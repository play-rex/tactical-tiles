/**
 * Pure flight kinematics & animation timing math for Theater Air Supply Drops.
 * Zero React/Pixi dependencies so every timing equation is unit-tested in Node.
 *
 * - Full-map edge-to-edge ray-box entry/exit with constant effective airspeed
 * - Automatically selects the longer approach half so corner/edge LZs never pop in abruptly
 * - Exact cargo ramp opening (`T_approach - 260ms`), upwind release drift, damped parachute
 *   sway + descent curve, and non-blocking ambient exit tail
 */
import type { AirDropKind } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';

export interface AirDropFlightInput {
  at: { x: number; y: number };
  headingRad: number;
  gridSize: number;
  dropKind: AirDropKind;
  reducedMotion?: boolean;
}

export interface AirDropFlightKinematics {
  dropKind: AirDropKind;
  lzX: number;
  lzY: number;
  ux: number;
  uy: number;
  rot: number;
  /** Signed distance from entry edge to LZ (always positive). */
  dIn: number;
  /** Signed distance from LZ to far exit edge (always positive). */
  dOut: number;
  /** Entry point in world pixels (outside board bounds by margin). */
  entryX: number;
  entryY: number;
  /** Exit point in world pixels (outside board bounds by margin). */
  exitX: number;
  exitY: number;
  /** Effective cruise speed in world px/s (constant across entire map!). */
  speedPxPerSec: number;
  /** Real ms from spawn off-edge until cargo release overhead of LZ. */
  approachMs: number;
  /** Real ms when rear cargo ramp opens and bay light turns on. */
  rampOpenMs: number;
  /** Real ms when crate ejects from cargo ramp (= approachMs). */
  releaseMs: number;
  /** Real ms for parachute descent from cargo bay to ground touchdown. */
  chuteMs: number;
  /** Real ms when crate lands on the tile (= releaseMs + chuteMs). */
  touchdownMs: number;
  /** Real ms for plane to clear far map edge after release (ambient tail). */
  exitMs: number;
  /** Real ms when plane exits the board completely (= releaseMs + exitMs). */
  planeEndMs: number;
  /** Total animation lifetime (max of touchdown + settle, plane exit). */
  totalMs: number;
}

export interface AirDropFlightSample {
  planeX: number;
  planeY: number;
  planeRot: number;
  planeVisible: boolean;
  planeAlpha: number;
  planeAlt: number;
  rampGlow: number;
  chuteVisible: boolean;
  chuteProgress: number;
  crateX: number;
  crateY: number;
  crateAltitude: number;
  swayPx: number;
  canopyScale: number;
  canopyAlpha: number;
  shadowScale: number;
  touchedDown: boolean;
  /** 0..1 ring fade right after touchdown (for ground dust/beacon pulse). */
  touchdownFlash: number;
}

const OFF_SCREEN_MARGIN_PX = 260;
const CRUISE_SPEED_PX_S: Record<AirDropKind, number> = {
  FIELD: 265,
  TACTICAL: 225,
};
const CHUTE_DURATION_MS: Record<AirDropKind, number> = {
  FIELD: 2150,
  TACTICAL: 2500,
};
const DROP_ALTITUDE_PX = 165;
const UPWIND_DRIFT_PX = 38;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Positive ray distance from `(px, py)` along unit `(dx, dy)` to the expanded box `[minB, maxB]^2`. */
const rayBoxDist = (px: number, py: number, dx: number, dy: number, minB: number, maxB: number): number => {
  let tMin = Infinity;
  if (Math.abs(dx) > 1e-6) {
    const t = ((dx > 0 ? maxB : minB) - px) / dx;
    if (t > 0 && t < tMin) tMin = t;
  }
  if (Math.abs(dy) > 1e-6) {
    const t = ((dy > 0 ? maxB : minB) - py) / dy;
    if (t > 0 && t < tMin) tMin = t;
  }
  return Number.isFinite(tMin) ? tMin : maxB - minB;
};

/**
 * Computes exact, constant-airspeed edge-to-edge flight geometry and timing milestones
 * for any board size, LZ position, heading angle, and drop kind.
 */
export const computeAirDropFlight = (input: AirDropFlightInput): AirDropFlightKinematics => {
  const { at, gridSize, dropKind, reducedMotion = false } = input;
  const boardPx = Math.max(8, gridSize) * TILE_SIZE;
  const minB = -OFF_SCREEN_MARGIN_PX;
  const maxB = boardPx + OFF_SCREEN_MARGIN_PX;
  const lzX = at.x * TILE_SIZE + TILE_SIZE / 2;
  const lzY = at.y * TILE_SIZE + TILE_SIZE / 2;

  let ux = Math.cos(input.headingRad);
  let uy = Math.sin(input.headingRad);
  const len = Math.hypot(ux, uy) || 1;
  ux /= len;
  uy /= len;

  let dIn = rayBoxDist(lzX, lzY, -ux, -uy, minB, maxB);
  let dOut = rayBoxDist(lzX, lzY, ux, uy, minB, maxB);

  // Always prefer the longer approach half so the plane flies visibly across the theater before dropping.
  if (dIn < (dIn + dOut) * 0.45) {
    ux = -ux;
    uy = -uy;
    const tmp = dIn;
    dIn = dOut;
    dOut = tmp;
  }

  const nominalSpeed = CRUISE_SPEED_PX_S[dropKind];
  const approachMs = reducedMotion
    ? 680
    : Math.round(clamp((dIn / nominalSpeed) * 1000, 2200, 3500));
  const speedPxPerSec = dIn / (approachMs / 1000);
  const exitMs = reducedMotion
    ? 680
    : Math.round(clamp((dOut / speedPxPerSec) * 1000, 2400, 4800));
  const rampOpenMs = Math.max(180, approachMs - 480);
  const releaseMs = approachMs;
  const chuteMs = reducedMotion ? 650 : CHUTE_DURATION_MS[dropKind];
  const touchdownMs = releaseMs + chuteMs;
  const planeEndMs = releaseMs + exitMs;
  const totalMs = Math.max(touchdownMs + 320, planeEndMs + 80);

  return {
    dropKind,
    lzX,
    lzY,
    ux,
    uy,
    rot: Math.atan2(uy, ux),
    dIn,
    dOut,
    entryX: lzX - ux * dIn,
    entryY: lzY - uy * dIn,
    exitX: lzX + ux * dOut,
    exitY: lzY + uy * dOut,
    speedPxPerSec,
    approachMs,
    rampOpenMs,
    releaseMs,
    chuteMs,
    touchdownMs,
    exitMs,
    planeEndMs,
    totalMs,
  };
};

/** Evaluates exact plane position, cargo ramp glow, and parachute crate pose at `elapsedMs`. */
export const sampleAirDropFlight = (
  plan: AirDropFlightKinematics,
  elapsedMs: number,
  reducedMotion = false,
): AirDropFlightSample => {
  const t = Math.max(0, elapsedMs);

  // Plane glides at constant effective velocity from entry edge through LZ to far exit edge.
  let sPlane: number;
  if (t <= plan.releaseMs) {
    const p = clamp01(t / Math.max(1, plan.releaseMs));
    sPlane = -plan.dIn * (1 - p);
  } else {
    const p = clamp01((t - plan.releaseMs) / Math.max(1, plan.exitMs));
    sPlane = plan.dOut * p;
  }

  const planeX = plan.lzX + plan.ux * sPlane;
  const planeY = plan.lzY + plan.uy * sPlane;
  const planeVisible = t >= 0 && t <= plan.planeEndMs;
  const edgeFadeIn = clamp01(t / 160);
  const edgeFadeOut = t > plan.planeEndMs - 220 ? clamp01((plan.planeEndMs - t) / 220) : 1;
  const planeAlpha = planeVisible ? Math.min(edgeFadeIn, edgeFadeOut) : 0;

  // Gentle climb after payload release
  const climbT = t > plan.releaseMs ? clamp01((t - plan.releaseMs) / Math.max(1, plan.exitMs)) : 0;
  const planeAlt = (plan.dropKind === 'TACTICAL' ? 36 : 30) + climbT * 24;

  // Cargo ramp opens 260ms before release and closes smoothly 300ms after
  let rampGlow = 0;
  if (t >= plan.rampOpenMs && t <= plan.releaseMs + 320) {
    if (t <= plan.releaseMs) {
      rampGlow = clamp01((t - plan.rampOpenMs) / Math.max(1, plan.releaseMs - plan.rampOpenMs));
    } else {
      rampGlow = clamp01(1 - (t - plan.releaseMs) / 320);
    }
  }

  const chuteVisible = t >= plan.releaseMs && t <= plan.touchdownMs + 280;
  const chuteProgress = t < plan.releaseMs ? 0 : clamp01((t - plan.releaseMs) / Math.max(1, plan.chuteMs));
  const touchedDown = t >= plan.touchdownMs;

  // Upwind release drift: crate ejects 26px upwind and glides smoothly onto exact LZ center
  const driftRemain = Math.pow(1 - chuteProgress, 2);
  const crateX = plan.lzX - plan.ux * UPWIND_DRIFT_PX * driftRemain;
  const crateY = plan.lzY - plan.uy * UPWIND_DRIFT_PX * driftRemain;

  // Smooth aerodynamic chute deceleration curve: h(s) = h0 * (1 - s)^1.75
  const crateAltitude = touchedDown ? 0 : DROP_ALTITUDE_PX * Math.pow(1 - chuteProgress, 1.75);
  const swayPx =
    reducedMotion || touchedDown
      ? 0
      : Math.sin(chuteProgress * Math.PI * 3.5) * (1 - chuteProgress) * 11;

  // Chute pops open over first 160ms after release, collapses cleanly in final 14% after touchdown
  const openT = clamp01((t - plan.releaseMs) / 160);
  const canopyScale = 0.28 + 0.72 * (1 - Math.pow(1 - openT, 3));
  const collapseAlpha =
    t <= plan.touchdownMs
      ? 1
      : clamp01(1 - (t - plan.touchdownMs) / 240);
  const canopyAlpha = chuteVisible ? openT * collapseAlpha : 0;

  const shadowScale = 0.25 + 0.75 * (1 - Math.pow(1 - chuteProgress, 1.75));
  const touchdownFlash =
    t >= plan.touchdownMs && t <= plan.touchdownMs + 320
      ? clamp01(1 - (t - plan.touchdownMs) / 320)
      : 0;

  return {
    planeX,
    planeY,
    planeRot: plan.rot,
    planeVisible,
    planeAlpha,
    planeAlt,
    rampGlow,
    chuteVisible,
    chuteProgress,
    crateX,
    crateY,
    crateAltitude,
    swayPx,
    canopyScale,
    canopyAlpha,
    shadowScale,
    touchedDown,
    touchdownFlash,
  };
};
