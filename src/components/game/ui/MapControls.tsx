import React from 'react';
import { useViewportContext } from '../../../context/ViewportContext';
import { useGameStore } from '../../../store/useGameStore';
import { wakeBattleRenderer } from '../../../store/useEffectStore';
import { GeoButton, GeoCard } from '../../ui/GeoPrimitives';

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: 'var(--op-ink)' }}>
    <span className="geo-chip" style={{ width: '10px', height: '10px', background: color, display: 'inline-block' }} />
    {label}
  </span>
);

/** Under-map Cursor-Zone Dock pairing Legend + Camera Keys with Turn Controls. */
export const MapControls: React.FC = () => {
  const { viewport } = useViewportContext();
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const isAiTurn = useGameStore(state => state.isAiTurn);
  const units = useGameStore(state => state.units);
  const endTurn = useGameStore(state => state.endTurn);
  const selectNextReadyUnit = useGameStore(state => state.selectNextReadyUnit);

  const isMyTurn = !isAiTurn;
  const readyUnitCount = units.filter(u => u.owner === currentPlayer && !u.completed).length;

  const handleZoomIn = () => {
    if (!viewport) return;
    wakeBattleRenderer(500);
    viewport.animate({
      time: 350,
      scale: viewport.scale.x * 1.4,
      ease: 'easeInOutQuad',
    });
  };

  const handleZoomOut = () => {
    if (!viewport) return;
    wakeBattleRenderer(500);
    viewport.animate({
      time: 350,
      scale: viewport.scale.x * 0.72,
      ease: 'easeInOutQuad',
    });
  };

  const handleReset = () => {
    if (!viewport) return;
    wakeBattleRenderer(450);
    viewport.plugins.remove('animate');
    viewport.fit();
    viewport.moveCenter(viewport.worldWidth / 2, viewport.worldHeight / 2);
  };

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
            <Swatch color="#1D5EFF" label="Move" />
            <Swatch color="#D93829" label="Attack" />
            <Swatch color="#FF9500" label="Overwatch / Action" />
            <Swatch color="#009153" label="Spawn" />
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)', fontFamily: 'monospace' }}>
            WASD / Drag • Scroll
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
            <GeoButton
              variant={isMyTurn && readyUnitCount > 0 ? 'softBlue' : 'default'}
              disabled={!isMyTurn || readyUnitCount === 0}
              onClick={selectNextReadyUnit}
              title="Select Next Ready Unit (Shortcut: Tab)"
              coreStyle={{ padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              NEXT UNIT ({readyUnitCount}) • TAB
            </GeoButton>

            <GeoButton
              variant={isMyTurn ? 'mint' : 'default'}
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
              {isMyTurn ? 'END TURN →' : 'ENEMY TURN...'}
            </GeoButton>
          </div>
        </div>
      </div>
    </GeoCard>
  );
};
