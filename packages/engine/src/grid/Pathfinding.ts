
import { Tile, Unit, UnitRank, UnitType, WeatherState } from '../types';
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
      if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
        const candidate = mapData[y * gridSize + x];
        if (candidate && candidate.id === id) return candidate;
      }
    }
  }
  return mapData.find(t => t.id === id);
};

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

export const getManhattanDistance = (t1: Tile, t2: Tile): number => {
  return Math.abs(t1.x - t2.x) + Math.abs(t1.y - t2.y);
};

// Check if a tile is visible under current weather conditions
const isTileVisibleInWeather = (start: Tile, end: Tile, weatherState: WeatherState): boolean => {
  const dist = getManhattanDistance(start, end);
  
  // Determine weather at the *viewer's* location (Start Tile)
  // Use the Voronoi zone of the start tile
  const zoneId = start.zone !== undefined ? start.zone : -1;
  const weather = zoneId >= 0 && weatherState.playerZones[zoneId] ? weatherState.playerZones[zoneId] : 'CLEAR';

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
  options: { blockBarriers?: boolean; checkTargetWeather?: boolean } = {}
): boolean => {
  // 1. Check Weather Visibility first
  if (!isTileVisibleInWeather(start, end, weatherState)) return false;
  if (options.checkTargetWeather && !isTileVisibleInWeather(end, start, weatherState)) return false;

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
       if (options.blockBarriers && tile.type === 'BARRIER' && tile.id !== start.id && tile.id !== end.id) {
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
  return traceLineOfSight(start, end, mapData, weatherState, gridSize, {
    blockBarriers: true,
    checkTargetWeather: true
  });
};

const getWeatherMoveCost = (
    tile: Tile,
    unitType: UnitType,
    baseCost: number,
    weatherState: WeatherState,
    unitRank: UnitRank = 0
): number => {
    // 1. Identify Weather
    const zoneId = tile.zone !== undefined ? tile.zone : -1;
    const weather = zoneId >= 0 && weatherState.playerZones[zoneId] ? weatherState.playerZones[zoneId] : 'CLEAR';
    
    const ignorePlainsSlow = unitType === 'SOLDIER' && unitRank >= 2;

    // 2. Apply Effects
    if (tile.type === 'PLAINS') {
        if (weather === 'SCORCHED' && !ignorePlainsSlow) return 2;
        if (weather === 'MONSOON' && unitType === 'ASSAULTER') return 2;
        if (weather === 'TAILWIND') return 0.5;
    }
    
    // SCORCHED increases cost on SAND too
    if (tile.type === 'SAND' && weather === 'SCORCHED') {
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
    if (unitType === 'SNIPER' && tile.type === 'BUILDING' && tile.owner !== currentPlayer) return null;

    // Ace Sniper climbs high ground effortlessly (1 CP per Mountain/Dunes tile)
    if (unitType === 'SNIPER' && unitRank >= 3 && (tile.type === 'MOUNTAIN' || tile.type === 'DUNES')) {
        return 1;
    }

    const terrainBaseCost = TERRAIN_COSTS[tile.type];
    if (terrainBaseCost >= 90) return null;

    const terrainMod = getWeatherMoveCost(tile, unitType, terrainBaseCost, weatherState, unitRank);
    return terrainMod * UNIT_STATS[unitType].moveCost;
};

const runDijkstra = (
  startTile: Tile,
  currentGlobalCp: number,
  mapData: Tile[],
  units: Unit[],
  unitType: UnitType,
  currentPlayer: number,
  weatherState: WeatherState,
  gridSize: number,
  unitRank: UnitRank = 0
): { validMoves: Map<string, number>; parents: Map<string, string> } => {
  const validMoves = new Map<string, number>();
  const parents = new Map<string, string>();
  
  // ROOTED CHECK (From Quicksand)
  const myUnit = units.find(u => u.tileId === startTile.id);
  if (myUnit && myUnit.isRooted) {
      return { validMoves, parents };
  }

  const visited = new Map<string, number>(); 
  const queue: MoveNode[] = [{ x: startTile.x, y: startTile.y, cost: 0 }];
  
  const occupiedTiles = new Set(units.map(u => u.tileId));
  occupiedTiles.delete(startTile.id);

  // Enemies block movement
  const enemyTiles = new Set(units.filter(u => u.owner !== currentPlayer).map(u => u.tileId));

  visited.set(startTile.id, 0);

  const directions = [{dx:0, dy:-1}, {dx:0, dy:1}, {dx:-1, dy:0}, {dx:1, dy:0}];

  while (queue.length > 0) {
    const current = heapPop(queue);
    if (!current) break;
    const currentId = `${current.x},${current.y}`;
    if (current.cost > (visited.get(currentId) ?? Infinity)) continue;

    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const nId = `${nx},${ny}`;

      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;

      const tileIndex = ny * gridSize + nx;
      const tile = mapData[tileIndex];
      if (!tile) continue;

      const moveCost = getStepCost(tile, unitType, currentPlayer, weatherState, unitRank);
      if (moveCost === null) continue;

      const newCost = current.cost + moveCost;

      if (newCost > currentGlobalCp) continue;
      if (enemyTiles.has(nId)) continue;
      if (visited.has(nId) && visited.get(nId)! <= newCost) continue;

      visited.set(nId, newCost);
      parents.set(nId, currentId);
      if (!occupiedTiles.has(nId)) {
        validMoves.set(nId, newCost);
      }
      heapPush(queue, { x: nx, y: ny, cost: newCost });
    }
  }

  return { validMoves, parents };
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
  unitRank: UnitRank = 0
): { validMoves: Map<string, number>; parents: Map<string, string> } => {
  return runDijkstra(startTile, currentGlobalCp, mapData, units, unitType, currentPlayer, weatherState, gridSize, unitRank);
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
  return runDijkstra(startTile, currentGlobalCp, mapData, units, unitType, currentPlayer, weatherState, gridSize, unitRank).validMoves;
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
  const { validMoves, parents } = runDijkstra(
      startTile,
      currentGlobalCp,
      mapData,
      units,
      unitType,
      currentPlayer,
      weatherState,
      gridSize,
      unitRank
  );
  return reconstructMovePathFromParents(startTile, targetTileId, validMoves, parents, mapData, gridSize);
};

export const calculateVisibility = (player: number, units: Unit[], mapData: Tile[], weather: WeatherState, fogEnabled: boolean, gridSize: number): Set<string> => {
    const visible = new Set<string>();
    if (!fogEnabled) {
        return visible; 
    }
    
    const myUnits = units.filter(u => u.owner === player);
    
    myUnits.forEach(unit => {
        const uTile = getTileByIdFast(mapData, unit.tileId, gridSize);
        if (!uTile) return;
        let vision = getUnitVision(unit);
        
        // Sandstorm reduces all vision
        const zoneId = uTile.zone !== undefined ? uTile.zone : -1;
        const wType = zoneId >= 0 ? weather.playerZones[zoneId] : 'CLEAR';
        if (wType === 'SANDSTORM') {
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
                    if (targetTile) {
                        if (hasLineOfSight(uTile, targetTile, mapData, unit.type, weather, gridSize)) {
                            visible.add(targetTile.id);
                        }
                    }
                }
            }
        }
    });
    
    mapData.filter(t => (t.type === 'BASE' || t.type === 'BUILDING') && t.owner === player).forEach(b => {
        visible.add(b.id);
        const adj = [{x:0,y:1}, {x:0,y:-1}, {x:1,y:0}, {x:-1,y:0},{x:1,y:1}, {x:1,y:-1}, {x:-1,y:1}, {x:-1,y:-1}];
        adj.forEach(d => {
            const tx = b.x + d.x; 
            const ty = b.y + d.y;
            if(tx >= 0 && tx < gridSize && ty >= 0 && ty < gridSize) visible.add(`${tx},${ty}`);
        });
    });
    return visible;
};

/** The four tiles next to `tile` (fewer at the map's edge). */
export const getNeighbors = (tile: Tile, map: Tile[], gridSize?: number): Tile[] => {
    const out: Tile[] = [];
    if (gridSize && gridSize > 0 && map.length === gridSize * gridSize) {
        const { x, y } = tile;
        if (x + 1 < gridSize) {
            const t = map[y * gridSize + (x + 1)];
            if (t) out.push(t);
        }
        if (x - 1 >= 0) {
            const t = map[y * gridSize + (x - 1)];
            if (t) out.push(t);
        }
        if (y + 1 < gridSize) {
            const t = map[(y + 1) * gridSize + x];
            if (t) out.push(t);
        }
        if (y - 1 >= 0) {
            const t = map[(y - 1) * gridSize + x];
            if (t) out.push(t);
        }
        return out;
    }
    const r = map.find(t => t.x === tile.x + 1 && t.y === tile.y);
    const l = map.find(t => t.x === tile.x - 1 && t.y === tile.y);
    const d = map.find(t => t.x === tile.x && t.y === tile.y + 1);
    const u = map.find(t => t.x === tile.x && t.y === tile.y - 1);
    if (r) out.push(r);
    if (l) out.push(l);
    if (d) out.push(d);
    if (u) out.push(u);
    return out;
};
