import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { GameEvent, SoundName, TerrainType } from '@tactical/engine';
import {
  computeMarchDurationMs,
  DEATH_GHOST_DURATION_MS,
  estimateProjectileTravelMs,
  FxTimeline,
  MAX_TIMELINE_STEP_MS,
  PROMOTION_BURST_DURATION_MS,
  SUPPLY_DROP_DURATION_MS,
  terrainFootstepPreset,
  type CrossfireLockRequest,
  type DeathGhostRequest,
  type ParticleEmitRequest,
  type PendingDeathVisual,
  type PopupSpawnRequest,
  type ProjectileSpawnRequest,
  type PromotionBurstRequest,
  type SupplyDropAnimRequest,
  type TacticalCalloutRequest,
  type TileEffectRequest,
} from '../graphics/fxTimeline';

const createHarness = (terrainMap: Record<string, TerrainType> = {}) => {
  const timeline = new FxTimeline();
  const sounds: { at: number; sound: SoundName }[] = [];
  let killConfirmCount = 0;
  const projectiles: { at: number; req: ProjectileSpawnRequest }[] = [];
  const removedProjectiles: { at: number; id: string }[] = [];
  const crossfires: { at: number; req: CrossfireLockRequest }[] = [];
  const removedCrossfires: { at: number; id: string }[] = [];
  const popups: { at: number; req: PopupSpawnRequest }[] = [];
  const removedPopups: { at: number; id: string }[] = [];
  const particles: { at: number; req: ParticleEmitRequest }[] = [];
  const deferredHp: Record<string, number> = {};
  const pendingDeaths: Map<string, { at: number; ghost: PendingDeathVisual }> = new Map();
  const removedPendingDeaths: { at: number; unitId: string }[] = [];
  const deathGhosts: { at: number; req: DeathGhostRequest }[] = [];
  const removedDeathGhosts: { at: number; id: string }[] = [];
  const tileEffects: { at: number; req: TileEffectRequest }[] = [];
  const removedTileEffects: { at: number; id: string }[] = [];
  const supplyDrops: { at: number; req: SupplyDropAnimRequest }[] = [];
  const removedSupplyDrops: { at: number; id: string }[] = [];
  const promotionBursts: { at: number; req: PromotionBurstRequest }[] = [];
  const removedPromotionBursts: { at: number; id: string }[] = [];
  const callouts: { at: number; req: TacticalCalloutRequest }[] = [];
  const wakes: number[] = [];
  let clearedCount = 0;

  timeline.configure({
    playSound: (sound) => sounds.push({ at: timeline.getClockMs(), sound }),
    playKillConfirm: () => { killConfirmCount++; },
    spawnProjectile: (req) => projectiles.push({ at: timeline.getClockMs(), req }),
    removeProjectile: (id) => removedProjectiles.push({ at: timeline.getClockMs(), id }),
    spawnCrossfire: (req) => crossfires.push({ at: timeline.getClockMs(), req }),
    removeCrossfire: (id) => removedCrossfires.push({ at: timeline.getClockMs(), id }),
    spawnPopup: (req) => popups.push({ at: timeline.getClockMs(), req }),
    removePopup: (id) => removedPopups.push({ at: timeline.getClockMs(), id }),
    addDeferredHp: (uid, amt) => {
      deferredHp[uid] = (deferredHp[uid] ?? 0) + amt;
    },
    clearDeferredHp: (uid, amt) => {
      const next = (deferredHp[uid] ?? 0) - amt;
      if (next <= 0) delete deferredHp[uid];
      else deferredHp[uid] = next;
    },
    addPendingDeath: (ghost) => {
      pendingDeaths.set(ghost.unitId, { at: timeline.getClockMs(), ghost });
    },
    removePendingDeath: (unitId) => {
      pendingDeaths.delete(unitId);
      removedPendingDeaths.push({ at: timeline.getClockMs(), unitId });
    },
    spawnDeathGhost: (req) => deathGhosts.push({ at: timeline.getClockMs(), req }),
    removeDeathGhost: (id) => removedDeathGhosts.push({ at: timeline.getClockMs(), id }),
    spawnTileEffect: (req) => tileEffects.push({ at: timeline.getClockMs(), req }),
    removeTileEffect: (id) => removedTileEffects.push({ at: timeline.getClockMs(), id }),
    spawnSupplyDrop: (req) => supplyDrops.push({ at: timeline.getClockMs(), req }),
    removeSupplyDrop: (id) => removedSupplyDrops.push({ at: timeline.getClockMs(), id }),
    spawnPromotionBurst: (req) => promotionBursts.push({ at: timeline.getClockMs(), req }),
    removePromotionBurst: (id) => removedPromotionBursts.push({ at: timeline.getClockMs(), id }),
    showCallout: (req) => callouts.push({ at: timeline.getClockMs(), req }),
    getTileTerrain: (x, y) => terrainMap[`${x},${y}`],
    emitParticles: (req) => particles.push({ at: timeline.getClockMs(), req }),
    hasActiveParticles: () => false,
    onWake: (ms) => wakes.push(ms),
    onClearVisuals: () => {
      clearedCount++;
      pendingDeaths.clear();
      for (const k of Object.keys(deferredHp)) delete deferredHp[k];
    },
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
    getKillConfirmCount: () => killConfirmCount,
    projectiles,
    removedProjectiles,
    crossfires,
    removedCrossfires,
    popups,
    removedPopups,
    particles,
    deferredHp,
    pendingDeaths,
    removedPendingDeaths,
    deathGhosts,
    removedDeathGhosts,
    tileEffects,
    removedTileEffects,
    supplyDrops,
    removedSupplyDrops,
    promotionBursts,
    removedPromotionBursts,
    callouts,
    wakes,
    getClearedCount: () => clearedCount,
    advance,
  };
};

test('FxTimeline clamps large ECO wake spikes to MAX_TIMELINE_STEP_MS', () => {
  const { timeline } = createHarness();
  let fired = false;
  timeline.schedule(100, () => { fired = true; });

  const { dtMs, combatDtMs } = timeline.step(10_000);
  assert.equal(dtMs, MAX_TIMELINE_STEP_MS);
  assert.equal(combatDtMs, MAX_TIMELINE_STEP_MS);
  assert.equal(fired, false, 'huge wake delta must not prematurely skip queued cues');
  assert.ok(timeline.getClockMs() <= MAX_TIMELINE_STEP_MS + 0.01);
});

test('FxTimeline trauma shake is zero-drift, zoom-compensated, and respects prefers-reduced-motion', () => {
  const { timeline, advance } = createHarness();

  assert.deepEqual(timeline.getShakeOffset(1, false), { x: 0, y: 0 });

  timeline.addTraumaFromIntensity(12);
  assert.ok(timeline.getTrauma() > 0.5);
  assert.deepEqual(timeline.getShakeOffset(1, true), { x: 0, y: 0 });

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

  timeline.step(25);
  assert.equal(cueFired, false, 'combat clock stayed paused during hit-stop');

  timeline.step(30);
  assert.equal(cueFired, true);
});

test('FxTimeline synchronizes ATTACK muzzle burst, crossfire locks, HP deferral, and impact cues', () => {
  const { timeline, sounds, projectiles, removedProjectiles, crossfires, removedCrossfires, popups, removedPopups, particles, deferredHp, advance } = createHarness();
  const from = { x: 2, y: 2 };
  const to = { x: 6, y: 2 };
  const ally = { x: 6, y: 4 };
  const expectedTravel = estimateProjectileTravelMs(from, to, 'BULLET', 'SOLDIER');

  const attackEvents: GameEvent[] = [
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from, to, style: 'BULLET', weapon: 'SOLDIER', attackerId: 'u_att', targetUnitId: 'u_tar' },
    { kind: 'hit', targetUnitId: 'u_tar', at: to, from, damage: 6, weapon: 'SOLDIER', isKill: false, isCrit: true, crossfireFrom: [ally] },
    { kind: 'popup', at: to, text: '-6', color: '#FF0000', lift: 10 },
    { kind: 'shake', intensity: 12, at: to },
  ];

  timeline.dispatchGameEvents(attackEvents);

  // t = 0: fire SFX, primary muzzle flash, projectile, crossfire lock, attacker recoil, and HP deferral
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].sound, 'attack');
  assert.equal(projectiles.length, 1);
  assert.equal(projectiles[0].req.travelMs, expectedTravel);
  assert.equal(crossfires.length, 1, 'crossfire lock spawns at shot launch');
  assert.equal(deferredHp['u_tar'], 6, 'target HP stays visually deferred while shot is in flight');
  assert.equal(particles.filter(p => p.req.preset === 'muzzleFlash').length, 1);
  assert.ok(timeline.getUnitImpulse('u_att') !== null, 'attacker receives immediate recoil impulse');

  // Impact effects must NOT fire prematurely at t = 0
  assert.equal(popups.length, 0);
  assert.equal(particles.filter(p => p.req.preset === 'impactSparks').length, 0);
  assert.equal(timeline.getTrauma(), 0);
  assert.equal(timeline.getUnitImpulse('u_tar'), null);

  // Mid-flight: single pistol muzzle flash at barrel, impact has not landed yet
  advance(Math.floor(expectedTravel / 2), 16);
  assert.equal(particles.filter(p => p.req.preset === 'muzzleFlash').length, 1, 'scout pistol emits single crisp muzzle flash');
  assert.equal(popups.length, 0);
  assert.equal(deferredHp['u_tar'], 6);

  // Step past projectile arrival: impact SFX, sparks, popup, target impulse, trauma, and HP drop fire!
  advance(expectedTravel, 16);
  assert.ok(sounds.some(s => s.sound === 'hit' && s.at >= expectedTravel));
  assert.equal(popups.length, 1);
  assert.equal(popups[0].req.value, '-6');
  assert.ok(popups[0].at >= expectedTravel);
  assert.equal(particles.filter(p => p.req.preset === 'impactSparks').length, 1);
  assert.equal(deferredHp['u_tar'], undefined, 'deferred HP releases right on impact');
  assert.ok(timeline.getTrauma() > 0);
  assert.ok(timeline.getUnitImpulse('u_tar') !== null);

  // Full tail cleanup settles timeline to inactive for 0% idle ECO GPU
  advance(1300, 16);
  assert.equal(removedProjectiles.length, 1);
  assert.equal(removedCrossfires.length, 1);
  assert.equal(removedPopups.length, 1);
  assert.equal(timeline.isActive(), false);
});

test('FxTimeline marches units tile-by-tile around corners with terrain-typed footsteps and reduced-motion bob control', () => {
  const { timeline, particles, advance } = createHarness({
    '1,1': 'PLAINS',
    '2,1': 'FOREST',
    '2,2': 'BRIDGE',
    '3,2': 'SAND',
  });

  // L-shaped route around an obstacle at (1,2)
  const path = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 2 },
  ];
  timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_scout', unitType: 'SOLDIER', owner: 0, path },
    { kind: 'sound', sound: 'move' },
  ]);

  assert.equal(timeline.hasActiveMove('u_scout'), true);

  // Midpoint of first segment (1,1 -> 2,1): stays on y = 1 (never cutting diagonally toward (3,2)!)
  advance(48, 16);
  const poseSeg1 = timeline.getUnitMovePose('u_scout', false);
  const poseReduced = timeline.getUnitMovePose('u_scout', true);
  assert.ok(poseSeg1 !== null);
  assert.equal(poseSeg1.y, 1 * TILE_SIZE, 'segment 1 follows tile grid horizontally without cutting corners');
  assert.ok(poseSeg1.x > 1 * TILE_SIZE && poseSeg1.x < 2 * TILE_SIZE);
  assert.ok(poseSeg1.strideBobPx > 0.5, 'normal motion includes stride bob');
  assert.equal(poseReduced?.strideBobPx, 0, 'reduced motion suppresses stride bob');
  assert.equal(poseReduced?.scaleX, 1, 'reduced motion suppresses squash-stretch');

  // Complete full march
  advance(computeMarchDurationMs(3) + 40, 16);
  assert.equal(timeline.hasActiveMove('u_scout'), false);

  const presets = particles.map(p => p.req.preset);
  assert.ok(presets.includes('leafBurst'), 'FOREST tile emits green leaf flecks');
  assert.ok(presets.includes('waterRipple'), 'BRIDGE tile emits teal water ripple');
  assert.ok(particles.some(p => p.req.preset === 'dustPuff' && p.req.color === terrainFootstepPreset('SAND').color), 'SAND tile emits warm sand dust');
});

test('FxTimeline choreographs compound MOVE -> lethal LAND MINE with pending-death presence until arrival', () => {
  const { timeline, sounds, particles, popups, pendingDeaths, removedPendingDeaths, advance } = createHarness({
    '1,1': 'PLAINS',
    '2,1': 'PLAINS',
    '3,1': 'PLAINS',
    '4,1': 'PLAINS',
  });

  const path = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
  ];
  const marchMs = computeMarchDurationMs(3); // 285ms

  timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_victim', unitType: 'SOLDIER', owner: 1, path, haltedAt: 3 },
    { kind: 'mineBlast', at: { x: 4, y: 1 }, damage: 8, victimUnitId: 'u_victim', victimDead: true },
    { kind: 'sound', sound: 'explosion' },
    { kind: 'popup', at: { x: 4, y: 1 }, text: 'LAND MINE!', color: '#EF4444', lift: 34 },
    { kind: 'popup', at: { x: 4, y: 1 }, text: '-8', color: '#FF6D00', lift: 14 },
    { kind: 'shake', intensity: 9, at: { x: 4, y: 1 } },
    { kind: 'killed', unitId: 'u_victim', unitType: 'SOLDIER', owner: 1, rank: 0, at: { x: 4, y: 1 }, cause: 'MINE', killerOwner: 0 },
  ]);

  // At t = 0: victim stays alive visually via PendingDeath & marches; mine has NOT exploded yet!
  assert.ok(pendingDeaths.has('u_victim'), 'dying mover stays visible while marching onto mine');
  assert.equal(sounds.filter(s => s.sound === 'explosion').length, 0, 'explosion SFX waits until unit reaches mine tile');
  assert.equal(particles.filter(p => p.req.preset === 'explosion').length, 0);
  assert.equal(popups.length, 0);
  assert.equal(timeline.getTrauma(), 0);

  // Halfway along path: still marching, still no detonation
  advance(Math.floor(marchMs * 0.5), 16);
  assert.ok(pendingDeaths.has('u_victim'));
  assert.equal(particles.filter(p => p.req.preset === 'explosion').length, 0);

  // Cross arrival time: mine detonates, victim disappears cleanly, popups stagger!
  advance(marchMs, 16);
  assert.equal(pendingDeaths.has('u_victim'), false, 'pending death releases right as mine detonates');
  assert.equal(removedPendingDeaths.length, 1);
  assert.ok(removedPendingDeaths[0].at >= marchMs);
  assert.equal(sounds.filter(s => s.sound === 'explosion').length, 1);
  assert.equal(particles.filter(p => p.req.preset === 'explosion').length, 1);
  assert.equal(popups.length, 2, 'LAND MINE! and -8 both spawn with stagger');
  assert.ok(popups[1].at > popups[0].at, 'damage number staggers cleanly after LAND MINE! header');
});

test('FxTimeline choreographs compound MOVE -> OVERWATCH pin-resisted pause and continuation', () => {
  const { timeline, sounds, projectiles, deferredHp, advance } = createHarness();
  const path = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 3, y: 1 },
    { x: 4, y: 1 },
    { x: 5, y: 1 },
  ];

  timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_breacher', unitType: 'ASSAULTER', owner: 0, path },
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: { x: 2, y: 4 }, to: { x: 2, y: 1 }, style: 'BULLET', weapon: 'SOLDIER', attackerId: 'u_ow', targetUnitId: 'u_breacher' },
    { kind: 'hit', targetUnitId: 'u_breacher', at: { x: 2, y: 1 }, from: { x: 2, y: 4 }, damage: 3, weapon: 'SOLDIER', isKill: false },
    { kind: 'popup', at: { x: 2, y: 1 }, text: '-3', color: '#FF6D00', lift: 12 },
    { kind: 'popup', at: { x: 5, y: 1 }, text: 'PIN RESISTED!', color: '#4CAF50', lift: 26 },
    { kind: 'shake', intensity: 5, at: { x: 2, y: 1 } },
  ]);

  assert.equal(deferredHp['u_breacher'], 3, 'breacher HP defers until overwatch shot lands');
  advance(260, 16);
  assert.equal(projectiles.length, 1);
  assert.ok(sounds.some(s => s.sound === 'hit'));
  assert.equal(deferredHp['u_breacher'], undefined, 'deferred HP drops once overwatch shot hits');

  // Breacher finishes marching all the way to (5,1)
  advance(600, 16);
  assert.equal(timeline.hasActiveMove('u_breacher'), false);
});

test('FxTimeline holds stationary lethal SNIPER target until rail beam lands and clears cleanly on reset', () => {
  const { timeline, pendingDeaths, removedPendingDeaths, particles, getClearedCount, advance } = createHarness();
  const from = { x: 1, y: 1 };
  const to = { x: 8, y: 1 };
  const travelMs = estimateProjectileTravelMs(from, to, 'LASER', 'SNIPER');

  timeline.dispatchGameEvents([
    { kind: 'sound', sound: 'sniper' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from, to, style: 'LASER', weapon: 'SNIPER', attackerId: 'u_snp', targetUnitId: 'u_vic' },
    { kind: 'hit', targetUnitId: 'u_vic', at: to, from, damage: 9, weapon: 'SNIPER', isKill: true },
    { kind: 'killed', unitId: 'u_vic', unitType: 'SOLDIER', owner: 1, rank: 1, at: to, cause: 'COMBAT', killerOwner: 0 },
    { kind: 'shake', intensity: 12, at: to },
  ]);

  assert.ok(pendingDeaths.has('u_vic'), 'lethal target stays rendered during sniper beam travel');
  advance(Math.floor(travelMs * 0.5), 16);
  assert.ok(pendingDeaths.has('u_vic'));

  advance(travelMs + 32, 16);
  assert.equal(pendingDeaths.has('u_vic'), false, 'lethal target removed right at sniper impact');
  assert.equal(removedPendingDeaths.length, 1);
  assert.ok(particles.some(p => p.req.preset === 'shockwaveRing'));

  // Test Base destruction secondary blasts + clear()
  timeline.dispatchGameEvents([
    { kind: 'projectile', from: { x: 1, y: 1 }, to: { x: 3, y: 1 }, style: 'MISSILE', weapon: 'SIEGE' },
    { kind: 'structureHit', at: { x: 3, y: 1 }, structureType: 'BASE', damage: 10, destroyed: true, owner: 1 },
    { kind: 'shake', intensity: 18, at: { x: 3, y: 1 } },
  ]);
  advance(750, 16);
  assert.equal(particles.filter(p => p.req.preset === 'explosion').length, 3);

  let leaked = false;
  timeline.schedule(100, () => { leaked = true; });
  timeline.addTrauma(0.9);
  timeline.clear();

  assert.equal(timeline.isActive(), false);
  assert.equal(timeline.getTrauma(), 0);
  assert.equal(getClearedCount(), 1);
  advance(300, 16);
  assert.equal(leaked, false);
});

test('computeMarchDurationMs caps long marches cleanly for AI cadence', () => {
  assert.equal(computeMarchDurationMs(0), 0);
  assert.equal(computeMarchDurationMs(1), 160);
  assert.equal(computeMarchDurationMs(3), 285);
  assert.equal(computeMarchDurationMs(10), 520);
});

test('FxTimeline transitions lethal Ace hit into 550ms death ghost, scorch decal, ember burst, and ACE DOWN! banner', () => {
  const {
    timeline,
    pendingDeaths,
    deathGhosts,
    removedDeathGhosts,
    tileEffects,
    removedTileEffects,
    particles,
    callouts,
    getKillConfirmCount,
    advance,
  } = createHarness();

  const from = { x: 1, y: 2 };
  const to = { x: 6, y: 2 };
  const travelMs = estimateProjectileTravelMs(from, to, 'LASER', 'SNIPER');

  timeline.dispatchGameEvents([
    { kind: 'projectile', from, to, style: 'LASER', weapon: 'SNIPER', attackerId: 'u_snp', targetUnitId: 'u_ace' },
    { kind: 'hit', targetUnitId: 'u_ace', at: to, from, damage: 10, weapon: 'SNIPER', isKill: true },
    { kind: 'killed', unitId: 'u_ace', unitType: 'ASSAULTER', owner: 1, rank: 3, at: to, killerOwner: 0, cause: 'COMBAT' },
  ]);

  // While beam is in flight: live pending-death sprite holds; no ghost or banner yet
  assert.ok(pendingDeaths.has('u_ace'));
  assert.equal(deathGhosts.length, 0);
  assert.equal(callouts.length, 0);

  // Beam lands: pending death releases -> 550ms death ghost + scorch + deathBurst + kill confirm + ACE DOWN!
  advance(travelMs + 32, 16);
  assert.equal(pendingDeaths.has('u_ace'), false);
  assert.equal(deathGhosts.length, 1);
  assert.equal(deathGhosts[0].req.durationMs, DEATH_GHOST_DURATION_MS);
  assert.equal(tileEffects.filter(t => t.req.kind === 'scorch').length, 1);
  assert.equal(particles.filter(p => p.req.preset === 'deathBurst').length, 1);
  assert.equal(getKillConfirmCount(), 1);
  assert.equal(callouts.length, 1);
  assert.equal(callouts[0].req.headline, 'ACE DOWN!');
  assert.equal(callouts[0].req.tone, 'ace');
  assert.equal(callouts[0].req.priority, 3);
  assert.equal(callouts[0].req.accentPlayer, 0);

  // After 550ms death ghost + hit-stop: death ghost removes cleanly
  advance(DEATH_GHOST_DURATION_MS + 100, 16);
  assert.equal(removedDeathGhosts.length, 1);

  // After scorch decal fades: all effects removed and timeline settles cleanly for ECO 0% idle GPU
  advance(1500, 16);
  assert.equal(removedTileEffects.length, 1);
  assert.equal(timeline.isActive(), false);
});

test('FxTimeline emits mineFlash, BASE BREACHED!, VAULT BREACHED!, captureWave, and spawnBeam micro-FX', () => {
  const { timeline, tileEffects, removedTileEffects, callouts, particles, advance } = createHarness();

  // 1. Land Mine triggers single-pulse red tile flash + crater scorch + 45ms kill hit-stop
  timeline.dispatchGameEvents([
    { kind: 'mineBlast', at: { x: 4, y: 4 }, damage: 8, victimUnitId: 'u1', victimDead: true },
    { kind: 'killed', unitId: 'u1', unitType: 'SOLDIER', owner: 1, rank: 0, at: { x: 4, y: 4 }, killerOwner: 0, cause: 'MINE' },
  ]);
  assert.equal(tileEffects.filter(t => t.req.kind === 'mineFlash').length, 1);
  assert.ok(tileEffects.filter(t => t.req.kind === 'scorch').length >= 1);
  assert.equal(callouts[0]?.req.headline, 'MINE KILL!');

  // Clear 45ms hit-stop before next action
  advance(64, 16);

  // 2. Bank heist triggers VAULT BREACHED! callout
  timeline.dispatchGameEvents([{ kind: 'heist', at: { x: 7, y: 7 }, playerId: 0 }]);
  assert.ok(callouts.some(c => c.req.headline === 'VAULT BREACHED!' && c.req.tone === 'heist'));

  // 3. Base destruction triggers BASE BREACHED! with attacker faction accent
  timeline.dispatchGameEvents([
    { kind: 'projectile', from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, style: 'MISSILE', weapon: 'SIEGE' },
    { kind: 'structureHit', at: { x: 2, y: 1 }, structureType: 'BASE', damage: 10, destroyed: true, owner: 1, attackerOwner: 0 },
  ]);
  advance(350, 16);
  assert.ok(callouts.some(c => c.req.headline === 'BASE BREACHED!' && c.req.accentPlayer === 0 && c.req.priority === 3));

  // Clear base breach hit-stop before next action
  advance(64, 16);

  // 4. Capture & Redeploy emit ground-plane waves + capturePulse particles
  timeline.dispatchGameEvents([
    { kind: 'capture', at: { x: 3, y: 3 }, owner: 0, subType: 'WATCHTOWER' },
    { kind: 'spawn', unitId: 'u_new', unitType: 'SOLDIER', owner: 0, at: { x: 1, y: 2 } },
  ]);
  assert.equal(tileEffects.filter(t => t.req.kind === 'captureWave').length, 1);
  assert.equal(tileEffects.filter(t => t.req.kind === 'spawnBeam').length, 1);
  assert.equal(particles.filter(p => p.req.preset === 'capturePulse').length, 2);

  // Settle all effects cleanly back to idle
  advance(2500, 16);
  assert.equal(removedTileEffects.length, tileEffects.length);
  assert.equal(timeline.isActive(), false);
});

test('FxTimeline drives parachute supply drops, promotion chevron bursts, and 3-wave heist coin fountains', () => {
  const {
    timeline,
    supplyDrops,
    removedSupplyDrops,
    promotionBursts,
    removedPromotionBursts,
    particles,
    advance,
  } = createHarness();

  // 1. Parachute supply drop descends then triggers touchdown ring + dust at landing
  timeline.dispatchGameEvents([
    { kind: 'supplyLanded', at: { x: 5, y: 5 }, item: 'MEDKIT' },
  ]);
  assert.equal(supplyDrops.length, 1);
  assert.equal(supplyDrops[0].req.durationMs, SUPPLY_DROP_DURATION_MS);
  assert.equal(particles.filter(p => p.req.preset === 'dustPuff').length, 0, 'touchdown puff waits for landing');

  advance(SUPPLY_DROP_DURATION_MS + 32, 16);
  assert.equal(removedSupplyDrops.length, 1);
  assert.equal(particles.filter(p => p.req.preset === 'dustPuff').length, 1);
  assert.equal(particles.filter(p => p.req.preset === 'shockwaveRing').length, 1);

  // 2. Promotion spawns golden chevron burst with earned rank + sparkles
  timeline.dispatchGameEvents([
    { kind: 'promotion', unitId: 'u_ace', at: { x: 3, y: 4 }, rank: 3, label: 'ACE ★★★' },
  ]);
  assert.equal(promotionBursts.length, 1);
  assert.equal(promotionBursts[0].req.rank, 3);
  assert.equal(promotionBursts[0].req.durationMs, PROMOTION_BURST_DURATION_MS);

  advance(PROMOTION_BURST_DURATION_MS + 32, 16);
  assert.equal(removedPromotionBursts.length, 1);

  // 3. Bank heist emits a 3-wave golden coin fountain (0ms, +95ms, +190ms)
  const goldBefore = particles.filter(p => p.req.preset === 'goldBurst').length;
  timeline.dispatchGameEvents([{ kind: 'heist', at: { x: 8, y: 8 }, playerId: 1 }]);
  assert.equal(particles.filter(p => p.req.preset === 'goldBurst').length - goldBefore, 1);
  advance(240, 16);
  assert.equal(particles.filter(p => p.req.preset === 'goldBurst').length - goldBefore, 3);

  assert.equal(timeline.isActive(), false);
});

test('FxTimeline routes unit-specific realistic Foley (pistol, tank blast missile, tank treads, Base rotating MG burst)', () => {
  const timeline = new FxTimeline();
  const weaponFires: string[] = [];
  const weaponImpacts: string[] = [];
  const unitMoves: string[] = [];
  const particles: ParticleEmitRequest[] = [];
  const tileEffects: TileEffectRequest[] = [];

  timeline.configure({
    playWeaponFire: (w) => weaponFires.push(w),
    playWeaponImpact: (w) => weaponImpacts.push(w),
    playUnitMove: (u) => unitMoves.push(u),
    emitParticles: (req) => particles.push(req),
    spawnTileEffect: (fx) => tileEffects.push(fx),
    hasActiveParticles: () => false,
  });

  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 16) timeline.step(Math.min(16, ms - t));
  };

  // 1. Breacher movement routes to ASSAULTER tank treads; Scout routes to SOLDIER footsteps
  timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_tank', unitType: 'ASSAULTER', owner: 0, path: [{ x: 1, y: 1 }, { x: 2, y: 1 }] },
    { kind: 'sound', sound: 'move' },
  ]);
  timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_scout', unitType: 'SOLDIER', owner: 0, path: [{ x: 3, y: 1 }, { x: 4, y: 1 }] },
    { kind: 'sound', sound: 'move' },
  ]);
  assert.deepEqual(unitMoves, ['ASSAULTER', 'SOLDIER']);
  advance(320);

  // 2. Breacher attack fires tank cannon + missile launch backblast, then erupts in full blast explosion + crater on impact
  const tankTravel = estimateProjectileTravelMs({ x: 2, y: 1 }, { x: 4, y: 1 }, 'BULLET', 'ASSAULTER');
  timeline.dispatchGameEvents([
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: { x: 2, y: 1 }, to: { x: 4, y: 1 }, style: 'BULLET', weapon: 'ASSAULTER', attackerId: 'u_tank', targetUnitId: 'u_enemy' },
    { kind: 'hit', targetUnitId: 'u_enemy', at: { x: 4, y: 1 }, from: { x: 2, y: 1 }, damage: 6, weapon: 'ASSAULTER', isKill: false },
  ]);
  assert.deepEqual(weaponFires, ['ASSAULTER']);
  assert.equal(weaponImpacts.length, 0);
  advance(tankTravel + 64);
  assert.deepEqual(weaponImpacts, ['ASSAULTER']);
  assert.ok(particles.some(p => p.preset === 'explosion'), 'breacher tank shell triggers blast explosion on impact');
  assert.ok(tileEffects.some(t => t.kind === 'scorch'), 'breacher tank shell leaves crater scorch');
  advance(1500);

  // 3. Base Defense (ARTILLERY) locks rotating MG turret onto target, kicks alternating barrels, and fires 6-round MG burst
  const muzzleBefore = particles.filter(p => p.preset === 'muzzleFlash').length;
  timeline.dispatchGameEvents([
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: { x: 1, y: 1 }, to: { x: 5, y: 1 }, style: 'MISSILE', weapon: 'ARTILLERY', targetUnitId: 'u_enemy' },
    { kind: 'hit', targetUnitId: 'u_enemy', at: { x: 5, y: 1 }, from: { x: 1, y: 1 }, damage: 4, weapon: 'ARTILLERY' },
  ]);
  assert.equal(weaponFires[weaponFires.length - 1], 'ARTILLERY');
  assert.equal(timeline.hasActiveBaseTurret(), true);
  const turretStart = timeline.getBaseTurretState(1, 1);
  assert.ok(turretStart !== null);
  assert.ok(Math.abs(turretStart.aimAngle - 0) < 0.01, 'turret aims directly East toward target at (5,1)');
  assert.equal(turretStart.firingSide, -1, 'starts firing left barrel');

  advance(64);
  const turretRight = timeline.getBaseTurretState(1, 1);
  assert.equal(turretRight?.firingSide, 1, 'alternates to right barrel on second round');

  advance(350);
  assert.equal(particles.filter(p => p.preset === 'muzzleFlash').length - muzzleBefore, 6, 'base MG fires 6 staggered muzzle flashes');

  // Settles back to idle so ECO sleeps at 0% GPU
  advance(900);
  assert.equal(timeline.hasActiveBaseTurret(), false);
  assert.equal(timeline.isActive(), false);
});

test('FxTimeline sequences multi-target HQ sweeps one target after another with turret slewing, swivel SFX, and per-target impact sync', () => {
  const timeline = new FxTimeline();
  const weaponFires: { at: number; weapon: string; burstRounds?: number }[] = [];
  const weaponImpacts: { at: number; weapon: string; burstRounds?: number }[] = [];
  const turretSwivels: number[] = [];
  const projectiles: { at: number; req: ProjectileSpawnRequest }[] = [];
  const popups: { at: number; req: PopupSpawnRequest }[] = [];
  const deferredHp: Record<string, number> = {};
  const pendingDeaths = new Map<string, PendingDeathVisual>();
  const deathGhosts: { at: number; req: DeathGhostRequest }[] = [];
  const callouts: { at: number; req: TacticalCalloutRequest }[] = [];

  timeline.configure({
    playWeaponFire: (w, burstRounds) => weaponFires.push({ at: timeline.getClockMs(), weapon: w, burstRounds }),
    playWeaponImpact: (w, burstRounds) => weaponImpacts.push({ at: timeline.getClockMs(), weapon: w, burstRounds }),
    playTurretSwivel: () => turretSwivels.push(timeline.getClockMs()),
    spawnProjectile: (req) => projectiles.push({ at: timeline.getClockMs(), req }),
    spawnPopup: (req) => popups.push({ at: timeline.getClockMs(), req }),
    addDeferredHp: (uid, amt) => {
      deferredHp[uid] = (deferredHp[uid] ?? 0) + amt;
    },
    clearDeferredHp: (uid, amt) => {
      const next = (deferredHp[uid] ?? 0) - amt;
      if (next <= 0) delete deferredHp[uid];
      else deferredHp[uid] = next;
    },
    addPendingDeath: (ghost) => { pendingDeaths.set(ghost.unitId, ghost); },
    removePendingDeath: (unitId) => { pendingDeaths.delete(unitId); },
    spawnDeathGhost: (req) => deathGhosts.push({ at: timeline.getClockMs(), req }),
    showCallout: (req) => callouts.push({ at: timeline.getClockMs(), req }),
    hasActiveParticles: () => false,
  });

  const advance = (totalMs: number) => {
    let rem = totalMs;
    while (rem > 0) {
      const step = Math.min(16, rem);
      timeline.step(step);
      rem -= step;
    }
  };

  const base = { x: 1, y: 1 };
  const targetA = { x: 5, y: 1 }; // East (0 rad), survives -4
  const targetB = { x: 1, y: 5 }; // South (+pi/2 rad), killed -2
  const targetC = { x: 3, y: 3 }; // SE (+pi/4 rad), survives -2 + suppressed

  const sweepEvents: GameEvent[] = [
    // Target A (Primary)
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: base, to: targetA, style: 'MISSILE', weapon: 'ARTILLERY', targetUnitId: 'u_a' },
    { kind: 'hit', targetUnitId: 'u_a', at: targetA, from: base, damage: 4, weapon: 'ARTILLERY', isKill: false },
    { kind: 'popup', at: targetA, text: '-4', color: '#FF5722', lift: 14 },
    { kind: 'shake', intensity: 4, at: targetA },
    // Target B (Splash kill)
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: base, to: targetB, style: 'MISSILE', weapon: 'ARTILLERY', targetUnitId: 'u_b' },
    { kind: 'hit', targetUnitId: 'u_b', at: targetB, from: base, damage: 2, weapon: 'ARTILLERY', isKill: true },
    { kind: 'popup', at: targetB, text: '-2', color: '#FF5722', lift: 14 },
    { kind: 'shake', intensity: 10, at: targetB },
    { kind: 'killed', unitId: 'u_b', unitType: 'SOLDIER', owner: 1, rank: 0, at: targetB, cause: 'ARTILLERY' },
    // Target C (Splash + Overwatch suppressed)
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: base, to: targetC, style: 'MISSILE', weapon: 'ARTILLERY', targetUnitId: 'u_c' },
    { kind: 'hit', targetUnitId: 'u_c', at: targetC, from: base, damage: 2, weapon: 'ARTILLERY', isKill: false, suppressed: true },
    { kind: 'popup', at: targetC, text: '-2', color: '#FF5722', lift: 14 },
    { kind: 'shake', intensity: 4, at: targetC },
    { kind: 'popup', at: targetC, text: 'SUPPRESSED!', color: '#FF9800', lift: 30 },
  ];

  timeline.dispatchGameEvents(sweepEvents);

  // t = 0: Only Target A opens fire with a 4-round sweep burst; B & C wait their turn!
  assert.equal(projectiles.length, 1);
  assert.equal(projectiles[0].req.burstRounds, 4);
  assert.equal(weaponFires.length, 1);
  assert.equal(weaponFires[0].weapon, 'ARTILLERY');
  assert.equal(weaponFires[0].burstRounds, 4);
  assert.equal(turretSwivels.length, 0);
  assert.equal(deferredHp['u_a'], 4);
  assert.equal(deferredHp['u_c'], 2);
  assert.equal(pendingDeaths.has('u_b'), true, 'Target B stays visually alive until turret sweeps to it');
  assert.equal(popups.length, 0);

  const turretAtA = timeline.getBaseTurretState(1, 1);
  assert.ok(turretAtA !== null);
  assert.ok(Math.abs(turretAtA.aimAngle - 0) < 0.01, 'turret opens aimed East at Target A');
  assert.equal(turretAtA.firingSide, -1);

  // After Target A impact (~140ms): u_a HP drops & -4 popup spawns; Target B & C untouched
  advance(160);
  assert.equal(deferredHp['u_a'], undefined, 'Target A HP drops right on first burst arrival');
  assert.equal(deferredHp['u_c'], 2, 'Target C HP stays held until its own turn');
  assert.equal(pendingDeaths.has('u_b'), true, 'Target B stays alive before second burst');
  assert.equal(projectiles.length, 1);
  assert.equal(popups.length, 1);
  assert.equal(popups[0].req.value, '-4');

  // Pre-aim slew window (~270ms): turret slews South onto Target B with swivel SFX before opening fire
  advance(110);
  assert.equal(turretSwivels.length, 1, 'servo swivel plays while rotating from Target A to Target B');
  assert.equal(projectiles.length, 1, 'Target B burst has not started yet during pre-aim slew');
  const turretSlewingB = timeline.getBaseTurretState(1, 1);
  assert.ok(turretSlewingB !== null);
  assert.ok(Math.abs(turretSlewingB.aimAngle - Math.PI / 2) < 0.01, 'turret aims South at Target B during slew');
  assert.equal(turretSlewingB.firingSide, 0, 'barrels hold fire during slew');

  // Advance through Target B launch + impact (+ 42ms kill hit-stop): Target B dies & spawns ghost!
  advance(320);
  assert.equal(projectiles.length, 2, 'Target B burst launched sequentially');
  assert.ok(
    projectiles[1].at >= 360 && projectiles[1].at <= 380,
    'Target B fires on 360ms 3-target sweep stride',
  );
  assert.equal(projectiles[1].req.burstRounds, 4);
  assert.equal(pendingDeaths.has('u_b'), false, 'Target B releases pending death on impact');
  assert.equal(deathGhosts.length, 1);
  assert.equal(callouts.some(c => c.req.headline === 'ELIMINATED!'), true);
  assert.equal(deferredHp['u_c'], 2, 'Target C still waits for third burst');

  // Advance into Target C slew window + launch + impact
  advance(500);
  assert.equal(turretSwivels.length, 2, 'second servo swivel plays while rotating from Target B to Target C');
  assert.equal(projectiles.length, 3, 'Target C burst launched third');
  assert.ok(projectiles[0].at < projectiles[1].at && projectiles[1].at < projectiles[2].at, 'all 3 targets fire strictly sequentially');
  assert.equal(weaponFires.length, 3);
  assert.equal(weaponImpacts.length, 3);
  assert.equal(deferredHp['u_c'], undefined, 'Target C HP drops once third burst lands');
  assert.ok(popups.some(p => p.req.value === 'SUPPRESSED!'), 'Target C suppression callout spawns after third burst');

  const turretAtC = timeline.getBaseTurretState(1, 1);
  assert.ok(turretAtC !== null);
  assert.ok(Math.abs(turretAtC.aimAngle - Math.PI / 4) < 0.01, 'turret finishes aimed SE at Target C');

  // Full cooldown returns timeline & turret to idle (0% ECO GPU)
  advance(2600);
  assert.equal(timeline.hasActiveBaseTurret(), false);
  assert.equal(timeline.isActive(), false);
});

test('FxTimeline sequences Bank Turret laser before multi-target HQ artillery without overlapping', () => {
  const timeline = new FxTimeline();
  const weaponFires: { at: number; weapon: string; burstRounds?: number }[] = [];
  const weaponImpacts: { at: number; weapon: string }[] = [];
  const turretSwivels: number[] = [];

  timeline.configure({
    playWeaponFire: (w, burstRounds) => weaponFires.push({ at: timeline.getClockMs(), weapon: w, burstRounds }),
    playWeaponImpact: (w) => weaponImpacts.push({ at: timeline.getClockMs(), weapon: w }),
    playTurretSwivel: () => turretSwivels.push(timeline.getClockMs()),
    hasActiveParticles: () => false,
  });

  const advance = (totalMs: number) => {
    for (let t = 0; t < totalMs; t += 16) timeline.step(Math.min(16, totalMs - t));
  };

  timeline.dispatchGameEvents([
    // Bank Turret fires first
    { kind: 'sound', sound: 'sniper' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: { x: 7, y: 7 }, to: { x: 7, y: 5 }, style: 'LASER', weapon: 'TURRET', targetUnitId: 'u_bank_vic' },
    { kind: 'hit', targetUnitId: 'u_bank_vic', at: { x: 7, y: 5 }, from: { x: 7, y: 7 }, damage: 3, weapon: 'TURRET' },
    // Base HQ follows with 2 targets
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: { x: 1, y: 1 }, to: { x: 3, y: 1 }, style: 'MISSILE', weapon: 'ARTILLERY', targetUnitId: 'u_hq1' },
    { kind: 'hit', targetUnitId: 'u_hq1', at: { x: 3, y: 1 }, from: { x: 1, y: 1 }, damage: 4, weapon: 'ARTILLERY' },
    { kind: 'sound', sound: 'attack' },
    { kind: 'sound', sound: 'hit' },
    { kind: 'projectile', from: { x: 1, y: 1 }, to: { x: 1, y: 3 }, style: 'MISSILE', weapon: 'ARTILLERY', targetUnitId: 'u_hq2' },
    { kind: 'hit', targetUnitId: 'u_hq2', at: { x: 1, y: 3 }, from: { x: 1, y: 1 }, damage: 2, weapon: 'ARTILLERY' },
  ]);

  advance(1200);

  assert.deepEqual(weaponFires.map(f => f.weapon), ['TURRET', 'ARTILLERY', 'ARTILLERY']);
  assert.deepEqual(weaponImpacts.map(i => i.weapon), ['TURRET', 'ARTILLERY', 'ARTILLERY']);
  assert.equal(weaponFires[0].at, 0);
  assert.ok(weaponFires[1].at >= 230, 'Base HQ waits for Bank Turret shot to finish before opening fire');
  assert.ok(weaponFires[2].at >= weaponFires[1].at + 380, 'Base HQ second target fires after first burst + slew');
  assert.equal(turretSwivels.length, 1, 'servo swivel plays once between HQ Target 1 and HQ Target 2');
});
