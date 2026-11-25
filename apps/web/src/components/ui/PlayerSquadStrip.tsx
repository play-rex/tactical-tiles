import React, { useMemo } from 'react';
import { RESPAWN_CP_COST, TILE_SIZE, UNIT_STATS, VETERANCY_CONFIG } from '@tactical/engine/constants/Config';
import type { DeadUnit, Unit } from '@tactical/engine/types';
import { getUnitMaxHp } from '@tactical/engine/rules/CombatRules';
import { getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import { UnitMapIcon } from './UnitDeckModal';
import { GeoButton } from './GeoPrimitives';
import { useGameStore } from '../../store/useGameStore';
import { useViewportContext } from '../../context/ViewportContext';
import { pingUnitLocation } from '../../core/unitLocate';
import { rotateBoardPoint } from '../../core/boardRotation';
import { wakeBattleRenderer } from '../../store/useEffectStore';

/** If the picked unit is outside what the camera shows, glide to it; leave a visible unit alone. */
const revealTileIfOffscreen = (viewport: ReturnType<typeof useViewportContext>['viewport'], tileId: string) => {
  if (!viewport || viewport.destroyed) return;
  const { mapData, gridSize, mapRotation } = useGameStore.getState();
  const tile = getTileByIdFast(mapData, tileId, gridSize);
  if (!tile) return;
  const world = rotateBoardPoint(
    (tile.x + 0.5) * TILE_SIZE,
    (tile.y + 0.5) * TILE_SIZE,
    mapRotation,
    gridSize * TILE_SIZE,
  );
  const screen = viewport.toScreen(world.x, world.y);
  const margin = 56;
  if (screen.x >= margin && screen.x <= viewport.screenWidth - margin && screen.y >= margin && screen.y <= viewport.screenHeight - margin) {
    return;
  }
  wakeBattleRenderer(700);
  viewport.animate({ position: { x: world.x, y: world.y }, time: 420, ease: 'easeInOutQuad' });
};

const hpTone = (pct: number) => (pct > 0.6 ? '#16A34A' : pct > 0.3 ? '#D97706' : '#DC2626');

const CHIP_BASE: React.CSSProperties = {
  flex: '0 0 48px',
  width: 48,
  padding: '2px 2px 3px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 1,
  borderRadius: 4,
  position: 'relative',
};

/** One living unit: icon, HP bar, ammo pips and rank stars, all reading live state. */
const LiveChip: React.FC<{
  unit: Unit;
  selected: boolean;
  accent: string;
  onClick: () => void;
}> = ({ unit, selected, accent, onClick }) => {
  const rank = unit.rank ?? 0;
  const maxHp = getUnitMaxHp(unit);
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(1, unit.hp / maxHp)) : 0;
  const tone = hpTone(hpPct);
  const status = unit.isOverwatching
    ? { color: '#D97706', label: 'Overwatch armed' }
    : unit.ammo === 0
      ? { color: '#DC2626', label: 'Out of ammo — field reload to fire' }
      : unit.completed
        ? { color: '#94A3B8', label: 'Acted this turn' }
        : { color: '#16A34A', label: 'Ready to act' };
  const action = unit.completed ? 'Done this turn' : unit.hasMoved ? 'Moved — can still fire' : 'Ready';
  const title =
    `${UNIT_STATS[unit.type].name} · ${VETERANCY_CONFIG.RANK_NAMES[rank]} (${rank}/3)\n` +
    `${unit.hp}/${maxHp} HP · ${unit.ammo}/${unit.maxAmmo} ammo\n` +
    `${action}${unit.isOverwatching ? ' · Overwatch armed' : ''}\n` +
    'Click to select it and ping its position on the map';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={selected}
      aria-label={title}
      style={{
        ...CHIP_BASE,
        background: selected ? '#FFFBEB' : 'var(--op-well, #FFFFFF)',
        border: `1.5px solid ${selected ? '#D4A000' : unit.completed ? '#D8DEE8' : `${accent}66`}`,
        boxShadow: selected
          ? '0 0 0 2px rgba(251,191,36,0.5)'
          : unit.completed
            ? 'none'
            : '0 1px 2px rgba(20,24,33,0.14)',
        cursor: 'pointer',
        opacity: unit.completed ? 0.66 : 1,
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 8, width: '100%' }}>
        <span
          style={{
            fontSize: 7,
            lineHeight: '8px',
            letterSpacing: '-0.4px',
            fontWeight: 900,
            color: '#B45309',
            whiteSpace: 'nowrap',
          }}
        >
          {rank > 0 ? '★'.repeat(rank) : ''}
        </span>
        <span
          aria-hidden
          title={status.label}
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            flexShrink: 0,
            background: status.color,
            boxShadow: `0 0 0 1px ${status.color}40`,
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          filter: unit.completed ? 'grayscale(0.55)' : undefined,
        }}
      >
        <UnitMapIcon type={unit.type} label={UNIT_STATS[unit.type].name} size={26} />
      </div>

      <div
        title={`${unit.hp}/${maxHp} HP`}
        style={{ height: 4, width: '100%', background: '#D9E0EA', borderRadius: 2, overflow: 'hidden', marginTop: 1 }}
      >
        <div style={{ height: '100%', width: `${hpPct * 100}%`, background: tone, borderRadius: 2 }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
        <span
          style={{
            fontSize: 8,
            lineHeight: '9px',
            fontWeight: 900,
            fontVariantNumeric: 'tabular-nums',
            color: hpPct <= 0.3 ? '#B91C1C' : 'var(--op-ink)',
          }}
        >
          {unit.hp}
        </span>
        <span
          title={`${unit.ammo}/${unit.maxAmmo} ammo`}
          style={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 1, overflow: 'hidden' }}
        >
          {Array.from({ length: Math.min(unit.maxAmmo, 12) }).map((_, i) => (
            <span
              key={i}
              style={{
                width: 2,
                height: 5,
                borderRadius: 0.5,
                flexShrink: 0,
                background: i < unit.ammo ? '#B45309' : '#DCE2EB',
              }}
            />
          ))}
        </span>
      </div>
    </button>
  );
};

/** A fallen unit's slot: countdown, price, and a one-click start for redeploy placement. */
const FallenChip: React.FC<{
  dead: DeadUnit;
  selected: boolean;
  canAct: boolean;
  cp: number;
  respawnsLeft: number;
  onClick: () => void;
}> = ({ dead, selected, canAct, cp, respawnsLeft, onClick }) => {
  const cost = RESPAWN_CP_COST[dead.type] ?? 0;
  const ready = (dead.turnsUntilRespawn ?? 0) <= 0;
  const affordable = cp >= cost;
  const enabled = canAct && ready && affordable && respawnsLeft > 0;
  const label = !ready
    ? `${dead.turnsUntilRespawn}t`
    : respawnsLeft <= 0
      ? 'OUT'
      : `${cost} CP`;
  const topLabel = selected ? 'PICK TILE' : ready && respawnsLeft > 0 ? 'RESPAWN' : 'FALLEN';
  const hint = !canAct
    ? 'Redeploys open on your turn'
    : !ready
      ? `Ready to redeploy in ${dead.turnsUntilRespawn} round${dead.turnsUntilRespawn === 1 ? '' : 's'}`
      : respawnsLeft <= 0
        ? 'No redeploys left this match'
        : !affordable
          ? `Redeploy costs ${cost} CP — ${cost - cp} more needed`
          : 'Click to redeploy, then pick a green spawn tile near your HQ';
  const title = `${UNIT_STATS[dead.type].name} — fallen\n${hint}${selected ? '\nClick again to cancel' : ''}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled && !selected}
      title={title}
      aria-pressed={selected}
      aria-label={title}
      style={{
        ...CHIP_BASE,
        background: selected ? '#FFFBEB' : enabled ? 'var(--acc-blue-soft)' : '#F1F4F9',
        border: selected
          ? '1.5px solid #D4A000'
          : enabled
            ? '1.5px solid #1E88E5'
            : '1.5px dashed #C2CBD9',
        boxShadow: selected
          ? '0 0 0 2px rgba(251,191,36,0.5)'
          : enabled
            ? '0 0 0 2px rgba(30,136,229,0.18)'
            : 'none',
        cursor: enabled || selected ? 'pointer' : 'not-allowed',
        opacity: enabled || selected ? 1 : 0.7,
        color: 'var(--op-ink-muted)',
        textAlign: 'left',
      }}
    >
      <span
        style={{
          fontSize: 7,
          lineHeight: '8px',
          height: 8,
          fontWeight: 900,
          letterSpacing: '0.2px',
          color: selected ? '#92400E' : enabled ? 'var(--acc-blue-ink)' : ready && respawnsLeft > 0 ? '#1D4ED8' : '#B91C1C',
          whiteSpace: 'nowrap',
        }}
      >
        {topLabel}
      </span>

      <div style={{ position: 'relative', width: '100%', height: 26, display: 'flex', justifyContent: 'center' }}>
        <div style={{ filter: 'grayscale(1)', opacity: 0.45 }}>
          <UnitMapIcon type={dead.type} label={UNIT_STATS[dead.type].name} size={26} />
        </div>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 19,
            lineHeight: 1,
            fontWeight: 900,
            color: '#B91C1C',
            textShadow: '0 1px 0 #FFFFFF',
          }}
        >
          ✕
        </span>
      </div>

      <div style={{ height: 4, marginTop: 1 }} aria-hidden />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
        <span
          style={{
            fontSize: 8,
            lineHeight: '9px',
            fontWeight: 900,
            fontVariantNumeric: 'tabular-nums',
            color: enabled || selected ? 'var(--acc-blue-ink)' : ready && !affordable ? '#B91C1C' : 'var(--op-ink-muted)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 8,
            lineHeight: '9px',
            fontWeight: 900,
            color: enabled || selected ? 'var(--acc-blue-ink)' : 'var(--op-ink-muted)',
          }}
        >
          {enabled ? '↻' : ready ? '' : '⏳'}
        </span>
      </div>
    </button>
  );
};

/**
 * The player's roster as a live horizontal strip: each unit's icon, HP bar, ammo pips and rank
 * update from the board, a click selects it and pings its tile, and a fallen unit's slot becomes
 * its own redeploy button with timer and CP price.
 */
export const PlayerSquadStrip: React.FC<{
  seat: number;
  casualties: DeadUnit[];
  respawnsLeft: number;
  cp: number;
  canAct: boolean;
  accentColor: string;
}> = ({ seat, casualties, respawnsLeft, cp, canAct, accentColor }) => {
  const units = useGameStore(state => state.units);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const selectedGraveyardUnitId = useGameStore(state => state.selectedGraveyardUnitId);
  const selectUnitById = useGameStore(state => state.selectUnitById);
  const handleGraveyardSelect = useGameStore(state => state.handleGraveyardSelect);
  const clearSelection = useGameStore(state => state.clearSelection);
  const { viewport } = useViewportContext();

  const squad = useMemo(() => units.filter(u => u.owner === seat), [units, seat]);
  const totals = useMemo(() => {
    let hp = 0;
    let maxHp = 0;
    for (const unit of squad) {
      hp += Math.max(0, unit.hp);
      maxHp += getUnitMaxHp(unit);
    }
    return { hp, maxHp, pct: maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0 };
  }, [squad]);
  const readyCount = squad.reduce((count, unit) => count + (unit.completed ? 0 : 1), 0);
  const integrity =
    totals.pct > 60
      ? { bg: 'var(--acc-mint-soft)', ink: 'var(--acc-mint-ink)' }
      : totals.pct > 30
        ? { bg: 'var(--acc-amber-soft)', ink: 'var(--acc-amber-ink)' }
        : { bg: 'var(--acc-red-soft)', ink: 'var(--acc-red-ink)' };

  const locate = (unit: Unit) => {
    selectUnitById(unit.id);
    pingUnitLocation(unit.tileId, unit.owner);
    revealTileIfOffscreen(viewport, unit.tileId);
  };

  // One-click respawn: the first fallen unit that can actually come back right now leads;
  // otherwise the banner still explains the wait, price or missing redeploys.
  const selectedDead = casualties.find(dead => dead.id === selectedGraveyardUnitId) ?? null;
  const eligibleDead =
    casualties.find(
      dead =>
        (dead.turnsUntilRespawn ?? 0) <= 0 &&
        cp >= (RESPAWN_CP_COST[dead.type] ?? 0) &&
        respawnsLeft > 0,
    ) ?? null;
  const focusDead = selectedDead ?? eligibleDead ?? casualties[0] ?? null;
  const focusCost = focusDead ? RESPAWN_CP_COST[focusDead.type] ?? 0 : 0;
  const canSpawnFocus = Boolean(canAct && eligibleDead);
  const moreFallen = Math.max(0, casualties.length - 1);
  const statusText = !focusDead
    ? ''
    : selectedDead
      ? `${UNIT_STATS[selectedDead.type].name} — green spawn tiles near your HQ are lit`
      : !canAct
        ? 'Redeploys open on your turn'
        : respawnsLeft <= 0
          ? 'No redeploys left this match'
          : (focusDead.turnsUntilRespawn ?? 0) > 0
            ? `${UNIT_STATS[focusDead.type].name} ready in ${focusDead.turnsUntilRespawn} round${focusDead.turnsUntilRespawn === 1 ? '' : 's'}`
            : !eligibleDead
              ? `${UNIT_STATS[focusDead.type].name} needs ${Math.max(0, focusCost - cp)} more CP`
              : `${UNIT_STATS[focusDead.type].name} ready · ${focusCost} CP${moreFallen > 0 ? ` · +${moreFallen} more fallen` : ''}`;
  const ctaLabel = selectedDead
    ? 'CANCEL'
    : canSpawnFocus
      ? `RESPAWN · ${focusCost} CP`
      : !canAct
        ? 'YOUR TURN'
        : respawnsLeft <= 0
          ? 'NO DEPLOYS'
          : (focusDead?.turnsUntilRespawn ?? 0) > 0
            ? `IN ${focusDead?.turnsUntilRespawn}T`
            : `NEED ${Math.max(0, focusCost - cp)} CP`;

  return (
    <div style={{ borderTop: '1px solid var(--op-line)', paddingTop: '5px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginBottom: '5px' }}>
        <span style={{ fontSize: '10px', fontWeight: 900, letterSpacing: '0.7px', color: 'var(--op-ink-muted)' }}>
          LIVE SQUAD
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span
            className="geo-chip"
            title={`Squad integrity: ${totals.hp}/${totals.maxHp} HP across ${squad.length} unit${squad.length === 1 ? '' : 's'}`}
            style={{ padding: '1px 4px', fontSize: '9px', fontWeight: 900, background: integrity.bg, color: integrity.ink }}
          >
            HP {totals.pct}%
          </span>
          <span
            className="geo-chip"
            title={`${readyCount} of ${squad.length} can still act this turn`}
            style={{
              padding: '1px 4px',
              fontSize: '9px',
              fontWeight: 900,
              background: 'var(--acc-blue-soft)',
              color: 'var(--acc-blue-ink)',
            }}
          >
            {readyCount}/{squad.length} READY
          </span>
          <span
            className="geo-chip"
            title={`${respawnsLeft} redeploy${respawnsLeft === 1 ? '' : 's'} left`}
            style={{
              padding: '1px 4px',
              fontSize: '9px',
              fontWeight: 900,
              background: respawnsLeft > 0 ? '#EEF2F7' : 'var(--acc-red-soft)',
              color: respawnsLeft > 0 ? 'var(--op-ink)' : 'var(--acc-red-ink)',
            }}
          >
            ↻ {respawnsLeft}
          </span>
        </span>
      </div>

      {casualties.length > 0 && focusDead && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            marginBottom: '5px',
            padding: '4px 5px',
            borderRadius: 4,
            border: `1px solid ${selectedDead ? '#F59E0B' : canSpawnFocus ? '#93C5FD' : '#D8DEE8'}`,
            background: selectedDead ? '#FFFBEB' : canSpawnFocus ? 'var(--acc-blue-soft)' : '#F7F9FC',
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 12,
              lineHeight: 1,
              color: selectedDead ? '#B45309' : canSpawnFocus ? 'var(--acc-blue-ink)' : 'var(--acc-red-ink)',
            }}
          >
            ⚑
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: '9.5px',
                fontWeight: 900,
                letterSpacing: '0.3px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: selectedDead || canSpawnFocus ? 'var(--op-ink)' : 'var(--op-ink-muted)',
              }}
            >
              {selectedDead
                ? `REDEPLOY ${UNIT_STATS[selectedDead.type].name.toUpperCase()}`
                : `${casualties.length} FALLEN`}
            </div>
            <div
              title={statusText}
              style={{
                fontSize: '9px',
                fontWeight: 700,
                lineHeight: 1.25,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: selectedDead ? '#B45309' : 'var(--op-ink-muted)',
              }}
            >
              {statusText}
            </div>
          </div>
          <GeoButton
            variant={selectedDead ? 'amber' : canSpawnFocus ? 'blue' : 'default'}
            disabled={!selectedDead && !canSpawnFocus}
            onClick={() => {
              if (selectedDead) {
                clearSelection();
                return;
              }
              if (eligibleDead) handleGraveyardSelect(eligibleDead.id);
            }}
            title={
              selectedDead
                ? 'Cancel redeploy'
                : canSpawnFocus
                  ? 'Start redeploy, then click a green spawn tile near your HQ'
                  : statusText
            }
            coreStyle={{ padding: '3px 6px', fontSize: '9px', fontWeight: 900, whiteSpace: 'nowrap' }}
          >
            {ctaLabel}
          </GeoButton>
        </div>
      )}

      {squad.length === 0 && casualties.length === 0 ? (
        <div style={{ fontSize: '11px', fontWeight: 700, fontStyle: 'italic', color: 'var(--op-ink-muted)' }}>
          No units in the field.
        </div>
      ) : (
        <div
          className="opgeo-scroll"
          role="group"
          aria-label="Live squad — click a unit to select and ping it on the map"
          style={{ display: 'flex', alignItems: 'stretch', gap: '4px', overflowX: 'auto', overflowY: 'hidden', paddingBottom: '2px' }}
        >
          {squad.map(unit => (
            <LiveChip
              key={unit.id}
              unit={unit}
              selected={selectedUnitId === unit.id}
              accent={accentColor}
              onClick={() => locate(unit)}
            />
          ))}
          {casualties.map(dead => (
            <FallenChip
              key={dead.id}
              dead={dead}
              selected={selectedGraveyardUnitId === dead.id}
              canAct={canAct}
              cp={cp}
              respawnsLeft={respawnsLeft}
              onClick={() => {
                if (selectedGraveyardUnitId === dead.id) {
                  clearSelection();
                  return;
                }
                handleGraveyardSelect(dead.id);
              }}
            />
          ))}
        </div>
      )}

      {squad.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px',
            marginTop: '3px',
            fontSize: '8px',
            fontWeight: 700,
            color: 'var(--op-ink-muted)',
          }}
        >
          <span>★ RANK · ▮ AMMO · BAR HP</span>
          <span>CLICK → MAP PING</span>
        </div>
      )}
    </div>
  );
};
