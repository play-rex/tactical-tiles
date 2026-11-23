/** Building a new game: generated maps, custom maps and challenge ops. */
import {
  BARRIER_STATS,
  BASE_STATS,
  GOLD_SETTINGS,
  TERRAIN_COSTS,
  VETERANCY_CONFIG,
} from '../constants/Config';
import type { GameMutators, GameSettings, Tile, Unit, UnitType, WeatherState, WeatherType } from '../types';
import { getManhattanDistance, getTileByIdFast } from '../grid/Pathfinding';
import { assignVoronoiZones } from '../grid/ZoneGeneration';
import { applyUnitXp, getEffectiveCpRules, getUnitMaxHp } from '../rules/CombatRules';
import { createSeededRng, generateSectorSeed, normalizeSeed } from '../utils/SeededRandom';
import { getChallengeById } from '../assets/ChallengeOps';
import { cloneMatchStats, createEmptyGameState, createLog, createUnit, type GameState, type InventoryItem, type PlayerStatus } from './state';

export const WEATHER_TYPES: WeatherType[] = ['CLEAR', 'SCORCHED', 'MONSOON', 'FOG', 'TAILWIND', 'SANDSTORM'];

export const rollWeather = (rng: () => number = Math.random): WeatherType => {
    return WEATHER_TYPES[Math.floor(rng() * WEATHER_TYPES.length)];
};

// ... (Map Generation Helpers) ...
export const generateDynamicMap = (
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

    const dist = getManhattanDistance;
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

                const isGroundBlocked = (t: Tile) =>
                    TERRAIN_COSTS[t.type] >= 90 || t.type === 'MOUNTAIN' || t.type === 'BUILDING';

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
                        if (!nt || visited.has(nt.id) || isGroundBlocked(nt)) continue;
                        visited.add(nt.id);
                        queue.push(nt);
                    }
                }

                if (!reached) {
                    // Carve a bridge/corridor along Manhattan path so no match starts unwinnable for ground squads
                    let cx = origin.x;
                    let cy = origin.y;
                    while (cx !== targetBase.x || cy !== targetBase.y) {
                        if (cx !== targetBase.x) cx += cx < targetBase.x ? 1 : -1;
                        else if (cy !== targetBase.y) cy += cy < targetBase.y ? 1 : -1;
                        const stepTile = getTile(cx, cy);
                        if (stepTile && isGroundBlocked(stepTile)) {
                            stepTile.type = stepTile.type === 'WATER' ? 'BRIDGE' : 'PLAINS';
                            stepTile.subType = undefined;
                            stepTile.owner = undefined;
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
export const spawnUnitsForPlayers = (
    mapTiles: Tile[],
    counts: GameSettings['unitCounts'],
    baseLocations: {x:number, y:number, owner:number}[],
    mutators?: GameMutators
): Unit[] => {
    const units: Unit[] = [];
    let idCounter = 0;

    baseLocations.forEach(base => {
        const candidates = mapTiles
            .filter(t => t.type !== 'WATER' && t.type !== 'MOUNTAIN' && t.type !== 'BUILDING' && t.type !== 'BASE' && t.type !== 'CANYON' && t.type !== 'BARRIER' && t.type !== 'QUICKSAND')
            .sort((a, b) => getManhattanDistance(a, base) - getManhattanDistance(b, base));
        
        let idx = 0;
        const spawnList = [
            ...Array(counts.SOLDIER).fill('SOLDIER'),
            ...Array(counts.ASSAULTER).fill('ASSAULTER'),
            ...Array(counts.SNIPER).fill('SNIPER'),
        ];
        spawnList.forEach(type => {
            if (idx < candidates.length) {
                units.push(createUnit({
                    id: `unit_${idCounter++}`,
                    type: type as UnitType,
                    tileId: candidates[idx].id,
                    owner: base.owner,
                    mutators,
                }));
                idx++;
            }
        });
    });

    return units;
};

// ── New games ────────────────────────────────────────────────────

interface StartingPlayers {
    playerCp: Record<number, number>;
    playerGold: Record<number, number>;
    playerRespawns: Record<number, number>;
    playerStatus: Record<number, PlayerStatus>;
    playerInventory: Record<number, InventoryItem[]>;
    weather: WeatherState;
}

/** Starting CP, gold and weather for every seat. Player 1 opens with less CP (first-move edge). */
const startingPlayers = (
    settings: GameSettings,
    weatherRng: () => number,
    overrides: { cp?: Record<number, number>; gold?: Record<number, number> } = {}
): StartingPlayers => {
    const cpRules = getEffectiveCpRules(settings.mutators);
    const out: StartingPlayers = {
        playerCp: {}, playerGold: {}, playerRespawns: {}, playerStatus: {}, playerInventory: {},
        weather: { playerZones: {}, turnsRemaining: 5 },
    };
    for (let i = 0; i < settings.playerCount; i++) {
        out.playerCp[i] = overrides.cp?.[i] ?? (i === 0 ? cpRules.p1Round1Cp : cpRules.maxCp);
        out.playerGold[i] = overrides.gold?.[i] ?? GOLD_SETTINGS.INITIAL_GOLD;
        out.playerRespawns[i] = 0;
        out.playerStatus[i] = 'ACTIVE';
        out.playerInventory[i] = [];
        out.weather.playerZones[i] = settings.dynamicWeather ? rollWeather(weatherRng) : 'CLEAR';
    }
    return out;
};

/** Bases get HP in Conquer mode; every Barrier starts at full strength. */
const initStructureHp = (map: Tile[], settings: GameSettings, clearBaseHp: boolean) => {
    map.forEach(t => {
        if (t.type === 'BASE') {
            if (settings.victoryMode === 'CONQUER') {
                t.hp = BASE_STATS.HP;
                t.maxHp = BASE_STATS.HP;
            } else if (clearBaseHp) {
                t.hp = undefined;
                t.maxHp = undefined;
            }
        }
        if (t.type === 'BARRIER') {
            t.hp = BARRIER_STATS.HP;
            t.maxHp = BARRIER_STATS.HP;
        }
    });
};

const freshGame = (
    settings: GameSettings,
    mapData: Tile[],
    gridSize: number,
    units: Unit[],
    activeSeed: string,
    players: StartingPlayers
): GameState => ({
    ...createEmptyGameState(settings, gridSize),
    mapData,
    units,
    ...players,
    activeSeed,
    matchStats: cloneMatchStats(undefined, settings.playerCount),
});

/** A generated map from the settings' seed (or a new random seed). */
export const createGeneratedGame = (settings: GameSettings): GameState => {
    const activeSeed = normalizeSeed(settings.mapSeed) || generateSectorSeed();
    const mapRng = createSeededRng(activeSeed);
    const weatherRng = createSeededRng(`${activeSeed}_weather`);
    const { map, size, baseLocations } = generateDynamicMap(settings.playerCount, mapRng);
    const zonedMap = assignVoronoiZones(map, baseLocations);
    const units = spawnUnitsForPlayers(zonedMap, settings.unitCounts, baseLocations, settings.mutators);
    const players = startingPlayers(settings, weatherRng);
    initStructureHp(zonedMap, settings, false);
    return freshGame(settings, zonedMap, size, units, activeSeed, players);
};

/** A copy of a map that's safe to change (tiles and their capture lists are copied). */
export const cloneTiles = (tiles: Tile[]): Tile[] =>
    tiles.map(t => ({ ...t, capturedByOwners: t.capturedByOwners ? [...t.capturedByOwners] : undefined }));

/** A saved or preset map. Only as many bases as players are kept; the rest become plains. */
export const createCustomMapGame = (settings: GameSettings, customMap: Tile[]): GameState => {
    const zonedMap = cloneTiles(customMap);
    const gridSize = Math.round(Math.sqrt(zonedMap.length));
    const seedUsed = normalizeSeed(settings.mapSeed) || 'CUSTOM';
    const weatherRng = createSeededRng(`${seedUsed}_weather`);

    const potentialBases = zonedMap.filter(t => t.type === 'BASE');
    const baseLocations: { x: number; y: number; owner: number }[] = [];

    if (potentialBases.length > 0) {
        // Roughly top-left to bottom-right
        potentialBases.sort((a, b) => (a.x + a.y) - (b.x + b.y));

        // Two players take opposite corners (first and last); more take the first N.
        let activeIndices: number[] = [];
        if (settings.playerCount === 2 && potentialBases.length >= 2) {
            activeIndices = [0, potentialBases.length - 1];
        } else {
            for (let i = 0; i < Math.min(settings.playerCount, potentialBases.length); i++) activeIndices.push(i);
        }

        // Hide every base, then bring back only the ones in play
        potentialBases.forEach(b => {
            b.type = 'PLAINS';
            delete b.owner;
            delete b.hp;
            delete b.maxHp;
        });
        activeIndices.forEach((baseIndex, ownerId) => {
            const b = potentialBases[baseIndex];
            b.type = 'BASE';
            b.owner = ownerId;
            b.height = 1;
            baseLocations.push({ x: b.x, y: b.y, owner: ownerId });
        });
    } else {
        // No bases on the map: opposite corners
        const p1 = getTileByIdFast(zonedMap, '1,1', gridSize);
        const p2 = getTileByIdFast(zonedMap, `${gridSize - 2},${gridSize - 2}`, gridSize);
        if (p1) { p1.type = 'BASE'; p1.owner = 0; baseLocations.push({ x: 1, y: 1, owner: 0 }); }
        if (p2) { p2.type = 'BASE'; p2.owner = 1; baseLocations.push({ x: gridSize - 2, y: gridSize - 2, owner: 1 }); }
    }

    // Keep zones painted in the editor; otherwise split the map between the bases.
    const hasCustomZones = zonedMap.some(t => t.zone !== undefined);
    const finalMap = hasCustomZones ? zonedMap : assignVoronoiZones(zonedMap, baseLocations);
    initStructureHp(finalMap, settings, true);

    const units = spawnUnitsForPlayers(finalMap, settings.unitCounts, baseLocations, settings.mutators);
    const players = startingPlayers(settings, weatherRng);
    return freshGame(settings, finalMap, gridSize, units, seedUsed, players);
};

const settingsForMission = (
    current: GameSettings,
    mission: NonNullable<ReturnType<typeof getChallengeById>>,
): GameSettings => ({
    ...current,
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
    challengeId: mission.id,
});

/** The settings a challenge op plays with: its own, over the player's current ones. */
export const challengeSettings = (current: GameSettings, challengeId: string): GameSettings | null => {
    const mission = getChallengeById(challengeId);
    return mission ? settingsForMission(current, mission) : null;
};

/** A challenge op: its own map, pre-placed squads and objectives. */
export const createChallengeGame = (current: GameSettings, challengeId: string): GameState | null => {
    const mission = getChallengeById(challengeId);
    if (!mission) return null;
    const settings = settingsForMission(current, mission);

    const finalMap = mission.buildMap();
    const units: Unit[] = mission.placements.map((p, idx) => {
        let unit = createUnit({
            id: `chal_${idx}`,
            type: p.type,
            tileId: `${p.x},${p.y}`,
            owner: p.owner,
            mutators: settings.mutators,
        });
        if (p.rank && p.rank > 0) {
            unit = applyUnitXp(unit, VETERANCY_CONFIG.XP_THRESHOLDS[p.rank]).unit;
        }
        if (p.hp !== undefined) {
            unit.hp = Math.min(getUnitMaxHp(unit), p.hp);
        }
        return unit;
    });

    const weatherRng = createSeededRng(`${mission.seed}_weather`);
    const players = startingPlayers(settings, weatherRng, { cp: mission.startingCp, gold: mission.startingGold });
    const startRound = mission.startingRound ?? 0;
    return {
        ...freshGame(settings, finalMap, mission.gridSize, units, mission.seed, players),
        totalTurns: startRound,
        activeMission: mission,
        gameLog: [createLog(startRound + 1, -1, `OP: ${mission.title} — ${mission.subtitle}`, 'INFO')],
    };
};
