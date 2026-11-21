
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Stage, Container, Graphics, Text, useTick } from '@pixi/react';
import { SafeSprite } from './SafeSprite';
import { UnitSprite } from './renderer/UnitSprite';
import { GameViewport } from './renderer/GameViewport';
import * as PIXI from 'pixi.js';
import { useGameStore } from '../../store/useGameStore';
import { Tile } from '../../core/types';
import { TILE_SIZE, UI_COLORS, UNIT_STATS, PLAYER_COLORS, BANK_STATS, BASE_STATS } from '../../core/constants/Config';
import { preloadTextures, getTexture } from '../../core/graphics/TextureManager';
import { bakeTacticalReconBoard, bakeSoftFogTexture, computeTerrainSignature } from '../../core/graphics/TacticalReconRenderer';
import { useViewportContext } from '../../context/ViewportContext';
import { SelectionCursor } from './renderer/SelectionCursor';
import { DamageText } from './renderer/DamageText';
import { ProjectileRenderer } from './renderer/ProjectileRenderer';
import { WeatherSystemMemo as WeatherSystem } from './renderer/WeatherSystem.tsx'; // Explicit .tsx extension
import { useEffectStore } from '../../store/useEffectStore';
import { canConstructOnTile } from '../../core/rules/CombatRules';
import { getOverwatchCoverageTiles, resolveMoveWithOverwatch } from '../../core/rules/OverwatchRules';
import { getMovePath } from '../../core/grid/Pathfinding';

const LOOT_MARKER_STYLE = new PIXI.TextStyle({
    fill: '#FFD700',
    fontSize: 20,
    fontWeight: 'bold',
    stroke: 'black',
    strokeThickness: 3,
});

// --- SUB-COMPONENTS FOR PERFORMANCE ---

// 1. Grid & Highlights Layer
const OverlayLayer = React.memo(({ 
    mapData, units, currentPlayer, settings, weather, visibleTiles,
    validMoveTiles, validAttackTargets, validSpawnTiles, 
    selectedTileId, hoveredTileId, placementMode,
    validSecureTile, validHeistTile, validSiegeTile, validDemolishTile, validLootTile,
    hoverPath, hoverMoveResolution, gridSize 
}: any) => {
    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();
        
        // Draw Highlights
        const drawHighlight = (id: string, colorStr: string, alpha: number = 0.4, border: boolean = false) => {
            const [x, y] = id.split(',').map(Number);
            const px = x * TILE_SIZE;
            const py = y * TILE_SIZE;
            
            // Parse rgba or hex
            let color = 0xFFFFFF;
            let borderColor: number | null = null;
            // Simple mapping for the Config colors to Hex
            if (colorStr.includes('0, 100, 255')) { color = 0x0064FF; borderColor = 0x38BDF8; } // Move
            else if (colorStr.includes('255, 0, 0')) color = 0xFF0000; // Attack
            else if (colorStr.includes('0, 255, 0')) color = 0x00FF00; // Spawn
            else if (colorStr === '#F44336') color = 0xF44336;
            else if (colorStr === '#D32F2F') color = 0xD32F2F;
            else if (colorStr === '#4CAF50') color = 0x4CAF50;
            else if (colorStr === '#00BCD4') color = 0x00BCD4;
            else if (colorStr === '#FF9800') color = 0xFF9800;
            else if (colorStr === '#FFB300') color = 0xFFB300;
            else if (colorStr === '#FF5722') color = 0xFF5722;
            else if (colorStr.includes('255, 165, 0')) color = 0xFFA500; // Action

            g.beginFill(color, alpha);
            g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            g.endFill();

            if (border) {
                g.lineStyle(2, borderColor ?? color, 0.95);
                g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                g.lineStyle(0);
            }
        };

        if (placementMode && placementMode.active && Array.isArray(mapData)) {
            mapData.forEach((tile: Tile) => {
                if (canConstructOnTile(placementMode.itemKey, tile, units || [])) {
                    drawHighlight(tile.id, '#00BCD4', 0.25, true);
                }
            });
        }

        validMoveTiles.forEach((id: string) => drawHighlight(id, UI_COLORS.MOVE_HIGHLIGHT, 0.36, true));
        validSpawnTiles.forEach((id: string) => drawHighlight(id, UI_COLORS.SPAWN_HIGHLIGHT));
        validAttackTargets.forEach((unitId: string) => {
            const targetUnit = Array.isArray(units) ? units.find((u: any) => u.id === unitId) : null;
            if (targetUnit) drawHighlight(targetUnit.tileId, '#FF0000', 0.4, true);
        });
        
        // Action Highlights
        if (validSecureTile) drawHighlight(validSecureTile, UI_COLORS.ACTION_HIGHLIGHT, 0.2, true);
        if (validHeistTile) drawHighlight(validHeistTile, '#F44336', 0.2, true);
        if (validSiegeTile) drawHighlight(validSiegeTile, '#D32F2F', 0.35, true);
        if (validDemolishTile) drawHighlight(validDemolishTile, '#D32F2F', 0.35, true);
        if (validLootTile) drawHighlight(validLootTile, '#4CAF50', 0.2, true);

        // Automated Turret / Base Artillery Danger Range Ring on Hover
        if (hoveredTileId && Array.isArray(mapData)) {
            const hTile = mapData.find((t: Tile) => t.id === hoveredTileId);
            if (hTile) {
                let dangerRange = 0;
                if (hTile.type === 'BANK' && (hTile.hackProgress || 0) < 100) {
                    dangerRange = BANK_STATS.RANGE;
                } else if (
                    hTile.type === 'BASE' &&
                    settings?.victoryMode === 'CONQUER' &&
                    hTile.owner !== currentPlayer &&
                    (hTile.hp || 0) > 0
                ) {
                    dangerRange = BASE_STATS.RANGE;
                }

                if (dangerRange > 0) {
                    mapData.forEach((t: Tile) => {
                        const d = Math.abs(t.x - hTile.x) + Math.abs(t.y - hTile.y);
                        if (d > 0 && d <= dangerRange) {
                            drawHighlight(t.id, '#FF9800', 0.14, true);
                        }
                    });
                }
            }
        }

        // Visible Overwatcher Coverage Ring on Hover or Selection
        const inspectTileId = hoveredTileId || selectedTileId;
        if (inspectTileId && Array.isArray(units) && Array.isArray(mapData) && weather) {
            const inspectedOverwatcher = units.find((u: any) =>
                u.tileId === inspectTileId &&
                u.isOverwatching &&
                u.ammo > 0 &&
                (!settings?.fogOfWar || u.owner === currentPlayer || visibleTiles?.has(u.tileId))
            );
            if (inspectedOverwatcher) {
                const covered = getOverwatchCoverageTiles(inspectedOverwatcher, mapData, weather, gridSize || 20);
                covered.forEach((tid: string) => drawHighlight(tid, '#FFB300', 0.14, true));
            }
        }

        // Hover Movement Path Preview (warns on visible enemy Overwatch interception)
        if (Array.isArray(hoverPath) && hoverPath.length > 1) {
            const trig = hoverMoveResolution?.trigger;
            const safeEndIdx = trig ? Math.min(hoverPath.length - 1, trig.interceptIndex) : hoverPath.length - 1;

            g.lineStyle(4, 0x00E5FF, 0.9);
            hoverPath.slice(0, safeEndIdx + 1).forEach((pt: Tile, idx: number) => {
                const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                if (idx === 0) g.moveTo(cx, cy);
                else g.lineTo(cx, cy);
            });
            g.lineStyle(0);

            if (trig && safeEndIdx < hoverPath.length - 1) {
                g.lineStyle(4, 0xFF5722, 0.9);
                hoverPath.slice(safeEndIdx).forEach((pt: Tile, idx: number) => {
                    const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                    const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                    if (idx === 0) g.moveTo(cx, cy);
                    else g.lineTo(cx, cy);
                });
                g.lineStyle(0);
            }

            hoverPath.slice(1).forEach((pt: Tile, idx: number) => {
                const stepIndex = idx + 1;
                const cx = pt.x * TILE_SIZE + TILE_SIZE / 2;
                const cy = pt.y * TILE_SIZE + TILE_SIZE / 2;
                const isIntercept = trig && stepIndex === trig.interceptIndex;
                const isDest = stepIndex === hoverPath.length - 1;
                const dotColor = isIntercept ? 0xFF5722 : isDest ? 0x00E5FF : 0xFFFFFF;
                g.beginFill(dotColor, isIntercept || isDest ? 0.95 : 0.75);
                g.drawCircle(cx, cy, isIntercept || isDest ? 7 : 4);
                g.endFill();
            });
        }

        // Selection
        if (selectedTileId) {
            const [x, y] = selectedTileId.split(',').map(Number);
            g.lineStyle(2, 0xFFFFFF, 0.8);
            g.drawRect(x * TILE_SIZE + 2, y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
            g.lineStyle(0);
        }

        // Hover
        if (hoveredTileId) {
            const [x, y] = hoveredTileId.split(',').map(Number);
            const color = 0xFFFFFF;

            g.beginFill(color, 0.15);
            g.drawRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            g.endFill();
            g.lineStyle(1, color, 0.5);
            g.drawRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            g.lineStyle(0);
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

    }, [mapData, units, currentPlayer, settings, weather, visibleTiles, validMoveTiles, validAttackTargets, validSpawnTiles, selectedTileId, hoveredTileId, placementMode, validSecureTile, validHeistTile, validSiegeTile, validDemolishTile, validLootTile, hoverPath, hoverMoveResolution, gridSize]);

    return <Graphics draw={draw} eventMode="none" />;
});

// Throttled (~20fps) Animated River & Shoreline Ripples (keeps GPU vertex uploads minimal)
const AnimatedWaterLayer = React.memo<{ waterTiles: Tile[] }>(({ waterTiles }) => {
    const gfxRef = useRef<PIXI.Graphics>(null);
    const phaseRef = useRef(0);
    const accumRef = useRef(3);

    useTick((delta) => {
        const dt = typeof delta === 'number' ? delta : 1;
        accumRef.current += dt;
        if (accumRef.current < 3) return;
        phaseRef.current += 0.035 * accumRef.current;
        accumRef.current = 0;

        const g = gfxRef.current;
        if (!g || (g as any).destroyed) return;
        g.clear();
        if (waterTiles.length === 0) return;

        const t = phaseRef.current;
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
    });

    return <Graphics ref={gfxRef} eventMode="none" />;
});

// Throttled (~20fps) Spinning Tactical Radar Bar on Visible HQ Compounds
const AnimatedBaseRadarLayer = React.memo<{ baseTiles: Tile[]; fogOfWar: boolean; visibleTiles: Set<string> }>(({
    baseTiles,
    fogOfWar,
    visibleTiles,
}) => {
    const gfxRef = useRef<PIXI.Graphics>(null);
    const angleRef = useRef(0);
    const accumRef = useRef(3);

    useTick((delta) => {
        const dt = typeof delta === 'number' ? delta : 1;
        accumRef.current += dt;
        if (accumRef.current < 3) return;
        angleRef.current += 0.025 * accumRef.current;
        accumRef.current = 0;

        const g = gfxRef.current;
        if (!g || (g as any).destroyed) return;
        g.clear();
        if (baseTiles.length === 0) return;

        g.lineStyle(2, 0xE2E8F0, 0.72);
        for (let i = 0; i < baseTiles.length; i++) {
            const b = baseTiles[i];
            if (fogOfWar && !visibleTiles.has(b.id)) continue;
            const cx = b.x * TILE_SIZE + TILE_SIZE / 2;
            const cy = b.y * TILE_SIZE + TILE_SIZE / 2;
            const ang = angleRef.current + b.x * 0.6;
            const dx = Math.cos(ang) * 7;
            const dy = Math.sin(ang) * 7;
            g.moveTo(cx - dx, cy - dy);
            g.lineTo(cx + dx, cy + dy);
        }
        g.lineStyle(0);
    });

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
    visibleTiles: Set<string>;
    fogOfWar: boolean;
    victoryMode: string;
}>(({ mapData, visibleTiles, fogOfWar, victoryMode }) => {
    const drawMarkers = useCallback((g: PIXI.Graphics) => {
        g.clear();
        for (let i = 0; i < mapData.length; i++) {
            const tile = mapData[i];
            if (fogOfWar && !visibleTiles.has(tile.id)) continue;
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;

            if (tile.type === 'BUILDING' && tile.owner !== undefined) {
                const colorStr = PLAYER_COLORS[tile.owner] || '#FFFFFF';
                const color = parseInt(colorStr.replace('#', '0x'));
                g.lineStyle(4, color, 1);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.lineStyle(0);
                g.beginFill(color, 0.2);
                g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                g.endFill();
            }

            if (tile.type === 'BASE' && victoryMode === 'CONQUER' && tile.hp !== undefined && tile.maxHp) {
                const pct = Math.max(0, Math.min(1, tile.hp / tile.maxHp));
                const ownerColorStr = PLAYER_COLORS[tile.owner!] || '#FF0000';
                const ownerColor = parseInt(ownerColorStr.replace('#', '0x'));
                g.lineStyle(0);
                g.beginFill(0x000000, 0.8);
                g.drawRect(px + 4, py + 4, TILE_SIZE - 8, 6);
                g.endFill();
                g.beginFill(ownerColor);
                g.drawRect(px + 5, py + 5, (TILE_SIZE - 10) * pct, 4);
                g.endFill();
            }
        }
    }, [mapData, visibleTiles, fogOfWar, victoryMode]);

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
                    x={tile.x * TILE_SIZE + TILE_SIZE / 2}
                    y={tile.y * TILE_SIZE + TILE_SIZE / 2}
                    style={LOOT_MARKER_STYLE}
                />
            ))}
        </Container>
    );
});

export const GameRenderer = () => {
    const parentRef = useRef<HTMLDivElement>(null);
    const { setViewport, viewport } = useViewportContext();
    const [loaded, setLoaded] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 200, height: 200 });

    // State Selectors
    const mapData = useGameStore(state => state.mapData);
    const units = useGameStore(state => state.units);
    const gridSize = useGameStore(state => state.gridSize) || 20; 
    const handleTileClick = useGameStore(state => state.handleTileClick);
    
    // Debug sizing
    useEffect(() => {
        console.log(`[GameRenderer] Resize Debug: Width=${dimensions.width}, Height=${dimensions.height}, Grid=${gridSize}, Tile=${TILE_SIZE}`);
    }, [dimensions, gridSize]);

    const setHoveredTile = useGameStore(state => state.setHoveredTile);
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const visibleTiles = useGameStore(state => state.visibleTiles);
    const settings = useGameStore(state => state.settings);
    const selectedUnitId = useGameStore(state => state.selectedUnitId);
    
    // Highlights
    const validMoveTiles = useGameStore(state => state.validMoveTiles);
    const validMoveCosts = useGameStore(state => state.validMoveCosts);
    const validAttackTargets = useGameStore(state => state.validAttackTargets);
    const validSpawnTiles = useGameStore(state => state.validSpawnTiles);
    const selectedTileId = useGameStore(state => state.selectedTileId);
    const hoveredTileId = useGameStore(state => state.hoveredTileId);
    const placementMode = useGameStore(state => state.placementMode);
    const playerCp = useGameStore(state => state.playerCp);
    const selectNextReadyUnit = useGameStore(state => state.selectNextReadyUnit);
    const enterOverwatch = useGameStore(state => state.enterOverwatch);
    
    // Actions
    const validSecureTile = useGameStore(state => state.validSecureTile);
    const validHeistTile = useGameStore(state => state.validHeistTile);
    const validSiegeTile = useGameStore(state => state.validSiegeTile);
    const validDemolishTile = useGameStore(state => state.validDemolishTile);

    // Visual Effects
    const damagePopups = useEffectStore(state => state.damagePopups);
    const projectiles = useEffectStore(state => state.projectiles);

    const terrainSig = useMemo(() => computeTerrainSignature(mapData, gridSize), [mapData, gridSize]);
    const bakedBoard = useMemo(() => bakeTacticalReconBoard(mapData, gridSize), [terrainSig]);
    const waterTiles = useMemo(() => mapData.filter(t => t.type === 'WATER'), [terrainSig]);
    const baseTiles = useMemo(() => mapData.filter(t => t.type === 'BASE'), [terrainSig]);
    const tileById = useMemo(() => {
        const map = new Map<string, Tile>();
        for (let i = 0; i < mapData.length; i++) map.set(mapData[i].id, mapData[i]);
        return map;
    }, [mapData]);

    useEffect(() => {
        return () => {
            bakedBoard.terrainTexture.destroy(true);
            bakedBoard.waterMaskTexture.destroy(true);
        };
    }, [bakedBoard]);

    // Derived Selection Data
    const selectedUnit = units.find(u => u.id === selectedUnitId);
    let selectedUnitPos = null;
    if (selectedUnit) {
        const t = tileById.get(selectedUnit.tileId);
        if (t) selectedUnitPos = { x: t.x * TILE_SIZE, y: t.y * TILE_SIZE };
    }
    const validLootTile = useGameStore(state => state.validLootTile);
    
    const weather = useGameStore(state => state.weather);
    const hitPlaneRef = useRef<PIXI.Graphics>(null);
    const lastHoverRef = useRef<string | null>(hoveredTileId);
    lastHoverRef.current = hoveredTileId;

    const hoverMoveResolution = useMemo(() => {
        if (!selectedUnit || selectedUnit.owner !== currentPlayer || selectedUnit.hasMoved) return null;
        if (!hoveredTileId || !validMoveCosts.has(hoveredTileId)) return null;
        return resolveMoveWithOverwatch({
            movingUnit: selectedUnit,
            targetTileId: hoveredTileId,
            mapData,
            units,
            weather,
            gridSize,
            fogOfWar: settings.fogOfWar,
            maxBudget: playerCp[currentPlayer] ?? 0,
            knownVisibleTiles: settings.fogOfWar ? visibleTiles : null
        });
    }, [selectedUnit, currentPlayer, hoveredTileId, validMoveCosts, mapData, units, weather, gridSize, settings.fogOfWar, playerCp, visibleTiles]);

    const hoverPath = useMemo(() => {
        if (hoverMoveResolution) return hoverMoveResolution.path;
        if (!selectedUnit || selectedUnit.owner !== currentPlayer || selectedUnit.hasMoved) return [];
        if (!hoveredTileId || !validMoveCosts.has(hoveredTileId)) return [];
        const startTile = mapData.find(t => t.id === selectedUnit.tileId);
        if (!startTile) return [];
        return getMovePath(
            startTile,
            hoveredTileId,
            playerCp[currentPlayer] ?? 0,
            mapData,
            units,
            selectedUnit.type,
            currentPlayer,
            weather,
            gridSize,
            selectedUnit.rank ?? 0
        );
    }, [hoverMoveResolution, selectedUnit, currentPlayer, hoveredTileId, validMoveCosts, mapData, playerCp, units, weather, gridSize]);

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
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectNextReadyUnit, enterOverwatch]);

    // Initial Load (Legacy + New)
    useEffect(() => {
        preloadTextures().then(() => {
            console.log("Legacy Textures Loaded");
            setLoaded(true);
        });
    }, []);

    // Resize Handler
    useEffect(() => {
        const resize = () => {
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

            setDimensions({ width: w, height: h });
        };
        
        const ro = new ResizeObserver(resize);
        if (parentRef.current) ro.observe(parentRef.current);
        window.addEventListener('resize', resize);
        
        setTimeout(resize, 50);

        return () => {
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

    if (!loaded) {
        return (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--op-ink)', fontWeight: 800, fontSize: '13px' }}>
                Initializing Tactical Recon Engine...
            </div>
        );
    }

    const stageResolution = Math.min(window.devicePixelRatio || 1, 1.5);

    return (
        <div ref={parentRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
            <Stage 
                width={dimensions.width} 
                height={dimensions.height} 
                options={{ backgroundAlpha: 0, antialias: false, autoDensity: true, resolution: stageResolution }}
            >
                <GameViewport
                    width={dimensions.width}
                    height={dimensions.height}
                    worldWidth={totalBoardSize}
                    worldHeight={totalBoardSize}
                    setViewport={setViewport}
                >
                    {/* 0. WORLD BOARD INSET FRAME */}
                    <Graphics eventMode="none" draw={drawBoardFrame} />

                    {/* 1. BAKED TACTICAL RECON HD TERRAIN + LIVE WATER + BASE RADAR + SINGLE HIT PLANE */}
                    <Container name="terrain">
                        <SafeSprite
                            texture={bakedBoard.terrainTexture}
                            x={0}
                            y={0}
                            width={totalBoardSize}
                            height={totalBoardSize}
                            eventMode="none"
                        />
                        <AnimatedWaterLayer waterTiles={waterTiles} />
                        <AnimatedBaseRadarLayer baseTiles={baseTiles} fogOfWar={settings.fogOfWar} visibleTiles={visibleTiles} />
                        <Graphics
                            ref={hitPlaneRef}
                            eventMode="static"
                            cursor="pointer"
                            draw={drawHitPlane}
                            pointerdown={(e: PIXI.FederatedPointerEvent) => {
                                if (!hitPlaneRef.current) return;
                                const local = e.getLocalPosition(hitPlaneRef.current);
                                const gx = Math.floor(local.x / TILE_SIZE);
                                const gy = Math.floor(local.y / TILE_SIZE);
                                if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
                                    handleTileClick(gx, gy);
                                }
                            }}
                            pointermove={(e: PIXI.FederatedPointerEvent) => {
                                if (!hitPlaneRef.current) return;
                                const local = e.getLocalPosition(hitPlaneRef.current);
                                const gx = Math.floor(local.x / TILE_SIZE);
                                const gy = Math.floor(local.y / TILE_SIZE);
                                if (gx >= 0 && gx < gridSize && gy >= 0 && gy < gridSize) {
                                    const id = `${gx},${gy}`;
                                    if (lastHoverRef.current !== id) {
                                        lastHoverRef.current = id;
                                        setHoveredTile(id);
                                    }
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
                        units={units}
                        currentPlayer={currentPlayer}
                        settings={settings}
                        weather={weather}
                        visibleTiles={visibleTiles}
                        validMoveTiles={validMoveTiles}
                        validAttackTargets={validAttackTargets}
                        validSpawnTiles={validSpawnTiles}
                        selectedTileId={selectedTileId}
                        hoveredTileId={hoveredTileId}
                        placementMode={placementMode}
                        validSecureTile={validSecureTile}
                        validHeistTile={validHeistTile}
                        validSiegeTile={validSiegeTile}
                        validDemolishTile={validDemolishTile}
                        validLootTile={validLootTile}
                        hoverPath={hoverPath}
                        hoverMoveResolution={hoverMoveResolution}
                        gridSize={gridSize}
                    />

                    {/* 4. UNITS LAYER (No full-screen bloom filter -> 10x lighter GPU compositing) */}
                    <Container name="units">
                        {units.map(unit => {
                            const tile = tileById.get(unit.tileId);
                            if (!tile) return null;
                            
                            const isFriendly = unit.owner === currentPlayer;
                            const isVisible = !settings.fogOfWar || isFriendly || visibleTiles.has(unit.tileId);
                            const isSelected = selectedUnitId === unit.id;

                            if (!isVisible) return null;

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
                                    isSelected={isSelected}
                                    onSelectTile={handleTileClick}
                                />
                            );
                        })}
                    </Container>

                    {/* 5. LOOT & UI OVERLAYS */}
                    <UIMarkersLayer
                        mapData={mapData}
                        visibleTiles={visibleTiles}
                        fogOfWar={settings.fogOfWar}
                        victoryMode={settings.victoryMode}
                    />

                    {/* 6. EFFECTS LAYER (Damage, Selection, Particles) */}
                    <Container name="effects" eventMode="none">
                         {/* Selection Pulse */}
                         {selectedUnitPos && (
                             <SelectionCursor x={selectedUnitPos.x} y={selectedUnitPos.y} />
                         )}

                         {/* Projectiles */}
                         {projectiles.map(proj => (
                             <ProjectileRenderer key={proj.id} data={proj} />
                         ))}

                         {/* Damage Popups */}
                         {damagePopups.map(popup => (
                             <DamageText key={popup.id} data={popup} />
                         ))}
                    </Container>

                    {/* Phase 4: Weather System (Atmosphere) - MOVED TO TOP LAYER */}
                    <WeatherSystem width={gridSize * TILE_SIZE} height={gridSize * TILE_SIZE} viewportInstance={viewport} />

                </GameViewport>
            </Stage>
            </div>
        </div>
    );
};

// End of GameRenderer
