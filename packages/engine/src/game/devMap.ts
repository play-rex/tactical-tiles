/**
 * Dev-map generator.
 *
 * The shipped generator (`generateDynamicMap`) is a carefully tuned archetype machine — great for
 * matches, useless for testing "what does a 40% mountain board play like". This one exposes every
 * ingredient of the battlefield as a knob (forest/mountain/river coverage, desert split, buildings,
 * loot, banks) and guarantees the result is still playable: bases are carved clear, and a ground
 * pass links every base so pathfinding can never strand a player behind water.
 *
 * Knobs are honoured as *tile counts*, not as dice rolls: `forestPct: 30` on a 20×20 board paints
 * exactly 120 forest tiles (scatter completion fills whatever the organic walks miss), so the same
 * number means the same board every time. `devMapReport` reports what was actually built next to
 * what was asked for, which is what the setup page shows.
 *
 * Deterministic: the same options + seed always produce the same board.
 */
import { BANK_STATS, BASE_STATS } from '../constants/Config';
import { placeEdgeAwareBridges } from '../grid/BridgePlacement';
import type { SupplyLootType, TerrainType, Tile } from '../types';
import { createSeededRng, generateSectorSeed, normalizeSeed } from '../utils/SeededRandom';
import { archipelagoSeaShare, carveArchipelago } from './islandArchipelago';
import { channelWidthStepper, planRiverChannel } from './riverChannel';

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
  /** River volume: share of the board under water, spread across the channels (0–30). */
  waterPct: number;
  /** How the water is built: braided river channels, an island chain, or none at all. */
  waterStyle: 'RIVERS' | 'ISLANDS' | 'NONE';
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
  waterStyle: 'RIVERS',
  desertPct: 0,
  buildingPct: 4,
  lootPct: 1,
  banks: 1,
  rivers: 1,
};

/** Coverage numbers, in the same unit the knobs use (whole percentages / counts). */
export interface DevMapCoverage {
  forestPct: number;
  mountainPct: number;
  waterPct: number;
  desertPct: number;
  buildingPct: number;
  lootPct: number;
  banks: number;
  rivers: number;
}

/** How far a realized coverage knob may sit from its request before the board reads unfaithful. */
export const DEV_MAP_TOLERANCE = {
  forestPct: 4,
  mountainPct: 4,
  desertPct: 4,
  buildingPct: 3,
  lootPct: 4,
  waterPct: 12,
} as const;

export interface DevMapReport {
  tiles: number;
  /** What the knobs asked for (clamped to their legal range). */
  requested: DevMapCoverage;
  /** What is actually on the board. */
  realized: DevMapCoverage;
  /** True when every coverage knob landed within tolerance; rivers cutting terrain can clear it. */
  faithful: boolean;
}

export interface DevMapResult {
  map: Tile[];
  size: number;
  report: DevMapReport;
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

/** Ground a terrain knob is allowed to paint over (structures/water are never overwritten). */
const OPEN_GROUND: ReadonlySet<TerrainType> = new Set<TerrainType>(['PLAINS', 'SAND', 'DUNES', 'FOREST']);

export const generateDevMap = (options: Partial<DevMapOptions> = {}): DevMapResult => {
  const opts: DevMapOptions = { ...DEFAULT_DEV_MAP_OPTIONS, ...options };
  const size = clampInt(opts.gridSize, 12, 32);
  const players = clampInt(opts.playerCount, 2, 6);
  const seed = normalizeSeed(opts.seed) || generateSectorSeed();
  const rng = createSeededRng(`${seed}_dev_${size}_${players}`);
  const noise = makeNoise(seed);
  const tiles = size * size;

  const map: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      map.push({ id: `${x},${y}`, x, y, type: 'PLAINS', height: 1, loot: null, hazardState: 'SAFE' });
    }
  }
  const at = (x: number, y: number): Tile | null =>
    x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null;
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const anyTile = (): Tile | null => at(Math.floor(rng() * size), Math.floor(rng() * size));
  const openGround = (t: Tile | null): t is Tile => !!t && OPEN_GROUND.has(t.type);

  // HQ plazas are reserved ground from the first pass: terrain knobs skip them, so a 5×5 carve at
  // the end can never quietly eat 15% off the forest count.
  const slots = devBaseSlots(size, players);
  const inBasePlaza = (t: Tile): boolean =>
    slots.some(s => Math.abs(s.x - t.x) <= 2 && Math.abs(s.y - t.y) <= 2);
  const paintTarget = (t: Tile | null): t is Tile => openGround(t) && !inBasePlaza(t);

  /**
   * Paints organic blobs (random walks that branch, so forests read as groves and mountains as
   * ranges), then scatter-fills whatever is left so the requested tile count is always met.
   */
  const paintBlobs = (
    target: number,
    canPaint: (t: Tile | null) => t is Tile,
    paint: (t: Tile) => void,
    walkSteps: () => number,
    axisBias = 0.7,
  ): number => {
    let painted = 0;
    for (let guard = 0; painted < target && guard < 4000; guard++) {
      let cx = 1 + Math.floor(rng() * Math.max(1, size - 2));
      let cy = 1 + Math.floor(rng() * Math.max(1, size - 2));
      const steps = walkSteps();
      for (let i = 0; i < steps && painted < target; i++) {
        const t = at(cx, cy);
        if (canPaint(t)) {
          paint(t);
          painted++;
        }
        // Prefer one axis so walks read as ridges/groves rather than blobs.
        if (rng() < axisBias) cx += rng() < 0.5 ? 1 : -1;
        else cy += rng() < 0.5 ? 1 : -1;
        cx = Math.max(0, Math.min(size - 1, cx));
        cy = Math.max(0, Math.min(size - 1, cy));
      }
    }
    // Completion pass: the walks always stall eventually (edges, blocking terrain), so finish the
    // requested count on the remaining eligible ground instead of silently returning less.
    for (let guard = 0; painted < target && guard < tiles * 8; guard++) {
      const t = anyTile();
      if (!canPaint(t)) continue;
      paint(t);
      painted++;
    }
    return painted;
  };

  // ── 1. Ground: grass vs desert is decided later (desert only paints leftover grass).
  const forestTarget = Math.round((tiles * clampInt(opts.forestPct, 0, 55)) / 100);
  const mountainTarget = Math.round((tiles * clampInt(opts.mountainPct, 0, 40)) / 100);
  const buildingTarget = Math.round((tiles * clampInt(opts.buildingPct, 0, 15)) / 100);
  const lootTarget = Math.round((tiles * clampInt(opts.lootPct, 0, 40)) / 100);
  const desertTarget = Math.round((tiles * clampInt(opts.desertPct, 0, 100)) / 100);

  // ── 2. Waterways: rivers carve continuous channels, island boards flood an archipelago field.
  //        Water goes down before the terrain knobs (the order the shipped generator uses), so
  //        forests, mountains and buildings settle on the land that is left instead of being
  //        painted over afterwards. Bridges land later, once every HQ plaza is final.
  const riverCount = clampInt(opts.rivers, 0, 3);
  const riverVolume = clampInt(opts.waterPct, 0, 30);
  const waterStyle = opts.waterStyle ?? 'RIVERS';
  const hasWater = waterStyle !== 'NONE' && riverCount > 0 && riverVolume > 0;
  // Width comes from the water the knob asks for, not from a bracket of the knob's value.
  let channel: ReturnType<typeof planRiverChannel> | null = null;
  if (hasWater && waterStyle === 'ISLANDS') {
    carveArchipelago({
      map,
      size,
      slots,
      playerCount: players,
      rings: riverCount,
      waterPct: riverVolume,
      flip: false,
      mirrored: false,
      noise,
      restoreGround: t => {
        t.type = 'PLAINS';
        t.height = 1;
      },
    });
  } else if (hasWater) {
    channel = planRiverChannel(size, riverCount, riverVolume);
    const wanderAmp = 0.35 + riverVolume / 25;
    for (let r = 0; r < riverCount; r++) {
      // Each channel walks the board once, so it averages its own width over its own run.
      const nextWidth = channelWidthStepper(channel);
      const horizontal = r % 2 === 0;
      const lane = Math.round((size * (r + 1)) / (riverCount + 1));
      let wander = 0;
      for (let step = 0; step < size; step++) {
        wander = Math.max(-3, Math.min(3, wander + (rng() - 0.5) * wanderAmp));
        const depth = Math.round(lane + wander);
        const runWidth = nextWidth();
        for (let w = 0; w < runWidth; w++) {
          const x = horizontal ? step : depth + w;
          const y = horizontal ? depth + w : step;
          const t = at(x, y);
          if (!t || inBasePlaza(t)) continue;
          t.type = 'WATER';
          t.height = 0;
          t.subType = undefined;
        }
      }
    }
  }

  // ── 3. Banks: stamped on the dry land the water leaves behind, so no vault can ever be flooded.
  const bankCount = clampInt(opts.banks, 0, 4);
  const bankSpots: Tile[] = [];
  const bankFits = (t: Tile | null): t is Tile =>
    !!t &&
    t.type === 'PLAINS' &&
    !inBasePlaza(t) &&
    !slots.some(s => Math.abs(s.x - t.x) + Math.abs(s.y - t.y) < 4) &&
    !bankSpots.some(b => b.x === t.x && b.y === t.y);

  const stampBank = (t: Tile) => {
    t.type = 'BANK';
    t.height = 1;
    t.owner = null;
    // Vault integrity: without hp the engine's SIEGE rejects the tile as an invalid target.
    t.hp = BANK_STATS.HP;
    t.maxHp = BANK_STATS.HP;
    t.hackProgress = 0;
    t.loot = null;
    t.subType = undefined;
    bankSpots.push(t);
  };

  for (let guard = 0; bankSpots.length < bankCount && guard < 2000; guard++) {
    const t = at(3 + Math.floor(rng() * Math.max(1, size - 6)), 3 + Math.floor(rng() * Math.max(1, size - 6)));
    if (bankFits(t)) stampBank(t);
  }
  // Completion pass: a dense board must still place the banks that were asked for.
  for (let guard = 0; bankSpots.length < bankCount && guard < tiles * 4; guard++) {
    const t = anyTile();
    if (bankFits(t)) stampBank(t);
  }

  // ── 4. Mountain massifs: the tallest terrain claims its ground before anything else.
  paintBlobs(
    mountainTarget,
    (t): t is Tile => paintTarget(t) && t.type !== 'MOUNTAIN',
    t => {
      t.type = 'MOUNTAIN';
      t.height = 2;
    },
    () => 3 + Math.floor(rng() * 9),
    0.78,
  );

  // ── 5. Forest groves: canopies over grass, sand or dunes, never over rock.
  paintBlobs(
    forestTarget,
    (t): t is Tile => paintTarget(t) && (t.type === 'PLAINS' || t.type === 'SAND' || t.type === 'DUNES'),
    t => {
      t.type = 'FOREST';
      t.height = 1;
    },
    () => 2 + Math.floor(rng() * 6),
    0.6,
  );

  // ── 6. Buildings: watchtowers (fire platforms) and bunkers (cover). Buildings take open ground
  //        only — canopies stay intact, and the desert pass still sees the grass it was promised.
  paintBlobs(
    buildingTarget,
    (t): t is Tile =>
      !!t && !inBasePlaza(t) && (t.type === 'PLAINS' || t.type === 'SAND' || t.type === 'DUNES'),
    t => {
      t.type = 'BUILDING';
      t.subType = rng() < 0.62 ? 'WATCHTOWER' : 'BUNKER';
      t.height = 1;
    },
    () => 1,
  );

  // ── 7. Desert: rank the leftover grass by noise and take exactly the requested share, so the
  //        coast between grass and sand follows a noise contour instead of a staircase.
  if (desertTarget > 0) {
    const grass = map.filter(t => t.type === 'PLAINS' && !inBasePlaza(t));
    grass.sort((a, b) => noise(a.x * 0.24, a.y * 0.24) - noise(b.x * 0.24, b.y * 0.24));
    for (const t of grass.slice(0, Math.min(desertTarget, grass.length))) {
      t.type = 'SAND';
      t.height = 1;
      // A thin dune belt with a slightly higher noise value gives the desert relief.
      if (noise(t.x * 0.4 + 40, t.y * 0.4 + 40) < 0.12) {
        t.type = 'DUNES';
        t.height = 2;
      }
    }
  }

  // ── 8. HQs: the plazas were reserved from the first pass, so this clears & stamps every HQ.
  slots.forEach((slot, owner) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = at(slot.x + dx, slot.y + dy);
        if (!t || t.type === 'BASE' || t.type === 'BANK') continue;
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

  // ── 9. Edge-aware bridge placement + orthogonal HQ/Bank connectivity guarantee.
  if (hasWater) {
    const anchors = [
      ...slots,
      ...map.filter(t => t.type === 'BANK').map(t => ({ x: t.x, y: t.y })),
    ];
    const islands = waterStyle === 'ISLANDS';
    placeEdgeAwareBridges(map, size, {
      // A wide river needs a longer deck than a narrow one, or its crossings silently disappear.
      // Island boards keep the shipped 5-tile strait deck and bridge count.
      maxSpan: islands ? 5 : Math.max(6, Math.ceil((channel?.width ?? 1) + 1)),
      minSpacing: 4,
      ...(islands ? { targetBridges: Math.max(players * 2 + 1, Math.round(size * 0.34)) } : {}),
      anchors,
      allowCarveObstacles: true,
      rng,
    });
  }

  // ── 10. Loose supply loot on walkable ground that isn't already a structure.
  paintBlobs(
    lootTarget,
    (t): t is Tile => paintTarget(t) && !t.loot,
    t => {
      t.loot = pick(LOOT_TYPES);
    },
    () => 1,
  );

  return { map, size, report: devMapReport(map, size, opts) };
};

/** Turns a generated board into the per-tile counts the sandbox shows in its summary. */
export const summarizeDevMap = (map: Tile[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const t of map) out[t.type] = (out[t.type] ?? 0) + 1;
  return out;
};

/**
 * Compares what the knobs asked for with what the board actually contains.
 *
 * This is the generator's fidelity check: `forestPct: 30` should read back as ~30%, and a knob at
 * zero must read back as zero. Rivers legitimately carve through terrain (they are painted last
 * before the HQs), so a river-heavy board can fall out of tolerance on purpose.
 */
export const devMapReport = (
  map: Tile[],
  size: number,
  options: Partial<DevMapOptions> = {},
): DevMapReport => {
  const opts: DevMapOptions = { ...DEFAULT_DEV_MAP_OPTIONS, ...options };
  const tiles = map.length || size * size;
  const share = (n: number): number => Math.round((n / Math.max(1, tiles)) * 100);
  const count = (pred: (t: Tile) => boolean): number => map.filter(pred).length;

  // Island boards flood a sea share instead of the knob number, so report the share the knob maps
  // to; comparing it against the raw 0–30 value would flag a working archipelago as broken.
  const waterRequested =
    opts.waterStyle === 'ISLANDS' && clampInt(opts.rivers, 0, 3) > 0 && clampInt(opts.waterPct, 0, 30) > 0
      ? Math.round(archipelagoSeaShare(clampInt(opts.waterPct, 0, 30)) * 100)
      : clampInt(opts.waterPct, 0, 30);

  const requested: DevMapCoverage = {
    forestPct: clampInt(opts.forestPct, 0, 55),
    mountainPct: clampInt(opts.mountainPct, 0, 40),
    waterPct: waterRequested,
    desertPct: clampInt(opts.desertPct, 0, 100),
    buildingPct: clampInt(opts.buildingPct, 0, 15),
    lootPct: clampInt(opts.lootPct, 0, 40),
    banks: clampInt(opts.banks, 0, 4),
    rivers: clampInt(opts.rivers, 0, 3),
  };
  const realized: DevMapCoverage = {
    forestPct: share(count(t => t.type === 'FOREST')),
    mountainPct: share(count(t => t.type === 'MOUNTAIN')),
    waterPct: share(count(t => t.type === 'WATER' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V')),
    desertPct: share(count(t => t.type === 'SAND' || t.type === 'DUNES')),
    buildingPct: share(count(t => t.type === 'BUILDING')),
    lootPct: share(count(t => !!t.loot)),
    banks: count(t => t.type === 'BANK'),
    rivers: requested.rivers,
  };

  const within = (a: number, b: number, tolerance: number): boolean => Math.abs(a - b) <= tolerance;
  const faithful =
    within(realized.forestPct, requested.forestPct, DEV_MAP_TOLERANCE.forestPct) &&
    within(realized.mountainPct, requested.mountainPct, DEV_MAP_TOLERANCE.mountainPct) &&
    within(realized.desertPct, requested.desertPct, DEV_MAP_TOLERANCE.desertPct) &&
    within(realized.buildingPct, requested.buildingPct, DEV_MAP_TOLERANCE.buildingPct) &&
    within(realized.lootPct, requested.lootPct, DEV_MAP_TOLERANCE.lootPct) &&
    within(realized.waterPct, requested.waterPct, DEV_MAP_TOLERANCE.waterPct) &&
    realized.banks === requested.banks;

  return { tiles, requested, realized, faithful };
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
