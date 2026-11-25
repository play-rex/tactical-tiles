/**
 * Theater Air Supply Drops (3-round Field / 6-round Tactical cadence):
 * - L - 2 (DISPATCH): Radio warning + approximate 5x5 sector radar ping (exact tile hidden).
 * - L - 1 (FLARE): Exact fair mid-board LZ locks with a public burning signal flare & flight heading.
 * - L     (DROP): Full-map C-130 / Heavy Lifter flyover & parachute descent; on R6/R12/R18... two
 *                 staggered planes drop separated Field + Tactical mystery crates.
 * - LOOT: No auto-claim. Crates stay 100% mystery until a unit spends LOOT on its turn, at which
 *         point the reward rolls deterministically with cost/tier weights and anti-Epic-streak math.
 */
import { AIR_DROP_SCHEDULE } from '../constants/Config';
import { getManhattanDistance } from '../grid/Pathfinding';
import { TACTICAL_IDS, TACTICAL_ITEMS, type TacticalTierOrder } from '../tactical/catalog';
import type {
  ActiveAirDrop,
  AirDropKind,
  AirDropMeta,
  ShopConstructId,
  TacticalId,
  Tile,
} from '../types';
import { createSeededRng } from '../utils/SeededRandom';
import type { GameState } from './state';

export type FieldCrateReward =
  | { category: 'CONSUMABLE'; item: 'AMMO' | 'FIRST_AID' | 'MEDKIT'; label: string }
  | { category: 'CONSTRUCT'; itemKey: ShopConstructId; label: string };

export interface TacticalCrateReward {
  itemKey: TacticalId;
  tier: TacticalTierOrder;
  label: string;
}

export interface AirDropFlightPlan {
  dropId: string;
  dropKind: AirDropKind;
  at: { x: number; y: number };
  tileId: string;
  headingRad: number;
  staggerMs: number;
  isDualConvoy: boolean;
  rerouted: boolean;
  companionAt?: { x: number; y: number };
}

export interface AirDropRoundTickResult {
  airDrops: ActiveAirDrop[];
  airDropMeta: AirDropMeta;
  landed: AirDropFlightPlan[];
  dispatched: ActiveAirDrop[];
  flared: ActiveAirDrop[];
}

/** True when global Theater Air Supply Drops are active for this match. */
export const areAirDropsEnabled = (state: Pick<GameState, 'settings' | 'activeMission'>): boolean => {
  if (state.settings.airDropsEnabled !== undefined) return state.settings.airDropsEnabled;
  if (state.activeMission || state.settings.challengeId) return false;
  return true;
};

export const isMysterySupplyLoot = (loot: Tile['loot']): loot is 'FIELD_SUPPLY' | 'TACTICAL_SUPPLY' =>
  loot === 'FIELD_SUPPLY' || loot === 'TACTICAL_SUPPLY';

const OPEN_DROP_TERRAIN = new Set<Tile['type']>([
  'PLAINS',
  'ROAD',
  'ROAD_H',
  'SAND',
  'DUNES',
  'FOREST',
]);

/** Whether a tile can accept an incoming Theater Air Drop LZ. */
export const isEligibleAirDropTile = (
  tile: Tile,
  activeHqs: Tile[],
  blockedTileIds: ReadonlySet<string>,
  burningTileIds: ReadonlySet<string>,
  gridSize: number,
  nextDoomsdayRing: number,
  relaxHqDistance = false,
): boolean => {
  if (!OPEN_DROP_TERRAIN.has(tile.type)) return false;
  if (tile.hazardState === 'LAVA' || tile.hazardState === 'WARNING') return false;
  if (tile.loot !== null && tile.loot !== undefined) return false;
  if (blockedTileIds.has(tile.id)) return false;
  if (burningTileIds.has(tile.id)) return false;
  if (nextDoomsdayRing >= 0) {
    const edgeDist = Math.min(tile.x, tile.y, gridSize - 1 - tile.x, gridSize - 1 - tile.y);
    if (edgeDist <= nextDoomsdayRing) return false;
  }
  const minHqDist = relaxHqDistance ? 2 : AIR_DROP_SCHEDULE.HQ_MIN_DISTANCE;
  for (let i = 0; i < activeHqs.length; i++) {
    if (getManhattanDistance(tile, activeHqs[i]) < minHqDist) return false;
  }
  return true;
};

const activeHqTilesOf = (state: Pick<GameState, 'mapData' | 'playerStatus'>): Tile[] =>
  state.mapData.filter(
    t =>
      t.type === 'BASE' &&
      typeof t.owner === 'number' &&
      (t.hp ?? 1) > 0 &&
      state.playerStatus?.[t.owner] !== 'ELIMINATED',
  );

const clampCoord = (v: number, gridSize: number): number => Math.max(1, Math.min(gridSize - 2, Math.round(v)));

/**
 * Picks a fair, contested mid-board LZ tile:
 * - Minimizes HQ distance spread `max_i d(t, h_i) - min_i d(t, h_i)` so drops stay equidistant in 2P/4P/6P.
 * - Enforces dual-drop separation (`>= max(5, floor(gridSize / 3))`) when Field + Tactical land together.
 * - Rotates away from `avoidCenter` (previous LZ) when possible.
 */
export const pickFairAirDropTile = (params: {
  state: Pick<GameState, 'mapData' | 'gridSize' | 'playerStatus' | 'burningLines' | 'settings'>;
  rng: () => number;
  blockedTileIds: ReadonlySet<string>;
  preferredSector?: { x: number; y: number };
  separateFrom?: { x: number; y: number };
  avoidPrev?: { x: number; y: number };
  tightBand?: number;
  nextDoomsdayRing?: number;
}): Tile | null => {
  const {
    state,
    rng,
    blockedTileIds,
    preferredSector,
    separateFrom,
    avoidPrev,
    tightBand = 3,
    nextDoomsdayRing = -1,
  } = params;

  const hqs = activeHqTilesOf(state);
  const burningTileIds = new Set<string>();
  for (const line of state.burningLines ?? []) {
    for (const id of line.tiles) burningTileIds.add(id);
  }

  let candidates = state.mapData.filter(t =>
    isEligibleAirDropTile(t, hqs, blockedTileIds, burningTileIds, state.gridSize, nextDoomsdayRing, false),
  );
  if (candidates.length === 0) {
    candidates = state.mapData.filter(t =>
      isEligibleAirDropTile(t, hqs, blockedTileIds, burningTileIds, state.gridSize, -1, true),
    );
  }
  if (candidates.length === 0) {
    // Absolute fallback: any walkable non-lava tile without loot
    candidates = state.mapData.filter(
      t =>
        t.type !== 'WATER' &&
        t.type !== 'CANYON' &&
        t.type !== 'MOUNTAIN' &&
        t.type !== 'BASE' &&
        t.type !== 'BANK' &&
        t.type !== 'BUILDING' &&
        t.type !== 'BARRIER' &&
        t.hazardState !== 'LAVA' &&
        !t.loot &&
        !blockedTileIds.has(t.id),
    );
  }
  if (candidates.length === 0) return null;

  // Dual-drop hard separation: keep Field & Tactical LZs genuinely contested on separate fronts.
  if (separateFrom) {
    const minSep = Math.max(5, Math.floor(state.gridSize / 3));
    const separated = candidates.filter(t => getManhattanDistance(t, separateFrom) >= minSep);
    if (separated.length > 0) candidates = separated;
  }

  // If dispatched 1 round earlier with a 5x5 sector radar zone, honor that sector first so the
  // L-2 sector warning genuinely guides squad rotation!
  if (preferredSector) {
    const inSector = candidates.filter(
      t => Math.abs(t.x - preferredSector.x) <= 2 && Math.abs(t.y - preferredSector.y) <= 2,
    );
    if (inSector.length > 0) {
      candidates = inSector;
    } else {
      const nearSector = candidates.filter(
        t => Math.abs(t.x - preferredSector.x) <= 4 && Math.abs(t.y - preferredSector.y) <= 4,
      );
      if (nearSector.length > 0) candidates = nearSector;
    }
  }

  // Compute equity spread Δ(t) = max_i dist(t, h_i) - min_i dist(t, h_i)
  const scored = candidates.map(t => {
    let spread = 0;
    let centerDist = 0;
    if (hqs.length >= 2) {
      let minD = Infinity;
      let maxD = -Infinity;
      let sumX = 0;
      let sumY = 0;
      for (const hq of hqs) {
        const d = getManhattanDistance(t, hq);
        if (d < minD) minD = d;
        if (d > maxD) maxD = d;
        sumX += hq.x;
        sumY += hq.y;
      }
      spread = maxD - minD;
      centerDist = Math.abs(t.x - sumX / hqs.length) + Math.abs(t.y - sumY / hqs.length);
    } else {
      const mid = (state.gridSize - 1) / 2;
      centerDist = Math.abs(t.x - mid) + Math.abs(t.y - mid);
    }
    return { tile: t, spread, centerDist };
  });

  let minSpread = Infinity;
  for (const s of scored) if (s.spread < minSpread) minSpread = s.spread;

  let band = scored.filter(s => s.spread <= minSpread + tightBand);
  if (band.length === 0) band = scored;

  // Prefer rotating away from the last drop tile when multiple fair candidates exist.
  if (avoidPrev) {
    const rotated = band.filter(s => getManhattanDistance(s.tile, avoidPrev) >= 5);
    if (rotated.length > 0) band = rotated;
  }

  // Slight preference for mid-board lanes over extreme map corners.
  band.sort((a, b) => a.centerDist - b.centerDist);
  const poolSize = Math.max(1, Math.min(band.length, Math.ceil(band.length * 0.65)));
  const idx = Math.floor(rng() * poolSize);
  return band[idx]?.tile ?? band[0].tile;
};

/** Picks a crisp diagonal flight heading (offset >= 25 deg from companion on dual-convoy rounds). */
export const pickFlightHeading = (rng: () => number, companionHeading?: number): number => {
  const baseAngles = [-0.52, -0.34, -0.18, 0.18, 0.34, 0.52, Math.PI - 0.52, Math.PI - 0.34, Math.PI + 0.34, Math.PI + 0.52];
  const filtered =
    companionHeading === undefined
      ? baseAngles
      : baseAngles.filter(a => {
          const diff = Math.abs(Math.atan2(Math.sin(a - companionHeading), Math.cos(a - companionHeading)));
          return diff >= 0.45 && Math.abs(Math.PI - diff) >= 0.45;
        });
  const pool = filtered.length > 0 ? filtered : baseAngles;
  return pool[Math.floor(rng() * pool.length)];
};

const emptyMeta = (meta?: AirDropMeta): AirDropMeta => ({
  crateRounds: { ...(meta?.crateRounds ?? {}) },
  lastTacticalTier: meta?.lastTacticalTier,
  lastTacticalId: meta?.lastTacticalId,
  openedCount: meta?.openedCount ?? 0,
  lastLz: meta?.lastLz ? { ...meta.lastLz } : undefined,
});

/**
 * Seeds Round 1's initial DISPATCH entry (Field Drop landing on Round 3) when a match starts.
 */
export const initAirDropsForMatch = (
  state: Pick<GameState, 'settings' | 'activeMission' | 'mapData' | 'gridSize' | 'playerStatus' | 'burningLines' | 'activeSeed'>,
): { airDrops: ActiveAirDrop[]; airDropMeta: AirDropMeta } => {
  const meta = emptyMeta();
  if (!areAirDropsEnabled(state)) return { airDrops: [], airDropMeta: meta };

  const landingRound = AIR_DROP_SCHEDULE.FIELD_INTERVAL; // Round 3
  const rng = createSeededRng(`${state.activeSeed || 'SEED'}_airdrop_dispatch_${landingRound}_FIELD`);
  const previewTile = pickFairAirDropTile({
    state,
    rng,
    blockedTileIds: new Set<string>(),
    tightBand: 3,
  });
  if (!previewTile) return { airDrops: [], airDropMeta: meta };

  const offsetX = Math.floor(rng() * 3) - 1;
  const offsetY = Math.floor(rng() * 3) - 1;
  const sectorCenter = {
    x: clampCoord(previewTile.x + offsetX, state.gridSize),
    y: clampCoord(previewTile.y + offsetY, state.gridSize),
  };

  return {
    airDrops: [
      {
        id: `drop_r${landingRound}_FIELD`,
        kind: 'FIELD',
        landingRound,
        phase: 'DISPATCH',
        sectorCenter,
        headingRad: pickFlightHeading(rng),
      },
    ],
    airDropMeta: meta,
  };
};

/**
 * Advances all Theater Air Supply Drops when a new round (`newRound`, 1-indexed) begins:
 * 1. Drops whose `landingRound === newRound` execute their flyover & land as mystery crates.
 * 2. Drops whose `landingRound - 1 === newRound` lock their exact fair LZ tile & ignite their flare.
 * 3. Drops scheduled for `newRound + 2` (Field every 3R; Tactical every 6R) enter DISPATCH with a 5x5 sector zone.
 */
export const advanceAirDropsForRound = (
  state: Pick<
    GameState,
    | 'settings'
    | 'activeMission'
    | 'mapData'
    | 'gridSize'
    | 'playerStatus'
    | 'burningLines'
    | 'activeSeed'
    | 'airDrops'
    | 'airDropMeta'
  >,
  newRound: number,
  nextDoomsdayRing = -1,
): AirDropRoundTickResult => {
  const meta = emptyMeta(state.airDropMeta);
  if (!areAirDropsEnabled(state)) {
    return { airDrops: [], airDropMeta: meta, landed: [], dispatched: [], flared: [] };
  }

  const seedBase = state.activeSeed || 'SEED';
  const existing = (state.airDrops ?? []).map(d => ({ ...d, sectorCenter: { ...d.sectorCenter } }));
  const remaining: ActiveAirDrop[] = [];
  const landed: AirDropFlightPlan[] = [];
  const flared: ActiveAirDrop[] = [];
  const dispatched: ActiveAirDrop[] = [];

  const blockedTileIds = new Set<string>();
  for (const t of state.mapData) {
    if (t.loot !== null && t.loot !== undefined) blockedTileIds.add(t.id);
  }
  for (const d of existing) {
    if (d.tileId && d.landingRound > newRound) blockedTileIds.add(d.tileId);
  }

  // 1. Resolve drops landing on `newRound` (Field plane first, then Tactical heavy lifter +550ms on R6/R12/R18...)
  const dueNow = existing
    .filter(d => d.landingRound <= newRound)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'FIELD' ? -1 : 1));
  const isDualConvoy = dueNow.length >= 2;
  const duePlans: AirDropFlightPlan[] = [];

  for (let i = 0; i < dueNow.length; i++) {
    const d = dueNow[i];
    const rng = createSeededRng(`${seedBase}_airdrop_land_${d.landingRound}_${d.kind}`);
    const prevTile = d.tileId ? state.mapData.find(t => t.id === d.tileId) : undefined;
    const stillSafe =
      prevTile &&
      prevTile.hazardState !== 'LAVA' &&
      prevTile.type !== 'WATER' &&
      prevTile.type !== 'CANYON' &&
      prevTile.type !== 'BARRIER' &&
      !prevTile.loot;

    let finalTile: Tile | null = stillSafe ? prevTile! : null;
    let rerouted = false;
    if (!finalTile) {
      rerouted = Boolean(d.tileId);
      finalTile = pickFairAirDropTile({
        state,
        rng,
        blockedTileIds,
        preferredSector: d.at ?? d.sectorCenter,
        separateFrom: duePlans[0]?.at,
        avoidPrev: meta.lastLz,
        tightBand: d.kind === 'TACTICAL' ? 2 : 3,
        nextDoomsdayRing,
      });
    }
    if (!finalTile) continue;

    blockedTileIds.add(finalTile.id);
    meta.crateRounds[finalTile.id] = d.landingRound;
    meta.lastLz = { x: finalTile.x, y: finalTile.y };

    duePlans.push({
      dropId: d.id,
      dropKind: d.kind,
      at: { x: finalTile.x, y: finalTile.y },
      tileId: finalTile.id,
      headingRad: d.headingRad,
      staggerMs: i === 0 ? 0 : AIR_DROP_SCHEDULE.DUAL_PLANE_STAGGER_MS,
      isDualConvoy,
      rerouted,
    });
  }

  if (duePlans.length >= 2) {
    duePlans[0].companionAt = duePlans[1].at;
    duePlans[1].companionAt = duePlans[0].at;
  }
  landed.push(...duePlans);

  // 2. Promote L - 1 drops from DISPATCH -> FLARE (locking Tactical LZ first so Field separates cleanly)
  const stillIncoming = existing.filter(d => d.landingRound > newRound);
  const toFlare = stillIncoming
    .filter(d => d.phase === 'DISPATCH' && d.landingRound - AIR_DROP_SCHEDULE.FLARE_LEAD_ROUNDS <= newRound)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'TACTICAL' ? -1 : 1));
  const keepUnchanged = stillIncoming.filter(d => !toFlare.includes(d));

  let flaredAnchor: { x: number; y: number } | undefined;
  for (const d of toFlare) {
    const rng = createSeededRng(`${seedBase}_airdrop_flare_${d.landingRound}_${d.kind}`);
    const lzTile = pickFairAirDropTile({
      state,
      rng,
      blockedTileIds,
      preferredSector: d.sectorCenter,
      separateFrom: flaredAnchor,
      avoidPrev: meta.lastLz,
      tightBand: d.kind === 'TACTICAL' ? 2 : 3,
      nextDoomsdayRing,
    });
    if (!lzTile) continue;
    blockedTileIds.add(lzTile.id);
    if (!flaredAnchor) flaredAnchor = { x: lzTile.x, y: lzTile.y };
    const updated: ActiveAirDrop = {
      ...d,
      phase: 'FLARE',
      tileId: lzTile.id,
      at: { x: lzTile.x, y: lzTile.y },
    };
    flared.push(updated);
    remaining.push(updated);
  }
  remaining.push(...keepUnchanged);

  // 3. Dispatch new drops arriving 2 rounds from now (`targetRound = newRound + 2`)
  const targetRound = newRound + AIR_DROP_SCHEDULE.DISPATCH_LEAD_ROUNDS;
  const kindsToDispatch: AirDropKind[] = [];
  if (targetRound % AIR_DROP_SCHEDULE.TACTICAL_INTERVAL === 0) kindsToDispatch.push('TACTICAL');
  if (targetRound % AIR_DROP_SCHEDULE.FIELD_INTERVAL === 0) kindsToDispatch.push('FIELD');

  let firstSector: { x: number; y: number } | undefined;
  let firstHeading: number | undefined;
  for (const kind of kindsToDispatch) {
    const id = `drop_r${targetRound}_${kind}`;
    if (remaining.some(d => d.id === id)) continue;
    const rng = createSeededRng(`${seedBase}_airdrop_dispatch_${targetRound}_${kind}`);
    const previewTile = pickFairAirDropTile({
      state,
      rng,
      blockedTileIds,
      separateFrom: firstSector,
      avoidPrev: meta.lastLz,
      tightBand: kind === 'TACTICAL' ? 2 : 3,
      nextDoomsdayRing,
    });
    if (!previewTile) continue;
    const offsetX = Math.floor(rng() * 3) - 1;
    const offsetY = Math.floor(rng() * 3) - 1;
    const sectorCenter = {
      x: clampCoord(previewTile.x + offsetX, state.gridSize),
      y: clampCoord(previewTile.y + offsetY, state.gridSize),
    };
    const headingRad = pickFlightHeading(rng, firstHeading);
    if (!firstSector) firstSector = sectorCenter;
    if (firstHeading === undefined) firstHeading = headingRad;

    const entry: ActiveAirDrop = {
      id,
      kind,
      landingRound: targetRound,
      phase: 'DISPATCH',
      sectorCenter,
      headingRad,
    };
    dispatched.push(entry);
    remaining.push(entry);
  }

  return { airDrops: remaining, airDropMeta: meta, landed, dispatched, flared };
};

const weightedPick = <T>(entries: { value: T; weight: number }[], rng: () => number): T => {
  const valid = entries.filter(e => e.weight > 0);
  const total = valid.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (let i = 0; i < valid.length; i++) {
    r -= valid[i].weight;
    if (r <= 0) return valid[i].value;
  }
  return valid[valid.length - 1].value;
};

/**
 * Deterministically rolls a Field Supply Crate reward AT PICKUP TIME (100% mystery until claimed!).
 * Context-filters Bridge (0 weight if no water/canyon) and Tunnel (0 weight if no mountains).
 */
export const rollFieldSupplyCrate = (
  state: Pick<GameState, 'mapData' | 'activeSeed'>,
  tileId: string,
  round: number,
  openedCount: number,
): FieldCrateReward => {
  const rng = createSeededRng(`${state.activeSeed || 'SEED'}_open_field_${tileId}_r${round}_${openedCount}`);
  const hasChannel = state.mapData.some(t => t.type === 'WATER' || t.type === 'CANYON');
  const hasMountain = state.mapData.some(t => t.type === 'MOUNTAIN');

  const table: { value: FieldCrateReward; weight: number }[] = [
    { value: { category: 'CONSUMABLE', item: 'FIRST_AID', label: 'First Aid Kit' }, weight: 28 },
    { value: { category: 'CONSUMABLE', item: 'AMMO', label: 'Ammo Drop' }, weight: 24 },
    { value: { category: 'CONSTRUCT', itemKey: 'LAND_MINE', label: 'Free Land Mine' }, weight: 18 },
    { value: { category: 'CONSTRUCT', itemKey: 'BARRIER', label: 'Free Barrier ×3' }, weight: 12 },
    { value: { category: 'CONSUMABLE', item: 'MEDKIT', label: 'Medkit' }, weight: 10 },
    { value: { category: 'CONSTRUCT', itemKey: 'BRIDGE', label: 'Free Bridge' }, weight: hasChannel ? 4 : 0 },
    { value: { category: 'CONSTRUCT', itemKey: 'TUNNEL', label: 'Free Tunnel' }, weight: hasMountain ? 4 : 0 },
  ];

  return weightedPick(table, rng);
};

/**
 * Tier weights for Tactical Supply Crates (3/6 cadence):
 * - R6:   35% Common / 55% Rare / 10% Epic
 * - R12:  20% Common / 55% Rare / 25% Epic
 * - R18+: 15% Common / 50% Rare / 35% Epic
 * - Anti-Epic Streak: if previous Tactical Crate rolled EPIC -> 0% Epic (25% Common / 75% Rare).
 */
export const tacticalCrateTierWeights = (
  crateLandingRound: number,
  lastTacticalTier?: TacticalTierOrder,
): Record<TacticalTierOrder, number> => {
  if (lastTacticalTier === 'EPIC') {
    return { COMMON: 25, RARE: 75, EPIC: 0 };
  }
  if (crateLandingRound <= 6) {
    return { COMMON: 35, RARE: 55, EPIC: 10 };
  }
  if (crateLandingRound <= 12) {
    return { COMMON: 20, RARE: 55, EPIC: 25 };
  }
  return { COMMON: 15, RARE: 50, EPIC: 35 };
};

/**
 * Deterministically rolls a Tactical Supply Crate weapon AT PICKUP TIME (100% mystery until claimed!).
 * Enforces anti-Epic-streak, no back-to-back weapon repeats, and context filtering (no Radar without Fog,
 * no Minefield Snapshot when zero enemy mines exist).
 */
export const rollTacticalSupplyCrate = (
  state: Pick<GameState, 'settings' | 'mines' | 'activeSeed' | 'airDropMeta'>,
  seat: number,
  tileId: string,
  round: number,
): TacticalCrateReward => {
  const meta = state.airDropMeta;
  const openedCount = meta?.openedCount ?? 0;
  const crateRound = meta?.crateRounds?.[tileId] ?? round;
  const rng = createSeededRng(`${state.activeSeed || 'SEED'}_open_tac_${tileId}_r${round}_${openedCount}`);

  const hasEnemyMines = (state.mines ?? []).some(m => m.owner !== seat);
  const eligibleIds = (tier: TacticalTierOrder): TacticalId[] => {
    const base = TACTICAL_IDS.filter(id => {
      const def = TACTICAL_ITEMS[id];
      if (def.tier !== tier) return false;
      if (def.fogOnly && !state.settings.fogOfWar) return false;
      if (id === 'MINEFIELD_SNAPSHOT' && !hasEnemyMines) return false;
      return true;
    });
    const noRepeat = base.filter(id => id !== meta?.lastTacticalId);
    return noRepeat.length > 0 ? noRepeat : base;
  };

  const weights = tacticalCrateTierWeights(crateRound, meta?.lastTacticalTier);
  const tierEntries: { value: TacticalTierOrder; weight: number }[] = (
    ['COMMON', 'RARE', 'EPIC'] as const
  ).map(tier => ({
    value: tier,
    weight: eligibleIds(tier).length > 0 ? weights[tier] : 0,
  }));

  const chosenTier = weightedPick(tierEntries, rng);
  const pool = eligibleIds(chosenTier);
  const chosenId = pool[Math.floor(rng() * pool.length)];

  return {
    itemKey: chosenId,
    tier: chosenTier,
    label: TACTICAL_ITEMS[chosenId].name,
  };
};
