/**
 * Kill-cam director (`killCam`).
 *
 * Pure, frame-driven film timeline with zero React/Pixi imports:
 * - `arm()`     — optional 150 ms pre-detonation beat (`MINE_CLICK`: "*click* ... BOOM").
 * - `preRoll()` — attack in flight: weapon-directed camera move + adaptive slow-motion.
 * - `impact()`  — blow lands: 2-beat anime impact frame, blueprint grade, Dutch-tilt, slow-mo.
 * - `skip()`    — immediately cancels the active cut and blocks deferred impact re-open.
 * - `step()`    — advances in *real* ms and drives the combat-clock `timeScale`.
 *
 * Also exports `computeClampedKillCamViewport` (Rule-of-Thirds soft clamping + Dutch-tilt
 * zoom floor + screen-space subject projection for dynamic UI corner dodging) and
 * `resolveKillCamNarrative` (emergent headline & badge priority engine).
 */

import type { DamageBreakdown, KillCause, TerrainType, UnitType, WeaponVisual } from '@tactical/engine';

/** Player-selectable kill-cam pacing mode. */
export type KillCamMode = 'FULL' | 'SHORT' | 'OFF';

/**
 * - `ATTACK`:    non-lethal hit punch-in (and 1-HP Graze Fake-Out).
 * - `MICRO`:     ordinary unit kill (snappy punch, no letterbox).
 * - `CINEMATIC`: Ace, Match-Winner, Overwatch, Mine, Crossfire, Longshot, Overkill, or Multi-kill.
 * - `STRUCTURE`: bank demolition, HQ breach/destruction, vault heist.
 */
export type KillCamTier = 'ATTACK' | 'MICRO' | 'CINEMATIC' | 'STRUCTURE';

export type KillCamSubject = 'ATTACK' | 'KILL' | 'STRUCTURE';

export type KillCamPhase = 'IDLE' | 'ARM' | 'PUSH' | 'SLAM' | 'SLOW' | 'RECOVER';

export type KillCamCameraStyle =
  | 'STANDARD'
  | 'SNIPER_WHIP'
  | 'MINE_CLICK'
  | 'OVERWATCH_SNAP'
  | 'CROSSFIRE_TRIANGLE'
  | 'BREACHER_ARC'
  | 'STRUCTURE_BLOWOUT'
  | 'GRAZE_FAKEOUT';

export type KillCamNarrativeTag =
  | 'FINAL_BLOW'
  | 'ZERO_CP'
  | 'VENDETTA'
  | 'GIANT_SLAYER'
  | 'FIRST_BLOOD'
  | 'LONGSHOT'
  | 'OVERKILL'
  | 'CROSSFIRE'
  | 'GRAZE';

export interface KillCamPoint {
  x: number;
  y: number;
}

export interface KillCamCue {
  id: number;
  tier: KillCamTier;
  subject: KillCamSubject;
  cause: KillCause;
  cameraStyle?: KillCamCameraStyle;
  weapon?: WeaponVisual;
  /** Structure headline, e.g. "VAULT BREACHED" (structure cues only). */
  title?: string;
  /** One-line subtext for structure cues. */
  detail?: string;
  structureType?: 'BASE' | 'BANK' | 'BARRIER';
  hpAfter?: number;
  victimUnitId?: string;
  victimUnitType?: UnitType;
  victimOwner?: number;
  victimRank?: number;
  /** Display name of the victim unit type, e.g. "Breacher". */
  victimName?: string;
  /** Victim's actual HP right before this lethal blow (for accurate "14 → 0" stamps). */
  victimPreHp?: number;
  /** Remaining HP after a non-lethal attack hit (`1` triggers GRAZE_FAKEOUT). */
  remainingHp?: number;
  isCrit?: boolean;
  killerOwner: number | null;
  killerUnitId?: string;
  killerUnitType?: UnitType;
  /** Exact engine damage modifiers for the Tactical Receipt & world-space shield shatter. */
  breakdown?: DamageBreakdown;
  /** Emergent narrative flags derived from authoritative state + match memory. */
  zeroCpClutch?: boolean;
  isMatchWinning?: boolean;
  isVendetta?: boolean;
  isFirstBlood?: boolean;
  /** True when attacker origin tile was visible (false under Fog-of-War blind ambush). */
  hasVisibleOrigin?: boolean;
  /** World-pixel centers of flanking Crossfire supporters (for triangulation framing + beams). */
  crossfirePoints?: KillCamPoint[];
  /** True when replaying a recorded Play of the Match clip. */
  isReplay?: boolean;
  /** Total incoming damage across every staged hit on this victim. */
  damage: number;
  maxHp: number;
  overkill: number;
  crossfireCount: number;
  /** Tiles between shooter and victim (0 for environmental kills or unseen fog shooter). */
  distanceTiles: number;
  terrain?: TerrainType;
  /** Impact tile centre in world pixels. */
  focusX: number;
  focusY: number;
  /** Shooter tile centre in world pixels (falls back to impact point when unseen/environmental). */
  markerX: number;
  markerY: number;
  /** World-pixel span covering shooter and victim tiles. */
  frameW: number;
  frameH: number;
  /** Optional wide bounding box including all Crossfire supporters. */
  triFrameW?: number;
  triFrameH?: number;
  triCenterX?: number;
  triCenterY?: number;
  /** Kill index within this action batch (1 = first, 2 = double kill…). */
  combo: number;
  /** Combat-time flight time of the shot from launch to impact. */
  travelMs: number;
}

export interface KillCamFrame {
  active: boolean;
  mode: KillCamMode;
  phase: KillCamPhase;
  cameraStyle: KillCamCameraStyle;
  cue: KillCamCue | null;
  combo: number;
  timeScale: number;
  /** 0..1 commitment to the framing scale (0 = the player's own zoom). */
  fit: number;
  /** 0..1 eased return-to-player-camera progress during `RECOVER` (0 in all other phases). */
  recover: number;
  frameW: number;
  frameH: number;
  centerX: number;
  centerY: number;
  /** Subtle Dutch-tilt angle in radians (0 when reduced motion or inactive). */
  dutchTiltRad: number;
  /** 0..1 crisp 2-frame anime luminance impact flash pulse (0–55ms of SLAM). */
  impactFlashGrade: number;
  /** 0..1 battlefield desaturation/cool slate grade so glowing tactical vectors pop. */
  worldDesat: number;
  /** 0..1 visibility of world-space blueprint vectors (trajectory, shield shatter, crossfire). */
  schematicAlpha: number;
  /** 0..1 progress through `ARM` pre-detonation mine click beat. */
  armProgress: number;
  /** True once a 1-HP GRAZE_FAKEOUT flips from crimson kill tease to amber survival reveal. */
  grazeFlipped: boolean;
  /** 0..1 brief comms-static glitch pulse (Overwatch snap / Graze flip). */
  glitch: number;
  letterbox: number;
  dim: number;
  flash: number;
  reticle: number;
  impact: number;
  elapsedMs: number;
}

export interface KillCamTiming {
  /** Pre-detonation `ARM` beat for Land Mines (`MINE_CLICK`), real ms. */
  armMs: number;
  pushMs: number;
  travelRealMs: number;
  minPushScale: number;
  slamMs: number;
  slowMs: number;
  recoverMs: number;
  slowScale: number;
  slamScale: number;
  letterbox: number;
  maxFit: number;
}

export const KILL_CAM_TIMINGS: Record<'FULL' | 'SHORT', Record<KillCamTier, KillCamTiming>> = {
  FULL: {
    ATTACK: { armMs: 0, pushMs: 320, travelRealMs: 260, minPushScale: 0.45, slamMs: 110, slowMs: 260, recoverMs: 240, slowScale: 0.55, slamScale: 0.35, letterbox: 0, maxFit: 0.58 },
    MICRO: { armMs: 120, pushMs: 1650, travelRealMs: 1550, minPushScale: 0.06, slamMs: 240, slowMs: 850, recoverMs: 520, slowScale: 0.28, slamScale: 0.16, letterbox: 0, maxFit: 1 },
    CINEMATIC: { armMs: 150, pushMs: 1950, travelRealMs: 1850, minPushScale: 0.055, slamMs: 280, slowMs: 1050, recoverMs: 560, slowScale: 0.22, slamScale: 0.06, letterbox: 1, maxFit: 1 },
    STRUCTURE: { armMs: 0, pushMs: 0, travelRealMs: 0, minPushScale: 1, slamMs: 420, slowMs: 1450, recoverMs: 750, slowScale: 0.2, slamScale: 0.08, letterbox: 1, maxFit: 1 },
  },
  SHORT: {
    ATTACK: { armMs: 0, pushMs: 180, travelRealMs: 150, minPushScale: 0.72, slamMs: 70, slowMs: 140, recoverMs: 180, slowScale: 0.72, slamScale: 0.5, letterbox: 0, maxFit: 0.42 },
    MICRO: { armMs: 80, pushMs: 360, travelRealMs: 300, minPushScale: 0.35, slamMs: 120, slowMs: 280, recoverMs: 240, slowScale: 0.4, slamScale: 0.18, letterbox: 0, maxFit: 1 },
    CINEMATIC: { armMs: 90, pushMs: 720, travelRealMs: 650, minPushScale: 0.18, slamMs: 220, slowMs: 680, recoverMs: 360, slowScale: 0.26, slamScale: 0.08, letterbox: 1, maxFit: 1 },
    STRUCTURE: { armMs: 0, pushMs: 0, travelRealMs: 0, minPushScale: 1, slamMs: 280, slowMs: 880, recoverMs: 420, slowScale: 0.24, slamScale: 0.1, letterbox: 1, maxFit: 1 },
  },
};

export const KILL_CAM_TIMING: Record<KillCamTier, KillCamTiming> = KILL_CAM_TIMINGS.FULL;

/** Dedicated timing override for the 1-HP Graze Fake-Out micro-cam. */
export const GRAZE_TIMING: Record<'FULL' | 'SHORT', KillCamTiming> = {
  FULL: { armMs: 0, pushMs: 260, travelRealMs: 220, minPushScale: 0.5, slamMs: 115, slowMs: 680, recoverMs: 280, slowScale: 0.48, slamScale: 0.18, letterbox: 0, maxFit: 0.78 },
  SHORT: { armMs: 0, pushMs: 150, travelRealMs: 130, minPushScale: 0.7, slamMs: 85, slowMs: 420, recoverMs: 200, slowScale: 0.58, slamScale: 0.22, letterbox: 0, maxFit: 0.66 },
};

export const getKillCamTiming = (
  tier: KillCamTier,
  mode: KillCamMode = 'FULL',
  cameraStyle?: KillCamCameraStyle,
): KillCamTiming => {
  const bucket = mode === 'SHORT' ? 'SHORT' : 'FULL';
  if (cameraStyle === 'GRAZE_FAKEOUT') return GRAZE_TIMING[bucket];
  return KILL_CAM_TIMINGS[bucket][tier];
};

const PUSH_RAMP_MS = 80;

const IDLE_FRAME: KillCamFrame = {
  active: false,
  mode: 'FULL',
  phase: 'IDLE',
  cameraStyle: 'STANDARD',
  cue: null,
  combo: 0,
  timeScale: 1,
  fit: 0,
  recover: 0,
  frameW: 0,
  frameH: 0,
  centerX: 0,
  centerY: 0,
  dutchTiltRad: 0,
  impactFlashGrade: 0,
  worldDesat: 0,
  schematicAlpha: 0,
  armProgress: 0,
  grazeFlipped: false,
  glitch: 0,
  letterbox: 0,
  dim: 0,
  flash: 0,
  reticle: 0,
  impact: 0,
  elapsedMs: 0,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampRange = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

/** Picks the signature weapon/cause cinematography profile for a cue. */
export const selectKillCamStyle = (cue: KillCamCue): KillCamCameraStyle => {
  if (cue.cameraStyle) return cue.cameraStyle;
  if (cue.subject === 'STRUCTURE') return 'STRUCTURE_BLOWOUT';
  if (cue.subject === 'ATTACK') {
    return cue.remainingHp === 1 ? 'GRAZE_FAKEOUT' : 'STANDARD';
  }
  if (cue.cause === 'MINE') return 'MINE_CLICK';
  if (cue.cause === 'OVERWATCH') return 'OVERWATCH_SNAP';
  if (cue.crossfireCount >= 1 && cue.crossfirePoints && cue.crossfirePoints.length > 0) {
    return 'CROSSFIRE_TRIANGLE';
  }
  if (cue.weapon === 'SNIPER' && cue.distanceTiles >= 3 && cue.hasVisibleOrigin !== false) {
    return 'SNIPER_WHIP';
  }
  if (cue.weapon === 'ASSAULTER' && cue.distanceTiles >= 2 && cue.hasVisibleOrigin !== false) {
    return 'BREACHER_ARC';
  }
  return 'STANDARD';
};

/** Only the kills that earn a full cinematic treatment — keeps pacing intact. */
export const classifyKillTier = (input: {
  rank: number;
  cause: KillCause;
  crossfireCount: number;
  weapon?: WeaponVisual;
  distanceTiles: number;
  overkill: number;
  combo: number;
  isMatchWinning?: boolean;
  zeroCpClutch?: boolean;
  isVendetta?: boolean;
  isFirstBlood?: boolean;
  killerUnitType?: UnitType;
  victimUnitType?: UnitType;
}): KillCamTier => {
  if (input.isMatchWinning) return 'CINEMATIC';
  if (input.zeroCpClutch) return 'CINEMATIC';
  if (input.isVendetta) return 'CINEMATIC';
  if (input.combo >= 2) return 'CINEMATIC';
  if (input.rank >= 3) return 'CINEMATIC';
  if (input.cause !== 'COMBAT') return 'CINEMATIC';
  if (input.crossfireCount >= 2) return 'CINEMATIC';
  if (input.weapon === 'SNIPER' && input.distanceTiles >= 5) return 'CINEMATIC';
  if (input.overkill >= 10) return 'CINEMATIC';
  if (input.killerUnitType === 'SOLDIER' && (input.victimUnitType === 'SNIPER' || input.rank >= 2)) return 'CINEMATIC';
  return 'MICRO';
};

export const KILL_CAM_CAUSE_LABEL: Record<KillCause, string> = {
  COMBAT: 'DIRECT FIRE',
  OVERWATCH: 'OVERWATCH AMBUSH',
  MINE: 'LAND MINE',
  TURRET: 'BANK TURRET',
  ARTILLERY: 'BASE ARTILLERY',
  LAVA: 'MAGMA',
  BASE_FALL: 'HQ COLLAPSE',
};

export const KILL_CAM_WEAPON_LABEL: Record<WeaponVisual, string> = {
  SOLDIER: 'SCOUT CARBINE',
  ASSAULTER: 'BREACHER SIEGE GUN',
  SNIPER: 'RAIL SNIPER',
  TURRET: 'BANK MG',
  ARTILLERY: 'HQ AUTOCANNON',
  SIEGE: 'DEMOLITION CHARGE',
};

export interface ResolvedNarrative {
  headline: string;
  eyebrow: string;
  tags: KillCamNarrativeTag[];
  accentGold: boolean;
}

/**
 * Priority-ranked emergent narrative resolver driven by deterministic match facts.
 * Picks the highest-drama headline while preserving all secondary badges for chips.
 */
export const resolveKillCamNarrative = (cue: KillCamCue, combo: number): ResolvedNarrative => {
  const tags: KillCamNarrativeTag[] = [];
  const victimRank = cue.victimRank ?? 0;
  const isGiantSlayer =
    cue.subject === 'KILL' &&
    cue.killerUnitType === 'SOLDIER' &&
    (cue.victimUnitType === 'SNIPER' || victimRank >= 2);

  if (cue.isMatchWinning) tags.push('FINAL_BLOW');
  if (cue.zeroCpClutch) tags.push('ZERO_CP');
  if (cue.isVendetta) tags.push('VENDETTA');
  if (isGiantSlayer) tags.push('GIANT_SLAYER');
  if (cue.isFirstBlood) tags.push('FIRST_BLOOD');
  if (cue.weapon === 'SNIPER' && cue.distanceTiles >= 7) tags.push('LONGSHOT');
  if (cue.overkill >= 10) tags.push('OVERKILL');
  if (cue.crossfireCount > 0) tags.push('CROSSFIRE');
  if (cue.subject === 'ATTACK' && cue.remainingHp === 1) tags.push('GRAZE');

  if (cue.subject === 'STRUCTURE') {
    const eyebrow = cue.isMatchWinning
      ? 'MATCH POINT · HQ ASSAULT'
      : cue.structureType === 'BANK'
        ? 'BANK ASSAULT'
        : 'HQ ASSAULT';
    return {
      headline: cue.isMatchWinning ? 'FINAL BLOW' : cue.title ?? 'STRUCTURE LOST',
      eyebrow,
      tags,
      accentGold: Boolean(cue.isMatchWinning || cue.structureType === 'BANK'),
    };
  }

  if (cue.subject === 'ATTACK') {
    const grazed = cue.remainingHp === 1;
    return {
      headline: grazed ? '1 HP · BARELY ALIVE!' : 'DIRECT HIT',
      eyebrow: grazed ? 'GRAZE SURVIVAL' : cue.cause === 'OVERWATCH' ? 'OVERWATCH HIT' : 'COMBAT IMPACT',
      tags,
      accentGold: grazed,
    };
  }

  let headline = 'ELIMINATED';
  let accentGold = false;

  if (cue.isMatchWinning) {
    headline = 'FINAL BLOW';
    accentGold = true;
  } else if (combo > 1) {
    headline = `${combo}× MULTI KILL`;
    accentGold = true;
  } else if (cue.zeroCpClutch) {
    headline = '0 CP CLUTCH';
    accentGold = true;
  } else if (cue.isVendetta) {
    headline = 'VENDETTA';
    accentGold = true;
  } else if (victimRank >= 3) {
    headline = 'ACE DOWN';
    accentGold = true;
  } else if (isGiantSlayer) {
    headline = 'GIANT SLAYER';
    accentGold = true;
  } else if (cue.isFirstBlood) {
    headline = 'FIRST BLOOD';
  } else if (cue.cause !== 'COMBAT') {
    headline = `${KILL_CAM_CAUSE_LABEL[cue.cause]} KILL`;
  } else if (cue.weapon === 'SNIPER' && cue.distanceTiles >= 7) {
    headline = 'LONGSHOT';
  }

  const eyebrow =
    cue.hasVisibleOrigin === false && cue.cause === 'COMBAT'
      ? 'FOG AMBUSH'
      : KILL_CAM_CAUSE_LABEL[cue.cause];

  return { headline, eyebrow, tags, accentGold };
};

export interface ClampedKillCamViewport {
  centerX: number;
  centerY: number;
  scale: number;
  /** Victim's projected screen coords (0..1) so KillCamOverlay can flip telemetry opposite corners. */
  subjectScreenX: number;
  subjectScreenY: number;
}

/**
 * Rule-of-Thirds soft clamping + Dutch-tilt zoom floor so corner kills never expose out-of-bounds
 * grey void. Guarantees the visible rotated viewport stays inside `[ -maxBleed, boardSize + maxBleed ]`,
 * naturally shifting corner fights onto a cinematic Rule-of-Thirds focal point.
 */
export function computeClampedKillCamViewport(params: {
  targetX: number;
  targetY: number;
  subjectX: number;
  subjectY: number;
  desiredScale: number;
  screenWidth: number;
  screenHeight: number;
  boardSize: number;
  dutchTiltRad: number;
  clampBlend?: number;
  maxBleedPx?: number;
  maxScale?: number;
}): ClampedKillCamViewport {
  const {
    targetX,
    targetY,
    subjectX,
    subjectY,
    desiredScale,
    screenWidth,
    screenHeight,
    boardSize,
    dutchTiltRad,
    clampBlend = 1,
    maxBleedPx = 22,
    maxScale = 2.6,
  } = params;

  const safeW = Math.max(64, screenWidth);
  const safeH = Math.max(64, screenHeight);
  const safeBoard = Math.max(64, boardSize);
  const cos = Math.abs(Math.cos(dutchTiltRad));
  const sin = Math.abs(Math.sin(dutchTiltRad));
  const rotW = safeW * cos + safeH * sin;
  const rotH = safeH * cos + safeW * sin;

  const span = safeBoard + maxBleedPx * 2;
  const minBoundScale = Math.min(maxScale, Math.max(rotW / span, rotH / span));
  const blend = clamp01(clampBlend);
  // Enforce the zoom floor smoothly as the camera commits so returning during RECOVER never snaps.
  const effectiveFloor = lerp(desiredScale, Math.max(desiredScale, minBoundScale), blend);
  const scale = Math.max(0.1, Math.min(maxScale, Math.max(desiredScale, effectiveFloor)));

  const halfW = rotW / (2 * scale);
  const halfH = rotH / (2 * scale);
  const minCx = halfW - maxBleedPx;
  const maxCx = safeBoard - halfW + maxBleedPx;
  const minCy = halfH - maxBleedPx;
  const maxCy = safeBoard - halfH + maxBleedPx;

  const clampedX = minCx <= maxCx ? clampRange(targetX, minCx, maxCx) : safeBoard / 2;
  const clampedY = minCy <= maxCy ? clampRange(targetY, minCy, maxCy) : safeBoard / 2;

  const centerX = lerp(targetX, clampedX, blend);
  const centerY = lerp(targetY, clampedY, blend);

  const subjectScreenX = clamp01(0.5 + ((subjectX - centerX) * scale) / safeW);
  const subjectScreenY = clamp01(0.5 + ((subjectY - centerY) * scale) / safeH);

  return { centerX, centerY, scale, subjectScreenX, subjectScreenY };
}

export class KillCamDirector {
  private mode: KillCamMode = 'FULL';
  private cue: KillCamCue | null = null;
  private cameraStyle: KillCamCameraStyle = 'STANDARD';
  private phase: KillCamPhase = 'IDLE';
  private elapsedMs = 0;
  private phaseElapsedMs = 0;
  private combo = 0;
  private timeScale = 1;
  private pushHoldMs = 0;
  private pushMsEff = 1;
  private pushScaleEff = 0.3;
  private hadPush = false;
  private hadArm = false;
  private reducedMotion = false;
  private skippedCueIds = new Set<number>();

  public setMode(mode: KillCamMode): void {
    this.mode = mode;
    if (mode === 'OFF') {
      this.reset();
    }
  }

  public getMode(): KillCamMode {
    return this.mode;
  }

  /**
   * Starts the pre-detonation `ARM` tension beat (used for Land Mine "*click* ... BOOM").
   * Returns the real-time `armMs` duration so `fxTimeline` can delay detonation to match.
   */
  public arm(cue: KillCamCue, reducedMotion = false): number {
    this.reducedMotion = reducedMotion;
    if (reducedMotion || this.mode === 'OFF' || this.skippedCueIds.has(cue.id)) {
      return 0;
    }
    const style = selectKillCamStyle(cue);
    const timing = getKillCamTiming(cue.tier, this.mode, style);
    if (timing.armMs <= 0) return 0;
    this.cue = { ...cue, cameraStyle: style };
    this.cameraStyle = style;
    this.combo = cue.combo;
    this.elapsedMs = 0;
    this.hadPush = false;
    this.hadArm = true;
    // Near-freeze during the 150ms click beat so the victim freezes right on top of the mine!
    this.timeScale = 0.04;
    this.enter('ARM');
    return timing.armMs;
  }

  /**
   * Starts the in-flight push-in when the shot actually fires.
   * Returns the estimated real-time flight duration (ms) so audio risers can match it.
   */
  public preRoll(cue: KillCamCue, reducedMotion = false): number {
    this.reducedMotion = reducedMotion;
    if (reducedMotion || this.mode === 'OFF' || this.skippedCueIds.has(cue.id)) {
      if (reducedMotion || this.mode === 'OFF') this.reset();
      return 0;
    }
    if (cue.tier === 'ATTACK' && this.cue && this.cue.tier !== 'ATTACK') {
      return 0;
    }
    const style = selectKillCamStyle(cue);
    this.cue = { ...cue, cameraStyle: style };
    this.cameraStyle = style;
    this.combo = cue.combo;
    this.elapsedMs = 0;
    const timing = getKillCamTiming(cue.tier, this.mode, style);
    this.pushHoldMs = Math.max(0, Math.min(1800, cue.travelMs));
    this.pushScaleEff = this.pushHoldMs > 0 && timing.travelRealMs > 0
      ? clampRange(this.pushHoldMs / timing.travelRealMs, timing.minPushScale, 0.9)
      : timing.minPushScale;
    const rampMs = Math.min(PUSH_RAMP_MS, this.pushHoldMs);
    const avgRampScale = this.pushScaleEff + (1 - this.pushScaleEff) * 0.25;
    const combatCoveredInRamp = rampMs * avgRampScale;
    const remainingCombat = Math.max(0, this.pushHoldMs - combatCoveredInRamp);
    const realFlightMs = rampMs + remainingCombat / Math.max(0.02, this.pushScaleEff);
    this.pushMsEff = Math.max(140, Math.min(timing.pushMs, realFlightMs || timing.pushMs));
    this.hadPush = true;
    this.hadArm = false;
    this.timeScale = 1;
    this.enter('PUSH');
    return Math.round(this.pushMsEff);
  }

  /** The blow lands: impact frame, dilation window, recover. */
  public impact(cue: KillCamCue): boolean {
    if (this.reducedMotion || this.mode === 'OFF') return false;
    if (this.skippedCueIds.has(cue.id)) {
      this.skippedCueIds.delete(cue.id);
      return false;
    }
    if (cue.tier === 'ATTACK' && this.cue && this.cue.tier !== 'ATTACK') {
      return false;
    }
    const style = selectKillCamStyle(cue);
    if (!this.cue) {
      this.cue = { ...cue, cameraStyle: style };
      this.cameraStyle = style;
      this.combo = cue.subject === 'KILL' ? Math.max(1, cue.combo) : 1;
      this.elapsedMs = 0;
      this.hadPush = false;
      this.hadArm = false;
    } else if (cue.id !== this.cue.id) {
      const escalatingFromAttack = this.cue.subject === 'ATTACK' && cue.subject !== 'ATTACK';
      this.cue = { ...cue, cameraStyle: style };
      this.cameraStyle = style;
      if (escalatingFromAttack) {
        this.combo = cue.subject === 'KILL' ? Math.max(1, cue.combo) : 1;
        this.hadPush = false;
        this.hadArm = false;
      } else if (cue.subject === 'KILL') {
        this.combo = Math.max(2, this.combo + 1);
      } else {
        this.combo = 1;
      }
    } else {
      this.cameraStyle = style;
    }
    const timing = getKillCamTiming(cue.tier, this.mode, this.cameraStyle);
    this.timeScale = timing.slamScale;
    this.enter('SLAM');
    return true;
  }

  /** Immediately cancels the active cut and prevents deferred impact from reopening it. */
  public skip(): boolean {
    if (this.phase === 'IDLE' || !this.cue) return false;
    const skippedId = this.cue.id;
    if (this.phase === 'PUSH' || this.phase === 'ARM') {
      this.skippedCueIds.add(skippedId);
      if (this.skippedCueIds.size > 24) {
        const oldest = this.skippedCueIds.values().next().value;
        if (oldest !== undefined) this.skippedCueIds.delete(oldest);
      }
    }
    this.reset();
    return true;
  }

  public wasSkipped(cueId: number): boolean {
    return this.skippedCueIds.has(cueId);
  }

  public isActive(): boolean {
    return this.phase !== 'IDLE';
  }

  public getTimeScale(): number {
    return this.timeScale;
  }

  public getCue(): KillCamCue | null {
    return this.cue;
  }

  public clear(): void {
    this.skippedCueIds.clear();
    this.reset();
  }

  public step(rawDtMs: number): void {
    if (this.phase === 'IDLE' || !this.cue) return;
    const dt = Math.max(0, Math.min(50, Number.isFinite(rawDtMs) ? rawDtMs : 0));
    if (dt <= 0) return;

    this.elapsedMs += dt;
    this.phaseElapsedMs += dt;
    const timing = getKillCamTiming(this.cue.tier, this.mode, this.cameraStyle);

    switch (this.phase) {
      case 'ARM': {
        this.timeScale = 0.04;
        // Safety valve in case impact never follows arm.
        if (this.phaseElapsedMs > Math.max(400, timing.armMs * 3)) this.reset();
        return;
      }
      case 'PUSH': {
        const t = clamp01(this.phaseElapsedMs / PUSH_RAMP_MS);
        this.timeScale = lerp(1, this.pushScaleEff, easeOutCubic(t));
        if (this.phaseElapsedMs > this.pushMsEff * 1.6 + 1500) this.reset();
        return;
      }
      case 'SLAM': {
        this.timeScale = timing.slamScale;
        if (this.phaseElapsedMs >= timing.slamMs) this.enter('SLOW');
        return;
      }
      case 'SLOW': {
        this.timeScale = timing.slowScale;
        if (this.phaseElapsedMs >= timing.slowMs) this.enter('RECOVER');
        return;
      }
      case 'RECOVER': {
        const t = clamp01(this.phaseElapsedMs / timing.recoverMs);
        this.timeScale = lerp(timing.slowScale, 1, smoothstep(t));
        if (this.phaseElapsedMs >= timing.recoverMs) this.reset();
        return;
      }
      default:
        this.reset();
    }
  }

  public getFrame(): KillCamFrame {
    if (this.phase === 'IDLE' || !this.cue) {
      return this.mode === 'FULL' ? IDLE_FRAME : { ...IDLE_FRAME, mode: this.mode };
    }
    const cue = this.cue;
    const style = this.cameraStyle;
    const timing = getKillCamTiming(cue.tier, this.mode, style);
    const hasLetterbox = timing.letterbox > 0;
    const maxFit = timing.maxFit;
    const isAttack = cue.tier === 'ATTACK';
    const isGraze = style === 'GRAZE_FAKEOUT';
    const isBlueprintWorthy = cue.tier === 'CINEMATIC' || cue.tier === 'STRUCTURE';
    const slowCreep = isAttack ? (isGraze ? -0.14 : 0.02) : 0.05;

    const armT = smoothstep(this.phaseElapsedMs / Math.max(1, timing.armMs || 150));
    const pushLinear = clamp01(this.phaseElapsedMs / Math.max(1, this.pushMsEff));
    const pushT = smoothstep(pushLinear);
    const slamT = easeOutCubic(this.phaseElapsedMs / Math.max(1, timing.slamMs));
    const slowT = clamp01(this.phaseElapsedMs / Math.max(1, timing.slowMs));
    const recoverT = smoothstep(this.phaseElapsedMs / Math.max(1, timing.recoverMs));

    const pairX = (cue.markerX + cue.focusX) / 2;
    const pairY = (cue.markerY + cue.focusY) / 2;
    const dx = cue.focusX - cue.markerX;
    const dy = cue.focusY - cue.markerY;
    const tiltSign = dx >= 0 ? 1 : -1;

    // Weapon-specific framing anchor points & dimensions
    let pushCenterX = pairX;
    let pushCenterY = pairY;
    let slamCenterX = lerp(pairX, cue.focusX, isAttack ? 0.14 : 0.22);
    let slamCenterY = lerp(pairY, cue.focusY, isAttack ? 0.14 : 0.22);
    let frameW = cue.frameW;
    let frameH = cue.frameH;
    let peakTiltRad = 0;

    switch (style) {
      case 'SNIPER_WHIP': {
        // Hold Sniper's high-ground perch for first 28%, then whip-pan riding the rail tip!
        const whipT = pushLinear < 0.28 ? 0 : easeOutCubic((pushLinear - 0.28) / 0.72);
        pushCenterX = lerp(cue.markerX, cue.focusX, whipT * 0.88);
        pushCenterY = lerp(cue.markerY, cue.focusY, whipT * 0.88);
        slamCenterX = lerp(pairX, cue.focusX, 0.72);
        slamCenterY = lerp(pairY, cue.focusY, 0.72);
        peakTiltRad = tiltSign * 0.036; // ~2.1 deg
        break;
      }
      case 'OVERWATCH_SNAP': {
        // Snap onto the hidden Overwatcher first (0..32%), then zip to the intercepted runner.
        const snapT = pushLinear < 0.32 ? 0 : easeOutCubic((pushLinear - 0.32) / 0.68);
        pushCenterX = lerp(cue.markerX, cue.focusX, snapT);
        pushCenterY = lerp(cue.markerY, cue.focusY, snapT);
        slamCenterX = lerp(pairX, cue.focusX, 0.62);
        slamCenterY = lerp(pairY, cue.focusY, 0.62);
        peakTiltRad = -tiltSign * 0.026;
        break;
      }
      case 'CROSSFIRE_TRIANGLE': {
        const wideX = cue.triCenterX ?? pairX;
        const wideY = cue.triCenterY ?? pairY;
        const wideW = cue.triFrameW ?? cue.frameW;
        const wideH = cue.triFrameH ?? cue.frameH;
        const tightW = Math.max(cue.frameW * 0.65, 220);
        const tightH = Math.max(cue.frameH * 0.65, 190);
        pushCenterX = wideX;
        pushCenterY = wideY;
        slamCenterX = lerp(wideX, cue.focusX, 0.74);
        slamCenterY = lerp(wideY, cue.focusY, 0.74);
        if (this.phase === 'PUSH') {
          frameW = wideW;
          frameH = wideH;
        } else if (this.phase === 'SLAM') {
          frameW = lerp(wideW, tightW, slamT);
          frameH = lerp(wideH, tightH, slamT);
        } else {
          frameW = tightW;
          frameH = tightH;
        }
        peakTiltRad = tiltSign * 0.02;
        break;
      }
      case 'BREACHER_ARC': {
        // Follow the tank blast shell along its low parabolic arc.
        const arcLift = Math.min(28, Math.hypot(dx, dy) * 0.08) * 4 * pushLinear * (1 - pushLinear);
        pushCenterX = lerp(cue.markerX, cue.focusX, pushT * 0.85);
        pushCenterY = lerp(cue.markerY, cue.focusY, pushT * 0.85) - arcLift * 0.45;
        slamCenterX = lerp(pairX, cue.focusX, 0.56);
        slamCenterY = lerp(pairY, cue.focusY, 0.56);
        peakTiltRad = tiltSign * 0.024;
        break;
      }
      case 'MINE_CLICK': {
        pushCenterX = cue.focusX;
        pushCenterY = cue.focusY;
        slamCenterX = cue.focusX;
        slamCenterY = cue.focusY;
        peakTiltRad = 0.03;
        break;
      }
      case 'STRUCTURE_BLOWOUT': {
        pushCenterX = cue.focusX;
        pushCenterY = cue.focusY;
        slamCenterX = cue.focusX;
        slamCenterY = cue.focusY;
        peakTiltRad = cue.structureType === 'BASE' ? 0.028 : 0.014;
        break;
      }
      case 'GRAZE_FAKEOUT': {
        slamCenterX = lerp(pairX, cue.focusX, 0.52);
        slamCenterY = lerp(pairY, cue.focusY, 0.52);
        peakTiltRad = tiltSign * 0.018;
        break;
      }
      default:
        peakTiltRad = cue.tier === 'CINEMATIC' ? tiltSign * 0.016 : 0;
        break;
    }

    let fit = 0;
    let recover = 0;
    let letterbox = 0;
    let dim = 0;
    let flash = 0;
    let reticle = 0;
    let impact = 0;
    let centerX = pushCenterX;
    let centerY = pushCenterY;
    let dutchTiltRad = 0;
    let impactFlashGrade = 0;
    let worldDesat = 0;
    let schematicAlpha = 0;
    let armProgress = 0;
    let grazeFlipped = false;
    let glitch = 0;

    switch (this.phase) {
      case 'ARM': {
        // Mine "*click*" micro-tension beat right before explosion.
        fit = lerp(0.12, 0.42, armT) * maxFit;
        dim = lerp(0, 0.28, armT);
        reticle = lerp(0.5, 1, armT);
        schematicAlpha = 0.9;
        armProgress = armT;
        centerX = cue.focusX;
        centerY = cue.focusY;
        break;
      }
      case 'PUSH': {
        fit = lerp(0.12, 0.8, pushT) * maxFit;
        dim = lerp(0, isAttack ? 0.08 : 0.2, pushT);
        reticle = lerp(0.32, 0.86, easeOutCubic(clamp01(pushLinear * 4.5)));
        letterbox = hasLetterbox ? lerp(0, 0.1 * timing.letterbox, pushT) : 0;
        dutchTiltRad = lerp(0, peakTiltRad * 0.85, pushT);
        schematicAlpha = isBlueprintWorthy ? lerp(0.15, 0.52, pushT) : 0;
        glitch = style === 'OVERWATCH_SNAP' && this.phaseElapsedMs < 85 ? 1 - this.phaseElapsedMs / 85 : 0;
        centerX = pushCenterX;
        centerY = pushCenterY;
        break;
      }
      case 'SLAM': {
        const startFit = this.hadPush ? 0.8 : this.hadArm ? 0.42 : 0;
        fit = lerp(startFit, 1, slamT) * maxFit;
        letterbox = hasLetterbox ? slamT * timing.letterbox : 0;
        dim = lerp(isAttack ? 0.08 : 0.2, isGraze ? 0.36 : isAttack ? 0.2 : 0.52, slamT);
        reticle = 1;
        flash = Math.max(0, (isAttack && !isGraze ? 0.45 : 1) - slamT * 1.15);
        impact = slamT;
        dutchTiltRad = lerp(peakTiltRad * 0.85, peakTiltRad, slamT);
        // Beat A (0–55ms): crisp 2-frame anime luminance impact pulse; Beat B: cool recon slate.
        const animeFlashT = clamp01(1 - this.phaseElapsedMs / 58);
        impactFlashGrade = isBlueprintWorthy ? animeFlashT : cue.tier === 'MICRO' ? animeFlashT * 0.48 : 0;
        worldDesat = isBlueprintWorthy
          ? lerp(0.25, 0.78, slamT)
          : cue.tier === 'MICRO'
            ? lerp(0.1, 0.34, slamT)
            : isGraze
              ? lerp(0.1, 0.42, slamT)
              : 0;
        schematicAlpha = isBlueprintWorthy ? lerp(0.52, 1, slamT) : cue.tier === 'MICRO' ? lerp(0.2, 0.65, slamT) : isGraze ? slamT : 0;
        centerX = lerp(pushCenterX, slamCenterX, slamT);
        centerY = lerp(pushCenterY, slamCenterY, slamT);
        break;
      }
      case 'SLOW': {
        fit = (1 + slowCreep * smoothstep(slowT)) * maxFit;
        letterbox = hasLetterbox ? timing.letterbox : 0;
        dim = lerp(isGraze ? 0.32 : isAttack ? 0.2 : 0.52, isAttack ? 0.12 : 0.4, slowT);
        reticle = 1 - 0.35 * smoothstep(slowT);
        impact = 1;
        dutchTiltRad = lerp(peakTiltRad, peakTiltRad * 0.55, slowT);
        worldDesat = isBlueprintWorthy ? lerp(0.78, 0.58, slowT) : cue.tier === 'MICRO' ? lerp(0.34, 0.2, slowT) : isGraze ? lerp(0.36, 0.14, slowT) : 0;
        schematicAlpha = isBlueprintWorthy ? 1 : cue.tier === 'MICRO' ? lerp(0.65, 0.4, slowT) : isGraze ? 1 - slowT * 0.35 : 0;
        grazeFlipped = isGraze;
        glitch = isGraze && this.phaseElapsedMs < 95 ? 1 - this.phaseElapsedMs / 95 : 0;
        centerX = slamCenterX;
        centerY = slamCenterY;
        break;
      }
      case 'RECOVER': {
        fit = lerp((1 + slowCreep) * maxFit, 0, recoverT);
        recover = recoverT;
        letterbox = hasLetterbox ? (1 - recoverT) * timing.letterbox : 0;
        dim = (isAttack ? 0.12 : 0.4) * (1 - recoverT);
        reticle = 0.65 * (1 - recoverT);
        impact = 1;
        dutchTiltRad = peakTiltRad * 0.55 * (1 - recoverT);
        worldDesat = (isBlueprintWorthy ? 0.58 : cue.tier === 'MICRO' ? 0.2 : isGraze ? 0.14 : 0) * (1 - recoverT);
        schematicAlpha = (isBlueprintWorthy ? 1 : cue.tier === 'MICRO' ? 0.4 : isGraze ? 0.65 : 0) * (1 - recoverT);
        grazeFlipped = isGraze;
        centerX = lerp(slamCenterX, pairX, recoverT);
        centerY = lerp(slamCenterY, pairY, recoverT);
        break;
      }
      default:
        return IDLE_FRAME;
    }

    return {
      active: true,
      mode: this.mode,
      phase: this.phase,
      cameraStyle: style,
      cue,
      combo: this.combo,
      timeScale: this.timeScale,
      fit,
      recover,
      frameW,
      frameH,
      centerX,
      centerY,
      dutchTiltRad: this.reducedMotion ? 0 : dutchTiltRad,
      impactFlashGrade: this.reducedMotion ? 0 : impactFlashGrade,
      worldDesat: this.reducedMotion ? 0 : worldDesat,
      schematicAlpha,
      armProgress,
      grazeFlipped,
      glitch: this.reducedMotion ? 0 : glitch,
      letterbox,
      dim,
      flash,
      reticle,
      impact,
      elapsedMs: this.elapsedMs,
    };
  }

  private enter(phase: KillCamPhase): void {
    this.phase = phase;
    this.phaseElapsedMs = 0;
  }

  private reset(): void {
    this.cue = null;
    this.cameraStyle = 'STANDARD';
    this.phase = 'IDLE';
    this.elapsedMs = 0;
    this.phaseElapsedMs = 0;
    this.combo = 0;
    this.timeScale = 1;
    this.pushHoldMs = 0;
    this.pushMsEff = 1;
    this.pushScaleEff = 0.3;
    this.hadPush = false;
    this.hadArm = false;
  }
}

const RECEIPT_TERRAIN_LABEL: Record<string, string> = {
  FOREST: 'FOREST',
  MOUNTAIN: 'HIGH GROUND',
  DUNES: 'DUNES',
  SAND: 'EXPOSED SAND',
  ROAD: 'ROAD',
  BUILDING: 'URBAN',
  WATER: 'WATERLINE',
  BRIDGE: 'BRIDGE',
  BRIDGE_V: 'BRIDGE',
  QUICKSAND: 'QUICKSAND',
  CANYON: 'CANYON',
  TUNNEL: 'TUNNEL',
  BASE: 'HQ PERIMETER',
  BARRIER: 'BARRIER',
  LAVA: 'MAGMA',
};

export interface ReceiptStep {
  text: string;
  tone: 'base' | 'boost' | 'mitigate' | 'total';
}

/** Builds a clean deterministic step-by-step Tactical Receipt from engine `DamageBreakdown`. */
export const buildReceiptSteps = (
  breakdown: DamageBreakdown | undefined,
  damage: number,
  isKill: boolean,
): ReceiptStep[] => {
  if (!breakdown || damage <= 0) return [];
  const steps: ReceiptStep[] = [
    { text: `${breakdown.baseDamage} ${breakdown.isOverwatch ? 'OVERWATCH' : 'BASE'}`, tone: 'base' },
  ];
  if (breakdown.watchtowerBoosted) {
    steps.push({ text: '×1.2 TOWER', tone: 'boost' });
  }
  if (breakdown.coverPct > 0) {
    const pct = Math.round(breakdown.coverPct * 100);
    const terr = breakdown.coverTerrain
      ? (RECEIPT_TERRAIN_LABEL[breakdown.coverTerrain] ?? breakdown.coverTerrain)
      : 'COVER';
    steps.push({ text: `−${pct}% ${terr}`, tone: 'mitigate' });
  } else if (breakdown.coverPct < 0) {
    const pct = Math.round(Math.abs(breakdown.coverPct) * 100);
    steps.push({ text: `+${pct}% EXPOSED`, tone: 'boost' });
  }
  if (breakdown.coverArmorApplied) {
    steps.push({ text: '−2 ARMOR', tone: 'mitigate' });
  }
  if (breakdown.crossfireBonus > 0) {
    steps.push({ text: `+${breakdown.crossfireBonus} CROSSFIRE`, tone: 'boost' });
  }
  // Only show the formula chain when at least one modifier touched the shot (or on kills)
  if (steps.length === 1 && !isKill) return [];
  steps.push({ text: `= ${damage} ${isKill ? 'LETHAL' : 'DMG'}`, tone: 'total' });
  return steps;
};
