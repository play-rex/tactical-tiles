/**
 * Archipelago carve, shared by the shipped generator and the dev sandbox.
 *
 * Island boards are not "three rivers": an elevation field is raised out of every HQ, a contested
 * centre island and (at higher island counts) flanking islets; the lowest tiles are then flooded up
 * to the requested sea share and the coastline is smoothed twice. Keeping the carve in one place
 * means a dev audition of ARCHIPELAGO shows the same island chains a real match does.
 */
import type { Tile } from '../types';

const DIRS_4: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface ArchipelagoOptions {
  map: Tile[];
  size: number;
  /** HQ slots, kept dry in a 5×5 plaza. */
  slots: ReadonlyArray<{ x: number; y: number }>;
  playerCount: number;
  /** Extra island rings from the generator's `rivers` knob (1–3). */
  rings: number;
  /** Sea-volume knob (0–30). */
  waterPct: number;
  /** Which diagonal the 2P flanking islets sit on. */
  flip: boolean;
  /** Keep the field 180° rotationally symmetric. */
  mirrored: boolean;
  /** Value noise in [0,1] that roughens the coastline. */
  noise: (x: number, y: number) => number;
  /** Returns a tile that turned out to be a puddle back to its dry ground. */
  restoreGround: (t: Tile) => void;
}

/** Sea share flooded for a `waterPct` knob — the curve the shipped Archipelago preset uses. */
export const archipelagoSeaShare = (waterPct: number): number =>
  Math.min(0.48, Math.max(0.18, 0.16 + waterPct * 0.011));

export const carveArchipelago = (opts: ArchipelagoOptions): void => {
  const { map, size, slots, playerCount, rings, waterPct, flip, mirrored, noise } = opts;
  const totalTiles = size * size;
  const center = (size - 1) / 2;

  const at = (x: number, y: number): Tile | null =>
    x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null;
  const inBasePlaza = (x: number, y: number, radius = 2): boolean =>
    slots.some(s => Math.abs(s.x - x) <= radius && Math.abs(s.y - y) <= radius);
  const mirrorOf = (t: Tile): Tile => map[(size - 1 - t.y) * size + (size - 1 - t.x)];

  const flood = (x: number, y: number) => {
    const t = at(x, y);
    if (!t || inBasePlaza(t.x, t.y, 2)) return;
    t.type = 'WATER';
    t.height = 0;
    if (mirrored) {
      const mt = mirrorOf(t);
      if (!inBasePlaza(mt.x, mt.y, 2)) {
        mt.type = 'WATER';
        mt.height = 0;
      }
    }
  };

  // Home islands around every HQ + a central treasury island + optional flanking islets.
  const islandCenters: Array<{ x: number; y: number; radius: number; weight: number }> = [];
  const homeRadius = Math.max(3.6, size * 0.21);
  for (const s of slots) {
    islandCenters.push({ x: s.x, y: s.y, radius: homeRadius, weight: 1.0 });
  }
  islandCenters.push({ x: center, y: center, radius: Math.max(2.8, size * 0.16), weight: 0.78 });

  if (playerCount === 2) {
    const offA = flip ? { x: 4, y: 4 } : { x: size - 5, y: 4 };
    const offB = flip ? { x: size - 5, y: size - 5 } : { x: 4, y: size - 5 };
    if (rings >= 2) {
      islandCenters.push({ x: offA.x, y: offA.y, radius: Math.max(2.7, size * 0.15), weight: 0.72 });
      islandCenters.push({ x: offB.x, y: offB.y, radius: Math.max(2.7, size * 0.15), weight: 0.72 });
    }
  } else if (rings >= 3 && size >= 24) {
    const mid = Math.floor(size / 2);
    islandCenters.push({ x: mid, y: 4, radius: 3.1, weight: 0.68 });
    islandCenters.push({ x: mid, y: size - 5, radius: 3.1, weight: 0.68 });
  }

  const elev = new Float64Array(totalTiles);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bestPeak = 0;
      let secondPeak = 0;
      for (const ic of islandCenters) {
        const d = Math.hypot(x - ic.x, y - ic.y);
        const contrib = ic.weight * Math.exp(-(d * d) / (2 * ic.radius * ic.radius));
        if (contrib > bestPeak) {
          secondPeak = bestPeak;
          bestPeak = contrib;
        } else if (contrib > secondPeak) {
          secondPeak = contrib;
        }
      }
      // Subtle strait trough where two islands meet so the channels open cleanly between them.
      const saddlePenalty = secondPeak > 0.22 ? secondPeak * 0.65 : 0;
      const n = noise(x * 0.28 + 5.1, y * 0.28 - 3.7) * 0.34;
      elev[y * size + x] = bestPeak - saddlePenalty + n;
    }
  }

  if (mirrored) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const mi = (size - 1 - y) * size + (size - 1 - x);
        if (i <= mi) {
          const avg = (elev[i] + elev[mi]) * 0.5;
          elev[i] = avg;
          elev[mi] = avg;
        }
      }
    }
  }

  const seaTarget = Math.round(totalTiles * archipelagoSeaShare(waterPct));
  const ranked = map
    .filter(t => !inBasePlaza(t.x, t.y, 2))
    .map(t => ({ tile: t, e: elev[t.y * size + t.x] }))
    .sort((a, b) => a.e - b.e);

  for (let i = 0; i < Math.min(seaTarget, ranked.length); i++) {
    flood(ranked[i].tile.x, ranked[i].tile.y);
  }

  // Two gentle coastline smoothing passes remove stray 1-tile puddles and pinprick islets.
  for (let pass = 0; pass < 2; pass++) {
    const toLand: Tile[] = [];
    const toWater: Tile[] = [];
    for (const t of map) {
      if (inBasePlaza(t.x, t.y, 2)) continue;
      let waterNeighbors = 0;
      let totalNeighbors = 0;
      for (const [dx, dy] of DIRS_4) {
        const nb = at(t.x + dx, t.y + dy);
        if (!nb) continue;
        totalNeighbors++;
        if (nb.type === 'WATER') waterNeighbors++;
      }
      if (t.type === 'WATER' && waterNeighbors <= 1) toLand.push(t);
      else if (t.type !== 'WATER' && totalNeighbors === 4 && waterNeighbors >= 3) toWater.push(t);
    }
    for (const t of toLand) opts.restoreGround(t);
    for (const t of toWater) {
      t.type = 'WATER';
      t.height = 0;
    }
  }
};
