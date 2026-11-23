import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyUnitXp,
    calculateAttackOutcome,
    calculateOverwatchOutcome,
    calculateSiegeDamage,
    canConstructOnTile,
    canUnitAttackFromTile,
    canUnitEnterOverwatch,
    getEffectiveBankRewards,
    getEffectiveCpRules,
    getEffectiveMaxRespawns,
    getEffectiveUnitAmmo,
    getUnitAttackCost,
    getUnitBaseDamage,
    getUnitMaxHp,
    getUnitRange,
    getUnitVision,
    resolveBridgeVariant
} from '@tactical/engine/rules/CombatRules';
import { getOverwatchCoverageTiles, resolveMoveWithOverwatch } from '@tactical/engine/rules/OverwatchRules';
import { getMovePath, getValidMoves, hasOverwatchLineOfSight } from '@tactical/engine/grid/Pathfinding';
import { CP_SYSTEM, MUTATOR_CONFIG, OVERWATCH_STATS, TERRAIN_COSTS, UNIT_STATS, VETERANCY_CONFIG } from '@tactical/engine/constants/Config';
import { findBestTarget } from '@tactical/engine/ai/TargetingLogic';
import { getBestAIAction } from '@tactical/engine/ai/AIBrain';
import { CHALLENGE_OPERATIONS } from '@tactical/engine/assets/ChallengeOps';
import { PRESET_MAPS } from '@tactical/engine/assets/Presets';
import { calculateMatchScorecard } from '@tactical/engine/storage/CareerStatsManager';
import { createSeededRng, normalizeSeed } from '@tactical/engine/utils/SeededRandom';
import {
    applyMapTilePatches,
    cloneTiles,
    createChallengeGame,
    createCustomMapGame,
    createGeneratedGame,
    createOnlineTableGame,
    DEFAULT_GAME_SETTINGS,
    DEFAULT_TABLE_SETTINGS,
    diffMapTilePatches,
    generateSectorSeed,
    mergeOnlineMapEdits,
    viewFor,
} from '@tactical/engine';
import { nextBoardRotation, rotateBoardPoint, rotateTileCoord, unrotateBoardPoint, type BoardRotation } from '../boardRotation';
import { computeTerrainSignature } from '../graphics/TacticalReconRenderer';
import { useGameStore } from '../../store/useGameStore';
import { Tile, Unit, WeatherState } from '@tactical/engine/types';

const makeGrid = (size: number): Tile[] => {
    const tiles: Tile[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            tiles.push({
                id: `${x},${y}`,
                x,
                y,
                type: 'PLAINS',
                height: 1,
                zone: 0,
                loot: null,
                hazardState: 'SAFE'
            });
        }
    }
    return tiles;
};

const clearWeather: WeatherState = { playerZones: { 0: 'CLEAR', 1: 'CLEAR' }, turnsRemaining: 5 };

test('CombatRules: Sniper firing terrain and Watchtower/Bunker/Sand modifiers', () => {
    const map = makeGrid(10);
    const sniper: Unit = {
        id: 'u_sniper',
        type: 'SNIPER',
        tileId: '2,2',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 0,
        hasMoved: false,
        completed: false
    };

    const plains = map[2 * 10 + 2];
    assert.equal(canUnitAttackFromTile(sniper, plains), false);

    plains.type = 'MOUNTAIN';
    plains.height = 2;
    assert.equal(canUnitAttackFromTile(sniper, plains), true);

    plains.type = 'DUNES';
    assert.equal(canUnitAttackFromTile(sniper, plains), true);

    plains.type = 'BUILDING';
    plains.subType = 'WATCHTOWER';
    plains.owner = 1;
    assert.equal(canUnitAttackFromTile(sniper, plains), false);

    plains.owner = 0;
    assert.equal(canUnitAttackFromTile(sniper, plains), true);
    assert.equal(getUnitRange(sniper, map, clearWeather), 11);

    const targetBunker = map[2 * 10 + 5];
    targetBunker.type = 'BUILDING';
    targetBunker.subType = 'BUNKER';
    targetBunker.owner = 1;
    const vsBunker = calculateAttackOutcome(sniper, plains, targetBunker, 1);
    // Sniper 20 * Watchtower 1.2 = 24; Bunker 50% cover = 12
    assert.equal(vsBunker.damage, 12);
    assert.equal(vsBunker.watchtowerBoosted, true);

    const targetSand = map[2 * 10 + 6];
    targetSand.type = 'SAND';
    const vsSand = calculateAttackOutcome(sniper, plains, targetSand, 1);
    // 24 * (1 - (-0.1)) = 26.4 -> floor 26
    assert.equal(vsSand.damage, 26);
});

test('CombatRules: Siege damage scales by unit type and Watchtower boost', () => {
    const map = makeGrid(6);
    const tile = map[0];
    const scout: Unit = { id: 's', type: 'SOLDIER', tileId: '0,0', hp: 15, ammo: 10, maxAmmo: 10, owner: 0, hasMoved: false, completed: false };
    const assaulter: Unit = { id: 'a', type: 'ASSAULTER', tileId: '0,0', hp: 30, ammo: 6, maxAmmo: 6, owner: 0, hasMoved: false, completed: false };
    const sniper: Unit = { id: 'sn', type: 'SNIPER', tileId: '0,0', hp: 10, ammo: 3, maxAmmo: 3, owner: 0, hasMoved: false, completed: false };

    assert.equal(calculateSiegeDamage(scout, tile), 4);
    assert.equal(calculateSiegeDamage(assaulter, tile), 8);
    assert.equal(calculateSiegeDamage(sniper, tile), 16);

    tile.type = 'BUILDING';
    tile.subType = 'WATCHTOWER';
    tile.owner = 0;
    assert.equal(calculateSiegeDamage(sniper, tile), 19);
});

test('AI Targeting & Brain: AI Snipers cannot shoot off Plains and use effective range', () => {
    const map = makeGrid(12);
    const aiSniper: Unit = {
        id: 'ai_sn',
        type: 'SNIPER',
        tileId: '1,1',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 1,
        hasMoved: false,
        completed: false
    };
    const enemy: Unit = {
        id: 'p0_s',
        type: 'SOLDIER',
        tileId: '1,4',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 0,
        hasMoved: false,
        completed: false
    };

    // Standing on PLAINS -> cannot attack
    assert.equal(findBestTarget(aiSniper, [aiSniper, enemy], map, 'HARD', clearWeather, 12), null);

    // Standing on owned Watchtower -> range 7 + 4 = 11; enemy at dist 10 is reachable
    map[1 * 12 + 1].type = 'BUILDING';
    map[1 * 12 + 1].subType = 'WATCHTOWER';
    map[1 * 12 + 1].owner = 1;
    enemy.tileId = '1,11';
    const found = findBestTarget(aiSniper, [aiSniper, enemy], map, 'HARD', clearWeather, 12);
    assert.ok(found);
    assert.equal(found.unit.id, 'p0_s');

    // Also verify AIBrain does not illegally emit SIEGE from Plains
    map[1 * 12 + 1].type = 'PLAINS';
    map[1 * 12 + 1].subType = undefined;
    map[1 * 12 + 1].owner = undefined;
    map[1 * 12 + 4].type = 'BASE';
    map[1 * 12 + 4].owner = 0;
    map[1 * 12 + 4].hp = 50;
    const action = getBestAIAction({
        mapData: map,
        units: [aiSniper],
        currentPlayer: 1,
        playerCp: 20,
        playerGold: 150,
        playerInventory: [],
        weather: clearWeather,
        difficulty: 'HARD',
        graveyard: [],
        victoryMode: 'CONQUER',
        gridSize: 12,
        settings: {
            playerCount: 2,
            unitCounts: { SOLDIER: 0, ASSAULTER: 0, SNIPER: 1 },
            dynamicWeather: false,
            fogOfWar: false,
            doomsdayEnabled: false,
            gameMode: 'PVE',
            victoryMode: 'CONQUER',
            aiDifficulty: 'HARD'
        },
        totalTurns: 0
    });
    assert.notEqual(action.type, 'SIEGE');
});

test('Preset Maps: Bridges and Bases remain intact and navigable', () => {
    const recon = PRESET_MAPS.find(m => m.id === 'campaign_recon');
    assert.ok(recon);
    const reconBridges = recon.data.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V');
    assert.ok(reconBridges.length >= 6);
    const reconBases = recon.data.filter(t => t.type === 'BASE');
    assert.equal(reconBases.length, 4);
    const reconBank = recon.data.find(t => t.type === 'BANK');
    assert.ok(reconBank);
    for (const base of reconBases) {
        const pathToBank = getMovePath(base, reconBank.id, 999, recon.data, [], 'SOLDIER', base.owner ?? 0, clearWeather, recon.width);
        assert.ok(pathToBank.length > 0, `Base ${base.id} should reach Bank ${reconBank.id}`);
    }

    const canyon = PRESET_MAPS.find(m => m.id === 'campaign_canyon');
    assert.ok(canyon);
    const canyonBridges = canyon.data.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V');
    assert.equal(canyonBridges.length, 6);
    assert.equal(canyon.data.filter(t => t.type === 'BASE').length, 2);

    const delta = PRESET_MAPS.find(m => m.id === 'campaign_delta');
    assert.ok(delta);
    const deltaBridges = delta.data.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V');
    assert.equal(deltaBridges.length, 4);
    assert.equal(delta.data.filter(t => t.type === 'BASE').length, 4);
});

test('Store: AI Bank Heist auto-resolves without softlocking player turn', () => {
    const map = makeGrid(8);
    map[0].type = 'BASE';
    map[0].owner = 0;
    map[0].hp = 50;
    map[0].maxHp = 50;

    map[63].type = 'BASE';
    map[63].owner = 1;
    map[63].hp = 50;
    map[63].maxHp = 50;

    const bank = map[2 * 8 + 2];
    bank.type = 'BANK';
    bank.hackProgress = 0;
    bank.bankGoldReward = 200;
    bank.bankCpReward = 10;

    const aiUnit: Unit = {
        id: 'ai_1',
        type: 'SOLDIER',
        tileId: '2,3',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 1,
        hasMoved: false,
        completed: false
    };

    useGameStore.setState({
        currentScreen: 'GAME',
        mapData: map,
        gridSize: 8,
        units: [aiUnit],
        graveyard: [],
        currentPlayer: 1,
        isAiTurn: true,
        winner: null,
        bankRewardPending: null,
        playerCp: { 0: 20, 1: 20 },
        playerGold: { 0: 150, 1: 150 },
        playerRespawns: { 0: 0, 1: 0 },
        playerStatus: { 0: 'ACTIVE', 1: 'ACTIVE' },
        playerInventory: { 0: [], 1: [] },
        weather: clearWeather,
        gameLog: [],
        settings: {
            playerCount: 2,
            unitCounts: { SOLDIER: 1, ASSAULTER: 0, SNIPER: 0 },
            dynamicWeather: false,
            fogOfWar: false,
            doomsdayEnabled: false,
            gameMode: 'PVE',
            victoryMode: 'CONQUER',
            aiDifficulty: 'HARD'
        }
    });

    useGameStore.getState().executeAiAction({
        type: 'HEIST',
        unitId: 'ai_1',
        tileId: bank.id,
        cost: 4
    });

    let state = useGameStore.getState();
    assert.equal(state.bankRewardPending, null);
    assert.equal(state.playerGold[1], 350);

    // End AI turn and verify Player 0 is not blocked
    state.executeAiAction({ type: 'END_TURN' });
    state = useGameStore.getState();
    assert.equal(state.currentPlayer, 0);
    assert.equal(state.isAiTurn, false);
    assert.equal(state.bankRewardPending, null);

    // Clean up screen state
    useGameStore.getState().resetGame();
});

test('Store: Custom map zones are preserved on loadMapAndStart and Deathmatch ends immediately on last kill', () => {
    const customMap = makeGrid(6);
    customMap.forEach(t => {
        t.zone = t.x < 3 ? 1 : 0; // Deliberately inverted from Voronoi
    });
    customMap[0].type = 'BASE';
    customMap[0].owner = 0;
    customMap[35].type = 'BASE';
    customMap[35].owner = 1;

    useGameStore.getState().setGameSettings({
        playerCount: 2,
        gameMode: 'PVP',
        victoryMode: 'DEATHMATCH',
        unitCounts: { SOLDIER: 1, ASSAULTER: 0, SNIPER: 0 }
    });
    useGameStore.getState().loadMapAndStart(customMap);

    let state = useGameStore.getState();
    assert.equal(state.mapData[0].zone, 1);
    assert.equal(state.mapData[5].zone, 0);

    // Place P1 unit with low HP next to P0 unit and kill it with no respawns left
    const p0Unit: Unit = { id: 'p0', type: 'ASSAULTER', tileId: '1,1', hp: 30, ammo: 6, maxAmmo: 6, owner: 0, hasMoved: false, completed: false };
    const p1Unit: Unit = { id: 'p1', type: 'SOLDIER', tileId: '1,2', hp: 5, ammo: 10, maxAmmo: 10, owner: 1, hasMoved: false, completed: false };
    useGameStore.setState({
        units: [p0Unit, p1Unit],
        playerRespawns: { 0: 0, 1: 2 },
        currentPlayer: 0
    });

    useGameStore.getState().executeAiAction({
        type: 'ATTACK',
        attackerId: 'p0',
        targetUnitId: 'p1',
        cost: 5
    });

    state = useGameStore.getState();
    assert.equal(state.playerStatus[1], 'ELIMINATED');
    assert.equal(state.winner, 0);

    useGameStore.getState().resetGame();
});

test('Construction helpers: Barrier/Bridge validation and auto-orientation', () => {
    const map = makeGrid(5);
    // Vertical river down x=2
    for (let y = 0; y < 5; y++) {
        map[y * 5 + 2].type = 'WATER';
    }
    const waterTile = map[2 * 5 + 2];
    assert.equal(canConstructOnTile('BRIDGE', waterTile, []), true);
    assert.equal(canConstructOnTile('BARRIER', waterTile, []), false);
    assert.equal(resolveBridgeVariant(waterTile, map, 5), 'BRIDGE');

    // Horizontal river across y=2
    const map2 = makeGrid(5);
    for (let x = 0; x < 5; x++) {
        map2[2 * 5 + x].type = 'WATER';
    }
    assert.equal(resolveBridgeVariant(map2[2 * 5 + 2], map2, 5), 'BRIDGE_V');
});

test('Pathfinding: getMovePath routes around water via bridge', () => {
    const map = makeGrid(5);
    for (let y = 0; y < 5; y++) {
        map[y * 5 + 2].type = 'WATER';
    }
    map[4 * 5 + 2].type = 'BRIDGE';
    const path = getMovePath(map[0], '3,4', 20, map, [], 'SOLDIER', 0, clearWeather, 5);
    assert.ok(path.length >= 6);
    assert.equal(path[0].id, '0,0');
    assert.equal(path[path.length - 1].id, '3,4');
    assert.ok(path.some(t => t.id === '2,4'));
});

test('Store: MAX_RESPAWNS is strictly enforced and RELOAD restores ammo', () => {
    const map = makeGrid(6);
    map[0].type = 'BASE';
    map[0].owner = 0;
    map[0].hp = 50;
    map[35].type = 'BASE';
    map[35].owner = 1;
    map[35].hp = 50;

    const unit: Unit = {
        id: 'u0',
        type: 'SNIPER',
        tileId: '1,1',
        hp: 10,
        ammo: 0,
        maxAmmo: 3,
        owner: 0,
        hasMoved: false,
        completed: false
    };

    useGameStore.setState({
        currentScreen: 'GAME',
        mapData: map,
        gridSize: 6,
        units: [unit],
        graveyard: [{ id: 'dead_1', type: 'SOLDIER', owner: 0, turnsUntilRespawn: 0 }],
        currentPlayer: 0,
        isAiTurn: false,
        winner: null,
        bankRewardPending: null,
        playerCp: { 0: 20, 1: 20 },
        playerGold: { 0: 500, 1: 150 },
        playerRespawns: { 0: 2, 1: 0 },
        playerStatus: { 0: 'ACTIVE', 1: 'ACTIVE' },
        playerInventory: { 0: [], 1: [] },
        weather: clearWeather,
        gameLog: []
    });

    // At respawn cap (2), SPAWN must not revive unit or spend gold
    useGameStore.getState().executeAiAction({
        type: 'SPAWN',
        unitType: 'SOLDIER',
        tileId: '0,0',
        cost: 0,
        goldCost: 50,
        deadUnitId: 'dead_1'
    });
    let state = useGameStore.getState();
    assert.equal(state.units.length, 1);
    assert.equal(state.playerGold[0], 500);

    // Field reload restores ceil(3/2)=2 ammo for 5 CP
    useGameStore.getState().executeAiAction({ type: 'RELOAD', unitId: 'u0', cost: 5 });
    state = useGameStore.getState();
    assert.equal(state.units[0].ammo, 2);
    assert.equal(state.playerCp[0], 15);
    assert.equal(state.units[0].completed, true);

    useGameStore.getState().resetGame();
});

test('Random map generation: 25 random maps all connect P0 and P1 bases', () => {
    for (let i = 0; i < 25; i++) {
        useGameStore.getState().setGameSettings({ playerCount: 2, gameMode: 'PVP' });
        useGameStore.getState().startGame();
        const { mapData, gridSize } = useGameStore.getState();
        const b0 = mapData.find(t => t.type === 'BASE' && t.owner === 0)!;
        const b1 = mapData.find(t => t.type === 'BASE' && t.owner === 1)!;

        const visited = new Set<string>([b0.id]);
        const queue = [b0];
        let found = false;
        while (queue.length > 0 && !found) {
            const cur = queue.shift()!;
            if (cur.id === b1.id) {
                found = true;
                break;
            }
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
                const nx = cur.x + dx;
                const ny = cur.y + dy;
                if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
                const nt = mapData[ny * gridSize + nx];
                if (!nt || visited.has(nt.id) || TERRAIN_COSTS[nt.type] >= 90 || nt.type === 'MOUNTAIN' || nt.type === 'BUILDING') continue;
                visited.add(nt.id);
                queue.push(nt);
            }
        }
        assert.equal(found, true, `Map ${i} had disconnected bases`);
    }
    useGameStore.getState().resetGame();
});

test('SeededRandom & Sector Seeds: repeatable procedural map and deterministic weather shift', () => {
    assert.equal(normalizeSeed('  ab-9#x '), 'AB9X');

    const r1 = createSeededRng('ALPHA1');
    const r2 = createSeededRng('ALPHA1');
    assert.deepEqual(
        [r1(), r1(), r1(), r1()],
        [r2(), r2(), r2(), r2()]
    );

    const store = useGameStore.getState();
    store.setGameSettings({
        playerCount: 2,
        gameMode: 'PVP',
        dynamicWeather: true,
        mapSeed: 'TACTIC'
    });
    store.startGame();
    const run1Map = useGameStore.getState().mapData.map(t => `${t.id}:${t.type}:${t.owner ?? ''}:${t.subType ?? ''}`);
    const run1Seed = useGameStore.getState().activeSeed;

    // Advance 5 individual turns to trigger deterministic weather shift
    for (let i = 0; i < 5; i++) {
        useGameStore.getState().endTurn();
    }
    const run1Weather = { ...useGameStore.getState().weather.playerZones };

    useGameStore.getState().setGameSettings({
        playerCount: 2,
        gameMode: 'PVP',
        dynamicWeather: true,
        mapSeed: 'tactic'
    });
    useGameStore.getState().startGame();
    const run2Map = useGameStore.getState().mapData.map(t => `${t.id}:${t.type}:${t.owner ?? ''}:${t.subType ?? ''}`);
    for (let i = 0; i < 5; i++) {
        useGameStore.getState().endTurn();
    }
    const run2Weather = { ...useGameStore.getState().weather.playerZones };

    assert.equal(run1Seed, 'TACTIC');
    assert.deepEqual(run1Map, run2Map);
    assert.deepEqual(run1Weather, run2Weather);
    assert.equal(PRESET_MAPS.length >= 2, true);
    useGameStore.getState().resetGame();
});

test('Veterancy: Rank 1/2/3 scaling, perks, Elite Breacher DR, Ace Breacher pierce, and move perks', () => {
    const baseScout: Unit = {
        id: 's1',
        type: 'SOLDIER',
        tileId: '0,0',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 0,
        hasMoved: false,
        completed: false
    };

    const r1Scout = applyUnitXp(baseScout, 2);
    assert.equal(r1Scout.promotedTo, 1);
    assert.equal(getUnitMaxHp(r1Scout.unit), 18);
    assert.equal(r1Scout.unit.hp, 18);
    assert.equal(r1Scout.unit.maxAmmo, 12);
    assert.equal(r1Scout.unit.ammo, 12);

    const r2Scout = applyUnitXp(r1Scout.unit, 3);
    assert.equal(r2Scout.promotedTo, 2);
    assert.equal(getUnitVision(r2Scout.unit), 5);

    const r3Scout = applyUnitXp(r2Scout.unit, 4);
    assert.equal(r3Scout.promotedTo, 3);
    assert.equal(getUnitMaxHp(r3Scout.unit), 21);
    assert.equal(getUnitBaseDamage(r3Scout.unit), 7);
    assert.equal(getUnitAttackCost(r3Scout.unit), 2);

    // Elite Scout ignores SCORCHED/MONSOON Plains penalty
    const map = makeGrid(6);
    const scorched: WeatherState = { playerZones: { 0: 'SCORCHED', 1: 'CLEAR' }, turnsRemaining: 3 };
    const recruitMoves = getValidMoves(map[0], 10, map, [baseScout], 'SOLDIER', 0, scorched, 6, 0);
    const eliteMoves = getValidMoves(map[0], 10, map, [r2Scout.unit], 'SOLDIER', 0, scorched, 6, 2);
    assert.equal(recruitMoves.get('2,0'), 4);
    assert.equal(eliteMoves.get('2,0'), 2);
    assert.deepEqual(
        getMovePath(map[0], '2,0', 10, map, [r2Scout.unit], 'SOLDIER', 0, scorched, 6, 2).map(t => t.id),
        ['0,0', '1,0', '2,0']
    );

    // Elite/Ace Sniper perks
    const baseSniper: Unit = {
        id: 'sn1',
        type: 'SNIPER',
        tileId: '0,0',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const r2Sniper = applyUnitXp(baseSniper, 5);
    assert.equal(r2Sniper.promotedTo, 2);
    assert.equal(getUnitBaseDamage(r2Sniper.unit), 22);
    assert.equal(getUnitAttackCost(r2Sniper.unit), 7);
    assert.equal(r2Sniper.unit.maxAmmo, 4);

    map[1].type = 'MOUNTAIN';
    const recruitMountainMoves = getValidMoves(map[0], 10, map, [baseSniper], 'SNIPER', 0, clearWeather, 6, 0);
    const aceMountainMoves = getValidMoves(map[0], 10, map, [baseSniper], 'SNIPER', 0, clearWeather, 6, 3);
    assert.equal(recruitMountainMoves.get('1,0'), 6);
    assert.equal(aceMountainMoves.get('1,0'), 1);

    // Elite Breacher cover armor & Ace Breacher siege pierce
    const breacher: Unit = {
        id: 'b1',
        type: 'ASSAULTER',
        tileId: '2,2',
        hp: 36,
        maxHp: 36,
        ammo: 8,
        maxAmmo: 8,
        owner: 1,
        rank: 2,
        xp: 5,
        hasMoved: false,
        completed: false
    };
    map[2 * 6 + 2].type = 'FOREST';
    const forestCoverOutcome = calculateAttackOutcome(r2Sniper.unit, map[1], map[2 * 6 + 2], 1, breacher);
    assert.equal(forestCoverOutcome.coverArmorApplied, true);
    // 22 * (1 - 0.4) = 13.2 -> floor 13 - 2 cover armor = 11
    assert.equal(forestCoverOutcome.damage, 11);

    const aceBreacher = applyUnitXp(breacher, 4).unit;
    assert.equal(aceBreacher.rank, 3);
    assert.equal(getUnitBaseDamage(aceBreacher), 12);
    assert.equal(calculateSiegeDamage(aceBreacher, map[0]), 12); // Pierces Base armor (full 12)
});

test('Store Veterancy Rules: anti-exploit XP (SECURE/DEMOLISH/SIEGE), Ace $75 bounty, MEDKIT heal, and SPAWN reset', () => {
    const map = makeGrid(6);
    map[0].type = 'BASE';
    map[0].owner = 0;
    map[0].hp = 50;
    map[35].type = 'BASE';
    map[35].owner = 1;
    map[35].hp = 50;
    map[2].type = 'BUILDING';
    map[3].type = 'BARRIER';
    map[3].hp = 25;
    map[4].type = 'BANK';
    map[4].hackProgress = 0;

    const p0Attacker: Unit = {
        id: 'p0_a',
        type: 'ASSAULTER',
        tileId: '1,0',
        hp: 30,
        maxHp: 30,
        ammo: 6,
        maxAmmo: 6,
        xp: 0,
        rank: 0,
        kills: 0,
        damageDealt: 0,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const p1AceVictim: Unit = {
        id: 'p1_ace',
        type: 'SOLDIER',
        tileId: '1,1',
        hp: 5,
        maxHp: 21,
        ammo: 12,
        maxAmmo: 12,
        xp: 9,
        rank: 3,
        owner: 1,
        hasMoved: false,
        completed: false
    };

    useGameStore.setState({
        currentScreen: 'GAME',
        mapData: map,
        gridSize: 6,
        units: [p0Attacker, p1AceVictim],
        graveyard: [],
        currentPlayer: 0,
        isAiTurn: false,
        winner: null,
        activeSeed: 'TESTXP',
        bankRewardPending: null,
        playerCp: { 0: 40, 1: 40 },
        playerGold: { 0: 100, 1: 100 },
        playerRespawns: { 0: 0, 1: 0 },
        playerStatus: { 0: 'ACTIVE', 1: 'ACTIVE' },
        playerInventory: { 0: ['FIRST_AID', 'MEDKIT', 'AMMO'], 1: [] },
        weather: clearWeather,
        gameLog: [],
        matchSummary: null
    });

    // 1. DEMOLISH awards 0 XP
    useGameStore.getState().executeAiAction({ type: 'DEMOLISH', unitId: 'p0_a', tileId: '3,0', cost: 5 });
    assert.equal(useGameStore.getState().units.find(u => u.id === 'p0_a')?.xp, 0);

    // 2. Non-lethal Base SIEGE awards 0 XP
    useGameStore.getState().executeAiAction({ type: 'SIEGE', unitId: 'p0_a', tileId: '5,5', cost: 5 });
    assert.equal(useGameStore.getState().units.find(u => u.id === 'p0_a')?.xp, 0);

    // 3. SECURE gives +1 XP first time for player 0, then 0 XP if recaptured by player 0
    useGameStore.getState().executeAiAction({ type: 'SECURE', unitId: 'p0_a', tileId: '2,0', cost: 4 });
    assert.equal(useGameStore.getState().units.find(u => u.id === 'p0_a')?.xp, 1);
    // Simulate enemy taking building then player 0 recapturing same building
    useGameStore.setState({
        mapData: useGameStore.getState().mapData.map(t => t.id === '2,0' ? { ...t, owner: 1 } : t)
    });
    useGameStore.getState().executeAiAction({ type: 'SECURE', unitId: 'p0_a', tileId: '2,0', cost: 4 });
    assert.equal(useGameStore.getState().units.find(u => u.id === 'p0_a')?.xp, 1);

    // 4. Killing an Ace grants +3 XP (total 4 -> Veteran Rank 1 -> maxHp 36) AND +$75 Bounty Gold
    useGameStore.getState().executeAiAction({
        type: 'ATTACK',
        attackerId: 'p0_a',
        targetUnitId: 'p1_ace',
        cost: 5
    });
    let st = useGameStore.getState();
    const promoted = st.units.find(u => u.id === 'p0_a')!;
    assert.equal(promoted.xp, 4);
    assert.equal(promoted.rank, 1);
    assert.equal(promoted.maxHp, 36);
    assert.equal(promoted.kills, 1);
    assert.equal(st.playerGold[0], 100 + VETERANCY_CONFIG.ACE_BOUNTY_GOLD);

    // 5. FIRST_AID heals 50% (+18 HP to 30 HP), MEDKIT heals to full 36 HP, AMMO refills to 8
    useGameStore.setState({
        units: st.units.map(u => u.id === 'p0_a' ? { ...u, hp: 12, ammo: 1 } : u)
    });
    useGameStore.getState().executeAiAction({ type: 'USE_ITEM', unitId: 'p0_a', itemIndex: 0, cost: 2 });
    assert.equal(useGameStore.getState().units.find(u => u.id === 'p0_a')?.hp, 30);
    useGameStore.getState().executeAiAction({ type: 'USE_ITEM', unitId: 'p0_a', itemIndex: 0, cost: 2 });
    useGameStore.getState().executeAiAction({ type: 'USE_ITEM', unitId: 'p0_a', itemIndex: 0, cost: 2 });
    st = useGameStore.getState();
    assert.equal(st.units.find(u => u.id === 'p0_a')?.hp, 36);
    assert.equal(st.units.find(u => u.id === 'p0_a')?.ammo, 8);

    // 6. Respawning fallen Ace (p1_ace) resets rank/xp to 0 and base Scout stats
    useGameStore.setState({
        currentPlayer: 1,
        graveyard: [{ id: 'p1_ace', type: 'SOLDIER', owner: 1, turnsUntilRespawn: 0 }]
    });
    useGameStore.getState().executeAiAction({
        type: 'SPAWN',
        unitType: 'SOLDIER',
        tileId: '5,4',
        cost: 0,
        goldCost: 50,
        deadUnitId: 'p1_ace'
    });
    const respawned = useGameStore.getState().units.find(u => u.id === 'p1_ace')!;
    assert.equal(respawned.rank, 0);
    assert.equal(respawned.xp, 0);
    assert.equal(respawned.maxHp, UNIT_STATS.SOLDIER.hp);
    assert.equal(respawned.hp, UNIT_STATS.SOLDIER.hp);
    assert.equal(respawned.maxAmmo, UNIT_STATS.SOLDIER.maxAmmo);

    useGameStore.getState().resetGame();
});

test('Scorecard Grading: S-Rank speed/preservation, MVP pick, and EASY AI S-cap', () => {
    const unit: Unit = {
        id: 'mvp_s',
        type: 'SNIPER',
        tileId: '1,1',
        hp: 12,
        maxHp: 12,
        ammo: 4,
        maxAmmo: 4,
        xp: 6,
        rank: 2,
        kills: 3,
        damageDealt: 62,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const stats = {
        0: { kills: 3, unitsLost: 0, damageDealt: 62, heists: 1, buildingsSecured: 2, acesPromoted: 0 },
        1: { kills: 0, unitsLost: 3, damageDealt: 10, heists: 0, buildingsSecured: 0, acesPromoted: 0 }
    };

    const hardSummary = calculateMatchScorecard({
        winner: 0,
        rounds: 14,
        victoryMode: 'CONQUER',
        gameMode: 'PVE',
        aiDifficulty: 'HARD',
        seed: 'SGRADE',
        playerStats: stats,
        playerRespawns: { 0: 0, 1: 0 },
        units: [unit]
    });
    assert.equal(hardSummary.grade, 'S');
    assert.equal(hardSummary.mvp?.unitId, 'mvp_s');

    const easySummary = calculateMatchScorecard({
        winner: 0,
        rounds: 14,
        victoryMode: 'CONQUER',
        gameMode: 'PVE',
        aiDifficulty: 'EASY',
        seed: 'SGRADE',
        playerStats: stats,
        playerRespawns: { 0: 0, 1: 0 },
        units: [unit]
    });
    assert.equal(easySummary.score <= 88, true);
    assert.notEqual(easySummary.grade, 'S');
});

test('Overwatch Rules: Stance terrain gates, damage/CP caps, Barrier & Weather blocking', () => {
    const map = makeGrid(10);
    const sniperOnPlains: Unit = {
        id: 'ow_sn',
        type: 'SNIPER',
        tileId: '1,1',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 1,
        hasMoved: false,
        completed: false
    };
    assert.equal(canUnitEnterOverwatch(sniperOnPlains, map[11], 20), false);
    map[11].type = 'MOUNTAIN';
    map[11].height = 2;
    assert.equal(canUnitEnterOverwatch(sniperOnPlains, map[11], 5), false);
    assert.equal(canUnitEnterOverwatch(sniperOnPlains, map[11], 6), true);

    // Barrier blocks Overwatch LOS and coverage tiles
    const owScout: Unit = {
        id: 'ow_sc',
        type: 'SOLDIER',
        tileId: '1,1',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 1,
        hasMoved: false,
        completed: false
    };
    map[11].type = 'PLAINS';
    map[11].height = 1;
    map[1 * 10 + 2].type = 'BARRIER';
    assert.equal(hasOverwatchLineOfSight(map[11], map[1 * 10 + 3], map, 'SOLDIER', clearWeather, 10), false);
    const coverage = getOverwatchCoverageTiles(owScout, map, clearWeather, 10);
    assert.equal(coverage.has('3,1'), false);
    assert.equal(coverage.has('1,2'), true);

    // Fog (>2) and Sandstorm (>3) block Overwatch lines symmetrically
    const fogWeather: WeatherState = { playerZones: { 0: 'FOG', 1: 'CLEAR' }, turnsRemaining: 5 };
    map[1 * 10 + 2].type = 'PLAINS';
    assert.equal(hasOverwatchLineOfSight(map[11], map[1 * 10 + 3], map, 'SNIPER', fogWeather, 10), true); // dist 2
    assert.equal(hasOverwatchLineOfSight(map[11], map[1 * 10 + 4], map, 'SNIPER', fogWeather, 10), false); // dist 3 > 2 in FOG

    const stormWeather: WeatherState = { playerZones: { 0: 'SANDSTORM', 1: 'CLEAR' }, turnsRemaining: 5 };
    assert.equal(hasOverwatchLineOfSight(map[11], map[1 * 10 + 4], map, 'ASSAULTER', stormWeather, 10), true); // dist 3
    assert.equal(hasOverwatchLineOfSight(map[11], map[1 * 10 + 5], map, 'ASSAULTER', stormWeather, 10), false); // dist 4 > 3 in SANDSTORM

    // Overwatch damage <= active shot damage
    const outcome = calculateOverwatchOutcome(owScout, map[11], map[1 * 10 + 2], 0);
    assert.equal(outcome.damage, OVERWATCH_STATS.SOLDIER.damage);
});

test('Store Overwatch Mechanics: Step interception, walked CP, collision step-back, Elite Breacher pin-resist, Suppression & 50% Refund', () => {
    const map = makeGrid(8);
    map[0].type = 'BASE'; map[0].owner = 0; map[0].hp = 50;
    map[63].type = 'BASE'; map[63].owner = 1; map[63].hp = 50;

    const p0Runner: Unit = {
        id: 'p0_run',
        type: 'SOLDIER',
        tileId: '0,2',
        hp: 15,
        maxHp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const p1WatcherA: Unit = {
        id: 'p1_wa',
        type: 'SOLDIER',
        tileId: '2,0',
        hp: 15,
        maxHp: 15,
        ammo: 10,
        maxAmmo: 10,
        xp: 0,
        rank: 0,
        owner: 1,
        hasMoved: false,
        completed: true,
        isOverwatching: true
    };
    const p1WatcherB: Unit = {
        id: 'p1_wb',
        type: 'SOLDIER',
        tileId: '3,0',
        hp: 15,
        maxHp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 1,
        hasMoved: false,
        completed: true,
        isOverwatching: true
    };

    useGameStore.setState({
        currentScreen: 'GAME',
        mapData: map,
        gridSize: 8,
        units: [p0Runner, p1WatcherA, p1WatcherB],
        graveyard: [],
        currentPlayer: 0,
        totalTurns: 0,
        turnCounter: 0,
        isAiTurn: false,
        winner: null,
        activeSeed: 'OWTEST',
        bankRewardPending: null,
        playerCp: { 0: 15, 1: 15 },
        playerGold: { 0: 150, 1: 150 },
        playerRespawns: { 0: 0, 1: 0 },
        playerStatus: { 0: 'ACTIVE', 1: 'ACTIVE' },
        playerInventory: { 0: [], 1: [] },
        weather: clearWeather,
        settings: {
            playerCount: 2,
            unitCounts: { SOLDIER: 1, ASSAULTER: 0, SNIPER: 0 },
            dynamicWeather: false,
            fogOfWar: false,
            doomsdayEnabled: false,
            gameMode: 'PVP',
            victoryMode: 'CONQUER',
            aiDifficulty: 'HARD'
        },
        gameLog: [],
        matchSummary: null
    });

    // Move (0,2)->(4,2) cost 4: range-3 watcher at (2,0) sees (1,2) at dist 3 -> pins at (1,2), costs only 1 CP, max 1 shot fires!
    useGameStore.getState().executeAiAction({ type: 'MOVE', unitId: 'p0_run', targetTileId: '4,2', cost: 4 });
    let st = useGameStore.getState();
    const runnerAfter = st.units.find(u => u.id === 'p0_run')!;
    const watcherAAfter = st.units.find(u => u.id === 'p1_wa')!;
    const watcherBAfter = st.units.find(u => u.id === 'p1_wb')!;
    assert.equal(runnerAfter.tileId, '1,2');
    assert.equal(runnerAfter.hp, 15 - OVERWATCH_STATS.SOLDIER.damage);
    assert.equal(st.playerCp[0], 14); // Deducted only 1 CP walked to (1,2), NOT 4 CP!
    assert.equal(watcherAAfter.isOverwatching, false);
    assert.equal(watcherAAfter.xp, 1);
    assert.equal(watcherAAfter.ammo, 9);
    // Second Overwatcher did NOT also shoot on the same MOVE
    assert.equal(watcherBAfter.isOverwatching, true);
    assert.equal(watcherBAfter.ammo, 10);

    // Friendly collision step-back safety: if ally stands on (2,2), moving (1,2)->(3,2) intercepted at (2,2) pins back on (1,2)
    const p0Ally: Unit = {
        id: 'p0_ally',
        type: 'SOLDIER',
        tileId: '2,2',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 0,
        hasMoved: false,
        completed: true
    };
    useGameStore.setState({
        units: [
            { ...runnerAfter, hp: 15, hasMoved: false, completed: false },
            p0Ally,
            { ...watcherBAfter, ammo: 10, isOverwatching: true }
        ],
        playerCp: { 0: 15, 1: 15 }
    });
    const previewRes = resolveMoveWithOverwatch({
        movingUnit: useGameStore.getState().units[0],
        targetTileId: '3,2',
        mapData: map,
        units: useGameStore.getState().units,
        weather: clearWeather,
        gridSize: 8,
        fogOfWar: false,
        maxBudget: 15
    });
    assert.equal(previewRes.trigger?.interceptTile.id, '2,2');
    assert.equal(previewRes.finalTile?.id, '1,2');
    assert.equal(previewRes.actualCost, 0);

    // Elite Breacher (Rank 2) resists pinning and finishes full move
    const p0EliteBreacher: Unit = {
        id: 'p0_eb',
        type: 'ASSAULTER',
        tileId: '1,2',
        hp: 36,
        maxHp: 36,
        ammo: 8,
        maxAmmo: 8,
        xp: 5,
        rank: 2,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    useGameStore.setState({
        units: [p0EliteBreacher, { ...watcherBAfter, ammo: 10, isOverwatching: true }],
        playerCp: { 0: 15, 1: 15 }
    });
    useGameStore.getState().executeAiAction({ type: 'MOVE', unitId: 'p0_eb', targetTileId: '3,2', cost: 4 });
    st = useGameStore.getState();
    const ebAfter = st.units.find(u => u.id === 'p0_eb')!;
    assert.equal(ebAfter.tileId, '3,2');
    assert.equal(ebAfter.hp, 36 - OVERWATCH_STATS.SOLDIER.damage);
    assert.equal(st.playerCp[0], 11);

    // Suppression counterplay & 50% CP refund clamped to MAX_CP=20
    const p1SniperOw: Unit = {
        id: 'p1_snow',
        type: 'SNIPER',
        tileId: '4,2',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 1,
        hasMoved: false,
        completed: true,
        isOverwatching: true
    };
    useGameStore.setState({
        units: [
            { ...ebAfter, hasMoved: true, completed: false },
            p1SniperOw
        ],
        currentPlayer: 0,
        playerCp: { 0: 10, 1: 12 }
    });
    useGameStore.getState().executeAiAction({ type: 'ATTACK', attackerId: 'p0_eb', targetUnitId: 'p1_snow', cost: 5 });
    // P1 Sniper survived with 10 - 10? Wait, Breacher deals 10 on PLAINS -> Sniper 10 HP dies unless HP 12 (Rank 1)
    assert.equal(useGameStore.getState().units.some(u => u.id === 'p1_snow'), false);

    // Non-lethal hit suppresses Overwatch, and unfired Overwatch refunds +3 CP capped at 20 CP
    const p1HealthyOw: Unit = {
        id: 'p1_how',
        type: 'SNIPER',
        tileId: '4,2',
        hp: 14,
        maxHp: 14,
        ammo: 4,
        maxAmmo: 4,
        xp: 9,
        rank: 3,
        owner: 1,
        hasMoved: false,
        completed: true,
        isOverwatching: true
    };
    const p0Scoot: Unit = {
        id: 'p0_scoot',
        type: 'SOLDIER',
        tileId: '3,2',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const p1UnfiredOw: Unit = {
        id: 'p1_unfired',
        type: 'SNIPER',
        tileId: '7,6',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 1,
        hasMoved: false,
        completed: true,
        isOverwatching: true
    };
    useGameStore.setState({
        units: [p0Scoot, p1HealthyOw, p1UnfiredOw],
        currentPlayer: 0,
        playerCp: { 0: 10, 1: 9 }
    });
    useGameStore.getState().executeAiAction({ type: 'ATTACK', attackerId: 'p0_scoot', targetUnitId: 'p1_how', cost: 3 });
    assert.equal(useGameStore.getState().units.find(u => u.id === 'p1_how')?.isOverwatching, false);

    // End turn P0 -> P1: unfired Sniper Overwatch refunds +3 CP (9 + 10 regen + 3 = 22 -> clamped to MAX_CP 20)
    useGameStore.getState().endTurn();
    st = useGameStore.getState();
    assert.equal(st.currentPlayer, 1);
    assert.equal(st.playerCp[1], CP_SYSTEM.MAX_CP);
    assert.equal(st.units.find(u => u.id === 'p1_unfired')?.isOverwatching, false);
    useGameStore.getState().resetGame();
});

test('AI Overwatch & Fog Stealth: Fog prevents blind ambush and AI prioritizes Suppress', () => {
    const map = makeGrid(8);
    // Mountain between (1,3) and (5,3) blocks Fog vision to (5,3)
    map[3 * 8 + 3].type = 'MOUNTAIN';
    map[3 * 8 + 3].height = 2;

    const p0Mover: Unit = {
        id: 'm_fog',
        type: 'SOLDIER',
        tileId: '5,2',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const p1Watcher: Unit = {
        id: 'w_fog',
        type: 'SNIPER',
        tileId: '1,3',
        hp: 10,
        ammo: 3,
        maxAmmo: 3,
        owner: 1,
        hasMoved: false,
        completed: true,
        isOverwatching: true
    };
    map[3 * 8 + 1].type = 'MOUNTAIN';
    map[3 * 8 + 1].height = 2;

    // P1 Sniper at (1,3) vision radius is 5, so distance to (5,3) is 4, and height 2 sees (5,3),
    // but let's place Sniper at (0,0) and put wall/range test at (0,4) where (6,4) is outside vision radius 5!
    p1Watcher.tileId = '0,4';
    map[3 * 8 + 1].type = 'PLAINS';
    map[3 * 8 + 1].height = 1;
    map[4 * 8 + 0].type = 'MOUNTAIN';
    map[4 * 8 + 0].height = 2;
    p0Mover.tileId = '6,4'; // dist 6 from (0,4) -> within Sniper range 7, OUTSIDE Sniper vision 5!

    const res = resolveMoveWithOverwatch({
        movingUnit: p0Mover,
        targetTileId: '6,3', // dist 7 -> within range 7, outside vision 5!
        mapData: map,
        units: [p0Mover, p1Watcher],
        weather: clearWeather,
        gridSize: 8,
        fogOfWar: true,
        maxBudget: 15
    });
    assert.equal(res.trigger, null); // Unseen in Fog -> no ambush!

    // Target priority prefers overwatching enemy (+35) over identical idle enemy
    const p0Attacker: Unit = {
        id: 'a_sup',
        type: 'ASSAULTER',
        tileId: '2,2',
        hp: 30,
        ammo: 6,
        maxAmmo: 6,
        owner: 0,
        hasMoved: false,
        completed: false
    };
    const eIdle: Unit = {
        id: 'e_idle',
        type: 'SOLDIER',
        tileId: '2,3',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 1,
        hasMoved: false,
        completed: false,
        isOverwatching: false
    };
    const eOw: Unit = {
        id: 'e_ow',
        type: 'SOLDIER',
        tileId: '3,2',
        hp: 15,
        ammo: 10,
        maxAmmo: 10,
        owner: 1,
        hasMoved: false,
        completed: false,
        isOverwatching: true
    };
    const bestTarget = findBestTarget(p0Attacker, [p0Attacker, eIdle, eOw], map, 'HARD', clearWeather, 8);
    assert.equal(bestTarget?.unit.id, 'e_ow');
});

test('Mutators: Blitz CP, Scarcity ammo & bank payouts, and Ironman zero respawns', () => {
    const blitz = { blitzCp: true, scarcity: false, ironman: false };
    const cpRules = getEffectiveCpRules(blitz);
    assert.equal(cpRules.maxCp, MUTATOR_CONFIG.BLITZ_CP.MAX_CP);
    assert.equal(cpRules.regenAmount, MUTATOR_CONFIG.BLITZ_CP.REGEN_AMOUNT);
    assert.equal(cpRules.p1Round1Cp, MUTATOR_CONFIG.BLITZ_CP.P1_ROUND1_CP);

    const scarcity = { blitzCp: false, scarcity: true, ironman: false };
    assert.equal(getEffectiveUnitAmmo('SOLDIER', scarcity), 5);
    assert.equal(getEffectiveUnitAmmo('ASSAULTER', scarcity), 3);
    assert.equal(getEffectiveUnitAmmo('SNIPER', scarcity), 2);
    const bankRewards = getEffectiveBankRewards(undefined, scarcity);
    assert.equal(bankRewards.gold, 300);
    assert.equal(bankRewards.cp, 15);

    const ironman = { blitzCp: false, scarcity: false, ironman: true };
    assert.equal(getEffectiveMaxRespawns(ironman), 0);

    // Start random match with all 3 mutators enabled cleanly
    const store = useGameStore.getState();
    store.setGameSettings({
        playerCount: 2,
        gameMode: 'PVP',
        victoryMode: 'DEATHMATCH',
        unitCounts: { SOLDIER: 1, ASSAULTER: 1, SNIPER: 1 },
        mapSeed: 'MUT888',
        mutators: { blitzCp: true, scarcity: true, ironman: true }
    });
    store.startGame();
    let st = useGameStore.getState();
    assert.equal(st.playerCp[0], 22);
    assert.equal(st.playerCp[1], 30);
    assert.equal(st.units.find(u => u.owner === 0 && u.type === 'SNIPER')?.maxAmmo, 2);

    // Spend P0 CP to 2, pass P0->P1->P0 -> P0 regens +15 CP (to 17), clamped <= 30
    useGameStore.setState({ playerCp: { 0: 2, 1: 10 } });
    useGameStore.getState().endTurn();
    useGameStore.getState().endTurn();
    st = useGameStore.getState();
    assert.equal(st.playerCp[0], 17);

    // Ironman blocks AI checkSpawn even with ready graveyard units and gold
    const gMap = makeGrid(6);
    gMap[0].type = 'BASE'; gMap[0].owner = 0;
    gMap[35].type = 'BASE'; gMap[35].owner = 1;
    const ironAction = getBestAIAction({
        mapData: gMap,
        units: [{ id: 'a0', type: 'SOLDIER', tileId: '1,1', hp: 15, ammo: 5, maxAmmo: 5, owner: 0, hasMoved: false, completed: false }],
        currentPlayer: 1,
        playerCp: 20,
        playerGold: 500,
        playerRespawns: 0,
        playerInventory: [],
        weather: clearWeather,
        difficulty: 'HARD',
        graveyard: [{ id: 'dead_i', type: 'SOLDIER', owner: 1, turnsUntilRespawn: 0 }],
        victoryMode: 'DEATHMATCH',
        gridSize: 6,
        settings: {
            playerCount: 2,
            unitCounts: { SOLDIER: 1, ASSAULTER: 0, SNIPER: 0 },
            dynamicWeather: false,
            fogOfWar: false,
            doomsdayEnabled: false,
            gameMode: 'PVE',
            victoryMode: 'DEATHMATCH',
            aiDifficulty: 'HARD',
            mutators: { blitzCp: false, scarcity: false, ironman: true }
        },
        totalTurns: 1
    });
    assert.notEqual(ironAction.type, 'SPAWN');
    useGameStore.getState().resetGame();
});

test('Challenge Ops: All 5 missions initialize validly and trigger surviveTurns, requiredHeists, turnLimit, & targetKillType', () => {
    assert.equal(CHALLENGE_OPERATIONS.length, 5);

    for (const op of CHALLENGE_OPERATIONS) {
        useGameStore.getState().startChallenge(op.id);
        const st = useGameStore.getState();
        assert.equal(st.activeMission?.id, op.id);
        assert.equal(st.gridSize, op.gridSize);
        const coordSet = new Set<string>();
        for (const u of st.units) {
            assert.equal(coordSet.has(u.tileId), false, `Duplicate spawn coord in ${op.id}: ${u.tileId}`);
            coordSet.add(u.tileId);
            const tile = st.mapData.find(t => t.id === u.tileId)!;
            assert.equal(Boolean(tile), true);
            assert.equal(TERRAIN_COSTS[tile.type] < 90 && tile.type !== 'QUICKSAND' && tile.hazardState !== 'LAVA', true, `Invalid spawn tile ${tile.type} in ${op.id}`);
        }
    }

    // 1. Doomsday Meltdown starts at Round 30 (totalTurns 29) with Ring 0 in WARNING -> LAVA next turn
    useGameStore.getState().startChallenge('doomsday_meltdown');
    let st = useGameStore.getState();
    assert.equal(st.totalTurns, 29);
    assert.equal(st.playerCp[0], 22);
    assert.equal(st.mapData.find(t => t.id === '0,0')?.hazardState, 'WARNING');
    useGameStore.getState().endTurn();
    useGameStore.getState().endTurn();
    assert.equal(useGameStore.getState().mapData.find(t => t.id === '0,0')?.hazardState, 'LAVA');

    // 2. surviveTurns (Iron Bridge Holdout): surviving round 8 triggers P0 S-medal win
    useGameStore.getState().startChallenge('iron_bridge_holdout');
    useGameStore.setState({ totalTurns: 7, currentPlayer: 1, isAiTurn: false });
    useGameStore.getState().endTurn(); // increments totalTurns -> 8 and returns to P0
    st = useGameStore.getState();
    assert.equal(st.winner, 0);
    assert.equal(st.matchSummary?.challengeId, 'iron_bridge_holdout');
    assert.equal(st.matchSummary?.challengeMedal, 'S');

    // 3. requiredHeists (Vault Zero Fog Heist): 2nd Heist wins immediately without blocking on Bank modal
    useGameStore.getState().startChallenge('vault_zero_fog_heist');
    st = useGameStore.getState();
    const p0Unit = st.units.find(u => u.owner === 0)!;
    useGameStore.setState({
        units: st.units.map(u => u.id === p0Unit.id ? { ...u, tileId: '7,4' } : u),
        matchStats: {
            0: { kills: 0, unitsLost: 0, damageDealt: 0, heists: 1, buildingsSecured: 0, acesPromoted: 0 },
            1: { kills: 0, unitsLost: 0, damageDealt: 0, heists: 0, buildingsSecured: 0, acesPromoted: 0 }
        },
        playerCp: { 0: 15, 1: 20 }
    });
    useGameStore.getState().executeAiAction({ type: 'HEIST', unitId: p0Unit.id, tileId: '7,4', cost: 4 });
    st = useGameStore.getState();
    assert.equal(st.winner, 0);
    assert.equal(st.bankRewardPending, null);

    // 4. turnLimit expiration fails Challenge
    useGameStore.getState().startChallenge('red_dunes_duel');
    useGameStore.setState({ totalTurns: 13, currentPlayer: 1, isAiTurn: false });
    useGameStore.getState().endTurn();
    assert.equal(useGameStore.getState().winner, 1);

    // 5. targetKillType (Ace Hunt): killing both P1 Aces triggers immediate win even if Escorts survive
    useGameStore.getState().startChallenge('ace_hunt');
    st = useGameStore.getState();
    const aceVictim = st.units.filter(u => u.owner === 1 && (u.rank ?? 0) >= 3);
    assert.equal(aceVictim.length, 2);
    const p0Killer = st.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!;
    const survivingAce = aceVictim[0];
    // Leave only 1 Ace alive at 1 HP next to p0Killer, plus non-Ace escorts
    useGameStore.setState({
        units: [
            p0Killer,
            { ...survivingAce, tileId: '4,6', hp: 1 },
            ...st.units.filter(u => u.owner === 1 && (u.rank ?? 0) < 3)
        ],
        playerCp: { 0: 15, 1: 20 }
    });
    useGameStore.getState().executeAiAction({
        type: 'ATTACK',
        attackerId: p0Killer.id,
        targetUnitId: survivingAce.id,
        cost: 5
    });
    st = useGameStore.getState();
    assert.equal(st.winner, 0);
    assert.equal(st.matchSummary?.challengeId, 'ace_hunt');
    assert.equal(st.matchSummary?.challengeMedal, 'S');
    useGameStore.getState().resetGame();
});

test('UX & tactical flow: local non-fog move undo, smart attack blocker feedback, and targeted shop drop', () => {
    useGameStore.getState().setGameSettings({
        playerCount: 2,
        gameMode: 'PVP',
        fogOfWar: false,
        mapSeed: 'UXTEST1',
    });
    useGameStore.getState().startGame();
    let st = useGameStore.getState();

    // Force open PLAINS board near P0 unit for deterministic move/undo + attack blocker test
    const openMap = st.mapData.map(t => ({
        ...t,
        type: t.type === 'BASE' ? ('BASE' as const) : ('PLAINS' as const),
        hazardState: undefined,
        owner: t.type === 'BASE' ? t.owner : undefined,
    }));
    const clearWeather = { ...st.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } };
    const p0Unit = st.units.find(u => u.owner === 0)!;
    const p1Enemy = st.units.find(u => u.owner === 1)!;
    const farEnemy = { ...p1Enemy, tileId: '10,10', hp: 15 };
    const heroUnit = { ...p0Unit, tileId: '2,2', hasMoved: false, completed: false };

    useGameStore.setState({
        mapData: openMap,
        weather: clearWeather,
        units: [heroUnit, farEnemy],
        currentPlayer: 0,
        isAiTurn: false,
        playerCp: { 0: 20, 1: 20 },
        playerGold: { 0: 300, 1: 300 },
        lastMoveSnapshot: null,
        mapFeedback: null,
    });

    // 1. Clicking out-of-range enemy keeps selection and raises tactical blocker feedback
    useGameStore.getState().handleTileClick(2, 2);
    assert.equal(useGameStore.getState().selectedUnitId, heroUnit.id);
    useGameStore.getState().handleTileClick(10, 10);
    st = useGameStore.getState();
    assert.equal(st.selectedUnitId, heroUnit.id, 'blocker preserves active unit selection');
    assert.ok(st.mapFeedback?.text.includes('Out of range'), `expected Out of range blocker, got: ${st.mapFeedback?.text}`);

    // 2. Non-fog local move can be undone once, restoring tile & CP
    const cpBefore = st.playerCp[0];
    useGameStore.getState().handleTileClick(3, 2);
    st = useGameStore.getState();
    const movedHero = st.units.find(u => u.id === heroUnit.id)!;
    assert.equal(movedHero.tileId, '3,2');
    assert.ok(st.playerCp[0] < cpBefore);
    assert.ok(st.lastMoveSnapshot !== null);

    // Clicking walkable empty ground after moving explains unit already moved & keeps selection on 1st click
    useGameStore.getState().handleTileClick(3, 2);
    useGameStore.getState().handleTileClick(4, 2);
    st = useGameStore.getState();
    assert.ok(st.mapFeedback?.text.includes('already moved'), `expected moved blocker, got: ${st.mapFeedback?.text}`);

    // Clicking a completed unit or attacking with it raises clear Done feedback
    useGameStore.setState({
        units: st.units.map(u => u.id === heroUnit.id ? { ...u, completed: true } : u),
        selectedUnitId: heroUnit.id,
        selectedTileId: movedHero.tileId,
        mapFeedback: null,
    });
    useGameStore.getState().handleTileClick(10, 10);
    assert.ok(useGameStore.getState().mapFeedback?.text.includes('Already acted'));

    useGameStore.getState().undoLastMove();
    st = useGameStore.getState();
    assert.equal(st.units.find(u => u.id === heroUnit.id)?.tileId, '2,2');
    assert.equal(st.playerCp[0], cpBefore);
    assert.equal(st.lastMoveSnapshot, null);

    // Undo is blocked under Fog of War
    useGameStore.setState(prev => ({
        settings: { ...prev.settings, fogOfWar: true },
    }));
    useGameStore.getState().handleTileClick(2, 2);
    useGameStore.getState().handleTileClick(3, 2);
    st = useGameStore.getState();
    assert.equal(st.lastMoveSnapshot, null, 'fog move must not record undo snapshot');
    useGameStore.setState(prev => ({
        settings: { ...prev.settings, fogOfWar: false },
    }));

    // 3. Supply Drops: Multiplayer (PVP) drops randomly right away; vs AI (PVE) enters targeted DROP selection
    useGameStore.getState().buyShopItem('AMMO_REFILL');
    st = useGameStore.getState();
    assert.equal(st.placementMode, null, 'PVP multiplayer should skip targeted DROP selection');
    assert.ok(st.pendingDrops.some(d => d.item === 'AMMO'));

    useGameStore.setState(prev => ({
        settings: { ...prev.settings, gameMode: 'PVE' },
        playerGold: { ...prev.playerGold, 0: 500 },
    }));
    useGameStore.getState().buyShopItem('FIRST_AID');
    st = useGameStore.getState();
    assert.equal(st.placementMode?.active, true);
    assert.equal(st.placementMode?.kind, 'DROP');
    const faChosenDrop = st.placementMode!.validTiles[0];
    const [fx, fy] = faChosenDrop.split(',').map(Number);
    useGameStore.getState().handleTileClick(fx, fy);
    st = useGameStore.getState();
    assert.equal(st.placementMode, null);
    assert.ok(st.pendingDrops.some(d => d.tileId === faChosenDrop && d.item === 'FIRST_AID'));

    useGameStore.getState().buyShopItem('MEDKIT');
    st = useGameStore.getState();
    assert.equal(st.placementMode?.active, true);
    assert.equal(st.placementMode?.kind, 'DROP');
    const chosenDrop = st.placementMode!.validTiles[0];
    const [dx, dy] = chosenDrop.split(',').map(Number);
    useGameStore.getState().handleTileClick(dx, dy);
    st = useGameStore.getState();
    assert.equal(st.placementMode, null);
    assert.ok(st.pendingDrops.some(d => d.tileId === chosenDrop && d.item === 'MEDKIT'));

    // 4. Barrier x3 (150€): 3 clicks with toggle unselect & auto-submit on 3rd tile; Land Mine (75€): HQ radius block feedback
    useGameStore.setState({ playerGold: { 0: 500, 1: 500 } });
    useGameStore.getState().buyShopItem('BARRIER');
    st = useGameStore.getState();
    assert.equal(st.placementMode?.requiredCount, 3);
    const bTiles = st.placementMode!.validTiles.slice(0, 4);
    const clickId = (id: string) => {
        const [bx, by] = id.split(',').map(Number);
        useGameStore.getState().handleTileClick(bx, by);
    };
    clickId(bTiles[0]);
    assert.deepEqual(useGameStore.getState().placementMode?.selectedTiles, [bTiles[0]]);
    clickId(bTiles[0]); // toggle off
    assert.deepEqual(useGameStore.getState().placementMode?.selectedTiles, []);
    clickId(bTiles[1]);
    clickId(bTiles[2]);
    clickId(bTiles[3]);
    st = useGameStore.getState();
    assert.equal(st.placementMode, null);
    assert.equal(st.playerGold[0], 350);
    assert.equal(st.mapData.find(t => t.id === bTiles[1])?.type, 'BARRIER');
    assert.equal(st.mapData.find(t => t.id === bTiles[2])?.type, 'BARRIER');
    assert.equal(st.mapData.find(t => t.id === bTiles[3])?.type, 'BARRIER');

    useGameStore.getState().buyShopItem('LAND_MINE');
    st = useGameStore.getState();
    assert.equal(st.placementMode?.itemKey, 'LAND_MINE');
    const enemyBase = st.mapData.find(t => t.type === 'BASE' && t.owner === 1)!;
    const blockedNearHq = st.mapData.find(
        t => t.type === 'PLAINS' && Math.max(Math.abs(t.x - enemyBase.x), Math.abs(t.y - enemyBase.y)) <= 5
    );
    if (blockedNearHq) {
        assert.equal(st.placementMode!.validTiles.includes(blockedNearHq.id), false);
        clickId(blockedNearHq.id);
        assert.ok(useGameStore.getState().mapFeedback?.text.includes('5 tiles of enemy HQ'));
    }
    const mineTarget = useGameStore.getState().placementMode!.validTiles[0];
    clickId(mineTarget);
    st = useGameStore.getState();
    assert.equal(st.placementMode, null);
    assert.equal(st.mines.some(m => m.tileId === mineTarget && m.owner === 0), true);
    assert.equal(st.playerGold[0], 275);

    useGameStore.getState().resetGame();
});

test('Map rotation helpers invert accurately across 0/90/180/270 and multiplayer updates preserve user rotation', () => {
    const boardSize = 20 * 64;
    const angles: BoardRotation[] = [0, 90, 180, 270];
    assert.equal(nextBoardRotation(0, 90), 90);
    assert.equal(nextBoardRotation(270, 90), 0);
    assert.equal(nextBoardRotation(0, -90), 270);

    for (const angle of angles) {
        const rot = rotateBoardPoint(96, 224, angle, boardSize);
        const back = unrotateBoardPoint(rot.x, rot.y, angle, boardSize);
        assert.equal(back.x, 96);
        assert.equal(back.y, 224);
    }

    assert.deepEqual(rotateBoardPoint(0, 0, 90, 1280), { x: 1280, y: 0 });
    assert.deepEqual(rotateBoardPoint(0, 0, 180, 1280), { x: 1280, y: 1280 });
    assert.deepEqual(rotateBoardPoint(0, 0, 270, 1280), { x: 0, y: 1280 });
    assert.deepEqual(rotateTileCoord(2, 5, 90, 20), { x: 14, y: 2 });
    assert.deepEqual(rotateTileCoord(2, 5, 180, 20), { x: 17, y: 14 });
    assert.deepEqual(rotateTileCoord(2, 5, 270, 20), { x: 5, y: 17 });

    useGameStore.getState().setMapRotation(0);
    useGameStore.getState().rotateMap(90);
    assert.equal(useGameStore.getState().mapRotation, 90);
    useGameStore.getState().rotateMap(90);
    assert.equal(useGameStore.getState().mapRotation, 180);

    // Online server views never reset a player's chosen camera angle
    const game = createGeneratedGame({ ...DEFAULT_GAME_SETTINGS, gameMode: 'PVP', mapSeed: 'ROTAT1' });
    assert.notEqual(
        computeTerrainSignature(game.mapData, game.gridSize, 0),
        computeTerrainSignature(game.mapData, game.gridSize, 180),
        'terrain signature must vary with rotation so upright terrain assets rebake'
    );
    const p2View = viewFor(game, 1);
    useGameStore.getState().applyServerView({
        code: 'ROOM01',
        status: 'playing',
        seats: [
            { name: 'P1', isBot: false, connected: true, isHost: true, autopilot: false },
            { name: 'P2', isBot: false, connected: true, isHost: false, autopilot: false },
        ],
        mySeat: 1,
        settings: DEFAULT_TABLE_SETTINGS,
        turnClock: null,
        game: p2View,
        events: [],
        seq: 1,
    });
    assert.equal(useGameStore.getState().mode, 'ONLINE');
    assert.equal(useGameStore.getState().mySeat, 1);
    assert.equal(useGameStore.getState().mapRotation, 180);

    useGameStore.getState().exitOnline();
    assert.equal(useGameStore.getState().mapRotation, 180);
    useGameStore.getState().setMapRotation(0);
});

test('setup map preview matches the exact battlefield deployed locally and supports seed reroll', () => {
    const seed = generateSectorSeed();
    const previewSettings = { ...DEFAULT_GAME_SETTINGS, playerCount: 3, mapSeed: seed };
    const preview = createGeneratedGame(previewSettings);

    useGameStore.getState().setGameSettings(previewSettings);
    useGameStore.getState().initializeMap();
    const deployed = useGameStore.getState();

    assert.equal(deployed.activeSeed, seed);
    assert.equal(deployed.gridSize, preview.gridSize);
    assert.equal(
        computeTerrainSignature(deployed.mapData, deployed.gridSize),
        computeTerrainSignature(preview.mapData, preview.gridSize),
    );
    assert.deepEqual(
        deployed.units.map(u => ({ tileId: u.tileId, owner: u.owner, type: u.type })),
        preview.units.map(u => ({ tileId: u.tileId, owner: u.owner, type: u.type })),
    );

    const reroll = createGeneratedGame({ ...previewSettings, mapSeed: `${seed}Z` });
    assert.notEqual(
        computeTerrainSignature(reroll.mapData, reroll.gridSize),
        computeTerrainSignature(preview.mapData, preview.gridSize),
        'Randomizing seed produces a distinct battlefield preview',
    );

    const presetPreview = createCustomMapGame(previewSettings, PRESET_MAPS[0].data);
    assert.ok(presetPreview.mapData.length > 0 && presetPreview.units.length > 0);
    const challengePreview = createChallengeGame(DEFAULT_GAME_SETTINGS, CHALLENGE_OPERATIONS[0].id);
    assert.ok(challengePreview && challengePreview.mapData.length > 0 && challengePreview.units.length > 0);

    // Inline map edits: move P0 base cleanly & add a Watchtower, diff patches, and confirm online/local parity
    const edited = cloneTiles(preview.mapData);
    const p0BaseIdx = edited.findIndex(t => t.type === 'BASE' && t.owner === 0);
    const dstIdx = edited.findIndex(t => t.type === 'PLAINS' && t.x >= 2 && t.y >= 2);
    assert.ok(p0BaseIdx >= 0 && dstIdx >= 0);
    const oldP0 = { ...edited[p0BaseIdx] };
    const oldDst = { ...edited[dstIdx] };
    edited[dstIdx] = { ...edited[dstIdx], type: 'BASE', owner: 0, height: 1 };
    edited[p0BaseIdx] = { ...edited[p0BaseIdx], type: oldDst.type, owner: undefined, height: oldDst.height };

    const towerIdx = edited.findIndex((t, i) => i !== p0BaseIdx && i !== dstIdx && t.type === 'PLAINS');
    assert.ok(towerIdx >= 0);
    edited[towerIdx] = { ...edited[towerIdx], type: 'BUILDING', subType: 'WATCHTOWER', height: 1 };

    const patches = diffMapTilePatches(preview.mapData, edited);
    assert.equal(patches.length, 3, 'diffMapTilePatches emits only modified tiles');
    const reapplied = applyMapTilePatches(preview.mapData, patches);
    assert.equal(reapplied[towerIdx].subType, 'WATCHTOWER');
    assert.equal(reapplied[dstIdx].type, 'BASE');
    assert.equal(reapplied[dstIdx].owner, 0);

    const onlineEdited = createOnlineTableGame({ ...DEFAULT_TABLE_SETTINGS, mapSeed: seed, mapEdits: patches }, 3);
    assert.equal(onlineEdited.mapData[towerIdx].subType, 'WATCHTOWER');
    assert.equal(onlineEdited.mapData[dstIdx].owner, 0, 'moved HQ preserves original owner');
    assert.ok(oldP0.id !== edited[dstIdx].id);

    // Guest suggestion merges cleanly on top of existing host edits
    const tableWithHostEdit = { ...DEFAULT_TABLE_SETTINGS, mapSeed: seed, mapEdits: patches };
    const bunkerTile = edited.find(
        t =>
            !(t.x === 0 && t.y === 1) &&
            !(t.x === 1 && t.y === 0) &&
            (t.x !== edited[towerIdx].x || t.y !== edited[towerIdx].y) &&
            t.type === 'PLAINS',
    )!;
    const merged = mergeOnlineMapEdits(tableWithHostEdit, 3, [
        { x: bunkerTile.x, y: bunkerTile.y, type: 'BUILDING', height: 1, subType: 'BUNKER' },
        { x: 0, y: 1, type: 'DUNES', height: 2 },
        { x: 1, y: 0, type: 'BRIDGE_V', height: 1 },
    ]);
    const finalOnline = createOnlineTableGame({ ...tableWithHostEdit, mapEdits: merged }, 3);
    assert.equal(finalOnline.mapData[towerIdx].subType, 'WATCHTOWER');
    assert.equal(finalOnline.mapData[bunkerTile.y * finalOnline.gridSize + bunkerTile.x].subType, 'BUNKER');
    assert.equal(finalOnline.mapData[finalOnline.gridSize].type, 'DUNES');
    assert.equal(finalOnline.mapData[1].type, 'BRIDGE_V');

    // Deleting an asset restores bare PLAINS cleanly without stale building subType
    const cleared = mergeOnlineMapEdits({ ...tableWithHostEdit, mapEdits: merged }, 3, [
        { x: bunkerTile.x, y: bunkerTile.y, type: 'PLAINS', height: 1 },
    ]);
    const clearedOnline = createOnlineTableGame({ ...tableWithHostEdit, mapEdits: cleared }, 3);
    const clearedTile = clearedOnline.mapData[bunkerTile.y * clearedOnline.gridSize + bunkerTile.x];
    assert.equal(clearedTile.type, 'PLAINS');
    assert.equal(clearedTile.subType, undefined);
});
