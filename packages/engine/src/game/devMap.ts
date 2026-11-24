/**
 * Dev-map generator.
 *
 * The shipped generator (`generateDynamicMap`) is a carefully tuned archetype machine — great for
 * matches, useless for testing "what does a 40% mountain board play like". This one exposes every
 * ingredient of the battlefield as a knob (forest/mountain/river coverage, desert split, buildings,
 * loot, banks) and guarantees the result is still playable: bases are carved clear, and a ground
 * pass links every base so pathfinding can never strand a player behind water.
 *
 * Deterministic: the same options + seed always produce the same board.
 */
import { BANK_STATS, BASE_STATS } from '../constants/Config';
import type { SupplyLootType, TerrainType, Tile } from '../types';
import { createSeededRng, generateSectorSeed, normalizeSeed } from '../utils/SeededRandom';

export interface DevMapOptions {
  /** Seed code; the same seed always rebuilds the same battlefield. */
  seed: string;
  /** Board edge length in tiles (12–32). */
  gridSize: number;
  /** Seats, which decides how many HQs are stamped (2–6). */
  playerCount: number;
  /** Share of the board covered by forest groves (0–55). */
  forestPct: number;
  /** Share covered by mountain massifs (0–40). */
  mountainPct: number;
  /** River volume: channel width and wander (0–30). */
  waterPct: number;
  /** Share of the ground painted sand/dunes instead of grass (0–100). */
  desertPct: number;
  /** Share of watchtowers/bunkers (0–15). */
  buildingPct: number;
  /** Share of tiles carrying loose supply loot (0–40). */
  lootPct: number;
  /** How many banks to stamp (0–4). */
  banks: number;
  /** How many rivers cut the board (0–3). */
  rivers: number;
}

export const DEFAULT_DEV_MAP_OPTIONS: DevMapOptions = {
  seed: 'DEV001',
  gridSize: 20,
  playerCount: 2,
  forestPct: 18,
  mountainPct: 12,
  waterPct: 10,
  desertPct: 0,
  buildingPct: 4,
  lootPct: 6,
  banks: 1,
  rivers: 1,
};

export interface DevMapResult {
  map: Tile[];
  size: number;
}

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));

/** Tiny value-noise: cheap, deterministic per seed, and organic enough for terrain. */
const makeNoise = (seedText: string) => {
  let salt = 0;
  for (let i = 0; i < seedText.length; i++) salt = (salt * 31 + seedText.charCodeAt(i)) % 100000;
  const hash = (x: number, y: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7 + salt * 0.013) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
  };
};

/** Where each seat's HQ sits, in a fixed order (corners first, then the far edges). */
export const devBaseSlots = (size: number, playerCount: number): { x: number; y: number }[] => {
  const far = size - 3;
  const mid = Math.floor(size / 2);
  const slots = [
    { x: 2, y: 2 },
    { x: far, y: far },
    { x: far, y: 2 },
    { x: 2, y: far },
    { x: mid, y: 2 },
    { x: mid, y: far },
  ];
  return slots.slice(0, clampInt(playerCount, 2, 6));
};

const LOOT_TYPES: SupplyLootType[] = ['AMMO', 'MEDKIT', 'FIRST_AID'];

export const generateDevMap = (options: Partial<DevMapOptions> = {}): DevMapResult => {
  const opts: DevMapOptions = { ...DEFAULT_DEV_MAP_OPTIONS, ...options };
  const size = clampInt(opts.gridSize, 12, 32);
  const players = clampInt(opts.playerCount, 2, 6);
  const seed = normalizeSeed(opts.seed) || generateSectorSeed();
  const rng = createSeededRng(`${seed}_dev_${size}_${players}`);
  const noise = makeNoise(seed);

  const map: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      map.push({ id: `${x},${y}`, x, y, type: 'PLAINS', height: 1, loot: null, hazardState: 'SAFE' });
    }
  }
  const at = (x: number, y: number): Tile | null =>
    x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null;
  const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size && y < size;
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  // ── 1. Ground: grass vs desert, split with noise so the border is a coastline, not a staircase.
  const desertCut = clampInt(opts.desertPct, 0, 100) / 100;
  if (desertCut > 0) {
    for (const t of map) {
      const n = noise(t.x * 0.24, t.y * 0.24);
      if (n < desertCut) {
        t.type = 'SAND';
        // A thin dune belt with a slightly higher noise value gives the desert relief.
        if (noise(t.x * 0.4 + 40, t.y * 0.4 + 40) < 0.12) {
          t.type = 'DUNES';
          t.height = 2;
        }
      }
    }
  }

  const paintable = (t: Tile | null): t is Tile =>
    !!t && (t.type === 'PLAINS' || t.type === 'SAND');

  // ── 2. Mountain massifs: random walks that branch, so ranges feel grown rather than dotted.
  const mountainTiles = Math.round((size * size * clampInt(opts.mountainPct, 0, 40)) / 100);
  let paintedMountains = 0;
  let mountainGuard = 0;
  while (paintedMountains < mountainTiles && mountainGuard < 4000) {
    mountainGuard++;
    const sx = 1 + Math.floor(rng() * (size - 2));
    const sy = 1 + Math.floor(rng() * (size - 2));
    const steps = 3 + Math.floor(rng() * 9);
    let cx = sx;
    let cy = sy;
    for (let i = 0; i < steps && paintedMountains < mountainTiles; i++) {
      const t = at(cx, cy);
      if (paintable(t)) {
        t.type = 'MOUNTAIN';
        t.height = 2;
        paintedMountains++;
      }
      // Prefer one axis, occasionally turn — produces ridges, not blobs.
      if (rng() < 0.7) cx += rng() < 0.5 ? 1 : -1;
      else cy += rng() < 0.5 ? 1 : -1;
      cx = Math.max(0, Math.min(size - 1, cx));
      cy = Math.max(0, Math.min(size - 1, cy));
    }
  }

  // ── 3. Forest groves: looser walks, canopies over grass or sand.
  const forestTiles = Math.round((size * size * clampInt(opts.forestPct, 0, 55)) / 100);
  let paintedForest = 0;
  let forestGuard = 0;
  while (paintedForest < forestTiles && forestGuard < 4000) {
    forestGuard++;
    let cx = 1 + Math.floor(rng() * (size - 2));
    let cy = 1 + Math.floor(rng() * (size - 2));
    const steps = 2 + Math.floor(rng() * 6);
    for (let i = 0; i < steps && paintedForest < forestTiles; i++) {
      const t = at(cx, cy);
      if (paintable(t)) {
        t.type = 'FOREST';
        t.height = 1;
        paintedForest++;
      }
      if (rng() < 0.5) cx += rng() < 0.5 ? 1 : -1;
      else cy += rng() < 0.5 ? 1 : -1;
      cx = Math.max(0, Math.min(size - 1, cx));
      cy = Math.max(0, Math.min(size - 1, cy));
    }
  }

  // ── 4. Rivers: continuous orthogonal channels with bridges, so no player is ever cut off.
  const riverCount = clampInt(opts.rivers, 0, 3);
  const riverVolume = clampInt(opts.waterPct, 0, 30);
  if (riverCount > 0 && riverVolume > 0) {
    const width = riverVolume >= 18 ? 2 : 1;
    for (let r = 0; r < riverCount; r++) {
      const horizontal = r % 2 === 0;
      const lane = Math.round((size * (r + 1)) / (riverCount + 1));
      let wander = 0;
      let bridgeTick = 0;
      for (let step = 0; step < size; step++) {
        wander = Math.max(-2, Math.min(2, wander + (rng() - 0.5) * 0.8));
        const depth = Math.round(lane + wander);
        for (let w = 0; w < width; w++) {
          const x = horizontal ? step : depth + w;
          const y = horizontal ? depth + w : step;
          const t = at(x, y);
          if (!t) continue;
          // A bridge every ~5 tiles keeps the crossing playable across the whole channel.
          const isBridge = bridgeTick % 5 === 2;
          t.type = isBridge ? (horizontal ? 'BRIDGE' : 'BRIDGE_V') : 'WATER';
          t.height = isBridge ? 1 : 0;
        }
        bridgeTick++;
      }
    }
  }

  // ── 5. Buildings: watchtowers (fire platforms) and bunkers (cover).
  const buildingTiles = Math.round((size * size * clampInt(opts.buildingPct, 0, 15)) / 100);
  for (let placed = 0, guard = 0; placed < buildingTiles && guard < 2000; guard++) {
    const t = at(Math.floor(rng() * size), Math.floor(rng() * size));
    if (!paintable(t)) continue;
    t.type = 'BUILDING';
    t.subType = rng() < 0.62 ? 'WATCHTOWER' : 'BUNKER';
    t.height = 1;
    placed++;
  }

  // ── 6. Bases last, and carved clear, so nothing can box an HQ in.
  const slots = devBaseSlots(size, players);
  slots.forEach((slot, owner) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = at(slot.x + dx, slot.y + dy);
        if (!t || t.type === 'BASE') continue;
        t.type = 'PLAINS';
        t.height = 1;
        t.loot = null;
        t.subType = undefined;
      }
    }
    const hq = at(slot.x, slot.y);
    if (!hq) return;
    hq.type = 'BASE';
    hq.owner = owner;
    hq.height = 1;
    hq.hp = BASE_STATS.HP;
    hq.maxHp = BASE_STATS.HP;
    hq.loot = null;
  });

  // ── 7. Banks, kept away from the HQs so a raid is a real trip.
  const bankCount = clampInt(opts.banks, 0, 4);
  const bankSpots: Tile[] = [];
  for (let placed = 0, guard = 0; placed < bankCount && guard < 2000; guard++) {
    const t = at(3 + Math.floor(rng() * (size - 6)), 3 + Math.floor(rng() * (size - 6)));
    if (!t) continue;
    if (t.type !== 'PLAINS' && t.type !== 'SAND' && t.type !== 'FOREST') continue;
    if (slots.some(s => Math.abs(s.x - t.x) + Math.abs(s.y - t.y) < 4)) continue;
    if (bankSpots.some(b => b.x === t.x && b.y === t.y)) continue;
    t.type = 'BANK';
    t.height = 1;
    t.owner = null;
    // Vault integrity: without hp the engine's SIEGE rejects the tile as an invalid target.
    t.hp = BANK_STATS.HP;
    t.maxHp = BANK_STATS.HP;
    t.hackProgress = 0;
    t.loot = null;
    bankSpots.push(t);
    placed++;
  }

  // ── 8. Loose supply loot on open ground.
  const lootTiles = Math.round((size * size * clampInt(opts.lootPct, 0, 40)) / 100);
  for (let placed = 0, guard = 0; placed < lootTiles && guard < 3000; guard++) {
    const t = at(Math.floor(rng() * size), Math.floor(rng() * size));
    if (!t || (t.type !== 'PLAINS' && t.type !== 'SAND')) continue;
    if (t.loot) continue;
    t.loot = pick(LOOT_TYPES);
    placed++;
  }

  // ── 9. Ground pass: guarantee every HQ can reach every other HQ on foot.
  const walkable = (t: Tile): boolean => t.type !== 'WATER';
  const key = (t: Tile): string => `${t.x},${t.y}`;
  const reachable = (from: Tile): Set<string> => {
    const seen = new Set<string>([key(from)]);
    const queue: Tile[] = [from];
    while (queue.length > 0) {
      const cur = queue.shift() as Tile;
      const neighbours = [at(cur.x + 1, cur.y), at(cur.x - 1, cur.y), at(cur.x, cur.y + 1), at(cur.x, cur.y - 1)];
      for (const n of neighbours) {
        if (!n || !walkable(n)) continue;
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
    return seen;
  };
  const hqTiles = slots.map(s => at(s.x, s.y)).filter((t): t is Tile => !!t);
  if (hqTiles.length > 1) {
    const origin = hqTiles[0];
    for (let i = 1; i < hqTiles.length; i++) {
      const target = hqTiles[i];
      if (reachable(origin).has(key(target))) continue;
      // Carve a straight service road of bridge/plains between the two HQs.
      const steps = Math.max(Math.abs(target.x - origin.x), Math.abs(target.y - origin.y));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(origin.x + ((target.x - origin.x) * s) / steps);
        const y = Math.round(origin.y + ((target.y - origin.y) * s) / steps);
        const t = at(x, y);
        if (!t || t.type === 'BASE') continue;
        if (t.type === 'WATER') {
          t.type = 'BRIDGE';
          t.height = 1;
        }
      }
    }
  }

  return { map, size };
};

/** Turns a generated board into the per-tile counts the sandbox shows in its summary. */
export const summarizeDevMap = (map: Tile[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of map) out[t.type] = (out[t.type] ?? 0) + 1;
  return out;
};

export const DEV_TERRAIN_LABEL: Record<string, string> = {
  PLAINS: 'GRASS',
  SAND: 'SAND',
  DUNES: 'DUNES',
  FOREST: 'FOREST',
  MOUNTAIN: 'MOUNTAIN',
  WATER: 'WATER',
  BRIDGE: 'BRIDGE',
  BRIDGE_V: 'BRIDGE',
  BANK: 'BANK',
  BASE: 'HQ',
  BUILDING: 'BUILDING',
  BARRIER: 'BARRIER',
  CANYON: 'CANYON',
  TUNNEL: 'TUNNEL',
  ROAD: 'ROAD',
  ROAD_H: 'ROAD',
  QUICKSAND: 'QUICKSAND',
} as Record<TerrainType, string>;
