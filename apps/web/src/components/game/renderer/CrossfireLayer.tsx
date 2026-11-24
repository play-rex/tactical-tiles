import React, { useRef, useCallback } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { CrossfireLock } from '../../../store/useEffectStore';
import { fxTimeline } from '../../../core/graphics/fxTimeline';

interface CrossfireBeamProps {
  data: CrossfireLock;
}

/**
 * Brief pulsing amber tactical sightlines linking each flanking Crossfire supporter
 * to the target during shot windup and impact so players immediately read why +2 DMG triggered.
 */
export const CrossfireBeam: React.FC<CrossfireBeamProps> = React.memo(({ data }) => {
  const gfxRef = useRef<PIXI.Graphics>(null);
  const elapsedRef = useRef(0);

  useTick(() => {
    const g = gfxRef.current;
    if (!g || g.destroyed) return;

    const dtMs = fxTimeline.getLastCombatDtMs();
    elapsedRef.current += dtMs;

    const totalMs = Math.max(180, data.durationMs);
    const t = elapsedRef.current / totalMs;
    g.clear();
    if (t >= 1) return;

    // Snappy ramp-in, bright lock hold, clean ease-out fade
    let alpha = 1;
    if (t < 0.14) alpha = t / 0.14;
    else if (t > 0.62) {
      const f = (t - 0.62) / 0.38;
      alpha = Math.max(0, 1 - f * f);
    }

    const tx = data.targetX;
    const ty = data.targetY;

    for (let i = 0; i < data.supporters.length; i++) {
      const sup = data.supporters[i];
      // Soft amber glow beam
      g.lineStyle(5, 0xF59E0B, alpha * 0.28);
      g.moveTo(sup.x, sup.y);
      g.lineTo(tx, ty);
      // Crisp tactical laser sightline
      g.lineStyle(1.8, 0xFEF08A, alpha * 0.92);
      g.moveTo(sup.x, sup.y);
      g.lineTo(tx, ty);
      // Supporter lock ring
      g.lineStyle(2, 0xF59E0B, alpha * 0.88);
      g.drawCircle(sup.x, sup.y, 22 - Math.min(1, t * 2) * 3);
    }

    // Converging diamond target lock on victim
    const lockRadius = 19 - Math.min(1, t * 1.8) * 6;
    g.lineStyle(2.5, 0xF59E0B, alpha * 0.95);
    g.moveTo(tx, ty - lockRadius);
    g.lineTo(tx + lockRadius, ty);
    g.lineTo(tx, ty + lockRadius);
    g.lineTo(tx - lockRadius, ty);
    g.closePath();
    g.lineStyle(0);
  });

  const initialDraw = useCallback((g: PIXI.Graphics) => {
    g.clear();
  }, []);

  return <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />;
});
