/**
 * Time-driven combat & battlefield FX sequencer (`fxTimeline`).
 *
 * Replaces `setTimeout`-based effect lifecycles with deterministic elapsed-time stepping
 * driven by Pixi's ticker (with strict delta clamping to prevent ECO wake spikes).
 * Pure TypeScript with zero React/Pixi runtime imports so it can be unit-tested in Node.
 */
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { GameEvent, SoundName, TilePoint, WeaponVisual } from '@tactical/engine';

export type ProjectileVisualStyle = 'BULLET' | 'LASER' | 'MISSILE';

export type ParticlePresetKind =
  | 'muzzleFlash'
  | 'impactSparks'
  | 'explosion'
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
}

export interface PopupSpawnRequest {
  id: string;
  x: number;
  y: number;
  value: string;
  color: string;
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

export interface ShakeOffset {
  x: number;
  y: number;
}

export interface TimelineSink {
  playSound?: (sound: SoundName) => void;
  spawnProjectile?: (proj: ProjectileSpawnRequest) => void;
  removeProjectile?: (id: string) => void;
  spawnPopup?: (popup: PopupSpawnRequest) => void;
  removePopup?: (id: string) => void;
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

export const tileCenterPx = (p: TilePoint): { x: number; y: number } => ({
  x: p.x * TILE_SIZE + TILE_SIZE / 2,
  y: p.y * TILE_SIZE + TILE_SIZE / 2,
});

/** Caps total unit march time so long sprints stay crisp against AI/bot 450–800ms cadence. */
export const computeMarchDurationMs = (stepCount: number): number => {
  if (stepCount <= 0) return 0;
  return Math.min(520, Math.max(160, stepCount * 95));
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
    return Math.round(Math.min(180, Math.max(110, 95 + dist * 9)));
  }
  if (weapon === 'ARTILLERY' || weapon === 'SIEGE' || style === 'MISSILE') {
    return Math.round(Math.min(280, Math.max(175, 145 + dist * 16)));
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
  private activeVisualCount = 0;
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

  public isActive(): boolean {
    return (
      this.cues.length > 0 ||
      this.trauma > 0.001 ||
      this.hitStopMs > 0 ||
      this.unitImpulses.size > 0 ||
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
    if (safeDelay === 0 && this.hitStopMs <= 0) {
      callback();
      this.notifyActiveIfChanged();
      return 0;
    }
    const id = this.nextCueId++;
    const fireAtMs = this.clockMs + safeDelay;
    this.cues.push({ id, fireAtMs, callback, tag });
    // Keep cues sorted ascending by fireAtMs so step() drains in exact chronological order
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
    // Snappy damped kick-out and smooth return to 0
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

    this.notifyActiveIfChanged();
    return { dtMs, combatDtMs: dtMs };
  }

  /** Clears all pending cues, trauma, impulses, and active transient visuals (match reset / tab hide). */
  public clear(): void {
    this.cues = [];
    this.trauma = 0;
    this.traumaTimeMs = 0;
    this.hitStopMs = 0;
    this.unitImpulses.clear();
    this.activeVisualCount = 0;
    this.sink.onClearVisuals?.();
    this.notifyActiveIfChanged();
  }

  /**
   * Translates a declarative engine `GameEvent[]` batch into a synchronized visual/audio timeline:
   * - `0ms`: firing sound, muzzle flash, attacker recoil, projectile launch
   * - `travelMs`: impact sound, impact sparks/rings, target knockback & hit flash, hit-stop,
   *   camera trauma, and floating damage popups
   */
  public dispatchGameEvents(events: GameEvent[]): void {
    if (!events || events.length === 0) return;

    const projectileImpactByTile = new Map<string, number>();
    let firstProjectileImpactMs = 0;
    let maxWakeMs = 0;
    const noteWake = (ms: number) => {
      if (ms > maxWakeMs) maxWakeMs = ms;
    };

    // Pass 1: compute projectile arrival windows so popups/shakes/impact sounds sync to arrival
    const projectilePlans = new Map<GameEvent, { startMs: number; travelMs: number; impactMs: number }>();
    for (const e of events) {
      if (e.kind === 'projectile') {
        const startMs = Math.max(0, e.delayMs ?? 0);
        const travelMs = e.travelMs ?? estimateProjectileTravelMs(e.from, e.to, e.style, e.weapon);
        const impactMs = startMs + travelMs;
        projectilePlans.set(e, { startMs, travelMs, impactMs });
        const key = tileKey(e.to);
        const prev = projectileImpactByTile.get(key);
        if (prev === undefined || impactMs < prev) {
          projectileImpactByTile.set(key, impactMs);
        }
        if (firstProjectileImpactMs === 0 || impactMs < firstProjectileImpactMs) {
          firstProjectileImpactMs = impactMs;
        }
      }
    }

    const hasMineBlast = events.some(e => e.kind === 'mineBlast');
    const hasDestroyedStructure = events.some(e => e.kind === 'structureHit' && e.destroyed);
    const hasProjectile = projectilePlans.size > 0;
    let minePopupCount = 0;

    // Pass 2: schedule each cue in synchronized order
    for (const e of events) {
      switch (e.kind) {
        case 'sound': {
          let delay = e.delayMs ?? 0;
          if (e.delayMs === undefined) {
            if (e.sound === 'hit' && hasProjectile) {
              delay = firstProjectileImpactMs;
            } else if (e.sound === 'explosion' && hasDestroyedStructure && hasProjectile && !hasMineBlast) {
              delay = firstProjectileImpactMs;
            }
          }
          this.schedule(delay, () => this.sink.playSound?.(e.sound), 'sound');
          noteWake(delay + 120);
          break;
        }

        case 'projectile': {
          const plan = projectilePlans.get(e)!;
          const fromPx = tileCenterPx(e.from);
          const toPx = tileCenterPx(e.to);
          const angle = Math.atan2(toPx.y - fromPx.y, toPx.x - fromPx.x);
          const id = `proj_${this.nextFxSeq++}`;
          const color = projectileColorFor(e.style, e.weapon);

          this.schedule(
            plan.startMs,
            () => {
              this.activeVisualCount++;
              this.sink.emitParticles?.({
                preset: 'muzzleFlash',
                x: fromPx.x + Math.cos(angle) * 14,
                y: fromPx.y + Math.sin(angle) * 14,
                angle,
                color,
                scale: e.weapon === 'ASSAULTER' || e.style === 'MISSILE' ? 1.2 : 1,
              });
              if (e.attackerId) {
                const kick = e.weapon === 'SNIPER' ? 6 : e.weapon === 'ASSAULTER' ? 5.5 : 4;
                this.triggerUnitImpulse(e.attackerId, {
                  recoilX: -Math.cos(angle) * kick,
                  recoilY: -Math.sin(angle) * kick,
                  durationMs: 165,
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
              });
            },
            'projectile-launch',
          );

          // Remove projectile cleanly via timeline after arrival + tiny afterglow window
          const cleanupMs = plan.impactMs + (e.style === 'LASER' ? 95 : 55);
          this.schedule(
            cleanupMs,
            () => {
              this.activeVisualCount = Math.max(0, this.activeVisualCount - 1);
              this.sink.removeProjectile?.(id);
            },
            'projectile-cleanup',
          );

          // If no explicit `hit` or `structureHit` event accompanies this projectile, still emit crisp impact sparks
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
                  preset: 'impactSparks',
                  x: toPx.x,
                  y: toPx.y,
                  angle: angle + Math.PI,
                  color,
                });
              },
              'projectile-fallback-impact',
            );
          }

          noteWake(cleanupMs + 220);
          break;
        }

        case 'hit': {
          const delay = e.delayMs ?? projectileImpactByTile.get(tileKey(e.at)) ?? 0;
          const atPx = tileCenterPx(e.at);
          const fromPx = e.from ? tileCenterPx(e.from) : null;
          const incomingAngle = fromPx ? Math.atan2(atPx.y - fromPx.y, atPx.x - fromPx.x) : 0;

          this.schedule(
            delay,
            () => {
              const color = e.weapon === 'SNIPER' ? 0xFB7185 : e.isCrit ? 0xF59E0B : 0xFDE047;
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
                  scale: e.isKill ? 1.15 : 0.75,
                });
              }
              if (e.targetUnitId) {
                const knock = e.isKill ? 7 : 5;
                this.triggerUnitImpulse(e.targetUnitId, {
                  recoilX: fromPx ? Math.cos(incomingAngle) * knock : 0,
                  recoilY: fromPx ? Math.sin(incomingAngle) * knock : -knock * 0.5,
                  flashColor: 0xFFE4E6,
                  flashMs: 85,
                  durationMs: 185,
                });
              }
              if (e.isKill || e.isCrit) {
                this.triggerHitStop(e.isKill ? 42 : 32);
              }
            },
            'hit-impact',
          );
          noteWake(delay + 520);
          break;
        }

        case 'mineBlast': {
          const delay = e.delayMs ?? 0;
          const atPx = tileCenterPx(e.at);
          this.schedule(
            delay,
            () => {
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
              if (e.victimDead) {
                this.triggerHitStop(45);
              }
            },
            'mine-blast',
          );
          noteWake(delay + 720);
          break;
        }

        case 'structureHit': {
          const delay = e.delayMs ?? projectileImpactByTile.get(tileKey(e.at)) ?? 0;
          const atPx = tileCenterPx(e.at);
          this.schedule(
            delay,
            () => {
              if (e.destroyed && e.structureType === 'BASE') {
                this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x, y: atPx.y, scale: 1.45 });
                this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0xEF4444, scale: 1.8 });
                this.triggerHitStop(48);
                this.schedule(110, () => {
                  this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x - 16, y: atPx.y - 10, scale: 1.1 });
                }, 'base-secondary-1');
                this.schedule(220, () => {
                  this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x + 14, y: atPx.y + 12, scale: 1.15 });
                }, 'base-secondary-2');
              } else if (e.destroyed && e.structureType === 'BARRIER') {
                this.sink.emitParticles?.({ preset: 'explosion', x: atPx.x, y: atPx.y, scale: 0.95 });
                this.sink.emitParticles?.({ preset: 'constructionDust', x: atPx.x, y: atPx.y, scale: 1.2 });
              } else {
                this.sink.emitParticles?.({ preset: 'impactSparks', x: atPx.x, y: atPx.y, color: 0xFB923C, scale: 1.1 });
              }
            },
            'structure-hit',
          );
          noteWake(delay + (e.destroyed ? 850 : 500));
          break;
        }

        case 'killed': {
          if (e.cause === 'LAVA') {
            const atPx = tileCenterPx(e.at);
            this.schedule(e.delayMs ?? 0, () => {
              this.sink.emitParticles?.({ preset: 'lavaSplash', x: atPx.x, y: atPx.y, scale: 1.15 });
            }, 'lava-kill');
            noteWake((e.delayMs ?? 0) + 650);
          }
          break;
        }

        case 'popup': {
          let delay = e.delayMs;
          if (delay === undefined) {
            const impactMs = projectileImpactByTile.get(tileKey(e.at));
            if (impactMs !== undefined) {
              delay = impactMs;
            } else if (hasMineBlast) {
              delay = minePopupCount === 0 ? 0 : 90;
              minePopupCount++;
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
          const delay =
            e.delayMs ?? (e.at ? projectileImpactByTile.get(tileKey(e.at)) : undefined) ?? (hasProjectile && !hasMineBlast ? firstProjectileImpactMs : 0);
          this.schedule(delay, () => this.addTraumaFromIntensity(e.intensity), 'shake');
          noteWake(delay + 560);
          break;
        }

        case 'heist': {
          const atPx = tileCenterPx(e.at);
          this.schedule(0, () => {
            this.sink.emitParticles?.({ preset: 'goldBurst', x: atPx.x, y: atPx.y, scale: 1.25 });
            this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0xFBBF24, scale: 1.1 });
          }, 'heist');
          noteWake(700);
          break;
        }

        case 'promotion': {
          const atPx = tileCenterPx(e.at);
          this.schedule(0, () => {
            this.sink.emitParticles?.({ preset: 'goldBurst', x: atPx.x, y: atPx.y, scale: 1.1 });
            this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0xFDE047, scale: 0.95 });
          }, 'promotion');
          noteWake(680);
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
          this.schedule(0, () => {
            this.sink.emitParticles?.({ preset: 'shockwaveRing', x: atPx.x, y: atPx.y, color: 0x22D3EE, scale: 0.9 });
            this.sink.emitParticles?.({ preset: 'dustPuff', x: atPx.x, y: atPx.y, scale: 0.9 });
          }, 'supply-landed');
          noteWake(620);
          break;
        }

        case 'movePath': {
          // Phase 2 hooks into `movePath` for step-by-step marching & terrain footsteps.
          noteWake(computeMarchDurationMs(Math.max(1, e.path.length - 1)) + 250);
          break;
        }
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
