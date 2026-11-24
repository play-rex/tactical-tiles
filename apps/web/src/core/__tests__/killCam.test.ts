import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameEvent } from '@tactical/engine';
import { FxTimeline, type TacticalCalloutRequest } from '../graphics/fxTimeline';
import {
  buildReceiptSteps,
  classifyKillTier,
  computeClampedKillCamViewport,
  getKillCamTiming,
  KILL_CAM_TIMING,
  KillCamDirector,
  resolveKillCamNarrative,
  selectKillCamStyle,
  type KillCamCue,
} from '../graphics/killCam';
import { HighlightRecorder, scoreHighlightBatch } from '../graphics/highlightRecorder';
import { isDramaticRecapBatch, RecapPlayer } from '../graphics/recapPlayer';

const makeCue = (overrides: Partial<KillCamCue> = {}): KillCamCue => ({
  id: 1,
  tier: 'CINEMATIC',
  subject: 'KILL',
  cause: 'COMBAT',
  weapon: 'SNIPER',
  victimUnitId: 'u_victim',
  victimUnitType: 'SOLDIER',
  victimOwner: 1,
  victimRank: 3,
  victimName: 'Scout',
  killerOwner: 0,
  damage: 12,
  maxHp: 21,
  overkill: 0,
  crossfireCount: 0,
  distanceTiles: 5,
  terrain: 'FOREST',
  focusX: 400,
  focusY: 300,
  markerX: 100,
  markerY: 300,
  frameW: 409,
  frameH: 96,
  combo: 1,
  travelMs: 160,
  ...overrides,
});

const advance = (director: KillCamDirector, totalMs: number, stepMs = 16) => {
  let left = totalMs;
  while (left > 0) {
    const chunk = Math.min(stepMs, left);
    director.step(chunk);
    left -= chunk;
  }
};

test('classifyKillTier reserves the cinematic cut for kills worth clipping', () => {
  const base = { rank: 0, cause: 'COMBAT' as const, crossfireCount: 0, weapon: 'SOLDIER' as const, distanceTiles: 2, overkill: 0, combo: 1 };
  assert.equal(classifyKillTier(base), 'MICRO');
  assert.equal(classifyKillTier({ ...base, rank: 3 }), 'CINEMATIC');
  assert.equal(classifyKillTier({ ...base, cause: 'OVERWATCH' }), 'CINEMATIC');
  assert.equal(classifyKillTier({ ...base, cause: 'MINE' }), 'CINEMATIC');
  assert.equal(classifyKillTier({ ...base, crossfireCount: 2 }), 'CINEMATIC');
  assert.equal(classifyKillTier({ ...base, weapon: 'SNIPER', distanceTiles: 7 }), 'CINEMATIC');
  assert.equal(classifyKillTier({ ...base, overkill: 11 }), 'CINEMATIC');
  assert.equal(classifyKillTier({ ...base, combo: 2 }), 'CINEMATIC');
  // A close-range pistol kill stays a micro punch even from a sniper rifle.
  assert.equal(classifyKillTier({ ...base, weapon: 'SNIPER', distanceTiles: 2 }), 'MICRO');
});

test('director pushes in during the shot, slams on impact, dilates, then restores real time smoothly', () => {
  const director = new KillCamDirector();
  const cue = makeCue();
  const timing = KILL_CAM_TIMING.CINEMATIC;

  const flightRealMs = director.preRoll(cue);
  assert.ok(flightRealMs > 1000 && flightRealMs <= timing.pushMs, `expected real flight within push ceiling (got ${flightRealMs})`);
  let frame = director.getFrame();
  assert.equal(frame.phase, 'PUSH');
  assert.equal(frame.timeScale, 1, 'the cut starts at real speed');
  assert.equal(frame.letterbox, 0);
  assert.equal(frame.recover, 0);

  advance(director, 100);
  frame = director.getFrame();
  assert.equal(frame.phase, 'PUSH');
  assert.ok(
    frame.timeScale < 1 && frame.timeScale > timing.minPushScale,
    'the world eases into slow motion while the round is still in the air',
  );
  assert.ok(frame.fit > 0 && frame.fit < 0.85, 'push-in commits most of the way to the two-tile crop');
  assert.equal(frame.cameraStyle, 'SNIPER_WHIP');
  assert.ok(
    frame.centerX >= cue.markerX && frame.centerX < cue.focusX,
    'sniper whip starts locked on muzzle then sweeps toward victim',
  );
  // Advance past the muzzle hold window to verify whip-pan sweeps cleanly toward the victim
  advance(director, 750);
  frame = director.getFrame();
  assert.ok(frame.centerX > cue.markerX && frame.centerX < cue.focusX, 'camera whips smoothly between shooter and victim');
  assert.ok(frame.reticle > 0.5, 'reticle closes while the round travels');

  director.impact(cue);
  frame = director.getFrame();
  assert.equal(frame.phase, 'SLAM');
  assert.ok(frame.timeScale <= 0.1, 'impact is a near-freeze');
  assert.ok(frame.flash > 0.5, 'impact flashes');

  advance(director, timing.slamMs + 16);
  frame = director.getFrame();
  assert.equal(frame.phase, 'SLOW');
  assert.equal(frame.timeScale, timing.slowScale);
  assert.equal(frame.letterbox, 1, 'full letterbox during the dilation window');
  assert.ok(frame.fit >= 1, 'the crop is fully committed during the dilation window');

  advance(director, timing.slowMs + 16);
  frame = director.getFrame();
  assert.equal(frame.phase, 'RECOVER');
  assert.ok(frame.timeScale > timing.slowScale && frame.timeScale < 1, 'time eases back, never snaps');
  assert.ok(frame.recover > 0 && frame.recover < 1, 'recover progress eases center back to saved camera');

  advance(director, timing.recoverMs + 32);
  frame = director.getFrame();
  assert.equal(frame.phase, 'IDLE');
  assert.equal(frame.active, false);
  assert.equal(director.getTimeScale(), 1);
  assert.equal(frame.fit, 0);
  assert.equal(frame.letterbox, 0);
  assert.equal(frame.recover, 0);
});

test('director honours reduced motion, escalates combos, and reports letterbox for STRUCTURE cues', () => {
  const reduced = new KillCamDirector();
  reduced.preRoll(makeCue(), true);
  assert.equal(reduced.isActive(), false);
  reduced.impact(makeCue());
  assert.equal(reduced.isActive(), false, 'reduced motion never zooms or dilates');

  const chained = new KillCamDirector();
  chained.preRoll(makeCue({ id: 1 }));
  chained.impact(makeCue({ id: 1 }));
  chained.impact(makeCue({ id: 2 }));
  const frame = chained.getFrame();
  assert.equal(frame.combo, 2);
  assert.equal(frame.phase, 'SLAM', 'a chain re-slams on the newest victim');

  const structure = new KillCamDirector();
  structure.impact(makeCue({ id: 9, tier: 'STRUCTURE', subject: 'STRUCTURE', travelMs: 0 }));
  advance(structure, KILL_CAM_TIMING.STRUCTURE.slamMs + 16);
  assert.equal(structure.getFrame().letterbox, 1, 'STRUCTURE cuts report full letterbox for viewport usableH framing');
});

test('skip() during PUSH cancels immediately and blocks deferred impact from reopening the cut', () => {
  const director = new KillCamDirector();
  const cue = makeCue({ id: 77 });
  director.preRoll(cue);
  assert.equal(director.isActive(), true);

  assert.equal(director.skip(), true);
  assert.equal(director.isActive(), false);
  assert.equal(director.getTimeScale(), 1);

  // Deferred impact for the same cue must NOT re-open the skipped cut.
  assert.equal(director.impact(cue), false);
  assert.equal(director.isActive(), false);
});

const killBatch = (kind: 'ACE' | 'GRUNT'): GameEvent[] => {
  const ace = kind === 'ACE';
  const from = ace ? { x: 1, y: 1 } : { x: 5, y: 1 };
  return [
    {
      kind: 'projectile',
      from,
      to: { x: 6, y: 1 },
      style: ace ? 'LASER' : 'BULLET',
      weapon: ace ? 'SNIPER' : 'SOLDIER',
      targetUnitId: 'u_victim',
      travelMs: 140,
    },
    {
      kind: 'hit',
      targetUnitId: 'u_victim',
      at: { x: 6, y: 1 },
      from,
      damage: 12,
      weapon: ace ? 'SNIPER' : 'SOLDIER',
      isKill: true,
    },
    {
      kind: 'killed',
      unitId: 'u_victim',
      unitType: 'SOLDIER',
      owner: 1,
      rank: ace ? 3 : 0,
      at: { x: 6, y: 1 },
      killerOwner: 0,
      cause: 'COMBAT',
    },
  ];
};

const nonLethalAttackBatch = (): GameEvent[] => [
  {
    kind: 'projectile',
    from: { x: 2, y: 2 },
    to: { x: 5, y: 2 },
    style: 'MISSILE',
    weapon: 'ASSAULTER',
    attackerId: 'u_att',
    targetUnitId: 'u_def',
    travelMs: 180,
  },
  {
    kind: 'hit',
    targetUnitId: 'u_def',
    at: { x: 5, y: 2 },
    from: { x: 2, y: 2 },
    damage: 10,
    weapon: 'ASSAULTER',
  },
];

const buildTimeline = () => {
  const timeline = new FxTimeline();
  const callouts: TacticalCalloutRequest[] = [];
  const stings: { stage: 'IN' | 'HIT'; tier: string; flightRealMs?: number }[] = [];
  let mineClicks = 0;
  let overwatchStatics = 0;
  let grazeSurvives = 0;
  timeline.configure({
    showCallout: (c) => callouts.push(c),
    playKillConfirm: () => {},
    playKillCamSting: (stage, tier, flightRealMs) => stings.push({ stage, tier, flightRealMs }),
    playMineClick: () => { mineClicks++; },
    playOverwatchStatic: () => { overwatchStatics++; },
    playGrazeSurvive: () => { grazeSurvives++; },
    hasActiveParticles: () => false,
    getUnitInfo: (id) =>
      id === 'u_def'
        ? { type: 'ASSAULTER', owner: 1, rank: 2, hp: 5, maxHp: 36 }
        : id === 'u_graze'
          ? { type: 'ASSAULTER', owner: 1, rank: 2, hp: 1, maxHp: 36 }
          : id === 'u_att'
            ? { type: 'ASSAULTER', owner: 0, rank: 0, hp: 30, maxHp: 30 }
            : undefined,
  });
  return {
    timeline,
    callouts,
    stings,
    getMineClicks: () => mineClicks,
    getOverwatchStatics: () => overwatchStatics,
    getGrazeSurvives: () => grazeSurvives,
  };
};

test('FxTimeline dilates the combat clock, computes rank-adjusted maxHp, and caps FULL cinematic <= 4s', () => {
  const { timeline, callouts, stings } = buildTimeline();
  timeline.dispatchGameEvents(killBatch('ACE'));

  const initial = timeline.getKillCamFrame();
  assert.equal(initial.phase, 'PUSH', 'camera moves while the round is in flight');
  // Ace Scout (base 15 + 3 Veteran + 3 Ace = 21 max HP)
  assert.equal(initial.cue?.maxHp, 21, 'Ace maxHp accounts for Veterancy HP bonuses');
  assert.equal(stings[0]?.stage, 'IN');
  assert.ok((stings[0]?.flightRealMs ?? 0) > 1000, 'audio riser receives real flight duration');

  let realMs = 0;
  while (timeline.getKillCamFrame().active && realMs < 15000) {
    timeline.step(10);
    realMs += 10;
  }

  assert.equal(timeline.getKillCamFrame().active, false, 'the cut always ends');
  assert.equal(callouts.length, 0, 'the kill-cam overlay carries the headline instead of a duplicate banner');
  assert.ok(realMs >= 3000 && realMs <= 4100, `FULL cinematic cut should stay <= 4s (ran ${realMs}ms)`);
});

test('SHORT mode runs snappy cuts (~1.5–2.2s cinematic, ~0.8–1.2s micro)', () => {
  const { timeline } = buildTimeline();
  timeline.setKillCamMode('SHORT');
  timeline.dispatchGameEvents(killBatch('ACE'));

  let cinMs = 0;
  while (timeline.getKillCamFrame().active && cinMs < 10000) {
    timeline.step(10);
    cinMs += 10;
  }
  assert.ok(cinMs >= 1350 && cinMs <= 2250, `SHORT cinematic should be ~1.8s (ran ${cinMs}ms)`);

  timeline.dispatchGameEvents(killBatch('GRUNT'));
  let microMs = 0;
  while (timeline.getKillCamFrame().active && microMs < 10000) {
    timeline.step(10);
    microMs += 10;
  }
  const shortMicroTiming = getKillCamTiming('MICRO', 'SHORT');
  assert.ok(
    microMs >= shortMicroTiming.slamMs + shortMicroTiming.slowMs && microMs <= 1250,
    `SHORT micro should be ~0.9s (ran ${microMs}ms)`,
  );
});

test('non-lethal attacks trigger the crisp ATTACK micro-cam with unit HP telemetry', () => {
  const { timeline, stings } = buildTimeline();
  timeline.dispatchGameEvents(nonLethalAttackBatch());

  const first = timeline.getKillCamFrame();
  assert.equal(first.active, true);
  assert.equal(first.cue?.tier, 'ATTACK');
  assert.equal(first.cue?.subject, 'ATTACK');
  assert.equal(first.cue?.victimName, 'Breacher');
  assert.equal(first.cue?.remainingHp, 5);
  assert.equal(stings.length, 0, 'non-lethal attacks do not fire heavy kill-cam stings');

  let realMs = 0;
  while (timeline.getKillCamFrame().active && realMs < 5000) {
    timeline.step(10);
    realMs += 10;
  }
  assert.ok(realMs >= 600 && realMs <= 1150, `FULL attack micro-cam should be crisp ~0.85s (ran ${realMs}ms)`);
});

test('OVERWATCH ambush waits to pre-roll until shot fires, and MINE kills never pre-roll early', () => {
  // Overwatch ambush mid-march (unit walks 3 tiles, intercepted at tile 2)
  const ow = buildTimeline();
  ow.timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_runner', unitType: 'SOLDIER', owner: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] },
    { kind: 'projectile', from: { x: 2, y: 3 }, to: { x: 2, y: 0 }, style: 'BULLET', weapon: 'SOLDIER', targetUnitId: 'u_runner', travelMs: 120 },
    { kind: 'hit', targetUnitId: 'u_runner', at: { x: 2, y: 0 }, from: { x: 2, y: 3 }, damage: 15, weapon: 'SOLDIER', isKill: true },
    { kind: 'killed', unitId: 'u_runner', unitType: 'SOLDIER', owner: 1, rank: 0, at: { x: 2, y: 0 }, killerOwner: 0, cause: 'OVERWATCH' },
  ]);
  assert.equal(ow.timeline.isKillCamActive(), false, 'must not spoil Overwatch at t=0 before unit reaches trigger');
  // Advance until the Overwatcher actually pulls the trigger (~124ms)
  for (let i = 0; i < 16; i++) ow.timeline.step(10);
  assert.equal(ow.timeline.getKillCamFrame().phase, 'PUSH', 'pre-roll begins only once Overwatch fires');
  assert.equal(ow.timeline.getKillCamFrame().cameraStyle, 'OVERWATCH_SNAP');
  assert.equal(ow.getOverwatchStatics(), 1, 'Overwatch snap plays comms static cue');

  // Land mine detonation mid-march: stays quiet on approach -> 150ms ARM (*click*) -> SLAM (*BOOM*)
  const mine = buildTimeline();
  mine.timeline.dispatchGameEvents([
    { kind: 'movePath', unitId: 'u_walker', unitType: 'SOLDIER', owner: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] },
    { kind: 'mineBlast', at: { x: 2, y: 0 }, damage: 15, victimUnitId: 'u_walker', victimDead: true },
    { kind: 'killed', unitId: 'u_walker', unitType: 'SOLDIER', owner: 1, rank: 0, at: { x: 2, y: 0 }, killerOwner: 0, cause: 'MINE' },
  ]);
  assert.equal(mine.timeline.isKillCamActive(), false, 'must not spoil a hidden Land Mine before arrival');
  for (let i = 0; i < 18; i++) mine.timeline.step(10);
  assert.equal(mine.timeline.isKillCamActive(), false, 'stays quiet during the walk onto the mine');
  for (let i = 0; i < 10; i++) mine.timeline.step(10);
  assert.equal(mine.timeline.getKillCamFrame().phase, 'ARM', 'freezes on the pressure plate in ARM phase (*click*)');
  assert.equal(mine.timeline.getKillCamFrame().cameraStyle, 'MINE_CLICK');
  assert.equal(mine.getMineClicks(), 1, 'mine click audio fires on arrival');
  for (let i = 0; i < 17; i++) mine.timeline.step(10);
  assert.equal(mine.timeline.getKillCamFrame().phase, 'SLAM', 'detonates straight into SLAM ~150ms real time later');
});

test('FxTimeline cuts to structure losses: vault heist and bank demolition', () => {
  const heist = buildTimeline();
  heist.timeline.dispatchGameEvents([
    { kind: 'heist', at: { x: 9, y: 9 }, playerId: 0 },
  ]);
  const heistFrame = heist.timeline.getKillCamFrame();
  assert.equal(heistFrame.cue?.subject, 'STRUCTURE');
  assert.equal(heistFrame.cue?.tier, 'STRUCTURE');
  assert.equal(heistFrame.cue?.title, 'VAULT BREACHED');
  assert.equal(heist.timeline.isKillCamActive(), true);

  const bank = buildTimeline();
  bank.timeline.dispatchGameEvents([
    { kind: 'structureHit', at: { x: 4, y: 4 }, structureType: 'BANK', damage: 9, destroyed: true, owner: 1, attackerOwner: 0 },
  ]);
  assert.equal(bank.timeline.getKillCamFrame().cue?.title, 'BANK DEMOLISHED');

  assert.equal(heist.callouts.length, 0);
  assert.equal(bank.callouts.length, 0);
});

test('structure cuts ignore routine siege damage after the first breach', () => {
  const siege = buildTimeline();
  const hit = (x: number, y: number, damage: number) => ({
    kind: 'structureHit' as const,
    at: { x, y },
    structureType: 'BASE' as const,
    damage,
    destroyed: false,
    owner: 1,
    attackerOwner: 0,
  });

  siege.timeline.dispatchGameEvents([hit(3, 3, 20)]);
  assert.equal(siege.timeline.getKillCamFrame().cue?.title, 'HQ BREACHED', 'the first breach is a moment');
  assert.equal(siege.timeline.isKillCamActive(), true);

  for (let i = 0; i < 600; i++) siege.timeline.step(10);
  assert.equal(siege.timeline.isKillCamActive(), false);

  siege.timeline.dispatchGameEvents([hit(3, 3, 18)]);
  assert.equal(siege.timeline.isKillCamActive(), false, 'routine siege damage never steals the camera');

  siege.timeline.dispatchGameEvents([hit(9, 9, 12)]);
  assert.equal(siege.timeline.isKillCamActive(), true);
});

test('first-breach memory survives a turn boundary and only a match reset re-arms it', () => {
  const { timeline } = buildTimeline();
  const hit = (x: number, y: number, damage: number) => ({
    kind: 'structureHit' as const,
    at: { x, y },
    structureType: 'BASE' as const,
    damage,
    destroyed: false,
    owner: 1,
    attackerOwner: 0,
  });

  timeline.dispatchGameEvents([hit(3, 3, 14)]);
  assert.equal(timeline.getKillCamFrame().cue?.title, 'HQ BREACHED', 'turn 1 opens with the breach');
  for (let i = 0; i < 600; i++) timeline.step(10);
  assert.equal(timeline.isKillCamActive(), false);

  timeline.clear();
  timeline.dispatchGameEvents([hit(3, 3, 22)]);
  assert.equal(timeline.isKillCamActive(), false, 'the second turn on the same HQ stays quiet');

  timeline.resetMatchMemory();
  timeline.dispatchGameEvents([hit(3, 3, 9)]);
  assert.equal(timeline.getKillCamFrame().cue?.title, 'HQ BREACHED', 'a new match gets its moment back');
});

test('FxTimeline avoids duplicate banner on MICRO kills, supports skipKillCam, and restores banners when OFF', () => {
  const micro = buildTimeline();
  const activeEvents: boolean[] = [];
  micro.timeline.subscribeKillCamActive((a) => activeEvents.push(a));

  micro.timeline.dispatchGameEvents(killBatch('GRUNT'));
  assert.equal(micro.timeline.getKillCamFrame().cue?.tier, 'MICRO');
  for (let i = 0; i < 500; i++) micro.timeline.step(10);
  assert.equal(micro.callouts.length, 0, 'MICRO kill cam carries its own headline instead of double-bannering');
  assert.deepEqual(activeEvents, [true, false], 'kill-cam active subscription fires cleanly on enter and exit');

  // Skipping during PUSH cancels immediately and never re-opens on impact.
  const skipped = buildTimeline();
  skipped.timeline.dispatchGameEvents(killBatch('ACE'));
  assert.equal(skipped.timeline.getKillCamFrame().phase, 'PUSH');
  assert.equal(skipped.timeline.skipKillCam(), true);
  assert.equal(skipped.timeline.isKillCamActive(), false);
  for (let i = 0; i < 60; i++) skipped.timeline.step(10);
  assert.equal(skipped.timeline.isKillCamActive(), false, 'skipped kill never re-triggers on impact');

  const off = buildTimeline();
  off.timeline.setKillCamMode('OFF');
  off.timeline.dispatchGameEvents(killBatch('ACE'));
  assert.equal(off.timeline.isKillCamActive(), false);
  for (let i = 0; i < 500; i++) off.timeline.step(10);
  assert.equal(off.callouts.length, 1, 'camera off restores the ace banner');
  assert.equal(off.callouts[0].headline, 'ACE DOWN!');
});

test('computeClampedKillCamViewport prevents out-of-bounds corner void and reports subjectScreen for UI dodging', () => {
  const boardSize = 20 * 64;
  // Top-left corner (0,0) zoomed in with Dutch tilt
  const corner = computeClampedKillCamViewport({
    targetX: 32,
    targetY: 32,
    subjectX: 32,
    subjectY: 32,
    desiredScale: 2.0,
    screenWidth: 960,
    screenHeight: 640,
    boardSize,
    dutchTiltRad: 0.04,
  });
  const halfW = (960 / corner.scale) / 2;
  const halfH = (640 / corner.scale) / 2;
  assert.ok(corner.centerX - halfW >= -24, `left edge clamped within apron bleed (got ${corner.centerX - halfW})`);
  assert.ok(corner.centerY - halfH >= -24, `top edge clamped within apron bleed (got ${corner.centerY - halfH})`);
  assert.ok(corner.subjectScreenX >= 0 && corner.subjectScreenX < 0.35, 'top-left corner subject sits in left viewport quadrant');
  assert.ok(corner.subjectScreenY >= 0 && corner.subjectScreenY < 0.35, 'top-left corner subject sits in top viewport quadrant');

  // Top-right corner (19,0) pushes subject into the upper-right quadrant (triggers UI corner-dodge)
  const topRight = computeClampedKillCamViewport({
    targetX: boardSize - 32,
    targetY: 32,
    subjectX: boardSize - 32,
    subjectY: 32,
    desiredScale: 2.0,
    screenWidth: 960,
    screenHeight: 640,
    boardSize,
    dutchTiltRad: -0.04,
  });
  assert.ok(topRight.subjectScreenX > 0.56 && topRight.subjectScreenY < 0.52, 'top-right victim triggers right-stamp dodge');
});

test('1-HP Graze Fake-Out flips from crimson SLAM to amber SLOW and plays armor ricochet audio', () => {
  const { timeline, getGrazeSurvives } = buildTimeline();
  timeline.dispatchGameEvents([
    {
      kind: 'projectile',
      from: { x: 2, y: 2 },
      to: { x: 5, y: 2 },
      style: 'MISSILE',
      weapon: 'ASSAULTER',
      attackerId: 'u_att',
      targetUnitId: 'u_graze',
      travelMs: 160,
    },
    {
      kind: 'hit',
      targetUnitId: 'u_graze',
      at: { x: 5, y: 2 },
      from: { x: 2, y: 2 },
      damage: 11,
      weapon: 'ASSAULTER',
      breakdown: {
        baseDamage: 14,
        watchtowerBoosted: false,
        coverPct: 0.2,
        coverTerrain: 'FOREST',
        coverArmorApplied: false,
        crossfireBonus: 0,
      },
    },
  ]);

  const pushFrame = timeline.getKillCamFrame();
  assert.equal(pushFrame.cameraStyle, 'GRAZE_FAKEOUT');
  assert.equal(pushFrame.grazeFlipped, false, 'starts unflipped during PUSH');

  // Step through PUSH into SLAM (crimson tease), then into SLOW (amber flip + audio)
  let sawUnflippedSlam = false;
  let sawFlippedSlow = false;
  for (let i = 0; i < 200; i++) {
    timeline.step(16);
    const f = timeline.getKillCamFrame();
    if (f.phase === 'SLAM' && !f.grazeFlipped) sawUnflippedSlam = true;
    if (f.phase === 'SLOW' && f.grazeFlipped) sawFlippedSlow = true;
  }
  assert.equal(sawUnflippedSlam, true, 'SLAM holds brief crimson fake-out tease');
  assert.equal(sawFlippedSlow, true, 'SLOW flips to amber/emerald 1-HP survival reveal');
  assert.equal(getGrazeSurvives(), 1, 'graze ricochet/heartbeat SFX plays once on flip');
});

test('selectKillCamStyle, resolveKillCamNarrative priority, FIRST BLOOD / VENDETTA memory, and buildReceiptSteps', () => {
  assert.equal(selectKillCamStyle(makeCue({ weapon: 'SNIPER', distanceTiles: 6, hasVisibleOrigin: true })), 'SNIPER_WHIP');
  assert.equal(selectKillCamStyle(makeCue({ weapon: 'SNIPER', distanceTiles: 6, hasVisibleOrigin: false })), 'STANDARD', 'hidden fog sniper skips whip-pan');
  assert.equal(selectKillCamStyle(makeCue({ cause: 'MINE' })), 'MINE_CLICK');
  assert.equal(selectKillCamStyle(makeCue({ cause: 'OVERWATCH' })), 'OVERWATCH_SNAP');
  assert.equal(
    selectKillCamStyle(makeCue({ crossfireCount: 2, crossfirePoints: [{ x: 160, y: 200 }, { x: 240, y: 120 }] })),
    'CROSSFIRE_TRIANGLE',
  );
  assert.equal(selectKillCamStyle(makeCue({ weapon: 'ASSAULTER', crossfireCount: 0 })), 'BREACHER_ARC');
  assert.equal(selectKillCamStyle(makeCue({ subject: 'STRUCTURE', tier: 'STRUCTURE' })), 'STRUCTURE_BLOWOUT');

  // Narrative priority: FINAL BLOW > 0 CP CLUTCH > VENDETTA > GIANT SLAYER > FIRST BLOOD > LONGSHOT
  assert.equal(resolveKillCamNarrative(makeCue({ isMatchWinning: true, zeroCpClutch: true, isFirstBlood: true }), 1).headline, 'FINAL BLOW');
  assert.equal(resolveKillCamNarrative(makeCue({ zeroCpClutch: true, isVendetta: true }), 1).headline, '0 CP CLUTCH');
  assert.equal(resolveKillCamNarrative(makeCue({ isVendetta: true, isFirstBlood: true }), 1).headline, 'VENDETTA');
  assert.equal(resolveKillCamNarrative(makeCue({ killerUnitType: 'SOLDIER', victimUnitType: 'SNIPER', victimRank: 2 }), 1).headline, 'GIANT SLAYER');
  assert.equal(resolveKillCamNarrative(makeCue({ isFirstBlood: true, victimRank: 0 }), 1).headline, 'FIRST BLOOD');
  assert.equal(resolveKillCamNarrative(makeCue({ weapon: 'SNIPER', distanceTiles: 8, victimRank: 0 }), 1).headline, 'LONGSHOT');

  // Tactical Receipt formatting
  const steps = buildReceiptSteps(
    {
      baseDamage: 12,
      watchtowerBoosted: true,
      coverPct: 0.4,
      coverTerrain: 'FOREST',
      coverArmorApplied: true,
      crossfireBonus: 2,
    },
    10,
    true,
  );
  assert.deepEqual(
    steps.map(s => s.text),
    ['12 BASE', '×1.2 TOWER', '−40% FOREST', '−2 ARMOR', '+2 CROSSFIRE', '= 10 LETHAL'],
  );

  // FxTimeline tracks FIRST BLOOD once per match and VENDETTA when slaying a unit that killed your ally
  const { timeline } = buildTimeline();
  timeline.dispatchGameEvents([
    { kind: 'hit', targetUnitId: 'u_a', at: { x: 4, y: 4 }, from: { x: 2, y: 4 }, damage: 15, weapon: 'SOLDIER', isKill: true },
    { kind: 'killed', unitId: 'u_a', unitType: 'SOLDIER', owner: 1, rank: 0, at: { x: 4, y: 4 }, killerOwner: 0, killerUnitId: 'u_killer_0', killerUnitType: 'SOLDIER', cause: 'COMBAT' },
  ]);
  assert.equal(timeline.getKillCamFrame().cue?.isFirstBlood, true, 'very first kill of match claims FIRST BLOOD');
  for (let i = 0; i < 400; i++) timeline.step(16);

  // Now Player 1 kills u_killer_0 (who previously killed Player 1's unit u_a) -> VENDETTA!
  timeline.dispatchGameEvents([
    { kind: 'hit', targetUnitId: 'u_killer_0', at: { x: 2, y: 4 }, from: { x: 2, y: 6 }, damage: 15, weapon: 'SOLDIER', isKill: true },
    { kind: 'killed', unitId: 'u_killer_0', unitType: 'SOLDIER', owner: 0, rank: 0, at: { x: 2, y: 4 }, killerOwner: 1, killerUnitId: 'u_avenger', killerUnitType: 'SOLDIER', cause: 'COMBAT' },
  ]);
  assert.equal(timeline.getKillCamFrame().cue?.isFirstBlood, false, 'second kill is not FIRST BLOOD');
  assert.equal(timeline.getKillCamFrame().cue?.isVendetta, true, 'eliminating a unit that previously killed your ally triggers VENDETTA');
});

test('HighlightRecorder scores match drama accurately and RecapPlayer switches between 2.5x routine and 1.0x dramatic', () => {
  const recorder = new HighlightRecorder();
  const gruntKill: GameEvent[] = [
    { kind: 'killed', unitId: 'u1', unitType: 'SOLDIER', owner: 1, rank: 0, at: { x: 3, y: 3 }, killerOwner: 0, cause: 'COMBAT' },
  ];
  const aceClutchKill: GameEvent[] = [
    { kind: 'hit', targetUnitId: 'u2', at: { x: 8, y: 8 }, from: { x: 1, y: 8 }, damage: 22, weapon: 'SNIPER', isKill: true, crossfireFrom: [{ x: 7, y: 7 }] },
    { kind: 'killed', unitId: 'u2', unitType: 'SNIPER', owner: 1, rank: 3, at: { x: 8, y: 8 }, killerOwner: 0, zeroCpClutch: true, isMatchWinning: true, cause: 'COMBAT' },
  ];

  assert.ok(scoreHighlightBatch(aceClutchKill).score > scoreHighlightBatch(gruntKill).score);
  assert.equal(recorder.record({ turn: 2, seed: 'TEST01', preUnits: [], preMapData: [], postUnits: [], postMapData: [], events: gruntKill }), true);
  assert.equal(recorder.record({ turn: 5, seed: 'TEST01', preUnits: [], preMapData: [], postUnits: [], postMapData: [], events: aceClutchKill }), true);
  assert.equal(recorder.getBest()?.turn, 5, 'recorder replaces lower highlight with higher drama peak');
  assert.equal(recorder.getBest()?.headline, 'FINAL BLOW');

  // RecapPlayer dramatic detection & clean stop/restore
  assert.equal(isDramaticRecapBatch([{ kind: 'movePath', unitId: 'u1', unitType: 'SOLDIER', owner: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }]), false);
  assert.equal(isDramaticRecapBatch(gruntKill), true);
  assert.equal(isDramaticRecapBatch([{ kind: 'heist', at: { x: 5, y: 5 }, playerId: 1 }]), true);

  const player = new RecapPlayer();
  let restored = 0;
  let dispatched = 0;
  player.startMissedRecap(
    [
      { seq: 2, actorSeat: 1, round: 1, preUnits: [], events: [{ kind: 'movePath', unitId: 'u1', unitType: 'SOLDIER', owner: 1, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }] },
    ],
    {
      applyDisplaySnapshot: () => {},
      restoreLiveState: () => { restored++; },
      dispatchEvents: () => { dispatched++; },
    },
  );
  assert.equal(player.isActive(), true);
  assert.equal(player.getStatus().fastForward, true, 'routine move runs at 2.5x fast-forward');
  assert.equal(dispatched, 1);
  player.stop();
  assert.equal(player.isActive(), false);
  assert.equal(restored, 1, 'stop() always restores authoritative live state');
});
