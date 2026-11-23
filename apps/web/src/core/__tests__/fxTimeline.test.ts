import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameEvent, SoundName } from '@tactical/engine';
import {
  computeMarchDurationMs,
  estimateProjectileTravelMs,
  FxTimeline,
  MAX_TIMELINE_STEP_MS,
  type ParticleEmitRequest,
  type PopupSpawnRequest,
  type ProjectileSpawnRequest,
} from '../graphics/fxTimeline';

const createHarness = () => {
  const timeline = new FxTimeline();
  const sounds: { at: number; sound: SoundName }[] = [];
  const projectiles: { at: number; req: ProjectileSpawnRequest }[] = [];
  const removedProjectiles: { at: number; id: string }[] = [];
  const popups: { at: number; req: PopupSpawnRequest }[] = [];
  const removedPopups: { at: number; id: string }[] = [];
  const particles: { at: number; req: ParticleEmitRequest }[] = [];
  const wakes: number[] = [];
  let clearedCount = 0;

  timeline.configure({
    playSound: (sound) => sounds.push({ at: timeline.getClockMs(), sound }),
    spawnProjectile: (req) => projectiles.push({ at: timeline.getClockMs(), req }),
    removeProjectile: (id) => removedProjectiles.push({ at: timeline.getClockMs(), id }),
    spawnPopup: (req) => popups.push({ at: timeline.getClockMs(), req }),
    removePopup: (id) => removedPopups.push({ at: timeline.getClockMs(), id }),
    emitParticles: (req) => particles.push({ at: timeline.getClockMs(), req }),
    hasActiveParticles: () => false,
    onWake: (ms) => wakes.push(ms),
    onClearVisuals: () => { clearedCount++; },
  });

  const advance = (totalMs: number, stepMs = 16) => {
    let remaining = totalMs;
    while (remaining > 0) {
      const chunk = Math.min(stepMs, remaining);
      timeline.step(chunk);
      remaining -= chunk;
    }
  };

  return {
    timeline,
    sounds,
    projectiles,
    removedProjectiles,
    popups,
    removedPopups,
    particles,
    wakes,
    getClearedCount: () => clearedCount,
    advance,
  };
};

test('FxTimeline clamps large ECO wake spikes to MAX_TIMELINE_STEP_MS', () => {
  const { timeline } = createHarness();
  let fired = false;
  timeline.schedule(100, () => { fired = true; });

  // Simulate waking from 10 seconds of ECO sleep
  const { dtMs, combatDtMs } = timeline.step(10_000);
  assert.equal(dtMs, MAX_TIMELINE_STEP_MS);
  assert.equal(combatDtMs, MAX_TIMELINE_STEP_MS);
  assert.equal(fired, false, 'huge wake delta must not prematurely skip queued cues');
  assert.ok(timeline.getClockMs() <= MAX_TIMELINE_STEP_MS + 0.01);
});

test('FxTimeline trauma shake is zero-drift, zoom-compensated, and respects prefers-reduced-motion', () => {
  const { timeline, advance } = createHarness();

  // Idle starts at exact (0, 0)
  assert.deepEqual(timeline.getShakeOffset(1, false), { x: 0, y: 0 });

  timeline.addTraumaFromIntensity(12);
  assert.ok(timeline.getTrauma() > 0.5);

  // Reduced motion strictly suppresses camera oscillation
  assert.deepEqual(timeline.getShakeOffset(1, true), { x: 0, y: 0 });

  // Advance 1 frame so sin/cos phase is non-zero
  timeline.step(16);
  const normalOffset = timeline.getShakeOffset(1, false);
  const zoomedOutOffset = timeline.getShakeOffset(0.5, false);
  const zoomedInOffset = timeline.getShakeOffset(2.0, false);

  const magNormal = Math.hypot(normalOffset.x, normalOffset.y);
  const magOut = Math.hypot(zoomedOutOffset.x, zoomedOutOffset.y);
  const magIn = Math.hypot(zoomedInOffset.x, zoomedInOffset.y);
  assert.ok(magNormal > 0.5, 'trauma produces visible offset');
  assert.ok(magOut > magNormal, 'zoomed-out world amplitude scales up for consistent screen punch');
  assert.ok(magIn < magNormal, 'zoomed-in world amplitude scales down to prevent excessive jolt');

  // After full decay, camera returns to exact (0, 0) with zero cumulative drift
  advance(600, 16);
  assert.equal(timeline.getTrauma(), 0);
  assert.deepEqual(timeline.getShakeOffset(1, false), { x: 0, y: 0 });
  assert.equal(timeline.isActive(), false);
});

test('FxTimeline hit-stop pauses combat cues while keeping camera trauma alive', () => {
  const { timeline } = createHarness();
  let cueFired = false;
  timeline.schedule(30, () => { cueFired = true; });
  timeline.addTrauma(0.8);
  timeline.triggerHitStop(45);

  const beforeTrauma = timeline.getTrauma();
  const res1 = timeline.step(20);
  assert.equal(res1.combatDtMs, 0, 'combat time freezes during hit-stop');
  assert.equal(cueFired, false);
  assert.ok(timeline.getTrauma() < beforeTrauma, 'camera trauma continues ticking during hit-stop');

  timeline.step(25); // exits hit-stop (45ms elapsed)
  assert.equal(cueFired, false, 'combat clock stayed paused during hit-stop');

  timeline.step(30); // now combat clock advances 30ms
  assert.equal(cueFired, true);
});

test('FxTimeline synchronizes ATTACK muzzle flash at t=0 and hit sparks/sound/popup/trauma at projectile arrival', () => {
  const { timeline, sounds, projectiles, removedProjectiles, popups, removedPopups, particles, advance } = createHarness();
  const from = { x: 2, y: 2 };
  const to = { x: 6, y: 2 };
  const expectedTravel = estimateProjectileTravelMs(from, to, 'BULLET', 'SOLDIER');

  const attackEvents: GameEvent[] = [
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from, to, style: 'BULLET', weapon: 'SOLDIER', attackerId: 'u_att', targetUnitId: 'u_tar' },
    { kind: 'hit', targetUnitId: 'u_tar', at: to, from, damage: 6, weapon: 'SOLDIER', isKill: false },
    { kind: 'popup', at: to, text: '-6', color: '#FF0000', lift: 10 },
    { kind: 'shake', intensity: 12, at: to },
  ];

  timeline.dispatchGameEvents(attackEvents);

  // At t = 0: fire SFX + muzzle flash + projectile + attacker recoil fire immediately
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].sound, 'attack');
  assert.equal(projectiles.length, 1);
  assert.equal(projectiles[0].req.travelMs, expectedTravel);
  assert.equal(particles.filter(p => p.req.preset === 'muzzleFlash').length, 1);
  assert.ok(timeline.getUnitImpulse('u_att') !== null, 'attacker receives immediate recoil impulse');

  // Impact effects must NOT fire prematurely at t = 0
  assert.equal(popups.length, 0, 'damage popup waits for projectile impact');
  assert.equal(particles.filter(p => p.req.preset === 'impactSparks').length, 0);
  assert.equal(timeline.getTrauma(), 0, 'camera trauma waits for projectile impact');
  assert.equal(timeline.getUnitImpulse('u_tar'), null, 'target knockback waits for impact');

  // Step halfway through flight: still no impact
  advance(Math.floor(expectedTravel / 2), 16);
  assert.equal(popups.length, 0);
  assert.equal(sounds.length, 1);

  // Step past projectile arrival: impact SFX, sparks, popup, target impulse, and trauma all fire!
  advance(expectedTravel, 16);
  assert.ok(sounds.some(s => s.sound === 'hit' && s.at >= expectedTravel));
  assert.equal(popups.length, 1);
  assert.equal(popups[0].req.value, '-6');
  assert.ok(popups[0].at >= expectedTravel);
  assert.equal(particles.filter(p => p.req.preset === 'impactSparks').length, 1);
  assert.ok(timeline.getTrauma() > 0, 'trauma engages on impact');
  assert.ok(timeline.getUnitImpulse('u_tar') !== null, 'target knockback + flash engages on impact');

  // Step through full popup & trauma tail: everything cleans up so ECO sleeps at 0% idle GPU
  advance(1200, 16);
  assert.equal(removedProjectiles.length, 1);
  assert.equal(removedPopups.length, 1);
  assert.equal(timeline.isActive(), false, 'timeline settles cleanly to inactive for 0% idle ECO GPU');
});

test('FxTimeline sequences Base destruction secondary explosions and clears cleanly on reset', () => {
  const { timeline, particles, getClearedCount, advance } = createHarness();

  timeline.dispatchGameEvents([
    { kind: 'projectile', from: { x: 1, y: 1 }, to: { x: 3, y: 1 }, style: 'MISSILE', weapon: 'SIEGE' },
    { kind: 'structureHit', at: { x: 3, y: 1 }, structureType: 'BASE', damage: 10, destroyed: true, owner: 1 },
    { kind: 'shake', intensity: 18, at: { x: 3, y: 1 } },
  ]);

  // Step past missile arrival + hit-stop + 220ms secondary blasts
  advance(700, 16);
  const explosions = particles.filter(p => p.req.preset === 'explosion');
  assert.equal(explosions.length, 3, 'destroyed base triggers primary + 2 staggered secondary blasts');

  // Schedule future cue then clear (match reset / tab hide)
  let leaked = false;
  timeline.schedule(100, () => { leaked = true; });
  timeline.addTrauma(0.9);
  timeline.clear();

  assert.equal(timeline.isActive(), false);
  assert.equal(timeline.getTrauma(), 0);
  assert.equal(getClearedCount(), 1);
  advance(300, 16);
  assert.equal(leaked, false, 'clear() cancels all pending cues');
});

test('computeMarchDurationMs caps long marches cleanly for AI cadence', () => {
  assert.equal(computeMarchDurationMs(0), 0);
  assert.equal(computeMarchDurationMs(1), 160);
  assert.equal(computeMarchDurationMs(3), 285);
  assert.equal(computeMarchDurationMs(10), 520);
});
