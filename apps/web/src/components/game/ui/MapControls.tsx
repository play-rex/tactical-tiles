import React from 'react';
import { useViewportContext } from '../../../context/ViewportContext';
import { useGameStore } from '../../../store/useGameStore';
import { wakeBattleRenderer } from '../../../store/useEffectStore';
import { GeoButton, GeoCard } from '../../ui/GeoPrimitives';
import { frameMap } from '../renderer/GameViewport';

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: 'var(--op-ink)' }}>
    <span className="geo-chip" style={{ width: '10px', height: '10px', background: color, display: 'inline-block' }} />
    {label}
  </span>
);

const fitViewport = (viewport: ReturnType<typeof useViewportContext>['viewport']) => {
  if (!viewport || viewport.destroyed) return;
  wakeBattleRenderer(450);
  viewport.plugins.remove('animate');
  frameMap(viewport);
};

/** What the turn buttons need: whether you can act and how many of your units still can. */
const useTurnControls = () => {
  const readyUnitCount = useGameStore(state => {
    let count = 0;
    for (const u of state.units) {
      if (u.owner === state.currentPlayer && !u.completed) count++;
    }
    return count;
  });
  const isMyTurn = useGameStore(state => !state.isAiTurn && state.winner === null);
  const canUndoMove = useGameStore(
    state => state.mode === 'LOCAL' && state.lastMoveSnapshot !== null && !state.isAiTurn && state.winner === null && !state.settings.fogOfWar
  );
  const endTurn = useGameStore(state => state.endTurn);
  const selectNextReadyUnit = useGameStore(state => state.selectNextReadyUnit);
  const undoLastMove = useGameStore(state => state.undoLastMove);
  return { isMyTurn, readyUnitCount, canUndoMove, endTurn, selectNextReadyUnit, undoLastMove };
};

/** Under-map Cursor-Zone Dock pairing Legend + Camera Keys with Turn Controls. */
export const MapControls: React.FC = () => {
  const { viewport } = useViewportContext();
  const { isMyTurn, readyUnitCount, canUndoMove, endTurn, selectNextReadyUnit, undoLastMove } = useTurnControls();

  const handleZoomIn = () => {
    if (!viewport || viewport.destroyed) return;
    wakeBattleRenderer(500);
    viewport.animate({
      time: 350,
      scale: viewport.scale.x * 1.4,
      ease: 'easeInOutQuad',
    });
  };

  const handleZoomOut = () => {
    if (!viewport || viewport.destroyed) return;
    wakeBattleRenderer(500);
    viewport.animate({
      time: 350,
      scale: viewport.scale.x * 0.72,
      ease: 'easeInOutQuad',
    });
  };

  const handleReset = () => fitViewport(viewport);

  return (
    <GeoCard style={{ width: '100%', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Row 1: Color Legend + Navigation Shortcut Strip */}
        <div
          style={{
            padding: '4px 12px',
            borderBottom: '1px solid var(--op-line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <Swatch color="#0284C7" label="Move Zone" />
            <Swatch color="#EF4444" label="Attack Reticle" />
            <Swatch color="#FF9500" label="Overwatch / Action" />
            <Swatch color="#009153" label="Spawn" />
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)', fontFamily: 'monospace' }}>
            WASD / Drag • Scroll{canUndoMove ? ' • Z Undo' : ''}
          </div>
        </div>

        {/* Row 2: Camera Controls (Left) + Turn Ergonomics (Right Below Board) */}
        <div
          style={{
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <GeoButton onClick={handleZoomOut} title="Zoom Out (-)" coreStyle={{ padding: '5px 10px' }}>
              -
            </GeoButton>
            <GeoButton onClick={handleReset} variant="softBlue" title="Fit Entire Map" coreStyle={{ padding: '5px 10px' }}>
              RESET VIEW
            </GeoButton>
            <GeoButton onClick={handleZoomIn} title="Zoom In (+)" coreStyle={{ padding: '5px 10px' }}>
              +
            </GeoButton>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
            <div style={{ width: '1px', height: '24px', background: 'var(--op-line)', marginRight: '4px' }} />
            {canUndoMove && (
              <GeoButton
                variant="softAmber"
                onClick={undoLastMove}
                title="Undo Last Move (Shortcut: Z)"
                coreStyle={{ padding: '6px 10px', whiteSpace: 'nowrap' }}
              >
                ↶ UNDO • Z
              </GeoButton>
            )}
            <GeoButton
              variant={isMyTurn && readyUnitCount > 0 ? 'softBlue' : 'default'}
              disabled={!isMyTurn || readyUnitCount === 0}
              onClick={selectNextReadyUnit}
              title="Select Next Ready Unit (Shortcut: Tab)"
              coreStyle={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              NEXT ({readyUnitCount}) • TAB
            </GeoButton>

            <GeoButton
              variant={isMyTurn ? (readyUnitCount === 0 ? 'amber' : 'mint') : 'default'}
              disabled={!isMyTurn}
              onClick={endTurn}
              coreStyle={{
                padding: '7px 18px',
                fontSize: '13px',
                fontWeight: 900,
                letterSpacing: '0.7px',
                whiteSpace: 'nowrap',
              }}
            >
              {isMyTurn ? (readyUnitCount === 0 ? 'DONE • END TURN →' : 'END TURN →') : 'ENEMY TURN...'}
            </GeoButton>
          </div>
        </div>
      </div>
    </GeoCard>
  );
};

type Sheet = 'SQUADS' | 'INTEL' | null;

/**
 * The phone's bottom bar: open squads & shop or intel & log, fit the map back in view, and
 * the turn buttons. Pinch and drag move the map.
 */
export const PhoneDock: React.FC<{ sheet: Sheet; onSheet: (s: Exclude<Sheet, null>) => void }> = ({ sheet, onSheet }) => {
  const { viewport } = useViewportContext();
  const { isMyTurn, readyUnitCount, canUndoMove, endTurn, selectNextReadyUnit, undoLastMove } = useTurnControls();
  const unitSelected = useGameStore(state => state.selectedUnitId !== null || state.selectedTileId !== null);

  const fit = () => fitViewport(viewport);
  const tab = (id: Exclude<Sheet, null>, label: string, dot = false) => (
    <GeoButton
      variant={sheet === id ? 'blue' : 'default'}
      onClick={() => onSheet(id)}
      aria-pressed={sheet === id}
      coreStyle={{ padding: '8px 10px', position: 'relative' }}
    >
      {label}
      {dot && sheet !== id && (
        <span
          aria-hidden
          style={{ position: 'absolute', top: '3px', right: '3px', width: '7px', height: '7px', borderRadius: '50%', background: 'var(--acc-amber)' }}
        />
      )}
    </GeoButton>
  );

  return (
    <GeoCard style={{ width: '100%', flexShrink: 0 }}>
      <div style={{ padding: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {tab('SQUADS', 'SQUADS')}
        {tab('INTEL', 'INTEL', unitSelected)}
        <GeoButton onClick={fit} title="Fit the whole map" coreStyle={{ padding: '8px 10px' }}>
          FIT
        </GeoButton>
        <span style={{ flex: 1 }} />
        {canUndoMove && (
          <GeoButton
            variant="softAmber"
            onClick={undoLastMove}
            title="Undo last non-combat move"
            coreStyle={{ padding: '8px 10px', fontWeight: 900 }}
          >
            ↶
          </GeoButton>
        )}
        <GeoButton
          variant={isMyTurn && readyUnitCount > 0 ? 'softBlue' : 'default'}
          disabled={!isMyTurn || readyUnitCount === 0}
          onClick={selectNextReadyUnit}
          title="Select the next unit that can still act"
          coreStyle={{ padding: '8px 10px', whiteSpace: 'nowrap' }}
        >
          NEXT ({readyUnitCount})
        </GeoButton>
        <GeoButton
          variant={isMyTurn ? (readyUnitCount === 0 ? 'amber' : 'mint') : 'default'}
          disabled={!isMyTurn}
          onClick={endTurn}
          coreStyle={{ padding: '8px 12px', fontWeight: 900, whiteSpace: 'nowrap' }}
        >
          {isMyTurn ? (readyUnitCount === 0 ? 'DONE • END TURN' : 'END TURN') : 'WAITING'}
        </GeoButton>
      </div>
    </GeoCard>
  );
};
