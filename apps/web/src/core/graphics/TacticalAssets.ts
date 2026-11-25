/**
 * Procedural `@2x` Tactical Recon HD assets & visual identity table for all 11 Tactical Weapons.
 *
 * Every weapon gets:
 * - A cohesive military color palette & callsign for HUD, board markings, hover previews, and Kill Cam
 * - Crisp offscreen-canvas `@2x` PixiJS sprites (zero external PNG fetch overhead, matching TacticalReconRenderer)
 * - Clean vector glyph definitions for `TacticalShop` & telemetry badges
 */
import * as PIXI from 'pixi.js';
import type { TacticalId } from '@tactical/engine/types';

export interface TacticalVisualSpec {
  primaryHex: string;
  secondaryHex: string;
  primaryPixi: number;
  secondaryPixi: number;
  callsign: string;
  shortLabel: string;
}

export const TACTICAL_VISUAL_STYLE: Record<TacticalId, TacticalVisualSpec> = {
  MINEFIELD_SNAPSHOT: {
    primaryHex: '#22D3EE',
    secondaryHex: '#34D399',
    primaryPixi: 0x22D3EE,
    secondaryPixi: 0x34D399,
    callsign: 'SUBSURFACE LIDAR',
    shortLabel: 'SNAPSHOT',
  },
  RECON_DRONE: {
    primaryHex: '#38BDF8',
    secondaryHex: '#BAE6FD',
    primaryPixi: 0x38BDF8,
    secondaryPixi: 0xBAE6FD,
    callsign: 'HUNTER-RECON UAV',
    shortLabel: 'HUNTER UAV',
  },
  SMOKE_SCREEN: {
    primaryHex: '#CBD5E1',
    secondaryHex: '#94A3B8',
    primaryPixi: 0xCBD5E1,
    secondaryPixi: 0x94A3B8,
    callsign: 'THERMAL OBSCURANT',
    shortLabel: 'SMOKE 3×3',
  },
  RADAR_SWEEP: {
    primaryHex: '#10B981',
    secondaryHex: '#6EE7B7',
    primaryPixi: 0x10B981,
    secondaryPixi: 0x6EE7B7,
    callsign: 'AWACS THEATER SWEEP',
    shortLabel: 'RADAR',
  },
  PRECISION_STRIKE: {
    primaryHex: '#F43F5E',
    secondaryHex: '#FDA4AF',
    primaryPixi: 0xF43F5E,
    secondaryPixi: 0xFDA4AF,
    callsign: 'ORBITAL JDAM STRIKE',
    shortLabel: 'PRECISION',
  },
  SABOTAGE: {
    primaryHex: '#C084FC',
    secondaryHex: '#38BDF8',
    primaryPixi: 0xC084FC,
    secondaryPixi: 0x38BDF8,
    callsign: 'CYBER-EMP DISRUPTOR',
    shortLabel: 'SABOTAGE',
  },
  NAPALM_LINE: {
    primaryHex: '#F97316',
    secondaryHex: '#FDE047',
    primaryPixi: 0xF97316,
    secondaryPixi: 0xFDE047,
    callsign: 'INCENDIARY FLYOVER',
    shortLabel: 'NAPALM 1×4',
  },
  PARADROP: {
    primaryHex: '#34D399',
    secondaryHex: '#A7F3D0',
    primaryPixi: 0x34D399,
    secondaryPixi: 0xA7F3D0,
    callsign: 'TACTICAL AIRLIFT',
    shortLabel: 'AIRLIFT',
  },
  CARPET_RUN: {
    primaryHex: '#FB923C',
    secondaryHex: '#EF4444',
    primaryPixi: 0xFB923C,
    secondaryPixi: 0xEF4444,
    callsign: 'TRI-STRIKE BOMBER',
    shortLabel: 'CARPET ×3',
  },
  ARTILLERY_BARRAGE: {
    primaryHex: '#EF4444',
    secondaryHex: '#F59E0B',
    primaryPixi: 0xEF4444,
    secondaryPixi: 0xF59E0B,
    callsign: '2×10 CREEPING BARRAGE',
    shortLabel: 'BARRAGE 2×10',
  },
  OVERCLOCK_CORE: {
    primaryHex: '#FACC15',
    secondaryHex: '#38BDF8',
    primaryPixi: 0xFACC15,
    secondaryPixi: 0x38BDF8,
    callsign: 'REACTOR OVERCHARGE',
    shortLabel: 'OVERCLOCK',
  },
};

const bakeCanvasTexture = (
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): PIXI.Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  return PIXI.Texture.from(canvas);
};

/** 1. Autonomous Quad-Rotor Recon Drone (`@2x` 128x128, top-down). */
export function createReconDroneTexture(): PIXI.Texture {
  return bakeCanvasTexture(128, 128, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    // 4 diagonal carbon-fiber rotor arms
    const armAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    for (const a of armAngles) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
      ctx.lineTo(Math.cos(a) * 38, Math.sin(a) * 38);
      ctx.stroke();
    }
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 4;
    for (const a of armAngles) {
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
      ctx.lineTo(Math.cos(a) * 36, Math.sin(a) * 36);
      ctx.stroke();
    }

    // 4 shrouded rotor housings + subtle rotor blur discs
    for (const a of armAngles) {
      const rx = Math.cos(a) * 38;
      const ry = Math.sin(a) * 38;
      const grad = ctx.createRadialGradient(rx, ry, 2, rx, ry, 19);
      grad.addColorStop(0, 'rgba(186, 230, 253, 0.45)');
      grad.addColorStop(0.7, 'rgba(56, 189, 248, 0.22)');
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(rx, ry, 19, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rx, ry, 15, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(rx, ry, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Armored diamond fuselage
    ctx.fillStyle = '#1E293B';
    ctx.strokeStyle = '#F8FAFC';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(18, -8);
    ctx.lineTo(18, 12);
    ctx.lineTo(0, 22);
    ctx.lineTo(-18, 12);
    ctx.lineTo(-18, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central high-contrast optical gimbal lens
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.arc(0, -2, 10, 0, Math.PI * 2);
    ctx.fill();

    const lens = ctx.createRadialGradient(-2, -4, 1, 0, -2, 8);
    lens.addColorStop(0, '#E0F2FE');
    lens.addColorStop(0.45, '#38BDF8');
    lens.addColorStop(1, '#0369A1');
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(0, -2, 7.5, 0, Math.PI * 2);
    ctx.fill();

    // Wing status LEDs
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.arc(-11, 8, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(11, 8, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** 2. Swept-Wing Napalm Strike Jet (`@2x` 192x192, pointing +X). */
export function createStrikeJetTexture(isShadow = false): PIXI.Texture {
  return bakeCanvasTexture(192, 192, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    const drawAirframe = () => {
      // Swept main delta wings
      ctx.beginPath();
      ctx.moveTo(46, 0);
      ctx.lineTo(12, -14);
      ctx.lineTo(-22, -74);
      ctx.lineTo(-44, -68);
      ctx.lineTo(-32, -16);
      ctx.lineTo(-56, -34);
      ctx.lineTo(-70, -28);
      ctx.lineTo(-54, -8);
      ctx.lineTo(-60, 0);
      ctx.lineTo(-54, 8);
      ctx.lineTo(-70, 28);
      ctx.lineTo(-56, 34);
      ctx.lineTo(-32, 16);
      ctx.lineTo(-44, 68);
      ctx.lineTo(-22, 74);
      ctx.lineTo(12, 14);
      ctx.closePath();
    };

    if (isShadow) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      drawAirframe();
      ctx.fill();
      ctx.restore();
      return;
    }

    // Twin blazing afterburner plumes behind engine nozzles
    for (const ey of [-9, 9]) {
      const grad = ctx.createLinearGradient(-56, ey, -94, ey);
      grad.addColorStop(0, 'rgba(255, 251, 235, 0.98)');
      grad.addColorStop(0.35, 'rgba(251, 146, 60, 0.9)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-54, ey - 5);
      ctx.lineTo(-92, ey);
      ctx.lineTo(-54, ey + 5);
      ctx.closePath();
      ctx.fill();
    }

    // Charcoal stealth airframe + bright crisp rim
    const bodyGrad = ctx.createLinearGradient(0, -68, 0, 68);
    bodyGrad.addColorStop(0, '#475569');
    bodyGrad.addColorStop(0.5, '#1E293B');
    bodyGrad.addColorStop(1, '#334155');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2.4;
    drawAirframe();
    ctx.fill();
    ctx.stroke();

    // Under-wing orange incendiary canisters
    ctx.fillStyle = '#F97316';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.5;
    for (const py of [-36, 28]) {
      ctx.beginPath();
      ctx.roundRect(-24, py, 24, 8, 3);
      ctx.fill();
      ctx.stroke();
    }

    // Central nose fuselage spine
    ctx.fillStyle = '#64748B';
    ctx.beginPath();
    ctx.moveTo(64, 0);
    ctx.lineTo(18, -11);
    ctx.lineTo(-54, -10);
    ctx.lineTo(-54, 10);
    ctx.lineTo(18, 11);
    ctx.closePath();
    ctx.fill();

    // Tinted gold-cyan fighter canopy
    const canopyGrad = ctx.createLinearGradient(10, -5, 34, 5);
    canopyGrad.addColorStop(0, '#0F172A');
    canopyGrad.addColorStop(0.55, '#38BDF8');
    canopyGrad.addColorStop(1, '#FEF08A');
    ctx.fillStyle = canopyGrad;
    ctx.beginPath();
    ctx.ellipse(24, 0, 14, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // High-vis tactical amber wing stripes
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(-30, -52, 8, 14);
    ctx.fillRect(-30, 38, 8, 14);

    ctx.restore();
  });
}

/** 3. Heavy Delta-Wing Strategic Bomber for Carpet Run (`@2x` 240x240, pointing +X). */
export function createHeavyBomberTexture(isShadow = false): PIXI.Texture {
  return bakeCanvasTexture(240, 240, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    const drawFlyingWing = () => {
      ctx.beginPath();
      ctx.moveTo(68, 0);
      ctx.lineTo(28, -28);
      ctx.lineTo(-22, -106);
      ctx.lineTo(-58, -96);
      ctx.lineTo(-34, -42);
      ctx.lineTo(-56, -24);
      ctx.lineTo(-36, 0);
      ctx.lineTo(-56, 24);
      ctx.lineTo(-34, 42);
      ctx.lineTo(-58, 96);
      ctx.lineTo(-22, 106);
      ctx.lineTo(28, 28);
      ctx.closePath();
    };

    if (isShadow) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.44)';
      drawFlyingWing();
      ctx.fill();
      ctx.restore();
      return;
    }

    // 4 recessed jet engine heat plumes
    for (const ey of [-34, -18, 18, 34]) {
      const grad = ctx.createLinearGradient(-44, ey, -92, ey);
      grad.addColorStop(0, 'rgba(254, 240, 138, 0.92)');
      grad.addColorStop(0.4, 'rgba(249, 115, 22, 0.78)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-42, ey - 4);
      ctx.lineTo(-92, ey);
      ctx.lineTo(-42, ey + 4);
      ctx.closePath();
      ctx.fill();
    }

    // Stealth obsidian flying-wing fuselage
    const wingGrad = ctx.createLinearGradient(-60, 0, 68, 0);
    wingGrad.addColorStop(0, '#0F172A');
    wingGrad.addColorStop(0.55, '#1E293B');
    wingGrad.addColorStop(1, '#334155');
    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2.6;
    drawFlyingWing();
    ctx.fill();
    ctx.stroke();

    // Panel seam lines & open bomb-bay warning chevrons
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(22, -22);
    ctx.lineTo(-42, -88);
    ctx.moveTo(22, 22);
    ctx.lineTo(-42, 88);
    ctx.stroke();

    // Glowing red-amber bomb bay spine & cockpit glass
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-18, -7, 30, 14);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(-14, -3, 22, 6);

    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.moveTo(48, 0);
    ctx.lineTo(30, -9);
    ctx.lineTo(26, -3);
    ctx.lineTo(36, 0);
    ctx.lineTo(26, 3);
    ctx.lineTo(30, 9);
    ctx.closePath();
    ctx.fill();

    // Wingtip hazard strobes
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(-40, -96, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.arc(-40, 96, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** 4. Precision Strike Hypersonic JDAM Kinetic Dart (`@2x` 96x96, pointing +Y down). */
export function createJdamMissileTexture(): PIXI.Texture {
  return bakeCanvasTexture(96, 96, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    // Exhaust plume above tail
    const plume = ctx.createLinearGradient(0, -14, 0, -46);
    plume.addColorStop(0, 'rgba(255, 255, 255, 1)');
    plume.addColorStop(0.35, 'rgba(251, 113, 133, 0.9)');
    plume.addColorStop(1, 'rgba(244, 63, 94, 0)');
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.moveTo(-7, -14);
    ctx.lineTo(0, -46);
    ctx.lineTo(7, -14);
    ctx.closePath();
    ctx.fill();

    // Tail fins
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(-14, -18);
    ctx.lineTo(-5, -2);
    ctx.lineTo(5, -2);
    ctx.lineTo(14, -18);
    ctx.closePath();
    ctx.fill();

    // Tungsten missile body
    ctx.fillStyle = '#E2E8F0';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 34);
    ctx.lineTo(7, 16);
    ctx.lineTo(7, -18);
    ctx.lineTo(-7, -18);
    ctx.lineTo(-7, 16);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Crimson guidance ring + incandescent warhead tip
    ctx.fillStyle = '#F43F5E';
    ctx.fillRect(-7, 4, 14, 7);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(-6, 13, 12, 3);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(0, 30, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

/** 5. Tactical Steerable Ram-Air Parafoil Canopy for Paradrop (`@2x` 128x128). */
export function createParadropChuteTexture(): PIXI.Texture {
  return bakeCanvasTexture(128, 128, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    // Rectangular 5-cell tactical ram-air canopy
    const w = 88;
    const h = 38;
    const cells = 5;
    const cellW = w / cells;
    for (let i = 0; i < cells; i++) {
      const x = -w / 2 + i * cellW;
      const archY = Math.abs(i - 2) * 3.5;
      ctx.fillStyle = i % 2 === 0 ? '#10B981' : '#0F766E';
      ctx.strokeStyle = '#ECFDF5';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(x + 1, -h / 2 + archY, cellW - 2, h - archY * 0.6, 5);
      ctx.fill();
      ctx.stroke();

      // Top highlight specular fold
      ctx.fillStyle = 'rgba(236, 253, 245, 0.28)';
      ctx.fillRect(x + 3, -h / 2 + archY + 3, cellW - 6, 7);
    }

    // Center tactical insertion chevron
    ctx.strokeStyle = '#FDE047';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.lineTo(0, -6);
    ctx.lineTo(10, 4);
    ctx.stroke();

    ctx.restore();
  });
}

/** 6. Multi-lobed volumetric smoke puff (`@2x` 128x128) for Smoke Screen clouds. */
export function createVolumetricSmokeTexture(): PIXI.Texture {
  return bakeCanvasTexture(128, 128, (ctx, s) => {
    const lobes = [
      { x: 64, y: 62, r: 34, a: 0.72 },
      { x: 42, y: 66, r: 26, a: 0.62 },
      { x: 86, y: 66, r: 26, a: 0.62 },
      { x: 54, y: 46, r: 24, a: 0.65 },
      { x: 76, y: 48, r: 24, a: 0.65 },
      { x: 64, y: 78, r: 24, a: 0.52 },
    ];
    for (const l of lobes) {
      const g = ctx.createRadialGradient(l.x - 5, l.y - 7, 3, l.x, l.y, l.r);
      g.addColorStop(0, `rgba(248, 250, 252, ${l.a})`);
      g.addColorStop(0.55, `rgba(203, 213, 225, ${l.a * 0.72})`);
      g.addColorStop(0.85, `rgba(100, 116, 139, ${l.a * 0.35})`);
      g.addColorStop(1, 'rgba(71, 85, 105, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** 7. Blast Crater Decal (`@2x` 128x128) for heavy tactical ordnance impacts. */
export function createBlastCraterTexture(): PIXI.Texture {
  return bakeCanvasTexture(128, 128, (ctx, s) => {
    const c = s / 2;
    const outer = ctx.createRadialGradient(c, c, 10, c, c, 56);
    outer.addColorStop(0, 'rgba(2, 6, 23, 0.85)');
    outer.addColorStop(0.42, 'rgba(15, 23, 42, 0.62)');
    outer.addColorStop(0.75, 'rgba(30, 41, 59, 0.26)');
    outer.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(c, c, 56, 0, Math.PI * 2);
    ctx.fill();

    // Jagged blast fracture rays
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI * 2 * i) / 8 + 0.25;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 14, c + Math.sin(a) * 14);
      ctx.lineTo(c + Math.cos(a + 0.08) * 32, c + Math.sin(a + 0.08) * 32);
      ctx.lineTo(c + Math.cos(a - 0.06) * 44, c + Math.sin(a - 0.06) * 44);
      ctx.stroke();
    }

    // Inner glowing ember pit
    const core = ctx.createRadialGradient(c, c, 2, c, c, 18);
    core.addColorStop(0, 'rgba(249, 115, 22, 0.55)');
    core.addColorStop(0.55, 'rgba(124, 45, 18, 0.32)');
    core.addColorStop(1, 'rgba(2, 6, 23, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(c, c, 18, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** 8. Tactical Quad-Turboprop Cargo Plane for Paradrop Airlift (`@2x` 240x240, pointing +X). */
export function createCargoPlaneTexture(isShadow = false): PIXI.Texture {
  return bakeCanvasTexture(240, 240, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    const drawAirframe = () => {
      // Chunky high-wing transport fuselage
      ctx.beginPath();
      ctx.moveTo(86, 0);
      ctx.quadraticCurveTo(80, -14, 52, -16);
      ctx.lineTo(-54, -15);
      ctx.lineTo(-84, -8);
      ctx.lineTo(-88, 0);
      ctx.lineTo(-84, 8);
      ctx.lineTo(-54, 15);
      ctx.lineTo(52, 16);
      ctx.quadraticCurveTo(80, 14, 86, 0);
      ctx.closePath();

      // Broad straight high wings
      ctx.moveTo(26, -15);
      ctx.lineTo(14, -104);
      ctx.lineTo(-14, -100);
      ctx.lineTo(-22, -14);
      ctx.closePath();
      ctx.moveTo(26, 15);
      ctx.lineTo(14, 104);
      ctx.lineTo(-14, 100);
      ctx.lineTo(-22, 14);
      ctx.closePath();

      // Swept T-tail horizontal stabilizers
      ctx.moveTo(-60, -7);
      ctx.lineTo(-76, -42);
      ctx.lineTo(-90, -38);
      ctx.lineTo(-82, -6);
      ctx.closePath();
      ctx.moveTo(-60, 7);
      ctx.lineTo(-76, 42);
      ctx.lineTo(-90, 38);
      ctx.lineTo(-82, 6);
      ctx.closePath();
    };

    if (isShadow) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
      drawAirframe();
      ctx.fill();
      ctx.restore();
      return;
    }

    // Main tactical slate-olive transport fuselage & wings
    const wingGrad = ctx.createLinearGradient(0, -104, 0, 104);
    wingGrad.addColorStop(0, '#334155');
    wingGrad.addColorStop(0.5, '#475569');
    wingGrad.addColorStop(1, '#334155');
    ctx.fillStyle = wingGrad;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2.4;
    drawAirframe();
    ctx.fill();
    ctx.stroke();

    // 4 wing-mounted turboprop engine nacelles + translucent spinning propeller blur discs
    for (const py of [-66, -38, 38, 66]) {
      // Engine exhaust streak
      const exh = ctx.createLinearGradient(-4, py, -36, py);
      exh.addColorStop(0, 'rgba(148, 163, 184, 0.55)');
      exh.addColorStop(1, 'rgba(148, 163, 184, 0)');
      ctx.fillStyle = exh;
      ctx.fillRect(-34, py - 3.5, 30, 7);

      // Nacelle pod
      ctx.fillStyle = '#1E293B';
      ctx.strokeStyle = '#CBD5E1';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-6, py - 6, 36, 12, 4);
      ctx.fill();
      ctx.stroke();

      // Spinning prop blur disc in front of nacelle
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(32, py - 15);
      ctx.lineTo(32, py + 15);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(35, py - 12);
      ctx.lineTo(35, py + 12);
      ctx.stroke();
    }

    // Fuselage dorsal spine & rear emerald cargo ramp glow
    ctx.fillStyle = '#64748B';
    ctx.fillRect(-52, -7, 102, 14);
    ctx.fillStyle = '#10B981';
    ctx.fillRect(-72, -5.5, 22, 11);
    ctx.fillStyle = '#A7F3D0';
    ctx.fillRect(-68, -2.5, 14, 5);

    // Armored nose radome & wrap-around flight deck windows
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(76, 0, 9, -Math.PI * 0.45, Math.PI * 0.45);
    ctx.fill();

    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.moveTo(68, 0);
    ctx.lineTo(54, -10);
    ctx.lineTo(48, -6);
    ctx.lineTo(58, 0);
    ctx.lineTo(48, 6);
    ctx.lineTo(54, 10);
    ctx.closePath();
    ctx.fill();

    // Emerald airborne invasion stripes on wings
    ctx.fillStyle = '#10B981';
    ctx.fillRect(-4, -90, 12, 14);
    ctx.fillRect(-4, 76, 12, 14);

    // Wingtip navigation lights
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(0, -100, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#22C55E';
    ctx.beginPath();
    ctx.arc(0, 100, 3.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
}

/** 9. Guided Glide Cruise Bomb for Carpet Run multi-target salvo (`@2x` 64x64, pointing +X). */
export function createCruiseBombTexture(): PIXI.Texture {
  return bakeCanvasTexture(64, 64, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    // Glowing rocket booster tail plume
    const plume = ctx.createLinearGradient(-10, 0, -31, 0);
    plume.addColorStop(0, 'rgba(255, 251, 235, 0.98)');
    plume.addColorStop(0.45, 'rgba(251, 146, 60, 0.88)');
    plume.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = plume;
    ctx.beginPath();
    ctx.moveTo(-10, -5);
    ctx.lineTo(-31, 0);
    ctx.lineTo(-10, 5);
    ctx.closePath();
    ctx.fill();

    // Swept guidance fins
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(-12, -13);
    ctx.lineTo(2, -4);
    ctx.lineTo(2, 4);
    ctx.lineTo(-12, 13);
    ctx.closePath();
    ctx.fill();

    // Sleek ordnance casing
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(24, 0);
    ctx.lineTo(12, -5.5);
    ctx.lineTo(-12, -5.5);
    ctx.lineTo(-12, 5.5);
    ctx.lineTo(12, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // High-explosive orange-crimson warhead band + seeker lens
    ctx.fillStyle = '#F97316';
    ctx.fillRect(2, -5, 7, 10);
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(20, 0, 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
}

/** 10. Stealth Obsidian Heavy Tactical Lifter for 6-round Tactical Supply Drops (`@2x` 220x220, pointing +X). */
export function createHeavyLifterTexture(isShadow = false): PIXI.Texture {
  return bakeCanvasTexture(220, 220, (ctx, s) => {
    const c = s / 2;
    ctx.save();
    ctx.translate(c, c);

    const drawAirframe = () => {
      ctx.beginPath();
      // Broad reinforced tactical airlifter fuselage
      ctx.moveTo(86, 0);
      ctx.quadraticCurveTo(72, -16, 44, -17);
      ctx.lineTo(-56, -15);
      ctx.lineTo(-94, -6);
      ctx.lineTo(-94, 6);
      ctx.lineTo(-56, 15);
      ctx.lineTo(44, 17);
      ctx.quadraticCurveTo(72, 16, 86, 0);
      ctx.closePath();

      // Swept supercritical wings with angled winglets
      ctx.moveTo(34, -15);
      ctx.lineTo(-14, -104);
      ctx.lineTo(-34, -102);
      ctx.lineTo(-18, -14);
      ctx.closePath();
      ctx.moveTo(34, 15);
      ctx.lineTo(-14, 104);
      ctx.lineTo(-34, 102);
      ctx.lineTo(-18, 14);
      ctx.closePath();

      // High-swept heavy T-tail
      ctx.moveTo(-64, -8);
      ctx.lineTo(-84, -46);
      ctx.lineTo(-98, -42);
      ctx.lineTo(-88, -6);
      ctx.closePath();
      ctx.moveTo(-64, 8);
      ctx.lineTo(-84, 46);
      ctx.lineTo(-98, 42);
      ctx.lineTo(-88, 6);
      ctx.closePath();
    };

    if (isShadow) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.48)';
      drawAirframe();
      ctx.fill();
      ctx.restore();
      return;
    }

    // Matte stealth-obsidian airframe with warm metallic rim
    const bodyGrad = ctx.createLinearGradient(0, -104, 0, 104);
    bodyGrad.addColorStop(0, '#0F172A');
    bodyGrad.addColorStop(0.5, '#1E293B');
    bodyGrad.addColorStop(1, '#0F172A');
    ctx.fillStyle = bodyGrad;
    ctx.strokeStyle = '#FDE68A';
    ctx.lineWidth = 2.4;
    drawAirframe();
    ctx.fill();
    ctx.stroke();

    // 4 turbofan nacelles with warm golden jet exhausts
    for (const [nx, ny] of [[10, -40], [-4, -68], [10, 40], [-4, 68]] as const) {
      const jet = ctx.createLinearGradient(nx - 6, ny, nx - 42, ny);
      jet.addColorStop(0, 'rgba(250, 204, 21, 0.85)');
      jet.addColorStop(0.5, 'rgba(249, 115, 22, 0.45)');
      jet.addColorStop(1, 'rgba(249, 115, 22, 0)');
      ctx.fillStyle = jet;
      ctx.fillRect(nx - 42, ny - 4.5, 36, 9);

      ctx.fillStyle = '#020617';
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(nx - 8, ny - 6.5, 32, 13, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Gold/crimson dorsal identification spine & glowing tactical cargo ramp
    ctx.fillStyle = '#334155';
    ctx.fillRect(-54, -8, 108, 16);
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(-78, -6, 26, 12);
    ctx.fillStyle = '#FEF08A';
    ctx.fillRect(-74, -2.5, 18, 5);

    // Tactical gold invasion stripes on swept wings
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(-20, -90, 12, 14);
    ctx.fillRect(-20, 76, 12, 14);
    ctx.fillStyle = '#EF4444';
    ctx.fillRect(-6, -86, 6, 14);
    ctx.fillRect(-6, 72, 6, 14);

    // Armored cockpit canopy (warm amber visor)
    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.moveTo(74, 0);
    ctx.lineTo(58, -11);
    ctx.lineTo(51, -7);
    ctx.lineTo(62, 0);
    ctx.lineTo(51, 7);
    ctx.lineTo(58, 11);
    ctx.closePath();
    ctx.fill();

    // Wingtip strobes
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(-22, -101, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FACC15';
    ctx.beginPath();
    ctx.arc(-22, 101, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  });
}

/** Registers every procedural tactical texture into a TextureManager sink. */
export function buildAllTacticalTextures(): Record<string, PIXI.Texture> {
  return {
    TACTICAL_RECON_DRONE: createReconDroneTexture(),
    TACTICAL_STRIKE_JET: createStrikeJetTexture(false),
    TACTICAL_STRIKE_JET_SHADOW: createStrikeJetTexture(true),
    TACTICAL_HEAVY_BOMBER: createHeavyBomberTexture(false),
    TACTICAL_HEAVY_BOMBER_SHADOW: createHeavyBomberTexture(true),
    TACTICAL_CARGO_PLANE: createCargoPlaneTexture(false),
    TACTICAL_CARGO_PLANE_SHADOW: createCargoPlaneTexture(true),
    TACTICAL_HEAVY_LIFTER: createHeavyLifterTexture(false),
    TACTICAL_HEAVY_LIFTER_SHADOW: createHeavyLifterTexture(true),
    TACTICAL_CRUISE_BOMB: createCruiseBombTexture(),
    TACTICAL_JDAM_MISSILE: createJdamMissileTexture(),
    TACTICAL_PARADROP_CHUTE: createParadropChuteTexture(),
    TACTICAL_SMOKE_PUFF: createVolumetricSmokeTexture(),
    TACTICAL_CRATER_DECAL: createBlastCraterTexture(),
  };
}
