import React from 'react';
import {
  TACTICAL_IDS,
  TACTICAL_ITEMS,
  TACTICAL_TIER_ORDER,
  tacticalCooldownLeft,
  tacticalIsFree,
  tacticalUnlockRound,
  tacticalVoucherCount,
} from '@tactical/engine';
import type { TacticalId } from '@tactical/engine/types';
import { TACTICAL_VISUAL_STYLE } from '../../core/graphics/TacticalAssets';
import { useGameStore } from '../../store/useGameStore';
import { GeoButton, GeoCard, GeoChip } from './GeoPrimitives';

/** Crisp vector weapon emblems (14px) matching each weapon's battlefield visual language. */
export const TacticalWeaponIcon: React.FC<{ itemKey: TacticalId; size?: number; color?: string }> = ({
  itemKey,
  size = 13,
  color,
}) => {
  const stroke = color ?? TACTICAL_VISUAL_STYLE[itemKey].primaryHex;
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: { flexShrink: 0 },
    'aria-hidden': true,
  };

  switch (itemKey) {
    case 'MINEFIELD_SNAPSHOT':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="5.5" strokeDasharray="2 2" />
          <circle cx="8" cy="8" r="2" fill={stroke} stroke="none" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
        </svg>
      );
    case 'RECON_DRONE':
      return (
        <svg {...common}>
          <circle cx="4" cy="4" r="2" />
          <circle cx="12" cy="4" r="2" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
          <circle cx="8" cy="8" r="1.8" fill={stroke} stroke="none" />
        </svg>
      );
    case 'SMOKE_SCREEN':
      return (
        <svg {...common}>
          <path d="M4.5 11.5h7a2.5 2.5 0 0 0 .3-5 3.3 3.3 0 0 0-6.4-.8A2.4 2.4 0 0 0 4.5 11.5z" />
          <path d="M3 13.8h10" strokeDasharray="2 1.8" />
        </svg>
      );
    case 'RADAR_SWEEP':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="3" opacity="0.6" />
          <path d="M8 8L12.5 3.5" />
          <circle cx="10.5" cy="10.5" r="1.2" fill={stroke} stroke="none" />
        </svg>
      );
    case 'PRECISION_STRIKE':
      return (
        <svg {...common}>
          <circle cx="8" cy="9" r="4.5" />
          <path d="M8 1.5v7.5M8 12.5v2M2 9h2M12 9h2" />
          <circle cx="8" cy="9" r="1.3" fill={stroke} stroke="none" />
        </svg>
      );
    case 'SABOTAGE':
      return (
        <svg {...common}>
          <path d="M9.5 1.5L4 8.5h4l-1.5 6L12 7.5H8l1.5-6z" fill={stroke} stroke="none" />
        </svg>
      );
    case 'NAPALM_LINE':
      return (
        <svg {...common}>
          <path d="M8 2c2 2.4 3.6 4.4 3.6 6.8a3.6 3.6 0 1 1-7.2 0c0-1.4.6-2.8 1.5-4 .2 1.1.9 1.7 1.6 1.7C7.2 4.8 7.5 3.2 8 2z" />
          <path d="M2.5 14h11" />
        </svg>
      );
    case 'PARADROP':
      return (
        <svg {...common}>
          <path d="M2.5 7a5.5 5.5 0 0 1 11 0z" />
          <path d="M4 7l4 4.5M12 7l-4 4.5M8 7v4.5" />
          <rect x="6.3" y="11.5" width="3.4" height="3" rx="0.6" fill={stroke} stroke="none" />
        </svg>
      );
    case 'CARPET_RUN':
      return (
        <svg {...common}>
          <path d="M2 8l12-4-2.8 4 2.8 4L2 8z" />
          <circle cx="4.5" cy="13" r="1.2" fill={stroke} stroke="none" />
          <circle cx="8.2" cy="13" r="1.2" fill={stroke} stroke="none" />
          <circle cx="11.8" cy="13" r="1.2" fill={stroke} stroke="none" />
        </svg>
      );
    case 'ARTILLERY_BARRAGE':
      return (
        <svg {...common}>
          <path d="M2.5 3.5l4 4M7.5 2.5l4 4M11 6l3 3" />
          <path d="M2 12.5h12M4 14.2h8" strokeDasharray="2 1.5" />
        </svg>
      );
    case 'OVERCLOCK_CORE':
      return (
        <svg {...common}>
          <polygon points="8,1.5 13.5,4.8 13.5,11.2 8,14.5 2.5,11.2 2.5,4.8" />
          <path d="M8.5 4.8L6.2 8.2h2.2l-.9 3 2.5-3.4H7.8l.7-3z" fill={stroke} stroke="none" />
        </svg>
      );
  }
};

/**
 * Tactical weapons live beside the Field Shop but resolve differently: buying is using, the
 * tier gate is the round, and the first Common bought in round 2 is free.
 */
export const TacticalShop: React.FC = () => {
  const currentPlayer = useGameStore(s => s.currentPlayer);
  const playerGold = useGameStore(s => s.playerGold);
  const totalTurns = useGameStore(s => s.totalTurns);
  const settings = useGameStore(s => s.settings);
  const tacticalRound = useGameStore(s => s.tacticalRound);
  const tacticalCooldowns = useGameStore(s => s.tacticalCooldowns);
  const freeTacticalRound = useGameStore(s => s.freeTacticalRound);
  const playerTacticalVouchers = useGameStore(s => s.playerTacticalVouchers);
  const overclockCharges = useGameStore(s => s.overclockCharges);
  const placementMode = useGameStore(s => s.placementMode);
  const isAiTurn = useGameStore(s => s.isAiTurn);
  const winner = useGameStore(s => s.winner);
  const mode = useGameStore(s => s.mode);
  const mySeat = useGameStore(s => s.mySeat);
  const devSandbox = useGameStore(s => s.devSandbox);
  const devFreeplay = useGameStore(s => s.devFreeplay);
  const useTacticalWeapon = useGameStore(s => s.useTacticalWeapon);
  const setTacticalAxis = useGameStore(s => s.setTacticalAxis);
  const confirmTacticalStrike = useGameStore(s => s.confirmTacticalStrike);
  const resetParadropPick = useGameStore(s => s.resetParadropPick);
  const cancelPlacement = useGameStore(s => s.cancelPlacement);

  const sandboxUnlocked = devSandbox && devFreeplay;
  const round = totalTurns + 1;
  const gold = playerGold[currentPlayer] ?? 0;
  const usedThisRound = !sandboxUnlocked && (tacticalRound?.[currentPlayer] ?? 0) === round;
  const myOverclock = overclockCharges?.[currentPlayer] ?? 0;
  const canAct = !isAiTurn && winner === null && (mode !== 'ONLINE' || mySeat === currentPlayer);
  const aimingId = placementMode?.kind === 'TACTICAL' ? (placementMode.itemKey as TacticalId) : null;
  const aiming = aimingId ? TACTICAL_ITEMS[aimingId] : null;
  const aimingDirectional = aiming?.shape === 'LINE4' || aiming?.shape === 'LANE';
  const carpetSelectedCount = aiming?.shape === 'UNITS3' ? (placementMode?.selectedTiles?.length ?? 0) : 0;
  const paradropUnitPicked = aiming?.shape === 'RELOCATE' && Boolean(placementMode?.tacticalUnitId);

  return (
    <GeoCard armed={placementMode?.kind === 'TACTICAL'} style={{ flexShrink: 0, marginRight: '4px' }}>
      <div style={{ padding: '9px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.5px' }}>
            TACTICAL WEAPONS
          </span>
          <GeoChip variant={myOverclock > 0 || sandboxUnlocked ? 'amber' : 'default'} style={{ fontSize: '10px', padding: '2px 6px' }}>
            {myOverclock > 0
              ? `⚡ OVERCLOCK ${myOverclock}/3`
              : sandboxUnlocked
                ? 'SANDBOX • ALL READY'
                : usedThisRound
                  ? 'USED THIS ROUND'
                  : tacticalIsFree({ totalTurns, freeTacticalRound }, currentPlayer, 'MINEFIELD_SNAPSHOT')
                    ? 'R2 • 1 FREE COMMON'
                    : `ROUND ${round} • READY`}
          </GeoChip>
        </div>

        {TACTICAL_TIER_ORDER.map(tier => {
          const items = TACTICAL_IDS.filter(id => {
            const def = TACTICAL_ITEMS[id];
            if (def.tier !== tier) return false;
            if (def.fogOnly && !settings.fogOfWar) return false;
            return true;
          });
          if (items.length === 0) return null;
          const unlock = tacticalUnlockRound(items[0]);
          const tierHasVoucher = items.some(
            id => tacticalVoucherCount({ playerTacticalVouchers }, currentPlayer, id) > 0,
          );
          const locked = !sandboxUnlocked && round < unlock;
          return (
            <div key={tier} style={{ opacity: locked && !tierHasVoucher ? 0.55 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 800, color: 'var(--op-ink-muted)', margin: '2px 0 3px' }}>
                <span>{tier}</span>
                <span>{sandboxUnlocked ? 'SANDBOX' : locked ? (tierHasVoucher ? 'CRATE UNLOCKED' : `OPENS ROUND ${unlock}`) : `ROUND ${unlock}+`}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                {items.map(id => {
                  const def = TACTICAL_ITEMS[id];
                  const vouchers = tacticalVoucherCount({ playerTacticalVouchers }, currentPlayer, id);
                  const hasVoucher = vouchers > 0;
                  const cdLeft = sandboxUnlocked || hasVoucher ? 0 : tacticalCooldownLeft({ totalTurns, tacticalCooldowns }, currentPlayer, id);
                  const free =
                    sandboxUnlocked ||
                    hasVoucher ||
                    (!locked && cdLeft === 0 && canAct && !usedThisRound && tacticalIsFree({ totalTurns, freeTacticalRound, playerTacticalVouchers }, currentPlayer, id));
                  const disabled = !canAct || (!hasVoucher && locked) || usedThisRound || (!hasVoucher && cdLeft > 0) || (!free && gold < def.cost);
                  const isAiming = placementMode?.kind === 'TACTICAL' && placementMode.itemKey === id;
                  const cdNote = cdLeft > 0 ? ` [Cooldown: ${cdLeft}R left]` : '';
                  const voucherNote = hasVoucher ? ` [Supply Crate Voucher ×${vouchers} · FREE]` : '';
                  return (
                    <GeoButton
                      key={id}
                      variant={isAiming ? 'amber' : hasVoucher ? 'mint' : 'default'}
                      onClick={() => useTacticalWeapon(id)}
                      disabled={disabled}
                      fullWidth
                      title={`${def.name} (${hasVoucher ? 'FREE supply crate voucher' : free ? 'free round-2 pick' : `€${def.cost}`})${voucherNote}${cdNote} — ${def.blurb}`}
                      coreStyle={{ padding: '5px 6px', justifyContent: 'space-between', gap: '4px' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0, overflow: 'hidden' }}>
                        <TacticalWeaponIcon itemKey={id} size={12} color={isAiming ? '#1C1200' : hasVoucher ? '#052E16' : undefined} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' }}>
                          {def.name}
                        </span>
                      </span>
                      <span
                        style={{
                          color: isAiming ? '#1C1200' : hasVoucher ? '#052E16' : cdLeft > 0 ? 'var(--acc-red-ink)' : 'var(--acc-amber-ink)',
                          fontFamily: 'monospace',
                          fontSize: '10.5px',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {hasVoucher ? `CRATE${vouchers > 1 ? `×${vouchers}` : ''}` : cdLeft > 0 ? `CD ${cdLeft}R` : free ? 'FREE' : `€${def.cost}`}
                      </span>
                    </GeoButton>
                  );
                })}
              </div>
            </div>
          );
        })}

        {placementMode?.kind === 'TACTICAL' && canAct && aiming && aimingId && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', borderTop: '1px solid var(--op-line)', paddingTop: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <TacticalWeaponIcon itemKey={aimingId} size={13} />
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--op-ink)', flex: 1 }}>
                {aiming.name.toUpperCase()}
                {aiming.shape === 'LANE' ? ' • 2×10' : ''}
                {aimingDirectional ? ` • ${placementMode.tacticalAxis === 'V' ? 'VERTICAL' : 'HORIZONTAL'}` : ''}
                {aiming.shape === 'RELOCATE' ? (paradropUnitPicked ? ' • STEP 2/2' : ' • STEP 1/2') : ''}
              </span>
              <span style={{ fontSize: '9.5px', fontWeight: 800, color: placementMode.validTiles.length > 0 ? 'var(--acc-mint-ink)' : 'var(--acc-red-ink)', fontFamily: 'monospace' }}>
                {aiming.shape === 'UNITS3'
                  ? `${carpetSelectedCount}/3 LOCKED`
                  : aiming.shape === 'RELOCATE'
                    ? paradropUnitPicked
                      ? `${placementMode.validTiles.length} LZ`
                      : `${placementMode.validTiles.length} UNITS`
                    : `${placementMode.validTiles.length} LEGAL`}
              </span>
            </div>
            {aimingDirectional && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--op-ink-muted)', flex: 1 }}>ORIENTATION</span>
                <GeoButton variant={placementMode.tacticalAxis === 'H' ? 'amber' : 'default'} onClick={() => setTacticalAxis('H')} coreStyle={{ padding: '3px 8px', fontSize: '10px' }}>H</GeoButton>
                <GeoButton variant={placementMode.tacticalAxis === 'V' ? 'amber' : 'default'} onClick={() => setTacticalAxis('V')} coreStyle={{ padding: '3px 8px', fontSize: '10px' }}>V</GeoButton>
              </div>
            )}
            {aiming.shape === 'UNITS3' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--op-ink-muted)' }}>
                  Click up to 3 visible enemy units (50% current HP · min 2 HP).
                </span>
                {carpetSelectedCount > 0 && (
                  <GeoButton variant="amber" fullWidth onClick={confirmTacticalStrike} coreStyle={{ padding: '5px 8px', fontSize: '10.5px' }}>
                    FIRE SALVO ({carpetSelectedCount}/3 TARGETS)
                  </GeoButton>
                )}
              </div>
            )}
            {aiming.shape === 'RELOCATE' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--op-ink-muted)', flex: 1 }}>
                  {paradropUnitPicked ? 'Click highlighted open ground to drop.' : 'Pick any visible unit (yours or enemy).'}
                </span>
                {paradropUnitPicked && (
                  <GeoButton variant="default" onClick={resetParadropPick} coreStyle={{ padding: '3px 7px', fontSize: '9.5px' }}>
                    RE-PICK
                  </GeoButton>
                )}
              </div>
            )}
            <GeoButton variant="red" fullWidth onClick={cancelPlacement} coreStyle={{ padding: '4px 8px', fontSize: '10px' }}>
              CANCEL TACTICAL
            </GeoButton>
          </div>
        )}
      </div>
    </GeoCard>
  );
};
