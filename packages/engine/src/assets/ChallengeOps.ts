import { MissionConfig, TerrainType, Tile } from '../types';
import { BARRIER_STATS, BASE_STATS } from '../constants/Config';
import { updateDoomsdayState } from '../grid/DoomsdayManager';

const createChallengeGrid = (size: number, defaultTerrain: TerrainType = 'PLAINS'): Tile[] => {
    const tiles: Tile[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            tiles.push({
                id: `${x},${y}`,
                x,
                y,
                type: defaultTerrain,
                height: 1,
                zone: x < size / 2 ? 0 : 1,
                loot: null,
                hazardState: 'SAFE'
            });
        }
    }
    return tiles;
};

const paint = (
    grid: Tile[],
    size: number,
    x: number,
    y: number,
    patch: Partial<Tile> & { type?: TerrainType }
): void => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const t = grid[y * size + x];
    Object.assign(t, patch);

    if (patch.type && patch.height === undefined) {
        if (patch.type === 'MOUNTAIN' || patch.type === 'DUNES') t.height = 2;
        else if (patch.type === 'WATER' || patch.type === 'CANYON') t.height = 0;
        else t.height = 1;
    }

    if (patch.type === 'BARRIER') {
        t.hp = patch.hp ?? BARRIER_STATS.HP;
        t.maxHp = patch.maxHp ?? BARRIER_STATS.HP;
    }
    if (patch.type === 'BASE') {
        t.hp = patch.hp ?? BASE_STATS.HP;
        t.maxHp = patch.maxHp ?? BASE_STATS.HP;
    }
    if (patch.type === 'BANK') {
        t.hackProgress = patch.hackProgress ?? 0;
    }
};

export const CHALLENGE_OPERATIONS: MissionConfig[] = [
    {
        id: 'iron_bridge_holdout',
        title: 'Iron Bridge Holdout',
        subtitle: 'Survive 8 Rounds • Twin River Chokes',
        briefing:
            'Hold the western bank across twin river bridges against a 7-unit Ironman assault wave. Use Overwatch on bridge exits to pin advancing Breachers.',
        difficultyLabel: 'HARD',
        gridSize: 16,
        seed: 'CHALBRIDGE',
        settings: {
            playerCount: 2,
            gameMode: 'PVE',
            victoryMode: 'DEATHMATCH',
            aiDifficulty: 'HARD',
            fogOfWar: false,
            dynamicWeather: false,
            doomsdayEnabled: false,
            mutators: { blitzCp: false, scarcity: false, ironman: true }
        },
        surviveTurns: 8,
        parRounds: 8,
        startingCp: { 0: 16, 1: 20 },
        buildMap: () => {
            const size = 16;
            const g = createChallengeGrid(size, 'PLAINS');
            for (let y = 0; y < size; y++) {
                paint(g, size, 7, y, { type: 'WATER' });
                paint(g, size, 8, y, { type: 'WATER' });
            }
            for (const by of [4, 11]) {
                paint(g, size, 7, by, { type: 'BRIDGE' });
                paint(g, size, 8, by, { type: 'BRIDGE' });
                paint(g, size, 5, by, { type: 'ROAD' });
                paint(g, size, 6, by, { type: 'ROAD' });
                paint(g, size, 9, by, { type: 'ROAD' });
                paint(g, size, 10, by, { type: 'ROAD' });
            }
            paint(g, size, 5, 7, { type: 'BUILDING', subType: 'WATCHTOWER', owner: 0 });
            paint(g, size, 5, 3, { type: 'BUILDING', subType: 'BUNKER', owner: 0 });
            paint(g, size, 5, 12, { type: 'BUILDING', subType: 'BUNKER', owner: 0 });
            paint(g, size, 6, 5, { type: 'FOREST' });
            paint(g, size, 6, 10, { type: 'FOREST' });
            paint(g, size, 10, 5, { type: 'FOREST' });
            paint(g, size, 10, 10, { type: 'FOREST' });
            paint(g, size, 2, 7, { type: 'MOUNTAIN' });
            paint(g, size, 3, 4, { type: 'MOUNTAIN' });
            paint(g, size, 13, 7, { type: 'MOUNTAIN' });
            return g;
        },
        placements: [
            { type: 'SNIPER', x: 2, y: 7, owner: 0, rank: 1 },
            { type: 'ASSAULTER', x: 5, y: 4, owner: 0, rank: 1 },
            { type: 'ASSAULTER', x: 5, y: 11, owner: 0, rank: 1 },
            { type: 'SOLDIER', x: 4, y: 8, owner: 0, rank: 0 },
            { type: 'ASSAULTER', x: 10, y: 4, owner: 1 },
            { type: 'ASSAULTER', x: 10, y: 11, owner: 1 },
            { type: 'ASSAULTER', x: 12, y: 8, owner: 1 },
            { type: 'SOLDIER', x: 11, y: 3, owner: 1 },
            { type: 'SOLDIER', x: 11, y: 12, owner: 1 },
            { type: 'SOLDIER', x: 12, y: 5, owner: 1 },
            { type: 'SNIPER', x: 13, y: 7, owner: 1 }
        ]
    },
    {
        id: 'vault_zero_fog_heist',
        title: 'Vault Zero Fog Heist',
        subtitle: '2 Bank Heists in 12 Rounds • Fog of War',
        briefing:
            'Breach two guarded Vaults hidden inside deep Fog before Round 12 expires. Use your Elite Scout vision (+1) and deployable Barriers to block Overwatch traps.',
        difficultyLabel: 'HARD',
        gridSize: 16,
        seed: 'CHALVAULT',
        settings: {
            playerCount: 2,
            gameMode: 'PVE',
            victoryMode: 'DEATHMATCH',
            aiDifficulty: 'HARD',
            fogOfWar: true,
            dynamicWeather: false,
            doomsdayEnabled: false,
            mutators: { blitzCp: false, scarcity: false, ironman: true }
        },
        requiredHeists: 2,
        turnLimit: 12,
        parRounds: 8,
        startingGold: { 0: 200, 1: 150 },
        buildMap: () => {
            const size = 16;
            const g = createChallengeGrid(size, 'PLAINS');
            paint(g, size, 1, 7, { type: 'BASE', owner: 0 });
            paint(g, size, 7, 4, { type: 'BANK' });
            paint(g, size, 8, 11, { type: 'BANK' });
            paint(g, size, 6, 7, { type: 'BUILDING', subType: 'WATCHTOWER' });
            paint(g, size, 9, 8, { type: 'BUILDING', subType: 'BUNKER' });
            paint(g, size, 10, 7, { type: 'BUILDING', subType: 'WATCHTOWER', owner: 1 });
            paint(g, size, 5, 4, { type: 'BARRIER' });
            paint(g, size, 5, 11, { type: 'BARRIER' });
            for (const [fx, fy] of [[4, 3], [4, 5], [4, 10], [4, 12], [6, 2], [9, 5], [7, 9], [10, 11]]) {
                paint(g, size, fx, fy, { type: 'FOREST' });
            }
            paint(g, size, 6, 4, { type: 'DUNES' });
            paint(g, size, 7, 11, { type: 'DUNES' });
            return g;
        },
        placements: [
            { type: 'SOLDIER', x: 3, y: 7, owner: 0, rank: 2 },
            { type: 'SOLDIER', x: 2, y: 4, owner: 0, rank: 0 },
            { type: 'SOLDIER', x: 2, y: 11, owner: 0, rank: 0 },
            { type: 'ASSAULTER', x: 3, y: 8, owner: 0, rank: 1 },
            { type: 'ASSAULTER', x: 8, y: 4, owner: 1 },
            { type: 'ASSAULTER', x: 7, y: 11, owner: 1 },
            { type: 'SOLDIER', x: 9, y: 3, owner: 1 },
            { type: 'SOLDIER', x: 9, y: 12, owner: 1 },
            { type: 'SNIPER', x: 10, y: 7, owner: 1 }
        ]
    },
    {
        id: 'red_dunes_duel',
        title: 'Red Dunes Duel',
        subtitle: 'Conquer in 14 Rounds • Scarcity 50% Ammo',
        briefing:
            'Every bullet counts across shifting desert Dunes and Quicksand traps. With Scarcity cutting ammo in half, seize the high ground and central Vault (+300 Euros) to crack the 35 HP enemy HQ.',
        difficultyLabel: 'STANDARD',
        gridSize: 16,
        seed: 'CHALDUNES',
        settings: {
            playerCount: 2,
            gameMode: 'PVE',
            victoryMode: 'CONQUER',
            aiDifficulty: 'HARD',
            fogOfWar: false,
            dynamicWeather: false,
            doomsdayEnabled: false,
            mutators: { blitzCp: false, scarcity: true, ironman: false }
        },
        turnLimit: 14,
        parRounds: 10,
        buildMap: () => {
            const size = 16;
            const g = createChallengeGrid(size, 'SAND');
            paint(g, size, 1, 7, { type: 'BASE', owner: 0, hp: 35, maxHp: 35 });
            paint(g, size, 14, 8, { type: 'BASE', owner: 1, hp: 35, maxHp: 35 });
            paint(g, size, 7, 7, { type: 'BANK' });
            paint(g, size, 7, 8, { type: 'QUICKSAND' });
            paint(g, size, 8, 7, { type: 'QUICKSAND' });
            for (const cy of [2, 3, 4, 11, 12, 13]) {
                paint(g, size, 7, cy, { type: 'CANYON' });
                paint(g, size, 8, cy, { type: 'CANYON' });
            }
            for (const [dx, dy] of [[4, 5], [3, 10], [11, 5], [11, 10], [6, 6], [9, 9]]) {
                paint(g, size, dx, dy, { type: 'DUNES' });
            }
            for (let x = 2; x <= 13; x++) {
                if (x !== 7 && x !== 8) {
                    paint(g, size, x, 7, { type: 'PLAINS' });
                }
            }
            return g;
        },
        placements: [
            { type: 'SNIPER', x: 4, y: 5, owner: 0, rank: 1 },
            { type: 'SNIPER', x: 3, y: 10, owner: 0, rank: 1 },
            { type: 'SOLDIER', x: 3, y: 7, owner: 0 },
            { type: 'SOLDIER', x: 3, y: 8, owner: 0 },
            { type: 'ASSAULTER', x: 2, y: 7, owner: 0 },
            { type: 'SNIPER', x: 11, y: 5, owner: 1 },
            { type: 'SNIPER', x: 11, y: 10, owner: 1 },
            { type: 'ASSAULTER', x: 12, y: 7, owner: 1 },
            { type: 'ASSAULTER', x: 12, y: 9, owner: 1 },
            { type: 'SOLDIER', x: 12, y: 4, owner: 1 },
            { type: 'SOLDIER', x: 12, y: 11, owner: 1 }
        ]
    },
    {
        id: 'doomsday_meltdown',
        title: 'Doomsday Meltdown',
        subtitle: 'Collapsing Arena • Blitz CP & Ironman',
        briefing:
            'Drop straight into Round 30 as magma swallows the outer perimeter. Armed with Blitz CP (30 Max / +15 per turn), push through the shrinking central citadel and eliminate all hostiles.',
        difficultyLabel: 'EXTREME',
        gridSize: 16,
        seed: 'CHALDOOM',
        settings: {
            playerCount: 2,
            gameMode: 'PVE',
            victoryMode: 'DEATHMATCH',
            aiDifficulty: 'HARD',
            fogOfWar: false,
            dynamicWeather: false,
            doomsdayEnabled: true,
            mutators: { blitzCp: true, scarcity: false, ironman: true }
        },
        startingRound: 29,
        parRounds: 6,
        buildMap: () => {
            const size = 16;
            const g = createChallengeGrid(size, 'PLAINS');
            paint(g, size, 6, 7, { type: 'BUILDING', subType: 'BUNKER' });
            paint(g, size, 9, 8, { type: 'BUILDING', subType: 'BUNKER' });
            paint(g, size, 7, 9, { type: 'BUILDING', subType: 'WATCHTOWER' });
            paint(g, size, 8, 6, { type: 'BUILDING', subType: 'WATCHTOWER' });
            for (const [fx, fy] of [[5, 6], [5, 9], [10, 6], [10, 9], [7, 5], [8, 10]]) {
                paint(g, size, fx, fy, { type: 'FOREST' });
            }
            paint(g, size, 4, 4, { type: 'MOUNTAIN' });
            paint(g, size, 11, 11, { type: 'MOUNTAIN' });
            return updateDoomsdayState(g, 29, size);
        },
        placements: [
            { type: 'ASSAULTER', x: 3, y: 7, owner: 0, rank: 1 },
            { type: 'ASSAULTER', x: 3, y: 9, owner: 0 },
            { type: 'SOLDIER', x: 4, y: 6, owner: 0 },
            { type: 'SOLDIER', x: 4, y: 10, owner: 0 },
            { type: 'SNIPER', x: 4, y: 4, owner: 0 },
            { type: 'ASSAULTER', x: 12, y: 6, owner: 1 },
            { type: 'ASSAULTER', x: 12, y: 9, owner: 1 },
            { type: 'SOLDIER', x: 11, y: 5, owner: 1 },
            { type: 'SOLDIER', x: 11, y: 10, owner: 1 },
            { type: 'SOLDIER', x: 10, y: 7, owner: 1 },
            { type: 'SNIPER', x: 11, y: 11, owner: 1 }
        ]
    },
    {
        id: 'ace_hunt',
        title: 'Ace Hunt',
        subtitle: 'Assassinate Both ★★★ Aces in 12 Rounds',
        briefing:
            'Two veteran-hardened ★★★ Ace commanders lead the eastern fortress. Use Elite Breachers to break through Overwatch fire and eliminate both enemy Aces before Round 12.',
        difficultyLabel: 'EXTREME',
        gridSize: 16,
        seed: 'CHALACES',
        settings: {
            playerCount: 2,
            gameMode: 'PVE',
            victoryMode: 'DEATHMATCH',
            aiDifficulty: 'HARD',
            fogOfWar: false,
            dynamicWeather: false,
            doomsdayEnabled: false,
            mutators: { blitzCp: false, scarcity: false, ironman: true }
        },
        targetKillType: { owner: 1, minRank: 3 },
        turnLimit: 12,
        parRounds: 7,
        buildMap: () => {
            const size = 16;
            const g = createChallengeGrid(size, 'PLAINS');
            paint(g, size, 2, 7, { type: 'MOUNTAIN' });
            paint(g, size, 13, 7, { type: 'MOUNTAIN' });
            paint(g, size, 6, 5, { type: 'BUILDING', subType: 'WATCHTOWER', owner: 0 });
            paint(g, size, 11, 7, { type: 'BUILDING', subType: 'BUNKER', owner: 1 });
            paint(g, size, 7, 11, { type: 'BANK' });
            for (const by of [5, 6, 9, 10]) {
                paint(g, size, 10, by, { type: 'BARRIER' });
            }
            for (const [fx, fy] of [[5, 7], [6, 8], [8, 6], [8, 9], [9, 7], [12, 8]]) {
                paint(g, size, fx, fy, { type: 'FOREST' });
            }
            return g;
        },
        placements: [
            { type: 'ASSAULTER', x: 4, y: 7, owner: 0, rank: 2 },
            { type: 'ASSAULTER', x: 4, y: 8, owner: 0, rank: 2 },
            { type: 'SOLDIER', x: 3, y: 5, owner: 0, rank: 1 },
            { type: 'SOLDIER', x: 3, y: 10, owner: 0, rank: 1 },
            { type: 'SNIPER', x: 2, y: 7, owner: 0, rank: 2 },
            { type: 'SNIPER', x: 13, y: 7, owner: 1, rank: 3 },
            { type: 'ASSAULTER', x: 11, y: 7, owner: 1, rank: 3 },
            { type: 'ASSAULTER', x: 11, y: 10, owner: 1 },
            { type: 'SOLDIER', x: 10, y: 4, owner: 1 },
            { type: 'SOLDIER', x: 10, y: 11, owner: 1 }
        ]
    }
];

export const getChallengeById = (id: string | undefined): MissionConfig | undefined =>
    id ? CHALLENGE_OPERATIONS.find(c => c.id === id) : undefined;
