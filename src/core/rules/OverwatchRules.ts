import { Tile, Unit, WeatherState } from '../types';
import {
    calculateVisibility,
    getManhattanDistance,
    getMovePath,
    getStepCost,
    hasOverwatchLineOfSight
} from '../grid/Pathfinding';
import {
    calculateOverwatchOutcome,
    canUnitAttackFromTile,
    getUnitRange
} from './CombatRules';

export interface OverwatchTriggerInfo {
    overwatcherId: string;
    overwatcherTileId: string;
    interceptTile: Tile;
    interceptIndex: number;
    damage: number;
    victimDead: boolean;
    pinResisted: boolean;
}

export interface OverwatchMoveResolution {
    path: Tile[];
    trigger: OverwatchTriggerInfo | null;
    finalTile: Tile | null;
    finalIndex: number;
    actualCost: number;
    haltedEarly: boolean;
}

/**
 * Computes all tile IDs watched by an Overwatching unit respecting range, Overwatch LOS, Barriers, and Weather.
 */
export const getOverwatchCoverageTiles = (
    overwatcher: Unit,
    mapData: Tile[],
    weather: WeatherState,
    gridSize: number
): Set<string> => {
    const covered = new Set<string>();
    const origin = mapData.find(t => t.id === overwatcher.tileId);
    if (!origin || !canUnitAttackFromTile(overwatcher, origin) || overwatcher.ammo <= 0) {
        return covered;
    }

    const effectiveRange = getUnitRange(overwatcher, mapData, weather);
    for (let dy = -effectiveRange; dy <= effectiveRange; dy++) {
        for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
            const dist = Math.abs(dx) + Math.abs(dy);
            if (dist === 0 || dist > effectiveRange) continue;
            const tx = origin.x + dx;
            const ty = origin.y + dy;
            if (tx < 0 || tx >= gridSize || ty < 0 || ty >= gridSize) continue;
            const target = mapData[ty * gridSize + tx];
            if (!target) continue;
            if (hasOverwatchLineOfSight(origin, target, mapData, overwatcher.type, weather, gridSize)) {
                covered.add(target.id);
            }
        }
    }

    return covered;
};

/**
 * Resolves a unit movement path step-by-step against active enemy Overwatchers.
 * Enforces max 1 Overwatch shot per move, exact walked CP cost, pass-through collision safety,
 * Elite Breacher pin-resistance, and Fog-honest visibility checks.
 */
export const resolveMoveWithOverwatch = (params: {
    movingUnit: Unit;
    targetTileId: string;
    mapData: Tile[];
    units: Unit[];
    weather: WeatherState;
    gridSize: number;
    fogOfWar: boolean;
    maxBudget: number;
    knownVisibleTiles?: Set<string> | null;
}): OverwatchMoveResolution => {
    const {
        movingUnit,
        targetTileId,
        mapData,
        units,
        weather,
        gridSize,
        fogOfWar,
        maxBudget,
        knownVisibleTiles = null
    } = params;

    const startTile = mapData.find(t => t.id === movingUnit.tileId);
    if (!startTile) {
        return { path: [], trigger: null, finalTile: null, finalIndex: 0, actualCost: 0, haltedEarly: false };
    }

    const path = getMovePath(
        startTile,
        targetTileId,
        maxBudget,
        mapData,
        units,
        movingUnit.type,
        movingUnit.owner,
        weather,
        gridSize,
        movingUnit.rank ?? 0
    );

    if (path.length === 0) {
        return { path: [], trigger: null, finalTile: startTile, finalIndex: 0, actualCost: 0, haltedEarly: false };
    }

    const cumulativeCosts: number[] = [0];
    for (let i = 1; i < path.length; i++) {
        const step = getStepCost(path[i], movingUnit.type, movingUnit.owner, weather, movingUnit.rank ?? 0) ?? 0;
        cumulativeCosts.push(cumulativeCosts[i - 1] + step);
    }

    const enemyOverwatchers = units.filter(u =>
        u.owner !== movingUnit.owner &&
        u.isOverwatching === true &&
        u.ammo > 0 &&
        (!knownVisibleTiles || knownVisibleTiles.has(u.tileId))
    );

    if (enemyOverwatchers.length === 0) {
        const lastIdx = path.length - 1;
        return {
            path,
            trigger: null,
            finalTile: path[lastIdx],
            finalIndex: lastIdx,
            actualCost: Math.min(maxBudget, cumulativeCosts[lastIdx]),
            haltedEarly: false
        };
    }

    const visByPlayer = new Map<number, Set<string>>();
    const getTeamVis = (owner: number): Set<string> => {
        let vis = visByPlayer.get(owner);
        if (!vis) {
            vis = calculateVisibility(owner, units, mapData, weather, true, gridSize);
            visByPlayer.set(owner, vis);
        }
        return vis;
    };

    const occupiedByOther = new Set(
        units.filter(u => u.id !== movingUnit.id).map(u => u.tileId)
    );

    for (let idx = 1; idx < path.length; idx++) {
        const stepTile = path[idx];
        const eligible: { overwatcher: Unit; damage: number; dist: number }[] = [];

        for (const ow of enemyOverwatchers) {
            const owTile = mapData.find(t => t.id === ow.tileId);
            if (!owTile || !canUnitAttackFromTile(ow, owTile)) continue;
            const dist = getManhattanDistance(owTile, stepTile);
            if (dist > getUnitRange(ow, mapData, weather)) continue;
            if (!hasOverwatchLineOfSight(owTile, stepTile, mapData, ow.type, weather, gridSize)) continue;
            if (fogOfWar && !getTeamVis(ow.owner).has(stepTile.id)) continue;

            const outcome = calculateOverwatchOutcome(ow, owTile, stepTile, movingUnit.owner, movingUnit);
            eligible.push({ overwatcher: ow, damage: outcome.damage, dist });
        }

        if (eligible.length > 0) {
            eligible.sort((a, b) => {
                if (b.damage !== a.damage) return b.damage - a.damage;
                if (a.dist !== b.dist) return a.dist - b.dist;
                return a.overwatcher.id.localeCompare(b.overwatcher.id);
            });

            const chosen = eligible[0];
            const victimDead = movingUnit.hp - chosen.damage <= 0;
            const pinResisted = !victimDead && movingUnit.type === 'ASSAULTER' && (movingUnit.rank ?? 0) >= 2;

            let haltIdx = idx;
            if (pinResisted) {
                haltIdx = path.length - 1;
            } else if (!victimDead) {
                // Never pin onto a pass-through tile occupied by another friendly unit; step back to last free tile.
                while (haltIdx > 0 && occupiedByOther.has(path[haltIdx].id)) {
                    haltIdx--;
                }
            }

            return {
                path,
                trigger: {
                    overwatcherId: chosen.overwatcher.id,
                    overwatcherTileId: chosen.overwatcher.tileId,
                    interceptTile: stepTile,
                    interceptIndex: idx,
                    damage: chosen.damage,
                    victimDead,
                    pinResisted
                },
                finalTile: path[haltIdx],
                finalIndex: haltIdx,
                actualCost: Math.min(maxBudget, cumulativeCosts[haltIdx]),
                haltedEarly: !pinResisted && haltIdx < path.length - 1
            };
        }
    }

    const lastIdx = path.length - 1;
    return {
        path,
        trigger: null,
        finalTile: path[lastIdx],
        finalIndex: lastIdx,
        actualCost: Math.min(maxBudget, cumulativeCosts[lastIdx]),
        haltedEarly: false
    };
};
