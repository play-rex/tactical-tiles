import { COMBAT_BONUSES } from '@tactical/engine/constants/Config';
import { getAttackBlocker, getCrossfireSupporters, type GameState } from '@tactical/engine';
import { getManhattanDistance, getTileByIdFast, hasLineOfSight, reconstructMovePathFromParents } from '@tactical/engine/grid/Pathfinding';
import {
  calculateAttackOutcome,
  canUnitAttackFromTile,
  getUnitAttackCost,
  getUnitRange,
  type AttackOutcome,
} from '@tactical/engine/rules/CombatRules';
import { resolveMoveWithOverwatch } from '@tactical/engine/rules/OverwatchRules';
import type { Tile, Unit, WeatherState } from '@tactical/engine/types';

type MoveWithOverwatchResolution = ReturnType<typeof resolveMoveWithOverwatch>;

export interface HoverMovePreviewInput {
  movingUnit: Unit;
  targetTileId: string;
  validMoveCosts: Map<string, number>;
  validMoveParents: Map<string, string | null>;
  mapData: Tile[];
  units: Unit[];
  weather: WeatherState;
  gridSize: number;
  fogOfWar: boolean;
  maxBudget: number;
  visibleTiles: Set<string> | null;
}

let cachedKey: HoverMovePreviewInput | null = null;
let cachedResult: MoveWithOverwatchResolution | null = null;

const matchesCache = (a: HoverMovePreviewInput, b: HoverMovePreviewInput) =>
  a.movingUnit === b.movingUnit &&
  a.targetTileId === b.targetTileId &&
  a.validMoveCosts === b.validMoveCosts &&
  a.validMoveParents === b.validMoveParents &&
  a.mapData === b.mapData &&
  a.units === b.units &&
  a.weather === b.weather &&
  a.gridSize === b.gridSize &&
  a.fogOfWar === b.fogOfWar &&
  a.maxBudget === b.maxBudget &&
  a.visibleTiles === b.visibleTiles;

/**
 * Resolves a hovered move preview with Overwatch warnings using cached Dijkstra parents when
 * available, memoizing the last result across the Pixi canvas and React HUD in the same frame.
 */
export function getHoverMoveResolution(input: HoverMovePreviewInput): MoveWithOverwatchResolution {
  if (cachedKey && cachedResult && matchesCache(cachedKey, input)) {
    return cachedResult;
  }
  const startTile = getTileByIdFast(input.mapData, input.movingUnit.tileId, input.gridSize);
  const precomputedPath =
    startTile && input.validMoveParents.size > 0
      ? reconstructMovePathFromParents(
          startTile,
          input.targetTileId,
          input.validMoveCosts,
          input.validMoveParents,
          input.mapData,
          input.gridSize,
        )
      : undefined;

  const result = resolveMoveWithOverwatch({
    movingUnit: input.movingUnit,
    targetTileId: input.targetTileId,
    mapData: input.mapData,
    units: input.units,
    weather: input.weather,
    gridSize: input.gridSize,
    fogOfWar: input.fogOfWar,
    maxBudget: input.maxBudget,
    knownVisibleTiles: input.visibleTiles,
    precomputedPath: precomputedPath && precomputedPath.length > 0 ? precomputedPath : undefined,
  });

  cachedKey = input;
  cachedResult = result;
  return result;
}

export interface UnitAttackPreview extends AttackOutcome {
  supporters: Tile[];
}

/** Computes attack outcome + Crossfire supporter tiles for UI hover & targeting previews. */
export function computeUnitAttackPreview(params: {
  attacker: Unit;
  attTile: Tile | undefined;
  target: Unit;
  tarTile: Tile | undefined;
  units: Unit[];
  mapData: Tile[];
  weather: WeatherState;
  gridSize: number;
}): UnitAttackPreview {
  const { attacker, attTile, target, tarTile, units, mapData, weather, gridSize } = params;
  const supportersUnits = tarTile ? getCrossfireSupporters(attacker, tarTile, units, mapData, weather, gridSize) : [];
  const crossfireBonus = supportersUnits.length > 0 ? COMBAT_BONUSES.CROSSFIRE_DAMAGE : 0;
  const outcome = calculateAttackOutcome(attacker, attTile, tarTile, target.owner, target, crossfireBonus);
  const supporters: Tile[] = [];
  for (const ally of supportersUnits) {
    const t = getTileByIdFast(mapData, ally.tileId, gridSize);
    if (t) supporters.push(t);
  }
  return { ...outcome, supporters };
}

/**
 * Returns visible enemy tiles reachable to fire at if `unit` ends its move on `destTile`
 * with `remainingCp` left.
 */
export function getPostMoveTargetTiles(params: {
  unit: Unit;
  destTile: Tile;
  remainingCp: number;
  mapData: Tile[];
  units: Unit[];
  weather: WeatherState;
  gridSize: number;
  fogOfWar: boolean;
  visibleTiles: ReadonlySet<string> | null;
}): Tile[] {
  const { unit, destTile, remainingCp, mapData, units, weather, gridSize, fogOfWar, visibleTiles } = params;
  if (unit.completed || unit.ammo <= 0 || remainingCp < getUnitAttackCost(unit)) return [];
  if (!canUnitAttackFromTile(unit, destTile)) return [];

  const range = getUnitRange(unit, mapData, weather, destTile);
  const out: Tile[] = [];
  for (const enemy of units) {
    if (enemy.owner === unit.owner) continue;
    const eTile = getTileByIdFast(mapData, enemy.tileId, gridSize);
    if (!eTile) continue;
    if (fogOfWar && visibleTiles && !visibleTiles.has(eTile.id)) continue;
    if (getManhattanDistance(destTile, eTile) > range) continue;
    if (hasLineOfSight(destTile, eTile, mapData, unit.type, weather, gridSize)) {
      out.push(eTile);
    }
  }
  return out;
}

export function getHoveredEnemyBlocker(
  state: Pick<GameState, 'mapData' | 'units' | 'weather' | 'gridSize' | 'settings' | 'playerCp' | 'currentPlayer'>,
  attacker: Unit,
  targetTile: Tile,
  visible?: ReadonlySet<string>,
): string | null {
  return getAttackBlocker(state, attacker, targetTile, visible);
}
