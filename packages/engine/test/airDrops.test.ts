import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction,
  createGeneratedGame,
  DEFAULT_GAME_SETTINGS,
  hasTacticalVoucher,
  legalTacticalAnchors,
  rollFieldSupplyCrate,
  rollTacticalSupplyCrate,
  tacticalBlocker,
  tacticalCrateTierWeights,
  viewFor,
  type GameState,
} from '../src/index';
import { getManhattanDistance } from '../src/grid/Pathfinding';
import type { GameSettings } from '../src/types';

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({
  ...DEFAULT_GAME_SETTINGS,
  ...over,
});

const endRound = (state: GameState): { state: GameState; events: ReturnType<typeof applyAction>['events'] } => {
  let cur = state;
  let lastEvents: ReturnType<typeof applyAction>['events'] = [];
  const startTurns = state.totalTurns;
  for (let safety = 0; safety < 8 && cur.totalTurns === startTurns; safety++) {
    const res = applyAction(cur, { type: 'END_TURN' });
    assert.equal(res.rejected, undefined);
    cur = res.state;
    lastEvents = res.events;
  }
  assert.equal(cur.totalTurns, startTurns + 1, 'round advanced by 1');
  return { state: cur, events: lastEvents };
};

test('3/6 Air Supply Drop rhythm: R1 Dispatch -> R2 Flare -> R3 Field Drop -> R4 Dual Dispatch -> R5 Dual Flares -> R6 Dual Convoy', () => {
  let s = createGeneratedGame(settings({ mapSeed: 'AIRDROP_36', fogOfWar: false, playerCount: 2, dynamicWeather: false }));

  // Round 1: Field Drop for R3 is in DISPATCH (sector only — NO exact tileId yet!)
  assert.equal(s.airDrops?.length, 1);
  assert.equal(s.airDrops?.[0].kind, 'FIELD');
  assert.equal(s.airDrops?.[0].landingRound, 3);
  assert.equal(s.airDrops?.[0].phase, 'DISPATCH');
  assert.equal(s.airDrops?.[0].tileId, undefined, 'DISPATCH never leaks exact landing tile');

  // Advance to Round 2: R3 Field Drop promotes to FLARE with exact tileId
  let step = endRound(s);
  s = step.state;
  const r2Flare = s.airDrops?.find(d => d.landingRound === 3 && d.kind === 'FIELD');
  assert.ok(r2Flare, 'R3 Field drop exists in R2');
  assert.equal(r2Flare.phase, 'FLARE');
  assert.ok(r2Flare.tileId && r2Flare.at, 'FLARE locks exact landing tile');
  const r3LzId = r2Flare.tileId!;

  // BARRIER cannot be constructed on an active flare tile, while LAND_MINE is allowed!
  const withGold: GameState = { ...s, playerGold: { 0: 1000, 1: 1000 } };
  const barrierBlocked = applyAction(withGold, { type: 'BUILD', itemKey: 'BARRIER', tileId: r3LzId, tileIds: [r3LzId] });
  assert.ok(barrierBlocked.rejected, 'BARRIER is blocked on active flare tile');
  const mineAllowed = applyAction(withGold, { type: 'BUILD', itemKey: 'LAND_MINE', tileId: r3LzId });
  assert.equal(mineAllowed.rejected, undefined, 'LAND_MINE ambush is allowed on active flare tile');

  // Advance to Round 3: Field plane flies over & drops FIELD_SUPPLY mystery crate!
  step = endRound(s);
  s = step.state;
  const r3AirDrops = step.events.filter(e => e.kind === 'airDrop');
  assert.equal(r3AirDrops.length, 1, '1 plane drops on Round 3');
  assert.equal(r3AirDrops[0].kind === 'airDrop' ? r3AirDrops[0].dropKind : '', 'FIELD');
  assert.equal(s.mapData.find(t => t.id === r3LzId)?.loot, 'FIELD_SUPPLY', 'Mystery FIELD_SUPPLY crate lands on flared tile');

  // Advance to Round 4: Dual Convoy (FIELD + TACTICAL for R6) enters DISPATCH!
  step = endRound(s);
  s = step.state;
  const r6Dispatches = (s.airDrops ?? []).filter(d => d.landingRound === 6 && d.phase === 'DISPATCH');
  assert.equal(r6Dispatches.length, 2, 'Round 4 dispatches both FIELD and TACTICAL for Round 6');

  // Advance to Round 5: Both R6 drops promote to FLARE on separated tiles!
  step = endRound(s);
  s = step.state;
  const r6Flares = (s.airDrops ?? []).filter(d => d.landingRound === 6 && d.phase === 'FLARE');
  assert.equal(r6Flares.length, 2, 'Round 5 lights both FIELD and TACTICAL flares');
  const sep = getManhattanDistance(r6Flares[0].at!, r6Flares[1].at!);
  assert.ok(sep >= 5, `Dual drop LZs must be separated on different fronts (got ${sep})`);

  // Advance to Round 6: TWO staggered planes drop FIELD_SUPPLY + TACTICAL_SUPPLY!
  step = endRound(s);
  s = step.state;
  const r6Planes = step.events.filter((e): e is Extract<typeof e, { kind: 'airDrop' }> => e.kind === 'airDrop');
  assert.equal(r6Planes.length, 2, 'Two planes fly on Round 6');
  assert.equal(r6Planes[0].dropKind, 'FIELD');
  assert.equal(r6Planes[1].dropKind, 'TACTICAL');
  assert.equal(r6Planes[0].isDualConvoy, true);
  assert.equal(r6Planes[1].staggerMs, 950);
  assert.ok(r6Planes[0].companionAt && r6Planes[1].companionAt);
  assert.equal(s.mapData.find(t => t.id === `${r6Planes[0].at.x},${r6Planes[0].at.y}`)?.loot, 'FIELD_SUPPLY');
  assert.equal(s.mapData.find(t => t.id === `${r6Planes[1].at.x},${r6Planes[1].at.y}`)?.loot, 'TACTICAL_SUPPLY');
});

test('NO auto-claim on landing, 100% mystery crate privacy in viewFor, and free vouchers work cleanly', () => {
  let s = createGeneratedGame(settings({ mapSeed: 'AIRDROP_CLAIM', fogOfWar: true, playerCount: 2, dynamicWeather: false }));
  s = endRound(s).state; // Round 2: flare lit
  const flare = s.airDrops!.find(d => d.phase === 'FLARE')!;
  const lzId = flare.tileId!;
  const p0Unit = s.units.find(u => u.owner === 0)!;

  // Park P0's unit directly ON the flare tile before Round 3 landing!
  const parked: GameState = {
    ...s,
    units: s.units.map(u => (u.id === p0Unit.id ? { ...u, tileId: lzId } : u)),
  };

  // Round 3 lands: crate MUST NOT auto-claim!
  const landed = endRound(parked).state;
  assert.equal(landed.mapData.find(t => t.id === lzId)?.loot, 'FIELD_SUPPLY', 'crate stays on tile with zero auto-claim');
  assert.equal(landed.playerInventory[0]?.length ?? 0, 0);
  assert.equal(landed.playerShopVouchers?.[0]?.length ?? 0, 0);

  // Now P0 explicitly spends LOOT (4 CP) on its own turn standing on the crate -> surprise reveal!
  const claimed = applyAction(landed, { type: 'LOOT', unitId: p0Unit.id, tileId: lzId, cost: 4 });
  assert.equal(claimed.rejected, undefined);
  assert.equal(claimed.state.mapData.find(t => t.id === lzId)?.loot, null, 'crate removed after explicit LOOT');
  const gotSomething =
    (claimed.state.playerInventory[0]?.length ?? 0) + (claimed.state.playerShopVouchers?.[0]?.length ?? 0);
  assert.equal(gotSomething, 1, 'Field Supply Crate granted 1 consumable or construct voucher');

  // Privacy check: P1 viewFor never sees P0 vouchers or exact pulled crate item in log!
  const p1View = viewFor(claimed.state, 1);
  assert.equal(p1View.game.playerShopVouchers?.[0], undefined, 'P0 construct vouchers are private in P1 view');
  assert.equal(p1View.game.playerTacticalVouchers?.[0], undefined, 'P0 tactical vouchers are private in P1 view');
  const p1ClaimLog = p1View.game.gameLog.find(l => l.message.includes('Field Supply Crate'));
  assert.equal(p1ClaimLog?.message, 'Claimed a Field Supply Crate', 'P1 log redacts what item P0 pulled');
});

test('Tactical Supply Crate weights, anti-Epic streak, and free voucher bypass unlock & cooldown', () => {
  // Exact tier weight schedule + hard 0% Epic anti-streak after an Epic!
  assert.deepEqual(tacticalCrateTierWeights(6, undefined), { COMMON: 35, RARE: 55, EPIC: 10 });
  assert.deepEqual(tacticalCrateTierWeights(12, 'RARE'), { COMMON: 20, RARE: 55, EPIC: 25 });
  assert.deepEqual(tacticalCrateTierWeights(18, 'COMMON'), { COMMON: 15, RARE: 50, EPIC: 35 });
  assert.deepEqual(tacticalCrateTierWeights(18, 'EPIC'), { COMMON: 25, RARE: 75, EPIC: 0 });

  const base = createGeneratedGame(settings({ mapSeed: 'AIRDROP_TAC_MATH', fogOfWar: false, playerCount: 2 }));
  // Fog OFF -> Radar Sweep must never roll; no mines -> Minefield Snapshot never rolls
  for (let i = 0; i < 40; i++) {
    const roll = rollTacticalSupplyCrate(
      {
        settings: base.settings,
        mines: [],
        activeSeed: `SEED_${i}`,
        airDropMeta: { crateRounds: { '10,10': 6 }, openedCount: i, lastTacticalTier: 'EPIC' },
      },
      0,
      '10,10',
      6,
    );
    assert.notEqual(roll.tier, 'EPIC', 'anti-Epic streak guarantees 0% Epic after an Epic');
    assert.notEqual(roll.itemKey, 'RADAR_SWEEP', 'Fog-only Radar Sweep never rolls without Fog');
    assert.notEqual(roll.itemKey, 'MINEFIELD_SNAPSHOT', 'Snapshot skipped when no enemy mines exist');
  }

  // Waterless / mountainless map zeroes Bridge & Tunnel from Field Supply Crate
  const flatMap = base.mapData.map(t => ({ ...t, type: 'PLAINS' as const }));
  for (let i = 0; i < 60; i++) {
    const r = rollFieldSupplyCrate({ mapData: flatMap, activeSeed: `FLAT_${i}` }, '5,5', 3, i);
    if (r.category === 'CONSTRUCT') {
      assert.notEqual(r.itemKey, 'BRIDGE');
      assert.notEqual(r.itemKey, 'TUNNEL');
    }
  }

  // Free Epic Tactical Voucher pulled on Round 6 bypasses Round 10 unlock & 3-round cooldown, costs €0, and does NOT trigger shop cooldown!
  const enemy = base.units.find(u => u.owner === 1)!;
  const r6WithVoucher: GameState = {
    ...base,
    totalTurns: 5, // Round 6 (< Round 10 Epic unlock!)
    playerGold: { 0: 0, 1: 0 }, // Zero gold!
    tacticalCooldowns: { 0: { CARPET_RUN: 9 } }, // Even if shop copy were on cooldown
    playerTacticalVouchers: { 0: ['CARPET_RUN'] },
  };
  assert.equal(hasTacticalVoucher(r6WithVoucher, 0, 'CARPET_RUN'), true);
  assert.equal(
    tacticalBlocker(r6WithVoucher, 0, 'CARPET_RUN', { tileId: enemy.tileId, tileIds: [enemy.tileId] }),
    null,
    'Tactical voucher unlocks Epic early, ignores €0 gold, and bypasses shop cooldown',
  );
  assert.ok(legalTacticalAnchors(r6WithVoucher, 0, 'CARPET_RUN').includes(enemy.tileId));

  const fired = applyAction(r6WithVoucher, {
    type: 'USE_TACTICAL',
    itemKey: 'CARPET_RUN',
    tileId: enemy.tileId,
    tileIds: [enemy.tileId],
  });
  assert.equal(fired.rejected, undefined);
  assert.equal(fired.state.playerTacticalVouchers?.[0]?.length, 0, 'voucher consumed');
  assert.equal(fired.state.playerGold[0], 0, 'cost €0');
  assert.equal(fired.state.tacticalRound?.[0], 6, 'still respects 1 tactical per round');
  assert.equal(fired.state.tacticalCooldowns?.[0]?.CARPET_RUN, 9, 'does not overwrite shop cooldown');

  // Free Shop Construct Voucher (BARRIER) builds for €0 even with €0 gold!
  const openTile = base.mapData.find(
    t => t.type === 'PLAINS' && !t.loot && !base.units.some(u => u.tileId === t.id),
  )!;
  const withShopVoucher: GameState = {
    ...base,
    playerGold: { 0: 0, 1: 0 },
    playerShopVouchers: { 0: ['BARRIER'] },
  };
  const built = applyAction(withShopVoucher, {
    type: 'BUILD',
    itemKey: 'BARRIER',
    tileId: openTile.id,
    tileIds: [openTile.id],
  });
  assert.equal(built.rejected, undefined, 'Free Barrier voucher builds with €0 gold');
  assert.equal(built.state.playerShopVouchers?.[0]?.length, 0, 'shop voucher consumed');
  assert.equal(built.state.mapData.find(t => t.id === openTile.id)?.type, 'BARRIER');
});
