import React from 'react';
import { useViewportContext } from '../../../context/ViewportContext';
import { GeoButton, GeoCard } from '../../ui/GeoPrimitives';

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', fontWeight: 700, color: 'var(--op-ink)' }}>
    <span className="geo-chip" style={{ width: '10px', height: '10px', background: color, display: 'inline-block' }} />
    {label}
  </span>
);

export const MapControls = () => {
  const { viewport } = useViewportContext();

  const handleZoomIn = () => {
    if (!viewport) return;
    viewport.animate({
      time: 350,
      scale: viewport.scale.x * 1.4,
      ease: 'easeInOutQuad',
    });
  };

  const handleZoomOut = () => {
    if (!viewport) return;
    viewport.animate({
      time: 350,
      scale: viewport.scale.x * 0.72,
      ease: 'easeInOutQuad',
    });
  };

  const handleReset = () => {
    if (!viewport) return;
    viewport.plugins.remove('animate');
    viewport.fit();
    viewport.moveCenter(viewport.worldWidth / 2, viewport.worldHeight / 2);
  };

  return (
    <GeoCard style={{ width: '100%' }}>
      <div
        style={{
          padding: '5px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        {/* Quick Battle Color Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <Swatch color="#1D5EFF" label="Move" />
          <Swatch color="#D93829" label="Attack" />
          <Swatch color="#FF9500" label="Overwatch / Action" />
          <Swatch color="#009153" label="Spawn" />
        </div>

        {/* Tactile Chamfered Camera Keys */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <GeoButton onClick={handleZoomOut} title="Zoom Out (-)" coreStyle={{ padding: '4px 11px' }}>
            -
          </GeoButton>
          <GeoButton onClick={handleReset} variant="softBlue" title="Reset View" coreStyle={{ padding: '4px 11px' }}>
            RESET VIEW
          </GeoButton>
          <GeoButton onClick={handleZoomIn} title="Zoom In (+)" coreStyle={{ padding: '4px 11px' }}>
            +
          </GeoButton>
        </div>

        {/* Navigation Tip */}
        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)', fontFamily: 'monospace' }}>
          WASD / Drag • Scroll
        </div>
      </div>
    </GeoCard>
  );
};
