/**
 * What a player may do right now. The web UI highlights these; the server checks actions
 * against them, so the two can never disagree.
 */
import { SHOP_ITEMS, UNIT_COSTS } from '../constants/Config';
import type { Tile, Unit, WeatherState } from '../types';
import {
  calculateVisibility,
  getManhattanDistance,
  getNeighbors,
  getTileByIdFast,
  getValidMovesWithParents,
  hasLineOfSight,
} from '../grid/Pathfinding';
import {
  canHoldDrop,
  canUnitAttackFromTile,
  getEffectiveMaxRespawns,
  getUnitAttackCost,
  getUnitRange,
} from '../rules/CombatRules';
import type { GameState } from './state';

/** CP that securing a building, robbing a bank or picking up supplies costs. */
export const INTERACT_COST = 4;

/**
 * Tiles `seat` can see. Empty when fog of war is off: then everything is visible (callers
 * check `settings.fogOfWar` before reading it, as the renderer does).
 */
export const visibleSet = (state: GameState, seat: number): Set<string> =>
  calculateVisibility(seat, state.units, state.mapData, state.weather, state.settings.fogOfWar, state.gridSize);

export const tileOf = (state: Pick<GameState, 'mapData' | 'gridSize'>, id: string) =>
  getTileByIdFast(state.mapData, id, state.gridSize);
const cpOf = (state: GameState) => state.playerCp[state.currentPlayer] ?? 0;

/** Whether `unit` is visible to `viewer` under current Fog of War rules. */
export const isUnitVisible = (
  unit: Pick<Unit, 'owner' | 'tileId'>,
  viewer: number,
  fogOfWar: boolean,
  visibleTiles: ReadonlySet<string>,
): boolean => !fogOfWar || unit.owner === viewer || visibleTiles.has(unit.tileId);

const moveGraphFor = (state: GameState, unit: Unit) => {
  const tile = tileOf(state, unit.tileId);
  const cp = cpOf(state);
  if (!tile || unit.hasMoved || cp <= 0 || unit.isRooted) {
    return { validMoves: new Map<string, number>(), parents: new Map<string, string | null>() };
  }
  return getValidMovesWithParents(tile, cp, state.mapData, state.units, unit.type, state.currentPlayer, state.weather, state.gridSize, unit.rank ?? 0);
};

/** Reachable tiles for `unit` and the CP each costs, as the current player. */
export const moveCostsFor = (state: GameState, unit: Unit): Map<string, number> =>
  moveGraphFor(state, unit).validMoves;

export interface AttackOptions {
  /** Enemy units in range and sight. */
  attackTargets: string[];
  /** Enemy bases (Conquer mode) and unbreached bank vaults in range. */
  siegeTiles: string[];
  /** Barriers in range. */
  demolishTiles: string[];
}

/**
 * What `unit` can shoot at from where it stands. `visible` is the current player's sight
 * (visibleSet); under fog, nothing outside it can be targeted.
 */
export const attackOptionsFor = (state: GameState, unit: Unit, visible: Set<string>): AttackOptions => {
  const { mapData, units, weather, gridSize, settings, currentPlayer } = state;
  const out: AttackOptions = { attackTargets: [], siegeTiles: [], demolishTiles: [] };
  const tile = tileOf(state, unit.tileId);
  if (!tile || cpOf(state) < getUnitAttackCost(unit) || unit.ammo <= 0 || !canUnitAttackFromTile(unit, tile)) return out;

  const range = getUnitRange(unit, mapData, weather, tile);
  const inReach = (t: Tile) =>
    getManhattanDistance(tile, t) <= range &&
    (!settings.fogOfWar || visible.has(t.id)) &&
    hasLineOfSight(tile, t, mapData, unit.type, weather, gridSize);

  for (const u of units) {
    if (u.owner === currentPlayer) continue;
    const t = tileOf(state, u.tileId);
    if (t && inReach(t)) out.attackTargets.push(u.id);
  }
  for (const t of mapData) {
    if ((t.hp || 0) <= 0) continue;
    if (t.type === 'BARRIER' && inReach(t)) out.demolishTiles.push(t.id);
    else if (settings.victoryMode === 'CONQUER' && t.type === 'BASE' && t.owner !== currentPlayer && inReach(t)) {
      out.siegeTiles.push(t.id);
    }
    else if (t.type === 'BANK' && (t.hackProgress || 0) < 100 && unit.type !== 'SNIPER' && inReach(t)) {
      out.siegeTiles.push(t.id);
    }
  }
  return out;
};

export interface InteractOptions {
  /** Buildings and supply drops on or beside the unit. Banks are breached by siege, not interaction. */
  secureTiles: string[];
  lootTiles: string[];
}

export const interactOptionsFor = (state: GameState, unit: Unit): InteractOptions => {
  const out: InteractOptions = { secureTiles: [], lootTiles: [] };
  const tile = tileOf(state, unit.tileId);
  if (!tile || cpOf(state) < INTERACT_COST) return out;
  for (const t of [tile, ...getNeighbors(tile, state.mapData, state.gridSize)]) {
    if (t.type === 'BUILDING' && t.owner !== state.currentPlayer) out.secureTiles.push(t.id);
    if (t.loot !== null && t.loot !== undefined) out.lootTiles.push(t.id);
  }
  return out;
};

export interface UnitOptions extends AttackOptions, InteractOptions {
  moveCosts: Map<string, number>;
  moveParents: Map<string, string | null>;
}

/** Everything `unit` could do from where it stands, as the current player. */
export const getUnitOptions = (state: GameState, unit: Unit, visible: Set<string>): UnitOptions => {
  const { validMoves, parents } = moveGraphFor(state, unit);
  return {
    moveCosts: validMoves,
    moveParents: parents,
    ...attackOptionsFor(state, unit, visible),
    ...interactOptionsFor(state, unit),
  };
};

export const canTileHoldSpawn = (t: Tile): boolean =>
  t.type !== 'WATER' &&
  t.type !== 'BARRIER' &&
  t.type !== 'CANYON' &&
  t.type !== 'MOUNTAIN' &&
  t.type !== 'BUILDING' &&
  t.hazardState !== 'LAVA';

export const isValidSpawnTile = (
  state: Pick<GameState, 'mapData' | 'units' | 'gridSize'>,
  player: number,
  tileId: string,
): boolean => {
  const target = tileOf(state, tileId);
  if (!target || !canTileHoldSpawn(target)) return false;
  if (state.units.some(u => u.tileId === tileId)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = target.y + dy;
    if (ny < 0 || ny >= state.gridSize) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = target.x + dx;
      if (nx < 0 || nx >= state.gridSize) continue;
      const t = state.mapData[ny * state.gridSize + nx];
      if (t && t.type === 'BASE' && t.owner === player && t.hazardState !== 'LAVA') return true;
    }
  }
  return false;
};

/** Where `player` may bring a fallen unit back: their bases and the tiles around them. */
export const getSpawnTiles = (state: Pick<GameState, 'mapData' | 'units' | 'gridSize'>, player: number): string[] => {
  const occupied = new Set(state.units.map(u => u.tileId));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const base of state.mapData) {
    if (base.type !== 'BASE' || base.owner !== player || base.hazardState === 'LAVA') continue;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = base.y + dy;
      if (ny < 0 || ny >= state.gridSize) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = base.x + dx;
        if (nx < 0 || nx >= state.gridSize) continue;
        const t = state.mapData[ny * state.gridSize + nx];
        if (!t || occupied.has(t.id) || seen.has(t.id) || !canTileHoldSpawn(t)) continue;
        seen.add(t.id);
        out.push(t.id);
      }
    }
  }
  return out;
};

/** Why `player` can't redeploy this fallen unit yet, or null if they can. */
export const spawnBlocker = (state: GameState, player: number, deadUnitId: string): string | null => {
  const dead = state.graveyard.find(u => u.id === deadUnitId);
  if (!dead || dead.owner !== player) return 'No such fallen unit';
  if (dead.turnsUntilRespawn > 0) return 'Not ready to redeploy yet';
  if ((state.playerGold[player] ?? 0) < UNIT_COSTS[dead.type]) return 'Not enough Euros';
  if ((state.playerRespawns[player] || 0) >= getEffectiveMaxRespawns(state.settings.mutators)) return 'No redeploys left';
  return null;
};

/** Tiles under or beside the player's units where an instant supply drop (the AI's shop) may land. */
export const dropTilesFor = (state: GameState, player: number): Set<string> => {
  const out = new Set<string>();
  for (const u of state.units) {
    if (u.owner !== player) continue;
    const t = tileOf(state, u.tileId);
    if (!t) continue;
    for (const n of [t, ...getNeighbors(t, state.mapData, state.gridSize)]) {
      if (canHoldDrop(n)) out.add(n.id);
    }
  }
  return out;
};

/** Valid airdrop target tiles within 6 of an owned non-lava HQ or within 2 of a friendly unit. */
export const getSupplyDropTargets = (
  state: Pick<GameState, 'mapData' | 'units' | 'gridSize'>,
  player: number,
): Set<string> => {
  const out = new Set<string>();
  const addRadius = (cx: number, cy: number, radius: number) => {
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= state.gridSize) continue;
      const maxDx = radius - Math.abs(dy);
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= state.gridSize) continue;
        const tile = state.mapData[ny * state.gridSize + nx];
        if (tile && canHoldDrop(tile)) out.add(tile.id);
      }
    }
  };

  for (const tile of state.mapData) {
    if (tile.type === 'BASE' && tile.owner === player && tile.hazardState !== 'LAVA') {
      addRadius(tile.x, tile.y, 6);
    }
  }
  for (const u of state.units) {
    if (u.owner !== player) continue;
    const ut = tileOf(state, u.tileId);
    if (ut) addRadius(ut.x, ut.y, 2);
  }
  return out;
};

/** Allied units (other than `attacker`) that also have range and LOS onto `tarTile` for Crossfire. */
export const getCrossfireSupporters = (
  attacker: Pick<Unit, 'id' | 'owner'>,
  tarTile: Tile,
  units: Unit[],
  mapData: Tile[],
  weather: WeatherState,
  gridSize: number,
): Unit[] => {
  const supporters: Unit[] = [];
  for (const ally of units) {
    if (ally.id === attacker.id || ally.owner !== attacker.owner || ally.ammo <= 0) continue;
    const allyTile = getTileByIdFast(mapData, ally.tileId, gridSize);
    if (!allyTile || !canUnitAttackFromTile(ally, allyTile)) continue;
    const range = getUnitRange(ally, mapData, weather, allyTile);
    if (getManhattanDistance(allyTile, tarTile) <= range && hasLineOfSight(allyTile, tarTile, mapData, ally.type, weather, gridSize)) {
      supporters.push(ally);
    }
  }
  return supporters;
};

/** Explains why `attacker` cannot currently attack `targetTile`, or null if the shot is legal. */
export const getAttackBlocker = (
  state: Pick<GameState, 'mapData' | 'units' | 'weather' | 'gridSize' | 'settings' | 'playerCp' | 'currentPlayer'>,
  attacker: Unit,
  targetTile: Tile,
  visible?: ReadonlySet<string>,
): string | null => {
  if (attacker.completed) return 'Unit has already acted this turn';
  if (attacker.ammo <= 0) return 'Out of ammo — Field Reload first';
  const atkCost = getUnitAttackCost(attacker);
  if ((state.playerCp[attacker.owner] ?? 0) < atkCost) return `Need ${atkCost} CP to fire`;
  const attTile = tileOf(state, attacker.tileId);
  if (!attTile) return 'Invalid unit position';
  if (!canUnitAttackFromTile(attacker, attTile)) return 'Sniper needs Mountain, Dunes, or Owned Building';
  const range = getUnitRange(attacker, state.mapData, state.weather, attTile);
  const dist = getManhattanDistance(attTile, targetTile);
  if (dist > range) return `Out of range (${dist}/${range})`;
  if (state.settings.fogOfWar && visible && !visible.has(targetTile.id)) return 'Target hidden in Fog of War';
  if (!hasLineOfSight(attTile, targetTile, state.mapData, attacker.type, state.weather, state.gridSize)) {
    return 'Blocked Line of Sight';
  }
  return null;
};

const shopItemType = (itemKey: string) =>
  itemKey in SHOP_ITEMS ? SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS].type : null;
export const isConsumable = (itemKey: string) => shopItemType(itemKey) === 'CONSUMABLE';
export const isConstruct = (itemKey: string) => shopItemType(itemKey) === 'CONSTRUCT';
