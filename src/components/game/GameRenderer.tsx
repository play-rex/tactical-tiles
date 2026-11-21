
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Stage, Container, Graphics, Text } from '@pixi/react';
import { SafeSprite } from './SafeSprite';
import { UnitSprite } from './renderer/UnitSprite';
import { GameViewport } from './renderer/GameViewport';
import * as PIXI from 'pixi.js';
import { useGameStore } from '../../store/useGameStore';
import { Tile } from '../../core/types';
import { TILE_SIZE, UI_COLORS, UNIT_STATS, PLAYER_COLORS, BANK_STATS, BASE_STATS } from '../../core/constants/Config';
import { preloadTextures, getTexture } from '../../core/graphics/TextureManager';
import { useAssetLoader } from '../../hooks/useAssetLoader';
import { useViewportContext } from '../../context/ViewportContext';
import { SelectionCursor } from './renderer/SelectionCursor';
import { DamageText } from './renderer/DamageText';
import { ProjectileRenderer } from './renderer/ProjectileRenderer';
import { WeatherSystem } from './renderer/WeatherSystem.tsx'; // Explicit .tsx extension
import { useEffectStore } from '../../store/useEffectStore';
import { canConstructOnTile } from '../../core/rules/CombatRules';
import { getOverwatchCoverageTiles, resolveMoveWithOverwatch } from '../../core/rules/OverwatchRules';
import { getMovePath } from '../../core/grid/Pathfinding';
import { AdvancedBloomFilter } from 'pixi-filters';
import { useMemo } from 'react';

// --- SUB-COMPONENTS FOR PERFORMANCE ---

// 1. Grid & Highlights Layer
const OverlayLayer = ({ 
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

        // Grid Lines
        g.lineStyle(1, 0x333333, 0.3);
        const totalSize = (gridSize || 20) * TILE_SIZE; // Use passed gridSize prop or fallback calculation
        for (let i = 0; i <= gridSize; i++) {
            g.moveTo(i * TILE_SIZE, 0);
            g.lineTo(i * TILE_SIZE, totalSize);
            g.moveTo(0, i * TILE_SIZE);
            g.lineTo(totalSize, i * TILE_SIZE);
        }
        g.lineStyle(0);

    }, [mapData, units, currentPlayer, settings, weather, visibleTiles, validMoveTiles, validAttackTargets, validSpawnTiles, selectedTileId, hoveredTileId, placementMode, validSecureTile, validHeistTile, validSiegeTile, validDemolishTile, validLootTile, hoverPath, hoverMoveResolution, gridSize]);

    return <Graphics draw={draw} eventMode="none" />;
};

// 2. Zone & Fog Layer
const ZoneAndFogLayer = ({ mapData, visibleTiles, weather, settings, gridSize }: any) => {
    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();

        // Zones & Weather
        mapData.forEach((tile: Tile) => {
            const px = tile.x * TILE_SIZE;
            const py = tile.y * TILE_SIZE;

            // Height Map Overlay
            if (tile.height !== 1) {
                const isMountain = tile.height === 2;
                g.beginFill(isMountain ? 0xFFFFFF : 0x000000, tile.height === 0 ? 0.3 : 0.15);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.endFill();
            }

            // Hazard Overlay
            if (tile.hazardState === 'LAVA') {
                g.beginFill(0xFF0000, 0.6);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.endFill();
            } else if (tile.hazardState === 'WARNING') {
                g.beginFill(0xFFEB3B, 0.3);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.endFill();
            }

            // Weather Overlay
            if (tile.zone !== undefined) {
                const wType = weather.playerZones[tile.zone] || 'CLEAR';
                if (wType !== 'CLEAR') {
                    let color = 0xFFFFFF;
                    let alpha = 0.2;
                    if (wType === 'SCORCHED') { color = 0xFF5000; alpha = 0.25; }
                    if (wType === 'MONSOON') { color = 0x141E3C; alpha = 0.5; }
                    if (wType === 'FOG') { color = 0xDCDCDC; alpha = 0.6; }
                    if (wType === 'TAILWIND') { color = 0x64FF96; alpha = 0.15; }
                    if (wType === 'SANDSTORM') { color = 0xD4A35B; alpha = 0.4; }

                    g.beginFill(color, alpha);
                    g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                    g.endFill();
                }
            }

            // Fog
            if (settings.fogOfWar && !visibleTiles.has(tile.id)) {
                g.beginFill(0x000000, 0.6);
                g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
                g.endFill();
            }
        });
    }, [mapData, visibleTiles, weather, settings]);

    return <Graphics draw={draw} eventMode="none" />;
}

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

    // Phase 4: Atmosphere
    const bloomFilter = useMemo(() => new AdvancedBloomFilter({
        threshold: 0.5,
        bloomScale: 1.5,
        blur: 6,
        quality: 5
    }), []);

    // Derived Selection Data
    const selectedUnit = units.find(u => u.id === selectedUnitId);
    let selectedUnitPos = null;
    if (selectedUnit) {
        const t = mapData.find(tile => tile.id === selectedUnit.tileId);
        if (t) selectedUnitPos = { x: t.x * TILE_SIZE, y: t.y * TILE_SIZE };
    }
    const validLootTile = useGameStore(state => state.validLootTile);
    
    const weather = useGameStore(state => state.weather);
    const { isLoaded, progress } = useAssetLoader();

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

    if (!loaded && !isLoaded) return <div style={{color:'white'}}>Initializing Neural Interface... {Math.round(progress*100)}%</div>;

    const onTileClick = (x: number, y: number) => {
        handleTileClick(x, y);
    };

    return (
        <div ref={parentRef} style={{ width: '100%', height: '100%', position: 'relative', background: '#050505', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
            <Stage 
                width={dimensions.width} 
                height={dimensions.height} 
                options={{ background: 0x050505, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 }}
            >
                <GameViewport
                    width={dimensions.width}
                    height={dimensions.height}
                    worldWidth={gridSize * TILE_SIZE}
                    worldHeight={gridSize * TILE_SIZE}
                    setViewport={setViewport}
                >
                    {/* 1. TERRAIN LAYER */}
                    <Container name="terrain">
                        {mapData.map(tile => {
                            let texKey = `TERRAIN_${tile.type}`;
                            if (tile.type === 'BANK' && (tile.hackProgress || 0) >= 100) {
                                texKey = 'TERRAIN_BANK_EMPTY';
                            }
                            
                            return (
                                <SafeSprite
                                    key={tile.id}
                                    texture={getTexture(texKey)}
                                    x={tile.x * TILE_SIZE}
                                    y={tile.y * TILE_SIZE}
                                    width={TILE_SIZE}
                                    height={TILE_SIZE}
                                    eventMode="static"
                                    cursor="pointer"
                                    pointerdown={() => onTileClick(tile.x, tile.y)}
                                    pointerenter={() => setHoveredTile(tile.id)}
                                />
                            );
                        })}
                    </Container>

                    {/* 2. OVERLAYS (Height, Zones, Fog) */}
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

                    {/* 4. UNITS LAYER (With Bloom) */}
                    <Container name="units" filters={[bloomFilter]}>
                        {units.map(unit => {
                            const tile = mapData.find(t => t.id === unit.tileId);
                            if (!tile) return null;
                            
                            const isFriendly = unit.owner === currentPlayer;
                            const isVisible = !settings.fogOfWar || isFriendly || visibleTiles.has(unit.tileId);
                            const isSelected = selectedUnitId === unit.id;

                            if (!isVisible) return null;

                            return (
                                <UnitSprite 
                                    key={unit.id}
                                    unit={unit}
                                    texture={getTexture(`UNIT_P${unit.owner}_${unit.type}`)}
                                    x={tile.x * TILE_SIZE}
                                    y={tile.y * TILE_SIZE}
                                    isSelected={isSelected}
                                    onPointerDown={() => handleTileClick(tile.x, tile.y)}
                                />
                            );
                        })}
                    </Container>

                    {/* 5. LOOT & UI OVERLAYS */}
                    <Container name="ui_markers" eventMode="none">
                        {mapData.map(tile => {
                            if (!visibleTiles.has(tile.id) && settings.fogOfWar) return null;
                            if (!tile.loot && !tile.owner && tile.type !== 'BASE') return null;

                            return (
                                <Container key={`ui_${tile.id}`} x={tile.x * TILE_SIZE} y={tile.y * TILE_SIZE}>
                                    {tile.loot && (
                                        <Text 
                                            text="?" 
                                            anchor={0.5} 
                                            x={TILE_SIZE/2} 
                                            y={TILE_SIZE/2} 
                                            style={new PIXI.TextStyle({ 
                                                fill: '#FFD700', 
                                                fontSize: 20, 
                                                fontWeight: 'bold',
                                                stroke: 'black',
                                                strokeThickness: 3
                                            })} 
                                        />
                                    )}
                                    {/* Building Ownership Ring (Visible Border) */}
                                    {tile.type === 'BUILDING' && tile.owner !== undefined && (
                                        <Graphics 
                                            draw={g => {
                                                const colorStr = PLAYER_COLORS[tile.owner!] || '#FFFFFF';
                                                const color = parseInt(colorStr.replace('#', '0x'));
                                                
                                                // Outer Glow/Border
                                                g.lineStyle(4, color, 1); // Thicker line
                                                g.drawRect(0, 0, TILE_SIZE, TILE_SIZE); // Full Tile Border
                                                
                                                // Inner Fill (Subtle)
                                                g.lineStyle(0);
                                                g.beginFill(color, 0.2);
                                                g.drawRect(2, 2, TILE_SIZE-4, TILE_SIZE-4);
                                                g.endFill();
                                            }}
                                        />
                                    )}
                                    {/* Base HP */}
                                    {tile.type === 'BASE' && settings.victoryMode === 'CONQUER' && tile.hp !== undefined && (
                                        <Graphics 
                                            draw={g => {
                                                const pct = tile.hp! / tile.maxHp!;
                                                const ownerColorStr = PLAYER_COLORS[tile.owner!] || '#FF0000';
                                                const ownerColor = parseInt(ownerColorStr.replace('#', '0x'));
                                                
                                                g.beginFill(0x000000, 0.8);
                                                g.drawRect(4, 4, TILE_SIZE-8, 6);
                                                g.endFill();
                                                g.beginFill(ownerColor);
                                                g.drawRect(5, 5, (TILE_SIZE-10) * pct, 4);
                                                g.endFill();
                                            }}
                                        />
                                    )}
                                </Container>
                            )
                        })}
                    </Container>

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
