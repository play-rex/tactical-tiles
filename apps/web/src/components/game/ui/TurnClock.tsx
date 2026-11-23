import React, { useEffect, useReducer } from 'react';
import { useOnline } from '../../../net/useOnline';

/** Live turn-clock reading. Null outside online play. Ticks 4x/sec while a clock runs. */
export const useTurnClock = () => {
  const clock = useOnline(s => s.view?.turnClock);
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => {
    if (!clock) return;
    const id = window.setInterval(force, 250);
    return () => window.clearInterval(id);
  }, [clock?.turnKey, clock?.deadline]);
  if (!clock) return null;
  const total = Math.max(1, clock.deadline - clock.sentAt);
  const left = Math.max(0, clock.deadline - Date.now());
  return { clock, total, left, frac: Math.min(1, left / total), secs: Math.ceil(left / 1000), urgent: left <= 10000 };
};

/** Compact chip: countdown + per-action bonus. For the top bar and panel headers. */
export const TurnClockLine: React.FC = React.memo(() => {
  const t = useTurnClock();
  if (!t) return null;
  return (
    <span
      className="geo-chip"
      title={'Turn clock: ' + t.clock.baseS + 's +' + t.clock.incrementS + 's per action'}
      style={{
        background: t.urgent ? 'var(--acc-red)' : 'var(--op-ink)',
        color: '#fff',
        padding: '3px 9px',
        fontSize: '12px',
        fontWeight: 900,
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {'\u23F1 ' + t.secs + 's'}
    </span>
  );
});

/** Thin depleting time bar. Color inherits --turn-color (player color, red when urgent). */
export const TurnClockBar: React.FC<{ height?: number }> = React.memo(({ height = 4 }) => {
  const t = useTurnClock();
  if (!t) return null;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(t.frac * 100)}
      aria-label={'Turn time left: ' + t.secs + ' seconds'}
      style={{ height, borderRadius: 2, background: 'rgba(20,24,33,0.12)', overflow: 'hidden', flexShrink: 0 }}
    >
      <div
        style={{
          width: (t.frac * 100).toFixed(1) + '%',
          height: '100%',
          borderRadius: 2,
          background: 'var(--turn-color, var(--op-ink))',
          transition: 'width 0.25s linear',
        }}
      />
    </div>
  );
});

/**
 * Rendered once inside the active player card. Shows countdown + bar under the header
 * and drives the card rim as a time ring: sets --turn-frac / --turn-urgent on the card
 * so the glowing border depletes with the clock instead of looping.
 */
export const ActiveTurnClock: React.FC<{ color: string }> = React.memo(({ color }) => {
  const t = useTurnClock();
  const ref = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = ref.current?.closest('.geo-drop') as HTMLElement | null;
    if (!card) return;
    if (t) {
      card.classList.add('geo-turn-timed');
      card.style.setProperty('--turn-frac', t.frac.toFixed(3));
      card.style.setProperty('--turn-color', t.urgent ? '#D93829' : color);
    } else {
      card.classList.remove('geo-turn-timed');
      card.style.removeProperty('--turn-frac');
    }
  });
  if (!t) return <span ref={ref} style={{ display: 'none' }} />;
  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          className="geo-chip"
          style={{
            background: t.urgent ? 'var(--acc-red)' : 'var(--op-ink)',
            color: '#fff',
            padding: '2px 8px',
            fontSize: '12px',
            fontWeight: 900,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {'\u23F1 ' + t.secs + 's left +' + t.clock.incrementS + '/move'}
        </span>
      </div>
      <TurnClockBar />
    </div>
  );
});
