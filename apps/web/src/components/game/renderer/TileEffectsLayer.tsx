import React, { useCallback, useRef } from 'react';
import { Container, Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { fxTimeline } from '../../../core/graphics/fxTimeline';
import { useEffectStore, type TileEffect } from '../../../store/useEffectStore';

const SCORCH_SPECKS = [
  { ang: 0.4, r: 17, sz: 4.5 },
  { ang: 1.5, r: 20, sz: 3.5 },
  { ang: 2.6, r: 16, sz: 5 },
  { ang: 3.9, r: 21, sz: 3.8 },
  { ang: 5.1, r: 18, sz: 4.2 },
] as const;

const TileEffectItem: React.FC<{ data: TileEffect }> = React.memo(({ data }) => {
  const gfxRef = useRef<PIXI.Graphics>(null);
  const elapsedRef = useRef(0);

  const initialDraw = useCallback((g: PIXI.Graphics) => {
    g.clear();
  }, []);

  useTick(() => {
    const g = gfxRef.current;
    if (!g || g.destroyed) return;

    const dtMs = fxTimeline.getLastCombatDtMs();
    elapsedRef.current += dtMs;
    const elapsed = elapsedRef.current;
    const duration = Math.max(150, data.durationMs);
    const t = Math.min(1, elapsed / duration);

    g.clear();
    if (t >= 1) return;

    const cx = data.x + TILE_SIZE / 2;
    const cy = data.y + TILE_SIZE / 2;
    const scale = data.scale ?? 1;

    switch (data.kind) {
      case 'mineFlash': {
        // Multi-stage Land Mine bomb-blast animation (WCAG 2.3.1 single-pulse smooth decay):
        // hot white-gold core -> jagged fiery blast starburst -> double concussive shockwaves
        const ease = Math.pow(1 - t, 1.65);
        const burst = 1 - Math.pow(1 - Math.min(1, t * 2.2), 2.6);

        // 1. Warm crimson/orange tile blast wash
        g.beginFill(data.color, 0.52 * ease);
        g.drawRect(data.x + 2, data.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.endFill();

        // 2. Jagged 10-point fiery starburst tearing radially outward (0..62%)
        if (t < 0.62) {
          const starFade = Math.pow(1 - t / 0.62, 1.45);
          const outerR = (13 + burst * 28) * scale;
          const innerR = (6 + burst * 11) * scale;
          const spikes = 10;
          g.beginFill(0xF97316, 0.88 * starFade);
          for (let i = 0; i < spikes * 2; i++) {
            const ang = (Math.PI * i) / spikes + 0.18;
            const jitter = i % 2 === 0 ? (i % 4 === 0 ? 1.12 : 0.9) : 0.92;
            const r = (i % 2 === 0 ? outerR : innerR) * jitter;
            const px = cx + Math.cos(ang) * r;
            const py = cy + Math.sin(ang) * r;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.endFill();

          // Hot yellow inner blast star
          const hotOuter = outerR * 0.66;
          const hotInner = innerR * 0.62;
          g.beginFill(0xFEF08A, 0.92 * starFade);
          for (let i = 0; i < spikes * 2; i++) {
            const ang = (Math.PI * i) / spikes + 0.34;
            const r = i % 2 === 0 ? hotOuter : hotInner;
            const px = cx + Math.cos(ang) * r;
            const py = cy + Math.sin(ang) * r;
            if (i === 0) g.moveTo(px, py);
            else g.lineTo(px, py);
          }
          g.closePath();
          g.endFill();
        }

        // 3. Incandescent white-gold detonation core (0..38%)
        if (t < 0.38) {
          const coreFade = Math.pow(1 - t / 0.38, 1.8);
          g.beginFill(0xFFFBEB, 0.96 * coreFade);
          g.drawCircle(cx, cy, (9 + t * 24) * scale);
          g.endFill();
        }

        // 4. Double expanding concussive shockwave rings (0..92%)
        const ringEase = 1 - Math.pow(1 - t, 2.2);
        g.lineStyle(3.2 * ease, 0xFEF08A, 0.94 * ease);
        g.drawCircle(cx, cy, (10 + ringEase * 28) * scale);
        g.lineStyle(2.4 * ease, 0xEF4444, 0.85 * ease);
        g.drawCircle(cx, cy, (14 + ringEase * 36) * scale);

        const pad = 2 - t * 6;
        g.lineStyle(2.4 * ease, 0xFCA5A5, 0.72 * ease);
        g.drawRect(data.x + pad, data.y + pad, TILE_SIZE - pad * 2, TILE_SIZE - pad * 2);
        g.lineStyle(0);
        break;
      }

      case 'scorch': {
        // Hold dark soot decal for first 45% then gently fade away so battlefield stays clean
        const fade = t < 0.45 ? 1 : Math.max(0, 1 - (t - 0.45) / 0.55);
        const alpha = fade * fade;

        // Soft outer soot bloom
        g.beginFill(0x0F172A, 0.34 * alpha);
        g.drawCircle(cx, cy, 24 * scale);
        g.endFill();

        // Dark charred inner crater
        g.beginFill(0x020617, 0.5 * alpha);
        g.drawCircle(cx, cy, 13.5 * scale);
        g.endFill();

        // Radial char flecks
        g.beginFill(0x1E293B, 0.44 * alpha);
        for (let i = 0; i < SCORCH_SPECKS.length; i++) {
          const sp = SCORCH_SPECKS[i];
          g.drawCircle(
            cx + Math.cos(sp.ang) * sp.r * scale,
            cy + Math.sin(sp.ang) * sp.r * scale,
            sp.sz * scale,
          );
        }
        g.endFill();

        // Initial hot cooling ember rim (0..380ms)
        if (elapsed < 380) {
          const ember = 1 - elapsed / 380;
          g.lineStyle(2.4 * ember, data.color, 0.78 * ember * ember);
          g.drawCircle(cx, cy, (14 + (1 - ember) * 6) * scale);
          g.lineStyle(0);
        }
        break;
      }

      case 'captureWave': {
        const easeOut = 1 - Math.pow(1 - t, 2.2);
        const alpha = Math.max(0, 1 - t * t);
        const inset = 14 * (1 - easeOut) - 4 * easeOut;
        const size = TILE_SIZE - inset * 2;

        g.beginFill(data.color, 0.28 * alpha);
        g.drawRect(data.x + 2, data.y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.endFill();

        g.lineStyle(3.2 * (1 - t * 0.45), data.color, 0.95 * alpha);
        g.drawRect(data.x + inset, data.y + inset, size, size);
        g.lineStyle(1.5, 0xFFFFFF, 0.75 * alpha);
        g.drawRect(data.x + inset + 2, data.y + inset + 2, Math.max(4, size - 4), Math.max(4, size - 4));
        g.lineStyle(0);
        break;
      }

      case 'spawnBeam': {
        const easeOut = 1 - Math.pow(1 - t, 2.4);
        const alpha = Math.max(0, 1 - t * t);
        // Converging drop ring + expanding landing ripple
        const innerR = Math.max(4, (1 - easeOut) * 28);
        const outerR = 10 + easeOut * 24;

        g.beginFill(data.color, 0.24 * alpha);
        g.drawCircle(cx, cy, outerR);
        g.endFill();

        g.lineStyle(2.5, 0xFFFFFF, 0.9 * alpha);
        g.drawCircle(cx, cy, innerR);
        g.lineStyle(2.2, data.color, 0.9 * alpha);
        g.drawCircle(cx, cy, outerR);
        g.lineStyle(0);
        break;
      }
    }
  });

  return <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />;
});

/** Ground-plane FX layer (scorch craters, blast flashes, capture waves, drop beams) under units. */
export const TileEffectsLayer: React.FC = React.memo(() => {
  const tileEffects = useEffectStore(state => state.tileEffects);
  if (tileEffects.length === 0) return null;
  return (
    <Container name="tile_effects" eventMode="none">
      {tileEffects.map(fx => (
        <TileEffectItem key={fx.id} data={fx} />
      ))}
    </Container>
  );
});
