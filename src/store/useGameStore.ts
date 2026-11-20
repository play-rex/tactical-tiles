
import { create } from 'zustand';
import { UNIT_STATS, TERRAIN_DEFENSE, CP_SYSTEM, TERRAIN_COSTS, GOLD_SETTINGS, RESPAWN_TIMERS, UNIT_COSTS, BUILDING_STATS, SHOP_ITEMS, BASE_STATS, BANK_STATS, MAX_RESPAWNS, DOOMSDAY_SETTINGS, DEFAULT_GRID_SIZE, BARRIER_STATS, TILE_SIZE, VETERANCY_CONFIG, OVERWATCH_STATS } from '../core/constants/Config';
import { useEffectStore } from './useEffectStore';
import { Tile, Unit, TerrainType, UnitType, DeadUnit, BankReward, PendingDrop, WeatherState, WeatherType, GameSettings, LogEntry, SavedMap, MatchPlayerStats, MatchSummary, GameMutators, MissionConfig } from '../core/types';
import { getValidMoves, getManhattanDistance, hasLineOfSight, calculateVisibility } from '../core/grid/Pathfinding';
import { assignVoronoiZones } from '../core/grid/ZoneGeneration';
import { getBestAIAction, AIAction } from '../core/ai/AIBrain';
import { updateDoomsdayState } from '../core/grid/DoomsdayManager';
import {
  canUnitAttackFromTile,
  canUnitEnterOverwatch,
  getUnitRange,
  getUnitAttackCost,
  getUnitMaxHp,
  getEffectiveCpRules,
  getEffectiveMaxRespawns,
  getEffectiveUnitAmmo,
  getEffectiveBankRewards,
  applyUnitXp,
  calculateAttackOutcome,
  calculateSiegeDamage,
  calculateDemolishDamage,
  getBaseArtilleryDamage,
  canConstructOnTile,
  resolveBridgeVariant
} from '../core/rules/CombatRules';
import { resolveMoveWithOverwatch } from '../core/rules/OverwatchRules';
import { SoundFX } from '../core/audio/SoundFX';
import { createSeededRng, generateSectorSeed, normalizeSeed } from '../core/utils/SeededRandom';
import { calculateMatchScorecard, CareerStorage } from '../core/storage/CareerStatsManager';
import { getChallengeById } from '../core/assets/ChallengeOps';

interface GameStore {
  mapData: Tile[];
  gridSize: number; // Dynamic size
  units: Unit[];
  graveyard: DeadUnit[];
  
  // Game State
  currentScreen: 'SETUP' | 'GAME' | 'EDITOR' | 'TUTORIAL';
  settings: GameSettings;
  currentPlayer: number;
  totalTurns: number; // For Doomsday (Rounds)
  turnCounter: number; // For Weather (Individual Turns)
  
  // Player Data maps
  playerCp: Record<number, number>; 
  playerGold: Record<number, number>;
  playerRespawns: Record<number, number>; 
  playerStatus: Record<number, 'ACTIVE' | 'ELIMINATED'>;
  playerInventory: Record<number, ('AMMO' | 'MEDKIT')[]>; // NEW

  winner: number | null;
  activeSeed: string;
  activeMission: MissionConfig | null;
  lastCustomMap: Tile[] | null;
  matchStats: Record<number, MatchPlayerStats>;
  matchSummary: MatchSummary | null;
  bankRewardPending: BankReward | null; 
  pendingDrops: PendingDrop[];
  
  // Shop Placement
  placementMode: { active: boolean, itemKey: string, cost: number, variant?: string } | null;

  // Weather (Per Player Zone)
  weather: WeatherState;

  // Visibility (Fog of War)
  visibleTiles: Set<string>; 

  // Selection
  selectedUnitId: string | null;
  selectedTileId: string | null;
  hoveredTileId: string | null;
  selectedGraveyardUnitId: string | null;
  selectedInventoryItemIndex: number | null; // NEW
  
  // Valid Moves/Targets
  validMoveCosts: Map<string, number>; 
  validMoveTiles: string[]; 
  validAttackTargets: string[]; 
  validSpawnTiles: string[]; 
  validSecureTile: string | null;
  validHeistTile: string | null;
  validSiegeTile: string | null; 
  validLootTile: string | null;
  validDemolishTile: string | null; // NEW

  // AI State
  isAiTurn: boolean;
  
  // Log
  gameLog: LogEntry[];

  // Editor State
  mapToEdit: SavedMap | null;

  // Setup Actions
  setGameSettings: (settings: Partial<GameSettings>) => void;
  startGame: () => void;
  startChallenge: (challengeId: string) => void;
  openEditor: () => void;
  exitEditor: () => void;
  openTutorial: () => void;
  exitTutorial: () => void;
  loadMapAndStart: (customMap: Tile[]) => void;
  loadMapIntoEditor: (map: SavedMap) => void;

  // Game Actions
  initializeMap: () => void;
  getTileAt: (gridX: number, gridY: number) => Tile | undefined;
  handleTileClick: (x: number, y: number) => void;
  setHoveredTile: (tileId: string | null) => void;
  handleGraveyardSelect: (deadUnitId: string) => void;
  selectInventoryItem: (index: number | null) => void; 
  selectNextReadyUnit: () => void;
  reloadUnit: () => void;
  enterOverwatch: () => void;
  endTurn: () => void;
  resetGame: () => void;
  retryCurrentMatch: () => void;
  
  secureBuilding: () => void;
  heistBank: () => void;
  siegeBase: () => void;
  demolishBarrier: () => void; // NEW
  lootSupply: () => void;
  resolveBankReward: (choice: 'GOLD' | 'CP') => void;
  buyShopItem: (itemKey: string, variant?: string) => void;
  cancelPlacement: () => void;

  // AI Internal Actions
  runAiLoop: () => void;
  executeAiAction: (action: AIAction) => void;
}
const WEATHER_TYPES: WeatherType[] = ['CLEAR', 'SCORCHED', 'MONSOON', 'FOG', 'TAILWIND', 'SANDSTORM'];

const rollWeather = (rng: () => number = Math.random): WeatherType => {
    return WEATHER_TYPES[Math.floor(rng() * WEATHER_TYPES.length)];
};

const createEmptyMatchStats = (playerCount: number): Record<number, MatchPlayerStats> => {
    const stats: Record<number, MatchPlayerStats> = {};
    for (let i = 0; i < playerCount; i++) {
        stats[i] = {
            kills: 0,
            unitsLost: 0,
            damageDealt: 0,
            heists: 0,
            buildingsSecured: 0,
            acesPromoted: 0
        };
    }
    return stats;
};

const ensureMatchStats = (
    stats: Record<number, MatchPlayerStats> | undefined,
    playerCount: number
): Record<number, MatchPlayerStats> => {
    const cloned: Record<number, MatchPlayerStats> = {};
    for (let i = 0; i < playerCount; i++) {
        cloned[i] = stats?.[i]
            ? { ...stats[i] }
            : { kills: 0, unitsLost: 0, damageDealt: 0, heists: 0, buildingsSecured: 0, acesPromoted: 0 };
    }
    return cloned;
};

const grantUnitXp = (
    unitsList: Unit[],
    unitId: string,
    gainedXp: number,
    map: Tile[],
    playerId: number,
    round: number,
    matchStats: Record<number, MatchPlayerStats>,
    extraLogs: LogEntry[]
): Unit[] => {
    if (gainedXp <= 0) return unitsList;
    return unitsList.map(u => {
        if (u.id !== unitId) return u;
        const { unit: promotedUnit, promotedTo } = applyUnitXp(u, gainedXp);
        if (promotedTo !== null) {
            const uTile = map.find(t => t.id === promotedUnit.tileId);
            if (uTile) {
                const px = uTile.x * TILE_SIZE + TILE_SIZE / 2;
                const py = uTile.y * TILE_SIZE + TILE_SIZE / 2;
                useEffectStore.getState().addDamagePopup(px, py - 24, VETERANCY_CONFIG.RANK_LABELS[promotedTo], '#FFD700');
            }
            SoundFX.play('capture');
            const rankName = VETERANCY_CONFIG.RANK_NAMES[promotedTo];
            extraLogs.push(createLog(round, playerId, `${UNIT_STATS[promotedUnit.type].name} promoted to ${rankName}!`, 'COMBAT'));
            if (promotedTo === 3 && matchStats[playerId]) {
                matchStats[playerId].acesPromoted += 1;
            }
        }
        return promotedUnit;
    });
};

const applyCombatOutcomeToStatsAndXp = (params: {
    attackerId: string;
    attackerOwner: number;
    attTile: Tile | undefined;
    victim: Unit;
    dmg: number;
    isKill: boolean;
    unitsList: Unit[];
    map: Tile[];
    round: number;
    nextPlayerGold: Record<number, number>;
    nextMatchStats: Record<number, MatchPlayerStats>;
    extraLogs: LogEntry[];
}): Unit[] => {
    const {
        attackerId,
        attackerOwner,
        attTile,
        victim,
        dmg,
        isKill,
        map,
        round,
        nextPlayerGold,
        nextMatchStats,
        extraLogs
    } = params;
    let updatedUnits = params.unitsList;

    if (nextMatchStats[attackerOwner]) {
        nextMatchStats[attackerOwner].damageDealt += dmg;
        if (isKill) nextMatchStats[attackerOwner].kills += 1;
    }

    if (isKill) {
        if (nextMatchStats[victim.owner]) {
            nextMatchStats[victim.owner].unitsLost += 1;
        }
        if ((victim.rank ?? 0) >= 3) {
            nextPlayerGold[attackerOwner] = (nextPlayerGold[attackerOwner] ?? 0) + VETERANCY_CONFIG.ACE_BOUNTY_GOLD;
            if (attTile) {
                const ax = attTile.x * TILE_SIZE + TILE_SIZE / 2;
                const ay = attTile.y * TILE_SIZE + TILE_SIZE / 2;
                useEffectStore.getState().addDamagePopup(ax, ay - 36, `+$${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} BOUNTY`, '#FFD700');
            }
            extraLogs.push(createLog(round, attackerOwner, `Ace Bounty claimed! +$${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} Gold`, 'ECONOMY'));
        }
        const xpGain = (victim.rank ?? 0) >= 2 ? 3 : 2;
        updatedUnits = grantUnitXp(updatedUnits, attackerId, xpGain, map, attackerOwner, round, nextMatchStats, extraLogs);
    } else if (dmg > 0) {
        updatedUnits = grantUnitXp(updatedUnits, attackerId, 1, map, attackerOwner, round, nextMatchStats, extraLogs);
    }

    return updatedUnits;
};

const createLog = (round: number, playerId: number, message: string, type: LogEntry['type'] = 'INFO'): LogEntry => ({
    id: Math.random().toString(36).substr(2, 9),
    round,
    playerId,
    message,
    type,
    timestamp: Date.now()
});

// ... (Map Generation Helpers) ...
const generateDynamicMap = (
    numPlayers: number,
    rng: () => number = Math.random
): { map: Tile[], size: number, baseLocations: {x:number, y:number, owner:number}[] } => {
    let size = 20;
    if (numPlayers >= 4) size = 25;
    if (numPlayers >= 6) size = 30;
    
    const tiles: Tile[] = [];
    const baseLocations: {x: number, y: number, owner: number}[] = [];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            tiles.push({
                id: `${x},${y}`, x, y,
                type: 'PLAINS', height: 1, loot: null, hazardState: 'SAFE'
            });
        }
    }

    const getTile = (x: number, y: number) => {
        if (x < 0 || x >= size || y < 0 || y >= size) return null;
        return tiles[y * size + x];
    };

    const centerX = Math.floor(size / 2);
    const centerY = Math.floor(size / 2);

    const lakeRadius = numPlayers > 2 ? 2 : 1;
    for (let y = centerY - lakeRadius; y <= centerY + lakeRadius; y++) {
        for (let x = centerX - lakeRadius; x <= centerX + lakeRadius; x++) {
             if (Math.sqrt(Math.pow(x-centerX,2) + Math.pow(y-centerY,2)) <= lakeRadius) {
                 const t = getTile(x, y);
                 if (t) { t.type = 'WATER'; t.height = 0; }
             }
        }
    }

    const startAngle = numPlayers === 2 ? (-Math.PI / 4) : (-Math.PI / 2);
    
    for (let i = 0; i < numPlayers; i++) {
        const riverAngle = startAngle + (i * 2 * Math.PI / numPlayers);
        
        let cx = centerX;
        let cy = centerY;
        const dx = Math.cos(riverAngle);
        const dy = Math.sin(riverAngle);
        const px = -Math.sin(riverAngle);
        const py = Math.cos(riverAngle);

        let dist = 0;
        const maxDist = size * 1.0; 

        while (dist < maxDist) {
            const wiggle = (rng() - 0.5) * 1.5; 
            const wx = px * wiggle;
            const wy = py * wiggle;

            cx += dx + wx;
            cy += dy + wy;
            dist += 1;

            const isWide = rng() < 0.3;
            let width = isWide ? 3 : (rng() < 0.5 ? 2 : 1);
            
            for (let w = -Math.floor(width/2); w <= Math.floor(width/2); w++) {
                const rx = Math.round(cx + px * w);
                const ry = Math.round(cy + py * w);
                const t = getTile(rx, ry);
                if (t) { t.type = 'WATER'; t.height = 0; }
            }
        }
    }

    const padding = 3;
    const baseDist = (size / 2) - padding; 

    for (let i = 0; i < numPlayers; i++) {
        const riverAngle = startAngle + (i * 2 * Math.PI / numPlayers);
        const sectorAngle = riverAngle + (Math.PI / numPlayers);

        const bx = Math.round(centerX + Math.cos(sectorAngle) * baseDist);
        const by = Math.round(centerY + Math.sin(sectorAngle) * baseDist);

        const t = getTile(bx, by);
        if (t) {
            t.type = 'BASE';
            t.owner = i;
            t.height = 1;
            baseLocations.push({ x: bx, y: by, owner: i });
        }
    }

    for (let i = 0; i < Math.max(4, numPlayers * 2); i++) {
         const mx = Math.floor(rng() * size);
         const my = Math.floor(rng() * size);
         let cx = mx, cy = my;
         for(let s=0; s<4; s++) {
             const t = getTile(cx, cy);
             if (t && t.type === 'PLAINS') {
                 t.type = 'MOUNTAIN';
                 t.height = 2;
             }
             cx += Math.floor(rng()*3 - 1);
             cy += Math.floor(rng()*3 - 1);
         }
    }

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const t = getTile(x, y);
            if (!t || t.type !== 'PLAINS') continue;
            const rand = rng();
            if (rand < 0.12) {
                t.type = 'FOREST';
            } else if (rand > 0.88) { 
                t.type = 'MOUNTAIN'; 
                t.height = 2; 
            }
        }
    }

    const bridgeCandidatesH: Tile[] = [];
    const bridgeCandidatesV: Tile[] = [];

    tiles.forEach(t => {
        if (t.type === 'WATER') {
            const left = getTile(t.x - 1, t.y);
            const right = getTile(t.x + 1, t.y);
            const top = getTile(t.x, t.y - 1);
            const bottom = getTile(t.x, t.y + 1);

            const isLand = (n: Tile | null) => n && n.type !== 'WATER' && n.type !== 'BRIDGE' && n.type !== 'BRIDGE_V' && n.type !== 'CANYON';

            if (isLand(left) && isLand(right)) bridgeCandidatesH.push(t);
            if (isLand(top) && isLand(bottom)) bridgeCandidatesV.push(t);
        }
    });

    const neededBridges = numPlayers * 3; 
    const shuffle = (arr: any[]) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    shuffle(bridgeCandidatesH);
    shuffle(bridgeCandidatesV);

    for(let i=0; i<Math.min(neededBridges, bridgeCandidatesH.length); i++) {
        const t = bridgeCandidatesH[i];
        if (t.type === 'WATER') {
            t.type = 'BRIDGE';
            t.height = 1;
        }
    }
    for(let i=0; i<Math.min(neededBridges, bridgeCandidatesV.length); i++) {
        const t = bridgeCandidatesV[i];
        if (t.type === 'WATER') {
            t.type = 'BRIDGE_V';
            t.height = 1;
        }
    }

    const dist = (t1: Tile, t2: Tile | {x:number, y:number}) => Math.abs(t1.x - t2.x) + Math.abs(t1.y - t2.y);
    const zoneTiles: Tile[][] = Array.from({ length: numPlayers }, () => []);
    
    tiles.forEach(t => {
        if (t.type !== 'PLAINS' && t.type !== 'FOREST') return;
        let closestOwner = -1;
        let minD = Infinity;
        baseLocations.forEach(base => {
            const d = dist(t, base);
            if (d < minD) {
                minD = d;
                closestOwner = base.owner;
            }
        });
        if (closestOwner !== -1) zoneTiles[closestOwner].push(t);
    });

    const placedBanks: Tile[] = [];
    const placedBuildings: Tile[] = [];
    const mapCenter = { x: centerX, y: centerY };

    for (let i = 0; i < numPlayers; i++) {
        const candidates = zoneTiles[i];
        const base = baseLocations[i];
        const scored = candidates.map(t => {
            const dBase = dist(t, base);
            const dCenter = dist(t, mapCenter);
            const score = (dBase * 2) - dCenter;
            return { tile: t, score, dBase };
        }).sort((a, b) => b.score - a.score);

        let placed = false;
        const constraints = [15, 10, 5];
        
        for (const minBankDist of constraints) {
            if (placed) break;
            for (const cand of scored) {
                if (cand.dBase < 8) continue;
                const conflict = placedBanks.some(b => dist(cand.tile, b) < minBankDist);
                if (!conflict) {
                    cand.tile.type = 'BANK';
                    cand.tile.hackProgress = 0;
                    cand.tile.height = 1;
                    placedBanks.push(cand.tile);
                    placed = true;
                    break;
                }
            }
        }
    }

    const bridges = tiles.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V');

    for (let i = 0; i < numPlayers; i++) {
        const validTiles = zoneTiles[i].filter(t => t.type === 'PLAINS' || t.type === 'FOREST'); 
        const base = baseLocations[i];

        const outpostCandidates = validTiles.map(t => {
            let minBridgeDist = Infinity;
            bridges.forEach(b => {
                const d = dist(t, b);
                if (d < minBridgeDist) minBridgeDist = d;
            });
            return { tile: t, score: -minBridgeDist + rng() }; 
        }).sort((a, b) => b.score - a.score);

        const allAssets = [...placedBanks, ...placedBuildings];

        for (const cand of outpostCandidates) {
            const t = cand.tile;
            if (dist(t, base) < 4) continue;
            if (allAssets.some(a => dist(t, a) < 3)) continue;

            t.type = 'BUILDING';
            t.subType = 'WATCHTOWER';
            t.height = 1;
            placedBuildings.push(t);
            allAssets.push(t); 
            break; 
        }

        const midX = Math.round((base.x + centerX) / 2);
        const midY = Math.round((base.y + centerY) / 2);
        const midPoint = { x: midX, y: midY };

        const bunkerCandidates = zoneTiles[i]
            .filter(t => t.type === 'PLAINS' || t.type === 'FOREST')
            .map(t => {
                const dMid = dist(t, midPoint);
                return { tile: t, score: -dMid + rng() };
            }).sort((a, b) => b.score - a.score);

        for (const cand of bunkerCandidates) {
            const t = cand.tile;
            if (allAssets.some(a => dist(t, a) < 3)) continue;
            if (dist(t, base) < 3) continue;

            t.type = 'BUILDING';
            t.subType = 'BUNKER';
            t.height = 1;
            placedBuildings.push(t);
            break;
        }
    }

    // Ensure every base is reachable by ground path from baseLocations[0] (bridge wide rivers if needed)
    if (baseLocations.length >= 2) {
        const origin = getTile(baseLocations[0].x, baseLocations[0].y);
        if (origin) {
            for (let bIdx = 1; bIdx < baseLocations.length; bIdx++) {
                const targetBase = getTile(baseLocations[bIdx].x, baseLocations[bIdx].y);
                if (!targetBase) continue;

                const visited = new Set<string>([origin.id]);
                const queue: Tile[] = [origin];
                let reached = false;
                while (queue.length > 0 && !reached) {
                    const cur = queue.shift()!;
                    if (cur.id === targetBase.id) {
                        reached = true;
                        break;
                    }
                    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    for (const [dx, dy] of dirs) {
                        const nt = getTile(cur.x + dx, cur.y + dy);
                        if (!nt || visited.has(nt.id) || TERRAIN_COSTS[nt.type] >= 90) continue;
                        visited.add(nt.id);
                        queue.push(nt);
                    }
                }

                if (!reached) {
                    // Carve a bridge/corridor along Manhattan path so no match starts unwinnable
                    let cx = origin.x;
                    let cy = origin.y;
                    while (cx !== targetBase.x || cy !== targetBase.y) {
                        if (cx !== targetBase.x) cx += cx < targetBase.x ? 1 : -1;
                        else if (cy !== targetBase.y) cy += cy < targetBase.y ? 1 : -1;
                        const stepTile = getTile(cx, cy);
                        if (stepTile && TERRAIN_COSTS[stepTile.type] >= 90) {
                            stepTile.type = stepTile.type === 'WATER' ? 'BRIDGE' : 'PLAINS';
                            stepTile.height = 1;
                        }
                    }
                }
            }
        }
    }

    return { map: tiles, size, baseLocations };
};

// ... (Spawn/Units Logic/Range/Visibility Helpers remain same) ...
const spawnUnitsForPlayers = (
    mapTiles: Tile[],
    counts: GameSettings['unitCounts'],
    baseLocations: {x:number, y:number, owner:number}[],
    gridSize: number,
    mutators?: GameMutators
): Unit[] => {
    const units: Unit[] = [];
    let idCounter = 0;

    const createUnit = (type: UnitType, tileId: string, owner: number) => {
        const ammoCap = getEffectiveUnitAmmo(type, mutators);
        units.push({
            id: `unit_${idCounter++}`,
            type,
            tileId,
            hp: UNIT_STATS[type].hp,
            maxHp: UNIT_STATS[type].hp,
            ammo: ammoCap,
            maxAmmo: ammoCap,
            owner,
            xp: 0,
            rank: 0,
            kills: 0,
            damageDealt: 0,
            hasMoved: false,
            completed: false,
            isOverwatching: false
        });
    };

    baseLocations.forEach(base => {
        const candidates = mapTiles
            .filter(t => t.type !== 'WATER' && t.type !== 'MOUNTAIN' && t.type !== 'BASE' && t.type !== 'CANYON' && t.type !== 'BARRIER' && t.type !== 'QUICKSAND')
            .sort((a, b) => {
                const d1 = getManhattanDistance(a, {x: base.x, y: base.y} as Tile);
                const d2 = getManhattanDistance(b, {x: base.x, y: base.y} as Tile);
                return d1 - d2;
            });
        
        let idx = 0;
        const spawnList = [
            ...Array(counts.SOLDIER).fill('SOLDIER'),
            ...Array(counts.ASSAULTER).fill('ASSAULTER'),
            ...Array(counts.SNIPER).fill('SNIPER'),
        ];
        spawnList.forEach(type => {
            if (idx < candidates.length) {
                createUnit(type as UnitType, candidates[idx].id, base.owner);
                idx++;
            }
        });
    });

    return units;
};

export const useGameStore = create<GameStore>((set, get) => ({
  mapData: [],
  gridSize: DEFAULT_GRID_SIZE,
  units: [],
  graveyard: [],
  currentScreen: 'SETUP',
  settings: {
      playerCount: 2,
      unitCounts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
      dynamicWeather: true,
      fogOfWar: false,
      doomsdayEnabled: false,
      gameMode: 'PVP',
      victoryMode: 'CONQUER',
      aiDifficulty: 'MEDIUM',
      mutators: { blitzCp: false, scarcity: false, ironman: false }
  },
  currentPlayer: 0,
  totalTurns: 0,
  turnCounter: 0,
  
  playerCp: {},
  playerGold: {},
  playerRespawns: {},
  playerStatus: {},
  playerInventory: {},

  winner: null,
  activeSeed: '',
  activeMission: null,
  lastCustomMap: null,
  matchStats: {},
  matchSummary: null,
  bankRewardPending: null,
  pendingDrops: [],
  placementMode: null,
  
  weather: { playerZones: {}, turnsRemaining: 5 },
  visibleTiles: new Set(),

  selectedUnitId: null,
  selectedTileId: null,
  hoveredTileId: null,
  selectedGraveyardUnitId: null,
  selectedInventoryItemIndex: null,
  
  validMoveCosts: new Map(),
  validMoveTiles: [], 
  validAttackTargets: [],
  validSpawnTiles: [],
  validSecureTile: null,
  validHeistTile: null,
  validSiegeTile: null,
  validLootTile: null,
  validDemolishTile: null,
  
  isAiTurn: false,
  
  gameLog: [],

  mapToEdit: null, // Initial State

  setGameSettings: (newSettings) => {
      set(state => ({ settings: { ...state.settings, ...newSettings } }));
  },

  startGame: () => {
      set({ currentScreen: 'GAME' });
      get().initializeMap();
  },

  openEditor: () => set({ currentScreen: 'EDITOR', mapToEdit: null }), // Clear when opening fresh
  exitEditor: () => set({ currentScreen: 'SETUP' }),
  openTutorial: () => set({ currentScreen: 'TUTORIAL' }),
  exitTutorial: () => set({ currentScreen: 'SETUP' }),
  
  loadMapIntoEditor: (map: SavedMap) => set({ currentScreen: 'EDITOR', mapToEdit: map }),

  loadMapAndStart: (customMap: Tile[]) => {
      // 1. Deep Copy the map data to avoid mutating original presets
      const rawCopy = JSON.parse(JSON.stringify(customMap)) as Tile[];
      const zonedMap = JSON.parse(JSON.stringify(customMap)) as Tile[];
      
      const tileCount = zonedMap.length;
      const mapSize = Math.sqrt(tileCount);
      const gridSize = Math.round(mapSize);
      const { settings } = get();
      const seedUsed = normalizeSeed(settings.mapSeed) || 'CUSTOM';
      const weatherRng = createSeededRng(`${seedUsed}_weather`);

      // 2. Filter Bases
      const potentialBases = zonedMap.filter(t => t.type === 'BASE');
      let baseLocations: {x:number, y:number, owner:number}[] = [];
      
      if (potentialBases.length > 0) {
          // Sort bases (roughly Top-Left to Bottom-Right)
          potentialBases.sort((a,b) => (a.x + a.y) - (b.x + b.y));

          // Determine which bases to activate based on player count
          let activeIndices: number[] = [];
          
          if (settings.playerCount === 2 && potentialBases.length >= 2) {
             // For 2 players, pick the corners (First and Last) for maximum distance
             activeIndices = [0, potentialBases.length - 1];
          } else {
             // For N players, take the first N bases
             for(let i=0; i<Math.min(settings.playerCount, potentialBases.length); i++) {
                 activeIndices.push(i);
             }
          }

          // 3. Reset ALL potential bases to standard terrain (PLAINS) first
          // This effectively "hides" the unused bases.
          potentialBases.forEach(b => {
              b.type = 'PLAINS';
              delete b.owner;
              delete b.hp;
              delete b.maxHp;
          });

          // 4. Activate ONLY selected bases
          activeIndices.forEach((baseIndex, ownerId) => {
              const b = potentialBases[baseIndex];
              b.type = 'BASE';
              b.owner = ownerId;
              b.height = 1; // Ensure bases are visible
              baseLocations.push({x:b.x, y:b.y, owner:ownerId});
          });

      } else {
          // Fallback if no bases found (Safe default)
          const p1 = zonedMap.find(t => t.x === 1 && t.y === 1);
          const p2 = zonedMap.find(t => t.x === gridSize-2 && t.y === gridSize-2);
          if (p1) { p1.type = 'BASE'; p1.owner = 0; baseLocations.push({x:1, y:1, owner:0}); }
          if (p2) { p2.type = 'BASE'; p2.owner = 1; baseLocations.push({x:gridSize-2, y:gridSize-2, owner:1}); }
      }

      // 5. Preserve manually painted map zones if present; otherwise assign Voronoi zones
      const hasCustomZones = zonedMap.some(t => t.zone !== undefined);
      const finalMap = hasCustomZones ? zonedMap : assignVoronoiZones(zonedMap, baseLocations);
      
      // Initialize Base HP for Conquer Mode AND Barrier HP
      finalMap.forEach(t => {
          if (t.type === 'BASE') {
              if (settings.victoryMode === 'CONQUER') {
                  t.hp = BASE_STATS.HP;
                  t.maxHp = BASE_STATS.HP;
              } else {
                  t.hp = undefined;
                  t.maxHp = undefined;
              }
          }
          if (t.type === 'BARRIER') {
              t.hp = BARRIER_STATS.HP;
              t.maxHp = BARRIER_STATS.HP;
          }
      });

      const units = spawnUnitsForPlayers(finalMap, settings.unitCounts, baseLocations, gridSize, settings.mutators);
      const cpRules = getEffectiveCpRules(settings.mutators);
      
      const initialWeather: WeatherState = {
        playerZones: {},
        turnsRemaining: 5
      };
      if (settings.dynamicWeather) {
          for(let i=0; i<settings.playerCount; i++) {
              initialWeather.playerZones[i] = rollWeather(weatherRng);
          }
      } else {
          for(let i=0; i<settings.playerCount; i++) {
              initialWeather.playerZones[i] = 'CLEAR';
          }
      }
      
      const visible = calculateVisibility(0, units, finalMap, initialWeather, settings.fogOfWar, gridSize);

      const pCp: any = {};
      const pGold: any = {};
      const pResp: any = {};
      const pStat: any = {};
      const pInv: any = {};
      
      for(let i=0; i<settings.playerCount; i++) {
          pCp[i] = i === 0 ? cpRules.p1Round1Cp : cpRules.maxCp;
          pGold[i] = GOLD_SETTINGS.INITIAL_GOLD;
          pResp[i] = 0;
          pStat[i] = 'ACTIVE';
          pInv[i] = [];
      }

      set({
          mapData: finalMap,
          gridSize,
          units,
          graveyard: [],
          currentPlayer: 0,
          totalTurns: 0,
          turnCounter: 0,
          playerCp: pCp,
          playerGold: pGold,
          playerRespawns: pResp,
          playerStatus: pStat,
          playerInventory: pInv,
          winner: null,
          activeSeed: seedUsed,
          activeMission: null,
          lastCustomMap: rawCopy,
          matchStats: createEmptyMatchStats(settings.playerCount),
          matchSummary: null,
          bankRewardPending: null,
          pendingDrops: [],
          placementMode: null,
          weather: initialWeather,
          visibleTiles: visible,
          isAiTurn: false,
          currentScreen: 'GAME',
          gameLog: [],
          selectedUnitId: null,
          selectedTileId: null,
          hoveredTileId: null,
          selectedGraveyardUnitId: null,
          selectedInventoryItemIndex: null,
          validMoveCosts: new Map(),
          validMoveTiles: [],
          validAttackTargets: [],
          validSpawnTiles: [],
          validSecureTile: null,
          validHeistTile: null,
          validSiegeTile: null,
          validLootTile: null,
          validDemolishTile: null
      });
  },

  initializeMap: () => {
    const { settings } = get();
    const activeSeed = normalizeSeed(settings.mapSeed) || generateSectorSeed();
    const mapRng = createSeededRng(activeSeed);
    const weatherRng = createSeededRng(`${activeSeed}_weather`);
    const { map, size, baseLocations } = generateDynamicMap(settings.playerCount, mapRng);
    const zonedMap = assignVoronoiZones(map, baseLocations);
    const units = spawnUnitsForPlayers(zonedMap, settings.unitCounts, baseLocations, size, settings.mutators);
    const cpRules = getEffectiveCpRules(settings.mutators);
    
    const pCp: Record<number, number> = {};
    const pGold: Record<number, number> = {};
    const pResp: Record<number, number> = {};
    const pStat: Record<number, 'ACTIVE' | 'ELIMINATED'> = {};
    const pInv: Record<number, ('AMMO' | 'MEDKIT')[]> = {};
    const wZones: Record<number, WeatherType> = {};

    for (let i = 0; i < settings.playerCount; i++) {
        pCp[i] = i === 0 ? cpRules.p1Round1Cp : cpRules.maxCp;
        pGold[i] = GOLD_SETTINGS.INITIAL_GOLD;
        pResp[i] = 0;
        pStat[i] = 'ACTIVE';
        pInv[i] = [];
        wZones[i] = settings.dynamicWeather ? rollWeather(weatherRng) : 'CLEAR';
    }

    zonedMap.forEach(t => {
        if (t.type === 'BASE' && settings.victoryMode === 'CONQUER') {
             t.hp = BASE_STATS.HP;
             t.maxHp = BASE_STATS.HP;
        }
        if (t.type === 'BARRIER') {
             t.hp = BARRIER_STATS.HP;
             t.maxHp = BARRIER_STATS.HP;
        }
    });

    const initialWeather: WeatherState = {
        playerZones: wZones,
        turnsRemaining: 5
    };

    const visible = calculateVisibility(0, units, zonedMap, initialWeather, settings.fogOfWar, size);

    set({ 
      mapData: zonedMap,
      gridSize: size,
      units: units,
      graveyard: [],
      currentPlayer: 0,
      totalTurns: 0,
      turnCounter: 0,
      playerCp: pCp,
      playerGold: pGold,
      playerRespawns: pResp,
      playerStatus: pStat,
      playerInventory: pInv,
      winner: null,
      activeSeed,
      activeMission: null,
      lastCustomMap: null,
      matchStats: createEmptyMatchStats(settings.playerCount),
      matchSummary: null,
      bankRewardPending: null,
      pendingDrops: [],
      placementMode: null,
      weather: initialWeather,
      visibleTiles: visible,
      isAiTurn: false,
      gameLog: [],
      selectedUnitId: null,
      selectedTileId: null,
      hoveredTileId: null,
      selectedGraveyardUnitId: null,
      selectedInventoryItemIndex: null,
      validMoveCosts: new Map(),
      validMoveTiles: [],
      validAttackTargets: [],
      validSpawnTiles: [],
      validSecureTile: null,
      validHeistTile: null,
      validSiegeTile: null,
      validLootTile: null,
      validDemolishTile: null
    });
  },

  resetGame: () => {
    set({
      currentScreen: 'SETUP',
      winner: null,
      matchSummary: null,
      activeMission: null,
      mapData: [],
      units: [],
      gameLog: [],
      lastCustomMap: null
    });
  },

  startChallenge: (challengeId: string) => {
    const mission = getChallengeById(challengeId);
    if (!mission) return;

    const currentSettings = get().settings;
    const effectiveSettings: GameSettings = {
        ...currentSettings,
        ...mission.settings,
        playerCount: mission.settings.playerCount ?? 2,
        gameMode: mission.settings.gameMode ?? 'PVE',
        victoryMode: mission.settings.victoryMode ?? 'DEATHMATCH',
        aiDifficulty: mission.settings.aiDifficulty ?? 'HARD',
        fogOfWar: mission.settings.fogOfWar ?? false,
        dynamicWeather: mission.settings.dynamicWeather ?? false,
        doomsdayEnabled: mission.settings.doomsdayEnabled ?? false,
        mutators: mission.settings.mutators ?? { blitzCp: false, scarcity: false, ironman: false },
        mapSeed: mission.seed,
        challengeId: mission.id
    };

    const finalMap = mission.buildMap();
    const units: Unit[] = mission.placements.map((p, idx) => {
        const baseHp = UNIT_STATS[p.type].hp;
        const baseAmmo = getEffectiveUnitAmmo(p.type, effectiveSettings.mutators);
        let unit: Unit = {
            id: `chal_${idx}`,
            type: p.type,
            tileId: `${p.x},${p.y}`,
            hp: baseHp,
            maxHp: baseHp,
            ammo: baseAmmo,
            maxAmmo: baseAmmo,
            owner: p.owner,
            xp: 0,
            rank: 0,
            kills: 0,
            damageDealt: 0,
            hasMoved: false,
            completed: false,
            isOverwatching: false
        };
        if (p.rank && p.rank > 0) {
            unit = applyUnitXp(unit, VETERANCY_CONFIG.XP_THRESHOLDS[p.rank]).unit;
        }
        if (p.hp !== undefined) {
            unit.hp = Math.min(getUnitMaxHp(unit), p.hp);
        }
        return unit;
    });

    const cpRules = getEffectiveCpRules(effectiveSettings.mutators);
    const pCp: Record<number, number> = {};
    const pGold: Record<number, number> = {};
    const pResp: Record<number, number> = {};
    const pStat: Record<number, 'ACTIVE' | 'ELIMINATED'> = {};
    const pInv: Record<number, ('AMMO' | 'MEDKIT')[]> = {};
    const wZones: Record<number, WeatherType> = {};
    const weatherRng = createSeededRng(`${mission.seed}_weather`);

    for (let i = 0; i < effectiveSettings.playerCount; i++) {
        pCp[i] = mission.startingCp?.[i] ?? (i === 0 ? cpRules.p1Round1Cp : cpRules.maxCp);
        pGold[i] = mission.startingGold?.[i] ?? GOLD_SETTINGS.INITIAL_GOLD;
        pResp[i] = 0;
        pStat[i] = 'ACTIVE';
        pInv[i] = [];
        wZones[i] = effectiveSettings.dynamicWeather ? rollWeather(weatherRng) : 'CLEAR';
    }

    const startRound = mission.startingRound ?? 0;
    const initialWeather: WeatherState = { playerZones: wZones, turnsRemaining: 5 };
    const visible = calculateVisibility(0, units, finalMap, initialWeather, effectiveSettings.fogOfWar, mission.gridSize);

    set({
        currentScreen: 'GAME',
        settings: effectiveSettings,
        mapData: finalMap,
        gridSize: mission.gridSize,
        units,
        graveyard: [],
        currentPlayer: 0,
        totalTurns: startRound,
        turnCounter: 0,
        playerCp: pCp,
        playerGold: pGold,
        playerRespawns: pResp,
        playerStatus: pStat,
        playerInventory: pInv,
        winner: null,
        activeSeed: mission.seed,
        activeMission: mission,
        lastCustomMap: null,
        matchStats: createEmptyMatchStats(effectiveSettings.playerCount),
        matchSummary: null,
        bankRewardPending: null,
        pendingDrops: [],
        placementMode: null,
        weather: initialWeather,
        visibleTiles: visible,
        isAiTurn: false,
        gameLog: [createLog(startRound + 1, -1, `OP: ${mission.title} — ${mission.subtitle}`, 'INFO')],
        selectedUnitId: null,
        selectedTileId: null,
        hoveredTileId: null,
        selectedGraveyardUnitId: null,
        selectedInventoryItemIndex: null,
        validMoveCosts: new Map(),
        validMoveTiles: [],
        validAttackTargets: [],
        validSpawnTiles: [],
        validSecureTile: null,
        validHeistTile: null,
        validSiegeTile: null,
        validLootTile: null,
        validDemolishTile: null
    });
  },

  retryCurrentMatch: () => {
    const { activeMission, lastCustomMap, activeSeed, settings } = get();
    if (activeMission) {
      get().startChallenge(activeMission.id);
      return;
    }
    if (lastCustomMap) {
      get().loadMapAndStart(lastCustomMap);
      return;
    }
    set({ settings: { ...settings, mapSeed: activeSeed } });
    get().startGame();
  },

  getTileAt: (gridX, gridY) => {
    const { mapData, gridSize } = get();
    return mapData[gridY * gridSize + gridX];
  },

  setHoveredTile: (tileId) => {
      const { hoveredTileId } = get();
      if (hoveredTileId !== tileId) {
          set({ hoveredTileId: tileId });
      }
  },

  handleGraveyardSelect: (deadUnitId) => {
      const { graveyard, currentPlayer, units, mapData, playerGold, playerRespawns, gridSize, settings } = get();
      const deadUnit = graveyard.find(u => u.id === deadUnitId);
      if (!deadUnit || deadUnit.owner !== currentPlayer) return;
      if (deadUnit.turnsUntilRespawn > 0) return;
      if (playerGold[currentPlayer] < UNIT_COSTS[deadUnit.type]) return;

      if ((playerRespawns[currentPlayer] || 0) >= getEffectiveMaxRespawns(settings.mutators)) return;

      const occupiedTileIds = new Set(units.map(u => u.tileId));
      const validSpawns: string[] = [];

      const bases = mapData.filter(t => t.type === 'BASE' && t.owner === currentPlayer && t.hazardState !== 'LAVA');
      
      bases.forEach(base => {
          if (base.hazardState !== 'LAVA' && !occupiedTileIds.has(base.id)) validSpawns.push(base.id);
          for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  const nx = base.x + dx;
                  const ny = base.y + dy;
                  if (nx >= 0 && nx < gridSize && ny >= 0 && ny < gridSize) {
                       const t = mapData[ny * gridSize + nx];
                       const isTerrainValid = t.type !== 'WATER' && t.type !== 'BARRIER' && t.type !== 'CANYON' && t.hazardState !== 'LAVA';
                       if (isTerrainValid && !occupiedTileIds.has(t.id) && !validSpawns.includes(t.id)) {
                           validSpawns.push(t.id);
                       }
                  }
              }
          }
      });

      set({
          selectedGraveyardUnitId: deadUnitId,
          selectedUnitId: null,
          selectedInventoryItemIndex: null,
          validMoveTiles: [],
          validMoveCosts: new Map(),
          validAttackTargets: [],
          validSpawnTiles: validSpawns,
          validSecureTile: null,
          validHeistTile: null,
          validSiegeTile: null,
          validLootTile: null,
          validDemolishTile: null
      });
  },

  selectInventoryItem: (index) => {
      set({ 
          selectedInventoryItemIndex: index,
          selectedUnitId: null,
          selectedGraveyardUnitId: null,
          validMoveTiles: [],
          validAttackTargets: []
      });
  },

  selectNextReadyUnit: () => {
      const { units, currentPlayer, selectedUnitId, mapData, isAiTurn, winner } = get();
      if (isAiTurn || winner !== null) return;
      const ready = units.filter(u => u.owner === currentPlayer && !u.completed);
      if (ready.length === 0) return;

      const currentIdx = ready.findIndex(u => u.id === selectedUnitId);
      const next = ready[(currentIdx + 1) % ready.length];
      const tile = mapData.find(t => t.id === next.tileId);
      if (tile) {
          get().handleTileClick(tile.x, tile.y);
      }
  },

  reloadUnit: () => {
      const { selectedUnitId, units, playerCp, currentPlayer } = get();
      const unit = units.find(u => u.id === selectedUnitId && u.owner === currentPlayer);
      if (!unit || unit.completed || unit.ammo >= unit.maxAmmo) return;
      if ((playerCp[currentPlayer] ?? 0) < CP_SYSTEM.RELOAD_COST) return;
      get().executeAiAction({ type: 'RELOAD', unitId: unit.id, cost: CP_SYSTEM.RELOAD_COST });
  },

  enterOverwatch: () => {
      const { selectedUnitId, units, playerCp, currentPlayer, mapData } = get();
      const unit = units.find(u => u.id === selectedUnitId && u.owner === currentPlayer);
      if (!unit) return;
      const tile = mapData.find(t => t.id === unit.tileId);
      if (!canUnitEnterOverwatch(unit, tile, playerCp[currentPlayer] ?? 0)) return;
      get().executeAiAction({ type: 'OVERWATCH', unitId: unit.id, cost: OVERWATCH_STATS[unit.type].cost });
  },

  handleTileClick: (x, y) => {
    const state = get();
    const { 
        units, currentPlayer, selectedUnitId, selectedGraveyardUnitId, selectedInventoryItemIndex,
        validMoveCosts, mapData, validAttackTargets, winner, playerCp, playerGold, graveyard, validSpawnTiles, weather, settings, isAiTurn, gridSize, placementMode, totalTurns
    } = state;
    
    const currentRound = totalTurns + 1;

    if (winner !== null || state.bankRewardPending || isAiTurn) return;

    const clickedTileId = `${x},${y}`;
    const tile = mapData.find(t => t.id === clickedTileId);
    
    // --- PLACEMENT MODE LOGIC ---
    if (placementMode && placementMode.active && tile) {
        const valid = canConstructOnTile(placementMode.itemKey, tile, units);

        if (valid) {
            // EXECUTE PLACEMENT
            const newGold = playerGold[currentPlayer] - placementMode.cost;
            let newType: TerrainType = tile.type;
            let newHeight = tile.height;
            let newHp: number | undefined;
            let newMaxHp: number | undefined;

            if (placementMode.itemKey === 'BARRIER') {
                newType = 'BARRIER';
                newHeight = 1; 
                newHp = BARRIER_STATS.HP;
                newMaxHp = BARRIER_STATS.HP;
            } else if (placementMode.itemKey === 'BRIDGE') {
                newType = placementMode.variant === 'V'
                    ? 'BRIDGE_V'
                    : resolveBridgeVariant(tile, mapData, gridSize);
                newHeight = 1;
            }

            const newMap = mapData.map(t => t.id === clickedTileId ? { ...t, type: newType, height: newHeight, hp: newHp, maxHp: newMaxHp } : t);
            
            const logEntry = createLog(currentRound, currentPlayer, `Built ${SHOP_ITEMS[placementMode.itemKey as keyof typeof SHOP_ITEMS].name} at (${x},${y})`, 'ECONOMY');
            SoundFX.play('capture');

            set({
                mapData: newMap,
                playerGold: { ...playerGold, [currentPlayer]: newGold },
                placementMode: null,
                gameLog: [logEntry, ...state.gameLog]
            });
        }
        return; // Consume click
    }

    const clickedUnit = units.find(u => u.tileId === clickedTileId);

    if (settings.fogOfWar && clickedUnit && clickedUnit.owner !== currentPlayer) {
        if (!state.visibleTiles.has(clickedTileId)) return;
    }

    // --- INVENTORY USE LOGIC ---
    if (selectedInventoryItemIndex !== null) {
        // Can only use on own units
        if (clickedUnit && clickedUnit.owner === currentPlayer) {
            get().executeAiAction({ 
                type: 'USE_ITEM', 
                unitId: clickedUnit.id, 
                itemIndex: selectedInventoryItemIndex,
                cost: 0 
            });
            set({ selectedInventoryItemIndex: null });
            return;
        } else {
            // Clicking empty space or enemy cancels selection
            set({ selectedInventoryItemIndex: null });
            return;
        }
    }
    
    // ... (Existing Interactions logic)
    const checkInteractions = (unit: Unit, tileId: string, currentCp: number) => {
        const uTile = mapData.find(t => t.id === tileId);
        if (!uTile) return { secure: null, heist: null, siege: null, loot: null };
        const neighbors = [
            mapData.find(t => t.x === uTile.x+1 && t.y === uTile.y),
            mapData.find(t => t.x === uTile.x-1 && t.y === uTile.y),
            mapData.find(t => t.x === uTile.x && t.y === uTile.y+1),
            mapData.find(t => t.x === uTile.x && t.y === uTile.y-1),
        ].filter(t => t !== undefined) as Tile[];

        const interactionTiles = [uTile, ...neighbors];

        let secure = null;
        let heist = null;
        let loot = null;

        const b = interactionTiles.find(t => t.type === 'BUILDING' && t.owner !== currentPlayer);
        if (b && currentCp >= 4) secure = b.id;
        
        const bank = interactionTiles.find(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
        if (bank && currentCp >= 4) heist = bank.id;

        const lootTile = interactionTiles.find(t => t.loot !== null && t.loot !== undefined);
        if (lootTile && currentCp >= 4) loot = lootTile.id;

        return { secure, heist, loot };
    };

    const currentCp = playerCp[currentPlayer];

    // SPAWN
    if (selectedGraveyardUnitId && validSpawnTiles.includes(clickedTileId)) {
        const deadUnit = graveyard.find(u => u.id === selectedGraveyardUnitId);
        if (deadUnit) {
            get().executeAiAction({ type: 'SPAWN', unitType: deadUnit.type, tileId: clickedTileId, cost: 0, goldCost: UNIT_COSTS[deadUnit.type], deadUnitId: deadUnit.id });
            return;
        }
    }

    // ATTACK UNIT
    if (selectedUnitId && clickedUnit && validAttackTargets.includes(clickedUnit.id)) {
        const attacker = units.find(u => u.id === selectedUnitId);
        if (attacker) {
            get().executeAiAction({ type: 'ATTACK', attackerId: attacker.id, targetUnitId: clickedUnit.id, cost: getUnitAttackCost(attacker) });
            return;
        }
    }

    // ATTACK BASE (SIEGE)
    if (selectedUnitId && state.validSiegeTile === clickedTileId) {
         const attacker = units.find(u => u.id === selectedUnitId);
         if (attacker) {
             get().executeAiAction({ type: 'SIEGE', unitId: attacker.id, tileId: clickedTileId, cost: getUnitAttackCost(attacker) });
             return;
         }
    }

    // DEMOLISH BARRIER
    if (selectedUnitId && state.validDemolishTile === clickedTileId) {
         const attacker = units.find(u => u.id === selectedUnitId);
         if (attacker) {
             get().executeAiAction({ type: 'DEMOLISH', unitId: attacker.id, tileId: clickedTileId, cost: getUnitAttackCost(attacker) });
             return;
         }
    }

    // MOVE
    if (selectedUnitId && validMoveCosts.has(clickedTileId)) {
      get().executeAiAction({ type: 'MOVE', unitId: selectedUnitId, targetTileId: clickedTileId, cost: validMoveCosts.get(clickedTileId) || 0 });
      return;
    }

    // SELECTION
    if (clickedUnit && clickedUnit.owner === currentPlayer && !clickedUnit.completed) {
      if (tile) {
        // UNIT SELECTION LOGIC
        let movesMap = new Map<string, number>();
        
        // Only calculate moves if not rooted
        if (!clickedUnit.hasMoved && currentCp > 0 && !clickedUnit.isRooted) {
            movesMap = getValidMoves(tile, currentCp, mapData, units, clickedUnit.type, currentPlayer, weather, gridSize, clickedUnit.rank ?? 0);
        }
        
        let targets: string[] = [];
        let siegeTarget: string | null = null;
        let demolishTarget: string | null = null;
        
        const effectiveRange = getUnitRange(clickedUnit, mapData, weather);
        const canAttack = currentCp >= getUnitAttackCost(clickedUnit) && clickedUnit.ammo > 0;
        const positionValid = canUnitAttackFromTile(clickedUnit, tile);
        SoundFX.play('click');

        if (canAttack && positionValid) {
             // 1. Enemy Units
             targets = units.filter(u => u.owner !== currentPlayer).filter(u => {
                 if (settings.fogOfWar && !state.visibleTiles.has(u.tileId)) return false;
                 const tTile = mapData.find(t => t.id === u.tileId)!;
                 if (getManhattanDistance(tile, tTile) > effectiveRange) return false;
                 return hasLineOfSight(tile, tTile, mapData, clickedUnit.type, weather, gridSize);
             }).map(u => u.id);

             // 2. Enemy Base
             if (settings.victoryMode === 'CONQUER') {
                 const bases = mapData.filter(t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0);
                 const validBase = bases.find(b => {
                     if (getManhattanDistance(tile, b) > effectiveRange) return false;
                     if (settings.fogOfWar && !state.visibleTiles.has(b.id)) return false;
                     return hasLineOfSight(tile, b, mapData, clickedUnit.type, weather, gridSize);
                 });
                 if (validBase) siegeTarget = validBase.id;
             }

             // 3. Barriers (Demolish)
             const barriers = mapData.filter(t => t.type === 'BARRIER' && (t.hp || 0) > 0);
             const validBarrier = barriers.find(b => {
                 if (getManhattanDistance(tile, b) > effectiveRange) return false;
                 if (settings.fogOfWar && !state.visibleTiles.has(b.id)) return false;
                 return hasLineOfSight(tile, b, mapData, clickedUnit.type, weather, gridSize);
             });
             
             if (validBarrier) demolishTarget = validBarrier.id;
        }

        const { secure, heist, loot } = checkInteractions(clickedUnit, clickedTileId, currentCp);

        set({ 
            selectedUnitId: clickedUnit.id, 
            selectedTileId: clickedTileId,
            validMoveCosts: movesMap,
            validMoveTiles: Array.from(movesMap.keys()),
            validAttackTargets: targets,
            validSecureTile: secure,
            validHeistTile: heist,
            validSiegeTile: siegeTarget,
            validLootTile: loot,
            validDemolishTile: demolishTarget,
            selectedGraveyardUnitId: null, 
            validSpawnTiles: [],
            selectedInventoryItemIndex: null
        });
      }
      return;
    }

    // DEFAULT
    set({ 
        selectedUnitId: null, 
        selectedTileId: clickedTileId,
        validMoveCosts: new Map(), 
        validMoveTiles: [], 
        validAttackTargets: [], 
        validSecureTile: null, 
        validHeistTile: null, 
        validSiegeTile: null,
        validLootTile: null,
        validDemolishTile: null,
        selectedGraveyardUnitId: null, 
        validSpawnTiles: [],
        selectedInventoryItemIndex: null
    });
  },

  secureBuilding: () => {
      const { selectedUnitId, validSecureTile } = get();
      if (selectedUnitId && validSecureTile) {
          get().executeAiAction({ type: 'SECURE', unitId: selectedUnitId, tileId: validSecureTile, cost: 4 });
      }
  },

  heistBank: () => {
      const { selectedUnitId, validHeistTile } = get();
      if (selectedUnitId && validHeistTile) {
          get().executeAiAction({ type: 'HEIST', unitId: selectedUnitId, tileId: validHeistTile, cost: 4 });
      }
  },

  siegeBase: () => {
      const { selectedUnitId, validSiegeTile, units } = get();
      const unit = units.find(u => u.id === selectedUnitId);
      if (selectedUnitId && validSiegeTile && unit) {
           get().executeAiAction({ type: 'SIEGE', unitId: selectedUnitId, tileId: validSiegeTile, cost: getUnitAttackCost(unit) });
      }
  },

  demolishBarrier: () => {
      const { selectedUnitId, validDemolishTile, units } = get();
      const unit = units.find(u => u.id === selectedUnitId);
      if (selectedUnitId && validDemolishTile && unit) {
           get().executeAiAction({ type: 'DEMOLISH', unitId: selectedUnitId, tileId: validDemolishTile, cost: getUnitAttackCost(unit) });
      }
  },

  lootSupply: () => {
      const { selectedUnitId, validLootTile } = get();
      if (selectedUnitId && validLootTile) {
          get().executeAiAction({ type: 'LOOT', unitId: selectedUnitId, tileId: validLootTile, cost: 4 });
      }
  },

  resolveBankReward: (choice) => {
      const { bankRewardPending, playerGold, playerCp, mapData, settings } = get();
      if (!bankRewardPending) return;
      
      const tile = mapData.find(t => t.id === bankRewardPending.tileId);
      const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(tile, settings.mutators);
      
      const pid = bankRewardPending.playerId;
      if (choice === 'GOLD') {
          set({ 
              playerGold: { ...playerGold, [pid]: playerGold[pid] + goldReward },
              bankRewardPending: null 
          });
      } else {
          set({ 
              playerCp: { ...playerCp, [pid]: playerCp[pid] + cpReward },
              bankRewardPending: null 
          });
      }
  },

  buyShopItem: (itemKey: string, variant?: string) => {
      const { currentPlayer, playerGold, mapData, pendingDrops, gridSize, totalTurns } = get();
      const item = SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS];
      if (playerGold[currentPlayer] < item.cost) return;

      const currentRound = totalTurns + 1;

      // Handle Construction Items (Barrier / Bridge)
      if (item.type === 'CONSTRUCT') {
          set({
              placementMode: { active: true, itemKey, cost: item.cost, variant },
              selectedUnitId: null, // Clear selection
              validMoveTiles: []
          });
          return;
      }

      // Handle Consumables (Drops)
      if (item.type === 'CONSUMABLE') {
          const newGold = playerGold[currentPlayer] - item.cost;
          const lootType: 'AMMO' | 'MEDKIT' = itemKey === 'AMMO_REFILL' ? 'AMMO' : 'MEDKIT';
          const base = mapData.find(t => t.type === 'BASE' && t.owner === currentPlayer);
          let targetTileId = base?.id;
          
          if (base) {
              for(let i=0; i<20; i++) {
                  const dist = 3 + Math.floor(Math.random() * 7); 
                  const angle = Math.random() * Math.PI * 2;
                  const rx = Math.round(base.x + Math.cos(angle) * dist);
                  const ry = Math.round(base.y + Math.sin(angle) * dist);

                  if (rx >= 0 && rx < gridSize && ry >= 0 && ry < gridSize) {
                       const t = mapData[ry * gridSize + rx];
                       if (t && !t.loot && 
                           t.type !== 'WATER' && 
                           t.type !== 'BARRIER' && 
                           t.type !== 'BASE' && 
                           t.type !== 'BUILDING' &&
                           t.type !== 'BANK' &&
                           t.hazardState !== 'LAVA' &&
                           t.type !== 'CANYON'
                       ) {
                           targetTileId = t.id;
                           break;
                       }
                  }
              }
          }

          if (targetTileId) {
              const newDrop: PendingDrop = {
                  playerId: currentPlayer,
                  tileId: targetTileId,
                  item: lootType
              };
              
              const logEntry = createLog(currentRound, currentPlayer, `Purchased ${item.name}`, 'ECONOMY');

              set({
                  playerGold: { ...playerGold, [currentPlayer]: newGold },
                  pendingDrops: [...pendingDrops, newDrop],
                  gameLog: [logEntry, ...get().gameLog]
              });
          }
      }
  },

  cancelPlacement: () => {
      set({ placementMode: null });
  },

  endTurn: () => {
    get().executeAiAction({ type: 'END_TURN' });
  },

  // ... (AI Loop remains the same)
  runAiLoop: () => {
      const { isAiTurn, winner, settings, currentScreen } = get();
      if (!isAiTurn || winner !== null || settings.gameMode !== 'PVE' || currentScreen !== 'GAME') return;

      setTimeout(() => {
          const state = get();
          if (state.winner !== null || state.currentScreen !== 'GAME' || !state.isAiTurn) return;
          const action = getBestAIAction({
              mapData: state.mapData,
              units: state.units,
              currentPlayer: state.currentPlayer,
              playerCp: state.playerCp[state.currentPlayer],
              playerGold: state.playerGold[state.currentPlayer],
              playerRespawns: state.playerRespawns[state.currentPlayer] || 0,
              playerInventory: state.playerInventory[state.currentPlayer],
              weather: state.weather,
              difficulty: state.settings.aiDifficulty,
              graveyard: state.graveyard,
              victoryMode: state.settings.victoryMode, 
              gridSize: state.gridSize,
              settings: state.settings,
              totalTurns: state.totalTurns
          });
          get().executeAiAction(action);
      }, 700);
  },

  executeAiAction: (action) => {
    const state = get();
    const { mapData, units, currentPlayer, playerCp, playerGold, graveyard, settings, weather, playerRespawns, totalTurns, turnCounter, playerStatus, gridSize, bankRewardPending, pendingDrops, playerInventory } = state;
    
    // GUARD CLAUSE: Check CP cost (except for turn end)
    if (action.type !== 'END_TURN' && playerCp[currentPlayer] < (action as any).cost) {
        console.error("Not enough CP for action", action);
        // Force end turn if AI can't afford move to prevent loop hang
        if (state.isAiTurn) {
             console.warn("Forcing AI End Turn due to CP error");
             get().executeAiAction({ type: 'END_TURN' });
        }
        return;
    }

    let newMap = [...mapData];
    let newUnits = [...units];
    let newCp = playerCp[currentPlayer];
    let newGold = playerGold[currentPlayer];
    let newGraveyard = [...graveyard];
    let newWinner = state.winner;
    let newTotalTurns = totalTurns;
    let nextPlayerStatus = { ...playerStatus };
    let newWeather = { ...weather };
    let newBankReward = bankRewardPending;

    let nextPlayerCp = { ...playerCp };
    let nextPlayerGold = { ...playerGold };
    let nextPlayerRespawns = { ...playerRespawns };
    let nextPlayerInventory = { ...playerInventory };
    let nextMatchStats = ensureMatchStats(state.matchStats, settings.playerCount);
    let newMatchSummary = state.matchSummary;

    // Logging Setup
    let logEntry: LogEntry | null = null;
    let extraLogs: LogEntry[] = [];
    
    // Current Round (Total Turns + 1)
    const currentRound = totalTurns + 1;

    if (action.type !== 'END_TURN') {
        newCp -= (action as any).cost;
        nextPlayerCp[currentPlayer] = newCp;
    }

    switch (action.type) {
        case 'MOVE': {
             const mUnit = newUnits.find(u => u.id === action.unitId);
             if (mUnit) {
                 const moveResolution = resolveMoveWithOverwatch({
                     movingUnit: mUnit,
                     targetTileId: action.targetTileId,
                     mapData: newMap,
                     units: newUnits,
                     weather,
                     gridSize,
                     fogOfWar: settings.fogOfWar,
                     maxBudget: playerCp[currentPlayer]
                 });

                 // Deduct only CP actually walked (critical when pinned early by Overwatch)
                 newCp = playerCp[currentPlayer] - moveResolution.actualCost;
                 nextPlayerCp[currentPlayer] = newCp;

                 const destTile = moveResolution.finalTile ?? newMap.find(t => t.id === action.targetTileId);
                 const trig = moveResolution.trigger;

                 if (trig) {
                     const shooter = newUnits.find(u => u.id === trig.overwatcherId);
                     const shooterTile = shooter ? newMap.find(t => t.id === shooter.tileId) : undefined;
                     const interceptTile = trig.interceptTile;

                     if (shooter) {
                         SoundFX.play(shooter.type === 'SNIPER' ? 'sniper' : 'attack');
                         SoundFX.play('hit');

                         if (shooterTile) {
                             const sx = shooterTile.x * TILE_SIZE + TILE_SIZE / 2;
                             const sy = shooterTile.y * TILE_SIZE + TILE_SIZE / 2;
                             const ex = interceptTile.x * TILE_SIZE + TILE_SIZE / 2;
                             const ey = interceptTile.y * TILE_SIZE + TILE_SIZE / 2;
                             useEffectStore.getState().addProjectile(sx, sy, ex, ey, shooter.type === 'SNIPER' ? 'LASER' : 'BULLET');
                             useEffectStore.getState().addDamagePopup(ex, ey - 12, `-${trig.damage}`, '#FF6D00');
                             useEffectStore.getState().triggerScreenShake(trig.damage > 5 ? 10 : 5);
                         }

                         newUnits = newUnits.map(u => {
                             if (u.id !== shooter.id) return u;
                             return {
                                 ...u,
                                 isOverwatching: false,
                                 ammo: Math.max(0, u.ammo - 1),
                                 damageDealt: (u.damageDealt ?? 0) + trig.damage,
                                 kills: (u.kills ?? 0) + (trig.victimDead ? 1 : 0)
                             };
                         });

                         if (trig.victimDead) {
                             newUnits = newUnits.filter(u => u.id !== mUnit.id);
                             newGraveyard.push({
                                 id: mUnit.id,
                                 type: mUnit.type,
                                 owner: mUnit.owner,
                                 turnsUntilRespawn: RESPAWN_TIMERS[mUnit.type]
                             });
                             logEntry = createLog(
                                 currentRound,
                                 shooter.owner,
                                 `OVERWATCH KILL! ${UNIT_STATS[shooter.type].name} eliminated ${UNIT_STATS[mUnit.type].name} (-${trig.damage} HP)`,
                                 'COMBAT'
                             );
                         } else {
                             const isQuicksand = destTile?.type === 'QUICKSAND';
                             const finalTileId = destTile ? destTile.id : mUnit.tileId;
                             newUnits = newUnits.map(u => u.id === mUnit.id ? {
                                 ...u,
                                 tileId: finalTileId,
                                 hp: mUnit.hp - trig.damage,
                                 hasMoved: true,
                                 isRooted: isQuicksand
                             } : u);

                             if (destTile) {
                                 const dx = destTile.x * TILE_SIZE + TILE_SIZE / 2;
                                 const dy = destTile.y * TILE_SIZE + TILE_SIZE / 2;
                                 if (trig.pinResisted) {
                                     useEffectStore.getState().addDamagePopup(dx, dy - 26, 'PIN RESISTED!', '#4CAF50');
                                     extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} resisted Overwatch pin!`, 'COMBAT'));
                                 } else if (moveResolution.haltedEarly) {
                                     useEffectStore.getState().addDamagePopup(dx, dy - 26, 'PINNED!', '#FF9800');
                                 }
                             }

                             logEntry = createLog(
                                 currentRound,
                                 shooter.owner,
                                 `OVERWATCH! ${UNIT_STATS[shooter.type].name} hit ${UNIT_STATS[mUnit.type].name} (-${trig.damage} HP)`,
                                 'COMBAT'
                             );
                             if (isQuicksand) {
                                 extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} stuck in Quicksand!`, 'INFO'));
                             }
                         }

                         newUnits = applyCombatOutcomeToStatsAndXp({
                             attackerId: shooter.id,
                             attackerOwner: shooter.owner,
                             attTile: shooterTile,
                             victim: mUnit,
                             dmg: trig.damage,
                             isKill: trig.victimDead,
                             unitsList: newUnits,
                             map: newMap,
                             round: currentRound,
                             nextPlayerGold,
                             nextMatchStats,
                             extraLogs
                         });
                     }
                 } else {
                     const isQuicksand = destTile?.type === 'QUICKSAND';
                     newUnits = newUnits.map(u => u.id === action.unitId ? {
                         ...u,
                         tileId: destTile ? destTile.id : action.targetTileId,
                         hasMoved: true,
                         isRooted: isQuicksand
                     } : u);
                     SoundFX.play('move');

                     logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} moved to (${destTile?.x},${destTile?.y})`, 'MOVE');
                     if (isQuicksand) {
                         extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} stuck in Quicksand!`, 'INFO'));
                     }
                 }
             }
             break;
        }
        case 'OVERWATCH': {
             const unit = newUnits.find(u => u.id === action.unitId);
             const uTile = unit ? newMap.find(t => t.id === unit.tileId) : undefined;
             if (!unit || !canUnitEnterOverwatch(unit, uTile, playerCp[currentPlayer])) {
                 // Restore upfront CP deduction if an illegal Overwatch call slipped through
                 newCp = playerCp[currentPlayer];
                 nextPlayerCp[currentPlayer] = newCp;
                 break;
             }
             newUnits = newUnits.map(u => u.id === unit.id ? {
                 ...u,
                 isOverwatching: true,
                 completed: true
             } : u);
             if (uTile) {
                 const px = uTile.x * TILE_SIZE + TILE_SIZE / 2;
                 const py = uTile.y * TILE_SIZE + TILE_SIZE / 2;
                 useEffectStore.getState().addDamagePopup(px, py - 20, 'OVERWATCH', '#FFB300');
             }
             SoundFX.play('click');
             logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} set Overwatch (${action.cost} CP)`, 'COMBAT');
             break;
        }
        case 'RELOAD': {
             const unit = newUnits.find(u => u.id === action.unitId);
             if (unit) {
                 const added = Math.max(1, Math.ceil(unit.maxAmmo / 2));
                 const nextAmmo = Math.min(unit.maxAmmo, unit.ammo + added);
                 newUnits = newUnits.map(u => u.id === unit.id ? { ...u, ammo: nextAmmo, completed: true } : u);
                 SoundFX.play('click');
                 logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} Field Reloaded (${nextAmmo}/${unit.maxAmmo} Ammo)`, 'ECONOMY');
             }
             break;
        }
        case 'LOOT': {
            const unit = newUnits.find(u => u.id === action.unitId);
            const tile = newMap.find(t => t.id === action.tileId);
            if (unit && tile && tile.loot) {
                // Change: Loot goes to Inventory instead of instant usage
                const lootItem = tile.loot;
                const currentInv = nextPlayerInventory[currentPlayer] || [];
                nextPlayerInventory[currentPlayer] = [...currentInv, lootItem];

                newUnits = newUnits.map(u => u.id === unit.id ? { 
                     ...u, completed: true
                } : u);
                
                newMap = newMap.map(t => t.id === tile.id ? { ...t, loot: null } : t);
                logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} retrieved ${lootItem} to Inventory`, 'ECONOMY');
            }
            break;
        }
        case 'USE_ITEM': {
             const itemIndex = (action as any).itemIndex;
             const inv = nextPlayerInventory[currentPlayer];
             if (inv && inv[itemIndex]) {
                 const item = inv[itemIndex];
                 const unit = newUnits.find(u => u.id === action.unitId);
                 
                 if (unit) {
                     if (item === 'MEDKIT') {
                         newUnits = newUnits.map(u => u.id === unit.id ? { ...u, hp: getUnitMaxHp(u) } : u);
                     } else if (item === 'AMMO') {
                         newUnits = newUnits.map(u => u.id === unit.id ? { ...u, ammo: u.maxAmmo } : u);
                     }
                     
                     // Remove from inventory
                     const newInvList = [...inv];
                     newInvList.splice(itemIndex, 1);
                     nextPlayerInventory[currentPlayer] = newInvList;
                     
                     logEntry = createLog(currentRound, currentPlayer, `Used ${item} on ${UNIT_STATS[unit.type].name}`, 'ECONOMY');
                 }
             }
             break;
        }
        case 'SECURE': {
             const unit = newUnits.find(u => u.id === action.unitId);
             const targetTile = newMap.find(t => t.id === action.tileId);
             if (unit && targetTile) {
                 const alreadyCapturedByPlayer = targetTile.capturedByOwners?.includes(currentPlayer) ?? false;
                 newMap = newMap.map(t => {
                     if (t.id !== action.tileId) return t;
                     return {
                         ...t,
                         owner: currentPlayer,
                         capturedByOwners: alreadyCapturedByPlayer
                             ? t.capturedByOwners
                             : [...(t.capturedByOwners ?? []), currentPlayer]
                     };
                 });
                 newUnits = newUnits.map(u => u.id === action.unitId ? { ...u, completed: true } : u);
                 if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].buildingsSecured += 1;
                 if (!alreadyCapturedByPlayer) {
                     newUnits = grantUnitXp(newUnits, unit.id, 1, newMap, currentPlayer, currentRound, nextMatchStats, extraLogs);
                 }
                 SoundFX.play('capture');
                 logEntry = createLog(currentRound, currentPlayer, `Secured a Building`, 'ECONOMY');
             }
             break;
        }
        case 'HEIST': {
             const unit = newUnits.find(u => u.id === action.unitId);
             if (unit) {
                 const bankTile = newMap.find(t => t.id === action.tileId);
                 newUnits = newUnits.map(u => u.id === action.unitId ? { ...u, completed: true } : u);
                 newMap = newMap.map(t => {
                     if (t.id === action.tileId) {
                         return { ...t, hackProgress: 100 }; 
                     }
                     return t;
                 });
                 if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].heists += 1;
                 newUnits = grantUnitXp(newUnits, unit.id, 2, newMap, currentPlayer, currentRound, nextMatchStats, extraLogs);
                 SoundFX.play('heist');

                 if (state.isAiTurn) {
                     const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(bankTile, settings.mutators);
                     const hasOtherActiveUnits = newUnits.some(u => u.owner === currentPlayer && !u.completed);
                     const chooseCp = newCp < 8 && hasOtherActiveUnits;

                     if (chooseCp) {
                         nextPlayerCp[currentPlayer] += cpReward;
                         logEntry = createLog(currentRound, currentPlayer, `Heist Successful! AI claimed +${cpReward} CP`, 'ECONOMY');
                     } else {
                         nextPlayerGold[currentPlayer] += goldReward;
                         logEntry = createLog(currentRound, currentPlayer, `Heist Successful! AI claimed +${goldReward} Gold`, 'ECONOMY');
                     }
                     newBankReward = null;
                 } else {
                     newBankReward = { tileId: action.tileId, playerId: currentPlayer };
                     logEntry = createLog(currentRound, currentPlayer, `Heist Successful! Bank Vault Breached`, 'ECONOMY');
                 }
             }
             break;
        }
        case 'ATTACK': {
             const att = newUnits.find(u => u.id === action.attackerId);
             const tar = newUnits.find(u => u.id === action.targetUnitId);
             if (att && tar) {
                const attTile = mapData.find(t => t.id === att.tileId);
                const tarTile = mapData.find(t => t.id === tar.tileId);
                const { damage: finalDmg } = calculateAttackOutcome(att, attTile, tarTile, tar.owner, tar);
                const remainingHp = tar.hp - finalDmg;
                const isKill = remainingHp <= 0;

                SoundFX.play(att.type === 'SNIPER' ? 'sniper' : 'attack');
                SoundFX.play('hit');

                // FX: Bullet & Impact
                if (attTile && tarTile) {
                    const sx = attTile.x * TILE_SIZE + TILE_SIZE/2;
                    const sy = attTile.y * TILE_SIZE + TILE_SIZE/2;
                    const ex = tarTile.x * TILE_SIZE + TILE_SIZE/2;
                    const ey = tarTile.y * TILE_SIZE + TILE_SIZE/2;
                    
                    useEffectStore.getState().addProjectile(sx, sy, ex, ey, att.type === 'SNIPER' ? 'LASER' : 'BULLET');
                    useEffectStore.getState().addDamagePopup(ex, ey - 10, `-${finalDmg}`, '#FF0000');
                    useEffectStore.getState().triggerScreenShake(finalDmg > 5 ? 12 : 4);
                }

                const wasOverwatching = Boolean(tar.isOverwatching);
                newUnits = newUnits.map(u => {
                    if (u.id === tar.id) {
                        return {
                            ...u,
                            hp: remainingHp,
                            isOverwatching: (finalDmg > 0 ? false : u.isOverwatching)
                        };
                    }
                    if (u.id === att.id) {
                        return {
                            ...u,
                            completed: true,
                            ammo: u.ammo - 1,
                            damageDealt: (u.damageDealt ?? 0) + finalDmg,
                            kills: (u.kills ?? 0) + (isKill ? 1 : 0)
                        };
                    }
                    return u;
                });

                let msg = `${UNIT_STATS[att.type].name} hit ${UNIT_STATS[tar.type].name} for ${finalDmg} dmg`;

                if (isKill) {
                    newUnits = newUnits.filter(u => u.id !== tar.id);
                    newGraveyard.push({
                        id: tar.id, type: tar.type, owner: tar.owner,
                        turnsUntilRespawn: RESPAWN_TIMERS[tar.type]
                    });
                    msg += " (KILL)";
                } else if (wasOverwatching && finalDmg > 0) {
                    if (tarTile) {
                        const ex = tarTile.x * TILE_SIZE + TILE_SIZE / 2;
                        const ey = tarTile.y * TILE_SIZE + TILE_SIZE / 2;
                        useEffectStore.getState().addDamagePopup(ex, ey - 28, 'SUPPRESSED!', '#FF9800');
                    }
                    extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[tar.type].name} Overwatch SUPPRESSED!`, 'COMBAT'));
                }

                newUnits = applyCombatOutcomeToStatsAndXp({
                    attackerId: att.id,
                    attackerOwner: currentPlayer,
                    attTile,
                    victim: tar,
                    dmg: finalDmg,
                    isKill,
                    unitsList: newUnits,
                    map: newMap,
                    round: currentRound,
                    nextPlayerGold,
                    nextMatchStats,
                    extraLogs
                });
                logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
             }
             break;
        }
        case 'SIEGE': {
            const att = newUnits.find(u => u.id === action.unitId);
            const baseTile = newMap.find(t => t.id === action.tileId);
            if (att && baseTile && baseTile.hp !== undefined) {
                 const attTile = mapData.find(t => t.id === att.tileId);
                 const siegeDmg = calculateSiegeDamage(att, attTile);
                 const newHp = Math.max(0, baseTile.hp - siegeDmg);
                 newMap = newMap.map(t => t.id === action.tileId ? { ...t, hp: newHp } : t);
                 if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].damageDealt += siegeDmg;
                 newUnits = newUnits.map(u => u.id === att.id ? {
                     ...u,
                     completed: true,
                     ammo: u.ammo - 1,
                     damageDealt: (u.damageDealt ?? 0) + siegeDmg
                 } : u);
                 
                 // FX
                 if (attTile) {
                     const sx = attTile.x * TILE_SIZE + TILE_SIZE/2;
                     const sy = attTile.y * TILE_SIZE + TILE_SIZE/2;
                     const ex = baseTile.x * TILE_SIZE + TILE_SIZE/2;
                     const ey = baseTile.y * TILE_SIZE + TILE_SIZE/2;
                     useEffectStore.getState().addProjectile(sx, sy, ex, ey, 'MISSILE'); // Siege uses Missile
                     useEffectStore.getState().addDamagePopup(ex, ey - 20, `-${siegeDmg}`, '#FF4500');
                     useEffectStore.getState().triggerScreenShake(newHp === 0 ? 18 : 8);
                 }

                 SoundFX.play(newHp === 0 ? 'explosion' : 'attack');
                 if (newHp > 0) SoundFX.play('hit');

                 let msg = `${UNIT_STATS[att.type].name} sieged Base (-${siegeDmg} HP)`;
                 if (newHp === 0) {
                     const eliminatedId = baseTile.owner!;
                     nextPlayerStatus[eliminatedId] = 'ELIMINATED';
                     const wipedCount = newUnits.filter(u => u.owner === eliminatedId).length;
                     if (nextMatchStats[eliminatedId]) nextMatchStats[eliminatedId].unitsLost += wipedCount;
                     newUnits = newUnits.filter(u => u.owner !== eliminatedId);
                     newUnits = grantUnitXp(newUnits, att.id, 2, newMap, currentPlayer, currentRound, nextMatchStats, extraLogs);
                     msg += " - BASE DESTROYED";
                 }
                 logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
            }
            break;
        }
        case 'DEMOLISH': {
            const att = newUnits.find(u => u.id === action.unitId);
            const barrierTile = newMap.find(t => t.id === action.tileId);
            if (att && barrierTile && barrierTile.hp !== undefined) {
                 const attTile = mapData.find(t => t.id === att.tileId);
                 const dmg = calculateDemolishDamage(att, attTile);
                 const newHp = Math.max(0, barrierTile.hp - dmg);
                 
                 // FX
                 if (attTile) {
                     const sx = attTile.x * TILE_SIZE + TILE_SIZE/2;
                     const sy = attTile.y * TILE_SIZE + TILE_SIZE/2;
                     const ex = barrierTile.x * TILE_SIZE + TILE_SIZE/2;
                     const ey = barrierTile.y * TILE_SIZE + TILE_SIZE/2;
                     useEffectStore.getState().addProjectile(sx, sy, ex, ey, 'MISSILE'); 
                     useEffectStore.getState().addDamagePopup(ex, ey - 20, `-${dmg}`, '#FFA500');
                     useEffectStore.getState().triggerScreenShake(5);
                 }

                 SoundFX.play(newHp === 0 ? 'explosion' : 'attack');

                 newMap = newMap.map(t => t.id === action.tileId ? { ...t, hp: newHp } : t);
                 newUnits = newUnits.map(u => u.id === att.id ? { ...u, completed: true, ammo: u.ammo - 1 } : u);
                 
                 let msg = `${UNIT_STATS[att.type].name} attacked Barrier (-${dmg} HP)`;
                 if (newHp === 0) {
                     // Destroy Barrier -> Plains
                     newMap = newMap.map(t => t.id === action.tileId ? { ...t, type: 'PLAINS', hp: undefined, maxHp: undefined, height: 1 } : t);
                     msg = `${UNIT_STATS[att.type].name} destroyed a Barrier!`;
                 }
                 logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
            }
            break;
        }
        case 'SPAWN': {
             if ((nextPlayerRespawns[currentPlayer] || 0) >= getEffectiveMaxRespawns(settings.mutators)) break;
             const goldCost = (action as any).goldCost || 0;
             if (newGold < goldCost) break;
             newGold -= goldCost;
             nextPlayerGold[currentPlayer] = newGold;

             if (action.deadUnitId) {
                  const baseHp = UNIT_STATS[action.unitType as UnitType].hp;
                  const maxAmmoCap = getEffectiveUnitAmmo(action.unitType as UnitType, settings.mutators);
                  newGraveyard = newGraveyard.filter(u => u.id !== action.deadUnitId);
                  nextPlayerRespawns[currentPlayer] = (nextPlayerRespawns[currentPlayer] || 0) + 1;
                  newUnits.push({
                      id: action.deadUnitId, type: action.unitType, owner: currentPlayer,
                      tileId: action.tileId, hp: baseHp,
                      maxHp: baseHp,
                      ammo: maxAmmoCap,
                      maxAmmo: maxAmmoCap,
                      xp: 0, rank: 0, kills: 0, damageDealt: 0,
                      hasMoved: true, completed: true, isOverwatching: false
                  });
                  logEntry = createLog(currentRound, currentPlayer, `Redeployed ${UNIT_STATS[action.unitType as UnitType].name}`, 'ECONOMY');
             }
             break;
        }
        case 'BUY_DROP': {
            const goldCost = (action as any).goldCost || 0;
            const itemKey = (action as any).itemKey;
            newGold -= goldCost;
            nextPlayerGold[currentPlayer] = newGold;
            
            // For AI, we can directly modify the tile with loot since it's instant
            // But to keep consistency with the turn structure, we'll spawn the loot on the tile
            const lootItem = itemKey === 'AMMO_REFILL' ? 'AMMO' : 'MEDKIT';
            newMap = newMap.map(t => t.id === action.tileId ? { ...t, loot: lootItem } : t);
            
            logEntry = createLog(currentRound, currentPlayer, `Purchased ${SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS].name}`, 'ECONOMY');
            break;
        }
        case 'END_TURN': {
            newBankReward = null;
            logEntry = createLog(currentRound, currentPlayer, `Ended Turn`, 'INFO');
            
            if (pendingDrops.length > 0) {
                 pendingDrops.forEach(drop => {
                     newMap = newMap.map(t => {
                         if (t.id === drop.tileId) {
                             return { ...t, loot: drop.item };
                         }
                         return t;
                     });
                 });
            }

            let nextId = (currentPlayer + 1) % settings.playerCount;
            let loopCount = 0;
            while (nextPlayerStatus[nextId] === 'ELIMINATED' && loopCount < settings.playerCount) {
                nextId = (nextId + 1) % settings.playerCount;
                loopCount++;
            }
            
            if (nextId === 0 || nextId < currentPlayer) newTotalTurns += 1;
            const newTurnCounter = turnCounter + 1;

            if (newTurnCounter > 0 && newTurnCounter % 5 === 0 && settings.dynamicWeather) {
                 const weatherRng = state.activeSeed
                     ? createSeededRng(`${state.activeSeed}_weather_${newTurnCounter}`)
                     : Math.random;
                 Object.keys(newWeather.playerZones).forEach(key => {
                     const pid = parseInt(key);
                     newWeather.playerZones[pid] = rollWeather(weatherRng);
                 });
                 newWeather.turnsRemaining = 5;
            } else {
                 newWeather.turnsRemaining = 5 - (newTurnCounter % 5);
            }

            let overwatchRefund = 0;
            newUnits.forEach(u => {
                if (u.owner === nextId && u.isOverwatching) {
                    overwatchRefund += OVERWATCH_STATS[u.type].refund;
                }
            });

            const cp = nextPlayerCp[nextId];
            const cpRules = getEffectiveCpRules(settings.mutators);
            nextPlayerCp[nextId] = Math.min(cpRules.maxCp, cp + cpRules.regenAmount + overwatchRefund);
            if (overwatchRefund > 0) {
                extraLogs.push(createLog(currentRound, nextId, `Unfired Overwatch refunded +${overwatchRefund} CP`, 'INFO'));
            }
            nextPlayerGold[nextId] += GOLD_SETTINGS.INCOME_PER_TURN;

            newGraveyard = newGraveyard.map(u => {
                if (u.owner === nextId && u.turnsUntilRespawn > 0) return { ...u, turnsUntilRespawn: u.turnsUntilRespawn - 1 };
                return u;
            });

            newUnits = newUnits.map(u => {
                if (u.owner === nextId) {
                    // RESET PHASE
                    // If Rooted, hasMoved becomes true (cannot move), but completed is false (can act)
                    // If not Rooted, fresh turn.
                    return { 
                        ...u, 
                        hasMoved: u.isRooted ? true : false, 
                        completed: false,
                        isRooted: false // Clear root for *next* turn (they are penalized *this* turn by hasMoved=true)
                        // Actually, wait: If they end turn on Quicksand, they get rooted for NEXT turn.
                        // So we should check the TILE they are on now.
                    };
                }
                return u;
            });
            
            // Re-apply Root status based on current tile position for the ACTIVE player
            // This ensures if they stayed in Quicksand, they get rooted again.
            // If they just moved into Quicksand last turn, the 'MOVE' action set isRooted=true.
            // The map above cleared it. We need to preserve it if it was set during the move phase? 
            // Better logic:
            // 1. Move sets isRooted=true if entering Quicksand.
            // 2. End Turn happens.
            // 3. Start Turn (above map): 
            //    If isRooted is true -> hasMoved=true.
            //    Then set isRooted=false (so they can move turn after, unless they stay).
            // But if they stay? The Move action doesn't trigger. 
            // So we need to check tile position here.
            
            newUnits = newUnits.map(u => {
                 if (u.owner === nextId) {
                     const tile = newMap.find(t => t.id === u.tileId);
                     const onQuicksand = tile?.type === 'QUICKSAND';
                     
                     // If they were rooted from previous move, or are standing on quicksand
                     const shouldBeRooted = u.isRooted || onQuicksand;
                     
                     return {
                         ...u,
                         hasMoved: shouldBeRooted ? true : false,
                         completed: false,
                         isRooted: false, // Reset flag, the penalty is applied via hasMoved
                         isOverwatching: false
                     };
                 }
                 return u;
            });

            // --- ENVIRONMENT ACTIONS (DOOMSDAY, TURRETS, ARTILLERY) ---
            
            // 1. DOOMSDAY
            if (settings.victoryMode === 'DEATHMATCH' && settings.doomsdayEnabled) {
                newMap = updateDoomsdayState(newMap, newTotalTurns, gridSize);
                const lavaTiles = new Set(newMap.filter(t => t.hazardState === 'LAVA').map(t => t.id));
                const meltingUnits = newUnits.filter(u => lavaTiles.has(u.tileId));
                
                if (meltingUnits.length > 0) {
                    newUnits = newUnits.filter(u => !lavaTiles.has(u.tileId));
                    meltingUnits.forEach(u => {
                        if (nextMatchStats[u.owner]) nextMatchStats[u.owner].unitsLost += 1;
                        newGraveyard.push({ id: u.id, type: u.type, owner: u.owner, turnsUntilRespawn: RESPAWN_TIMERS[u.type] });
                        extraLogs.push(createLog(currentRound, -1, `${UNIT_STATS[u.type].name} melted in Lava!`, 'COMBAT'));
                    });
                }
            }

            // 2. BANK TURRETS & 3. BASE ARTILLERY (Automated Defenses)
            const fireAutomatedDefense = (
                origin: Tile,
                range: number,
                dmg: number,
                candidates: Unit[],
                sourceLabel: string,
                projType: 'LASER' | 'MISSILE',
                colorHex: string
            ) => {
                const inRange = candidates.filter(u => {
                    const ut = newMap.find(t => t.id === u.tileId);
                    return ut ? Math.abs(ut.x - origin.x) + Math.abs(ut.y - origin.y) <= range : false;
                });
                if (inRange.length === 0) return;

                inRange.sort((a, b) => a.hp - b.hp);
                const target = inRange[0];
                const newHp = target.hp - dmg;
                const tarTile = newMap.find(t => t.id === target.tileId);

                if (tarTile) {
                    const sx = origin.x * TILE_SIZE + TILE_SIZE / 2;
                    const sy = origin.y * TILE_SIZE + TILE_SIZE / 2;
                    const ex = tarTile.x * TILE_SIZE + TILE_SIZE / 2;
                    const ey = tarTile.y * TILE_SIZE + TILE_SIZE / 2;
                    useEffectStore.getState().addProjectile(sx, sy, ex, ey, projType);
                    useEffectStore.getState().addDamagePopup(ex, ey - 14, `-${dmg}`, colorHex);
                    useEffectStore.getState().triggerScreenShake(newHp <= 0 ? 10 : 4);
                }

                const targetWasOverwatching = Boolean(target.isOverwatching);
                extraLogs.push(createLog(currentRound, -1, `${sourceLabel} hit P${target.owner + 1} ${UNIT_STATS[target.type].name} (-${dmg} HP)`, 'COMBAT'));
                newUnits = newUnits.map(u => u.id === target.id ? {
                    ...u,
                    hp: newHp,
                    isOverwatching: (dmg > 0 ? false : u.isOverwatching)
                } : u);
                if (newHp <= 0) {
                    newUnits = newUnits.filter(u => u.id !== target.id);
                    if (nextMatchStats[target.owner]) nextMatchStats[target.owner].unitsLost += 1;
                    newGraveyard.push({ id: target.id, type: target.type, owner: target.owner, turnsUntilRespawn: RESPAWN_TIMERS[target.type] });
                    extraLogs.push(createLog(currentRound, -1, `${sourceLabel} killed P${target.owner + 1} ${UNIT_STATS[target.type].name}`, 'COMBAT'));
                } else if (targetWasOverwatching && dmg > 0) {
                    if (tarTile) {
                        const ex = tarTile.x * TILE_SIZE + TILE_SIZE / 2;
                        const ey = tarTile.y * TILE_SIZE + TILE_SIZE / 2;
                        useEffectStore.getState().addDamagePopup(ex, ey - 28, 'SUPPRESSED!', '#FF9800');
                    }
                    extraLogs.push(createLog(currentRound, target.owner, `${sourceLabel} suppressed ${UNIT_STATS[target.type].name}'s Overwatch!`, 'COMBAT'));
                }
            };

            const activeBanks = newMap.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
            activeBanks.forEach(bank => {
                fireAutomatedDefense(bank, BANK_STATS.RANGE, BANK_STATS.DAMAGE, newUnits, 'Bank Turret', 'LASER', '#FFD700');
            });

            if (settings.victoryMode === 'CONQUER') {
                const myBases = newMap.filter(t => t.type === 'BASE' && t.owner === currentPlayer && (t.hp || 0) > 0);
                myBases.forEach(base => {
                    const enemyUnits = newUnits.filter(u => u.owner !== currentPlayer);
                    fireAutomatedDefense(base, BASE_STATS.RANGE, getBaseArtilleryDamage(), enemyUnits, 'Base Artillery', 'MISSILE', '#FF5722');
                });
            }

            break;
        }
    }

    // Check Deathmatch elimination when a player has 0 live units and no remaining respawns
    const effectiveMaxRespawns = getEffectiveMaxRespawns(settings.mutators);
    if (settings.victoryMode === 'DEATHMATCH') {
        for (let pid = 0; pid < settings.playerCount; pid++) {
            if (nextPlayerStatus[pid] === 'ELIMINATED') continue;
            const aliveCount = newUnits.filter(u => u.owner === pid).length;
            const hasRespawnAvailable =
                (nextPlayerRespawns[pid] || 0) < effectiveMaxRespawns &&
                newGraveyard.some(g => g.owner === pid);
            if (aliveCount === 0 && !hasRespawnAvailable) {
                nextPlayerStatus[pid] = 'ELIMINATED';
                extraLogs.push(createLog(currentRound, -1, `Player ${pid + 1} eliminated!`, 'COMBAT'));
            }
        }
    }

    // Immediate winner evaluation (works for Conquer, Deathmatch, and Mission triggers)
    const activePlayers = Object.entries(nextPlayerStatus)
        .filter(([, status]) => status === 'ACTIVE')
        .map(([pid]) => parseInt(pid, 10));
    if (activePlayers.length === 1) {
        newWinner = activePlayers[0];
    }

    const actualNextPlayer = action.type === 'END_TURN' ? 
        (() => {
            let nextId = (state.currentPlayer + 1) % settings.playerCount;
            let loopCount = 0;
            while (nextPlayerStatus[nextId] === 'ELIMINATED' && loopCount < settings.playerCount) {
                nextId = (nextId + 1) % settings.playerCount;
                loopCount++;
            }
            return nextId;
        })() : currentPlayer;

    const mission = state.activeMission;
    if (mission && newWinner === null) {
        if (mission.targetKillType) {
            const targetRemaining = newUnits.some(
                u => u.owner === mission.targetKillType!.owner && (u.rank ?? 0) >= mission.targetKillType!.minRank
            );
            if (!targetRemaining) {
                newWinner = 0;
                extraLogs.push(createLog(currentRound, 0, 'All Command Targets Eliminated — Mission Complete!', 'INFO'));
            }
        }
        if (newWinner === null && mission.requiredHeists && (nextMatchStats[0]?.heists ?? 0) >= mission.requiredHeists) {
            newWinner = 0;
            newBankReward = null;
            extraLogs.push(createLog(currentRound, 0, 'Vault Objectives Completed — Mission Complete!', 'ECONOMY'));
        }
        if (newWinner === null && action.type === 'END_TURN' && actualNextPlayer === 0) {
            const elapsedCompleted = newTotalTurns - (mission.startingRound ?? 0);
            const p0Alive = nextPlayerStatus[0] === 'ACTIVE' && newUnits.some(u => u.owner === 0);
            if (mission.surviveTurns && elapsedCompleted >= mission.surviveTurns && p0Alive) {
                newWinner = 0;
                extraLogs.push(createLog(currentRound, 0, `Held the line for ${mission.surviveTurns} rounds — Mission Complete!`, 'INFO'));
            } else if (mission.turnLimit && elapsedCompleted >= mission.turnLimit) {
                newWinner = 1;
                extraLogs.push(createLog(currentRound, -1, `Turn Limit (${mission.turnLimit} rounds) expired — Mission Failed`, 'INFO'));
            }
        }
    }

    if (newWinner !== null) {
        if (state.winner === null) {
            const roundsTaken = mission
                ? Math.max(1, newTotalTurns - (mission.startingRound ?? 0) + 1)
                : Math.max(1, newTotalTurns + 1);
            newMatchSummary = calculateMatchScorecard({
                winner: newWinner,
                rounds: roundsTaken,
                victoryMode: settings.victoryMode,
                gameMode: settings.gameMode,
                aiDifficulty: settings.aiDifficulty,
                seed: state.activeSeed || '',
                playerStats: nextMatchStats,
                playerRespawns: nextPlayerRespawns,
                units: newUnits,
                parRoundsOverride: mission?.parRounds,
                challengeId: mission?.id
            });
            CareerStorage.recordMatch(newMatchSummary);
        }
        SoundFX.play('victory');
    } else if (action.type === 'END_TURN') {
        SoundFX.play('turn');
    }

    const vis = calculateVisibility(actualNextPlayer, newUnits, newMap, newWeather, settings.fogOfWar, gridSize);
    const updatedTurnCounter = action.type === 'END_TURN' ? (turnCounter + 1) : turnCounter;

    // Combine Logs
    const allNewLogs = [...extraLogs.reverse()];
    if (logEntry) allNewLogs.push(logEntry);

    set({
        mapData: newMap,
        units: newUnits,
        graveyard: newGraveyard,
        playerCp: nextPlayerCp,
        playerGold: nextPlayerGold,
        playerRespawns: nextPlayerRespawns,
        playerStatus: nextPlayerStatus,
        playerInventory: nextPlayerInventory,
        winner: newWinner,
        matchStats: nextMatchStats,
        matchSummary: newMatchSummary,
        totalTurns: newTotalTurns,
        turnCounter: updatedTurnCounter,
        visibleTiles: vis,
        weather: newWeather,
        currentPlayer: actualNextPlayer,
        bankRewardPending: newBankReward,
        pendingDrops: action.type === 'END_TURN' ? [] : state.pendingDrops,
        selectedUnitId: null,
        selectedTileId: null,
        hoveredTileId: null,
        validMoveTiles: [],
        validAttackTargets: [],
        validSecureTile: null,
        validHeistTile: null,
        validSiegeTile: null,
        validLootTile: null,
        validDemolishTile: null,
        placementMode: null,
        gameLog: [...allNewLogs, ...state.gameLog],
        isAiTurn: newWinner === null && (actualNextPlayer === 1 && settings.gameMode === 'PVE'),
        selectedInventoryItemIndex: null
    });

    if (newWinner === null && actualNextPlayer === 1 && settings.gameMode === 'PVE') {
        get().runAiLoop();
    }
  }
}));
