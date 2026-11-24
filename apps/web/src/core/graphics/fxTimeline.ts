/**
 * Time-driven combat & battlefield FX sequencer (`fxTimeline`).
 *
 * Replaces `setTimeout`-based effect lifecycles with deterministic elapsed-time stepping
 * driven by Pixi's ticker (with strict delta clamping to prevent ECO wake spikes).
 * Owns:
 * - Tile-by-tile unit movement tracks with terrain footstep triggers & stride bob
 * - Compound MOVE -> OVERWATCH -> MINE choreography
 * - Weapon-specific combat sequencing, crossfire lock lines, and hit-stop
 * - Non-blocking visual deferral (pending-death presence & pre-impact HP display)
 * - Zero-drift zoom-compensated camera trauma shake
 *
 * Pure TypeScript with zero React/Pixi runtime imports so it can be unit-tested in Node.
 */
import { PLAYER_COLORS, TILE_SIZE, UNIT_STATS, VETERANCY_CONFIG } from '@tactical/engine/constants/Config';
import type { GameEvent, KillCause, SoundName, SupplyLootType, TerrainType, TilePoint, UnitRank, UnitType, WeaponVisual } from '@tactical/engine';

export type ProjectileVisualStyle = 'BULLET' | 'LASER' | 'MISSILE';

export type ParticlePresetKind =
  | 'muzzleFlash'
  | 'impactSparks'
  | 'explosion'
  | 'deathBurst'
  | 'capturePulse'
  | 'dustPuff'
  | 'leafBurst'
  | 'waterRipple'
  | 'healPulse'
  | 'goldBurst'
  | 'shockwaveRing'
  | 'overwatchRing'
  | 'constructionDust'
  | 'lavaSplash';

export interface ParticleEmitRequest {
  preset: ParticlePresetKind;
  x: number;
  y: number;
  /** Optional direction angle in radians (board space) for directional bursts. */
  angle?: number;
  /** Optional tint override (0xRRGGBB). */
  color?: number;
  /** Optional intensity multiplier (default 1). */
  scale?: number;
}

export interface ProjectileSpawnRequest {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  type: ProjectileVisualStyle;
  weapon?: WeaponVisual;
  color: number;
  travelMs: number;
  /** Number of rapid rounds for multi-round bursts (e.g., Base MG: 6 single-target, 4 per target in multi-target sweep). */
  burstRounds?: number;
}

export interface CrossfireLockRequest {
  id: string;
  supporters: { x: number; y: number }[];
  targetX: number;
  targetY: number;
  durationMs: number;
}

export interface PopupSpawnRequest {
  id: string;
  x: number;
  y: number;
  value: string;
  color: string;
  durationMs: number;
}

export interface PendingDeathVisual {
  unitId: string;
  unitType: UnitType;
  owner: number;
  rank: UnitRank;
  /** Starting tile (or death tile if stationary) in grid coordinates. */
  tileX: number;
  tileY: number;
  /** Final tile where the lethal impact lands (for snap/alignment). */
  endTileX: number;
  endTileY: number;
  /** Pre-lethal HP to display until the lethal blow arrives. */
  displayHp: number;
}

export interface DeathGhostRequest {
  id: string;
  unitId: string;
  unitType: UnitType;
  owner: number;
  rank: UnitRank;
  /** Top-left world pixel coordinate matching tile `(x * TILE_SIZE, y * TILE_SIZE)`. */
  x: number;
  y: number;
  cause: KillCause;
  durationMs: number;
}

export type TileEffectKind = 'scorch' | 'mineFlash' | 'captureWave' | 'spawnBeam';

export interface TileEffectRequest {
  id: string;
  kind: TileEffectKind;
  /** Top-left world pixel coordinate of the tile. */
  x: number;
  y: number;
  color: number;
  durationMs: number;
  scale?: number;
}

export interface TacticalCalloutRequest {
  id: string;
  headline: string;
  subtext: string;
  /** Killer/acting player seat (`0..5`) or `null` for neutral hazard/environment styling. */
  accentPlayer: number | null;
  tone: 'kill' | 'ace' | 'heist' | 'base';
  priority: number;
  durationMs: number;
}

export interface SupplyDropAnimRequest {
  id: string;
  tileId: string;
  /** Top-left world pixel coordinate of landing tile. */
  x: number;
  y: number;
  item: SupplyLootType;
  durationMs: number;
}

export interface PromotionBurstRequest {
  id: string;
  unitId: string;
  /** Center world pixel coordinate of promoted unit tile. */
  x: number;
  y: number;
  rank: UnitRank;
  label: string;
  durationMs: number;
}

export interface UnitImpulseInput {
  recoilX?: number;
  recoilY?: number;
  flashColor?: number;
  flashMs?: number;
  durationMs?: number;
}

export interface UnitImpulseSample {
  offsetX: number;
  offsetY: number;
  flashColor: number;
  flashAlpha: number;
}

interface InternalUnitImpulse {
  recoilX: number;
  recoilY: number;
  elapsedMs: number;
  durationMs: number;
  flashColor: number;
  flashMs: number;
}

export interface UnitMovePose {
  /** Top-left world pixel coordinate matching UnitSprite container `(x, y)`. */
  x: number;
  y: number;
  /** Movement heading in radians (board space). */
  facingRad: number;
  /** Screen-up stride bob lift in pixels (0 under reduced motion or pause). */
  strideBobPx: number;
  scaleX: number;
  scaleY: number;
  progress: number;
}

interface InternalMoveTrack {
  path: TilePoint[];
  walkElapsedMs: number;
  totalMoveMs: number;
  lastSteppedIdx: number;
  pauseAtSegIdx: number | null;
  pauseDurationMs: number;
  pauseElapsedMs: number;
  isPaused: boolean;
}

export interface ShakeOffset {
  x: number;
  y: number;
}

export interface BaseTurretSample {
  aimAngle: number;
  recoilLeft: number;
  recoilRight: number;
  firingSide: -1 | 0 | 1;
}

interface InternalBaseTurret {
  aimAngle: number;
  elapsedMs: number;
  burstDurationMs: number;
  holdDurationMs: number;
  roundIntervalMs: number;
}

export interface TimelineSink {
  playSound?: (sound: SoundName) => void;
  playWeaponFire?: (weapon: WeaponVisual, burstRounds?: number) => void;
  playWeaponImpact?: (weapon: WeaponVisual, burstRounds?: number) => void;
  playTurretSwivel?: () => void;
  playUnitMove?: (unitType: UnitType, durationMs: number, terrain?: TerrainType) => void;
  playTacticalFoley?: (kind: 'reload' | 'overwatch' | 'heal' | 'build') => void;
  playKillConfirm?: () => void;
  spawnProjectile?: (proj: ProjectileSpawnRequest) => void;
  removeProjectile?: (id: string) => void;
  spawnCrossfire?: (lock: CrossfireLockRequest) => void;
  removeCrossfire?: (id: string) => void;
  spawnPopup?: (popup: PopupSpawnRequest) => void;
  removePopup?: (id: string) => void;
  addDeferredHp?: (unitId: string, amount: number) => void;
  clearDeferredHp?: (unitId: string, amount: number) => void;
  addPendingDeath?: (ghost: PendingDeathVisual) => void;
  removePendingDeath?: (unitId: string) => void;
  spawnDeathGhost?: (ghost: DeathGhostRequest) => void;
  removeDeathGhost?: (id: string) => void;
  spawnTileEffect?: (fx: TileEffectRequest) => void;
  removeTileEffect?: (id: string) => void;
  spawnSupplyDrop?: (drop: SupplyDropAnimRequest) => void;
  removeSupplyDrop?: (id: string) => void;
  spawnPromotionBurst?: (burst: PromotionBurstRequest) => void;
  removePromotionBurst?: (id: string) => void;
  showCallout?: (callout: TacticalCalloutRequest) => void;
  getTileTerrain?: (x: number, y: number) => TerrainType | undefined;
  emitParticles?: (req: ParticleEmitRequest) => void;
  hasActiveParticles?: () => boolean;
  onWake?: (durationMs: number) => void;
  onClearVisuals?: () => void;
}

interface ScheduledCue {
  id: number;
  fireAtMs: number;
  callback: () => void;
  tag?: string;
}

/** Hard ceiling per tick so waking from ECO sleep or switching tabs never teleports FX. */
export const MAX_TIMELINE_STEP_MS = 33.33;

/** Linear trauma decay per second (1.0 -> 0 in ~450ms for crisp tactile response). */
const TRAUMA_DECAY_PER_SEC = 2.2;
const MAX_SHAKE_SCREEN_PX = 14;
const POPUP_LIFETIME_MS = 960;
export const DEATH_GHOST_DURATION_MS = 550;
export const SUPPLY_DROP_DURATION_MS = 720;
export const PROMOTION_BURST_DURATION_MS = 780;

const parseHexColor = (hex: string | undefined, fallback = 0x38BDF8): number => {
  if (!hex) return fallback;
  const parsed = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const playerFactionPixiColor = (owner: number | null | undefined): number => {
  if (owner === null || owner === undefined || owner < 0) return 0xEF4444;
  return parseHexColor(PLAYER_COLORS[owner], 0x38BDF8);
};

const killCauseSubtitle = (cause: KillCause): string => {
  switch (cause) {
    case 'OVERWATCH':
      return 'Overwatch Ambush';
    case 'MINE':
      return 'Land Mine Detonation';
    case 'TURRET':
      return 'Bank Turret Defense';
    case 'ARTILLERY':
      return 'Base Artillery Strike';
    case 'LAVA':
      return 'Doomsday Magma';
    case 'BASE_FALL':
      return 'Command Base Lost';
    default:
      return 'Direct Combat';
  }
};

export const tileCenterPx = (p: TilePoint): { x: number; y: number } => ({
  x: p.x * TILE_SIZE + TILE_SIZE / 2,
  y: p.y * TILE_SIZE + TILE_SIZE / 2,
});

/** Caps total unit march time so long sprints stay crisp against AI/bot 450–800ms cadence. */
export const computeMarchDurationMs = (stepCount: number): number => {
  if (stepCount <= 0) return 0;
  return Math.min(520, Math.max(160, stepCount * 95));
};

/** Maps terrain type to its footstep particle preset & palette. */
export const terrainFootstepPreset = (
  terrain: TerrainType | undefined,
): { preset: 'dustPuff' | 'leafBurst' | 'waterRipple'; color?: number; scale?: number } => {
  switch (terrain) {
    case 'FOREST':
      return { preset: 'leafBurst', scale: 0.9 };
    case 'WATER':
    case 'BRIDGE':
    case 'BRIDGE_V':
      return { preset: 'waterRipple', scale: 0.85 };
    case 'SAND':
    case 'DUNES':
      return { preset: 'dustPuff', color: 0xE2B86B, scale: 1.0 };
    case 'QUICKSAND':
      return { preset: 'dustPuff', color: 0xB45309, scale: 1.25 };
    case 'MOUNTAIN':
    case 'CANYON':
      return { preset: 'dustPuff', color: 0x94A3B8, scale: 0.92 };
    case 'ROAD':
    case 'ROAD_H':
    case 'BUILDING':
    case 'BASE':
    case 'BARRIER':
      return { preset: 'dustPuff', color: 0xCBD5E1, scale: 0.82 };
    default:
      return { preset: 'dustPuff', color: 0xD6C29F, scale: 0.92 };
  }
};

/** Computes crisp weapon-aware projectile travel time in milliseconds. */
export const estimateProjectileTravelMs = (
  from: TilePoint,
  to: TilePoint,
  style: ProjectileVisualStyle,
  weapon?: WeaponVisual,
): number => {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (weapon === 'SNIPER' || weapon === 'TURRET' || style === 'LASER') {
    return Math.round(Math.min(170, Math.max(110, 95 + dist * 8)));
  }
  if (weapon === 'ARTILLERY') {
    // Base heavy machine gun: fast tracer travel per round, burst runs ~340ms
    return Math.round(Math.min(195, Math.max(115, 95 + dist * 12)));
  }
  if (weapon === 'ASSAULTER') {
    // Breacher heavy tank blast missile
    return Math.round(Math.min(285, Math.max(170, 145 + dist * 18)));
  }
  if (weapon === 'SIEGE' || style === 'MISSILE') {
    return Math.round(Math.min(310, Math.max(195, 160 + dist * 18)));
  }
  if (weapon === 'SOLDIER') {
    // Scout crisp 9mm pistol round
    return Math.round(Math.min(190, Math.max(110, 95 + dist * 13)));
  }
  return Math.round(Math.min(240, Math.max(135, 115 + dist * 16)));
};

export const projectileColorFor = (style: ProjectileVisualStyle, weapon?: WeaponVisual): number => {
  if (weapon === 'SNIPER') return 0xF43F5E;
  if (weapon === 'ASSAULTER') return 0xF59E0B;
  if (weapon === 'TURRET') return 0xFDE047;
  if (weapon === 'ARTILLERY' || weapon === 'SIEGE') return 0xFB923C;
  if (style === 'LASER') return 0xEF4444;
  if (style === 'MISSILE') return 0xFFA500;
  return 0xFDE047;
};

/** Reads live `prefers-reduced-motion` safely in browser or Node environments. */
export const getPrefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Subscribes to live OS reduced-motion preference toggles. */
export const subscribeReducedMotion = (listener: (reduced: boolean) => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => listener(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  } catch {
    return () => {};
  }
};

const tileKey = (p: TilePoint) => `${p.x},${p.y}`;
const smoothstep = (t: number) => t * t * (3 - 2 * t);

const easeSegment = (t: number, segIdx: number, totalSegments: number): number => {
  if (totalSegments <= 1) return smoothstep(t);
  if (segIdx === 0) return 0.35 * t + 0.65 * (t * t);
  if (segIdx === totalSegments - 1) return 1 - 0.65 * (1 - t) * (1 - t) - 0.35 * (1 - t);
  return 0.65 * t + 0.35 * smoothstep(t);
};

export class FxTimeline {
  private clockMs = 0;
  private lastCombatDtMs = 16.67;
  private traumaTimeMs = 0;
  private trauma = 0;
  private hitStopMs = 0;
  private nextCueId = 1;
  private nextFxSeq = 1;
  private cues: ScheduledCue[] = [];
  private unitImpulses = new Map<string, InternalUnitImpulse>();
  private unitMoveTracks = new Map<string, InternalMoveTrack>();
  private baseTurrets = new Map<string, InternalBaseTurret>();
  private activeVisualCount = 0;
  private allowImmediateZeroCues = false;
  private sink: TimelineSink = {};
  private activeListeners = new Set<(active: boolean) => void>();
  private lastNotifiedActive = false;

  public configure(sink: Partial<TimelineSink>): void {
    this.sink = { ...this.sink, ...sink };
  }

  public getClockMs(): number {
    return this.clockMs;
  }

  public getLastCombatDtMs(): number {
    return this.lastCombatDtMs;
  }

  public getTrauma(): number {
    return this.trauma;
  }

  public getHitStopMs(): number {
    return this.hitStopMs;
  }

  public getPendingCueCount(): number {
    return this.cues.length;
  }

  public hasActiveMove(unitId: string): boolean {
    return this.unitMoveTracks.has(unitId);
  }

  public hasActiveBaseTurret(): boolean {
    return this.baseTurrets.size > 0;
  }

  /** Slews a Base's rotating turret smoothly toward `aimAngle` without firing (pre-aim between targets). */
  public aimBaseTurret(tileX: number, tileY: number, aimAngle: number, holdMs = 350): void {
    const key = `${tileX},${tileY}`;
    this.baseTurrets.set(key, {
      aimAngle,
      elapsedMs: 0,
      burstDurationMs: 0,
      holdDurationMs: Math.max(120, holdMs),
      roundIntervalMs: 56,
    });
    this.sink.onWake?.(holdMs + 120);
    this.notifyActiveIfChanged();
  }

  /** Engages a Base's rotating heavy machine gun turret toward `aimAngle` with rapid alternating recoil. */
  public triggerBaseTurretFire(
    tileX: number,
    tileY: number,
    aimAngle: number,
    burstDurationMs = 340,
    roundIntervalMs = 56,
  ): void {
    const key = `${tileX},${tileY}`;
    this.baseTurrets.set(key, {
      aimAngle,
      elapsedMs: 0,
      burstDurationMs,
      holdDurationMs: burstDurationMs + 520,
      roundIntervalMs,
    });
    this.sink.onWake?.(burstDurationMs + 560);
    this.notifyActiveIfChanged();
  }

  /** Samples live aim heading, left/right barrel kickback, and active flash side for a Base turret. */
  public getBaseTurretState(tileX: number, tileY: number): BaseTurretSample | null {
    const st = this.baseTurrets.get(`${tileX},${tileY}`);
    if (!st) return null;
    if (st.elapsedMs >= st.burstDurationMs) {
      return { aimAngle: st.aimAngle, recoilLeft: 0, recoilRight: 0, firingSide: 0 };
    }
    const roundIdx = Math.floor(st.elapsedMs / st.roundIntervalMs);
    const localMs = st.elapsedMs - roundIdx * st.roundIntervalMs;
    const kick = Math.max(0, 1 - localMs / st.roundIntervalMs);
    const isLeft = roundIdx % 2 === 0;
    const flashOn = localMs < 24;
    return {
      aimAngle: st.aimAngle,
      recoilLeft: isLeft ? kick : 0,
      recoilRight: isLeft ? 0 : kick,
      firingSide: flashOn ? (isLeft ? -1 : 1) : 0,
    };
  }

  public isActive(): boolean {
    return (
      this.cues.length > 0 ||
      this.trauma > 0.001 ||
      this.hitStopMs > 0 ||
      this.unitImpulses.size > 0 ||
      this.unitMoveTracks.size > 0 ||
      this.baseTurrets.size > 0 ||
      this.activeVisualCount > 0 ||
      Boolean(this.sink.hasActiveParticles?.())
    );
  }

  public subscribeActive(listener: (active: boolean) => void): () => void {
    this.activeListeners.add(listener);
    return () => {
      this.activeListeners.delete(listener);
    };
  }

  private notifyActiveIfChanged(): void {
    const active = this.isActive();
    if (active !== this.lastNotifiedActive) {
      this.lastNotifiedActive = active;
      this.activeListeners.forEach(fn => fn(active));
    }
  }

  /** Schedule a callback after `delayMs` of timeline combat time (pauses during hit-stop). */
  public schedule(delayMs: number, callback: () => void, tag?: string): number {
    const safeDelay = Math.max(0, delayMs);
    if (safeDelay === 0 && (this.hitStopMs <= 0 || this.allowImmediateZeroCues)) {
      callback();
      this.notifyActiveIfChanged();
      return 0;
    }
    const id = this.nextCueId++;
    const fireAtMs = this.clockMs + safeDelay;
    this.cues.push({ id, fireAtMs, callback, tag });
    if (this.cues.length > 1 && this.cues[this.cues.length - 2].fireAtMs > fireAtMs) {
      this.cues.sort((a, b) => a.fireAtMs - b.fireAtMs || a.id - b.id);
    }
    this.notifyActiveIfChanged();
    return id;
  }

  /** Trigger a brief combat-time hit-stop (camera trauma keeps vibrating for crunchy impact). */
  public triggerHitStop(durationMs: number): void {
    const clamped = Math.min(75, Math.max(0, durationMs));
    if (clamped > this.hitStopMs) {
      this.hitStopMs = clamped;
      this.notifyActiveIfChanged();
    }
  }

  /** Add camera trauma from a legacy intensity scale (4..18) or direct normalized amount. */
  public addTraumaFromIntensity(intensity: number): void {
    if (!Number.isFinite(intensity) || intensity <= 0) return;
    const normalized = Math.min(1, intensity / 16);
    this.addTrauma(normalized);
  }

  public addTrauma(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.trauma = Math.min(1, Math.max(this.trauma, amount) + Math.min(this.trauma, amount) * 0.35);
    this.sink.onWake?.(550);
    this.notifyActiveIfChanged();
  }

  /**
   * Computes exact zero-drift world-space shake offset for `<WorldShakeContainer>`.
   * Always returns `{ x: 0, y: 0 }` when settled or when `reducedMotion` is enabled.
   */
  public getShakeOffset(viewportScale = 1, reducedMotion = false): ShakeOffset {
    if (reducedMotion || this.trauma <= 0.001) {
      return { x: 0, y: 0 };
    }
    const shake = this.trauma * this.trauma;
    const safeScale = Math.max(0.45, Math.min(2.2, Number.isFinite(viewportScale) && viewportScale > 0 ? viewportScale : 1));
    const amp = (MAX_SHAKE_SCREEN_PX * shake) / safeScale;
    const t = this.traumaTimeMs;
    const ox = Math.sin(t * 0.068) * 0.65 + Math.sin(t * 0.143 + 1.1) * 0.35;
    const oy = Math.cos(t * 0.079 + 0.7) * 0.65 + Math.sin(t * 0.131 + 2.4) * 0.35;
    return { x: ox * amp, y: oy * amp };
  }

  /** Starts a tile-by-tile path march for a unit (replaces any prior active march for that unit). */
  public startUnitMove(
    unitId: string,
    path: TilePoint[],
    options?: { pauseAtSegIdx?: number; pauseDurationMs?: number },
  ): number {
    if (!unitId || path.length < 2) return 0;
    const totalMoveMs = computeMarchDurationMs(path.length - 1);
    const pauseAtSegIdx =
      options?.pauseAtSegIdx !== undefined &&
      options.pauseAtSegIdx >= 1 &&
      options.pauseAtSegIdx < path.length - 1 &&
      (options.pauseDurationMs ?? 0) > 0
        ? options.pauseAtSegIdx
        : null;
    const pauseDurationMs = pauseAtSegIdx !== null ? Math.min(240, Math.max(0, options?.pauseDurationMs ?? 0)) : 0;

    this.unitMoveTracks.set(unitId, {
      path,
      walkElapsedMs: 0,
      totalMoveMs,
      lastSteppedIdx: 0,
      pauseAtSegIdx,
      pauseDurationMs,
      pauseElapsedMs: 0,
      isPaused: false,
    });

    // Subtle push-off footstep at origin tile
    const startPt = path[0];
    const nextPt = path[1];
    this.emitFootstepAt(startPt, Math.atan2(nextPt.y - startPt.y, nextPt.x - startPt.x), 0.75);

    const totalMs = totalMoveMs + pauseDurationMs;
    this.sink.onWake?.(totalMs + 220);
    this.notifyActiveIfChanged();
    return totalMs;
  }

  private emitFootstepAt(tile: TilePoint, angle: number, scaleMult = 1): void {
    const terrain = this.sink.getTileTerrain?.(tile.x, tile.y);
    const spec = terrainFootstepPreset(terrain);
    const center = tileCenterPx(tile);
    this.sink.emitParticles?.({
      preset: spec.preset,
      x: center.x,
      y: center.y + 4,
      angle,
      color: spec.color,
      scale: (spec.scale ?? 1) * scaleMult,
    });
  }

  /** Samples the current interpolated tile-by-tile pose for a marching unit. */
  public getUnitMovePose(unitId: string, reducedMotion = false): UnitMovePose | null {
    const track = this.unitMoveTracks.get(unitId);
    if (!track || track.path.length < 2) return null;

    const segments = track.path.length - 1;
    const progress = Math.min(1, Math.max(0, track.walkElapsedMs / track.totalMoveMs));
    const scaled = progress * segments;
    const segIdx = Math.min(segments - 1, Math.floor(scaled));
    const localT = Math.min(1, Math.max(0, scaled - segIdx));
    const easedT = easeSegment(localT, segIdx, segments);

    const a = track.path[segIdx];
    const b = track.path[segIdx + 1];
    const x = (a.x + (b.x - a.x) * easedT) * TILE_SIZE;
    const y = (a.y + (b.y - a.y) * easedT) * TILE_SIZE;
    const facingRad = Math.atan2(b.y - a.y, b.x - a.x);

    const strideBobPx = reducedMotion || track.isPaused ? 0 : Math.abs(Math.sin(localT * Math.PI)) * 4.5;
    const bobFrac = strideBobPx / 4.5;

    return {
      x,
      y,
      facingRad,
      strideBobPx,
      scaleX: reducedMotion ? 1 : 1 + 0.055 * bobFrac,
      scaleY: reducedMotion ? 1 : 1 - 0.045 * bobFrac,
      progress,
    };
  }

  /** Trigger damped recoil/knockback and/or single-pulse hit flash on a unit sprite. */
  public triggerUnitImpulse(unitId: string, input: UnitImpulseInput): void {
    if (!unitId) return;
    const durationMs = Math.max(80, input.durationMs ?? 190);
    const flashMs = Math.max(0, Math.min(140, input.flashMs ?? 0));
    this.unitImpulses.set(unitId, {
      recoilX: input.recoilX ?? 0,
      recoilY: input.recoilY ?? 0,
      elapsedMs: 0,
      durationMs,
      flashColor: input.flashColor ?? 0xFFFFFF,
      flashMs,
    });
    this.sink.onWake?.(durationMs + 80);
    this.notifyActiveIfChanged();
  }

  public getUnitImpulse(unitId: string): UnitImpulseSample | null {
    const imp = this.unitImpulses.get(unitId);
    if (!imp) return null;
    const p = Math.min(1, imp.elapsedMs / imp.durationMs);
    const kick = Math.sin(Math.min(1, p * 1.15) * Math.PI) * Math.pow(1 - p, 1.35);
    const flashAlpha =
      imp.flashMs > 0 && imp.elapsedMs < imp.flashMs
        ? Math.max(0, 1 - imp.elapsedMs / imp.flashMs)
        : 0;
    return {
      offsetX: imp.recoilX * kick,
      offsetY: imp.recoilY * kick,
      flashColor: imp.flashColor,
      flashAlpha,
    };
  }

  /**
   * Advances timeline by one clamped frame (`dtMs <= 33.33ms`).
   * Returns `{ dtMs, combatDtMs }` so particle systems can respect hit-stop cleanly.
   */
  public step(rawDeltaMs: number): { dtMs: number; combatDtMs: number } {
    const dtMs = Math.min(MAX_TIMELINE_STEP_MS, Math.max(0, Number.isFinite(rawDeltaMs) ? rawDeltaMs : 0));
    if (dtMs <= 0) {
      this.lastCombatDtMs = 0;
      this.notifyActiveIfChanged();
      return { dtMs: 0, combatDtMs: 0 };
    }

    // Trauma always runs even during hit-stop so impacts feel snappy rather than frozen dead
    if (this.trauma > 0) {
      this.traumaTimeMs += dtMs;
      this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY_PER_SEC * (dtMs / 1000));
      if (this.trauma <= 0.001) {
        this.trauma = 0;
        this.traumaTimeMs = 0;
      }
    }

    if (this.hitStopMs > 0) {
      this.hitStopMs = Math.max(0, this.hitStopMs - dtMs);
      this.lastCombatDtMs = 0;
      this.notifyActiveIfChanged();
      return { dtMs, combatDtMs: 0 };
    }

    this.lastCombatDtMs = dtMs;
    this.clockMs += dtMs;

    // Advance active tile-by-tile unit marches & trigger terrain footsteps on tile crossings
    if (this.unitMoveTracks.size > 0) {
      for (const [uid, track] of this.unitMoveTracks) {
        const segments = track.path.length - 1;
        const segMs = track.totalMoveMs / segments;

        if (track.pauseAtSegIdx !== null) {
          const pauseWalkMs = track.pauseAtSegIdx * segMs;
          if (track.isPaused) {
            track.pauseElapsedMs += dtMs;
            if (track.pauseElapsedMs >= track.pauseDurationMs) {
              const leftover = track.pauseElapsedMs - track.pauseDurationMs;
              track.isPaused = false;
              track.pauseAtSegIdx = null;
              track.walkElapsedMs += leftover;
            }
          } else if (track.walkElapsedMs + dtMs >= pauseWalkMs) {
            const toPause = Math.max(0, pauseWalkMs - track.walkElapsedMs);
            track.walkElapsedMs = pauseWalkMs;
            track.isPaused = true;
            track.pauseElapsedMs = Math.max(0, dtMs - toPause);
          } else {
            track.walkElapsedMs += dtMs;
          }
        } else {
          track.walkElapsedMs += dtMs;
        }

        // Emit footsteps for every tile entered since last tick
        const reachedIdx = Math.min(segments, Math.floor((track.walkElapsedMs / track.totalMoveMs) * segments + 0.001));
        while (track.lastSteppedIdx < reachedIdx) {
          track.lastSteppedIdx++;
          const prevPt = track.path[track.lastSteppedIdx - 1];
          const curPt = track.path[track.lastSteppedIdx];
          this.emitFootstepAt(curPt, Math.atan2(curPt.y - prevPt.y, curPt.x - prevPt.x), 1);
        }

        if (!track.isPaused && track.walkElapsedMs >= track.totalMoveMs) {
          this.unitMoveTracks.delete(uid);
        }
      }
    }

    // Drain all cues whose fire time has elapsed (guard against infinite self-scheduling)
    let guard = 0;
    while (this.cues.length > 0 && this.cues[0].fireAtMs <= this.clockMs && guard < 128) {
      const cue = this.cues.shift()!;
      guard++;
      cue.callback();
    }

    // Advance unit impulses
    if (this.unitImpulses.size > 0) {
      for (const [uid, imp] of this.unitImpulses) {
        imp.elapsedMs += dtMs;
        if (imp.elapsedMs >= imp.durationMs && imp.elapsedMs >= imp.flashMs) {
          this.unitImpulses.delete(uid);
        }
      }
    }

    // Advance rotating Base machine gun turrets
    if (this.baseTurrets.size > 0) {
      for (const [key, turret] of this.baseTurrets) {
        turret.elapsedMs += dtMs;
        if (turret.elapsedMs >= turret.holdDurationMs) {
          this.baseTurrets.delete(key);
        }
      }
    }

    this.notifyActiveIfChanged();
    return { dtMs, combatDtMs: dtMs };
  }

  /** Clears all pending cues, move tracks, trauma, impulses, turrets, and active transient visuals. */
  public clear(): void {
    this.cues = [];
    this.trauma = 0;
    this.traumaTimeMs = 0;
    this.hitStopMs = 0;
    this.unitImpulses.clear();
    this.unitMoveTracks.clear();
    this.baseTurrets.clear();
    this.activeVisualCount = 0;
    this.sink.onClearVisuals?.();
    this.notifyActiveIfChanged();
  }

  /**
   * Translates a declarative engine `GameEvent[]` batch into a synchronized visual/audio timeline:
   * - Compound MOVE -> OVERWATCH -> MINE choreography aligned to tile arrival times
   * - Weapon-specific muzzle/burst/arc launches at `startMs`
   * - Synced impact SFX, sparks, knockback, single-pulse flash, hit-stop, trauma & popups at `impactMs`
   * - Non-blocking visual HP deferral and pending-death presence until lethal blow lands
   */
  public dispatchGameEvents(events: GameEvent[]): void {
    if (!events || events.length === 0) return;

    const prevAllowImmediate = this.allowImmediateZeroCues;
    if (this.hitStopMs <= 0) {
      this.allowImmediateZeroCues = true;
    }
    try {
      this.dispatchGameEventsInner(events);
    } finally {
      this.allowImmediateZeroCues = prevAllowImmediate;
    }
  }

  private dispatchGameEventsInner(events: GameEvent[]): void {

    interface PlannedProjectile {
      event: Extract<GameEvent, { kind: 'projectile' }>;
      startMs: number;
      travelMs: number;
      impactMs: number;
      burstRounds: number;
      roundIntervalMs: number;
      burstDurationMs: number;
      slewStartMs: number | null;
    }

    const projectileImpactByTile = new Map<string, number>();
    const projectileStartByTile = new Map<string, number>();
    const impactByVictimId = new Map<string, number>();
    let firstProjectileImpactMs = 0;
    let maxWakeMs = 0;
    const noteWake = (ms: number) => {
      if (ms > maxWakeMs) maxWakeMs = ms;
    };

    // Pass 0: inspect compound MOVE path so Overwatch shots & Land Mines synchronize with tile arrival
    const moveEvt = events.find((e): e is Extract<GameEvent, { kind: 'movePath' }> => e.kind === 'movePath' && e.path.length >= 2);
    const moveSegments = moveEvt ? moveEvt.path.length - 1 : 0;
    const moveBaseMs = moveEvt ? computeMarchDurationMs(moveSegments) : 0;
    const moveSegMs = moveSegments > 0 ? moveBaseMs / moveSegments : 0;

    const findStepIndex = (target: TilePoint): number => {
      if (!moveEvt) return -1;
      for (let i = 1; i < moveEvt.path.length; i++) {
        if (moveEvt.path[i].x === target.x && moveEvt.path[i].y === target.y) return i;
      }
      if (moveEvt.path[0].x === target.x && moveEvt.path[0].y === target.y) return 0;
      return -1;
    };

    let overwatchPauseSegIdx: number | undefined;
    let overwatchPauseMs = 0;
    let overwatchInterceptIdx = -1;

    // Count how many shots each origin fires in this batch (e.g., HQ multi-target defense sweep)
    const originProjectileCount = new Map<string, number>();
    for (const e of events) {
      if (e.kind === 'projectile') {
        const ok = tileKey(e.from);
        originProjectileCount.set(ok, (originProjectileCount.get(ok) ?? 0) + 1);
      }
    }

    // Pass 1: plan projectile launch, turret slewing, & arrival timings sequentially when multiple shots fire
    const plannedList: PlannedProjectile[] = [];
    const projectilePlans = new Map<GameEvent, PlannedProjectile>();
    const lastPlanByOrigin = new Map<string, PlannedProjectile>();

    for (const e of events) {
      if (e.kind !== 'projectile') continue;
      const travelMs = e.travelMs ?? estimateProjectileTravelMs(e.from, e.to, e.style, e.weapon);
      const originKey = tileKey(e.from);
      const originCount = originProjectileCount.get(originKey) ?? 1;
      const isBaseMg = e.weapon === 'ARTILLERY';
      const isMultiFromBase = isBaseMg && originCount >= 2;
      const burstRounds = isBaseMg ? (isMultiFromBase ? 4 : 6) : 1;
      const roundIntervalMs = isBaseMg ? (isMultiFromBase ? 54 : 56) : 0;
      const burstDurationMs = isBaseMg ? burstRounds * roundIntervalMs : 0;

      let startMs = Math.max(0, e.delayMs ?? 0);
      let slewStartMs: number | null = null;

      if (e.delayMs === undefined && moveEvt && (!e.targetUnitId || e.targetUnitId === moveEvt.unitId)) {
        const idx = findStepIndex(e.to);
        if (idx >= 1) {
          const arriveMs = Math.round(idx * moveSegMs);
          startMs = Math.max(0, arriveMs - Math.round(travelMs * 0.55));
          const computedImpact = startMs + travelMs;
          overwatchInterceptIdx = idx;
          if (idx < moveSegments && computedImpact > arriveMs) {
            overwatchPauseSegIdx = idx;
            overwatchPauseMs = computedImpact - arriveMs;
          }
        }
      } else if (e.delayMs === undefined && plannedList.length > 0) {
        // Sequence automated defense shots one after another (e.g. Bank Turret -> HQ Target 1 -> HQ Target 2 -> Target 3)
        const prev = plannedList[plannedList.length - 1];
        const prevOriginCount = originProjectileCount.get(tileKey(prev.event.from)) ?? 1;
        const prevStride =
          prev.event.weapon === 'ARTILLERY'
            ? prevOriginCount >= 4
              ? 330
              : prevOriginCount >= 3
                ? 360
                : 385
            : Math.max(230, prev.travelMs + 95);
        startMs = prev.startMs + prevStride;

        // If the same Base HQ turret is sweeping from a previous target, pre-slew barrels ~115ms before firing!
        const prevFromSameOrigin = lastPlanByOrigin.get(originKey);
        if (isBaseMg && prevFromSameOrigin) {
          slewStartMs = Math.max(
            prevFromSameOrigin.startMs + prevFromSameOrigin.burstDurationMs + 8,
            startMs - 115,
          );
        }
      }

      const impactMs = startMs + travelMs;
      const plan: PlannedProjectile = {
        event: e,
        startMs,
        travelMs,
        impactMs,
        burstRounds,
        roundIntervalMs,
        burstDurationMs,
        slewStartMs,
      };
      plannedList.push(plan);
      projectilePlans.set(e, plan);
      lastPlanByOrigin.set(originKey, plan);

      const key = tileKey(e.to);
      const prevImpact = projectileImpactByTile.get(key);
      if (prevImpact === undefined || impactMs < prevImpact) {
        projectileImpactByTile.set(key, impactMs);
        projectileStartByTile.set(key, startMs);
      }
      if (e.targetUnitId) {
        const prevVictim = impactByVictimId.get(e.targetUnitId);
        if (prevVictim === undefined || impactMs > prevVictim) {
          impactByVictimId.set(e.targetUnitId, impactMs);
        }
      }
      if (firstProjectileImpactMs === 0 || impactMs < firstProjectileImpactMs) {
        firstProjectileImpactMs = impactMs;
      }
    }

    // Plan Land Mine detonation times along move path
    const mineDelayByEvent = new Map<GameEvent, number>();
    let firstMineDelayMs: number | null = null;
    for (const e of events) {
      if (e.kind !== 'mineBlast') continue;
      let delay = Math.max(0, e.delayMs ?? 0);
      if (e.delayMs === undefined && moveEvt && (!e.victimUnitId || e.victimUnitId === moveEvt.unitId)) {
        const idx = findStepIndex(e.at);
        if (idx >= 1) {
          const extraPause = overwatchInterceptIdx >= 1 && idx > overwatchInterceptIdx ? overwatchPauseMs : 0;
          delay = Math.round(idx * moveSegMs) + extraPause;
        }
      }
      mineDelayByEvent.set(e, delay);
      if (firstMineDelayMs === null || delay < firstMineDelayMs) {
        firstMineDelayMs = delay;
      }
      if (e.victimUnitId) {
        const prevVictim = impactByVictimId.get(e.victimUnitId);
        if (prevVictim === undefined || delay > prevVictim) {
          impactByVictimId.set(e.victimUnitId, delay);
        }
      }
    }

    const hasMineBlast = mineDelayByEvent.size > 0;
    const hasDestroyedStructure = events.some(e => e.kind === 'structureHit' && e.destroyed);
    const hasProjectile = projectilePlans.size > 0;
    const healEvt = events.find((e): e is Extract<GameEvent, { kind: 'heal' }> => e.kind === 'heal');
    const hasOverwatchSet = events.some(e => e.kind === 'overwatchSet');
    const hasBuild = events.some(e => e.kind === 'build');
    const hasMoveSound = events.some(e => e.kind === 'sound' && e.sound === 'move');
    let minePopupCount = 0;
    let fireSoundCursor = 0;
    let hitSoundCursor = 0;
    let activePlan: PlannedProjectile | null = null;

    const matchingPlanForTile = (at: TilePoint, unitId?: string): PlannedProjectile | null => {
      if (activePlan) {
        if (unitId && activePlan.event.targetUnitId === unitId) return activePlan;
        if (activePlan.event.to.x === at.x && activePlan.event.to.y === at.y) return activePlan;
      }
      return null;
    };

    // Start unit path marching immediately so UnitSprite glides tile-by-tile
    if (moveEvt) {
      const totalMarch = this.startUnitMove(moveEvt.unitId, moveEvt.path, {
        pauseAtSegIdx: overwatchPauseSegIdx,
        pauseDurationMs: overwatchPauseMs,
      });
      // Play footsteps or heavy tank treads even when Overwatch/Mine interrupted the move (no `sound('move')`)
      if (!hasMoveSound) {
        const terrain = this.sink.getTileTerrain?.(moveEvt.path[1].x, moveEvt.path[1].y);
        this.schedule(0, () => {
          this.sink.playUnitMove?.(moveEvt.unitType, moveBaseMs, terrain);
        }, 'move-ambush-foley');
      }
      noteWake(totalMarch + 280);
    }

    // Pass 2: schedule each cue in synchronized order (pairing each shot's sound/hit/popup/shake/kill 1-to-1)
    for (const e of events) {
      switch (e.kind) {
        case 'sound': {
          let delay = e.delayMs ?? 0;
          let matchedPlan: PlannedProjectile | undefined;

          if ((e.sound === 'attack' || e.sound === 'sniper') && hasProjectile) {
            matchedPlan = plannedList[Math.min(fireSoundCursor, plannedList.length - 1)];
            fireSoundCursor++;
            if (e.delayMs === undefined && matchedPlan) delay = matchedPlan.startMs;
          } else if (e.sound === 'hit' && hasProjectile) {
            matchedPlan = plannedList[Math.min(hitSoundCursor, plannedList.length - 1)];
            hitSoundCursor++;
            if (e.delayMs === undefined && matchedPlan) delay = matchedPlan.impactMs;
          } else if (e.delayMs === undefined && e.sound === 'explosion') {
            if (hasMineBlast && firstMineDelayMs !== null) {
              delay = firstMineDelayMs;
            } else if (hasDestroyedStructure && hasProjectile) {
              delay = firstProjectileImpactMs;
            }
          }

          const soundWeapon = matchedPlan?.event.weapon;
          const soundBurstRounds = matchedPlan?.burstRounds;

          this.schedule(
            delay,
            () => {
              if (e.sound === 'move' && moveEvt && this.sink.playUnitMove) {
                const terrain = this.sink.getTileTerrain?.(moveEvt.path[1].x, moveEvt.path[1].y);
                this.sink.playUnitMove(moveEvt.unitType, moveBaseMs, terrain);
                return;
              }
              if ((e.sound === 'attack' || e.sound === 'sniper') && soundWeapon && this.sink.playWeaponFire) {
                this.sink.playWeaponFire(soundWeapon, soundBurstRounds);
                return;
              }
              if (e.sound === 'hit' && soundWeapon && this.sink.playWeaponImpact) {
                this.sink.playWeaponImpact(soundWeapon, soundBurstRounds);
                return;
              }
              if (e.sound === 'click' && this.sink.playTacticalFoley) {
                if (hasOverwatchSet) {
                  this.sink.playTacticalFoley('overwatch');
                  return;
                }
                if (healEvt && (healEvt.item === 'RELOAD' || healEvt.item === 'AMMO')) {
                  this.sink.playTacticalFoley('reload');
                  return;
                }
              }
              if (e.sound === 'capture' && this.sink.playTacticalFoley) {
                if (healEvt && (healEvt.item === 'MEDKIT' || healEvt.item === 'FIRST_AID')) {
                  this.sink.playTacticalFoley('heal');
                  return;
                }
                if (hasBuild) {
                  this.sink.playTacticalFoley('build');
                  return;
                }
              }
              this.sink.playSound?.(e.sound);
            },
            'sound',
          );
          noteWake(delay + 120);
          break;
        }

        case 'projectile': {
          const plan = projectilePlans.get(e)!;
          activePlan = plan;
          const fromPx = tileCenterPx(e.from);
          const toPx = tileCenterPx(e.to);
          const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
          const id = `proj_${this.nextFxSeq++}`;
          const color = projectileColorFor(e.style, e.weapon);
          const isBaseMg = e.weapon === 'ARTILLERY';
          const isTankCannon = e.weapon === 'ASSAULTER';

          const emitMuzzle = (scaleMult = 1, sideOffset = 0) => {
            const px = -Math.sin(angle) * sideOffset;
            const py = Math.cos(angle) * sideOffset;
            const barrelDist = isBaseMg ? 24 : isTankCannon ? 20 : 14;
            this.sink.emitParticles?.({
              preset: 'muzzleFlash',
              x: fromPx.x + Math.cos(angle) * barrelDist + px,
              y: fromPx.y + Math.sin(angle) * barrelDist + py,
              angle,
              color,
              scale: (isTankCannon ? 1.55 : e.style === 'MISSILE' ? 1.25 : 1) * scaleMult,
            });
          };

          // Multi-target HQ sweep: visibly slew the rotating MG turret onto the next target before opening fire!
          if (isBaseMg && plan.slewStartMs !== null) {
            const slewHold = Math.max(150, plan.startMs - plan.slewStartMs + 60);
            this.schedule(
              plan.slewStartMs,
              () => {
                this.aimBaseTurret(e.from.x, e.from.y, angle, slewHold);
                this.sink.playTurretSwivel?.();
              },
              'base-mg-slew',
            );
          }

          this.schedule(
            plan.startMs,
            () => {
              this.activeVisualCount++;
              emitMuzzle(1, isBaseMg ? -4 : 0);

              if (isTankCannon) {
                this.sink.emitParticles?.({
                  preset: 'dustPuff',
                  x: fromPx.x + Math.cos(angle) * 14,
                  y: fromPx.y + Math.sin(angle) * 14,
                  angle: angle + Math.PI,
                  color: 0x94A3B8,
                  scale: 1.2,
                });
                this.addTrauma(0.16);
              }

              if (isBaseMg) {
                this.triggerBaseTurretFire(
                  e.from.x,
                  e.from.y,
                  angle,
                  plan.burstDurationMs,
                  plan.roundIntervalMs,
                );
              }

              if (e.attackerId) {
                const kick = e.weapon === 'SNIPER' ? 7 : isTankCannon ? 8 : 3.8;
                this.triggerUnitImpulse(e.attackerId, {
                  recoilX: -Math.cos(angle) * kick,
                  recoilY: -Math.sin(angle) * kick,
                  durationMs: isTankCannon ? 220 : 150,
                });
              }
              this.sink.spawnProjectile?.({
                id,
                startX: fromPx.x,
                startY: fromPx.y,
                endX: toPx.x,
                endY: toPx.y,
                type: e.style,
                weapon: e.weapon,
                color,
                travelMs: plan.travelMs,
                ...(isBaseMg ? { burstRounds: plan.burstRounds } : {}),
              });
            },
            'projectile-launch',
          );

          // Base Defense: rapid alternating twin-barrel heavy machine gun muzzle flashes & sparks
          if (isBaseMg) {
            for (let r = 1; r < plan.burstRounds; r++) {
              const side = r % 2 === 0 ? -4 : 4;
              this.schedule(
                plan.startMs + r * plan.roundIntervalMs,
                () => emitMuzzle(0.75, side),
                `base-mg-round-${r}`,
              );
            }
            const extraSparks = Math.max(1, plan.burstRounds - 2);
            for (let r = 1; r <= extraSparks; r++) {
              this.schedule(
                plan.impactMs + r * 62,
                () => {
                  this.sink.emitParticles?.({
                    preset: 'impactSparks',
                    x: toPx.x + (Math.random() - 0.5) * 14,
                    y: toPx.y + (Math.random() - 0.5) * 14,
                    angle: angle + Math.PI,
                    color: 0xFDE047,
                    scale: 0.72,
                  });
                },
                `base-mg-hit-${r}`,
              );
            }
          }

          const afterglowMs =
            e.weapon === 'SNIPER'
              ? 185
              : isBaseMg
                ? Math.max(180, plan.burstDurationMs)
                : e.style === 'LASER'
                  ? 110
                  : 55;
          const cleanupMs = plan.impactMs + afterglowMs;
          this.schedule(
            cleanupMs,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeProjectile?.(id);
            },
            'projectile-cleanup',
          );

          const hasExplicitImpact = events.some(
            other =>
              (other.kind === 'hit' || other.kind === 'structureHit') &&
              other.at.x === e.to.x &&
              other.at.y === e.to.y,
          );
          if (!hasExplicitImpact) {
            this.schedule(
              plan.impactMs,
              () => {
                this.sink.emitParticles?.({
                  preset: isTankCannon ? 'explosion' : 'impactSparks',
                  x: toPx.x,
                  y: toPx.y,
                  angle: angle + Math.PI,
                  color,
                });
              },
              'projectile-fallback-impact',
            );
          }

          noteWake(cleanupMs + 260);
          break;
        }

        case 'hit': {
          const paired = matchingPlanForTile(e.at, e.targetUnitId);
          const delay = e.delayMs ?? paired?.impactMs ?? projectileImpactByTile.get(tileKey(e.at)) ?? 0;
          const lockStartMs = paired?.startMs ?? projectileStartByTile.get(tileKey(e.at)) ?? 0;
          const atPx = tileCenterPx(e.at);
          const fromPx = e.from ? tileCenterPx(e.from) : null;
          const incomingAngle = fromPx ? Math.atan2(atPx.y - fromPx.y, atPx.x - fromPx.x) : 0;
          const isTankBlast = e.weapon === 'ASSAULTER';
          const blastScorchId = isTankBlast ? `tfx_${this.nextFxSeq++}` : null;

          // Crossfire tactical lock sightlines from supporting allies
          if (e.crossfireFrom && e.crossfireFrom.length > 0) {
            const lockId = `xfire_${this.nextFxSeq++}`;
            const supporters = e.crossfireFrom.map(tileCenterPx);
            const lockDurationMs = Math.max(180, delay - lockStartMs + 165);
            this.schedule(
              lockStartMs,
              () => {
                this.activeVisualCount++;
                this.sink.spawnCrossfire?.({
                  id: lockId,
                  supporters,
                  targetX: atPx.x,
                  targetY: atPx.y,
                  durationMs: lockDurationMs,
                });
              },
              'crossfire-lock',
            );
            this.schedule(
              lockStartMs + lockDurationMs,
              () => {
                this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
                this.sink.removeCrossfire?.(lockId);
              },
              'crossfire-cleanup',
            );
            noteWake(lockStartMs + lockDurationMs + 80);
          }

          // Non-blocking visual HP deferral so target HP bar drops right as the shot lands
          if (e.targetUnitId && !e.isKill && e.damage > 0 && delay > 0) {
            const tid = e.targetUnitId;
            const dmg = e.damage;
            this.sink.addDeferredHp?.(tid, dmg);
            this.schedule(delay, () => this.sink.clearDeferredHp?.(tid, dmg), 'deferred-hp-release');
          }

          this.schedule(
            delay,
            () => {
              const color = e.weapon === 'SNIPER' ? 0xFB7185 : e.isCrit || isTankBlast ? 0xF59E0B : 0xFDE047;
              if (isTankBlast) {
                // Breacher heavy tank blast shell erupts in a full fiery explosion + crater scorch
                this.sink.emitParticles?.({
                  preset: 'explosion',
                  x: atPx.x,
                  y: atPx.y,
                  scale: e.isKill ? 1.25 : 0.96,
                });
                this.sink.emitParticles?.({
                  preset: 'shockwaveRing',
                  x: atPx.x,
                  y: atPx.y,
                  color: 0xF97316,
                  scale: e.isKill ? 1.35 : 1.08,
                });
                if (blastScorchId) {
                  this.activeVisualCount++;
                  this.sink.spawnTileEffect?.({
                    id: blastScorchId,
                    kind: 'scorch',
                    x: e.at.x * TILE_SIZE,
                    y: e.at.y * TILE_SIZE,
                    color: 0xF97316,
                    durationMs: 1350,
                    scale: 0.95,
                  });
                }
                this.addTrauma(0.45);
              } else {
                this.sink.emitParticles?.({
                  preset: 'impactSparks',
                  x: atPx.x,
                  y: atPx.y,
                  angle: incomingAngle + Math.PI,
                  color,
                  scale: e.isKill ? 1.35 : e.isCrit ? 1.18 : 1,
                });
                if (e.weapon === 'SNIPER' || e.isKill || e.isCrit) {
                  this.sink.emitParticles?.({
                    preset: 'shockwaveRing',
                    x: atPx.x,
                    y: atPx.y,
                    color: e.isKill ? 0xF97316 : color,
                    scale: e.isKill ? 1.15 : 0.8,
                  });
                }
              }
              if (e.targetUnitId) {
                const knock = e.isKill ? 7.5 : isTankBlast ? 8.5 : 5;
                this.triggerUnitImpulse(e.targetUnitId, {
                  recoilX: fromPx ? Math.cos(incomingAngle) * knock : 0,
                  recoilY: fromPx ? Math.sin(incomingAngle) * knock : -knock * 0.5,
                  flashColor: isTankBlast ? 0xFED7AA : 0xFFE4E6,
                  flashMs: 85,
                  durationMs: isTankBlast ? 220 : 185,
                });
              }
              if (e.isKill || e.isCrit || isTankBlast) {
                this.triggerHitStop(e.isKill ? 42 : isTankBlast ? 34 : 32);
              }
            },
            'hit-impact',
          );
          if (blastScorchId) {
            this.schedule(
              delay + 1350,
              () => {
                this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
                this.sink.removeTileEffect?.(blastScorchId);
              },
              'tank-blast-scorch-cleanup',
            );
          }
          noteWake(delay + (isTankBlast ? 1450 : 520));
          break;
        }

        case 'mineBlast': {
          const delay = mineDelayByEvent.get(e) ?? Math.max(0, e.delayMs ?? 0);
          const atPx = tileCenterPx(e.at);
          const tileX = e.at.x * TILE_SIZE;
          const tileY = e.at.y * TILE_SIZE;
          const flashId = `tfx_${this.nextFxSeq++}`;
          const scorchId = `tfx_${this.nextFxSeq++}`;

          if (e.victimUnitId && !e.victimDead && e.damage > 0 && delay > 0) {
            const vid = e.victimUnitId;
            const dmg = e.damage;
            this.sink.addDeferredHp?.(vid, dmg);
            this.schedule(delay, () => this.sink.clearDeferredHp?.(vid, dmg), 'mine-deferred-hp-release');
          }

          this.schedule(
            delay,
            () => {
              this.activeVisualCount += 2;
              this.sink.spawnTileEffect?.({
                id: flashId,
                kind: 'mineFlash',
                x: tileX,
                y: tileY,
                color: 0xEF4444,
                durationMs: 360,
              });
              this.sink.spawnTileEffect?.({
                id: scorchId,
                kind: 'scorch',
                x: tileX,
                y: tileY,
                color: 0xEA580C,
                durationMs: 1750,
                scale: 1.25,
              });
              this.sink.emitParticles?.({
                preset: 'explosion',
                x: atPx.x,
                y: atPx.y,
                scale: e.victimDead ? 1.25 : 1.05,
              });
              this.sink.emitParticles?.({
                preset: 'shockwaveRing',
                x: atPx.x,
                y: atPx.y,
                color: 0xF97316,
                scale: 1.5,
              });
              if (e.victimUnitId && !e.victimDead) {
                this.triggerUnitImpulse(e.victimUnitId, {
                  recoilX: 0,
                  recoilY: -7,
                  flashColor: 0xFECACA,
                  flashMs: 95,
                  durationMs: 210,
                });
              }
              if (e.victimDead) {
                this.triggerHitStop(45);
              }
            },
            'mine-blast',
          );
          this.schedule(
            delay + 360,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeTileEffect?.(flashId);
            },
            'mine-flash-cleanup',
          );
          this.schedule(
            delay + 1750,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeTileEffect?.(scorchId);
            },
            'mine-scorch-cleanup',
          );
          noteWake(delay + 1820);
          break;
        }

        case 'structureHit': {
          const delay = e.delayMs ?? projectileImpactByTile.get(tileKey(e.at)) ?? 0;
          const atPx = tileCenterPx(e.at);
          const tileX = e.at.x * TILE_SIZE;
          const tileY = e.at.y * TILE_SIZE;
          const scorchId = e.destroyed ? `tfx_${this.nextFxSeq++}` : null;
          const scorchMs = e.structureType === 'BASE' ? 2000 : 1450;

          this.schedule(
            delay,
            () => {
              if (e.destroyed && e.structureType === 'BASE') {
                if (scorchId) {
                  this.activeVisualCount++;
                  this.sink.spawnTileEffect?.({
                    id: scorchId,
                    kind: 'scorch',
                    x: tileX,
                    y: tileY,
                    color: 0xEF4444,
                    durationMs: scorchMs,
                    scale: 1.45,
                  });
                }
                this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x, y: atPx.y, scale: 1.45 });
                this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0xEF4444, scale: 1.8 });
                this.triggerHitStop(48);
                this.sink.playKillConfirm?.();
                const ownerLabel = e.owner !== undefined && e.owner !== null ? `Player ${e.owner + 1} HQ` : 'Command Base';
                this.sink.showCallout?.({
                  id: `callout_${this.nextFxSeq++}`,
                  headline: 'BASE BREACHED!',
                  subtext: `${ownerLabel} Destroyed · Faction Eliminated`,
                  accentPlayer: e.attackerOwner ?? null,
                  tone: 'base',
                  priority: 3,
                  durationMs: 2200,
                });
                this.schedule(110, () => {
                  this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x - 16, y: atPx.y - 10, scale: 1.1 });
                }, 'base-secondary-1');
                this.schedule(220, () => {
                  this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x + 14, y: atPx.y + 12, scale: 1.15 });
                }, 'base-secondary-2');
              } else if (e.destroyed && e.structureType === 'BARRIER') {
                if (scorchId) {
                  this.activeVisualCount++;
                  this.sink.spawnTileEffect?.({
                    id: scorchId,
                    kind: 'scorch',
                    x: tileX,
                    y: tileY,
                    color: 0x94A3B8,
                    durationMs: scorchMs,
                    scale: 1.0,
                  });
                }
                this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x, y: atPx.y, scale: 0.95 });
                this.sink.emitParticles?.({ preset: 'constructionDust', x: atPx.x, y: atPx.y, scale: 1.2 });
              } else {
                this.sink.emitParticles?.({ preset: 'impactSparks', x: atPx.x, y: atPx.y, color: 0xFB923C, scale: 1.1 });
              }
            },
            'structure-hit',
          );
          if (scorchId) {
            this.schedule(
              delay + scorchMs,
              () => {
                this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
                this.sink.removeTileEffect?.(scorchId);
              },
              'structure-scorch-cleanup',
            );
          }
          noteWake(delay + (e.destroyed ? scorchMs + 120 : 500));
          break;
        }

        case 'killed': {
          const pairedKill = matchingPlanForTile(e.at, e.unitId);
          const killImpactMs =
            e.delayMs ?? pairedKill?.impactMs ?? impactByVictimId.get(e.unitId) ?? projectileImpactByTile.get(tileKey(e.at)) ?? 0;
          const atPx = tileCenterPx(e.at);
          const tileX = e.at.x * TILE_SIZE;
          const tileY = e.at.y * TILE_SIZE;
          const ghostId = `death_${this.nextFxSeq++}`;
          const scorchId = `tfx_${this.nextFxSeq++}`;
          const scorchDurationMs = 1650;
          const safeRank = (Math.max(0, Math.min(3, e.rank)) as UnitRank);

          // Keep dying unit visibly present (and marching if killed mid-move!) until lethal blow arrives
          if (killImpactMs > 0) {
            let totalIncomingDmg = 0;
            for (const other of events) {
              if (
                (other.kind === 'hit' && other.targetUnitId === e.unitId) ||
                (other.kind === 'mineBlast' && other.victimUnitId === e.unitId)
              ) {
                totalIncomingDmg += other.damage;
              }
            }
            const approxPreHp = Math.max(1, totalIncomingDmg);
            const startTile = moveEvt && moveEvt.unitId === e.unitId ? moveEvt.path[0] : e.at;
            this.activeVisualCount++;
            this.sink.addPendingDeath?.({
              unitId: e.unitId,
              unitType: e.unitType,
              owner: e.owner,
              rank: safeRank,
              tileX: startTile.x,
              tileY: startTile.y,
              endTileX: e.at.x,
              endTileY: e.at.y,
              displayHp: approxPreHp,
            });
          }

          // At exact lethal impact: release live hold -> launch 550ms death ghost, scorch decal, ember burst, & kill banner
          this.schedule(
            killImpactMs,
            () => {
              if (killImpactMs > 0) {
                this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
                this.sink.removePendingDeath?.(e.unitId);
              }

              this.activeVisualCount += 2;
              this.sink.spawnDeathGhost?.({
                id: ghostId,
                unitId: e.unitId,
                unitType: e.unitType,
                owner: e.owner,
                rank: safeRank,
                x: tileX,
                y: tileY,
                cause: e.cause,
                durationMs: DEATH_GHOST_DURATION_MS,
              });
              this.sink.spawnTileEffect?.({
                id: scorchId,
                kind: 'scorch',
                x: tileX,
                y: tileY,
                color: e.cause === 'LAVA' ? 0xEF4444 : 0xF97316,
                durationMs: scorchDurationMs,
                scale: 1.0,
              });

              if (e.cause === 'LAVA') {
                this.sink.emitParticles?.({ preset: 'lavaSplash', x: atPx.x, y: atPx.y, scale: 1.15 });
              } else {
                this.sink.emitParticles?.({
                  preset: 'deathBurst',
                  x: atPx.x,
                  y: atPx.y,
                  scale: safeRank >= 3 ? 1.3 : 1.05,
                });
              }

              this.sink.playKillConfirm?.();

              const unitName = UNIT_STATS[e.unitType]?.name ?? e.unitType;
              const isAce = safeRank >= 3;
              const headline = isAce
                ? 'ACE DOWN!'
                : e.cause === 'OVERWATCH'
                  ? 'OVERWATCH KILL!'
                  : e.cause === 'MINE'
                    ? 'MINE KILL!'
                    : 'ELIMINATED!';
              const subtext = isAce
                ? `P${e.owner + 1} Ace ${unitName} · +€${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} Bounty`
                : `P${e.owner + 1} ${unitName} · ${killCauseSubtitle(e.cause)}`;
              this.sink.showCallout?.({
                id: `callout_${this.nextFxSeq++}`,
                headline,
                subtext,
                accentPlayer: e.killerOwner ?? null,
                tone: isAce ? 'ace' : 'kill',
                priority: isAce ? 3 : 1,
                durationMs: isAce ? 2000 : 1550,
              });
            },
            'death-ghost-start',
          );

          this.schedule(
            killImpactMs + DEATH_GHOST_DURATION_MS,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeDeathGhost?.(ghostId);
            },
            'death-ghost-cleanup',
          );
          this.schedule(
            killImpactMs + scorchDurationMs,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeTileEffect?.(scorchId);
            },
            'death-scorch-cleanup',
          );
          noteWake(killImpactMs + scorchDurationMs + 120);
          break;
        }

        case 'popup': {
          let delay = e.delayMs;
          if (delay === undefined) {
            const pairedPopup = matchingPlanForTile(e.at);
            const impactMs = pairedPopup?.impactMs ?? projectileImpactByTile.get(tileKey(e.at));
            if (hasMineBlast && firstMineDelayMs !== null && (e.text === 'LAND MINE!' || e.text.startsWith('-'))) {
              if (impactMs !== undefined && Math.abs(impactMs - firstMineDelayMs) > 20 && e.text.startsWith('-') && minePopupCount === 0 && !events.some(ev => ev.kind === 'mineBlast' && ev.at.x === e.at.x && ev.at.y === e.at.y)) {
                delay = impactMs;
              } else {
                delay = firstMineDelayMs + (minePopupCount === 0 ? 0 : 90);
                minePopupCount++;
              }
            } else if (impactMs !== undefined) {
              delay = impactMs + (e.text === 'PINNED!' || e.text === 'PIN RESISTED!' || e.text === 'SUPPRESSED!' ? 70 : 0);
            } else if (e.text === 'PIN RESISTED!' && hasProjectile) {
              delay = firstProjectileImpactMs + 70;
            } else {
              delay = 0;
            }
          }
          const atPx = tileCenterPx(e.at);
          const id = `pop_${this.nextFxSeq++}`;
          this.schedule(
            delay,
            () => {
              this.activeVisualCount++;
              this.sink.spawnPopup?.({
                id,
                x: atPx.x,
                y: atPx.y - e.lift,
                value: e.text,
                color: e.color,
                durationMs: POPUP_LIFETIME_MS,
              });
            },
            'popup-spawn',
          );
          this.schedule(
            delay + POPUP_LIFETIME_MS,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removePopup?.(id);
            },
            'popup-cleanup',
          );
          noteWake(delay + POPUP_LIFETIME_MS + 120);
          break;
        }

        case 'shake': {
          let delay = e.delayMs;
          if (delay === undefined) {
            const matchingMine = e.at
              ? events.find(ev => ev.kind === 'mineBlast' && ev.at.x === e.at!.x && ev.at.y === e.at!.y)
              : undefined;
            const pairedShake = e.at ? matchingPlanForTile(e.at) : null;
            if (matchingMine && mineDelayByEvent.has(matchingMine)) {
              delay = mineDelayByEvent.get(matchingMine)!;
            } else if (pairedShake) {
              delay = pairedShake.impactMs;
            } else if (e.at && projectileImpactByTile.has(tileKey(e.at))) {
              delay = projectileImpactByTile.get(tileKey(e.at))!;
            } else if (hasMineBlast && firstMineDelayMs !== null && !hasProjectile) {
              delay = firstMineDelayMs;
            } else if (hasProjectile) {
              delay = firstProjectileImpactMs;
            } else {
              delay = 0;
            }
          }
          this.schedule(delay, () => this.addTraumaFromIntensity(e.intensity), 'shake');
          noteWake(delay + 560);
          break;
        }

        case 'heist': {
          const atPx = tileCenterPx(e.at);
          this.schedule(0, () => {
            this.sink.emitParticles?.({ preset: 'goldBurst', x: atPx.x, y: atPx.y, scale: 1.3 });
            this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0xFBBF24, scale: 1.15 });
            this.sink.showCallout?.({
              id: `callout_${this.nextFxSeq++}`,
              headline: 'VAULT BREACHED!',
              subtext: `Player ${e.playerId + 1} Raided the Bank`,
              accentPlayer: e.playerId,
              tone: 'heist',
              priority: 2,
              durationMs: 1800,
            });
          }, 'heist');
          // Multi-wave golden coin fountain arcing out of the vault
          this.schedule(95, () => {
            this.sink.emitParticles?.({ preset: 'goldBurst', x: atPx.x, y: atPx.y - 4, scale: 1.05 });
          }, 'heist-fountain-2');
          this.schedule(190, () => {
            this.sink.emitParticles?.({ preset: 'goldBurst', x: atPx.x, y: atPx.y - 6, scale: 0.95 });
          }, 'heist-fountain-3');
          noteWake(920);
          break;
        }

        case 'capture': {
          const atPx = tileCenterPx(e.at);
          const color = playerFactionPixiColor(e.owner);
          const waveId = `tfx_${this.nextFxSeq++}`;
          this.schedule(0, () => {
            this.activeVisualCount++;
            this.sink.spawnTileEffect?.({
              id: waveId,
              kind: 'captureWave',
              x: e.at.x * TILE_SIZE,
              y: e.at.y * TILE_SIZE,
              color,
              durationMs: 500,
            });
            this.sink.emitParticles?.({ preset: 'capturePulse', x: atPx.x, y: atPx.y, color, scale: 1.0 });
          }, 'capture');
          this.schedule(
            500,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeTileEffect?.(waveId);
            },
            'capture-wave-cleanup',
          );
          noteWake(640);
          break;
        }

        case 'spawn': {
          const atPx = tileCenterPx(e.at);
          const color = playerFactionPixiColor(e.owner);
          const beamId = `tfx_${this.nextFxSeq++}`;
          this.schedule(0, () => {
            this.activeVisualCount++;
            this.sink.spawnTileEffect?.({
              id: beamId,
              kind: 'spawnBeam',
              x: e.at.x * TILE_SIZE,
              y: e.at.y * TILE_SIZE,
              color,
              durationMs: 460,
            });
            this.sink.emitParticles?.({ preset: 'capturePulse', x: atPx.x, y: atPx.y, color, scale: 0.92 });
            this.sink.emitParticles?.({ preset: 'dustPuff', x: atPx.x, y: atPx.y, scale: 0.9 });
          }, 'spawn');
          this.schedule(
            460,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeTileEffect?.(beamId);
            },
            'spawn-beam-cleanup',
          );
          noteWake(620);
          break;
        }

        case 'promotion': {
          const atPx = tileCenterPx(e.at);
          const promoId = `promo_${this.nextFxSeq++}`;
          const safeRank = Math.max(1, Math.min(3, e.rank)) as UnitRank;
          this.schedule(0, () => {
            this.activeVisualCount++;
            this.sink.spawnPromotionBurst?.({
              id: promoId,
              unitId: e.unitId,
              x: atPx.x,
              y: atPx.y,
              rank: safeRank,
              label: e.label,
              durationMs: PROMOTION_BURST_DURATION_MS,
            });
            this.sink.emitParticles?.({ preset: 'goldBurst', x: atPx.x, y: atPx.y, scale: safeRank >= 3 ? 1.35 : 1.1 });
            this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0xFDE047, scale: safeRank >= 3 ? 1.25 : 0.95 });
          }, 'promotion');
          this.schedule(
            PROMOTION_BURST_DURATION_MS,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removePromotionBurst?.(promoId);
            },
            'promotion-cleanup',
          );
          noteWake(PROMOTION_BURST_DURATION_MS + 140);
          break;
        }

        case 'overwatchSet': {
          const atPx = tileCenterPx(e.at);
          this.schedule(0, () => {
            this.sink.emitParticles?.({ preset: 'overwatchRing', x: atPx.x, y: atPx.y });
          }, 'overwatch-set');
          noteWake(550);
          break;
        }

        case 'heal': {
          const atPx = tileCenterPx(e.at);
          const isAmmo = e.item === 'AMMO' || e.item === 'RELOAD';
          this.schedule(0, () => {
            this.sink.emitParticles?.({
              preset: isAmmo ? 'goldBurst' : 'healPulse',
              x: atPx.x,
              y: atPx.y,
              scale: isAmmo ? 0.7 : 1,
            });
          }, 'heal');
          noteWake(650);
          break;
        }

        case 'build': {
          for (const tile of e.tiles) {
            const atPx = tileCenterPx(tile);
            this.schedule(0, () => {
              this.sink.emitParticles?.({ preset: 'constructionDust', x: atPx.x, y: atPx.y });
            }, 'build');
          }
          noteWake(620);
          break;
        }

        case 'supplyLanded': {
          const atPx = tileCenterPx(e.at);
          const dropId = `drop_${this.nextFxSeq++}`;
          const tileId = `${e.at.x},${e.at.y}`;
          this.schedule(0, () => {
            this.activeVisualCount++;
            this.sink.spawnSupplyDrop?.({
              id: dropId,
              tileId,
              x: e.at.x * TILE_SIZE,
              y: e.at.y * TILE_SIZE,
              item: e.item,
              durationMs: SUPPLY_DROP_DURATION_MS,
            });
          }, 'supply-drop-start');
          // Touchdown puff & cyan landing ring right as the parachute crate hits the ground
          this.schedule(
            SUPPLY_DROP_DURATION_MS - 60,
            () => {
              this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0x22D3EE, scale: 0.95 });
              this.sink.emitParticles?.({ preset: 'dustPuff', x: atPx.x, y: atPx.y, scale: 0.95 });
            },
            'supply-drop-touchdown',
          );
          this.schedule(
            SUPPLY_DROP_DURATION_MS,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeSupplyDrop?.(dropId);
            },
            'supply-drop-cleanup',
          );
          noteWake(SUPPLY_DROP_DURATION_MS + 240);
          break;
        }

        case 'movePath':
          // Already started before Pass 2 so compound cues align with march arrival
          break;
      }
    }

    if (maxWakeMs > 0) {
      this.sink.onWake?.(maxWakeMs);
    }
    this.notifyActiveIfChanged();
  }
}

/** Singleton battlefield FX timeline shared across the web client. */
export const fxTimeline = new FxTimeline();
