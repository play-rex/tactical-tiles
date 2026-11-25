/**
 * Map playability audit — the structural half of the playtest lab.
 *
 * sim-playtest.ts measures what happens when bots play a map. This measures the map itself,
 * because a board can be "fair" by win-rate and still be unplayable: split by a canyon with no
 * bridge, so tight that the first player can siege a neighbour on turn one, or missing the
 * terrain a sniper needs. Those show up here as connectivity, HQ spacing and perch parity.
 *
 * Run: cd packages/engine && bun sim-map-audit.ts
 *      MAP_SEEDS=40 bun sim-map-audit.ts
 */
import { createGeneratedGame, DEFAULT_GAME_SETTINGS, MAP_GEN_PRESETS } from './src/index';
import { TERRAIN_COSTS } from './src/constants/Config';
import type { GameSettings, MapPresetId, Tile } from './src/index';

const SEEDS = Number(process.env.MAP_SEEDS ?? 24);

const walkable = (t: Tile) => (TERRAIN_COSTS[t.type] ?? 99) < 90;

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

const bfs = (map: Tile[], size: number, start: Tile, goal?: Tile): Map<string, number> => {
  const dist = new Map<string, number>([[start.id, 0]]);
  const queue: Tile[] = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (goal && cur.id === goal.id) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const t = map[ny * size + nx];
      if (!t || dist.has(t.id)) continue;
      // Banks/barriers/water are blocked ground. A base is not walkable either, but a unit can
      // stand on and move through its apron, so bases count as traversable endpoints.
      if (!walkable(t) && t.type !== 'BASE' && t.id !== goal?.id) continue;
      dist.set(t.id, (dist.get(cur.id) ?? 0) + 1);
      queue.push(t);
    }
  }
  return dist;
};

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const quantile = (a: number[], p: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] : 0;
};

interface Row {
  preset: string;
  players: number;
  size: number;
  hqMin: number;
  hqPath: number;
  connectedPct: number;
  componentPct: number;
  banks: number;
  perchGap: number;
  bankDist: number;
  mountPct: number;
  forestPct: number;
  waterPct: number;
  buildingCount: number;
}

const rows: Row[] = [];

for (const preset of MAP_GEN_PRESETS) {
  if (preset.id === 'custom') continue;
  for (const players of [2, 3, 4, 5, 6]) {
    const acc: Row[] = [];
    for (let i = 0; i < SEEDS; i++) {
      const settings: GameSettings = {
        ...DEFAULT_GAME_SETTINGS,
        playerCount: players,
        mapSeed: seedFrom(`${preset.id}#${players}#${i}`),
        mapGen: { preset: preset.id as MapPresetId },
      };
      const g = createGeneratedGame(settings);
      const map = g.mapData;
      const size = g.gridSize;
      const bases = map.filter(t => t.type === 'BASE');
      const banks = map.filter(t => t.type === 'BANK');

      let connected = 0;
      let componentFrac = 0;
      let maxPath = 0;
      if (bases.length >= 2) {
        const fromFirst = bfs(map, size, bases[0]);
        const reachable = bases.slice(1).filter(b => fromFirst.has(b.id)).length;
        connected = reachable / Math.max(1, bases.length - 1);
        maxPath = Math.max(...bases.slice(1).map(b => fromFirst.get(b.id) ?? -1), 0);

        // Largest walkable component / all walkable tiles.
        const seen = new Set<string>();
        let largest = 0;
        for (const t of map) {
          if (!walkable(t) || seen.has(t.id)) continue;
          const comp = bfs(map, size, t);
          for (const id of comp.keys()) seen.add(id);
          largest = Math.max(largest, comp.size);
        }
        const walkableCount = map.filter(walkable).length || 1;
        componentFrac = largest / walkableCount;
      }

      const hqMin = bases.length >= 2
        ? Math.min(...bases.flatMap((a, ai) => bases.slice(ai + 1).map(b => Math.abs(a.x - b.x) + Math.abs(a.y - b.y))))
        : 0;

      const perZone = new Map<number, number>();
      for (const t of map) {
        if (t.zone === undefined) continue;
        const perch = t.type === 'MOUNTAIN' || t.type === 'DUNES' || (t.type === 'BUILDING' && (t.owner === null || t.owner === undefined));
        if (perch) perZone.set(t.zone, (perZone.get(t.zone) ?? 0) + 1);
      }
      const perZoneCounts = Array.from({ length: players }, (_, z) => perZone.get(z) ?? 0);
      const perchGap = Math.max(...perZoneCounts) - Math.min(...perZoneCounts);

      const bankDist = banks.length
        ? mean(bases.map(b => Math.min(...banks.map(bk => Math.abs(b.x - bk.x) + Math.abs(b.y - bk.y)))))
        : -1;

      acc.push({
        preset: preset.id,
        players,
        size,
        hqMin,
        hqPath: maxPath,
        connectedPct: 100 * connected,
        componentPct: 100 * componentFrac,
        banks: banks.length,
        perchGap,
        bankDist,
        mountPct: (100 * map.filter(t => t.type === 'MOUNTAIN').length) / map.length,
        forestPct: (100 * map.filter(t => t.type === 'FOREST').length) / map.length,
        waterPct: (100 * map.filter(t => t.type === 'WATER' || t.type === 'CANYON').length) / map.length,
        buildingCount: map.filter(t => t.type === 'BUILDING').length,
      });
    }

    rows.push({
      preset: preset.id,
      players,
      size: Math.round(mean(acc.map(r => r.size))),
      hqMin: mean(acc.map(r => r.hqMin)),
      hqPath: quantile(acc.map(r => r.hqPath), 0.5),
      connectedPct: 100 * mean(acc.map(r => r.connectedPct / 100)),
      componentPct: 100 * mean(acc.map(r => r.componentPct / 100)),
      banks: mean(acc.map(r => r.banks)),
      perchGap: mean(acc.map(r => r.perchGap)),
      bankDist: mean(acc.map(r => r.bankDist)),
      mountPct: mean(acc.map(r => r.mountPct)),
      forestPct: mean(acc.map(r => r.forestPct)),
      waterPct: mean(acc.map(r => r.waterPct)),
      buildingCount: mean(acc.map(r => r.buildingCount)),
    });
  }
}

const head =
  'preset'.padEnd(14) +
  'P'.padStart(3) +
  'size'.padStart(5) +
  'HQmin'.padStart(7) +
  'HQpath'.padStart(7) +
  'bases÷'.padStart(7) +
  'walk÷'.padStart(6) +
  'banks'.padStart(6) +
  'bankDist'.padStart(9) +
  'perchGap'.padStart(9) +
  'mtn%'.padStart(6) +
  'for%'.padStart(6) +
  'water%'.padStart(7) +
  'bldgs'.padStart(6);
console.log(`${SEEDS} boards per cell · ÷ = all bases reachable on foot / walkable area fraction\n`);
console.log(head);
for (const r of rows) {
  console.log(
    r.preset.slice(0, 13).padEnd(14) +
      String(r.players).padStart(3) +
      String(r.size).padStart(5) +
      r.hqMin.toFixed(0).padStart(7) +
      String(r.hqPath).padStart(7) +
      `${r.connectedPct.toFixed(0)}%`.padStart(7) +
      `${r.componentPct.toFixed(0)}%`.padStart(6) +
      r.banks.toFixed(1).padStart(6) +
      (r.bankDist < 0 ? '-' : r.bankDist.toFixed(1)).padStart(9) +
      r.perchGap.toFixed(0).padStart(9) +
      r.mountPct.toFixed(0).padStart(6) +
      r.forestPct.toFixed(0).padStart(6) +
      r.waterPct.toFixed(0).padStart(7) +
      r.buildingCount.toFixed(0).padStart(6),
  );
}

console.log('\n--- VERDICTS ---');
const bad = rows.filter(r => r.connectedPct < 99.9 || r.componentPct < 97);
if (bad.length) {
  for (const r of bad) {
    console.log(`${r.preset} ${r.players}P: bases reachable ${r.connectedPct.toFixed(0)}%, walkable area in one piece ${r.componentPct.toFixed(0)}%`);
  }
} else {
  console.log('All generated boards: every base reachable on foot, walkable area in one piece.');
}
const tight = rows.filter(r => r.hqMin < 14);
for (const r of tight) console.log(`${r.preset} ${r.players}P: nearest two HQs ${r.hqMin.toFixed(0)} tiles apart`);
const lowBank = rows.filter(r => r.banks < 2);
for (const r of lowBank) console.log(`${r.preset} ${r.players}P: only ${r.banks.toFixed(1)} banks per board`);
const perchy = rows.filter(r => r.perchGap >= 12);
for (const r of perchy) console.log(`${r.preset} ${r.players}P: sniper perches uneven across zones (gap ${r.perchGap.toFixed(0)})`);

const m = Math.min(...rows.map(r => r.hqMin));
const byPlayers = new Map<number, number[]>();
for (const r of rows) byPlayers.set(r.players, [...(byPlayers.get(r.players) ?? []), r.hqMin]);
console.log('\n--- HQ SPACING BY PLAYER COUNT (all presets) ---');
for (const [p, v] of [...byPlayers.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`${p}P: nearest-HQ median ${quantile(v, 0.5).toFixed(0)} tiles (min ${Math.min(...v).toFixed(0)}, max ${Math.max(...v).toFixed(0)})`);
}
console.log(`overall minimum HQ separation: ${m.toFixed(0)} tiles`);
