import React, { useCallback, useRef } from 'react';
import { Container, Graphics, useApp, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { BoardRotation } from '../../../core/boardRotation';
import { fxTimeline, type TacticalFxAnimRequest } from '../../../core/graphics/fxTimeline';
import { screenUpVector } from '../../../core/graphics/ParticlePool';
import { getTexture } from '../../../core/graphics/TextureManager';
import { TACTICAL_VISUAL_STYLE } from '../../../core/graphics/TacticalAssets';
import { useEffectStore } from '../../../store/useEffectStore';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

interface TacticalFxItemProps {
  data: TacticalFxAnimRequest;
  mapRotation: BoardRotation;
  gridSize: number;
}

const tileCenter = (pt: { x: number; y: number }) => ({
  x: pt.x * TILE_SIZE + TILE_SIZE / 2,
  y: pt.y * TILE_SIZE + TILE_SIZE / 2,
});

interface FlightLine {
  ux: number;
  uy: number;
  rot: number;
  refX: number;
  refY: number;
  /** Signed distance from ref to map-entry point (negative). */
  sMin: number;
  /** Signed distance from ref to map-exit point (positive). */
  sMax: number;
}

/**
 * Intersects an infinite flight line through `(refX, refY)` along unit vector `(ux, uy)` with
 * the entire expanded map box `[-margin, boardPx + margin]²` so every aircraft enters from off
 * one edge of the whole battlefield and exits cleanly past the opposite horizon.
 */
function fullMapFlightLine(
  refX: number,
  refY: number,
  rawDx: number,
  rawDy: number,
  boardPx: number,
  margin: number,
): FlightLine {
  const len = Math.hypot(rawDx, rawDy);
  const ux = len > 0.001 ? rawDx / len : 1;
  const uy = len > 0.001 ? rawDy / len : 0;
  const minB = -margin;
  const maxB = boardPx + margin;

  let tNear = -Infinity;
  let tFar = Infinity;

  if (Math.abs(ux) > 1e-5) {
    const tx1 = (minB - refX) / ux;
    const tx2 = (maxB - refX) / ux;
    tNear = Math.max(tNear, Math.min(tx1, tx2));
    tFar = Math.min(tFar, Math.max(tx1, tx2));
  }
  if (Math.abs(uy) > 1e-5) {
    const ty1 = (minB - refY) / uy;
    const ty2 = (maxB - refY) / uy;
    tNear = Math.max(tNear, Math.min(ty1, ty2));
    tFar = Math.min(tFar, Math.max(ty1, ty2));
  }

  const sMin = Number.isFinite(tNear) ? Math.min(-margin, tNear) : -boardPx;
  const sMax = Number.isFinite(tFar) ? Math.max(margin, tFar) : boardPx;
  return { ux, uy, rot: Math.atan2(uy, ux), refX, refY, sMin, sMax };
}

/**
 * Piecewise smooth flight position along a `FlightLine`:
 * - `0 .. passStartMs`: flies from map entry `sMin` to `sPassStart`
 * - `passStartMs .. passEndMs`: cruises smoothly over payload zone `sPassStart .. sPassEnd`
 * - `passEndMs .. totalMs`: glides smoothly off the opposite edge `sPassEnd .. sMax` (continues live while player plays!)
 */
function sampleFlightS(
  line: FlightLine,
  elapsed: number,
  passStartMs: number,
  passEndMs: number,
  sPassStart: number,
  sPassEnd: number,
  totalMs: number,
): number {
  if (elapsed <= passStartMs) {
    const t = clamp01(elapsed / Math.max(1, passStartMs));
    return line.sMin + (sPassStart - line.sMin) * t;
  }
  if (elapsed <= passEndMs) {
    const t = clamp01((elapsed - passStartMs) / Math.max(1, passEndMs - passStartMs));
    return sPassStart + (sPassEnd - sPassStart) * t;
  }
  const t = clamp01((elapsed - passEndMs) / Math.max(1, totalMs - passEndMs));
  return sPassEnd + (line.sMax - sPassEnd) * t;
}

/** Draws sleek dual white wingtip contrail ribbons behind an airborne aircraft. */
function drawWingtipContrails(
  g: PIXI.Graphics,
  x: number,
  y: number,
  ux: number,
  uy: number,
  halfSpan: number,
  trailLen: number,
  alpha: number,
  color = 0xF8FAFC,
): void {
  if (alpha <= 0.02 || trailLen <= 4) return;
  const px = -uy;
  const py = ux;
  for (const side of [-1, 1]) {
    const tipX = x + px * halfSpan * side - ux * 10;
    const tipY = y + py * halfSpan * side - uy * 10;
    const tailX = tipX - ux * trailLen;
    const tailY = tipY - uy * trailLen;
    g.lineStyle(3.2, color, 0.22 * alpha);
    g.moveTo(tipX, tipY);
    g.lineTo(tailX, tailY);
    g.lineStyle(1.3, 0xFFFFFF, 0.56 * alpha);
    g.moveTo(tipX, tipY);
    g.lineTo(tipX - ux * (trailLen * 0.65), tipY - uy * (trailLen * 0.65));
  }
  g.lineStyle(0);
}

const TacticalFxItem: React.FC<TacticalFxItemProps> = React.memo(({ data, mapRotation, gridSize }) => {
  const app = useApp();
  const gfxRef = useRef<PIXI.Graphics>(null);
  const spriteLayerRef = useRef<PIXI.Container>(null);
  const actorSpriteRef = useRef<PIXI.Sprite | null>(null);
  const shadowSpriteRef = useRef<PIXI.Sprite | null>(null);
  const secondarySpriteRef = useRef<PIXI.Sprite | null>(null);
  const decalSpritesRef = useRef<PIXI.Sprite[]>([]);
  const warheadSpritesRef = useRef<PIXI.Sprite[]>([]);
  const combatElapsedRef = useRef(0);
  const tailElapsedRef = useRef(0);
  const removedRef = useRef(false);

  const ensureSprite = useCallback((ref: React.MutableRefObject<PIXI.Sprite | null>, textureKey: string) => {
    const parent = spriteLayerRef.current;
    if (!parent || parent.destroyed) return null;
    if (ref.current && !ref.current.destroyed) return ref.current;
    const tex = getTexture(textureKey);
    if (!tex) return null;
    const sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5);
    sp.eventMode = 'none';
    parent.addChild(sp);
    ref.current = sp;
    return sp;
  }, []);

  const ensurePooledSprite = useCallback(
    (poolRef: React.MutableRefObject<PIXI.Sprite[]>, idx: number, textureKey: string, insertBottom = false): PIXI.Sprite | null => {
      const parent = spriteLayerRef.current;
      if (!parent || parent.destroyed) return null;
      const existing = poolRef.current[idx];
      if (existing && !existing.destroyed) return existing;
      const tex = getTexture(textureKey);
      if (!tex) return null;
      const sp = new PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      sp.eventMode = 'none';
      if (insertBottom) parent.addChildAt(sp, 0);
      else parent.addChild(sp);
      poolRef.current[idx] = sp;
      return sp;
    },
    [],
  );

  const initialDraw = useCallback((g: PIXI.Graphics) => {
    g.clear();
  }, []);

  useTick(() => {
    const g = gfxRef.current;
    if (!g || g.destroyed) return;

    const combatDur = Math.max(180, data.durationMs);
    const ambientTailMs = Math.max(0, data.ambientTailMs ?? 0);
    const totalDur = combatDur + ambientTailMs;

    // During combat/camera phase: ride fxTimeline's dilated combat clock so aircraft slow down smoothly inside Kill Cam!
    // Once combat phase completes: advance ambient exit flight in real time while live gameplay continues unimpeded.
    if (combatElapsedRef.current < combatDur) {
      combatElapsedRef.current += fxTimeline.getLastCombatDtMs();
      if (combatElapsedRef.current > combatDur) {
        tailElapsedRef.current += combatElapsedRef.current - combatDur;
        combatElapsedRef.current = combatDur;
      }
    } else if (ambientTailMs > 0) {
      const rawDt = Math.max(0, Math.min(33.33, (app as any)?.ticker?.deltaMS ?? 16.67));
      tailElapsedRef.current += rawDt;
    }

    const elapsed = combatElapsedRef.current + tailElapsedRef.current;
    const tCombat = clamp01(elapsed / combatDur);
    const tTotal = clamp01(elapsed / totalDur);

    g.clear();
    if (actorSpriteRef.current && !actorSpriteRef.current.destroyed) actorSpriteRef.current.visible = false;
    if (shadowSpriteRef.current && !shadowSpriteRef.current.destroyed) shadowSpriteRef.current.visible = false;
    if (secondarySpriteRef.current && !secondarySpriteRef.current.destroyed) secondarySpriteRef.current.visible = false;
    for (let i = 0; i < decalSpritesRef.current.length; i++) {
      const sp = decalSpritesRef.current[i];
      if (sp && !sp.destroyed) sp.visible = false;
    }
    for (let i = 0; i < warheadSpritesRef.current.length; i++) {
      const sp = warheadSpritesRef.current[i];
      if (sp && !sp.destroyed) sp.visible = false;
    }

    if (elapsed >= totalDur) {
      if (ambientTailMs > 0 && !removedRef.current) {
        removedRef.current = true;
        useEffectStore.getState().removeTacticalEffect(data.id);
      }
      return;
    }

    const up = screenUpVector(mapRotation);
    const uprightRad = (-mapRotation * Math.PI) / 180;
    const boardPx = gridSize * TILE_SIZE;
    const anchor = tileCenter(data.anchor);
    const visual = TACTICAL_VISUAL_STYLE[data.itemKey];

    switch (data.itemKey) {
      // ── 1. MINEFIELD SNAPSHOT: Subsurface dual-ring lidar wave + mine locks ──
      case 'MINEFIELD_SNAPSHOT': {
        const wave = easeOutCubic(tCombat);
        const maxR = boardPx * 0.78;
        const r = 24 + wave * maxR;
        const alpha = (1 - tCombat) * 0.9;

        g.lineStyle(5 * (1 - tCombat * 0.5), 0x22D3EE, alpha * 0.85);
        g.drawCircle(anchor.x, anchor.y, r);
        g.lineStyle(2.2, 0x6EE7B7, alpha * 0.65);
        g.drawCircle(anchor.x, anchor.y, Math.max(6, r - 28));

        const pings = data.pings ?? [];
        for (let i = 0; i < pings.length; i++) {
          const p = tileCenter(pings[i]);
          const dist = Math.hypot(p.x - anchor.x, p.y - anchor.y);
          if (r < dist - 16) continue;
          const pingT = clamp01((r - dist + 16) / (maxR * 0.35));
          const pa = Math.max(0, 1 - pingT * 0.85);
          const pr = 12 + pingT * 18;
          g.lineStyle(2.4, 0x22D3EE, pa);
          g.moveTo(p.x, p.y - pr);
          g.lineTo(p.x + pr, p.y);
          g.lineTo(p.x, p.y + pr);
          g.lineTo(p.x - pr, p.y);
          g.closePath();
          g.beginFill(0xEF4444, pa * 0.85);
          g.drawCircle(p.x, p.y, 4.5);
          g.endFill();
        }
        g.lineStyle(0);
        break;
      }

      // ── 2. HUNTER DRONE (RECON_DRONE): Full-map UAV swoop + 3-round micro-burst + exit climb ──
      case 'RECON_DRONE': {
        const impactAt = 280;
        // Approach diagonally from map edge toward target, strike at 280ms, then bank off far map edge
        const dirDx = anchor.x > boardPx * 0.5 ? -0.88 : 0.88;
        const dirDy = anchor.y > boardPx * 0.5 ? -0.47 : 0.47;
        const line = fullMapFlightLine(anchor.x, anchor.y, dirDx, dirDy, boardPx, TILE_SIZE * 2.4);
        const sPos = sampleFlightS(line, elapsed, impactAt, 520, -TILE_SIZE * 0.55, TILE_SIZE * 0.7, totalDur);
        const dx = line.refX + line.ux * sPos;
        const dy = line.refY + line.uy * sPos;
        const climb = elapsed > 480 ? clamp01((elapsed - 480) / Math.max(1, totalDur - 480)) : 0;

        // Ground shadow
        g.beginFill(0x020617, (0.28 - climb * 0.14));
        g.drawEllipse(dx - up.x * (14 + climb * 16) + 12, dy - up.y * (14 + climb * 16) + 12, 14, 8);
        g.endFill();

        // Optical lock laser right before strike (100..280ms)
        if (elapsed >= 90 && elapsed < impactAt + 40) {
          const la = elapsed < impactAt ? 0.85 : 1 - (elapsed - impactAt) / 40;
          g.lineStyle(2, 0x38BDF8, la * 0.9);
          g.moveTo(dx + up.x * 16, dy + up.y * 16);
          g.lineTo(anchor.x, anchor.y);
          g.lineStyle(2, 0xF43F5E, la);
          g.drawCircle(anchor.x, anchor.y, 20 * (1 - clamp01(elapsed / impactAt) * 0.45));
          g.lineStyle(0);
        }

        // Rapid 3-round cyan-crimson micro-cannon tracer burst at 260..370ms
        for (let b = 0; b < 3; b++) {
          const bStart = 245 + b * 36;
          if (elapsed < bStart || elapsed > bStart + 55) continue;
          const bt = (elapsed - bStart) / 55;
          const sx = dx + up.x * 16;
          const sy = dy + up.y * 16;
          const lx = sx + (anchor.x - sx) * bt;
          const ly = sy + (anchor.y - sy) * bt;
          g.lineStyle(4, 0x38BDF8, 0.7);
          g.moveTo(sx + (anchor.x - sx) * Math.max(0, bt - 0.35), sy + (anchor.y - sy) * Math.max(0, bt - 0.35));
          g.lineTo(lx, ly);
          g.lineStyle(1.8, 0xFFFFFF, 0.98);
          g.moveTo(sx + (anchor.x - sx) * Math.max(0, bt - 0.2), sy + (anchor.y - sy) * Math.max(0, bt - 0.2));
          g.lineTo(lx, ly);
          g.lineStyle(0);
        }

        // Impact ring + optical sensor sweep at 280..combatDur
        if (elapsed >= impactAt && elapsed < combatDur) {
          const postT = clamp01((elapsed - impactAt) / (combatDur - impactAt));
          const flashA = Math.pow(1 - postT, 1.8);
          g.beginFill(0x38BDF8, 0.45 * flashA);
          g.drawCircle(anchor.x, anchor.y, 12 + easeOutCubic(postT) * 28);
          g.endFill();
          g.lineStyle(2.4 * flashA, 0xBAE6FD, flashA);
          g.drawCircle(anchor.x, anchor.y, 14 + easeOutCubic(postT) * 44);

          const rad = 20 + easeOutCubic(postT) * (3.5 * TILE_SIZE);
          g.lineStyle(1.8, 0x38BDF8, (1 - postT) * 0.6);
          g.moveTo(anchor.x, anchor.y - rad);
          g.lineTo(anchor.x + rad, anchor.y);
          g.lineTo(anchor.x, anchor.y + rad);
          g.lineTo(anchor.x - rad, anchor.y);
          g.closePath();
          g.lineStyle(0);
        }

        const sp = ensureSprite(actorSpriteRef, 'TACTICAL_RECON_DRONE');
        if (sp) {
          sp.visible = true;
          sp.position.set(dx + up.x * (18 + climb * 18), dy + up.y * (18 + climb * 18));
          sp.rotation = uprightRad + line.rot + Math.sin(elapsed * 0.015) * 0.08;
          sp.scale.set(0.46 + climb * 0.08);
          sp.alpha = clamp01(1 - Math.max(0, tTotal - 0.9) / 0.1);
        }
        break;
      }

      // ── 3. SMOKE SCREEN: 3 incoming canisters + billowing 3x3 thermal cloud burst ──
      case 'SMOKE_SCREEN': {
        const canisters = [
          { dx: -TILE_SIZE * 0.65, dy: -TILE_SIZE * 0.4, delay: 0 },
          { dx: TILE_SIZE * 0.55, dy: -TILE_SIZE * 0.2, delay: 65 },
          { dx: 0, dy: TILE_SIZE * 0.5, delay: 130 },
        ];
        for (let i = 0; i < canisters.length; i++) {
          const c = canisters[i];
          const lt = clamp01((elapsed - c.delay) / 240);
          if (lt <= 0 || lt >= 1) continue;
          const tx = anchor.x + c.dx;
          const ty = anchor.y + c.dy;
          const alt = (1 - lt) * 120 + Math.sin(lt * Math.PI) * 32;
          const cx = tx + up.x * alt - (1 - lt) * 42;
          const cy = ty + up.y * alt;
          g.lineStyle(3, 0xE2E8F0, 0.75 * (1 - lt * 0.4));
          g.moveTo(cx + up.x * 16, cy + up.y * 16);
          g.lineTo(cx, cy);
          g.lineStyle(0);
          g.beginFill(0xFFFFFF, 0.95);
          g.drawCircle(cx, cy, 4);
          g.endFill();
        }

        if (elapsed > 190) {
          const bt = clamp01((elapsed - 190) / (combatDur - 190));
          const ease = easeOutCubic(bt);
          const alpha = bt < 0.55 ? 0.65 * ease : 0.65 * (1 - (bt - 0.55) / 0.45);
          for (let i = 0; i < data.tiles.length; i++) {
            const sp = ensurePooledSprite(decalSpritesRef, i, 'TACTICAL_SMOKE_PUFF', true);
            if (!sp) continue;
            const pt = tileCenter(data.tiles[i]);
            sp.visible = true;
            sp.position.set(pt.x, pt.y);
            const sz = (0.45 + ease * 0.75) * (TILE_SIZE / 64);
            sp.scale.set(sz);
            sp.rotation = i * 0.9 + bt * 0.45;
            sp.alpha = Math.max(0, alpha);
          }
        }
        break;
      }

      // ── 4. RADAR SWEEP: Full-theater AWACS sweeping phosphor beam + contact locks ──
      case 'RADAR_SWEEP': {
        const sweepX = -TILE_SIZE + tCombat * (boardPx + TILE_SIZE * 2);
        const trailW = TILE_SIZE * 3.4;
        const beamAlpha = tCombat < 0.85 ? 0.92 : (1 - tCombat) / 0.15;

        for (let s = 0; s < 6; s++) {
          const frac = s / 6;
          const segX = sweepX - frac * trailW;
          const segW = trailW / 6 + 2;
          g.beginFill(0x10B981, (1 - frac) * 0.16 * beamAlpha);
          g.drawRect(segX - segW, 0, segW, boardPx);
          g.endFill();
        }

        g.lineStyle(6, 0x10B981, 0.45 * beamAlpha);
        g.moveTo(sweepX, 0);
        g.lineTo(sweepX, boardPx);
        g.lineStyle(2.4, 0xA7F3D0, 0.98 * beamAlpha);
        g.moveTo(sweepX, 0);
        g.lineTo(sweepX, boardPx);

        const pings = data.pings ?? [];
        for (let i = 0; i < pings.length; i++) {
          const p = tileCenter(pings[i]);
          if (sweepX < p.x - 10) continue;
          const age = clamp01((sweepX - p.x + 10) / (boardPx * 0.45));
          const pa = Math.max(0, 1 - age * 0.85);
          const r = 14 + age * 14;
          g.lineStyle(2.4, 0x34D399, pa);
          g.drawCircle(p.x, p.y, r);
          g.lineStyle(1.8, 0xFFFFFF, pa);
          g.moveTo(p.x - r - 5, p.y);
          g.lineTo(p.x + r + 5, p.y);
          g.moveTo(p.x, p.y - r - 5);
          g.lineTo(p.x, p.y + r + 5);
        }
        g.lineStyle(0);
        break;
      }

      // ── 5. PRECISION STRIKE: Converging orbital lock beams + hypersonic JDAM + triple shockwave ──
      case 'PRECISION_STRIKE': {
        if (data.phase === 'MARK') {
          const lockT = easeOutCubic(tCombat);
          const r = 42 - lockT * 20;
          const alpha = 1 - tCombat * 0.65;
          g.lineStyle(2.8, 0xF43F5E, alpha);
          g.drawCircle(anchor.x, anchor.y, r);
          g.lineStyle(1.8, 0xFFF1F2, alpha);
          g.moveTo(anchor.x - r - 8, anchor.y);
          g.lineTo(anchor.x + r + 8, anchor.y);
          g.moveTo(anchor.x, anchor.y - r - 8);
          g.lineTo(anchor.x, anchor.y + r + 8);
          g.lineStyle(0);
        } else {
          const impactAt = 420;
          // Phase A (0..420ms): Converging dual orbital laser beams + tightening reticle
          if (elapsed < impactAt + 90) {
            const lockT = clamp01(elapsed / impactAt);
            const beamA = elapsed < impactAt ? 0.92 : Math.max(0, 1 - (elapsed - impactAt) / 90);
            const skyX = anchor.x + up.x * 580;
            const skyY = anchor.y + up.y * 580;
            const spread = (1 - easeOutCubic(lockT)) * 46;
            const sideX = -up.y * spread;
            const sideY = up.x * spread;

            // Converging twin satellite laser rails
            g.lineStyle(3.2, 0xF43F5E, 0.55 * beamA);
            g.moveTo(skyX + sideX, skyY + sideY);
            g.lineTo(anchor.x, anchor.y);
            g.moveTo(skyX - sideX, skyY - sideY);
            g.lineTo(anchor.x, anchor.y);

            // Core vertical designator beam
            g.lineStyle(14, 0xF43F5E, 0.26 * beamA);
            g.moveTo(skyX, skyY);
            g.lineTo(anchor.x, anchor.y);
            g.lineStyle(3.5, 0xFFF1F2, 0.96 * beamA);
            g.moveTo(skyX, skyY);
            g.lineTo(anchor.x, anchor.y);

            // Tightening orbital ground lock rings
            g.lineStyle(2.4, 0xF43F5E, beamA);
            g.drawCircle(anchor.x, anchor.y, 34 * (1 - lockT * 0.62));
            g.lineStyle(1.6, 0xFDA4AF, beamA * 0.85);
            g.drawCircle(anchor.x, anchor.y, 52 * (1 - lockT * 0.52));
            g.lineStyle(0);
          }

          // Phase B (140..420ms): Hypersonic JDAM missile plunging straight down screen-up axis
          if (elapsed >= 140 && elapsed < impactAt) {
            const diveT = clamp01((elapsed - 140) / (impactAt - 140));
            const accel = diveT * diveT;
            const alt = (1 - accel) * 420;
            const mx = anchor.x + up.x * alt;
            const my = anchor.y + up.y * alt;
            const sp = ensureSprite(actorSpriteRef, 'TACTICAL_JDAM_MISSILE');
            if (sp) {
              sp.visible = true;
              sp.position.set(mx, my);
              sp.rotation = uprightRad;
              sp.scale.set(0.68);
              sp.alpha = 1;
            }
            // Double Mach vapor shock cones around diving kinetic dart
            g.lineStyle(2.4, 0xFDA4AF, 0.84);
            g.drawCircle(mx, my, 12 + diveT * 14);
            g.lineStyle(1.4, 0xFFFFFF, 0.72);
            g.drawCircle(mx + up.x * 24, my + up.y * 24, 8 + diveT * 9);
            g.lineStyle(0);
          }

          // Phase C (420..combatDur): Blinding orbital plasma pillar + triple shockwave + crater
          if (elapsed >= impactAt) {
            const postT = clamp01((elapsed - impactAt) / (combatDur - impactAt));
            const flash = Math.pow(1 - postT, 2.0);
            const skyX = anchor.x + up.x * 460;
            const skyY = anchor.y + up.y * 460;

            const crater = ensurePooledSprite(decalSpritesRef, 0, 'TACTICAL_CRATER_DECAL', true);
            if (crater) {
              crater.visible = true;
              crater.position.set(anchor.x, anchor.y);
              crater.scale.set(0.72);
              crater.alpha = postT < 0.55 ? 0.94 : 0.94 * (1 - (postT - 0.55) / 0.45);
            }

            if (postT < 0.48) {
              const colA = 1 - postT / 0.48;
              g.lineStyle(32 * colA, 0xF43F5E, 0.36 * colA);
              g.moveTo(skyX, skyY);
              g.lineTo(anchor.x, anchor.y);
              g.lineStyle(12 * colA, 0xFFFFFF, 0.95 * colA);
              g.moveTo(skyX, skyY);
              g.lineTo(anchor.x, anchor.y);
              g.beginFill(0xFFF1F2, 0.72 * colA);
              g.drawCircle(anchor.x, anchor.y, 18 + colA * 26);
              g.endFill();
            }
            g.lineStyle(4.5 * flash, 0xFDA4AF, flash);
            g.drawCircle(anchor.x, anchor.y, 18 + easeOutCubic(postT) * 92);
            g.lineStyle(2.4 * flash, 0xF43F5E, flash * 0.85);
            g.drawCircle(anchor.x, anchor.y, 12 + easeOutCubic(postT) * 62);
            g.lineStyle(0);
          }
        }
        break;
      }

      // ── 6. SABOTAGE: Collapsing violet-cyan EMP sphere + jagged lightning arcs ──
      case 'SABOTAGE': {
        const implodeT = clamp01(elapsed / 220);
        const burstT = clamp01((elapsed - 200) / (combatDur - 200));
        if (elapsed < 220) {
          const r = 48 * (1 - easeOutCubic(implodeT)) + 8;
          g.lineStyle(2.6, 0xC084FC, 0.92);
          g.drawCircle(anchor.x, anchor.y, r);
          g.beginFill(0x38BDF8, 0.25);
          g.drawCircle(anchor.x, anchor.y, r * 0.65);
          g.endFill();
        }
        if (elapsed >= 190) {
          const a = Math.max(0, 1 - burstT);
          const rad = 14 + easeOutCubic(burstT) * 58;
          g.lineStyle(3.2 * a, 0xC084FC, a);
          g.drawCircle(anchor.x, anchor.y, rad);
          g.lineStyle(2 * a, 0x38BDF8, a * 0.9);
          for (let b = 0; b < 6; b++) {
            const baseAng = (Math.PI * 2 * b) / 6 + Math.floor(elapsed / 45) * 0.22;
            g.moveTo(anchor.x, anchor.y);
            for (let seg = 1; seg <= 3; seg++) {
              const dist = (rad * seg) / 3;
              const jitter = ((b + seg + Math.floor(elapsed / 40)) % 2 === 0 ? 1 : -1) * 7;
              const nx = anchor.x + Math.cos(baseAng) * dist - Math.sin(baseAng) * jitter;
              const ny = anchor.y + Math.sin(baseAng) * dist + Math.cos(baseAng) * jitter;
              g.lineTo(nx, ny);
            }
          }
          g.lineStyle(0);
        }
        break;
      }

      // ── 7. NAPALM LINE: Full-map edge-to-edge Strike Jet + canisters + lively ambient exit ──
      case 'NAPALM_LINE': {
        if (data.phase === 'BURN') {
          const a = Math.pow(1 - tCombat, 1.5);
          g.beginFill(0xF97316, 0.42 * a);
          g.drawCircle(anchor.x, anchor.y, 16 + easeOutCubic(tCombat) * 26);
          g.endFill();
          g.lineStyle(3 * a, 0xFEF08A, a);
          g.drawCircle(anchor.x, anchor.y, 10 + easeOutCubic(tCombat) * 32);
          g.lineStyle(0);
          break;
        }

        const tiles = data.tiles.length > 0 ? data.tiles : [data.anchor];
        const first = tileCenter(tiles[0]);
        const last = tileCenter(tiles[tiles.length - 1]);
        const axis = data.axis ?? (Math.abs(last.y - first.y) > Math.abs(last.x - first.x) ? 'V' : 'H');
        const dirX = axis === 'H' ? 1 : 0;
        const dirY = axis === 'V' ? 1 : 0;
        const span = Math.hypot(last.x - first.x, last.y - first.y);
        const line = fullMapFlightLine(first.x, first.y, dirX, dirY, boardPx, TILE_SIZE * 3.4);

        // Jet enters from map edge -> sweeps tiles 0..3 at 220..550ms -> cruises all the way off far edge!
        const sPos = sampleFlightS(line, elapsed, 200, 560, -TILE_SIZE * 0.35, span + TILE_SIZE * 0.4, totalDur);
        const jx = line.refX + line.ux * sPos;
        const jy = line.refY + line.uy * sPos;
        const climb = elapsed > 620 ? clamp01((elapsed - 620) / Math.max(1, totalDur - 620)) : 0;
        const jetAlt = 24 + climb * 18;

        drawWingtipContrails(
          g,
          jx + up.x * jetAlt,
          jy + up.y * jetAlt,
          line.ux,
          line.uy,
          44,
          120 + climb * 55,
          1 - Math.max(0, tTotal - 0.92) / 0.08,
          0xFDE68A,
        );

        const shadow = ensureSprite(shadowSpriteRef, 'TACTICAL_STRIKE_JET_SHADOW');
        if (shadow) {
          shadow.visible = true;
          shadow.position.set(jx - up.x * (26 + climb * 20) + 20, jy - up.y * (26 + climb * 20) + 20);
          shadow.rotation = line.rot;
          shadow.scale.set(0.68 + climb * 0.06);
          shadow.alpha = 0.48 * (1 - climb * 0.35);
        }
        const jet = ensureSprite(actorSpriteRef, 'TACTICAL_STRIKE_JET');
        if (jet) {
          jet.visible = true;
          jet.position.set(jx + up.x * jetAlt, jy + up.y * jetAlt);
          jet.rotation = line.rot;
          jet.scale.set(0.78 + climb * 0.1);
          jet.alpha = 1;
        }

        // Tumbling incendiary canisters dropping -> sequential 6-DMG fire ignitions at 220 + i*110ms
        for (let i = 0; i < tiles.length; i++) {
          const igniteAt = 220 + i * 110;
          const dropStart = igniteAt - 95;
          const pt = tileCenter(tiles[i]);
          if (elapsed >= dropStart && elapsed < igniteAt) {
            const dt = clamp01((elapsed - dropStart) / 95);
            const alt = (1 - dt * dt) * 44;
            const cx = pt.x + up.x * alt;
            const cy = pt.y + up.y * alt;
            g.beginFill(0xF97316, 0.95);
            g.drawCircle(cx, cy, 5);
            g.endFill();
            g.beginFill(0xFEF08A, 0.9);
            g.drawCircle(cx, cy, 2.5);
            g.endFill();
          } else if (elapsed >= igniteAt && elapsed < igniteAt + 520) {
            const ft = clamp01((elapsed - igniteAt) / 520);
            const fa = Math.pow(1 - ft, 1.45);
            g.beginFill(0xEA580C, 0.62 * fa);
            g.drawCircle(pt.x, pt.y, 14 + easeOutCubic(ft) * 34);
            g.endFill();
            g.beginFill(0xFEF08A, 0.78 * fa * fa);
            g.drawCircle(pt.x, pt.y, 9 + easeOutCubic(ft) * 18);
            g.endFill();
            g.lineStyle(2.6 * fa, 0xFB923C, fa);
            g.drawCircle(pt.x, pt.y, 16 + easeOutCubic(ft) * 42);
            g.lineStyle(0);
          }
        }
        break;
      }

      // ── 8. PARADROP: Full-map C-130 Cargo Plane airlift (pickup -> drop) + parafoil + ambient exit ──
      case 'PARADROP': {
        const dropAt = 380;
        const landAt = 860;
        const fromTile = data.meta?.from ?? (data.tiles.length >= 2 ? data.tiles[0] : null);
        const fromPx = fromTile ? tileCenter(fromTile) : null;
        const rawDx = fromPx ? anchor.x - fromPx.x : 0.92;
        const rawDy = fromPx ? anchor.y - fromPx.y : -0.39;
        const pickupDist = fromPx ? Math.hypot(anchor.x - fromPx.x, anchor.y - fromPx.y) : 0;
        const line = fullMapFlightLine(anchor.x, anchor.y, rawDx, rawDy, boardPx, TILE_SIZE * 3.8);

        // Cargo plane enters from map edge -> sweeps pickup (200ms) -> passes LZ (380ms) -> cruises off opposite edge!
        const sPassStart = fromPx ? -Math.min(pickupDist, boardPx * 0.75) : -TILE_SIZE * 2.2;
        const sPos = sampleFlightS(line, elapsed, 180, dropAt, sPassStart, TILE_SIZE * 0.25, totalDur);
        const cx = line.refX + line.ux * sPos;
        const cy = line.refY + line.uy * sPos;
        const climb = elapsed > dropAt + 120 ? clamp01((elapsed - dropAt - 120) / Math.max(1, totalDur - dropAt - 120)) : 0;
        const planeAlt = 30 + climb * 20;

        // 1. Brief emerald extraction tether ring on pickup tile as Cargo Plane sweeps over it
        if (fromPx && elapsed < 420) {
          const exT = clamp01(elapsed / 420);
          const exA = Math.sin(exT * Math.PI);
          g.lineStyle(2.4, 0x34D399, 0.85 * exA);
          g.drawCircle(fromPx.x, fromPx.y, 12 + easeOutCubic(exT) * 32);
          if (elapsed > 80 && elapsed < 260) {
            g.lineStyle(2, 0xA7F3D0, 0.72 * exA);
            g.moveTo(fromPx.x, fromPx.y);
            g.lineTo(cx + up.x * planeAlt, cy + up.y * planeAlt);
          }
          g.lineStyle(0);
        }

        // 2. Green LZ beacon flare on landing tile
        if (elapsed < combatDur) {
          const beaconA = clamp01(1 - tCombat * 0.72);
          g.lineStyle(2.4, 0x34D399, beaconA);
          g.drawCircle(anchor.x, anchor.y, 14 + Math.sin(elapsed * 0.015) * 4);
          g.beginFill(0x10B981, 0.25 * beaconA);
          g.drawCircle(anchor.x, anchor.y, 12);
          g.endFill();
          g.lineStyle(0);
        }

        // 3. Swaying ram-air parafoil deploying out of Cargo Plane rear ramp at 380ms -> touchdown at 860ms
        if (elapsed >= dropAt && elapsed < landAt) {
          const dropT = clamp01((elapsed - dropAt) / (landAt - dropAt));
          const ease = 1 - Math.pow(1 - dropT, 1.65);
          const alt = (1 - ease) * 200;
          const sway = Math.sin(dropT * Math.PI * 2.2) * 14 * (1 - dropT);
          const sideX = -up.y * sway;
          const sideY = up.x * sway;
          const unitX = anchor.x + up.x * alt + sideX;
          const unitY = anchor.y + up.y * alt + sideY;
          const chuteX = unitX + up.x * 34;
          const chuteY = unitY + up.y * 34;

          g.beginFill(0x020617, 0.14 + dropT * 0.26);
          g.drawEllipse(anchor.x, anchor.y + 8, 8 + dropT * 10, 4 + dropT * 5);
          g.endFill();

          g.lineStyle(1.4, 0xE2E8F0, 0.88);
          g.moveTo(unitX, unitY);
          g.lineTo(chuteX - up.y * 22, chuteY + up.x * 22);
          g.moveTo(unitX, unitY);
          g.lineTo(chuteX + up.y * 22, chuteY - up.x * 22);
          g.lineStyle(0);

          g.beginFill(0x10B981, 0.96);
          g.drawCircle(unitX, unitY, 7);
          g.endFill();

          const chute = ensureSprite(secondarySpriteRef, 'TACTICAL_PARADROP_CHUTE');
          if (chute) {
            chute.visible = true;
            chute.position.set(chuteX, chuteY);
            chute.rotation = uprightRad + sway * 0.012;
            chute.scale.set(0.56);
            chute.alpha = 1;
          }
        } else if (elapsed >= landAt && elapsed < combatDur) {
          const pt = clamp01((elapsed - landAt) / (combatDur - landAt));
          const pa = 1 - pt;
          g.lineStyle(3.2 * pa, 0x34D399, pa);
          g.drawCircle(anchor.x, anchor.y, 12 + easeOutCubic(pt) * 48);
          g.lineStyle(0);
        }

        // 4. Quad-turboprop contrails + Cargo Plane & shadow gliding edge-to-edge across the entire map!
        drawWingtipContrails(
          g,
          cx + up.x * planeAlt,
          cy + up.y * planeAlt,
          line.ux,
          line.uy,
          62,
          135 + climb * 45,
          1 - Math.max(0, tTotal - 0.92) / 0.08,
          0xA7F3D0,
        );
        const shadow = ensureSprite(shadowSpriteRef, 'TACTICAL_CARGO_PLANE_SHADOW');
        if (shadow) {
          shadow.visible = true;
          shadow.position.set(cx - up.x * (34 + climb * 22) + 26, cy - up.y * (34 + climb * 22) + 26);
          shadow.rotation = line.rot;
          shadow.scale.set(0.86 + climb * 0.05);
          shadow.alpha = 0.48 * (1 - climb * 0.32);
        }
        const plane = ensureSprite(actorSpriteRef, 'TACTICAL_CARGO_PLANE');
        if (plane) {
          plane.visible = true;
          plane.position.set(cx + up.x * planeAlt, cy + up.y * planeAlt);
          plane.rotation = line.rot;
          plane.scale.set(0.94 + climb * 0.08);
          plane.alpha = 1;
        }
        break;
      }

      // ── 9. CARPET RUN: Full-map Heavy Stealth Bomber + 1..3 curved homing cruise bombs + lively exit ──
      case 'CARPET_RUN': {
        const tiles = data.tiles.length > 0 ? data.tiles : [data.anchor];
        if (data.phase === 'MARK') {
          for (let i = 0; i < tiles.length; i++) {
            const lt = clamp01((elapsed - i * 70) / 280);
            if (lt <= 0) continue;
            const pt = tileCenter(tiles[i]);
            const a = 1 - lt * 0.65;
            g.lineStyle(2.6, visual.primaryPixi, a);
            g.drawRect(pt.x - 26, pt.y - 26, 52, 52);
          }
          g.lineStyle(0);
          break;
        }

        const centers = tiles.map(tileCenter);
        let sumX = 0;
        let sumY = 0;
        for (const c of centers) {
          sumX += c.x;
          sumY += c.y;
        }
        const centX = sumX / centers.length;
        const centY = sumY / centers.length;

        // Orient bomber along first->last target vector (or diagonal/axis fallback for single target)
        const first = centers[0];
        const last = centers[centers.length - 1];
        const vecLen = Math.hypot(last.x - first.x, last.y - first.y);
        const dirX = vecLen > TILE_SIZE * 0.5 ? last.x - first.x : data.axis === 'V' ? 0 : 0.92;
        const dirY = vecLen > TILE_SIZE * 0.5 ? last.y - first.y : data.axis === 'V' ? 1 : -0.39;
        const line = fullMapFlightLine(centX, centY, dirX, dirY, boardPx, TILE_SIZE * 3.8);

        const releaseEndMs = 140 + (centers.length - 1) * 160 + 140;
        const sPassHalf = Math.min(boardPx * 0.32, Math.max(TILE_SIZE * 1.5, vecLen * 0.45));
        const sPos = sampleFlightS(line, elapsed, 140, releaseEndMs, -sPassHalf, sPassHalf, totalDur);
        const bx = line.refX + line.ux * sPos;
        const by = line.refY + line.uy * sPos;
        const climb = elapsed > releaseEndMs + 140 ? clamp01((elapsed - releaseEndMs - 140) / Math.max(1, totalDur - releaseEndMs - 140)) : 0;
        const bomberAlt = 30 + climb * 18;

        // 1..3 independent guided cruise bombs arcing smoothly from the bomber's live release point into each target!
        for (let i = 0; i < centers.length; i++) {
          const impactAt = 280 + i * 200;
          const releaseAt = Math.max(40, impactAt - 190);
          const pt = centers[i];

          // Target lock diamond pulsing ahead of impact
          if (elapsed < impactAt) {
            const lockP = clamp01(elapsed / impactAt);
            const r = 28 - lockP * 10;
            g.lineStyle(2.2, 0xFB923C, 0.82);
            g.moveTo(pt.x, pt.y - r);
            g.lineTo(pt.x + r, pt.y);
            g.lineTo(pt.x, pt.y + r);
            g.lineTo(pt.x - r, pt.y);
            g.closePath();
            g.lineStyle(0);
          }

          if (elapsed >= releaseAt && elapsed < impactAt) {
            const bt = clamp01((elapsed - releaseAt) / (impactAt - releaseAt));
            const sRel = sampleFlightS(line, releaseAt, 140, releaseEndMs, -sPassHalf, sPassHalf, totalDur);
            const rx = line.refX + line.ux * sRel + up.x * 26;
            const ry = line.refY + line.uy * sRel + up.y * 26;
            const ctrlX = (rx + pt.x) * 0.5 + line.ux * 36 + up.x * 48;
            const ctrlY = (ry + pt.y) * 0.5 + line.uy * 36 + up.y * 48;
            const inv = 1 - bt;
            const wx = inv * inv * rx + 2 * inv * bt * ctrlX + bt * bt * pt.x;
            const wy = inv * inv * ry + 2 * inv * bt * ctrlY + bt * bt * pt.y;
            const tanX = 2 * inv * (ctrlX - rx) + 2 * bt * (pt.x - ctrlX);
            const tanY = 2 * inv * (ctrlY - ry) + 2 * bt * (pt.y - ctrlY);

            // Glowing curved missile contrail ribbon
            const tailT = Math.max(0, bt - 0.35);
            const invT = 1 - tailT;
            const tx = invT * invT * rx + 2 * invT * tailT * ctrlX + tailT * tailT * pt.x;
            const ty = invT * invT * ry + 2 * invT * tailT * ctrlY + tailT * tailT * pt.y;
            g.lineStyle(5, 0xFB923C, 0.35);
            g.moveTo(tx, ty);
            g.lineTo(wx, wy);
            g.lineStyle(2, 0xFEF08A, 0.92);
            g.moveTo(tx, ty);
            g.lineTo(wx, wy);
            g.lineStyle(0);

            const bomb = ensurePooledSprite(warheadSpritesRef, i, 'TACTICAL_CRUISE_BOMB', false);
            if (bomb) {
              bomb.visible = true;
              bomb.position.set(wx, wy);
              bomb.rotation = Math.atan2(tanY, tanX);
              bomb.scale.set(0.68);
              bomb.alpha = 1;
            }
          } else if (elapsed >= impactAt && elapsed < impactAt + 640) {
            const bt = clamp01((elapsed - impactAt) / 640);
            const crater = ensurePooledSprite(decalSpritesRef, i, 'TACTICAL_CRATER_DECAL', true);
            if (crater) {
              crater.visible = true;
              crater.position.set(pt.x, pt.y);
              crater.scale.set(0.66);
              crater.alpha = bt < 0.55 ? 0.92 : 0.92 * (1 - (bt - 0.55) / 0.45);
            }
            if (bt < 0.65) {
              const fa = Math.pow(1 - bt / 0.65, 1.55);
              g.beginFill(0xFB923C, 0.66 * fa);
              g.drawCircle(pt.x, pt.y, 16 + easeOutCubic(bt / 0.65) * 44);
              g.endFill();
              g.lineStyle(3.4 * fa, 0xFEF08A, fa);
              g.drawCircle(pt.x, pt.y, 18 + easeOutCubic(bt / 0.65) * 58);
              g.lineStyle(0);
            }
          }
        }

        // Heavy Flying-Wing Bomber + wingtip contrails + offset ground shadow sailing edge-to-edge!
        drawWingtipContrails(
          g,
          bx + up.x * bomberAlt,
          by + up.y * bomberAlt,
          line.ux,
          line.uy,
          76,
          155 + climb * 50,
          1 - Math.max(0, tTotal - 0.92) / 0.08,
          0xFED7AA,
        );
        const shadow = ensureSprite(shadowSpriteRef, 'TACTICAL_HEAVY_BOMBER_SHADOW');
        if (shadow) {
          shadow.visible = true;
          shadow.position.set(bx - up.x * (36 + climb * 22) + 26, by - up.y * (36 + climb * 22) + 26);
          shadow.rotation = line.rot;
          shadow.scale.set(0.88 + climb * 0.05);
          shadow.alpha = 0.52 * (1 - climb * 0.34);
        }
        const bomber = ensureSprite(actorSpriteRef, 'TACTICAL_HEAVY_BOMBER');
        if (bomber) {
          bomber.visible = true;
          bomber.position.set(bx + up.x * bomberAlt, by + up.y * bomberAlt);
          bomber.rotation = line.rot;
          bomber.scale.set(0.96 + climb * 0.08);
          bomber.alpha = 1;
        }
        break;
      }

      // ── 10. ARTILLERY BARRAGE: 2×10 walking twin-column 155mm shell wall ──
      case 'ARTILLERY_BARRAGE': {
        const tiles = data.tiles.length > 0 ? data.tiles : [data.anchor];
        const w = 2;
        if (data.phase === 'MARK') {
          for (let i = 0; i < tiles.length; i++) {
            const step = Math.floor(i / w);
            const lt = clamp01((elapsed - step * 35) / 260);
            if (lt <= 0) continue;
            const pt = tileCenter(tiles[i]);
            g.lineStyle(2.4, 0xEF4444, 1 - lt * 0.65);
            g.drawRect(pt.x - 25, pt.y - 25, 50, 50);
          }
          g.lineStyle(0);
          break;
        }

        for (let i = 0; i < tiles.length; i++) {
          const step = Math.floor(i / w);
          const impactAt = 200 + step * 85 + (i % 2 === 1 ? 32 : 0);
          const shellStart = impactAt - 170;
          const pt = tileCenter(tiles[i]);

          if (elapsed >= shellStart && elapsed < impactAt) {
            const st = clamp01((elapsed - shellStart) / 170);
            const alt = (1 - st * st) * 240;
            const sx = pt.x + up.x * alt - up.y * (1 - st) * 28;
            const sy = pt.y + up.y * alt + up.x * (1 - st) * 28;
            g.lineStyle(5, 0xF97316, 0.74);
            g.moveTo(sx + up.x * 30, sy + up.y * 30);
            g.lineTo(sx, sy);
            g.lineStyle(2.2, 0xFEF08A, 0.98);
            g.moveTo(sx + up.x * 18, sy + up.y * 18);
            g.lineTo(sx, sy);
            g.lineStyle(0);
          } else if (elapsed >= impactAt) {
            const bt = clamp01((elapsed - impactAt) / 580);
            const crater = ensurePooledSprite(decalSpritesRef, i, 'TACTICAL_CRATER_DECAL', true);
            if (crater) {
              crater.visible = true;
              crater.position.set(pt.x, pt.y);
              crater.scale.set(0.58);
              crater.alpha = bt < 0.58 ? 0.88 : 0.88 * (1 - (bt - 0.58) / 0.42);
            }
            if (bt < 0.62) {
              const fa = Math.pow(1 - bt / 0.62, 1.5);
              g.beginFill(0xEF4444, 0.58 * fa);
              g.drawCircle(pt.x, pt.y, 13 + easeOutCubic(bt / 0.62) * 36);
              g.endFill();
              g.lineStyle(2.8 * fa, 0xFEF08A, fa);
              g.drawCircle(pt.x, pt.y, 15 + easeOutCubic(bt / 0.62) * 48);
              g.lineStyle(0);
            }
          }
        }
        break;
      }

      // ── 11. OVERCLOCK CORE: Reactor burst + crackling golden-cyan tethers to allies ──
      case 'OVERCLOCK_CORE': {
        const ease = easeOutCubic(tCombat);
        const a = Math.max(0, 1 - tCombat * tCombat);
        g.lineStyle(4 * a, 0xFACC15, a);
        g.drawCircle(anchor.x, anchor.y, 16 + ease * 88);
        g.lineStyle(2.2 * a, 0x38BDF8, a * 0.85);
        g.drawCircle(anchor.x, anchor.y, 10 + ease * 54);

        const allies = data.pings ?? [];
        for (let i = 0; i < allies.length; i++) {
          const ap = tileCenter(allies[i]);
          const midX = (anchor.x + ap.x) / 2 + Math.sin(elapsed * 0.03 + i) * 14;
          const midY = (anchor.y + ap.y) / 2 + Math.cos(elapsed * 0.03 + i) * 14;
          g.lineStyle(4.5 * a, 0xFACC15, 0.32 * a);
          g.moveTo(anchor.x, anchor.y);
          g.lineTo(midX, midY);
          g.lineTo(ap.x, ap.y);
          g.lineStyle(2 * a, 0xFFFBEB, 0.94 * a);
          g.moveTo(anchor.x, anchor.y);
          g.lineTo(midX, midY);
          g.lineTo(ap.x, ap.y);

          g.lineStyle(2.6 * a, 0xFACC15, a);
          g.drawCircle(ap.x, ap.y, 14 + ease * 24);
        }
        g.lineStyle(0);
        break;
      }
    }
  });

  return (
    <Container eventMode="none">
      <Container ref={spriteLayerRef} eventMode="none" />
      <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />
    </Container>
  );
});

/**
 * Transient animated FX layer for all 11 Tactical Weapons (full-map edge-to-edge jets, bombers,
 * cargo airlifters, hunter UAVs, JDAMs, cruise warheads, AWACS sweeps, lidar rings, EMP arcs).
 */
export const TacticalFxLayer: React.FC<{
  mapRotation: BoardRotation;
  gridSize: number;
}> = React.memo(({ mapRotation, gridSize }) => {
  const tacticalEffects = useEffectStore(state => state.tacticalEffects);
  if (tacticalEffects.length === 0) return null;
  return (
    <Container name="tactical_fx_layer" eventMode="none">
      {tacticalEffects.map(fx => (
        <TacticalFxItem key={fx.id} data={fx} mapRotation={mapRotation} gridSize={gridSize} />
      ))}
    </Container>
  );
});
