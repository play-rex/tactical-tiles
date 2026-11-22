import { Tile, Unit, GameSettings, WeatherState, AIDifficulty, VictoryMode } from '../types';
import { UNIT_STATS, TERRAIN_DEFENSE, UNIT_COSTS, CP_SYSTEM, SHOP_ITEMS, DOOMSDAY_SETTINGS, TERRAIN_COSTS, BANK_STATS, BASE_STATS, OVERWATCH_STATS } from '../constants/Config';
import {
    getValidMovesWithParents,
    reconstructMovePathFromParents,
    getTileByIdFast,
    hasLineOfSight,
    getManhattanDistance,
    calculateVisibility,
    getNeighbors
} from '../grid/Pathfinding';
import { findBestTarget } from './TargetingLogic';
import { getRingIndex } from '../grid/DoomsdayManager';
import { calculateSiegeDamage, canHoldDrop, canUnitAttackFromTile, canUnitEnterOverwatch, getEffectiveMaxRespawns, getUnitAttackCost, getUnitMaxHp, getUnitRange } from '../rules/CombatRules';
import { getOverwatchCoverageTiles, resolveMoveWithOverwatch } from '../rules/OverwatchRules';

// AI Action Types
export type AIAction =
  | { type: 'END_TURN' }
  | { type: 'MOVE'; unitId: string; targetTileId: string; cost: number }
  | { type: 'ATTACK'; attackerId: string; targetUnitId: string; cost: number }
  | { type: 'OVERWATCH'; unitId: string; cost: number }
  | { type: 'RELOAD'; unitId: string; cost: number }
  | { type: 'SECURE'; unitId: string; tileId: string; cost: number }
  | { type: 'HEIST'; unitId: string; tileId: string; cost: number }
  | { type: 'SIEGE'; unitId: string; tileId: string; cost: number }
  | { type: 'DEMOLISH'; unitId: string; tileId: string; cost: number }
  | { type: 'LOOT'; unitId: string; tileId: string; cost: number }
  | { type: 'BUY_DROP'; itemKey: string; tileId: string; cost: number; goldCost: number }
  | { type: 'USE_ITEM'; unitId: string; itemIndex: number; cost: number }
  | { type: 'SPAWN'; unitType: any; tileId: string; cost: number; goldCost: number; deadUnitId?: string };

interface GameStateProxy {
  mapData: Tile[];
  units: Unit[];
  currentPlayer: number;
  playerCp: number;
  playerGold: number;
  playerRespawns?: number;
  playerInventory: ('AMMO' | 'MEDKIT')[];
  weather: WeatherState;
  difficulty: AIDifficulty;
  graveyard: any[];
  victoryMode?: VictoryMode;
  gridSize: number;
  settings: GameSettings;
  totalTurns: number;
}

/**
 * Multi-source BFS over walkable terrain so AI units navigate around rivers, canyons, and walls via bridges.
 */
const computePathDistanceField = (
    goalTiles: Tile[],
    mapData: Tile[],
    gridSize: number
): Map<string, number> => {
    const distMap = new Map<string, number>();
    if (goalTiles.length === 0) return distMap;

    const queue: { x: number; y: number; d: number }[] = [];
    for (const g of goalTiles) {
        if (g.hazardState === 'LAVA') continue;
        distMap.set(g.id, 0);
        queue.push({ x: g.x, y: g.y, d: 0 });
    }

    const dirs = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 }
    ];

    let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        for (const dir of dirs) {
            const nx = cur.x + dir.dx;
            const ny = cur.y + dir.dy;
            if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
            const nId = `${nx},${ny}`;
            if (distMap.has(nId)) continue;
            const tile = mapData[ny * gridSize + nx];
            if (!tile || tile.hazardState === 'LAVA' || TERRAIN_COSTS[tile.type] >= 90) continue;
            distMap.set(nId, cur.d + 1);
            queue.push({ x: nx, y: ny, d: cur.d + 1 });
        }
    }

    return distMap;
};

// --- 1. MOVEMENT EVALUATION (Tactical Positions) ---

const evaluatePosition = (
    tile: Tile,
    unit: Unit,
    enemyTiles: Tile[],
    activeBanks: Tile[],
    activeEnemyBases: Tile[],
    difficulty: AIDifficulty,
    victoryMode: VictoryMode | undefined,
    targetBase: Tile | undefined,
    enemyDistField: Map<string, number>,
    baseDistField: Map<string, number>,
    doomsdayEnabled: boolean,
    totalTurns: number,
    gridSize: number,
    fogEnabled: boolean
): number => {
  let score = 0;
  const unitStats = UNIT_STATS[unit.type];

  // A. DOOMSDAY SURVIVAL (Priority #1)
  if (doomsdayEnabled) {
      const ring = getRingIndex(tile.x, tile.y, gridSize);
      const lavaTurn = DOOMSDAY_SETTINGS.START_TURN + (ring * DOOMSDAY_SETTINGS.SHRINK_INTERVAL);
      const turnsUntilDoom = lavaTurn - totalTurns;

      if (turnsUntilDoom <= 1) {
          score -= 5000;
      } else if (turnsUntilDoom <= 5) {
          score -= 500;
      } else {
          score += ring * 2;
      }
  }

  // B. Terrain Defense & Bonuses
  const defense = TERRAIN_DEFENSE[tile.type] || 0;
  score += defense * 20;

  if (tile.type === 'QUICKSAND') score -= 120;
  if (tile.type === 'DUNES') score += 10;

  // C. Unit Specific Preferences
  if (unit.type === 'SNIPER') {
      if (canUnitAttackFromTile(unit, tile)) {
          score += 65; // Snipers need Mountain, Dunes, or owned Building to shoot
      } else {
          score -= 25;
      }
  } else if (unit.type === 'ASSAULTER') {
      if (tile.type === 'FOREST') score += 20;
  }

  // D. Path & Range Assessment
  let minEnemyDist = 999;
  for (let i = 0; i < enemyTiles.length; i++) {
    const d = getManhattanDistance(tile, enemyTiles[i]);
    if (d < minEnemyDist) minEnemyDist = d;
  }

  const pathToEnemy = enemyDistField.get(tile.id);
  const pathToBase = baseDistField.get(tile.id);

  if (fogEnabled && enemyTiles.length === 0) {
      if (victoryMode === 'CONQUER' && pathToBase !== undefined) {
          score -= pathToBase * 4;
      } else {
          const centerDist = Math.abs(tile.x - gridSize / 2) + Math.abs(tile.y - gridSize / 2);
          score -= centerDist * 2.5;
          if (tile.type === 'BUILDING' && tile.owner !== unit.owner) score += 25;
          if (tile.type === 'BANK' && (tile.hackProgress || 0) < 100) score += 25;
      }
  } else if (enemyTiles.length > 0) {
      if (difficulty === 'EASY') {
          score += Math.random() * 25;
          if (pathToEnemy !== undefined) score -= pathToEnemy * 1.5;
      } else {
          const optimalRange = unitStats.range;

          if (unit.type === 'SNIPER') {
              if (minEnemyDist < 3) score -= 60;
              else if (minEnemyDist <= optimalRange && canUnitAttackFromTile(unit, tile)) score += 60;
              else if (pathToEnemy !== undefined) score -= pathToEnemy * 3;
          } else if (unit.type === 'ASSAULTER') {
              if (minEnemyDist <= 2) score += 40;
              else if (pathToEnemy !== undefined) score -= pathToEnemy * 4;
              else score -= minEnemyDist * 3;
          } else {
              if (minEnemyDist <= optimalRange) score += 25;
              else if (pathToEnemy !== undefined) score -= pathToEnemy * 3.5;
              else score -= minEnemyDist * 2;
          }
      }
  }

  // E. Objectives
  if (tile.type === 'BUILDING' && tile.owner !== unit.owner) {
      score += 35;
  }
  if (tile.type === 'BANK' && (tile.hackProgress || 0) < 100) {
      score += 45;
  }
  if (tile.loot) {
      score += 80;
  }

  // F. Base Siege (Conquer Mode)
  if (victoryMode === 'CONQUER' && targetBase) {
      const distToBase = getManhattanDistance(tile, targetBase);
      if (distToBase <= unitStats.range && canUnitAttackFromTile(unit, tile)) {
          score += 85;
      } else if (pathToBase !== undefined) {
          score -= pathToBase * 4;
      } else {
          score -= distToBase * 2;
      }
  }

  // G. Survival & Automated Turret Avoidance (Hard Mode)
  if (difficulty === 'HARD') {
      if (unit.hp < getUnitMaxHp(unit) * 0.4) {
          if (defense > 0) score += 45;
          if (minEnemyDist < 3) score -= 35;
      }

      let inBankTurretRange = false;
      for (let i = 0; i < activeBanks.length; i++) {
          if (getManhattanDistance(tile, activeBanks[i]) <= BANK_STATS.RANGE) {
              inBankTurretRange = true;
              break;
          }
      }
      if (inBankTurretRange && tile.type !== 'BANK') {
          score -= 25;
      }

      if (victoryMode === 'CONQUER') {
          let inEnemyArtilleryRange = false;
          for (let i = 0; i < activeEnemyBases.length; i++) {
              if (getManhattanDistance(tile, activeEnemyBases[i]) <= BASE_STATS.RANGE) {
                  inEnemyArtilleryRange = true;
                  break;
              }
          }
          if (inEnemyArtilleryRange && !(minEnemyDist <= unitStats.range) && (!targetBase || getManhattanDistance(tile, targetBase) > unitStats.range)) {
              score -= 30;
          }
      }
  }

  return score;
};

// --- 2. SHOP LOGIC (Logistics) ---

const checkShop = (gameState: GameStateProxy, myUnits: Unit[]): AIAction | null => {
    const { playerGold, playerCp, mapData, difficulty } = gameState;

    if (playerCp < 4 && difficulty !== 'EASY') return null;
    if (difficulty === 'EASY') return null;

    for (const unit of myUnits) {
        const maxHp = getUnitMaxHp(unit);
        const tile = mapData.find(t => t.id === unit.tileId);
        if (!tile) continue;

        if (unit.hp <= maxHp * 0.6 && playerGold >= SHOP_ITEMS.MEDKIT.cost) {
            const dropTile = findEmptyAdjacent(tile, mapData);
            if (dropTile) {
                return {
                    type: 'BUY_DROP',
                    itemKey: 'MEDKIT',
                    tileId: dropTile.id,
                    cost: 0,
                    goldCost: SHOP_ITEMS.MEDKIT.cost
                };
            }
        }

        if (unit.ammo <= 1 && playerGold >= SHOP_ITEMS.AMMO_REFILL.cost) {
            const dropTile = findEmptyAdjacent(tile, mapData);
            if (dropTile) {
                return {
                    type: 'BUY_DROP',
                    itemKey: 'AMMO_REFILL',
                    tileId: dropTile.id,
                    cost: 0,
                    goldCost: SHOP_ITEMS.AMMO_REFILL.cost
                };
            }
        }
    }
    return null;
};

const checkInventory = (gameState: GameStateProxy, myUnits: Unit[]): AIAction | null => {
    const { playerInventory } = gameState;
    if (playerInventory.length === 0) return null;

    for (const unit of myUnits) {
        const maxHp = getUnitMaxHp(unit);

        const medIndex = playerInventory.indexOf('MEDKIT');
        if (medIndex !== -1 && unit.hp <= maxHp * 0.5) {
            return { type: 'USE_ITEM', unitId: unit.id, itemIndex: medIndex, cost: 0 };
        }

        const ammoIndex = playerInventory.indexOf('AMMO');
        if (ammoIndex !== -1 && unit.ammo <= 1) {
            return { type: 'USE_ITEM', unitId: unit.id, itemIndex: ammoIndex, cost: 0 };
        }
    }
    return null;
};

const findEmptyAdjacent = (center: Tile, map: Tile[]): Tile | null =>
    getNeighbors(center, map).find(t => canHoldDrop(t) && t.type !== 'QUICKSAND') || null;

// --- 3. REINFORCEMENTS (Spawning) ---

const checkSpawn = (gameState: GameStateProxy): AIAction | null => {
    const { playerGold, playerRespawns = 0, graveyard, mapData, currentPlayer, units, difficulty, gridSize, settings } = gameState;

    if (playerRespawns >= getEffectiveMaxRespawns(settings.mutators)) return null;

    const occupied = new Set(units.map(u => u.tileId));
    const safeBases = mapData.filter(
        t => t.type === 'BASE' && t.owner === currentPlayer && t.hazardState !== 'LAVA'
    );

    if (safeBases.length === 0) return null;

    // Collect valid spawn tiles (base tile or adjacent safe tile if base is occupied)
    let spawnTileId: string | null = null;
    for (const base of safeBases) {
        if (!occupied.has(base.id)) {
            spawnTileId = base.id;
            break;
        }
        for (let dy = -1; dy <= 1 && !spawnTileId; dy++) {
            for (let dx = -1; dx <= 1 && !spawnTileId; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = base.x + dx;
                const ny = base.y + dy;
                if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
                const t = mapData[ny * gridSize + nx];
                if (
                    t &&
                    t.hazardState !== 'LAVA' &&
                    t.type !== 'WATER' &&
                    t.type !== 'BARRIER' &&
                    t.type !== 'CANYON' &&
                    !occupied.has(t.id)
                ) {
                    spawnTileId = t.id;
                }
            }
        }
        if (spawnTileId) break;
    }

    if (!spawnTileId) return null;

    const affordable = graveyard.filter(
        u => u.owner === currentPlayer && u.turnsUntilRespawn === 0 && playerGold >= UNIT_COSTS[u.type]
    );
    if (affordable.length === 0) return null;

    let choice: any = affordable[0];
    if (difficulty === 'HARD') {
        affordable.sort((a, b) => UNIT_COSTS[b.type] - UNIT_COSTS[a.type]);
        choice = affordable[0];
    } else if (difficulty === 'MEDIUM') {
        choice = affordable[Math.floor(Math.random() * affordable.length)];
    } else {
        affordable.sort((a, b) => UNIT_COSTS[a.type] - UNIT_COSTS[b.type]);
        choice = affordable[0];
    }

    return {
        type: 'SPAWN',
        unitType: choice.type,
        tileId: spawnTileId,
        cost: 0,
        goldCost: UNIT_COSTS[choice.type],
        deadUnitId: choice.id
    };
};

// --- MAIN AI LOOP ---

export const getBestAIAction = (gameState: GameStateProxy): AIAction => {
  const { mapData, units, currentPlayer, playerCp, difficulty, weather, victoryMode, gridSize, settings, totalTurns } = gameState;
  const myUnits = units.filter(u => u.owner === currentPlayer && !u.completed && !u.isRooted);

  // FOG OF WAR LOGIC: Filter visible enemies
  let enemyUnits = units.filter(u => u.owner !== currentPlayer);
  let aiVisibleSet: Set<string> | null = null;
  if (settings.fogOfWar) {
      aiVisibleSet = calculateVisibility(currentPlayer, units, mapData, weather, true, gridSize);
      enemyUnits = enemyUnits.filter(u => aiVisibleSet!.has(u.tileId));
  }
  const hasVisibleEnemyOverwatch = enemyUnits.some(e => e.isOverwatching && e.ammo > 0);

  // 0. Use Inventory (Free action)
  const inventoryAction = checkInventory(gameState, myUnits);
  if (inventoryAction) return inventoryAction;

  // 1. Reinforcements
  const spawnAction = checkSpawn(gameState);
  if (spawnAction) return spawnAction;

  // 2. Logistics
  const shopAction = checkShop(gameState, myUnits);
  if (shopAction) return shopAction;

  if (myUnits.length === 0) return { type: 'END_TURN' };

  let bestAction: AIAction = { type: 'END_TURN' };
  let bestScore = 0; // Only take actions strictly better than passing (0)

  // Locate nearest live Enemy Base in Conquer Mode
  const enemyBases = victoryMode === 'CONQUER'
      ? mapData.filter(t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0)
      : [];

  // Precompute reverse-BFS path distance fields & tactical structures once per AI evaluation
  const enemyTiles = enemyUnits
      .map(e => getTileByIdFast(mapData, e.tileId, gridSize))
      .filter((t): t is Tile => Boolean(t));
  const enemyDistField = computePathDistanceField(enemyTiles, mapData, gridSize);

  const activeBanks = mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
  const baseDistCache = new Map<string, Map<string, number>>();
  const barTiles = mapData.filter(t => t.type === 'BARRIER' && t.hp !== undefined && t.hp > 0);

  // Precompute Overwatch coverage & observer vision ONCE instead of per-candidate-tile
  const visibleOverwatchers = (difficulty === 'HARD' && hasVisibleEnemyOverwatch)
      ? enemyUnits.filter(u => u.isOverwatching === true && u.ammo > 0)
      : [];
  const knownCoverageByOverwatcher = new Map<string, Set<string>>();
  const anyWatchedTileIds = new Set<string>();
  const knownTeamVisByOwner = new Map<number, Set<string>>();
  if (visibleOverwatchers.length > 0) {
      for (const ow of visibleOverwatchers) {
          const cov = getOverwatchCoverageTiles(ow, mapData, weather, gridSize);
          knownCoverageByOverwatcher.set(ow.id, cov);
          cov.forEach(tid => anyWatchedTileIds.add(tid));
          if (settings.fogOfWar && !knownTeamVisByOwner.has(ow.owner)) {
              knownTeamVisByOwner.set(ow.owner, calculateVisibility(ow.owner, units, mapData, weather, true, gridSize));
          }
      }
  }

  for (const unit of myUnits) {
    const unitStats = UNIT_STATS[unit.type];
    const uTile = getTileByIdFast(mapData, unit.tileId, gridSize);
    if (!uTile) continue;
    const adj = [uTile, ...getNeighbors(uTile, mapData, gridSize)];

    // Pick closest enemy base for this unit
    let targetBase: Tile | undefined;
    if (enemyBases.length > 0) {
        targetBase = enemyBases.reduce((best, cur) =>
            getManhattanDistance(uTile, cur) < getManhattanDistance(uTile, best) ? cur : best
        );
    }
    let baseDistField: Map<string, number>;
    if (targetBase) {
        const cached = baseDistCache.get(targetBase.id);
        if (cached) {
            baseDistField = cached;
        } else {
            baseDistField = computePathDistanceField([targetBase], mapData, gridSize);
            baseDistCache.set(targetBase.id, baseDistField);
        }
    } else {
        baseDistField = new Map<string, number>();
    }

    // --- INTERACTION ACTIONS ---

    // A. Loot Supplies
    if (playerCp >= 4) {
        const lootTile = adj.find(t => t.loot !== null && t.loot !== undefined);
        if (lootTile) {
            const priority = 150;
            if (priority > bestScore) {
                bestScore = priority;
                bestAction = { type: 'LOOT', unitId: unit.id, tileId: lootTile.id, cost: 4 };
            }
        }
    }

    // B. Emergency Field Reload when out of ammo (Medium & Hard)
    if (difficulty !== 'EASY' && unit.ammo === 0 && playerCp >= CP_SYSTEM.RELOAD_COST) {
        const reloadScore = 95;
        if (reloadScore > bestScore) {
            bestScore = reloadScore;
            bestAction = { type: 'RELOAD', unitId: unit.id, cost: CP_SYSTEM.RELOAD_COST };
        }
    }

    // C. Secure Buildings / Heist Banks (Avoid flipping building back and forth under active close threat)
    if (playerCp >= 4) {
        let nearbyThreat = false;
        for (let i = 0; i < enemyTiles.length; i++) {
            if (getManhattanDistance(uTile, enemyTiles[i]) <= 3) {
                nearbyThreat = true;
                break;
            }
        }

        const b = adj.find(t => t.type === 'BUILDING' && t.owner !== currentPlayer);
        if (b && (difficulty !== 'EASY' || Math.random() < 0.4)) {
            const secureScore = nearbyThreat ? 18 : b.owner == null ? 55 : 42;
            if (secureScore > bestScore) {
                bestScore = secureScore;
                bestAction = { type: 'SECURE', unitId: unit.id, tileId: b.id, cost: 4 };
            }
        }

        const bank = adj.find(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
        if (bank && (difficulty !== 'EASY' || Math.random() < 0.5)) {
            const heistScore = 115;
            if (heistScore > bestScore) {
                bestScore = heistScore;
                bestAction = { type: 'HEIST', unitId: unit.id, tileId: bank.id, cost: 4 };
            }
        }
    }

    // --- COMBAT ACTIONS (Only against Visible Enemies) ---
    const canAttackFromHere = canUnitAttackFromTile(unit, uTile);
    const effectiveRange = getUnitRange(unit, mapData, weather);
    const attackCost = getUnitAttackCost(unit);

    // D. Attack Unit
    if (playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere) {
        const result = findBestTarget(unit, [...myUnits, ...enemyUnits], mapData, difficulty, weather, gridSize);
        if (result && result.score > bestScore) {
            bestScore = result.score;
            bestAction = { type: 'ATTACK', attackerId: unit.id, targetUnitId: result.unit.id, cost: attackCost };
        }
    }

    // E. Siege Base (under fog, only a base it can see, as for a player)
    if (targetBase && playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere &&
        (!aiVisibleSet || aiVisibleSet.has(targetBase.id))) {
         const dist = getManhattanDistance(uTile, targetBase);
         if (dist <= effectiveRange) {
             const hasLOS = hasLineOfSight(uTile, targetBase, mapData, unit.type, weather, gridSize);
             if (hasLOS) {
                 const siegeDmg = calculateSiegeDamage(unit, uTile);
                 let siegeScore = difficulty === 'EASY' ? 50 : 120;
                 if ((targetBase.hp || 50) <= siegeDmg) siegeScore = difficulty === 'EASY' ? 90 : 9999;
                 else if (difficulty !== 'EASY' && unit.type === 'SNIPER') siegeScore += 50;

                 if (siegeScore > bestScore) {
                     bestScore = siegeScore;
                     bestAction = { type: 'SIEGE', unitId: unit.id, tileId: targetBase.id, cost: attackCost };
                 }
             }
         }
    }

    // F. Demolish Barriers
    if (playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere) {
        for (const barrier of barTiles) {
            if (getManhattanDistance(uTile, barrier) > effectiveRange) continue;
            if (aiVisibleSet && !aiVisibleSet.has(barrier.id)) continue;
            const hasLOS = hasLineOfSight(uTile, barrier, mapData, unit.type, weather, gridSize);
            if (hasLOS) {
                let demolishScore = 20;
                if (unit.type === 'ASSAULTER') demolishScore += 20;

                if (demolishScore > bestScore) {
                    bestScore = demolishScore;
                    bestAction = { type: 'DEMOLISH', unitId: unit.id, tileId: barrier.id, cost: attackCost };
                }
            }
        }
    }

    // --- MOVEMENT ACTIONS (Relative improvement over current tile) ---
    if (!unit.hasMoved) {
        const currentScore = evaluatePosition(
            uTile, unit, enemyTiles, activeBanks, enemyBases, difficulty, victoryMode,
            targetBase, enemyDistField, baseDistField,
            settings.doomsdayEnabled, totalTurns, gridSize, settings.fogOfWar
        );

        const { validMoves: moveMap, parents: moveParents } = getValidMovesWithParents(
            uTile, playerCp, mapData, units, unit.type, currentPlayer, weather, gridSize, unit.rank ?? 0
        );
        for (const [tileId, cost] of moveMap) {
            const destTile = getTileByIdFast(mapData, tileId, gridSize);
            if (!destTile) continue;

            const destScore = evaluatePosition(
                destTile, unit, enemyTiles, activeBanks, enemyBases, difficulty, victoryMode,
                targetBase, enemyDistField, baseDistField,
                settings.doomsdayEnabled, totalTurns, gridSize, settings.fogOfWar
            );

            // Net positional gain minus tiny CP friction; avoids stepping back onto worse tiles
            let moveValue = (destScore - currentScore) - cost * 0.5;

            const neighbors = getNeighbors(destTile, mapData, gridSize);
            if (neighbors.some(n => n.type === 'BANK' && (n.hackProgress || 0) < 100)) moveValue += 18;
            if (neighbors.some(n => n.type === 'BUILDING' && n.owner !== currentPlayer)) moveValue += 12;

            // Respect visible enemy Overwatch on HARD difficulty (Elite Breachers resist pin)
            if (anyWatchedTileIds.size > 0) {
                const candidatePath = reconstructMovePathFromParents(uTile, tileId, moveMap, moveParents, mapData, gridSize);
                let touchesOverwatch = false;
                for (let k = 1; k < candidatePath.length; k++) {
                    if (anyWatchedTileIds.has(candidatePath[k].id)) {
                        touchesOverwatch = true;
                        break;
                    }
                }
                if (touchesOverwatch) {
                    const res = resolveMoveWithOverwatch({
                        movingUnit: unit,
                        targetTileId: tileId,
                        mapData,
                        units,
                        weather,
                        gridSize,
                        fogOfWar: settings.fogOfWar,
                        maxBudget: playerCp,
                        knownVisibleTiles: aiVisibleSet,
                        precomputedPath: candidatePath,
                        precomputedEnemyOverwatchers: visibleOverwatchers,
                        knownTeamVisByOwner,
                        knownCoverageByOverwatcher
                    });
                    if (res.trigger) {
                        if (res.trigger.victimDead) moveValue -= 45;
                        else if (res.trigger.pinResisted) moveValue -= 6;
                        else moveValue -= (18 + res.trigger.damage);
                    }
                }
            }

            // Keep Easy AI visibly unfocused and prone to suboptimal moves
            if (difficulty === 'EASY') {
                moveValue += (Math.random() - 0.5) * 35;
            }

            // Require clear net progress (> 2) so units don't jitter back and forth
            if (moveValue > 2 && moveValue > bestScore) {
                bestScore = moveValue;
                bestAction = { type: 'MOVE', unitId: unit.id, targetTileId: tileId, cost: cost };
            }
        }
    }

    // --- OVERWATCH STANCE (Medium & Hard AI tactical zoning) ---
    if (difficulty !== 'EASY' && canUnitEnterOverwatch(unit, uTile, playerCp)) {
        const uZoneWeather = uTile.zone !== undefined ? weather.playerZones[uTile.zone] || 'CLEAR' : 'CLEAR';
        if (uZoneWeather !== 'FOG' && uZoneWeather !== 'SANDSTORM') {
            let minEnemyDist = 999;
            for (let i = 0; i < enemyTiles.length; i++) {
                const d = getManhattanDistance(uTile, enemyTiles[i]);
                if (d < minEnemyDist) minEnemyDist = d;
            }
            const watchingApproach =
                minEnemyDist <= effectiveRange + 4 ||
                (settings.fogOfWar && minEnemyDist === 999 && (uTile.type === 'BUILDING' || canUnitAttackFromTile(unit, uTile)));

            if (watchingApproach) {
                const owCost = OVERWATCH_STATS[unit.type].cost;
                const otherReadyCount = myUnits.filter(u => u.id !== unit.id && !u.completed).length;
                let owScore = unit.type === 'SNIPER' ? 32 : unit.type === 'ASSAULTER' ? 28 : 24;
                if (unit.hasMoved) owScore += 6;
                if (adj.some(t => t.type === 'BANK' || t.type === 'BUILDING' || t.type === 'BASE')) owScore += 8;
                owScore -= otherReadyCount * 8;

                if (owScore > bestScore && playerCp >= owCost) {
                    bestScore = owScore;
                    bestAction = { type: 'OVERWATCH', unitId: unit.id, cost: owCost };
                }
            }
        }
    }
  }

  return bestAction;
};


