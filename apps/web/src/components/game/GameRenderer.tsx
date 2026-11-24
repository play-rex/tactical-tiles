
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Stage, Container, Graphics, Text, useTick, useApp } from '@pixi/react';
import { SafeSprite } from './SafeSprite';
import { UnitSprite } from './renderer/UnitSprite';
import { GameViewport } from './renderer/GameViewport';
import * as PIXI from 'pixi.js';
import { isUnitVisible } from '@tactical/engine';
import { useGameStore, viewerSeat } from '../../store/useGameStore';
import { LandMine, Tile } from '@tactical/engine/types';
import { TILE_SIZE, UI_COLORS, PLAYER_COLORS, BANK_STATS, BASE_STATS, UNIT_STATS } from '@tactical/engine/constants/Config';
import { hexToPixiColor } from '../ui/GeoPrimitives';
import { preloadTextures, getTexture } from '../../core/graphics/TextureManager';
import { bakeTacticalReconBoard, bakeSoftFogTexture, computeTerrainSignature } from '../../core/graphics/TacticalReconRenderer';
import { useViewportContext } from '../../context/ViewportContext';
import { SelectionCursor } from './renderer/SelectionCursor';
import { DamageText } from './renderer/DamageText';
import { ProjectileRenderer } from './renderer/ProjectileRenderer';
import { CrossfireBeam } from './renderer/CrossfireLayer';
import { ParticleLayer } from './renderer/ParticleLayer';
import { DeathGhostLayer } from './renderer/DeathGhostLayer';
import { TileEffectsLayer } from './renderer/TileEffectsLayer';
import { WaterShimmerLayer } from './renderer/WaterShimmerLayer';
import { LivingMapLayer } from './renderer/LivingMapLayer';
import { DropAndPromoLayer } from './renderer/DropAndPromoLayer';
import { PerimeterApronLayer } from './renderer/PerimeterApronLayer';
import { KillCamSchematicLayer } from './renderer/KillCamSchematicLayer';
import { setLivePixiApp, getLivePixiApp } from '../../core/graphics/livePixiRef';
import { WeatherSystemMemo as WeatherSystem } from './renderer/WeatherSystem.tsx'; // Explicit .tsx extension
import { FxMode, subscribeRendererWake, useEffectStore, wakeBattleRenderer } from '../../store/useEffectStore';
import { fxTimeline } from '../../core/graphics/fxTimeline';
import type { ParticlePool } from '../../core/graphics/ParticlePool';
import { canUnitAttackFromTile, getUnitMaxHp } from '@tactical/engine/rules/CombatRules';
import { getOverwatchCoverageTiles } from '@tactical/engine/rules/OverwatchRules';
import { useLowPowerStageOptions } from './renderer/pixiStageUtils';
import { type BoardRotation, rotateBoardPoint, unrotateBoardPoint } from '../../core/boardRotation';
import { computeUnitAttackPreview, getHoverMoveResolution, getPostMoveTargetTiles } from '../../core/hoverMovePreview';

const LOOT_MARKER_STYLE = new PIXI.TextStyle({
    fill: '#FFD700',
    fontSize: 20,
    fontWeight: 'bold',
    stroke: 'black',
    strokeThickness: 3,
});

const DROP_MARKER_STYLE = new PIXI.TextStyle({
    fill: '#22D3EE',
    fontSize: 10,
    fontWeight: '900',
    stroke: '#083344',
    strokeThickness: 3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
});

const DROP_MARKER_ANCHOR = { x: 0.5, y: 1 };

const MINE_MARKER_STYLE = new PIXI.TextStyle({
    fill: '#FEF08A',
    fontSize: 9,
    fontWeight: '900',
    stroke: '#7F1D1D',
    strokeThickness: 3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
});

const drawTileBox = (
    g: PIXI.Graphics,
    tile: Pick<Tile, 'x' | 'y'>,
    color: number,
    alpha: number,
    borderAlpha?: number,
    borderColor = color
) => {
    const px = tile.x * TILE_SIZE;
    const py = tile.y * TILE_SIZE;
    g.beginFill(color, alpha);
    g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
    g.endFill();
    if (borderAlpha !== undefined) {
        g.lineStyle(2, borderColor, borderAlpha);
        g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.lineStyle(0);
    }
};

const drawCrosshairBrackets = (
    g: PIXI.Graphics,
    px: number,
    py: number,
    color: number,
    alpha = 0.98,
    inset = 4,
    arm = 13,
    lineWidth = 3
) => {
    const x0 = px + inset;
    const y0 = py + inset;
    const x1 = px + TILE_SIZE - inset;
    const y1 = py + TILE_SIZE - inset;
    g.lineStyle(lineWidth, color, alpha);
    // Top-left
    g.moveTo(x0, y0 + arm);
    g.lineTo(x0, y0);
    g.lineTo(x0 + arm, y0);
    // Top-right
    g.moveTo(x1 - arm, y0);
    g.lineTo(x1, y0);
    g.lineTo(x1, y0 + arm);
    // Bottom-right
    g.moveTo(x1, y1 - arm);
    g.lineTo(x1, y1);
    g.lineTo(x1 - arm, y1);
    // Bottom-left
    g.moveTo(x0 + arm, y1);
    g.lineTo(x0, y1);
    g.lineTo(x0, y1 - arm);
    g.lineStyle(0);
};

// --- SUB-COMPONENTS FOR PERFORMANCE ---

// 1. Grid & Highlights Layer
const OverlayLayer = React.memo(({
    mapData, tileById, units, viewer, settings, weather, visibleTiles,
    selectedUnit, currentPlayer,
    validMoveTiles, validAttackTargets, validSpawnTiles,
    selectedTileId, placementMode,
    validSecureTile, validSiegeTile, validDemolishTile, validLootTile,
    gridSize
}: any) => {
    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();

        const drawHighlight = (id: string, colorStr: string, alpha = 0.4, border = false) => {
            const tile = tileById.get(id);
            if (!tile) return;

            let color = 0xFFFFFF;
            let borderColor: number | null = null;
            if (colorStr.includes('0, 100, 255')) { color = 0x0064FF; borderColor = 0x38BDF8; }
            else if (colorStr.includes('255, 0, 0')) color = 0xFF0000;
            else if (colorStr.includes('0, 255, 0')) color = 0x00FF00;
            else if (colorStr === '#F44336') color = 0xF44336;
            else if (colorStr === '#D32F2F') color = 0xD32F2F;
            else if (colorStr === '#4CAF50') color = 0x4CAF50;
            else if (colorStr === '#00BCD4') color = 0x00BCD4;
            else if (colorStr === '#FF9800') color = 0xFF9800;
            else if (colorStr === '#FFB300') color = 0xFFB300;
            else if (colorStr.includes('255, 165, 0')) color = 0xFFA500;

            drawTileBox(g, tile, color, alpha, border ? 0.95 : undefined, borderColor ?? color);
        };

        if (placementMode && placementMode.active) {
            const selectedSet = new Set<string>(Array.isArray(placementMode.selectedTiles) ? placementMode.selectedTiles : []);
            if (Array.isArray(placementMode.validTiles) && placementMode.validTiles.length > 0) {
                placementMode.validTiles.forEach((id: string) => {
                    if (selectedSet.has(id)) return;
                    drawHighlight(id, placementMode.kind === 'DROP' ? '#FFB300' : '#00BCD4', 0.28, true);
                });
            }
            selectedSet.forEach((id: string) => {
                const tile = tileById.get(id);
                if (!tile) return;
                drawHighlight(id, '#4CAF50', 0.45, true);
                drawCrosshairBrackets(g, tile.x * TILE_SIZE, tile.y * TILE_SIZE, 0x34D399, 0.98, 5, 11, 3);
            });
        }

        const selectedUnitTile = selectedUnit ? tileById.get(selectedUnit.tileId) : undefined;
        const sniperNeedsPerch = Boolean(
            selectedUnit?.type === 'SNIPER' &&
            selectedUnit.owner === currentPlayer &&
            !selectedUnit.completed &&
            !canUnitAttackFromTile(selectedUnit, selectedUnitTile)
        );

        // Unified calm blue movement zone (remaining shooting CP is indicated cleanly by the -cost corner label)
        validMoveTiles.forEach((id: string) => {
            const tile = tileById.get(id);
            if (!tile) return;
            drawTileBox(g, tile, 0x0284C7, 0.26, 0.68, 0x38BDF8);
            if (
                sniperNeedsPerch &&
                (tile.type === 'MOUNTAIN' || tile.type === 'DUNES' || (tile.type === 'BUILDING' && tile.owner === selectedUnit.owner))
            ) {
                const px = tile.x * TILE_SIZE + 10;
                const py = tile.y * TILE_SIZE + 10;
                g.beginFill(0xF59E0B, 0.95);
                g.lineStyle(1, 0xFFFBEB, 0.9);
                g.moveTo(px, py - 5);
                g.lineTo(px + 5, py);
                g.lineTo(px, py + 5);
                g.lineTo(px - 5, py);
                g.closePath();
                g.endFill();
                g.lineStyle(0);
            }
        });

        validSpawnTiles.forEach((id: string) => drawHighlight(id, UI_COLORS.SPAWN_HIGHLIGHT));
        validAttackTargets.forEach((unitId: string) => {
            const targetUnit = Array.isArray(units) ? units.find((u: any) => u.id === unitId) : null;
            if (targetUnit) {
                const targetTile = tileById.get(targetUnit.tileId);
                if (targetTile) drawTileBox(g, targetTile, 0xEF4444, 0.16);
            }
        });

        // Action Highlights
        if (validSecureTile) drawHighlight(validSecureTile, UI_COLORS.ACTION_HIGHLIGHT, 0.2, true);
        if (validSiegeTile) drawHighlight(validSiegeTile, '#D32F2F', 0.35, true);
        if (validDemolishTile) drawHighlight(validDemolishTile, '#D32F2F', 0.35, true);
        if (validLootTile) drawHighlight(validLootTile, '#4CAF50', 0.2, true);

        // Visible Overwatcher Coverage Ring on Selection
        if (selectedTileId && Array.isArray(units) && Array.isArray(mapData) && weather) {
            const selectedOverwatcher = units.find((u: any) =>
                u.tileId === selectedTileId &&
                u.isOverwatching &&
                u.ammo > 0 &&
                isUnitVisible(u, viewer, Boolean(settings?.fogOfWar), visibleTiles)
            );
            if (selectedOverwatcher) {
                const covered = getOverwatchCoverageTiles(selectedOverwatcher, mapData, weather, gridSize || 20);
                covered.forEach((tid: string) => {
                    const t = tileById.get(tid);
                    if (t) drawTileBox(g, t, 0xFFB300, 0.14, 0.95);
                });
            }
        }

        // Selection
        if (selectedTileId) {
            const st = tileById.get(selectedTileId);
            if (st) {
                g.lineStyle(2, 0xFFFFFF, 0.85);
                g.drawRect(st.x * TILE_SIZE + 2, st.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                g.lineStyle(0);
            }
        }

        // Crisp Subtle Grid Overlay (main terrain already renders under-canopy contours)
        g.lineStyle(1, 0x1E293B, 0.14);
        const totalSize = (gridSize || 20) * TILE_SIZE;
        for (let i = 0; i <= gridSize; i++) {
            g.moveTo(i * TILE_SIZE, 0);
            g.lineTo(i * TILE_SIZE, totalSize);
            g.moveTo(0, i * TILE_SIZE);
            g.lineTo(totalSize, i * TILE_SIZE);
        }
        g.lineStyle(0);

    }, [mapData, tileById, units, viewer, settings, weather, visibleTiles, selectedUnit, currentPlayer, validMoveTiles, validAttackTargets, validSpawnTiles, selectedTileId, placementMode, validSecureTile, validSiegeTile, validDemolishTile, validLootTile, gridSize]);

    return <Graphics draw={draw} eventMode="none" />;
});

const renderWaterRipples = (g: PIXI.Graphics, waterTiles: Tile[], t: number) => {
    g.clear();
    if (waterTiles.length === 0) return;

    g.lineStyle(1.8, 0xBAE6FD, 0.34);
    for (let i = 0; i < waterTiles.length; i++) {
        const tile = waterTiles[i];
        const px = tile.x * TILE_SIZE;
        const py = tile.y * TILE_SIZE;
        const shift = ((t * 14 + tile.x * 9) % 28) - 14;
        const y1 = py + 20 + Math.sin(tile.x * 1.3 + t) * 4;
        const y2 = py + 44 + Math.cos(tile.y * 1.1 + t * 0.9) * 4;
        g.moveTo(px + 10 + shift * 0.2, y1);
        g.lineTo(px + 34 + shift * 0.2, y1 + 1.5);
        g.moveTo(px + 26 - shift * 0.2, y2);
        g.lineTo(px + 52 - shift * 0.2, y2 - 1.5);
    }
    g.lineStyle(0);
};

function useThrottledGraphicsLayer(
    render: (g: PIXI.Graphics, phase: number) => void,
    animate: boolean,
    speedPerDelta: number,
    deps: React.DependencyList
) {
    const gfxRef = useRef<PIXI.Graphics>(null);
    const phaseRef = useRef(0);
    const accumRef = useRef(0);

    useEffect(() => {
        const g = gfxRef.current;
        if (g && !(g as { destroyed?: boolean }).destroyed) {
            render(g, phaseRef.current);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    useTick((delta) => {
        if (!animate) return;
        const dt = typeof delta === 'number' ? delta : 1;
        accumRef.current += dt;
        if (accumRef.current < 3) return;
        phaseRef.current += speedPerDelta * accumRef.current;
        accumRef.current = 0;

        const g = gfxRef.current;
        if (g && !(g as { destroyed?: boolean }).destroyed) {
            render(g, phaseRef.current);
        }
    });

    return gfxRef;
}

// Throttled Animated River & Shoreline Ripples (draws initial frame immediately in ECO mode)
const AnimatedWaterLayer = React.memo<{ waterTiles: Tile[]; animate: boolean }>(({ waterTiles, animate }) => {
    const render = useCallback((g: PIXI.Graphics, phase: number) => renderWaterRipples(g, waterTiles, phase), [waterTiles]);
    const gfxRef = useThrottledGraphicsLayer(render, animate, 0.035, [waterTiles]);
    return <Graphics ref={gfxRef} eventMode="none" />;
});

// 2. Zone, Hazards & Soft Feathered Fog Layer
const ZoneAndFogLayer = React.memo(({ mapData, visibleTiles, weather, settings, gridSize }: any) => {
    const totalSize = (gridSize || 20) * TILE_SIZE;
    const softFogTexture = useMemo(
        () => (settings.fogOfWar ? bakeSoftFogTexture(mapData, visibleTiles, gridSize || 20) : null),
        [settings.fogOfWar, mapData, visibleTiles, gridSize]
    );

    useEffect(() => {
        return () => {
            softFogTexture?.destroy(true);
        };
    }, [softFogTexture]);

    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();

        // Zones, Hazards & Weather Tints (sculpted mountains/dunes render their own relief)
        mapData.forEach((tile: Tile) => {
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;

            if (tile.hazardState === 'LAVA') {
                g.beginFill(0xFF0000, 0.52);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.endFill();
            } else if (tile.hazardState === 'WARNING') {
                g.beginFill(0xFFEB3B, 0.28);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.endFill();
            }

            if (tile.zone !== undefined) {
                const wType = weather.playerZones[tile.zone] || 'CLEAR';
                if (wType !== 'CLEAR') {
                    let color = 0xFFFFFF;
                    let alpha = 0.16;
                    if (wType === 'SCORCHED') { color = 0xFF5000; alpha = 0.16; }
                    if (wType === 'MONSOON') { color = 0x141E3C; alpha = 0.30; }
                    if (wType === 'FOG') { color = 0xCBD5E1; alpha = 0.22; }
                    if (wType === 'TAILWIND') { color = 0x64FF96; alpha = 0.10; }
                    if (wType === 'SANDSTORM') { color = 0xD4A35B; alpha = 0.18; }

                    g.beginFill(color, alpha);
                    g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                    g.endFill();
                }
            }
        });
    }, [mapData, weather]);

    return (
        <Container eventMode="none">
            <Graphics draw={draw} eventMode="none" />
            {softFogTexture && (
                <SafeSprite texture={softFogTexture} x={0} y={0} width={totalSize} height={totalSize} eventMode="none" />
            )}
        </Container>
    );
});

// Batched UI Markers Layer (completely decoupled from hoveredTileId!)
const UIMarkersLayer = React.memo<{
    mapData: Tile[];
    tileById: Map<string, Tile>;
    visibleTiles: Set<string>;
    fogOfWar: boolean;
    victoryMode: string;
    pendingDrops: { playerId: number; item: 'AMMO' | 'MEDKIT' | 'FIRST_AID'; tileId: string }[];
    ownMines: LandMine[];
    mapRotation: BoardRotation;
}>(({ mapData, tileById, visibleTiles, fogOfWar, victoryMode, pendingDrops, ownMines, mapRotation }) => {
    const visibleDrops = useMemo(() => {
        const list: { key: string; tile: Tile; label: string }[] = [];
        for (let i = 0; i < pendingDrops.length; i++) {
            const d = pendingDrops[i];
            if (fogOfWar && !visibleTiles.has(d.tileId)) continue;
            const tile = tileById.get(d.tileId);
            if (tile) {
                list.push({
                    key: `drop_${i}_${d.tileId}_${d.item}`,
                    tile,
                    label: d.item === 'MEDKIT' ? 'DROP +HP' : d.item === 'FIRST_AID' ? 'DROP +50%' : 'DROP AMMO',
                });
            }
        }
        return list;
    }, [pendingDrops, fogOfWar, visibleTiles, tileById]);

    const visibleMines = useMemo(() => {
        const list: { key: string; tile: Tile }[] = [];
        for (let i = 0; i < ownMines.length; i++) {
            const m = ownMines[i];
            const tile = tileById.get(m.tileId);
            if (tile) list.push({ key: m.id, tile });
        }
        return list;
    }, [ownMines, tileById]);

    const drawMarkers = useCallback((g: PIXI.Graphics) => {
        g.clear();
        for (let i = 0; i < mapData.length; i++) {
            const tile = mapData[i];
            if (fogOfWar && !visibleTiles.has(tile.id)) continue;
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;

            if (tile.type === 'BUILDING' && tile.owner !== undefined) {
                const color = hexToPixiColor(PLAYER_COLORS[tile.owner] || '#FFFFFF');
                g.lineStyle(4, color, 1);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.lineStyle(0);
                g.beginFill(color, 0.2);
                g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                g.endFill();
            }

            if (tile.type === 'BASE' && victoryMode === 'CONQUER' && tile.hp !== undefined && tile.maxHp) {
                const pct = Math.max(0, Math.min(1, tile.hp / tile.maxHp));
                const ownerColor = hexToPixiColor(PLAYER_COLORS[tile.owner!] || '#FF0000');
                const span = TILE_SIZE - 8;
                const inner = (TILE_SIZE - 10) * pct;
                g.lineStyle(0);
                if (mapRotation === 90 || mapRotation === 270) {
                    const bx = mapRotation === 90 ? px + 4 : px + TILE_SIZE - 10;
                    g.beginFill(0x000000, 0.8);
                    g.drawRect(bx, py + 4, 6, span);
                    g.endFill();
                    g.beginFill(ownerColor);
                    g.drawRect(bx + 1, py + 5, 4, inner);
                    g.endFill();
                } else {
                    const by = mapRotation === 180 ? py + TILE_SIZE - 10 : py + 4;
                    g.beginFill(0x000000, 0.8);
                    g.drawRect(px + 4, by, span, 6);
                    g.endFill();
                    g.beginFill(ownerColor);
                    g.drawRect(px + 5, by + 1, inner, 4);
                    g.endFill();
                }
            }
        }

        for (let i = 0; i < visibleDrops.length; i++) {
            const { tile } = visibleDrops[i];
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;
            drawCrosshairBrackets(g, px, py, 0x22D3EE, 0.95, 6, 10, 2);
            g.beginFill(0x0891B2, 0.22);
            g.drawCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 14);
            g.endFill();
        }

        for (let i = 0; i < visibleMines.length; i++) {
            const { tile } = visibleMines[i];
            const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
            const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
            g.lineStyle(2, 0xEF4444, 0.95);
            g.beginFill(0x7F1D1D, 0.55);
            g.drawCircle(cx, cy, 11);
            g.endFill();
            g.lineStyle(0);
            g.beginFill(0xFBBF24, 0.98);
            g.drawCircle(cx, cy, 4);
            g.endFill();
        }
    }, [mapData, visibleTiles, fogOfWar, victoryMode, visibleDrops, visibleMines, mapRotation]);

    const lootTiles = useMemo(
        () => mapData.filter(tile => Boolean(tile.loot) && (!fogOfWar || visibleTiles.has(tile.id))),
        [mapData, fogOfWar, visibleTiles]
    );

    return (
        <Container name="ui_markers" eventMode="none">
            <Graphics draw={drawMarkers} eventMode="none" />
            {lootTiles.map(tile => (
                <Text
                    key={`loot_${tile.id}`}
                    text="?"
                    anchor={0.5}
                    angle={-mapRotation}
                    x={tile.x * TILE_SIZE + TILE_SIZE / 2}
                    y={tile.y * TILE_SIZE + TILE_SIZE / 2}
                    style={LOOT_MARKER_STYLE}
                />
            ))}
            {visibleDrops.map(({ key, tile, label }) => (
                <Container
                    key={key}
                    x={tile.x * TILE_SIZE + TILE_SIZE / 2}
                    y={tile.y * TILE_SIZE + TILE_SIZE / 2}
                    angle={-mapRotation}
                >
                    <Text
                        text={label}
                        anchor={DROP_MARKER_ANCHOR}
                        x={0}
                        y={TILE_SIZE / 2 - 5}
                        style={DROP_MARKER_STYLE}
                    />
                </Container>
            ))}
            {visibleMines.map(({ key, tile }) => (
                <Container
                    key={key}
                    x={tile.x * TILE_SIZE + TILE_SIZE / 2}
                    y={tile.y * TILE_SIZE + TILE_SIZE / 2}
                    angle={-mapRotation}
                >
                    <Text
                        text="MINE"
                        anchor={DROP_MARKER_ANCHOR}
                        x={0}
                        y={TILE_SIZE / 2 - 5}
                        style={MINE_MARKER_STYLE}
                    />
                </Container>
            ))}
        </Container>
    );
});

// Top-of-sprite targeting reticles so units never cover attackable targets
const TargetingOverlayLayer = React.memo<{
    tileById: Map<string, Tile>;
    units: any[];
    validAttackTargets: string[];
    validSiegeTile: string | null;
    validDemolishTile: string | null;
}>(({ tileById, units, validAttackTargets, validSiegeTile, validDemolishTile }) => {
    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();
        for (let i = 0; i < validAttackTargets.length; i++) {
            const targetUnit = units.find(u => u.id === validAttackTargets[i]);
            if (!targetUnit) continue;
            const tile = tileById.get(targetUnit.tileId);
            if (!tile) continue;
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;
            drawCrosshairBrackets(g, px, py, 0xFEE2E2, 0.9, 3, 12, 4.5);
            drawCrosshairBrackets(g, px, py, 0xEF4444, 1, 3, 12, 2.5);
            g.lineStyle(1.5, 0xEF4444, 0.72);
            g.drawCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 11);
            g.lineStyle(0);
        }

        const structureTargets = [validSiegeTile, validDemolishTile].filter(Boolean) as string[];
        for (let i = 0; i < structureTargets.length; i++) {
            const tile = tileById.get(structureTargets[i]);
            if (!tile) continue;
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;
            drawCrosshairBrackets(g, px, py, 0xFFEDD5, 0.9, 3, 12, 4.5);
            drawCrosshairBrackets(g, px, py, 0xF97316, 1, 3, 12, 2.5);
        }
    }, [tileById, units, validAttackTargets, validSiegeTile, validDemolishTile]);

    return <Graphics draw={draw} eventMode="none" />;
});

// Isolated Hover & Path Preview Layer (prevents hoveredTileId changes from re-rendering the whole Stage tree)
const HoverOverlayLayer = React.memo<{
    tileById: Map<string, Tile>;
    hitPlaneRef: React.RefObject<PIXI.Graphics | null>;
    containerRef: React.RefObject<HTMLDivElement | null>;
}>(({ tileById, hitPlaneRef, containerRef }) => {
    const hoveredTileId = useGameStore(state => state.hoveredTileId);
    const selectedUnitId = useGameStore(state => state.selectedUnitId);
    const selectedTileId = useGameStore(state => state.selectedTileId);
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const viewer = useGameStore(viewerSeat);
    const validMoveCosts = useGameStore(state => state.validMoveCosts);
    const validMoveParents = useGameStore(state => state.validMoveParents);
    const validMoveTiles = useGameStore(state => state.validMoveTiles);
    const validAttackTargets = useGameStore(state => state.validAttackTargets);
    const validSiegeTile = useGameStore(state => state.validSiegeTile);
    const validDemolishTile = useGameStore(state => state.validDemolishTile);
    const placementMode = useGameStore(state => state.placementMode);
    const isAiTurn = useGameStore(state => state.isAiTurn);
    const winner = useGameStore(state => state.winner);
    const units = useGameStore(state => state.units);
    const mapData = useGameStore(state => state.mapData);
    const weather = useGameStore(state => state.weather);
    const gridSize = useGameStore(state => state.gridSize) || 20;
    const settings = useGameStore(state => state.settings);
    const playerCp = useGameStore(state => state.playerCp);
    const visibleTiles = useGameStore(state => state.visibleTiles);

    const selectedUnit = useMemo(
        () => (selectedUnitId ? units.find(u => u.id === selectedUnitId) : undefined),
        [units, selectedUnitId]
    );

    const hoveredEnemy = useMemo(() => {
        if (!hoveredTileId) return undefined;
        return units.find(u => u.tileId === hoveredTileId && validAttackTargets.includes(u.id));
    }, [units, hoveredTileId, validAttackTargets]);

    const hoverMoveResolution = useMemo(() => {
        if (!selectedUnit || selectedUnit.owner !== currentPlayer || selectedUnit.hasMoved) return null;
        if (!hoveredTileId || !validMoveCosts.has(hoveredTileId)) return null;
        return getHoverMoveResolution({
            movingUnit: selectedUnit,
            targetTileId: hoveredTileId,
            validMoveCosts,
            validMoveParents,
            mapData,
            units,
            weather,
            gridSize,
            fogOfWar: settings.fogOfWar,
            maxBudget: playerCp[currentPlayer] ?? 0,
            visibleTiles: settings.fogOfWar ? visibleTiles : null,
        });
    }, [selectedUnit, currentPlayer, hoveredTileId, validMoveCosts, validMoveParents, mapData, units, weather, gridSize, settings.fogOfWar, playerCp, visibleTiles]);

    const hoverPath = hoverMoveResolution?.path;

    useEffect(() => {
        let nextCursor = 'default';
        if (!isAiTurn && winner === null && hoveredTileId) {
            if (hoveredEnemy || hoveredTileId === validSiegeTile || hoveredTileId === validDemolishTile) {
                nextCursor = 'crosshair';
            } else if (
                validMoveTiles.includes(hoveredTileId) ||
                placementMode?.validTiles?.includes(hoveredTileId)
            ) {
                nextCursor = 'pointer';
            }
        }
        if (hitPlaneRef.current) hitPlaneRef.current.cursor = nextCursor;
        if (containerRef.current) containerRef.current.style.cursor = nextCursor;
    }, [isAiTurn, winner, hoveredTileId, hoveredEnemy, validSiegeTile, validDemolishTile, validMoveTiles, placementMode, hitPlaneRef, containerRef]);

    useEffect(() => {
        wakeBattleRenderer(0);
    }, [hoveredTileId, hoverPath, validAttackTargets]);

    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();
        if (!hoveredTileId) return;

        const ht = tileById.get(hoveredTileId);
        // Automated Turret / Base Artillery Danger Range Ring on Hover
        if (ht) {
            let dangerRange = 0;
            if (ht.type === 'BANK' && (ht.hackProgress || 0) < 100) {
                dangerRange = BANK_STATS.RANGE;
            } else if (
                ht.type === 'BASE' &&
                settings.victoryMode === 'CONQUER' &&
                ht.owner !== currentPlayer &&
                (ht.hp || 0) > 0
            ) {
                dangerRange = BASE_STATS.RANGE;
            }
            if (dangerRange > 0) {
                for (let dy = -dangerRange; dy <= dangerRange; dy++) {
                    const ny = ht.y + dy;
                    if (ny < 0 || ny >= gridSize) continue;
                    const maxDx = dangerRange - Math.abs(dy);
                    for (let dx = -maxDx; dx <= maxDx; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = ht.x + dx;
                        if (nx < 0 || nx >= gridSize) continue;
                        const t = mapData[ny * gridSize + nx];
                        if (t) drawTileBox(g, t, 0xFF9800, 0.14, 0.95);
                    }
                }
            }
        }

        if (hoveredTileId !== selectedTileId) {
            const hoveredOverwatcher = units.find(u =>
                u.tileId === hoveredTileId &&
                u.isOverwatching &&
                u.ammo > 0 &&
                isUnitVisible(u, viewer, settings.fogOfWar, visibleTiles)
            );
            if (hoveredOverwatcher) {
                const covered = getOverwatchCoverageTiles(hoveredOverwatcher, mapData, weather, gridSize);
                covered.forEach((tid: string) => {
                    const t = tileById.get(tid);
                    if (t) drawTileBox(g, t, 0xFFB300, 0.14, 0.9);
                });
            }
        }

        const selectedUnitTile = selectedUnit ? tileById.get(selectedUnit.tileId) : undefined;
        if (
            ht &&
            hoveredEnemy &&
            selectedUnit &&
            selectedUnitTile &&
            selectedUnit.owner === currentPlayer &&
            !selectedUnit.completed
        ) {
            const attackPreview = computeUnitAttackPreview({
                attacker: selectedUnit,
                attTile: selectedUnitTile,
                target: hoveredEnemy,
                tarTile: ht,
                units,
                mapData,
                weather,
                gridSize,
            });
            const sx = selectedUnitTile.x * TILE_SIZE + TILE_SIZE / 2;
            const sy = selectedUnitTile.y * TILE_SIZE + TILE_SIZE / 2;
            const tx = ht.x * TILE_SIZE + TILE_SIZE / 2;
            const ty = ht.y * TILE_SIZE + TILE_SIZE / 2;
            g.lineStyle(7, 0xEF4444, 0.28);
            g.moveTo(sx, sy);
            g.lineTo(tx, ty);
            g.lineStyle(2.5, 0xFCA5A5, 0.95);
            g.moveTo(sx, sy);
            g.lineTo(tx, ty);
            g.lineStyle(0);

            for (let i = 0; i < attackPreview.supporters.length; i++) {
                const allyTile = attackPreview.supporters[i];
                const ax = allyTile.x * TILE_SIZE + TILE_SIZE / 2;
                const ay = allyTile.y * TILE_SIZE + TILE_SIZE / 2;
                g.lineStyle(2, 0xF59E0B, 0.85);
                g.moveTo(ax, ay);
                g.lineTo(tx, ty);
                g.lineStyle(2, 0xF59E0B, 0.9);
                g.drawCircle(ax, ay, 24);
                g.lineStyle(0);
            }

            drawCrosshairBrackets(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE, 0xEF4444, 0.98, 2, 14, 3.5);
        } else if (
            ht &&
            selectedUnit &&
            selectedUnit.owner === currentPlayer &&
            !hoveredEnemy
        ) {
            const hoveredAnyEnemy = units.find(
                u =>
                    u.tileId === hoveredTileId &&
                    u.owner !== currentPlayer &&
                    isUnitVisible(u, viewer, settings.fogOfWar, visibleTiles)
            );
            if (hoveredAnyEnemy) {
                drawCrosshairBrackets(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE, 0xF59E0B, 0.88, 3, 11, 2.5);
            } else if (
                selectedUnitTile &&
                !selectedUnit.completed &&
                (hoveredTileId === validSiegeTile || hoveredTileId === validDemolishTile)
            ) {
                const sx = selectedUnitTile.x * TILE_SIZE + TILE_SIZE / 2;
                const sy = selectedUnitTile.y * TILE_SIZE + TILE_SIZE / 2;
                const tx = ht.x * TILE_SIZE + TILE_SIZE / 2;
                const ty = ht.y * TILE_SIZE + TILE_SIZE / 2;
                g.lineStyle(6, 0xF97316, 0.28);
                g.moveTo(sx, sy);
                g.lineTo(tx, ty);
                g.lineStyle(2.5, 0xFDBA74, 0.95);
                g.moveTo(sx, sy);
                g.lineTo(tx, ty);
                g.lineStyle(0);
            } else if (hoverPath && hoverPath.length > 1) {
                const trig = hoverMoveResolution?.trigger;
                const safeEndIdx = trig ? Math.min(hoverPath.length - 1, trig.interceptIndex) : hoverPath.length - 1;

                g.lineStyle(4, 0x00E5FF, 0.9);
                for (let idx = 0; idx <= safeEndIdx; idx++) {
                    const pt = hoverPath[idx];
                    const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                    const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                    if (idx === 0) g.moveTo(cx, cy);
                    else g.lineTo(cx, cy);
                }
                g.lineStyle(0);

                if (trig && safeEndIdx < hoverPath.length - 1) {
                    g.lineStyle(4, 0xFF5722, 0.9);
                    for (let idx = safeEndIdx; idx < hoverPath.length; idx++) {
                        const pt = hoverPath[idx];
                        const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                        const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                        if (idx === safeEndIdx) g.moveTo(cx, cy);
                        else g.lineTo(cx, cy);
                    }
                    g.lineStyle(0);
                }

                for (let idx = 1; idx < hoverPath.length; idx++) {
                    const pt = hoverPath[idx];
                    const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                    const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                    const isIntercept = trig && idx === trig.interceptIndex;
                    const isDest = idx === hoverPath.length - 1;
                    const dotColor = isIntercept ? 0xFF5722 : isDest ? 0x00E5FF : 0xFFFFFF;
                    g.beginFill(dotColor, isIntercept || isDest ? 0.95 : 0.75);
                    g.drawCircle(cx, cy, isIntercept || isDest ? 7 : 4);
                    g.endFill();
                }

                if (!selectedUnit.completed) {
                    const moveCost = validMoveCosts.get(ht.id) ?? 1;
                    const postMoveTargets = getPostMoveTargetTiles({
                        unit: selectedUnit,
                        destTile: ht,
                        remainingCp: Math.max(0, (playerCp[currentPlayer] ?? 0) - moveCost),
                        mapData,
                        units,
                        weather,
                        gridSize,
                        fogOfWar: settings.fogOfWar,
                        visibleTiles: settings.fogOfWar ? visibleTiles : null,
                    });
                    for (let i = 0; i < postMoveTargets.length; i++) {
                        const et = postMoveTargets[i];
                        const ex = et.x * TILE_SIZE + TILE_SIZE / 2;
                        const ey = et.y * TILE_SIZE + TILE_SIZE / 2;
                        g.lineStyle(2, 0xFB7185, 0.85);
                        g.drawCircle(ex, ey, 16);
                        g.lineStyle(0);
                    }
                }
            }
        } else if (hoverPath && hoverPath.length > 1) {
            const trig = hoverMoveResolution?.trigger;
            const safeEndIdx = trig ? Math.min(hoverPath.length - 1, trig.interceptIndex) : hoverPath.length - 1;

            g.lineStyle(4, 0x00E5FF, 0.9);
            for (let idx = 0; idx <= safeEndIdx; idx++) {
                const pt = hoverPath[idx];
                const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                if (idx === 0) g.moveTo(cx, cy);
                else g.lineTo(cx, cy);
            }
            g.lineStyle(0);
        }

        if (ht) {
            g.lineStyle(1.5, 0xFFFFFF, 0.52);
            g.drawRect(ht.x * TILE_SIZE + 1, ht.y * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            g.lineStyle(0);
        }
    }, [hoveredTileId, selectedTileId, selectedUnit, hoveredEnemy, validSiegeTile, validDemolishTile, currentPlayer, units, settings.fogOfWar, settings.victoryMode, viewer, visibleTiles, mapData, weather, gridSize, tileById, hoverPath, hoverMoveResolution, validMoveCosts, playerCp]);

    return <Graphics draw={draw} eventMode="none" />;
});

/**
 * Renders units that were lethally hit in the authoritative state while the lethal shot
 * or compound Overwatch/Mine march is still in flight, so units never vanish before impact.
 */
/** Re-export live PixiJS Application accessor for clip export. */
export { getLivePixiApp };

const PendingDeathsLayer = React.memo<{
    aliveUnitIds: Set<string>;
    gridSize: number;
    mapRotation: BoardRotation;
}>(({ aliveUnitIds, gridSize, mapRotation }) => {
    const pendingDeaths = useEffectStore(state => state.pendingDeaths);
    if (pendingDeaths.length === 0) return null;
    return (
        <>
            {pendingDeaths.map(ghost => {
                if (aliveUnitIds.has(ghost.unitId)) return null;
                const baseStats = UNIT_STATS[ghost.unitType];
                const fullMaxHp = getUnitMaxHp({ type: ghost.unitType, rank: ghost.rank } as any);
                const maxAmmo = ghost.maxAmmo ?? baseStats.maxAmmo;
                const ammo = ghost.ammo ?? maxAmmo;
                return (
                    <UnitSprite
                        key={`pending_${ghost.unitId}`}
                        unit={{
                            id: ghost.unitId,
                            type: ghost.unitType,
                            owner: ghost.owner,
                            hp: ghost.displayHp,
                            maxHp: fullMaxHp,
                            ammo,
                            maxAmmo,
                            rank: ghost.rank,
                            hasMoved: true,
                            completed: false,
                            isOverwatching: false,
                        }}
                        gridSize={gridSize}
                        texture={getTexture(`UNIT_P${ghost.owner}_${ghost.unitType}`)}
                        x={ghost.endTileX * TILE_SIZE}
                        y={ghost.endTileY * TILE_SIZE}
                        tileX={ghost.endTileX}
                        tileY={ghost.endTileY}
                        mapRotation={mapRotation}
                        initialFacingRad={ghost.facingRad}
                        isSelected={false}
                        isReadyTurn={false}
                    />
                );
            })}
        </>
    );
});

/** Isolated FX layer so transient projectiles/popups/crossfire do not re-render the map, units, or viewport. */
const EffectsLayer = React.memo<{
    selectedUnitPos: { x: number; y: number } | null;
    fxMode: FxMode;
    mapRotation: BoardRotation;
    particlePoolRef: React.MutableRefObject<ParticlePool | null>;
}>(
    ({ selectedUnitPos, fxMode, mapRotation, particlePoolRef }) => {
        const damagePopups = useEffectStore(state => state.damagePopups);
        const projectiles = useEffectStore(state => state.projectiles);
        const crossfireLocks = useEffectStore(state => state.crossfireLocks);
        return (
            <Container name="effects" eventMode="none">
                {selectedUnitPos && (
                    <SelectionCursor x={selectedUnitPos.x} y={selectedUnitPos.y} pulse={fxMode === 'LIVE'} />
                )}
                {crossfireLocks.map(lock => (
                    <CrossfireBeam key={lock.id} data={lock} />
                ))}
                {projectiles.map(proj => (
                    <ProjectileRenderer key={proj.id} data={proj} mapRotation={mapRotation} />
                ))}
                <ParticleLayer mapRotation={mapRotation} poolRef={particlePoolRef} />
                <DropAndPromoLayer mapRotation={mapRotation} />
                {damagePopups.map(popup => (
                    <DamageText key={popup.id} data={popup} mapRotation={mapRotation} />
                ))}
            </Container>
        );
    }
);

/**
 * Demand-driven + adaptive-FPS PixiJS Stage lifecycle & FX timeline driver:
 * - ECO idle: 0% GPU (`ticker.stop()`)
 * - Active combat / movement / pan (both ECO & LIVE): silky 60 FPS with wake delta-spike clamp
 * - LIVE idle: 24 FPS ambient map life
 */
const BattleRenderController: React.FC<{
    fxMode: FxMode;
    viewport: any;
    unitsAnimKey: string;
    sceneRenderDeps: unknown[];
    particlePoolRef: React.MutableRefObject<ParticlePool | null>;
    tileById: Map<string, Tile>;
}> = ({ fxMode, viewport, unitsAnimKey, sceneRenderDeps, particlePoolRef, tileById }) => {
    const app = useApp();
    const hasProjectiles = useEffectStore(state => state.projectiles.length > 0);
    const hasPopups = useEffectStore(state => state.damagePopups.length > 0);
    const hasCrossfire = useEffectStore(state => state.crossfireLocks.length > 0);
    const hasPendingDeaths = useEffectStore(state => state.pendingDeaths.length > 0);
    const hasDeathGhosts = useEffectStore(state => state.deathGhosts.length > 0);
    const hasTileEffects = useEffectStore(state => state.tileEffects.length > 0);
    const hasSupplyDrops = useEffectStore(state => state.supplyDrops.length > 0);
    const hasPromotions = useEffectStore(state => state.promotionBursts.length > 0);
    const activeFx =
        hasProjectiles ||
        hasPopups ||
        hasCrossfire ||
        hasPendingDeaths ||
        hasDeathGhosts ||
        hasTileEffects ||
        hasSupplyDrops ||
        hasPromotions;

    const wakeUntilRef = useRef<number>(0);
    const singleRafRef = useRef<number | null>(null);
    const justWokeRef = useRef<boolean>(false);
    const fxModeRef = useRef<FxMode>(fxMode);
    const activeFxRef = useRef<boolean>(activeFx);
    const tileByIdRef = useRef<Map<string, Tile>>(tileById);
    fxModeRef.current = fxMode;
    activeFxRef.current = activeFx;
    tileByIdRef.current = tileById;

    const scheduleSingleFrame = useCallback(() => {
        if (fxModeRef.current === 'LIVE') return;
        if (singleRafRef.current !== null) return;
        singleRafRef.current = requestAnimationFrame(() => {
            singleRafRef.current = null;
            const renderer = (app as any)?.renderer;
            const stage = (app as any)?.stage;
            if (renderer && !renderer.destroyed && stage) {
                renderer.render(stage);
            }
        });
    }, [app]);

    const wake = useCallback((durationMs = 600) => {
        const ticker = (app as any)?.ticker;
        if (!ticker || ticker.destroyed) return;
        if (durationMs > 0) {
            wakeUntilRef.current = Math.max(wakeUntilRef.current, performance.now() + durationMs);
        }
        if (fxModeRef.current === 'LIVE') {
            if (durationMs > 0) ticker.maxFPS = 60;
            if (!ticker.started) {
                justWokeRef.current = true;
                ticker.start();
            }
            return;
        }
        if (durationMs <= 0) {
            scheduleSingleFrame();
            return;
        }
        ticker.maxFPS = 60;
        if (!ticker.started) {
            justWokeRef.current = true;
            ticker.start();
        }
    }, [app, scheduleSingleFrame]);

    // Connect pooled particle sink & terrain lookup to fxTimeline + clear cleanly on unmount or tab hide
    useEffect(() => {
        fxTimeline.configure({
            emitParticles: (req) => particlePoolRef.current?.emit(req),
            hasActiveParticles: () => Boolean(particlePoolRef.current?.hasActiveCombatParticles()),
            getTileTerrain: (tx, ty) => tileByIdRef.current.get(`${tx},${ty}`)?.type,
        });
        const unsubTimelineActive = fxTimeline.subscribeActive((active) => {
            if (active) wake(350);
        });

        const onVisibilityChange = () => {
            if (document.hidden) {
                fxTimeline.clear();
                particlePoolRef.current?.clear();
                wakeUntilRef.current = 0;
                const ticker = (app as any)?.ticker;
                if (fxModeRef.current === 'ECO' && ticker && !ticker.destroyed && ticker.started) {
                    ticker.stop();
                }
            } else {
                justWokeRef.current = true;
                scheduleSingleFrame();
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            unsubTimelineActive();
            document.removeEventListener('visibilitychange', onVisibilityChange);
            fxTimeline.configure({
                emitParticles: undefined,
                hasActiveParticles: undefined,
                getTileTerrain: undefined,
            });
            fxTimeline.clear();
            particlePoolRef.current?.clear();
        };
    }, [app, particlePoolRef, wake, scheduleSingleFrame]);

    // Stop PixiJS global Ticker.shared so no stray background RAF loop runs & register app for clip export
    useEffect(() => {
        setLivePixiApp(app);
        try {
            PIXI.Ticker.shared.autoStart = false;
            PIXI.Ticker.shared.stop();
        } catch {
            // Safe guard
        }
        return () => {
            if (getLivePixiApp() === app) setLivePixiApp(null);
            if (singleRafRef.current !== null) {
                cancelAnimationFrame(singleRafRef.current);
                singleRafRef.current = null;
            }
        };
    }, [app]);

    // Central clamped timeline & particle stepping + adaptive FPS / ECO auto-sleep
    useTick(() => {
        const ticker = (app as any)?.ticker;
        if (!ticker || ticker.destroyed) return;

        let rawMs = ticker.deltaMS;
        if (justWokeRef.current) {
            justWokeRef.current = false;
            rawMs = 16.67;
        }
        const { combatDtMs } = fxTimeline.step(rawMs);
        if (combatDtMs > 0) {
            particlePoolRef.current?.update(combatDtMs);
        }

        const fxBusy = activeFxRef.current || fxTimeline.isActive();
        const withinWake = performance.now() < wakeUntilRef.current;

        if (fxModeRef.current === 'LIVE') {
            const targetFps = fxBusy || withinWake ? 60 : 24;
            if (ticker.maxFPS !== targetFps) ticker.maxFPS = targetFps;
        } else {
            if (ticker.maxFPS !== 60) ticker.maxFPS = 60;
            if (!fxBusy && !withinWake) {
                wakeUntilRef.current = 0;
                ticker.stop();
                scheduleSingleFrame();
            }
        }
    });

    // Configure ticker startup on ECO <-> LIVE mode change
    useEffect(() => {
        const ticker = (app as any)?.ticker;
        if (!ticker || ticker.destroyed) return;
        if (fxMode === 'LIVE') {
            ticker.maxFPS = 24;
            if (!ticker.started) {
                justWokeRef.current = true;
                ticker.start();
            }
            return;
        }
        // ECO: kick off one clean settle window then drop to 0% idle GPU
        wake(450);
    }, [app, fxMode, wake]);

    // Wake for unit movement / spawns / combat FX
    useEffect(() => {
        wake(850);
    }, [unitsAnimKey, wake]);

    useEffect(() => {
        if (activeFx) wake(1200);
    }, [activeFx, wake]);

    // Coalesced single-frame render on board/fog/selection/overlay changes
    useEffect(() => {
        scheduleSingleFrame();
    }, [scheduleSingleFrame, ...sceneRenderDeps]);

    // Wake smoothly during viewport pan/drag/zoom momentum & keyboard pan
    useEffect(() => {
        const unsubWake = subscribeRendererWake((ms) => wake(ms ?? 0));

        const onKey = (e: KeyboardEvent) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || k === 'a' || k === 's' || k === 'd' || k.startsWith('arrow')) {
                wake(550);
            }
        };
        window.addEventListener('keydown', onKey);

        const onVpActive = () => wake(550);
        if (viewport) {
            viewport.on('drag-start', onVpActive);
            viewport.on('wheel-start', onVpActive);
            viewport.on('pinch-start', onVpActive);
            viewport.on('zoomed-start', onVpActive);
            viewport.on('moved', onVpActive);
            viewport.on('zoomed', onVpActive);
        }

        return () => {
            unsubWake();
            window.removeEventListener('keydown', onKey);
            if (viewport && !viewport.destroyed) {
                viewport.off('drag-start', onVpActive);
                viewport.off('wheel-start', onVpActive);
                viewport.off('pinch-start', onVpActive);
                viewport.off('zoomed-start', onVpActive);
                viewport.off('moved', onVpActive);
                viewport.off('zoomed', onVpActive);
            }
        };
    }, [viewport, wake]);

    return null;
};

export const GameRenderer = () => {
    const parentRef = useRef<HTMLDivElement>(null);
    const { setViewport, viewport } = useViewportContext();
    const [loaded, setLoaded] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 200, height: 200 });

    // State Selectors (decoupled from hoveredTileId so cursor sweep never re-renders the whole Stage)
    const mapData = useGameStore(state => state.mapData);
    const units = useGameStore(state => state.units);
    const gridSize = useGameStore(state => state.gridSize) || 20;
    const handleTileClick = useGameStore(state => state.handleTileClick);

    const setHoveredTile = useGameStore(state => state.setHoveredTile);
    const viewer = useGameStore(viewerSeat);
    const mode = useGameStore(state => state.mode);
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const playerCp = useGameStore(state => state.playerCp);
    const pendingDrops = useGameStore(state => state.pendingDrops);
    const mines = useGameStore(state => state.mines);
    const isAiTurn = useGameStore(state => state.isAiTurn);
    const winner = useGameStore(state => state.winner);
    const visibleTiles = useGameStore(state => state.visibleTiles);
    const settings = useGameStore(state => state.settings);
    const selectedUnitId = useGameStore(state => state.selectedUnitId);

    // Highlights
    const validMoveTiles = useGameStore(state => state.validMoveTiles);
    const validMoveCosts = useGameStore(state => state.validMoveCosts);
    const validAttackTargets = useGameStore(state => state.validAttackTargets);
    const validSpawnTiles = useGameStore(state => state.validSpawnTiles);
    const selectedTileId = useGameStore(state => state.selectedTileId);
    const placementMode = useGameStore(state => state.placementMode);
    const selectNextReadyUnit = useGameStore(state => state.selectNextReadyUnit);
    const enterOverwatch = useGameStore(state => state.enterOverwatch);
    const undoLastMove = useGameStore(state => state.undoLastMove);
    const clearSelection = useGameStore(state => state.clearSelection);
    const mapRotation = useGameStore(state => state.mapRotation);
    const rotateMap = useGameStore(state => state.rotateMap);

    // Actions
    const validSecureTile = useGameStore(state => state.validSecureTile);
    const validSiegeTile = useGameStore(state => state.validSiegeTile);
    const validDemolishTile = useGameStore(state => state.validDemolishTile);

    // Visual Effects & Render Mode (dark tactical table slate prevents light-grey edge void!)
    const fxMode = useEffectStore(state => state.fxMode);
    const stageOptions = useLowPowerStageOptions(0x0B1220, fxMode === 'ECO' ? 1.25 : 1.5);

    const terrainSig = useMemo(() => computeTerrainSignature(mapData, gridSize, mapRotation), [mapData, gridSize, mapRotation]);
    const bakedBoard = useMemo(() => bakeTacticalReconBoard(mapData, gridSize, mapRotation), [terrainSig]);
    const waterTiles = useMemo(() => mapData.filter(t => t.type === 'WATER'), [terrainSig]);
    const tileById = useMemo(() => {
        const map = new Map<string, Tile>();
        for (let i = 0; i < mapData.length; i++) map.set(mapData[i].id, mapData[i]);
        return map;
    }, [mapData]);

    const isMyTurn = !isAiTurn && winner === null;
    const visiblePendingDrops = useMemo(() => {
        const ownerSeat = mode === 'ONLINE' ? viewer : currentPlayer;
        return pendingDrops.filter(d => d.playerId === ownerSeat);
    }, [pendingDrops, mode, viewer, currentPlayer]);
    const visibleOwnMines = useMemo(
        () => (mines ?? []).filter(m => m.owner === viewer),
        [mines, viewer]
    );

    useEffect(() => {
        return () => {
            bakedBoard.terrainTexture.destroy(true);
            bakedBoard.waterMaskTexture.destroy(true);
        };
    }, [bakedBoard]);

    // Derived Selection Data
    const selectedUnit = selectedUnitId
        ? units.find(u => u.id === selectedUnitId && isUnitVisible(u, viewer, settings.fogOfWar, visibleTiles))
        : undefined;
    let selectedUnitPos = null;
    if (selectedUnit) {
        const t = tileById.get(selectedUnit.tileId);
        if (t) selectedUnitPos = { x: t.x * TILE_SIZE, y: t.y * TILE_SIZE };
    }
    const validLootTile = useGameStore(state => state.validLootTile);
    
    const weather = useGameStore(state => state.weather);
    const hitPlaneRef = useRef<PIXI.Graphics>(null);
    const particlePoolRef = useRef<ParticlePool | null>(null);
    const lastHoverRef = useRef<string | null>(null);

    const unitsAnimKey = useMemo(
        () => units.map(u => `${u.id}:${u.tileId}:${u.hp}`).join('|'),
        [units]
    );
    const aliveUnitIds = useMemo(() => new Set(units.map(u => u.id)), [units]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const targetTag = (e.target as HTMLElement | null)?.tagName;
            if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;
            if (e.key === 'Tab') {
                e.preventDefault();
                selectNextReadyUnit();
            } else if ((e.key === 'o' || e.key === 'O') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                enterOverwatch();
            } else if ((e.key === 'z' || e.key === 'Z') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                undoLastMove();
            } else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                rotateMap(e.shiftKey ? -90 : 90);
            } else if (e.key === 'Escape') {
                if (fxTimeline.isKillCamActive()) {
                    e.preventDefault();
                    fxTimeline.skipKillCam();
                    return;
                }
                const st = useGameStore.getState();
                if (
                    st.placementMode?.active ||
                    st.selectedInventoryItemIndex !== null ||
                    st.selectedUnitId ||
                    st.selectedTileId ||
                    st.selectedGraveyardUnitId
                ) {
                    e.preventDefault();
                    clearSelection();
                }
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectNextReadyUnit, enterOverwatch, undoLastMove, rotateMap, clearSelection]);

    // Initial Load (Legacy + New)
    useEffect(() => {
        preloadTextures().then(() => {
            console.log("Legacy Textures Loaded");
            setLoaded(true);
        });
    }, []);

    // Resize Handler
    useEffect(() => {
        let alive = true;
        const resize = () => {
            if (!alive) return;
            let w = 800; 
            let h = 600;

            if (parentRef.current) {
                w = parentRef.current.clientWidth;
                h = parentRef.current.clientHeight;
            }
            if (h <= 50) {
                 w = window.innerWidth;
                 h = window.innerHeight;
            }

            setDimensions({ width: Math.max(1, w), height: Math.max(1, h) });
        };
        
        const ro = new ResizeObserver(resize);
        if (parentRef.current) ro.observe(parentRef.current);
        window.addEventListener('resize', resize);
        
        const timer = setTimeout(resize, 50);

        return () => {
            alive = false;
            clearTimeout(timer);
            ro.disconnect();
            window.removeEventListener('resize', resize);
        };
    }, []);

    // Prevent Default Browser Zooming inside the game area
    useEffect(() => {
        const preventDefault = (e: WheelEvent | TouchEvent) => {
            if (e.target && parentRef.current && parentRef.current.contains(e.target as Node)) {
                e.preventDefault();
            }
        };

        const container = parentRef.current;
        if (!container) return;

        // Passive: false is crucial for preventing default
        container.addEventListener('wheel', preventDefault as EventListener, { passive: false });
        container.addEventListener('touchstart', preventDefault as EventListener, { passive: false });
        container.addEventListener('touchmove', preventDefault as EventListener, { passive: false });

        return () => {
            container.removeEventListener('wheel', preventDefault as EventListener);
            container.removeEventListener('touchstart', preventDefault as EventListener);
            container.removeEventListener('touchmove', preventDefault as EventListener);
        };
    }, []);

    const totalBoardSize = gridSize * TILE_SIZE;
    const prevRotRef = useRef<BoardRotation>(mapRotation);

    useEffect(() => {
        const prevRot = prevRotRef.current;
        if (prevRot === mapRotation) return;
        prevRotRef.current = mapRotation;
        if (!viewport || viewport.destroyed) return;
        // Preserve whatever area of the battlefield the camera was centered on across rotation
        const unrot = unrotateBoardPoint(viewport.center.x, viewport.center.y, prevRot, totalBoardSize);
        const nextCenter = rotateBoardPoint(unrot.x, unrot.y, mapRotation, totalBoardSize);
        viewport.moveCenter(nextCenter.x, nextCenter.y);
    }, [mapRotation, viewport, totalBoardSize]);

    const drawBoardFrame = useCallback((g: PIXI.Graphics) => {
        g.clear();
        g.lineStyle(4, 0x273041, 0.95);
        g.drawRect(-2, -2, totalBoardSize + 4, totalBoardSize + 4);
        g.lineStyle(0);
    }, [totalBoardSize]);

    const drawHitPlane = useCallback((g: PIXI.Graphics) => {
        g.clear();
        g.beginFill(0xffffff, 0.001);
        g.drawRect(0, 0, totalBoardSize, totalBoardSize);
        g.endFill();
    }, [totalBoardSize]);

    const updateHoverFromClient = useCallback((clientX: number, clientY: number) => {
        if (!parentRef.current || !viewport || viewport.destroyed) return;
        const rect = parentRef.current.getBoundingClientRect();
        const world = viewport.toWorld(clientX - rect.left, clientY - rect.top);
        const unrot = unrotateBoardPoint(world.x, world.y, mapRotation, totalBoardSize);
        const gx = Math.floor(unrot.x / TILE_SIZE);
        const gy = Math.floor(unrot.y / TILE_SIZE);
        if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
            const id = `${gx},${gy}`;
            if (lastHoverRef.current !== id) {
                lastHoverRef.current = id;
                setHoveredTile(id);
            }
        } else if (lastHoverRef.current !== null) {
            lastHoverRef.current = null;
            setHoveredTile(null);
        }
    }, [viewport, gridSize, mapRotation, totalBoardSize, setHoveredTile]);

    if (!loaded) {
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--op-ink)', fontWeight: 800, fontSize: '13px' }}>
                Initializing Tactical Recon Engine...
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            onPointerMove={(e) => updateHoverFromClient(e.clientX, e.clientY)}
            onContextMenu={(e) => {
                e.preventDefault();
                clearSelection();
            }}
            onMouseLeave={() => {
                lastHoverRef.current = null;
                setHoveredTile(null);
            }}
            style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
        >
            <div style={{ position: 'absolute', inset: 0 }}>
            <Stage
                width={dimensions.width}
                height={dimensions.height}
                raf={fxMode === 'LIVE'}
                renderOnComponentChange={false}
                options={stageOptions}
            >
                <BattleRenderController
                    fxMode={fxMode}
                    viewport={viewport}
                    unitsAnimKey={unitsAnimKey}
                    particlePoolRef={particlePoolRef}
                    tileById={tileById}
                    sceneRenderDeps={[
                        dimensions,
                        bakedBoard,
                        mapData,
                        units,
                        visibleTiles,
                        selectedUnitId,
                        selectedTileId,
                        validMoveTiles,
                        validMoveCosts,
                        validAttackTargets,
                        validSpawnTiles,
                        placementMode,
                        validSecureTile,
                        validSiegeTile,
                        validDemolishTile,
                        validLootTile,
                        visiblePendingDrops,
                        visibleOwnMines,
                        playerCp,
                        currentPlayer,
                        isMyTurn,
                        weather,
                        mapRotation,
                    ]}
                />
                <GameViewport
                    width={dimensions.width}
                    height={dimensions.height}
                    worldWidth={totalBoardSize}
                    worldHeight={totalBoardSize}
                    setViewport={setViewport}
                    schematicOverlay={
                        <Container
                            name="killcam_schematic_root"
                            x={totalBoardSize / 2}
                            y={totalBoardSize / 2}
                            pivot={{ x: totalBoardSize / 2, y: totalBoardSize / 2 }}
                            angle={mapRotation}
                            eventMode="none"
                        >
                            <KillCamSchematicLayer />
                        </Container>
                    }
                >
                    {/* 0. DARK ANODIZED COMMAND-TABLE PERIMETER APRON (zero grey void on corner zoom/shake/tilt) */}
                    <PerimeterApronLayer gridSize={gridSize} mapRotation={mapRotation} />

                    {/* 0a. BAKED TACTICAL RECON HD TERRAIN (pre-rotated in upright screen space so assets never flip) */}
                    <SafeSprite
                        texture={bakedBoard.terrainTexture}
                        x={0}
                        y={0}
                        width={totalBoardSize}
                        height={totalBoardSize}
                        eventMode="none"
                    />

                    {/* 0a-2. MASKED SPECULAR WATER CAUSTICS (screen-upright, pixel-locked to waterMaskTexture in LIVE mode) */}
                    <WaterShimmerLayer
                        waterMaskTexture={bakedBoard.waterMaskTexture}
                        boardSize={totalBoardSize}
                        animate={fxMode === 'LIVE'}
                    />

                    <Container
                        name="rotated_board"
                        x={totalBoardSize / 2}
                        y={totalBoardSize / 2}
                        pivot={{ x: totalBoardSize / 2, y: totalBoardSize / 2 }}
                        angle={mapRotation}
                    >
                        {/* 0b. WORLD BOARD INSET FRAME */}
                        <Graphics eventMode="none" draw={drawBoardFrame} />

                        {/* 1. LIVE WATER + LIVING STRUCTURES (RADAR CONES, BANK BEACONS, BASE SMOKE) + SINGLE HIT PLANE */}
                        <Container name="terrain">
                            <AnimatedWaterLayer waterTiles={waterTiles} animate={fxMode === 'LIVE'} />
                            <LivingMapLayer
                                mapData={mapData}
                                gridSize={gridSize}
                                fogOfWar={settings.fogOfWar}
                                visibleTiles={visibleTiles}
                                victoryMode={settings.victoryMode}
                                animate={fxMode === 'LIVE'}
                                particlePoolRef={particlePoolRef}
                            />
                            <Graphics
                                ref={hitPlaneRef}
                                eventMode="static"
                                cursor="default"
                                draw={drawHitPlane}
                                pointerdown={(e: PIXI.FederatedPointerEvent) => {
                                    // Right-click (and macOS Ctrl+click) deselects via onContextMenu; ignore non-primary buttons here
                                    if (e.pointerType === 'mouse' && (e.button !== 0 || e.ctrlKey)) return;
                                    if (!hitPlaneRef.current) return;
                                    const local = e.getLocalPosition(hitPlaneRef.current);
                                    const gx = Math.floor(local.x / TILE_SIZE);
                                    const gy = Math.floor(local.y / TILE_SIZE);
                                    if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
                                        handleTileClick(gx, gy);
                                    }
                                }}
                            />
                        </Container>

                        {/* 2. OVERLAYS (Zones, Hazards, Weather Tints, Soft Feathered Fog) */}
                        <ZoneAndFogLayer 
                            mapData={mapData} 
                            visibleTiles={visibleTiles} 
                            weather={weather} 
                            settings={settings}
                            gridSize={gridSize}
                        />

                        {/* 3. GRID & HIGHLIGHTS */}
                        <OverlayLayer
                            mapData={mapData}
                            tileById={tileById}
                            units={units}
                            viewer={viewer}
                            settings={settings}
                            weather={weather}
                            visibleTiles={visibleTiles}
                            selectedUnit={selectedUnit}
                            currentPlayer={currentPlayer}
                            validMoveTiles={validMoveTiles}
                            validAttackTargets={validAttackTargets}
                            validSpawnTiles={validSpawnTiles}
                            selectedTileId={selectedTileId}
                            placementMode={placementMode}
                            validSecureTile={validSecureTile}
                            validSiegeTile={validSiegeTile}
                            validDemolishTile={validDemolishTile}
                            validLootTile={validLootTile}
                            gridSize={gridSize}
                        />
                        <HoverOverlayLayer
                            tileById={tileById}
                            hitPlaneRef={hitPlaneRef}
                            containerRef={parentRef}
                        />

                        {/* 3b. GROUND-PLANE TILE EFFECTS (scorch craters, mine flashes, capture waves, drop beams) */}
                        <TileEffectsLayer />

                        {/* 4. UNITS LAYER (No full-screen bloom filter -> 10x lighter GPU compositing) */}
                        <Container name="units">
                            {units.map(unit => {
                                const tile = tileById.get(unit.tileId);
                                if (!tile || !isUnitVisible(unit, viewer, settings.fogOfWar, visibleTiles)) return null;

                                return (
                                    <UnitSprite
                                        key={unit.id}
                                        unit={unit}
                                        gridSize={gridSize}
                                        texture={getTexture(`UNIT_P${unit.owner}_${unit.type}`)}
                                        x={tile.x * TILE_SIZE}
                                        y={tile.y * TILE_SIZE}
                                        tileX={tile.x}
                                        tileY={tile.y}
                                        mapRotation={mapRotation}
                                        isSelected={selectedUnitId === unit.id}
                                        isReadyTurn={isMyTurn && unit.owner === currentPlayer && !unit.completed && !unit.isOverwatching}
                                    />
                                );
                            })}
                            <PendingDeathsLayer
                                aliveUnitIds={aliveUnitIds}
                                gridSize={gridSize}
                                mapRotation={mapRotation}
                            />
                        </Container>

                        {/* 4a. 550ms UNIT DEATH GHOSTS */}
                        <DeathGhostLayer />

                        {/* 4b. TOP-OF-SPRITE ATTACK TARGETING RETICLES */}
                        <TargetingOverlayLayer
                            tileById={tileById}
                            units={units}
                            validAttackTargets={validAttackTargets}
                            validSiegeTile={validSiegeTile}
                            validDemolishTile={validDemolishTile}
                        />

                        {/* 5. LOOT & UI OVERLAYS */}
                        <UIMarkersLayer
                            mapData={mapData}
                            tileById={tileById}
                            visibleTiles={visibleTiles}
                            fogOfWar={settings.fogOfWar}
                            victoryMode={settings.victoryMode}
                            pendingDrops={visiblePendingDrops}
                            ownMines={visibleOwnMines}
                            mapRotation={mapRotation}
                        />

                        {/* 6. EFFECTS LAYER (Damage, Selection, Projectiles, Pooled Particles) */}
                        <EffectsLayer
                            selectedUnitPos={selectedUnitPos}
                            fxMode={fxMode}
                            mapRotation={mapRotation}
                            particlePoolRef={particlePoolRef}
                        />
                    </Container>

                    {/* Phase 4: Weather System (Atmosphere) - stays unrotated above board so rain/wind stay screen-upright */}
                    <WeatherSystem viewportInstance={viewport} />

                </GameViewport>
            </Stage>
            </div>
        </div>
    );
};

// End of GameRenderer
