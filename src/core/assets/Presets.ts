
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

/** 25x25 Showcase Preset designed to highlight every Tactical Recon HD biome, road, bridge, peak, hazard & structure. */
const generateReconShowcaseMap = (): Tile[] => {
    const size = 25;
    const mid = 12;
    const rng = createSeededRng('RECON_SHOWCASE');
    const tiles: Tile[] = [];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            tiles.push({
                id: `${x},${y}`,
                x,
                y,
                type: 'PLAINS',
                height: 1,
                loot: null,
                hazardState: 'SAFE'
            });
        }
    }

    const setTile = (x: number, y: number, type: Tile['type'], extra: Partial<Tile> = {}) => {
        if (x < 0 || x >= size || y < 0 || y >= size) return;
        const t = tiles[y * size + x];
        if (!t) return;
        t.type = type;
        t.height = type === 'WATER' || type === 'CANYON' ? 0 : type === 'MOUNTAIN' || type === 'DUNES' ? 2 : 1;
        delete t.subType;
        delete t.owner;
        delete t.hackProgress;
        Object.assign(t, extra);
    };

    // 1. Southeast Desert Biome Sector (blends organically into temperate meadow)
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (x >= 13 && y >= 13) {
                setTile(x, y, rng() < 0.12 ? 'DUNES' : 'SAND');
            } else if (x < 11 && y < 11) {
                if (rng() < 0.24) setTile(x, y, 'FOREST');
            } else if (x > 13 && y < 11) {
                if (rng() < 0.18) setTile(x, y, 'FOREST');
            } else if (x < 11 && y > 13) {
                if (rng() < 0.15) setTile(x, y, 'FOREST');
            }
        }
    }

    // 2. Winding North-South River + West Tributary (smooth corner transitions, clear at bridge approaches)
    let prevRiverX = mid;
    for (let y = 0; y < size; y++) {
        const curveOffset = y < 8 ? Math.round(Math.sin(y * 0.6)) : y > 16 ? Math.round(Math.cos(y * 0.55)) : 0;
        const rx = mid + curveOffset;
        setTile(rx, y, 'WATER');
        // Fill corner bend so water riverbanks connect seamlessly without diagonal pinches
        if (rx !== prevRiverX && y !== 9 && y !== 15) {
            setTile(prevRiverX, y, 'WATER');
        }
        // Subtle widening away from bridge crossings
        if (y % 3 === 0 && ![4, 5, 6, 8, 9, 10, 14, 15, 16, 18, 19, 20].includes(y)) {
            setTile(rx - 1, y, 'WATER');
        }
        prevRiverX = rx;
    }
    for (let x = 0; x <= 9; x++) {
        setTile(x, mid, 'WATER');
        if (x >= 3 && x <= 7) setTile(x, mid - 1, 'WATER');
    }

    // 3. Eastern Desert Canyon Gorge
    for (let x = 15; x < size; x++) {
        setTile(x, mid, 'CANYON');
        if (x === 17 || x === 21) setTile(x, mid + 1, 'CANYON');
    }

    // 4. Central Contested Plaza Around Bank Vault
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            setTile(mid + dx, mid + dy, Math.abs(dx) === 2 || Math.abs(dy) === 2 ? 'SAND' : 'PLAINS');
        }
    }
    setTile(mid, mid, 'BANK', { hackProgress: 0 });
    setTile(mid, mid - 3, 'BRIDGE');
    setTile(mid, mid + 3, 'BRIDGE');
    setTile(mid - 3, mid, 'BRIDGE_V');
    setTile(mid + 3, mid, 'BRIDGE_V');

    // 5. Primary Crossing Steel Bridges
    setTile(mid + Math.round(Math.sin(5 * 0.6)), 5, 'BRIDGE');
    setTile(mid + Math.round(Math.cos(19 * 0.55)), 19, 'BRIDGE');
    setTile(5, mid, 'BRIDGE_V');
    setTile(5, mid - 1, 'BRIDGE_V');
    setTile(19, mid, 'BRIDGE_V');

    // 6. Auto-Connecting Tactical Highway Loops
    for (let x = 2; x <= 22; x++) {
        if (tiles[5 * size + x].type !== 'WATER' && tiles[5 * size + x].type !== 'BRIDGE') setTile(x, 5, 'ROAD_H');
        if (tiles[19 * size + x].type !== 'WATER' && tiles[19 * size + x].type !== 'BRIDGE') setTile(x, 19, 'ROAD_H');
    }
    for (let y = 2; y <= 22; y++) {
        const cLeft = tiles[y * size + 5].type;
        if (cLeft !== 'WATER' && cLeft !== 'BRIDGE_V') setTile(5, y, 'ROAD');
        const cRight = tiles[y * size + 19].type;
        if (cRight !== 'CANYON' && cRight !== 'BRIDGE_V') setTile(19, y, 'ROAD');
    }

    // 7. Granite Mountain Overlooks (High Ground for Snipers)
    const peaks: Array<[number, number]> = [
        [7, 3], [8, 3], [7, 7],
        [16, 3], [17, 3], [16, 7],
        [7, 16], [8, 16],
    ];
    peaks.forEach(([mx, my]) => setTile(mx, my, 'MOUNTAIN'));

    // 8. Quicksand Sinkholes & Tactical Barriers
    setTile(16, 16, 'QUICKSAND');
    setTile(20, 15, 'QUICKSAND');
    setTile(4, 9, 'BARRIER');
    setTile(20, 14, 'BARRIER');
    setTile(9, 20, 'BARRIER');
    setTile(15, 4, 'BARRIER');

    // 9. Watchtowers & Concrete Pillbox Bunkers
    setTile(9, 9, 'BUILDING', { subType: 'WATCHTOWER' });
    setTile(15, 15, 'BUILDING', { subType: 'WATCHTOWER' });
    setTile(15, 9, 'BUILDING', { subType: 'BUNKER' });
    setTile(9, 15, 'BUILDING', { subType: 'BUNKER' });

    // 10. Four Corner HQs with Clear Deployment Grounds
    const hqs: Array<[number, number, number]> = [
        [2, 2, 0],
        [22, 2, 2],
        [2, 22, 3],
        [22, 22, 1],
    ];
    hqs.forEach(([bx, by, owner]) => {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = bx + dx;
                const ny = by + dy;
                const cur = tiles[ny * size + nx]?.type;
                if (cur !== 'ROAD' && cur !== 'ROAD_H') {
                    setTile(nx, ny, bx > 12 && by > 12 ? 'SAND' : 'PLAINS');
                }
            }
        }
        setTile(bx, by, 'BASE', { owner });
    });

    return tiles;
};

export const PRESET_MAPS: SavedMap[] = [
    {
        id: 'campaign_recon',
        name: 'Tactical Recon: Iron Confluence',
        author: 'Command',
        width: 25,
        height: 25,
        createdAt: 1700000002,
        isPreset: true,
        baseCount: 4,
        data: generateReconShowcaseMap()
    },
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
