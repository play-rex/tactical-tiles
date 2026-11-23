
import { Tile, Unit, UnitRank, UnitType, WeatherState, WeatherType } from '../types';
import { TERRAIN_COSTS, UNIT_STATS } from '../constants/Config';
import { getUnitVision } from '../rules/CombatRules';

interface MoveNode {
  x: number;
  y: number;
  cost: number;
}

/** O(1) tile lookup by "x,y" id for row-major grids, falling back safely to linear scan. */
export const getTileByIdFast = (mapData: Tile[], id: string, gridSize?: number): Tile | undefined => {
  if (gridSize && gridSize > 0) {
    const comma = id.indexOf(',');
    if (comma > 0) {
      const x = Number(id.slice(0, comma));
      const y = Number(id.slice(comma + 1));
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
        const candidate = mapData[y * gridSize + x];
        if (candidate && candidate.id === id) return candidate;
      }
    }
  }
  return mapData.find(t => t.id === id);
};

const ORTHOGONAL_DIRS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

const KING_DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const heapPush = (heap: MoveNode[], node: MoveNode) => {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].cost <= heap[i].cost) break;
    const tmp = heap[p];
    heap[p] = heap[i];
    heap[i] = tmp;
    i = p;
  }
};

const heapPop = (heap: MoveNode[]): MoveNode | undefined => {
  const n = heap.length;
  if (n === 0) return undefined;
  const top = heap[0];
  const last = heap.pop()!;
  if (n > 1) {
    heap[0] = last;
    let i = 0;
    const len = heap.length;
    while (true) {
      let smallest = i;
      const l = (i << 1) + 1;
      const r = l + 1;
      if (l < len && heap[l].cost < heap[smallest].cost) smallest = l;
      if (r < len && heap[r].cost < heap[smallest].cost) smallest = r;
      if (smallest === i) break;
      const tmp = heap[i];
      heap[i] = heap[smallest];
      heap[smallest] = tmp;
      i = smallest;
    }
  }
  return top;
};

export const getManhattanDistance = (t1: { x: number; y: number }, t2: { x: number; y: number }): number => {
  return Math.abs(t1.x - t2.x) + Math.abs(t1.y - t2.y);
};

export const getMinManhattanDistance = (
  origin: { x: number; y: number },
  targets: readonly { x: number; y: number }[],
  fallback = 999
): number => {
  let min = fallback;
  for (let i = 0; i < targets.length; i++) {
    const d = getManhattanDistance(origin, targets[i]);
    if (d < min) min = d;
  }
  return min;
};

export const hasTileWithinRange = (
  origin: { x: number; y: number },
  targets: readonly { x: number; y: number }[],
  maxRange: number
): boolean => {
  for (let i = 0; i < targets.length; i++) {
    if (getManhattanDistance(origin, targets[i]) <= maxRange) return true;
  }
  return false;
};

/** Resolves the effective weather for a tile based on its zone. */
export const getTileWeather = (
  tile: Pick<Tile, 'zone'> | undefined,
  weatherState: WeatherState,
): WeatherType => {
  const zoneId = tile?.zone !== undefined ? tile.zone : -1;
  return zoneId >= 0 && weatherState.playerZones[zoneId] ? weatherState.playerZones[zoneId] : 'CLEAR';
};

// Check if a tile is visible under current weather conditions
const isTileVisibleInWeather = (start: Tile, end: Tile, weatherState: WeatherState): boolean => {
  const dist = getManhattanDistance(start, end);
  const weather = getTileWeather(start, weatherState);

  if (weather === 'FOG') {
    // Fog Cap: Max vision 2 tiles
    if (dist > 2) return false;
  }
  
  if (weather === 'SANDSTORM') {
      // Sandstorm Cap: Max vision 3 tiles
      if (dist > 3) return false;
  }
  
  return true;
};

const traceLineOfSight = (
  start: Tile,
  end: Tile,
  mapData: Tile[],
  weatherState: WeatherState,
  gridSize: number,
  blockBarriers = false,
  checkTargetWeather = false
): boolean => {
  // 1. Check Weather Visibility first
  if (!isTileVisibleInWeather(start, end, weatherState)) return false;
  if (checkTargetWeather && !isTileVisibleInWeather(end, start, weatherState)) return false;

  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = (x0 < x1) ? 1 : -1;
  const sy = (y0 < y1) ? 1 : -1;
  let err = dx - dy;

  const attackerHeight = start.height;

  while (true) {
    if (x0 === x1 && y0 === y1) break;

    const tileIdx = y0 * gridSize + x0;
    const tile = mapData[tileIdx];

    if (tile && (x0 !== start.x || y0 !== start.y)) {
       // Buildings always block LOS unless you are on top of one
       if (tile.type === 'BUILDING' && tile.id !== start.id && tile.id !== end.id) {
           return false;
       }
       // Barriers block Overwatch reaction lines
       if (blockBarriers && tile.type === 'BARRIER' && tile.id !== start.id && tile.id !== end.id) {
           return false;
       }

       if (tile.height > attackerHeight) {
           return false;
       }

       if (tile.type === 'MOUNTAIN' && attackerHeight < tile.height) {
           return false;
       }

       // DUNES block LOS (Height 2)
       if (tile.type === 'DUNES' && attackerHeight < tile.height) {
           return false;
       }
    }

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return true;
};

// Bresenham's Line Algorithm to check Line of Sight
export const hasLineOfSight = (start: Tile, end: Tile, mapData: Tile[], _unitType: UnitType, weatherState: WeatherState, gridSize: number): boolean => {
  return traceLineOfSight(start, end, mapData, weatherState, gridSize);
};

// Overwatch Line of Sight: additionally blocked by Barriers and bidirectional Fog/Sandstorm caps
export const hasOverwatchLineOfSight = (start: Tile, end: Tile, mapData: Tile[], _unitType: UnitType, weatherState: WeatherState, gridSize: number): boolean => {
  return traceLineOfSight(start, end, mapData, weatherState, gridSize, true, true);
};

const getWeatherMoveCost = (
    tile: Tile,
    unitType: UnitType,
    baseCost: number,
    weatherState: WeatherState,
    unitRank: UnitRank = 0
): number => {
    const weather = getTileWeather(tile, weatherState);
    const ignorePlainsSlow = unitType === 'SOLDIER' && unitRank >= 2;

    if (tile.type === 'PLAINS') {
        if (weather === 'SCORCHED' && !ignorePlainsSlow) return 2;
        if (weather === 'MONSOON' && !ignorePlainsSlow) return 2;
        if (weather === 'TAILWIND') return 0.5;
    }

    if (tile.type === 'SAND' && (weather === 'SCORCHED' || weather === 'SANDSTORM') && !ignorePlainsSlow) {
        return baseCost + 1;
    }

    return baseCost;
};

export const getStepCost = (
    tile: Tile,
    unitType: UnitType,
    currentPlayer: number,
    weatherState: WeatherState,
    unitRank: UnitRank = 0
): number | null => {
    if (tile.hazardState === 'LAVA') return null;
    if (tile.type === 'MOUNTAIN' && unitType !== 'SNIPER') return null;
    if (tile.type === 'BUILDING') {
        if (tile.owner !== currentPlayer) return null;
        if (tile.subType === 'WATCHTOWER' && unitType !== 'SNIPER') return null;
    }

    // Ace Sniper climbs high ground effortlessly (1 CP per Mountain/Dunes tile)
    if (unitType === 'SNIPER' && unitRank >= 3 && (tile.type === 'MOUNTAIN' || tile.type === 'DUNES')) {
        return 1;
    }

    const terrainBaseCost = TERRAIN_COSTS[tile.type];
    if (terrainBaseCost >= 90) return null;

    const terrainMod = getWeatherMoveCost(tile, unitType, terrainBaseCost, weatherState, unitRank);
    return terrainMod * UNIT_STATS[unitType].moveCost;
};

export const getValidMovesWithParents = (
  startTile: Tile,
  currentGlobalCp: number,
  mapData: Tile[],
  units: Unit[],
  unitType: UnitType,
  currentPlayer: number,
  weatherState: WeatherState,
  gridSize: number,
  unitRank: UnitRank = 0,
  stopAtTileId?: string
): { validMoves: Map<string, number>; parents: Map<string, string> } => {
  const validMoves = new Map<string, number>();
  const parents = new Map<string, string>();

  // ROOTED CHECK (From Quicksand)
  const myUnit = units.find(u => u.tileId === startTile.id);
  if (myUnit && myUnit.isRooted) {
      return { validMoves, parents };
  }

  const totalCells = gridSize * gridSize;
  const occupiedFlags = new Uint8Array(totalCells);
  const enemyFlags = new Uint8Array(totalCells);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const ut = getTileByIdFast(mapData, u.tileId, gridSize);
    if (!ut || ut.x < 0 || ut.x >= gridSize || ut.y < 0 || ut.y >= gridSize) continue;
    const idx = ut.y * gridSize + ut.x;
    if (u.tileId !== startTile.id) occupiedFlags[idx] = 1;
    if (u.owner !== currentPlayer) enemyFlags[idx] = 1;
  }

  if (stopAtTileId !== undefined) {
    if (stopAtTileId === startTile.id) return { validMoves, parents };
    const stopTile = getTileByIdFast(mapData, stopAtTileId, gridSize);
    if (!stopTile || stopTile.x < 0 || stopTile.x >= gridSize || stopTile.y < 0 || stopTile.y >= gridSize) {
      return { validMoves, parents };
    }
    const stopIdx = stopTile.y * gridSize + stopTile.x;
    if (occupiedFlags[stopIdx] || enemyFlags[stopIdx]) return { validMoves, parents };
    if (getStepCost(stopTile, unitType, currentPlayer, weatherState, unitRank) === null) {
      return { validMoves, parents };
    }
  }

  const visitedCosts = new Float64Array(totalCells);
  visitedCosts.fill(Infinity);
  const startIdx = startTile.y * gridSize + startTile.x;
  if (startIdx >= 0 && startIdx < totalCells) visitedCosts[startIdx] = 0;

  const queue: MoveNode[] = [{ x: startTile.x, y: startTile.y, cost: 0 }];

  while (queue.length > 0) {
    const current = heapPop(queue);
    if (!current) break;
    const currentIdx = current.y * gridSize + current.x;
    if (current.cost > visitedCosts[currentIdx]) continue;
    const currentTile = mapData[currentIdx];
    const currentId = currentTile ? currentTile.id : `${current.x},${current.y}`;
    if (stopAtTileId !== undefined && currentId === stopAtTileId) break;

    for (let d = 0; d < ORTHOGONAL_DIRS.length; d++) {
      const nx = current.x + ORTHOGONAL_DIRS[d][0];
      const ny = current.y + ORTHOGONAL_DIRS[d][1];
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;

      const tileIndex = ny * gridSize + nx;
      const tile = mapData[tileIndex];
      if (!tile || enemyFlags[tileIndex]) continue;

      const moveCost = getStepCost(tile, unitType, currentPlayer, weatherState, unitRank);
      if (moveCost === null) continue;

      const newCost = current.cost + moveCost;
      if (newCost > currentGlobalCp) continue;
      if (visitedCosts[tileIndex] <= newCost) continue;

      visitedCosts[tileIndex] = newCost;
      const nId = tile.id;
      parents.set(nId, currentId);
      if (!occupiedFlags[tileIndex]) {
        validMoves.set(nId, newCost);
      }
      heapPush(queue, { x: nx, y: ny, cost: newCost });
    }
  }

  return { validMoves, parents };
};

export const reconstructMovePathFromParents = (
  startTile: Tile,
  targetTileId: string,
  validMoves: Map<string, number>,
  parents: Map<string, string>,
  mapData: Tile[],
  gridSize: number
): Tile[] => {
  if (!validMoves.has(targetTileId)) return [];

  const path: Tile[] = [];
  let cursor: string | undefined = targetTileId;
  let guard = 0;
  const maxSteps = gridSize * gridSize;
  while (cursor && cursor !== startTile.id && guard < maxSteps) {
    const t = getTileByIdFast(mapData, cursor, gridSize);
    if (t) path.push(t);
    cursor = parents.get(cursor);
    guard++;
  }
  path.push(startTile);
  path.reverse();
  return path;
};

export const getValidMoves = (
  startTile: Tile,
  currentGlobalCp: number,
  mapData: Tile[],
  units: Unit[],
  unitType: UnitType,
  currentPlayer: number,
  weatherState: WeatherState,
  gridSize: number,
  unitRank: UnitRank = 0
): Map<string, number> => {
  return getValidMovesWithParents(startTile, currentGlobalCp, mapData, units, unitType, currentPlayer, weatherState, gridSize, unitRank).validMoves;
};

export const getMovePath = (
  startTile: Tile,
  targetTileId: string,
  currentGlobalCp: number,
  mapData: Tile[],
  units: Unit[],
  unitType: UnitType,
  currentPlayer: number,
  weatherState: WeatherState,
  gridSize: number,
  unitRank: UnitRank = 0
): Tile[] => {
  const { validMoves, parents } = getValidMovesWithParents(
      startTile,
      currentGlobalCp,
      mapData,
      units,
      unitType,
      currentPlayer,
      weatherState,
      gridSize,
      unitRank,
      targetTileId
  );
  return reconstructMovePathFromParents(startTile, targetTileId, validMoves, parents, mapData, gridSize);
};

export const calculateVisibility = (player: number, units: Unit[], mapData: Tile[], weather: WeatherState, fogEnabled: boolean, gridSize: number): Set<string> => {
    const visible = new Set<string>();
    if (!fogEnabled) {
        return visible; 
    }
    
    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        if (unit.owner !== player) continue;
        const uTile = getTileByIdFast(mapData, unit.tileId, gridSize);
        if (!uTile) continue;
        let vision = getUnitVision(unit);
        
        // Fog / Sandstorm reduce all vision
        const wType = getTileWeather(uTile, weather);
        if (wType === 'FOG') {
            vision = Math.min(vision, 2);
        } else if (wType === 'SANDSTORM') {
            vision = Math.min(vision, 3);
        }

        const range = vision; 
        visible.add(uTile.id);
        for (let y = -range; y <= range; y++) {
            for (let x = -range; x <= range; x++) {
                if (Math.abs(x) + Math.abs(y) > range) continue; 
                const tx = uTile.x + x;
                const ty = uTile.y + y;
                if (tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize) {
                    const targetTile = mapData[ty * gridSize + tx];
                    if (targetTile && !visible.has(targetTile.id)) {
                        if (hasLineOfSight(uTile, targetTile, mapData, unit.type, weather, gridSize)) {
                            visible.add(targetTile.id);
                        }
                    }
                }
            }
        }
    }
    
    for (let i = 0; i < mapData.length; i++) {
        const b = mapData[i];
        if ((b.type !== 'BASE' && b.type !== 'BUILDING') || b.owner !== player) continue;
        visible.add(b.id);
        for (let d = 0; d < KING_DIRS.length; d++) {
            const tx = b.x + KING_DIRS[d][0];
            const ty = b.y + KING_DIRS[d][1];
            if (tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize) {
                const nt = mapData[ty * gridSize + tx];
                visible.add(nt ? nt.id : `${tx},${ty}`);
            }
        }
    }
    return visible;
};

/** The four tiles next to `tile` (fewer at the map's edge). */
export const getNeighbors = (tile: Tile, map: Tile[], gridSize?: number): Tile[] => {
    const out: Tile[] = [];
    const useGrid = Boolean(gridSize && gridSize > 0 && map.length === gridSize * gridSize);
    for (let d = 0; d < ORTHOGONAL_DIRS.length; d++) {
        const nx = tile.x + ORTHOGONAL_DIRS[d][0];
        const ny = tile.y + ORTHOGONAL_DIRS[d][1];
        const t = useGrid
            ? (nx >= 0 && nx < gridSize! && ny >= 0 && ny < gridSize! ? map[ny * gridSize! + nx] : undefined)
            : map.find(candidate => candidate.x === nx && candidate.y === ny);
        if (t) out.push(t);
    }
    return out;
};
