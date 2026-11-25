/**
 * Bridge audit: does every deck do a job?
 *
 *  laneBlk  = a building on the landing lane (shore -> one tile straight beyond, along the deck axis)
 *  shoreBlk = a building on the shore tile itself
 *  stump    = a crossing (contiguous run of one deck type) whose end landing is missing or is a
 *             dead-end stone: a land area under 3 tiles, no Base/Bank, and no other crossing on it
 *
 * The stub test is written independently of the generator's prune so the two can disagree.
 * Run: bun sim-bridge-audit.ts [boards-per-cell]
 */
import { createGeneratedGame } from './src/index';

const PRESETS = ['classic', 'balanced', 'lush_valley', 'twin_fronts'] as const;
const COUNTS = [2, 3, 4, 5, 6] as const;
const PER = Number(process.argv[2] ?? 24);

const isBridgeType = (s: string) => s === 'BRIDGE' || s === 'BRIDGE_V';
const WALKABLE = new Set([
  'PLAINS', 'SAND', 'DUNES', 'FOREST', 'ROAD', 'ROAD_H', 'QUICKSAND', 'TUNNEL', 'BRIDGE', 'BRIDGE_V',
]);
const REAL_LAND = new Set(['PLAINS', 'SAND', 'DUNES', 'FOREST', 'ROAD', 'ROAD_H', 'QUICKSAND', 'TUNNEL']);
const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const seedFrom = (s: string): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let x = h >>> 0;
  let out = '';
  for (let i = 0; i < 8; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; out += alphabet[x % alphabet.length]; }
  return out;
};

type Cell = { boards: number; bridges: number; laneBlk: number; shoreBlk: number; stump: number; badBoards: number };
const rows: Record<string, Cell> = {};
const stumpsSeen: string[] = [];

const analyze = (map: any[], size: number, key: string) => {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null);

  // 1. Real land areas (decks do not count as land).
  const landId = new Int32Array(size * size).fill(-1);
  const landSize: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (landId[i] !== -1 || !REAL_LAND.has(map[i].type)) continue;
      const id = landSize.length;
      let n = 0;
      const stack = [i];
      landId[i] = id;
      while (stack.length) {
        const c = stack.pop()!;
        n++;
        const cx = c % size;
        const cy = (c - cx) / size;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (landId[ni] !== -1 || !REAL_LAND.has(map[ni].type)) continue;
          landId[ni] = id;
          stack.push(ni);
        }
      }
      landSize.push(n);
    }
  }

  // 2. Group decks into contiguous runs of one type (decks are judged by their two landings).
  const runs: any[][] = [];
  const onRun = new Set<string>();
  for (const b of map) {
    if (!isBridgeType(b.type) || onRun.has(b.id)) continue;
    const ax = b.type === 'BRIDGE' ? 1 : 0;
    const ay = b.type === 'BRIDGE' ? 0 : 1;
    let sx = b.x;
    let sy = b.y;
    for (;;) {
      const prev = at(sx - ax, sy - ay);
      if (!prev || prev.type !== b.type) break;
      sx -= ax;
      sy -= ay;
    }
    const run: any[] = [];
    let cx = sx;
    let cy = sy;
    for (;;) {
      const t = at(cx, cy);
      if (!t || t.type !== b.type) break;
      onRun.add(t.id);
      run.push(t);
      cx += ax;
      cy += ay;
    }
    runs.push(run);
  }

  // 3. Which land areas each run touches; which areas hold a Base or Bank.
  const runsTouching: Array<Set<number>> = landSize.map(() => new Set<number>());
  runs.forEach((run, i) => {
    const touched = new Set<number>();
    for (const t of run) {
      for (const [dx, dy] of DIRS) {
        const nb = at(t.x + dx, t.y + dy);
        if (!nb) continue;
        const c = landId[nb.y * size + nb.x];
        if (c !== -1) touched.add(c);
      }
    }
    touched.forEach(c => runsTouching[c].add(i));
  });
  const hasPlace: boolean[] = landSize.map(() => false);
  for (const t of map) {
    if (t.type !== 'BASE' && t.type !== 'BANK') continue;
    for (const [dx, dy] of DIRS) {
      const nb = at(t.x + dx, t.y + dy);
      if (!nb) continue;
      const c = landId[nb.y * size + nb.x];
      if (c !== -1) hasPlace[c] = true;
    }
  }
  const landingOk = (t: any | null): boolean => {
    if (!t) return false;
    const c = landId[t.y * size + t.x];
    if (c === -1) return false;
    return landSize[c] >= 3 || hasPlace[c] || runsTouching[c].size >= 2;
  };

  // 4. Per run: landings must exist and be somewhere, plus the building checks along the deck.
  let laneBlk = 0;
  let shoreBlk = 0;
  let stumps = 0;
  let bridges = 0;
  for (const run of runs) {
    const ax = run[0].type === 'BRIDGE' ? 1 : 0;
    const ay = run[0].type === 'BRIDGE' ? 0 : 1;
    const first = run[0];
    const last = run[run.length - 1];
    const landing = (t: any, dir: number) => at(t.x + ax * dir, t.y + ay * dir);
    const ends = [landing(first, -1), landing(last, 1)];
    bridges += run.length;
    const servesPlace = run.some(t =>
      DIRS.some(([dx, dy]) => {
        const nb = at(t.x + dx, t.y + dy);
        return !!nb && (nb.type === 'BASE' || nb.type === 'BANK');
      }),
    );
    if (!servesPlace && !ends.every(landingOk)) {
      stumps++;
      if (stumpsSeen.length < 12) {
        stumpsSeen.push(`${key}: stump ${run[0].type} run@${first.x},${first.y}..${last.x},${last.y}`);
      }
    }
    for (const [t, dir] of [[first, -1], [last, 1]] as const) {
      const shore = landing(t, dir);
      if (!shore || isBridgeType(shore.type)) continue;
      if (!WALKABLE.has(shore.type) && shore.type !== 'BUILDING') continue;
      if (shore.type === 'BUILDING') shoreBlk++;
      const lane = at(shore.x + ax * dir, shore.y + ay * dir);
      if (lane && lane.type === 'BUILDING') laneBlk++;
    }
  }
  return { laneBlk, shoreBlk, stumps, bridges };
};

for (const preset of PRESETS) {
  for (const players of COUNTS) {
    const key = `${preset} ${players}P`;
    const cell: Cell = { boards: 0, bridges: 0, laneBlk: 0, shoreBlk: 0, stump: 0, badBoards: 0 };
    for (let i = 0; i < PER; i++) {
      const g = createGeneratedGame({
        playerCount: players,
        mapSeed: seedFrom(`bridge-audit:${preset}:${players}:${i}`),
        mapGen: { preset, knobs: {} },
        unitCounts: { SOLDIER: 2 },
      } as any);
      const r = analyze(g.mapData, g.gridSize, `${key} seed#${i}`);
      cell.boards++;
      cell.bridges += r.bridges;
      cell.laneBlk += r.laneBlk;
      cell.shoreBlk += r.shoreBlk;
      cell.stump += r.stumps;
      if (r.laneBlk + r.shoreBlk + r.stumps > 0) cell.badBoards++;
    }
    rows[key] = cell;
  }
}

console.log('cell                 boards bridges laneBlk shoreBlk  stump  badBoards');
for (const [k, c] of Object.entries(rows)) {
  console.log(
    `${k.padEnd(20)} ${String(c.boards).padStart(6)} ${String(c.bridges).padStart(7)} ${String(c.laneBlk).padStart(7)} ${String(c.shoreBlk).padStart(8)} ${String(c.stump).padStart(6)} ${String(c.badBoards).padStart(10)}`,
  );
}
const sum = (f: (c: Cell) => number) => Object.values(rows).reduce((a, c) => a + f(c), 0);
console.log(`\nboards: ${sum(c => c.boards)} · bridges: ${sum(c => c.bridges)} · lane-blocked: ${sum(c => c.laneBlk)} · shore-blocked: ${sum(c => c.shoreBlk)}`);
console.log(`boards with any defect: ${sum(c => c.badBoards)}/${sum(c => c.boards)}`);
if (stumpsSeen.length) console.log('stumps:\n  ' + stumpsSeen.join('\n  '));
