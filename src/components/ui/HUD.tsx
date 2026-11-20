
import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { PLAYER_COLORS, UNIT_STATS, TERRAIN_DEFENSE, TERRAIN_COLORS, CP_SYSTEM, UNIT_COSTS, SHOP_ITEMS, BUILDING_STATS, MAX_RESPAWNS, GOLD_SETTINGS, BARRIER_STATS, BANK_STATS, BASE_STATS, VETERANCY_CONFIG, OVERWATCH_STATS } from '../../core/constants/Config';
import { Tile, WeatherType, LogEntry } from '../../core/types';
import { calculateAttackOutcome, calculateSiegeDamage, calculateDemolishDamage, canUnitAttackFromTile, canUnitEnterOverwatch, getEffectiveBankRewards, getEffectiveMaxRespawns, getUnitMaxHp, getUnitBaseDamage, getUnitAttackCost } from '../../core/rules/CombatRules';
import { resolveMoveWithOverwatch } from '../../core/rules/OverwatchRules';
import { SoundFX } from '../../core/audio/SoundFX';

interface PanelProps {
    children: React.ReactNode;
    style?: React.CSSProperties;
    onClick?: () => void;
}

const Panel: React.FC<PanelProps> = ({ children, style, onClick }) => (
    <div 
        onClick={onClick}
        style={{
            background: 'rgba(20, 20, 20, 0.95)',
            border: '1px solid #333',
            borderRadius: '12px',
            padding: '16px',
            color: '#eee',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(10px)',
            ...style
        }}
    >
        {children}
    </div>
);

const LogView = () => {
    const gameLog = useGameStore(state => state.gameLog);
    
    // Group logs by Round
    const groupedLogs: Record<number, LogEntry[]> = {};
    gameLog.forEach(log => {
        if (!groupedLogs[log.round]) groupedLogs[log.round] = [];
        groupedLogs[log.round].push(log);
    });

    const rounds = Object.keys(groupedLogs).map(k => parseInt(k)).sort((a,b) => b - a);

    if (rounds.length === 0) {
        return <div style={{ color:'#666', fontStyle:'italic', textAlign:'center', marginTop:'20px', fontSize: '13px' }}>Mission Log Empty</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {rounds.map(round => (
                <div key={round}>
                    <div style={{ 
                        fontSize: '10px', fontWeight: 'bold', color: '#666', 
                        borderBottom: '1px solid #333', marginBottom: '8px', 
                        textAlign: 'center', letterSpacing: '1px' 
                    }}>
                        ROUND {round}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {groupedLogs[round].map((log) => {
                            const isEnv = log.playerId === -1;
                            const color = isEnv ? '#9E9E9E' : (PLAYER_COLORS[log.playerId] || '#fff');
                            const bg = isEnv ? 'transparent' : `${color}10`; // 10% opacity hex
                            
                            return (
                                <div key={log.id} style={{ 
                                    display: 'flex', 
                                    fontSize: '11px', 
                                    background: bg,
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{ width: '3px', background: color }}></div>
                                    <div style={{ padding: '6px 8px', flex: 1, color: isEnv ? '#ccc' : color }}>
                                        {log.message}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

const BuildingInfoPanel = ({ tile }: { tile: Tile }) => {
    const weatherState = useGameStore(state => state.weather);
    const victoryMode = useGameStore(state => state.settings.victoryMode);

    let name: string = tile.type;
    let color = '#888';
    let ownerName = 'NEUTRAL';
    let stats = [];

    if (tile.type === 'BUILDING' && tile.subType) {
        const config = BUILDING_STATS[tile.subType];
        name = config.name.toUpperCase();
        if (tile.owner !== null && tile.owner !== undefined) { 
            color = PLAYER_COLORS[tile.owner]; 
            ownerName = `PLAYER ${tile.owner + 1}`; 
        }
        
        stats.push({ label: 'DEFENSE', value: `+${config.defense * 100}%` });
        stats.push({ label: 'RANGE', value: `+${config.rangeBonus}` });
        stats.push({ label: 'DMG', value: `x${config.damageBonus}` });
    } else if (tile.type === 'BANK') {
        name = 'BANK VAULT';
        const hacked = (tile.hackProgress || 0) >= 100;
        ownerName = hacked ? 'LOOTED' : 'SECURE';
        color = hacked ? '#546E7A' : '#FFD700';
    } else if (tile.type === 'BASE') {
        name = 'HEADQUARTERS';
        if (tile.owner !== null && tile.owner !== undefined) { 
            color = PLAYER_COLORS[tile.owner]; 
            ownerName = `PLAYER ${tile.owner + 1} BASE`; 
        }

        if (victoryMode === 'CONQUER' && tile.hp !== undefined) {
             stats.push({ label: 'INTEGRITY', value: `${tile.hp}/${tile.maxHp}` });
        } else {
             stats.push({ label: 'STATUS', value: 'INVULNERABLE' });
        }
    } else if (tile.type === 'BARRIER') {
        name = 'DEFENSE BARRIER';
        if (tile.hp !== undefined && tile.maxHp !== undefined) {
            stats.push({ label: 'INTEGRITY', value: `${tile.hp}/${tile.maxHp}` });
        } else {
            stats.push({ label: 'INTEGRITY', value: `${BARRIER_STATS.HP}/${BARRIER_STATS.HP}` });
        }
        const def = TERRAIN_DEFENSE[tile.type] * 100;
        stats.push({ label: 'COVER', value: `${def}%` });
    } else {
        name = tile.type;
        const def = TERRAIN_DEFENSE[tile.type] * 100;
        if (def !== 0) {
            const sign = def > 0 ? '+' : '';
            stats.push({ label: 'DEFENSE', value: `${sign}${def}%` });
        }
    }
    
    if (tile.zone !== undefined) {
        stats.push({ label: 'TERRITORY', value: `ZONE ${tile.zone + 1}` });
    }

    let activeWeather: WeatherType = 'CLEAR';
    if (tile.zone !== undefined && weatherState.playerZones[tile.zone]) {
        activeWeather = weatherState.playerZones[tile.zone];
    }

    let weatherLabel = 'Clear Skies';
    let weatherColor = '#aaa';
    const weatherEffects: string[] = [];

    if (activeWeather !== 'CLEAR') {
        switch (activeWeather) {
            case 'SCORCHED':
                weatherLabel = '🔥 SCORCHED';
                weatherColor = '#ff9800';
                if (tile.type === 'PLAINS') weatherEffects.push('Move Cost: 2 CP');
                if (tile.type === 'SAND') weatherEffects.push('Move Cost: 2 CP');
                break;
            case 'MONSOON':
                weatherLabel = '🌧️ MONSOON';
                weatherColor = '#90caf9';
                if (tile.type === 'PLAINS') weatherEffects.push('Mud: Heavy Units Slow');
                break;
            case 'FOG':
                weatherLabel = '🌫️ DENSE FOG';
                weatherColor = '#cfd8dc';
                weatherEffects.push('Vision Max: 2');
                weatherEffects.push('Sniper Range Max: 3');
                break;
            case 'TAILWIND':
                weatherLabel = '🍃 TAILWIND';
                weatherColor = '#69f0ae';
                if (tile.type === 'PLAINS') weatherEffects.push('Move Cost: 0.5 CP');
                weatherEffects.push('Unit Range: +1');
                break;
            case 'SANDSTORM':
                weatherLabel = '🌪️ SANDSTORM';
                weatherColor = '#D4A35B';
                weatherEffects.push('Vision Max: 3');
                break;
        }
    }

    return (
        <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'white', marginBottom: '5px' }}>{name}</div>
            <div style={{ fontSize: '12px', color: color, fontWeight: 'bold', marginBottom: '15px' }}>{ownerName}</div>
            
            {stats.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                    {stats.map((s, i) => (
                        <div key={i} style={{ background: 'rgba(255,255,255,0.05)', padding: '6px', borderRadius: '4px' }}>
                            <div style={{ fontSize: '10px', color: '#aaa' }}>{s.label}</div>
                            <div style={{ fontSize: '14px', fontWeight: 'bold', color: s.value.toString().includes('-') ? '#ff5722' : 'white' }}>{s.value}</div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ borderTop: '1px solid #444', paddingTop: '10px' }}>
                <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>WEATHER CONDITIONS</div>
                <div style={{ fontSize: '14px', fontWeight: 'bold', color: weatherColor, marginBottom: '5px' }}>
                    {weatherLabel}
                </div>
                {weatherEffects.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {weatherEffects.map((effect, i) => (
                            <div key={i} style={{ fontSize: '11px', color: '#ccc', background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                                {effect}
                            </div>
                        ))}
                    </div>
                )}
                {activeWeather === 'CLEAR' && (
                    <div style={{ fontSize: '11px', color: '#666', fontStyle: 'italic' }}>No active effects.</div>
                )}
            </div>
        </div>
    );
};

const WeatherIcon = ({ type }: { type: WeatherType }) => {
    let icon = '☀️';
    switch(type) {
        case 'SCORCHED': icon = '🔥'; break;
        case 'MONSOON': icon = '🌧️'; break;
        case 'FOG': icon = '🌫️'; break;
        case 'TAILWIND': icon = '🍃'; break;
        case 'SANDSTORM': icon = '🌪️'; break;
    }
    return (
        <span style={{ fontSize: '14px', marginLeft: '5px' }}>{icon}</span>
    );
};

export const LeftPanel = () => {
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const playerCount = useGameStore(state => state.settings.playerCount);
    const playerCp = useGameStore(state => state.playerCp);
    const playerGold = useGameStore(state => state.playerGold);
    const playerRespawns = useGameStore(state => state.playerRespawns);
    const playerStatus = useGameStore(state => state.playerStatus);
    const playerInventory = useGameStore(state => state.playerInventory);
    const graveyard = useGameStore(state => state.graveyard);
    const handleGraveyardSelect = useGameStore(state => state.handleGraveyardSelect);
    const selectedGraveyardUnitId = useGameStore(state => state.selectedGraveyardUnitId);
    const selectInventoryItem = useGameStore(state => state.selectInventoryItem);
    const selectedInventoryItemIndex = useGameStore(state => state.selectedInventoryItemIndex);
    const weather = useGameStore(state => state.weather);
    const settings = useGameStore(state => state.settings);
    const mapData = useGameStore(state => state.mapData);
    const units = useGameStore(state => state.units);

    const [expandedId, setExpandedId] = useState<number | null>(null);

    useEffect(() => {
        if (playerCount > 4) {
            setExpandedId(currentPlayer);
        } else {
            setExpandedId(null);
        }
    }, [currentPlayer, playerCount]);

    const renderPlayerSection = (pid: number) => {
        const isCompactMode = playerCount > 4;
        const isExpanded = !isCompactMode || expandedId === pid;
        
        const isCurrent = currentPlayer === pid;
        const isEliminated = playerStatus[pid] === 'ELIMINATED';
        const color = PLAYER_COLORS[pid];
        const casualties = graveyard.filter(u => u.owner === pid);
        const respawnsUsed = playerRespawns[pid] || 0;
        const maxRespawns = getEffectiveMaxRespawns(settings.mutators);
        const respawnsLeft = Math.max(0, maxRespawns - respawnsUsed);
        const inventory = playerInventory[pid] || [];
        
        let statsLabel = '';
        let statsValue = '';
        
        if (settings.victoryMode === 'CONQUER') {
             const base = mapData.find(t => t.type === 'BASE' && t.owner === pid);
             statsLabel = 'BASE HP';
             statsValue = base && base.hp !== undefined ? `${base.hp}` : 'DESTROYED';
        } else {
             const count = units.filter(u => u.owner === pid).length;
             statsLabel = 'UNITS';
             statsValue = `${count}`;
        }

        if (isEliminated) {
            return (
                <Panel key={pid} style={{ 
                    flex: '0 0 auto', 
                    opacity: 0.4, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '10px'
                }}>
                    <div style={{ color: color, fontWeight: 'bold', fontSize: '14px', textDecoration: 'line-through' }}>
                        P{pid + 1} (ELIM)
                    </div>
                </Panel>
            )
        }

        return (
            <Panel 
                key={pid} 
                onClick={() => { if(isCompactMode) setExpandedId(pid); }}
                style={{ 
                    flex: isExpanded ? 1 : '0 0 auto',
                    height: isExpanded ? 'auto' : 'auto',
                    border: isCurrent ? `2px solid ${color}` : '1px solid #333', 
                    opacity: isCurrent ? 1 : (isCompactMode && !isExpanded ? 0.6 : 0.8),
                    display: 'flex', 
                    flexDirection: 'column',
                    padding: '12px',
                    transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)',
                    cursor: isCompactMode ? 'pointer' : 'default',
                    overflow: 'hidden'
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: `1px solid ${color}40`, paddingBottom: '4px' }}>
                    <h2 style={{ color: color, margin: 0, fontSize: '16px' }}>
                        P{pid + 1} <WeatherIcon type={weather.playerZones[pid]} />
                    </h2>
                    <div style={{ background: color, color: 'white', fontSize: '10px', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px' }}>
                         {statsLabel}: {statsValue}
                    </div>
                </div>
                
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: isExpanded ? '10px' : '0', background: 'rgba(0,0,0,0.3)', padding: '6px', borderRadius: '6px' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#888' }}>GOLD</div>
                        <div style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '14px' }}>{playerGold[pid]}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#888' }}>CP</div>
                        <div style={{ color: 'white', fontWeight: 'bold', fontSize: '14px' }}>{playerCp[pid]}</div>
                    </div>
                </div>

                {isExpanded && (
                    <div style={{ flex: 1, overflowY: 'auto', minHeight: '60px', marginTop: '5px', animation: 'fadeIn 0.3s' }}>
                        
                        {inventory.length > 0 && (
                            <div style={{ marginBottom: '10px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
                                <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 'bold', marginBottom: '4px' }}>INVENTORY (Click to Use)</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                    {inventory.map((item, idx) => (
                                        <button
                                            key={idx}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (isCurrent) selectInventoryItem(idx === selectedInventoryItemIndex ? null : idx);
                                            }}
                                            style={{
                                                background: selectedInventoryItemIndex === idx ? '#4CAF50' : '#333',
                                                border: selectedInventoryItemIndex === idx ? '1px solid #81C784' : '1px solid #555',
                                                color: 'white',
                                                fontSize: '10px',
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                cursor: isCurrent ? 'pointer' : 'default',
                                                fontWeight: 'bold'
                                            }}
                                        >
                                            {item}
                                        </button>
                                    ))}
                                </div>
                                {selectedInventoryItemIndex !== null && isCurrent && (
                                    <div style={{ fontSize: '10px', color: '#4CAF50', marginTop: '4px', fontStyle: 'italic' }}>
                                        Select a unit on map to apply.
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <div style={{ fontSize: '10px', color: '#666', textTransform: 'uppercase', fontWeight: 'bold' }}>Casualties ({respawnsLeft})</div>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {casualties.map(unit => {
                                const cost = UNIT_COSTS[unit.type];
                                const canAfford = playerGold[pid] >= cost;
                                const isReady = unit.turnsUntilRespawn === 0;
                                const isSelected = selectedGraveyardUnitId === unit.id;
                                const hasRespawns = respawnsLeft > 0;

                                return (
                                    <div 
                                        key={unit.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (isCurrent && isReady && canAfford && hasRespawns) {
                                                handleGraveyardSelect(unit.id);
                                            }
                                        }}
                                        style={{
                                            background: isSelected ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.2)',
                                            border: isSelected ? `1px solid ${color}` : '1px solid transparent',
                                            borderRadius: '4px',
                                            padding: '4px',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            cursor: (isCurrent && isReady && canAfford && hasRespawns) ? 'pointer' : 'default',
                                            opacity: (isCurrent && isReady && !canAfford) ? 0.5 : 1
                                        }}
                                    >
                                        <div style={{fontSize:'10px'}}>
                                            <span style={{ color: color, fontWeight: 'bold' }}>{UNIT_STATS[unit.type].name.toUpperCase()}</span>
                                        </div>
                                        
                                        {isReady ? (
                                            <div style={{ 
                                                background: (canAfford && hasRespawns) ? color : '#333', 
                                                color: (canAfford && hasRespawns) ? 'white' : '#777',
                                                padding: '2px 4px', borderRadius: '3px', fontSize: '9px', fontWeight: 'bold' 
                                            }}>
                                                ${cost}
                                            </div>
                                        ) : (
                                            <div style={{ color: '#888', fontSize: '10px' }}>
                                                {unit.turnsUntilRespawn}t
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {casualties.length === 0 && (
                                <div style={{ fontSize:'10px', color:'#444', fontStyle:'italic', textAlign:'center', marginTop:'5px' }}>No Casualties</div>
                            )}
                        </div>
                    </div>
                )}
            </Panel>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '14px', gap: '10px', boxSizing: 'border-box', overflowY: 'auto' }}>
            {Array.from({ length: playerCount }).map((_, i) => renderPlayerSection(i))}
        </div>
    );
};


const TurnStatusBar = () => {
    const totalTurns = useGameStore(state => state.totalTurns);
    const weather = useGameStore(state => state.weather);
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const dynamicWeather = useGameStore(state => state.settings.dynamicWeather);
    const mutators = useGameStore(state => state.settings.mutators);
    const activeSeed = useGameStore(state => state.activeSeed);
    const activeMission = useGameStore(state => state.activeMission);
    const matchStats = useGameStore(state => state.matchStats);
    const units = useGameStore(state => state.units);
    const [muted, setMuted] = useState(() => SoundFX.isMuted());

    const toggleMute = () => {
        const next = !muted;
        SoundFX.setMuted(next);
        setMuted(next);
    };

    const zoneWeather = weather.playerZones[currentPlayer] || 'CLEAR';
    const activeMutatorTags = [
        mutators?.blitzCp ? 'BLITZ CP' : null,
        mutators?.scarcity ? 'SCARCITY' : null,
        mutators?.ironman ? 'IRONMAN' : null
    ].filter(Boolean) as string[];

    let missionLine: string | null = null;
    if (activeMission) {
        const elapsedRound = Math.max(1, totalTurns - (activeMission.startingRound ?? 0) + 1);
        if (activeMission.surviveTurns) {
            missionLine = `Hold ${elapsedRound}/${activeMission.surviveTurns} Rounds`;
        } else if (activeMission.requiredHeists) {
            missionLine = `Heists ${matchStats[0]?.heists ?? 0}/${activeMission.requiredHeists} • Limit ${activeMission.turnLimit}R (Now ${elapsedRound}R)`;
        } else if (activeMission.targetKillType) {
            const acesLeft = units.filter(
                u => u.owner === activeMission.targetKillType!.owner && (u.rank ?? 0) >= activeMission.targetKillType!.minRank
            ).length;
            missionLine = `Targets Left: ${acesLeft} • Limit ${activeMission.turnLimit}R (${elapsedRound}R)`;
        } else if (activeMission.turnLimit) {
            missionLine = `HQ Assault • Limit ${activeMission.turnLimit}R (${elapsedRound}R)`;
        } else {
            missionLine = activeMission.subtitle;
        }
    }

    return (
        <Panel style={{ marginBottom: '0px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', background: 'rgba(30, 35, 45, 0.9)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div>
                    <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                        ROUND {totalTurns + 1}
                        {activeSeed && (
                            <span style={{ color: '#FFD700', marginLeft: '6px', fontFamily: 'monospace' }}>
                                • {activeSeed}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: '10px', color: '#90caf9' }}>
                        {dynamicWeather ? `${zoneWeather} • Shift in ${weather.turnsRemaining}t` : 'Weather: Clear'}
                    </div>
                </div>
                <button
                    onClick={toggleMute}
                    title={muted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
                    style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255, 255, 255, 0.18)',
                        borderRadius: '6px',
                        padding: '5px 10px',
                        color: muted ? '#888' : '#fff',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                    }}
                >
                    {muted ? '🔇 MUTE' : '🔊 SFX'}
                </button>
            </div>
            {(missionLine || activeMutatorTags.length > 0) && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {missionLine && (
                        <div style={{ fontSize: '10px', color: '#FFD54F', fontWeight: 'bold' }}>
                            🎯 {activeMission?.title}: {missionLine}
                        </div>
                    )}
                    {activeMutatorTags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {activeMutatorTags.map(tag => (
                                <span key={tag} style={{ fontSize: '9px', padding: '1px 6px', borderRadius: '4px', background: 'rgba(255,152,0,0.18)', border: '1px solid rgba(255,152,0,0.45)', color: '#FFB74D', fontWeight: 'bold' }}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </Panel>
    );
};

const BankRewardModal = () => {
    const bankRewardPending = useGameStore((state) => state.bankRewardPending);
    const resolveBankReward = useGameStore((state) => state.resolveBankReward);
    const currentPlayer = useGameStore((state) => state.currentPlayer);
    const mapData = useGameStore((state) => state.mapData);
    const mutators = useGameStore((state) => state.settings.mutators);

    if (!bankRewardPending || bankRewardPending.playerId !== currentPlayer) return null;
    const bankTile = mapData.find(t => t.id === bankRewardPending.tileId);
    const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(bankTile, mutators);

    return (
        <div style={{
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(5px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200
        }}>
             <Panel style={{ width: '400px', textAlign: 'center', border: '2px solid #FFD700', boxShadow: '0 0 30px rgba(255, 215, 0, 0.3)' }}>
                <h1 style={{ color: '#FFD700', fontSize: '24px', marginBottom: '10px' }}>VAULT BREACHED</h1>
                <p style={{ color: '#ccc', marginBottom: '30px' }}>The heist was successful. Choose your share of the loot.</p>
                
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center' }}>
                    <button 
                        onClick={() => resolveBankReward('GOLD')}
                        style={{
                            padding: '20px', background: 'rgba(255, 215, 0, 0.1)',
                            border: '1px solid #FFD700', borderRadius: '8px',
                            color: '#FFD700', cursor: 'pointer', flex: 1,
                            transition: 'all 0.2s'
                        }}
                    >
                        <div style={{ fontSize: '24px', marginBottom: '5px' }}>💰</div>
                        <div style={{ fontWeight: 'bold' }}>{goldReward} GOLD</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Fund your war machine</div>
                    </button>

                    <button 
                        onClick={() => resolveBankReward('CP')}
                        style={{
                            padding: '20px', background: 'rgba(33, 150, 243, 0.1)',
                            border: '1px solid #2196F3', borderRadius: '8px',
                            color: '#2196F3', cursor: 'pointer', flex: 1,
                            transition: 'all 0.2s'
                        }}
                    >
                         <div style={{ fontSize: '24px', marginBottom: '5px' }}>⚡</div>
                        <div style={{ fontWeight: 'bold' }}>{cpReward} CP</div>
                        <div style={{ fontSize: '11px', color: '#888' }}>Tactical Advantage</div>
                    </button>
                </div>
             </Panel>
        </div>
    );
};

export const RightPanel = () => {
    const selectedUnitId = useGameStore(state => state.selectedUnitId);
    const selectedTileId = useGameStore(state => state.selectedTileId);
    const hoveredTileId = useGameStore(state => state.hoveredTileId);
    const validAttackTargets = useGameStore(state => state.validAttackTargets);
    const validMoveCosts = useGameStore(state => state.validMoveCosts);
    const mapData = useGameStore(state => state.mapData);
    const units = useGameStore(state => state.units);
    const currentPlayer = useGameStore(state => state.currentPlayer);
    const playerGold = useGameStore(state => state.playerGold);
    const playerCp = useGameStore(state => state.playerCp);
    const weather = useGameStore(state => state.weather);
    const gridSize = useGameStore(state => state.gridSize);
    const visibleTiles = useGameStore(state => state.visibleTiles);
    const fogOfWar = useGameStore(state => state.settings.fogOfWar);
    const victoryMode = useGameStore(state => state.settings.victoryMode);
    const isAiTurn = useGameStore(state => state.isAiTurn);
    const endTurn = useGameStore(state => state.endTurn);
    const selectNextReadyUnit = useGameStore(state => state.selectNextReadyUnit);
    const reloadUnit = useGameStore(state => state.reloadUnit);
    const enterOverwatch = useGameStore(state => state.enterOverwatch);
    const buyShopItem = useGameStore(state => state.buyShopItem);
    const cancelPlacement = useGameStore(state => state.cancelPlacement);
    const placementMode = useGameStore(state => state.placementMode);
    
    // Heist Bank Reward Check
    const bankRewardPending = useGameStore(state => state.bankRewardPending);
    
    const secureBuilding = useGameStore(state => state.secureBuilding);
    const heistBank = useGameStore(state => state.heistBank);
    const siegeBase = useGameStore(state => state.siegeBase);
    const demolishBarrier = useGameStore(state => state.demolishBarrier);
    const lootSupply = useGameStore(state => state.lootSupply);

    const validSecureTile = useGameStore(state => state.validSecureTile);
    const validHeistTile = useGameStore(state => state.validHeistTile);
    const validSiegeTile = useGameStore(state => state.validSiegeTile);
    const validLootTile = useGameStore(state => state.validLootTile);
    const validDemolishTile = useGameStore(state => state.validDemolishTile);

    const [activeTab, setActiveTab] = useState<'INTEL' | 'LOG'>('INTEL');

    const selectedUnit = units.find(u => u.id === selectedUnitId);
    const selectedTile = mapData.find(t => t.id === selectedTileId);
    const hoveredTile = mapData.find(t => t.id === hoveredTileId);
    const selectedUnitTile = selectedUnit ? mapData.find(t => t.id === selectedUnit.tileId) : undefined;
    const hoveredEnemy = hoveredTile
        ? units.find(u => u.tileId === hoveredTile.id && validAttackTargets.includes(u.id))
        : undefined;

    let combatPreview: { title: string; damage: number; hpBefore: number; hpAfter: number; notes: string[] } | null = null;
    if (selectedUnit && selectedUnit.owner === currentPlayer && hoveredTile) {
        if (hoveredEnemy) {
            const { damage, defense, watchtowerBoosted, coverArmorApplied } = calculateAttackOutcome(
                selectedUnit,
                selectedUnitTile,
                hoveredTile,
                hoveredEnemy.owner,
                hoveredEnemy
            );
            const notes: string[] = [];
            if (defense > 0) notes.push(`Target Cover: -${Math.round(defense * 100)}% DMG`);
            if (defense < 0) notes.push(`Exposed (${hoveredTile.type}): +${Math.round(Math.abs(defense) * 100)}% DMG`);
            if (coverArmorApplied) notes.push(`Cover Armor: -${VETERANCY_CONFIG.ELITE_BREACHER_COVER_DR} DMG`);
            if (watchtowerBoosted) notes.push('Watchtower Bonus: x1.2 DMG');
            if (hoveredEnemy.isOverwatching) notes.push('Breaks Overwatch (SUPPRESSED!)');
            combatPreview = {
                title: `P${hoveredEnemy.owner + 1} ${UNIT_STATS[hoveredEnemy.type].name}`,
                damage,
                hpBefore: hoveredEnemy.hp,
                hpAfter: Math.max(0, hoveredEnemy.hp - damage),
                notes
            };
        } else if (validSiegeTile && hoveredTile.id === validSiegeTile && hoveredTile.hp !== undefined) {
            const damage = calculateSiegeDamage(selectedUnit, selectedUnitTile);
            const piercesBase = selectedUnit.type === 'ASSAULTER' && (selectedUnit.rank ?? 0) >= 3;
            combatPreview = {
                title: `P${(hoveredTile.owner ?? 0) + 1} Headquarters`,
                damage,
                hpBefore: hoveredTile.hp,
                hpAfter: Math.max(0, hoveredTile.hp - damage),
                notes: [piercesBase ? 'Ace Siege Pierce: 100% DMG' : 'Base Armor: -20% DMG']
            };
        } else if (validDemolishTile && hoveredTile.id === validDemolishTile && hoveredTile.hp !== undefined) {
            const damage = calculateDemolishDamage(selectedUnit, selectedUnitTile);
            combatPreview = {
                title: 'Defense Barrier',
                damage,
                hpBefore: hoveredTile.hp,
                hpAfter: Math.max(0, hoveredTile.hp - damage),
                notes: ['Full Structural Damage']
            };
        }
    }

    const readyUnitCount = units.filter(u => u.owner === currentPlayer && !u.completed).length;
    const sniperCanFire = selectedUnit?.type === 'SNIPER'
        ? canUnitAttackFromTile(selectedUnit, selectedUnitTile)
        : true;

    const movePreviewCost =
        selectedUnit && selectedUnit.owner === currentPlayer && hoveredTile && validMoveCosts.has(hoveredTile.id)
            ? validMoveCosts.get(hoveredTile.id)!
            : null;
    const movePreviewWarnings: string[] = [];
    if (movePreviewCost !== null && hoveredTile) {
        if (hoveredTile.type === 'QUICKSAND') movePreviewWarnings.push('Quicksand: Roots unit next turn!');
        if ((TERRAIN_DEFENSE[hoveredTile.type] || 0) < 0) movePreviewWarnings.push(`${hoveredTile.type}: -10% Exposed Cover`);
        if ((TERRAIN_DEFENSE[hoveredTile.type] || 0) > 0) movePreviewWarnings.push(`${hoveredTile.type}: +${Math.round((TERRAIN_DEFENSE[hoveredTile.type] || 0) * 100)}% Cover`);
        const inBankRange = mapData.some(
            t => t.type === 'BANK' && (t.hackProgress || 0) < 100 && Math.abs(t.x - hoveredTile.x) + Math.abs(t.y - hoveredTile.y) <= BANK_STATS.RANGE
        );
        if (inBankRange) movePreviewWarnings.push(`Inside Bank Turret Range (${BANK_STATS.DAMAGE} DMG/t)`);
        if (victoryMode === 'CONQUER') {
            const inBaseArtillery = mapData.some(
                t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0 && Math.abs(t.x - hoveredTile.x) + Math.abs(t.y - hoveredTile.y) <= BASE_STATS.RANGE
            );
            if (inBaseArtillery) movePreviewWarnings.push(`Inside Enemy Base Artillery (${BASE_STATS.MIN_DMG}-${BASE_STATS.MAX_DMG} DMG/t)`);
        }
        if (selectedUnit && selectedUnit.owner === currentPlayer) {
            const owCheck = resolveMoveWithOverwatch({
                movingUnit: selectedUnit,
                targetTileId: hoveredTile.id,
                mapData,
                units,
                weather,
                gridSize,
                fogOfWar,
                maxBudget: playerCp[currentPlayer] ?? 0,
                knownVisibleTiles: fogOfWar ? visibleTiles : null
            });
            if (owCheck.trigger) {
                movePreviewWarnings.push(
                    owCheck.trigger.pinResisted
                        ? `Enemy Overwatch on path (-${owCheck.trigger.damage} DMG, Pin Resisted)`
                        : `Enemy Overwatch on path (-${owCheck.trigger.damage} DMG, Pins)`
                );
            }
        }
    }

    const isMyTurn = !isAiTurn;

    // 1. BANK HEIST MODAL (Highest Priority Overlay)
    if (bankRewardPending && bankRewardPending.playerId === currentPlayer) {
         return <BankRewardModal />;
    }

    if (placementMode && placementMode.active) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '14px', boxSizing: 'border-box' }}>
                <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                    <h2 style={{ color: '#FFD700', marginBottom: '10px' }}>CONSTRUCTION MODE</h2>
                    <p style={{ color: '#ccc', marginBottom: '20px' }}>Select a target tile to build.</p>
                    <div style={{ fontSize: '14px', color: '#888', marginBottom: '20px' }}>
                        Item: {SHOP_ITEMS[placementMode.itemKey as keyof typeof SHOP_ITEMS]?.name} (${placementMode.cost})
                    </div>
                    <button 
                        onClick={cancelPlacement}
                        style={{ padding: '12px 24px', background: '#D32F2F', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        CANCEL BUILD
                    </button>
                </Panel>
            </div>
        )
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '14px', gap: '12px', boxSizing: 'border-box' }}>
            
            <TurnStatusBar />

            {/* TOP SECTION: TABS & INTEL/LOGS (Flex 1 to fill available space) */}
            <Panel style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
                {/* Tabs Header */}
                <div style={{ display: 'flex', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid #444', flexShrink: 0 }}>
                    <button 
                        onClick={() => setActiveTab('INTEL')}
                        style={{ 
                            flex: 1, padding: '12px', background: activeTab === 'INTEL' ? 'rgba(255,255,255,0.05)' : 'transparent',
                            color: activeTab === 'INTEL' ? 'white' : '#888', border: 'none', 
                            borderBottom: activeTab === 'INTEL' ? '3px solid #2196F3' : '3px solid transparent',
                            fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                        }}
                    >
                        INTEL
                    </button>
                    <button 
                        onClick={() => setActiveTab('LOG')}
                        style={{ 
                            flex: 1, padding: '12px', background: activeTab === 'LOG' ? 'rgba(255,255,255,0.05)' : 'transparent',
                            color: activeTab === 'LOG' ? 'white' : '#888', border: 'none',
                            borderBottom: activeTab === 'LOG' ? '3px solid #2196F3' : '3px solid transparent',
                            fontWeight: 'bold', cursor: 'pointer', fontSize: '12px'
                        }}
                    >
                        LOGS
                    </button>
                </div>

                {/* Tab Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                    {activeTab === 'INTEL' ? (
                        <>
                            {selectedUnit ? (() => {
                                const rank = selectedUnit.rank ?? 0;
                                const xp = selectedUnit.xp ?? 0;
                                const nextThreshold = rank < 3 ? VETERANCY_CONFIG.XP_THRESHOLDS[rank + 1] : null;
                                const maxHp = getUnitMaxHp(selectedUnit);
                                const baseDmg = getUnitBaseDamage(selectedUnit);
                                const atkCost = getUnitAttackCost(selectedUnit);
                                const rankPerkSummary = rank === 0
                                    ? null
                                    : [
                                        `+20% Max HP & +${VETERANCY_CONFIG.AMMO_BONUS_RANK1[selectedUnit.type]} Max Ammo`,
                                        rank >= 2 && selectedUnit.type === 'SOLDIER' ? '+1 Vision & Clear Weather Plains' : null,
                                        rank >= 2 && selectedUnit.type === 'ASSAULTER' ? `Cover Armor (-${VETERANCY_CONFIG.ELITE_BREACHER_COVER_DR} DMG in Cover)` : null,
                                        rank >= 2 && selectedUnit.type === 'SNIPER' ? `+${VETERANCY_CONFIG.ELITE_SNIPER_DMG_BONUS} DMG & ${atkCost} CP Shot` : null,
                                        rank >= 3 ? '+20% Ace Max HP' : null,
                                        rank >= 3 && selectedUnit.type === 'SOLDIER' ? `+${VETERANCY_CONFIG.ACE_SCOUT_DMG_BONUS} DMG & ${atkCost} CP Shot` : null,
                                        rank >= 3 && selectedUnit.type === 'ASSAULTER' ? `+${VETERANCY_CONFIG.ACE_BREACHER_DMG_BONUS} DMG & Siege Armor Pierce` : null,
                                        rank >= 3 && selectedUnit.type === 'SNIPER' ? '1 CP Mountain/Dunes Move' : null
                                    ].filter(Boolean).join(' • ');

                                return (
                                <div style={{ animation: 'fadeIn 0.2s' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
                                        <div style={{ 
                                            width: '40px', height: '40px', 
                                            background: PLAYER_COLORS[selectedUnit.owner], 
                                            borderRadius: '4px', marginRight: '10px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontWeight: 'bold', color: 'rgba(0,0,0,0.6)',
                                            border: rank >= 3 ? '2px solid #FFD700' : 'none'
                                        }}>
                                            {UNIT_STATS[selectedUnit.type].name.substring(0,2)}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                                                <span style={{ fontSize: '15px', fontWeight: 'bold', color: 'white' }}>{UNIT_STATS[selectedUnit.type].name.toUpperCase()}</span>
                                                <span style={{
                                                    fontSize: '10px',
                                                    fontWeight: 'bold',
                                                    padding: '2px 6px',
                                                    borderRadius: '4px',
                                                    background: rank > 0 ? 'rgba(255, 215, 0, 0.18)' : 'rgba(255,255,255,0.08)',
                                                    color: rank > 0 ? '#FFD700' : '#999',
                                                    border: rank > 0 ? '1px solid rgba(255, 215, 0, 0.4)' : '1px solid #333'
                                                }}>
                                                    {rank > 0 ? VETERANCY_CONFIG.RANK_LABELS[rank] : 'RECRUIT'}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', justifyContent: 'space-between', marginTop: '3px' }}>
                                                <span>{selectedUnit.owner === currentPlayer ? 'Your Unit' : 'Enemy Unit'}</span>
                                                <span>
                                                    {nextThreshold !== null ? `XP ${xp}/${nextThreshold}` : `MAX (${xp} XP)`} • {selectedUnit.kills ?? 0} KILLS
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {rankPerkSummary && (
                                        <div style={{
                                            fontSize: '10px',
                                            color: '#FFD54F',
                                            background: 'rgba(255, 215, 0, 0.08)',
                                            border: '1px solid rgba(255, 215, 0, 0.25)',
                                            borderRadius: '4px',
                                            padding: '5px 8px',
                                            marginBottom: '10px'
                                        }}>
                                            {rankPerkSummary}
                                        </div>
                                    )}

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '15px' }}>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
                                            <div style={{ fontSize: '10px', color: '#888' }}>HP</div>
                                            <div style={{ color: selectedUnit.hp < 5 ? '#f44336' : 'white', fontWeight: 'bold' }}>{selectedUnit.hp} / {maxHp}</div>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
                                            <div style={{ fontSize: '10px', color: '#888' }}>AMMO</div>
                                            <div style={{ color: selectedUnit.ammo === 0 ? '#f44336' : 'white', fontWeight: 'bold' }}>{selectedUnit.ammo} / {selectedUnit.maxAmmo}</div>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
                                            <div style={{ fontSize: '10px', color: '#888' }}>ATK DMG</div>
                                            <div style={{ color: 'white', fontWeight: 'bold' }}>{baseDmg}</div>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
                                            <div style={{ fontSize: '10px', color: '#888' }}>ATK COST</div>
                                            <div style={{ color: 'white', fontWeight: 'bold' }}>{atkCost} CP</div>
                                        </div>
                                    </div>
                                    
                                    {selectedUnit.type === 'SNIPER' && selectedUnit.owner === currentPlayer && (
                                        <div style={{
                                            marginBottom: '10px',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            fontSize: '11px',
                                            fontWeight: 'bold',
                                            background: sniperCanFire ? 'rgba(76, 175, 80, 0.15)' : 'rgba(255, 152, 0, 0.15)',
                                            border: `1px solid ${sniperCanFire ? '#4CAF50' : '#FF9800'}`,
                                            color: sniperCanFire ? '#A5D6A7' : '#FFCC80'
                                        }}>
                                            {sniperCanFire ? '🎯 High-Ground Firing Ready' : '⚠️ Move to Mountain, Dunes, or Owned Building to Fire'}
                                        </div>
                                    )}
                                    
                                    {selectedUnit.owner === currentPlayer && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {selectedUnit.isOverwatching && (
                                                <div style={{
                                                    padding: '8px 10px',
                                                    borderRadius: '4px',
                                                    background: 'rgba(255, 179, 0, 0.16)',
                                                    border: '1px solid #FFB300',
                                                    color: '#FFE082',
                                                    fontSize: '11px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    🎯 OVERWATCH ACTIVE ({OVERWATCH_STATS[selectedUnit.type].damage} DMG • +{OVERWATCH_STATS[selectedUnit.type].refund} CP refund if unfired)
                                                </div>
                                            )}
                                            {!selectedUnit.completed && !selectedUnit.isOverwatching && (() => {
                                                const owCfg = OVERWATCH_STATS[selectedUnit.type];
                                                const canOw = canUnitEnterOverwatch(selectedUnit, selectedUnitTile, playerCp[currentPlayer] ?? 0);
                                                return (
                                                    <button
                                                        onClick={enterOverwatch}
                                                        disabled={!canOw}
                                                        style={{
                                                            padding: '10px',
                                                            background: canOw ? 'linear-gradient(135deg, #F57C00 0%, #E65100 100%)' : '#333',
                                                            border: canOw ? '1px solid #FFB300' : '1px solid #444',
                                                            color: canOw ? 'white' : '#777',
                                                            borderRadius: '4px',
                                                            cursor: canOw ? 'pointer' : 'not-allowed',
                                                            fontWeight: 'bold',
                                                            fontSize: '12px'
                                                        }}
                                                    >
                                                        SET OVERWATCH ({owCfg.cost} CP • {owCfg.damage} DMG) • O
                                                    </button>
                                                );
                                            })()}
                                            {selectedUnit.ammo < selectedUnit.maxAmmo && !selectedUnit.completed && (
                                                <button
                                                    onClick={reloadUnit}
                                                    disabled={(playerCp[currentPlayer] ?? 0) < CP_SYSTEM.RELOAD_COST}
                                                    style={{
                                                        padding: '10px',
                                                        background: (playerCp[currentPlayer] ?? 0) >= CP_SYSTEM.RELOAD_COST ? '#1976D2' : '#333',
                                                        border: 'none',
                                                        color: (playerCp[currentPlayer] ?? 0) >= CP_SYSTEM.RELOAD_COST ? 'white' : '#777',
                                                        borderRadius: '4px',
                                                        cursor: (playerCp[currentPlayer] ?? 0) >= CP_SYSTEM.RELOAD_COST ? 'pointer' : 'not-allowed',
                                                        fontWeight: 'bold'
                                                    }}
                                                >
                                                    FIELD RELOAD (+{Math.max(1, Math.ceil(selectedUnit.maxAmmo / 2))} AMMO • {CP_SYSTEM.RELOAD_COST} CP)
                                                </button>
                                            )}
                                            {validSecureTile && (
                                                <button onClick={secureBuilding} style={{ padding: '10px', background: '#FF9800', border: 'none', color: 'black', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    SECURE BUILDING (4 CP)
                                                </button>
                                            )}
                                            {validHeistTile && (
                                                <button onClick={heistBank} style={{ padding: '10px', background: '#FFD700', border: 'none', color: 'black', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    HEIST BANK (4 CP)
                                                </button>
                                            )}
                                            {validSiegeTile && (
                                                <button onClick={siegeBase} style={{ padding: '10px', background: '#D32F2F', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    SIEGE BASE
                                                </button>
                                            )}
                                            {validDemolishTile && (
                                                <button onClick={demolishBarrier} style={{ padding: '10px', background: '#D32F2F', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    DEMOLISH BARRIER
                                                </button>
                                            )}
                                            {validLootTile && (
                                                <button onClick={lootSupply} style={{ padding: '10px', background: '#4CAF50', border: 'none', color: 'white', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                                    RETRIEVE SUPPLY (4 CP)
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {combatPreview && (
                                        <div style={{
                                            marginTop: '14px',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            background: 'rgba(211, 47, 47, 0.14)',
                                            border: '1px solid #ef5350'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                <span style={{ fontSize: '10px', color: '#ef9a9a', fontWeight: 'bold', letterSpacing: '0.5px' }}>TARGET PREVIEW</span>
                                                {combatPreview.hpAfter === 0 && (
                                                    <span style={{ fontSize: '10px', background: '#D32F2F', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontWeight: 'bold' }}>LETHAL</span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff', marginBottom: '4px' }}>{combatPreview.title}</div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#ffccbc', marginBottom: '4px' }}>
                                                <span>Expected DMG: <strong>-{combatPreview.damage}</strong></span>
                                                <span>HP: {combatPreview.hpBefore} → <strong>{combatPreview.hpAfter}</strong></span>
                                            </div>
                                            {combatPreview.notes.map((note, idx) => (
                                                <div key={idx} style={{ fontSize: '10px', color: '#bbb' }}>• {note}</div>
                                            ))}
                                        </div>
                                    )}

                                    {movePreviewCost !== null && hoveredTile && !combatPreview && (
                                        <div style={{
                                            marginTop: '14px',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            background: 'rgba(0, 229, 255, 0.1)',
                                            border: '1px solid #00BCD4'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#80DEEA', fontWeight: 'bold', marginBottom: '4px' }}>
                                                <span>MOVE TO ({hoveredTile.x},{hoveredTile.y})</span>
                                                <span>{movePreviewCost} CP</span>
                                            </div>
                                            {movePreviewWarnings.map((w, idx) => (
                                                <div key={idx} style={{ fontSize: '10px', color: w.includes('Quicksand') || w.includes('Inside') || w.includes('Exposed') || w.includes('Overwatch') ? '#FFCC80' : '#B2EBF2' }}>
                                                    • {w}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                );
                            })() : selectedTile ? (() => {
                                const tileUnit = units.find(u =>
                                    u.tileId === selectedTile.id &&
                                    (!fogOfWar || u.owner === currentPlayer || visibleTiles.has(u.tileId))
                                );
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {tileUnit && (
                                            <div style={{ padding: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', border: tileUnit.isOverwatching ? '1px solid #FFB300' : '1px solid #333' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                    <span style={{ fontSize: '12px', fontWeight: 'bold', color: PLAYER_COLORS[tileUnit.owner] }}>
                                                        P{tileUnit.owner + 1} {UNIT_STATS[tileUnit.type].name.toUpperCase()}
                                                    </span>
                                                    <span style={{ fontSize: '11px', color: '#ddd' }}>
                                                        HP {tileUnit.hp}/{getUnitMaxHp(tileUnit)}
                                                    </span>
                                                </div>
                                                {tileUnit.isOverwatching && (
                                                    <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#FFB300' }}>
                                                        🎯 OVERWATCH ACTIVE ({OVERWATCH_STATS[tileUnit.type].damage} DMG reaction)
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        <BuildingInfoPanel tile={selectedTile} />
                                    </div>
                                );
                            })() : (
                                <div style={{ color: '#666', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>
                                    Select a unit or tile for tactical analysis.
                                </div>
                            )}
                        </>
                    ) : (
                        <LogView />
                    )}
                </div>
            </Panel>

            {/* MIDDLE SECTION: SHOP (Limited Height, Scrollable) */}
            {isMyTurn && (
                <Panel style={{ height: '35%', minHeight: '160px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', marginBottom: '4px', flexShrink: 0 }}>Field Shop (Requisition)</div>
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
                        {Object.entries(SHOP_ITEMS).map(([key, item]) => (
                            <button
                                key={key}
                                onClick={() => buyShopItem(key)}
                                disabled={playerGold[currentPlayer] < item.cost}
                                style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '10px',
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid #333',
                                    borderRadius: '4px',
                                    cursor: playerGold[currentPlayer] >= item.cost ? 'pointer' : 'not-allowed',
                                    opacity: playerGold[currentPlayer] >= item.cost ? 1 : 0.5,
                                    width: '100%',
                                    textAlign: 'left'
                                }}
                            >
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ color: '#ddd', fontSize: '12px', fontWeight: 'bold' }}>{item.name}</span>
                                    {item.type === 'CONSUMABLE' && <span style={{ color: '#888', fontSize: '10px' }}>Delivered via Drop Pod</span>}
                                </div>
                                <span style={{ color: '#FFD700', fontSize: '12px', fontWeight: 'bold' }}>${item.cost}</span>
                            </button>
                        ))}
                    </div>
                </Panel>
            )}

            {/* BOTTOM SECTION: NEXT UNIT + END TURN */}
            {isMyTurn && readyUnitCount > 0 && (
                <button
                    onClick={selectNextReadyUnit}
                    style={{
                        height: '38px',
                        padding: '0 12px',
                        background: 'rgba(33, 150, 243, 0.16)',
                        color: '#90CAF9',
                        border: '1px solid #2196F3',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        letterSpacing: '0.5px',
                        flexShrink: 0
                    }}
                >
                    NEXT READY UNIT ({readyUnitCount}) • TAB
                </button>
            )}

            <button
                onClick={endTurn}
                disabled={!isMyTurn}
                style={{
                    height: '60px',
                    padding: '0 16px',
                    background: isMyTurn ? 'linear-gradient(135deg, #2E7D32 0%, #1B5E20 100%)' : '#333',
                    color: isMyTurn ? 'white' : '#666',
                    border: 'none',
                    borderRadius: '12px',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    cursor: isMyTurn ? 'pointer' : 'not-allowed',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    boxShadow: isMyTurn ? '0 4px 15px rgba(46, 125, 50, 0.4)' : 'none',
                    flexShrink: 0
                }}
            >
                {isMyTurn ? 'END TURN' : 'ENEMY TURN'}
            </button>
        </div>
    );
};

export const WinnerOverlay = () => {
    const winner = useGameStore(state => state.winner);
    const resetGame = useGameStore(state => state.resetGame);
    const retryCurrentMatch = useGameStore(state => state.retryCurrentMatch);
    const victoryMode = useGameStore(state => state.settings.victoryMode);
    const matchSummary = useGameStore(state => state.matchSummary);
    const activeSeed = useGameStore(state => state.activeSeed);
    const activeMission = useGameStore(state => state.activeMission);
    const [copiedSeed, setCopiedSeed] = useState(false);

    if (winner === null) return null;

    const gradeColors: Record<string, string> = {
        S: '#FFD700',
        A: '#4CAF50',
        B: '#2196F3',
        C: '#FF9800',
        D: '#F44336'
    };
    const winnerStats = matchSummary?.playerStats?.[winner];
    const seedValue = matchSummary?.seed || activeSeed;

    const handleCopySeed = () => {
        if (!seedValue) return;
        navigator.clipboard?.writeText(seedValue).then(() => {
            setCopiedSeed(true);
            setTimeout(() => setCopiedSeed(false), 1800);
        }).catch(() => {});
    };

    return (
        <div style={{
            position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(10px)',
            zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px', boxSizing: 'border-box'
        }}>
            <div style={{
                textAlign: 'center',
                animation: 'fadeIn 0.4s ease-out',
                background: 'rgba(22, 24, 30, 0.96)',
                border: '1px solid #333',
                borderRadius: '16px',
                padding: '28px 34px',
                maxWidth: '520px',
                width: '100%',
                boxShadow: '0 20px 60px rgba(0,0,0,0.75)'
            }}>
                <div style={{ fontSize: '48px', marginBottom: '8px' }}>
                    {activeMission ? (winner === 0 ? '🎖️' : '💀') : '🏆'}
                </div>
                <h1 style={{ color: PLAYER_COLORS[winner], fontSize: '34px', margin: '0 0 6px 0', textShadow: '0 0 20px currentColor' }}>
                    {activeMission
                        ? (winner === 0 ? 'OPERATION COMPLETE!' : 'OPERATION FAILED')
                        : `PLAYER ${winner + 1} WINS!`}
                </h1>
                <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '16px' }}>
                    {activeMission
                        ? `${activeMission.title} • ${activeMission.subtitle}`
                        : victoryMode === 'CONQUER' ? 'Enemy Headquarters Destroyed' : 'All Enemy Units Eliminated'}
                </p>

                {matchSummary?.challengeMedal && winner === 0 && (
                    <div style={{
                        display: 'inline-block',
                        marginBottom: '16px',
                        padding: '6px 14px',
                        borderRadius: '20px',
                        background: 'rgba(255, 215, 0, 0.14)',
                        border: `1px solid ${gradeColors[matchSummary.challengeMedal]}`,
                        color: gradeColors[matchSummary.challengeMedal],
                        fontSize: '12px',
                        fontWeight: 'bold',
                        letterSpacing: '1px'
                    }}>
                        🏅 MEDAL EARNED: {matchSummary.challengeMedal}-RANK
                    </div>
                )}

                {matchSummary && (
                    <div style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid #333',
                        borderRadius: '12px',
                        padding: '16px',
                        marginBottom: '20px',
                        textAlign: 'left'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #2e2e2e' }}>
                            <div>
                                <div style={{ fontSize: '10px', color: '#888', letterSpacing: '1px', fontWeight: 'bold' }}>AFTER-ACTION EFFICIENCY</div>
                                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fff', marginTop: '2px' }}>
                                    {matchSummary.score} / 100 PTS
                                </div>
                                <div style={{ fontSize: '11px', color: '#aaa', marginTop: '2px' }}>
                                    Completed in <strong>{matchSummary.rounds}</strong> Rounds (Par {matchSummary.parRounds})
                                </div>
                            </div>
                            <div style={{
                                width: '60px', height: '60px', borderRadius: '12px',
                                background: 'rgba(0,0,0,0.45)',
                                border: `2px solid ${gradeColors[matchSummary.grade] || '#fff'}`,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                            }}>
                                <span style={{ fontSize: '28px', fontWeight: 'bold', lineHeight: 1, color: gradeColors[matchSummary.grade] || '#fff' }}>
                                    {matchSummary.grade}
                                </span>
                                <span style={{ fontSize: '9px', color: '#999', marginTop: '2px' }}>GRADE</span>
                            </div>
                        </div>

                        {winnerStats && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                                <div style={{ background: 'rgba(0,0,0,0.28)', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '9px', color: '#888' }}>KILLS</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{winnerStats.kills}</div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.28)', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '9px', color: '#888' }}>LOSSES</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: winnerStats.unitsLost === 0 ? '#4CAF50' : '#ff8a65' }}>{winnerStats.unitsLost}</div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.28)', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '9px', color: '#888' }}>DAMAGE</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#fff' }}>{winnerStats.damageDealt}</div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.28)', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '9px', color: '#888' }}>HEISTS</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#FFD700' }}>{winnerStats.heists}</div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.28)', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '9px', color: '#888' }}>SECURED</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#90CAF9' }}>{winnerStats.buildingsSecured}</div>
                                </div>
                                <div style={{ background: 'rgba(0,0,0,0.28)', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '9px', color: '#888' }}>ACES</div>
                                    <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#FFD700' }}>{winnerStats.acesPromoted}</div>
                                </div>
                            </div>
                        )}

                        {matchSummary.mvp && (
                            <div style={{
                                background: 'rgba(255, 215, 0, 0.08)',
                                border: '1px solid rgba(255, 215, 0, 0.25)',
                                borderRadius: '8px',
                                padding: '8px 10px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: seedValue ? '10px' : '0px'
                            }}>
                                <div>
                                    <div style={{ fontSize: '9px', color: '#FFD700', fontWeight: 'bold', letterSpacing: '0.5px' }}>MATCH MVP</div>
                                    <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>
                                        {matchSummary.mvp.unitName} {matchSummary.mvp.rank > 0 ? VETERANCY_CONFIG.RANK_LABELS[matchSummary.mvp.rank] : ''}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '11px', color: '#ddd' }}>
                                    <div>{matchSummary.mvp.kills} Kills</div>
                                    <div style={{ color: '#aaa' }}>{matchSummary.mvp.damageDealt} DMG</div>
                                </div>
                            </div>
                        )}

                        {seedValue && (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.35)', padding: '6px 10px', borderRadius: '6px' }}>
                                <span style={{ fontSize: '11px', color: '#aaa' }}>
                                    SECTOR SEED: <strong style={{ color: '#FFD700', fontFamily: 'monospace' }}>{seedValue}</strong>
                                </span>
                                <button
                                    onClick={handleCopySeed}
                                    style={{
                                        background: '#333', border: '1px solid #555', color: '#eee',
                                        borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', fontWeight: 'bold'
                                    }}
                                >
                                    {copiedSeed ? 'COPIED' : 'COPY SEED'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                    {seedValue && (
                        <button
                            onClick={retryCurrentMatch}
                            style={{
                                padding: '14px 20px', background: '#1976D2', color: 'white',
                                border: '1px solid #42A5F5', borderRadius: '30px', fontSize: '14px', fontWeight: 'bold',
                                cursor: 'pointer'
                            }}
                        >
                            {activeMission ? 'RETRY OPERATION' : 'RETRY THIS SEED'}
                        </button>
                    )}
                    <button
                        onClick={resetGame}
                        style={{
                            padding: '14px 26px', background: 'white', color: 'black',
                            border: 'none', borderRadius: '30px', fontSize: '14px', fontWeight: 'bold',
                            cursor: 'pointer', boxShadow: '0 0 20px rgba(255,255,255,0.25)'
                        }}
                    >
                        RETURN TO BASE
                    </button>
                </div>
            </div>
        </div>
    );
};
