import React, { useCallback, useEffect, useRef } from 'react';
import { Container, Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { BoardRotation } from '../../../core/boardRotation';
import {
  fxTimeline,
  getPrefersReducedMotion,
  subscribeReducedMotion,
} from '../../../core/graphics/fxTimeline';
import {
  useEffectStore,
  type PromotionBurst,
  type SupplyDropAnim,
} from '../../../store/useEffectStore';

const SupplyDropSprite: React.FC<{ data: SupplyDropAnim; mapRotation: BoardRotation }> = React.memo(
  ({ data, mapRotation }) => {
    const gfxRef = useRef<PIXI.Graphics>(null);
    const elapsedRef = useRef(0);
    const reducedMotionRef = useRef<boolean>(getPrefersReducedMotion());

    useEffect(() => {
      reducedMotionRef.current = getPrefersReducedMotion();
      return subscribeReducedMotion((reduced) => {
        reducedMotionRef.current = reduced;
      });
    }, []);

    const initialDraw = useCallback((g: PIXI.Graphics) => {
      g.clear();
    }, []);

    useTick(() => {
      const g = gfxRef.current;
      if (!g || g.destroyed) return;

      const dtMs = fxTimeline.getLastCombatDtMs();
      elapsedRef.current += dtMs;
      const duration = Math.max(250, data.durationMs || 720);
      const t = Math.min(1, elapsedRef.current / duration);

      g.clear();
      if (t >= 1) return;

      // Smooth ease-out descent in viewer-upright local coordinates (counter-rotated by -mapRotation)
      const descendEase = 1 - Math.pow(1 - t, 2.2);
      const altitude = (1 - descendEase) * 76;
      const sway = reducedMotionRef.current ? 0 : Math.sin(t * Math.PI * 3.5) * (1 - t) * 7.5;

      // 1. Growing ground shadow centered on tile (0, 0)
      const shadowScale = 0.35 + descendEase * 0.65;
      g.beginFill(0x0F172A, 0.16 + descendEase * 0.28);
      g.drawEllipse(0, 8, 13 * shadowScale, 6.5 * shadowScale);
      g.endFill();

      // 2. Parachute canopy & shroud lines (collapse cleanly in final 18% after touchdown)
      const canopyFade = t < 0.82 ? 1 : Math.max(0, 1 - (t - 0.82) / 0.18);
      const crateX = sway * 0.45;
      const crateY = -altitude;
      const canopyX = sway;
      const canopyY = crateY - 26;

      if (canopyFade > 0.02) {
        // Twin shroud lines
        g.lineStyle(1.3, 0xE2E8F0, 0.85 * canopyFade);
        g.moveTo(crateX - 6, crateY - 6);
        g.lineTo(canopyX - 15, canopyY + 2);
        g.moveTo(crateX + 6, crateY - 6);
        g.lineTo(canopyX + 15, canopyY + 2);
        g.moveTo(crateX, crateY - 6);
        g.lineTo(canopyX, canopyY - 1);
        g.lineStyle(0);

        // Billowing white-cyan parachute dome
        g.beginFill(0xF8FAFC, 0.94 * canopyFade);
        g.arc(canopyX, canopyY + 4, 17 * (0.75 + 0.25 * canopyFade), Math.PI, 0);
        g.closePath();
        g.endFill();

        g.beginFill(0x22D3EE, 0.78 * canopyFade);
        g.arc(canopyX, canopyY + 4, 17 * (0.75 + 0.25 * canopyFade), Math.PI * 1.32, Math.PI * 1.68);
        g.lineTo(canopyX, canopyY + 4);
        g.closePath();
        g.endFill();

        g.lineStyle(1.5, 0x0E7490, 0.8 * canopyFade);
        g.arc(canopyX, canopyY + 4, 17 * (0.75 + 0.25 * canopyFade), Math.PI, 0);
        g.lineStyle(0);
      }

      // 3. Tactical supply crate (color-coded emblem by item type)
      const emblemColor = data.item === 'AMMO' ? 0xFACC15 : 0x22C55E;
      const crateFade = t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1;
      g.lineStyle(1.8, 0x0F172A, 0.95 * crateFade);
      g.beginFill(0x1E293B, 0.96 * crateFade);
      g.drawRoundedRect(crateX - 9, crateY - 8, 18, 16, 3);
      g.endFill();
      g.lineStyle(0);

      // Gold trim band + item icon
      g.beginFill(emblemColor, 0.96 * crateFade);
      if (data.item === 'AMMO') {
        g.drawRect(crateX - 5, crateY - 4, 2.5, 8);
        g.drawRect(crateX - 1.2, crateY - 4, 2.5, 8);
        g.drawRect(crateX + 2.6, crateY - 4, 2.5, 8);
      } else {
        // Medical cross
        g.drawRect(crateX - 1.8, crateY - 5, 3.6, 10);
        g.drawRect(crateX - 5, crateY - 1.8, 10, 3.6);
      }
      g.endFill();
    });

    const cx = data.x + TILE_SIZE / 2;
    const cy = data.y + TILE_SIZE / 2;

    return (
      <Container x={cx} y={cy} angle={-mapRotation} eventMode="none">
        <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />
      </Container>
    );
  },
);

const PromotionChevronSprite: React.FC<{ data: PromotionBurst; mapRotation: BoardRotation }> = React.memo(
  ({ data, mapRotation }) => {
    const gfxRef = useRef<PIXI.Graphics>(null);
    const elapsedRef = useRef(0);
    const reducedMotionRef = useRef<boolean>(getPrefersReducedMotion());

    useEffect(() => {
      reducedMotionRef.current = getPrefersReducedMotion();
      return subscribeReducedMotion((reduced) => {
        reducedMotionRef.current = reduced;
      });
    }, []);

    const initialDraw = useCallback((g: PIXI.Graphics) => {
      g.clear();
    }, []);

    useTick(() => {
      const g = gfxRef.current;
      if (!g || g.destroyed) return;

      const dtMs = fxTimeline.getLastCombatDtMs();
      elapsedRef.current += dtMs;
      const duration = Math.max(300, data.durationMs || 780);
      const t = Math.min(1, elapsedRef.current / duration);

      g.clear();
      if (t >= 1) return;

      const alpha = t < 0.14 ? t / 0.14 : Math.max(0, 1 - Math.pow((t - 0.14) / 0.86, 1.8));
      const easeOut = 1 - Math.pow(1 - t, 2.3);
      const isAce = data.rank >= 3;

      // Expanding golden promotion aura ring
      const ringR = 14 + easeOut * (isAce ? 28 : 22);
      g.lineStyle(isAce ? 3.2 : 2.4, 0xFACC15, alpha * 0.9);
      g.drawCircle(0, 0, ringR);
      g.lineStyle(1.4, 0xFFFBEB, alpha * 0.78);
      g.drawCircle(0, 0, ringR * 0.76);

      // Rising golden military chevrons (1, 2, or 3 stacked based on earned rank)
      const rise = reducedMotionRef.current ? -6 : 6 - easeOut * 28;
      const count = Math.max(1, Math.min(3, data.rank));
      const w = isAce ? 13 : 11;
      for (let i = 0; i < count; i++) {
        const cy = rise - i * 7.5;
        // Dark crisp halo for high contrast on bright maps
        g.lineStyle(4.6, 0x78350F, alpha * 0.85);
        g.moveTo(-w, cy + 5);
        g.lineTo(0, cy - 3);
        g.lineTo(w, cy + 5);
        // Bright gold chevron
        g.lineStyle(2.8, 0xFDE047, alpha);
        g.moveTo(-w, cy + 5);
        g.lineTo(0, cy - 3);
        g.lineTo(w, cy + 5);
      }

      // Extra golden star flare for Rank 3 Ace promotions
      if (isAce) {
        const starY = rise - count * 7.5 - 5;
        const rOuter = 6.5 * (0.7 + 0.3 * (1 - t));
        g.lineStyle(0);
        g.beginFill(0xFFFBEB, alpha);
        g.drawPolygon([
          0, starY - rOuter,
          rOuter * 0.42, starY - rOuter * 0.42,
          rOuter, starY,
          rOuter * 0.42, starY + rOuter * 0.42,
          0, starY + rOuter,
          -rOuter * 0.42, starY + rOuter * 0.42,
          -rOuter, starY,
          -rOuter * 0.42, starY - rOuter * 0.42,
        ]);
        g.endFill();
      }
      g.lineStyle(0);
    });

    return (
      <Container x={data.x} y={data.y} angle={-mapRotation} eventMode="none">
        <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />
      </Container>
    );
  },
);

/** Renders parachute supply drop descents and golden unit promotion chevron bursts. */
export const DropAndPromoLayer: React.FC<{ mapRotation: BoardRotation }> = React.memo(({ mapRotation }) => {
  const supplyDrops = useEffectStore(state => state.supplyDrops);
  const promotionBursts = useEffectStore(state => state.promotionBursts);
  if (supplyDrops.length === 0 && promotionBursts.length === 0) return null;

  return (
    <Container name="drops_and_promotions" eventMode="none">
      {supplyDrops.map(drop => (
        <SupplyDropSprite key={drop.id} data={drop} mapRotation={mapRotation} />
      ))}
      {promotionBursts.map(burst => (
        <PromotionChevronSprite key={burst.id} data={burst} mapRotation={mapRotation} />
      ))}
    </Container>
  );
});
