/**
 * Tactical Tiles — Economy Lab.
 *
 * Why this exists: `sim-playtest.ts` measures the *feel* of a turn but tracks no gold at all, so
 * "does the economy need more money?" was previously unanswerable from the sims. This harness
 * runs real HARD-bot matches with the gold knobs overridden and keeps a per-seat ledger:
 *
 *   earned = starting gold + trickle + building income + heists + ace bounties (+ misc)
 *   spent  = shop items (redeploys are paid in CP, not gold)
 *   left   = gold still in hand when the match ended
 *
 * It also measures the thing that actually hurts: a dead unit whose respawn timer is up and who
 * cannot be redeployed because the seat is broke ("blocked respawn"), plus how long redeploys
 * take once affordable.
 *
 * Run:
 *   cd packages/engine
 *   bun sim-economy.ts                 # 4 arms × (12 two-player + 6 four-player) matches
 *   ECO_QUICK=1 bun sim-economy.ts     # smoke test
 *   ECO_2P=20 ECO_4P=10 bun sim-economy.ts
 *
 * Output: console tables + sim-results/economy.json
 */
import { mkdirSync } from 'node:fs';
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import { GOLD_SETTINGS, MAX_RESPAWNS, RESPAWN_CP_COST } from './src/constants/Config';
import type { GameAction, GameSettings } from './src/index';

interface Arm {
  key: string;
  start: number;
  income: number;
}

/** The three shipped setup presets; 200/+20 is the default. */
const ARMS: Arm[] = [
  { key: '150/+15', start: 150, income: 15 },
  { key: '200/+20 (default)', start: 200, income: 20 },
  { key: '300/+15', start: 300, income: 15 },
];

const QUICK = process.env.ECO_QUICK === '1';
const N2 = Number(process.env.ECO_2P ?? (QUICK ? 2 : 12));
const N4 = Number(process.env.ECO_4P ?? (QUICK ? 1 : 6));
const CAP = 4000;

// ── Shapes ───────────────────────────────────────────────────────
interface SeatEco {
  seat: number;
  turns: number;
  trickle: number;
  buildings: number;
  heists: number;
  heistGold: number;
  bounties: number;
  otherIn: number;
  respawnSpend: number;
  itemSpend: number;
  items: number;
  respawns: number;
  goldEndTurnSum: number;
  lowTurns: number; // ended a turn with < 50 (can't buy the cheapest thing)
  midTurns: number; // 50–149
  highTurns: number; // 150–299
  hoardTurns: number; // >= 300 (a Sniper respawn sitting idle)
  blockedTurns: number; // turn opened with a ready dead unit it could not afford
  stuckSum: number; // such units, summed over turns
  readySum: number; // ready dead units, summed over turns
  goldFinal: number;
  stranded: number; // dead at match end, never redeployed
  delays: number[];
  respawnByType: Record<string, number>;
}

interface MatchEco {
  key: string;
  players: number;
  rounds: number;
  stalled: boolean;
  rejects: number;
  actions: number;
  seats: SeatEco[];
  respawnDelays: number[];
}

const newSeat = (seat: number): SeatEco => ({
  seat, turns: 0, trickle: 0, buildings: 0, heists: 0, heistGold: 0, bounties: 0, otherIn: 0,
  respawnSpend: 0, itemSpend: 0, items: 0, respawns: 0,
  goldEndTurnSum: 0, lowTurns: 0, midTurns: 0, highTurns: 0, hoardTurns: 0,
  blockedTurns: 0, stuckSum: 0, readySum: 0, goldFinal: 0, stranded: 0, delays: [],
  respawnByType: {},
});

// ── Seeds (engine keeps the first 12 chars, so hash them) ────────
const seedFrom = (s: string): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let x = h >>> 0;
  let out = '';
  for (let i = 0; i < 8; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += alphabet[x % alphabet.length];
  }
  return out;
};

// ── One match ────────────────────────────────────────────────────
const playOne = (arm: Arm, players: number, seed: string): MatchEco => {
  const settings: GameSettings = {
    ...DEFAULT_GAME_SETTINGS,
    startingGold: arm.start,
    goldIncome: arm.income,
    playerCount: players,
    unitCounts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
    dynamicWeather: true,
    fogOfWar: false,
    victoryMode: 'CONQUER',
    aiDifficulty: 'HARD',
    mapSeed: seed,
    mapGen: { preset: 'balanced' },
  };

  let g = createGeneratedGame(settings);
  const seats = Array.from({ length: players }, (_, i) => newSeat(i));
  const deathRound = new Map<string, { round: number; seat: number }>();
  let actions = 0;
  let rejects = 0;
  let curSeat = -1;
  let blockedThisTurn = false;

  const closeTurn = (seat: number) => {
    const s = seats[seat];
    s.turns++;
    const gold = g.playerGold[seat] ?? 0;
    s.goldEndTurnSum += gold;
    if (gold >= 300) s.hoardTurns++;
    else if (gold >= 150) s.highTurns++;
    else if (gold >= 50) s.midTurns++;
    else s.lowTurns++;
  };

  while (g.winner === null && actions < CAP) {
    const seat = g.currentPlayer;
    if (seat !== curSeat) {
      if (curSeat !== -1) closeTurn(curSeat);
      curSeat = seat;
      blockedThisTurn = false;
    }
    const acc = seats[seat];

    // Economic pressure: bodies waiting on the respawn timer that the seat cannot pay for.
    // Once the seat has used all its respawns, a body in the graveyard is gone for good —
    // counting it as "blocked" would fake economy pressure that no amount of gold removes.
    const respawnsLeft = MAX_RESPAWNS - (g.playerRespawns[seat] ?? 0);
    const ready = respawnsLeft > 0
      ? g.graveyard.filter(u => u.owner === seat && u.turnsUntilRespawn === 0).slice(0, respawnsLeft)
      : [];
    if (ready.length > 0) {
      acc.readySum += ready.length;
      const unaffordable = ready.filter(u => (g.playerCp[seat] ?? 0) < RESPAWN_CP_COST[u.type]).length;
      if (unaffordable > 0) {
        if (!blockedThisTurn) {
          acc.blockedTurns++;
          blockedThisTurn = true;
        }
        acc.stuckSum += unaffordable;
      }
    }

    const proposed = botAction(g, 'HARD');
    const prep = prepareAction(g, seat, proposed);
    let action: GameAction;
    if (prep.ok) action = prep.action;
    else {
      rejects++;
      action = { type: 'END_TURN' };
    }

    const beforeGold = { ...g.playerGold };
    const beforeGrave = new Set(g.graveyard.map(x => x.id));
    const res = applyAction(g, action, { autoBankReward: true });

    if (res.rejected) {
      const end = applyAction(g, { type: 'END_TURN' }, { autoBankReward: true });
      g = end.state;
    } else {
      for (let s = 0; s < players; s++) {
        const d = (res.state.playerGold[s] ?? 0) - (beforeGold[s] ?? 0);
        if (d === 0) continue;
        const sa = seats[s];
        if (d > 0) {
          const heist = res.events.some(e => e.kind === 'heist') || action.type === 'BANK_REWARD';
          const bounty = res.events.some(e => e.kind === 'killed');
          if (action.type === 'END_TURN' && s !== seat) {
            const owned = res.state.mapData.filter(t => t.type === 'BUILDING' && t.owner === s).length;
            const buildingGold = owned * GOLD_SETTINGS.BUILDING_INCOME;
            sa.buildings += buildingGold;
            sa.trickle += d - buildingGold;
          } else if (heist) {
            sa.heistGold += d;
          } else if (bounty) {
            sa.bounties += d;
          } else {
            sa.otherIn += d;
          }
        } else if (action.type === 'SPAWN') {
          sa.respawnSpend += -d;
        } else {
          sa.itemSpend += -d;
        }
      }
      for (const e of res.events) {
        if (e.kind === 'heist') seats[seat].heists++;
      }
      if (action.type === 'SPAWN') {
        seats[seat].respawns++;
        const st = seats[seat].respawnByType;
        st[action.unitType] = (st[action.unitType] ?? 0) + 1;
      }
      if (action.type === 'BUY_DROP' || action.type === 'BUY_ITEM') seats[seat].items++;

      // Redeploy delay: death round -> round the body leaves the graveyard.
      const round = res.state.totalTurns;
      for (const gr of res.state.graveyard) {
        if (!beforeGrave.has(gr.id)) deathRound.set(gr.id, { round, seat: gr.owner });
      }
      const afterIds = new Set(res.state.graveyard.map(x => x.id));
      for (const id of beforeGrave) {
        if (afterIds.has(id)) continue;
        const rec = deathRound.get(id);
        if (rec !== undefined) {
          const delay = Math.max(0, round - rec.round);
          seats[rec.seat].delays.push(delay);
          deathRound.delete(id);
        }
      }
      g = res.state;
    }

    actions++;
  }

  if (curSeat !== -1) closeTurn(curSeat);

  for (const s of seats) {
    s.goldFinal = g.playerGold[s.seat] ?? 0;
    s.stranded =
      MAX_RESPAWNS - (g.playerRespawns[s.seat] ?? 0) > 0
        ? g.graveyard.filter(u => u.owner === s.seat).length
        : 0;
  }

  return {
    key: arm.key,
    players,
    rounds: g.totalTurns,
    stalled: g.winner === null,
    rejects,
    actions,
    seats,
    respawnDelays: seats.flatMap(s => s.delays),
  };
};

// ── Aggregation ──────────────────────────────────────────────────
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor((s.length - 1) / 2)];
};

const summarize = (arm: Arm, players: number, recs: MatchEco[]) => {
  const key = arm.key;
  const done = recs.filter(r => !r.stalled);
  const base = done.length ? done : recs;
  const seats = base.flatMap(r => r.seats);
  const turns = seats.reduce((s, x) => s + x.turns, 0) || 1;
  const earned =
    seats.reduce((s, x) => s + x.trickle + x.buildings + x.heistGold + x.bounties + x.otherIn, 0) || 1;
  const spent = seats.reduce((s, x) => s + x.respawnSpend + x.itemSpend, 0);
  const delays = base.flatMap(r => r.respawnDelays);
  return {
    key,
    players,
    n: recs.length,
    nDone: done.length,
    rounds: median(base.map(r => r.rounds)),
    turnsPerSeat: turns / seats.length,
    start: arm.start,
    income: arm.income,
    tricklePerTurn: seats.reduce((s, x) => s + x.trickle, 0) / turns,
    buildingSharePct: pct(seats.reduce((s, x) => s + x.buildings, 0), earned),
    heistSharePct: pct(seats.reduce((s, x) => s + x.heistGold, 0), earned),
    heistPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.heists, 0))),
    respawnSpendPerSeat: seats.reduce((s, x) => s + x.respawnSpend, 0) / seats.length,
    itemSpendPerSeat: seats.reduce((s, x) => s + x.itemSpend, 0) / seats.length,
    respawnsPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.respawns, 0))),
    itemsPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.items, 0))),
    spendRatePct: pct(spent, earned + arm.start * seats.length),
    goldPerTurn: seats.reduce((s, x) => s + x.goldEndTurnSum, 0) / turns,
    lowPct: pct(seats.reduce((s, x) => s + x.lowTurns, 0), turns),
    /** Share of turns ending with enough in hand to buy a tactical weapon next turn. */
    afford150Pct: pct(seats.reduce((s, x) => s + x.highTurns + x.hoardTurns, 0), turns),
    afford300Pct: pct(seats.reduce((s, x) => s + x.hoardTurns, 0), turns),
    respawnMix: seats.reduce<Record<string, number>>((acc, x) => {
      for (const [t, n] of Object.entries(x.respawnByType)) acc[t] = (acc[t] ?? 0) + n;
      return acc;
    }, {}),
    blockedPct: pct(seats.reduce((s, x) => s + x.blockedTurns, 0), turns),
    stuckPerTurn: seats.reduce((s, x) => s + x.stuckSum, 0) / turns,
    readyPerTurn: seats.reduce((s, x) => s + x.readySum, 0) / turns,
    leftPerSeat: seats.reduce((s, x) => s + x.goldFinal, 0) / seats.length,
    strandedPerSeat: seats.reduce((s, x) => s + x.stranded, 0) / seats.length,
    respawnDelay: mean(delays),
    stallPct: pct(recs.filter(r => r.stalled).length, recs.length),
    rejectPct: pct(base.reduce((s, r) => s + r.rejects, 0), base.reduce((s, r) => s + r.actions, 0) || 1),
  };
};

type Summary = ReturnType<typeof summarize>;

const HEAD =
  'arm'.padEnd(12) +
  'n'.padStart(4) +
  'medR'.padStart(6) +
  '€/turn'.padStart(8) +
  'end€'.padStart(7) +
  'left€'.padStart(7) +
  'spend%'.padStart(8) +
  'low%'.padStart(6) +
  'aff150%'.padStart(9) +
  'aff300%'.padStart(9) +
  'block%'.padStart(8) +
  'respawn'.padStart(9) +
  'delay'.padStart(7) +
  'items'.padStart(7) +
  'heist%'.padStart(8);

const printRow = (s: Summary) => {
  console.log(
    s.key.padEnd(12) +
      String(s.n).padStart(4) +
      String(s.rounds).padStart(6) +
      s.tricklePerTurn.toFixed(1).padStart(8) +
      s.goldPerTurn.toFixed(0).padStart(7) +
      s.leftPerSeat.toFixed(0).padStart(7) +
      s.spendRatePct.toFixed(0).padStart(8) +
      s.lowPct.toFixed(0).padStart(6) +
      s.afford150Pct.toFixed(0).padStart(9) +
      s.afford300Pct.toFixed(0).padStart(9) +
      s.blockedPct.toFixed(0).padStart(8) +
      s.respawnsPerMatch.toFixed(2).padStart(9) +
      s.respawnDelay.toFixed(1).padStart(7) +
      s.itemsPerMatch.toFixed(2).padStart(7) +
      s.heistSharePct.toFixed(0).padStart(8),
  );
};

// ── Execute ──────────────────────────────────────────────────────
const results: Record<string, Summary> = {};
const started = Date.now();
console.log(`Economy lab · ${ARMS.length} arms · ${N2} two-player + ${N4} four-player matches each\n`);

for (const players of [2, 4]) {
  const n = players === 2 ? N2 : N4;
  console.log(`=== ${players}P · balanced · HARD bots ===`);
  console.log(HEAD);
  for (const arm of ARMS) {
    const recs: MatchEco[] = [];
    for (let i = 0; i < n; i++) {
      const seed = seedFrom(`eco:${players}:${arm.start}:${arm.income}#${i}`);
      try {
        recs.push(playOne(arm, players, seed));
      } catch (err) {
        console.error(`\n!! ${arm.key} ${players}P #${i} crashed:`, err);
      }
    }
    if (!recs.length) continue;
    const s = summarize(arm, players, recs);
    results[`${players}P ${arm.key}`] = s;
    printRow(s);
  }
  console.log('');
}

console.log('=== 2P detail: where the gold goes ===');
for (const arm of ARMS) {
  const s = results[`2P ${arm.key}`];
  if (!s) continue;
  console.log(
    `${arm.key.padEnd(12)} start €${String(arm.start).padEnd(4)} +€${String(arm.income).padEnd(3)}/turn` +
      ` · per seat: items €${s.itemSpendPerSeat.toFixed(0)}` +
      ` · €${s.leftPerSeat.toFixed(0)} unspent at end` +
      ` · ${s.blockedPct.toFixed(0)}% of turns had a ready body the battery could not pay for` +
      ` · could buy a €150 weapon on ${s.afford150Pct.toFixed(0)}% of turns, €300 on ${s.afford300Pct.toFixed(0)}%` +
      ` · respawns/match: scout ${((s.respawnMix.SOLDIER ?? 0) / s.nDone).toFixed(1)} / breacher ${((s.respawnMix.ASSAULTER ?? 0) / s.nDone).toFixed(1)} / sniper ${((s.respawnMix.SNIPER ?? 0) / s.nDone).toFixed(1)}`,
  );
}

mkdirSync('sim-results', { recursive: true });
await Bun.write(
  'sim-results/economy.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), arms: ARMS, cells: results }, null, 2),
);
console.log(`\nWrote sim-results/economy.json · ${((Date.now() - started) / 1000).toFixed(0)}s`);
