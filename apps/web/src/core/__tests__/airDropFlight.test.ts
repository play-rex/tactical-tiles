import assert from 'node:assert/strict';
import test from 'node:test';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { computeAirDropFlight, sampleAirDropFlight } from '../graphics/airDropFlight';
import { FxTimeline, type AirDropAnimRequest } from '../graphics/fxTimeline';

test('computeAirDropFlight calculates exact edge-to-edge paths, longer approaches, and clamped airspeed across board sizes', () => {
  for (const gridSize of [16, 20, 25]) {
    const plan = computeAirDropFlight({
      at: { x: 2, y: 2 }, // Corner LZ: must flip to longer approach!
      headingRad: 0.25,
      gridSize,
      dropKind: 'FIELD',
    });
    assert.ok(plan.dIn >= (plan.dIn + plan.dOut) * 0.44, `grid ${gridSize}: selects longer visible approach`);
    assert.ok(plan.approachMs >= 2200 && plan.approachMs <= 3500, `grid ${gridSize}: longer approachMs clamped (${plan.approachMs})`);
    assert.ok(plan.exitMs >= 2400 && plan.exitMs <= 4800, `grid ${gridSize}: longer exitMs clamped (${plan.exitMs})`);
    assert.ok(plan.rampOpenMs > 0 && plan.rampOpenMs < plan.releaseMs);
    assert.equal(plan.releaseMs, plan.approachMs);
    assert.equal(plan.chuteMs, 2150);
    assert.equal(plan.touchdownMs, plan.releaseMs + plan.chuteMs);
    assert.ok(plan.totalMs >= plan.touchdownMs + 280);
    assert.ok(plan.planeEndMs >= 4600, 'full edge-to-edge flight runs long and smooth (~5–8s)');

    // At releaseMs, plane is exactly over the LZ!
    const atRelease = sampleAirDropFlight(plan, plan.releaseMs);
    assert.ok(Math.abs(atRelease.planeX - plan.lzX) < 1, 'plane crosses exact LZ at releaseMs');
    assert.ok(Math.abs(atRelease.planeY - plan.lzY) < 1);
    assert.equal(atRelease.chuteVisible, true);
    assert.equal(atRelease.touchedDown, false);

    // Right after cargo release, plane keeps cruising away while chute is descending
    const midDrop = sampleAirDropFlight(plan, plan.releaseMs + 400);
    assert.equal(midDrop.planeVisible, true, 'plane keeps flying away smoothly after releasing payload');
    assert.equal(midDrop.chuteVisible, true);

    // At touchdownMs, crate has descended to exact LZ center with altitude 0!
    const atTouch = sampleAirDropFlight(plan, plan.touchdownMs);
    assert.equal(atTouch.touchedDown, true);
    assert.equal(atTouch.crateAltitude, 0);
    assert.ok(Math.abs(atTouch.crateX - plan.lzX) < 0.5);
    assert.ok(Math.abs(atTouch.crateY - plan.lzY) < 0.5);
  }

  // On a mid-board LZ (20x20), the exit tail extends past crate touchdown for lively ambient flyout!
  const midPlan = computeAirDropFlight({
    at: { x: 10, y: 10 },
    headingRad: -0.35,
    gridSize: 20,
    dropKind: 'FIELD',
  });
  assert.equal(
    sampleAirDropFlight(midPlan, midPlan.touchdownMs).planeVisible,
    true,
    'mid-board plane continues ambient exit cruise after crate touchdown',
  );

  // Tactical Heavy Lifter uses slower cruise & longer twin-chute descent
  const tacPlan = computeAirDropFlight({
    at: { x: 10, y: 10 },
    headingRad: -0.35,
    gridSize: 20,
    dropKind: 'TACTICAL',
  });
  assert.equal(tacPlan.chuteMs, 2500);
  const reduced = computeAirDropFlight({
    at: { x: 10, y: 10 },
    headingRad: -0.35,
    gridSize: 20,
    dropKind: 'FIELD',
    reducedMotion: true,
  });
  assert.equal(reduced.approachMs, 680);
  assert.equal(reduced.chuteMs, 650);
  assert.equal(sampleAirDropFlight(reduced, reduced.releaseMs + 200, true).swayPx, 0, 'zero sway under reduced motion');
});

test('FxTimeline choreographs dual-convoy air drops with ZERO camera hijack, deferred crate reveal, and clean idle settle', () => {
  const timeline = new FxTimeline();
  timeline.setKillCamMode('FULL'); // Even with FULL kill-cam ON, supply drops must NEVER hijack camera!
  const spawned: AirDropAnimRequest[] = [];
  const ambiented: string[] = [];
  const removed: string[] = [];
  const hiddenTiles = new Set<string>();
  const sounds: string[] = [];

  timeline.configure({
    getGridSize: () => 20,
    spawnAirDrop: anim => spawned.push(anim),
    completeAirDropTouchdown: id => ambiented.push(id),
    removeAirDrop: id => removed.push(id),
    addPendingAirDropTile: tid => hiddenTiles.add(tid),
    removePendingAirDropTile: tid => hiddenTiles.delete(tid),
    playAirDrop: (kind, stage) => sounds.push(`${kind}:${stage}`),
    hasActiveParticles: () => false,
  });

  timeline.dispatchGameEvents([
    {
      kind: 'airDrop',
      dropId: 'r6_field',
      dropKind: 'FIELD',
      at: { x: 6, y: 8 },
      headingRad: -0.3,
      staggerMs: 0,
      isDualConvoy: true,
      companionAt: { x: 14, y: 12 },
    },
    {
      kind: 'airDrop',
      dropId: 'r6_tac',
      dropKind: 'TACTICAL',
      at: { x: 14, y: 12 },
      headingRad: 0.45,
      staggerMs: 950,
      isDualConvoy: true,
      companionAt: { x: 6, y: 8 },
    },
  ]);

  // Both grounded crate sprites are hidden immediately, and kill-cam stays completely IDLE!
  assert.equal(timeline.isKillCamActive(), false, 'supply drops never hijack the camera');
  assert.equal(hiddenTiles.has('6,8'), true);
  assert.equal(hiddenTiles.has('14,12'), true);
  assert.equal(spawned.length, 1, 'Field plane spawns at t=0');
  assert.equal(sounds[0], 'FIELD:FLYOVER');

  // Advance 1000ms -> second staggered Tactical Heavy Lifter enters, still zero camera movement!
  for (let i = 0; i < 50; i++) timeline.step(20);
  assert.equal(timeline.isKillCamActive(), false, 'no camera cut during dual convoy');
  assert.equal(spawned.length, 2, 'Tactical Heavy Lifter spawns at +950ms stagger');
  assert.ok(sounds.includes('TACTICAL:FLYOVER'));

  // Advance through both long flights (~9s total) + full exit tails
  for (let i = 0; i < 500; i++) timeline.step(20);
  assert.equal(timeline.isKillCamActive(), false, 'never triggered camera at any point');
  assert.equal(hiddenTiles.size, 0, 'both mystery crates revealed on touchdown');
  assert.equal(ambiented.length, 2, 'both planes completed touchdown cleanly');
  assert.equal(removed.length, 2, 'both planes cleaned up after clearing far map edge');
  assert.ok(sounds.includes('FIELD:DROP') && sounds.includes('FIELD:TOUCHDOWN'));
  assert.ok(sounds.includes('TACTICAL:DROP') && sounds.includes('TACTICAL:TOUCHDOWN'));
  assert.equal(timeline.isActive(), false, 'timeline returns cleanly to 0% idle GPU');
  assert.ok(TILE_SIZE === 64);
});
