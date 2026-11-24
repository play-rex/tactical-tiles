/** Building a new game: generated maps, custom maps and challenge ops. */
import {
  BANK_STATS,
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
import { gameSettingsFor, type MapTilePatch, type TableSettings } from '../protocol';

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
    const dist = getManhattanDistance;
    const DIRS_4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const DIRS_8: ReadonlyArray<readonly [number, number]> = [
        [-1, -1], [0, -1], [1, -1],
        [-1, 0],           [1, 0],
        [-1, 1],  [0, 1],  [1, 1],
    ];

    const shuffle = <T,>(arr: T[]): T[] => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };

    type MapArchetype = 'RIVER_VALLEY' | 'FORKED_RIVER' | 'FRONTIER_RIVER' | 'CANYON_DIVIDE';
    const archRoll = rng();
    const archetype: MapArchetype =
        archRoll < 0.34 ? 'RIVER_VALLEY' :
        archRoll < 0.58 ? 'FORKED_RIVER' :
        archRoll < 0.80 ? 'FRONTIER_RIVER' :
        'CANYON_DIVIDE';

    const frontierPhase = rng() * Math.PI * 2;

    // 2. Choose symmetrical sector orientation (varied per seed so rivers alternate diagonals & angles naturally)
    const startAngle = numPlayers === 2
        ? (rng() < 0.5 ? -Math.PI / 4 : Math.PI / 4) + (rng() - 0.5) * 0.40
        : -Math.PI / 2 + (rng() < 0.5 ? 0 : Math.PI / 4);

    const baseGroundAt = (x: number, y: number): 'PLAINS' | 'SAND' => {
        if (archetype === 'CANYON_DIVIDE') return 'SAND';
        if (archetype === 'FRONTIER_RIVER') {
            // Split-biome theater aligned gently across the river divide so one flank is lush valley & the other golden frontier
            const axis = startAngle + Math.PI / 2;
            const proj = (x - centerX) * Math.cos(axis) + (y - centerY) * Math.sin(axis);
            const wave = Math.sin((x * 0.38 - y * 0.32) + frontierPhase) * 2.0;
            return proj + wave > 0.5 ? 'SAND' : 'PLAINS';
        }
        return 'PLAINS';
    };

    // 1. Paint base biome ground (PLAINS or SAND)
    for (const t of tiles) {
        t.type = baseGroundAt(t.x, t.y);
        t.height = 1;
    }

    // Helper: carve a 100% continuous organic winding river or canyon channel (zero diagonal gaps!)
    const carveChannel = (
        sx: number,
        sy: number,
        angle: number,
        maxDist: number,
        channelType: 'WATER' | 'CANYON',
        allowWide: boolean,
        initialLateral = 0,
    ) => {
        let prevX = Math.round(sx);
        let prevY = Math.round(sy);
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const px = -Math.sin(angle);
        const py = Math.cos(angle);
        const paint = (tx: number, ty: number) => {
            const t = getTile(tx, ty);
            if (t) {
                t.type = channelType;
                t.height = 0;
            }
        };
        paint(prevX, prevY);

        let walked = 0;
        let lateralOffset = initialLateral;
        while (walked < maxDist) {
            lateralOffset = Math.max(-2.6, Math.min(2.6, lateralOffset + (rng() - 0.5) * 0.92));
            const cx = sx + dx * (walked + 1) + px * lateralOffset;
            const cy = sy + dy * (walked + 1) + py * lateralOffset;
            const tx = Math.round(cx);
            const ty = Math.round(cy);

            // Step orthogonally from (prevX, prevY) -> (tx, ty) so the channel NEVER breaks into puddles!
            let bx = prevX;
            let by = prevY;
            let guard = 0;
            while ((bx !== tx || by !== ty) && guard < 8) {
                guard++;
                if (Math.abs(tx - bx) >= Math.abs(ty - by) && bx !== tx) {
                    bx += tx > bx ? 1 : -1;
                } else if (by !== ty) {
                    by += ty > by ? 1 : -1;
                }
                paint(bx, by);
            }
            prevX = tx;
            prevY = ty;

            // Occasional gentle 2-tile widening along straight stretches
            if (allowWide && rng() < 0.22) {
                paint(tx + Math.round(px), ty + Math.round(py));
            }
            walked += 1;
        }
    };

    // Helper: connect two points with a 1-tile continuous river/canyon bend (for braided river islands)
    const carveSegment = (x0: number, y0: number, x1: number, y1: number, channelType: 'WATER' | 'CANYON') => {
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        let prevX = x0;
        let prevY = y0;
        const paint = (tx: number, ty: number) => {
            const t = getTile(tx, ty);
            if (t) {
                t.type = channelType;
                t.height = 0;
            }
        };
        paint(prevX, prevY);
        for (let i = 1; i <= steps; i++) {
            const tx = Math.round(x0 + ((x1 - x0) * i) / steps);
            const ty = Math.round(y0 + ((y1 - y0) * i) / steps);
            while (prevX !== tx || prevY !== ty) {
                if (Math.abs(tx - prevX) >= Math.abs(ty - prevY) && prevX !== tx) {
                    prevX += tx > prevX ? 1 : -1;
                } else if (prevY !== ty) {
                    prevY += ty > prevY ? 1 : -1;
                }
                paint(prevX, prevY);
            }
        }
    };

    // 3. Sculpt macro flowing geography per Battlefield Archetype (100% flowing divides — ZERO isolated pools!)
    if (archetype === 'RIVER_VALLEY' || archetype === 'FRONTIER_RIVER') {
        for (let i = 0; i < numPlayers; i++) {
            const riverAngle = startAngle + (i * 2 * Math.PI / numPlayers);
            carveChannel(centerX, centerY, riverAngle, size * 0.95, 'WATER', archetype === 'RIVER_VALLEY');
        }
    } else if (archetype === 'CANYON_DIVIDE') {
        for (let i = 0; i < numPlayers; i++) {
            const gorgeAngle = startAngle + (i * 2 * Math.PI / numPlayers);
            carveChannel(centerX, centerY, gorgeAngle, size * 0.95, 'CANYON', true);
        }
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (Math.abs(dx) + Math.abs(dy) <= 1) {
                    const t = getTile(centerX + dx, centerY + dy);
                    if (t) { t.type = 'CANYON'; t.height = 0; }
                }
            }
        }
    } else if (archetype === 'FORKED_RIVER') {
        // Flowing river that splits around a contested central river island before flowing cleanly to the edges!
        const islandSpan = numPlayers > 2 ? 3.5 : 3.0;
        const dx = Math.cos(startAngle);
        const dy = Math.sin(startAngle);
        const px = -Math.sin(startAngle);
        const py = Math.cos(startAngle);

        const forkAX = Math.max(2, Math.min(size - 3, Math.round(centerX + dx * islandSpan)));
        const forkAY = Math.max(2, Math.min(size - 3, Math.round(centerY + dy * islandSpan)));
        const forkBX = Math.max(2, Math.min(size - 3, Math.round(centerX - dx * islandSpan)));
        const forkBY = Math.max(2, Math.min(size - 3, Math.round(centerY - dy * islandSpan)));
        const bankLX = Math.max(2, Math.min(size - 3, Math.round(centerX + px * islandSpan)));
        const bankLY = Math.max(2, Math.min(size - 3, Math.round(centerY + py * islandSpan)));
        const bankRX = Math.max(2, Math.min(size - 3, Math.round(centerX - px * islandSpan)));
        const bankRY = Math.max(2, Math.min(size - 3, Math.round(centerY - py * islandSpan)));

        // Diamond-shaped twin braided channels hugging the central island
        carveSegment(forkAX, forkAY, bankLX, bankLY, 'WATER');
        carveSegment(bankLX, bankLY, forkBX, forkBY, 'WATER');
        carveSegment(forkAX, forkAY, bankRX, bankRY, 'WATER');
        carveSegment(bankRX, bankRY, forkBX, forkBY, 'WATER');

        // Continue main river branches cleanly out to every edge
        carveChannel(forkAX, forkAY, startAngle, size * 0.7, 'WATER', false);
        carveChannel(forkBX, forkBY, startAngle + Math.PI, size * 0.7, 'WATER', false);
        if (numPlayers > 2) {
            carveChannel(bankLX, bankLY, startAngle + Math.PI / 2, size * 0.7, 'WATER', false);
            carveChannel(bankRX, bankRY, startAngle - Math.PI / 2, size * 0.7, 'WATER', false);
        }
    }

    // 4. Place Player Bases symmetrically & guarantee clear walkable HQ aprons
    const padding = 3;
    const baseDist = (size / 2) - padding;
    for (let i = 0; i < numPlayers; i++) {
        const sectorAnchor = startAngle + (i * 2 * Math.PI / numPlayers);
        const sectorAngle = sectorAnchor + (Math.PI / numPlayers);
        const bx = Math.max(2, Math.min(size - 3, Math.round(centerX + Math.cos(sectorAngle) * baseDist)));
        const by = Math.max(2, Math.min(size - 3, Math.round(centerY + Math.sin(sectorAngle) * baseDist)));

        // Clear a 2-tile walkable apron around every Base so squads always deploy smoothly
        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) + Math.abs(dy) > 2) continue;
                const nt = getTile(bx + dx, by + dy);
                if (nt && nt.type !== 'BASE') {
                    nt.type = baseGroundAt(nt.x, nt.y);
                    nt.height = 1;
                }
            }
        }
        const t = getTile(bx, by);
        if (t) {
            t.type = 'BASE';
            t.owner = i;
            t.height = 1;
            baseLocations.push({ x: bx, y: by, owner: i });
        }
    }

    const isNearAnyBase = (x: number, y: number, minDist = 3): boolean =>
        baseLocations.some(b => Math.abs(b.x - x) + Math.abs(b.y - y) <= minDist);
    const isOpenGround = (t: Tile | null): t is Tile =>
        Boolean(t && (t.type === 'PLAINS' || t.type === 'SAND'));

    // 5. Place cleanly spaced strategic Bridges (minimum 3-tile spacing, walkable approaches on both ends!)
    const placedBridges: Tile[] = [];
    const bridgeCandidates: Array<{ tile: Tile; bridgeType: 'BRIDGE' | 'BRIDGE_V' }> = [];
    for (const t of tiles) {
        if (t.type !== 'WATER' && t.type !== 'CANYON') continue;
        if (t.x <= 1 || t.x >= size - 2 || t.y <= 1 || t.y >= size - 2) continue;
        const left = getTile(t.x - 1, t.y);
        const right = getTile(t.x + 1, t.y);
        const top = getTile(t.x, t.y - 1);
        const bottom = getTile(t.x, t.y + 1);
        if (isOpenGround(left) && isOpenGround(right)) {
            bridgeCandidates.push({ tile: t, bridgeType: 'BRIDGE' });
        } else if (isOpenGround(top) && isOpenGround(bottom)) {
            bridgeCandidates.push({ tile: t, bridgeType: 'BRIDGE_V' });
        }
    }
    shuffle(bridgeCandidates);
    const targetBridgeCount =
        archetype === 'FORKED_RIVER'
            ? (numPlayers === 2 ? 5 : numPlayers * 2 + 2)
            : (numPlayers === 2 ? 4 : numPlayers * 2);
    const minBridgeSpacing = 3;

    for (const cand of bridgeCandidates) {
        if (placedBridges.length >= targetBridgeCount) break;
        if (cand.tile.type !== 'WATER' && cand.tile.type !== 'CANYON') continue;
        if (placedBridges.some(b => dist(b, cand.tile) < minBridgeSpacing)) continue;
        cand.tile.type = cand.bridgeType;
        cand.tile.height = 1;
        placedBridges.push(cand.tile);
    }

    const isNearBridgeApproach = (x: number, y: number): boolean =>
        placedBridges.some(b => Math.abs(b.x - x) + Math.abs(b.y - y) <= 1);

    // 6. Carve concise tactical supply roads extending outward from primary bridge crossings
    const paintRoadLine = (x0: number, y0: number, x1: number, y1: number) => {
        let cx = x0;
        let cy = y0;
        let horizontalFirst = rng() < 0.5;
        let steps = 0;
        while ((cx !== x1 || cy !== y1) && steps < size * 2) {
            steps++;
            let movedH = false;
            if (horizontalFirst && cx !== x1) {
                cx += cx < x1 ? 1 : -1;
                movedH = true;
            } else if (cy !== y1) {
                cy += cy < y1 ? 1 : -1;
            } else if (cx !== x1) {
                cx += cx < x1 ? 1 : -1;
                movedH = true;
            }
            if (steps % 4 === 0 && rng() < 0.35) horizontalFirst = !horizontalFirst;
            const stepTile = getTile(cx, cy);
            if (!stepTile) break;
            if (stepTile.type === 'WATER' || stepTile.type === 'CANYON' || stepTile.type === 'BASE') break;
            if (isOpenGround(stepTile) && !isNearAnyBase(stepTile.x, stepTile.y, 1)) {
                stepTile.type = movedH ? 'ROAD_H' : 'ROAD';
                stepTile.height = 1;
            }
        }
    };

    if (archetype !== 'CANYON_DIVIDE') {
        const roadBridges = placedBridges.slice(0, numPlayers === 2 ? 2 : 3);
        for (const br of roadBridges) {
            const isH = br.type === 'BRIDGE';
            const reach = 2 + Math.floor(rng() * 2);
            if (isH) {
                paintRoadLine(br.x, br.y, Math.max(2, br.x - reach), br.y);
                paintRoadLine(br.x, br.y, Math.min(size - 3, br.x + reach), br.y);
            } else {
                paintRoadLine(br.x, br.y, br.x, Math.max(2, br.y - reach));
                paintRoadLine(br.x, br.y, br.x, Math.min(size - 3, br.y + reach));
            }
        }
    }

    // 7. Spread 4–5 Medium/Small Irregular Mountain Ranges in 20x20 (7–8 in 25x25), strictly capped <= 6 tiles!
    const mountainClusterOwner = new Int16Array(size * size).fill(-1);
    const hasForeignMountainNeighbor = (x: number, y: number, myClusterId: number): boolean => {
        for (const [dx, dy] of DIRS_8) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            const owner = mountainClusterOwner[ny * size + nx];
            if (owner !== -1 && owner !== myClusterId) return true;
        }
        return false;
    };

    const canPlaceMountain = (x: number, y: number, myClusterId: number): boolean => {
        const t = getTile(x, y);
        if (!isOpenGround(t)) return false;
        if (isNearAnyBase(x, y, 3) || isNearBridgeApproach(x, y)) return false;
        if (hasForeignMountainNeighbor(x, y, myClusterId)) return false;
        return true;
    };

    // Tactical flanking geometry:
    // - 20x20: 1–2 larger flanking ranges (7–9t, 6–7t) + rich 2–3t & 4–5t center/flank ridges + 1–2t outcrops
    // - 25x25: 2–3 sweeping massifs (8–12t) + 5 medium/small ridges + 1–2t outcrops
    // Every cluster enforces 8-way non-merging so crisp 1–3 tile flanking passes always stay open between ranges!
    const plannedRangeDefs: Array<{ size: number; centerBias: boolean }> =
        numPlayers === 2
            ? [
                { size: 7 + Math.floor(rng() * 3), centerBias: false },                  // hero flanking barrier (7–9t)
                { size: rng() < 0.65 ? 6 + Math.floor(rng() * 2) : 5, centerBias: false }, // secondary range (6–7 or 5t)
                { size: 4 + Math.floor(rng() * 2), centerBias: true },                   // mid-flank ridge (4–5t)
                { size: 3, centerBias: true },                                           // center-flank 3t ridge
                { size: 3, centerBias: true },                                           // center-flank 3t ridge
                { size: 2 + Math.floor(rng() * 2), centerBias: true },                   // center-flank 2–3t ridge
                { size: 2 + Math.floor(rng() * 2), centerBias: false },                  // outer-flank 2–3t ridge
                { size: 2 + Math.floor(rng() * 2), centerBias: false },                  // outer-flank 2–3t spur
              ]
            : numPlayers <= 4
                ? [
                    { size: 9 + Math.floor(rng() * 4), centerBias: false },              // sweeping hero massif (9–12t)
                    { size: 8 + Math.floor(rng() * 3), centerBias: false },              // large flanking range (8–10t)
                    { size: 7 + Math.floor(rng() * 3), centerBias: false },              // large-medium range (7–9t)
                    { size: 5 + Math.floor(rng() * 2), centerBias: true },               // inner-flank ridge (5–6t)
                    { size: 4 + Math.floor(rng() * 2), centerBias: true },               // inner-flank ridge (4–5t)
                    { size: 4, centerBias: false },                                      // tactical ridge (4t)
                    { size: 3 + Math.floor(rng() * 2), centerBias: true },               // center-flank 3–4t ridge
                    { size: 3, centerBias: false },                                      // flanking spur (3t)
                  ]
                : [12, 10, 9, 8, 6, 5, 5, 4, 4, 3].map((sz, idx) => ({ size: sz, centerBias: idx >= 4 && idx <= 7 }));

    const rangeAnchors: { x: number; y: number }[] = [];
    let nextMtnClusterId = 0;

    for (const { size: targetSize, centerBias } of plannedRangeDefs) {
        const cid = nextMtnClusterId++;
        let sx = -1;
        let sy = -1;
        let bestSeedScore = -Infinity;
        const innerMinD = 2;
        const innerMaxD = Math.floor(size * 0.36);
        const minSpread = targetSize <= 3 ? Math.max(3, Math.floor(size * 0.16)) : Math.floor(size * 0.21);

        for (let attempt = 0; attempt < 65; attempt++) {
            const cx = 1 + Math.floor(rng() * (size - 2));
            const cy = 1 + Math.floor(rng() * (size - 2));
            if (!canPlaceMountain(cx, cy, cid)) continue;
            const dCenter = Math.abs(cx - centerX) + Math.abs(cy - centerY);
            const spreadReq = attempt < 36 ? minSpread : Math.max(2, minSpread - 1);
            if (!rangeAnchors.every(a => Math.abs(a.x - cx) + Math.abs(a.y - cy) >= spreadReq)) continue;

            let score = rng() * 2.5;
            if (centerBias) {
                score += dCenter >= innerMinD && dCenter <= innerMaxD ? 12 : -Math.abs(dCenter - innerMaxD);
            } else {
                score += dCenter >= 4 && dCenter <= Math.floor(size * 0.55) ? 6 : 0;
            }
            if (score > bestSeedScore) {
                bestSeedScore = score;
                sx = cx;
                sy = cy;
            }
        }
        if (sx === -1) continue;

        const placed: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
        const seedTile = getTile(sx, sy)!;
        seedTile.type = 'MOUNTAIN';
        seedTile.height = 2;
        mountainClusterOwner[sy * size + sx] = cid;
        rangeAnchors.push({ x: sx, y: sy });

        // Grow organically with curved spines + occasional core branching for realistic irregular flanking silhouettes
        let heading = rng() * Math.PI * 2;
        const curve = (rng() - 0.5) * 0.58;
        let guard = 0;
        while (placed.length < targetSize && guard < 48) {
            guard++;
            const anchor =
                rng() < 0.68
                    ? placed[placed.length - 1]
                    : placed[Math.floor(rng() * placed.length)];
            heading += curve + (rng() - 0.5) * 1.1;
            const dx = Math.round(Math.cos(heading));
            const dy = Math.round(Math.sin(heading));
            if (dx === 0 && dy === 0) continue;
            const nx = anchor.x + dx;
            const ny = anchor.y + dy;
            if (nx < 1 || nx >= size - 1 || ny < 1 || ny >= size - 1) continue;
            if (!canPlaceMountain(nx, ny, cid)) continue;
            const nt = getTile(nx, ny)!;
            nt.type = 'MOUNTAIN';
            nt.height = 2;
            mountainClusterOwner[ny * size + nx] = cid;
            placed.push({ x: nx, y: ny });
        }
    }

    // Add compact 2-tile rocky pillars + isolated 1-tile sniper crags for crisp LOS pockets & tactical flanking cover
    const twoTileOutcropTarget = numPlayers === 2 ? 4 : numPlayers <= 4 ? 5 : 6;
    let twoTilePlaced = 0;
    for (let attempt = 0; attempt < 95 && twoTilePlaced < twoTileOutcropTarget; attempt++) {
        const cid = nextMtnClusterId++;
        const cx = 1 + Math.floor(rng() * (size - 2));
        const cy = 1 + Math.floor(rng() * (size - 2));
        if (!canPlaceMountain(cx, cy, cid)) continue;
        // Bias first 2 compact 2-tile pillars near mid-map flanking corridors
        const dCenter = Math.abs(cx - centerX) + Math.abs(cy - centerY);
        if (twoTilePlaced < 2 && attempt < 45 && dCenter > Math.floor(size * 0.42)) continue;
        const dirs = shuffle([...DIRS_8]);
        let pairTile: Tile | null = null;
        for (const [dx, dy] of dirs) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 1 || nx >= size - 1 || ny < 1 || ny >= size - 1) continue;
            if (canPlaceMountain(nx, ny, cid)) {
                pairTile = getTile(nx, ny);
                break;
            }
        }
        if (!pairTile) continue;
        const t1 = getTile(cx, cy)!;
        t1.type = 'MOUNTAIN';
        t1.height = 2;
        mountainClusterOwner[cy * size + cx] = cid;
        pairTile.type = 'MOUNTAIN';
        pairTile.height = 2;
        mountainClusterOwner[pairTile.y * size + pairTile.x] = cid;
        twoTilePlaced++;
    }

    const loneCragTarget = numPlayers === 2 ? 5 : numPlayers <= 4 ? 6 : 8;
    let loneCragsPlaced = 0;
    for (let attempt = 0; attempt < 95 && loneCragsPlaced < loneCragTarget; attempt++) {
        const cid = nextMtnClusterId++;
        const cx = 1 + Math.floor(rng() * (size - 2));
        const cy = 1 + Math.floor(rng() * (size - 2));
        if (!canPlaceMountain(cx, cy, cid)) continue;
        const t = getTile(cx, cy)!;
        t.type = 'MOUNTAIN';
        t.height = 2;
        mountainClusterOwner[cy * size + cx] = cid;
        loneCragsPlaced++;
    }

    // 8. Desert Sculpted Dunes & Quicksand Traps on sand/desert zones
    if (archetype === 'CANYON_DIVIDE' || archetype === 'FRONTIER_RIVER') {
        const sandTiles = tiles.filter(t => t.type === 'SAND' && !isNearAnyBase(t.x, t.y, 3) && !isNearBridgeApproach(t.x, t.y));
        shuffle(sandTiles);
        const duneTarget = archetype === 'CANYON_DIVIDE' ? Math.round(size * 0.65) : Math.round(size * 0.34);
        const placedDunes: Tile[] = [];
        for (const st of sandTiles) {
            if (placedDunes.length >= duneTarget) break;
            if (placedDunes.some(d => dist(d, st) < 2)) continue;
            st.type = 'DUNES';
            st.height = 2;
            placedDunes.push(st);
        }
        const qsTarget = archetype === 'CANYON_DIVIDE' ? 3 : 1;
        let qsPlaced = 0;
        for (const st of sandTiles) {
            if (qsPlaced >= qsTarget) break;
            if (st.type !== 'SAND') continue;
            if (st.x <= 2 || st.x >= size - 3 || st.y <= 2 || st.y >= size - 3) continue;
            st.type = 'QUICKSAND';
            st.height = 1;
            qsPlaced++;
        }
    }

    // 9. Scaled Cohesive Forest Groves + Tactical 3–5 Tile Flanking Copses + Rich Solo Trees:
    // - 20x20: 1 larger hero forest (6–8t) + 1 classic grove (5–6t) + 3 clever flanking forest clusters (3–5t each, center & flank biased) + 42–48 solo trees
    // - 25x25: 3 larger groves (7–10t) + 1 center-flanking 3–4t copse + 64–73 solo trees
    // - 30x30: 4 groves (7–10t) + 1 center-flanking 4–5t copse + 86–96 solo trees
    const forestClusterOwner = new Int16Array(size * size).fill(-1);
    const plannedGroveDefs: Array<{ size: number; centerBias: boolean }> =
        numPlayers === 2
            ? [
                { size: 6 + Math.floor(rng() * 3), centerBias: false }, // 1 larger hero forest (6–8 tiles)
                { size: 5 + Math.floor(rng() * 2), centerBias: false }, // 1 classic forest grove (5–6 tiles)
                { size: 4 + Math.floor(rng() * 2), centerBias: true },  // central flanking wood (4–5 tiles)
                { size: 3 + Math.floor(rng() * 2), centerBias: true },  // central/bridge approach copse (3–4 tiles)
                { size: 3 + Math.floor(rng() * 2), centerBias: false }, // outer lane flank copse (3–4 tiles)
              ]
            : numPlayers <= 4
                ? [
                    { size: 8 + Math.floor(rng() * 3), centerBias: false }, // 8–10 tiles
                    { size: 7 + Math.floor(rng() * 3), centerBias: false }, // 7–9 tiles
                    { size: 6 + Math.floor(rng() * 2), centerBias: false }, // 6–7 tiles
                    { size: 3 + Math.floor(rng() * 2), centerBias: true },  // inner flanking copse (3–4 tiles)
                  ]
                : [
                    { size: 9, centerBias: false },
                    { size: 8, centerBias: false },
                    { size: 8, centerBias: false },
                    { size: 7, centerBias: false },
                    { size: 4, centerBias: true },
                  ];
    const GROVE_ID_LIMIT = plannedGroveDefs.length;

    const hasForeignForestNeighbor8 = (x: number, y: number, myId: number): boolean => {
        for (const [dx, dy] of DIRS_8) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            const owner = forestClusterOwner[ny * size + nx];
            if (owner !== -1 && owner !== myId) return true;
        }
        return false;
    };

    const touchesGroveOrOrthoTree = (x: number, y: number): boolean => {
        // Strictly 8-way clear of all main groves so no lone tree ever merges onto a grove
        for (const [dx, dy] of DIRS_8) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            const owner = forestClusterOwner[ny * size + nx];
            if (owner >= 0 && owner < GROVE_ID_LIMIT) return true;
        }
        // Strictly 4-way clear of all other individual trees so no unintended clump ever forms
        for (const [dx, dy] of DIRS_4) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
            if (forestClusterOwner[ny * size + nx] !== -1) return true;
        }
        return false;
    };

    const canPlaceGroveTile = (x: number, y: number, gid: number): boolean => {
        const t = getTile(x, y);
        if (!isOpenGround(t)) return false;
        if (isNearAnyBase(x, y, 2) || isNearBridgeApproach(x, y)) return false;
        if (hasForeignForestNeighbor8(x, y, gid)) return false;
        return true;
    };

    const groveAnchors: { x: number; y: number }[] = [];
    let nextForestId = 0;

    for (const { size: targetGroveSize, centerBias } of plannedGroveDefs) {
        const gid = nextForestId++;
        let sx = -1;
        let sy = -1;
        let bestScore = -Infinity;
        const minSpread = targetGroveSize <= 4 ? Math.max(4, Math.floor(size * 0.20)) : Math.floor(size * 0.27);
        const innerMaxD = Math.floor(size * 0.36);

        for (let attempt = 0; attempt < 65; attempt++) {
            const cx = 2 + Math.floor(rng() * (size - 4));
            const cy = 2 + Math.floor(rng() * (size - 4));
            if (!canPlaceGroveTile(cx, cy, gid)) continue;
            const spread = attempt < 38 ? minSpread : Math.max(3, minSpread - 2);
            if (!groveAnchors.every(a => Math.abs(a.x - cx) + Math.abs(a.y - cy) >= spread)) continue;
            const dCenter = Math.abs(cx - centerX) + Math.abs(cy - centerY);
            let score = rng() * 2.5;
            if (centerBias) {
                score += dCenter >= 2 && dCenter <= innerMaxD ? 12 : -Math.abs(dCenter - innerMaxD);
            }
            if (score > bestScore) {
                bestScore = score;
                sx = cx;
                sy = cy;
            }
        }
        if (sx === -1) continue;

        const groveTiles: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
        getTile(sx, sy)!.type = 'FOREST';
        forestClusterOwner[sy * size + sx] = gid;
        groveAnchors.push({ x: sx, y: sy });

        let guard = 0;
        while (groveTiles.length < targetGroveSize && guard < 55) {
            guard++;
            const anchor = groveTiles[Math.floor(rng() * groveTiles.length)];
            const dirs = shuffle([...DIRS_4]);
            for (const [dx, dy] of dirs) {
                const nx = anchor.x + dx;
                const ny = anchor.y + dy;
                if (nx < 1 || nx >= size - 1 || ny < 1 || ny >= size - 1) continue;
                if (!canPlaceGroveTile(nx, ny, gid)) continue;
                getTile(nx, ny)!.type = 'FOREST';
                forestClusterOwner[ny * size + nx] = gid;
                groveTiles.push({ x: nx, y: ny });
                break;
            }
        }
    }

    // Generously scatter individual standalone colorful trees across open meadows, foothills & riverbanks!
    const loneTreeTarget =
        numPlayers === 2
            ? 42 + Math.floor(rng() * 7) // 42–48 individual trees on 20x20!
            : numPlayers <= 4
                ? 64 + Math.floor(rng() * 10) // 64–73 on 25x25
                : 86 + Math.floor(rng() * 10);
    const openCandidates = tiles.filter(
        t => isOpenGround(t) && !isNearAnyBase(t.x, t.y, 2) && !isNearBridgeApproach(t.x, t.y),
    );
    shuffle(openCandidates);
    let loneTreesPlaced = 0;

    // Pass A: 8-way isolated trees first for airy organic spread
    const passATarget = Math.round(loneTreeTarget * 0.65);
    for (const cand of openCandidates) {
        if (loneTreesPlaced >= passATarget) break;
        if (!isOpenGround(cand)) continue;
        const tid = nextForestId++;
        if (hasForeignForestNeighbor8(cand.x, cand.y, tid)) continue;
        cand.type = 'FOREST';
        forestClusterOwner[cand.y * size + cand.x] = tid;
        loneTreesPlaced++;
    }
    // Pass B: fill lush individual trees keeping strict 4-way separation (and 8-way clear of the 2 main groves!)
    for (const cand of openCandidates) {
        if (loneTreesPlaced >= loneTreeTarget) break;
        if (!isOpenGround(cand)) continue;
        if (touchesGroveOrOrthoTree(cand.x, cand.y)) continue;
        const tid = nextForestId++;
        cand.type = 'FOREST';
        forestClusterOwner[cand.y * size + cand.x] = tid;
        loneTreesPlaced++;
    }

    // 10. Partition open buildable ground into player sectors for fair Banks, Watchtowers, & Bunkers
    const zoneTiles: Tile[][] = Array.from({ length: numPlayers }, () => []);
    tiles.forEach(t => {
        if (t.type !== 'PLAINS' && t.type !== 'SAND') return;
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

    // Place Banks in contested interior sectors (inset >= 2 tiles from map edges so vaults never hide in corners!)
    const idealCenterDist = Math.round(size * 0.24);
    for (let i = 0; i < numPlayers; i++) {
        const candidates = zoneTiles[i].filter(t => !isNearBridgeApproach(t.x, t.y));
        const base = baseLocations[i];
        const scored = candidates.map(t => {
            const dBase = dist(t, base);
            const dCenter = dist(t, mapCenter);
            const inset = t.x >= 2 && t.x <= size - 3 && t.y >= 2 && t.y <= size - 3 ? 8 : -20;
            const score = inset - Math.abs(dCenter - idealCenterDist) * 1.4 + Math.min(dBase, size * 0.48) * 0.65 + rng() * 1.5;
            return { tile: t, score, dBase };
        }).sort((a, b) => b.score - a.score);

        let placed = false;
        const constraints = [
            { minBankDist: 10, minBaseDist: 7 },
            { minBankDist: 7, minBaseDist: 6 },
            { minBankDist: 4, minBaseDist: 5 },
        ];
        for (const { minBankDist, minBaseDist } of constraints) {
            if (placed) break;
            for (const cand of scored) {
                if (cand.dBase < minBaseDist) continue;
                if (placedBanks.some(b => dist(cand.tile, b) < minBankDist)) continue;
                cand.tile.type = 'BANK';
                cand.tile.hackProgress = 0;
                cand.tile.height = 1;
                placedBanks.push(cand.tile);
                placed = true;
                break;
            }
        }
    }

    const bridges = tiles.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V');

    // Place Watchtower (overlooking crossings/center) & Bunker (mid-lane anchor) per player sector with clean fallback
    for (let i = 0; i < numPlayers; i++) {
        const validTiles = zoneTiles[i].filter(t => isOpenGround(t));
        const base = baseLocations[i];
        const allAssets = [...placedBanks, ...placedBuildings];

        const outpostCandidates = validTiles.map(t => {
            let minBridgeDist = bridges.length > 0 ? Infinity : dist(t, mapCenter);
            bridges.forEach(b => {
                const d = dist(t, b);
                if (d < minBridgeDist) minBridgeDist = d;
            });
            const borderPenalty = t.x <= 1 || t.x >= size - 2 || t.y <= 1 || t.y >= size - 2 ? -6 : 0;
            return { tile: t, score: -minBridgeDist + borderPenalty + rng() };
        }).sort((a, b) => b.score - a.score);

        for (const minAssetGap of [3, 2, 1]) {
            let wtPlaced = false;
            for (const cand of outpostCandidates) {
                const t = cand.tile;
                if (dist(t, base) < 4) continue;
                if (allAssets.some(a => dist(t, a) < minAssetGap)) continue;
                t.type = 'BUILDING';
                t.subType = 'WATCHTOWER';
                t.height = 1;
                placedBuildings.push(t);
                allAssets.push(t);
                wtPlaced = true;
                break;
            }
            if (wtPlaced) break;
        }

        const midPoint = { x: Math.round((base.x + centerX) / 2), y: Math.round((base.y + centerY) / 2) };
        const bunkerCandidates = zoneTiles[i]
            .filter(t => isOpenGround(t))
            .map(t => ({ tile: t, score: -dist(t, midPoint) + rng() }))
            .sort((a, b) => b.score - a.score);

        for (const minAssetGap of [3, 2, 1]) {
            let bkPlaced = false;
            for (const cand of bunkerCandidates) {
                const t = cand.tile;
                if (dist(t, base) < 3) continue;
                if (allAssets.some(a => dist(t, a) < minAssetGap)) continue;
                t.type = 'BUILDING';
                t.subType = 'BUNKER';
                t.height = 1;
                placedBuildings.push(t);
                bkPlaced = true;
                break;
            }
            if (bkPlaced) break;
        }
    }

    // Add 1 (20x20) or 2 (25x25+) contested mid-map neutral tactical strongholds near central crossings
    {
        const centerOutpostTarget = numPlayers > 2 ? 2 : 1;
        const allAssets = [...placedBanks, ...placedBuildings];
        const centerCandidates = tiles
            .filter(t => isOpenGround(t) && !isNearAnyBase(t.x, t.y, 5) && !isNearBridgeApproach(t.x, t.y))
            .map(t => ({ tile: t, dCenter: dist(t, mapCenter) }))
            .filter(c => c.dCenter <= (numPlayers > 2 ? 7 : 5))
            .sort((a, b) => a.dCenter - b.dCenter);
        let placedCenter = 0;
        for (const cand of centerCandidates) {
            if (placedCenter >= centerOutpostTarget) break;
            if (allAssets.some(a => dist(cand.tile, a) < 3)) continue;
            cand.tile.type = 'BUILDING';
            cand.tile.subType = placedCenter % 2 === 0 ? 'BUNKER' : 'WATCHTOWER';
            cand.tile.height = 1;
            placedBuildings.push(cand.tile);
            allAssets.push(cand.tile);
            placedCenter++;
        }
    }

    // 11. Ensure every base is reachable by ground path from baseLocations[0] (bridge wide rivers/canyons if needed)
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
                    for (const [dx, dy] of DIRS_4) {
                        const nt = getTile(cur.x + dx, cur.y + dy);
                        if (!nt || visited.has(nt.id)) continue;
                        if (nt.id !== targetBase.id && isGroundBlocked(nt)) continue;
                        visited.add(nt.id);
                        queue.push(nt);
                    }
                }

                if (!reached) {
                    let cx = origin.x;
                    let cy = origin.y;
                    while (cx !== targetBase.x || cy !== targetBase.y) {
                        const prevX = cx;
                        if (cx !== targetBase.x) cx += cx < targetBase.x ? 1 : -1;
                        else if (cy !== targetBase.y) cy += cy < targetBase.y ? 1 : -1;
                        const movedH = cx !== prevX;
                        const stepTile = getTile(cx, cy);
                        if (stepTile && stepTile.id !== targetBase.id && stepTile.type !== 'BASE' && isGroundBlocked(stepTile)) {
                            stepTile.type =
                                stepTile.type === 'WATER' || stepTile.type === 'CANYON'
                                    ? (movedH ? 'BRIDGE' : 'BRIDGE_V')
                                    : baseGroundAt(stepTile.x, stepTile.y);
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
    const occupied = new Set<string>();
    let idCounter = 0;

    baseLocations.forEach(base => {
        const candidates = mapTiles
            .filter(
                t =>
                    !occupied.has(t.id) &&
                    t.type !== 'WATER' &&
                    t.type !== 'MOUNTAIN' &&
                    t.type !== 'BUILDING' &&
                    t.type !== 'BASE' &&
                    t.type !== 'BANK' &&
                    t.type !== 'CANYON' &&
                    t.type !== 'BARRIER' &&
                    t.type !== 'QUICKSAND' &&
                    t.hazardState !== 'LAVA'
            )
            .sort((a, b) => getManhattanDistance(a, base) - getManhattanDistance(b, base));
        
        let idx = 0;
        const spawnList = [
            ...Array(counts.SOLDIER).fill('SOLDIER'),
            ...Array(counts.ASSAULTER).fill('ASSAULTER'),
            ...Array(counts.SNIPER).fill('SNIPER'),
        ];
        spawnList.forEach(type => {
            if (idx < candidates.length) {
                const tileId = candidates[idx].id;
                occupied.add(tileId);
                units.push(createUnit({
                    id: `unit_${idCounter++}`,
                    type: type as UnitType,
                    tileId,
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

/**
 * Gives every Bank 15 HP and rolls its vault (seeded, so retries replay identically):
 * 70% cash vaults holding €100-300, 30% dry intel caches (0 gold, +12 CP).
 * Maps with explicit editor-set rewards keep them.
 */
export const initBankVaults = (map: Tile[], rng: () => number) => {
    map.forEach(t => {
        if (t.type !== 'BANK') return;
        t.hp = BANK_STATS.HP;
        t.maxHp = BANK_STATS.HP;
        if (t.bankGoldReward === undefined && t.bankCpReward === undefined) {
            if (rng() < 0.3) {
                t.bankGoldReward = 0;
                t.bankCpReward = 12;
            } else {
                t.bankGoldReward = 100 + Math.floor(rng() * 21) * 10;
            }
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
    initBankVaults(zonedMap, mapRng);
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
        const distinctOwners = new Set(potentialBases.map(b => b.owner));
        const hasExplicitMatch =
            potentialBases.length === settings.playerCount &&
            distinctOwners.size === settings.playerCount &&
            potentialBases.every(b => typeof b.owner === 'number' && b.owner >= 0 && b.owner < settings.playerCount);

        if (hasExplicitMatch) {
            potentialBases.forEach(b => {
                b.type = 'BASE';
                b.height = 1;
                baseLocations.push({ x: b.x, y: b.y, owner: b.owner! });
            });
            baseLocations.sort((a, b) => a.owner - b.owner);
        } else {
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
        }
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
    initBankVaults(finalMap, createSeededRng(`${seedUsed}_vaults`));

    const units = spawnUnitsForPlayers(finalMap, settings.unitCounts, baseLocations, settings.mutators);
    const players = startingPlayers(settings, weatherRng);
    return freshGame(settings, finalMap, gridSize, units, seedUsed, players);
};

/** Computes sparse differences between a generated tile array and an edited version. */
export const diffMapTilePatches = (baseTiles: Tile[], editedTiles: Tile[]): MapTilePatch[] => {
    const patches: MapTilePatch[] = [];
    const gridSize = Math.round(Math.sqrt(baseTiles.length));
    for (const edited of editedTiles) {
        const base = baseTiles[edited.y * gridSize + edited.x];
        if (!base) continue;
        if (
            base.type === edited.type &&
            base.height === edited.height &&
            (base.subType ?? undefined) === (edited.subType ?? undefined) &&
            (base.owner ?? undefined) === (edited.owner ?? undefined) &&
            (base.bankGoldReward ?? undefined) === (edited.bankGoldReward ?? undefined) &&
            (base.bankCpReward ?? undefined) === (edited.bankCpReward ?? undefined)
        ) {
            continue;
        }
        patches.push({
            x: edited.x,
            y: edited.y,
            type: edited.type,
            height: edited.height,
            ...(edited.subType !== undefined ? { subType: edited.subType } : {}),
            ...(edited.owner !== undefined ? { owner: edited.owner } : {}),
            ...(edited.bankGoldReward !== undefined ? { bankGoldReward: edited.bankGoldReward } : {}),
            ...(edited.bankCpReward !== undefined ? { bankCpReward: edited.bankCpReward } : {}),
        });
    }
    return patches;
};

/** Applies sparse tile overrides onto a cloned tile grid. */
export const applyMapTilePatches = (baseTiles: Tile[], patches: MapTilePatch[]): Tile[] => {
    const next = cloneTiles(baseTiles);
    const gridSize = Math.round(Math.sqrt(next.length));
    for (const p of patches) {
        if (p.x < 0 || p.x >= gridSize || p.y < 0 || p.y >= gridSize) continue;
        const idx = p.y * gridSize + p.x;
        const target = next[idx];
        if (!target) continue;
        next[idx] = {
            ...target,
            type: p.type,
            height: p.height,
            subType: p.subType,
            owner: p.owner,
            bankGoldReward: p.bankGoldReward,
            bankCpReward: p.bankCpReward,
            hp: undefined,
            maxHp: undefined,
        };
    }
    return next;
};

/** Builds an online table's game state from table rules and optional inline map edits. */
export const createOnlineTableGame = (table: TableSettings, playerCount: number): GameState => {
    const gameSettings = gameSettingsFor(table, playerCount);
    const base = createGeneratedGame(gameSettings);
    if (!table.mapEdits?.length) return base;
    const patched = applyMapTilePatches(base.mapData, table.mapEdits);
    // Recompute Voronoi zones if the host moved any HQs during lobby editing.
    patched.forEach(t => { delete t.zone; });
    return createCustomMapGame({ ...gameSettings, mapSeed: base.activeSeed }, patched);
};

/** Merges suggested tile patches into an online table's `mapEdits` array relative to its generated base map. */
export const mergeOnlineMapEdits = (
    table: TableSettings,
    playerCount: number,
    suggestionEdits: MapTilePatch[],
): MapTilePatch[] => {
    const base = createGeneratedGame(gameSettingsFor({ ...table, mapEdits: undefined }, playerCount));
    const current = table.mapEdits?.length ? applyMapTilePatches(base.mapData, table.mapEdits) : base.mapData;
    const merged = applyMapTilePatches(current, suggestionEdits);
    return diffMapTilePatches(base.mapData, merged);
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
    initBankVaults(finalMap, createSeededRng(`${mission.seed}_vaults`));
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
