import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { GameSettings, UnitType, AIDifficulty, SavedMap, MissionConfig } from '../core/types';
import { PRESET_MAPS } from '../core/assets/Presets';
import { CHALLENGE_OPERATIONS } from '../core/assets/ChallengeOps';
import { UNIT_STATS } from '../core/constants/Config';
import { MapStorage } from '../core/storage/MapStorageManager';
import { generateSectorSeed } from '../core/utils/SeededRandom';
import { CareerStorage } from '../core/storage/CareerStatsManager';
import { GeoButton, GeoCard, GeoChip, GeoToggle, GeoWell } from '../components/ui/GeoPrimitives';

interface MapCardProps {
  map: SavedMap;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  onEdit?: (e: React.MouseEvent) => void;
}

const MapCard: React.FC<MapCardProps> = ({ map, isSelected, onClick, onDelete, onEdit }) => (
  <GeoCard
    onClick={onClick}
    accentColor={isSelected ? 'var(--acc-blue)' : undefined}
    style={{ cursor: 'pointer' }}
  >
    <div
      style={{
        padding: '10px 12px',
        background: isSelected ? 'var(--acc-blue-soft)' : undefined,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 900, fontSize: '13px', color: isSelected ? 'var(--acc-blue-ink)' : 'var(--op-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {map.name}
        </div>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--op-ink-muted)' }}>
          {map.width}×{map.height} • {map.baseCount} Bases
        </div>
      </div>

      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
        {onEdit && (
          <GeoButton
            variant="softAmber"
            title="Edit Map"
            onClick={e => {
              e.stopPropagation();
              onEdit(e);
            }}
            coreStyle={{ padding: '4px 8px' }}
          >
            ✎
          </GeoButton>
        )}
        {!map.isPreset && onDelete && (
          <GeoButton
            variant="softRed"
            title="Delete Map"
            onClick={e => {
              e.stopPropagation();
              onDelete(e);
            }}
            coreStyle={{ padding: '4px 8px' }}
          >
            ×
          </GeoButton>
        )}
      </div>
    </div>
  </GeoCard>
);

export const GameSetup: React.FC = () => {
  const startGame = useGameStore(state => state.startGame);
  const startChallenge = useGameStore(state => state.startChallenge);
  const loadMapAndStart = useGameStore(state => state.loadMapAndStart);
  const openEditor = useGameStore(state => state.openEditor);
  const loadMapIntoEditor = useGameStore(state => state.loadMapIntoEditor);
  const openTutorial = useGameStore(state => state.openTutorial);
  const setGameSettings = useGameStore(state => state.setGameSettings);

  const [activeTab, setActiveTab] = useState<'RANDOM' | 'PRESET' | 'CUSTOM' | 'CHALLENGES'>('RANDOM');
  const [selectedMap, setSelectedMap] = useState<SavedMap | null>(null);
  const [selectedChallenge, setSelectedChallenge] = useState<MissionConfig>(CHALLENGE_OPERATIONS[0]);
  const [customMaps, setCustomMaps] = useState<SavedMap[]>([]);
  const career = CareerStorage.get();

  const [settings, setSettings] = useState<GameSettings>({
    playerCount: 2,
    unitCounts: { SOLDIER: 3, ASSAULTER: 2, SNIPER: 1 },
    dynamicWeather: true,
    fogOfWar: false,
    doomsdayEnabled: false,
    gameMode: 'PVP',
    victoryMode: 'CONQUER',
    aiDifficulty: 'MEDIUM',
    mapSeed: '',
    mutators: { blitzCp: false, scarcity: false, ironman: false },
  });

  useEffect(() => {
    if (activeTab === 'CUSTOM') {
      setCustomMaps(MapStorage.getAll());
    }
    setSelectedMap(null);
  }, [activeTab]);

  useEffect(() => {
    if (selectedMap) {
      setSettings(s => ({
        ...s,
        playerCount: Math.min(s.playerCount, selectedMap.baseCount || 2),
      }));
    }
  }, [selectedMap]);

  const updateCount = (type: UnitType, delta: number) => {
    const max = type === 'SOLDIER' ? 5 : type === 'ASSAULTER' ? 4 : 3;
    const current = settings.unitCounts[type];
    const next = Math.min(max, Math.max(0, current + delta));
    setSettings({
      ...settings,
      unitCounts: { ...settings.unitCounts, [type]: next },
    });
  };

  const handleDeploy = () => {
    if (activeTab === 'CHALLENGES') {
      startChallenge(selectedChallenge.id);
      return;
    }
    setGameSettings(settings);
    if (activeTab === 'RANDOM') {
      startGame();
    } else {
      if (!selectedMap) return;
      loadMapAndStart(selectedMap.data);
    }
  };

  const handleDeleteMap = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this map?')) {
      MapStorage.delete(id);
      setCustomMaps(MapStorage.getAll());
      if (selectedMap?.id === id) setSelectedMap(null);
    }
  };

  const handleEditMap = (e: React.MouseEvent, map: SavedMap) => {
    e.stopPropagation();
    loadMapIntoEditor(map);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttmap,.json';
    input.onchange = (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = re => {
        if (re.target?.result) {
          MapStorage.import(re.target.result as string);
          setCustomMaps(MapStorage.getAll());
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const totalUnits = settings.unitCounts.SOLDIER + settings.unitCounts.ASSAULTER + settings.unitCounts.SNIPER;
  const canDeploy = activeTab === 'CHALLENGES' || (totalUnits > 0 && (activeTab === 'RANDOM' || Boolean(selectedMap)));
  const randomGridPreview = settings.playerCount >= 6 ? '30×30' : settings.playerCount >= 4 ? '25×25' : '20×20';

  const unitMeta: Array<{ type: UnitType; label: string; max: number; role: string }> = [
    { type: 'SOLDIER', label: 'SCOUT', max: 5, role: 'Fast recon, captures & heists (3 CP)' },
    { type: 'ASSAULTER', label: 'BREACHER', max: 4, role: 'Heavy frontline siege unit (5 CP)' },
    { type: 'SNIPER', label: 'SNIPER', max: 3, role: 'High-ground precision cannon (8 CP)' },
  ];

  return (
    <div
      className="opgeo-stage opgeo-scroll"
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
    >
      <div style={{ width: 'min(1140px, 96vw)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* TOP CONSOLE HEADER BAR */}
        <GeoCard>
          <div
            style={{
              padding: '10px 16px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
              <span
                className="geo-chip"
                style={{
                  background: 'var(--acc-violet)',
                  color: '#FFFFFF',
                  padding: '6px 14px',
                  fontSize: '15px',
                  fontWeight: 900,
                  letterSpacing: '0.8px',
                }}
              >
                TACTICAL TILES
              </span>

              {(career.gamesPlayed > 0 || Object.keys(career.challengeMedals || {}).length > 0) ? (
                <GeoChip variant="softMint" style={{ padding: '5px 10px' }}>
                  {career.wins}W–{career.losses}L • {Object.keys(career.challengeMedals || {}).length}/{CHALLENGE_OPERATIONS.length} OPS • BEST {career.bestGrade ?? '-'} • STREAK {career.bestStreak} • {career.fastestWinRounds ? `${career.fastestWinRounds}R FAST` : 'NO WIN'} • {career.totalAcesPromoted} ACES
                </GeoChip>
              ) : (
                <GeoChip variant="softBlue" style={{ padding: '5px 10px' }}>
                  STEP 1: PICK MAP → STEP 2: SET RULES &amp; SQUAD → DEPLOY
                </GeoChip>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <GeoButton onClick={openTutorial} coreStyle={{ padding: '7px 14px' }}>
                ? HOW TO PLAY
              </GeoButton>
              <GeoButton variant="softBlue" onClick={openEditor} coreStyle={{ padding: '7px 14px' }}>
                OPEN MAP EDITOR
              </GeoButton>
            </div>
          </div>
        </GeoCard>

        {/* MAIN 2-COLUMN DECK */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(290px, 38%) minmax(0, 1fr)',
            gap: '14px',
            alignItems: 'stretch',
          }}
        >
          {/* LEFT: MAP SOURCE & CHALLENGES LIST */}
          <GeoCard fill>
            <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
              <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' }}>
                1. SELECT BATTLEFIELD
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[
                  ['RANDOM', 'RANDOM', 'violet'],
                  ['PRESET', 'PRESETS', 'violet'],
                  ['CUSTOM', 'MY MAPS', 'violet'],
                  ['CHALLENGES', 'OPS', 'amber'],
                ].map(([tabId, label, activeVar]) => (
                  <GeoButton
                    key={tabId}
                    variant={activeTab === tabId ? (activeVar as 'violet' | 'amber') : 'default'}
                    fullWidth
                    onClick={() => setActiveTab(tabId as typeof activeTab)}
                    coreStyle={{ padding: '8px 4px' }}
                  >
                    {label}
                  </GeoButton>
                ))}
              </div>

              <div className="opgeo-scroll" style={{ flex: 1, overflowY: 'auto', maxHeight: '430px', paddingRight: '3px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeTab === 'RANDOM' && (
                  <>
                    <GeoWell coreStyle={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)' }}>
                        SHAREABLE SECTOR SEED
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <input
                          type="text"
                          maxLength={12}
                          placeholder="AUTO RANDOM SEED"
                          value={settings.mapSeed || ''}
                          onChange={e => setSettings({ ...settings, mapSeed: e.target.value.toUpperCase() })}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            padding: '8px 10px',
                            background: '#FFFFFF',
                            border: '1.5px solid var(--op-line)',
                            borderRadius: '6px',
                            color: 'var(--op-ink)',
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            fontWeight: 800,
                            letterSpacing: '1px',
                            outline: 'none',
                          }}
                        />
                        <GeoButton
                          title="Roll Random Sector Seed"
                          onClick={() => setSettings({ ...settings, mapSeed: generateSectorSeed() })}
                          coreStyle={{ padding: '7px 12px' }}
                        >
                          🎲 ROLL
                        </GeoButton>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.4 }}>
                        Enter a seed to replay or share an exact map layout &amp; weather schedule, or leave blank for a fresh roll.
                      </div>
                      {settings.mapSeed && (
                        <button
                          type="button"
                          onClick={() => setSettings({ ...settings, mapSeed: '' })}
                          style={{
                            alignSelf: 'flex-start',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--acc-blue-ink)',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: 0,
                            textDecoration: 'underline',
                          }}
                        >
                          Clear seed (generate fresh on deploy)
                        </button>
                      )}
                    </GeoWell>

                    <GeoWell coreStyle={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink)' }}>
                        Grid Size &amp; Core Rule:
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.4 }}>
                        Map scales automatically by player count: 2–3P = 20×20, 4–5P = <strong>25×25</strong>, 6P = 30×30. All units share a <strong>20 CP</strong> command battery (+10 CP/turn).
                      </div>
                    </GeoWell>
                  </>
                )}

                {activeTab === 'PRESET' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {PRESET_MAPS.map(map => (
                      <MapCard
                        key={map.id}
                        map={map}
                        isSelected={selectedMap?.id === map.id}
                        onClick={() => setSelectedMap(map)}
                        onEdit={e => handleEditMap(e, map)}
                      />
                    ))}
                    <GeoWell coreStyle={{ padding: '10px 12px', fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.4 }}>
                      <strong>Tactical Recon: Iron Confluence</strong> showcases every procedural HD biome, auto-tiled river, canyon gorge, mountain ridge, forest grove, bunker &amp; road network.
                    </GeoWell>
                  </div>
                )}

                {activeTab === 'CUSTOM' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {customMaps.length === 0 && (
                      <GeoWell coreStyle={{ padding: '16px', textAlign: 'center', color: 'var(--op-ink-muted)', fontSize: '12px' }}>
                        No custom maps saved yet. Open the Map Editor or import a `.ttmap` / `.json` file.
                      </GeoWell>
                    )}
                    {customMaps.map(map => (
                      <MapCard
                        key={map.id}
                        map={map}
                        isSelected={selectedMap?.id === map.id}
                        onClick={() => setSelectedMap(map)}
                        onDelete={e => handleDeleteMap(e, map.id)}
                        onEdit={e => handleEditMap(e, map)}
                      />
                    ))}
                    <GeoButton fullWidth onClick={handleImport} coreStyle={{ padding: '8px 10px' }}>
                      + IMPORT MAP FILE (.TTMAP / .JSON)
                    </GeoButton>
                  </div>
                )}

                {activeTab === 'CHALLENGES' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    {CHALLENGE_OPERATIONS.map(op => {
                      const isSel = selectedChallenge.id === op.id;
                      const medal = career.challengeMedals?.[op.id];
                      return (
                        <GeoButton
                          key={op.id}
                          variant={isSel ? 'softAmber' : 'default'}
                          fullWidth
                          onClick={() => setSelectedChallenge(op)}
                          coreStyle={{ padding: '9px 11px', justifyContent: 'space-between', textAlign: 'left' }}
                        >
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 900 }}>{op.title}</div>
                            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600 }}>{op.subtitle}</div>
                          </div>
                          <GeoChip variant={medal ? 'softAmber' : op.difficultyLabel === 'EXTREME' ? 'softRed' : 'softMint'}>
                            {medal ? `🏅 ${medal}` : op.difficultyLabel}
                          </GeoChip>
                        </GeoButton>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </GeoCard>

          {/* RIGHT: RULESET / BRIEFING + DEPLOY TRIGGER */}
          <GeoCard fill>
            <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px', height: '100%' }}>
              {activeTab === 'CHALLENGES' ? (() => {
                const p0Units = selectedChallenge.placements.filter(p => p.owner === 0);
                const p1Units = selectedChallenge.placements.filter(p => p.owner === 1);
                const earnedMedal = career.challengeMedals?.[selectedChallenge.id];
                const muts = selectedChallenge.settings.mutators;
                const activeRuleTags = [
                  selectedChallenge.settings.fogOfWar ? 'FOG OF WAR' : null,
                  selectedChallenge.settings.doomsdayEnabled ? `DOOMSDAY R${(selectedChallenge.startingRound ?? 0) + 1}` : null,
                  muts?.blitzCp ? 'BLITZ CP (30/+15)' : null,
                  muts?.scarcity ? 'SCARCITY (50% AMMO)' : null,
                  muts?.ironman ? 'IRONMAN (0 RESPAWNS)' : null,
                  `AI: ${selectedChallenge.settings.aiDifficulty || 'HARD'}`,
                ].filter(Boolean) as string[];

                const formatRoster = (list: typeof p0Units) =>
                  list.map(u => `${UNIT_STATS[u.type].name}${u.rank ? ` ${'★'.repeat(u.rank)}` : ''}`).join(', ');

                return (
                  <div className="opgeo-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                      <GeoChip variant="softAmber">TACTICAL OPERATION BRIEFING</GeoChip>
                      {earnedMedal && <GeoChip variant="amber">🏅 BEST: {earnedMedal}-MEDAL</GeoChip>}
                    </div>

                    <div>
                      <h2 style={{ margin: '0 0 3px 0', fontSize: '20px', fontWeight: 900 }}>{selectedChallenge.title}</h2>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--acc-blue-ink)' }}>{selectedChallenge.subtitle}</div>
                    </div>

                    <GeoWell coreStyle={{ padding: '12px', fontSize: '13px', lineHeight: 1.55 }}>
                      {selectedChallenge.briefing}
                    </GeoWell>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      <GeoChip variant="softBlue">{selectedChallenge.gridSize}×{selectedChallenge.gridSize} SECTOR</GeoChip>
                      <GeoChip variant="softAmber">PAR: {selectedChallenge.parRounds} ROUNDS</GeoChip>
                      {activeRuleTags.map(tag => (
                        <GeoChip key={tag} variant="softViolet">{tag}</GeoChip>
                      ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'stretch' }}>
                      <GeoWell style={{ height: '100%' }} coreStyle={{ padding: '10px 12px', height: '100%' }}>
                        <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--acc-red-ink)', marginBottom: '4px' }}>
                          YOUR STRIKE TEAM ({p0Units.length})
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.4 }}>{formatRoster(p0Units)}</div>
                      </GeoWell>
                      <GeoWell style={{ height: '100%' }} coreStyle={{ padding: '10px 12px', height: '100%' }}>
                        <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--acc-blue-ink)', marginBottom: '4px' }}>
                          HOSTILE GARRISON ({p1Units.length})
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, lineHeight: 1.4 }}>{formatRoster(p1Units)}</div>
                      </GeoWell>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', flex: 1 }}>
                  {/* COLUMN A: MODE, VICTORY & ENVIRONMENT */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' }}>
                      2. MODE &amp; VICTORY RULES
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <GeoButton
                        variant={settings.gameMode === 'PVP' ? 'blue' : 'default'}
                        fullWidth
                        onClick={() => setSettings({ ...settings, gameMode: 'PVP' })}
                      >
                        MULTIPLAYER
                      </GeoButton>
                      <GeoButton
                        variant={settings.gameMode === 'PVE' ? 'red' : 'default'}
                        fullWidth
                        onClick={() => setSettings({ ...settings, gameMode: 'PVE', playerCount: 2 })}
                      >
                        VS AI
                      </GeoButton>
                    </div>

                    {settings.gameMode === 'PVP' ? (
                      <GeoWell coreStyle={{ padding: '9px 11px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 800 }}>
                          <span>PLAYERS (2–{selectedMap ? selectedMap.baseCount : 6})</span>
                          <span style={{ color: 'var(--acc-blue-ink)' }}>
                            {settings.playerCount}P {activeTab === 'RANDOM' ? `(${randomGridPreview})` : ''}
                          </span>
                        </div>
                        <input
                          className="opgeo-range"
                          type="range"
                          min="2"
                          max={selectedMap ? selectedMap.baseCount : 6}
                          step="1"
                          value={settings.playerCount}
                          onChange={e => setSettings({ ...settings, playerCount: parseInt(e.target.value, 10) })}
                          style={{ width: '100%' }}
                        />
                        {selectedMap && settings.playerCount === selectedMap.baseCount && (
                          <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 700 }}>
                            Max players limited by map bases.
                          </div>
                        )}
                      </GeoWell>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
                        {(['EASY', 'MEDIUM', 'HARD'] as AIDifficulty[]).map(d => (
                          <GeoButton
                            key={d}
                            variant={
                              settings.aiDifficulty === d
                                ? d === 'EASY'
                                  ? 'mint'
                                  : d === 'MEDIUM'
                                    ? 'amber'
                                    : 'red'
                                : 'default'
                            }
                            fullWidth
                            onClick={() => setSettings({ ...settings, aiDifficulty: d })}
                            coreStyle={{ padding: '7px 4px' }}
                          >
                            {d}
                          </GeoButton>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <GeoButton
                        variant={settings.victoryMode === 'CONQUER' ? 'amber' : 'default'}
                        fullWidth
                        onClick={() => setSettings({ ...settings, victoryMode: 'CONQUER' })}
                      >
                        CONQUER (HQ)
                      </GeoButton>
                      <GeoButton
                        variant={settings.victoryMode === 'DEATHMATCH' ? 'red' : 'default'}
                        fullWidth
                        onClick={() => setSettings({ ...settings, victoryMode: 'DEATHMATCH' })}
                      >
                        DEATHMATCH
                      </GeoButton>
                    </div>

                    {settings.victoryMode === 'DEATHMATCH' ? (
                      <GeoToggle
                        label="Doomsday Protocol (Shrinking Map)"
                        value={settings.doomsdayEnabled}
                        onChange={v => setSettings({ ...settings, doomsdayEnabled: v })}
                        variant="amber"
                      />
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontStyle: 'italic', paddingLeft: '2px' }}>
                        Destroy enemy Headquarters to win.
                      </div>
                    )}

                    <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px', marginTop: '4px' }}>
                      ENVIRONMENT
                    </div>
                    <GeoToggle
                      label="Dynamic Weather (Voronoi Shifts)"
                      value={settings.dynamicWeather}
                      onChange={v => setSettings({ ...settings, dynamicWeather: v })}
                    />
                    <GeoToggle
                      label="Fog of War (Line-of-Sight Vision)"
                      value={settings.fogOfWar}
                      onChange={v => setSettings({ ...settings, fogOfWar: v })}
                    />
                  </div>

                  {/* COLUMN B: SQUAD LOADOUT & MUTATORS */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' }}>
                      3. STARTING SQUAD ({totalUnits} UNITS)
                    </div>

                    {unitMeta.map(({ type, label, max, role }) => (
                      <GeoWell
                        key={type}
                        coreStyle={{
                          padding: '8px 10px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 900 }}>
                            {label} <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600 }}>(Max {max})</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)' }}>{role}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <GeoButton
                            onClick={() => updateCount(type, -1)}
                            disabled={settings.unitCounts[type] <= 0}
                            coreStyle={{ padding: '4px 10px' }}
                          >
                            -
                          </GeoButton>
                          <span style={{ fontSize: '15px', fontWeight: 900, width: '18px', textAlign: 'center' }}>
                            {settings.unitCounts[type]}
                          </span>
                          <GeoButton
                            onClick={() => updateCount(type, 1)}
                            disabled={settings.unitCounts[type] >= max}
                            coreStyle={{ padding: '4px 10px' }}
                          >
                            +
                          </GeoButton>
                        </div>
                      </GeoWell>
                    ))}

                    <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px', marginTop: '4px' }}>
                      FUN MUTATORS
                    </div>
                    <GeoToggle
                      label="Blitz CP (30 Max / +15 CP/turn)"
                      value={Boolean(settings.mutators?.blitzCp)}
                      onChange={v =>
                        setSettings({
                          ...settings,
                          mutators: {
                            blitzCp: v,
                            scarcity: Boolean(settings.mutators?.scarcity),
                            ironman: Boolean(settings.mutators?.ironman),
                          },
                        })
                      }
                      variant="amber"
                    />
                    <GeoToggle
                      label="Scarcity (50% Ammo / +50% Bank)"
                      value={Boolean(settings.mutators?.scarcity)}
                      onChange={v =>
                        setSettings({
                          ...settings,
                          mutators: {
                            blitzCp: Boolean(settings.mutators?.blitzCp),
                            scarcity: v,
                            ironman: Boolean(settings.mutators?.ironman),
                          },
                        })
                      }
                      variant="amber"
                    />
                    <GeoToggle
                      label="Ironman (0 Graveyard Respawns)"
                      value={Boolean(settings.mutators?.ironman)}
                      onChange={v =>
                        setSettings({
                          ...settings,
                          mutators: {
                            blitzCp: Boolean(settings.mutators?.blitzCp),
                            scarcity: Boolean(settings.mutators?.scarcity),
                            ironman: v,
                          },
                        })
                      }
                      variant="amber"
                    />
                  </div>
                </div>
              )}

              <GeoButton
                variant={activeTab === 'CHALLENGES' ? 'amber' : 'mint'}
                fullWidth
                disabled={!canDeploy}
                onClick={handleDeploy}
                coreStyle={{ padding: '14px 18px', fontSize: '15px', fontWeight: 900, letterSpacing: '1px' }}
              >
                {activeTab === 'CHALLENGES'
                  ? `DEPLOY OP: ${selectedChallenge.title.toUpperCase()} →`
                  : totalUnits === 0
                    ? 'ADD AT LEAST 1 UNIT TO DEPLOY'
                    : activeTab === 'RANDOM'
                      ? 'INITIATE RANDOM OP →'
                      : selectedMap
                        ? `DEPLOY TO ${selectedMap.name.toUpperCase()} →`
                        : 'SELECT A MAP FROM LEFT DECK'}
              </GeoButton>
            </div>
          </GeoCard>
        </div>
      </div>
    </div>
  );
};
