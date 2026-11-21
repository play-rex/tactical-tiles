import React, { useRef, useState, useEffect } from 'react';
import { Stage, Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { SafeSprite } from '../components/game/SafeSprite';
import { useGameStore } from '../store/useGameStore';
import { Tile, TerrainType, BuildingSubType } from '../core/types';
import {
  TILE_SIZE,
  PLAYER_COLORS,
  TERRAIN_DEFENSE,
  TERRAIN_COSTS,
  TERRAIN_COLORS,
  BUILDING_STATS,
  BASE_STATS,
  BANK_STATS,
} from '../core/constants/Config';
import { preloadTextures, getTexture } from '../core/graphics/TextureManager';
import { MapStorage } from '../core/storage/MapStorageManager';
import { GeoButton, GeoCard, GeoChip, GeoWell, PLAYER_UI_THEME } from '../components/ui/GeoPrimitives';

const createBlankMap = (size: number): Tile[] =>
  Array(size * size)
    .fill(null)
    .map((_, i) => {
      const x = i % size;
      const y = Math.floor(i / size);
      return { id: `${x},${y}`, x, y, type: 'PLAINS', height: 1, loot: null } as Tile;
    });

const TERRAIN_TYPES: TerrainType[] = [
  'PLAINS',
  'FOREST',
  'MOUNTAIN',
  'WATER',
  'SAND',
  'DUNES',
  'QUICKSAND',
  'CANYON',
  'ROAD',
  'ROAD_H',
  'BRIDGE',
  'BRIDGE_V',
  'BASE',
  'BANK',
  'BUILDING',
  'BARRIER',
];

const Section: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <GeoWell style={{ marginBottom: '12px' }} coreStyle={{ padding: '12px' }}>
    <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 900, textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.6px' }}>
      {title}
    </div>
    {children}
  </GeoWell>
);

const Stat: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color = 'var(--op-ink)' }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', fontSize: '13px' }}>
    <span style={{ color: 'var(--op-ink-muted)', fontWeight: 600 }}>{label}</span>
    <span style={{ fontWeight: 800, color }}>{value}</span>
  </div>
);

const RightIntelPanel: React.FC<{
  mode: 'PAINT' | 'ZONE';
  brush: TerrainType;
  brushSettings: { bankGold: number; bankCp: number; buildingType: BuildingSubType };
  activeZone: number | null;
}> = ({ mode, brush, brushSettings, activeZone }) => {
  if (mode === 'ZONE') {
    const zTheme = activeZone !== null ? PLAYER_UI_THEME[activeZone] : null;
    return (
      <GeoCard fill style={{ width: 'clamp(220px, 21vw, 280px)', flexShrink: 0, height: '100%' }}>
        <div className="opgeo-scroll" style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>
          <div style={{ borderBottom: '1.5px solid var(--op-line)', paddingBottom: '10px', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 900 }}>ZONE EDITOR</h2>
            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>METEOROLOGY &amp; CONTROL</div>
          </div>

          <Section title="Active Selection">
            {activeZone === null ? (
              <div style={{ color: 'var(--op-ink-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                NEUTRAL ZONE (No Weather Effects)
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '20px', fontWeight: 900, color: zTheme?.ink || 'var(--op-ink)', marginBottom: '6px' }}>
                  ZONE {activeZone + 1}
                </div>
                <p style={{ fontSize: '12px', color: 'var(--op-ink)', lineHeight: 1.5, margin: 0 }}>
                  Territory assigned to Player {activeZone + 1}. Dynamic weather rolls a condition for this zone every 5 turns.
                </p>
              </div>
            )}
          </Section>

          <Section title="Weather Possibilities">
            <ul style={{ paddingLeft: '18px', margin: 0, fontSize: '12px', color: 'var(--op-ink)', lineHeight: 1.7 }}>
              <li><strong style={{ color: '#C2410C' }}>SCORCHED:</strong> Heat increases move cost (+1).</li>
              <li><strong style={{ color: '#1344C4' }}>MONSOON:</strong> Rain slows heavy units on Plains.</li>
              <li><strong style={{ color: '#475569' }}>FOG:</strong> Caps vision range at 2 tiles.</li>
              <li><strong style={{ color: '#046C3E' }}>TAILWIND:</strong> +1 attack range &amp; faster Plains.</li>
              <li><strong style={{ color: '#8D5B1C' }}>SANDSTORM:</strong> Blinds units (Vision 3).</li>
            </ul>
          </Section>
        </div>
      </GeoCard>
    );
  }

  const def = TERRAIN_DEFENSE[brush] !== undefined ? Math.round(TERRAIN_DEFENSE[brush] * 100) : 0;
  const cost = TERRAIN_COSTS[brush] >= 99 ? 'IMPASSABLE' : TERRAIN_COSTS[brush];
  const previewColor = TERRAIN_COLORS[brush] || '#607D8B';

  let description = 'Standard terrain.';
  let tactical = 'No specific bonuses.';
  let weatherNotes = 'No specific interactions.';

  switch (brush) {
    case 'PLAINS':
      description = 'Open flat ground with minimal obstruction.';
      tactical = 'Neutral ground. No defense bonuses. Easy to traverse.';
      weatherNotes = 'Susceptible to SCORCHED (+Cost) and TAILWIND (-Cost).';
      break;
    case 'FOREST':
      description = 'Dense vegetation and trees.';
      tactical = 'Provides 40% Defense cover. Costs 2 CP to traverse.';
      break;
    case 'MOUNTAIN':
      description = 'High elevation rocky terrain.';
      tactical = 'High ground. Enables SNIPERS to fire and provides +40% defense cover (3 CP).';
      weatherNotes = 'Blocks Line of Sight from lower terrain.';
      break;
    case 'WATER':
      description = 'Deep water bodies.';
      tactical = 'Impassable to ground units. Requires BRIDGES to cross.';
      break;
    case 'SAND':
      description = 'Loose, shifting sand.';
      tactical = 'Exposed footing (+10% more damage taken).';
      weatherNotes = 'SCORCHED increases move cost to 2.';
      break;
    case 'DUNES':
      description = 'Large sand dunes obstructing view.';
      tactical = 'Blocks LOS. Provides +20% Cover and Sniper High Ground.';
      break;
    case 'QUICKSAND':
      description = 'Deceptive liquid soil.';
      tactical = 'HAZARD: Entering ROOTS the unit for 1 turn.';
      break;
    case 'CANYON':
      description = 'Deep geological rift.';
      tactical = 'IMPASSABLE to movement. Does NOT block Line of Sight.';
      break;
    case 'BASE':
      description = 'Military Headquarters.';
      tactical = `Spawn point (${BASE_STATS.HP} HP) with Artillery (${BASE_STATS.RANGE} Range).`;
      break;
    case 'BANK':
      description = 'Financial storage vault.';
      tactical = `Can be HEISTED for Gold/CP. Protected by Turrets (${BANK_STATS.DAMAGE} DMG).`;
      break;
    case 'BUILDING':
      if (brushSettings.buildingType === 'WATCHTOWER') {
        description = 'Observation Tower.';
        tactical = `+${BUILDING_STATS.WATCHTOWER.rangeBonus} Range, +${Math.round((BUILDING_STATS.WATCHTOWER.damageBonus - 1) * 100)}% Damage.`;
      } else {
        description = 'Reinforced Bunker.';
        tactical = `+${Math.round(BUILDING_STATS.BUNKER.defense * 100)}% Defense, +${BUILDING_STATS.BUNKER.rangeBonus} Range.`;
      }
      break;
    case 'BARRIER':
      description = 'Artificial blockade.';
      tactical = 'Blocks all movement. High cover (80%) if standing behind it.';
      break;
    case 'ROAD':
    case 'ROAD_H':
      description = 'Paved infrastructure.';
      tactical = 'Fast travel (1 CP cost).';
      break;
    case 'BRIDGE':
    case 'BRIDGE_V':
      description = 'Water/Canyon crossing.';
      tactical = 'Allows movement across Water or Canyons (1 CP cost).';
      break;
  }

  return (
    <GeoCard fill style={{ width: 'clamp(220px, 21vw, 280px)', flexShrink: 0, height: '100%' }}>
      <div className="opgeo-scroll" style={{ padding: '14px', overflowY: 'auto', flex: 1 }}>
        <div style={{ borderBottom: '1.5px solid var(--op-line)', paddingBottom: '10px', marginBottom: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 900 }}>INTEL DATABASE</h2>
          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>TERRAIN ANALYSIS</div>
        </div>

        <GeoWell style={{ marginBottom: '12px' }} coreStyle={{ padding: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div className="geo-chip" style={{ width: '40px', height: '40px', background: previewColor, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '16px', fontWeight: 900 }}>{brush}</div>
            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>
              {brush === 'BUILDING' ? brushSettings.buildingType : 'TERRAIN FEATURE'}
            </div>
          </div>
        </GeoWell>

        <Section title="Description">
          <p style={{ fontSize: '12px', color: 'var(--op-ink)', lineHeight: 1.5, margin: 0 }}>{description}</p>
        </Section>

        <Section title="Combat Statistics">
          <Stat label="Move Cost" value={cost} color={cost === 'IMPASSABLE' ? 'var(--acc-red-ink)' : typeof cost === 'number' && cost > 1 ? 'var(--acc-amber-ink)' : 'var(--acc-mint-ink)'} />
          <Stat label="Defense Bonus" value={def < 0 ? `${def}%` : `+${def}%`} color={def < 0 ? 'var(--acc-red-ink)' : def > 0 ? 'var(--acc-mint-ink)' : 'var(--op-ink-muted)'} />
          {brush === 'BANK' && (
            <>
              <Stat label="Gold Reward" value={brushSettings.bankGold} color="var(--acc-amber-ink)" />
              <Stat label="CP Reward" value={brushSettings.bankCp} color="var(--acc-blue-ink)" />
            </>
          )}
          {brush === 'BASE' && <Stat label="Base Integrity" value={`${BASE_STATS.HP} HP`} color="var(--acc-red-ink)" />}
        </Section>

        <Section title="Tactical Analysis">
          <p style={{ fontSize: '12px', color: 'var(--op-ink)', lineHeight: 1.5, margin: 0 }}>{tactical}</p>
        </Section>

        <Section title="Weather Conditions">
          <p style={{ fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>{weatherNotes}</p>
        </Section>
      </div>
    </GeoCard>
  );
};

export const MapEditor: React.FC = () => {
  const exitEditor = useGameStore(state => state.exitEditor);
  const loadMapAndStart = useGameStore(state => state.loadMapAndStart);
  const mapToEdit = useGameStore(state => state.mapToEdit);

  const [mapSize, setMapSize] = useState<number>(() => (mapToEdit ? mapToEdit.width : 20));
  const [mapData, setMapData] = useState<Tile[]>(() =>
    mapToEdit ? JSON.parse(JSON.stringify(mapToEdit.data)) : createBlankMap(20)
  );
  const [history, setHistory] = useState<Tile[][]>([]);

  const [mode, setMode] = useState<'PAINT' | 'ZONE'>('PAINT');
  const [activeBrush, setActiveBrush] = useState<TerrainType>('PLAINS');
  const [activeZone, setActiveZone] = useState<number | null>(0);
  const [isDrawing, setIsDrawing] = useState(false);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pendingResize, setPendingResize] = useState<number | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [mapName, setMapName] = useState(() => (mapToEdit ? mapToEdit.name : ''));
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);

  const showNotice = (text: string, isError = false) => {
    setNotice({ text, isError });
    setTimeout(() => setNotice(prev => (prev?.text === text ? null : prev)), 3200);
  };

  const [brushSettings, setBrushSettings] = useState({
    bankGold: 200,
    bankCp: 10,
    buildingType: 'WATCHTOWER' as BuildingSubType,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const [imagesLoaded, setImagesLoaded] = useState(false);
  const [layout, setLayout] = useState({ width: 200, height: 200, scale: 0.2, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    preloadTextures().then(() => setImagesLoaded(true));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const resize = () => {
      if (!containerRef.current) return;
      const clientWidth = Math.max(1, containerRef.current.clientWidth);
      const clientHeight = Math.max(1, containerRef.current.clientHeight);
      const worldSize = mapSize * TILE_SIZE;
      const scale = Math.min(clientWidth / worldSize, clientHeight / worldSize) * 0.94;
      const offsetX = (clientWidth - worldSize * scale) / 2;
      const offsetY = (clientHeight - worldSize * scale) / 2;
      setLayout({ width: clientWidth, height: clientHeight, scale, offsetX, offsetY });
    };
    const obs = new ResizeObserver(resize);
    obs.observe(containerRef.current);
    resize();
    return () => obs.disconnect();
  }, [mapSize, imagesLoaded]);

  const handleUndo = () => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setHistory(prev => prev.slice(0, prev.length - 1));
    setMapData(previousState);
  };

  const requestClearMap = () => setShowClearConfirm(true);
  const executeClear = () => {
    setHistory(prev => [...prev, mapData]);
    setMapData(createBlankMap(mapSize));
    setShowClearConfirm(false);
  };

  const handleResize = (size: number) => {
    if (size === mapSize) return;
    if (mapData.some(t => t.type !== 'PLAINS')) {
      setPendingResize(size);
      return;
    }
    setMapSize(size);
    setMapData(createBlankMap(size));
    setHistory([]);
  };

  const confirmResize = () => {
    if (pendingResize === null) return;
    setMapSize(pendingResize);
    setMapData(createBlankMap(pendingResize));
    setHistory([]);
    setPendingResize(null);
  };

  const handlePaint = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const worldX = (mouseX - layout.offsetX) / layout.scale;
    const worldY = (mouseY - layout.offsetY) / layout.scale;
    const gridX = Math.floor(worldX / TILE_SIZE);
    const gridY = Math.floor(worldY / TILE_SIZE);

    if (gridX < 0 || gridX >= mapSize || gridY < 0 || gridY >= mapSize) return;

    setMapData(prev => {
      const idx = gridY * mapSize + gridX;
      if (prev[idx].type === activeBrush && mode === 'PAINT') {
        if (activeBrush === 'BANK' && prev[idx].bankGoldReward === brushSettings.bankGold && prev[idx].bankCpReward === brushSettings.bankCp) return prev;
        if (activeBrush === 'BUILDING' && prev[idx].subType === brushSettings.buildingType) return prev;
        if (activeBrush !== 'BANK' && activeBrush !== 'BUILDING') return prev;
      }
      if (mode === 'ZONE' && prev[idx].zone === activeZone) return prev;

      const newMap = [...prev];
      const oldTile = newMap[idx];

      if (mode === 'ZONE') {
        const newTile = { ...oldTile };
        if (activeZone === null) delete newTile.zone;
        else newTile.zone = activeZone;
        newMap[idx] = newTile;
        return newMap;
      }

      if ((activeBrush === 'BRIDGE' || activeBrush === 'BRIDGE_V') && oldTile.type !== 'WATER' && oldTile.type !== 'CANYON') return prev;

      let newHeight = 1;
      if (activeBrush === 'WATER' || activeBrush === 'CANYON') newHeight = 0;
      if (activeBrush === 'MOUNTAIN' || activeBrush === 'DUNES') newHeight = 2;

      const newTile: Tile = {
        ...oldTile,
        type: activeBrush,
        height: newHeight,
        subType: undefined,
        bankGoldReward: undefined,
        bankCpReward: undefined,
      };

      if (activeBrush === 'BANK') {
        newTile.bankGoldReward = brushSettings.bankGold;
        newTile.bankCpReward = brushSettings.bankCp;
      } else if (activeBrush === 'BUILDING') {
        newTile.subType = brushSettings.buildingType;
      }

      newMap[idx] = newTile;
      return newMap;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setHistory(prev => [...prev, mapData]);
    setIsDrawing(true);
    handlePaint(e);
  };

  const handleSave = () => {
    const baseCount = mapData.filter(t => t.type === 'BASE').length;
    if (baseCount < 2) {
      showNotice('Map must have at least 2 BASES to be playable.', true);
      return;
    }
    setShowSaveModal(true);
  };

  const executeSave = () => {
    if (!mapName.trim()) return;
    MapStorage.save({
      id: `custom_${Date.now()}`,
      name: mapName,
      author: 'Player',
      width: mapSize,
      height: mapSize,
      createdAt: Date.now(),
      isPreset: false,
      data: mapData,
      baseCount: mapData.filter(t => t.type === 'BASE').length,
    });
    setShowSaveModal(false);
    setMapName('');
    showNotice('Map saved to Local Storage!');
  };

  const handleLoadPlay = () => {
    const baseCount = mapData.filter(t => t.type === 'BASE').length;
    if (baseCount < 2) {
      showNotice('Map must have at least 2 BASES to test play.', true);
      return;
    }
    loadMapAndStart(mapData);
  };

  if (!imagesLoaded) {
    return (
      <div className="opgeo-stage" style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>
        Loading Editor Resources...
      </div>
    );
  }

  const baseCount = mapData.filter(t => t.type === 'BASE').length;

  return (
    <div
      className="opgeo-stage"
      style={{ width: '100vw', height: '100vh', display: 'flex', padding: '10px', gap: '10px', overflow: 'hidden' }}
    >
      {/* LEFT PALETTE */}
      <GeoCard fill style={{ width: 'clamp(215px, 19vw, 265px)', flexShrink: 0, height: '100%' }}>
        <div className="opgeo-scroll" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 900, letterSpacing: '0.6px' }}>ACTIONS</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <GeoButton fullWidth onClick={exitEditor} coreStyle={{ padding: '7px' }}>EXIT</GeoButton>
            <GeoButton variant="mint" fullWidth onClick={handleLoadPlay} coreStyle={{ padding: '7px' }}>TEST MAP</GeoButton>
            <GeoButton variant="amber" fullWidth onClick={handleSave} coreStyle={{ padding: '7px' }}>SAVE MAP</GeoButton>
            <GeoButton fullWidth disabled={history.length === 0} onClick={handleUndo} coreStyle={{ padding: '7px' }}>UNDO</GeoButton>
          </div>
          <GeoButton variant="softRed" fullWidth onClick={requestClearMap} coreStyle={{ padding: '7px' }}>
            CLEAR MAP
          </GeoButton>

          <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 900, marginBottom: '6px' }}>MAP SIZE</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              {[20, 25, 30].map(s => (
                <GeoButton
                  key={s}
                  variant={mapSize === s ? 'blue' : 'default'}
                  fullWidth
                  onClick={() => handleResize(s)}
                  coreStyle={{ padding: '6px 4px' }}
                >
                  {s}×{s}
                </GeoButton>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '8px' }}>
            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 900, marginBottom: '6px' }}>EDITOR TOOL</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <GeoButton variant={mode === 'PAINT' ? 'blue' : 'default'} fullWidth onClick={() => setMode('PAINT')} coreStyle={{ padding: '6px' }}>
                TERRAIN
              </GeoButton>
              <GeoButton variant={mode === 'ZONE' ? 'violet' : 'default'} fullWidth onClick={() => setMode('ZONE')} coreStyle={{ padding: '6px' }}>
                ZONES
              </GeoButton>
            </div>
          </div>

          {mode === 'PAINT' ? (
            <>
              <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 900 }}>BRUSHES</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                {TERRAIN_TYPES.map(type => (
                  <GeoButton
                    key={type}
                    variant={activeBrush === type ? 'mint' : 'default'}
                    fullWidth
                    onClick={() => setActiveBrush(type)}
                    coreStyle={{ padding: '6px 5px', justifyContent: 'flex-start' }}
                  >
                    <span
                      className="geo-chip"
                      style={{
                        width: '9px',
                        height: '9px',
                        background: TERRAIN_COLORS[type] || '#555',
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{type}</span>
                  </GeoButton>
                ))}
              </div>

              {(activeBrush === 'BANK' || activeBrush === 'BUILDING' || ['BARRIER', 'QUICKSAND', 'CANYON', 'SAND'].includes(activeBrush)) && (
                <GeoWell coreStyle={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)' }}>BRUSH SETTINGS</div>
                  {activeBrush === 'BANK' && (
                    <>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '3px' }}>Max Gold: {brushSettings.bankGold}</div>
                        <input className="opgeo-range" type="range" min="50" max="400" step="50" value={brushSettings.bankGold} onChange={e => setBrushSettings({ ...brushSettings, bankGold: parseInt(e.target.value, 10) })} style={{ width: '100%' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '3px' }}>Max CP: {brushSettings.bankCp}</div>
                        <input className="opgeo-range" type="range" min="0" max="15" step="1" value={brushSettings.bankCp} onChange={e => setBrushSettings({ ...brushSettings, bankCp: parseInt(e.target.value, 10) })} style={{ width: '100%' }} />
                      </div>
                    </>
                  )}
                  {activeBrush === 'BUILDING' && (
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '4px' }}>Defense Type</div>
                      <select
                        value={brushSettings.buildingType}
                        onChange={e => setBrushSettings({ ...brushSettings, buildingType: e.target.value as BuildingSubType })}
                        style={{ width: '100%', padding: '6px', background: '#FFFFFF', color: 'var(--op-ink)', border: '1px solid var(--op-line)', borderRadius: '6px', fontSize: '12px', fontWeight: 700 }}
                      >
                        <option value="WATCHTOWER">Watchtower (Range)</option>
                        <option value="BUNKER">Bunker (Defense)</option>
                      </select>
                    </div>
                  )}
                  {activeBrush === 'BARRIER' && <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 700 }}>Blocks movement completely.</div>}
                  {activeBrush === 'QUICKSAND' && <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 700 }}>ROOTS unit for 1 Turn.</div>}
                  {activeBrush === 'CANYON' && <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 700 }}>Impassable, allows shooting.</div>}
                  {activeBrush === 'SAND' && <div style={{ fontSize: '12px', color: 'var(--acc-red-ink)', fontWeight: 700 }}>Negative Cover (-10% Defense).</div>}
                </GeoWell>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 900 }}>WEATHER ZONES</div>
              <GeoButton variant={activeZone === null ? 'blue' : 'default'} fullWidth onClick={() => setActiveZone(null)}>
                NEUTRAL / NO ZONE
              </GeoButton>
              {[0, 1, 2, 3, 4, 5].map(pid => {
                const zTheme = PLAYER_UI_THEME[pid];
                const isSel = activeZone === pid;
                return (
                  <GeoButton
                    key={pid}
                    fullWidth
                    onClick={() => setActiveZone(pid)}
                    coreStyle={{
                      background: isSel ? zTheme.badgeBg : undefined,
                      color: isSel ? zTheme.badgeText : zTheme.ink,
                    }}
                  >
                    ZONE {pid + 1}
                  </GeoButton>
                );
              })}
              <GeoWell coreStyle={{ padding: '8px', fontSize: '12px', color: 'var(--op-ink-muted)' }}>
                Paint zones manually to define weather regions.
              </GeoWell>
            </div>
          )}
        </div>
      </GeoCard>

      {/* CENTER CANVAS COLUMN */}
      <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative' }}>
        <GeoCard>
          <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>
              <strong>Builder Steps:</strong> 1. Place 2+ BASE tiles → 2. Paint Terrain &amp; Banks → 3. Click TEST MAP
            </span>
            <GeoChip variant={baseCount >= 2 ? 'softMint' : 'softAmber'}>
              BASES: {baseCount} / 2+ REQUIRED
            </GeoChip>
          </div>
        </GeoCard>

        <GeoCard fill style={{ flex: 1, minHeight: 0 }}>
          <div style={{ padding: '8px', flex: 1, minHeight: 0, display: 'flex' }}>
            <div className="geo-frame-rim" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <div
                ref={containerRef}
                className="geo-frame-core"
                style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', cursor: 'crosshair', overflow: 'hidden' }}
                onMouseDown={handleMouseDown}
                onMouseMove={e => {
                  if (isDrawing) handlePaint(e);
                }}
                onMouseUp={() => setIsDrawing(false)}
                onMouseLeave={() => setIsDrawing(false)}
              >
                <div style={{ position: 'absolute', inset: 0 }}>
                  <Stage width={layout.width} height={layout.height} options={{ backgroundAlpha: 0, antialias: true }}>
                  <Container x={layout.offsetX} y={layout.offsetY} scale={layout.scale}>
                    <Graphics
                      draw={g => {
                        g.clear();
                        g.beginFill(0x273041, 0.25);
                        g.drawRect(10, 12, mapSize * TILE_SIZE, mapSize * TILE_SIZE);
                        g.endFill();
                        g.beginFill(0x1b2230);
                        g.drawRect(0, 0, mapSize * TILE_SIZE, mapSize * TILE_SIZE);
                        g.endFill();
                        g.lineStyle(3, 0x273041, 1);
                        g.drawRect(-1.5, -1.5, mapSize * TILE_SIZE + 3, mapSize * TILE_SIZE + 3);
                      }}
                    />

                    {mapData.map(tile => {
                      const texKey = `TERRAIN_${tile.type}`;
                      return (
                        <Container key={tile.id} x={tile.x * TILE_SIZE} y={tile.y * TILE_SIZE}>
                          <SafeSprite texture={getTexture(texKey)} width={TILE_SIZE} height={TILE_SIZE} tint={0xffffff} />

                          {tile.height !== 1 && (
                            <Graphics
                              eventMode="none"
                              draw={g => {
                                g.clear();
                                if (tile.height === 0) {
                                  g.beginFill(0x000000, 0.4);
                                  g.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
                                  g.endFill();
                                } else if (tile.height === 2) {
                                  g.beginFill(0xffffff, 0.1);
                                  g.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
                                  g.endFill();
                                  g.lineStyle(2, 0xffffff, 0.5);
                                  g.drawRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
                                }
                              }}
                            />
                          )}

                          {tile.zone !== undefined && (
                            <>
                              <Graphics
                                eventMode="none"
                                draw={g => {
                                  const colorStr = PLAYER_COLORS[tile.zone! % 6] || '#ffffff';
                                  const color = parseInt(colorStr.replace('#', '0x'), 16);
                                  g.beginFill(color, 0.25);
                                  g.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
                                  g.endFill();
                                }}
                              />
                              {mode === 'ZONE' && (
                                <Text
                                  text={`Z${tile.zone + 1}`}
                                  x={4}
                                  y={14}
                                  style={new PIXI.TextStyle({ fill: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 'bold' })}
                                />
                              )}
                            </>
                          )}

                          {tile.type === 'BANK' && (
                            <Text
                              text={`$${tile.bankGoldReward || 200}`}
                              x={34}
                              y={58}
                              anchor={0.5}
                              style={new PIXI.TextStyle({ fill: 'black', fontSize: 8, fontWeight: 'bold' })}
                            />
                          )}

                          <Graphics
                            draw={g => {
                              g.lineStyle(1, 0xffffff, 0.05);
                              g.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
                            }}
                          />
                        </Container>
                      );
                    })}
                  </Container>
                </Stage>
                </div>
              </div>
            </div>
          </div>
        </GeoCard>

        {notice && (
          <div style={{ position: 'absolute', top: '54px', left: '50%', transform: 'translateX(-50%)', zIndex: 120 }}>
            <GeoCard armed={notice.isError}>
              <div style={{ padding: '8px 16px', fontSize: '12px', fontWeight: 900, color: notice.isError ? 'var(--acc-red-ink)' : 'var(--acc-mint-ink)' }}>
                {notice.text}
              </div>
            </GeoCard>
          </div>
        )}

        {pendingResize !== null && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,33,0.72)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}>
            <GeoCard armed style={{ width: '340px' }}>
              <div style={{ padding: '22px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0, color: 'var(--acc-amber-ink)' }}>RESIZE TO {pendingResize}×{pendingResize}?</h3>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--op-ink-muted)' }}>Changing grid size resets the current map.</p>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <GeoButton fullWidth onClick={() => setPendingResize(null)}>CANCEL</GeoButton>
                  <GeoButton variant="amber" fullWidth onClick={confirmResize}>RESIZE</GeoButton>
                </div>
              </div>
            </GeoCard>
          </div>
        )}

        {showClearConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,33,0.72)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}>
            <GeoCard armed style={{ width: '340px' }}>
              <div style={{ padding: '22px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0, color: 'var(--acc-red-ink)' }}>CLEAR ENTIRE MAP?</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <GeoButton fullWidth onClick={() => setShowClearConfirm(false)}>CANCEL</GeoButton>
                  <GeoButton variant="red" fullWidth onClick={executeClear}>CONFIRM</GeoButton>
                </div>
              </div>
            </GeoCard>
          </div>
        )}

        {showSaveModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,33,0.72)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 150 }}>
            <GeoCard armed style={{ width: '340px' }}>
              <div style={{ padding: '22px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h3 style={{ margin: 0, color: 'var(--acc-amber-ink)' }}>SAVE CUSTOM MAP</h3>
                <input
                  type="text"
                  placeholder="Enter Map Name..."
                  value={mapName}
                  onChange={e => setMapName(e.target.value)}
                  style={{ width: '100%', padding: '10px', background: '#FFFFFF', border: '1.5px solid var(--op-line)', borderRadius: '6px', fontSize: '13px', fontWeight: 700 }}
                />
                <div style={{ display: 'flex', gap: '10px' }}>
                  <GeoButton fullWidth onClick={() => setShowSaveModal(false)}>CANCEL</GeoButton>
                  <GeoButton variant="amber" fullWidth disabled={!mapName.trim()} onClick={executeSave}>SAVE</GeoButton>
                </div>
              </div>
            </GeoCard>
          </div>
        )}
      </div>

      {/* RIGHT INTEL PANEL */}
      <RightIntelPanel mode={mode} brush={activeBrush} brushSettings={brushSettings} activeZone={activeZone} />
    </div>
  );
};
