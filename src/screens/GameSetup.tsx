
import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { GameSettings, UnitType, AIDifficulty, SavedMap, MissionConfig } from '../core/types';
import { SPRITES } from '../core/assets/SpriteAssets';
import { PRESET_MAPS } from '../core/assets/Presets';
import { CHALLENGE_OPERATIONS } from '../core/assets/ChallengeOps';
import { UNIT_STATS } from '../core/constants/Config';
import { MapStorage } from '../core/storage/MapStorageManager';
import { generateSectorSeed } from '../core/utils/SeededRandom';
import { CareerStorage } from '../core/storage/CareerStatsManager';
// import { AssetExporter } from '../components/debug/AssetExporter';

interface MapCardProps {
    map: SavedMap;
    isSelected: boolean;
    onClick: () => void;
    onDelete?: (e: React.MouseEvent) => void;
    onEdit?: (e: React.MouseEvent) => void;
}

const MapCard: React.FC<MapCardProps> = ({ map, isSelected, onClick, onDelete, onEdit }) => (
    <div 
        onClick={onClick}
        style={{
            background: isSelected ? '#2196F3' : 'rgba(255,255,255,0.05)',
            border: isSelected ? '1px solid #64B5F6' : '1px solid #444',
            borderRadius: '8px', padding: '12px', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: '4px',
            transition: 'all 0.2s', position: 'relative'
        }}
    >
        <div style={{ fontWeight: 'bold', color: isSelected ? 'white' : '#ddd', fontSize: '14px', paddingRight: '40px' }}>{map.name}</div>
        <div style={{ fontSize: '11px', color: isSelected ? 'rgba(255,255,255,0.8)' : '#888' }}>
            {map.width}x{map.height} • {map.baseCount} Bases
        </div>
        
        <div style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px' }}>
            {onEdit && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onEdit(e); }}
                    style={{
                        background: '#FF9800', border: 'none', color: 'black',
                        width: '24px', height: '24px', borderRadius: '4px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '14px'
                    }}
                    title="Edit Map"
                >
                    ✎
                </button>
            )}
            {!map.isPreset && onDelete && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onDelete(e); }}
                    style={{
                        background: '#D32F2F', border: 'none', color: 'white',
                        width: '24px', height: '24px', borderRadius: '4px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '14px'
                    }}
                    title="Delete Map"
                >
                    ×
                </button>
            )}
        </div>
    </div>
);

export const GameSetup = () => {
    const startGame = useGameStore(state => state.startGame);
    const startChallenge = useGameStore(state => state.startChallenge);
    const loadMapAndStart = useGameStore(state => state.loadMapAndStart);
    const openEditor = useGameStore(state => state.openEditor);
    const loadMapIntoEditor = useGameStore(state => state.loadMapIntoEditor);
    const openTutorial = useGameStore(state => state.openTutorial);
    const setGameSettings = useGameStore(state => state.setGameSettings);
    
    // UI State
    const [activeTab, setActiveTab] = useState<'RANDOM' | 'PRESET' | 'CUSTOM' | 'CHALLENGES'>('RANDOM');
    const [selectedMap, setSelectedMap] = useState<SavedMap | null>(null);
    const [selectedChallenge, setSelectedChallenge] = useState<MissionConfig>(CHALLENGE_OPERATIONS[0]);
    const [customMaps, setCustomMaps] = useState<SavedMap[]>([]);
    const career = CareerStorage.get();

    // Game Config State
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
        mutators: { blitzCp: false, scarcity: false, ironman: false }
    });

    // Load custom maps on mount or tab switch
    useEffect(() => {
        if (activeTab === 'CUSTOM') {
            setCustomMaps(MapStorage.getAll());
        }
        setSelectedMap(null); // Reset selection on tab change
    }, [activeTab]);

    const updateCount = (type: UnitType, delta: number) => {
        const max = type === 'SOLDIER' ? 5 : type === 'ASSAULTER' ? 4 : 3;
        const current = settings.unitCounts[type];
        const next = Math.min(max, Math.max(0, current + delta));
        
        setSettings({
            ...settings,
            unitCounts: { ...settings.unitCounts, [type]: next }
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
        if (window.confirm("Are you sure you want to delete this map?")) {
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
        input.onchange = (e: any) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                if (re.target?.result) {
                    MapStorage.import(re.target.result as string);
                    setCustomMaps(MapStorage.getAll());
                }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    const UnitCounter = ({ type, label, max }: { type: UnitType, label: string, max: number }) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
            <span style={{ color: '#ccc', fontWeight: 'bold', fontSize: '13px' }}>{label} <span style={{fontSize:'10px', color:'#666', marginLeft: '5px', fontWeight: 'normal'}}>(Max {max})</span></span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button 
                    onClick={() => updateCount(type, -1)}
                    style={{ background: '#333', border: '1px solid #555', color: 'white', width: '30px', height: '30px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                >-</button>
                <span style={{ fontSize: '18px', fontWeight: 'bold', width: '20px', textAlign: 'center', color: 'white' }}>{settings.unitCounts[type]}</span>
                <button 
                    onClick={() => updateCount(type, 1)}
                    style={{ background: '#333', border: '1px solid #555', color: 'white', width: '30px', height: '30px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                >+</button>
            </div>
        </div>
    );

    const Toggle = ({ label, value, onChange, disabled }: { label: string, value: boolean, onChange: (v: boolean) => void, disabled?: boolean }) => (
        <div 
            onClick={() => { if (!disabled) onChange(!value); }}
            style={{ 
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
                marginBottom: '15px', cursor: disabled ? 'default' : 'pointer', padding: '12px 15px',
                background: value ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255,255,255,0.05)',
                border: value ? '1px solid #4CAF50' : '1px solid #444',
                borderRadius: '8px', transition: 'all 0.2s',
                opacity: disabled ? 0.3 : 1
            }}
        >
            <span style={{ fontWeight: 'bold', color: value ? '#4CAF50' : '#888', fontSize: '14px' }}>{label}</span>
            <div style={{ 
                width: '36px', height: '18px', background: '#333', borderRadius: '10px', position: 'relative',
                border: '1px solid #555'
            }}>
                <div style={{ 
                    position: 'absolute', top: '1px', left: value ? '19px' : '1px', 
                    width: '14px', height: '14px', borderRadius: '50%', 
                    background: value ? '#4CAF50' : '#888', transition: 'all 0.2s'
                }}></div>
            </div>
        </div>
    );

    const TERRAIN_KEYS = Object.keys(SPRITES.TERRAIN);
    const getBackground = (index: number) => {
        const key = TERRAIN_KEYS[(index * 3 + 7) % TERRAIN_KEYS.length] as keyof typeof SPRITES.TERRAIN;
        return SPRITES.TERRAIN[key];
    };

    const TitleLetter: React.FC<{ char: string, index: number }> = ({ char, index }) => (
        <div style={{ 
            width: '36px', height: '36px', position: 'relative',
            backgroundImage: `url(${getBackground(index)})`, backgroundSize: 'cover',
            imageRendering: 'pixelated',
            borderRadius: '6px',
            boxShadow: '0 4px 8px rgba(0,0,0,0.6)',
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: `rotate(${(index % 2 === 0 ? 2 : -2)}deg) translateY(${index%3 === 0 ? -2 : 0}px)`
        }}>
            <div style={{ 
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', borderRadius: '5px' 
            }} />
            <span style={{ 
                position: 'relative', zIndex: 2,
                color: '#fff', fontSize: '22px', fontWeight: '900', fontFamily: 'monospace',
                textShadow: '2px 2px 0 #000'
            }}>{char}</span>
        </div>
    );

    // Update player count limit if map selected
    useEffect(() => {
        if (selectedMap) {
            setSettings(s => ({
                ...s,
                playerCount: Math.min(s.playerCount, selectedMap.baseCount || 2)
            }));
        }
    }, [selectedMap]);

    return (
        <div style={{ 
            width: '100vw', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center',
            background: 'linear-gradient(135deg, #050505, #111)',
            overflow: 'hidden',
            fontFamily: "'Segoe UI', Roboto, sans-serif"
        }}>
            {/* Background Decor */}
            <div style={{
                position: 'absolute', inset: 0, opacity: 0.1, pointerEvents: 'none',
                backgroundImage: `radial-gradient(circle at 50% 50%, #333 1px, transparent 1px)`,
                backgroundSize: '20px 20px'
            }} />
            
            {/* HOW TO PLAY BUTTON (Top Right) */}
            <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 20 }}>
                <button
                    onClick={openTutorial}
                    style={{
                        padding: '12px 24px', background: 'rgba(255,255,255,0.1)', border: '1px solid #444',
                        color: '#ddd', borderRadius: '30px', fontWeight: 'bold', cursor: 'pointer',
                        backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                >
                    <span style={{ background: '#2196F3', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: 'white' }}>?</span>
                    HOW TO PLAY
                </button>
            </div>

            <div style={{ 
                width: 'min(860px, 94vw)', height: 'min(620px, 90vh)', display: 'flex',
                background: 'rgba(20,20,20,0.95)', 
                border: '1px solid #333', borderRadius: '16px', boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
                position: 'relative', zIndex: 10, overflow: 'hidden'
            }}>
                
                {/* LEFT SIDE: MAP SELECTION */}
                <div style={{ width: '40%', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '20px', borderBottom: '1px solid #333', textAlign: 'center' }}>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '8px' }}>
                            {['T','A','C','T','I','C','A','L'].map((char, i) => (
                                <TitleLetter key={i} char={char} index={i} />
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                            {['T','I','L','E','S'].map((char, i) => (
                                <TitleLetter key={i} char={char} index={i + 8} />
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', borderBottom: '1px solid #333' }}>
                        <button onClick={() => setActiveTab('RANDOM')} style={{ flex: 1, padding: '10px 4px', border: 'none', background: activeTab === 'RANDOM' ? '#333' : 'transparent', color: activeTab === 'RANDOM' ? '#fff' : '#666', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}>RANDOM</button>
                        <button onClick={() => setActiveTab('PRESET')} style={{ flex: 1, padding: '10px 4px', border: 'none', background: activeTab === 'PRESET' ? '#333' : 'transparent', color: activeTab === 'PRESET' ? '#fff' : '#666', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}>PRESETS</button>
                        <button onClick={() => setActiveTab('CUSTOM')} style={{ flex: 1, padding: '10px 4px', border: 'none', background: activeTab === 'CUSTOM' ? '#333' : 'transparent', color: activeTab === 'CUSTOM' ? '#fff' : '#666', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}>MY MAPS</button>
                        <button onClick={() => setActiveTab('CHALLENGES')} style={{ flex: 1, padding: '10px 4px', border: 'none', background: activeTab === 'CHALLENGES' ? '#FF9800' : 'transparent', color: activeTab === 'CHALLENGES' ? '#000' : '#FFB74D', cursor: 'pointer', fontWeight: 'bold', fontSize: '10px' }}>CHALLENGES</button>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
                        {activeTab === 'RANDOM' && (
                            <div style={{ padding: '16px 10px', textAlign: 'center', color: '#888' }}>
                                <div style={{ fontSize: '34px', marginBottom: '10px' }}>🎲</div>
                                <div style={{ fontSize: '12px', fontStyle: 'italic', marginBottom: '16px' }}>
                                    Enter a 6-character Sector Seed to share or replay an exact battlefield, or leave blank for a new random sector.
                                </div>
                                <div style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid #333', borderRadius: '8px', padding: '10px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#888', letterSpacing: '1px', marginBottom: '6px' }}>SECTOR SEED</div>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <input
                                            type="text"
                                            maxLength={12}
                                            placeholder="RANDOM SEED"
                                            value={settings.mapSeed || ''}
                                            onChange={(e) => setSettings({ ...settings, mapSeed: e.target.value.toUpperCase() })}
                                            style={{
                                                flex: 1,
                                                minWidth: 0,
                                                padding: '8px 10px',
                                                background: '#111',
                                                border: '1px solid #444',
                                                borderRadius: '6px',
                                                color: '#FFD700',
                                                fontFamily: 'monospace',
                                                fontSize: '13px',
                                                fontWeight: 'bold',
                                                letterSpacing: '1px',
                                                outline: 'none'
                                            }}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setSettings({ ...settings, mapSeed: generateSectorSeed() })}
                                            title="Roll Sector Seed"
                                            style={{
                                                padding: '0 12px',
                                                background: '#222',
                                                border: '1px solid #555',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                cursor: 'pointer',
                                                fontSize: '14px',
                                                fontWeight: 'bold'
                                            }}
                                        >
                                            🎲
                                        </button>
                                    </div>
                                    {settings.mapSeed && (
                                        <button
                                            type="button"
                                            onClick={() => setSettings({ ...settings, mapSeed: '' })}
                                            style={{
                                                marginTop: '6px',
                                                background: 'transparent',
                                                border: 'none',
                                                color: '#888',
                                                fontSize: '10px',
                                                cursor: 'pointer',
                                                padding: 0,
                                                textDecoration: 'underline'
                                            }}
                                        >
                                            Clear seed (generate fresh on deploy)
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'PRESET' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {PRESET_MAPS.map(map => (
                                    <MapCard 
                                        key={map.id} 
                                        map={map} 
                                        isSelected={selectedMap?.id === map.id} 
                                        onClick={() => setSelectedMap(map)}
                                        onEdit={(e) => handleEditMap(e, map)}
                                    />
                                ))}
                            </div>
                        )}

                        {activeTab === 'CUSTOM' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {customMaps.length === 0 && (
                                    <div style={{ textAlign: 'center', color: '#666', fontSize: '12px', marginTop: '20px' }}>
                                        No custom maps found.<br/>Use Map Editor to create one.
                                    </div>
                                )}
                                {customMaps.map(map => (
                                    <MapCard 
                                        key={map.id} 
                                        map={map} 
                                        isSelected={selectedMap?.id === map.id} 
                                        onClick={() => setSelectedMap(map)} 
                                        onDelete={(e) => handleDeleteMap(e, map.id)}
                                        onEdit={(e) => handleEditMap(e, map)}
                                    />
                                ))}
                                <button 
                                    onClick={handleImport}
                                    style={{ marginTop: '10px', padding: '8px', border: '1px dashed #444', background: 'transparent', color: '#888', cursor: 'pointer', borderRadius: '4px', fontSize: '12px' }}
                                >
                                    + Import Map File
                                </button>
                            </div>
                        )}

                        {activeTab === 'CHALLENGES' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {CHALLENGE_OPERATIONS.map(op => {
                                    const isSel = selectedChallenge.id === op.id;
                                    const medal = career.challengeMedals?.[op.id];
                                    const diffColor = op.difficultyLabel === 'EXTREME' ? '#EF5350' : op.difficultyLabel === 'HARD' ? '#FF9800' : '#4CAF50';
                                    return (
                                        <div
                                            key={op.id}
                                            onClick={() => setSelectedChallenge(op)}
                                            style={{
                                                background: isSel ? 'rgba(255, 152, 0, 0.22)' : 'rgba(255,255,255,0.05)',
                                                border: isSel ? '1px solid #FF9800' : '1px solid #444',
                                                borderRadius: '8px',
                                                padding: '10px 12px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '4px'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ fontWeight: 'bold', color: isSel ? '#FFE082' : '#eee', fontSize: '13px' }}>{op.title}</span>
                                                <span style={{ fontSize: '10px', fontWeight: 'bold', color: medal ? '#FFD700' : diffColor }}>
                                                    {medal ? `🏅 ${medal}` : op.difficultyLabel}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '10px', color: '#aaa' }}>{op.subtitle}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    
                    {(career.gamesPlayed > 0 || Object.keys(career.challengeMedals || {}).length > 0) && (
                        <div style={{ padding: '10px 15px', borderTop: '1px solid #333', background: 'rgba(255,215,0,0.04)' }}>
                            <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#FFD700', letterSpacing: '1px', marginBottom: '6px' }}>
                                CAREER RECORD ({career.wins}W - {career.losses}L • {Object.keys(career.challengeMedals || {}).length}/{CHALLENGE_OPERATIONS.length} OPS)
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: '11px', color: '#bbb' }}>
                                <span>Best Grade: <strong style={{ color: '#fff' }}>{career.bestGrade ?? '-'}</strong></span>
                                <span>Best Streak: <strong style={{ color: '#4CAF50' }}>{career.bestStreak}</strong></span>
                                <span>Fastest Win: <strong style={{ color: '#90CAF9' }}>{career.fastestWinRounds ? `${career.fastestWinRounds}R` : '-'}</strong></span>
                                <span>Aces: <strong style={{ color: '#FFD700' }}>{career.totalAcesPromoted}</strong></span>
                            </div>
                        </div>
                    )}

                    <div style={{ padding: '15px', borderTop: '1px solid #333' }}>
                        <button 
                            onClick={openEditor}
                            style={{
                                width: '100%', padding: '12px', 
                                background: '#333', border: '1px solid #444', color: '#ccc',
                                borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer',
                                fontSize: '12px'
                            }}
                        >
                            OPEN MAP EDITOR
                        </button>
                    </div>
                </div>

                {/* RIGHT SIDE: CONFIG */}
                <div style={{ width: '60%', padding: '30px', display: 'flex', flexDirection: 'column' }}>
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
                            `AI: ${selectedChallenge.settings.aiDifficulty || 'HARD'}`
                        ].filter(Boolean) as string[];

                        const formatRoster = (list: typeof p0Units) =>
                            list.map(u => `${UNIT_STATS[u.type].name}${u.rank ? ` ${'★'.repeat(u.rank)}` : ''}`).join(', ');

                        return (
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '1px', color: '#FF9800' }}>TACTICAL OPERATION BRIEFING</span>
                                    {earnedMedal && (
                                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: '#FFD700', background: 'rgba(255,215,0,0.12)', border: '1px solid rgba(255,215,0,0.4)', padding: '3px 10px', borderRadius: '12px' }}>
                                            🏅 BEST: {earnedMedal}-MEDAL
                                        </span>
                                    )}
                                </div>
                                <div>
                                    <h2 style={{ margin: '0 0 4px 0', color: '#fff', fontSize: '22px' }}>{selectedChallenge.title}</h2>
                                    <div style={{ fontSize: '12px', color: '#90CAF9', fontWeight: 'bold' }}>{selectedChallenge.subtitle}</div>
                                </div>
                                <div style={{ padding: '14px', background: 'rgba(255,255,255,0.04)', border: '1px solid #333', borderRadius: '8px', color: '#ddd', fontSize: '13px', lineHeight: '1.6' }}>
                                    {selectedChallenge.briefing}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    <span style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px', background: '#222', border: '1px solid #444', color: '#ccc', fontWeight: 'bold' }}>
                                        {selectedChallenge.gridSize}x{selectedChallenge.gridSize} SECTOR
                                    </span>
                                    <span style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px', background: '#222', border: '1px solid #444', color: '#FFD700', fontWeight: 'bold' }}>
                                        PAR: {selectedChallenge.parRounds} ROUNDS
                                    </span>
                                    {activeRuleTags.map(tag => (
                                        <span key={tag} style={{ fontSize: '10px', padding: '4px 8px', borderRadius: '4px', background: 'rgba(255,152,0,0.15)', border: '1px solid rgba(255,152,0,0.4)', color: '#FFB74D', fontWeight: 'bold' }}>
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
                                    <div style={{ background: 'rgba(229,57,53,0.1)', border: '1px solid rgba(229,57,53,0.3)', padding: '10px 12px', borderRadius: '8px' }}>
                                        <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#EF9A9A', marginBottom: '4px' }}>YOUR STRIKE TEAM ({p0Units.length} UNITS)</div>
                                        <div style={{ fontSize: '12px', color: '#eee' }}>{formatRoster(p0Units)}</div>
                                    </div>
                                    <div style={{ background: 'rgba(30,136,229,0.1)', border: '1px solid rgba(30,136,229,0.3)', padding: '10px 12px', borderRadius: '8px' }}>
                                        <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#90CAF9', marginBottom: '4px' }}>HOSTILE GARRISON ({p1Units.length} UNITS)</div>
                                        <div style={{ fontSize: '12px', color: '#eee' }}>{formatRoster(p1Units)}</div>
                                    </div>
                                </div>
                            </div>
                        );
                    })() : (
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        
                        <div style={{ marginBottom: '25px' }}>
                            <h3 style={{ color: '#888', fontSize: '11px', fontWeight:'bold', letterSpacing:'1px', marginBottom: '10px' }}>GAME MODE</h3>
                            
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <button onClick={() => setSettings({...settings, gameMode: 'PVP'})} style={{ flex: 1, padding: '10px', background: settings.gameMode === 'PVP' ? '#2196F3' : '#222', border: 'none', color: settings.gameMode === 'PVP' ? 'white' : '#888', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>MULTIPLAYER</button>
                                <button onClick={() => setSettings({...settings, gameMode: 'PVE', playerCount: 2})} style={{ flex: 1, padding: '10px', background: settings.gameMode === 'PVE' ? '#D32F2F' : '#222', border: 'none', color: settings.gameMode === 'PVE' ? 'white' : '#888', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>VS AI</button>
                            </div>

                            {settings.gameMode === 'PVP' && (
                                <div style={{ marginBottom: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                                        <span style={{ color: '#ccc', fontWeight: 'bold', fontSize: '13px' }}>PLAYER COUNT</span>
                                        <span style={{ color: '#2196F3', fontWeight: 'bold' }}>{settings.playerCount}</span>
                                    </div>
                                    <input 
                                        type="range" min="2" max={selectedMap ? selectedMap.baseCount : 6} step="1"
                                        value={settings.playerCount}
                                        onChange={(e) => setSettings({...settings, playerCount: parseInt(e.target.value)})}
                                        style={{ width: '100%', cursor: 'pointer' }}
                                    />
                                    {selectedMap && settings.playerCount === selectedMap.baseCount && (
                                        <div style={{ fontSize: '10px', color: '#ff9800' }}>Max players limited by map bases.</div>
                                    )}
                                </div>
                            )}

                            {settings.gameMode === 'PVE' && (
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px' }}>
                                    {(['EASY', 'MEDIUM', 'HARD'] as AIDifficulty[]).map(d => (
                                        <button key={d} onClick={() => setSettings({...settings, aiDifficulty: d})} style={{ flex: 1, padding: '6px', background: settings.aiDifficulty === d ? (d === 'EASY' ? '#4CAF50' : d === 'MEDIUM' ? '#FF9800' : '#D32F2F') : '#333', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontSize:'10px', fontWeight: 'bold', opacity: settings.aiDifficulty === d ? 1 : 0.6 }}>{d}</button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* VICTORY CONDITIONS - ADDED BACK */}
                        <div style={{ marginBottom: '25px', padding: '15px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid #333' }}>
                            <h3 style={{ color: '#888', fontSize: '11px', fontWeight:'bold', letterSpacing:'1px', marginBottom: '10px', marginTop: 0 }}>VICTORY CONDITION</h3>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <button 
                                    onClick={() => setSettings({...settings, victoryMode: 'CONQUER'})} 
                                    style={{ 
                                        flex: 1, padding: '10px', 
                                        background: settings.victoryMode === 'CONQUER' ? '#FF9800' : '#222', 
                                        border: settings.victoryMode === 'CONQUER' ? '1px solid #F57C00' : '1px solid #333',
                                        color: settings.victoryMode === 'CONQUER' ? 'black' : '#888', 
                                        borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' 
                                    }}
                                >
                                    CONQUER (BASE)
                                </button>
                                <button 
                                    onClick={() => setSettings({...settings, victoryMode: 'DEATHMATCH'})} 
                                    style={{ 
                                        flex: 1, padding: '10px', 
                                        background: settings.victoryMode === 'DEATHMATCH' ? '#D32F2F' : '#222', 
                                        border: settings.victoryMode === 'DEATHMATCH' ? '1px solid #B71C1C' : '1px solid #333',
                                        color: settings.victoryMode === 'DEATHMATCH' ? 'white' : '#888', 
                                        borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' 
                                    }}
                                >
                                    DEATHMATCH
                                </button>
                            </div>
                            
                            {settings.victoryMode === 'DEATHMATCH' && (
                                <Toggle 
                                    label="Doomsday Protocol (Shrinking Map)" 
                                    value={settings.doomsdayEnabled} 
                                    onChange={(v) => setSettings({...settings, doomsdayEnabled: v})} 
                                />
                            )}
                            {settings.victoryMode === 'CONQUER' && (
                                <div style={{ fontSize: '11px', color: '#666', fontStyle: 'italic', padding: '0 5px' }}>
                                    Destroy enemy Headquarters to win.
                                </div>
                            )}
                        </div>

                        <div style={{ marginBottom: '25px' }}>
                            <h3 style={{ color: '#888', fontSize: '11px', fontWeight:'bold', letterSpacing:'1px', marginBottom: '10px' }}>SQUAD LOADOUT</h3>
                            <UnitCounter type="SOLDIER" label="SCOUT" max={5} />
                            <UnitCounter type="ASSAULTER" label="ASSAULTER" max={4} />
                            <UnitCounter type="SNIPER" label="SNIPER" max={3} />
                        </div>

                        <div style={{ marginBottom: '25px' }}>
                            <h3 style={{ color: '#888', fontSize: '11px', fontWeight:'bold', letterSpacing:'1px', marginBottom: '10px' }}>ENVIRONMENT</h3>
                            <Toggle label="Dynamic Weather" value={settings.dynamicWeather} onChange={(v) => setSettings({...settings, dynamicWeather: v})} />
                            <Toggle label="Fog of War" value={settings.fogOfWar} onChange={(v) => setSettings({...settings, fogOfWar: v})} />
                        </div>

                        <div>
                            <h3 style={{ color: '#888', fontSize: '11px', fontWeight:'bold', letterSpacing:'1px', marginBottom: '10px' }}>GAME MUTATORS</h3>
                            <Toggle
                                label="Blitz CP (30 Max / +15 CP/turn)"
                                value={Boolean(settings.mutators?.blitzCp)}
                                onChange={(v) => setSettings({ ...settings, mutators: { blitzCp: v, scarcity: Boolean(settings.mutators?.scarcity), ironman: Boolean(settings.mutators?.ironman) } })}
                            />
                            <Toggle
                                label="Scarcity (50% Ammo / +50% Bank Gold)"
                                value={Boolean(settings.mutators?.scarcity)}
                                onChange={(v) => setSettings({ ...settings, mutators: { blitzCp: Boolean(settings.mutators?.blitzCp), scarcity: v, ironman: Boolean(settings.mutators?.ironman) } })}
                            />
                            <Toggle
                                label="Ironman (0 Graveyard Respawns)"
                                value={Boolean(settings.mutators?.ironman)}
                                onChange={(v) => setSettings({ ...settings, mutators: { blitzCp: Boolean(settings.mutators?.blitzCp), scarcity: Boolean(settings.mutators?.scarcity), ironman: v } })}
                            />
                        </div>
                    </div>
                    )}

                    {(() => {
                        const totalUnits = settings.unitCounts.SOLDIER + settings.unitCounts.ASSAULTER + settings.unitCounts.SNIPER;
                        const canDeploy = activeTab === 'CHALLENGES' || (totalUnits > 0 && (activeTab === 'RANDOM' || Boolean(selectedMap)));
                        return (
                            <button 
                                onClick={handleDeploy}
                                disabled={!canDeploy}
                                style={{
                                    width: '100%', padding: '18px', marginTop: '20px',
                                    background: canDeploy ? (activeTab === 'CHALLENGES' ? 'linear-gradient(180deg, #F57C00, #E65100)' : 'linear-gradient(180deg, #2E7D32, #1B5E20)') : '#333', 
                                    border: canDeploy ? (activeTab === 'CHALLENGES' ? '1px solid #FFB300' : '1px solid #4CAF50') : '1px solid #444', 
                                    borderRadius: '8px',
                                    color: canDeploy ? 'white' : '#666', fontSize: '16px', fontWeight: 'bold', 
                                    cursor: canDeploy ? 'pointer' : 'not-allowed',
                                    boxShadow: canDeploy ? '0 4px 15px rgba(46, 125, 50, 0.4)' : 'none', letterSpacing: '1px',
                                    textTransform: 'uppercase'
                                }}
                            >
                                {activeTab === 'CHALLENGES'
                                    ? `DEPLOY OP: ${selectedChallenge.title}`
                                    : totalUnits === 0
                                        ? 'ADD AT LEAST 1 UNIT'
                                        : activeTab === 'RANDOM'
                                            ? 'INITIATE RANDOM OP'
                                            : selectedMap
                                                ? `DEPLOY TO ${selectedMap.name}`
                                                : 'SELECT A MAP'}
                            </button>
                        );
                    })()}
                </div>
            </div>
            
            {/* DEV TOOL INJECTION */}
            {/* <AssetExporter /> */}
        </div>
    );
};
