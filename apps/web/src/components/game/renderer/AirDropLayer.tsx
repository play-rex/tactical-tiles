import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Container, Graphics, Text, useApp, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { ActiveAirDrop, Tile } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { BoardRotation } from '../../../core/boardRotation';
import { sampleAirDropFlight } from '../../../core/graphics/airDropFlight';
import { fxTimeline, getPrefersReducedMotion, subscribeReducedMotion } from '../../../core/graphics/fxTimeline';
import type { ParticlePool } from '../../../core/graphics/ParticlePool';
import { getTexture } from '../../../core/graphics/TextureManager';
import { useEffectStore, type AirDropAnim } from '../../../store/useEffectStore';

const FIELD_LABEL_STYLE = new PIXI.TextStyle({
  fill: '#A5F3FC',
  fontSize: 9,
  fontWeight: '900',
  stroke: '#083344',
  strokeThickness: 3,
  letterSpacing: 0.45,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const TACTICAL_LABEL_STYLE = new PIXI.TextStyle({
  fill: '#FEF08A',
  fontSize: 9.5,
  fontWeight: '900',
  stroke: '#7C2D12',
  strokeThickness: 3.2,
  letterSpacing: 0.5,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const CRATE_Q_FIELD_STYLE = new PIXI.TextStyle({
  fill: '#ECFEFF',
  fontSize: 17,
  fontWeight: '900',
  stroke: '#0E7490',
  strokeThickness: 4,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const CRATE_Q_TAC_STYLE = new PIXI.TextStyle({
  fill: '#FEF08A',
  fontSize: 18,
  fontWeight: '900',
  stroke: '#7C2D12',
  strokeThickness: 4,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const BADGE_ANCHOR = { x: 0.5, y: 1 };

function screenUpVector(mapRotation: BoardRotation): { x: number; y: number } {
  const rad = (-mapRotation * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

function drawDashedBox(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
  dash = 10,
  gap = 7,
) {
  g.lineStyle(2, color, alpha);
  const seg = dash + gap;
  for (let d = 0; d < w; d += seg) {
    const x2 = Math.min(x + w, x + d + dash);
    g.moveTo(x + d, y);
    g.lineTo(x2, y);
    g.moveTo(x + d, y + h);
    g.lineTo(x2, y + h);
  }
  for (let d = 0; d < h; d += seg) {
    const y2 = Math.min(y + h, y + d + dash);
    g.moveTo(x, y + d);
    g.lineTo(x, y2);
    g.moveTo(x + w, y + d);
    g.lineTo(x + w, y2);
  }
  g.lineStyle(0);
}

/**
 * Ground-plane Theater Air Drop visuals (mounted below units):
 * - Phase 1 (DISPATCH, L-2): Soft pulsing 5x5 sector radar zone (exact LZ stays secret!)
 * - Phase 2 (FLARE, L-1): Live burning signal flare canister, rising colored smoke plumes,
 *   LZ brackets, and inbound plane heading chevrons
 * - Landed Mystery Crates (FIELD_SUPPLY / TACTICAL_SUPPLY): Distinct armored '?' mystery boxes
 *   visible as public contested objectives (hidden while parachute is still descending)
 */
export const AirDropGroundLayer: React.FC<{
  airDrops: ActiveAirDrop[];
  mapData: Tile[];
  gridSize: number;
  mapRotation: BoardRotation;
  animate: boolean;
  particlePoolRef: React.MutableRefObject<ParticlePool | null>;
}> = React.memo(({ airDrops, mapData, gridSize, mapRotation, animate, particlePoolRef }) => {
  const pendingAirDropTiles = useEffectStore(s => s.pendingAirDropTiles);
  const gfxRef = useRef<PIXI.Graphics>(null);
  const phaseRef = useRef(0);
  const lastEmitRef = useRef(0);

  const mysteryCrates = useMemo(
    () =>
      mapData.filter(
        t =>
          (t.loot === 'FIELD_SUPPLY' || t.loot === 'TACTICAL_SUPPLY') &&
          !pendingAirDropTiles.includes(t.id),
      ),
    [mapData, pendingAirDropTiles],
  );

  const hasContent = airDrops.length > 0 || mysteryCrates.length > 0;

  const drawFrame = useCallback(
    (g: PIXI.Graphics, tSec: number) => {
      g.clear();
      if (!hasContent) return;
      const up = screenUpVector(mapRotation);
      const boardPx = gridSize * TILE_SIZE;

      // 1. Incoming Air Drops (DISPATCH sector ring + FLARE live burning flare)
      for (let i = 0; i < airDrops.length; i++) {
        const d = airDrops[i];
        const isTac = d.kind === 'TACTICAL';
        const primary = isTac ? 0xF59E0B : 0x22D3EE;
        const hot = isTac ? 0xF43F5E : 0x34D399;
        const pulse = 0.5 + 0.5 * Math.sin(tSec * 3.8 + i * 1.4);

        if (d.phase === 'DISPATCH') {
          const sx = Math.max(0, d.sectorCenter.x - 2) * TILE_SIZE;
          const sy = Math.max(0, d.sectorCenter.y - 2) * TILE_SIZE;
          const ex = Math.min(gridSize, d.sectorCenter.x + 3) * TILE_SIZE;
          const ey = Math.min(gridSize, d.sectorCenter.y + 3) * TILE_SIZE;
          const sw = Math.max(TILE_SIZE, ex - sx);
          const sh = Math.max(TILE_SIZE, ey - sy);
          const cx = sx + sw / 2;
          const cy = sy + sh / 2;

          g.beginFill(primary, 0.055 + pulse * 0.035);
          g.drawRect(sx + 2, sy + 2, sw - 4, sh - 4);
          g.endFill();

          drawDashedBox(g, sx + 3, sy + 3, sw - 6, sh - 6, primary, 0.48 + pulse * 0.28, 12, 8);

          // Expanding soft radar ping inside the 5x5 sector
          const ringP = (tSec * 0.45 + i * 0.5) % 1;
          g.lineStyle(1.8, primary, (1 - ringP) * 0.55);
          g.drawCircle(cx, cy, 18 + ringP * Math.min(sw, sh) * 0.42);
          g.lineStyle(0);
          continue;
        }

        if (d.phase === 'FLARE' && d.at) {
          const px = d.at.x * TILE_SIZE;
          const py = d.at.y * TILE_SIZE;
          const cx = px + TILE_SIZE / 2;
          const cy = py + TILE_SIZE / 2;

          // Bright LZ beacon pad + pulsing corner brackets
          g.beginFill(primary, 0.14 + pulse * 0.1);
          g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.endFill();

          const arm = 12;
          const ins = 3;
          g.lineStyle(2.6, primary, 0.85 + pulse * 0.15);
          g.moveTo(px + ins, py + ins + arm);
          g.lineTo(px + ins, py + ins);
          g.lineTo(px + ins + arm, py + ins);
          g.moveTo(px + TILE_SIZE - ins - arm, py + ins);
          g.lineTo(px + TILE_SIZE - ins, py + ins);
          g.lineTo(px + TILE_SIZE - ins, py + ins + arm);
          g.moveTo(px + TILE_SIZE - ins, py + TILE_SIZE - ins - arm);
          g.lineTo(px + TILE_SIZE - ins, py + TILE_SIZE - ins);
          g.lineTo(px + TILE_SIZE - ins - arm, py + TILE_SIZE - ins);
          g.moveTo(px + ins + arm, py + TILE_SIZE - ins);
          g.lineTo(px + ins, py + TILE_SIZE - ins);
          g.lineTo(px + ins, py + TILE_SIZE - ins - arm);

          // Expanding ground flare sonar wave
          const waveP = (tSec * 0.85 + i * 0.35) % 1;
          g.lineStyle(2, hot, (1 - waveP) * 0.8);
          g.drawCircle(cx, cy, 10 + waveP * 26);

          // Inbound aircraft approach vector chevron pointing from entry direction
          const ux = Math.cos(d.headingRad);
          const uy = Math.sin(d.headingRad);
          const arrowDist = TILE_SIZE * 0.92;
          const ax = cx - ux * arrowDist;
          const ay = cy - uy * arrowDist;
          if (ax > 10 && ax < boardPx - 10 && ay > 10 && ay < boardPx - 10) {
            const perpX = -uy;
            const perpY = ux;
            g.lineStyle(2.2, primary, 0.65 + pulse * 0.25);
            g.moveTo(ax - ux * 10 + perpX * 8, ay - uy * 10 + perpY * 8);
            g.lineTo(ax + ux * 6, ay + uy * 6);
            g.lineTo(ax - ux * 10 - perpX * 8, ay - uy * 10 - perpY * 8);
          }
          g.lineStyle(0);

          // Rising procedural colored flare smoke puffs (always legible in both ECO and LIVE modes)
          for (let pIdx = 0; pIdx < 4; pIdx++) {
            const pLife = (tSec * 0.9 + pIdx * 0.25) % 1;
            const rise = 6 + pLife * 32;
            const drift = Math.sin(tSec * 3.2 + pIdx * 1.9) * (2.5 + pLife * 4.5);
            const sx = cx + up.x * rise - up.y * drift;
            const sy = cy + up.y * rise + up.x * drift;
            g.beginFill(hot, (1 - pLife) * 0.42);
            g.drawCircle(sx, sy, 4.5 + pLife * 8.5);
            g.endFill();
          }

          // Burning signal flare canister + incandescent tip
          g.beginFill(0x1E293B, 0.95);
          g.drawCircle(cx, cy, 6.2);
          g.endFill();
          g.beginFill(hot, 0.96);
          g.drawCircle(cx, cy, 4.4 + pulse * 1.1);
          g.endFill();
          g.beginFill(0xFFFBEB, 0.96);
          g.drawCircle(cx, cy, 2.2);
          g.endFill();
        }
      }

      // 2. Landed Mystery Supply Crates (strictly mystery '?' boxes until claimed!)
      for (let i = 0; i < mysteryCrates.length; i++) {
        const tile = mysteryCrates[i];
        const isTac = tile.loot === 'TACTICAL_SUPPLY';
        const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
        const pulse = 0.5 + 0.5 * Math.sin(tSec * 3.4 + i * 1.1);
        const accent = isTac ? 0xFACC15 : 0x22D3EE;
        const body = isTac ? 0x1C1917 : 0x0F172A;
        const trim = isTac ? 0xF59E0B : 0x10B981;

        // Soft pulsing beacon aura under the crate so players spot contested crates fast
        g.beginFill(accent, 0.14 + pulse * 0.12);
        g.drawCircle(cx, cy, 22 + pulse * 4);
        g.endFill();
        g.lineStyle(1.8, accent, 0.55 + pulse * 0.3);
        g.drawCircle(cx, cy, 20 + pulse * 3);
        g.lineStyle(0);

        // Ground shadow
        g.beginFill(0x020617, 0.42);
        g.drawEllipse(cx, cy + 12, 16, 6.5);
        g.endFill();

        // Armored military mystery crate body
        const halfW = isTac ? 14.5 : 13;
        const halfH = isTac ? 12.5 : 11.5;
        g.lineStyle(2.2, accent, 0.98);
        g.beginFill(body, 0.96);
        g.drawRoundedRect(cx - halfW, cy - halfH, halfW * 2, halfH * 2, 4);
        g.endFill();

        // Reinforced top/bottom hazard bands
        g.lineStyle(0);
        g.beginFill(trim, 0.88);
        g.drawRect(cx - halfW + 2, cy - halfH + 2, (halfW - 2) * 2, 3);
        g.drawRect(cx - halfW + 2, cy + halfH - 5, (halfW - 2) * 2, 3);
        g.endFill();
      }
    },
    [hasContent, airDrops, mysteryCrates, gridSize, mapRotation],
  );

  const initialDraw = useCallback(
    (g: PIXI.Graphics) => {
      drawFrame(g, phaseRef.current);
    },
    [drawFrame],
  );

  useEffect(() => {
    const g = gfxRef.current;
    if (g && !g.destroyed) drawFrame(g, phaseRef.current);
  }, [drawFrame]);

  useTick((delta) => {
    if (!hasContent) return;
    const g = gfxRef.current;
    if (!g || g.destroyed) return;
    if (!animate) return;
    phaseRef.current += (delta / 60);
    drawFrame(g, phaseRef.current);

    // Emit ambient flare smoke puffs into pooled particle system in LIVE mode
    const now = performance.now();
    if (now - lastEmitRef.current > 240 && particlePoolRef.current && !getPrefersReducedMotion()) {
      lastEmitRef.current = now;
      for (const d of airDrops) {
        if (d.phase === 'FLARE' && d.at) {
          particlePoolRef.current.emit({
            preset: 'dustPuff',
            x: d.at.x * TILE_SIZE + TILE_SIZE / 2,
            y: d.at.y * TILE_SIZE + TILE_SIZE / 2,
            color: d.kind === 'TACTICAL' ? 0xFB923C : 0x34D399,
            scale: 0.45,
          });
        }
      }
    }
  });

  if (!hasContent) return null;

  return (
    <Container name="air_drop_ground" eventMode="none">
      <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />

      {/* Counter-rotated labels for DISPATCH sectors and FLARE landing zones */}
      {airDrops.map(d => {
        const isTac = d.kind === 'TACTICAL';
        const tx =
          d.phase === 'FLARE' && d.at
            ? d.at.x * TILE_SIZE + TILE_SIZE / 2
            : d.sectorCenter.x * TILE_SIZE + TILE_SIZE / 2;
        const ty =
          d.phase === 'FLARE' && d.at
            ? d.at.y * TILE_SIZE + TILE_SIZE / 2
            : Math.max(0, d.sectorCenter.y - 2) * TILE_SIZE + 14;
        const label =
          d.phase === 'FLARE'
            ? isTac
              ? 'TACTICAL DROP · 1R'
              : 'FIELD DROP · 1R'
            : isTac
              ? 'TACTICAL SECTOR · 2R'
              : 'FIELD SECTOR · 2R';
        return (
          <Container key={d.id} x={tx} y={ty} angle={-mapRotation}>
            <Text
              text={label}
              anchor={BADGE_ANCHOR}
              x={0}
              y={d.phase === 'FLARE' ? TILE_SIZE / 2 - 2 : 0}
              style={isTac ? TACTICAL_LABEL_STYLE : FIELD_LABEL_STYLE}
            />
          </Container>
        );
      })}

      {/* Upright '?' mystery markers on landed Air Supply Crates (zero spoiler of contents!) */}
      {mysteryCrates.map(tile => {
        const isTac = tile.loot === 'TACTICAL_SUPPLY';
        const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
        return (
          <Container key={`mystery_${tile.id}`} x={cx} y={cy} angle={-mapRotation}>
            <Text
              text="?"
              anchor={0.5}
              x={0}
              y={-1}
              style={isTac ? CRATE_Q_TAC_STYLE : CRATE_Q_FIELD_STYLE}
            />
            <Text
              text={isTac ? 'TACTICAL' : 'FIELD'}
              anchor={BADGE_ANCHOR}
              x={0}
              y={TILE_SIZE / 2 - 2}
              style={isTac ? TACTICAL_LABEL_STYLE : FIELD_LABEL_STYLE}
            />
          </Container>
        );
      })}
    </Container>
  );
});

const AirDropFlightItem: React.FC<{ data: AirDropAnim; mapRotation: BoardRotation }> = React.memo(
  ({ data, mapRotation }) => {
    const app = useApp();
    const gfxRef = useRef<PIXI.Graphics>(null);
    const planeSpriteRef = useRef<PIXI.Sprite | null>(null);
    const shadowSpriteRef = useRef<PIXI.Sprite | null>(null);
    const containerRef = useRef<PIXI.Container>(null);
    const elapsedRef = useRef(0);
    const reducedRef = useRef(getPrefersReducedMotion());

    useEffect(() => {
      reducedRef.current = getPrefersReducedMotion();
      return subscribeReducedMotion(r => {
        reducedRef.current = r;
      });
    }, []);

    useEffect(() => {
      return () => {
        for (const ref of [planeSpriteRef, shadowSpriteRef]) {
          if (ref.current) {
            ref.current.parent?.removeChild(ref.current);
            ref.current.destroy();
            ref.current = null;
          }
        }
      };
    }, []);

    const ensureSprite = (ref: React.MutableRefObject<PIXI.Sprite | null>, texKey: string) => {
      const host = containerRef.current;
      if (!host || host.destroyed) return null;
      if (!ref.current || ref.current.destroyed) {
        const tex = getTexture(texKey);
        if (!tex) return null;
        const spr = new PIXI.Sprite(tex);
        spr.anchor.set(0.5);
        spr.eventMode = 'none';
        host.addChild(spr);
        ref.current = spr;
      }
      return ref.current;
    };

    const initialDraw = useCallback((g: PIXI.Graphics) => {
      g.clear();
    }, []);

    useTick(() => {
      const g = gfxRef.current;
      if (!g || g.destroyed) return;

      // Advance cleanly on real/combat time; once crate touches down, exit cruise runs at 1x real time!
      const rawDt = Math.max(0, Math.min(33.33, (app as any)?.ticker?.deltaMS ?? 16.67));
      const dtMs = data.ambientOnly ? rawDt : fxTimeline.getLastCombatDtMs();
      elapsedRef.current += dtMs;
      const elapsed = elapsedRef.current;
      const plan = data.kinematics;
      const sample = sampleAirDropFlight(plan, elapsed, reducedRef.current);

      g.clear();
      const up = screenUpVector(mapRotation);
      const isTac = plan.dropKind === 'TACTICAL';
      const accent = isTac ? 0xFACC15 : 0x22D3EE;
      const secondary = isTac ? 0xEF4444 : 0x34D399;

      // 1. Overhead Supply Plane + altitude-offset ground shadow + wingtip contrails + cargo ramp glow
      const planeKey = isTac ? 'TACTICAL_HEAVY_LIFTER' : 'TACTICAL_CARGO_PLANE';
      const shadowKey = isTac ? 'TACTICAL_HEAVY_LIFTER_SHADOW' : 'TACTICAL_CARGO_PLANE_SHADOW';
      const shadow = ensureSprite(shadowSpriteRef, shadowKey);
      const plane = ensureSprite(planeSpriteRef, planeKey);

      if (sample.planeVisible && sample.planeAlpha > 0.01) {
        const px = sample.planeX + up.x * sample.planeAlt;
        const py = sample.planeY + up.y * sample.planeAlt;

        // Twin wingtip contrails
        const perpX = -plan.uy;
        const perpY = plan.ux;
        const wingHalf = isTac ? 62 : 54;
        const trailLen = isTac ? 165 : 135;
        for (const side of [-1, 1]) {
          const sx = px + perpX * wingHalf * side;
          const sy = py + perpY * wingHalf * side;
          g.lineStyle(2.4, isTac ? 0xFEF08A : 0xE2E8F0, 0.34 * sample.planeAlpha);
          g.moveTo(sx, sy);
          g.lineTo(sx - plan.ux * trailLen, sy - plan.uy * trailLen);
        }
        g.lineStyle(0);

        // Glowing rear cargo bay beacon when ramp lowers before drop
        if (sample.rampGlow > 0.02) {
          const bx = px - plan.ux * 44;
          const by = py - plan.uy * 44;
          g.beginFill(accent, 0.55 * sample.rampGlow);
          g.drawCircle(bx, by, 10 + sample.rampGlow * 8);
          g.endFill();
        }

        if (shadow) {
          shadow.visible = true;
          shadow.position.set(sample.planeX + 46, sample.planeY + 54);
          shadow.rotation = sample.planeRot;
          shadow.scale.set(isTac ? 0.84 : 0.78);
          shadow.alpha = 0.42 * sample.planeAlpha;
        }
        if (plane) {
          plane.visible = true;
          plane.position.set(px, py);
          plane.rotation = sample.planeRot;
          plane.scale.set(isTac ? 0.92 : 0.84);
          plane.alpha = sample.planeAlpha;
        }
      } else {
        if (shadow) shadow.visible = false;
        if (plane) plane.visible = false;
      }

      // 2. Parachute & Mystery Supply Crate Descent
      if (sample.chuteVisible) {
        const rightX = -up.y;
        const rightY = up.x;
        const swayX = rightX * sample.swayPx;
        const swayY = rightY * sample.swayPx;

        // Growing ground shadow anchored to exact LZ coordinates
        g.beginFill(0x020617, 0.16 + sample.shadowScale * 0.3);
        g.drawEllipse(sample.crateX, sample.crateY + 9, 15 * sample.shadowScale, 7 * sample.shadowScale);
        g.endFill();

        const crateX = sample.crateX + up.x * sample.crateAltitude + swayX * 0.48;
        const crateY = sample.crateY + up.y * sample.crateAltitude + swayY * 0.48;

        // Parachute canopy(ies) + shroud lines
        if (sample.canopyAlpha > 0.02) {
          const canopyOff = 30 * sample.canopyScale;
          const canopyOffsets = isTac ? [-11, 11] : [0];
          for (const spread of canopyOffsets) {
            const canX = crateX + up.x * canopyOff + swayX * 0.55 + rightX * spread;
            const canY = crateY + up.y * canopyOff + swayY * 0.55 + rightY * spread;
            const rad = (isTac ? 14.5 : 18) * sample.canopyScale;

            // Shroud lines connecting crate to canopy edges
            g.lineStyle(1.3, 0xE2E8F0, 0.86 * sample.canopyAlpha);
            g.moveTo(crateX - rightX * 6, crateY - rightY * 6);
            g.lineTo(canX - rightX * rad * 0.88, canY - rightY * rad * 0.88);
            g.moveTo(crateX + rightX * 6, crateY + rightY * 6);
            g.lineTo(canX + rightX * rad * 0.88, canY + rightY * rad * 0.88);
            g.moveTo(crateX, crateY);
            g.lineTo(canX, canY);
            g.lineStyle(0);

            // Canopy dome aligned screen-upright via up vector
            const baseAngle = Math.atan2(up.y, up.x);
            g.beginFill(isTac ? 0xFEF9C3 : 0xF8FAFC, 0.95 * sample.canopyAlpha);
            g.arc(canX, canY, rad, baseAngle - Math.PI / 2, baseAngle + Math.PI / 2);
            g.closePath();
            g.endFill();

            g.beginFill(isTac ? secondary : accent, 0.86 * sample.canopyAlpha);
            g.arc(canX, canY, rad, baseAngle - Math.PI * 0.2, baseAngle + Math.PI * 0.2);
            g.lineTo(canX, canY);
            g.closePath();
            g.endFill();

            g.lineStyle(1.6, isTac ? 0x991B1B : 0x0E7490, 0.85 * sample.canopyAlpha);
            g.arc(canX, canY, rad, baseAngle - Math.PI / 2, baseAngle + Math.PI / 2);
            g.lineStyle(0);
          }
        }

        // Falling armored mystery crate (fades smoothly into grounded crate right at touchdown)
        const crateAlpha = sample.touchedDown ? Math.max(0, sample.touchdownFlash * 0.85) : 1;
        if (crateAlpha > 0.02) {
          const hw = isTac ? 12.5 : 11;
          const hh = isTac ? 10.5 : 9.5;
          g.lineStyle(2, accent, 0.96 * crateAlpha);
          g.beginFill(isTac ? 0x1C1917 : 0x0F172A, 0.96 * crateAlpha);
          g.drawRoundedRect(crateX - hw, crateY - hh, hw * 2, hh * 2, 3);
          g.endFill();
          g.lineStyle(0);
          g.beginFill(secondary, 0.92 * crateAlpha);
          g.drawRect(crateX - hw + 2, crateY - 2, (hw - 2) * 2, 4);
          g.endFill();
        }
      }

      // 3. Touchdown ground beacon ring
      if (sample.touchdownFlash > 0.02) {
        const ringT = 1 - sample.touchdownFlash;
        g.lineStyle(3 * sample.touchdownFlash, accent, sample.touchdownFlash);
        g.drawCircle(plan.lzX, plan.lzY, 12 + ringT * 34);
        g.lineStyle(0);
      }
    });

    return (
      <Container ref={containerRef} name={`airdrop_${data.id}`} eventMode="none">
        <Graphics ref={gfxRef} draw={initialDraw} eventMode="none" />
      </Container>
    );
  },
);

/** Aerial Theater Air Drop layer (planes + parachutes, mounted above units & fog). */
export const AirDropAirLayer: React.FC<{ mapRotation: BoardRotation }> = React.memo(({ mapRotation }) => {
  const airDropAnims = useEffectStore(s => s.airDropAnims);
  if (airDropAnims.length === 0) return null;
  return (
    <Container name="air_drop_air" eventMode="none">
      {airDropAnims.map(anim => (
        <AirDropFlightItem key={anim.id} data={anim} mapRotation={mapRotation} />
      ))}
    </Container>
  );
});
