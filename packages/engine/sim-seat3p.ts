/**
 * 3P seat-fairness probe.
 *
 * Is a seat-win spread turn order, terrain, or sampling noise? Three arms on the same cells the
 * playtest matrix uses (3P CP30 / CP20 / fog):
 *
 *   fix  shipped behaviour: seat 0 always acts first.
 *   rot  same maps, but the first player rotates per match (0,1,2,0,…).
 *
 * Run:
 *   bun sim-seat3p.ts                    # 120 matches/cell/arm, varied map seeds
 *   MATCHES=60 SEEDMODE=fixed bun sim-seat3p.ts
 *   SEEDS=30 PER_SEED=12 bun sim-seat3p.ts   # per-map breakdown
 *
 * Writes nothing; prints a summary plus a Monte Carlo p-value for the observed spread under a
 * fair 1/3-1/3-1/3 null.
 */
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import type { GameAction, GameSettings, GameState } from './src/index';

const MATCHES = Number(process.env.MATCHES ?? 120);
const SEEDMODE = process.env.SEEDMODE ?? 'varied'; // varied | fixed
const FIXED_SEED = process.env.SEED ?? 'SEAT-FIXED-MAP';
const SEEDS = Number(process.env.SEEDS ?? 0); // >0: per-map breakdown instead of the main arms
const PER_SEED = Number(process.env.PER_SEED ?? 12);

interface Cell { key: string; classic: boolean; fog: boolean }
const CELLS: Cell[] = [
  { key: '3P CP30', classic: false, fog: false },
  { key: '3P CP20', classic: true, fog: false },
  { key: '3P fog', classic: false, fog: true },
];

const settingsFor = (cell: Cell, seed: string): GameSettings => ({
  ...DEFAULT_GAME_SETTINGS,
  playerCount: 3,
  unitCounts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
  dynamicWeather: true,
  fogOfWar: cell.fog,
  doomsdayEnabled: false,
  victoryMode: 'CONQUER',
  aiDifficulty: 'HARD',
  mutators: { classicCp: cell.classic, scarcity: false, ironman: false },
  mapSeed: seed,
  mapGen: { preset: 'balanced', knobs: { gridSize: 'AUTO' } },
} as GameSettings);

/** One bot-vs-bot match; `startSeat` overrides who acts first. */
const playOne = (cell: Cell, seed: string, startSeat: number | null): number | 'DRAW' | null => {
  let g: GameState = createGeneratedGame(settingsFor(cell, seed));
  if (startSeat !== null && startSeat !== 0) g = { ...g, currentPlayer: startSeat };
  let actions = 0;
  const cap = 6000;
  while (g.winner === null && actions < cap) {
    const seat = g.currentPlayer;
    const prep = prepareAction(g, seat, botAction(g, 'HARD'));
    const action: GameAction = prep.ok ? prep.action : { type: 'END_TURN' };
    const res = applyAction(g, action, { autoBankReward: true });
    g = res.rejected ? applyAction(g, { type: 'END_TURN' }, { autoBankReward: true }).state : res.state;
    actions++;
  }
  return g.winner;
};

const rngFrom = (label: string) => {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) { h ^= label.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
};

const spread = (wins: number[], n: number) =>
  n === 0 ? 0 : ((Math.max(...wins) - Math.min(...wins)) / n) * 100;

/** P(range of 3 multinomial(1/3) shares ≥ observed) under a fair null. */
const nullP = (wins: number[], n: number, trials = 20000): number => {
  const obs = spread(wins, n);
  const r = rngFrom(`null-${wins.join('-')}-${n}`);
  let hits = 0;
  for (let t = 0; t < trials; t++) {
    let rem = n;
    const w = [0, 0, 0];
    for (let i = 0; i < 2; i++) {
      // binomial draw for the remaining seats, keep it exact enough with a normal approx
      let k = 0;
      for (let j = 0; j < rem; j++) if (r() < 1 / (3 - i)) k++;
      w[i] = k; rem -= k;
    }
    w[2] = rem;
    if (spread(w, n) >= obs - 1e-9) hits++;
  }
  return hits / trials;
};

const runCell = (cell: Cell, arm: 'fix' | 'rot', matches: number) => {
  const wins = [0, 0, 0];
  let decided = 0, draws = 0, stalls = 0;
  for (let m = 0; m < matches; m++) {
    const seed = SEEDMODE === 'fixed' ? FIXED_SEED : `${cell.key}-${arm}-${m}`;
    const start = arm === 'rot' ? m % 3 : null;
    const w = playOne(cell, seed, start);
    if (typeof w === 'number') { wins[w]++; decided++; }
    else if (w === 'DRAW') draws++;
    else stalls++;
  }
  return { wins, decided, draws, stalls };
};

if (SEEDS > 0) {
  // Per-map view: does one seat win more *on its own map* with the shipped order (terrain), and
  // does that advantage move when the first player rotates?
  const cell = CELLS[0];
  console.log(`per-map breakdown, ${cell.key}, ${SEEDS} seeds x ${PER_SEED} matches, fixed start order`);
  const rows: string[] = [];
  const total = [0, 0, 0];
  let nAll = 0;
  for (let s = 0; s < SEEDS; s++) {
    const seed = `PM-${s}`;
    const wins = [0, 0, 0];
    let n = 0;
    for (let m = 0; m < PER_SEED; m++) {
      const w = playOne(cell, seed, null);
      if (typeof w === 'number') { wins[w]++; n++; }
    }
    if (n === 0) continue;
    nAll += n;
    wins.forEach((w, i) => { total[i] += w; });
    rows.push(`${seed.padEnd(6)} ${wins.map(w => `${((100 * w) / n).toFixed(0)}%`).join(' ')} spread ${spread(wins, n).toFixed(0)}pp`);
  }
  console.log(rows.join('\n'));
  console.log(`pooled ${total.map(w => `${((100 * w) / nAll).toFixed(0)}%`).join(' ')} over ${nAll} decided`);
} else {
  const table: string[] = [];
  const cells = MATCHES ? CELLS : CELLS;
  for (const cell of cells) {
    for (const arm of ['fix', 'rot'] as const) {
      const r = runCell(cell, arm, MATCHES);
      const pct = r.wins.map(w => (r.decided ? (100 * w) / r.decided : 0));
      const p = nullP(r.wins, r.decided);
      table.push(
        `${cell.key.padEnd(7)} ${arm}  seats ${pct.map(v => `${v.toFixed(0)}%`).join(' ')}` +
        `  spread ${spread(r.wins, r.decided).toFixed(0)}pp  decided ${r.decided}` +
        `  draws ${r.draws} stalls ${r.stalls}  fair-null p ${p < 0.001 ? '<0.001' : p.toFixed(3)}`,
      );
    }
  }
  console.log(table.join('\n'));
}
