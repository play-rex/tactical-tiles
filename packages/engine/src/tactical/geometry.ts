/**
 * Footprints for tactical weapons. Everything is resolved against the board here, so the shop
 * preview, the validator and the engine agree on the exact tiles.
 */
import type { TacticalAxis, TacticalId, Tile } from '../types';
import { TACTICAL_ITEMS } from './catalog';

const tileAt = (mapData: Tile[], gridSize: number, x: number, y: number): Tile | undefined => {
  if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return undefined;
  return mapData[y * gridSize + x];
};

/** A straight run from the anchor: H walks +x, V walks +y. */
export const tilesAlong = (
  mapData: Tile[],
  gridSize: number,
  anchorId: string,
  axis: TacticalAxis,
  length: number,
  width = 1,
): Tile[] | null => {
  const anchor = mapData.find(t => t.id === anchorId);
  if (!anchor) return null;
  const out: Tile[] = [];
  for (let step = 0; step < length; step++) {
    for (let side = 0; side < width; side++) {
      const x = anchor.x + (axis === 'H' ? step : side);
      const y = anchor.y + (axis === 'H' ? side : step);
      const tile = tileAt(mapData, gridSize, x, y);
      if (!tile) return null;
      out.push(tile);
    }
  }
  return out;
};

export const zoneTiles = (mapData: Tile[], gridSize: number, anchorId: string): Tile[] | null => {
  const anchor = mapData.find(t => t.id === anchorId);
  if (!anchor) return null;
  const out: Tile[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tile = tileAt(mapData, gridSize, anchor.x + dx, anchor.y + dy);
      if (tile) out.push(tile);
    }
  }
  return out.length > 0 ? out : null;
};

/** Every tile the weapon would touch; empty for self-buffs, null when it does not fit. */
export const tacticalTilesFor = (
  mapData: Tile[],
  gridSize: number,
  itemKey: TacticalId,
  tileId?: string,
  axis?: TacticalAxis,
  _width?: 1 | 2,
  tileIds?: string[],
): Tile[] | null => {
  const shape = TACTICAL_ITEMS[itemKey].shape;
  if (shape === 'NONE') return [];
  if (shape === 'UNITS3') {
    const ids = tileIds && tileIds.length > 0 ? Array.from(new Set(tileIds)) : tileId ? [tileId] : [];
    if (ids.length === 0) return null;
    const out: Tile[] = [];
    for (const id of ids) {
      const t = mapData.find(tile => tile.id === id);
      if (!t) return null;
      out.push(t);
    }
    return out;
  }
  if (!tileId) return null;
  switch (shape) {
    case 'TILE':
    case 'UNIT':
    case 'RELOCATE':
      return mapData.filter(t => t.id === tileId);
    case 'ZONE3':
      return zoneTiles(mapData, gridSize, tileId);
    case 'LINE4':
      return axis ? tilesAlong(mapData, gridSize, tileId, axis, 4) : null;
    case 'LANE':
      // Artillery Barrage is always a 2×10 corridor.
      return axis ? tilesAlong(mapData, gridSize, tileId, axis, 10, 2) : null;
    default:
      return null;
  }
};

/** HQ tiles and their 8 neighbours: Artillery Barrage may never cover them (rule 10). */
export const hqExclusionTiles = (mapData: Tile[], gridSize: number): Set<string> => {
  const out = new Set<string>();
  for (const hq of mapData) {
    if (hq.type !== 'BASE') continue;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tile = tileAt(mapData, gridSize, hq.x + dx, hq.y + dy);
        if (tile) out.add(tile.id);
      }
    }
  }
  return out;
};

/**
 * Smoke blocks line of sight both ways. The engine's fog is radius-based, so this is the only
 * place smoke changes targeting: sniper shots, normal attacks and Overwatch lanes through it.
 */
export const smokeBlocksLine = (
  smokeZones: readonly { tiles: string[] }[] | undefined,
  from: Pick<Tile, 'x' | 'y'>,
  to: Pick<Tile, 'x' | 'y'>,
): boolean => {
  if (!smokeZones || smokeZones.length === 0) return false;
  const smoke = new Set<string>();
  for (const zone of smokeZones) for (const id of zone.tiles) smoke.add(id);
  if (smoke.size === 0) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return smoke.has(`${from.x},${from.y}`);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(from.x + (dx * i) / steps);
    const y = Math.round(from.y + (dy * i) / steps);
    if (smoke.has(`${x},${y}`)) return true;
  }
  return false;
};
