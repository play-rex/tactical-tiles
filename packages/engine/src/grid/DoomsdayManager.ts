import type { DoomsdayZone, GameSettings, HazardState, Tile, Unit } from '../types';
import {
    DOOMSDAY_ESCALATION,
    DOOMSDAY_SETTINGS,
    DOOMSDAY_ZONE_TIMING,
    TERRAIN_COSTS,
    getDoomsdayStartTurn,
} from '../constants/Config';
import { createSeededRng } from '../utils/SeededRandom';

export type DoomsdayStage = 'SKIRMISH' | 'COLLAPSE' | 'MELTDOWN';

export interface DoomsdayEscalation {
    stage: DoomsdayStage;
    label: string;
    /** Total CP regen bonus added on top of the player's battery rules. */
    regenBonus: number;
    roundsUntilNextStage: number | null;
}

/**
 * The escalation clock uses the same completed-round counter as updateDoomsdayState.
 * It is only meaningful for Deathmatch + Doomsday; passing enabled=false returns Skirmish.
 * `endTurn` lets a circle plan put Meltdown at roughly 60% of the closing schedule; when
 * omitted the legacy 30/40 clock is kept for old snapshots and Challenge Ops.
 */
export const getDoomsdayEscalation = (
    currentTurn: number,
    enabled = true,
    startTurn = DOOMSDAY_SETTINGS.START_TURN,
    endTurn?: number,
): DoomsdayEscalation => {
    if (!enabled) {
        return { stage: 'SKIRMISH', label: 'Skirmish', regenBonus: 0, roundsUntilNextStage: null };
    }
    const collapseTurn = startTurn;
    const meltdownTurn = endTurn !== undefined
        ? startTurn + Math.round((endTurn - startTurn) * 0.6)
        : collapseTurn + DOOMSDAY_ESCALATION.MELTDOWN_RING * DOOMSDAY_SETTINGS.SHRINK_INTERVAL;
    if (currentTurn < collapseTurn) {
        return {
            stage: 'SKIRMISH',
            label: 'Skirmish',
            regenBonus: 0,
            roundsUntilNextStage: collapseTurn - currentTurn,
        };
    }
    if (currentTurn < meltdownTurn) {
        return {
            stage: 'COLLAPSE',
            label: 'Collapse',
            regenBonus: DOOMSDAY_ESCALATION.COLLAPSE_REGEN_BONUS,
            roundsUntilNextStage: meltdownTurn - currentTurn,
        };
    }
    return {
        stage: 'MELTDOWN',
        label: 'Meltdown',
        regenBonus: DOOMSDAY_ESCALATION.MELTDOWN_REGEN_BONUS,
        roundsUntilNextStage: null,
    };
};

export const getRingIndex = (x: number, y: number, gridSize: number): number => {
    // Legacy square-ring distance, still used by old snapshots and the challenge prebuild.
    return Math.min(x, gridSize - 1 - x, y, gridSize - 1 - y);
};

const openTerrain = (tile: Tile): boolean => {
    const cost = TERRAIN_COSTS[tile.type] ?? 99;
    return (
        cost < 90 &&
        tile.type !== 'BUILDING' &&
        tile.type !== 'BANK' &&
        tile.type !== 'BASE' &&
        tile.type !== 'BARRIER' &&
        tile.type !== 'MOUNTAIN' &&
        tile.type !== 'QUICKSAND' &&
        tile.hazardState !== 'LAVA'
    );
};

const tileCenter = (tile: Tile): { x: number; y: number } => ({ x: tile.x + 0.5, y: tile.y + 0.5 });

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(a.x - b.x, a.y - b.y);

/** The four corners are the furthest tiles from any centre; this radius covers the whole board. */
const maxCornerDistance = (center: { x: number; y: number }, gridSize: number): number =>
    Math.max(
        distance(center, { x: 0, y: 0 }),
        distance(center, { x: gridSize, y: 0 }),
        distance(center, { x: 0, y: gridSize }),
        distance(center, { x: gridSize, y: gridSize }),
    ) + 0.5;

/**
 * Picks a final circle centre that is:
 * - reachable from every surviving player;
 * - roughly equidistant, so nobody starts inside the final ring while another crosses the map;
 * - offset from the geometric centre (a random, interesting arena rather than the same bullseye);
 * - near cover/structures and with enough open floor for the last fight.
 *
 * The top few scored candidates are sampled with the match seed, so identical seeds replay
 * identically while different maps produce different closing arenas.
 */
const chooseCenter = (
    mapData: Tile[],
    gridSize: number,
    units: Unit[],
    playerCount: number,
    endRadius: number,
    seed: string,
): { x: number; y: number } => {
    const tileById = new Map(mapData.map(t => [t.id, t]));
    const rng = createSeededRng(`${seed}_doomsday_circle_${gridSize}_${playerCount}`);
    const anchors: { x: number; y: number; tiles: Tile[] }[] = [];

    for (let owner = 0; owner < playerCount; owner++) {
        const ownUnits = units.filter(u => u.owner === owner);
        const ownTiles = ownUnits
            .map(u => tileById.get(u.tileId))
            .filter((t): t is Tile => Boolean(t));
        if (ownTiles.length > 0) {
            const avg = ownTiles.reduce(
                (acc, t) => ({ x: acc.x + (t.x + 0.5) / ownTiles.length, y: acc.y + (t.y + 0.5) / ownTiles.length }),
                { x: 0, y: 0 },
            );
            anchors.push({ ...avg, tiles: ownTiles });
            continue;
        }
        const base = mapData.find(t => t.type === 'BASE' && t.owner === owner);
        if (base) anchors.push({ ...tileCenter(base), tiles: [base] });
    }

    const centroid = anchors.length > 0
        ? {
            x: anchors.reduce((sum, a) => sum + a.x, 0) / anchors.length,
            y: anchors.reduce((sum, a) => sum + a.y, 0) / anchors.length,
        }
        : { x: gridSize / 2, y: gridSize / 2 };

    const margin = endRadius + 1;
    const candidates = mapData.filter(t => {
        const c = tileCenter(t);
        return (
            openTerrain(t) &&
            c.x >= margin &&
            c.y >= margin &&
            c.x <= gridSize - margin &&
            c.y <= gridSize - margin
        );
    });

    if (candidates.length === 0) return { x: gridSize / 2, y: gridSize / 2 };

    const scoreCandidate = (tile: Tile): { score: number; spread: number } => {
        const center = tileCenter(tile);
        const distances = anchors.map(a => distance(center, a));
        const minDist = distances.length > 0 ? Math.min(...distances) : 0;
        const maxDist = distances.length > 0 ? Math.max(...distances) : 0;
        const spread = maxDist - minDist;
        const offset = distance(center, centroid);
        const targetOffset = gridSize * 0.1;
        const edgeMargin = Math.min(center.x, center.y, gridSize - center.x, gridSize - center.y);

        let cover = 0;
        let open = 0;
        for (const other of mapData) {
            const d = distance(center, tileCenter(other));
            if (d > endRadius) continue;
            if (openTerrain(other)) open++;
            if (d <= 3 && (other.type === 'BUILDING' || other.type === 'BANK' || other.type === 'FOREST' || other.type === 'MOUNTAIN')) {
                cover++;
            }
        }

        return {
            score:
                -spread * 3
                - Math.max(0, gridSize * 0.18 - minDist) * 6
                - Math.abs(offset - targetOffset) * 0.7
                + Math.min(cover, 8) * 1.5
                + Math.min(open, 16) * 0.1
                - Math.max(0, endRadius + 1 - edgeMargin) * 40,
            spread,
        };
    };

    // Reachability is the hard constraint; score first, then only pay for BFS on good candidates.
    const ranked = candidates
        .map(tile => ({ tile, ...scoreCandidate(tile) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 16);

    const reachable = (start: Tile): Set<string> => {
        const seen = new Set<string>([start.id]);
        const queue = [start];
        while (queue.length > 0) {
            const cur = queue.shift()!;
            for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
                const next = tileById.get(`${cur.x + dx},${cur.y + dy}`);
                if (!next || seen.has(next.id) || !openTerrain(next)) continue;
                seen.add(next.id);
                queue.push(next);
            }
        }
        return seen;
    };

    const valid = ranked.filter(({ tile }) => {
        const seen = reachable(tile);
        return anchors.every(a => a.tiles.some(t => seen.has(t.id)));
    });

    const poolBase = valid.length > 0 ? valid : ranked;
    // Keep the circle fair: a candidate may not put one player's corner materially closer
    // than another's. Variety comes from the balanced shortlist, not from a lopsided centre.
    const balanced = poolBase.filter(c => c.spread <= gridSize * 0.18);
    const pool = (balanced.length > 0 ? balanced : poolBase).slice(0, 6);
    const chosen = pool[Math.floor(rng() * pool.length)] ?? pool[0];
    return tileCenter(chosen.tile);
};

/**
 * Builds the match's circle plan once, at setup, from the actual spawn layout. The zone is
 * stored on GameState so every turn, AI decision and HUD frame uses exactly the same centre.
 */
export const createDoomsdayZone = (params: {
    mapData: Tile[];
    gridSize: number;
    units: Unit[];
    settings: Pick<GameSettings, 'playerCount' | 'doomsdayStartTurn' | 'doomsdayCenter'>;
    seed: string;
}): DoomsdayZone => {
    const { mapData, gridSize, units, settings, seed } = params;
    const timing = gridSize <= DOOMSDAY_ZONE_TIMING.SMALL_MAX_GRID
        ? DOOMSDAY_ZONE_TIMING.SMALL
        : DOOMSDAY_ZONE_TIMING.BIG;
    const startTurn = getDoomsdayStartTurn(settings, gridSize);
    const startRadiusFallback = maxCornerDistance({ x: gridSize / 2, y: gridSize / 2 }, gridSize);
    const endRadius = timing.END_RADIUS;

    const center = settings.doomsdayCenter
        ? {
            x: Math.max(0.5, Math.min(gridSize - 0.5, settings.doomsdayCenter.x)),
            y: Math.max(0.5, Math.min(gridSize - 0.5, settings.doomsdayCenter.y)),
        }
        : chooseCenter(mapData, gridSize, units, settings.playerCount, endRadius, seed);

    return {
        center,
        startTurn,
        endTurn: startTurn + timing.STAGES * timing.INTERVAL,
        startRadius: startRadiusFallback > 0 ? maxCornerDistance(center, gridSize) : startRadiusFallback,
        endRadius,
        shrinkInterval: timing.INTERVAL,
        stageCount: timing.STAGES,
    };
};

/** Number of completed shrink stages at a round (0 before the first close). */
const stageAt = (zone: DoomsdayZone, currentTurn: number): number => {
    if (currentTurn < zone.startTurn) return 0;
    return Math.min(
        zone.stageCount,
        Math.floor((currentTurn - zone.startTurn) / zone.shrinkInterval) + 1,
    );
};

const radiusAtStage = (zone: DoomsdayZone, stage: number): number => {
    const t = Math.max(0, Math.min(zone.stageCount, stage)) / zone.stageCount;
    return zone.startRadius + (zone.endRadius - zone.startRadius) * t;
};

/** Current safe-zone radius in tiles. */
export const getDoomsdayRadius = (zone: DoomsdayZone, currentTurn: number): number =>
    radiusAtStage(zone, stageAt(zone, currentTurn));

/**
 * Radius that will be safe next. Before the first close this is the next-stage radius for
 * exactly one round, which creates the visible WARNING band that PUBG players expect.
 */
export const getDoomsdayNextRadius = (zone: DoomsdayZone, currentTurn: number): number => {
    if (currentTurn < zone.startTurn - 1) return getDoomsdayRadius(zone, currentTurn);
    const stage = stageAt(zone, currentTurn);
    return radiusAtStage(zone, Math.min(zone.stageCount, stage + 1));
};

/** Completed rounds until the next circle step, or null once the final circle is reached. */
export const getDoomsdayRoundsUntilShrink = (zone: DoomsdayZone, currentTurn: number): number | null => {
    if (currentTurn < zone.startTurn) return zone.startTurn - currentTurn;
    const stage = stageAt(zone, currentTurn);
    if (stage >= zone.stageCount) return null;
    return Math.max(1, zone.startTurn + stage * zone.shrinkInterval - currentTurn);
};

export const updateDoomsdayState = (
    mapData: Tile[],
    currentTurn: number,
    gridSize: number,
    startTurn = DOOMSDAY_SETTINGS.START_TURN,
    zone?: DoomsdayZone,
): Tile[] => {
    if (zone) {
        const radius = getDoomsdayRadius(zone, currentTurn);
        const nextRadius = getDoomsdayNextRadius(zone, currentTurn);
        return mapData.map(tile => {
            const dist = Math.hypot(tile.x + 0.5 - zone.center.x, tile.y + 0.5 - zone.center.y);
            const hazard: HazardState =
                dist > radius ? 'LAVA' : dist > nextRadius ? 'WARNING' : 'SAFE';
            if (tile.hazardState === hazard) return tile;
            return { ...tile, hazardState: hazard };
        });
    }

    // Legacy edge-in rings: kept for old online snapshots and the prebuilt challenge map.
    return mapData.map(tile => {
        const ring = getRingIndex(tile.x, tile.y, gridSize);
        const lavaTurn = startTurn + (ring * DOOMSDAY_SETTINGS.SHRINK_INTERVAL);

        let hazard: HazardState = 'SAFE';
        if (currentTurn >= lavaTurn) {
            hazard = 'LAVA';
        } else if (currentTurn >= lavaTurn - 1) {
            hazard = 'WARNING';
        }

        if (tile.hazardState === hazard) return tile;
        return { ...tile, hazardState: hazard };
    });
};
