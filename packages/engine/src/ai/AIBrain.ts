import { Tile, Unit, GameSettings, WeatherState, AIDifficulty, VictoryMode, SupplyLootType, LandMine, PerkId, SharedContract, FinalPushStatus, ActiveAirDrop, SmokeZone } from '../types';
import type { DoomsdayZone } from '../types';
import { smokeBlocksLine } from '../tactical/geometry';
import { UNIT_STATS, TERRAIN_DEFENSE, RESPAWN_CP_COST, CP_SYSTEM, SHOP_ITEMS, DOOMSDAY_SETTINGS, getDoomsdayStartTurn, TERRAIN_COSTS, BANK_STATS, BASE_STATS, OVERWATCH_STATS, AGGRESSION_AFTER_ROUNDS, AGGRESSION_START_ROUND } from '../constants/Config';
import {
    getValidMovesWithParents,
    reconstructMovePathFromParents,
    getTileByIdFast,
    hasLineOfSight,
    getManhattanDistance,
    getMinManhattanDistance,
    hasTileWithinRange,
    calculateVisibility,
    getNeighbors
} from '../grid/Pathfinding';
import { getSpawnTiles, INTERACT_COST } from '../game/options';
import { findBestTarget } from './TargetingLogic';
import { getDoomsdayNextRadius, getDoomsdayRadius, getRingIndex } from '../grid/DoomsdayManager';
import { calculateSiegeDamage, canConstructOnTile, canHoldDrop, canUnitAttackFromTile, canUnitEnterOverwatch, getEffectiveCpRules, getEffectiveMaxRespawns, getUnitAttackCost, getUnitBaseDamage, getUnitMaxHp, getUnitRange } from '../rules/CombatRules';
import { getOverwatchCoverageTiles, resolveMoveWithOverwatch } from '../rules/OverwatchRules';

// AI Action Types
export type AIAction =
  | { type: 'END_TURN' }
  | { type: 'MOVE'; unitId: string; targetTileId: string; cost: number }
  | { type: 'ATTACK'; attackerId: string; targetUnitId: string; cost: number }
  | { type: 'OVERWATCH'; unitId: string; cost: number }
  | { type: 'RELOAD'; unitId: string; cost: number }
  | { type: 'SECURE'; unitId: string; tileId: string; cost: number }
  | { type: 'SIEGE'; unitId: string; tileId: string; cost: number }
  | { type: 'DEMOLISH'; unitId: string; tileId: string; cost: number }
  | { type: 'LOOT'; unitId: string; tileId: string; cost: number }
  | { type: 'BUY_DROP'; itemKey: string; tileId: string; cost: number; goldCost: number }
  | { type: 'BUILD'; itemKey: string; tileId: string; cost: number }
  | { type: 'USE_ITEM'; unitId: string; itemIndex: number; cost: number }
  | { type: 'SPAWN'; unitType: any; tileId: string; cost: number; deadUnitId?: string }
  /** Borrow CP for a kill the bot is a few points short of. */
  | { type: 'OVERCLOCK'; amount: number }
  | { type: 'CHOOSE_PERK'; unitId: string; perkId: PerkId }
  | { type: 'FINAL_PUSH' };

interface GameStateProxy {
  mapData: Tile[];
  units: Unit[];
  currentPlayer: number;
  playerCp: number;
  playerCpDebt?: number;
  playerCpBorrowed?: number;
  playerGold: number;
  playerRespawns?: number;
  playerInventory: SupplyLootType[];
  mines?: LandMine[];
  weather: WeatherState;
  difficulty: AIDifficulty;
  graveyard: any[];
  victoryMode?: VictoryMode;
  gridSize: number;
  settings: GameSettings;
  /** The match's closing circle, when Deathmatch + Doomsday is active. */
  doomsdayZone?: DoomsdayZone;
  totalTurns: number;
  lastHqDamageRound?: number;
  /** The round's shared contract, so the bot races for it instead of handing it to the human. */
  contract?: SharedContract | null;
  /** The bot's Final Push token, if the endgame has granted one. */
  finalPush?: FinalPushStatus;
  /** Incoming Theater Air Supply Drops; FLARE entries expose the exact LZ. */
  airDrops?: ActiveAirDrop[];
  /** Active Smoke Screen clouds blocking LOS and Overwatch both ways. */
  smokeZones?: SmokeZone[];
}

const BFS_DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

/**
 * BFS step-distances from a start tile over ground-walkable terrain, treating every
 * mountain as blocked except one blasted gap tile (a candidate tunnel). -1 = unreachable.
 */
const bfsFromWithGap = (
    mapData: Tile[],
    gridSize: number,
    startId: string,
    gapId: string | null,
): Int32Array | null => {
    const start = mapData.find(t => t.id === startId);
    if (!start) return null;
    const dists = new Int32Array(gridSize * gridSize).fill(-1);
    const sIdx = start.y * gridSize + start.x;
    dists[sIdx] = 0;
    const q: number[] = [sIdx];
    let head = 0;
    while (head < q.length) {
        const cur = q[head++];
        const cx = cur % gridSize;
        const cy = (cur / gridSize) | 0;
        for (let i = 0; i < 4; i++) {
            const nx = cx + BFS_DIRS[i][0];
            const ny = cy + BFS_DIRS[i][1];
            if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
            const nIdx = ny * gridSize + nx;
            if (dists[nIdx] !== -1) continue;
            const t = mapData[nIdx];
            if (!t || t.hazardState === 'LAVA') continue;
            // Structure targets (BASE, BANK, BUILDING) can be reached up to their tile without walking through them.
            if (t.type === 'BASE' || t.type === 'BANK' || t.type === 'BUILDING') {
                dists[nIdx] = dists[cur] + 1;
                continue;
            }
            if (TERRAIN_COSTS[t.type] >= 90) continue;
            if (t.type === 'MOUNTAIN' && t.id !== gapId) continue;
            dists[nIdx] = dists[cur] + 1;
            q.push(nIdx);
        }
    }
    return dists;
};

/**
 * Multi-source BFS over walkable terrain so AI units navigate around rivers, canyons, and walls via bridges.
 */
const computePathDistanceField = (
    goalTiles: Tile[],
    mapData: Tile[],
    gridSize: number,
    allowMountain = false,
): Int32Array | null => {
    if (goalTiles.length === 0) return null;
    const dists = new Int32Array(gridSize * gridSize).fill(-1);
    const qIdx: number[] = [];

    for (const g of goalTiles) {
        if (g.hazardState === 'LAVA') continue;
        const idx = g.y * gridSize + g.x;
        dists[idx] = 0;
        qIdx.push(idx);
    }

    let head = 0;
    while (head < qIdx.length) {
        const curIdx = qIdx[head++];
        const cx = curIdx % gridSize;
        const cy = (curIdx / gridSize) | 0;
        const nextDist = dists[curIdx] + 1;

        for (let i = 0; i < 4; i++) {
            const nx = cx + BFS_DIRS[i][0];
            const ny = cy + BFS_DIRS[i][1];
            if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
            const nIdx = ny * gridSize + nx;
            if (dists[nIdx] !== -1) continue;
            const tile = mapData[nIdx];
            if (
                !tile ||
                tile.hazardState === 'LAVA' ||
                TERRAIN_COSTS[tile.type] >= 90 ||
                tile.type === 'BUILDING' ||
                (!allowMountain && tile.type === 'MOUNTAIN')
            ) continue;
            dists[nIdx] = nextDist;
            qIdx.push(nIdx);
        }
    }

    return dists;
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
    enemyDistField: Int32Array | null,
    baseDistField: Int32Array | null,
    doomsdayEnabled: boolean,
    doomsdayStartTurn: number,
    doomsdayZone: DoomsdayZone | undefined,
    totalTurns: number,
    gridSize: number,
    fogEnabled: boolean,
    supplyDistField: Int32Array | null = null
): number => {
  let score = 0;
  const unitStats = UNIT_STATS[unit.type];

  // A. DOOMSDAY SURVIVAL (Priority #1)
  if (doomsdayEnabled) {
      if (doomsdayZone) {
          const dist = Math.hypot(
              tile.x + 0.5 - doomsdayZone.center.x,
              tile.y + 0.5 - doomsdayZone.center.y,
          );
          const radius = getDoomsdayRadius(doomsdayZone, totalTurns);
          const nextRadius = getDoomsdayNextRadius(doomsdayZone, totalTurns);
          if (dist > radius) {
              score -= 5000;
          } else if (dist > nextRadius) {
              score -= 500;
          } else {
              // Central floor is safer and pulls the squad toward the final fight.
              score += Math.max(0, radius - dist) * 2;
          }
      } else {
          const ring = getRingIndex(tile.x, tile.y, gridSize);
          const lavaTurn = doomsdayStartTurn + (ring * DOOMSDAY_SETTINGS.SHRINK_INTERVAL);
          const turnsUntilDoom = lavaTurn - totalTurns;

          if (turnsUntilDoom <= 1) {
              score -= 5000;
          } else if (turnsUntilDoom <= 5) {
              score -= 500;
          } else {
              score += ring * 2;
          }
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
  const minEnemyDist = getMinManhattanDistance(tile, enemyTiles);
  const tileIdx = tile.y * gridSize + tile.x;
  const rawEnemyDist = enemyDistField ? enemyDistField[tileIdx] : -1;
  const rawBaseDist = baseDistField ? baseDistField[tileIdx] : -1;
  const pathToEnemy = rawEnemyDist >= 0 ? rawEnemyDist : undefined;
  const pathToBase = rawBaseDist >= 0 ? rawBaseDist : undefined;

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
  if (tile.loot && tile.loot !== 'FIELD_SUPPLY' && tile.loot !== 'TACTICAL_SUPPLY') {
      score += 80;
  }

  // E2. Supply drops. A mystery crate underfoot is the strongest local objective, and a
  // nearby crate (or a lit FLARE LZ) pulls a squad in from up to 8 path tiles. Beyond that
  // the troop keeps playing the normal objective game instead of crossing the map.
  const rawSupplyDist = supplyDistField ? supplyDistField[tileIdx] : -1;
  if (tile.loot === 'TACTICAL_SUPPLY') {
      score += 150;
  } else if (tile.loot === 'FIELD_SUPPLY') {
      score += 110;
  } else if (rawSupplyDist > 0 && rawSupplyDist <= 8) {
      score += (9 - rawSupplyDist) * 6;
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

      if (hasTileWithinRange(tile, activeBanks, BANK_STATS.RANGE) && tile.type !== 'BANK') {
          score -= 25;
      }

      if (victoryMode === 'CONQUER') {
          const inEnemyArtilleryRange = hasTileWithinRange(tile, activeEnemyBases, BASE_STATS.RANGE);
          if (inEnemyArtilleryRange && !(minEnemyDist <= unitStats.range) && (!targetBase || getManhattanDistance(tile, targetBase) > unitStats.range)) {
              score -= 30;
          }
      }
  }

  return score;
};

// --- 2. SHOP LOGIC (Logistics) ---

const checkShop = (gameState: GameStateProxy, myUnits: Unit[], visibleUnits: Unit[]): AIAction | null => {
    const { playerGold, playerCp, mapData, gridSize, difficulty, currentPlayer, mines = [] } = gameState;

    if (playerCp < 4 && difficulty !== 'EASY') return null;
    if (difficulty === 'EASY') return null;

    for (const unit of myUnits) {
        const maxHp = getUnitMaxHp(unit);
        const tile = getTileByIdFast(mapData, unit.tileId, gridSize);
        if (!tile) continue;

        const healKey: 'MEDKIT' | 'FIRST_AID' | null =
            unit.hp <= maxHp * 0.45 && playerGold >= SHOP_ITEMS.MEDKIT.cost ? 'MEDKIT'
            : unit.hp <= maxHp * 0.7 && playerGold >= SHOP_ITEMS.FIRST_AID.cost ? 'FIRST_AID'
            : null;
        if (healKey) {
            const dropTile = findEmptyAdjacent(tile, mapData, gridSize);
            if (dropTile) {
                return {
                    type: 'BUY_DROP',
                    itemKey: healKey,
                    tileId: dropTile.id,
                    cost: 0,
                    goldCost: SHOP_ITEMS[healKey].cost
                };
            }
        }

        if (unit.ammo <= 1 && playerGold >= SHOP_ITEMS.AMMO_REFILL.cost) {
            const dropTile = findEmptyAdjacent(tile, mapData, gridSize);
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

    const ownMines = mines.filter(m => m.owner === currentPlayer).length;
    if (difficulty === 'HARD' && playerGold >= 225 && ownMines < 2 && myUnits.length > 0) {
        for (const unit of myUnits) {
            const tile = getTileByIdFast(mapData, unit.tileId, gridSize);
            if (!tile) continue;
            const adj = getNeighbors(tile, mapData, gridSize);
            const sortedAdj = [...adj].sort((a, b) => {
                const scoreTile = (t: Tile) =>
                    t.type === 'BRIDGE' || t.type === 'BRIDGE_V' || t.type === 'TUNNEL' ? 3 : t.type === 'ROAD' || t.type === 'ROAD_H' ? 2 : 1;
                return scoreTile(b) - scoreTile(a);
            });
            const mineTile = sortedAdj.find(t =>
                canConstructOnTile('LAND_MINE', t, visibleUnits, { playerId: currentPlayer, mapData, mines })
            );
            if (mineTile) {
                return { type: 'BUILD', itemKey: 'LAND_MINE', tileId: mineTile.id, cost: 0 };
            }
        }
    }

    // HARD-only: blast a Mountain Tunnel when a ridge separates a ground unit from an
    // objective (enemy, enemy HQ, bank, or capturable building). Human rules are untouched:
    // the BUILD still passes the same validation and pays the same 125€ shop price.
    if (difficulty === 'HARD' && playerGold >= SHOP_ITEMS.TUNNEL.cost + 100 && myUnits.length > 0) {
        if (mapData.filter(t => t.type === 'TUNNEL').length >= 2) return null;
        const enemyBaseTiles = mapData.filter(t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0);
        const bankTiles = mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
        const capturableTiles = mapData.filter(t => t.type === 'BUILDING' && t.owner !== currentPlayer);
        const enemyTiles = visibleUnits
            .filter(u => u.owner !== currentPlayer)
            .map(u => getTileByIdFast(mapData, u.tileId, gridSize))
            .filter((t): t is Tile => Boolean(t));
        const objectives = [...enemyTiles, ...enemyBaseTiles, ...bankTiles, ...capturableTiles];
        if (objectives.length === 0) return null;
        const buildCtx = { playerId: currentPlayer, mapData, mines };
        const openTunnels = mapData.filter(t => t.type === 'TUNNEL');
        for (const unit of myUnits) {
            if (unit.type === 'SNIPER') continue; // Snipers already cross mountains
            const uTile = getTileByIdFast(mapData, unit.tileId, gridSize);
            if (!uTile) continue;
            const nearObjectives = objectives
                .map(o => ({ o, d: getManhattanDistance(uTile, o) }))
                .sort((a, b) => a.d - b.d)
                .slice(0, 4);
            // Ridges near the unit are the visible, plausible blasting zone.
            const ridges = mapData
                .filter(t =>
                    t.type === 'MOUNTAIN' &&
                    getManhattanDistance(uTile, t) <= 5 &&
                    canConstructOnTile('TUNNEL', t, visibleUnits, buildCtx)
                )
                .sort((a, b) => getManhattanDistance(uTile, a) - getManhattanDistance(uTile, b))
                .slice(0, 10);
            if (ridges.length === 0) continue;
            const walkNow = bfsFromWithGap(mapData, gridSize, uTile.id, null);
            if (!walkNow) continue;
            for (const { o: target } of nearObjectives) {
                const tIdx = target.y * gridSize + target.x;
                const dNow = walkNow[tIdx];
                if (dNow !== -1 && dNow <= 8) continue; // already a short walk away
                for (const ridge of ridges) {
                    // A nearby open lane already serves this reachable objective: don't pay
                    // 125€ for a second one. Unreachable objectives are exempt — punching
                    // through a double-thick wall still needs its second blast.
                    if (dNow !== -1 && openTunnels.some(t => getManhattanDistance(t, ridge) <= 3)) continue;
                    const walkGap = bfsFromWithGap(mapData, gridSize, uTile.id, ridge.id);
                    const dNew = walkGap ? walkGap[tIdx] : -1;
                    if (dNew === -1) continue;
                    if (dNow === -1 || dNew <= dNow - 3) {
                        return { type: 'BUILD', itemKey: 'TUNNEL', tileId: ridge.id, cost: 0 };
                    }
                }
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

        const firstAidIndex = playerInventory.indexOf('FIRST_AID');
        if (firstAidIndex !== -1 && unit.hp <= maxHp * 0.75) {
            return { type: 'USE_ITEM', unitId: unit.id, itemIndex: firstAidIndex, cost: 0 };
        }

        const ammoIndex = playerInventory.indexOf('AMMO');
        if (ammoIndex !== -1 && unit.ammo <= 1) {
            return { type: 'USE_ITEM', unitId: unit.id, itemIndex: ammoIndex, cost: 0 };
        }
    }
    return null;
};

const findEmptyAdjacent = (center: Tile, map: Tile[], gridSize: number): Tile | null =>
    getNeighbors(center, map, gridSize).find(t => canHoldDrop(t) && t.type !== 'QUICKSAND') || null;

// --- 3. REINFORCEMENTS (Spawning) ---

const checkSpawn = (gameState: GameStateProxy): AIAction | null => {
    const { playerCp = 0, playerRespawns = 0, graveyard, currentPlayer, difficulty, settings } = gameState;

    if (playerRespawns >= getEffectiveMaxRespawns(settings.mutators)) return null;

    const spawnTiles = getSpawnTiles(gameState, currentPlayer);
    if (spawnTiles.length === 0) return null;
    const spawnTileId = spawnTiles[0];

    // Redeploys are paid in CP, so a body is only a candidate when the battery can cover it.
    // This runs before any other spending in the action loop, which is the reservation: the
    // turn's CP goes to a ready body first, and a spawn the seat can't pay for is never proposed.
    const affordable = graveyard.filter(
        u => u.owner === currentPlayer && u.turnsUntilRespawn === 0 && playerCp >= RESPAWN_CP_COST[u.type]
    );
    if (affordable.length === 0) return null;

    let choice: any = affordable[0];
    if (difficulty === 'HARD') {
        affordable.sort((a, b) => RESPAWN_CP_COST[b.type] - RESPAWN_CP_COST[a.type]);
        choice = affordable[0];
    } else if (difficulty === 'MEDIUM') {
        choice = affordable[Math.floor(Math.random() * affordable.length)];
    } else {
        affordable.sort((a, b) => RESPAWN_CP_COST[a.type] - RESPAWN_CP_COST[b.type]);
        choice = affordable[0];
    }

    return {
        type: 'SPAWN',
        unitType: choice.type,
        tileId: spawnTileId,
        cost: RESPAWN_CP_COST[choice.type],
        deadUnitId: choice.id
    };
};

// --- MAIN AI LOOP ---

/**
 * Borrows CP only to finish a kill it is at most 3 CP short of. Deliberately narrow: the bot
 * never borrows just to bank CP, and one borrow per turn is enforced by the debt itself.
 */
/** The safe default pick for each class; the bot does not try to read the board for this. */
const AI_PERK_CHOICE: Record<Unit['type'], PerkId> = {
  SOLDIER: 'RELAY',
  ASSAULTER: 'BULWARK',
  SNIPER: 'COLD_BORE',
};

const checkOverclock = (gameState: GameStateProxy): AIAction | null => {
  const { playerCp, playerCpDebt = 0, playerCpBorrowed = 0, units, currentPlayer, mapData, weather, gridSize, smokeZones } = gameState;
  if (playerCpBorrowed > 0 || playerCpDebt > 0) return null;
  const enemies = units.filter(u => u.owner !== currentPlayer);
  const borrow = (cost: number): number => {
    const short = cost - playerCp;
    return short >= 1 && short <= 3 ? short : 0;
  };
  for (const unit of units) {
    if (unit.owner !== currentPlayer || unit.completed || unit.isRooted) continue;
    const tile = getTileByIdFast(mapData, unit.tileId, gridSize);
    if (!tile) continue;
    const atkShort = borrow(getUnitAttackCost(unit));
    const range = getUnitRange(unit, mapData, weather, tile);

    // A kill that is already in range: the cleanest reason to borrow.
    if (atkShort > 0 && unit.ammo > 0) {
      for (const enemy of enemies) {
        const et = getTileByIdFast(mapData, enemy.tileId, gridSize);
        if (!et || getManhattanDistance(tile, et) > range) continue;
        if (!hasLineOfSight(tile, et, mapData, unit.type, weather, gridSize) || smokeBlocksLine(smokeZones, tile, et)) continue;
        if (enemy.hp <= getUnitBaseDamage(unit)) return { type: 'OVERCLOCK', amount: atkShort };
      }
    }

    // A building it can flip this turn.
    const secureShort = borrow(INTERACT_COST);
    if (secureShort > 0 && getNeighbors(tile, mapData, gridSize).some(t => t.type === 'BUILDING' && t.owner !== currentPlayer)) {
      return { type: 'OVERCLOCK', amount: secureShort };
    }

    // A vault one shot from opening.
    if (atkShort > 0 && unit.ammo > 0 && unit.type !== 'SNIPER') {
      for (const t of mapData) {
        if (t.type !== 'BANK' || (t.hp ?? 0) <= 0 || (t.hackProgress ?? 0) >= 100) continue;
        if (getManhattanDistance(tile, t) > range) continue;
        if (!hasLineOfSight(tile, t, mapData, unit.type, weather, gridSize) || smokeBlocksLine(smokeZones, tile, t)) continue;
        if ((t.hp ?? 0) <= calculateSiegeDamage(unit, tile, 'BANK')) return { type: 'OVERCLOCK', amount: atkShort };
      }
    }
  }
  return null;
};

export const getBestAIAction = (gameState: GameStateProxy): AIAction => {
  const { mapData, units, currentPlayer, playerCp, playerGold, playerRespawns, graveyard, difficulty, weather, victoryMode, gridSize, settings, doomsdayZone, totalTurns, smokeZones } = gameState;
  const doomsdayStartTurn = getDoomsdayStartTurn(settings, gridSize);
  const myUnits = units.filter(u => u.owner === currentPlayer && !u.completed && !u.isRooted);

  // --- LAST-STAND ENDGAME: every remaining side fields ≤1 unit and I cannot
  // reinforce (no ready bodies, respawns exhausted, or nowhere to spawn). Normal
  // positional play stalemates here (overwatch-camping + passing forever), so the
  // unit below switches to a pure HQ hunt: no overwatch, no securing, march.
  const aliveBySeat = new Map<number, number>();
  for (const u of units) aliveBySeat.set(u.owner, (aliveBySeat.get(u.owner) ?? 0) + 1);
  const usedRespawns = typeof playerRespawns === 'number' ? playerRespawns : 0;
  const iCanReinforce =
    (graveyard || []).some(g => g.owner === currentPlayer && (g.turnsUntilRespawn ?? 0) <= 0 && playerCp >= RESPAWN_CP_COST[g.type]) &&
    usedRespawns < getEffectiveMaxRespawns(settings.mutators) &&
    getSpawnTiles(gameState, currentPlayer).length > 0;
  const lastStand = aliveBySeat.size > 0 && !iCanReinforce && [...aliveBySeat.values()].every(n => n <= 1);

  // ── AGGRESSION CLOCK ──
  // Two bots that both hold Overwatch never close, and the rules never force them to: the
  // standoff cells froze at 17–75% before this existed. Once no HQ has been hit for
  // AGGRESSION_AFTER_ROUNDS (and the match is old enough that it is not just a normal opening),
  // positional play is over — no Overwatch, and every unit values closing on the objective.
  const roundsWithoutHqDamage = totalTurns - (gameState.lastHqDamageRound ?? 0);
  const pressure = totalTurns >= AGGRESSION_START_ROUND && roundsWithoutHqDamage >= AGGRESSION_AFTER_ROUNDS;
  const hunts = lastStand || pressure;

  // FOG OF WAR LOGIC: Filter visible enemies
  let enemyUnits = units.filter(u => u.owner !== currentPlayer);
  let aiVisibleSet: Set<string> | null = null;
  if (settings.fogOfWar) {
      aiVisibleSet = calculateVisibility(currentPlayer, units, mapData, weather, true, gridSize);
      enemyUnits = enemyUnits.filter(u => aiVisibleSet!.has(u.tileId));
  }

  // 0. Use Inventory (Free action)
  const pendingPerk = units.find(u => u.owner === currentPlayer && (u.rank ?? 0) >= 1 && !u.perk);
  if (pendingPerk) return { type: 'CHOOSE_PERK', unitId: pendingPerk.id, perkId: AI_PERK_CHOICE[pendingPerk.type] };

  // Spend the once-per-match battery refill as soon as it is granted and there is room for it.
  if (gameState.finalPush === 'READY' && playerCp < getEffectiveCpRules(settings.mutators).maxCp) {
    return { type: 'FINAL_PUSH' };
  }

  const overclockAction = checkOverclock(gameState);
  if (overclockAction) return overclockAction;

  const inventoryAction = checkInventory(gameState, myUnits);
  if (inventoryAction) return inventoryAction;

  // 1. Reinforcements
  const spawnAction = checkSpawn(gameState);
  if (spawnAction) return spawnAction;

  // 2. Logistics
  const visibleUnitsForAi = aiVisibleSet ? units.filter(u => u.owner === currentPlayer || aiVisibleSet!.has(u.tileId)) : units;
  const shopAction = checkShop(gameState, myUnits, visibleUnitsForAi);
  if (shopAction) return shopAction;

  if (myUnits.length === 0) return { type: 'END_TURN' };

  let bestAction: AIAction = { type: 'END_TURN' };
  let bestScore = 0; // Only take actions strictly better than passing (0)
  const liveContract = gameState.contract && gameState.contract.claimedBy === null ? gameState.contract.id : null;

  // Locate nearest live Enemy Base in Conquer Mode
  const enemyBases = victoryMode === 'CONQUER'
      ? mapData.filter(t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0)
      : [];

  // Precompute reverse-BFS path distance fields once per AI evaluation:
  // ground units (Scouts/Breachers) flank around Mountains & Buildings; Snipers may traverse Mountains.
  const enemyTiles = enemyUnits
      .map(e => getTileByIdFast(mapData, e.tileId, gridSize))
      .filter((t): t is Tile => Boolean(t));
  const groundEnemyDistField = computePathDistanceField(enemyTiles, mapData, gridSize, false);
  const sniperEnemyDistField = computePathDistanceField(enemyTiles, mapData, gridSize, true);

  const activeBanks = mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
  const baseDistCache = new Map<string, Int32Array | null>();
  const barTiles = mapData.filter(t => t.type === 'BARRIER' && t.hp !== undefined && t.hp > 0);

  // Supply objectives: landed mystery crates plus the exact LZ of a flared incoming drop,
  // so a squad is already close when the crate touches down.
  const supplyTiles = mapData.filter(t => t.loot === 'FIELD_SUPPLY' || t.loot === 'TACTICAL_SUPPLY');
  for (const d of gameState.airDrops ?? []) {
      if (d.phase !== 'FLARE') continue;
      const lz = d.tileId ? getTileByIdFast(mapData, d.tileId, gridSize) : undefined;
      if (lz && !supplyTiles.includes(lz)) supplyTiles.push(lz);
  }
  const groundSupplyDistField = computePathDistanceField(supplyTiles, mapData, gridSize, false);
  const sniperSupplyDistField = computePathDistanceField(supplyTiles, mapData, gridSize, true);

  // Precompute Overwatch coverage ONCE instead of per-candidate-tile; defer enemy team vision unless a path actually touches Overwatch
  const visibleOverwatchers = difficulty === 'HARD'
      ? enemyUnits.filter(u => u.isOverwatching === true && u.ammo > 0)
      : [];
  const knownCoverageByOverwatcher = new Map<string, Set<string>>();
  const anyWatchedTileIds = new Set<string>();
  const knownTeamVisByOwner = new Map<number, Set<string>>();
  let teamVisPopulated = false;
  if (visibleOverwatchers.length > 0) {
      for (const ow of visibleOverwatchers) {
          const cov = getOverwatchCoverageTiles(ow, mapData, weather, gridSize);
          knownCoverageByOverwatcher.set(ow.id, cov);
          cov.forEach(tid => anyWatchedTileIds.add(tid));
      }
  }

  for (const unit of myUnits) {
    const uTile = getTileByIdFast(mapData, unit.tileId, gridSize);
    if (!uTile) continue;
    const adj = [uTile, ...getNeighbors(uTile, mapData, gridSize)];
    const canClimbMountain = unit.type === 'SNIPER';
    const enemyDistField = canClimbMountain ? sniperEnemyDistField : groundEnemyDistField;
    const supplyDistField = canClimbMountain ? sniperSupplyDistField : groundSupplyDistField;

    // Pick closest enemy base for this unit
    let targetBase: Tile | undefined;
    if (enemyBases.length > 0) {
        targetBase = enemyBases.reduce((best, cur) =>
            getManhattanDistance(uTile, cur) < getManhattanDistance(uTile, best) ? cur : best
        );
    }
    let baseDistField: Int32Array | null = null;
    if (targetBase) {
        const cacheKey = `${targetBase.id}:${canClimbMountain ? 1 : 0}`;
        const cached = baseDistCache.get(cacheKey);
        if (cached !== undefined) {
            baseDistField = cached;
        } else {
            baseDistField = computePathDistanceField([targetBase], mapData, gridSize, canClimbMountain);
            baseDistCache.set(cacheKey, baseDistField);
        }
    }

    // --- INTERACTION ACTIONS ---

    // A. Loot Supplies (check standing tile first, then adjacent — mystery crates score highest!)
    if (playerCp >= 4) {
        const lootCandidates = [uTile, ...adj].filter(t => t.loot !== null && t.loot !== undefined);
        lootCandidates.sort((a, b) => {
            const rankLoot = (l: Tile['loot']) => (l === 'TACTICAL_SUPPLY' ? 3 : l === 'FIELD_SUPPLY' ? 2 : 1);
            return rankLoot(b.loot) - rankLoot(a.loot);
        });
        const lootTile = lootCandidates[0];
        if (lootTile) {
            const priority = lootTile.loot === 'TACTICAL_SUPPLY' ? 220 : lootTile.loot === 'FIELD_SUPPLY' ? 185 : 150;
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

    // C. Secure Buildings (Avoid flipping building back and forth under active close threat)
    // Banks are breached by siege now (see E2 below), not by interaction.
    // Skipped in last stand: income is worthless with nothing left to buy.
    if (playerCp >= 4 && !hunts) {
        const nearbyThreat = hasTileWithinRange(uTile, enemyTiles, 3);

        const b = adj.find(t => t.type === 'BUILDING' && t.owner !== currentPlayer);
        if (b && (difficulty !== 'EASY' || Math.random() < 0.4)) {
            const secureScore = (nearbyThreat ? 18 : b.owner == null ? 55 : 42) + (liveContract === 'LAND_GRAB' ? 30 : 0);
            if (secureScore > bestScore) {
                bestScore = secureScore;
                bestAction = { type: 'SECURE', unitId: unit.id, tileId: b.id, cost: 4 };
            }
        }
    }

    // --- COMBAT ACTIONS (Only against Visible Enemies) ---
    const canAttackFromHere = canUnitAttackFromTile(unit, uTile);
    const effectiveRange = getUnitRange(unit, mapData, weather, uTile);
    const attackCost = getUnitAttackCost(unit);

    // D. Attack Unit
    if (playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere) {
        const result = findBestTarget(unit, enemyUnits, mapData, difficulty, weather, gridSize, enemyUnits, smokeZones);
        // Contract weighting: a kill that finishes the round's card is worth more than a body.
        const contractAttackBonus = !result || !liveContract ? 0
            : liveContract === 'ACE_HUNT' ? ((result.unit.rank ?? 0) >= 2 ? 45 : 0)
            : liveContract === 'FIRST_BLOOD' || liveContract === 'BREAKTHROUGH' || liveContract === 'PURGE' || liveContract === 'WIPE' ? 25
            : liveContract === 'OVERWATCH_KILL' ? 20
            : liveContract === 'CROSSFIRE_KILL' ? 15
            : liveContract === 'SKIRMISH' ? 12
            : 0;
        if (result && result.score + contractAttackBonus > bestScore) {
            bestScore = result.score + contractAttackBonus;
            bestAction = { type: 'ATTACK', attackerId: unit.id, targetUnitId: result.unit.id, cost: attackCost };
        }
    }

    // E. Siege Base (under fog, only a base it can see, as for a player)
    if (targetBase && playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere &&
        (!aiVisibleSet || aiVisibleSet.has(targetBase.id))) {
         const dist = getManhattanDistance(uTile, targetBase);
         if (dist <= effectiveRange) {
             const hasLOS = hasLineOfSight(uTile, targetBase, mapData, unit.type, weather, gridSize) && !smokeBlocksLine(smokeZones, uTile, targetBase);
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

    // E2. Siege unbreached Bank vaults (breaching runs for Scouts & Breachers — Snipers can't crack vaults)
    if (unit.type !== 'SNIPER' && playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere) {
        const vault = activeBanks
            .filter(b => (!aiVisibleSet || aiVisibleSet.has(b.id)) && getManhattanDistance(uTile, b) <= effectiveRange && hasLineOfSight(uTile, b, mapData, unit.type, weather, gridSize) && !smokeBlocksLine(smokeZones, uTile, b))
            .sort((a, c) => getManhattanDistance(uTile, a) - getManhattanDistance(uTile, c))[0];
        if (vault) {
            const vaultDmg = calculateSiegeDamage(unit, uTile, 'BANK');
            let vaultScore = difficulty === 'EASY' ? 45 : 100;
            if (liveContract === 'VAULT_RACE') vaultScore += 40;
            if ((vault.hp || BANK_STATS.HP) <= vaultDmg) vaultScore = difficulty === 'EASY' ? 85 : 9999;
            if (vaultScore > bestScore) {
                bestScore = vaultScore;
                bestAction = { type: 'SIEGE', unitId: unit.id, tileId: vault.id, cost: attackCost };
            }
        }
    }

    // F. Demolish Barriers
    if (playerCp >= attackCost && unit.ammo > 0 && canAttackFromHere) {
        for (const barrier of barTiles) {
            if (getManhattanDistance(uTile, barrier) > effectiveRange) continue;
            if (aiVisibleSet && !aiVisibleSet.has(barrier.id)) continue;
            const hasLOS = hasLineOfSight(uTile, barrier, mapData, unit.type, weather, gridSize) && !smokeBlocksLine(smokeZones, uTile, barrier);
            if (hasLOS) {
                let demolishScore = 20;
                if (unit.type === 'ASSAULTER') demolishScore += 20;
                if (liveContract === 'DEMOLITION') demolishScore += 40;

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
            settings.doomsdayEnabled, doomsdayStartTurn, doomsdayZone, totalTurns, gridSize, settings.fogOfWar, supplyDistField
        );

        const { validMoves: moveMap, parents: moveParents } = getValidMovesWithParents(
            uTile, playerCp, mapData, units, unit.type, currentPlayer, weather, gridSize, unit.rank ?? 0
        );
        const touchesCache = new Map<string, boolean>();
        const pathTouchesOverwatch = (tid: string): boolean => {
            if (tid === uTile.id) return false;
            const cached = touchesCache.get(tid);
            if (cached !== undefined) return cached;
            if (anyWatchedTileIds.has(tid)) {
                touchesCache.set(tid, true);
                return true;
            }
            const p = moveParents.get(tid);
            const res = p !== undefined && pathTouchesOverwatch(p);
            touchesCache.set(tid, res);
            return res;
        };

        for (const [tileId, cost] of moveMap) {
            const destTile = getTileByIdFast(mapData, tileId, gridSize);
            if (!destTile) continue;

            const destScore = evaluatePosition(
                destTile, unit, enemyTiles, activeBanks, enemyBases, difficulty, victoryMode,
                targetBase, enemyDistField, baseDistField,
                settings.doomsdayEnabled, doomsdayStartTurn, doomsdayZone, totalTurns, gridSize, settings.fogOfWar, supplyDistField
            );

            // Net positional gain minus tiny CP friction; avoids stepping back onto worse tiles
            let moveValue = (destScore - currentScore) - cost * 0.5;

            // Supply contest: a step that closes on a crate (or a flared LZ) is worth a detour.
            // The score term above is relative, so without this a 6-point-per-tile gradient is
            // too weak to pull a squad off its combat lane and the crate is never claimed.
            if (supplyDistField) {
                const before = supplyDistField[uTile.y * gridSize + uTile.x];
                const after = supplyDistField[destTile.y * gridSize + destTile.x];
                if (after >= 0 && after <= 10 && (before < 0 || after < before)) {
                    moveValue += after === 0 ? 45 : 18;
                }
            }

            const neighbors = getNeighbors(destTile, mapData, gridSize);
            if (neighbors.some(n => n.type === 'BANK' && (n.hackProgress || 0) < 100)) moveValue += 18;
            if (neighbors.some(n => n.type === 'BUILDING' && n.owner !== currentPlayer)) moveValue += 12;

            // Last stand: nothing matters but reaching a tile that can strike the final
            // objective (enemy HQ, or the last enemy unit when there is no base to hunt).
            // Marching closer dominates comfort (~65 for a sniper nest); standing on a tile
            // that can actually fire dominates everything, so snipers stop pacing and settle.
            if (hunts) {
                const hunt = targetBase ?? (enemyTiles.length > 0
                    ? enemyTiles.reduce((best, cur) =>
                        getManhattanDistance(uTile, cur) < getManhattanDistance(uTile, best) ? cur : best
                    )
                    : undefined);
                if (hunt) {
                    const canStrikeFrom = (t: Tile) =>
                        canUnitAttackFromTile(unit, t) &&
                        getManhattanDistance(t, hunt) <= getUnitRange(unit, mapData, weather, t) &&
                        hasLineOfSight(t, hunt, mapData, unit.type, weather, gridSize) &&
                        !smokeBlocksLine(smokeZones, t, hunt);
                    // Last stand is all-or-nothing; the aggression clock only tilts the choice.
                    const strikeBonus = lastStand ? 500 : 260;
                    const stepBonus = lastStand ? 200 : 40;
                    if (canStrikeFrom(destTile)) {
                        moveValue += strikeBonus;
                    } else {
                        moveValue += (getManhattanDistance(uTile, hunt) - getManhattanDistance(destTile, hunt)) * stepBonus;
                    }
                }
            }

            // Respect visible enemy Overwatch on HARD difficulty (Elite Breachers resist pin)
            if (anyWatchedTileIds.size > 0 && pathTouchesOverwatch(tileId)) {
                if (settings.fogOfWar && !teamVisPopulated) {
                    teamVisPopulated = true;
                    for (const ow of visibleOverwatchers) {
                        if (!knownTeamVisByOwner.has(ow.owner)) {
                            knownTeamVisByOwner.set(ow.owner, calculateVisibility(ow.owner, units, mapData, weather, true, gridSize));
                        }
                    }
                }
                const candidatePath = reconstructMovePathFromParents(uTile, tileId, moveMap, moveParents, mapData, gridSize);
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

    // --- OVERWATCH STANCE (Medium & Hard AI tactical zoning; banned in last stand) ---
    if (!hunts && difficulty !== 'EASY' && canUnitEnterOverwatch(unit, uTile, playerCp)) {
        const uZoneWeather = uTile.zone !== undefined ? weather.playerZones[uTile.zone] || 'CLEAR' : 'CLEAR';
        if (uZoneWeather !== 'FOG' && uZoneWeather !== 'SANDSTORM') {
            const minEnemyDist = getMinManhattanDistance(uTile, enemyTiles);
            const watchingApproach =
                minEnemyDist <= effectiveRange + 4 ||
                (settings.fogOfWar && enemyTiles.length === 0 && (uTile.type === 'BUILDING' || canUnitAttackFromTile(unit, uTile)));

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


