import React, { useCallback, useRef } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { fxTimeline } from '../../../core/graphics/fxTimeline';

const drawHex = (g: PIXI.Graphics, cx: number, cy: number, r: number, rot = 0) => {
  for (let i = 0; i < 6; i++) {
    const a = rot + (Math.PI / 3) * i;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
};

const drawDiamond = (g: PIXI.Graphics, cx: number, cy: number, r: number) => {
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r, cy);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r, cy);
  g.closePath();
};

/**
 * World-space tactical blueprint vector overlay rendered ABOVE the battlefield ColorMatrixFilter
 * so glowing cyan, crimson, and amber kill-cam schematics stay razor-sharp and full saturation
 * against the cooled recon-slate impact grade.
 *
 * Costs 0 GPU draw work during normal play (clears immediately when inactive).
 */
export const KillCamSchematicLayer: React.FC = React.memo(() => {
  const gfxRef = useRef<PIXI.Graphics>(null);
  const hadDrawRef = useRef(false);

  const initialDraw = useCallback((g: PIXI.Graphics) => {
    g.clear();
  }, []);

  useTick(() => {
    const g = gfxRef.current;
    if (!g || g.destroyed) return;

    const frame = fxTimeline.getKillCamFrame();
    if (!frame.active || !frame.cue || frame.schematicAlpha <= 0.01) {
      if (hadDrawRef.current) {
        g.clear();
        hadDrawRef.current = false;
      }
      return;
    }

    hadDrawRef.current = true;
    g.clear();

    const cue = frame.cue;
    const alpha = frame.schematicAlpha;
    const fx = cue.focusX;
    const fy = cue.focusY;
    const mx = cue.markerX;
    const my = cue.markerY;
    const dx = fx - mx;
    const dy = fy - my;
    const dist = Math.hypot(dx, dy);
    const ux = dist > 1 ? dx / dist : 1;
    const uy = dist > 1 ? dy / dist : 0;
    const px = -uy;
    const py = ux;

    // 1. LAND MINE ARM PHASE ("*click*"): blinking crimson pressure-plate LED under victim's boots
    if (frame.phase === 'ARM' && frame.cameraStyle === 'MINE_CLICK') {
      const p = frame.armProgress;
      const blink = Math.sin(p * Math.PI * 6) > -0.25 ? 1 : 0.35;
      g.lineStyle(2.5, 0xEF4444, 0.95 * blink);
      g.drawCircle(fx, fy, 10 + p * 18);
      g.lineStyle(1.6, 0xFCA5A5, 0.85 * blink);
      g.drawCircle(fx, fy, Math.max(4, 24 - p * 16));
      g.lineStyle(0);
      g.beginFill(0xEF4444, 0.95 * blink);
      g.drawCircle(fx, fy, 5.5);
      g.endFill();
      g.beginFill(0xFFFFFF, 0.95 * blink);
      g.drawCircle(fx, fy, 2.4);
      g.endFill();
      return;
    }

    // 2. 1-HP GRAZE FAKE-OUT: crimson tease -> electric amber/emerald cracked armor shield
    if (frame.cameraStyle === 'GRAZE_FAKEOUT') {
      if (!frame.grazeFlipped) {
        // Crimson kill-cam fake-out pulse during first 115ms
        g.lineStyle(3, 0xEF4444, 0.9 * alpha);
        drawDiamond(g, fx, fy, 28 - frame.impact * 8);
        g.lineStyle(0);
      } else {
        // Snapped to survival: glowing cracked hexagonal armor ring + sonar pulse
        const pulse = (frame.elapsedMs % 420) / 420;
        g.lineStyle(2.8, 0xFACC15, 0.95 * alpha);
        drawHex(g, fx, fy, 25, Math.PI / 6);
        g.lineStyle(1.8, 0x34D399, (1 - pulse) * 0.85 * alpha);
        g.drawCircle(fx, fy, 22 + pulse * 24);
        // Jagged crack line across the shield confirming "barely held!"
        g.lineStyle(2.2, 0xFFFFFF, 0.92 * alpha);
        g.moveTo(fx - 12, fy - 14);
        g.lineTo(fx - 3, fy - 3);
        g.lineTo(fx + 5, fy + 2);
        g.lineTo(fx + 13, fy + 14);
        g.lineStyle(0);
      }
      return;
    }

    // 3. BANK VAULT LOCK BLOWOUT: spinning & cracking golden tumbler ring
    if (cue.subject === 'STRUCTURE' && cue.structureType === 'BANK') {
      const spin = frame.elapsedMs * 0.0045;
      const expand = frame.impact * 14;
      g.lineStyle(2.6, 0xFACC15, 0.88 * alpha);
      g.drawCircle(fx, fy, 26 + expand);
      g.lineStyle(1.6, 0xFEF08A, 0.65 * alpha);
      g.drawCircle(fx, fy, 36 + expand * 1.3);
      for (let i = 0; i < 8; i++) {
        const a = spin + (Math.PI * 2 * i) / 8;
        const r0 = 20 + expand;
        const r1 = 34 + expand * 1.45;
        g.lineStyle(2.4, 0xFDE047, 0.9 * alpha);
        g.moveTo(fx + Math.cos(a) * r0, fy + Math.sin(a) * r0);
        g.lineTo(fx + Math.cos(a) * r1, fy + Math.sin(a) * r1);
      }
      g.lineStyle(0);
      return;
    }

    // 4. HQ STRUCTURE BREACH / DESTRUCTION: converging crimson tactical grid lock
    if (cue.subject === 'STRUCTURE') {
      const r = 34 + frame.impact * 10;
      g.lineStyle(2.2, 0xF87171, 0.85 * alpha);
      g.drawRect(fx - r, fy - r, r * 2, r * 2);
      g.lineStyle(1.5, 0x38BDF8, 0.65 * alpha);
      drawDiamond(g, fx, fy, r * 1.15);
      g.lineStyle(0);
      return;
    }

    // 5. CROSSFIRE TRIANGULATION POLYGON (attacker + all flanking allies -> victim)
    if (cue.crossfirePoints && cue.crossfirePoints.length > 0) {
      for (const sup of cue.crossfirePoints) {
        if (cue.hasVisibleOrigin !== false && dist > 10) {
          g.beginFill(0xF59E0B, 0.1 * alpha);
          g.drawPolygon([mx, my, sup.x, sup.y, fx, fy]);
          g.endFill();
        }
        g.lineStyle(4.5, 0xF59E0B, 0.25 * alpha);
        g.moveTo(sup.x, sup.y);
        g.lineTo(fx, fy);
        g.lineStyle(1.8, 0xFEF08A, 0.92 * alpha);
        g.moveTo(sup.x, sup.y);
        g.lineTo(fx, fy);
        // Supporter tactical ring
        g.lineStyle(2, 0xF59E0B, 0.88 * alpha);
        g.drawCircle(sup.x, sup.y, 24);
      }
      g.lineStyle(0);
    }

    // 6. BALLISTIC TRAJECTORY & RANGE RULER (strictly when shooter origin is visible!)
    if (cue.hasVisibleOrigin !== false && dist > 20) {
      const lineColor =
        cue.weapon === 'SNIPER'
          ? 0xFB7185
          : cue.cause === 'OVERWATCH'
            ? 0xF59E0B
            : 0x38BDF8;

      // Soft vector glow + crisp dashed blueprint trajectory
      g.lineStyle(5, lineColor, 0.18 * alpha);
      g.moveTo(mx, my);
      g.lineTo(fx, fy);

      const dashLen = 10;
      const gapLen = 7;
      const step = dashLen + gapLen;
      g.lineStyle(1.8, lineColor, 0.88 * alpha);
      for (let d = 16; d < dist - 16; d += step) {
        const dEnd = Math.min(dist - 16, d + dashLen);
        g.moveTo(mx + ux * d, my + uy * d);
        g.lineTo(mx + ux * dEnd, my + uy * dEnd);
      }

      // Perpendicular tile-interval ruler ticks along the ballistic path
      g.lineStyle(1.3, 0xE2E8F0, 0.55 * alpha);
      for (let d = TILE_SIZE; d < dist - 18; d += TILE_SIZE) {
        const tx = mx + ux * d;
        const ty = my + uy * d;
        g.moveTo(tx - px * 6, ty - py * 6);
        g.lineTo(tx + px * 6, ty + py * 6);
      }

      // Origin marker (Watchtower / Sniper high-ground elevation halo)
      const boostedOrigin = Boolean(cue.breakdown?.watchtowerBoosted || cue.weapon === 'SNIPER');
      g.lineStyle(2, boostedOrigin ? 0xFACC15 : lineColor, 0.82 * alpha);
      g.drawCircle(mx, my, boostedOrigin ? 26 : 18);
      if (boostedOrigin) {
        g.lineStyle(1.4, 0xFEF08A, 0.65 * alpha);
        drawDiamond(g, mx, my, 32);
      }
      g.lineStyle(0);
    }

    // 7. TARGET LOCK RETICLE ON VICTIM
    const lockR = 30 - frame.reticle * 9;
    const targetCol = cue.isMatchWinning ? 0xFACC15 : 0xF87171;
    g.lineStyle(2.2, targetCol, 0.92 * alpha);
    drawDiamond(g, fx, fy, lockR);
    // Cardinal crosshair ticks
    for (let i = 0; i < 4; i++) {
      const a = (Math.PI / 2) * i;
      g.moveTo(fx + Math.cos(a) * (lockR - 5), fy + Math.sin(a) * (lockR - 5));
      g.lineTo(fx + Math.cos(a) * (lockR + 7), fy + Math.sin(a) * (lockR + 7));
    }
    g.lineStyle(0);

    // 8. ANIMATED COVER SHIELD SHATTER (when shot pierced positive cover!)
    const coverPct = cue.breakdown?.coverPct ?? 0;
    if (coverPct > 0 && frame.phase !== 'PUSH') {
      const shatter = Math.min(1, frame.impact);
      // Place shield slightly toward incoming shot side, splitting into two angled halves
      const baseX = fx - ux * 14;
      const baseY = fy - uy * 14;
      const splitOffset = 4 + shatter * 16;
      const shieldAlpha = Math.max(0.15, (1 - shatter * 0.65) * alpha);

      g.lineStyle(2.4, 0x38BDF8, shieldAlpha);
      // Left half arc
      const lx = baseX + px * splitOffset + ux * (shatter * 8);
      const ly = baseY + py * splitOffset + uy * (shatter * 8);
      g.moveTo(lx - ux * 6 + px * 10, ly - uy * 6 + py * 10);
      g.lineTo(lx + px * 3, ly + py * 3);
      g.lineTo(lx + ux * 8 + px * 8, ly + uy * 8 + py * 8);

      // Right half arc
      const rx = baseX - px * splitOffset + ux * (shatter * 8);
      const ry = baseY - py * splitOffset + uy * (shatter * 8);
      g.moveTo(rx - ux * 6 - px * 10, ry - uy * 6 - py * 10);
      g.lineTo(rx - px * 3, ry - py * 3);
      g.lineTo(rx + ux * 8 - px * 8, ry + uy * 8 - py * 8);

      // Glowing fracture flash at center of break
      if (shatter < 0.7) {
        g.lineStyle(1.8, 0xFFFFFF, (1 - shatter / 0.7) * 0.9 * alpha);
        g.moveTo(baseX - px * 6, baseY - py * 6);
        g.lineTo(baseX + ux * 4, baseY + uy * 4);
        g.lineTo(baseX + px * 6, baseY + py * 6);
      }
      g.lineStyle(0);
    }
  });

  return <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />;
});
