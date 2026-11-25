import { LAND_MINE_STATS } from '../constants/Config';
import { LandMine, SmokeZone, Tile, Unit, WeatherState } from '../types';
import { smokeBlocksLine } from '../tactical/geometry';
import {
    calculateVisibility,
    getManhattanDistance,
    getMovePath,
    getStepCost,
    getTileByIdFast,
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

export interface MineTriggerInfo {
    mineId: string;
    mineOwner: number;
    interceptTile: Tile;
    damage: number;
    victimDead: boolean;
}

export interface OverwatchMoveResolution {
    path: Tile[];
    trigger: OverwatchTriggerInfo | null;
    mineTrigger: MineTriggerInfo | null;
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
    gridSize: number,
    smokeZones?: readonly SmokeZone[]
): Set<string> => {
    const covered = new Set<string>();
    const origin = getTileByIdFast(mapData, overwatcher.tileId, gridSize);
    if (!origin || !canUnitAttackFromTile(overwatcher, origin) || overwatcher.ammo <= 0) {
        return covered;
    }

    const effectiveRange = getUnitRange(overwatcher, mapData, weather, origin);
    for (let dy = -effectiveRange; dy <= effectiveRange; dy++) {
        for (let dx = -effectiveRange; dx <= effectiveRange; dx++) {
            const dist = Math.abs(dx) + Math.abs(dy);
            if (dist === 0 || dist > effectiveRange) continue;
            const tx = origin.x + dx;
            const ty = origin.y + dy;
            if (tx < 0 || tx >= gridSize || ty < 0 || ty >= gridSize) continue;
            const target = mapData[ty * gridSize + tx];
            if (!target) continue;
            if (
                hasOverwatchLineOfSight(origin, target, mapData, overwatcher.type, weather, gridSize) &&
                !smokeBlocksLine(smokeZones, origin, target)
            ) {
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
    mines?: LandMine[];
    smokeZones?: readonly SmokeZone[];
    knownVisibleTiles?: Set<string> | null;
    precomputedPath?: Tile[];
    precomputedEnemyOverwatchers?: Unit[];
    knownTeamVisByOwner?: Map<number, Set<string>>;
    knownCoverageByOverwatcher?: Map<string, Set<string>>;
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
        mines = [],
        smokeZones,
        knownVisibleTiles = null,
        precomputedPath,
        precomputedEnemyOverwatchers,
        knownTeamVisByOwner,
        knownCoverageByOverwatcher
    } = params;

    const startTile = getTileByIdFast(mapData, movingUnit.tileId, gridSize);
    if (!startTile) {
        return { path: [], trigger: null, mineTrigger: null, finalTile: null, finalIndex: 0, actualCost: 0, haltedEarly: false };
    }

    const path = precomputedPath ?? getMovePath(
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
        return { path: [], trigger: null, mineTrigger: null, finalTile: startTile, finalIndex: 0, actualCost: 0, haltedEarly: false };
    }

    const cumulativeCosts: number[] = [0];
    for (let i = 1; i < path.length; i++) {
        const step = getStepCost(path[i], movingUnit.type, movingUnit.owner, weather, movingUnit.rank ?? 0) ?? 0;
        cumulativeCosts.push(cumulativeCosts[i - 1] + step);
    }

    const mineByTile = new Map<string, LandMine>();
    for (let i = 0; i < mines.length; i++) {
        const m = mines[i];
        if (m.owner !== movingUnit.owner && !mineByTile.has(m.tileId)) {
            mineByTile.set(m.tileId, m);
        }
    }

    const enemyOverwatchers = precomputedEnemyOverwatchers ?? units.filter(u =>
        u.owner !== movingUnit.owner &&
        u.isOverwatching === true &&
        u.ammo > 0 &&
        (!knownVisibleTiles || knownVisibleTiles.has(u.tileId))
    );

    const visByPlayer = knownTeamVisByOwner ?? new Map<number, Set<string>>();
    const getTeamVis = (owner: number): Set<string> => {
        let vis = visByPlayer.get(owner);
        if (!vis) {
            vis = calculateVisibility(owner, units, mapData, weather, true, gridSize);
            visByPlayer.set(owner, vis);
        }
        return vis;
    };

    const preparedOverwatchers: { ow: Unit; owTile: Tile; range: number; preCoverage: Set<string> | undefined }[] = [];
    for (const ow of enemyOverwatchers) {
        const owTile = getTileByIdFast(mapData, ow.tileId, gridSize);
        if (!owTile || !canUnitAttackFromTile(ow, owTile)) continue;
        const preCoverage = knownCoverageByOverwatcher?.get(ow.id);
        const range = preCoverage ? 0 : getUnitRange(ow, mapData, weather, owTile);
        preparedOverwatchers.push({ ow, owTile, range, preCoverage });
    }

    if (preparedOverwatchers.length === 0 && mineByTile.size === 0) {
        const lastIdx = path.length - 1;
        return {
            path,
            trigger: null,
            mineTrigger: null,
            finalTile: path[lastIdx],
            finalIndex: lastIdx,
            actualCost: Math.min(maxBudget, cumulativeCosts[lastIdx]),
            haltedEarly: false
        };
    }

    const resolveSafeHaltIdx = (targetIdx: number): number => {
        // Never pin onto a pass-through tile occupied by another friendly unit; step back to last free tile.
        const occupiedByOther = new Set<string>();
        for (let uIdx = 0; uIdx < units.length; uIdx++) {
            if (units[uIdx].id !== movingUnit.id) occupiedByOther.add(units[uIdx].tileId);
        }
        let haltIdx = targetIdx;
        while (haltIdx > 0 && occupiedByOther.has(path[haltIdx].id)) {
            haltIdx--;
        }
        return haltIdx;
    };

    let firedOverwatch: OverwatchTriggerInfo | null = null;
    let remainingHp = movingUnit.hp;

    for (let idx = 1; idx < path.length; idx++) {
        const stepTile = path[idx];

        if (!firedOverwatch && preparedOverwatchers.length > 0) {
            let bestOw: Unit | null = null;
            let bestDmg = -1;
            let bestDist = Infinity;
            // Bulwark: a living adjacent ally on the moving unit's side reduces the shot by 1.
            const adjacentBulwark = units.some(u => {
                if (u.id === movingUnit.id || u.owner !== movingUnit.owner || u.perk !== 'BULWARK') return false;
                const ut = getTileByIdFast(mapData, u.tileId, gridSize);
                return !!ut && getManhattanDistance(ut, stepTile) === 1;
            });

            for (let j = 0; j < preparedOverwatchers.length; j++) {
                const { ow, owTile, range, preCoverage } = preparedOverwatchers[j];
                if (preCoverage && !preCoverage.has(stepTile.id)) continue;

                const dist = getManhattanDistance(owTile, stepTile);
                if (!preCoverage) {
                    if (dist > range) continue;
                    if (!hasOverwatchLineOfSight(owTile, stepTile, mapData, ow.type, weather, gridSize)) continue;
                }
                if (smokeBlocksLine(smokeZones, owTile, stepTile)) continue;
                if (fogOfWar && !getTeamVis(ow.owner).has(stepTile.id)) continue;

                const outcome = calculateOverwatchOutcome(ow, owTile, stepTile, movingUnit.owner, movingUnit);
                const dealt = Math.max(1, outcome.damage - (adjacentBulwark ? 1 : 0));
                if (
                    !bestOw ||
                    dealt > bestDmg ||
                    (dealt === bestDmg && (dist < bestDist || (dist === bestDist && ow.id.localeCompare(bestOw.id) < 0)))
                ) {
                    bestOw = ow;
                    bestDmg = dealt;
                    bestDist = dist;
                }
            }

            if (bestOw) {
                remainingHp -= bestDmg;
                const owDead = remainingHp <= 0;
                const pinResisted = !owDead && movingUnit.type === 'ASSAULTER' && (movingUnit.rank ?? 0) >= 2;
                firedOverwatch = {
                    overwatcherId: bestOw.id,
                    overwatcherTileId: bestOw.tileId,
                    interceptTile: stepTile,
                    interceptIndex: idx,
                    damage: bestDmg,
                    victimDead: owDead,
                    pinResisted
                };

                if (owDead) {
                    return {
                        path,
                        trigger: firedOverwatch,
                        mineTrigger: null,
                        finalTile: path[idx],
                        finalIndex: idx,
                        actualCost: Math.min(maxBudget, cumulativeCosts[idx]),
                        haltedEarly: idx < path.length - 1
                    };
                }
            }
        }

        const stepMine = mineByTile.get(stepTile.id);
        if (stepMine) {
            const mineDmg = LAND_MINE_STATS.DAMAGE;
            remainingHp -= mineDmg;
            const mineDead = remainingHp <= 0;
            const haltIdx = mineDead ? idx : resolveSafeHaltIdx(idx);
            return {
                path,
                trigger: firedOverwatch,
                mineTrigger: {
                    mineId: stepMine.id,
                    mineOwner: stepMine.owner,
                    interceptTile: stepTile,
                    damage: mineDmg,
                    victimDead: mineDead
                },
                finalTile: path[haltIdx],
                finalIndex: haltIdx,
                actualCost: Math.min(maxBudget, cumulativeCosts[haltIdx]),
                haltedEarly: haltIdx < path.length - 1
            };
        }

        if (firedOverwatch && firedOverwatch.interceptIndex === idx && !firedOverwatch.pinResisted) {
            const haltIdx = resolveSafeHaltIdx(idx);
            return {
                path,
                trigger: firedOverwatch,
                mineTrigger: null,
                finalTile: path[haltIdx],
                finalIndex: haltIdx,
                actualCost: Math.min(maxBudget, cumulativeCosts[haltIdx]),
                haltedEarly: haltIdx < path.length - 1
            };
        }
    }

    const lastIdx = path.length - 1;
    return {
        path,
        trigger: firedOverwatch,
        mineTrigger: null,
        finalTile: path[lastIdx],
        finalIndex: lastIdx,
        actualCost: Math.min(maxBudget, cumulativeCosts[lastIdx]),
        haltedEarly: false
    };
};
