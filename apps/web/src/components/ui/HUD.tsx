import React, { useState, useEffect, useMemo } from 'react';
import { isUnitVisible } from '@tactical/engine';
import { useGameStore, viewerSeat } from '../../store/useGameStore';
import { useOnline } from '../../net/useOnline';
import { useCopyState } from '../../hooks/useCopyState';
import { getHoverMoveResolution, computeUnitAttackPreview, getHoveredEnemyBlocker } from '../../core/hoverMovePreview';
import {
  UNIT_STATS,
  TERRAIN_COSTS,
  TERRAIN_DEFENSE,
  CP_SYSTEM,
  GOLD_SETTINGS,
  LAND_MINE_STATS,
  UNIT_COSTS,
  SHOP_ITEMS,
  BUILDING_STATS,
  BARRIER_STATS,
  BANK_STATS,
  BASE_STATS,
  VETERANCY_CONFIG,
  OVERWATCH_STATS,
  MUTATOR_CONFIG,
} from '@tactical/engine/constants/Config';
import { Tile, Unit, WeatherType, LogEntry, MatchSummary } from '@tactical/engine/types';
import { getManhattanDistance, getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import {
  calculateSiegeDamage,
  calculateDemolishDamage,
  canUnitAttackFromTile,
  canUnitEnterOverwatch,
  getEffectiveBankRewards,
  getEffectiveMaxRespawns,
  getUnitMaxHp,
  getUnitBaseDamage,
  getUnitAttackCost,
} from '@tactical/engine/rules/CombatRules';
import { GeoButton, GeoCard, GeoChip, GeoWell, PLAYER_UI_THEME, playerDisplayName } from './GeoPrimitives';

/**
 * How loudly a log line is shown: the turn passing is a divider, routine moves and purchases
 * are quiet text, and what changes the match (kills, captures, heists) stands out.
 */
const KEY_EVENT = /kill|eliminat|promoted|heist|secured|breached|destroyed|melted|mission|bounty|suppressed/i;
const ROUTINE_EVENT = /^(purchased|used|set overwatch|redeployed|built)|field reloaded|retrieved|refunded/i;
const logWeight = (log: LogEntry): 'turn' | 'routine' | 'normal' | 'key' => {
  if (log.message === 'Ended Turn') return 'turn';
  if (KEY_EVENT.test(log.message)) return 'key';
  if (log.type === 'MOVE' || ROUTINE_EVENT.test(log.message)) return 'routine';
  return 'normal';
};

const LogView: React.FC = React.memo(() => {
  const gameLog = useGameStore(state => state.gameLog);
  const viewer = useGameStore(viewerSeat);
  const mode = useGameStore(state => state.mode);
  const playerNames = useGameStore(state => state.settings.playerNames);
  const seats = useOnline(state => state.view?.seats);

  const groupedLogs: Record<number, LogEntry[]> = {};
  gameLog.forEach(log => {
    if (log.playerId !== viewer && log.message.startsWith('Planted Land Mine')) return;
    if (!groupedLogs[log.round]) groupedLogs[log.round] = [];
    groupedLogs[log.round].push(log);
  });

  const rounds = Object.keys(groupedLogs).map(k => parseInt(k, 10)).sort((a, b) => b - a);

  if (rounds.length === 0) {
    return (
      <div style={{ color: 'var(--op-ink-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: '20px', fontSize: '12px' }}>
        Nothing yet. Moves, shots and captures show up here.
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {groupedLogs[round].map(log => {
              const isEnv = log.playerId === -1;
              const pTheme = PLAYER_UI_THEME[log.playerId];
              const color = isEnv ? '#475569' : (pTheme?.ink || 'var(--op-ink)');
              const stripe = isEnv ? '#64748B' : (pTheme?.badgeBg || '#1D5EFF');
              const who = isEnv ? 'Map' : playerDisplayName(log.playerId, playerNames, mode === 'ONLINE' ? seats?.[log.playerId]?.name : undefined);
              const weight = logWeight(log);

              if (weight === 'turn') {
                return (
                  <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 700, color: 'var(--op-ink-muted)', margin: '2px 0' }}>
                    <span style={{ flex: 1, height: '1px', background: 'var(--op-line)' }} />
                    <span style={{ color }}>{who}</span> ended their turn
                    <span style={{ flex: 1, height: '1px', background: 'var(--op-line)' }} />
                  </div>
                );
              }
              if (weight === 'routine') {
                return (
                  <div key={log.id} style={{ display: 'flex', gap: '6px', padding: '1px 4px 1px 2px', fontSize: '12px', fontWeight: 600, color: 'var(--op-ink-muted)' }}>
                    <span style={{ fontWeight: 800, color, flexShrink: 0, minWidth: '22px' }}>{who}</span>
                    <span>{log.message}</span>
                  </div>
                );
              }
              const key = weight === 'key';
              return (
                <GeoWell key={log.id} coreStyle={{ padding: '0px', display: 'flex', alignItems: 'stretch', ...(key ? { background: `${stripe}1F` } : {}) }}>
                  <div style={{ width: key ? '6px' : '4px', background: stripe, flexShrink: 0 }} />
                  <div style={{ padding: key ? '7px 8px' : '5px 8px', flex: 1, fontSize: key ? '13px' : '12px', fontWeight: key ? 800 : 600, color }}>
                    <span style={{ fontWeight: 900, marginRight: '6px' }}>{who}</span>
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
});

const BuildingInfoPanel: React.FC<{ tile: Tile }> = React.memo(({ tile }) => {
  const weatherState = useGameStore(state => state.weather);
  const victoryMode = useGameStore(state => state.settings.victoryMode);
  const localNames = useGameStore(state => state.settings.playerNames);
  const online = useGameStore(state => state.mode === 'ONLINE');
  const onlineSeats = useOnline(state => state.view?.seats);
  const ownerLabel = (owner: number | null | undefined) =>
    owner === null || owner === undefined
      ? 'NEUTRAL'
      : playerDisplayName(owner, localNames, online ? onlineSeats?.[owner]?.name : undefined).toUpperCase();

  let name: string = tile.type;
  let ownerColor = 'var(--op-ink-muted)';
  let ownerName = 'NEUTRAL';
  const stats: { label: string; value: string }[] = [];

  if (tile.type === 'BUILDING' && tile.subType) {
    const config = BUILDING_STATS[tile.subType];
    name = config.name.toUpperCase();
    if (tile.owner !== null && tile.owner !== undefined) {
      ownerColor = PLAYER_UI_THEME[tile.owner]?.ink || 'var(--op-ink)';
      ownerName = ownerLabel(tile.owner);
    }
    stats.push({ label: 'DEFENSE', value: `+${Math.round(config.defense * 100)}%` });
    stats.push({ label: 'RANGE', value: `+${config.rangeBonus}` });
    stats.push({ label: 'DMG', value: `x${config.damageBonus}` });
    stats.push({ label: 'INCOME', value: `+${GOLD_SETTINGS.BUILDING_INCOME}€/t` });
  } else if (tile.type === 'BANK') {
    name = 'BANK VAULT';
    const hacked = (tile.hackProgress || 0) >= 100;
    ownerName = hacked ? 'LOOTED' : 'SECURE';
    ownerColor = hacked ? '#475569' : 'var(--acc-amber-ink)';
  } else if (tile.type === 'BASE') {
    name = 'HEADQUARTERS';
    if (tile.owner !== null && tile.owner !== undefined) {
      ownerColor = PLAYER_UI_THEME[tile.owner]?.ink || 'var(--op-ink)';
      ownerName = `${ownerLabel(tile.owner)} BASE`;
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
        if (tile.type === 'PLAINS' || tile.type === 'SAND') weatherEffects.push('2x Move Cost (Rank 2+ Scout immune)');
        break;
      case 'MONSOON':
        weatherLabel = '🌧️ MONSOON';
        weatherColor = '#1344C4';
        if (tile.type === 'PLAINS') weatherEffects.push('Mud: 2x Move Cost (Rank 2+ Scout immune)');
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
        if (tile.type === 'PLAINS') weatherEffects.push('0.5x Move Cost (Scout 0.5, Heavy 1)');
        weatherEffects.push('Unit Range: +1');
        break;
      case 'SANDSTORM':
        weatherLabel = '🌪️ SANDSTORM';
        weatherColor = '#8D5B1C';
        weatherEffects.push('Vision Max: 3');
        if (tile.type === 'SAND') weatherEffects.push('2x Sand Move Cost');
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
});

const WeatherIcon: React.FC<{ type: WeatherType; zoneNum?: number }> = ({ type, zoneNum }) => {
  let icon = '☀️';
  switch (type) {
    case 'SCORCHED': icon = '🔥'; break;
    case 'MONSOON': icon = '🌧️'; break;
    case 'FOG': icon = '🌫️'; break;
    case 'TAILWIND': icon = '🍃'; break;
    case 'SANDSTORM': icon = '🌪️'; break;
  }
  return (
    <span
      title={zoneNum !== undefined ? `Zone ${zoneNum} Weather: ${type || 'CLEAR'}` : `Weather: ${type || 'CLEAR'}`}
      style={{ fontSize: '13px', marginLeft: '4px' }}
    >
      {icon}
    </span>
  );
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

export const LeftPanel: React.FC = React.memo(() => {
  // Online: the players' names, beside their colours
  const online = useGameStore(state => state.mode === 'ONLINE');
  const mySeat = useGameStore(state => state.mySeat);
  const onlineSeats = useOnline(state => state.view?.seats);
  const playerNames = useGameStore(state => state.settings.playerNames);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const playerCount = useGameStore(state => state.settings.playerCount);
  const playerCp = useGameStore(state => state.playerCp);
  const playerGold = useGameStore(state => state.playerGold);
  const playerRespawns = useGameStore(state => state.playerRespawns);
  const playerStatus = useGameStore(state => state.playerStatus);
  const playerInventory = useGameStore(state => state.playerInventory);
  const handleGraveyardSelect = useGameStore(state => state.handleGraveyardSelect);
  const selectedGraveyardUnitId = useGameStore(state => state.selectedGraveyardUnitId);
  const selectInventoryItem = useGameStore(state => state.selectInventoryItem);
  const selectedInventoryItemIndex = useGameStore(state => state.selectedInventoryItemIndex);
  const graveyard = useGameStore(state => state.graveyard);
  const weather = useGameStore(state => state.weather);
  const settings = useGameStore(state => state.settings);
  const mapData = useGameStore(state => state.mapData);
  const units = useGameStore(state => state.units);
  const isAiTurn = useGameStore(state => state.isAiTurn);
  const winner = useGameStore(state => state.winner);
  const buyShopItem = useGameStore(state => state.buyShopItem);
  const placementMode = useGameStore(state => state.placementMode);
  const cancelPlacement = useGameStore(state => state.cancelPlacement);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const maxCp = settings.mutators?.blitzCp ? MUTATOR_CONFIG.BLITZ_CP.MAX_CP : CP_SYSTEM.MAX_CP;
  const isMyTurn = !isAiTurn && winner === null;

  useEffect(() => {
    if (playerCount > 4) {
      setExpandedId(currentPlayer);
    } else {
      setExpandedId(null);
    }
  }, [currentPlayer, playerCount]);

  const casualtiesByOwner = useMemo(() => {
    const grouped = new Map<number, typeof graveyard>();
    for (const dead of graveyard) {
      let list = grouped.get(dead.owner);
      if (!list) {
        list = [];
        grouped.set(dead.owner, list);
      }
      list.push(dead);
    }
    return grouped;
  }, [graveyard]);

  const baseByOwner = useMemo(() => {
    const map = new Map<number, Tile>();
    if (settings.victoryMode !== 'CONQUER') return map;
    for (const t of mapData) {
      if (t.type === 'BASE' && t.owner !== undefined && t.owner !== null) map.set(t.owner, t);
    }
    return map;
  }, [mapData, settings.victoryMode]);

  const unitCountsByOwner = useMemo(() => {
    const counts = new Map<number, number>();
    if (settings.victoryMode === 'CONQUER') return counts;
    for (const u of units) counts.set(u.owner, (counts.get(u.owner) ?? 0) + 1);
    return counts;
  }, [units, settings.victoryMode]);

  const renderPlayerSection = (pid: number) => {
    const isCompactMode = playerCount > 4;
    const isExpanded = !isCompactMode || expandedId === pid;

    const isCurrent = currentPlayer === pid;
    const isEliminated = playerStatus[pid] === 'ELIMINATED';
    const pTheme = PLAYER_UI_THEME[pid] || PLAYER_UI_THEME[0];
    const casualties = casualtiesByOwner.get(pid) ?? [];
    const respawnsUsed = playerRespawns[pid] || 0;
    const maxRespawns = getEffectiveMaxRespawns(settings.mutators);
    const respawnsLeft = Math.max(0, maxRespawns - respawnsUsed);
    const inventory = playerInventory[pid] || [];

    let statsLabel = '';
    let statsValue = '';
    if (settings.victoryMode === 'CONQUER') {
      const base = baseByOwner.get(pid);
      statsLabel = 'BASE';
      statsValue = base && base.hp !== undefined ? `${base.hp} HP` : 'DESTROYED';
    } else {
      statsLabel = 'UNITS';
      statsValue = `${unitCountsByOwner.get(pid) ?? 0}`;
    }

    if (isEliminated) {
      return (
        <GeoCard key={pid} style={{ opacity: 0.55, flexShrink: 0 }}>
          <div style={{ padding: '7px 11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: pTheme.ink, fontWeight: 800, fontSize: '13px', textDecoration: 'line-through' }}>
              {playerDisplayName(pid, playerNames, online ? onlineSeats?.[pid]?.name : undefined)} (P{pid + 1} • ELIM)
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
          opacity: isCurrent ? 1 : isCompactMode && !isExpanded ? 0.72 : 0.92,
          cursor: isCompactMode ? 'pointer' : 'default',
          flexShrink: 0,
        }}
      >
        <div style={{ padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Player Header & Objective Counter */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: `1.5px solid ${pTheme.border}40`,
              paddingBottom: '4px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
              <span className="geo-chip" style={{ width: '9px', height: '9px', background: pTheme.badgeBg, flexShrink: 0 }} />
              <span style={{ fontWeight: 900, fontSize: '14px', color: pTheme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {playerDisplayName(pid, playerNames, online ? onlineSeats?.[pid]?.name : undefined)}
              </span>
              <span style={{ fontWeight: 800, fontSize: '11px', color: 'var(--op-ink-muted)', flexShrink: 0 }}>
                P{pid + 1}{online && pid === mySeat ? ' • YOU' : ''}{isCurrent ? ' • TURN' : ''}
              </span>
              <WeatherIcon type={weather.playerZones[pid] || 'CLEAR'} zoneNum={pid + 1} />
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

          {/* Euros & CP Recessed Wells */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <GeoWell coreStyle={{ padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>EUROS</span>
              <span style={{ fontSize: '13px', fontWeight: 900, color: 'var(--acc-amber-ink)' }}>€{playerGold[pid]}</span>
            </GeoWell>
            <GeoWell coreStyle={{ padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '5px' }}>
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
                        {item === 'FIRST_AID' ? 'FIRST AID' : item}
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

              {casualties.length > 0 ? (
                <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '5px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 800, marginBottom: '4px' }}>
                    <span>CASUALTIES</span>
                    <span>{respawnsLeft} LEFT</span>
                  </div>

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
                            <span>€{cost}</span>
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
                            {isReady ? `€${cost}` : `${unit.turnsUntilRespawn}t`}
                          </span>
                        </GeoWell>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    borderTop: '1px solid var(--op-line)',
                    paddingTop: '5px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                    color: 'var(--op-ink-muted)',
                    fontWeight: 700,
                  }}
                >
                  <span>CASUALTIES • Clear</span>
                  <span style={{ fontWeight: 800 }}>{respawnsLeft} LEFT</span>
                </div>
              )}
            </div>
          )}
        </div>
      </GeoCard>
    );
  };

  const activeBuyerTheme = PLAYER_UI_THEME[currentPlayer] || PLAYER_UI_THEME[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px' }}>
      {/* Scrollable Faction Roster Stack (2P–6P) */}
      <div
        className="opgeo-scroll"
        style={{
          flex: '0 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          overflowY: 'auto',
          paddingRight: '4px',
          paddingBottom: '2px',
        }}
      >
        {Array.from({ length: playerCount }).map((_, i) => renderPlayerSection(i))}
      </div>

      {/* Pinned Left-Bottom Economy Panel: FIELD SHOP (Cursor-Zone Dock Layout) */}
      <GeoCard armed={Boolean(placementMode?.active)} style={{ flexShrink: 0, marginRight: '4px' }}>
        <div style={{ padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.5px' }}>
              FIELD SHOP
            </span>
            {isMyTurn ? (
              <span
                className="geo-chip"
                style={{
                  background: activeBuyerTheme.badgeBg,
                  color: activeBuyerTheme.badgeText,
                  fontSize: '12px',
                  fontWeight: 800,
                  padding: '2px 7px',
                }}
              >
                {playerDisplayName(currentPlayer, playerNames, online ? onlineSeats?.[currentPlayer]?.name : undefined).toUpperCase()} • €{playerGold[currentPlayer] ?? 0}
              </span>
            ) : (
              <GeoChip variant="default" style={{ fontSize: '12px', padding: '2px 7px' }}>
                {online ? 'NOT YOUR TURN' : 'AI TURN'}
              </GeoChip>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {Object.entries(SHOP_ITEMS).map(([key, item]) => {
              const canBuy = isMyTurn && (playerGold[currentPlayer] ?? 0) >= item.cost;
              const isPlacingThis = Boolean(placementMode?.active && placementMode.itemKey === key);
              return (
                <GeoButton
                  key={key}
                  variant={isPlacingThis ? 'amber' : 'default'}
                  onClick={() => buyShopItem(key)}
                  disabled={!canBuy}
                  fullWidth
                  title={
                    item.type === 'CONSUMABLE'
                      ? `${item.name} (€${item.cost}) — Pick drop zone vs AI; random drop near HQ in Multiplayer`
                      : key === 'LAND_MINE'
                        ? `Land Mine (€${item.cost}) — Hidden to enemies (${LAND_MINE_STATS.DAMAGE} DMG + stops move). Restricted within ${LAND_MINE_STATS.ENEMY_HQ_EXCLUSION_RADIUS} tiles of enemy HQ.`
                        : key === 'BARRIER'
                          ? `Deploy Barrier (x3) (€${item.cost}) — Click up to ${BARRIER_STATS.BUILD_COUNT} tiles to build ${BARRIER_STATS.HP} HP waist-high cover.`
                          : `${item.name} (€${item.cost}) — Select placement tile on map`
                  }
                  coreStyle={{ padding: '6px 8px', justifyContent: 'space-between' }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.name.replace('Deploy ', '').replace(' Drop', '').replace(' Kit (50% Heal)', '').replace(' (Full Heal)', '').replace(' (x3)', ' x3')}
                  </span>
                  <span style={{ color: isPlacingThis ? '#1C1200' : 'var(--acc-amber-ink)', fontFamily: 'monospace' }}>
                    €{item.cost}
                  </span>
                </GeoButton>
              );
            })}
          </div>

          {placementMode && placementMode.active && isMyTurn && (
            <GeoButton variant="red" fullWidth onClick={cancelPlacement} coreStyle={{ padding: '6px 10px' }}>
              CANCEL BUILD
            </GeoButton>
          )}
        </div>
      </GeoCard>
    </div>
  );
});

const TurnStatusBar: React.FC = React.memo(() => {
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
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--acc-blue-ink)', display: 'inline-flex', alignItems: 'center' }} title="Your home zone weather (each player zone has its own weather)">
            <WeatherIcon type={dynamicWeather ? zoneWeather : 'CLEAR'} />
            <span style={{ marginLeft: '4px' }}>
              {dynamicWeather ? `Z${currentPlayer + 1} ${zoneWeather} • ${weather.turnsRemaining}t` : 'CLEAR'}
            </span>
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
});

/** Shown over everything (it renders fixed), so it's mounted once at the app level. */
export const BankRewardModal: React.FC = () => {
  const bankRewardPending = useGameStore(state => state.bankRewardPending);
  const resolveBankReward = useGameStore(state => state.resolveBankReward);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const mapData = useGameStore(state => state.mapData);
  const gridSize = useGameStore(state => state.gridSize);
  const mutators = useGameStore(state => state.settings.mutators);

  if (!bankRewardPending || bankRewardPending.playerId !== currentPlayer) return null;
  const bankTile = getTileByIdFast(mapData, bankRewardPending.tileId, gridSize);
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
              <span style={{ fontSize: '22px' }}>💶</span>
              <span style={{ fontSize: '15px', fontWeight: 900 }}>{goldReward} EUROS</span>
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

/** Isolated hover tactical preview so pointer sweeps never re-render RightPanel or LogView. */
const HoveredTacticalPreview: React.FC<{
  selectedUnit: Unit;
  selectedUnitTile: Tile | undefined;
}> = React.memo(({ selectedUnit, selectedUnitTile }) => {
  const hoveredTileId = useGameStore(state => state.hoveredTileId);
  const validAttackTargets = useGameStore(state => state.validAttackTargets);
  const validMoveCosts = useGameStore(state => state.validMoveCosts);
  const validMoveParents = useGameStore(state => state.validMoveParents);
  const validSiegeTile = useGameStore(state => state.validSiegeTile);
  const validDemolishTile = useGameStore(state => state.validDemolishTile);
  const mapData = useGameStore(state => state.mapData);
  const units = useGameStore(state => state.units);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const playerCp = useGameStore(state => state.playerCp);
  const weather = useGameStore(state => state.weather);
  const gridSize = useGameStore(state => state.gridSize);
  const visibleTiles = useGameStore(state => state.visibleTiles);
  const viewer = useGameStore(viewerSeat);
  const settings = useGameStore(state => state.settings);
  const fogOfWar = settings.fogOfWar;
  const victoryMode = settings.victoryMode;
  const isAiTurn = useGameStore(state => state.isAiTurn);
  const winner = useGameStore(state => state.winner);
  const online = useGameStore(state => state.mode === 'ONLINE');
  const onlineSeats = useOnline(state => state.view?.seats);
  const ownerLabel = (owner: number) => playerDisplayName(owner, settings.playerNames, online ? onlineSeats?.[owner]?.name : undefined);

  const activeBanks = useMemo(
    () => mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100),
    [mapData]
  );
  const enemyBases = useMemo(
    () => victoryMode === 'CONQUER'
      ? mapData.filter(t => t.type === 'BASE' && t.owner !== currentPlayer && (t.hp || 0) > 0)
      : [],
    [mapData, victoryMode, currentPlayer]
  );

  // Attack & status previews apply whenever your own unit is selected during your turn
  if (!hoveredTileId || isAiTurn || winner !== null || selectedUnit.owner !== currentPlayer) {
    return null;
  }
  const hoveredTile = getTileByIdFast(mapData, hoveredTileId, gridSize);
  if (!hoveredTile) return null;

  const hoveredEnemy = !selectedUnit.completed
    ? units.find(u => u.tileId === hoveredTile.id && validAttackTargets.includes(u.id))
    : undefined;
  const hoveredAnyVisibleEnemy = units.find(
    u => u.tileId === hoveredTile.id && u.owner !== currentPlayer && isUnitVisible(u, viewer, fogOfWar, visibleTiles)
  );

  let combatPreview: { title: string; damage: number; hpBefore: number; hpAfter: number; notes: string[] } | null = null;
  if (hoveredEnemy) {
    const { damage, defense, watchtowerBoosted, coverArmorApplied, crossfireBonus } = computeUnitAttackPreview({
      attacker: selectedUnit,
      attTile: selectedUnitTile,
      target: hoveredEnemy,
      tarTile: hoveredTile,
      units,
      mapData,
      weather,
      gridSize,
    });
    const notes: string[] = [];
    if (defense > 0) notes.push(`Target Cover: -${Math.round(defense * 100)}% DMG`);
    if (defense < 0) notes.push(`Exposed (${hoveredTile.type}): +${Math.round(Math.abs(defense) * 100)}% DMG`);
    if (coverArmorApplied) notes.push(`Cover Armor: -${VETERANCY_CONFIG.ELITE_BREACHER_COVER_DR} DMG`);
    if (watchtowerBoosted) notes.push('Watchtower Bonus: x1.2 DMG');
    if (crossfireBonus > 0) notes.push(`Crossfire Ally: +${crossfireBonus} DMG`);
    if (hoveredEnemy.isOverwatching) notes.push('Breaks Overwatch (SUPPRESSED!)');
    combatPreview = {
      title: `${ownerLabel(hoveredEnemy.owner)} ${UNIT_STATS[hoveredEnemy.type].name}`,
      damage,
      hpBefore: hoveredEnemy.hp,
      hpAfter: Math.max(0, hoveredEnemy.hp - damage),
      notes,
    };
  } else if (!selectedUnit.completed && validSiegeTile && hoveredTile.id === validSiegeTile && hoveredTile.hp !== undefined) {
    const damage = calculateSiegeDamage(selectedUnit, selectedUnitTile);
    const piercesBase = selectedUnit.type === 'ASSAULTER' && (selectedUnit.rank ?? 0) >= 3;
    combatPreview = {
      title: `${ownerLabel(hoveredTile.owner ?? 0)} Headquarters`,
      damage,
      hpBefore: hoveredTile.hp,
      hpAfter: Math.max(0, hoveredTile.hp - damage),
      notes: [piercesBase ? 'Ace Siege Pierce: 100% DMG' : 'Base Armor: -20% DMG'],
    };
  } else if (!selectedUnit.completed && validDemolishTile && hoveredTile.id === validDemolishTile && hoveredTile.hp !== undefined) {
    const damage = calculateDemolishDamage(selectedUnit, selectedUnitTile);
    combatPreview = {
      title: 'Defense Barrier',
      damage,
      hpBefore: hoveredTile.hp,
      hpAfter: Math.max(0, hoveredTile.hp - damage),
      notes: ['Full Structural Damage'],
    };
  }

  if (combatPreview) {
    return (
      <GeoChip variant="softRed" style={{ display: 'block', padding: '7px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, marginBottom: '3px' }}>
          <span>IN RANGE • TARGET PREVIEW</span>
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
    );
  }

  if (hoveredAnyVisibleEnemy) {
    const blocker = selectedUnit.completed
      ? 'Already acted this turn — cannot attack anymore'
      : getHoveredEnemyBlocker(
          { mapData, units, weather, gridSize, settings, playerCp, currentPlayer },
          selectedUnit,
          hoveredTile,
          visibleTiles
        ) || 'Target cannot be attacked right now';
    return (
      <GeoChip variant="softAmber" style={{ display: 'block', padding: '7px 10px' }}>
        <div style={{ fontWeight: 900, marginBottom: '2px' }}>
          {selectedUnit.completed ? 'CANT ATTACK • DONE' : blocker.startsWith('Out of range') ? 'OUT OF RANGE' : 'TARGET BLOCKED'}
        </div>
        <div style={{ fontWeight: 700 }}>{blocker}</div>
      </GeoChip>
    );
  }

  if (selectedUnit.completed) return null;

  const movePreviewCost = validMoveCosts.get(hoveredTile.id);
  if (movePreviewCost === undefined) {
    if ((selectedUnit.hasMoved || selectedUnit.isRooted) && TERRAIN_COSTS[hoveredTile.type] < 90 && hoveredTile.id !== selectedUnit.tileId) {
      return (
        <GeoChip variant="softAmber" style={{ display: 'block', padding: '7px 10px' }}>
          <div style={{ fontWeight: 900 }}>{selectedUnit.isRooted ? 'ROOTED — CANT MOVE' : "CAN'T MOVE"}</div>
          <div style={{ fontWeight: 600 }}>
            {selectedUnit.isRooted ? 'Trapped in Quicksand this turn' : 'Already moved this turn — attack or Overwatch only'}
          </div>
        </GeoChip>
      );
    }
    return null;
  }

  const movePreviewWarnings: string[] = [];
  if (hoveredTile.type === 'QUICKSAND') movePreviewWarnings.push('Quicksand: Roots unit next turn!');
  const terrainDef = TERRAIN_DEFENSE[hoveredTile.type] || 0;
  if (terrainDef < 0) movePreviewWarnings.push(`${hoveredTile.type}: -10% Exposed Cover`);
  if (terrainDef > 0) movePreviewWarnings.push(`${hoveredTile.type}: +${Math.round(terrainDef * 100)}% Cover`);
  if (activeBanks.some(b => getManhattanDistance(b, hoveredTile) <= BANK_STATS.RANGE)) {
    movePreviewWarnings.push(`Inside Bank Turret Range (${BANK_STATS.DAMAGE} DMG/t)`);
  }
  if (enemyBases.some(b => getManhattanDistance(b, hoveredTile) <= BASE_STATS.RANGE)) {
    movePreviewWarnings.push(`Inside Enemy Base Artillery (${BASE_STATS.MIN_DMG}-${BASE_STATS.MAX_DMG} DMG/t)`);
  }
  const owCheck = getHoverMoveResolution({
    movingUnit: selectedUnit,
    targetTileId: hoveredTile.id,
    validMoveCosts,
    validMoveParents,
    mapData,
    units,
    weather,
    gridSize,
    fogOfWar,
    maxBudget: playerCp[currentPlayer] ?? 0,
    visibleTiles: fogOfWar ? visibleTiles : null,
  });
  if (owCheck.trigger) {
    movePreviewWarnings.push(
      owCheck.trigger.pinResisted
        ? `Enemy Overwatch on path (-${owCheck.trigger.damage} DMG, Pin Resisted)`
        : `Enemy Overwatch on path (-${owCheck.trigger.damage} DMG, Pins)`
    );
  }

  return (
    <GeoChip variant="softBlue" style={{ display: 'block', padding: '7px 10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 900, marginBottom: '2px' }}>
        <span>MOVE TO ({hoveredTile.x},{hoveredTile.y})</span>
        <span>{movePreviewCost} CP</span>
      </div>
      {movePreviewWarnings.map((w, idx) => (
        <div key={idx} style={{ fontWeight: 600 }}>• {w}</div>
      ))}
    </GeoChip>
  );
});

export const RightPanel: React.FC = () => {
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const selectedTileId = useGameStore(state => state.selectedTileId);
  const mapData = useGameStore(state => state.mapData);
  const units = useGameStore(state => state.units);
  const gameLog = useGameStore(state => state.gameLog);
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const playerCp = useGameStore(state => state.playerCp);
  const gridSize = useGameStore(state => state.gridSize);
  const visibleTiles = useGameStore(state => state.visibleTiles);
  const viewer = useGameStore(viewerSeat);
  const fogOfWar = useGameStore(state => state.settings.fogOfWar);
  const isAiTurn = useGameStore(state => state.isAiTurn);
  const winner = useGameStore(state => state.winner);
  const mode = useGameStore(state => state.mode);
  const localNames = useGameStore(state => state.settings.playerNames);
  const onlineSeats = useOnline(state => state.view?.seats);
  const unitOwnerLabel = (owner: number) => playerDisplayName(owner, localNames, mode === 'ONLINE' ? onlineSeats?.[owner]?.name : undefined);
  const reloadUnit = useGameStore(state => state.reloadUnit);
  const enterOverwatch = useGameStore(state => state.enterOverwatch);
  const cancelPlacement = useGameStore(state => state.cancelPlacement);
  const confirmConstruct = useGameStore(state => state.confirmConstruct);
  const confirmAutoDrop = useGameStore(state => state.confirmAutoDrop);
  const placementMode = useGameStore(state => state.placementMode);

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

  const selectedUnit = selectedUnitId
    ? units.find(u => u.id === selectedUnitId && isUnitVisible(u, viewer, fogOfWar, visibleTiles))
    : undefined;
  const selectedTile = selectedTileId ? getTileByIdFast(mapData, selectedTileId, gridSize) : undefined;
  const selectedUnitTile = selectedUnit ? getTileByIdFast(mapData, selectedUnit.tileId, gridSize) : undefined;

  const sniperCanFire = selectedUnit?.type === 'SNIPER' ? canUnitAttackFromTile(selectedUnit, selectedUnitTile) : true;

  const isMyTurn = !isAiTurn && winner === null;
  const canCommandSelected = Boolean(selectedUnit && selectedUnit.owner === currentPlayer && isMyTurn && !selectedUnit.completed);
  const intelBadge = selectedUnit?.isOverwatching
    ? { label: 'OVERWATCH', variant: 'amber' as const }
    : selectedUnit
    ? { label: UNIT_STATS[selectedUnit.type].name.toUpperCase(), variant: 'softBlue' as const }
    : selectedTile
    ? { label: selectedTile.type, variant: 'softMint' as const }
    : { label: 'STANDBY', variant: 'default' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px', paddingRight: '4px' }}>
      <TurnStatusBar />

      {/* ARMED CONSTRUCTION / AIRDROP MODE PROMPT */}
      {placementMode && placementMode.active && isMyTurn && (
        <GeoCard armed style={{ flexShrink: 0 }}>
          <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: 900, color: 'var(--acc-amber-ink)' }}>
              {placementMode.kind === 'DROP' ? 'SUPPLY AIRDROP MODE' : 'CONSTRUCTION MODE'}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600 }}>
              {placementMode.kind === 'DROP'
                ? 'Click any highlighted amber tile for targeted delivery, or auto-drop near HQ.'
                : placementMode.itemKey === 'LAND_MINE'
                  ? `Click a cyan tile to plant hidden mine (excluded within ${LAND_MINE_STATS.ENEMY_HQ_EXCLUSION_RADIUS} tiles of enemy HQ).`
                  : (placementMode.requiredCount ?? 1) > 1
                    ? (() => {
                        const selectedCount = placementMode.selectedTiles?.length ?? 0;
                        const reqCount = placementMode.requiredCount ?? BARRIER_STATS.BUILD_COUNT;
                        const remaining = Math.max(0, reqCount - selectedCount);
                        return `Click ${remaining} more cyan tile${remaining === 1 ? '' : 's'} (${selectedCount}/${reqCount} selected — click picked tile to undo).`;
                      })()
                    : 'Click any highlighted cyan tile on the battlefield to deploy.'}
            </div>
            <GeoWell coreStyle={{ padding: '6px 10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 900 }}>
                {SHOP_ITEMS[placementMode.itemKey as keyof typeof SHOP_ITEMS]?.name} (€{placementMode.cost})
              </div>
            </GeoWell>
            {placementMode.kind === 'CONSTRUCT' && (placementMode.requiredCount ?? 1) > 1 && (placementMode.selectedTiles?.length ?? 0) > 0 && (
              <GeoButton variant="mint" fullWidth onClick={confirmConstruct} coreStyle={{ padding: '7px 10px' }}>
                BUILD SELECTED ({placementMode.selectedTiles?.length}/{placementMode.requiredCount})
              </GeoButton>
            )}
            {placementMode.kind === 'DROP' && (
              <GeoButton variant="amber" fullWidth onClick={confirmAutoDrop} coreStyle={{ padding: '7px 10px' }}>
                AUTO-DROP NEAR HQ
              </GeoButton>
            )}
            <GeoButton variant="red" fullWidth onClick={cancelPlacement} coreStyle={{ padding: '7px 10px' }}>
              {placementMode.kind === 'DROP' ? 'CANCEL DROP' : 'CANCEL BUILD'}
            </GeoButton>
          </div>
        </GeoCard>
      )}

      {/* TACTICAL INTEL CARD (Content-Hugging: Zero Empty White Void, Scrolls Only If Stacked Tall) */}
      <GeoCard hug armed={Boolean(selectedUnit?.isOverwatching)} style={{ maxHeight: '58%' }}>
        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight: '100%', gap: '7px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '6px',
              paddingBottom: '5px',
              borderBottom: '1px solid var(--op-line)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' }}>
              TACTICAL INTEL
            </span>
            <GeoChip variant={intelBadge.variant} style={{ padding: '1px 7px' }}>
              {intelBadge.label}
            </GeoChip>
          </div>

          <div className="opgeo-scroll" style={{ flex: '0 1 auto', overflowY: 'auto', minHeight: 0, paddingRight: '3px' }}>
            {selectedUnit ? (() => {
              const rank = selectedUnit.rank ?? 0;
              const xp = selectedUnit.xp ?? 0;
              const nextThreshold = rank < 3 ? VETERANCY_CONFIG.XP_THRESHOLDS[rank + 1] : null;
              const maxHp = getUnitMaxHp(selectedUnit);
              const baseDmg = getUnitBaseDamage(selectedUnit);
              const atkCost = getUnitAttackCost(selectedUnit);
              const uTheme = PLAYER_UI_THEME[selectedUnit.owner] || PLAYER_UI_THEME[0];
              const unitCfg = UNIT_STATS[selectedUnit.type];
              const standingDef = selectedUnitTile
                ? selectedUnitTile.type === 'BUILDING' && selectedUnitTile.subType
                  ? Math.round(BUILDING_STATS[selectedUnitTile.subType].defense * 100)
                  : Math.round((TERRAIN_DEFENSE[selectedUnitTile.type] || 0) * 100)
                : 0;
              const standingTerrainName = selectedUnitTile
                ? selectedUnitTile.type === 'BUILDING' && selectedUnitTile.subType
                  ? BUILDING_STATS[selectedUnitTile.subType].name.toUpperCase()
                  : selectedUnitTile.type
                : '';
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', animation: 'fadeIn 0.2s' }}>
                  {/* Unit Identity Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      className="geo-chip"
                      style={{
                        width: '34px',
                        height: '34px',
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
                      {unitCfg.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 900, color: 'var(--op-ink)' }}>
                          {unitCfg.name.toUpperCase()}
                        </span>
                        <GeoChip variant={rank > 0 ? 'softAmber' : 'default'} style={{ padding: '2px 6px' }}>
                          {rank > 0 ? VETERANCY_CONFIG.RANK_LABELS[rank] : 'RECRUIT'}
                        </GeoChip>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600, display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
                        <span style={{ color: (PLAYER_UI_THEME[selectedUnit.owner] ?? PLAYER_UI_THEME[0]).ink, fontWeight: 800 }}>{unitOwnerLabel(selectedUnit.owner)} Unit</span>
                        <span>{nextThreshold !== null ? `XP ${xp}/${nextThreshold}` : `MAX (${xp})`} • {selectedUnit.kills ?? 0}K</span>
                      </div>
                    </div>
                  </div>

                  {isMyTurn && selectedUnit.owner === currentPlayer && (selectedUnit.completed || selectedUnit.hasMoved || selectedUnit.isRooted) && (
                    <GeoChip
                      variant={selectedUnit.completed || selectedUnit.isRooted ? 'softAmber' : 'softBlue'}
                      style={{ display: 'block', padding: '5px 8px', lineHeight: 1.35 }}
                    >
                      {selectedUnit.completed
                        ? 'DONE THIS TURN • Already acted (cannot move or attack anymore)'
                        : selectedUnit.isRooted
                        ? 'ROOTED • Trapped in Quicksand (cannot move this turn)'
                        : 'ALREADY MOVED • Cannot move again (Attack, Action, or Overwatch)'}
                    </GeoChip>
                  )}

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

                  {/* Standing Tile Cover & Base Range/Move Strip */}
                  {selectedUnitTile && (
                    <GeoWell coreStyle={{ padding: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', gap: '6px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--op-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        ({selectedUnitTile.x},{selectedUnitTile.y}) {standingTerrainName}
                        {standingDef !== 0 && (
                          <span style={{ color: standingDef > 0 ? 'var(--acc-mint-ink)' : 'var(--acc-red-ink)', marginLeft: '4px', fontWeight: 800 }}>
                            {standingDef > 0 ? `+${standingDef}%` : `${standingDef}%`}
                          </span>
                        )}
                      </span>
                      <span style={{ fontWeight: 800, color: 'var(--op-ink-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
                        RNG {unitCfg.range} • MOV {unitCfg.moveCost}
                      </span>
                    </GeoWell>
                  )}

                  {selectedUnit.type === 'SNIPER' && canCommandSelected && (
                    <GeoChip variant={sniperCanFire ? 'softMint' : 'softAmber'} style={{ display: 'block', padding: '5px 8px' }}>
                      {sniperCanFire ? '🎯 High-Ground Firing Ready' : '⚠️ Move to Mountain, Dunes, or Owned Building to Fire'}
                    </GeoChip>
                  )}

                  {selectedUnit.owner === currentPlayer && isMyTurn && (selectedUnit.isOverwatching || !selectedUnit.completed) && (
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
                            coreStyle={{ padding: '7px 10px' }}
                          >
                            SET OVERWATCH ({owCfg.cost} CP • {owCfg.damage} DMG) • O
                          </GeoButton>
                        );
                      })()}

                      {!selectedUnit.completed && selectedUnit.ammo < selectedUnit.maxAmmo && (
                        <GeoButton
                          variant="softBlue"
                          fullWidth
                          disabled={(playerCp[currentPlayer] ?? 0) < CP_SYSTEM.RELOAD_COST}
                          onClick={reloadUnit}
                          coreStyle={{ padding: '7px 10px' }}
                        >
                          FIELD RELOAD (+{Math.max(1, Math.ceil(selectedUnit.maxAmmo / 2))} AMMO • {CP_SYSTEM.RELOAD_COST} CP)
                        </GeoButton>
                      )}

                      {!selectedUnit.completed && validSecureTile && (
                        <GeoButton variant="amber" fullWidth onClick={secureBuilding} coreStyle={{ padding: '7px 10px' }}>
                          SECURE BUILDING (4 CP)
                        </GeoButton>
                      )}
                      {!selectedUnit.completed && validHeistTile && (
                        <GeoButton variant="amber" fullWidth onClick={heistBank} coreStyle={{ padding: '7px 10px' }}>
                          HEIST BANK (4 CP)
                        </GeoButton>
                      )}
                      {!selectedUnit.completed && validSiegeTile && (
                        <GeoButton variant="red" fullWidth onClick={siegeBase} coreStyle={{ padding: '7px 10px' }}>
                          SIEGE BASE
                        </GeoButton>
                      )}
                      {!selectedUnit.completed && validDemolishTile && (
                        <GeoButton variant="red" fullWidth onClick={demolishBarrier} coreStyle={{ padding: '7px 10px' }}>
                          DEMOLISH BARRIER
                        </GeoButton>
                      )}
                      {!selectedUnit.completed && validLootTile && (
                        <GeoButton variant="mint" fullWidth onClick={lootSupply} coreStyle={{ padding: '7px 10px' }}>
                          RETRIEVE SUPPLY (4 CP)
                        </GeoButton>
                      )}
                    </div>
                  )}

                  <HoveredTacticalPreview selectedUnit={selectedUnit} selectedUnitTile={selectedUnitTile} />
                </div>
              );
            })() : selectedTile ? (
              <BuildingInfoPanel tile={selectedTile} />
            ) : (
              <div style={{ color: 'var(--op-ink-muted)', fontStyle: 'italic', textAlign: 'center', padding: '12px 6px', fontSize: '12px' }}>
                Select a unit or tile for tactical analysis. Hover targets to preview damage &amp; CP.
              </div>
            )}
          </div>
        </div>
      </GeoCard>

      {/* ALWAYS-VISIBLE LIVE MISSION LOGS (Expands to Fill Remaining Right-Column Height) */}
      <GeoCard fill style={{ flex: '1 1 0%', minHeight: '140px' }}>
        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '7px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '6px',
              paddingBottom: '5px',
              borderBottom: '1px solid var(--op-line)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' }}>
              LIVE MISSION LOGS
            </span>
            <GeoChip variant="softBlue" style={{ padding: '1px 7px', fontFamily: 'monospace' }}>
              {gameLog.length}
            </GeoChip>
          </div>

          <div className="opgeo-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: '3px' }}>
            <LogView />
          </div>
        </div>
      </GeoCard>

    </div>
  );
};

const GRADE_COLORS: Record<string, { bg: string; ink: string }> = {
  S: { bg: '#FFF0D4', ink: '#994D00' },
  A: { bg: '#D3F9E8', ink: '#046C3E' },
  B: { bg: '#DCE6FF', ink: '#1344C4' },
  C: { bg: '#FFE1DC', ink: '#B42318' },
  D: { bg: '#FFE1DC', ink: '#B42318' },
};

const MatchScorecardSummary: React.FC<{
  matchSummary: MatchSummary;
  winner: number;
  seedValue: string;
}> = ({ matchSummary, winner, seedValue }) => {
  const { copied, copy } = useCopyState(1800);
  const winnerStats = matchSummary.playerStats?.[winner];
  const grade = GRADE_COLORS[matchSummary.grade];

  return (
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
            background: grade?.bg || '#DCE6FF',
            color: grade?.ink || 'var(--acc-blue-ink)',
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
          <GeoButton onClick={() => void copy(seedValue)} coreStyle={{ padding: '4px 10px' }}>
            {copied ? 'COPIED' : 'COPY SEED'}
          </GeoButton>
        </GeoWell>
      )}
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
  const mode = useGameStore(state => state.mode);
  const mySeat = useGameStore(state => state.mySeat);
  const onlineView = useOnline(state => state.view);
  const rematch = useOnline(state => state.rematch);

  if (winner === null) return null;
  const online = mode === 'ONLINE';
  const isHost = Boolean(onlineView?.seats[mySeat]?.isHost);
  const localNames = useGameStore(state => state.settings.playerNames);
  const winnerName = playerDisplayName(winner, localNames, online ? onlineView?.seats[winner]?.name : undefined);
  const seedValue = matchSummary?.seed || activeSeed;
  const pTheme = PLAYER_UI_THEME[winner] || PLAYER_UI_THEME[0];

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
              {activeMission ? (winner === 0 ? '🎖️' : '💀') : online && winner !== mySeat ? '💀' : '🏆'}
            </div>
            <h1 style={{ color: pTheme.ink, fontSize: '28px', fontWeight: 900, margin: '0 0 4px 0' }}>
              {activeMission
                ? winner === 0 ? 'OPERATION COMPLETE!' : 'OPERATION FAILED'
                : online
                  ? winner === mySeat ? 'VICTORY!' : `${winnerName.toUpperCase()} WINS`
                  : `${winnerName.toUpperCase()} WINS!`}
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
            <MatchScorecardSummary matchSummary={matchSummary} winner={winner} seedValue={seedValue} />
          )}

          {online ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              {isHost ? (
                <GeoButton variant="blue" fullWidth onClick={rematch} coreStyle={{ padding: '12px 14px' }}>
                  REMATCH
                </GeoButton>
              ) : (
                <GeoWell coreStyle={{ padding: '10px', flex: 1, fontSize: '13px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>
                  The host can start a rematch
                </GeoWell>
              )}
              <GeoButton variant="mint" fullWidth onClick={resetGame} coreStyle={{ padding: '12px 14px' }}>
                LEAVE TABLE
              </GeoButton>
            </div>
          ) : (
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
          )}
        </div>
      </GeoCard>
    </div>
  );
};
