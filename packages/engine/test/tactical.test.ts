import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction,
  chooseTacticalAction,
  computeTacticalPercentDamage,
  createGeneratedGame,
  DEFAULT_GAME_SETTINGS,
  eventsFor,
  legalParadropDestinations,
  legalTacticalAnchors,
  TACTICAL_MIN_HP_FLOOR,
  tacticalCooldownLeft,
  tacticalTilesFor,
  viewFor,
  type GameAction,
  type GameEvent,
  type GameState,
} from '../src/index';
import { getOverwatchCoverageTiles, resolveMoveWithOverwatch } from '../src/rules/OverwatchRules';
import type { GameSettings } from '../src/types';

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({ ...DEFAULT_GAME_SETTINGS, ...over });

/** A flat board keeps the footprints easy to reason about. */
const flatBoard = (base: GameState): GameState => ({
  ...base,
  mapData: base.mapData.map(t => ({
    ...t,
    type: 'PLAINS' as const,
    hazardState: undefined,
    owner: undefined,
    hp: undefined,
    maxHp: undefined,
    subType: undefined,
    loot: null,
  })),
});

const endTurn = (state: GameState): GameState => {
  const result = applyAction(state, { type: 'END_TURN' });
  assert.equal(result.rejected, undefined);
  return result.state;
};

test('tactical tiers open at round 2 / 5 / 10, first Common in round 2 is free, and each weapon has a 3-round cooldown', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_GATE', fogOfWar: false, playerCount: 2 })));
  const gold = { 0: 1000, 1: 1000 };
  const enemy = base.units.find(u => u.owner === 1)!;
  const enemyHp = enemy.hp;

  const round1 = { ...base, totalTurns: 0, playerGold: gold };
  const early = applyAction(round1, { type: 'USE_TACTICAL', itemKey: 'MINEFIELD_SNAPSHOT' });
  assert.match(early.rejected ?? '', /opens at round 2/);

  const round2 = { ...base, totalTurns: 1, playerGold: gold };
  const free = applyAction(round2, { type: 'USE_TACTICAL', itemKey: 'MINEFIELD_SNAPSHOT' });
  assert.equal(free.rejected, undefined);
  assert.equal(free.state.playerGold[0], 1000, 'the round-2 Common pick costs no gold');
  assert.equal(free.state.freeTacticalRound?.[0], 2);
  assert.equal(tacticalCooldownLeft(free.state, 0, 'MINEFIELD_SNAPSHOT'), 3, 'enters 3-round cooldown');

  const secondSameRound = applyAction(free.state, { type: 'USE_TACTICAL', itemKey: 'RECON_DRONE', tileId: enemy.tileId });
  assert.match(secondSameRound.rejected ?? '', /One tactical weapon per round/);

  // Same weapon blocked in round 3 & 4 (cooldown), ready again in round 5
  const cdRound3 = applyAction({ ...free.state, totalTurns: 2 }, { type: 'USE_TACTICAL', itemKey: 'MINEFIELD_SNAPSHOT' });
  assert.match(cdRound3.rejected ?? '', /cooldown/);
  const cdRound4 = applyAction({ ...free.state, totalTurns: 3 }, { type: 'USE_TACTICAL', itemKey: 'MINEFIELD_SNAPSHOT' });
  assert.match(cdRound4.rejected ?? '', /cooldown/);
  const readyRound5 = applyAction({ ...free.state, totalTurns: 4 }, { type: 'USE_TACTICAL', itemKey: 'MINEFIELD_SNAPSHOT' });
  assert.equal(readyRound5.rejected, undefined, 'cooldown expires after 3 rounds (round 2 -> round 5)');

  // Different Common works in round 3 and deals instant 40% current HP (Hunter Drone, min 2 HP) without sensor when Fog is OFF
  const round3 = applyAction(
    { ...free.state, totalTurns: 2 },
    { type: 'USE_TACTICAL', itemKey: 'RECON_DRONE', tileId: enemy.tileId },
  );
  assert.equal(round3.rejected, undefined);
  assert.equal(round3.state.playerGold[0], 875, 'from round 3 Hunter Drone costs €125');
  const expectedDroneHp = computeTacticalPercentDamage({ hp: enemyHp }, 0.4).hpAfter;
  assert.equal(round3.state.units.find(u => u.id === enemy.id)!.hp, expectedDroneHp, 'Hunter Drone deals 40% current HP');
  assert.equal(round3.state.sensors?.length ?? 0, 0, 'Hunter Drone skips sensor placement when Fog of War is OFF');

  // Precision Strike opens at round 5 and strikes immediately for 75% current HP (min 2 HP) on an enemy unit
  const round4 = applyAction(
    { ...base, totalTurns: 3, playerGold: gold },
    { type: 'USE_TACTICAL', itemKey: 'PRECISION_STRIKE', tileId: enemy.tileId },
  );
  assert.match(round4.rejected ?? '', /opens at round 5/);

  const round5 = applyAction(
    { ...base, totalTurns: 4, playerGold: gold },
    { type: 'USE_TACTICAL', itemKey: 'PRECISION_STRIKE', tileId: enemy.tileId },
  );
  assert.equal(round5.rejected, undefined);
  assert.equal(round5.state.playerGold[0], 825);
  assert.equal(round5.state.pendingTacticals?.length ?? 0, 0, 'Precision Strike resolves immediately with no pending delay');
  const expectedPrecisionHp = computeTacticalPercentDamage({ hp: enemyHp }, 0.75).hpAfter;
  assert.equal(round5.state.units.find(u => u.id === enemy.id)!.hp, expectedPrecisionHp, 'Precision Strike deals 75% current HP');
});

test('Radar Sweep is Fog of War only, and Hunter Drone leaves a sensor when Fog of War is ON', () => {
  const noFog = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_FOG_ONLY', fogOfWar: false, playerCount: 2 })));
  const blocked = applyAction({ ...noFog, totalTurns: 5, playerGold: { 0: 1000, 1: 1000 } }, { type: 'USE_TACTICAL', itemKey: 'RADAR_SWEEP' });
  assert.match(blocked.rejected ?? '', /Fog of War/);

  const withFog = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_FOG_ONLY', fogOfWar: true, playerCount: 2 })));
  const allowed = applyAction({ ...withFog, totalTurns: 5, playerGold: { 0: 1000, 1: 1000 } }, { type: 'USE_TACTICAL', itemKey: 'RADAR_SWEEP' });
  assert.equal(allowed.rejected, undefined);
  assert.equal(allowed.state.radarRound?.[0], 6);

  // Place an enemy right next to an ally so it's visible under Fog, then fire Hunter Drone
  const ally = withFog.units.find(u => u.owner === 0)!;
  const enemy = withFog.units.find(u => u.owner === 1)!;
  const [ax, ay] = ally.tileId.split(',').map(Number);
  const adjacentTile = `${Math.min(withFog.gridSize - 1, ax + 1)},${ay}`;
  const closeFog: GameState = {
    ...withFog,
    totalTurns: 2,
    playerGold: { 0: 1000, 1: 1000 },
    units: withFog.units.map(u => (u.id === enemy.id ? { ...u, tileId: adjacentTile } : u)),
  };
  const drone = applyAction(closeFog, { type: 'USE_TACTICAL', itemKey: 'RECON_DRONE', tileId: adjacentTile });
  assert.equal(drone.rejected, undefined);
  assert.equal(drone.state.sensors?.length, 1, 'Hunter Drone leaves a 3-round Recon Sensor in Fog mode');
  assert.equal(drone.state.sensors?.[0].tileId, adjacentTile);
});

test('bots buy the cheapest useful unlocked tactical, once per round', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_BOT', fogOfWar: false, playerCount: 2, aiDifficulty: 'HARD' })));
  const spent = {
    ...base,
    totalTurns: 1,
    playerGold: { 0: 1000, 1: 1000 },
    units: base.units.map(u => (u.owner === 0 ? { ...u, completed: true } : u)),
    mines: [{ id: 'm1', tileId: '5,5', owner: 1 }],
  };

  const action = chooseTacticalAction(spent, 0);
  assert.equal(action?.type, 'USE_TACTICAL');
  assert.equal(action?.itemKey, 'MINEFIELD_SNAPSHOT', 'an enemy mine makes the free Common pick useful');

  const applied = applyAction(spent, action!);
  assert.equal(applied.rejected, undefined);
  assert.equal(chooseTacticalAction(applied.state, 0), null, 'one tactical per round');

  const early = chooseTacticalAction({ ...spent, totalTurns: 0 }, 0);
  assert.equal(early, null, 'nothing is buyable in round 1');
});

test('napalm deals instant 40% current HP on drop (friendly fire ON), burns 20% at round end, and caps at 60% per line', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_FIRE', fogOfWar: false, playerCount: 2 })));
  const victim = base.units.find(u => u.owner === 1)!;
  const ally = base.units.find(u => u.owner === 0)!;
  const round6: GameState = {
    ...base,
    totalTurns: 5,
    playerGold: { 0: 1000, 1: 1000 },
    units: base.units.map(u =>
      u.id === victim.id ? { ...u, tileId: '2,2', hp: 20 } : u.id === ally.id ? { ...u, tileId: '4,2', hp: 20 } : u,
    ),
  };

  const buy = applyAction(round6, {
    type: 'USE_TACTICAL',
    itemKey: 'NAPALM_LINE',
    tileId: '2,2',
    axis: 'H',
  } as GameAction);
  assert.equal(buy.rejected, undefined);
  assert.deepEqual(buy.state.burningLines?.[0].tiles, ['2,2', '3,2', '4,2', '5,2']);
  assert.equal(buy.state.burningLines?.[0].roundsLeft, 2);
  assert.equal(buy.state.units.find(u => u.id === victim.id)!.hp, 12, 'instant 40% current HP on drop (20 -> 12) to enemy');
  assert.equal(buy.state.units.find(u => u.id === ally.id)!.hp, 12, 'friendly fire ON deals instant 40% current HP (20 -> 12) to ally');

  // End of round 6: standing in fire deals 20% of current HP (round(12 * 0.2) = 2 -> 10 HP; 40% + 20% = 60% cap reached!)
  const afterRound6 = endTurn(endTurn(buy.state));
  assert.equal(afterRound6.totalTurns, 6);
  assert.equal(afterRound6.units.find(u => u.id === victim.id)!.hp, 10, '20% current HP round-end burn (12 -> 10) reaches 60% cap');

  // End of round 7: 60% cap already reached, so no more damage and fire expires
  const afterRound7 = endTurn(endTurn(afterRound6));
  assert.equal(afterRound7.units.find(u => u.id === victim.id)!.hp, 10, 'per-line 60% cap prevents further ticks');
  assert.equal(afterRound7.burningLines?.length, 0, 'fire extinguishes after 2 rounds');
});

test('Carpet Run hits 1 to 3 distinct visible enemy units immediately for 50% current HP each', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_CARPET3', fogOfWar: false, playerCount: 2 })));
  const enemies = base.units.filter(u => u.owner === 1).slice(0, 3);
  assert.equal(enemies.length, 3);
  const round10: GameState = {
    ...base,
    totalTurns: 9,
    playerGold: { 0: 1000, 1: 1000 },
    units: base.units.map(u => (u.owner === 1 ? { ...u, hp: 18 } : u)),
  };

  const res = applyAction(round10, {
    type: 'USE_TACTICAL',
    itemKey: 'CARPET_RUN',
    tileId: enemies[0].tileId,
    tileIds: enemies.map(e => e.tileId),
  });
  assert.equal(res.rejected, undefined);
  assert.equal(res.state.playerGold[0], 750);
  assert.equal(res.state.pendingTacticals?.length ?? 0, 0, 'Carpet Run resolves immediately');
  for (const e of enemies) {
    assert.equal(res.state.units.find(u => u.id === e.id)!.hp, 9, 'each targeted enemy takes 50% current HP (18 -> 9)');
  }
});

test('Artillery Barrage is always 2x10 and deals instant 50% current HP to units in the corridor', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_BARRAGE', fogOfWar: false, playerCount: 2 })));
  const victim = base.units.find(u => u.owner === 1)!;
  const round10: GameState = {
    ...base,
    totalTurns: 9,
    playerGold: { 0: 1000, 1: 1000 },
    units: base.units.map(u => (u.id === victim.id ? { ...u, tileId: '5,2', hp: 20 } : u)),
  };

  // Always 20 tiles (2x10)
  assert.equal(tacticalTilesFor(base.mapData, base.gridSize, 'ARTILLERY_BARRAGE', '1,1', 'H', 1)?.length, 20);
  assert.equal(tacticalTilesFor(base.mapData, base.gridSize, 'ARTILLERY_BARRAGE', '1,1', 'H', 2)?.length, 20);

  const buy = applyAction(round10, {
    type: 'USE_TACTICAL',
    itemKey: 'ARTILLERY_BARRAGE',
    tileId: '1,1',
    axis: 'H',
    width: 2,
  });
  assert.equal(buy.rejected, undefined);
  assert.equal(buy.state.playerGold[0], 725);
  assert.equal(buy.state.pendingTacticals?.length ?? 0, 0, 'Barrage resolves immediately');
  assert.equal(buy.state.units.find(u => u.id === victim.id)!.hp, 10, 'deals 50% current HP (20 -> 10) across 2x10 lane');
});

test('Paradrop 7B airlifts own or enemy units immediately while enforcing anti-cheese enemy drop guardrails', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_PARA7B', fogOfWar: false, playerCount: 2 })));
  const own = base.units.find(u => u.owner === 0)!;
  const enemy = base.units.find(u => u.owner === 1)!;
  const setup: GameState = {
    ...base,
    totalTurns: 5,
    playerGold: { 0: 1000, 1: 1000 },
    mapData: base.mapData.map(t => {
      if (t.id === '1,1') return { ...t, type: 'BASE' as const, owner: 0, hp: 30, maxHp: 30 };
      if (t.id === '10,10') return { ...t, hazardState: 'LAVA' as const };
      return t;
    }),
    units: base.units.map(u =>
      u.id === own.id
        ? { ...u, tileId: '5,5', isRooted: true, isOverwatching: true, hasMoved: false }
        : u.id === enemy.id
          ? { ...u, tileId: '14,14', isOverwatching: true }
          : u,
    ),
    mines: [{ id: 'm_own', tileId: '12,12', owner: 0 }],
    burningLines: [{ id: 'b_nap', owner: 0, tiles: ['11,11', '12,11', '13,11', '14,11'], roundsLeft: 2, hits: {} }],
  };

  // Anti-cheese: dropping ENEMY onto Lava, Napalm, Land Mine, or inside own HQ autocannon range (dist <= 4 from 1,1) is rejected!
  const enemyDests = legalParadropDestinations(setup, 0, enemy.id);
  assert.equal(enemyDests.includes('10,10'), false, 'cannot drop enemy onto Lava');
  assert.equal(enemyDests.includes('11,11'), false, 'cannot drop enemy onto burning Napalm');
  assert.equal(enemyDests.includes('12,12'), false, 'cannot drop enemy onto a Land Mine');
  assert.equal(enemyDests.includes('3,1'), false, 'cannot drop enemy within own HQ autocannon range');
  assert.equal(enemyDests.includes('16,16'), true, 'open safe ground is legal for enemy airlift');

  const blockedNapalm = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PARADROP', unitId: enemy.id, tileId: '11,11' });
  assert.match(blockedNapalm.rejected ?? '', /Napalm/);
  const blockedMine = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PARADROP', unitId: enemy.id, tileId: '12,12' });
  assert.match(blockedMine.rejected ?? '', /Land Mine/);
  const blockedHq = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PARADROP', unitId: enemy.id, tileId: '3,1' });
  assert.match(blockedHq.rejected ?? '', /HQ autocannon/);

  // Dropping ENEMY onto safe open ground relocates immediately and clears Overwatch
  const dropEnemy = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PARADROP', unitId: enemy.id, tileId: '16,16' });
  assert.equal(dropEnemy.rejected, undefined);
  const movedEnemy = dropEnemy.state.units.find(u => u.id === enemy.id)!;
  assert.equal(movedEnemy.tileId, '16,16');
  assert.equal(movedEnemy.isOverwatching, false);

  // Dropping OWN unit relocates immediately, clears root/OW, and marks hasMoved = true
  const dropOwn = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PARADROP', unitId: own.id, tileId: '15,15' });
  assert.equal(dropOwn.rejected, undefined);
  const movedOwn = dropOwn.state.units.find(u => u.id === own.id)!;
  assert.equal(movedOwn.tileId, '15,15');
  assert.equal(movedOwn.isRooted, false);
  assert.equal(movedOwn.isOverwatching, false);
  assert.equal(movedOwn.hasMoved, true);
});

test('legalTacticalAnchors filters strictly by axis, 2x10 HQ exclusion, Sabotage specialization, and unit targeting', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_ANCHORS', fogOfWar: false, playerCount: 2 })));
  const enemy = base.units.find(u => u.owner === 1)!;
  const withStructures: GameState = {
    ...base,
    totalTurns: 9,
    playerGold: { 0: 1000, 1: 1000 },
    mapData: base.mapData.map(t => {
      if (t.id === '1,1') return { ...t, type: 'BASE' as const, owner: 0, hp: 30, maxHp: 30 };
      if (t.id === '18,18') return { ...t, type: 'BASE' as const, owner: 1, hp: 30, maxHp: 30 };
      if (t.id === '8,8') return { ...t, type: 'BUILDING' as const, owner: 1, subType: 'NONE' as const };
      if (t.id === '9,8') return { ...t, type: 'BUILDING' as const, owner: 1, subType: 'WATCHTOWER' as const };
      return t;
    }),
  };

  // Artillery Barrage 2x10 horizontal cannot clip right/bottom edges or overlap HQ 3x3 exclusion
  const barrageH2 = legalTacticalAnchors(withStructures, 0, 'ARTILLERY_BARRAGE', { axis: 'H', width: 2 });
  assert.equal(barrageH2.includes(`${withStructures.gridSize - 2},10`), false, 'clips right edge');
  assert.equal(barrageH2.includes(`5,${withStructures.gridSize - 1}`), false, '2-wide H clips bottom row');
  assert.equal(barrageH2.includes('0,0'), false, 'blocked by P0 HQ 3x3 exclusion');
  assert.equal(barrageH2.includes('5,10'), true, 'clear mid-board lane is legal');

  // Sabotage targets enemy HQs (-8 CP) and specialized enemy buildings (Strip), never own HQ, enemy units, or subType NONE
  const sabotageAnchors = legalTacticalAnchors(withStructures, 0, 'SABOTAGE');
  assert.equal(sabotageAnchors.includes('18,18'), true, 'enemy HQ is a legal Sabotage target');
  assert.equal(sabotageAnchors.includes('1,1'), false, 'own HQ is not a legal Sabotage target');
  assert.equal(sabotageAnchors.includes(enemy.tileId), false, 'enemy unit tile is no longer a Sabotage target');
  assert.equal(sabotageAnchors.includes('8,8'), false, 'unspecialized building is not a legal Sabotage target');
  assert.equal(sabotageAnchors.includes('9,8'), true, 'enemy Watchtower is a legal Sabotage target');

  // Unit-targeted Precision Strike highlights only visible enemy units
  const strikeAnchors = legalTacticalAnchors(withStructures, 0, 'PRECISION_STRIKE');
  assert.equal(strikeAnchors.includes(enemy.tileId), true);
  assert.equal(strikeAnchors.includes('10,10'), false);

  // Paradrop Step 1 highlights visible alive units (both own and enemy)
  const paradropStep1 = legalTacticalAnchors(withStructures, 0, 'PARADROP');
  assert.equal(paradropStep1.length, withStructures.units.length);
});

test('Smoke Screen blocks Overwatch coverage and interception both ways', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_SMOKE_OW', fogOfWar: false, dynamicWeather: false, playerCount: 2 })));
  const owUnit = { ...base.units.find(u => u.owner === 1)!, type: 'ASSAULTER' as const, tileId: '7,5', isOverwatching: true, ammo: 4 };
  const runner = { ...base.units.find(u => u.owner === 0)!, type: 'SOLDIER' as const, tileId: '3,5', hasMoved: false };
  const smoke = [{ id: 'sm1', owner: 0, tiles: ['5,4', '5,5', '5,6', '6,4', '6,5', '6,6'], roundsLeft: 2 }];

  const clearCov = getOverwatchCoverageTiles(owUnit, base.mapData, base.weather, base.gridSize);
  const smokedCov = getOverwatchCoverageTiles(owUnit, base.mapData, base.weather, base.gridSize, smoke);
  assert.equal(clearCov.has('5,5'), true, 'tile is covered without smoke');
  assert.equal(smokedCov.has('5,5'), false, 'smoke blocks Overwatch coverage');

  const path = [
    base.mapData.find(t => t.id === '3,5')!,
    base.mapData.find(t => t.id === '4,5')!,
    base.mapData.find(t => t.id === '5,5')!,
  ];
  const res = resolveMoveWithOverwatch({
    movingUnit: runner,
    targetTileId: '5,5',
    mapData: base.mapData,
    units: [runner, owUnit],
    weather: base.weather,
    gridSize: base.gridSize,
    fogOfWar: false,
    maxBudget: 20,
    smokeZones: smoke,
    precomputedPath: path,
  });
  assert.equal(res.trigger, null, 'runner moving into smoke is not ambushed by Overwatch');
});

test('Napalm entry ignores stepping off fire, attributes kills to caster, and tacticalFx respects fog filtering', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_FOG_FX', fogOfWar: true, playerCount: 2 })));
  const runner = base.units.find(u => u.owner === 0)!;
  const setup: GameState = {
    ...base,
    totalTurns: 5,
    playerCp: { 0: 20, 1: 20 },
    units: base.units.map(u => (u.id === runner.id ? { ...u, tileId: '5,5', hp: 10, hasMoved: false, completed: false } : u)),
    burningLines: [{ id: 'b1', owner: 1, tiles: ['5,5', '6,5', '7,5', '8,5'], roundsLeft: 2, hits: {} }],
    sensors: [{ id: 's1', owner: 0, tileId: '10,10', roundsLeft: 3 }],
  };

  // Stepping OFF 5,5 onto clean 4,5 should NOT trigger entry burn
  const stepOff = applyAction(setup, { type: 'MOVE', unitId: runner.id, targetTileId: '4,5', cost: 1 });
  assert.equal(stepOff.rejected, undefined);
  assert.equal(stepOff.state.units.find(u => u.id === runner.id)!.hp, 10, 'leaving a burning tile does not deal entry burn');

  // Recon drones are visible to everyone in viewFor so opponents can step on them
  const enemyView = viewFor(setup, 1);
  assert.equal(enemyView.game.sensors?.length, 1, 'enemy can see deployed Recon Drones');

  // Fog-honest tacticalFx filtering: Minefield Snapshot is private; Radar Sweep pings are private to caster
  const rawEvents: GameEvent[] = [
    {
      kind: 'tacticalFx',
      itemKey: 'MINEFIELD_SNAPSHOT',
      phase: 'ACTIVATE',
      owner: 0,
      anchor: { x: 1, y: 1 },
      tiles: [{ x: 1, y: 1 }],
      pings: [{ x: 12, y: 12 }],
    },
    {
      kind: 'tacticalFx',
      itemKey: 'RADAR_SWEEP',
      phase: 'ACTIVATE',
      owner: 0,
      anchor: { x: 10, y: 10 },
      tiles: [],
      pings: [{ x: 15, y: 15 }],
    },
  ];
  const p0Events = eventsFor(rawEvents, true, new Set(['1,1']), new Set(['1,1']), 0);
  const p1Events = eventsFor(rawEvents, true, new Set(['15,15']), new Set(['15,15']), 1);
  assert.equal(p0Events.length, 2, 'owner receives both private Snapshot and Radar Sweep pings');
  assert.equal(p1Events.length, 1, 'opponent does not receive private Minefield Snapshot');
  assert.equal(p1Events[0].kind === 'tacticalFx' ? p1Events[0].pings : 'bad', undefined, 'opponent sees Radar wave without private contact pings');
});

test('Sabotage clicks an enemy HQ base to drain 8 CP from that specific player in 4P (even in Fog), rejects units, and still strips structures', () => {
  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_SAB4P', fogOfWar: true, playerCount: 4 })));
  const enemyUnit = base.units.find(u => u.owner === 1)!;
  const setup: GameState = {
    ...base,
    totalTurns: 5,
    playerGold: { 0: 1000, 1: 1000, 2: 1000, 3: 1000 },
    playerCp: { 0: 20, 1: 16, 2: 18, 3: 12 },
    playerStatus: { 0: 'ACTIVE', 1: 'ACTIVE', 2: 'ACTIVE', 3: 'ELIMINATED' },
    mapData: base.mapData.map(t => {
      if (t.id === '1,1') return { ...t, type: 'BASE' as const, owner: 0, hp: 30, maxHp: 30 };
      if (t.id === '18,1') return { ...t, type: 'BASE' as const, owner: 1, hp: 30, maxHp: 30 };
      if (t.id === '18,18') return { ...t, type: 'BASE' as const, owner: 2, hp: 30, maxHp: 30 };
      if (t.id === '1,18') return { ...t, type: 'BASE' as const, owner: 3, hp: 30, maxHp: 30 };
      if (t.id === '2,1') return { ...t, type: 'BUILDING' as const, owner: 1, subType: 'WATCHTOWER' as const };
      if (t.id === '15,15') return { ...t, type: 'BUILDING' as const, owner: 2, subType: 'BUNKER' as const };
      return t;
    }),
    units: base.units.map(u => (u.id === enemyUnit.id ? { ...u, tileId: '2,2' } : u)),
  };

  // Fog sight around P0 HQ (1,1) sees 2,1 and 2,2, NOT 18,1, 18,18, 1,18, or 15,15
  const visible = new Set(['1,1', '2,1', '2,2']);
  const anchors = legalTacticalAnchors(setup, 0, 'SABOTAGE', { visible });
  assert.equal(anchors.includes('18,1'), true, 'active P2 HQ is targetable even under fog');
  assert.equal(anchors.includes('18,18'), true, 'active P3 HQ is targetable even under fog');
  assert.equal(anchors.includes('1,18'), false, 'eliminated P4 HQ is excluded');
  assert.equal(anchors.includes('1,1'), false, 'own HQ is excluded');
  assert.equal(anchors.includes('2,2'), false, 'enemy unit tile is excluded');
  assert.equal(anchors.includes('2,1'), true, 'visible enemy Watchtower is targetable');
  assert.equal(anchors.includes('15,15'), false, 'unseen enemy Bunker under fog is excluded');

  // Clicking enemy unit is rejected
  const onUnit = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'SABOTAGE', tileId: '2,2' });
  assert.match(onUnit.rejected ?? '', /enemy HQ/i);

  // Clicking Seat 2's HQ (18,18) drains 8 CP from Seat 2 ONLY, leaving Seat 1 & Seat 3 unchanged
  const drainP3 = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'SABOTAGE', tileId: '18,18' });
  assert.equal(drainP3.rejected, undefined);
  assert.equal(drainP3.state.playerCp[2], 10, 'P3 lost 8 CP (18 -> 10)');
  assert.equal(drainP3.state.playerCp[1], 16, 'P2 CP untouched');
  assert.equal(drainP3.state.playerCp[3], 12, 'P4 CP untouched');

  // Stripping a visible specialized enemy building still works
  const stripTower = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'SABOTAGE', tileId: '2,1' });
  assert.equal(stripTower.rejected, undefined);
  assert.equal(stripTower.state.mapData.find(t => t.id === '2,1')?.subType, 'NONE');

  // Bot Sabotage picks the highest-CP enemy HQ when no specialized enemy building is visible
  const aiState: GameState = {
    ...setup,
    settings: { ...setup.settings, fogOfWar: false, aiDifficulty: 'HARD' },
    playerGold: { 0: 175, 1: 1000, 2: 1000, 3: 1000 },
    tacticalCooldowns: {
      0: {
        MINEFIELD_SNAPSHOT: 99,
        RECON_DRONE: 99,
        SMOKE_SCREEN: 99,
        RADAR_SWEEP: 99,
        PRECISION_STRIKE: 99,
      },
    },
    mapData: setup.mapData.map(t => (t.type === 'BUILDING' ? { ...t, subType: 'NONE' as const } : t)),
    units: setup.units.map(u => (u.owner === 0 ? { ...u, completed: true } : u)),
  };
  const aiPick = chooseTacticalAction(aiState, 0);
  assert.equal(aiPick?.type, 'USE_TACTICAL');
  assert.equal(aiPick?.itemKey, 'SABOTAGE');
  assert.equal(aiPick?.tileId, '18,18', 'bot targets the highest-CP enemy HQ (P3: 18 CP vs P2: 16 CP)');
});

test('Tactical Weapons deal % of CURRENT HP and enforce strict 2 HP non-lethal floor across all strikes & AoE', () => {
  assert.equal(TACTICAL_MIN_HP_FLOOR, 2);

  // Formula checks across Sniper (10), Scout (15), Breacher (30), wounded (3), and floor (2, 1)
  assert.deepEqual(computeTacticalPercentDamage({ hp: 10 }, 0.75), { raw: 8, dealt: 8, hpAfter: 2, atFloor: false });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 15 }, 0.75), { raw: 11, dealt: 11, hpAfter: 4, atFloor: false });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 30 }, 0.75), { raw: 23, dealt: 23, hpAfter: 7, atFloor: false });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 30 }, 0.5), { raw: 15, dealt: 15, hpAfter: 15, atFloor: false });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 30 }, 0.4), { raw: 12, dealt: 12, hpAfter: 18, atFloor: false });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 3 }, 0.75), { raw: 2, dealt: 1, hpAfter: 2, atFloor: false });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 2 }, 0.75), { raw: 0, dealt: 0, hpAfter: 2, atFloor: true });
  assert.deepEqual(computeTacticalPercentDamage({ hp: 1 }, 0.75), { raw: 0, dealt: 0, hpAfter: 1, atFloor: true });

  const base = flatBoard(createGeneratedGame(settings({ mapSeed: 'TAC_FLOOR2', fogOfWar: false, playerCount: 2 })));
  const enemies = base.units.filter(u => u.owner === 1);
  assert.ok(enemies.length >= 3);
  const [eLow3, eFloor2, eFloor1] = enemies;
  const eHealthy = enemies[3] ?? null;

  const setup: GameState = {
    ...base,
    totalTurns: 9,
    playerGold: { 0: 2000, 1: 1000 },
    mapData: base.mapData.map(t => (t.id === '6,2' ? { ...t, type: 'BARRIER' as const, hp: 10, maxHp: 10 } : t)),
    units: base.units.map(u => {
      if (u.id === eLow3.id) return { ...u, tileId: '3,2', hp: 3 };
      if (u.id === eFloor2.id) return { ...u, tileId: '4,2', hp: 2 };
      if (u.id === eFloor1.id) return { ...u, tileId: '5,2', hp: 1 };
      if (eHealthy && u.id === eHealthy.id) return { ...u, tileId: '7,2', hp: 30 };
      return u;
    }),
  };

  // 1. Legal anchors for single-target weapons exclude enemies already at <= 2 HP
  for (const key of ['PRECISION_STRIKE', 'CARPET_RUN', 'RECON_DRONE'] as const) {
    const anchors = legalTacticalAnchors(setup, 0, key);
    assert.equal(anchors.includes('3,2'), true, `${key} can target 3 HP enemy`);
    assert.equal(anchors.includes('4,2'), false, `${key} excludes 2 HP enemy`);
    assert.equal(anchors.includes('5,2'), false, `${key} excludes 1 HP enemy`);
  }

  // 2. Direct targeting of 2 HP or 1 HP enemy is rejected so Euros are never wasted
  const blocked2 = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PRECISION_STRIKE', tileId: '4,2' });
  assert.match(blocked2.rejected ?? '', /2 HP floor/);
  const blocked1 = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'RECON_DRONE', tileId: '5,2' });
  assert.match(blocked1.rejected ?? '', /2 HP floor/);

  // 3. Precision Strike on a 3 HP unit clamps to 1 DMG (3 -> 2 HP) and NEVER kills
  const strike3 = applyAction(setup, { type: 'USE_TACTICAL', itemKey: 'PRECISION_STRIKE', tileId: '3,2' });
  assert.equal(strike3.rejected, undefined);
  assert.equal(strike3.state.units.find(u => u.id === eLow3.id)!.hp, 2, '3 HP unit drops to 2 HP floor, not killed');
  assert.equal(strike3.events.some(e => e.kind === 'killed'), false, 'tactical strike never emits a unit kill');

  // 4. Artillery Barrage over 3 HP, 2 HP, 1 HP, 30 HP units + 10 HP Barrier:
  //    3 HP -> 2 HP (-1), 2 HP -> 2 HP (0), 1 HP -> 1 HP (0, never healed), 30 HP -> 15 HP (-15), Barrier demolished
  const barrage = applyAction(setup, {
    type: 'USE_TACTICAL',
    itemKey: 'ARTILLERY_BARRAGE',
    tileId: '2,1',
    axis: 'H',
    width: 2,
  });
  assert.equal(barrage.rejected, undefined);
  assert.equal(barrage.state.units.find(u => u.id === eLow3.id)!.hp, 2, 'barrage clamps 3 HP unit at 2 HP');
  assert.equal(barrage.state.units.find(u => u.id === eFloor2.id)!.hp, 2, 'barrage deals 0 to 2 HP unit');
  assert.equal(barrage.state.units.find(u => u.id === eFloor1.id)!.hp, 1, 'barrage deals 0 to 1 HP unit and never heals it');
  if (eHealthy) {
    assert.equal(barrage.state.units.find(u => u.id === eHealthy.id)!.hp, 15, 'barrage deals 50% current HP (30 -> 15)');
  }
  assert.equal(barrage.state.mapData.find(t => t.id === '6,2')!.type, 'PLAINS', 'barrage still 1-shots 10 HP Barriers');

  // 5. Napalm entry burn respects 20% current HP + strict 2 HP floor (never kills a 2 HP mover)
  const mover = base.units.find(u => u.owner === 0)!;
  const napSetup: GameState = {
    ...base,
    totalTurns: 5,
    playerCp: { 0: 20, 1: 20 },
    units: base.units.map(u => (u.id === mover.id ? { ...u, tileId: '4,5', hp: 2, hasMoved: false, completed: false } : u)),
    burningLines: [{ id: 'b_floor', owner: 1, tiles: ['5,5', '6,5', '7,5', '8,5'], roundsLeft: 2, hits: {} }],
  };
  const stepInFloor = applyAction(napSetup, { type: 'MOVE', unitId: mover.id, targetTileId: '5,5', cost: 1 });
  assert.equal(stepInFloor.rejected, undefined);
  assert.equal(stepInFloor.state.units.find(u => u.id === mover.id)!.hp, 2, 'stepping into Napalm at 2 HP deals 0 DMG (never lethal)');

  const napHealthy: GameState = {
    ...napSetup,
    units: napSetup.units.map(u => (u.id === mover.id ? { ...u, hp: 10 } : u)),
  };
  const stepInHealthy = applyAction(napHealthy, { type: 'MOVE', unitId: mover.id, targetTileId: '5,5', cost: 1 });
  assert.equal(stepInHealthy.rejected, undefined);
  assert.equal(stepInHealthy.state.units.find(u => u.id === mover.id)!.hp, 8, 'stepping into Napalm at 10 HP deals 20% (10 -> 8)');

  // 6. Chained strikes scale off CURRENT HP (diminishing returns): 30 -> Precision 75% -> 7 -> Carpet 50% -> 3 -> Drone 40% -> 2
  const chainBase: GameState = {
    ...base,
    totalTurns: 9,
    playerGold: { 0: 2000, 1: 1000 },
    units: base.units.map(u => (u.id === eLow3.id ? { ...u, tileId: '10,10', hp: 30 } : u)),
  };
  const s1 = applyAction(chainBase, { type: 'USE_TACTICAL', itemKey: 'PRECISION_STRIKE', tileId: '10,10' });
  assert.equal(s1.state.units.find(u => u.id === eLow3.id)!.hp, 7, '30 HP - 75% (23) = 7 HP');
  const s2 = applyAction({ ...s1.state, totalTurns: 10 }, { type: 'USE_TACTICAL', itemKey: 'CARPET_RUN', tileId: '10,10', tileIds: ['10,10'] });
  assert.equal(s2.state.units.find(u => u.id === eLow3.id)!.hp, 3, '7 HP - 50% (4) = 3 HP');
  const s3 = applyAction({ ...s2.state, totalTurns: 11 }, { type: 'USE_TACTICAL', itemKey: 'RECON_DRONE', tileId: '10,10' });
  assert.equal(s3.state.units.find(u => u.id === eLow3.id)!.hp, 2, '3 HP - 40% (1) = 2 HP floor');
});
