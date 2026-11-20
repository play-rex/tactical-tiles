
import { SavedMap, Tile } from '../types';
import { createSeededRng } from '../utils/SeededRandom';

// Helper to generate a deterministic grid for presets
const generateGrid = (size: number, type: 'CANYON' | 'DELTA'): Tile[] => {
    const rng = createSeededRng(type === 'CANYON' ? 'DUSTBOWL' : 'RIVERDELTA');
    const tiles: Tile[] = [];
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            tiles.push({ 
                id: `${x},${y}`, x, y, 
                type: 'PLAINS', height: 1, loot: null, hazardState: 'SAFE' 
            });
        }
    }
    
    // Add specific features
    if (type === 'CANYON') {
        tiles.forEach(t => {
            // Sand base with scattered dunes placed before canyon/bridges
            t.type = rng() < 0.1 ? 'DUNES' : 'SAND';
            t.height = t.type === 'DUNES' ? 2 : 1;

            // Canyon River down the center
            if (Math.abs(t.x - size / 2) < 2) {
                t.type = 'CANYON';
                t.height = 0;
            }

            // Bridges across the canyon
            if (t.type === 'CANYON' && (t.y === 5 || t.y === size - 5)) {
                t.type = 'BRIDGE';
                t.height = 1;
            }
        });

        // Contested structures for Dust Bowl
        const mid = Math.floor(size / 2);
        const setFeature = (x: number, y: number, fType: 'BANK' | 'BUILDING', subType?: 'WATCHTOWER' | 'BUNKER') => {
            const t = tiles[y * size + x];
            if (!t) return;
            t.type = fType;
            t.height = 1;
            if (fType === 'BANK') t.hackProgress = 0;
            if (subType) t.subType = subType;
        };
        setFeature(6, 5, 'BUILDING', 'WATCHTOWER');
        setFeature(size - 7, size - 5, 'BUILDING', 'WATCHTOWER');
        setFeature(6, size - 6, 'BUILDING', 'BUNKER');
        setFeature(size - 7, 5, 'BUILDING', 'BUNKER');
        setFeature(mid - 3, mid, 'BANK');
    }

    if (type === 'DELTA') {
        const mid = Math.floor(size / 2);
        tiles.forEach(t => {
            if (rng() < 0.15) t.type = 'FOREST';

            // Water Cross
            if (t.x === mid || t.y === mid) {
                t.type = 'WATER';
                t.height = 0;
            }

            // Central Island
            if (Math.abs(t.x - mid) <= 1 && Math.abs(t.y - mid) <= 1) {
                t.type = 'PLAINS';
                t.height = 1;
            }
        });

        // Bridges connecting all 4 quadrants
        const setBridge = (x: number, y: number, bridgeType: 'BRIDGE' | 'BRIDGE_V') => {
            const t = tiles[y * size + x];
            if (t) {
                t.type = bridgeType;
                t.height = 1;
            }
        };
        setBridge(mid, 5, 'BRIDGE');
        setBridge(mid, size - 6, 'BRIDGE');
        setBridge(5, mid, 'BRIDGE_V');
        setBridge(size - 6, mid, 'BRIDGE_V');

        // Contested Watchtowers & central Bank
        const setFeature = (x: number, y: number, fType: 'BANK' | 'BUILDING', subType?: 'WATCHTOWER' | 'BUNKER') => {
            const t = tiles[y * size + x];
            if (!t) return;
            t.type = fType;
            t.height = 1;
            if (fType === 'BANK') t.hackProgress = 0;
            if (subType) t.subType = subType;
        };
        setFeature(mid, mid, 'BANK');
        setFeature(mid - 3, mid - 3, 'BUILDING', 'WATCHTOWER');
        setFeature(mid + 3, mid + 3, 'BUILDING', 'WATCHTOWER');
        setFeature(mid + 3, mid - 3, 'BUILDING', 'BUNKER');
        setFeature(mid - 3, mid + 3, 'BUILDING', 'BUNKER');
    }

    // Add Bases last so random terrain never overwrites them
    const setBase = (x: number, y: number, owner: number) => {
        const t = tiles[y * size + x];
        if (t) { t.type = 'BASE'; t.owner = owner; t.height = 1; }
    };

    setBase(2, 2, 0);
    setBase(size-3, size-3, 1);
    if (size > 20) {
        setBase(size-3, 2, 2);
        setBase(2, size-3, 3);
    }

    return tiles;
};

export const PRESET_MAPS: SavedMap[] = [
    {
        id: 'campaign_canyon',
        name: 'Operation: Dust Bowl',
        author: 'Command',
        width: 20,
        height: 20,
        createdAt: 1700000000,
        isPreset: true,
        baseCount: 2,
        data: generateGrid(20, 'CANYON')
    },
    {
        id: 'campaign_delta',
        name: 'River Delta Skirmish',
        author: 'Command',
        width: 25,
        height: 25,
        createdAt: 1700000001,
        isPreset: true,
        baseCount: 4,
        data: generateGrid(25, 'DELTA')
    }
];
