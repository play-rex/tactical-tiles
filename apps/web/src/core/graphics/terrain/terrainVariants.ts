import { TerrainType, Tile } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';

export const DESERT_TYPES = new Set<TerrainType>(['SAND', 'DUNES', 'QUICKSAND', 'CANYON']);

export type MountainVariant =
  | 'ALPINE_PEAK'
  | 'TWIN_RIDGE'
  | 'CRAG_SPIRE'
  | 'HIGHLAND_PINE'
  | 'DESERT_MESA'
  | 'DESERT_BUTTE';

export type ForestVariant =
  | 'CONIFER_PINE'
  | 'BROADLEAF_OAK'
  | 'GOLDEN_BIRCH'
  | 'CRIMSON_MAPLE'
  | 'SAKURA_BLOSSOM'
  | 'RIVERSIDE_WILLOW'
  | 'DESERT_OASIS';

export type GroveTheme =
  | 'EMERALD_DEEPWOOD'
  | 'AUTUMN_RESERVE'
  | 'ALPINE_TIMBER'
  | 'SPRING_GLADE'
  | 'DESERT_OASIS';

export type BankVariant =
  | 'BULLION_ROTUNDA'
  | 'RESERVE_VAULT'
  | 'TREASURY_CITADEL'
  | 'TRADE_EXCHANGE';

export type DuneVariant =
  | 'BARCHAN_CRESCENT'
  | 'TWIN_RIDGES'
  | 'STAR_DUNE'
  | 'ROCKY_DRIFT';

export type WatchtowerVariant =
  | 'RADAR_TOWER'
  | 'COMMS_OUTPOST'
  | 'CROWS_NEST';

export type BunkerVariant =
  | 'CONCRETE_PILLBOX'
  | 'HEX_CASEMATE'
  | 'TRENCH_BERM';

export type BarrierVariant =
  | 'JERSEY_BLOCKS'
  | 'CZECH_HEDGEHOGS'
  | 'DRAGONS_TEETH';

export type BridgeVariant =
  | 'STEEL_TRUSS'
  | 'CONCRETE_VIADUCT';

export type PlainsDetailVariant =
  | 'CLEAN'
  | 'GRASS_TUFTS'
  | 'WILDFLOWERS'
  | 'FIELD_PEBBLES'
  | 'CLOVER_PATCH';

export type SandDetailVariant =
  | 'CLEAN'
  | 'WIND_RIPPLES'
  | 'SANDSTONE_SHARDS'
  | 'DESERT_SCRUB'
  | 'ALKALI_CRACKS';

/** Fast deterministic [0, 1) hash from two integer coordinates. */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Deterministic [0, 1) hash salted with an integer channel so each feature varies independently. */
export function hash3(x: number, y: number, salt: number): number {
  let h =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(salt | 0, 2246822519)) ^
    0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x: number, y: number): number {
  return (
    smoothNoise(x, y) * 0.55 +
    smoothNoise(x * 2.1, y * 2.1) * 0.3 +
    smoothNoise(x * 4.3, y * 4.3) * 0.15
  );
}

export function isDesertTile(t: Tile | undefined): boolean {
  return Boolean(t && DESERT_TYPES.has(t.type));
}

export function isWaterLike(t: Tile | undefined): boolean {
  return Boolean(t && (t.type === 'WATER' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V'));
}

export function isRoadLike(t: Tile | undefined): boolean {
  return Boolean(
    t &&
      (t.type === 'ROAD' ||
        t.type === 'ROAD_H' ||
        t.type === 'BRIDGE' ||
        t.type === 'BRIDGE_V' ||
        t.type === 'BASE'),
  );
}

export function isCanyonLike(t: Tile | undefined): boolean {
  return Boolean(t && (t.type === 'CANYON' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V'));
}

/**
 * Checks whether a tile sits inside a desert neighborhood by inspecting its 8 canonical neighbors.
 * Using canonical neighbors ensures identical biome classification under 0/90/180/270° rotation.
 */
export function isDesertNeighborhood(
  tile: Tile,
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
): boolean {
  if (gridSize <= 1) return false;
  let desertCount = 0;
  let sampleCount = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      const nb = canonicalGrid[ny]?.[nx];
      if (!nb) continue;
      sampleCount++;
      if (DESERT_TYPES.has(nb.type)) desertCount++;
    }
  }
  return sampleCount > 0 && desertCount >= 2;
}

/**
 * Picks a deterministic, rotation-invariant mountain silhouette + rock material.
 * Single-tile previews (gridSize === 1) always render the iconic Alpine Peak.
 */
export function pickMountainVariant(
  tile: Tile,
  isDesertContext: boolean,
  gridSize: number,
): MountainVariant {
  if (gridSize <= 1) return 'ALPINE_PEAK';
  const r = hash3(tile.x, tile.y, 101);
  if (isDesertContext) {
    return r < 0.58 ? 'DESERT_MESA' : 'DESERT_BUTTE';
  }
  if (r < 0.30) return 'ALPINE_PEAK';
  if (r < 0.55) return 'TWIN_RIDGE';
  if (r < 0.78) return 'CRAG_SPIRE';
  return 'HIGHLAND_PINE';
}

/**
 * Checks whether a tile sits adjacent (8-way) to water so shoreline trees naturally favor willows.
 */
export function isWaterNeighborhood(
  tile: Tile,
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
): boolean {
  if (gridSize <= 1) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      if (canonicalGrid[ny]?.[nx]?.type === 'WATER') return true;
    }
  }
  return false;
}

/**
 * Picks a deterministic, rotation-invariant tree species & color palette.
 * Produces vibrant natural diversity across emerald oaks, blue-spruce pines, golden birches,
 * crimson maples, delicate sakura blossoms, riverside willows, and desert oasis palms.
 */
export function pickForestVariant(
  tile: Tile,
  isDesertContext: boolean,
  gridSize: number,
  isNearWater = false,
): ForestVariant {
  if (gridSize <= 1) return 'BROADLEAF_OAK';
  if (isDesertContext) return 'DESERT_OASIS';
  const r = hash3(tile.x, tile.y, 202);
  if (isNearWater && r < 0.60) return 'RIVERSIDE_WILLOW';
  if (r < 0.30) return 'BROADLEAF_OAK';
  if (r < 0.54) return 'CONIFER_PINE';
  if (r < 0.69) return 'GOLDEN_BIRCH';
  if (r < 0.81) return 'CRIMSON_MAPLE';
  if (r < 0.90) return 'SAKURA_BLOSSOM';
  return 'RIVERSIDE_WILLOW';
}

/** Picks a cohesive multi-species theme for a 4–6 tile Forest Grove. */
export function pickGroveTheme(
  seedTile: Tile,
  isDesertGrove: boolean,
): GroveTheme {
  if (isDesertGrove) return 'DESERT_OASIS';
  const r = hash3(seedTile.x * 3, seedTile.y * 5, 244);
  if (r < 0.28) return 'AUTUMN_RESERVE';
  if (r < 0.54) return 'ALPINE_TIMBER';
  if (r < 0.76) return 'EMERALD_DEEPWOOD';
  return 'SPRING_GLADE';
}

export interface ForestClusterInfo {
  id: number;
  size: number;
  theme: GroveTheme;
  isDesert: boolean;
}

const DIRS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

/**
 * Flood-fills 4-way (orthogonally) connected FOREST tiles so 4–6 tile groves render as cohesive deep
 * woodlands while scattered individual trees (including diagonally staggered ones) render as crisp
 * standalone specimen trees.
 */
export function classifyForestClusters(
  grid: (Tile | undefined)[][],
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
): Map<string, ForestClusterInfo> {
  const result = new Map<string, ForestClusterInfo>();
  const visited = new Uint8Array(gridSize * gridSize);
  let nextId = 0;

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const start = grid[y]?.[x];
      if (!start || start.type !== 'FOREST') continue;
      const sk = y * gridSize + x;
      if (visited[sk]) continue;

      const members: Tile[] = [];
      const q: Array<{ x: number; y: number }> = [{ x, y }];
      visited[sk] = 1;
      let desertVotes = 0;

      while (q.length > 0) {
        const cur = q.shift()!;
        const tile = grid[cur.y]?.[cur.x];
        if (!tile) continue;
        members.push(tile);
        if (isDesertNeighborhood(tile, canonicalGrid, gridSize)) desertVotes++;

        for (const [dx, dy] of DIRS_4) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
          const nk = ny * gridSize + nx;
          if (visited[nk]) continue;
          if (grid[ny]?.[nx]?.type === 'FOREST') {
            visited[nk] = 1;
            q.push({ x: nx, y: ny });
          }
        }
      }

      // Canonical minimum tile anchors the grove theme identically across 0/90/180/270° board rotations
      let anchor = members[0];
      for (const m of members) {
        if (m.y < anchor.y || (m.y === anchor.y && m.x < anchor.x)) anchor = m;
      }
      const isDesert = desertVotes * 2 >= members.length;
      const info: ForestClusterInfo = {
        id: nextId++,
        size: members.length,
        theme: pickGroveTheme(anchor, isDesert),
        isDesert,
      };
      for (const m of members) {
        result.set(m.id, info);
      }
    }
  }

  return result;
}

/**
 * Picks one of 4 distinct high-value architectural Bank Vault styles.
 * Uses canonical sorted bank order + a canonical map-wide seed offset so:
 * - Multiple banks on the same battlefield are guaranteed distinct architectures (up to 4 unique),
 * - Rotating the board 0/90/180/270° keeps the exact same building on each tile.
 */
export function pickBankVariant(
  canonicalBankIndex: number,
  bankSeedOffset: number,
  gridSize: number,
): BankVariant {
  if (gridSize <= 1) return 'BULLION_ROTUNDA';
  const styles: BankVariant[] = [
    'BULLION_ROTUNDA',
    'RESERVE_VAULT',
    'TREASURY_CITADEL',
    'TRADE_EXCHANGE',
  ];
  const idx = ((canonicalBankIndex + bankSeedOffset) % styles.length + styles.length) % styles.length;
  return styles[idx];
}

export function pickDuneVariant(tile: Tile, gridSize: number): DuneVariant {
  if (gridSize <= 1) return 'BARCHAN_CRESCENT';
  const r = hash3(tile.x, tile.y, 404);
  if (r < 0.32) return 'BARCHAN_CRESCENT';
  if (r < 0.60) return 'TWIN_RIDGES';
  if (r < 0.82) return 'STAR_DUNE';
  return 'ROCKY_DRIFT';
}

export function pickWatchtowerVariant(tile: Tile, gridSize: number): WatchtowerVariant {
  if (gridSize <= 1) return 'RADAR_TOWER';
  const r = hash3(tile.x, tile.y, 505);
  if (r < 0.38) return 'RADAR_TOWER';
  if (r < 0.72) return 'COMMS_OUTPOST';
  return 'CROWS_NEST';
}

export function pickBunkerVariant(tile: Tile, gridSize: number): BunkerVariant {
  if (gridSize <= 1) return 'CONCRETE_PILLBOX';
  const r = hash3(tile.x, tile.y, 606);
  if (r < 0.38) return 'CONCRETE_PILLBOX';
  if (r < 0.72) return 'HEX_CASEMATE';
  return 'TRENCH_BERM';
}

export function pickBarrierVariant(tile: Tile, gridSize: number): BarrierVariant {
  if (gridSize <= 1) return 'JERSEY_BLOCKS';
  const r = hash3(tile.x, tile.y, 707);
  if (r < 0.40) return 'JERSEY_BLOCKS';
  if (r < 0.72) return 'CZECH_HEDGEHOGS';
  return 'DRAGONS_TEETH';
}

export function pickBridgeVariant(tile: Tile, isCanyonBridge: boolean, gridSize: number): BridgeVariant {
  if (gridSize <= 1) return 'STEEL_TRUSS';
  if (isCanyonBridge) return 'CONCRETE_VIADUCT';
  return hash3(tile.x, tile.y, 808) < 0.65 ? 'STEEL_TRUSS' : 'CONCRETE_VIADUCT';
}

export function pickPlainsDetail(tile: Tile, gridSize: number): PlainsDetailVariant {
  if (gridSize <= 1) return 'GRASS_TUFTS';
  const r = hash3(tile.x, tile.y, 909);
  if (r < 0.36) return 'CLEAN';
  if (r < 0.58) return 'GRASS_TUFTS';
  if (r < 0.74) return 'WILDFLOWERS';
  if (r < 0.88) return 'FIELD_PEBBLES';
  return 'CLOVER_PATCH';
}

export function pickSandDetail(tile: Tile, gridSize: number): SandDetailVariant {
  if (gridSize <= 1) return 'WIND_RIPPLES';
  const r = hash3(tile.x, tile.y, 1010);
  if (r < 0.30) return 'CLEAN';
  if (r < 0.54) return 'WIND_RIPPLES';
  if (r < 0.72) return 'SANDSTONE_SHARDS';
  if (r < 0.87) return 'DESERT_SCRUB';
  return 'ALKALI_CRACKS';
}

export interface MountainNode {
  x: number;
  y: number;
  tile: Tile;
  orthoNeighbors: number;
  totalNeighbors: number;
  /** Normalized summit height in [0.42, 1.0]; massif interior peaks rise tallest. */
  elevation: number;
  /** Organically jittered summit point in canvas pixel coordinates. */
  peakX: number;
  peakY: number;
  /** Foothill center in canvas pixel coordinates. */
  cx: number;
  cy: number;
  isDesert: boolean;
}

export interface MountainRidgeLink {
  a: number;
  b: number;
  isDiagonal: boolean;
}

export interface MountainCluster {
  id: number;
  nodes: MountainNode[];
  links: MountainRidgeLink[];
  /** Unified geological biome for the whole range (desert sandstone massif vs alpine granite range). */
  isDesert: boolean;
}

const DIRS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

/**
 * Flood-fills connected MOUNTAIN tiles (8-way: orthogonal + diagonal) into cohesive geological
 * mountain ranges (massifs), computing per-node elevation prominence, organically jittered summits,
 * and non-crossing ridge spine links.
 */
export function findMountainClusters(
  grid: (Tile | undefined)[][],
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
): MountainCluster[] {
  const visited = new Uint8Array(gridSize * gridSize);
  const clusters: MountainCluster[] = [];
  let clusterId = 0;

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const start = grid[y]?.[x];
      if (!start || start.type !== 'MOUNTAIN') continue;
      const startKey = y * gridSize + x;
      if (visited[startKey]) continue;

      const coords: Array<{ x: number; y: number; tile: Tile }> = [];
      const queue: Array<{ x: number; y: number }> = [{ x, y }];
      visited[startKey] = 1;

      while (queue.length > 0) {
        const cur = queue.shift()!;
        const tile = grid[cur.y]?.[cur.x];
        if (!tile) continue;
        coords.push({ x: cur.x, y: cur.y, tile });

        for (const [dx, dy] of DIRS_8) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
          const nk = ny * gridSize + nx;
          if (visited[nk]) continue;
          const nt = grid[ny]?.[nx];
          if (nt && nt.type === 'MOUNTAIN') {
            visited[nk] = 1;
            queue.push({ x: nx, y: ny });
          }
        }
      }

      // Compute unified biome + elevation + organic summit placement for every tile in this massif
      const indexByPos = new Map<number, number>();
      let desertVotes = 0;
      const clusterBonus = Math.min(0.18, (coords.length - 1) * 0.025);

      const nodes: MountainNode[] = coords.map((c, idx) => {
        indexByPos.set(c.y * gridSize + c.x, idx);
        const isDesert = isDesertNeighborhood(c.tile, canonicalGrid, gridSize);
        if (isDesert) desertVotes++;

        let orthoNeighbors = 0;
        let totalNeighbors = 0;
        let pullX = 0;
        let pullY = 0;
        for (const [dx, dy] of DIRS_8) {
          const nt = grid[c.y + dy]?.[c.x + dx];
          if (nt && nt.type === 'MOUNTAIN') {
            totalNeighbors++;
            if (dx === 0 || dy === 0) orthoNeighbors++;
            pullX += dx;
            pullY += dy;
          }
        }

        const prominence = totalNeighbors / 8;
        const randH = hash3(c.tile.x, c.tile.y, 601);
        const elevation = Math.max(
          0.42,
          Math.min(1.0, 0.44 + prominence * 0.36 + clusterBonus + (randH - 0.35) * 0.22),
        );

        const cx = c.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = c.y * TILE_SIZE + TILE_SIZE / 2;
        const jitterX = (hash3(c.tile.x, c.tile.y, 602) - 0.5) * 16;
        const jitterY = (hash3(c.tile.x, c.tile.y, 603) - 0.5) * 12;
        const pullLen = Math.hypot(pullX, pullY);
        const normPullX = pullLen > 0 ? (pullX / pullLen) * 3.5 : 0;
        const normPullY = pullLen > 0 ? (pullY / pullLen) * 2.8 : 0;

        // Taller massif summits rise visually higher (oblique top-down relief)
        const peakX = cx + jitterX + normPullX;
        const peakY = cy - 6 - elevation * 11 + jitterY * 0.6 + normPullY;

        return {
          x: c.x,
          y: c.y,
          tile: c.tile,
          orthoNeighbors,
          totalNeighbors,
          elevation,
          peakX,
          peakY,
          cx,
          cy,
          isDesert,
        };
      });

      const rangeIsDesert = desertVotes * 2 >= nodes.length;
      for (const n of nodes) n.isDesert = rangeIsDesert;

      // Build clean non-crossing ridge spine links (E, S, plus SE/SW when not already bridged by orthogonal edges)
      const links: MountainRidgeLink[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const eIdx = a.x + 1 < gridSize ? indexByPos.get(a.y * gridSize + (a.x + 1)) : undefined;
        const sIdx = a.y + 1 < gridSize ? indexByPos.get((a.y + 1) * gridSize + a.x) : undefined;
        const wIdx = a.x - 1 >= 0 ? indexByPos.get(a.y * gridSize + (a.x - 1)) : undefined;
        const seIdx =
          a.x + 1 < gridSize && a.y + 1 < gridSize
            ? indexByPos.get((a.y + 1) * gridSize + (a.x + 1))
            : undefined;
        const swIdx =
          a.x - 1 >= 0 && a.y + 1 < gridSize
            ? indexByPos.get((a.y + 1) * gridSize + (a.x - 1))
            : undefined;

        if (eIdx !== undefined) links.push({ a: i, b: eIdx, isDiagonal: false });
        if (sIdx !== undefined) links.push({ a: i, b: sIdx, isDiagonal: false });
        // Diagonal ridges bridge jagged zig-zag chains without crisscrossing 2x2 cores
        if (seIdx !== undefined && (eIdx === undefined || sIdx === undefined)) {
          links.push({ a: i, b: seIdx, isDiagonal: true });
        }
        if (swIdx !== undefined && (wIdx === undefined || sIdx === undefined)) {
          links.push({ a: i, b: swIdx, isDiagonal: true });
        }
      }

      clusters.push({
        id: clusterId++,
        nodes,
        links,
        isDesert: rangeIsDesert,
      });
    }
  }

  return clusters;
}
