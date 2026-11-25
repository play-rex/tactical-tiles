/**
 * Command Point battery audit: 300 full bot-vs-bot matches.
 *
 * Two CP economies x five map presets, each applied to CP_SYSTEM for the whole cell:
 *   CP 20/+10  Classic CP option (MAX_CP 20, REGEN 10, P1 round1 15)
 *   CP 30/+15  shipped default  (MAX_CP 30, REGEN 15, P1 round1 22)
 *
 * The loop is exactly the server's: botAction -> prepareAction -> applyAction, so anything
 * the rules reject shows up here as a fault instead of as a desynced client.
 *
 * Run (from packages/engine):  bun sim-cp-audit.ts
 * Scale it:                   GAMES_PER_CELL=5 bun sim-cp-audit.ts
 * Raw rows are written to /tmp/tactical-cp-sim.json for follow-up analysis.
 */
import { writeFileSync } from 'node:fs';
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import { getEffectiveCpRules } from './src/rules/CombatRules';
import { CP_SYSTEM, TERRAIN_COSTS } from './src/constants/Config';
import type { GameAction, GameState, UnitType } from './src/index';

const MAPS = ['balanced', 'archipelago', 'badlands', 'fortress', 'open_blitz'] as const;
type MapId = (typeof MAPS)[number];

interface Variant {
  id: string;
  maxCp: number;
  regen: number;
  p1: number;
}
const VARIANTS: Variant[] = [
  { id: 'CP 20/+10', maxCp: 20, regen: 10, p1: 15 },
  { id: 'CP 30/+15', maxCp: 30, regen: 15, p1: 22 },
];

const applyVariant = (variant: Variant) => {
  CP_SYSTEM.MAX_CP = variant.maxCp;
  CP_SYSTEM.REGEN_AMOUNT = variant.regen;
  CP_SYSTEM.P1_ROUND1_CP = variant.p1;
};

// Optional calibration arm for the standard battery, e.g. CP_OVERRIDE=25/12/18 (max/regen/P1 round 1).
const CP_OVERRIDE = process.env.CP_OVERRIDE;
if (CP_OVERRIDE) {
  const [maxCp, regen, p1] = CP_OVERRIDE.split('/').map(Number);
  if (maxCp > 0 && regen > 0) {
    VARIANTS.push({ id: `CP ${maxCp}/+${regen}`, maxCp, regen, p1: p1 > 0 ? p1 : maxCp });
  }
}

const GAMES_PER_CELL = Number(process.env.GAMES_PER_CELL ?? 30);
const MAX_ACTIONS = Number(process.env.MAX_ACTIONS ?? 4000);
const OUT_JSON = process.env.OUT_JSON ?? '/tmp/tactical-cp-sim.json';
const SEED_OFFSET = Number(process.env.SEED_OFFSET ?? 0);
const MAP_FILTER = process.env.MAPS_FILTER ? process.env.MAPS_FILTER.split(',') : null;
const VARIANT_FILTER = process.env.VARIANT_FILTER ? process.env.VARIANT_FILTER.split(',') : null;

const PAYOFF = new Set([
  'hit', 'killed', 'structureHit', 'heist', 'promotion', 'mineBlast', 'capture', 'heal',
  'supplyLanded',
]);
const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
};
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fixed = (n: number, d = 1): string => Number.isFinite(n) ? n.toFixed(d) : '-';
const rate = (n: number, d: number): string => (d > 0 ? `${Math.round((100 * n) / d)}%` : '-');

/** 95% Wilson interval for a proportion, as a compact string. */
const wilson = (k: number, n: number): string => {
  if (n === 0) return '-';
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return `${fixed(100 * centre, 0)}%±${fixed(100 * half, 0)}`;
};

interface MapMetrics {
  size: number;
  passablePct: number;
  waterPct: number;
  forestPct: number;
  mountainPct: number;
  sandPct: number;
  canyonPct: number;
  quicksand: number;
  dunes: number;
  bridges: number;
  buildings: number;
  banks: number;
  /** Sniper high ground (MOUNTAIN + DUNES) inside each player's Voronoi zone. */
  perches0: number;
  perches1: number;
  /** Forest + mountain + building tiles (damage-reducing cover) per zone. */
  cover0: number;
  cover1: number;
  /** Manhattan distance from each HQ to its nearest bank. */
  bankDist0: number;
  bankDist1: number;
  /** Walking distance between the two HQs (-1 when no foot route exists). */
  hqGroundDist: number;
  connected: boolean;
  /** Largest one-way asymmetry (perches, cover) as a share of the larger side. */
  perchGap: number;
  coverGap: number;
}

const groundDistance = (map: GameState['mapData'], size: number, fromId: string, toId: string): number => {
  const idx = (x: number, y: number) => y * size + x;
  const start = map.find(t => t.id === fromId);
  const goal = map.find(t => t.id === toId);
  if (!start || !goal) return -1;
  const dist = new Int32Array(size * size).fill(-1);
  const queue: number[] = [idx(start.x, start.y)];
  dist[idx(start.x, start.y)] = 0;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const cx = cur % size;
    const cy = (cur - cx) / size;
    if (cur === idx(goal.x, goal.y)) return dist[cur];
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const ni = idx(nx, ny);
      if (dist[ni] !== -1) continue;
      const t = map[ni];
      // The HQ itself costs 99 to enter; it is the destination, so step onto it explicitly.
      if (!t) continue;
      if (ni === idx(goal.x, goal.y)) return dist[cur] + 1;
      if (t.hazardState === 'LAVA' || (TERRAIN_COSTS[t.type] ?? 99) >= 90) continue;
      dist[ni] = dist[cur] + 1;
      queue.push(ni);
    }
  }
  return -1;
};

const snapshotMap = (g: GameState): MapMetrics => {
  const { mapData: map, gridSize: size } = g;
  const total = size * size;
  const hqs = map.filter(t => t.type === 'BASE');
  const hq0 = hqs.find(t => t.owner === 0);
  const hq1 = hqs.find(t => t.owner === 1);
  const banks = map.filter(t => t.type === 'BANK');
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const nearestBank = (hq?: { x: number; y: number }) =>
    hq && banks.length ? Math.min(...banks.map(b => dist(hq, b))) : -1;
  const count = (fn: (t: (typeof map)[number]) => boolean) => map.filter(fn).length;
  const passable = count(t => t.hazardState !== 'LAVA' && (TERRAIN_COSTS[t.type] ?? 99) < 90);
  const perches0 = count(t => t.zone === 0 && (t.type === 'MOUNTAIN' || t.type === 'DUNES'));
  const perches1 = count(t => t.zone === 1 && (t.type === 'MOUNTAIN' || t.type === 'DUNES'));
  const cover0 = count(t => t.zone === 0 && (t.type === 'FOREST' || t.type === 'MOUNTAIN' || t.type === 'BUILDING'));
  const cover1 = count(t => t.zone === 1 && (t.type === 'FOREST' || t.type === 'MOUNTAIN' || t.type === 'BUILDING'));
  const groundDist = hq0 && hq1 ? groundDistance(map, size, hq0.id, hq1.id) : -1;
  return {
    size,
    passablePct: (100 * passable) / total,
    waterPct: (100 * count(t => t.type === 'WATER')) / total,
    forestPct: (100 * count(t => t.type === 'FOREST')) / total,
    mountainPct: (100 * count(t => t.type === 'MOUNTAIN')) / total,
    sandPct: (100 * count(t => t.type === 'SAND' || t.type === 'DUNES' || t.type === 'QUICKSAND')) / total,
    canyonPct: (100 * count(t => t.type === 'CANYON')) / total,
    quicksand: count(t => t.type === 'QUICKSAND'),
    dunes: count(t => t.type === 'DUNES'),
    bridges: count(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V'),
    buildings: count(t => t.type === 'BUILDING'),
    banks: banks.length,
    perches0,
    perches1,
    cover0,
    cover1,
    bankDist0: nearestBank(hq0),
    bankDist1: nearestBank(hq1),
    hqGroundDist: groundDist,
    connected: groundDist >= 0,
    perchGap: Math.max(perches0, perches1) > 0
      ? Math.abs(perches0 - perches1) / Math.max(perches0, perches1)
      : 0,
    coverGap: Math.max(cover0, cover1) > 0 ? Math.abs(cover0 - cover1) / Math.max(cover0, cover1) : 0,
  };
};

interface GameRow {
  variant: string;
  map: MapId;
  seed: string;
  winner: number | 'DRAW' | null;
  winBy: 'HQ' | 'WIPE' | 'OTHER' | null;
  rounds: number;
  actions: number;
  crashed: string | null;
  rejects: string[];
  appliedRejects: string[];
  /** CP economy. */
  cpAtCapTurns: number;
  cpStartSum: number;
  cpSpentSum: number;
  cpLeftSum: number;
  regenWaste: number;
  maxTurnSpend: number;
  turnEnds: number;
  zeroLeftTurns: number;
  richLeftTurns: number;
  burstTurns: number;
  cpuTuned: boolean;
  /** Behaviour. */
  actionsByType: Record<string, number>;
  kills: number;
  heists: number;
  promotions: number;
  hqHits: number;
  /** Biggest single-turn damage dealt to an enemy HQ (50 HP = kill from full). */
  maxHqBurst: number;
  hqBurstTurns: number;
  /** Longest run of consecutive rounds with no payoff event (a frozen board). */
  longestQuiet: number;
  quietAtEnd: number;
  lastHqRound: number | null;
  captures: number;
  banksBreached: number;
  deadUnits: number;
  deadByType: Record<string, number>;
  dmgByType: Record<string, number>;
  siegeDmgByType: Record<string, number>;
  payoff: number;
  deadTurns: number;
  firstBlood: number | null;
  firstHq: number | null;
  firstHeist: number | null;
  /** Fault probes. */
  negGold: boolean;
  overCap: boolean;
  completedLeak: number;
  stuckPending: boolean;
  stalled: boolean;
  /** Final board. */
  alive0: number;
  alive1: number;
  gold0: number;
  gold1: number;
  hqHp0: number;
  hqHp1: number;
  graveyard0: number;
  graveyard1: number;
  mapMetrics: MapMetrics;
}

const emptyRow = (variant: string, map: MapId, seed: string, mapMetrics: MapMetrics): GameRow => ({
  variant, map, seed, winner: null, winBy: null, rounds: 0, actions: 0, crashed: null,
  rejects: [], appliedRejects: [], cpAtCapTurns: 0, cpStartSum: 0, cpSpentSum: 0, cpLeftSum: 0,
  regenWaste: 0, maxTurnSpend: 0, turnEnds: 0, zeroLeftTurns: 0, richLeftTurns: 0, burstTurns: 0,
  cpuTuned: true, actionsByType: {}, kills: 0, heists: 0, promotions: 0, hqHits: 0, captures: 0,
  maxHqBurst: 0, hqBurstTurns: 0, longestQuiet: 0, quietAtEnd: 0, lastHqRound: null,
  banksBreached: 0, deadUnits: 0, deadByType: {}, dmgByType: {}, siegeDmgByType: {}, payoff: 0,
  deadTurns: 0, firstBlood: null, firstHq: null, firstHeist: null, negGold: false, overCap: false,
  completedLeak: 0, stuckPending: false, stalled: false, alive0: 0, alive1: 0, gold0: 0, gold1: 0, hqHp0: 0, hqHp1: 0,
  graveyard0: 0, graveyard1: 0, mapMetrics,
});

const playOne = (variant: Variant, mapId: MapId, seed: string): GameRow => {
  let g: GameState;
  let row: GameRow;
  const settings = {
    ...DEFAULT_GAME_SETTINGS,
    mapSeed: seed,
    mapGen: { preset: mapId },
    victoryMode: 'CONQUER' as const,
    aiDifficulty: 'HARD' as const,
    mutators: { classicCp: false, scarcity: false, ironman: false },
  };
  try {
    g = createGeneratedGame(settings);
    row = emptyRow(variant.id, mapId, seed, snapshotMap(g));
  } catch (e) {
    const blank: MapMetrics = {
      size: 0, passablePct: 0, waterPct: 0, forestPct: 0, mountainPct: 0, sandPct: 0, canyonPct: 0,
      quicksand: 0, dunes: 0, bridges: 0, buildings: 0, banks: 0, perches0: 0, perches1: 0,
      cover0: 0, cover1: 0, bankDist0: -1, bankDist1: -1, hqGroundDist: -1, connected: false,
      perchGap: 0, coverGap: 0,
    };
    row = emptyRow(variant.id, mapId, seed, blank);
    row.crashed = `setup: ${e instanceof Error ? e.message : String(e)}`;
    return row;
  }

  const cpRules = getEffectiveCpRules(settings.mutators);
  if (cpRules.maxCp !== variant.maxCp || cpRules.regenAmount !== variant.regen || cpRules.p1Round1Cp !== variant.p1) {
    row.cpuTuned = false;
  }

  let turnSeat = -1;
  let turnStartCp = 0;
  let turnSpent = 0;
  let turnActions = 0;
  let turnPayoff = 0;
  let turnHqDmg = 0;
  let quietRun = 0;
  const lastLeftover = [0, 0];
  let hqDestroyed = false;

  try {
    while (g.winner === null && row.actions < MAX_ACTIONS) {
      const seat = g.currentPlayer;
      if (seat !== turnSeat) {
        turnSeat = seat;
        turnStartCp = g.playerCp[seat] ?? 0;
        turnSpent = 0;
        turnActions = 0;
        turnPayoff = 0;
        turnHqDmg = 0;
        row.cpStartSum += turnStartCp;
        row.turnEnds += 0; // counted on END_TURN
        if (turnStartCp >= variant.maxCp) row.cpAtCapTurns++;
        row.regenWaste += Math.max(0, (lastLeftover[seat] ?? 0) + cpRules.regenAmount - variant.maxCp);
        row.actionsByType.END_TURN_STARTS = (row.actionsByType.END_TURN_STARTS ?? 0) + 0;
        row.actionsByType.turns = (row.actionsByType.turns ?? 0) + 1;
        const leaked = g.units.filter(u => u.owner === seat && u.completed).length;
        if (leaked > 0) row.completedLeak += leaked;
      }

      const proposed = botAction(g, 'HARD') as GameAction;
      let action: GameAction;
      const prepared = prepareAction(g, seat, proposed);
      if (prepared.ok) {
        action = prepared.action;
      } else {
        row.rejects.push(`${proposed.type}: ${prepared.error}`);
        action = { type: 'END_TURN' };
      }

      const actorId =
        action.type === 'ATTACK' ? action.attackerId
          : 'unitId' in action ? action.unitId
            : null;
      const actorType: UnitType | undefined = actorId
        ? g.units.find(u => u.id === actorId)?.type
        : undefined;

      const cost = 'cost' in action ? Number((action as { cost?: number }).cost ?? 0) : 0;
      const isEnd = action.type === 'END_TURN';
      const cpBefore = g.playerCp[seat] ?? 0;

      if (isEnd) {
        const left = g.playerCp[seat] ?? 0;
        row.cpLeftSum += left;
        row.turnEnds++;
        lastLeftover[seat] = left;
        row.cpSpentSum += turnSpent;
        row.maxTurnSpend = Math.max(row.maxTurnSpend, turnSpent);
        if (turnSpent >= 20) row.burstTurns++;
        if (left <= 0) row.zeroLeftTurns++;
        if (left >= Math.floor(variant.maxCp / 2)) row.richLeftTurns++;
        if (turnPayoff === 0) {
          row.deadTurns++;
          quietRun++;
          row.longestQuiet = Math.max(row.longestQuiet, quietRun);
        } else {
          quietRun = 0;
        }
        row.maxHqBurst = Math.max(row.maxHqBurst, turnHqDmg);
        if (turnHqDmg >= 50) row.hqBurstTurns++;
      }

      const res = applyAction(g, action, { autoBankReward: true });
      if (res.rejected) {
        row.appliedRejects.push(`${action.type}: ${res.rejected}`);
        const end = applyAction(g, { type: 'END_TURN' }, { autoBankReward: true });
        g = end.state;
      } else {
        row.actionsByType[action.type] = (row.actionsByType[action.type] ?? 0) + 1;
        if (action.type !== 'END_TURN' && !res.rejected) {
          // only count a real action's CP after it was actually applied
        }
        for (const e of res.events) {
          if (PAYOFF.has(e.kind)) {
            row.payoff++;
            turnPayoff++;
          }
          if (e.kind === 'hit') {
            if (row.firstBlood === null) row.firstBlood = g.totalTurns + 1;
            if (actorType) row.dmgByType[actorType] = (row.dmgByType[actorType] ?? 0) + e.damage;
          }
          if (e.kind === 'killed') {
            row.kills++;
            row.deadUnits++;
            row.deadByType[e.unitType] = (row.deadByType[e.unitType] ?? 0) + 1;
          }
          if (e.kind === 'structureHit') {
            if (e.structureType === 'BASE') {
              row.hqHits++;
              turnHqDmg += e.damage;
              row.lastHqRound = g.totalTurns + 1;
              if (row.firstHq === null) row.firstHq = g.totalTurns + 1;
              if (e.destroyed) hqDestroyed = true;
            }
            if (actorType) {
              row.siegeDmgByType[actorType] = (row.siegeDmgByType[actorType] ?? 0) + e.damage;
            }
          }
          if (e.kind === 'heist' && row.firstHeist === null) row.firstHeist = g.totalTurns + 1;
          if (e.kind === 'promotion') row.promotions++;
          if (e.kind === 'capture') row.captures++;
        }
        if (isEnd) {
          // turnSpent already accounted above
        } else {
          // Charge what the action actually took: a MOVE interrupted by Overwatch or a mine
          // only pays for the tiles walked, and a heist can refund CP in the same action.
          const delta = cpBefore - (g.playerCp[seat] ?? 0);
          turnSpent += delta > 0 ? delta : cost;
        }
        g = res.state;
      }
      row.actions++;
      turnActions++;

      if (row.actions % 97 === 0) {
        const over = Object.entries(g.playerCp).some(([, cp]) => cp > variant.maxCp);
        if (over) row.overCap = true;
      }
    }

    row.winner = g.winner;
    row.rounds = g.totalTurns;
    row.stalled = g.winner === null;
    row.quietAtEnd = quietRun;
    row.banksBreached = g.mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) >= 100).length;
    row.negGold = (g.playerGold[0] ?? 0) < 0 || (g.playerGold[1] ?? 0) < 0;
    row.stuckPending = g.bankRewardPending != null;
    row.alive0 = g.units.filter(u => u.owner === 0).length;
    row.alive1 = g.units.filter(u => u.owner === 1).length;
    row.gold0 = g.playerGold[0] ?? 0;
    row.gold1 = g.playerGold[1] ?? 0;
    row.graveyard0 = g.graveyard.filter(u => u.owner === 0).length;
    row.graveyard1 = g.graveyard.filter(u => u.owner === 1).length;
    const hq = (owner: number) => g.mapData.find(t => t.type === 'BASE' && t.owner === owner);
    row.hqHp0 = hq(0)?.hp ?? 0;
    row.hqHp1 = hq(1)?.hp ?? 0;
    row.heists = (g.matchStats[0]?.heists ?? 0) + (g.matchStats[1]?.heists ?? 0);
    if (typeof g.winner === 'number') {
      const loser = g.winner === 0 ? 1 : 0;
      const enemyAlive = g.units.filter(u => u.owner === loser).length;
      row.winBy = hqDestroyed ? 'HQ' : enemyAlive === 0 ? 'WIPE' : 'OTHER';
    }
    if (!row.overCap) {
      row.overCap = Object.values(g.playerCp).some(cp => cp > variant.maxCp);
    }
  } catch (e) {
    row.crashed = `turn ${g.totalTurns}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`;
    row.winner = g.winner;
    row.rounds = g.totalTurns;
    row.stalled = g.winner === null;
  }
  return row;
};

// ── Run ──────────────────────────────────────────────────────────

const rows: GameRow[] = [];
const started = Date.now();
let played = 0;

const ACTIVE_VARIANTS = VARIANT_FILTER ? VARIANTS.filter(v => VARIANT_FILTER.includes(v.id)) : VARIANTS;
const ACTIVE_MAPS = MAP_FILTER ? MAPS.filter(m => MAP_FILTER.includes(m)) : [...MAPS];

for (const variant of ACTIVE_VARIANTS) {
  for (const mapId of ACTIVE_MAPS) {
    for (let i = 0; i < GAMES_PER_CELL; i++) {
      const seed = `CP${variant.maxCp}-${i + SEED_OFFSET}-${mapId.slice(0, 2).toUpperCase()}`;
      applyVariant(variant);
      rows.push(playOne(variant, mapId, seed));
      played++;
      if (played % 25 === 0) {
        process.stderr.write(`  ${played}/${ACTIVE_VARIANTS.length * ACTIVE_MAPS.length * GAMES_PER_CELL} games (${fixed((Date.now() - started) / 1000, 0)}s)\n`);
      }
    }
  }
}
process.stderr.write(`played ${played} games in ${fixed((Date.now() - started) / 1000, 1)}s\n`);

const mistuned = rows.filter(r => !r.cpuTuned);
if (mistuned.length > 0) {
  process.stderr.write(`ERROR: ${mistuned.length}/${rows.length} games ran a different CP battery than their label\n`);
  process.exitCode = 1;
}

// ── Aggregation ──────────────────────────────────────────────────

interface Summary {
  label: string;
  n: number;
  p0: number;
  p1: number;
  draws: number;
  stalls: number;
  crashes: number;
  rounds: number[];
  cpUtil: number;
  cpLeft: number;
  turns: number;
  atCap: number;
  waste: number;
  deadTurnPct: number;
  payoffPerTurn: number;
  actionsPerTurn: number;
  maxSpend: number;
  burstPct: number;
  kills: number;
  heists: number;
  promos: number;
  hqHits: number;
  hqBurstMax: number;
  hqBurstTurns: number;
  longestQuiet: number;
  frozenGames: number;
  goldEnd: number;
  goldEndMedian: number;
  sinceHq: number;
  breachedGames: number;
  heistlessGames: number;
  rejects: number;
  firstBlood: number[];
  firstHq: number[];
  winBy: Record<string, number>;
  cpStart: number;
  zeroLeft: number;
  richLeft: number;
  perchGap: number;
  coverGap: number;
  disconnected: number;
  cpUses: Record<string, number>;
  deaths: Record<string, number>;
  dmg: Record<string, number>;
  siegeDmg: Record<string, number>;
  hqDist: number;
}

const summarize = (label: string, list: GameRow[]): Summary => {
  const t = (k: string) => list.reduce((a, r) => a + (r.actionsByType[k] ?? 0), 0);
  const sumD = (pick: (r: GameRow) => Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const r of list) for (const [k, v] of Object.entries(pick(r))) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const winBy: Record<string, number> = {};
  for (const r of list) if (r.winBy) winBy[r.winBy] = (winBy[r.winBy] ?? 0) + 1;
  return {
    label,
    n: list.length,
    p0: list.filter(r => r.winner === 0).length,
    p1: list.filter(r => r.winner === 1).length,
    draws: list.filter(r => r.winner === 'DRAW').length,
    stalls: list.filter(r => r.stalled).length,
    crashes: list.filter(r => r.crashed).length,
    rounds: list.map(r => r.rounds),
    cpUtil: list.reduce((a, r) => a + r.cpSpentSum, 0) / Math.max(1, list.reduce((a, r) => a + r.cpStartSum, 0)),
    cpLeft: list.reduce((a, r) => a + r.cpLeftSum, 0) / Math.max(1, list.reduce((a, r) => a + r.turnEnds, 0)),
    turns: list.reduce((a, r) => a + r.turnEnds, 0),
    atCap: list.reduce((a, r) => a + r.cpAtCapTurns, 0),
    waste: list.reduce((a, r) => a + r.regenWaste, 0),
    deadTurnPct: list.reduce((a, r) => a + r.deadTurns, 0) / Math.max(1, list.reduce((a, r) => a + r.turnEnds, 0)),
    payoffPerTurn: list.reduce((a, r) => a + r.payoff, 0) / Math.max(1, list.reduce((a, r) => a + r.turnEnds, 0)),
    actionsPerTurn: list.reduce((a, r) => a + r.actions, 0) / Math.max(1, list.reduce((a, r) => a + r.actionsByType.turns!, 0)),
    maxSpend: mean(list.map(r => r.maxTurnSpend)),
    burstPct: list.filter(r => r.burstTurns > 0).length / Math.max(1, list.length),
    kills: list.reduce((a, r) => a + r.kills, 0) / Math.max(1, list.length),
    heists: list.reduce((a, r) => a + r.heists, 0) / Math.max(1, list.length),
    promos: list.reduce((a, r) => a + r.promotions, 0) / Math.max(1, list.length),
    hqHits: list.reduce((a, r) => a + r.hqHits, 0) / Math.max(1, list.length),
    hqBurstMax: Math.max(0, ...list.map(r => r.maxHqBurst)),
    hqBurstTurns: list.reduce((a, r) => a + r.hqBurstTurns, 0),
    longestQuiet: Math.max(0, ...list.map(r => r.longestQuiet)),
    frozenGames: list.filter(r => r.longestQuiet >= 20).length,
    goldEnd: mean(list.flatMap(r => [r.gold0, r.gold1])),
    goldEndMedian: median(list.flatMap(r => [r.gold0, r.gold1])),
    sinceHq: median(list.map(r => (r.lastHqRound === null ? r.rounds : r.rounds - r.lastHqRound))),
    breachedGames: list.filter(r => r.banksBreached > 0).length,
    heistlessGames: list.filter(r => r.heists === 0 && r.banksBreached === 0).length,
    rejects: list.reduce((a, r) => a + r.rejects.length + r.appliedRejects.length, 0),
    firstBlood: list.map(r => r.firstBlood).filter((v): v is number => v !== null),
    firstHq: list.map(r => r.firstHq).filter((v): v is number => v !== null),
    winBy,
    cpStart: list.reduce((a, r) => a + r.cpStartSum, 0) / Math.max(1, list.reduce((a, r) => a + r.actionsByType.turns!, 0)),
    zeroLeft: list.reduce((a, r) => a + r.zeroLeftTurns, 0),
    richLeft: list.reduce((a, r) => a + r.richLeftTurns, 0),
    perchGap: mean(list.map(r => r.mapMetrics.perchGap)),
    coverGap: mean(list.map(r => r.mapMetrics.coverGap)),
    disconnected: list.filter(r => !r.mapMetrics.connected).length,
    cpUses: {
      MOVE: t('MOVE'), ATTACK: t('ATTACK'), SIEGE: t('SIEGE'), OVERWATCH: t('OVERWATCH'),
      RELOAD: t('RELOAD'), SECURE: t('SECURE'), LOOT: t('LOOT'), SPAWN: t('SPAWN'),
      DEMOLISH: t('DEMOLISH'), BUILD: t('BUILD'), BUY_DROP: t('BUY_DROP'), USE_ITEM: t('USE_ITEM'),
      BUY_ITEM: t('BUY_ITEM'), BANK_REWARD: t('BANK_REWARD'),
    },
    deaths: sumD(r => r.deadByType),
    dmg: sumD(r => r.dmgByType),
    siegeDmg: sumD(r => r.siegeDmgByType),
    hqDist: mean(list.map(r => r.mapMetrics.hqGroundDist)),
  };
};

const printBlock = (s: Summary) => {
  const done = s.rounds.filter(r => r > 0);
  console.log(`\n${s.label}  (n=${s.n})`);
  console.log(
    `  result        P0 ${s.p0} / P1 ${s.p1} / draw ${s.draws} / stall ${s.stalls}  ` +
    `P0 share ${rate(s.p0, s.p0 + s.p1)}  95%CI ${wilson(s.p0, s.p0 + s.p1)}`,
  );
  console.log(
    `  length        med ${median(done)} rounds | avg ${fixed(mean(done))} | p10 ${pct(done, 0.1)} | p90 ${pct(done, 0.9)} | max ${Math.max(0, ...done)}`,
  );
  console.log(
    `  win by        HQ ${s.winBy.HQ ?? 0} | wipe ${s.winBy.WIPE ?? 0} | other ${s.winBy.OTHER ?? 0}`,
  );
  console.log(
    `  CP economy    start ${fixed(s.cpStart)} CP/turn | spent ${fixed(100 * s.cpUtil, 0)}% of it | left ${fixed(s.cpLeft)} CP/turn | ` +
    `turns ending 0 CP ${rate(s.zeroLeft, s.turns)} | ending >=half ${rate(s.richLeft, s.turns)} | starting at cap ${rate(s.atCap, s.turns)} | ` +
    `regen overflow ${fixed(s.waste)} CP total`,
  );
  console.log(
    `  tempo         ${fixed(s.actionsPerTurn)} actions/turn | max single-turn spend ${fixed(s.maxSpend)} CP | games with a 20+ CP turn ${rate(Math.round(s.burstPct * s.n), s.n)} | ` +
    `dead turns ${fixed(100 * s.deadTurnPct)}% | payoff events/turn ${fixed(s.payoffPerTurn, 2)}`,
  );
  console.log(
    `  combat        kills/match ${fixed(s.kills)} | first blood round ${median(s.firstBlood)} | first HQ hit round ${median(s.firstHq)} | HQ salvos ${fixed(s.hqHits)}`,
  );
  console.log(
    `  HQ burst      biggest single-turn HQ damage ${s.hqBurstMax} | turns dealing >=50 (kill from full) ${s.hqBurstTurns}`,
  );
  console.log(
    `  freeze        longest payoff-free run ${s.longestQuiet} rounds | games frozen >=20 rounds ${s.frozenGames} | ` +
    `median rounds since last HQ damage at end ${s.sinceHq}`,
  );
  console.log(
    `  economy obj   heists/match ${fixed(s.heists, 2)} | games with a breached vault ${rate(s.breachedGames, s.n)} | banks untouched ${rate(s.heistlessGames, s.n)} | promotions/match ${fixed(s.promos, 2)}`,
  );
  console.log(
    `  currency      gold at end mean €${fixed(s.goldEnd, 0)} | median €${fixed(s.goldEndMedian, 0)}`,
  );
  console.log(
    `  map shape     HQ walk distance ${fixed(s.hqDist)} | disconnected ${s.disconnected} | perch gap ${fixed(100 * s.perchGap, 1)}% | cover gap ${fixed(100 * s.coverGap, 1)}%`,
  );
  console.log(
    `  faults        crashes ${s.crashes} | rejected bot actions ${s.rejects}`,
  );
};

const byVariant = VARIANTS.map(v => summarize(v.id, rows.filter(r => r.variant === v.id)));
const byVariantClean = VARIANTS.map(v =>
  summarize(`${v.id} (no stalls)`, rows.filter(r => r.variant === v.id && !r.stalled)),
);
const byCell = ACTIVE_VARIANTS.flatMap(v =>
  ACTIVE_MAPS.map(m => summarize(`  ${v.id} · ${m}`, rows.filter(r => r.variant === v.id && r.map === m))),
);

console.log('\n════════ CP BATTERY AUDIT · 300 HARD-vs-HARD CONQUER MATCHES ════════');
console.log(`games=${rows.length}  maps=${ACTIVE_MAPS.join(', ')}  cap=${MAX_ACTIONS} actions  wall-clock=${fixed((Date.now() - started) / 1000, 1)}s`);
console.log('\n── BY CP ECONOMY ───────────────────────────────────────────────');
byVariant.forEach(printBlock);
console.log('\n── BY CP ECONOMY, STALLED GAMES EXCLUDED (the honest pacing/economy read) ──');
byVariantClean.forEach(printBlock);
console.log('\n── BY MAP (per economy) ────────────────────────────────────────');
byCell.forEach(printBlock);

// ── Action mix, unit utility, faults ─────────────────────────────

console.log('\n── ACTION MIX, STALL-FREE GAMES ONLY ───────────────────────────');
for (const v of VARIANTS) {
  const list = rows.filter(r => r.variant === v.id && !r.stalled);
  const t = (k: string) => list.reduce((a, r) => a + (r.actionsByType[k] ?? 0), 0);
  const keys = ['MOVE', 'ATTACK', 'SIEGE', 'OVERWATCH', 'SECURE', 'LOOT', 'SPAWN', 'BUILD', 'BUY_DROP', 'USE_ITEM', 'RELOAD'];
  const total = keys.reduce((a, k) => a + t(k), 0);
  console.log(`${v.id}: ` + keys.map(k => `${k} ${fixed((100 * t(k)) / Math.max(1, total))}%`).join(' | '));
}

console.log('\n── ACTION MIX (share of applied non-end-turn actions) ─────────');
const mixHeader = ['action', ...byVariant.map(v => v.label)].join('\t');
console.log(mixHeader);
const actionKeys = ['MOVE', 'ATTACK', 'SIEGE', 'OVERWATCH', 'RELOAD', 'SECURE', 'LOOT', 'SPAWN', 'DEMOLISH', 'BUILD', 'BUY_DROP', 'BUY_ITEM', 'USE_ITEM', 'BANK_REWARD'];
const totals = byVariant.map(v => actionKeys.reduce((a, k) => a + (v.cpUses[k] ?? 0), 0));
for (const k of actionKeys) {
  const cells = byVariant.map((v, i) =>
    `${fixed((100 * (v.cpUses[k] ?? 0)) / Math.max(1, totals[i]))}% (${v.cpUses[k] ?? 0})`,
  );
  console.log([k, ...cells].join('\t'));
}

console.log('\n── UNIT UTILITY (per match) ────────────────────────────────────');
for (const type of ['SOLDIER', 'ASSAULTER', 'SNIPER']) {
  const cells = byVariant.map(v => {
    const deaths = (v.deaths[type] ?? 0) / Math.max(1, v.n);
    const dmg = (v.dmg[type] ?? 0) / Math.max(1, v.n);
    const siege = (v.siegeDmg[type] ?? 0) / Math.max(1, v.n);
    return `${type} deaths ${fixed(deaths)} dmg ${fixed(dmg)} siege ${fixed(siege)}`;
  });
  console.log([type, ...cells].join('\t'));
}

console.log('\n── FAULT PROBES ────────────────────────────────────────────────');
for (const v of VARIANTS) {
  const list = rows.filter(r => r.variant === v.id);
  const rejects = new Map<string, number>();
  for (const r of list) {
    for (const j of [...r.rejects, ...r.appliedRejects]) rejects.set(j, (rejects.get(j) ?? 0) + 1);
  }
  console.log(
    `${v.id}: negGold=${list.filter(r => r.negGold).length} overCap=${list.filter(r => r.overCap).length} ` +
    `completedLeak=${list.reduce((a, r) => a + r.completedLeak, 0)} stuckPending=${list.filter(r => r.stuckPending).length} ` +
    `cpRulesMismatch=${list.filter(r => !r.cpuTuned).length} crashed=${list.filter(r => r.crashed).length} stalled=${list.filter(r => r.stalled).length}`,
  );
  const top = [...rejects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) for (const [k, n] of top) console.log(`   ${n}x ${k}`);
  const crashedSeeds = list.filter(r => r.crashed).slice(0, 3);
  for (const r of crashedSeeds) console.log(`   CRASH ${r.map}/${r.seed}: ${r.crashed}`);
}

console.log('\n── STALL FORENSICS ─────────────────────────────────────────────');
for (const r of rows.filter(r => r.stalled)) {
  console.log(
    `${r.variant} ${r.map}/${r.seed}: rounds=${r.rounds} actions=${r.actions} hq ${r.hqHp0}/${r.hqHp1} ` +
    `units ${r.alive0}/${r.alive1} bankPending=${r.stuckPending}`,
  );
}

// Long games: what happens when the battery runs out of new things to buy?
console.log('\n── LENGTH DISTRIBUTION (rounds) ────────────────────────────────');
for (const v of VARIANTS) {
  const list = rows.filter(r => r.variant === v.id).map(r => r.rounds);
  const bands: Array<[number, number]> = [[0, 15], [15, 25], [25, 35], [35, 50], [50, 80], [80, Infinity]];
  const line = bands
    .map(([lo, hi]) => `${lo === 80 ? '80+' : `${lo}-${hi}`} ${rate(list.filter(x => x >= lo && x < hi).length, list.length)}`)
    .join(' | ');
  console.log(`${v.id}: ${line}`);
}

// ── Map generation health ────────────────────────────────────────

console.log('\n── MAP GENERATION HEALTH (per preset, 60 boards) ───────────────');
for (const mapId of ACTIVE_MAPS) {
  const list = rows.filter(r => r.map === mapId);
  const mm = list.map(r => r.mapMetrics);
  console.log(
    `${mapId.padEnd(12)} passable ${fixed(mean(mm.map(m => m.passablePct)), 0)}% | water ${fixed(mean(mm.map(m => m.waterPct)), 0)}% ` +
    `canyon ${fixed(mean(mm.map(m => m.canyonPct)), 0)}% | forest ${fixed(mean(mm.map(m => m.forestPct)), 0)}% ` +
    `mountain ${fixed(mean(mm.map(m => m.mountainPct)), 0)}% | sand ${fixed(mean(mm.map(m => m.sandPct)), 0)}% ` +
    `dunes ${fixed(mean(mm.map(m => m.dunes)))} quicksand ${fixed(mean(mm.map(m => m.quicksand)))} | bridges ${fixed(mean(mm.map(m => m.bridges)))} ` +
    `banks ${fixed(mean(mm.map(m => m.banks)))} bldg ${fixed(mean(mm.map(m => m.buildings)))} | ` +
    `HQ walk ${fixed(mean(mm.map(m => m.hqGroundDist)))} | perch gap ${fixed(100 * mean(mm.map(m => m.perchGap)), 0)}% | ` +
    `bank gap ${fixed(mean(mm.map(m => Math.abs(m.bankDist0 - m.bankDist1))))} | disconnected ${mm.filter(m => !m.connected).length}`,
  );
}

const jsonOut = {
  generatedAt: new Date().toISOString(),
  games: rows.length,
  settings: { gamesPerCell: GAMES_PER_CELL, maxActions: MAX_ACTIONS, maps: MAPS, variants: VARIANTS },
  summaries: byVariant,
  rows: rows.map(r => ({ ...r })),
};
writeFileSync(OUT_JSON, JSON.stringify(jsonOut, null, 1));
console.log(`\nraw rows -> ${OUT_JSON}`);
