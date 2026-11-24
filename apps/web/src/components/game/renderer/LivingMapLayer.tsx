import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Graphics, useApp, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { Tile } from '@tactical/engine/types';
import { PLAYER_COLORS, TILE_SIZE } from '@tactical/engine/constants/Config';
import type { ParticlePool } from '../../../core/graphics/ParticlePool';
import {
  fxTimeline,
  getPrefersReducedMotion,
  subscribeReducedMotion,
} from '../../../core/graphics/fxTimeline';

interface LivingMapLayerProps {
  mapData: Tile[];
  gridSize: number;
  fogOfWar: boolean;
  visibleTiles: Set<string>;
  victoryMode: string;
  animate: boolean;
  particlePoolRef: React.MutableRefObject<ParticlePool | null>;
}

const parseFactionHex = (owner: number | null | undefined): number => {
  if (owner === null || owner === undefined || owner < 0) return 0x94A3B8;
  const raw = PLAYER_COLORS[owner];
  if (!raw) return 0x94A3B8;
  const parsed = Number.parseInt(raw.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x94A3B8;
};

const drawRadarSweepCone = (
  g: PIXI.Graphics,
  cx: number,
  cy: number,
  radius: number,
  angle: number,
  color: number,
  animated: boolean,
) => {
  if (!animated) {
    const dx = Math.cos(angle) * (radius * 0.45);
    const dy = Math.sin(angle) * (radius * 0.45);
    g.lineStyle(2, 0xE2E8F0, 0.72);
    g.moveTo(cx - dx, cy - dy);
    g.lineTo(cx + dx, cy + dy);
    g.lineStyle(0);
    return;
  }

  g.lineStyle(1, color, 0.25);
  g.drawCircle(cx, cy, radius);
  g.lineStyle(0);

  const slices = [
    { startOff: -0.74, endOff: -0.44, alpha: 0.08 },
    { startOff: -0.44, endOff: -0.18, alpha: 0.16 },
    { startOff: -0.18, endOff: 0, alpha: 0.28 },
  ];
  for (let s = 0; s < slices.length; s++) {
    const sl = slices[s];
    g.beginFill(color, sl.alpha);
    g.moveTo(cx, cy);
    g.arc(cx, cy, radius, angle + sl.startOff, angle + sl.endOff);
    g.lineTo(cx, cy);
    g.endFill();
  }

  g.lineStyle(2, color, 0.85);
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  g.lineStyle(0);

  g.beginFill(0xFFFFFF, 0.85);
  g.drawCircle(cx, cy, 2.0);
  g.endFill();
};

/** Helper to draw a rotated local-space polygon around `(cx, cy)` at heading `angle`. */
const drawRotRect = (
  g: PIXI.Graphics,
  cx: number,
  cy: number,
  angle: number,
  lx: number,
  ly: number,
  w: number,
  h: number,
) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x0 = lx;
  const y0 = ly;
  const x1 = lx + w;
  const y1 = ly + h;
  g.drawPolygon([
    cx + x0 * cos - y0 * sin, cy + x0 * sin + y0 * cos,
    cx + x1 * cos - y0 * sin, cy + x1 * sin + y0 * cos,
    cx + x1 * cos - y1 * sin, cy + x1 * sin + y1 * cos,
    cx + x0 * cos - y1 * sin, cy + x0 * sin + y1 * cos,
  ]);
};

/**
 * Draws a crisp top-down rotating Twin-Barrel Heavy Machine Gun Turret mounted on a Base's
 * armored slewing ring, complete with side ammo drum, perforated barrel shrouds, muzzle brakes,
 * alternating barrel recoil, and firing muzzle flash.
 */
const drawBaseMachineGunTurret = (
  g: PIXI.Graphics,
  cx: number,
  cy: number,
  angle: number,
  factionColor: number,
  recoilLeft: number,
  recoilRight: number,
  firingSide: -1 | 0 | 1,
) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // 1. Turret drop shadow
  g.beginFill(0x020617, 0.42);
  g.drawCircle(cx + 2, cy + 3, 12.5);
  g.endFill();

  // 2. Twin heavy .50 cal machine gun barrels (left = -y, right = +y in turret frame)
  const leftKick = recoilLeft * 3.8;
  const rightKick = recoilRight * 3.8;

  // Cooling shrouds (dark perforated jackets)
  g.beginFill(0x1E293B, 1);
  drawRotRect(g, cx, cy, angle, 5 - leftKick, -5.8, 12, 3.6);
  drawRotRect(g, cx, cy, angle, 5 - rightKick, 2.2, 12, 3.6);
  g.endFill();

  // Steel inner barrels extending forward
  g.beginFill(0xE2E8F0, 1);
  drawRotRect(g, cx, cy, angle, 15 - leftKick, -5.1, 10, 2.2);
  drawRotRect(g, cx, cy, angle, 15 - rightKick, 2.9, 10, 2.2);
  g.endFill();

  // Heavy slotted muzzle brakes
  g.beginFill(0x0F172A, 1);
  drawRotRect(g, cx, cy, angle, 23 - leftKick, -5.8, 3.5, 3.6);
  drawRotRect(g, cx, cy, angle, 23 - rightKick, 2.2, 3.5, 3.6);
  g.endFill();

  // 3. Side-mounted armored ammo drum + brass feed belt strip
  g.lineStyle(1, 0x0F172A, 0.9);
  g.beginFill(0x3F6212, 1);
  drawRotRect(g, cx, cy, angle, -7, -13.5, 10, 4.5);
  g.endFill();
  g.lineStyle(0);
  g.beginFill(0xFACC15, 0.9);
  drawRotRect(g, cx, cy, angle, -3.5, -9.2, 4.5, 2.2);
  g.endFill();

  // 4. Angular steel armored turret housing
  g.lineStyle(1.4, 0xCBD5E1, 0.95);
  g.beginFill(0x475569, 1);
  drawRotRect(g, cx, cy, angle, -11, -9.5, 19, 19);
  g.endFill();
  g.lineStyle(0);

  // Front armored gun mantlet shield
  g.beginFill(0x94A3B8, 1);
  drawRotRect(g, cx, cy, angle, 6, -8, 3.2, 16);
  g.endFill();

  // 5. Faction armored commander cupola / cap
  const capX = cx + (-2.5) * cos;
  const capY = cy + (-2.5) * sin;
  g.lineStyle(1.5, 0xFFFFFF, 0.9);
  g.beginFill(factionColor, 1);
  g.drawCircle(capX, capY, 6);
  g.endFill();
  g.lineStyle(0);

  // Rear sensor / optic slit
  g.beginFill(0x38BDF8, 0.95);
  drawRotRect(g, cx, cy, angle, 2.5, -2.5, 2.5, 5);
  g.endFill();

  // 6. Active barrel muzzle flash burst while firing
  if (firingSide !== 0) {
    const ly = firingSide < 0 ? -4 : 4;
    const tipDist = 27;
    const fx = cx + tipDist * cos - ly * sin;
    const fy = cy + tipDist * sin + ly * cos;
    g.beginFill(0xF97316, 0.65);
    g.drawCircle(fx, fy, 7.5);
    g.endFill();
    g.beginFill(0xFEF08A, 0.98);
    g.drawCircle(fx, fy, 4.2);
    g.endFill();
    g.beginFill(0xFFFFFF, 1);
    g.drawCircle(fx, fy, 2.0);
    g.endFill();
  }
};

/**
 * Ambient `LIVE` mode structure life + live rotating Base Heavy Machine Gun Turrets
 * (mounted inside `rotated_board`):
 * - Rotating twin-barrel `.50 cal` machine gun turrets on every visible Base (tracks & fires
 *   on enemies in BOTH ECO & LIVE modes; patrols smoothly in LIVE mode)
 * - Rotating radar sweep cones on visible Watchtowers & Base comms masts
 * - Slow breathing golden vault beacon & orbiting glints on active Banks
 * - Rising ambient smoke wisps (and distress embers <25% HP) on damaged Bases (<50% HP)
 */
export const LivingMapLayer: React.FC<LivingMapLayerProps> = React.memo(
  ({ mapData, gridSize, fogOfWar, visibleTiles, victoryMode, animate, particlePoolRef }) => {
    const app = useApp();
    const gfxRef = useRef<PIXI.Graphics>(null);
    const timeSecRef = useRef(0);
    const smokeAccumMsRef = useRef(0);
    const turretAngleRef = useRef<Map<string, number>>(new Map());
    const hadActiveTurretRef = useRef(false);
    const reducedMotionRef = useRef<boolean>(getPrefersReducedMotion());

    const structureLists = useMemo(() => {
      const bases: Tile[] = [];
      const watchtowers: Tile[] = [];
      const activeBanks: Tile[] = [];
      const damagedBases: Tile[] = [];
      const lavaTiles: Tile[] = [];

      for (let i = 0; i < mapData.length; i++) {
        const t = mapData[i];
        if (t.type === 'BASE' && (t.hp === undefined || t.hp > 0)) {
          bases.push(t);
          if (victoryMode === 'CONQUER' && t.hp !== undefined && t.maxHp && t.hp > 0 && t.hp / t.maxHp < 0.5) {
            damagedBases.push(t);
          }
        } else if (t.type === 'BUILDING' && t.subType === 'WATCHTOWER') {
          watchtowers.push(t);
        } else if (t.type === 'BANK' && (t.hackProgress ?? 0) < 100) {
          activeBanks.push(t);
        }
        if (t.hazardState === 'LAVA') {
          lavaTiles.push(t);
        }
      }
      return { bases, watchtowers, activeBanks, damagedBases, lavaTiles };
    }, [mapData, victoryMode]);

    const boardCenterPx = (gridSize * TILE_SIZE) / 2;

    const renderFrame = useCallback(
      (g: PIXI.Graphics, tSec: number, dtSec: number, isAmbientAnimated: boolean) => {
        g.clear();
        const isVisible = (tile: Tile) => !fogOfWar || visibleTiles.has(tile.id);

        // 1. Bases: Rotating Twin-Barrel Heavy Machine Gun Turret + subtle corner comms radar
        for (let i = 0; i < structureLists.bases.length; i++) {
          const b = structureLists.bases[i];
          if (!isVisible(b)) continue;
          const cx = b.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = b.y * TILE_SIZE + TILE_SIZE / 2;
          const baseCenterAngle = Math.atan2(boardCenterPx - cy, boardCenterPx - cx);

          const turretState = fxTimeline.getBaseTurretState(b.x, b.y);
          let targetAngle = baseCenterAngle;
          let recoilLeft = 0;
          let recoilRight = 0;
          let firingSide: -1 | 0 | 1 = 0;

          if (turretState) {
            targetAngle = turretState.aimAngle;
            recoilLeft = turretState.recoilLeft;
            recoilRight = turretState.recoilRight;
            firingSide = turretState.firingSide;
          } else if (isAmbientAnimated) {
            // Smooth automated sentry patrol sweep ±48° watching the battlefield
            targetAngle = baseCenterAngle + Math.sin(tSec * 0.68 + b.x * 1.1 + b.y * 0.5) * 0.84;
          }

          const prevAngle = turretAngleRef.current.get(b.id) ?? targetAngle;
          const diff = ((targetAngle - prevAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
          const slewSpeed = turretState ? 22 : 4.5;
          const curAngle = dtSec > 0 ? prevAngle + diff * Math.min(1, slewSpeed * dtSec) : targetAngle;
          turretAngleRef.current.set(b.id, curAngle);

          // Small comms radar sweep on corner mast
          const radarAng = tSec * 1.25 + b.x * 0.7;
          drawRadarSweepCone(g, cx - 16, cy - 16, 9, radarAng, 0x34D399, isAmbientAnimated);

          // Live rotating Twin-Barrel Heavy Machine Gun Turret
          drawBaseMachineGunTurret(
            g,
            cx,
            cy,
            curAngle,
            parseFactionHex(b.owner),
            recoilLeft,
            recoilRight,
            firingSide,
          );
        }

        // 2. Watchtower Recon Sweep Cones
        for (let i = 0; i < structureLists.watchtowers.length; i++) {
          const wt = structureLists.watchtowers[i];
          if (!isVisible(wt)) continue;
          const cx = wt.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = wt.y * TILE_SIZE + TILE_SIZE / 2;
          const ang = -tSec * 1.45 + wt.x * 0.9 + wt.y * 0.5;
          drawRadarSweepCone(g, cx, cy, 14, ang, 0x38BDF8, isAmbientAnimated);
        }

        // 3. Active Bank Vault Golden Beacon (gentle 0.35 Hz breathing glow, WCAG flash-safe)
        for (let i = 0; i < structureLists.activeBanks.length; i++) {
          const bank = structureLists.activeBanks[i];
          if (!isVisible(bank)) continue;
          const cx = bank.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = bank.y * TILE_SIZE + TILE_SIZE / 2;
          const pulse = isAmbientAnimated ? 0.5 + 0.5 * Math.sin(tSec * 2.2 + bank.x) : 0.65;

          g.lineStyle(2, 0xFACC15, 0.35 + pulse * 0.45);
          g.drawCircle(cx, cy, 14 + pulse * 6);
          g.lineStyle(0);

          if (isAmbientAnimated) {
            const orbit = tSec * 1.3 + bank.y;
            for (let k = 0; k < 2; k++) {
              const a = orbit + k * Math.PI;
              g.beginFill(0xFEF08A, 0.82);
              g.drawCircle(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 2.4);
              g.endFill();
            }
          }
        }
      },
      [structureLists, fogOfWar, visibleTiles, boardCenterPx],
    );

    useEffect(() => {
      reducedMotionRef.current = getPrefersReducedMotion();
      const redraw = () => {
        const g = gfxRef.current;
        if (g && !g.destroyed) {
          renderFrame(g, timeSecRef.current, 0, animate && !reducedMotionRef.current);
        }
      };
      redraw();
      return subscribeReducedMotion((reduced) => {
        reducedMotionRef.current = reduced;
        redraw();
      });
    }, [renderFrame, animate]);

    useTick(() => {
      const g = gfxRef.current;
      if (!g || g.destroyed) return;

      const isAmbientAnimated = animate && !reducedMotionRef.current;
      const hasActiveTurret = fxTimeline.hasActiveBaseTurret();
      if (!isAmbientAnimated && !hasActiveTurret && !hadActiveTurretRef.current) {
        return;
      }
      hadActiveTurretRef.current = hasActiveTurret;

      const dtMs = Math.min(50, Math.max(0, (app as any)?.ticker?.deltaMS ?? 16.67));
      const dtSec = dtMs / 1000;
      if (isAmbientAnimated) {
        timeSecRef.current += dtSec;
      }
      renderFrame(g, timeSecRef.current, dtSec, isAmbientAnimated);

      if (!isAmbientAnimated) return;

      // Emit rising ambient smoke wisps on damaged bases (<50% HP) and occasional magma sparks on LAVA
      const pool = particlePoolRef.current;
      if (!pool) return;
      smokeAccumMsRef.current += dtMs;
      if (smokeAccumMsRef.current < 440) return;
      smokeAccumMsRef.current = 0;

      for (let i = 0; i < structureLists.damagedBases.length; i++) {
        const b = structureLists.damagedBases[i];
        if (fogOfWar && !visibleTiles.has(b.id)) continue;
        const cx = b.x * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 16;
        const cy = b.y * TILE_SIZE + TILE_SIZE / 2 + (Math.random() - 0.5) * 12;
        const hpRatio = b.hp! / b.maxHp!;

        pool.spawn({
          texture: 'softPuff',
          ambient: true,
          x: cx,
          y: cy,
          vx: (Math.random() - 0.5) * 14,
          vy: (Math.random() - 0.5) * 14,
          upAccel: 42,
          drag: 1.5,
          lifeMs: 900 + Math.random() * 450,
          startScale: 0.28,
          endScale: 0.95,
          color: hpRatio < 0.25 ? 0x1E293B : 0x475569,
          alpha: 0.45,
          fadeInFrac: 0.16,
        });

        if (hpRatio < 0.25 && Math.random() < 0.65) {
          pool.spawn({
            texture: 'shard',
            additive: true,
            ambient: true,
            x: cx,
            y: cy,
            vx: (Math.random() - 0.5) * 24,
            vy: (Math.random() - 0.5) * 24,
            upAccel: 58,
            drag: 1.4,
            lifeMs: 560,
            startScale: 0.24,
            endScale: 0.05,
            color: 0xF97316,
            alpha: 0.9,
            vr: (Math.random() - 0.5) * 8,
          });
        }
      }

      if (structureLists.lavaTiles.length > 0 && Math.random() < 0.55) {
        const lava = structureLists.lavaTiles[Math.floor(Math.random() * structureLists.lavaTiles.length)];
        if (!fogOfWar || visibleTiles.has(lava.id)) {
          pool.spawn({
            texture: 'glow',
            additive: true,
            ambient: true,
            x: lava.x * TILE_SIZE + 10 + Math.random() * (TILE_SIZE - 20),
            y: lava.y * TILE_SIZE + 10 + Math.random() * (TILE_SIZE - 20),
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            upAccel: 38,
            drag: 1.2,
            lifeMs: 680,
            startScale: 0.18,
            endScale: 0.04,
            color: 0xFB923C,
            alpha: 0.78,
          });
        }
      }
    });

    return <Graphics ref={gfxRef} eventMode="none" />;
  },
);
