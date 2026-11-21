import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import {
  PLAYER_COLORS,
  UNIT_STATS,
  TERRAIN_DEFENSE,
  CP_SYSTEM,
  UNIT_COSTS,
  SHOP_ITEMS,
  BUILDING_STATS,
  GOLD_SETTINGS,
  BARRIER_STATS,
  BANK_STATS,
  BASE_STATS,
  VETERANCY_CONFIG,
  OVERWATCH_STATS,
  MUTATOR_CONFIG,
} from '../../core/constants/Config';
import { Tile, WeatherType, LogEntry } from '../../core/types';
import {
  calculateAttackOutcome,
  calculateSiegeDamage,
  calculateDemolishDamage,
  canUnitAttackFromTile,
  canUnitEnterOverwatch,
  getEffectiveBankRewards,
  getEffectiveMaxRespawns,
  getUnitMaxHp,
  getUnitBaseDamage,
  getUnitAttackCost,
} from '../../core/rules/CombatRules';
import { resolveMoveWithOverwatch } from '../../core/rules/OverwatchRules';
import { GeoButton, GeoCard, GeoChip, GeoWell, PLAYER_UI_THEME } from './GeoPrimitives';

const LogView: React.FC = () => {
  const gameLog = useGameStore(state => state.gameLog);

  const groupedLogs: Record<number, LogEntry[]> = {};
  gameLog.forEach(log => {
    if (!groupedLogs[log.round]) groupedLogs[log.round] = [];
    groupedLogs[log.round].push(log);
  });

  const rounds = Object.keys(groupedLogs).map(k => parseInt(k, 10)).sort((a, b) => b - a);

  if (rounds.length === 0) {
    return (
      <div style={{ color: 'var(--op-ink-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: '20px', fontSize: '12px' }}>
        Mission Log Empty
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {rounds.map(round => (
        <div key={round}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 800,
              color: 'var(--op-ink-muted)',
              borderBottom: '1px solid var(--op-line)',
              marginBottom: '6px',
              paddingBottom: '2px',
              textAlign: 'center',
              letterSpacing: '0.8px',
            }}
          >
            ROUND {round}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {groupedLogs[round].map(log => {
              const isEnv = log.playerId === -1;
              const pTheme = PLAYER_UI_THEME[log.playerId];
              const color = isEnv ? '#475569' : (pTheme?.ink || 'var(--op-ink)');
              const stripe = isEnv ? '#64748B' : (pTheme?.badgeBg || '#1D5EFF');

              return (
                <GeoWell key={log.id} coreStyle={{ padding: '0px', display: 'flex', alignItems: 'stretch' }}>
                  <div style={{ width: '4px', background: stripe, flexShrink: 0 }} />
                  <div style={{ padding: '6px 8px', flex: 1, fontSize: '12px', fontWeight: 600, color }}>
                    {log.message}
                  </div>
                </GeoWell>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

const BuildingInfoPanel: React.FC<{ tile: Tile }> = ({ tile }) => {
  const weatherState = useGameStore(state => state.weather);
  const victoryMode = useGameStore(state => state.settings.victoryMode);

  let name: string = tile.type;
  let ownerColor = 'var(--op-ink-muted)';
  let ownerName = 'NEUTRAL';
  const stats: { label: string; value: string }[] = [];

  if (tile.type === 'BUILDING' && tile.subType) {
    const config = BUILDING_STATS[tile.subType];
    name = config.name.toUpperCase();
    if (tile.owner !== null && tile.owner !== undefined) {
      ownerColor = PLAYER_UI_THEME[tile.owner]?.ink || 'var(--op-ink)';
      ownerName = `PLAYER ${tile.owner + 1}`;
    }
    stats.push({ label: 'DEFENSE', value: `+${Math.round(config.defense * 100)}%` });
    stats.push({ label: 'RANGE', value: `+${config.rangeBonus}` });
    stats.push({ label: 'DMG', value: `x${config.damageBonus}` });
  } else if (tile.type === 'BANK') {
    name = 'BANK VAULT';
    const hacked = (tile.hackProgress || 0) >= 100;
    ownerName = hacked ? 'LOOTED' : 'SECURE';
    ownerColor = hacked ? '#475569' : 'var(--acc-amber-ink)';
  } else if (tile.type === 'BASE') {
    name = 'HEADQUARTERS';
    if (tile.owner !== null && tile.owner !== undefined) {
      ownerColor = PLAYER_UI_THEME[tile.owner]?.ink || 'var(--op-ink)';
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
    stats.push({ label: 'COVER', value: `${Math.round(TERRAIN_DEFENSE[tile.type] * 100)}%` });
  } else {
    name = tile.type;
    const def = Math.round((TERRAIN_DEFENSE[tile.type] || 0) * 100);
    if (def !== 0) {
      stats.push({ label: 'DEFENSE', value: `${def > 0 ? '+' : ''}${def}%` });
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
  let weatherColor = 'var(--op-ink-muted)';
  const weatherEffects: string[] = [];

  if (activeWeather !== 'CLEAR') {
    switch (activeWeather) {
      case 'SCORCHED':
        weatherLabel = '🔥 SCORCHED';
        weatherColor = '#C2410C';
        if (tile.type === 'PLAINS') weatherEffects.push('Move Cost: 2 CP');
        if (tile.type === 'SAND') weatherEffects.push('Move Cost: 2 CP');
        break;
      case 'MONSOON':
        weatherLabel = '🌧️ MONSOON';
        weatherColor = '#1344C4';
        if (tile.type === 'PLAINS') weatherEffects.push('Mud: Heavy Units Slow');
        break;
      case 'FOG':
        weatherLabel = '🌫️ DENSE FOG';
        weatherColor = '#475569';
        weatherEffects.push('Vision Max: 2');
        weatherEffects.push('Sniper Range Max: 3');
        break;
      case 'TAILWIND':
        weatherLabel = '🍃 TAILWIND';
        weatherColor = '#046C3E';
        if (tile.type === 'PLAINS') weatherEffects.push('Move Cost: 0.5 CP');
        weatherEffects.push('Unit Range: +1');
        break;
      case 'SANDSTORM':
        weatherLabel = '🌪️ SANDSTORM';
        weatherColor = '#8D5B1C';
        weatherEffects.push('Vision Max: 3');
        break;
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div>
        <div style={{ fontSize: '16px', fontWeight: 900, color: 'var(--op-ink)' }}>{name}</div>
        <div style={{ fontSize: '12px', color: ownerColor, fontWeight: 800 }}>{ownerName}</div>
      </div>

      {stats.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          {stats.map((s, i) => (
            <GeoWell key={i} coreStyle={{ padding: '6px 8px' }}>
              <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>{s.label}</div>
              <div style={{ fontSize: '13px', fontWeight: 800, color: s.value.includes('-') ? 'var(--acc-red-ink)' : 'var(--op-ink)' }}>
                {s.value}
              </div>
            </GeoWell>
          ))}
        </div>
      )}

      <GeoWell coreStyle={{ padding: '8px 10px' }}>
        <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 800, marginBottom: '4px' }}>
          WEATHER CONDITIONS
        </div>
        <div style={{ fontSize: '13px', fontWeight: 900, color: weatherColor, marginBottom: weatherEffects.length > 0 ? '6px' : '0px' }}>
          {weatherLabel}
        </div>
        {weatherEffects.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {weatherEffects.map((effect, i) => (
              <div key={i} style={{ fontSize: '12px', fontWeight: 600, color: 'var(--op-ink)', background: '#FFFFFF', padding: '3px 7px', borderRadius: '4px' }}>
                {effect}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontStyle: 'italic' }}>No active effects.</div>
        )}
      </GeoWell>
    </div>
  );
};

const WeatherIcon: React.FC<{ type: WeatherType }> = ({ type }) => {
  let icon = '☀️';
  switch (type) {
    case 'SCORCHED': icon = '🔥'; break;
    case 'MONSOON': icon = '🌧️'; break;
    case 'FOG': icon = '🌫️'; break;
    case 'TAILWIND': icon = '🍃'; break;
    case 'SANDSTORM': icon = '🌪️'; break;
  }
  return <span style={{ fontSize: '13px', marginLeft: '4px' }}>{icon}</span>;
};

const CpSegMeter: React.FC<{ cp: number; maxCp: number }> = ({ cp, maxCp }) => {
  const cells = 10;
  const lit = Math.max(0, Math.min(cells, Math.round((cp / maxCp) * cells)));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '3px' }}>
      {Array.from({ length: cells }).map((_, i) => {
        const isLit = i < lit;
        return (
          <div
            key={i}
            className="geo-chip"
            style={{
              height: '7px',
              background: isLit ? 'var(--acc-blue)' : '#C2CBD9',
              opacity: isLit ? 1 : 0.45,
            }}
          />
        );
      })}
    </div>
  );
};

export const LeftPanel: React.FC = () => {
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
  const maxCp = settings.mutators?.blitzCp ? MUTATOR_CONFIG.BLITZ_CP.MAX_CP : CP_SYSTEM.MAX_CP;

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
    const pTheme = PLAYER_UI_THEME[pid] || PLAYER_UI_THEME[0];
    const casualties = graveyard.filter(u => u.owner === pid);
    const respawnsUsed = playerRespawns[pid] || 0;
    const maxRespawns = getEffectiveMaxRespawns(settings.mutators);
    const respawnsLeft = Math.max(0, maxRespawns - respawnsUsed);
    const inventory = playerInventory[pid] || [];

    let statsLabel = '';
    let statsValue = '';
    if (settings.victoryMode === 'CONQUER') {
      const base = mapData.find(t => t.type === 'BASE' && t.owner === pid);
      statsLabel = 'BASE';
      statsValue = base && base.hp !== undefined ? `${base.hp} HP` : 'DESTROYED';
    } else {
      const count = units.filter(u => u.owner === pid).length;
      statsLabel = 'UNITS';
      statsValue = `${count}`;
    }

    if (isEliminated) {
      return (
        <GeoCard key={pid} style={{ opacity: 0.55 }}>
          <div style={{ padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: pTheme.ink, fontWeight: 800, fontSize: '13px', textDecoration: 'line-through' }}>
              P{pid + 1} (ELIM)
            </span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>OUT</span>
          </div>
        </GeoCard>
      );
    }

    return (
      <GeoCard
        key={pid}
        accentColor={isCurrent ? pTheme.border : undefined}
        onClick={() => {
          if (isCompactMode) setExpandedId(pid);
        }}
        style={{
          opacity: isCurrent ? 1 : isCompactMode && !isExpanded ? 0.72 : 0.9,
          cursor: isCompactMode ? 'pointer' : 'default',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {/* Player Header & Objective Counter */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: `1.5px solid ${pTheme.border}40`,
              paddingBottom: '5px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span className="geo-chip" style={{ width: '9px', height: '9px', background: pTheme.badgeBg }} />
              <span style={{ fontWeight: 900, fontSize: '14px', color: pTheme.ink }}>
                P{pid + 1}
              </span>
              <WeatherIcon type={weather.playerZones[pid]} />
            </div>
            <span
              className="geo-chip"
              style={{
                background: pTheme.badgeBg,
                color: pTheme.badgeText,
                fontSize: '12px',
                fontWeight: 800,
                padding: '2px 7px',
              }}
            >
              {statsLabel}: {statsValue}
            </span>
          </div>

          {/* Gold & CP Recessed Wells */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <GeoWell coreStyle={{ padding: '5px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>GOLD</span>
              <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--acc-amber-ink)' }}>${playerGold[pid]}</span>
            </GeoWell>
            <GeoWell coreStyle={{ padding: '5px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>CP</span>
              <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--acc-blue-ink)' }}>
                {playerCp[pid]}/{maxCp}
              </span>
            </GeoWell>
          </div>

          {isCurrent && <CpSegMeter cp={playerCp[pid] ?? 0} maxCp={maxCp} />}

          {/* Expanded Section: Inventory & Respawn Queue */}
          {isExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', animation: 'fadeIn 0.25s' }}>
              {inventory.length > 0 && (
                <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '6px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 800, marginBottom: '4px' }}>
                    INVENTORY (Click to Use)
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {inventory.map((item, idx) => (
                      <GeoButton
                        key={idx}
                        variant={selectedInventoryItemIndex === idx && isCurrent ? 'mint' : 'default'}
                        onClick={e => {
                          e.stopPropagation();
                          if (isCurrent) selectInventoryItem(idx === selectedInventoryItemIndex ? null : idx);
                        }}
                        disabled={!isCurrent}
                        coreStyle={{ padding: '4px 8px', fontSize: '12px' }}
                      >
                        {item}
                      </GeoButton>
                    ))}
                  </div>
                  {selectedInventoryItemIndex !== null && isCurrent && (
                    <div style={{ fontSize: '12px', color: 'var(--acc-mint-ink)', marginTop: '4px', fontWeight: 700 }}>
                      Click a friendly unit on map to apply.
                    </div>
                  )}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 800, marginBottom: '4px' }}>
                  <span>CASUALTIES</span>
                  <span>{respawnsLeft} LEFT</span>
                </div>

                {casualties.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '110px', overflowY: 'auto' }} className="opgeo-scroll">
                    {casualties.map(unit => {
                      const cost = UNIT_COSTS[unit.type];
                      const canAfford = playerGold[pid] >= cost;
                      const isReady = unit.turnsUntilRespawn === 0;
                      const isSelected = selectedGraveyardUnitId === unit.id;
                      const hasRespawns = respawnsLeft > 0;
                      const canSpawn = isCurrent && isReady && canAfford && hasRespawns;

                      if (canSpawn || isSelected) {
                        return (
                          <GeoButton
                            key={unit.id}
                            variant={isSelected ? 'mint' : 'softBlue'}
                            fullWidth
                            onClick={e => {
                              e.stopPropagation();
                              handleGraveyardSelect(unit.id);
                            }}
                            coreStyle={{ padding: '4px 8px', justifyContent: 'space-between' }}
                          >
                            <span>{UNIT_STATS[unit.type].name.toUpperCase()}</span>
                            <span>${cost}</span>
                          </GeoButton>
                        );
                      }

                      return (
                        <GeoWell
                          key={unit.id}
                          coreStyle={{
                            padding: '4px 8px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '12px',
                            fontWeight: 700,
                            opacity: isCurrent && isReady && !canAfford ? 0.55 : 1,
                          }}
                        >
                          <span style={{ color: pTheme.ink }}>{UNIT_STATS[unit.type].name.toUpperCase()}</span>
                          <span style={{ color: 'var(--op-ink-muted)' }}>
                            {isReady ? `$${cost}` : `${unit.turnsUntilRespawn}t`}
                          </span>
                        </GeoWell>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontStyle: 'italic' }}>
                    No Casualties
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </GeoCard>
    );
  };

  return (
    <div
      className="opgeo-scroll"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: '10px',
        overflowY: 'auto',
        paddingRight: '4px',
        paddingBottom: '4px',
      }}
    >
      {Array.from({ length: playerCount }).map((_, i) => renderPlayerSection(i))}
    </div>
  );
};

const TurnStatusBar: React.FC = () => {
  const totalTurns = useGameStore(state => state.totalTurns);
  const weather = useGameStore(state => state.weather);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const dynamicWeather = useGameStore(state => state.settings.dynamicWeather);
  const mutators = useGameStore(state => state.settings.mutators);
  const activeSeed = useGameStore(state => state.activeSeed);
  const activeMission = useGameStore(state => state.activeMission);
  const matchStats = useGameStore(state => state.matchStats);
  const units = useGameStore(state => state.units);

  const zoneWeather = weather.playerZones[currentPlayer] || 'CLEAR';
  const activeMutatorTags = [
    mutators?.blitzCp ? 'BLITZ CP' : null,
    mutators?.scarcity ? 'SCARCITY' : null,
    mutators?.ironman ? 'IRONMAN' : null,
  ].filter(Boolean) as string[];

  let missionLine: string | null = null;
  if (activeMission) {
    const elapsedRound = Math.max(1, totalTurns - (activeMission.startingRound ?? 0) + 1);
    if (activeMission.surviveTurns) {
      missionLine = `Hold ${elapsedRound}/${activeMission.surviveTurns} Rounds`;
    } else if (activeMission.requiredHeists) {
      missionLine = `Heists ${matchStats[0]?.heists ?? 0}/${activeMission.requiredHeists} • Limit ${activeMission.turnLimit}R (${elapsedRound}R)`;
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
    <GeoCard style={{ flexShrink: 0 }}>
      <div style={{ padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--op-ink)' }}>
            ROUND {totalTurns + 1}
            {activeSeed && (
              <span style={{ color: 'var(--acc-amber-ink)', marginLeft: '6px', fontFamily: 'monospace' }}>
                • {activeSeed}
              </span>
            )}
          </span>
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--acc-blue-ink)' }}>
            {dynamicWeather ? `${zoneWeather} • ${weather.turnsRemaining}t` : 'CLEAR'}
          </span>
        </div>

        {(missionLine || activeMutatorTags.length > 0) && (
          <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {missionLine && (
              <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 800 }}>
                🎯 {activeMission?.title}: {missionLine}
              </div>
            )}
            {activeMutatorTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {activeMutatorTags.map(tag => (
                  <GeoChip key={tag} variant="softAmber" style={{ fontSize: '12px', padding: '1px 6px' }}>
                    {tag}
                  </GeoChip>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </GeoCard>
  );
};

const BankRewardModal: React.FC = () => {
  const bankRewardPending = useGameStore(state => state.bankRewardPending);
  const resolveBankReward = useGameStore(state => state.resolveBankReward);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const mapData = useGameStore(state => state.mapData);
  const mutators = useGameStore(state => state.settings.mutators);

  if (!bankRewardPending || bankRewardPending.playerId !== currentPlayer) return null;
  const bankTile = mapData.find(t => t.id === bankRewardPending.tileId);
  const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(bankTile, mutators);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 24, 33, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        padding: '16px',
      }}
    >
      <GeoCard armed style={{ maxWidth: '420px', width: '100%' }}>
        <div style={{ padding: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 900, color: 'var(--acc-amber-ink)' }}>VAULT BREACHED</div>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: 'var(--op-ink-muted)' }}>
              The heist was successful. Choose your share of the loot.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <GeoButton
              variant="softAmber"
              fullWidth
              onClick={() => resolveBankReward('GOLD')}
              coreStyle={{ padding: '18px 12px', flexDirection: 'column' }}
            >
              <span style={{ fontSize: '22px' }}>💰</span>
              <span style={{ fontSize: '15px', fontWeight: 900 }}>{goldReward} GOLD</span>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Fund drops &amp; respawns</span>
            </GeoButton>

            <GeoButton
              variant="softBlue"
              fullWidth
              onClick={() => resolveBankReward('CP')}
              coreStyle={{ padding: '18px 12px', flexDirection: 'column' }}
            >
              <span style={{ fontSize: '22px' }}>⚡</span>
              <span style={{ fontSize: '15px', fontWeight: 900 }}>{cpReward} CP</span>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Tactical Surge</span>
            </GeoButton>
          </div>
        </div>
      </GeoCard>
    </div>
  );
};

export const RightPanel: React.FC = () => {
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
        notes,
      };
    } else if (validSiegeTile && hoveredTile.id === validSiegeTile && hoveredTile.hp !== undefined) {
      const damage = calculateSiegeDamage(selectedUnit, selectedUnitTile);
      const piercesBase = selectedUnit.type === 'ASSAULTER' && (selectedUnit.rank ?? 0) >= 3;
      combatPreview = {
        title: `P${(hoveredTile.owner ?? 0) + 1} Headquarters`,
        damage,
        hpBefore: hoveredTile.hp,
        hpAfter: Math.max(0, hoveredTile.hp - damage),
        notes: [piercesBase ? 'Ace Siege Pierce: 100% DMG' : 'Base Armor: -20% DMG'],
      };
    } else if (validDemolishTile && hoveredTile.id === validDemolishTile && hoveredTile.hp !== undefined) {
      const damage = calculateDemolishDamage(selectedUnit, selectedUnitTile);
      combatPreview = {
        title: 'Defense Barrier',
        damage,
        hpBefore: hoveredTile.hp,
        hpAfter: Math.max(0, hoveredTile.hp - damage),
        notes: ['Full Structural Damage'],
      };
    }
  }

  const readyUnitCount = units.filter(u => u.owner === currentPlayer && !u.completed).length;
  const sniperCanFire = selectedUnit?.type === 'SNIPER' ? canUnitAttackFromTile(selectedUnit, selectedUnitTile) : true;

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
        knownVisibleTiles: fogOfWar ? visibleTiles : null,
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

  if (bankRewardPending && bankRewardPending.playerId === currentPlayer) {
    return <BankRewardModal />;
  }

  if (placementMode && placementMode.active) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', paddingRight: '4px' }}>
        <GeoCard fill armed style={{ flex: 1 }}>
          <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: '14px' }}>
            <div style={{ fontSize: '16px', fontWeight: 900, color: 'var(--acc-amber-ink)' }}>CONSTRUCTION MODE</div>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--op-ink-muted)' }}>
              Click any highlighted cyan tile on the battlefield to deploy.
            </p>
            <GeoWell style={{ width: '100%' }}>
              <div style={{ fontSize: '13px', fontWeight: 800 }}>
                {SHOP_ITEMS[placementMode.itemKey as keyof typeof SHOP_ITEMS]?.name} (${placementMode.cost})
              </div>
            </GeoWell>
            <GeoButton variant="red" fullWidth onClick={cancelPlacement} coreStyle={{ padding: '10px 14px' }}>
              CANCEL BUILD
            </GeoButton>
          </div>
        </GeoCard>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '8px', paddingRight: '4px' }}>
      <TurnStatusBar />

      {/* INTEL / LOGS CARD */}
      <GeoCard fill armed={Boolean(selectedUnit?.isOverwatching)} style={{ flex: 1, minHeight: 0 }}>
        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', flexShrink: 0 }}>
            <GeoButton
              variant={activeTab === 'INTEL' ? 'blue' : 'default'}
              fullWidth
              onClick={() => setActiveTab('INTEL')}
              coreStyle={{ padding: '6px' }}
            >
              INTEL
            </GeoButton>
            <GeoButton
              variant={activeTab === 'LOG' ? 'blue' : 'default'}
              fullWidth
              onClick={() => setActiveTab('LOG')}
              coreStyle={{ padding: '6px' }}
            >
              LOGS
            </GeoButton>
          </div>

          <div className="opgeo-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '3px' }}>
            {activeTab === 'INTEL' ? (
              <>
                {selectedUnit ? (() => {
                  const rank = selectedUnit.rank ?? 0;
                  const xp = selectedUnit.xp ?? 0;
                  const nextThreshold = rank < 3 ? VETERANCY_CONFIG.XP_THRESHOLDS[rank + 1] : null;
                  const maxHp = getUnitMaxHp(selectedUnit);
                  const baseDmg = getUnitBaseDamage(selectedUnit);
                  const atkCost = getUnitAttackCost(selectedUnit);
                  const uTheme = PLAYER_UI_THEME[selectedUnit.owner] || PLAYER_UI_THEME[0];
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
                        rank >= 3 && selectedUnit.type === 'SNIPER' ? '1 CP Mountain/Dunes Move' : null,
                      ].filter(Boolean).join(' • ');

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', animation: 'fadeIn 0.2s' }}>
                      {/* Unit Identity Header */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          className="geo-chip"
                          style={{
                            width: '36px',
                            height: '36px',
                            background: uTheme.badgeBg,
                            color: uTheme.badgeText,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 900,
                            fontSize: '13px',
                            flexShrink: 0,
                          }}
                        >
                          {UNIT_STATS[selectedUnit.type].name.substring(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                            <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--op-ink)' }}>
                              {UNIT_STATS[selectedUnit.type].name.toUpperCase()}
                            </span>
                            <GeoChip variant={rank > 0 ? 'softAmber' : 'default'} style={{ padding: '2px 6px' }}>
                              {rank > 0 ? VETERANCY_CONFIG.RANK_LABELS[rank] : 'RECRUIT'}
                            </GeoChip>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                            <span>{selectedUnit.owner === currentPlayer ? 'Your Unit' : `P${selectedUnit.owner + 1} Unit`}</span>
                            <span>{nextThreshold !== null ? `XP ${xp}/${nextThreshold}` : `MAX (${xp})`} • {selectedUnit.kills ?? 0}K</span>
                          </div>
                        </div>
                      </div>

                      {rankPerkSummary && (
                        <GeoChip variant="softAmber" style={{ display: 'block', padding: '5px 8px', lineHeight: 1.35 }}>
                          {rankPerkSummary}
                        </GeoChip>
                      )}

                      {/* 2x2 Stat Wells */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                        <GeoWell coreStyle={{ padding: '5px 8px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>HP</span>
                          <span style={{ fontSize: '12px', fontWeight: 900, color: selectedUnit.hp < 5 ? 'var(--acc-red-ink)' : 'var(--op-ink)' }}>
                            {selectedUnit.hp}/{maxHp}
                          </span>
                        </GeoWell>
                        <GeoWell coreStyle={{ padding: '5px 8px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>AMMO</span>
                          <span style={{ fontSize: '12px', fontWeight: 900, color: selectedUnit.ammo === 0 ? 'var(--acc-red-ink)' : 'var(--op-ink)' }}>
                            {selectedUnit.ammo}/{selectedUnit.maxAmmo}
                          </span>
                        </GeoWell>
                        <GeoWell coreStyle={{ padding: '5px 8px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>DMG</span>
                          <span style={{ fontSize: '12px', fontWeight: 900 }}>{baseDmg}</span>
                        </GeoWell>
                        <GeoWell coreStyle={{ padding: '5px 8px', display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>SHOT</span>
                          <span style={{ fontSize: '12px', fontWeight: 900 }}>{atkCost} CP</span>
                        </GeoWell>
                      </div>

                      {selectedUnit.type === 'SNIPER' && selectedUnit.owner === currentPlayer && (
                        <GeoChip variant={sniperCanFire ? 'softMint' : 'softAmber'} style={{ display: 'block', padding: '5px 8px' }}>
                          {sniperCanFire ? '🎯 High-Ground Firing Ready' : '⚠️ Move to Mountain, Dunes, or Owned Building to Fire'}
                        </GeoChip>
                      )}

                      {selectedUnit.owner === currentPlayer && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {selectedUnit.isOverwatching && (
                            <GeoChip variant="amber" style={{ display: 'block', padding: '7px 9px', fontWeight: 900 }}>
                              🎯 OVERWATCH ARMED ({OVERWATCH_STATS[selectedUnit.type].damage} DMG • +{OVERWATCH_STATS[selectedUnit.type].refund} CP refund)
                            </GeoChip>
                          )}

                          {!selectedUnit.completed && !selectedUnit.isOverwatching && (() => {
                            const owCfg = OVERWATCH_STATS[selectedUnit.type];
                            const canOw = canUnitEnterOverwatch(selectedUnit, selectedUnitTile, playerCp[currentPlayer] ?? 0);
                            return (
                              <GeoButton
                                variant={canOw ? 'softAmber' : 'default'}
                                fullWidth
                                disabled={!canOw}
                                onClick={enterOverwatch}
                                coreStyle={{ padding: '8px 10px' }}
                              >
                                SET OVERWATCH ({owCfg.cost} CP • {owCfg.damage} DMG) • O
                              </GeoButton>
                            );
                          })()}

                          {selectedUnit.ammo < selectedUnit.maxAmmo && !selectedUnit.completed && (
                            <GeoButton
                              variant="softBlue"
                              fullWidth
                              disabled={(playerCp[currentPlayer] ?? 0) < CP_SYSTEM.RELOAD_COST}
                              onClick={reloadUnit}
                              coreStyle={{ padding: '8px 10px' }}
                            >
                              FIELD RELOAD (+{Math.max(1, Math.ceil(selectedUnit.maxAmmo / 2))} AMMO • {CP_SYSTEM.RELOAD_COST} CP)
                            </GeoButton>
                          )}

                          {validSecureTile && (
                            <GeoButton variant="amber" fullWidth onClick={secureBuilding} coreStyle={{ padding: '8px 10px' }}>
                              SECURE BUILDING (4 CP)
                            </GeoButton>
                          )}
                          {validHeistTile && (
                            <GeoButton variant="amber" fullWidth onClick={heistBank} coreStyle={{ padding: '8px 10px' }}>
                              HEIST BANK (4 CP)
                            </GeoButton>
                          )}
                          {validSiegeTile && (
                            <GeoButton variant="red" fullWidth onClick={siegeBase} coreStyle={{ padding: '8px 10px' }}>
                              SIEGE BASE
                            </GeoButton>
                          )}
                          {validDemolishTile && (
                            <GeoButton variant="red" fullWidth onClick={demolishBarrier} coreStyle={{ padding: '8px 10px' }}>
                              DEMOLISH BARRIER
                            </GeoButton>
                          )}
                          {validLootTile && (
                            <GeoButton variant="mint" fullWidth onClick={lootSupply} coreStyle={{ padding: '8px 10px' }}>
                              RETRIEVE SUPPLY (4 CP)
                            </GeoButton>
                          )}
                        </div>
                      )}

                      {combatPreview && (
                        <GeoChip variant="softRed" style={{ display: 'block', padding: '8px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, marginBottom: '3px' }}>
                            <span>TARGET PREVIEW</span>
                            {combatPreview.hpAfter === 0 && (
                              <span className="geo-chip" style={{ background: 'var(--acc-red)', color: '#fff', padding: '1px 5px' }}>LETHAL</span>
                            )}
                          </div>
                          <div style={{ fontWeight: 900 }}>{combatPreview.title}</div>
                          <div>
                            DMG: <strong>-{combatPreview.damage}</strong> • HP: {combatPreview.hpBefore} → <strong>{combatPreview.hpAfter}</strong>
                          </div>
                          {combatPreview.notes.map((n, idx) => (
                            <div key={idx} style={{ fontWeight: 600 }}>• {n}</div>
                          ))}
                        </GeoChip>
                      )}

                      {movePreviewCost !== null && hoveredTile && !combatPreview && (
                        <GeoChip variant="softBlue" style={{ display: 'block', padding: '8px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, marginBottom: '2px' }}>
                            <span>MOVE TO ({hoveredTile.x},{hoveredTile.y})</span>
                            <span>{movePreviewCost} CP</span>
                          </div>
                          {movePreviewWarnings.map((w, idx) => (
                            <div key={idx} style={{ fontWeight: 600 }}>• {w}</div>
                          ))}
                        </GeoChip>
                      )}
                    </div>
                  );
                })() : selectedTile ? (() => {
                  const tileUnit = units.find(
                    u => u.tileId === selectedTile.id && (!fogOfWar || u.owner === currentPlayer || visibleTiles.has(u.tileId))
                  );
                  const tuTheme = tileUnit ? PLAYER_UI_THEME[tileUnit.owner] : null;
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {tileUnit && tuTheme && (
                        <GeoWell coreStyle={{ padding: '8px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '12px', fontWeight: 900, color: tuTheme.ink }}>
                              P{tileUnit.owner + 1} {UNIT_STATS[tileUnit.type].name.toUpperCase()}
                            </span>
                            <span style={{ fontSize: '12px', fontWeight: 800 }}>
                              HP {tileUnit.hp}/{getUnitMaxHp(tileUnit)}
                            </span>
                          </div>
                          {tileUnit.isOverwatching && (
                            <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--acc-amber-ink)', marginTop: '3px' }}>
                              🎯 OVERWATCH ACTIVE ({OVERWATCH_STATS[tileUnit.type].damage} DMG reaction)
                            </div>
                          )}
                        </GeoWell>
                      )}
                      <BuildingInfoPanel tile={selectedTile} />
                    </div>
                  );
                })() : (
                  <div style={{ color: 'var(--op-ink-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: '24px', fontSize: '12px' }}>
                    Select a unit or tile for tactical analysis.
                  </div>
                )}
              </>
            ) : (
              <LogView />
            )}
          </div>
        </div>
      </GeoCard>

      {/* FIELD SHOP (Compact 2x2 Grid Preserves Max Space for Intel) */}
      {isMyTurn && (
        <GeoCard style={{ flexShrink: 0 }}>
          <div style={{ padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.5px' }}>
              FIELD SHOP (REQUISITION)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              {Object.entries(SHOP_ITEMS).map(([key, item]) => {
                const canBuy = (playerGold[currentPlayer] ?? 0) >= item.cost;
                return (
                  <GeoButton
                    key={key}
                    onClick={() => buyShopItem(key)}
                    disabled={!canBuy}
                    fullWidth
                    title={item.type === 'CONSUMABLE' ? 'Delivered via Drop Pod near base' : 'Select placement tile'}
                    coreStyle={{ padding: '6px 8px', justifyContent: 'space-between' }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name.replace('Deploy ', '').replace(' Drop', '').replace(' (Full Heal)', '')}
                    </span>
                    <span style={{ color: 'var(--acc-amber-ink)', fontFamily: 'monospace' }}>${item.cost}</span>
                  </GeoButton>
                );
              })}
            </div>
          </div>
        </GeoCard>
      )}

      {/* NEXT READY UNIT + END TURN */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', flexShrink: 0 }}>
        {isMyTurn && readyUnitCount > 0 && (
          <GeoButton variant="softBlue" fullWidth onClick={selectNextReadyUnit} coreStyle={{ padding: '8px 10px' }}>
            NEXT READY UNIT ({readyUnitCount}) • TAB
          </GeoButton>
        )}

        <GeoButton
          variant={isMyTurn ? 'mint' : 'default'}
          fullWidth
          disabled={!isMyTurn}
          onClick={endTurn}
          coreStyle={{ padding: '12px 14px', fontSize: '15px', fontWeight: 900, letterSpacing: '1px' }}
        >
          {isMyTurn ? 'END TURN →' : 'ENEMY TURN...'}
        </GeoButton>
      </div>
    </div>
  );
};

export const WinnerOverlay: React.FC = () => {
  const winner = useGameStore(state => state.winner);
  const resetGame = useGameStore(state => state.resetGame);
  const retryCurrentMatch = useGameStore(state => state.retryCurrentMatch);
  const victoryMode = useGameStore(state => state.settings.victoryMode);
  const matchSummary = useGameStore(state => state.matchSummary);
  const activeSeed = useGameStore(state => state.activeSeed);
  const activeMission = useGameStore(state => state.activeMission);
  const [copiedSeed, setCopiedSeed] = useState(false);

  if (winner === null) return null;

  const gradeColors: Record<string, { bg: string; ink: string }> = {
    S: { bg: '#FFF0D4', ink: '#994D00' },
    A: { bg: '#D3F9E8', ink: '#046C3E' },
    B: { bg: '#DCE6FF', ink: '#1344C4' },
    C: { bg: '#FFE1DC', ink: '#B42318' },
    D: { bg: '#FFE1DC', ink: '#B42318' },
  };
  const winnerStats = matchSummary?.playerStats?.[winner];
  const seedValue = matchSummary?.seed || activeSeed;
  const pTheme = PLAYER_UI_THEME[winner] || PLAYER_UI_THEME[0];

  const handleCopySeed = () => {
    if (!seedValue) return;
    navigator.clipboard?.writeText(seedValue).then(() => {
      setCopiedSeed(true);
      setTimeout(() => setCopiedSeed(false), 1800);
    }).catch(() => {});
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 24, 33, 0.72)',
        backdropFilter: 'blur(8px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <GeoCard armed style={{ maxWidth: '520px', width: '100%', animation: 'fadeIn 0.3s ease-out' }}>
        <div style={{ padding: '24px 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ fontSize: '40px', marginBottom: '4px' }}>
              {activeMission ? (winner === 0 ? '🎖️' : '💀') : '🏆'}
            </div>
            <h1 style={{ color: pTheme.ink, fontSize: '28px', fontWeight: 900, margin: '0 0 4px 0' }}>
              {activeMission
                ? winner === 0 ? 'OPERATION COMPLETE!' : 'OPERATION FAILED'
                : `PLAYER ${winner + 1} WINS!`}
            </h1>
            <p style={{ color: 'var(--op-ink-muted)', fontSize: '13px', margin: 0, fontWeight: 600 }}>
              {activeMission
                ? `${activeMission.title} • ${activeMission.subtitle}`
                : victoryMode === 'CONQUER' ? 'Enemy Headquarters Destroyed' : 'All Enemy Units Eliminated'}
            </p>
          </div>

          {matchSummary?.challengeMedal && winner === 0 && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <GeoChip variant="softAmber" style={{ padding: '5px 12px' }}>
                🏅 MEDAL EARNED: {matchSummary.challengeMedal}-RANK
              </GeoChip>
            </div>
          )}

          {matchSummary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
              <GeoWell coreStyle={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 800 }}>AFTER-ACTION EFFICIENCY</div>
                  <div style={{ fontSize: '17px', fontWeight: 900, color: 'var(--op-ink)', marginTop: '2px' }}>
                    {matchSummary.score} / 100 PTS
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', marginTop: '2px' }}>
                    Completed in <strong>{matchSummary.rounds}</strong> Rounds (Par {matchSummary.parRounds})
                  </div>
                </div>
                <div
                  className="geo-chip"
                  style={{
                    width: '56px',
                    height: '56px',
                    background: gradeColors[matchSummary.grade]?.bg || '#DCE6FF',
                    color: gradeColors[matchSummary.grade]?.ink || 'var(--acc-blue-ink)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontSize: '24px', fontWeight: 900, lineHeight: 1 }}>{matchSummary.grade}</span>
                  <span style={{ fontSize: '12px', fontWeight: 800 }}>GRADE</span>
                </div>
              </GeoWell>

              {winnerStats && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {[
                    ['KILLS', winnerStats.kills, 'var(--op-ink)'],
                    ['LOSSES', winnerStats.unitsLost, winnerStats.unitsLost === 0 ? 'var(--acc-mint-ink)' : 'var(--acc-red-ink)'],
                    ['DAMAGE', winnerStats.damageDealt, 'var(--op-ink)'],
                    ['HEISTS', winnerStats.heists, 'var(--acc-amber-ink)'],
                    ['SECURED', winnerStats.buildingsSecured, 'var(--acc-blue-ink)'],
                    ['ACES', winnerStats.acesPromoted, 'var(--acc-amber-ink)'],
                  ].map(([lbl, val, col]) => (
                    <GeoWell key={String(lbl)} coreStyle={{ padding: '7px 9px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>{lbl}</div>
                      <div style={{ fontSize: '15px', fontWeight: 900, color: String(col) }}>{val}</div>
                    </GeoWell>
                  ))}
                </div>
              )}

              {matchSummary.mvp && (
                <GeoWell coreStyle={{ padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--acc-amber-ink)', fontWeight: 900 }}>MATCH MVP</div>
                    <div style={{ fontSize: '14px', fontWeight: 900 }}>
                      {matchSummary.mvp.unitName} {matchSummary.mvp.rank > 0 ? VETERANCY_CONFIG.RANK_LABELS[matchSummary.mvp.rank] : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '12px', fontWeight: 800 }}>
                    <div>{matchSummary.mvp.kills} Kills</div>
                    <div style={{ color: 'var(--op-ink-muted)' }}>{matchSummary.mvp.damageDealt} DMG</div>
                  </div>
                </GeoWell>
              )}

              {seedValue && (
                <GeoWell coreStyle={{ padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>
                    SECTOR SEED: <strong style={{ color: 'var(--acc-amber-ink)', fontFamily: 'monospace' }}>{seedValue}</strong>
                  </span>
                  <GeoButton onClick={handleCopySeed} coreStyle={{ padding: '4px 10px' }}>
                    {copiedSeed ? 'COPIED' : 'COPY SEED'}
                  </GeoButton>
                </GeoWell>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            {seedValue && (
              <GeoButton variant="blue" fullWidth onClick={retryCurrentMatch} coreStyle={{ padding: '12px 14px' }}>
                {activeMission ? 'RETRY OPERATION' : 'RETRY THIS SEED'}
              </GeoButton>
            )}
            <GeoButton variant="mint" fullWidth onClick={resetGame} coreStyle={{ padding: '12px 14px' }}>
              RETURN TO BASE
            </GeoButton>
          </div>
        </div>
      </GeoCard>
    </div>
  );
};
