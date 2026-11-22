
import { Unit, Tile, AIDifficulty, WeatherState } from '../types';
import { UNIT_STATS } from '../constants/Config';
import { getManhattanDistance, getTileByIdFast, hasLineOfSight } from '../grid/Pathfinding';
import { calculateAttackOutcome, canUnitAttackFromTile, getUnitRange } from '../rules/CombatRules';

interface CombatSimulationResult {
    damageDealt: number; 
    potentialDamage: number; 
    isKill: boolean;
    hitChance: number;
}

const simulateCombat = (attacker: Unit, target: Unit, mapData: Tile[], gridSize: number): CombatSimulationResult => {
    const attTile = getTileByIdFast(mapData, attacker.tileId, gridSize);
    const tarTile = getTileByIdFast(mapData, target.tileId, gridSize);

    if (!attTile || !tarTile) return { damageDealt: 0, potentialDamage: 0, isKill: false, hitChance: 0 };

    const { damage: finalDmg } = calculateAttackOutcome(attacker, attTile, tarTile, target.owner, target);

    return {
        damageDealt: finalDmg,
        potentialDamage: finalDmg,
        isKill: finalDmg >= target.hp,
        hitChance: 1.0
    };
};

export const findBestTarget = (
    attacker: Unit,
    allUnits: Unit[],
    mapData: Tile[],
    difficulty: AIDifficulty,
    weather: WeatherState,
    gridSize: number
): { unit: Unit, score: number } | null => {
    const enemies = allUnits.filter(u => u.owner !== attacker.owner);
    const attTile = getTileByIdFast(mapData, attacker.tileId, gridSize);
    if (!attTile || !canUnitAttackFromTile(attacker, attTile)) return null;

    const effectiveRange = getUnitRange(attacker, mapData, weather);

    // Filter valid targets (Range & LOS)
    const validTargets = enemies.filter(enemy => {
        const enemyTile = getTileByIdFast(mapData, enemy.tileId, gridSize);
        if (!enemyTile) return false;
        
        const dist = getManhattanDistance(attTile, enemyTile);
        if (dist > effectiveRange) return false;

        return hasLineOfSight(attTile, enemyTile, mapData, attacker.type, weather, gridSize);
    });

    if (validTargets.length === 0) return null;

    // --- EASY MODE: Just Closest ---
    if (difficulty === 'EASY') {
        const closest = validTargets.sort((a, b) => {
            const ta = getTileByIdFast(mapData, a.tileId, gridSize)!;
            const tb = getTileByIdFast(mapData, b.tileId, gridSize)!;
            return getManhattanDistance(attTile, ta) - getManhattanDistance(attTile, tb);
        })[0];
        return { unit: closest, score: 50 };
    }

    // --- MEDIUM & HARD: KILL MATRIX ---
    let bestTarget: Unit | null = null;
    let highestScore = -Infinity;

    validTargets.forEach(target => {
        let score = 0;
        const sim = simulateCombat(attacker, target, mapData, gridSize);

        // 1. DAMAGE & KILLS
        if (sim.isKill) {
            score += 150; // MASSIVE bonus for removing a unit
        } else {
            score += sim.damageDealt * 3; // Value damage
        }

        // Prioritize suppressing active enemy Overwatch stances
        if (target.isOverwatching) {
            score += 35;
        }

        // 2. TARGET PRIORITY (Hard Mode)
        if (difficulty === 'HARD') {
            if (target.type === 'SNIPER') score += 30; // Eliminate heavy hitters
            if (target.type === 'ASSAULTER') score += 20;
            if ((target.rank ?? 0) > 0) score += (target.rank ?? 0) * 20; // Hunt promoted Veterans/Aces

            // Focus-fire already wounded enemies to secure kills faster
            const missingHp = Math.max(0, (UNIT_STATS[target.type].hp || target.hp) - target.hp);
            score += missingHp * 1.5;

            // Don't overkill massively
            if (sim.isKill && target.hp < 3 && sim.damageDealt > 10) {
                score -= 10; // "Waste" of high damage
            }
        }

        if (score > highestScore) {
            highestScore = score;
            bestTarget = target;
        }
    });

    return bestTarget ? { unit: bestTarget, score: highestScore } : null;
};
