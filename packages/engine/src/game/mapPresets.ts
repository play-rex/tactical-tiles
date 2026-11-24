/**
 * Unified player-facing map presets, shareable recipe codes, and configured map generator.
 *
 * Keeps `classic` 100% delegated to `generateDynamicMap` for backwards compatibility while
 * bringing curated terrain styles (Balanced, Lush Valley, Archipelago, Badlands, Fortress,
 * Twin Fronts, Timber Ridge, Open Blitz) and full Advanced customization to both Local Setup
 * and Online Lobbies — with edge-aware bridges and optional 180° competitive symmetry.
 */
import { BANK_STATS, BASE_STATS } from '../constants/Config';
import {
  isChannelTerrain,
  isFootPassable,
  placeEdgeAwareBridges,
} from '../grid/BridgePlacement';
import { carveArchipelago } from './islandArchipelago';
import { channelWidthStepper, planRiverChannel } from './riverChannel';
import type {
  GridSizeOption,
  MapGenConfig,
  MapGenKnobs,
  MapPresetId,
  MapSymmetry,
  SupplyLootType,
  Tile,
  WaterStyle,
} from '../types';
import { createSeededRng, generateSectorSeed, normalizeSeed } from '../utils/SeededRandom';
import { devBaseSlots } from './devMap';

export interface MapPresetMeta {
  id: Exclude<MapPresetId, 'custom'>;
  /** Short prefix used in shareable recipe codes (e.g. ARCH-K7M9P2). */
  code: string;
  label: string;
  icon: string;
  tagline: string;
  knobs: MapGenKnobs;
}

export const DEFAULT_MAP_GEN_KNOBS: MapGenKnobs = {
  gridSize: 'AUTO',
  waterStyle: 'RIVERS',
  rivers: 1,
  waterPct: 10,
  forestPct: 18,
  mountainPct: 12,
  desertPct: 0,
  buildingPct: 4,
  lootPct: 0,
  banks: 2,
  roads: true,
  symmetry: 'ORGANIC',
};

export const DEFAULT_MAP_GEN_CONFIG: MapGenConfig = {
  preset: 'classic',
};

export const MAP_GEN_PRESETS: readonly MapPresetMeta[] = [
  {
    id: 'classic',
    code: 'CLS',
    label: 'Classic Mix',
    icon: '🎲',
    tagline: 'Signature 4-archetype randomizer',
    knobs: { ...DEFAULT_MAP_GEN_KNOBS },
  },
  {
    id: 'balanced',
    code: 'BAL',
    label: 'Balanced',
    icon: '⚖️',
    tagline: 'All-around competitive skirmish',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'RIVERS',
      rivers: 1,
      waterPct: 10,
      forestPct: 18,
      mountainPct: 12,
      desertPct: 0,
      buildingPct: 4,
      lootPct: 0,
      banks: 2,
      roads: true,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'lush_valley',
    code: 'LUSH',
    label: 'Lush Valley',
    icon: '🌲',
    tagline: 'Dense groves & 1–3 gentle rivers',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'RIVERS',
      rivers: 1,
      waterPct: 12,
      forestPct: 38,
      mountainPct: 14,
      desertPct: 0,
      buildingPct: 3,
      lootPct: 0,
      banks: 2,
      roads: true,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'archipelago',
    code: 'ARCH',
    label: 'Archipelago',
    icon: '🏝️',
    tagline: 'Island chains & bridge straits',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'ISLANDS',
      rivers: 3,
      waterPct: 26,
      forestPct: 16,
      mountainPct: 8,
      desertPct: 0,
      buildingPct: 3,
      lootPct: 0,
      banks: 2,
      roads: false,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'badlands',
    code: 'BAD',
    label: 'Badlands',
    icon: '🏜️',
    tagline: 'Dunes, mesas & quicksand traps',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'NONE',
      rivers: 0,
      waterPct: 0,
      forestPct: 4,
      mountainPct: 20,
      desertPct: 85,
      buildingPct: 5,
      lootPct: 0,
      banks: 2,
      roads: false,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'fortress',
    code: 'FORT',
    label: 'Fortress',
    icon: '🏰',
    tagline: 'Mountain passes & strongholds',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'RIVERS',
      rivers: 1,
      waterPct: 8,
      forestPct: 10,
      mountainPct: 28,
      desertPct: 0,
      buildingPct: 10,
      lootPct: 0,
      banks: 1,
      roads: true,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'twin_fronts',
    code: 'TWIN',
    label: 'Twin Fronts',
    icon: '⚔️',
    tagline: 'Green meadow vs desert frontier',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'RIVERS',
      rivers: 1,
      waterPct: 12,
      forestPct: 20,
      mountainPct: 12,
      desertPct: 50,
      buildingPct: 4,
      lootPct: 0,
      banks: 2,
      roads: true,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'timber_ridge',
    code: 'WOOD',
    label: 'Timber Ridge',
    icon: '🌳',
    tagline: 'No rivers · ~35% woods & ~16% peaks',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'NONE',
      rivers: 0,
      waterPct: 0,
      forestPct: 35,
      mountainPct: 16,
      desertPct: 0,
      buildingPct: 4,
      lootPct: 0,
      banks: 2,
      roads: false,
      symmetry: 'ORGANIC',
    },
  },
  {
    id: 'open_blitz',
    code: 'OPEN',
    label: 'Open Blitz',
    icon: '⚡',
    tagline: 'Fast open lanes, rapid clash',
    knobs: {
      gridSize: 'AUTO',
      waterStyle: 'NONE',
      rivers: 0,
      waterPct: 0,
      forestPct: 6,
      mountainPct: 4,
      desertPct: 10,
      buildingPct: 2,
      lootPct: 0,
      banks: 2,
      roads: true,
      symmetry: 'ORGANIC',
    },
  },
];

export const MAP_PRESET_BY_ID: Record<Exclude<MapPresetId, 'custom'>, MapPresetMeta> =
  Object.fromEntries(MAP_GEN_PRESETS.map(p => [p.id, p])) as Record<
    Exclude<MapPresetId, 'custom'>,
    MapPresetMeta
  >;

export const GRID_SIZE_OPTIONS: readonly GridSizeOption[] = ['AUTO', 16, 20, 25, 30];
export const WATER_STYLE_OPTIONS: readonly WaterStyle[] = ['RIVERS', 'ISLANDS', 'CANYON', 'NONE'];
export const MAP_SYMMETRY_OPTIONS: readonly MapSymmetry[] = ['ORGANIC', 'MIRRORED'];

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));

/** Smallest board edge length that comfortably holds `playerCount` HQ plazas without overlap. */
export const minGridSizeForPlayers = (playerCount: number): 16 | 20 | 25 =>
  playerCount >= 5 ? 25 : playerCount >= 4 ? 20 : 16;

/** Resolves `'AUTO'` or a manual size choice into a legal board edge length for `playerCount`. */
export const resolveEffectiveGridSize = (
  gridSize: GridSizeOption | undefined,
  playerCount: number,
): number => {
  if (!gridSize || gridSize === 'AUTO') {
    if (playerCount >= 6) return 30;
    if (playerCount >= 4) return 25;
    return 20;
  }
  const floor = minGridSizeForPlayers(playerCount);
  const valid: number = gridSize === 16 || gridSize === 20 || gridSize === 25 || gridSize === 30 ? gridSize : 20;
  return Math.max(floor, Math.min(30, valid));
};

/** Clamps and fills any partial knobs against the active preset's defaults. */
export const resolveMapGenKnobs = (config?: MapGenConfig): MapGenKnobs => {
  const baseId: Exclude<MapPresetId, 'custom'> =
    config?.preset && config.preset !== 'custom' && config.preset in MAP_PRESET_BY_ID
      ? config.preset
      : 'balanced';
  const base = MAP_PRESET_BY_ID[baseId].knobs;
  const k = config?.knobs ?? {};
  const waterStyle: WaterStyle =
    k.waterStyle && WATER_STYLE_OPTIONS.includes(k.waterStyle) ? k.waterStyle : base.waterStyle;
  const gridSize: GridSizeOption =
    k.gridSize && GRID_SIZE_OPTIONS.includes(k.gridSize) ? k.gridSize : base.gridSize;
  const symmetry: MapSymmetry =
    k.symmetry && MAP_SYMMETRY_OPTIONS.includes(k.symmetry) ? k.symmetry : base.symmetry;

  return {
    gridSize,
    waterStyle,
    rivers: clampInt(k.rivers ?? base.rivers, 0, 3),
    waterPct: clampInt(k.waterPct ?? base.waterPct, 0, 30),
    forestPct: clampInt(k.forestPct ?? base.forestPct, 0, 55),
    mountainPct: clampInt(k.mountainPct ?? base.mountainPct, 0, 40),
    desertPct: clampInt(k.desertPct ?? base.desertPct, 0, 100),
    buildingPct: clampInt(k.buildingPct ?? base.buildingPct, 0, 15),
    lootPct: clampInt(k.lootPct ?? base.lootPct, 0, 40),
    banks: clampInt(k.banks ?? base.banks, 0, 4),
    roads: k.roads ?? base.roads,
    symmetry,
  };
};

/** True when `config` should delegate directly to the untouched classic `generateDynamicMap`. */
export const isClassicDynamicConfig = (config?: MapGenConfig): boolean => {
  if (!config) return true;
  if (config.staticMapId) return false;
  if (config.preset !== 'classic') return false;
  return !config.knobs || Object.keys(config.knobs).length === 0;
};

/** Canonical equality helper for MapGenConfig (used by React memos, Zustand, and TableRoom). */
export const isSameMapGen = (a?: MapGenConfig, b?: MapGenConfig): boolean => {
  if (a === b) return true;
  const norm = (c?: MapGenConfig) => {
    if (!c || isClassicDynamicConfig(c)) return 'classic';
    if (c.staticMapId) return `static:${c.staticMapId}`;
    const k = resolveMapGenKnobs(c);
    return `${c.preset}:${k.gridSize}:${k.waterStyle}:${k.rivers}:${k.waterPct}:${k.forestPct}:${k.mountainPct}:${k.desertPct}:${k.buildingPct}:${k.lootPct}:${k.banks}:${k.roads ? 1 : 0}:${k.symmetry}`;
  };
  return norm(a) === norm(b);
};

/** Checks if `knobs` match a named preset exactly (returns that preset id or `'custom'`). */
export const detectMatchingPreset = (knobs: MapGenKnobs): MapPresetId => {
  for (const p of MAP_GEN_PRESETS) {
    if (p.id === 'classic') continue;
    const pk = p.knobs;
    if (
      pk.gridSize === knobs.gridSize &&
      pk.waterStyle === knobs.waterStyle &&
      pk.rivers === knobs.rivers &&
      pk.waterPct === knobs.waterPct &&
      pk.forestPct === knobs.forestPct &&
      pk.mountainPct === knobs.mountainPct &&
      pk.desertPct === knobs.desertPct &&
      pk.buildingPct === knobs.buildingPct &&
      pk.lootPct === knobs.lootPct &&
      pk.banks === knobs.banks &&
      pk.roads === knobs.roads &&
      pk.symmetry === knobs.symmetry
    ) {
      return p.id;
    }
  }
  return 'custom';
};

/** Generates a fun, playable wildcard set of custom knobs ("Mix It Up" button). */
export const rollWildcardKnobs = (rng: () => number = Math.random): MapGenKnobs => {
  const styles: WaterStyle[] = ['RIVERS', 'RIVERS', 'ISLANDS', 'CANYON', 'NONE'];
  const waterStyle = styles[Math.floor(rng() * styles.length)];
  const isDry = waterStyle === 'NONE';
  const rivers = isDry ? 0 : waterStyle === 'ISLANDS' ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 3);
  const waterPct = isDry
    ? 0
    : waterStyle === 'ISLANDS'
      ? 20 + Math.floor(rng() * 11)
      : 8 + Math.floor(rng() * 15);
  const desertRoll = rng();
  const desertPct =
    waterStyle === 'CANYON'
      ? 70 + Math.floor(rng() * 31)
      : desertRoll < 0.45
        ? 0
        : desertRoll < 0.72
          ? 40 + Math.floor(rng() * 25)
          : 75 + Math.floor(rng() * 26);

  return {
    gridSize: 'AUTO',
    waterStyle,
    rivers,
    waterPct,
    forestPct: desertPct >= 75 ? Math.floor(rng() * 10) : 10 + Math.floor(rng() * 34),
    mountainPct: 6 + Math.floor(rng() * 24),
    desertPct,
    buildingPct: 2 + Math.floor(rng() * 8),
    lootPct: 0,
    banks: 1 + Math.floor(rng() * 3),
    roads: waterStyle !== 'ISLANDS' && rng() < 0.75,
    symmetry: rng() < 0.35 ? 'MIRRORED' : 'ORGANIC',
  };
};

// ── Shareable Map Recipe Codes ───────────────────────────────────

const PRESET_BY_CODE = new Map<string, Exclude<MapPresetId, 'custom'>>(
  MAP_GEN_PRESETS.map(p => [p.code, p.id]),
);

const packKnobs = (k: MapGenKnobs): string => {
  const gsIdx = Math.max(0, GRID_SIZE_OPTIONS.indexOf(k.gridSize));
  const wsIdx = Math.max(0, WATER_STYLE_OPTIONS.indexOf(k.waterStyle));
  const symBit = k.symmetry === 'MIRRORED' ? 1 : 0;
  const roadBit = k.roads ? 1 : 0;
  // Pack into a deterministic integer vector encoded in compact base36 pairs
  const parts = [
    (gsIdx * 4 + wsIdx).toString(36),
    (k.rivers * 4 + symBit * 2 + roadBit).toString(36),
    k.waterPct.toString(36).padStart(2, '0'),
    k.forestPct.toString(36).padStart(2, '0'),
    k.mountainPct.toString(36).padStart(2, '0'),
    k.desertPct.toString(36).padStart(2, '0'),
    k.buildingPct.toString(36),
    k.lootPct.toString(36).padStart(2, '0'),
    k.banks.toString(36),
  ];
  return parts.join('').toUpperCase();
};

const unpackKnobs = (raw: string): MapGenKnobs | null => {
  if (raw.length !== 14) return null;
  const vals = [
    parseInt(raw.slice(0, 1), 36),
    parseInt(raw.slice(1, 2), 36),
    parseInt(raw.slice(2, 4), 36),
    parseInt(raw.slice(4, 6), 36),
    parseInt(raw.slice(6, 8), 36),
    parseInt(raw.slice(8, 10), 36),
    parseInt(raw.slice(10, 11), 36),
    parseInt(raw.slice(11, 13), 36),
    parseInt(raw.slice(13, 14), 36),
  ];
  if (vals.some(v => !Number.isFinite(v) || v < 0)) return null;
  const [gsws, rsr, waterPct, forestPct, mountainPct, desertPct, buildingPct, lootPct, banks] = vals;
  const gsIdx = Math.floor(gsws / 4);
  const wsIdx = gsws % 4;
  const rivers = Math.floor(rsr / 4);
  const symBit = Math.floor((rsr % 4) / 2);
  const roadBit = rsr % 2;
  if (gsIdx >= GRID_SIZE_OPTIONS.length || wsIdx >= WATER_STYLE_OPTIONS.length) return null;
  return resolveMapGenKnobs({
    preset: 'custom',
    knobs: {
      gridSize: GRID_SIZE_OPTIONS[gsIdx],
      waterStyle: WATER_STYLE_OPTIONS[wsIdx],
      rivers,
      waterPct,
      forestPct,
      mountainPct,
      desertPct,
      buildingPct,
      lootPct,
      banks,
      roads: roadBit === 1,
      symmetry: symBit === 1 ? 'MIRRORED' : 'ORGANIC',
    },
  });
};

/** Encodes a seed + MapGenConfig into a compact shareable code (e.g. `ARCH-K7M9P2`). */
export const encodeMapCode = (seed: string, mapGen?: MapGenConfig): string => {
  const cleanSeed = normalizeSeed(seed) || generateSectorSeed();
  if (!mapGen || isClassicDynamicConfig(mapGen)) return `CLS-${cleanSeed}`;
  if (mapGen.staticMapId) return `MAP-${mapGen.staticMapId.toUpperCase()}`;
  const resolved = resolveMapGenKnobs(mapGen);
  const exactPreset = detectMatchingPreset(resolved);
  if (exactPreset !== 'custom' && exactPreset === mapGen.preset) {
    return `${MAP_PRESET_BY_ID[exactPreset].code}-${cleanSeed}`;
  }
  return `CST-${cleanSeed}-${packKnobs(resolved)}`;
};

export interface DecodedMapCode {
  seed?: string;
  mapGen?: MapGenConfig;
}

/** Parses either a plain sector seed (`K7M9P2`) or a full map recipe code (`ARCH-K7M9P2`, `CST-...`). */
export const decodeMapCode = (raw: string): DecodedMapCode | null => {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;
  const parts = trimmed.split('-').filter(Boolean);
  if (parts.length === 1) {
    const seed = normalizeSeed(parts[0]);
    return seed ? { seed } : null;
  }
  const [prefix, seedPart, specPart] = parts;
  if (prefix === 'MAP' && seedPart) {
    const staticId = seedPart.toLowerCase();
    if (staticId === 'campaign_recon' || staticId === 'campaign_canyon' || staticId === 'campaign_delta') {
      return { mapGen: { preset: 'classic', staticMapId: staticId } };
    }
    return null;
  }
  if (prefix === 'CST' && seedPart && specPart) {
    const seed = normalizeSeed(seedPart);
    const knobs = unpackKnobs(specPart);
    if (!seed || !knobs) return null;
    return { seed, mapGen: { preset: 'custom', knobs } };
  }
  const presetId = PRESET_BY_CODE.get(prefix);
  if (presetId && seedPart) {
    const seed = normalizeSeed(seedPart);
    if (!seed) return null;
    return { seed, mapGen: { preset: presetId } };
  }
  const fallbackSeed = normalizeSeed(trimmed);
  return fallbackSeed ? { seed: fallbackSeed } : null;
};

// ── Configured High-Craft Procedural Generator ───────────────────

const LOOT_TYPES: readonly SupplyLootType[] = ['AMMO', 'MEDKIT', 'FIRST_AID'];
const DIRS_4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIRS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

const makeValueNoise = (seedText: string) => {
  let salt = 0;
  for (let i = 0; i < seedText.length; i++) salt = (salt * 31 + seedText.charCodeAt(i)) % 100000;
  const hash = (x: number, y: number): number => {
    const h = Math.sin(x * 127.1 + y * 311.7 + salt * 0.017) * 43758.5453;
    return h - Math.floor(h);
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const sample = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c + (d - c) * xf - (a + (b - a) * xf)) * yf;
  };
  return (x: number, y: number): number =>
    sample(x, y) * 0.62 + sample(x * 2.05 + 17.3, y * 2.05 - 9.1) * 0.38;
};

/**
 * Places exactly 1 starting supply crate per player (2 for 2P, 4 for 4P, etc.) at equal
 * Manhattan distance from each player's HQ with the same opening item type (`AMMO` or `FIRST_AID`).
 * Supports exact 180° symmetry in mirrored 2P/4P matches.
 */
export const placeFairStartingLoot = (
  map: Tile[],
  size: number,
  baseLocations: ReadonlyArray<{ x: number; y: number; owner: number }>,
  rng: () => number,
  mirrored = false,
): Tile[] => {
  if (baseLocations.length === 0) return [];
  const at = (x: number, y: number): Tile | null =>
    x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const center = (size - 1) / 2;

  // Reachability BFS from HQ 0 so crates never spawn on isolated slivers
  const reachable = new Set<string>();
  const queue: Tile[] = [];
  for (const [dx, dy] of DIRS_4) {
    const nb = at(baseLocations[0].x + dx, baseLocations[0].y + dy);
    if (nb && isFootPassable(nb)) {
      reachable.add(nb.id);
      queue.push(nb);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const [dx, dy] of DIRS_4) {
      const nb = at(cur.x + dx, cur.y + dy);
      if (!nb || reachable.has(nb.id) || !isFootPassable(nb)) continue;
      reachable.add(nb.id);
      queue.push(nb);
    }
  }

  const isEligible = (t: Tile | null): t is Tile =>
    !!t &&
    (t.type === 'PLAINS' || t.type === 'SAND' || t.type === 'FOREST' || t.type === 'ROAD' || t.type === 'ROAD_H') &&
    !t.loot &&
    reachable.has(t.id) &&
    baseLocations.every(b => Math.abs(t.x - b.x) > 2 || Math.abs(t.y - b.y) > 2);

  // Shared opening crate item so no side gets an unfair RNG advantage on Turn 1
  const sharedItem: SupplyLootType = rng() < 0.55 ? 'AMMO' : 'FIRST_AID';
  const idealDist = Math.max(4, Math.round(size * 0.30));
  const placed: Tile[] = [];

  // Partition eligible tiles by closest HQ (Voronoi sector)
  const sectorMap = new Map<number, Tile[]>();
  for (const b of baseLocations) sectorMap.set(b.owner, []);
  for (const t of map) {
    if (!isEligible(t)) continue;
    let closestOwner = baseLocations[0].owner;
    let minD = Infinity;
    for (const b of baseLocations) {
      const d = dist(t, b);
      if (d < minD) {
        minD = d;
        closestOwner = b.owner;
      }
    }
    sectorMap.get(closestOwner)?.push(t);
  }

  const canMirror = mirrored && (baseLocations.length === 2 || baseLocations.length === 4);
  if (canMirror) {
    const pairs: Array<[number, number]> = baseLocations.length === 2 ? [[0, 1]] : [[0, 1], [2, 3]];
    for (const [aIdx, bIdx] of pairs) {
      const baseA = baseLocations[aIdx];
      const baseB = baseLocations[bIdx];
      if (!baseA || !baseB) continue;
      const bucket = sectorMap.get(baseA.owner) ?? [];
      const best = bucket
        .filter(t => {
          if (!isEligible(t)) return false;
          const mt = at(size - 1 - t.x, size - 1 - t.y);
          if (!isEligible(mt) || mt.id === t.id) return false;
          return dist(t, baseA) === dist(mt, baseB) && placed.every(p => dist(t, p) >= 3 && dist(mt, p) >= 3);
        })
        .map(t => ({
          t,
          score:
            -Math.abs(dist(t, baseA) - idealDist) * 3.0 -
            Math.hypot(t.x - center, t.y - center) * 0.25 +
            (t.type === 'PLAINS' || t.type === 'SAND' ? 1.0 : 0) +
            rng() * 0.6,
        }))
        .sort((a, b) => b.score - a.score)[0];

      if (best) {
        const mt = at(size - 1 - best.t.x, size - 1 - best.t.y)!;
        best.t.loot = sharedItem;
        mt.loot = sharedItem;
        placed.push(best.t, mt);
      }
    }
    if (placed.length === baseLocations.length) return placed;
  }

  // Organic equal-distance selection: search outward from idealDist for an exact shared Manhattan distance
  const distOrder: number[] = [idealDist];
  for (let delta = 1; delta < size; delta++) {
    if (idealDist - delta >= 3) distOrder.push(idealDist - delta);
    if (idealDist + delta <= size - 2) distOrder.push(idealDist + delta);
  }

  let sharedDist: number | null = null;
  for (const d of distOrder) {
    const allHave = baseLocations.every(b =>
      (sectorMap.get(b.owner) ?? []).some(t => isEligible(t) && dist(t, b) === d),
    );
    if (allHave) {
      sharedDist = d;
      break;
    }
  }

  for (const b of baseLocations) {
    // Skip seats already filled by partial mirror pass
    if (placed.some(p => {
      let closestOwner = baseLocations[0].owner;
      let minD = Infinity;
      for (const other of baseLocations) {
        const d = dist(p, other);
        if (d < minD) { minD = d; closestOwner = other.owner; }
      }
      return closestOwner === b.owner;
    })) {
      continue;
    }
    const bucket = (sectorMap.get(b.owner) ?? []).filter(isEligible);
    const pool = sharedDist !== null ? bucket.filter(t => dist(t, b) === sharedDist) : bucket;
    const candidates = (pool.length > 0 ? pool : bucket)
      .map(t => ({
        t,
        score:
          -Math.abs(dist(t, b) - (sharedDist ?? idealDist)) * 3.0 -
          Math.hypot(t.x - center, t.y - center) * 0.25 +
          (t.type === 'PLAINS' || t.type === 'SAND' ? 1.0 : 0) +
          (placed.some(p => dist(t, p) < 3) ? -10 : 0) +
          rng() * 0.6,
      }))
      .sort((a, b) => b.score - a.score);
    if (candidates[0]) {
      candidates[0].t.loot = sharedItem;
      placed.push(candidates[0].t);
    }
  }

  return placed;
};

/**
 * Generates a high-craft playable battlefield honoring `config` (preset + optional knob overrides).
 * Supports organic rivers, true multi-island Archipelagos, desert canyon viaducts, tactical roads,
 * sector-fair Banks/Outposts, and optional 180° rotational mirror symmetry for 2P/4P PvP.
 */
export const generateConfiguredMap = (
  playerCount: number,
  seedInput: string,
  config: MapGenConfig,
): { map: Tile[]; size: number; baseLocations: { x: number; y: number; owner: number }[] } => {
  const players = clampInt(playerCount, 2, 6);
  const knobs = resolveMapGenKnobs(config);
  const size = resolveEffectiveGridSize(knobs.gridSize, players);
  const seed = normalizeSeed(seedInput) || generateSectorSeed();
  const rng = createSeededRng(`${seed}_cfg_${config.preset}_${size}_${players}`);
  const noise = makeValueNoise(`${seed}_${config.preset}`);
  const mirrored = knobs.symmetry === 'MIRRORED' && (players === 2 || players === 4);
  const totalTiles = size * size;
  const center = (size - 1) / 2;

  const map: Tile[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      map.push({ id: `${x},${y}`, x, y, type: 'PLAINS', height: 1, loot: null, hazardState: 'SAFE' });
    }
  }

  const at = (x: number, y: number): Tile | null =>
    x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null;
  const mirrorOf = (t: Tile): Tile => map[(size - 1 - t.y) * size + (size - 1 - t.x)];
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const shuffle = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // ── 1. Place HQ slots symmetrically (exact 180° mirror pairs for 2P & 4P)
  const rawSlots = devBaseSlots(size, players);
  const flip2P = players === 2 && rng() < 0.5;
  const slots = flip2P
    ? [
        { x: size - 3, y: 2 },
        { x: 2, y: size - 3 },
      ]
    : rawSlots;
  const baseLocations = slots.map((s, owner) => ({ x: s.x, y: s.y, owner }));

  const inBasePlaza = (x: number, y: number, radius = 2): boolean =>
    slots.some(s => Math.abs(s.x - x) <= radius && Math.abs(s.y - y) <= radius);

  // ── 2. Base biome ground (PLAINS vs SAND)
  const desertTarget = Math.round((totalTiles * knobs.desertPct) / 100);
  const isSplitBiome = config.preset === 'twin_fronts' && !mirrored;
  // Align Twin Fronts split perpendicular to the 2P HQ diagonal so P1 starts in lush valley & P2 in golden frontier
  const splitAngle = players === 2 ? (flip2P ? (3 * Math.PI) / 4 : Math.PI / 4) : (rng() < 0.5 ? Math.PI / 4 : (3 * Math.PI) / 4);
  const splitPhase = rng() * Math.PI * 2;

  const groundScore = (x: number, y: number): number => {
    if (isSplitBiome) {
      const proj = (x - center) * Math.cos(splitAngle) + (y - center) * Math.sin(splitAngle);
      const wave = Math.sin(x * 0.32 - y * 0.28 + splitPhase) * 2.4;
      return proj + wave;
    }
    if (mirrored) {
      const mx = size - 1 - x;
      const my = size - 1 - y;
      return (noise(x * 0.22, y * 0.22) + noise(mx * 0.22, my * 0.22)) * 0.5;
    }
    return noise(x * 0.22, y * 0.22);
  };

  const sandMask = new Uint8Array(totalTiles);
  if (desertTarget > 0) {
    const order = map
      .map(t => ({ idx: t.y * size + t.x, score: groundScore(t.x, t.y) }))
      .sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(desertTarget, order.length); i++) {
      const idx = order[i].idx;
      sandMask[idx] = 1;
      if (mirrored) {
        const tx = idx % size;
        const ty = (idx - tx) / size;
        sandMask[(size - 1 - ty) * size + (size - 1 - tx)] = 1;
      }
    }
    for (let i = 0; i < totalTiles; i++) {
      if (sandMask[i]) map[i].type = 'SAND';
    }
  }

  const baseGroundAt = (x: number, y: number): 'PLAINS' | 'SAND' =>
    sandMask[y * size + x] ? 'SAND' : 'PLAINS';

  // ── 3. Waterways & Geography (RIVERS / CANYON / ISLANDS / NONE)
  const paintChannel = (x: number, y: number, channelType: 'WATER' | 'CANYON') => {
    const t = at(x, y);
    if (!t || inBasePlaza(t.x, t.y, 2)) return;
    t.type = channelType;
    t.height = 0;
    if (mirrored) {
      const mt = mirrorOf(t);
      if (!inBasePlaza(mt.x, mt.y, 2)) {
        mt.type = channelType;
        mt.height = 0;
      }
    }
  };

  const hasWaterway =
    knobs.waterStyle !== 'NONE' &&
    knobs.waterPct > 0 &&
    (knobs.waterStyle === 'ISLANDS' || knobs.rivers > 0);

  // Wide rivers get wider decks; set by the river carving below, read by bridge placement after it.
  let channelMaxSpan = 6;

  if (hasWaterway && (knobs.waterStyle === 'RIVERS' || knobs.waterStyle === 'CANYON')) {
    const channelType: 'WATER' | 'CANYON' = knobs.waterStyle === 'CANYON' ? 'CANYON' : 'WATER';
    // Lush Valley naturally varies across 1, 2, or 3 river variants per seed while keeping
    // total water volume light and playable (1 river = 2 tiles wide; 2–3 rivers = crisp 1-tile streams).
    const isLushVariant =
      config.preset === 'lush_valley' &&
      config.knobs?.rivers === undefined &&
      config.knobs?.waterPct === undefined;
    const riverCount = isLushVariant ? 1 + Math.floor(rng() * 3) : knobs.rivers;
    // Width comes from the water the knob asks for rather than from a bracket of its value, so 8%
    // and 9% differ by a few tiles instead of doubling the river. Lush Valley rolls its own 1- or
    // 2-tile variant per seed and keeps that shape.
    const channel = isLushVariant ? null : planRiverChannel(size, riverCount, knobs.waterPct);
    const width = channel ? channel.width : riverCount === 1 ? 2 : 1;
    /** Widest a step can paint — the band is centred and clamped on this, not on the average. */
    const boxWidth = Math.max(1, Math.ceil(width));
    channelMaxSpan = Math.max(6, boxWidth + 1);
    const wanderAmp = isLushVariant && riverCount >= 2 ? 0.52 : 0.42 + knobs.waterPct / 28;
    // Flip primary axis randomly so every seed feels fresh
    const primaryHorizontal = rng() < 0.5;
    // Pick diagonal slope sign dividing the 2P corner HQs cleanly (SW->NE when flip2P=false, NW->SE when flip2P=true)
    const diagSign = players === 2 ? (flip2P ? 1 : -1) : (rng() < 0.5 ? 1 : -1);
    const diagMag = 0.54 + rng() * 0.16; // ~28°–35° (or ~55°–62° when vertical), giving sweeping diagonals with clean bridge banks
    const diagChance =
      config.preset === 'twin_fronts'
        ? 0.72
        : config.preset === 'balanced'
          ? 0.58
          : isLushVariant
            ? (riverCount <= 2 ? 0.48 : 0.25)
            : 0.42;
    const useDiagonal = knobs.waterStyle === 'RIVERS' && rng() < diagChance;

    interface RiverSpec {
      horizontal: boolean;
      laneFrac: number;
      slope: number;
      halfOnly?: boolean;
    }

    // Distribute lanes evenly so 1–3 rivers (orthogonal OR sweeping diagonal) frame distinct valleys.
    // In mirrored mode, central lanes carve half-way (meeting at center) and off-center lanes
    // auto-produce their mirror twin so rivers never overlap onto double channels.
    const lanesFor = (count: number): RiverSpec[] => {
      if (count === 1) {
        return [{ horizontal: primaryHorizontal, laneFrac: 0.5, slope: useDiagonal ? diagSign * diagMag : 0, halfOnly: mirrored }];
      }
      if (count === 2) {
        if (useDiagonal) {
          return [
            { horizontal: primaryHorizontal, laneFrac: 0.5, slope: diagSign * diagMag, halfOnly: mirrored },
            { horizontal: !primaryHorizontal, laneFrac: 0.5, slope: -diagSign * diagMag, halfOnly: mirrored },
          ];
        }
        return [
          { horizontal: primaryHorizontal, laneFrac: 0.5, slope: 0, halfOnly: mirrored },
          { horizontal: !primaryHorizontal, laneFrac: 0.5, slope: 0, halfOnly: mirrored },
        ];
      }
      if (mirrored) {
        return [
          { horizontal: primaryHorizontal, laneFrac: 0.28, slope: 0, halfOnly: false },
          { horizontal: !primaryHorizontal, laneFrac: 0.5, slope: useDiagonal ? diagSign * diagMag : 0, halfOnly: true },
        ];
      }
      return [
        { horizontal: primaryHorizontal, laneFrac: 0.30, slope: 0 },
        { horizontal: !primaryHorizontal, laneFrac: 0.50, slope: useDiagonal ? diagSign * (diagMag * 0.85) : 0 },
        { horizontal: primaryHorizontal, laneFrac: 0.70, slope: 0 },
      ];
    };

    const specs = lanesFor(riverCount);
    for (const spec of specs) {
      const maxStep = spec.halfOnly ? Math.ceil(size / 2) : size;
      let wander = spec.halfOnly ? 0 : (rng() - 0.5) * 1.4;
      // Each channel averages its own width over its own run.
      const nextWidth = channel ? channelWidthStepper(channel) : () => width;
      const depthAt = (stepIdx: number, wOffset: number): number => {
        const rawCenter = (size - 1) * spec.laneFrac + (stepIdx - center) * spec.slope + wOffset;
        const d = Math.round(rawCenter - (boxWidth - 1) / 2);
        return Math.max(1, Math.min(size - 1 - boxWidth, d));
      };
      let prevDepth = depthAt(0, wander);
      for (let step = 0; step < maxStep; step++) {
        // Taper centered mirrored rivers gently back to the center axis near the midpoint
        if (spec.halfOnly && step >= maxStep - 2) {
          wander *= 0.35;
        } else {
          wander = Math.max(-2.2, Math.min(2.2, wander + (rng() - 0.5) * wanderAmp));
        }
        const depth = depthAt(step, wander);
        // Fill intermediate orthogonal step when depth shifts so rivers never pinch diagonally
        const lo = Math.min(prevDepth, depth);
        const hi = Math.max(prevDepth, depth);
        const runWidth = nextWidth();
        for (let d = lo; d <= hi; d++) {
          for (let w = 0; w < runWidth; w++) {
            const x = spec.horizontal ? step : d + w;
            const y = spec.horizontal ? d + w : step;
            paintChannel(x, y, channelType);
          }
        }
        prevDepth = depth;
      }
    }
  } else if (hasWaterway && knobs.waterStyle === 'ISLANDS') {
    // Organic Archipelago: the carve lives in `islandArchipelago` so the dev sandbox floods the
    // exact same island field instead of approximating islands with three river channels.
    carveArchipelago({
      map,
      size,
      slots,
      playerCount: players,
      rings: knobs.rivers,
      waterPct: knobs.waterPct,
      flip: flip2P,
      mirrored,
      noise,
      restoreGround: t => {
        t.type = baseGroundAt(t.x, t.y);
        t.height = 1;
      },
    });
  }

  // ── 4. Clear HQ aprons & stamp HQs early so bridge placement & mountains respect them
  slots.forEach((slot, owner) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const t = at(slot.x + dx, slot.y + dy);
        if (!t || t.type === 'BASE') continue;
        t.type = baseGroundAt(t.x, t.y);
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
  });

  // ── 5. Edge-Aware Bridge Placement across all WATER & CANYON channels
  const placedSpans = hasWaterway
    ? placeEdgeAwareBridges(map, size, {
        maxSpan: knobs.waterStyle === 'ISLANDS' ? 5 : channelMaxSpan,
        minSpacing: 4,
        targetBridges:
          knobs.waterStyle === 'ISLANDS'
            ? Math.max(players * 2 + 1, Math.round(size * 0.34))
            : Math.max(players * 2, Math.round(size * 0.25) + knobs.rivers),
        anchors: slots,
        groundTypeAt: baseGroundAt,
        allowCarveObstacles: true,
        mirror180: mirrored,
        rng,
      })
    : [];

  const isNearBridge = (x: number, y: number, rad = 1): boolean => {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > rad) continue;
        const nb = at(x + dx, y + dy);
        if (nb && (nb.type === 'BRIDGE' || nb.type === 'BRIDGE_V')) return true;
      }
    }
    return false;
  };

  // ── 6. Tactical Road Stubs extending outward from primary bridges
  if (knobs.roads && placedSpans.length > 0) {
    const roadCount = Math.min(placedSpans.length, players <= 2 ? 3 : 4);
    const paintStub = (sx: number, sy: number, dx: number, dy: number, len: number) => {
      const roadType = dx !== 0 ? 'ROAD_H' : 'ROAD';
      for (let step = 0; step < len; step++) {
        const t = at(sx + dx * step, sy + dy * step);
        if (!t) break;
        if (t.type !== 'PLAINS' && t.type !== 'SAND') break;
        if (inBasePlaza(t.x, t.y, 1)) break;
        t.type = roadType;
        t.height = 1;
        if (mirrored) {
          const mt = mirrorOf(t);
          if ((mt.type === 'PLAINS' || mt.type === 'SAND') && !inBasePlaza(mt.x, mt.y, 1)) {
            mt.type = roadType;
            mt.height = 1;
          }
        }
      }
    };
    for (let i = 0; i < roadCount; i++) {
      const span = placedSpans[i];
      const len = 2 + Math.floor(rng() * 2);
      if (span.bridgeType === 'BRIDGE') {
        paintStub(span.shoreA.x, span.shoreA.y, -1, 0, len);
        paintStub(span.shoreB.x, span.shoreB.y, 1, 0, len);
      } else {
        paintStub(span.shoreA.x, span.shoreA.y, 0, -1, len);
        paintStub(span.shoreB.x, span.shoreB.y, 0, 1, len);
      }
    }
  }

  const isOpenLand = (t: Tile | null): t is Tile =>
    !!t && (t.type === 'PLAINS' || t.type === 'SAND');

  // Helper to paint organic clusters (ridges/groves) while respecting symmetry and exact targets
  const paintOrganicTerrain = (
    targetCount: number,
    canUse: (t: Tile | null) => t is Tile,
    applyTile: (t: Tile) => void,
    walkRange: [number, number],
    axisBias: number,
  ) => {
    let painted = 0;
    const stamp = (t: Tile) => {
      applyTile(t);
      painted++;
      if (mirrored) {
        const mt = mirrorOf(t);
        if (mt.id !== t.id && canUse(mt)) {
          applyTile(mt);
          painted++;
        }
      }
    };

    for (let guard = 0; painted < targetCount && guard < 3000; guard++) {
      let cx = 1 + Math.floor(rng() * Math.max(1, size - 2));
      let cy = 1 + Math.floor(rng() * Math.max(1, size - 2));
      const steps = walkRange[0] + Math.floor(rng() * (walkRange[1] - walkRange[0] + 1));
      const preferX = rng() < 0.5;
      for (let s = 0; s < steps && painted < targetCount; s++) {
        const t = at(cx, cy);
        if (canUse(t) && (!mirrored || canUse(mirrorOf(t)) || mirrorOf(t).id === t.id)) {
          stamp(t);
        }
        const moveX = rng() < axisBias ? preferX : !preferX;
        if (moveX) cx += rng() < 0.5 ? 1 : -1;
        else cy += rng() < 0.5 ? 1 : -1;
        cx = Math.max(1, Math.min(size - 2, cx));
        cy = Math.max(1, Math.min(size - 2, cy));
      }
    }
    // Gentle completion pass for remaining eligible tiles
    for (let guard = 0; painted < targetCount && guard < totalTiles * 6; guard++) {
      const t = at(Math.floor(rng() * size), Math.floor(rng() * size));
      if (!canUse(t)) continue;
      if (mirrored && mirrorOf(t).id !== t.id && !canUse(mirrorOf(t))) continue;
      stamp(t);
    }
  };

  // Timber Ridge dry woodland/highland natural variants (~35% forest & ~16% mountain baseline)
  const isTimberVariant =
    config.preset === 'timber_ridge' &&
    config.knobs?.forestPct === undefined &&
    config.knobs?.mountainPct === undefined;
  const timberVariantIdx = isTimberVariant ? Math.floor(rng() * 3) : -1;
  const effectiveMountainPct =
    timberVariantIdx === 1 ? 13 : timberVariantIdx === 2 ? 20 : knobs.mountainPct;
  const effectiveForestPct =
    timberVariantIdx === 1 ? 41 : timberVariantIdx === 2 ? 30 : knobs.forestPct;

  // ── 7. Mountain Ranges (avoiding HQ plazas & bridge landing zones)
  const mountainTarget = Math.round((totalTiles * effectiveMountainPct) / 100);
  if (mountainTarget > 0) {
    paintOrganicTerrain(
      mountainTarget,
      (t): t is Tile => isOpenLand(t) && !inBasePlaza(t.x, t.y, 2) && !isNearBridge(t.x, t.y, 1),
      t => {
        t.type = 'MOUNTAIN';
        t.height = 2;
      },
      [3, 8],
      0.76,
    );
  }

  // ── 8. Desert Sculpted Dunes & Quicksand Traps on sand tiles
  if (knobs.desertPct >= 25) {
    const sandTiles = map.filter(
      t => t.type === 'SAND' && !inBasePlaza(t.x, t.y, 2) && !isNearBridge(t.x, t.y, 1),
    );
    shuffle(sandTiles);
    const duneTarget = Math.round(sandTiles.length * 0.11);
    const placedDunes: Tile[] = [];
    for (const st of sandTiles) {
      if (placedDunes.length >= duneTarget) break;
      if (st.type !== 'SAND') continue;
      if (placedDunes.some(d => dist(d, st) < 2)) continue;
      if (mirrored) {
        const mt = mirrorOf(st);
        if (mt.type !== 'SAND' || inBasePlaza(mt.x, mt.y, 2) || isNearBridge(mt.x, mt.y, 1)) continue;
        mt.type = 'DUNES';
        mt.height = 2;
        placedDunes.push(mt);
      }
      st.type = 'DUNES';
      st.height = 2;
      placedDunes.push(st);
    }

    if (knobs.desertPct >= 50) {
      const qsTarget = knobs.desertPct >= 80 ? 2 : 1;
      let qsPlaced = 0;
      for (const st of sandTiles) {
        if (qsPlaced >= qsTarget) break;
        if (st.type !== 'SAND') continue;
        if (st.x <= 2 || st.x >= size - 3 || st.y <= 2 || st.y >= size - 3) continue;
        if (mirrored) {
          const mt = mirrorOf(st);
          if (mt.type !== 'SAND' || mt.id === st.id) continue;
          mt.type = 'QUICKSAND';
          mt.height = 1;
          qsPlaced++;
        }
        st.type = 'QUICKSAND';
        st.height = 1;
        qsPlaced++;
      }
    }
  }

  // ── 9. Forest Groves & Specimen Trees
  const forestTarget = Math.round((totalTiles * effectiveForestPct) / 100);
  if (forestTarget > 0) {
    paintOrganicTerrain(
      forestTarget,
      (t): t is Tile => isOpenLand(t) && !inBasePlaza(t.x, t.y, 2) && !isNearBridge(t.x, t.y, 1),
      t => {
        t.type = 'FOREST';
        t.height = 1;
      },
      [2, 6],
      0.58,
    );
  }

  // Compute reachable land mask from HQ 0 so Banks & Buildings never spawn on unreachable slivers
  const reachableFromHq0 = (): Set<string> => {
    const seen = new Set<string>();
    const start = slots[0];
    const queue: Tile[] = [];
    for (const [dx, dy] of DIRS_4) {
      const nb = at(start.x + dx, start.y + dy);
      if (nb && isFootPassable(nb)) {
        seen.add(nb.id);
        queue.push(nb);
      }
    }
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      for (const [dx, dy] of DIRS_4) {
        const nb = at(cur.x + dx, cur.y + dy);
        if (!nb || seen.has(nb.id) || !isFootPassable(nb)) continue;
        seen.add(nb.id);
        queue.push(nb);
      }
    }
    return seen;
  };

  // Ensure all HQs are connected right after mountains (before placing banks/buildings)
  placeEdgeAwareBridges(map, size, {
    maxSpan: 6,
    minSpacing: 4,
    targetBridges: 0, // Pass 3 connectivity guarantee only — don't add extra bridges here
    anchors: slots,
    groundTypeAt: baseGroundAt,
    allowCarveObstacles: true,
    mirror180: mirrored,
    rng,
  });

  const reachableIds = reachableFromHq0();
  const isReachableAdjacent = (t: Tile): boolean =>
    DIRS_4.some(([dx, dy]) => {
      const nb = at(t.x + dx, t.y + dy);
      return !!nb && reachableIds.has(nb.id);
    });

  // ── 10. Sector-Fair / Mirrored Banks
  const bankList: Tile[] = [];
  const stampBank = (t: Tile) => {
    t.type = 'BANK';
    t.height = 1;
    t.owner = null;
    t.hp = BANK_STATS.HP;
    t.maxHp = BANK_STATS.HP;
    t.hackProgress = 0;
    t.loot = null;
    t.subType = undefined;
    bankList.push(t);
  };

  const bankCount = knobs.banks;
  const bankEligible = (t: Tile | null): t is Tile =>
    !!t &&
    (t.type === 'PLAINS' || t.type === 'SAND' || t.type === 'FOREST') &&
    !inBasePlaza(t.x, t.y, 2) &&
    !isNearBridge(t.x, t.y, 1) &&
    t.x >= 2 &&
    t.x <= size - 3 &&
    t.y >= 2 &&
    t.y <= size - 3 &&
    isReachableAdjacent(t) &&
    slots.every(s => dist(t, s) >= 5) &&
    bankList.every(b => dist(t, b) >= 4);

  if (bankCount > 0) {
    if (mirrored) {
      // On odd-sized boards, an odd bank count gets 1 exact dead-center vault first.
      const centerInt = Math.floor(size / 2);
      if (bankCount % 2 === 1 && size % 2 === 1) {
        const ct = at(centerInt, centerInt);
        if (ct && !isChannelTerrain(ct.type) && ct.type !== 'BASE' && isReachableAdjacent(ct)) {
          stampBank(ct);
        }
      }
      // Fill remaining banks in exact 180° symmetric pairs (even grids round 1 -> 2 for pure fairness)
      const targetMirroredBanks =
        size % 2 === 0 && bankCount % 2 === 1 ? Math.min(4, bankCount + 1) : bankCount;
      const candidates = map
        .filter(t => bankEligible(t) && t.y * size + t.x < (size - 1 - t.y) * size + (size - 1 - t.x))
        .map(t => ({
          t,
          score: -Math.abs(Math.hypot(t.x - center, t.y - center) - size * 0.24) + rng() * 1.6,
        }))
        .sort((a, b) => b.score - a.score);

      for (const { t } of candidates) {
        if (bankList.length >= targetMirroredBanks) break;
        const mt = mirrorOf(t);
        if (!bankEligible(t) || !bankEligible(mt) || dist(t, mt) < 4) continue;
        stampBank(t);
        stampBank(mt);
      }
    } else if (bankCount === 1) {
      // Contested central vault
      const best = map
        .filter(bankEligible)
        .sort((a, b) => Math.hypot(a.x - center, a.y - center) - Math.hypot(b.x - center, b.y - center))[0];
      if (best) stampBank(best);
    } else {
      // Distribute across Voronoi player sectors fairly
      const sectorBuckets: Tile[][] = Array.from({ length: players }, () => []);
      for (const t of map) {
        if (!bankEligible(t)) continue;
        let owner = 0;
        let bestD = Infinity;
        for (const b of baseLocations) {
          const d = dist(t, b);
          if (d < bestD) {
            bestD = d;
            owner = b.owner;
          }
        }
        sectorBuckets[owner].push(t);
      }
      const idealCenterD = size * 0.25;
      for (let round = 0; bankList.length < bankCount && round < 4; round++) {
        for (let p = 0; p < players && bankList.length < bankCount; p++) {
          const best = sectorBuckets[p]
            .filter(bankEligible)
            .map(t => ({
              t,
              score: -Math.abs(Math.hypot(t.x - center, t.y - center) - idealCenterD) + rng() * 1.4,
            }))
            .sort((a, b) => b.score - a.score)[0];
          if (best) stampBank(best.t);
        }
      }
    }
  }

  // ── 11. Tactical Buildings (Watchtowers overlooking crossings + Bunkers in mid-lanes)
  const buildingTarget = Math.round((totalTiles * knobs.buildingPct) / 100);
  if (buildingTarget > 0) {
    const placedBuildings: Tile[] = [];
    const bldEligible = (t: Tile | null): t is Tile =>
      isOpenLand(t) &&
      !inBasePlaza(t.x, t.y, 2) &&
      !isNearBridge(t.x, t.y, 1) &&
      isReachableAdjacent(t) &&
      bankList.every(b => dist(t, b) >= 2) &&
      placedBuildings.every(b => dist(t, b) >= 2);

    const currentBridges = map.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V');
    const ranked = map
      .filter(bldEligible)
      .map(t => {
        const bridgeD =
          currentBridges.length > 0
            ? Math.min(...currentBridges.map(b => dist(t, b)))
            : Math.round(Math.hypot(t.x - center, t.y - center));
        const edgePen = t.x <= 1 || t.x >= size - 2 || t.y <= 1 || t.y >= size - 2 ? -5 : 0;
        return { t, score: -bridgeD * 0.4 + edgePen + rng() * 3.0 };
      })
      .sort((a, b) => b.score - a.score);

    for (const { t } of ranked) {
      if (placedBuildings.length >= buildingTarget) break;
      if (!bldEligible(t)) continue;
      const sub: 'WATCHTOWER' | 'BUNKER' = placedBuildings.length % 2 === 0 ? 'WATCHTOWER' : 'BUNKER';
      if (mirrored) {
        const mt = mirrorOf(t);
        if (mt.id === t.id || !bldEligible(mt)) continue;
        t.type = 'BUILDING';
        t.subType = sub;
        t.height = 1;
        mt.type = 'BUILDING';
        mt.subType = sub;
        mt.height = 1;
        placedBuildings.push(t, mt);
      } else {
        t.type = 'BUILDING';
        t.subType = sub;
        t.height = 1;
        placedBuildings.push(t);
      }
    }
  }

  // ── 12. Final anchor check: guarantee every HQ and Bank is reachable on foot
  const allAnchors = [...slots, ...bankList.map(b => ({ x: b.x, y: b.y }))];
  placeEdgeAwareBridges(map, size, {
    maxSpan: 6,
    minSpacing: 4,
    targetBridges: 0,
    anchors: allAnchors,
    groundTypeAt: baseGroundAt,
    allowCarveObstacles: true,
    mirror180: mirrored,
    rng,
  });

  // Ensure no surrounding stray 8-way wall blocks HQ spawn points
  for (const slot of slots) {
    for (const [dx, dy] of DIRS_8) {
      const nb = at(slot.x + dx, slot.y + dy);
      if (nb && (nb.type === 'WATER' || nb.type === 'CANYON' || nb.type === 'MOUNTAIN')) {
        nb.type = baseGroundAt(nb.x, nb.y);
        nb.height = 1;
      }
    }
  }

  // ── 13. Fair starting loot (1 equal-distance crate per player) + optional extra loose loot
  placeFairStartingLoot(map, size, baseLocations, rng, mirrored);

  const extraLootTarget = Math.round((totalTiles * knobs.lootPct) / 100);
  if (extraLootTarget > 0) {
    const finalReachable = reachableFromHq0();
    const lootEligible = map.filter(
      t =>
        (t.type === 'PLAINS' || t.type === 'SAND' || t.type === 'FOREST') &&
        !inBasePlaza(t.x, t.y, 2) &&
        !t.loot &&
        finalReachable.has(t.id),
    );
    shuffle(lootEligible);
    let placedLoot = 0;
    for (const t of lootEligible) {
      if (placedLoot >= extraLootTarget) break;
      if (t.loot) continue;
      const item = LOOT_TYPES[Math.floor(rng() * LOOT_TYPES.length)];
      if (mirrored) {
        const mt = mirrorOf(t);
        if (mt.loot || !isFootPassable(mt) || inBasePlaza(mt.x, mt.y, 2)) continue;
        t.loot = item;
        mt.loot = item;
        placedLoot += mt.id === t.id ? 1 : 2;
      } else {
        t.loot = item;
        placedLoot++;
      }
    }
  }

  return { map, size, baseLocations };
};
