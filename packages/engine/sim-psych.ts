/**
 * TEMPORARY psychology/pacing probe. Runs bot vs bot through the real rules pipeline and
 * logs payoff density, dead turns, comeback behaviour and unit utility. Deleted after the audit.
 * Run: bun sim-psych.ts
 */
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  getUnitOptions,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import { getManhattanDistance } from './src/grid/Pathfinding';
import type { GameAction, GameState, Unit } from './src/index';

type Policy = 'HARD' | 'RUSH' | 'TURTLE';
const MAX_ACTIONS = 3000;

const PAYOFF = new Set([
  'hit', 'killed', 'structureHit', 'heist', 'promotion', 'mineBlast',
  'capture', 'build', 'supplyLanded',
]);

const hqOf = (g: GameState, owner: number) => g.mapData.find(t => t.type === 'BASE' && t.owner === owner);

const choose = (g: GameState, policy: Policy): GameAction => {
  const cur = g.currentPlayer;
  if (policy === 'HARD') return botAction(g, 'HARD');
  const ready = g.units.filter(u => u.owner === cur && !u.completed);
  const cp = g.playerCp[cur] ?? 0;
  const enemyBase = g.mapData.find(t => t.type === 'BASE' && t.owner !== cur);
  const ownBase = hqOf(g, cur);

  const optsFor = (u: Unit) => getUnitOptions(g, u, new Set());

  if (policy === 'RUSH') {
    for (const u of ready) {
      const o = optsFor(u);
      if (enemyBase && o.siegeTiles.includes(enemyBase.id)) {
        const c = u.type === 'SNIPER' ? 8 : u.type === 'ASSAULTER' ? 5 : 3;
        if (cp >= c) return { type: 'SIEGE', unitId: u.id, tileId: enemyBase.id, cost: c };
      }
    }
    // march the unit that is closest to the enemy HQ
    const sorted = [...ready].sort((a, b) => {
      const ta = g.mapData.find(t => t.id === a.tileId)!;
      const tb = g.mapData.find(t => t.id === b.tileId)!;
      return getManhattanDistance(ta, enemyBase!) - getManhattanDistance(tb, enemyBase!);
    });
    for (const u of sorted) {
      if (u.hasMoved || u.isRooted || cp <= 0) continue;
      const o = optsFor(u);
      const uTile = g.mapData.find(t => t.id === u.tileId)!;
      let best: { id: string; cost: number; d: number } | null = null;
      for (const [id, cost] of o.moveCosts) {
        const t = g.mapData.find(x => x.id === id);
        if (!t || !enemyBase) continue;
        const d = getManhattanDistance(t, enemyBase);
        if (!best || d < best.d) best = { id, cost, d };
      }
      if (best) return { type: 'MOVE', unitId: u.id, targetTileId: best.id, cost: best.cost };
    }
    return { type: 'END_TURN' };
  }

  // TURTLE: kill > overwatch > hold cover near own HQ / centre
  for (const u of ready) {
    const o = optsFor(u);
    if (o.attackTargets.length > 0) {
      const targets = o.attackTargets
        .map(id => g.units.find(x => x.id === id)!)
        .filter(Boolean)
        .sort((a, b) => a.hp - b.hp);
      const cost = u.type === 'SNIPER' ? 8 : u.type === 'ASSAULTER' ? 5 : 3;
      if (targets[0] && cp >= cost) return { type: 'ATTACK', attackerId: u.id, targetUnitId: targets[0].id, cost };
    }
  }
  for (const u of ready) {
    const o = optsFor(u);
    if (o.attackTargets.length > 0) continue;
    const owCost = u.type === 'SNIPER' ? 6 : u.type === 'ASSAULTER' ? 4 : 3;
    if (cp >= owCost && !u.hasMoved) continue;
    if (cp >= owCost) return { type: 'OVERWATCH', unitId: u.id, cost: owCost };
  }
  for (const u of ready) {
    if (u.hasMoved || cp <= 0) continue;
    const o = optsFor(u);
    const uTile = g.mapData.find(t => t.id === u.tileId)!;
    let best: { id: string; cost: number; score: number } | null = null;
    for (const [id, cost] of o.moveCosts) {
      const t = g.mapData.find(x => x.id === id);
      if (!t) continue;
      const cover = t.type === 'FOREST' ? 3 : t.type === 'BUILDING' ? 4 : t.type === 'MOUNTAIN' ? 2 : 0;
      const hqGuard = ownBase ? -getManhattanDistance(t, ownBase) * 0.4 : 0;
      const center = -(Math.abs(t.x - g.gridSize / 2) + Math.abs(t.y - g.gridSize / 2)) * 0.15;
      const score = cover + hqGuard + center;
      if (!best || score > best.score) best = { id, cost, score };
    }
    if (best && best.cost > 0) return { type: 'MOVE', unitId: u.id, targetTileId: best.id, cost: best.cost };
  }
  return { type: 'END_TURN' };
};

interface Row {
  winner: number | 'DRAW' | null;
  rounds: number;
  actions: number;
  payoff: number;
  kills: number;
  hqHits: number;
  heists: number;
  promos: number;
  turns: number;
  deadTurns: number;
  firstBlood: number | null;
  firstHq: number | null;
  stalled: boolean;
  leaderAt10: number | null;
  winnerBehindAt10: boolean | null;
  deadByType: Record<string, number>;
  dmgByType: Record<string, number>;
  hqLow: number;
  cpSpent: number;
  cpLeft: number;
  emptyCpTurns: number;
  richCpTurns: number;
}

const playOne = (
  seed: string,
  p0: Policy,
  p1: Policy,
  opts: { victoryMode?: 'CONQUER' | 'DEATHMATCH'; unitCounts?: Record<string, number>; doomsday?: boolean } = {},
): Row => {
  const settings = {
    ...DEFAULT_GAME_SETTINGS,
    mapSeed: seed,
    victoryMode: opts.victoryMode ?? 'CONQUER',
    dynamicWeather: true,
    doomsdayEnabled: opts.doomsday ?? false,
    ...(opts.unitCounts ? { unitCounts: opts.unitCounts as never } : {}),
  };
  let g = createGeneratedGame(settings);
  const r: Row = {
    winner: null, rounds: 0, actions: 0, payoff: 0, kills: 0, hqHits: 0, heists: 0,
    promos: 0, turns: 0, deadTurns: 0, firstBlood: null, firstHq: null, stalled: false,
    leaderAt10: null, winnerBehindAt10: null, deadByType: {}, dmgByType: {}, hqLow: 50, cpSpent: 0,
    cpLeft: 0, emptyCpTurns: 0, richCpTurns: 0,
  };
  let turnPayoff = 0;
  let turnActions = 0;
  let leaderSeen = false;
  const deadByType: Record<string, number> = {};
  const dmgByType: Record<string, number> = {};

  while (g.winner === null && r.actions < MAX_ACTIONS) {
    const seat = g.currentPlayer;
    const pol = seat === 0 ? p0 : p1;
    const proposed = choose(g, pol);
    const prep = prepareAction(g, seat, proposed);
    const action: GameAction = prep.ok ? prep.action : { type: 'END_TURN' };
    if ('cost' in action) r.cpSpent += (action as { cost: number }).cost;
    if (action.type === 'END_TURN') {
      const left = g.playerCp[g.currentPlayer] ?? 0;
      r.cpLeft += left;
      if (left <= 0) r.emptyCpTurns++;
      if (left >= 10) r.richCpTurns++;
    }
    const res = applyAction(g, action, { autoBankReward: true });
    if (res.rejected) {
      const end = applyAction(g, { type: 'END_TURN' }, { autoBankReward: true });
      g = end.state;
    } else {
      for (const e of res.events) {
        if (PAYOFF.has(e.kind)) {
          r.payoff++;
          turnPayoff++;
        }
        if (e.kind === 'killed') {
          r.kills++;
          const t = (e as { unitType: string }).unitType;
          deadByType[t] = (deadByType[t] ?? 0) + 1;
        }
        if (e.kind === 'hit') {
          if (r.firstBlood === null) r.firstBlood = g.totalTurns + 1;
        }
        if (e.kind === 'structureHit' && (e as { structureType: string }).structureType === 'BASE') {
          r.hqHits++;
          if (r.firstHq === null) r.firstHq = g.totalTurns + 1;
        }
        if (e.kind === 'heist') r.heists++;
        if (e.kind === 'promotion') r.promos++;
      }
      g = res.state;
    }
    turnActions++;
    r.actions++;

    if (action.type === 'END_TURN') {
      r.turns++;
      if (turnPayoff === 0) r.deadTurns++;
      turnPayoff = 0;
      turnActions = 0;
    }
    if (!leaderSeen && g.totalTurns >= 10) {
      leaderSeen = true;
      const score = (owner: number) => {
        const hq = hqOf(g, owner);
        return (hq?.hp ?? 0) + g.units.filter(u => u.owner === owner).length * 12;
      };
      r.leaderAt10 = score(0) >= score(1) ? 0 : 1;
    }
  }

  r.winner = g.winner;
  r.rounds = g.totalTurns;
  r.stalled = g.winner === null;
  r.deadByType = deadByType;
  for (const u of g.units) {
    const t = u.type;
    dmgByType[t] = (dmgByType[t] ?? 0) + (u.damageDealt ?? 0);
  }
  r.dmgByType = dmgByType;
  r.hqLow = Math.min(...g.mapData.filter(t => t.type === 'BASE').map(t => t.hp ?? 0));
  if (r.leaderAt10 !== null && typeof g.winner === 'number') r.winnerBehindAt10 = r.leaderAt10 !== g.winner;
  return r;
};

const summarize = (name: string, rows: Row[]) => {
  const n = rows.length;
  const done = rows.filter(r => !r.stalled);
  const p0 = rows.filter(r => r.winner === 0).length;
  const p1 = rows.filter(r => r.winner === 1).length;
  const draws = rows.filter(r => r.winner === 'DRAW').length;
  const rounds = done.map(r => r.rounds).sort((a, b) => a - b);
  const med = rounds.length ? rounds[Math.floor(rounds.length / 2)] : 0;
  const avg = rows.reduce((s, r) => s + r.rounds, 0) / n;
  const turns = rows.reduce((s, r) => s + r.turns, 0) || 1;
  const dead = rows.reduce((s, r) => s + r.deadTurns, 0);
  const payoff = rows.reduce((s, r) => s + r.payoff, 0);
  const behind = rows.filter(r => r.winnerBehindAt10 === true).length;
  const known = rows.filter(r => r.winnerBehindAt10 !== null && r.winner !== 'DRAW').length;
  console.log(
    `${name.padEnd(34)} n=${n} P0=${p0} P1=${p1} D=${draws} | med=${med} avg=${avg.toFixed(1)} ` +
    `min=${rounds[0] ?? '-'} max=${rounds[rounds.length - 1] ?? '-'} | stall=${rows.filter(r => r.stalled).length} | ` +
    `turns=${turns} dead=${(100 * dead / turns).toFixed(1)}% | payoff/turn=${(payoff / turns).toFixed(2)} | ` +
    `actions/turn=${(rows.reduce((s, r) => s + r.actions, 0) / turns).toFixed(1)} | ` +
    `CPleft/turn=${(rows.reduce((s, r) => s + r.cpLeft, 0) / turns).toFixed(1)} | ` +
    `turns@0CP=${Math.round(100 * rows.reduce((s, r) => s + r.emptyCpTurns, 0) / turns)}% ` +
    `turns@10+CP=${Math.round(100 * rows.reduce((s, r) => s + r.richCpTurns, 0) / turns)}% | ` +
    `R30+=${Math.round(100 * rows.filter(r => r.rounds >= 30).length / n)}% | ` +
    `comeback@10=${known ? Math.round(100 * behind / known) : '-'}%`,
  );
  const fb = done.map(r => r.firstBlood).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const fh = done.map(r => r.firstHq).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const medOf = (a: number[]) => (a.length ? a[Math.floor(a.length / 2)] : '-');
  console.log(
    `  ↳ first blood round med=${medOf(fb)} | first HQ damage round med=${medOf(fh)} | ` +
    `kills/match=${(rows.reduce((s, r) => s + r.kills, 0) / n).toFixed(1)} ` +
    `heists/match=${(rows.reduce((s, r) => s + r.heists, 0) / n).toFixed(2)} ` +
    `HQshots/match=${(rows.reduce((s, r) => s + r.hqHits, 0) / n).toFixed(1)} ` +
    `promotions/match=${(rows.reduce((s, r) => s + r.promos, 0) / n).toFixed(2)} ` +
    `CP/turn=${(rows.reduce((s, r) => s + r.cpSpent, 0) / turns).toFixed(1)}`,
  );
};

const rows: Record<string, Row[]> = {};
const add = (k: string, row: Row) => (rows[k] ??= []).push(row);

for (let i = 0; i < 100; i++) add('HARD vs HARD (Conquer)', playOne(`PSY${i}`, 'HARD', 'HARD'));
for (let i = 0; i < 40; i++) add('RUSH(P0) vs HARD', playOne(`RSH${i}`, 'RUSH', 'HARD'));
for (let i = 0; i < 40; i++) add('HARD vs RUSH(P1)', playOne(`RSI${i}`, 'HARD', 'RUSH'));
for (let i = 0; i < 30; i++) add('TURTLE(P0) vs HARD', playOne(`TRT${i}`, 'TURTLE', 'HARD'));
for (let i = 0; i < 30; i++) add('HARD vs TURTLE(P1)', playOne(`TRU${i}`, 'HARD', 'TURTLE'));
for (let i = 0; i < 25; i++) add('HARD Deathmatch+Doomsday', playOne(`PSD${i}`, 'HARD', 'HARD', { victoryMode: 'DEATHMATCH', doomsday: true }));
for (let i = 0; i < 25; i++) {
  add('Sniper-heavy P0 vs Scout-heavy', playOne(`SNP${i}`, 'HARD', 'HARD', { unitCounts: { SOLDIER: 1, ASSAULTER: 1, SNIPER: 3 } }));
}

for (const [k, v] of Object.entries(rows)) summarize(k, v);

// Unit utility across every match played
const deadAll: Record<string, number> = {};
const dmgAll: Record<string, number> = {};
for (const list of Object.values(rows)) {
  for (const r of list) {
    for (const [t, c] of Object.entries(r.deadByType)) deadAll[t] = (deadAll[t] ?? 0) + c;
    for (const [t, c] of Object.entries(r.dmgByType)) dmgAll[t] = (dmgAll[t] ?? 0) + c;
  }
}
console.log('\n--- UNIT UTILITY (all matches) ---');
for (const t of ['SOLDIER', 'ASSAULTER', 'SNIPER']) {
  const deaths = deadAll[t] ?? 0;
  const dmg = dmgAll[t] ?? 0;
  console.log(`${t.padEnd(10)} deaths=${deaths} damage=${dmg} dmg/death=${deaths ? (dmg / deaths).toFixed(1) : '-'}`);
}

// Dead-turn distribution for the pure HARD baseline
const base = rows['HARD vs HARD (Conquer)'];
const buckets = [0, 1, 2, 3, 5];
console.log('\n--- DEAD-TURN SHARE (HARD vs HARD) ---');
for (let i = 0; i < buckets.length; i++) {
  const lo = buckets[i];
  const hi = buckets[i + 1];
  const inBand = base.filter(r => {
    const pct = 100 * r.deadTurns / Math.max(1, r.turns);
    return pct >= lo && (hi === undefined || pct < hi);
  }).length;
  console.log(`${lo}${hi === undefined ? '+' : '-' + hi}% dead turns: ${inBand}/${base.length} matches`);
}
