/**
 * Purchase legality for tactical weapons. The server calls this before applying an action and
 * applyAction calls it again, so a client can never buy a locked tier, skip the round cap or
 * 3-round cooldown, or target through fog.
 */
import { BASE_STATS } from '../constants/Config';
import { getManhattanDistance } from '../grid/Pathfinding';
import type { GameState } from '../game/state';
import type { TacticalAxis, TacticalId, Tile } from '../types';
import {
  TACTICAL_ITEMS,
  TACTICAL_MIN_HP_FLOOR,
  currentRoundOf,
  hasTacticalVoucher,
  tacticalCooldownLeft,
  tacticalIsFree,
  tacticalUnlockRound,
} from './catalog';
import { hqExclusionTiles, tacticalTilesFor } from './geometry';

export interface TacticalTargeting {
  tileId?: string;
  /** Up to 3 distinct enemy unit tiles for Carpet Run. */
  tileIds?: string[];
  /** Unit ID being airlifted by Paradrop (own or enemy). */
  unitId?: string;
  axis?: TacticalAxis;
  width?: 1 | 2;
  /** The seat's sight. null/undefined means fog is off (everything is visible). */
  visible?: ReadonlySet<string> | null;
}

export const canHoldParadrop = (tile: Tile): boolean =>
  tile.hazardState !== 'LAVA' &&
  tile.type !== 'WATER' &&
  tile.type !== 'MOUNTAIN' &&
  tile.type !== 'BUILDING' &&
  tile.type !== 'BASE' &&
  tile.type !== 'BANK' &&
  tile.type !== 'BARRIER' &&
  tile.type !== 'CANYON';

const isEnemyStructure = (tile: Tile, seat: number): boolean =>
  tile.type === 'BUILDING' &&
  tile.owner !== null &&
  tile.owner !== undefined &&
  tile.owner !== seat &&
  tile.subType !== undefined &&
  tile.subType !== 'NONE';

const isEnemyHq = (state: Pick<GameState, 'playerStatus'>, tile: Tile, seat: number): boolean =>
  tile.type === 'BASE' &&
  tile.owner !== null &&
  tile.owner !== undefined &&
  tile.owner !== seat &&
  (tile.hp ?? 1) > 0 &&
  state.playerStatus?.[tile.owner] !== 'ELIMINATED';

/** Anti-cheese destination check for Paradrop airlift. */
export const paradropDestinationBlocker = (
  state: GameState,
  seat: number,
  unitOwner: number,
  unitTileId: string,
  destTile: Tile,
  visible?: ReadonlySet<string> | null,
): string | null => {
  if (visible && !visible.has(destTile.id)) return 'Destination hidden in Fog of War';
  if (destTile.id === unitTileId) return 'Pick a different tile to drop onto';
  if (state.units.some(u => u.tileId === destTile.id)) return 'That tile is occupied';
  if (!canHoldParadrop(destTile)) return 'Cannot paradrop onto that terrain';

  // Anti-cheese guardrails when airlifting an ENEMY unit away
  if (unitOwner !== seat) {
    if (state.burningLines?.some(line => line.tiles.includes(destTile.id))) {
      return 'Cannot drop an enemy onto burning Napalm';
    }
    if (state.mines?.some(m => m.tileId === destTile.id)) {
      return 'Cannot drop an enemy onto a Land Mine';
    }
    const ownHqs = state.mapData.filter(t => t.type === 'BASE' && t.owner === seat && (t.hp ?? 1) > 0);
    if (ownHqs.some(hq => getManhattanDistance(hq, destTile) <= BASE_STATS.RANGE)) {
      return 'Cannot drop an enemy into your HQ autocannon range';
    }
  }
  return null;
};

/** Why this purchase is illegal, or null when it may resolve. */
export const tacticalBlocker = (
  state: GameState,
  seat: number,
  itemKey: TacticalId,
  targeting: TacticalTargeting = {},
): string | null => {
  const def = TACTICAL_ITEMS[itemKey];
  if (!def) return 'Unknown tactical weapon';
  const round = currentRoundOf(state);

  if (def.fogOnly && !state.settings.fogOfWar) {
    return `${def.name} is only available with Fog of War on`;
  }
  const hasVoucher = hasTacticalVoucher(state, seat, itemKey);
  if (!hasVoucher && round < tacticalUnlockRound(itemKey)) {
    return `${def.name} opens at round ${tacticalUnlockRound(itemKey)}`;
  }
  if ((state.tacticalRound?.[seat] ?? 0) === round) {
    return 'One tactical weapon per round';
  }
  const cd = tacticalCooldownLeft(state, seat, itemKey);
  if (!hasVoucher && cd > 0) {
    return `${def.name} is on cooldown (${cd} round${cd === 1 ? '' : 's'} left)`;
  }
  if (!tacticalIsFree(state, seat, itemKey) && (state.playerGold[seat] ?? 0) < def.cost) {
    return 'Not enough Euros';
  }

  if (def.shape === 'NONE') return null;

  const visible = state.settings.fogOfWar ? targeting.visible ?? null : null;

  if (def.shape === 'UNITS3') {
    const ids =
      targeting.tileIds && targeting.tileIds.length > 0
        ? Array.from(new Set(targeting.tileIds))
        : targeting.tileId
          ? [targeting.tileId]
          : [];
    if (ids.length === 0) return 'Pick 1 to 3 enemy units';
    if (ids.length > 3) return 'Carpet Run hits at most 3 enemy units';
    for (const id of ids) {
      const tile = state.mapData.find(t => t.id === id);
      if (!tile) return 'Pick valid enemy unit tiles';
      if (visible && !visible.has(tile.id)) return 'Target hidden in Fog of War';
      const occupant = state.units.find(u => u.tileId === tile.id && u.owner !== seat);
      if (!occupant) return 'Target enemy units only';
      if (occupant.hp <= TACTICAL_MIN_HP_FLOOR) return 'Target already at 2 HP floor — finish with a unit';
    }
    return null;
  }

  if (def.shape === 'RELOCATE') {
    if (!targeting.unitId) return 'Pick a unit to airlift';
    const unit = state.units.find(u => u.id === targeting.unitId);
    if (!unit) return 'Unit not found';
    if (visible && unit.owner !== seat && !visible.has(unit.tileId)) return 'Target unit hidden in Fog of War';
    if (!targeting.tileId) return 'Pick an open landing tile';
    const dest = state.mapData.find(t => t.id === targeting.tileId);
    if (!dest) return 'Pick an open landing tile';
    return paradropDestinationBlocker(state, seat, unit.owner, unit.tileId, dest, visible);
  }

  if (!targeting.tileId) return 'Pick a target tile';
  const tile = state.mapData.find(t => t.id === targeting.tileId);
  if (!tile) return 'Pick a target tile';

  // Enemy HQs are known map landmarks and remain valid Sabotage targets even under Fog of War.
  const sabotageHq = itemKey === 'SABOTAGE' && isEnemyHq(state, tile, seat);
  if (!sabotageHq && visible && !visible.has(tile.id)) return 'Target hidden in Fog of War';

  if (def.shape === 'UNIT') {
    const occupant = state.units.find(u => u.tileId === tile.id && u.owner !== seat);
    if (!occupant) return 'Target a visible enemy unit';
    if (occupant.hp <= TACTICAL_MIN_HP_FLOOR) return 'Target already at 2 HP floor — finish with a unit';
    return null;
  }

  if (def.shape === 'TILE') {
    if (itemKey === 'SABOTAGE') {
      if (!sabotageHq && !isEnemyStructure(tile, seat)) {
        return 'Target an enemy HQ (-8 CP) or specialized structure (Strip)';
      }
    }
    return null;
  }

  if ((def.shape === 'LANE' || def.shape === 'LINE4') && !targeting.axis) {
    return 'Choose horizontal or vertical';
  }

  const tiles = tacticalTilesFor(state.mapData, state.gridSize, itemKey, targeting.tileId, targeting.axis, 2);
  if (!tiles || tiles.length === 0) return 'That footprint does not fit on the board';

  if (def.shape === 'LANE') {
    const excluded = hqExclusionTiles(state.mapData, state.gridSize);
    if (tiles.some(t => excluded.has(t.id))) {
      return 'No barrage over an HQ or its 8 neighbours';
    }
  }

  return null;
};

/**
 * Legal destination tiles for Paradrop once a unit (`unitId`) has been picked for airlift.
 */
export const legalParadropDestinations = (
  state: GameState,
  seat: number,
  unitId: string,
  visible?: ReadonlySet<string> | null,
): string[] => {
  const unit = state.units.find(u => u.id === unitId);
  if (!unit) return [];
  const vis = state.settings.fogOfWar ? visible ?? null : null;
  const out: string[] = [];
  for (let i = 0; i < state.mapData.length; i++) {
    const tile = state.mapData[i];
    if (paradropDestinationBlocker(state, seat, unit.owner, unit.tileId, tile, vis) === null) {
      out.push(tile.id);
    }
  }
  return out;
};

/**
 * Every board tile that is a legal click target for `itemKey` under the given axis, selection, and sight.
 * Uses `tacticalBlocker` directly so the UI highlight and rules validator never drift apart.
 */
export const legalTacticalAnchors = (
  state: GameState,
  seat: number,
  itemKey: TacticalId,
  targeting: Omit<TacticalTargeting, 'tileId'> = {},
): string[] => {
  const def = TACTICAL_ITEMS[itemKey];
  if (!def || def.shape === 'NONE') return [];
  if (def.fogOnly && !state.settings.fogOfWar) return [];
  const round = currentRoundOf(state);
  const hasVoucher = hasTacticalVoucher(state, seat, itemKey);
  if (!hasVoucher && round < tacticalUnlockRound(itemKey)) return [];
  if ((state.tacticalRound?.[seat] ?? 0) === round) return [];
  if (!hasVoucher && tacticalCooldownLeft(state, seat, itemKey) > 0) return [];
  if (!tacticalIsFree(state, seat, itemKey) && (state.playerGold[seat] ?? 0) < def.cost) return [];

  const visible = state.settings.fogOfWar ? targeting.visible ?? null : null;

  // Paradrop 2-step flow: Step 1 highlights visible alive units; Step 2 highlights legal landing tiles.
  if (def.shape === 'RELOCATE') {
    if (targeting.unitId) {
      return legalParadropDestinations(state, seat, targeting.unitId, visible);
    }
    return state.units
      .filter(u => !visible || u.owner === seat || visible.has(u.tileId))
      .map(u => u.tileId);
  }

  // Unit-targeted strikes highlight visible enemy units above the strict 2 HP non-lethal floor.
  if (def.shape === 'UNIT' || def.shape === 'UNITS3') {
    const picked = new Set(targeting.tileIds ?? []);
    return state.units
      .filter(
        u =>
          u.owner !== seat &&
          u.hp > TACTICAL_MIN_HP_FLOOR &&
          (!visible || visible.has(u.tileId)) &&
          !picked.has(u.tileId),
      )
      .map(u => u.tileId);
  }

  const out: string[] = [];
  for (let i = 0; i < state.mapData.length; i++) {
    const tile = state.mapData[i];
    if (visible && !visible.has(tile.id) && !(itemKey === 'SABOTAGE' && isEnemyHq(state, tile, seat))) {
      continue;
    }
    if (tacticalBlocker(state, seat, itemKey, { ...targeting, tileId: tile.id }) === null) {
      out.push(tile.id);
    }
  }
  return out;
};
