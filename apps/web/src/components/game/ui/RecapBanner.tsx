import React, { useEffect, useState } from 'react';
import { recapPlayer, type RecapStatus } from '../../../core/graphics/recapPlayer';

/**
 * Floating broadcast banner shown during "While You Were Away" Turn Recaps and
 * Play-of-the-Match replays, offering an instant 1-click SKIP/STOP button.
 */
export const RecapBanner: React.FC = () => {
  const [status, setStatus] = useState<RecapStatus>(() => recapPlayer.getStatus());

  useEffect(() => recapPlayer.subscribe(setStatus), []);

  if (!status.active) return null;

  const isFilm = status.kind === 'FILM';
  const isPotm = status.kind === 'POTM';

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        background: 'rgba(6, 10, 18, 0.92)',
        border: `1px solid ${isPotm ? 'rgba(250, 204, 21, 0.6)' : 'rgba(56, 189, 248, 0.55)'}`,
        boxShadow: '0 10px 28px -10px rgba(0,0,0,0.85)',
        color: '#F8FAFC',
        fontFamily: '"Space Grotesk", "Avenir Next", system-ui, sans-serif',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        backdropFilter: 'blur(4px)',
      }}
      role="status"
      aria-live="polite"
    >
      <span style={{ color: isPotm || isFilm ? '#FACC15' : '#38BDF8' }}>
        {isFilm
          ? `★ DRAMA REEL ${status.step}/${status.total} · ${status.label}`
          : isPotm
            ? '★ PLAY OF THE MATCH'
            : `▶ ${status.label} (${status.step}/${status.total})`}
      </span>
      {status.fastForward && (
        <span
          style={{
            padding: '2px 5px',
            background: 'rgba(56, 189, 248, 0.2)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            color: '#7DD3FC',
            fontSize: 9,
          }}
        >
          2.5×
        </span>
      )}
      <button
        type="button"
        onClick={() => recapPlayer.stop()}
        style={{
          padding: '3px 8px',
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid rgba(248, 113, 113, 0.55)',
          color: '#FECACA',
          fontFamily: 'inherit',
          fontSize: 9,
          fontWeight: 900,
          letterSpacing: '0.18em',
          cursor: 'pointer',
        }}
      >
        {isFilm ? 'SKIP' : isPotm ? 'CLOSE' : 'SKIP'}
      </button>
    </div>
  );
};
