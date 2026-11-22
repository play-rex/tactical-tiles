/**
 * What a player may do right now. The web UI highlights these; the server checks actions
 * against them, so the two can never disagree.
 */
import { SHOP_ITEMS, UNIT_COSTS } from '../constants/Config';
import type { Tile, Unit } from '../types';
import {
  calculateVisibility,
  getManhattanDistance,
  getNeighbors,
  getTileByIdFast,
  getValidMoves,
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

const tileOf = (state: GameState, id: string) => getTileByIdFast(state.mapData, id, state.gridSize);
const cpOf = (state: GameState) => state.playerCp[state.currentPlayer] ?? 0;

/** Reachable tiles for `unit` and the CP each costs, as the current player. */
export const moveCostsFor = (state: GameState, unit: Unit): Map<string, number> => {
  const tile = tileOf(state, unit.tileId);
  const cp = cpOf(state);
  if (!tile || unit.hasMoved || cp <= 0 || unit.isRooted) return new Map();
  return getValidMoves(tile, cp, state.mapData, state.units, unit.type, state.currentPlayer, state.weather, state.gridSize, unit.rank ?? 0);
};

export interface AttackOptions {
  /** Enemy units in range and sight. */
  attackTargets: string[];
  /** Enemy bases in range (Conquer mode). */
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

  const range = getUnitRange(unit, mapData, weather);
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
  }
  return out;
};

export interface InteractOptions {
  /** Buildings, banks and supply drops on or beside the unit. */
  secureTiles: string[];
  heistTiles: string[];
  lootTiles: string[];
}

export const interactOptionsFor = (state: GameState, unit: Unit): InteractOptions => {
  const out: InteractOptions = { secureTiles: [], heistTiles: [], lootTiles: [] };
  const tile = tileOf(state, unit.tileId);
  if (!tile || cpOf(state) < INTERACT_COST) return out;
  for (const t of [tile, ...getNeighbors(tile, state.mapData, state.gridSize)]) {
    if (t.type === 'BUILDING' && t.owner !== state.currentPlayer) out.secureTiles.push(t.id);
    if (t.type === 'BANK' && (t.hackProgress || 0) < 100) out.heistTiles.push(t.id);
    if (t.loot !== null && t.loot !== undefined) out.lootTiles.push(t.id);
  }
  return out;
};

export interface UnitOptions extends AttackOptions, InteractOptions {
  moveCosts: Map<string, number>;
}

/** Everything `unit` could do from where it stands, as the current player. */
export const getUnitOptions = (state: GameState, unit: Unit, visible: Set<string>): UnitOptions => ({
  moveCosts: moveCostsFor(state, unit),
  ...attackOptionsFor(state, unit, visible),
  ...interactOptionsFor(state, unit),
});

/** Where `player` may bring a fallen unit back: their bases and the tiles around them. */
export const getSpawnTiles = (state: GameState, player: number): string[] => {
  const occupied = new Set(state.units.map(u => u.tileId));
  const out: string[] = [];
  const bases = state.mapData.filter(t => t.type === 'BASE' && t.owner === player && t.hazardState !== 'LAVA');
  bases.forEach(base => {
    if (!occupied.has(base.id)) out.push(base.id);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const t = tileOf(state, `${base.x + dx},${base.y + dy}`);
        if (!t) continue;
        const ok = t.type !== 'WATER' && t.type !== 'BARRIER' && t.type !== 'CANYON' && t.hazardState !== 'LAVA';
        if (ok && !occupied.has(t.id) && !out.includes(t.id)) out.push(t.id);
      }
    }
  });
  return out;
};

/** Why `player` can't redeploy this fallen unit yet, or null if they can. */
export const spawnBlocker = (state: GameState, player: number, deadUnitId: string): string | null => {
  const dead = state.graveyard.find(u => u.id === deadUnitId);
  if (!dead || dead.owner !== player) return 'No such fallen unit';
  if (dead.turnsUntilRespawn > 0) return 'Not ready to redeploy yet';
  if ((state.playerGold[player] ?? 0) < UNIT_COSTS[dead.type]) return 'Not enough gold';
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

const shopItemType = (itemKey: string) =>
  itemKey in SHOP_ITEMS ? SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS].type : null;
export const isConsumable = (itemKey: string) => shopItemType(itemKey) === 'CONSUMABLE';
export const isConstruct = (itemKey: string) => shopItemType(itemKey) === 'CONSTRUCT';
