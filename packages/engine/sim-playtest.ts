/**
 * Tactical Tiles — Virtual Playtest Lab.
 *
 * Why this exists: the earlier audits (sim-cp-audit, sim-psych, sim-bots) measured *match
 * outcomes* (who won, how long). That answers "is it balanced?" but not "is it fun to play?".
 * A player does not experience a match — they experience a sequence of turns. So this harness
 * measures the experience one seat-turn at a time, for every seat, in every configuration:
 * what a player could do, whether it mattered, how long they waited, and whether the match
 * built toward a climax or stalled.
 *
 * Run:
 *   cd packages/engine
 *   bun sim-playtest.ts                  # full matrix (~15-25 min)
 *   SIM_QUICK=1 bun sim-playtest.ts      # 2 matches per cell, smoke test
 *   SIM_PHASE=A bun sim-playtest.ts      # one phase only (A-F)
 *   SIM_SCALE=2 bun sim-playtest.ts      # double every cell
 *   SIM_MATCHES=30 SIM_PHASE=E bun sim-playtest.ts
 *   SIM_OUT=sim-results/run-b.json bun sim-playtest.ts   # archive a run for run-to-run diffs
 *
 * Output: console tables + sim-results/playtest.json (aggregates only). A filtered run writes
 * sim-results/playtest-<PHASE>.json so it cannot overwrite the full matrix.
 *
 * Metric glossary (all are per player-turn unless noted):
 *   families  distinct legal action families at turn start: move / attack / siege / interact /
 *             overwatch / reload. 1 family = a railroaded turn; 0 = a dead turn.
 *   agency    share of turns opening with >= 2 action families (a real choice existed).
 *   progress  share of turns where the player could touch an objective (shoot a unit, siege an
 *             HQ/bank, secure a building, loot).
 *   dead      turn with zero payoff events (hit, kill, HQ/vault damage, heist, promotion,
 *             capture, build, supply drop, mine blast).
 *   idleCP    CP still unspent when the turn ended.
 *   wait      other players' actions that resolved before this seat acted again (downtime).
 *   agency%   share of wall-clock match time this player is actually acting (the multiplayer
 *             "am I even playing?" number).
 *   climax    share of a match's payoff events that land in its final third.
 *   comeback  share of decided matches where the mid-match leader did not win.
 */
import { mkdirSync } from 'node:fs';
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  getUnitOptions,
  visibleSet,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import { getManhattanDistance } from './src/grid/Pathfinding';
import { BASE_STATS, CP_SYSTEM, DOOMSDAY_SETTINGS, MUTATOR_CONFIG, OVERWATCH_STATS, UNIT_STATS } from './src/constants/Config';
import type {
  AIDifficulty,
  GameAction,
  GameSettings,
  GameState,
  GridSizeOption,
  MapPresetId,
  Unit,
} from './src/index';

// ── Human-time model ─────────────────────────────────────────────
// Calibrated from the genre: a considered action in a 20x20 tactics board is ~6 s, and a turn
// costs ~5 s of reading/reorienting before the first action. Used only for wall-clock estimates.
const SEC_ACTION = 6;
const SEC_TURN = 5;

const PAYOFF = new Set([
  'hit', 'killed', 'structureHit', 'heist', 'promotion', 'mineBlast',
  'capture', 'build', 'supplyLanded',
]);
const MAJOR = new Set(['killed', 'heist', 'promotion', 'capture', 'mineBlast']);

type CpMode = 'std' | 'classic' | 'custom';

interface MatchConfig {
  key: string;
  players: number;
  preset: MapPresetId;
  cp: CpMode;
  /** Only for cp === 'custom'. */
  cpMax: number;
  cpRegen: number;
  cpP1: number;
  fog: boolean;
  mode: 'CONQUER' | 'DEATHMATCH';
  doomsday: boolean;
  scarcity: boolean;
  ironman: boolean;
  counts: { SOLDIER: number; ASSAULTER: number; SNIPER: number };
  seatDifficulty: AIDifficulty | AIDifficulty[];
  gridSize: GridSizeOption;
  /** Rule lab knobs (mutated on the exported constants, restored after each cell). */
  hqHp: number;
  doomsdayStart: number;
  banks?: number;
  scoutDamage?: number;
  scoutCost?: number;
  sniperCost?: number;
}

const baseCfg = (over: Partial<MatchConfig> & { key: string }): MatchConfig => ({
  players: 2,
  preset: 'balanced',
  cp: 'std',
  cpMax: CP_SYSTEM.MAX_CP,
  cpRegen: CP_SYSTEM.REGEN_AMOUNT,
  cpP1: CP_SYSTEM.P1_ROUND1_CP,
  fog: false,
  mode: 'CONQUER',
  doomsday: false,
  scarcity: false,
  ironman: false,
  counts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
  seatDifficulty: 'HARD',
  gridSize: 'AUTO',
  hqHp: BASE_STATS.HP,
  doomsdayStart: DOOMSDAY_SETTINGS.START_TURN,
  ...over,
});

// ── Rule lab: apply / restore constant overrides ─────────────────
const RULE_SAVE = {
  cpMax: CP_SYSTEM.MAX_CP,
  cpRegen: CP_SYSTEM.REGEN_AMOUNT,
  cpP1: CP_SYSTEM.P1_ROUND1_CP,
  hq: BASE_STATS.HP,
  doomsday: DOOMSDAY_SETTINGS.START_TURN,
  soldierDamage: UNIT_STATS.SOLDIER.damage,
  soldierCost: UNIT_STATS.SOLDIER.attackCost,
  sniperCost: UNIT_STATS.SNIPER.attackCost,
  classicMax: MUTATOR_CONFIG.CLASSIC_CP.MAX_CP,
  classicRegen: MUTATOR_CONFIG.CLASSIC_CP.REGEN_AMOUNT,
  classicP1: MUTATOR_CONFIG.CLASSIC_CP.P1_ROUND1_CP,
};

const applyRules = (cfg: MatchConfig) => {
  // Reset to shipped values first, so arms never leak into each other.
  CP_SYSTEM.MAX_CP = RULE_SAVE.cpMax;
  CP_SYSTEM.REGEN_AMOUNT = RULE_SAVE.cpRegen;
  CP_SYSTEM.P1_ROUND1_CP = RULE_SAVE.cpP1;
  MUTATOR_CONFIG.CLASSIC_CP.MAX_CP = RULE_SAVE.classicMax;
  MUTATOR_CONFIG.CLASSIC_CP.REGEN_AMOUNT = RULE_SAVE.classicRegen;
  MUTATOR_CONFIG.CLASSIC_CP.P1_ROUND1_CP = RULE_SAVE.classicP1;
  BASE_STATS.HP = cfg.hqHp;
  DOOMSDAY_SETTINGS.START_TURN = cfg.doomsdayStart;
  UNIT_STATS.SOLDIER.damage = cfg.scoutDamage ?? RULE_SAVE.soldierDamage;
  UNIT_STATS.SOLDIER.attackCost = cfg.scoutCost ?? RULE_SAVE.soldierCost;
  UNIT_STATS.SNIPER.attackCost = cfg.sniperCost ?? RULE_SAVE.sniperCost;
  if (cfg.cp === 'custom') {
    CP_SYSTEM.MAX_CP = cfg.cpMax;
    CP_SYSTEM.REGEN_AMOUNT = cfg.cpRegen;
    CP_SYSTEM.P1_ROUND1_CP = cfg.cpP1;
  }
};

// ── Telemetry shapes ─────────────────────────────────────────────
interface SeatAcc {
  seat: number;
  turns: number;
  actions: number;
  deadTurns: number;
  cpLeft: number;
  idleHalfTurns: number;
  famSum: number;
  lowAgencyTurns: number;
  progressTurns: number;
  impactSum: number;
  impactChoiceTurns: number;
  hqPressureTurns: number;
  waitActions: number;
  payoff: number;
  major: number;
  kills: number;
  heists: number;
  promos: number;
  captures: number;
  builds: number;
  hqShots: number;
  hqDamage: number;
  deaths: number;
  firstMajor: number | null;
  firstKill: number | null;
  firstHeist: number | null;
  firstHq: number | null;
  elimRound: number | null;
  won: boolean;
  mix: Record<string, number>;
}

interface MatchRec {
  key: string;
  seed: string;
  players: number;
  rounds: number;
  actions: number;
  winner: number | 'DRAW' | null;
  stalled: boolean;
  rejects: number;
  seats: SeatAcc[];
  leadChanges: number;
  leaderAtMid: number | null;
  comeback: boolean | null;
  climaxShare: number;
  payoff: number;
  deadPct: number;
  estMinutes: number;
  endsBy: 'HQ' | 'WIPE' | 'CAP' | 'DRAW';
  gridSize: number;
  hqDistance: number;
  opening: string;
  firstHqRound: number | null;
  eliminations: number;
  avgElimRound: number | null;
  /** Action mix of a match that never ended, so the stall's shape is visible. */
  stallMix: Record<string, number> | null;
}

const newSeat = (seat: number): SeatAcc => ({
  seat, turns: 0, actions: 0, deadTurns: 0, cpLeft: 0, idleHalfTurns: 0, famSum: 0,
  lowAgencyTurns: 0, progressTurns: 0, impactSum: 0, impactChoiceTurns: 0, hqPressureTurns: 0, waitActions: 0, payoff: 0, major: 0,
  kills: 0, heists: 0, promos: 0, captures: 0, builds: 0, hqShots: 0, hqDamage: 0, deaths: 0,
  firstMajor: null, firstKill: null, firstHeist: null, firstHq: null, elimRound: null, won: false,
  mix: {},
});

interface TurnOpening {
  ready: number;
  moveTiles: number;
  attackTargets: number;
  siege: number;
  hqSiege: number;
  interact: number;
  canOverwatch: boolean;
  canReload: boolean;
  families: number;
}

const openingFor = (g: GameState, seat: number): TurnOpening => {
  const vis = visibleSet(g, seat);
  const cp = g.playerCp[seat] ?? 0;
  const ready = g.units.filter(u => u.owner === seat && !u.completed);
  let moveTiles = 0, attackTargets = 0, siege = 0, hqSiege = 0, interact = 0;
  let canOverwatch = false, canReload = false;
  const tileById = new Map(g.mapData.map(t => [t.id, t] as const));
  for (const u of ready) {
    const o = getUnitOptions(g, u, vis);
    moveTiles += o.moveCosts.size;
    attackTargets += o.attackTargets.length;
    siege += o.siegeTiles.length;
    interact += o.secureTiles.length + o.lootTiles.length;
    for (const id of o.siegeTiles) {
      const t = tileById.get(id);
      if (t && t.type === 'BASE' && t.owner !== seat) hqSiege++;
    }
    if (cp >= OVERWATCH_STATS[u.type].cost) canOverwatch = true;
    if (u.ammo < UNIT_STATS[u.type].maxAmmo && cp >= CP_SYSTEM.RELOAD_COST) canReload = true;
  }
  const families =
    (moveTiles > 0 ? 1 : 0) +
    (attackTargets > 0 ? 1 : 0) +
    (siege > 0 ? 1 : 0) +
    (interact > 0 ? 1 : 0) +
    (canOverwatch ? 1 : 0) +
    (canReload ? 1 : 0);
  return { ready: ready.length, moveTiles, attackTargets, siege, hqSiege, interact, canOverwatch, canReload, families };
};

const diffFor = (cfg: MatchConfig, seat: number): AIDifficulty =>
  Array.isArray(cfg.seatDifficulty) ? (cfg.seatDifficulty[seat] ?? 'HARD') : cfg.seatDifficulty;

// ── One match ────────────────────────────────────────────────────
const playOne = (cfg: MatchConfig, seed: string): MatchRec => {
  applyRules(cfg);
  const settings: GameSettings = {
    ...DEFAULT_GAME_SETTINGS,
    playerCount: cfg.players,
    unitCounts: { ...cfg.counts },
    dynamicWeather: true,
    fogOfWar: cfg.fog,
    doomsdayEnabled: cfg.doomsday,
    victoryMode: cfg.mode,
    aiDifficulty: Array.isArray(cfg.seatDifficulty) ? 'HARD' : cfg.seatDifficulty,
    mutators: { classicCp: cfg.cp === 'classic', scarcity: cfg.scarcity, ironman: cfg.ironman },
    mapSeed: seed,
    mapGen: {
      preset: cfg.preset,
      knobs: { gridSize: cfg.gridSize, ...(cfg.banks !== undefined ? { banks: cfg.banks } : {}) },
    },
  };

  let g = createGeneratedGame(settings);
  const seats = Array.from({ length: cfg.players }, (_, i) => newSeat(i));
  const cap = cfg.players <= 2 ? 4000 : 6000;
  let actions = 0;
  let rejects = 0;
  let payoffTotal = 0;
  let payoffByRound: number[] = [];
  let firstHqRound: number | null = null;
  let lastActionCountBySeat = new Array(cfg.players).fill(0);
  const leaderSeries: (number | null)[] = [];
  const openingTypes: string[] = [];
  let elimRoundSum = 0;
  let elimCount = 0;
  const prevStatus = { ...g.playerStatus };

  const baseTiles = g.mapData.filter(t => t.type === 'BASE');
  let hqDistance = 0;
  if (baseTiles.length >= 2) {
    let minD = Infinity;
    for (let i = 0; i < baseTiles.length; i++) {
      for (let j = i + 1; j < baseTiles.length; j++) {
        minD = Math.min(minD, getManhattanDistance(baseTiles[i], baseTiles[j]));
      }
    }
    hqDistance = Number.isFinite(minD) ? minD : 0;
  }

  // per-turn accumulators
  let curSeat = -1;
  let opening: TurnOpening | null = null;
  let turnPayoff = 0;
  let turnActions = 0;
  let cpAtTurnEnd = 0;

  const beginTurn = (seat: number) => {
    const acc = seats[seat];
    acc.waitActions += Math.max(0, actions - lastActionCountBySeat[seat]);
    opening = openingFor(g, seat);
    acc.famSum += opening.families;
    if (opening.families <= 1) acc.lowAgencyTurns++;
    const impact = opening.attackTargets + opening.siege + opening.interact;
    acc.impactSum += impact;
    if (impact >= 2) acc.impactChoiceTurns++;
    if (impact > 0) acc.progressTurns++;
    if (opening.hqSiege > 0) acc.hqPressureTurns++;
    turnPayoff = 0;
    turnActions = 0;
    cpAtTurnEnd = g.playerCp[seat] ?? 0;
  };

  const endTurn = (seat: number) => {
    const acc = seats[seat];
    acc.turns++;
    if (turnPayoff === 0) acc.deadTurns++;
    acc.cpLeft += cpAtTurnEnd;
    // "Rich" turn: ended with at least half a battery unspent (the flow never became a decision).
    const battery = cfg.cp === 'classic' ? MUTATOR_CONFIG.CLASSIC_CP.MAX_CP : (cfg.cp === 'custom' ? cfg.cpMax : CP_SYSTEM.MAX_CP);
    if (cpAtTurnEnd >= Math.ceil(battery / 2)) acc.idleHalfTurns++;
    lastActionCountBySeat[seat] = actions;
    // Leader snapshot per completed round.
    const active = seats.filter(s => g.playerStatus[s.seat] !== 'ELIMINATED');
    const score = (s: number) => {
      const hq = g.mapData.find(t => t.type === 'BASE' && t.owner === s);
      return (hq?.hp ?? (cfg.mode === 'CONQUER' ? 0 : 50)) + g.units.filter(u => u.owner === s).length * 12;
    };
    let best: number | null = null;
    let bestScore = -Infinity;
    for (const s of active) {
      const v = score(s.seat);
      if (v > bestScore) { bestScore = v; best = s.seat; }
    }
    leaderSeries.push(best);
  };

  while (g.winner === null && actions < cap) {
    const seat = g.currentPlayer;
    if (seat !== curSeat) {
      if (curSeat !== -1) endTurn(curSeat);
      curSeat = seat;
      beginTurn(seat);
    }
    const acc = seats[seat];
    const proposed = botAction(g, diffFor(cfg, seat));
    const prep = prepareAction(g, seat, proposed);
    let action: GameAction;
    if (prep.ok) {
      action = prep.action;
    } else {
      rejects++;
      action = { type: 'END_TURN' };
    }

    if (action.type === 'END_TURN') cpAtTurnEnd = g.playerCp[seat] ?? 0;
    if (openingTypes.length < 8) openingTypes.push(action.type === 'END_TURN' ? 'E' : action.type[0]);

    const res = applyAction(g, action, { autoBankReward: true });
    if (res.rejected) {
      const end = applyAction(g, { type: 'END_TURN' }, { autoBankReward: true });
      g = end.state;
      acc.mix.REJECT = (acc.mix.REJECT ?? 0) + 1;
    } else {
      for (const e of res.events) {
        if (PAYOFF.has(e.kind)) {
          payoffTotal++;
          turnPayoff++;
          acc.payoff++;
          if (g.totalTurns > 0) {
            payoffByRound[g.totalTurns] = (payoffByRound[g.totalTurns] ?? 0) + 1;
          }
        }
        if (MAJOR.has(e.kind)) {
          acc.major++;
          if (acc.firstMajor === null) acc.firstMajor = g.totalTurns;
        }
        if (e.kind === 'killed') {
          acc.kills++;
          if (acc.firstKill === null) acc.firstKill = g.totalTurns;
          const owner = (e as { owner?: number }).owner;
          if (typeof owner === 'number' && seats[owner]) seats[owner].deaths++;
        }
        if (e.kind === 'heist') {
          acc.heists++;
          if (acc.firstHeist === null) acc.firstHeist = g.totalTurns;
        }
        if (e.kind === 'promotion') acc.promos++;
        if (e.kind === 'capture') acc.captures++;
        if (e.kind === 'build') acc.builds++;
        if (e.kind === 'structureHit' && (e as { structureType: string }).structureType === 'BASE') {
          acc.hqShots++;
          acc.hqDamage += (e as { damage?: number }).damage ?? 0;
          if (acc.firstHq === null) acc.firstHq = g.totalTurns;
          if (firstHqRound === null) firstHqRound = g.totalTurns;
        }
      }
      g = res.state;
    }
    acc.actions++;
    turnActions++;
    acc.mix[action.type] = (acc.mix[action.type] ?? 0) + 1;
    actions++;

    // Elimination bookkeeping.
    for (let p = 0; p < cfg.players; p++) {
      if (prevStatus[p] !== 'ELIMINATED' && g.playerStatus[p] === 'ELIMINATED') {
        seats[p].elimRound = g.totalTurns;
        elimRoundSum += g.totalTurns;
        elimCount++;
      }
      prevStatus[p] = g.playerStatus[p];
    }
  }
  if (curSeat !== -1) endTurn(curSeat);

  const rounds = g.totalTurns;
  const winner = g.winner;
  if (typeof winner === 'number' && seats[winner]) seats[winner].won = true;

  // Lead changes over the completed-round series.
  let leadChanges = 0;
  for (let i = 1; i < leaderSeries.length; i++) {
    if (leaderSeries[i] !== null && leaderSeries[i - 1] !== null && leaderSeries[i] !== leaderSeries[i - 1]) leadChanges++;
  }
  const mid = leaderSeries.length ? leaderSeries[Math.floor(leaderSeries.length / 2)] : null;
  const comeback = mid !== null && typeof winner === 'number' ? mid !== winner : null;

  // Climax: payoff density in the final third versus the rest.
  const totalRounds = Math.max(1, payoffByRound.length - 1);
  const lastThirdStart = Math.ceil(totalRounds * (2 / 3));
  let early = 0, late = 0;
  for (let r = 0; r < payoffByRound.length; r++) {
    const v = payoffByRound[r] ?? 0;
    if (r >= lastThirdStart) late += v; else early += v;
  }
  const climaxShare = early + late > 0 ? late / (early + late) : 0;

  const turns = seats.reduce((s, x) => s + x.turns, 0) || 1;
  const deadTurns = seats.reduce((s, x) => s + x.deadTurns, 0);
  const baseDestroyed = g.mapData.some(t => t.type === 'BASE' && (t.hp ?? 0) <= 0);
  const endsBy: MatchRec['endsBy'] = baseDestroyed ? 'HQ' : winner === 'DRAW' ? 'DRAW' : winner !== null ? 'WIPE' : 'CAP';
  const estMinutes = (actions * SEC_ACTION + turns * SEC_TURN) / 60;

  return {
    key: cfg.key,
    seed,
    players: cfg.players,
    rounds,
    actions,
    winner,
    stalled: winner === null,
    rejects,
    seats,
    leadChanges,
    leaderAtMid: mid,
    comeback,
    climaxShare,
    payoff: payoffTotal,
    deadPct: deadTurns / turns,
    estMinutes,
    endsBy,
    gridSize: g.gridSize,
    hqDistance,
    opening: openingTypes.join(''),
    firstHqRound,
    eliminations: elimCount,
    avgElimRound: elimCount ? elimRoundSum / elimCount : null,
    stallMix: winner === null
      ? seats.reduce<Record<string, number>>((acc, s) => {
          for (const [k, v] of Object.entries(s.mix)) acc[k] = (acc[k] ?? 0) + v;
          return acc;
        }, {})
      : null,
  };
};

// ── Aggregation ──────────────────────────────────────────────────
const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const quantile = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[i];
};

const summarize = (key: string, recs: MatchRec[]) => {
  const n = recs.length;
  const stalls = recs.filter(r => r.stalled).length;
  // Experience metrics describe matches that actually ended. A 2,800-round freeze is a defect,
  // not 2,800 rounds of "average pacing", so it is reported as stall% and excluded here.
  const done = recs.filter(r => !r.stalled);
  const base = done.length ? done : recs;
  const seats = base.flatMap(r => r.seats);
  const decided = base.filter(r => typeof r.winner === 'number');
  const turns = seats.reduce((s, x) => s + x.turns, 0) || 1;
  const actions = seats.reduce((s, x) => s + x.actions, 0) || 1;
  const payoff = seats.reduce((s, x) => s + x.payoff, 0);
  const major = seats.reduce((s, x) => s + x.major, 0);
  const dead = seats.reduce((s, x) => s + x.deadTurns, 0);
  const lowAgency = seats.reduce((s, x) => s + x.lowAgencyTurns, 0);
  const progress = seats.reduce((s, x) => s + x.progressTurns, 0);
  const impactChoices = seats.reduce((s, x) => s + x.impactChoiceTurns, 0);
  const impactSum = seats.reduce((s, x) => s + x.impactSum, 0);
  const hqPressure = seats.reduce((s, x) => s + x.hqPressureTurns, 0);
  const idleHalf = seats.reduce((s, x) => s + x.idleHalfTurns, 0);
  const cpLeft = seats.reduce((s, x) => s + x.cpLeft, 0);
  const wait = seats.reduce((s, x) => s + x.waitActions, 0);
  const famSum = seats.reduce((s, x) => s + x.famSum, 0);

  // Wall-clock agency: own seconds / total seconds, per seat then averaged.
  // Wall-clock share of the match this seat is actually acting, averaged over seats.
  // Computed per match: a seat's own seconds / that match's total seconds.
  let ownSec = 0;
  let totalSec = 0;
  for (const r of base) {
    const matchActions = r.seats.reduce((s, x) => s + x.actions, 0);
    const matchTurns = r.seats.reduce((s, x) => s + x.turns, 0);
    const matchSec = matchActions * SEC_ACTION + matchTurns * SEC_TURN;
    for (const s of r.seats) {
      ownSec += s.actions * SEC_ACTION + s.turns * SEC_TURN;
      totalSec += matchSec;
    }
  }
  const actingShare = totalSec > 0 ? ownSec / totalSec : 0;

  const seatWins = Array.from({ length: base[0]?.players ?? 2 }, (_, i) =>
    decided.filter(r => r.winner === i).length,
  );
  const seatShare = seatWins.map(w => (decided.length ? w / decided.length : 0));
  const fairShare = 1 / seatShare.length;
  const seatBiasPP = 100 * Math.max(...seatShare.map(s => Math.abs(s - fairShare)));
  const seatSpreadPP = 100 * (Math.max(...seatShare) - Math.min(...seatShare));

  const comebackKnown = base.filter(r => r.comeback !== null);
  const firstHq = base.map(r => r.firstHqRound).filter((v): v is number => v !== null);
  const elimSeats = seats.filter(s => s.elimRound !== null);
  const distinctOpenings = new Set(base.map(r => r.opening)).size;

  const rows = base.map(r => ({
    deadPct: r.deadPct,
    rounds: r.rounds,
    payoffPerTurn: r.payoff / Math.max(1, r.seats.reduce((s, x) => s + x.turns, 0)),
  }));
  const funDeath = base.filter(r => r.deadPct > 0.7 && r.rounds >= 30).length;

  return {
    key,
    n,
    nDone: done.length,
    players: base[0]?.players ?? 0,
    medianRounds: quantile(base.map(r => r.rounds), 0.5),
    p90Rounds: quantile(base.map(r => r.rounds), 0.9),
    maxRounds: Math.max(...base.map(r => r.rounds)),
    stalls,
    estMinutes: mean(base.map(r => r.estMinutes)),
    deadPct: pct(dead, turns),
    payoffPerTurn: payoff / turns,
    majorPerTurn: major / turns,
    actionsPerTurn: actions / turns,
    turnsPerMatch: turns / n,
    actionsPerMatch: actions / n,
    /** Floor for a match at the shipped 30 s turn clock: nobody can play faster than the clock. */
    clockFloorMin: ((turns / n) * 30) / 60,
    families: famSum / turns,
    choicePct: pct(turns - lowAgency, turns),
    impactPct: pct(impactChoices, turns),
    impactAvg: impactSum / turns,
    progressPct: pct(progress, turns),
    hqPressurePct: pct(hqPressure, turns),
    idleCp: cpLeft / turns,
    idleHalfPct: pct(idleHalf, turns),
    waitActions: wait / turns,
    actingSharePct: 100 * actingShare,
    comebackPct: comebackKnown.length ? pct(comebackKnown.filter(r => r.comeback).length, comebackKnown.length) : -1,
    leadChanges: mean(base.map(r => r.leadChanges)),
    climaxPct: 100 * mean(base.map(r => r.climaxShare)),
    firstHqRound: firstHq.length ? quantile(firstHq, 0.5) : -1,
    killsPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.kills, 0))),
    heistsPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.heists, 0))),
    promosPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.promos, 0))),
    hqShotsPerMatch: mean(base.map(r => r.seats.reduce((s, x) => s + x.hqShots, 0))),
    firstMajorRound: mean(seats.map(s => s.firstMajor).filter((v): v is number => v !== null)),
    elimPct: pct(elimSeats.length, seats.length),
    elimRound: elimSeats.length ? mean(elimSeats.map(s => s.elimRound as number)) : -1,
    seatWins,
    seatBiasPP,
    seatSpreadPP,
    openingVarietyPct: pct(distinctOpenings, base.length),
    funDeathPct: pct(funDeath, base.length),
    hqWinPct: pct(base.filter(r => r.endsBy === 'HQ').length, base.length),
    wipeWinPct: pct(base.filter(r => r.endsBy === 'WIPE').length, base.length),
    rejectRate: pct(base.reduce((s, r) => s + r.rejects, 0), actions),
    gridSize: base[0]?.gridSize ?? 0,
    hqDistance: mean(base.map(r => r.hqDistance)),
    stallPct: pct(stalls, n),
    stallMix: recs.reduce<Record<string, number>>((acc, r) => {
      if (!r.stallMix) return acc;
      for (const [k, v] of Object.entries(r.stallMix)) acc[k] = (acc[k] ?? 0) + v;
      return acc;
    }, {}),
  };
};

// ── Printing ─────────────────────────────────────────────────────
const HEAD =
  'cell'.padEnd(26) +
  'n'.padStart(4) +
  'medR'.padStart(6) +
  'p90R'.padStart(6) +
  'maxR'.padStart(6) +
  'dead%'.padStart(7) +
  'pay/t'.padStart(7) +
  'act/t'.padStart(7) +
  'fam'.padStart(6) +
  'choice%'.padStart(9) +
  'i≥2%'.padStart(7) +
  'i/t'.padStart(6) +
  'prog%'.padStart(7) +
  'idleCP'.padStart(8) +
  'wait'.padStart(6) +
  'play%'.padStart(6) +
  'come%'.padStart(7) +
  'clim%'.padStart(7) +
  'elim%'.padStart(7) +
  'stall%'.padStart(8);

const printRow = (s: ReturnType<typeof summarize>) => {
  console.log(
    s.key.slice(0, 25).padEnd(26) +
      String(s.n).padStart(4) +
      String(s.medianRounds).padStart(6) +
      String(s.p90Rounds).padStart(6) +
      String(s.maxRounds).padStart(6) +
      s.deadPct.toFixed(0).padStart(7) +
      s.payoffPerTurn.toFixed(2).padStart(7) +
      s.actionsPerTurn.toFixed(1).padStart(7) +
      s.families.toFixed(1).padStart(6) +
      s.choicePct.toFixed(0).padStart(9) +
      s.impactPct.toFixed(0).padStart(7) +
      s.impactAvg.toFixed(1).padStart(6) +
      s.progressPct.toFixed(0).padStart(7) +
      s.idleCp.toFixed(1).padStart(8) +
      s.waitActions.toFixed(1).padStart(6) +
      s.actingSharePct.toFixed(0).padStart(6) +
      (s.comebackPct < 0 ? '-' : s.comebackPct.toFixed(0)).padStart(7) +
      s.climaxPct.toFixed(0).padStart(7) +
      s.elimPct.toFixed(0).padStart(7) +
      s.stallPct.toFixed(0).padStart(8),
  );
};

// ── The plan ─────────────────────────────────────────────────────
const SCALE = Number(process.env.SIM_SCALE ?? 1);
const QUICK = process.env.SIM_QUICK === '1';
const MATCHES = Number(process.env.SIM_MATCHES ?? 0);
const PHASE = (process.env.SIM_PHASE ?? 'ALL').toUpperCase();
const per = (n: number) => (MATCHES > 0 ? MATCHES : QUICK ? 2 : Math.max(4, Math.round(n * SCALE)));

/**
 * A unique 12-char seed per (cell, index). Seeds must be hashed: the engine keeps only the
 * first 12 characters of a seed, so "2Pbalanced0..11" would collapse onto one map.
 */
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

const arms: { cfg: MatchConfig; n: number; phase: string }[] = [];
const add = (phase: string, cfg: MatchConfig, n: number) => arms.push({ phase, cfg, n: per(n) });

const COUNTS = {
  default: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
  scout: { SOLDIER: 4, ASSAULTER: 1, SNIPER: 1 },
  sniper: { SOLDIER: 1, ASSAULTER: 1, SNIPER: 3 },
} as const;

// A. Player-count × CP economy (the core experience matrix).
// CP20 is the Classic CP option: 20 max / +10 regen / 15 opening.
// CP30 is the shipped default: 30 / +15 / 22.
for (const players of [2, 3, 4, 5, 6]) {
  add('A', baseCfg({ key: `${players}P CP20`, players, cp: 'classic' }), 16);
  add('A', baseCfg({ key: `${players}P CP30`, players, cp: 'std' }), 16);
}

// A2. Fog of war per player count.
for (const players of [2, 3, 4, 5, 6]) {
  add('A', baseCfg({ key: `${players}P fog`, players, fog: true }), 12);
}

// B. Map / generator presets at 2P and 4P.
const PRESETS: MapPresetId[] = [
  'balanced', 'lush_valley', 'archipelago', 'badlands',
  'fortress', 'twin_fronts', 'timber_ridge', 'open_blitz',
];
for (const players of [2, 4]) {
  for (const preset of PRESETS) {
    add('B', baseCfg({ key: `${players}P ${preset}`, players, preset }), 12);
  }
}

// C. Modes, mutators and squad decks.
for (const players of [2, 4]) {
  add('C', baseCfg({ key: `${players}P deathmatch+doom`, players, mode: 'DEATHMATCH', doomsday: true }), 12);
  add('C', baseCfg({ key: `${players}P doom-conquer`, players, doomsday: true }), 12);
  add('C', baseCfg({ key: `${players}P scarcity`, players, scarcity: true }), 12);
  add('C', baseCfg({ key: `${players}P ironman`, players, ironman: true }), 12);
  add('C', baseCfg({ key: `${players}P scout-heavy`, players, counts: COUNTS.scout }), 12);
  add('C', baseCfg({ key: `${players}P sniper-heavy`, players, counts: COUNTS.sniper }), 12);
}

// D. Skill ramp: what a first-session player actually experiences.
add('D', baseCfg({ key: '2P easy vs easy', seatDifficulty: 'EASY' }), 20);
add('D', baseCfg({ key: '2P medium vs medium', seatDifficulty: 'MEDIUM' }), 20);
add('D', baseCfg({ key: '2P easy(P0) vs hard', seatDifficulty: ['EASY', 'HARD'] }), 20);
add('D', baseCfg({ key: '2P hard(P0) vs easy', seatDifficulty: ['HARD', 'EASY'] }), 20);
add('D', baseCfg({ key: '4P mixed skill', players: 4, seatDifficulty: ['EASY', 'MEDIUM', 'HARD', 'HARD'] }), 12);

// E. Rule lab: one change at a time, measured on the experience axes.
const LAB: Partial<MatchConfig>[] = [
  { key: 'LAB baseline' },
  { key: 'LAB HQ 35hp', hqHp: 35 },
  { key: 'LAB HQ 65hp', hqHp: 65 },
  { key: 'LAB doom@18', doomsday: true, doomsdayStart: 18 },
  { key: 'LAB grid16', gridSize: 16 },
  { key: 'LAB equal-first-CP', cp: 'custom', cpMax: 20, cpRegen: 10, cpP1: 20 },
  { key: 'LAB scout dmg7', scoutDamage: 7 },
  { key: 'LAB scout cp2', scoutCost: 2 },
  { key: 'LAB sniper cp9', sniperCost: 9 },
  { key: 'LAB fortress banks2', preset: 'fortress', banks: 2 },
  { key: 'LAB banks3', banks: 3 },
  { key: 'LAB CP25/+12', cp: 'custom', cpMax: 25, cpRegen: 12, cpP1: 18 },
  // Fog control: the same rule on the classic generator vs a preset, so the fog defect is
  // attributable to the map family and not to a different sample.
  { key: 'LAB classic fog off', preset: 'classic' },
  { key: 'LAB classic fog on', preset: 'classic', fog: true },
  { key: 'LAB balanced fog on', fog: true },
];
for (const l of LAB) add('E', baseCfg({ ...l, key: l.key as string }), 20);

// F. Combined "best guess" packages — testing hypotheses together.
add('F', baseCfg({ key: 'PKG fast+HQ35+doom18', hqHp: 35, doomsday: true, doomsdayStart: 18 }), 20);
add('F', baseCfg({ key: 'PKG classic+HQ35', cp: 'classic', hqHp: 35 }), 20);
add('F', baseCfg({ key: 'PKG grid16+HQ35+doom18', gridSize: 16, hqHp: 35, doomsday: true, doomsdayStart: 18 }), 20);
add('F', baseCfg({ key: 'PKG 4P classic+HQ35', players: 4, cp: 'classic', hqHp: 35 }), 12);

// ── Execute ──────────────────────────────────────────────────────
const selected = arms.filter(a => PHASE === 'ALL' || PHASE.includes(a.phase));
const results: Record<string, ReturnType<typeof summarize>> = {};
const started = Date.now();
console.log(`${selected.length} cells · ~${selected.reduce((s, a) => s + a.n, 0)} matches\n`);

const phaseLabel: Record<string, string> = {
  A: 'A · PLAYER COUNT & CP ECONOMY',
  B: 'B · MAP PRESETS',
  C: 'C · MODES, MUTATORS, DECKS',
  D: 'D · SKILL RAMP (new-player experience)',
  E: 'E · RULE LAB (one change at a time)',
  F: 'F · COMBINED PACKAGES',
};
let lastPhase = '';
for (const arm of selected) {
  if (arm.phase !== lastPhase) {
    lastPhase = arm.phase;
    console.log(`\n=== ${phaseLabel[arm.phase] ?? arm.phase} ===`);
    console.log(HEAD);
  }
  const recs: MatchRec[] = [];
  for (let i = 0; i < arm.n; i++) {
    const seed = seedFrom(`${arm.cfg.key}#${i}`);
    try {
      recs.push(playOne(arm.cfg, seed));
    } catch (err) {
      console.error(`\n!! ${arm.cfg.key} #${i} crashed:`, err);
    }
  }
  if (!recs.length) continue;
  const s = summarize(arm.cfg.key, recs);
  results[s.key] = s;
  printRow(s);
  console.error(`   [${arm.cfg.key}] done in ${((Date.now() - started) / 1000).toFixed(0)}s total`);
}

// Restore shipped rules so a later import in the same process sees stock values.
applyRules(baseCfg({ key: 'restore' }));

// ── Deep dives printed after the tables ──────────────────────────
const pick = (...keys: string[]) => keys.map(k => results[k]).filter(Boolean);

console.log('\n=== DEEP DIVE · per-seat fairness (winner share by seat) ===');
for (const k of Object.keys(results)) {
  const s = results[k];
  if (s.nDone < 8) continue;
  console.log(
          `${k.padEnd(26)} [${s.nDone}/${s.n}] ${s.seatWins.map((w, i) => `P${i + 1}:${(100 * w / Math.max(1, s.seatWins.reduce((a, b) => a + b, 0))).toFixed(0)}%`).join(' ')}` +
      `  bias±${s.seatBiasPP.toFixed(0)}pp  spread${s.seatSpreadPP.toFixed(0)}pp  HQ-win:${s.hqWinPct.toFixed(0)}% wipe:${s.wipeWinPct.toFixed(0)}%` +
      `  firstHQ:r${s.firstHqRound}  elim@r${s.elimRound.toFixed(0)}  fun-death:${s.funDeathPct.toFixed(0)}%  variety:${s.openingVarietyPct.toFixed(0)}%  rejects:${s.rejectRate.toFixed(2)}%`,
  );
  if (s.stallPct > 0) console.log(`    ↳ stalled matches' actions: ${JSON.stringify(s.stallMix)}`);
}

// Per-player-count ranking summary, useful for the report.
console.log('\n=== DEEP DIVE · multiplayer pacing ===');
for (const n of [2, 3, 4, 5, 6]) {
  const a = results[`${n}P CP20`];
  const b = results[`${n}P CP30`];
  if (!a && !b) continue;
  for (const s of [a, b].filter(Boolean)) {
    console.log(
      `${s.key.padEnd(12)} median ${String(s.medianRounds).padStart(3)} rounds (p90 ${s.p90Rounds}, max ${s.maxRounds}) · ` +
        `${s.estMinutes.toFixed(0).padStart(3)} min · playing ${s.actingSharePct.toFixed(0)}% of it · wait ${s.waitActions.toFixed(0)} actions · ` +
        `dead ${s.deadPct.toFixed(0)}% · choice ${s.choicePct.toFixed(0)}% · 2+ real options ${s.impactPct.toFixed(0)}% · can-hit-HQ ${s.hqPressurePct.toFixed(0)}%`,
    );
  }
}

const outDir = 'sim-results';
mkdirSync(outDir, { recursive: true });
// A filtered run writes its own file so it can never clobber the full-matrix evidence.
// SIM_OUT names an explicit archive, e.g. SIM_OUT=sim-results/run-b.json.
const outPath = process.env.SIM_OUT ?? `${outDir}/playtest${PHASE === 'ALL' ? '' : `-${PHASE}`}.json`;
const payload = {
  generatedAt: new Date().toISOString(),
  model: { secPerAction: SEC_ACTION, secPerTurn: SEC_TURN },
  cells: results,
};
await Bun.write(outPath, JSON.stringify(payload, null, 2));
console.log(`\nWrote ${outPath} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
