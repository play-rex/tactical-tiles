/**
 * Edge-aware, span-based bridge placement & connectivity guarantee.
 *
 * Bridges are always placed AFTER all water/canyon channels and HQ plazas are carved:
 *  - 'BRIDGE'   = horizontal deck (East–West crossing across a North–South waterway)
 *  - 'BRIDGE_V' = vertical deck   (North–South crossing across an East–West waterway)
 *
 * Every candidate bridge is scanned as a full shore-to-shore orthogonal span across
 * contiguous WATER/CANYON tiles with passable land on both endpoints and perpendicular
 * waterway flanking. This prevents axis-inverted bridges, mid-intersection bridges,
 * clipped half-bridges, and diagonal staircases.
 */
import type { TerrainType, Tile } from '../types';

export type BridgeType = 'BRIDGE' | 'BRIDGE_V';

export interface BridgePlacementOptions {
  /** Maximum orthogonal water/canyon span width eligible for a bridge (default 5). */
  maxSpan?: number;
  /** Preferred minimum Manhattan spacing between bridge midpoints (default 4). */
  minSpacing?: number;
  /** Target total bridge crossings across the board (auto-scaled from channel tiles if omitted). */
  targetBridges?: number;
  /** Anchor tiles (HQs, Banks) that must be mutually reachable on foot. */
  anchors?: ReadonlyArray<{ x: number; y: number }>;
  /** Open ground type used if fallback must carve through a wall (default 'PLAINS'). */
  groundTypeAt?: (x: number, y: number) => 'PLAINS' | 'SAND';
  /** Allow fallback to carve through mountains/buildings if an anchor is completely walled off (default true). */
  allowCarveObstacles?: boolean;
  /** Keep placed bridge spans 180° rotationally symmetric around board center. */
  mirror180?: boolean;
  /** Deterministic RNG for gentle tie-breaking. */
  rng?: () => number;
}

export interface PlacedBridgeSpan {
  bridgeType: BridgeType;
  tiles: Tile[];
  shoreA: Tile;
  shoreB: Tile;
  midX: number;
  midY: number;
}

interface SpanCandidate {
  bridgeType: BridgeType;
  tiles: Tile[];
  shoreA: Tile;
  shoreB: Tile;
  midX: number;
  midY: number;
  length: number;
  /** Higher score = cleaner, more central, better-inset crossing. */
  baseScore: number;
}

const DIRS_4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const isChannelTerrain = (type: TerrainType): boolean =>
  type === 'WATER' || type === 'CANYON';

export const isBridgeTerrain = (type: TerrainType): boolean =>
  type === 'BRIDGE' || type === 'BRIDGE_V';

/** Tiles a ground squad can walk onto cleanly when stepping off a bridge shore. */
export const isWalkableShore = (t: Tile | null | undefined): boolean =>
  !!t &&
  (t.type === 'PLAINS' ||
    t.type === 'SAND' ||
    t.type === 'DUNES' ||
    t.type === 'FOREST' ||
    t.type === 'ROAD' ||
    t.type === 'ROAD_H' ||
    t.type === 'QUICKSAND' ||
    t.type === 'TUNNEL');

/** Walkable terrain for foot-connectivity checks (includes bridges). */
export const isFootPassable = (t: Tile | null | undefined): boolean =>
  !!t && (isWalkableShore(t) || isBridgeTerrain(t.type));

/**
 * A shore must lead somewhere other than straight back over the deck. A one-tile islet with water on
 * its other three sides makes the crossing a bridge to nowhere, so such spans are never placed.
 * (deckDx/deckDy point from the shore towards the deck and are skipped.)
 */
const shoreLeadsOnward = (
  map: Tile[],
  size: number,
  shore: Tile,
  deckDx: number,
  deckDy: number,
): boolean => {
  for (const [dx, dy] of DIRS_4) {
    if (dx === deckDx && dy === deckDy) continue;
    if (isFootPassable(atGrid(map, size, shore.x + dx, shore.y + dy))) return true;
  }
  return false;
};

const atGrid = (map: Tile[], size: number, x: number, y: number): Tile | null =>
  x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null;

/** Flood-fills foot-passable ground into connected components and returns component ids + sizes. */
const computeLandComponents = (
  map: Tile[],
  size: number,
): { comp: Int32Array; sizes: number[]; count: number } => {
  const comp = new Int32Array(size * size).fill(-1);
  const sizes: number[] = [];
  let count = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      if (comp[idx] !== -1) continue;
      if (!isFootPassable(map[idx])) continue;
      const cid = count++;
      let sz = 0;
      const queue: number[] = [idx];
      comp[idx] = cid;
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        sz++;
        const cx = cur % size;
        const cy = (cur - cx) / size;
        for (const [dx, dy] of DIRS_4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const nIdx = ny * size + nx;
          if (comp[nIdx] !== -1) continue;
          if (!isFootPassable(map[nIdx])) continue;
          comp[nIdx] = cid;
          queue.push(nIdx);
        }
      }
      sizes.push(sz);
    }
  }
  return { comp, sizes, count };
};

/** Returns the walkable component touching an anchor (its own tile if walkable, else an adjacent walkable tile). */
const anchorComponent = (
  map: Tile[],
  size: number,
  comp: Int32Array,
  anchor: { x: number; y: number },
): number => {
  const selfIdx = anchor.y * size + anchor.x;
  if (comp[selfIdx] !== -1) return comp[selfIdx];
  let bestComp = -1;
  for (const [dx, dy] of DIRS_4) {
    const nx = anchor.x + dx;
    const ny = anchor.y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const c = comp[ny * size + nx];
    if (c !== -1) {
      bestComp = c;
      break;
    }
  }
  return bestComp;
};

/** Scans every valid orthogonal shore-to-shore water/canyon crossing on the map. */
const scanBridgeCandidates = (
  map: Tile[],
  size: number,
  maxSpan: number,
  rng: () => number,
): SpanCandidate[] => {
  const candidates: SpanCandidate[] = [];
  const center = (size - 1) / 2;

  // 1. Horizontal bridge candidates ('BRIDGE', crossing East–West across a North–South waterway)
  for (let y = 1; y < size - 1; y++) {
    let x = 1;
    while (x < size - 1) {
      const start = atGrid(map, size, x, y);
      if (!start || !isChannelTerrain(start.type)) {
        x++;
        continue;
      }
      let endX = x;
      while (endX + 1 < size - 1 && isChannelTerrain(atGrid(map, size, endX + 1, y)!.type)) {
        endX++;
      }
      const len = endX - x + 1;
      const shoreA = atGrid(map, size, x - 1, y);
      const shoreB = atGrid(map, size, endX + 1, y);
      if (
        len <= maxSpan &&
        shoreA &&
        shoreB &&
        isWalkableShore(shoreA) &&
        isWalkableShore(shoreB) &&
        shoreLeadsOnward(map, size, shoreA, 1, 0) &&
        shoreLeadsOnward(map, size, shoreB, -1, 0)
      ) {
        let northFlank = 0;
        let southFlank = 0;
        let bothFlank = 0;
        const spanTiles: Tile[] = [];
        for (let tx = x; tx <= endX; tx++) {
          const tile = atGrid(map, size, tx, y)!;
          spanTiles.push(tile);
          const hasN = isChannelTerrain(atGrid(map, size, tx, y - 1)?.type ?? 'PLAINS');
          const hasS = isChannelTerrain(atGrid(map, size, tx, y + 1)?.type ?? 'PLAINS');
          if (hasN) northFlank++;
          if (hasS) southFlank++;
          if (hasN && hasS) bothFlank++;
        }
        // Must genuinely cross an open channel (at least half the span flanked on BOTH perpendicular sides)
        // rather than skimming diagonally along a shoreline pinch.
        if (northFlank > 0 && southFlank > 0 && bothFlank >= Math.ceil(len / 2)) {
          const midX = (x + endX) / 2;
          const midY = y;
          // Prefer shores that don't immediately hug perpendicular water (stays clean of river intersections)
          const shoreCleanA =
            !isChannelTerrain(atGrid(map, size, shoreA.x, shoreA.y - 1)?.type ?? 'PLAINS') &&
            !isChannelTerrain(atGrid(map, size, shoreA.x, shoreA.y + 1)?.type ?? 'PLAINS');
          const shoreCleanB =
            !isChannelTerrain(atGrid(map, size, shoreB.x, shoreB.y - 1)?.type ?? 'PLAINS') &&
            !isChannelTerrain(atGrid(map, size, shoreB.x, shoreB.y + 1)?.type ?? 'PLAINS');
          const edgeInset = Math.min(y, size - 1 - y, x, size - 1 - endX);
          const distCenter = Math.hypot(midX - center, midY - center) / Math.max(1, size);
          const baseScore =
            (bothFlank === len ? 8 : 0) +
            (shoreCleanA ? 4 : 0) +
            (shoreCleanB ? 4 : 0) +
            Math.min(edgeInset, 3) * 1.5 -
            len * 1.8 -
            distCenter * 2.0 +
            rng() * 1.4;
          candidates.push({
            bridgeType: 'BRIDGE',
            tiles: spanTiles,
            shoreA,
            shoreB,
            midX,
            midY,
            length: len,
            baseScore,
          });
        }
      }
      x = endX + 1;
    }
  }

  // 2. Vertical bridge candidates ('BRIDGE_V', crossing North–South across an East–West waterway)
  for (let x = 1; x < size - 1; x++) {
    let y = 1;
    while (y < size - 1) {
      const start = atGrid(map, size, x, y);
      if (!start || !isChannelTerrain(start.type)) {
        y++;
        continue;
      }
      let endY = y;
      while (endY + 1 < size - 1 && isChannelTerrain(atGrid(map, size, x, endY + 1)!.type)) {
        endY++;
      }
      const len = endY - y + 1;
      const shoreA = atGrid(map, size, x, y - 1);
      const shoreB = atGrid(map, size, x, endY + 1);
      if (
        len <= maxSpan &&
        shoreA &&
        shoreB &&
        isWalkableShore(shoreA) &&
        isWalkableShore(shoreB) &&
        shoreLeadsOnward(map, size, shoreA, 0, 1) &&
        shoreLeadsOnward(map, size, shoreB, 0, -1)
      ) {
        let westFlank = 0;
        let eastFlank = 0;
        let bothFlank = 0;
        const spanTiles: Tile[] = [];
        for (let ty = y; ty <= endY; ty++) {
          const tile = atGrid(map, size, x, ty)!;
          spanTiles.push(tile);
          const hasW = isChannelTerrain(atGrid(map, size, x - 1, ty)?.type ?? 'PLAINS');
          const hasE = isChannelTerrain(atGrid(map, size, x + 1, ty)?.type ?? 'PLAINS');
          if (hasW) westFlank++;
          if (hasE) eastFlank++;
          if (hasW && hasE) bothFlank++;
        }
        if (westFlank > 0 && eastFlank > 0 && bothFlank >= Math.ceil(len / 2)) {
          const midX = x;
          const midY = (y + endY) / 2;
          const shoreCleanA =
            !isChannelTerrain(atGrid(map, size, shoreA.x - 1, shoreA.y)?.type ?? 'PLAINS') &&
            !isChannelTerrain(atGrid(map, size, shoreA.x + 1, shoreA.y)?.type ?? 'PLAINS');
          const shoreCleanB =
            !isChannelTerrain(atGrid(map, size, shoreB.x - 1, shoreB.y)?.type ?? 'PLAINS') &&
            !isChannelTerrain(atGrid(map, size, shoreB.x + 1, shoreB.y)?.type ?? 'PLAINS');
          const edgeInset = Math.min(x, size - 1 - x, y, size - 1 - endY);
          const distCenter = Math.hypot(midX - center, midY - center) / Math.max(1, size);
          const baseScore =
            (bothFlank === len ? 8 : 0) +
            (shoreCleanA ? 4 : 0) +
            (shoreCleanB ? 4 : 0) +
            Math.min(edgeInset, 3) * 1.5 -
            len * 1.8 -
            distCenter * 2.0 +
            rng() * 1.4;
          candidates.push({
            bridgeType: 'BRIDGE_V',
            tiles: spanTiles,
            shoreA,
            shoreB,
            midX,
            midY,
            length: len,
            baseScore,
          });
        }
      }
      y = endY + 1;
    }
  }

  return candidates;
};

/** Checks whether placing `cand` collides with or sits directly flush against an existing bridge. */
const conflictsWithExistingBridges = (
  map: Tile[],
  size: number,
  cand: SpanCandidate,
  placed: PlacedBridgeSpan[],
  minSpacing: number,
): boolean => {
  for (const t of cand.tiles) {
    if (!isChannelTerrain(t.type)) return true;
    // Never touch an existing bridge orthogonally (prevents 2-wide bridge slabs and '+' crosses in water)
    for (const [dx, dy] of DIRS_4) {
      const nb = atGrid(map, size, t.x + dx, t.y + dy);
      if (nb && isBridgeTerrain(nb.type)) return true;
    }
  }
  // Also keep shore approaches clear of existing bridge decks AND enforce spacing from any pre-existing bridges
  for (const [dx, dy] of DIRS_4) {
    const a = atGrid(map, size, cand.shoreA.x + dx, cand.shoreA.y + dy);
    const b = atGrid(map, size, cand.shoreB.x + dx, cand.shoreB.y + dy);
    if ((a && isBridgeTerrain(a.type)) || (b && isBridgeTerrain(b.type))) return true;
  }
  const sep = Math.max(1, minSpacing - 1);
  for (const t of cand.tiles) {
    for (let dy = -sep; dy <= sep; dy++) {
      for (let dx = -sep; dx <= sep; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > sep) continue;
        const nb = atGrid(map, size, t.x + dx, t.y + dy);
        if (nb && isBridgeTerrain(nb.type)) return true;
      }
    }
  }
  for (const p of placed) {
    const d = Math.abs(p.midX - cand.midX) + Math.abs(p.midY - cand.midY);
    if (d < minSpacing) return true;
  }
  return false;
};

const stampSpan = (cand: SpanCandidate): PlacedBridgeSpan => {
  for (const t of cand.tiles) {
    t.type = cand.bridgeType;
    t.height = 1;
    t.subType = undefined;
    t.owner = undefined;
    t.loot = null;
  }
  return {
    bridgeType: cand.bridgeType,
    tiles: cand.tiles,
    shoreA: cand.shoreA,
    shoreB: cand.shoreB,
    midX: cand.midX,
    midY: cand.midY,
  };
};

/**
 * Weighted 4-way Dijkstra fallback connecting `from` to `to` when span placement alone
 * could not reach a disconnected HQ or Bank (e.g., mountain wall or corner lagoon).
 * Always uses orthogonal steps and stamps properly oriented BRIDGE / BRIDGE_V segments.
 */
const carveOrthogonalFallbackPath = (
  map: Tile[],
  size: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  groundTypeAt: (x: number, y: number) => 'PLAINS' | 'SAND',
  allowCarveObstacles: boolean,
): void => {
  const total = size * size;
  // Encode state as (idx * 2 + dirAxis): dirAxis 0 = entered horizontally, 1 = entered vertically
  // Adding a turn penalty inside water keeps fallback crossings straight rather than zig-zagging.
  const states = total * 2;
  const dist = new Float64Array(states).fill(Infinity);
  const parent = new Int32Array(states).fill(-1);
  const visited = new Uint8Array(states);

  const startIdx = from.y * size + from.x;
  const goalIdx = to.y * size + to.x;

  dist[startIdx * 2] = 0;
  dist[startIdx * 2 + 1] = 0;

  // Simple priority queue via small binary heap (size <= 2048 states on 32x32)
  const heapState: number[] = [startIdx * 2, startIdx * 2 + 1];
  const heapCost: number[] = [0, 0];
  const push = (st: number, cost: number) => {
    let i = heapState.length;
    heapState.push(st);
    heapCost.push(cost);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapCost[p] <= heapCost[i]) break;
      [heapState[p], heapState[i]] = [heapState[i], heapState[p]];
      [heapCost[p], heapCost[i]] = [heapCost[i], heapCost[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heapState[0];
    const lastS = heapState.pop()!;
    const lastC = heapCost.pop()!;
    if (heapState.length > 0) {
      heapState[0] = lastS;
      heapCost[0] = lastC;
      let i = 0;
      const n = heapState.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && heapCost[l] < heapCost[smallest]) smallest = l;
        if (r < n && heapCost[r] < heapCost[smallest]) smallest = r;
        if (smallest === i) break;
        [heapState[i], heapState[smallest]] = [heapState[smallest], heapState[i]];
        [heapCost[i], heapCost[smallest]] = [heapCost[smallest], heapCost[i]];
        i = smallest;
      }
    }
    return top;
  };

  let bestGoalState = -1;
  while (heapState.length > 0) {
    const curState = pop();
    if (visited[curState]) continue;
    visited[curState] = 1;
    const curIdx = curState >> 1;
    const curAxis = curState & 1;
    if (curIdx === goalIdx) {
      bestGoalState = curState;
      break;
    }
    const cx = curIdx % size;
    const cy = (curIdx - cx) / size;
    const curTile = map[curIdx];
    const curCost = dist[curState];

    for (const [dx, dy] of DIRS_4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nIdx = ny * size + nx;
      const nt = map[nIdx];
      const nextAxis = dx !== 0 ? 0 : 1;

      let stepCost = 1;
      if (nIdx === goalIdx) {
        stepCost = 1;
      } else if (nt.type === 'BASE' || nt.type === 'BANK') {
        stepCost = 500;
      } else if (isFootPassable(nt)) {
        const intoBridgeSide =
          isChannelTerrain(curTile.type) &&
          ((nt.type === 'BRIDGE' && nextAxis === 1) || (nt.type === 'BRIDGE_V' && nextAxis === 0));
        stepCost = intoBridgeSide ? 200 : 1;
      } else if (isChannelTerrain(nt.type)) {
        const offBridgeSide =
          (curTile.type === 'BRIDGE' && nextAxis === 1) ||
          (curTile.type === 'BRIDGE_V' && nextAxis === 0);
        // Penalize turning inside water or entering/exiting water on a 90° bend
        const turningOnChannel = curAxis !== nextAxis && (isChannelTerrain(curTile.type) || isChannelTerrain(nt.type));
        stepCost = 14 + (turningOnChannel ? 30 : 0) + (offBridgeSide ? 200 : 0);
      } else {
        // MOUNTAIN / BUILDING / BARRIER
        stepCost = allowCarveObstacles ? 24 : 400;
      }

      const nextState = nIdx * 2 + nextAxis;
      const candCost = curCost + stepCost;
      if (candCost < dist[nextState]) {
        dist[nextState] = candCost;
        parent[nextState] = curState;
        push(nextState, candCost);
      }
    }
  }

  if (bestGoalState === -1) return;

  // Reconstruct tile path from `from` to `to`
  const path: Tile[] = [];
  let s = bestGoalState;
  while (s !== -1) {
    path.push(map[s >> 1]);
    s = parent[s];
  }
  path.reverse();

  // Walk the 4-connected path:
  //  - Obstacles (mountain/building/barrier) are cleared to open land when allowed.
  //  - Channel tiles where the path turns 90° become shore stepping stones (never bent bridges).
  //  - Straight channel runs whose entry and exit align cleanly become BRIDGE (H) or BRIDGE_V (V).
  for (let i = 0; i < path.length; i++) {
    const t = path[i];
    if (t.type === 'BASE' || t.type === 'BANK') continue;
    if (!isChannelTerrain(t.type)) {
      if (!isFootPassable(t) && allowCarveObstacles) {
        t.type = groundTypeAt(t.x, t.y);
        t.height = 1;
        t.subType = undefined;
        t.owner = undefined;
      }
      continue;
    }

    const prev = i > 0 ? path[i - 1] : null;
    const next = i + 1 < path.length ? path[i + 1] : null;
    const inAxis: 'H' | 'V' | null = prev ? (prev.y === t.y ? 'H' : 'V') : null;
    const outAxis: 'H' | 'V' | null = next ? (next.y === t.y ? 'H' : 'V') : null;

    // 90° corner inside or at edge of water: reclaim as a shore tile so adjacent bridges meet land cleanly
    if (!inAxis || !outAxis || inAxis !== outAxis) {
      t.type = groundTypeAt(t.x, t.y);
      t.height = 1;
      t.subType = undefined;
      t.owner = undefined;
      t.loot = null;
      continue;
    }

    // Straight crossing: stamp the matching orthogonal bridge
    t.type = inAxis === 'H' ? 'BRIDGE' : 'BRIDGE_V';
    t.height = 1;
    t.subType = undefined;
    t.owner = undefined;
    t.loot = null;
  }

  // Final defensive pass: if any newly stamped bridge tile on the path abuts perpendicular water
  // or a perpendicular bridge on its roadway end, reclaim it as shore land so zero dead-ends remain.
  const isValidEnd = (nb: Tile | null, sameBridge: BridgeType): boolean =>
    !!nb && (nb.type === sameBridge || isWalkableShore(nb) || nb.type === 'BASE' || nb.type === 'BANK');
  for (const t of path) {
    if (t.type === 'BRIDGE') {
      const w = atGrid(map, size, t.x - 1, t.y);
      const e = atGrid(map, size, t.x + 1, t.y);
      if (!isValidEnd(w, 'BRIDGE') || !isValidEnd(e, 'BRIDGE')) {
        t.type = groundTypeAt(t.x, t.y);
        t.height = 1;
      }
    } else if (t.type === 'BRIDGE_V') {
      const n = atGrid(map, size, t.x, t.y - 1);
      const s = atGrid(map, size, t.x, t.y + 1);
      if (!isValidEnd(n, 'BRIDGE_V') || !isValidEnd(s, 'BRIDGE_V')) {
        t.type = groundTypeAt(t.x, t.y);
        t.height = 1;
      }
    }
  }
};

/**
 * Places well-oriented, shore-to-shore bridges across all WATER/CANYON waterways and
 * guarantees every anchor (HQ / Bank) is mutually reachable on foot.
 */
export const placeEdgeAwareBridges = (
  map: Tile[],
  size: number,
  options: BridgePlacementOptions = {},
): PlacedBridgeSpan[] => {
  const maxSpan = options.maxSpan ?? 5;
  const baseMinSpacing = options.minSpacing ?? 4;
  const rng = options.rng ?? (() => 0.5);
  const groundTypeAt = options.groundTypeAt ?? (() => 'PLAINS' as const);
  const allowCarveObstacles = options.allowCarveObstacles ?? true;
  const mirror180 = options.mirror180 ?? false;

  const anchors =
    options.anchors ??
    map.filter(t => t.type === 'BASE' || t.type === 'BANK').map(t => ({ x: t.x, y: t.y }));

  const channelCount = map.filter(t => isChannelTerrain(t.type)).length;
  const placed: PlacedBridgeSpan[] = [];

  if (channelCount > 0) {
    const { comp, sizes, count } = computeLandComponents(map, size);

    // Union-Find over land components
    const uf = Array.from({ length: count }, (_, idx) => idx);
    const find = (x: number): number => {
      while (uf[x] !== x) {
        uf[x] = uf[uf[x]];
        x = uf[x];
      }
      return x;
    };
    const unite = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) uf[ra] = rb;
    };

    const anchorComps = new Set<number>();
    for (const a of anchors) {
      const c = anchorComponent(map, size, comp, a);
      if (c !== -1) anchorComps.add(c);
    }

    const candidates = scanBridgeCandidates(map, size, maxSpan, rng);

    const candKey = (c: SpanCandidate): string => {
      const ids = c.tiles.map(t => t.id).sort();
      return `${c.bridgeType}:${ids.join(';')}`;
    };
    const candByKey = new Map<string, SpanCandidate>();
    for (const c of candidates) candByKey.set(candKey(c), c);

    const mirrorOf = (c: SpanCandidate): SpanCandidate | null => {
      if (!mirror180) return null;
      const mIds = c.tiles.map(t => `${size - 1 - t.x},${size - 1 - t.y}`).sort();
      const mk = `${c.bridgeType}:${mIds.join(';')}`;
      if (mk === candKey(c)) return null; // self-symmetric center crossing
      return candByKey.get(mk) ?? null;
    };

    const spansTouch = (a: SpanCandidate, b: SpanCandidate): boolean => {
      for (const ta of a.tiles) {
        for (const tb of b.tiles) {
          if (Math.abs(ta.x - tb.x) + Math.abs(ta.y - tb.y) <= 1) return true;
        }
      }
      return false;
    };

    const canCommit = (cand: SpanCandidate, spacing: number): { ok: boolean; mirror: SpanCandidate | null } => {
      if (conflictsWithExistingBridges(map, size, cand, placed, spacing)) return { ok: false, mirror: null };
      if (!mirror180) return { ok: true, mirror: null };
      const mIds = cand.tiles.map(t => `${size - 1 - t.x},${size - 1 - t.y}`).sort();
      const mk = `${cand.bridgeType}:${mIds.join(';')}`;
      if (mk === candKey(cand)) return { ok: true, mirror: null }; // self-symmetric
      const m = mirrorOf(cand);
      if (!m) return { ok: false, mirror: null };
      if (spansTouch(cand, m)) return { ok: false, mirror: null };
      if (conflictsWithExistingBridges(map, size, m, placed, spacing)) return { ok: false, mirror: null };
      return { ok: true, mirror: m };
    };

    const commitSpan = (cand: SpanCandidate, mirror: SpanCandidate | null) => {
      placed.push(stampSpan(cand));
      const ca = comp[cand.shoreA.y * size + cand.shoreA.x];
      const cb = comp[cand.shoreB.y * size + cand.shoreB.x];
      if (ca !== -1 && cb !== -1) unite(ca, cb);
      if (mirror) {
        placed.push(stampSpan(mirror));
        const mca = comp[mirror.shoreA.y * size + mirror.shoreA.x];
        const mcb = comp[mirror.shoreB.y * size + mirror.shoreB.x];
        if (mca !== -1 && mcb !== -1) unite(mca, mcb);
      }
    };

    // Pass 1: Connect distinct land components (MST-style, prioritizing HQ/Bank islands & larger landmasses)
    for (const spacing of [baseMinSpacing, Math.max(2, baseMinSpacing - 1), 1]) {
      let progress = true;
      while (progress) {
        progress = false;
        let best: { cand: SpanCandidate; mirror: SpanCandidate | null } | null = null;
        let bestScore = -Infinity;

        for (const cand of candidates) {
          const ca = comp[cand.shoreA.y * size + cand.shoreA.x];
          const cb = comp[cand.shoreB.y * size + cand.shoreB.x];
          if (ca === -1 || cb === -1 || find(ca) === find(cb)) continue;
          // Ignore tiny 1–2 tile decorative sandbars unless they carry an anchor
          const sigA = anchorComps.has(ca) || sizes[ca] >= 4;
          const sigB = anchorComps.has(cb) || sizes[cb] >= 4;
          if (!sigA || !sigB) continue;
          const check = canCommit(cand, spacing);
          if (!check.ok) continue;

          const priorityBoost = (anchorComps.has(ca) ? 25 : 0) + (anchorComps.has(cb) ? 25 : 0);
          const score = cand.baseScore + priorityBoost;
          if (score > bestScore) {
            bestScore = score;
            best = { cand, mirror: check.mirror };
          }
        }

        if (best) {
          commitSpan(best.cand, best.mirror);
          progress = true;
        }
      }
    }

    // Pass 2: Add flanking / loop bridges across waterways so crossings never feel single-choke
    const autoTarget = Math.max(
      2,
      Math.min(Math.round(size * 0.45), Math.round(channelCount / 14) + 1),
    );
    const targetBridges = options.targetBridges ?? autoTarget;
    const flankSpacing = Math.max(baseMinSpacing, size >= 24 ? 5 : 4);

    // Sort remaining candidates by quality score
    const sorted = [...candidates].sort((a, b) => b.baseScore - a.baseScore);
    for (const cand of sorted) {
      if (placed.length >= targetBridges) break;
      const check = canCommit(cand, flankSpacing);
      if (!check.ok) continue;
      // Only add bridges connecting meaningful land on both sides (skip micro islets)
      const ca = comp[cand.shoreA.y * size + cand.shoreA.x];
      const cb = comp[cand.shoreB.y * size + cand.shoreB.x];
      if (ca === -1 || cb === -1) continue;
      if (sizes[ca] < 4 || sizes[cb] < 4) continue;
      commitSpan(cand, check.mirror);
    }
  }

  // Pass 3: Guaranteed orthogonal connectivity between every anchor (HQs & Banks)
  if (anchors.length >= 2) {
    const origin = anchors[0];
    for (let i = 1; i < anchors.length; i++) {
      const target = anchors[i];
      const { comp } = computeLandComponents(map, size);
      const originComp = anchorComponent(map, size, comp, origin);
      const targetComp = anchorComponent(map, size, comp, target);
      if (originComp !== -1 && originComp === targetComp) continue;
      const beforeTypes = mirror180 ? map.map(t => t.type) : null;
      carveOrthogonalFallbackPath(map, size, origin, target, groundTypeAt, allowCarveObstacles);
      if (mirror180 && beforeTypes) {
        // Mirror every tile altered by fallback (bridges AND cleared/shore tiles) to keep 180° symmetry
        for (let idx = 0; idx < map.length; idx++) {
          if (map[idx].type === beforeTypes[idx]) continue;
          const t = map[idx];
          const mt = atGrid(map, size, size - 1 - t.x, size - 1 - t.y);
          if (!mt || mt.type === 'BASE' || mt.type === 'BANK') continue;
          mt.type = t.type;
          mt.height = t.height;
          mt.subType = undefined;
          mt.owner = undefined;
          mt.loot = null;
        }
      }
    }
  }

  return placed;
};

export interface BridgeAuditIssue {
  x: number;
  y: number;
  type: BridgeType;
  reason: string;
}

/**
 * Audits every bridge tile on a map to verify clean shore-to-shore axis alignment.
 * Used by automated tests to ensure zero inverted or dead-end bridges ever ship.
 */
export const auditBridgeOrientation = (map: Tile[], size: number): BridgeAuditIssue[] => {
  const issues: BridgeAuditIssue[] = [];
  const isEnd = (t: Tile | null, sameBridge: BridgeType): boolean =>
    !!t && (t.type === sameBridge || isWalkableShore(t) || t.type === 'BASE' || t.type === 'BANK');

  for (const t of map) {
    if (t.type !== 'BRIDGE' && t.type !== 'BRIDGE_V') continue;
    if (t.type === 'BRIDGE') {
      // Horizontal crossing: must continue E–W toward land on both West and East ends
      const west = atGrid(map, size, t.x - 1, t.y);
      const east = atGrid(map, size, t.x + 1, t.y);
      if (!isEnd(west, 'BRIDGE') || !isEnd(east, 'BRIDGE')) {
        issues.push({
          x: t.x,
          y: t.y,
          type: 'BRIDGE',
          reason: `Horizontal BRIDGE at (${t.x},${t.y}) dead-ends into ${west?.type ?? 'OOB'} / ${east?.type ?? 'OOB'}`,
        });
      }
    } else {
      // Vertical crossing: must continue N–S toward land on both North and South ends
      const north = atGrid(map, size, t.x, t.y - 1);
      const south = atGrid(map, size, t.x, t.y + 1);
      if (!isEnd(north, 'BRIDGE_V') || !isEnd(south, 'BRIDGE_V')) {
        issues.push({
          x: t.x,
          y: t.y,
          type: 'BRIDGE_V',
          reason: `Vertical BRIDGE_V at (${t.x},${t.y}) dead-ends into ${north?.type ?? 'OOB'} / ${south?.type ?? 'OOB'}`,
        });
      }
    }
  }
  return issues;
};

/** A land area this small is a stone — a landing there needs another crossing to be worth it. */
const MIN_LAND_AREA = 3;

/**
 * Finds bridge-to-nowhere crossings. A crossing is a contiguous run of one deck type; it is judged by
 * its two end landings, never by interior deck tiles (which have water on both perpendicular sides by
 * construction). It is a stub when an end landing is missing, or when that landing is a *dead-end
 * stone*: a land area under MIN_LAND_AREA tiles with no Base/Bank and no other crossing on it.
 * Terrain placed after bridges (mountains, banks, buildings) can seal a landing that looked open when
 * the deck went down, so this is evaluated on the finished map. Evaluation repeats to a fixed point,
 * because taking out one stub can leave another crossing's stone without a second crossing.
 */
const findStubRuns = (map: Tile[], size: number): Tile[][] => {
  const removed = new Set<string>();
  const stubRuns: Tile[][] = [];
  for (let pass = 0; pass < 8; pass++) {
    // Land areas, counted without decks, so a stone does not look like a continent.
    const comp = new Int32Array(size * size).fill(-1);
    const sizes: number[] = [];
    const hasPlace: boolean[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = y * size + x;
        if (comp[idx] !== -1 || !isWalkableShore(map[idx])) continue;
        const cid = sizes.length;
        let n = 0;
        let place = false;
        const stack = [idx];
        comp[idx] = cid;
        while (stack.length) {
          const cur = stack.pop()!;
          n++;
          const cx = cur % size;
          const cy = (cur - cx) / size;
          for (const [dx, dy] of DIRS_4) {
            const nb = atGrid(map, size, cx + dx, cy + dy);
            if (!nb) continue;
            if (nb.type === 'BASE' || nb.type === 'BANK') place = true;
            if (!isWalkableShore(nb)) continue;
            const ni = nb.y * size + nb.x;
            if (comp[ni] !== -1) continue;
            comp[ni] = cid;
            stack.push(ni);
          }
        }
        sizes.push(n);
        hasPlace.push(place);
      }
    }

    // Group decks into contiguous runs of one type, then note which land areas each run touches.
    const runs: Tile[][] = [];
    const onRun = new Set<string>();
    for (const deck of map) {
      if (!isBridgeTerrain(deck.type) || removed.has(deck.id) || onRun.has(deck.id)) continue;
      const ax = deck.type === 'BRIDGE' ? 1 : 0;
      const ay = deck.type === 'BRIDGE' ? 0 : 1;
      let sx = deck.x;
      let sy = deck.y;
      for (;;) {
        const prev = atGrid(map, size, sx - ax, sy - ay);
        if (!prev || prev.type !== deck.type || removed.has(prev.id)) break;
        sx -= ax;
        sy -= ay;
      }
      const run: Tile[] = [];
      let cx = sx;
      let cy = sy;
      for (;;) {
        const t = atGrid(map, size, cx, cy);
        if (!t || t.type !== deck.type || removed.has(t.id) || onRun.has(t.id)) break;
        onRun.add(t.id);
        run.push(t);
        cx += ax;
        cy += ay;
      }
      if (run.length > 0) runs.push(run);
    }

    const compRuns: Array<Set<number>> = sizes.map(() => new Set<number>());
    runs.forEach((run, i) => {
      const touched = new Set<number>();
      for (const t of run) {
        for (const [dx, dy] of DIRS_4) {
          const nb = atGrid(map, size, t.x + dx, t.y + dy);
          if (!nb) continue;
          const c = comp[nb.y * size + nb.x];
          if (c !== -1) touched.add(c);
        }
      }
      touched.forEach(c => compRuns[c].add(i));
    });

    const viableComp = (c: number): boolean =>
      c === -1 || sizes[c] >= MIN_LAND_AREA || hasPlace[c] || compRuns[c].size >= 2;

    let changed = false;
    for (const run of runs) {
      const ax = run[0].type === 'BRIDGE' ? 1 : 0;
      const ay = run[0].type === 'BRIDGE' ? 0 : 1;
      const first = run[0];
      const last = run[run.length - 1];
      const landing = (t: Tile, dir: number): Tile | null => {
        const nb = atGrid(map, size, t.x + ax * dir, t.y + ay * dir);
        return nb && !isBridgeTerrain(nb.type) && isWalkableShore(nb) ? nb : null;
      };
      const ends = [landing(first, -1), landing(last, 1)];
      const servesPlace = run.some(t =>
        DIRS_4.some(([dx, dy]) => {
          const nb = atGrid(map, size, t.x + dx, t.y + dy);
          return !!nb && (nb.type === 'BASE' || nb.type === 'BANK');
        }),
      );
      const viable = servesPlace || ends.every(sh => sh !== null && viableComp(comp[sh.y * size + sh.x]));
      if (viable) continue;
      for (const t of run) removed.add(t.id);
      stubRuns.push(run);
      changed = true;
    }
    if (!changed) break;
  }
  return stubRuns;
};

/** Every deck tile that belongs to a bridge to nowhere. */
export const findStubBridges = (map: Tile[], size: number): Tile[] =>
  findStubRuns(map, size).flat();

/** How many Bases/Banks can be reached on foot from the first one (some maps start with a pocket). */
const reachableAnchors = (map: Tile[], size: number): number => {
  const anchors = map.filter(t => t.type === 'BASE' || t.type === 'BANK');
  if (anchors.length < 2) return anchors.length;
  const seen = new Set<string>();
  const stack: Tile[] = [];
  for (const [dx, dy] of DIRS_4) {
    const nb = atGrid(map, size, anchors[0].x + dx, anchors[0].y + dy);
    if (nb && isFootPassable(nb) && !seen.has(nb.id)) {
      seen.add(nb.id);
      stack.push(nb);
    }
  }
  while (stack.length) {
    const c = stack.pop()!;
    for (const [dx, dy] of DIRS_4) {
      const nb = atGrid(map, size, c.x + dx, c.y + dy);
      if (!nb || seen.has(nb.id) || !isFootPassable(nb)) continue;
      seen.add(nb.id);
      stack.push(nb);
    }
  }
  return anchors.filter(a =>
    DIRS_4.some(([dx, dy]) => {
      const nb = atGrid(map, size, a.x + dx, a.y + dy);
      return !!nb && seen.has(nb.id);
    }),
  ).length;
};

/**
 * Turns bridges to nowhere back into channel, one crossing at a time. A crossing that would cost a
 * Base or Bank its route is put back: a cosmetic clean-up must never disconnect the map.
 * Returns the decks that were removed.
 */
export const pruneDeadEndBridges = (map: Tile[], size: number): Tile[] => {
  const removed: Tile[] = [];
  // A map can already ship with an unreachable pocket; only *new* damage counts against a removal.
  const baselineReach = reachableAnchors(map, size);
  // Repeat: removing one crossing can leave another one's landing as a dead-end stone, and a
  // crossing the connectivity guard puts back may be judged again once its neighbours are gone.
  for (let round = 0; round < 4; round++) {
    const runs = findStubRuns(map, size);
    if (runs.length === 0) break;
    let removedThisRound = 0;
    for (const run of runs) {
      const snapshot = run.map(t => t.type);
      for (const deck of run) {
        const canyonNeighbour = DIRS_4.some(([dx, dy]) => atGrid(map, size, deck.x + dx, deck.y + dy)?.type === 'CANYON');
        deck.type = canyonNeighbour ? 'CANYON' : 'WATER';
        deck.height = 0;
        deck.subType = undefined;
        deck.owner = undefined;
        deck.loot = null;
      }
      if (reachableAnchors(map, size) >= baselineReach) {
        removed.push(...run);
        removedThisRound++;
        continue;
      }
      run.forEach((t, i) => {
        t.type = snapshot[i];
        t.height = 1;
      });
    }
    if (removedThisRound === 0) break;
  }
  return removed;
};
