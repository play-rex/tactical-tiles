import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { GameSettings, SavedMap, MissionConfig } from '@tactical/engine/types';
import { PRESET_MAPS } from '@tactical/engine/assets/Presets';
import { CHALLENGE_OPERATIONS } from '@tactical/engine/assets/ChallengeOps';
import { UNIT_STATS } from '@tactical/engine/constants/Config';
import { MapStorage } from '../core/storage/MapStorageManager';
import { generateSectorSeed } from '@tactical/engine/utils/SeededRandom';
import { CareerStorage } from '@tactical/engine/storage/CareerStatsManager';
import { GeoButton, GeoCard, GeoChip, GeoWell } from '../components/ui/GeoPrimitives';
import {
  BrandHeader,
  DifficultyButtons,
  EnvironmentToggles,
  MutatorToggles,
  SECTION_LABEL,
  SquadLoadoutControls,
  StageShell,
  VictoryModeControl,
  SquadGuideButton,
} from '../components/ui/MatchRulesControls';

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

const HOTSEAT_NAMES_KEY = 'tactical_tiles_hotseat_names';

const loadPersistedHotseatNames = (): string[] | undefined => {
  try {
    const raw = localStorage.getItem(HOTSEAT_NAMES_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const names = parsed.filter((n): n is string => typeof n === 'string').slice(0, 6);
    return names.length > 0 ? names : undefined;
  } catch {
    return undefined;
  }
};

const savePersistedHotseatNames = (names: string[] | undefined) => {
  try {
    if (!names || names.every(n => !n || !n.trim())) {
      localStorage.removeItem(HOTSEAT_NAMES_KEY);
      return;
    }
    localStorage.setItem(HOTSEAT_NAMES_KEY, JSON.stringify(names.slice(0, 6)));
  } catch {
    // Storage full/blocked: names still work for this session via the store.
  }
};

export const GameSetup: React.FC = () => {
  const startGame = useGameStore(state => state.startGame);
  const startChallenge = useGameStore(state => state.startChallenge);
  const loadMapAndStart = useGameStore(state => state.loadMapAndStart);
  const openEditor = useGameStore(state => state.openEditor);
  const loadMapIntoEditor = useGameStore(state => state.loadMapIntoEditor);
  const openTutorial = useGameStore(state => state.openTutorial);
  const openOnline = useGameStore(state => state.openOnline);
  const setGameSettings = useGameStore(state => state.setGameSettings);

  const [activeTab, setActiveTab] = useState<'RANDOM' | 'PRESET' | 'CUSTOM' | 'CHALLENGES'>('RANDOM');
  const [selectedMap, setSelectedMap] = useState<SavedMap | null>(null);
  const [selectedChallenge, setSelectedChallenge] = useState<MissionConfig>(CHALLENGE_OPERATIONS[0]);
  const [customMaps, setCustomMaps] = useState<SavedMap[]>([]);
  const career = CareerStorage.get();

  const [settings, setSettings] = useState<GameSettings>(() => {
    const base: GameSettings = {
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
    };
    // Keep last match's names: the store survives resetGame (same session),
    // localStorage survives reloads (across sessions).
    const storeSettings = useGameStore.getState().settings;
    const hasStoreNames = (storeSettings.playerNames ?? []).some(n => n && n.trim());
    if (hasStoreNames) {
      return {
        ...base,
        playerCount: Math.min(6, Math.max(2, storeSettings.playerCount)),
        playerNames: storeSettings.playerNames,
      };
    }
    const persistedNames = loadPersistedHotseatNames();
    if (!persistedNames) return base;
    return {
      ...base,
      playerCount: Math.min(6, Math.max(2, persistedNames.length)),
      playerNames: persistedNames,
    };
  });

  // Persist hot-seat callsigns so the next match / next session reuses them.
  useEffect(() => {
    savePersistedHotseatNames(settings.playerNames);
  }, [settings.playerNames]);

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

  const handleDeploy = () => {
    if (activeTab === 'CHALLENGES') {
      startChallenge(selectedChallenge.id);
      return;
    }
    savePersistedHotseatNames(settings.playerNames);
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
  const patchSettings = (patch: Partial<GameSettings>) => setSettings(prev => ({ ...prev, ...patch }));

  return (
    <StageShell width={1140}>
        {/* TOP CONSOLE HEADER BAR */}
        <BrandHeader
          badge={
            (career.gamesPlayed > 0 || Object.keys(career.challengeMedals || {}).length > 0) ? (
              <GeoChip variant="softMint" style={{ padding: '5px 10px' }}>
                {career.wins}W–{career.losses}L • {Object.keys(career.challengeMedals || {}).length}/{CHALLENGE_OPERATIONS.length} OPS • BEST {career.bestGrade ?? '-'} • STREAK {career.bestStreak} • {career.fastestWinRounds ? `${career.fastestWinRounds}R FAST` : 'NO WIN'} • {career.totalAcesPromoted} ACES
              </GeoChip>
            ) : (
              <GeoChip variant="softBlue" style={{ padding: '5px 10px' }}>
                STEP 1: PICK MAP → STEP 2: SET RULES &amp; SQUAD → DEPLOY
              </GeoChip>
            )
          }
          right={
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <GeoButton onClick={openTutorial} coreStyle={{ padding: '7px 14px' }}>
                ? HOW TO PLAY
              </GeoButton>
              <GeoButton variant="softBlue" onClick={openEditor} coreStyle={{ padding: '7px 14px' }}>
                OPEN MAP EDITOR
              </GeoButton>
            </div>
          }
        />

        {/* MAIN 2-COLUMN DECK */}
        <div
          className="tt-cols"
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

                    <div className="tt-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'stretch' }}>
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
                <div className="tt-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', flex: 1 }}>
                  {/* COLUMN A: MODE, VICTORY & ENVIRONMENT */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' }}>
                      2. MODE &amp; VICTORY RULES
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <GeoButton
                        variant="blue"
                        fullWidth
                        title={settings.gameMode === 'PVP' ? 'Hot-seat multiplayer — tap to switch to VS AI' : 'You vs the AI — tap to switch to hot-seat'}
                        onClick={() => setSettings(settings.gameMode === 'PVP'
                          ? { ...settings, gameMode: 'PVE', playerCount: 2 }
                          : { ...settings, gameMode: 'PVP' })}
                        coreStyle={{ padding: '8px 4px' }}
                      >
                        📍 LOCAL: {settings.gameMode === 'PVP' ? 'TURN-BY-TURN' : 'VS AI'}
                      </GeoButton>
                      <GeoButton
                        variant="default"
                        fullWidth
                        title="Create or join an online table"
                        onClick={openOnline}
                        coreStyle={{ padding: '8px 4px' }}
                      >
                        🌐 ONLINE →
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                          {Array.from({ length: settings.playerCount }).map((_, i) => (
                            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 900, minWidth: '28px' }}>P{i + 1}</span>
                              <input
                                type="text"
                                maxLength={18}
                                placeholder={`Player ${i + 1}`}
                                value={settings.playerNames?.[i] ?? ''}
                                onChange={e => {
                                  const next = [...(settings.playerNames ?? [])];
                                  next[i] = e.target.value;
                                  setSettings({ ...settings, playerNames: next });
                                }}
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  padding: '7px 9px',
                                  background: '#FFFFFF',
                                  border: '1.5px solid var(--op-line)',
                                  borderRadius: '6px',
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  fontFamily: 'inherit',
                                  color: 'var(--op-ink)',
                                  outline: 'none',
                                }}
                              />
                            </label>
                          ))}
                        </div>
                        {selectedMap && settings.playerCount === selectedMap.baseCount && (
                          <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 700 }}>
                            Max players limited by map bases.
                          </div>
                        )}
                      </GeoWell>
                    ) : (
                      <DifficultyButtons value={settings.aiDifficulty} onChange={aiDifficulty => patchSettings({ aiDifficulty })} />
                    )}

                    <VictoryModeControl
                      victoryMode={settings.victoryMode}
                      doomsdayEnabled={settings.doomsdayEnabled}
                      showConquerNote
                      onPatch={patchSettings}
                    />

                    <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>
                      ENVIRONMENT
                    </div>
                    <EnvironmentToggles
                      dynamicWeather={settings.dynamicWeather}
                      fogOfWar={settings.fogOfWar}
                      detailedLabels
                      onPatch={patchSettings}
                    />
                  </div>

                  {/* COLUMN B: SQUAD LOADOUT & MUTATORS */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ ...SECTION_LABEL, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span>3. STARTING SQUAD ({totalUnits} UNITS)</span>
                      <SquadGuideButton />
                    </div>

                    <SquadLoadoutControls
                      unitCounts={settings.unitCounts}
                      showDetails
                      onChange={unitCounts => patchSettings({ unitCounts })}
                    />

                    <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>
                      FUN MUTATORS
                    </div>
                    <MutatorToggles
                      mutators={settings.mutators}
                      detailedLabels
                      onChange={mutators => patchSettings({ mutators })}
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
    </StageShell>
  );
};
