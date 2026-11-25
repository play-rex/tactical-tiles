import React from 'react';
import { TACTICAL_ITEMS } from '@tactical/engine';
import type { TacticalId } from '@tactical/engine/types';
import { TACTICAL_VISUAL_STYLE } from '../../../core/graphics/TacticalAssets';
import { useGameStore } from '../../../store/useGameStore';
import { TacticalWeaponIcon } from '../../ui/TacticalShop';

/**
 * Standardized compact targeting bar shown at the top-center of the battlefield whenever any
 * targetable Tactical Weapon is armed. Gives every weapon the same predictable layout:
 * [Icon + Name] [Progress/Shape Pill] [Clear 1-Line Instruction] [Inline Controls + Cancel].
 */
export const TacticalTargetingBar: React.FC = React.memo(() => {
  const placementMode = useGameStore(s => s.placementMode);
  const isAiTurn = useGameStore(s => s.isAiTurn);
  const winner = useGameStore(s => s.winner);
  const settings = useGameStore(s => s.settings);
  const setTacticalAxis = useGameStore(s => s.setTacticalAxis);
  const confirmTacticalStrike = useGameStore(s => s.confirmTacticalStrike);
  const resetParadropPick = useGameStore(s => s.resetParadropPick);
  const cancelPlacement = useGameStore(s => s.cancelPlacement);

  if (!placementMode?.active || placementMode.kind !== 'TACTICAL' || isAiTurn || winner !== null) {
    return null;
  }

  const itemKey = placementMode.itemKey as TacticalId;
  const def = TACTICAL_ITEMS[itemKey];
  if (!def) return null;

  const visual = TACTICAL_VISUAL_STYLE[itemKey];
  const isDirectional = def.shape === 'LINE4' || def.shape === 'LANE';
  const axis = placementMode.tacticalAxis ?? 'H';
  const carpetPicked = def.shape === 'UNITS3' ? (placementMode.selectedTiles?.length ?? 0) : 0;
  const paradropStep2 = def.shape === 'RELOCATE' && Boolean(placementMode.tacticalUnitId);
  const legalCount = placementMode.validTiles.length;

  let statusPill = `${legalCount} LEGAL`;
  let prompt = 'Click a lit target to fire';

  if (def.shape === 'UNIT') {
    statusPill = `${legalCount} ENEM${legalCount === 1 ? 'Y' : 'IES'}`;
    prompt =
      itemKey === 'PRECISION_STRIKE'
        ? 'Pick 1 lit enemy unit for 75% current HP (min 2 HP)'
        : settings.fogOfWar
          ? 'Pick 1 lit enemy unit (40% current HP · min 2 HP + 3R sensor)'
          : 'Pick 1 lit enemy unit for 40% current HP (min 2 HP)';
  } else if (def.shape === 'UNITS3') {
    statusPill = `${carpetPicked}/3 LOCKED`;
    prompt =
      carpetPicked === 0
        ? 'Pick 1–3 lit enemy units (50% current HP each · min 2 HP)'
        : 'Pick more enemies or press SPACE / FIRE';
  } else if (def.shape === 'RELOCATE') {
    statusPill = paradropStep2 ? `STEP 2/2 · ${legalCount} LZ` : `STEP 1/2 · ${legalCount} UNITS`;
    prompt = paradropStep2
      ? 'Click any lit ground tile to drop unit'
      : 'Click any lit unit (ally or enemy) to airlift';
  } else if (itemKey === 'SABOTAGE') {
    statusPill = `${legalCount} TARGET${legalCount === 1 ? '' : 'S'}`;
    prompt = 'Click a lit enemy HQ (-8 CP) or specialized building (Strip)';
  } else if (def.shape === 'LANE') {
    statusPill = `2×10 ${axis}`;
    prompt = 'Aim 2×10 barrage (50% HP · min 2 HP · FF ON) · SPACE flips H/V';
  } else if (def.shape === 'LINE4') {
    statusPill = `1×4 ${axis}`;
    prompt = 'Aim 4-tile fire (40% + 20% burn · min 2 HP · FF ON) · SPACE flips H/V';
  } else if (def.shape === 'ZONE3') {
    statusPill = '3×3 CLOUD';
    prompt = 'Click a lit tile to drop 3×3 LOS-blocking smoke';
  }

  return (
    <div
      className="tt-tacbar"
      role="region"
      aria-label={`${def.name} targeting controls`}
      style={{ '--tac-accent': visual?.primaryHex ?? '#38BDF8' } as React.CSSProperties}
    >
      <span className="tt-tacbar__title">
        <TacticalWeaponIcon itemKey={itemKey} size={13} />
        <span>{def.name}</span>
      </span>

      <span className="tt-tacbar__badge">{statusPill}</span>
      <span className="tt-tacbar__hint">{prompt}</span>

      <div className="tt-tacbar__actions">
        {isDirectional && (
          <>
            <button
              type="button"
              className={`tt-tacbar__btn${axis === 'H' ? ' tt-tacbar__btn--active' : ''}`}
              onClick={() => setTacticalAxis('H')}
              aria-pressed={axis === 'H'}
              title="Horizontal orientation (Space to toggle)"
            >
              H
            </button>
            <button
              type="button"
              className={`tt-tacbar__btn${axis === 'V' ? ' tt-tacbar__btn--active' : ''}`}
              onClick={() => setTacticalAxis('V')}
              aria-pressed={axis === 'V'}
              title="Vertical orientation (Space to toggle)"
            >
              V
            </button>
          </>
        )}

        {def.shape === 'UNITS3' && carpetPicked > 0 && (
          <button
            type="button"
            className="tt-tacbar__btn tt-tacbar__btn--active"
            onClick={confirmTacticalStrike}
            title="Launch bomber salvo at locked targets (Space)"
          >
            FIRE ({carpetPicked}/3)
          </button>
        )}

        {paradropStep2 && (
          <button
            type="button"
            className="tt-tacbar__btn"
            onClick={resetParadropPick}
            title="Choose a different unit to airlift"
          >
            RE-PICK
          </button>
        )}

        <button
          type="button"
          className="tt-tacbar__btn tt-tacbar__btn--cancel"
          onClick={cancelPlacement}
          title="Cancel tactical targeting (Esc or Right-Click)"
        >
          CANCEL
        </button>
      </div>
    </div>
  );
});
