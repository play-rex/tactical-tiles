import assert from 'node:assert/strict';
import test from 'node:test';
import { FxTimeline } from '../graphics/fxTimeline';
import { resolveKillCamNarrative } from '../graphics/killCam';
import {
  DEV_EVENT_CATALOG,
  DEV_EVENT_EXPECTED,
  DEV_EVENT_GROUPS,
  devEventCoverage,
  devProbeOutcome,
  type DevEventContext,
  type DevEventKind,
} from '../dev/devEventMatrix';

test('every dev event declares the cut it produces and the director agrees', () => {
  for (const spec of DEV_EVENT_CATALOG) {
    assert.ok(spec.label.length > 0, `${spec.kind} needs a button label`);
    assert.ok(spec.hint.length > 0, `${spec.kind} needs a hint so the panel explains itself`);
    if (spec.tool) {
      assert.equal(spec.probe, undefined, `${spec.kind} is a tool, not a cue`);
      continue;
    }
    assert.ok(spec.probe, `${spec.kind} has no probe`);
    assert.ok(spec.expect, `${spec.kind} has no declared expectation`);
    const actual = devProbeOutcome(spec.probe);
    assert.equal(actual.tier, spec.expect.tier, `${spec.kind}: tier`);
    assert.equal(actual.style, spec.expect.style, `${spec.kind}: camera style`);
    assert.equal(actual.headline, spec.expect.headline, `${spec.kind}: headline`);
    assert.deepEqual(actual.tags, spec.expect.tags, `${spec.kind}: narrative tags`);
  }
});

test('the sandbox can reach every kill cause, tier and camera profile the game can play', () => {
  const coverage = devEventCoverage();
  assert.deepEqual(coverage.missingCauses, [], 'no kill cause may be unauditionable');
  assert.deepEqual(coverage.missingTiers, [], 'no cut tier may be unauditionable');
  assert.deepEqual(coverage.missingStyles, [], 'no camera profile may be unauditionable');
  assert.equal(coverage.complete, true);
  assert.equal(coverage.causes.length, 7);
  assert.equal(coverage.tiers.length, 4);
  assert.equal(coverage.styles.length, 8);
});

test('every matrix entry is unique, grouped, and listed exactly once in the panel', () => {
  const kinds = DEV_EVENT_CATALOG.map(spec => spec.kind);
  assert.equal(new Set(kinds).size, kinds.length, 'duplicate dev event kind');
  assert.equal(DEV_EVENT_CATALOG.length, kinds.length);
  const grouped = DEV_EVENT_GROUPS.flatMap(group => DEV_EVENT_CATALOG.filter(spec => spec.group === group.id));
  assert.equal(grouped.length, DEV_EVENT_CATALOG.length, 'every event belongs to a rendered group');
  for (const kind of kinds) {
    assert.ok(DEV_EVENT_EXPECTED[kind as DevEventKind] || DEV_EVENT_CATALOG.find(s => s.kind === kind)?.tool, `${kind} has no contract`);
  }
});

test('every button is matrix-built and plays exactly the declared tier, camera and headline', () => {
  const cueEntries = DEV_EVENT_CATALOG.filter(spec => !spec.tool);
  const unbuilt = cueEntries.filter(spec => !spec.build);
  assert.deepEqual(unbuilt.map(spec => spec.kind), [], 'every dev button must fire through a matrix builder');

  for (const spec of cueEntries) {
    const probe = spec.probe!;
    const victimRank = probe.rank ?? 0;
    const ctx: DevEventContext = {
      gridSize: 20,
      currentPlayer: 0,
      victim: {
        id: 'v1',
        type: probe.victimUnitType ?? 'SOLDIER',
        owner: 1,
        hp: 20,
        rank: victimRank,
        x: 10,
        y: 10,
        terrain: 'PLAINS',
      },
      killer: { id: 'k1', type: probe.killerUnitType ?? 'SOLDIER', owner: 0, hp: 20, rank: 0, x: 5, y: 10, terrain: 'PLAINS' },
      flank: [{ x: 8, y: 9 }, { x: 12, y: 11 }],
      structure: spec.structureTarget
        ? {
            x: 12,
            y: 6,
            type: spec.structureTarget === 'BANK' ? 'BANK' : spec.structureTarget === 'BARRIER' ? 'BARRIER' : 'BASE',
            owner: spec.structureTarget === 'ENEMY_HQ' ? 1 : null,
          }
        : null,
    };

    const timeline = new FxTimeline();
    timeline.configure({
      getUnitInfo: (id: string) =>
        id === 'v1'
          ? {
              type: ctx.victim.type,
              owner: 1,
              rank: victimRank as 0 | 1 | 2 | 3,
              hp: probe.subject === 'ATTACK' ? probe.remainingHp ?? 20 : 20,
              maxHp: 21,
            }
          : { type: ctx.killer.type, owner: 0, rank: 0, hp: 20, maxHp: 20 },
      hasActiveParticles: () => false,
    });

    // Burn FIRST BLOOD first: the auditioned cut is judged on its own merits, not on being the
    // first kill this timeline ever saw.
    timeline.dispatchGameEvents([
      {
        kind: 'hit',
        targetUnitId: 'warmup',
        at: { x: 18, y: 18 },
        from: { x: 17, y: 18 },
        damage: 15,
        weapon: 'SOLDIER',
        isKill: true,
      },
      {
        kind: 'killed',
        unitId: 'warmup',
        unitType: 'SOLDIER',
        owner: 1,
        rank: 0,
        at: { x: 18, y: 18 },
        killerOwner: 0,
        cause: 'COMBAT',
      },
    ]);
    timeline.clear();

    timeline.dispatchGameEvents(spec.build!(ctx));
    let cue = timeline.getKillCamFrame().cue;
    for (let waited = 0; !cue && waited < 3000; waited += 10) {
      timeline.step(10);
      cue = timeline.getKillCamFrame().cue;
    }
    assert.ok(cue, `${spec.kind}: builder produced no kill-cam cue`);
    assert.equal(cue.tier, spec.expect!.tier, `${spec.kind}: tier`);
    assert.equal(cue.cameraStyle, spec.expect!.style, `${spec.kind}: camera`);
    assert.equal(resolveKillCamNarrative(cue, cue.combo).headline, spec.expect!.headline, `${spec.kind}: headline`);
  }
});
