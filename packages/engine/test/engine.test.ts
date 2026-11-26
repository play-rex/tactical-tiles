import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction,
  botAction,
  createGeneratedGame,
  eventsFor,
  getAttackBlocker,
  getCrossfireSupporters,
  getSpawnTiles,
  getSupplyDropTargets,
  prepareAction,
  spawnUnitsForPlayers,
  viewFor,
  visibleSet,
  DEFAULT_GAME_SETTINGS,
  moveCostsFor,
  type GameAction,
  type GameState,
} from '../src/index';
import { BANK_STATS, BASE_STATS, COMBAT_BONUSES, CP_SYSTEM, GOLD_SETTINGS, LAND_MINE_STATS, MOMENTUM_REFUNDS, RESPAWN_CP_COST, SHOP_ITEMS, getDoomsdayStartTurn } from '../src/constants/Config';
import { getDoomsdayEscalation } from '../src/grid/DoomsdayManager';
import { getUnitAttackCost, isWithinEnemyHqExclusion } from '../src/rules/CombatRules';
import { initBankVaults } from '../src/game/setup';
import { getStepCost } from '../src/grid/Pathfinding';
import { calculateAttackOutcome, calculateDemolishDamage, calculateOverwatchOutcome } from '../src/rules/CombatRules';
import type { GameSettings, Tile, Unit } from '../src/types';

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({ ...DEFAULT_GAME_SETTINGS, ...over });

/** Plays a whole game with bots, every action checked as the server would. */
function playOut(game: GameState, maxActions = 4000) {
  let rejected = 0;
  const reasons: string[] = [];
  let actions = 0;
  while (game.winner === null && actions < maxActions) {
    const seat = game.currentPlayer;
    const proposed = botAction(game);
    const prepared = prepareAction(game, seat, proposed);
    let action: GameAction;
    if (prepared.ok) action = prepared.action;
    else {
      rejected++;
      reasons.push(`${proposed.type}: ${prepared.error}`);
      action = { type: 'END_TURN' };
    }
    const result = applyAction(game, action, { autoBankReward: true });
    if (result.rejected) {
      // A rejected END_TURN would loop forever
      assert.notEqual(action.type, 'END_TURN');
      game = applyAction(game, { type: 'END_TURN' }, { autoBankReward: true }).state;
    } else {
      game = result.state;
    }
    actions++;
  }
  return { game, rejected, reasons, actions };
}

test('bots finish games, and the server-side check accepts what they play', () => {
  const runs = [
    settings({ mapSeed: 'ALPHA1' }),
    settings({ mapSeed: 'BRAVO2', victoryMode: 'DEATHMATCH', doomsdayEnabled: true }),
    settings({ mapSeed: 'CHARL3', fogOfWar: true }),
    settings({ mapSeed: 'DELTA4', playerCount: 4 }),
    settings({ mapSeed: 'ECHO55', playerCount: 3, fogOfWar: true, victoryMode: 'DEATHMATCH' }),
  ];
  let totalActions = 0;
  let totalRejected = 0;
  const allReasons: string[] = [];
  for (const s of runs) {
    const { game, rejected, reasons, actions } = playOut(createGeneratedGame(s));
    totalActions += actions;
    totalRejected += rejected;
    allReasons.push(...reasons);
    assert.ok(actions > 10, `${s.mapSeed}: game ended suspiciously fast`);
    // The state must survive the trip over the wire (JSON drops undefined fields, nothing else)
    const wire = JSON.stringify(game);
    assert.equal(JSON.stringify(JSON.parse(wire)), wire);
  }
  // The AI and the validator agree on (almost) everything. Report what they don't.
  if (totalRejected) console.log('rejected bot actions:', [...new Set(allReasons)]);
  assert.ok(totalRejected / totalActions < 0.01, `${totalRejected}/${totalActions} bot actions rejected`);
});

test('prepareAction: only the current player acts, and costs come from the rules', () => {
  const game = createGeneratedGame(settings({ mapSeed: 'RULES1' }));
  const mine = game.units.find(u => u.owner === 0)!;

  assert.equal(prepareAction(game, 1, { type: 'END_TURN' }).ok, false, 'not their turn');

  // A move claimed at 0 CP is charged what it really costs
  const mover = game.units.find(u => u.owner === 0 && moveCostsFor(game, u).size > 0)!;
  const [targetTileId] = moveCostsFor(game, mover).keys();
  const anyMove: GameAction = { type: 'MOVE', unitId: mover.id, targetTileId, cost: 0 };
  assert.ok(anyMove && anyMove.type === 'MOVE');
  const cheap = prepareAction(game, 0, { ...anyMove, cost: 0 });
  assert.ok(cheap.ok && cheap.action.type === 'MOVE' && cheap.action.cost > 0);

  // Moving an enemy unit, or to somewhere unreachable, is refused
  const enemy = game.units.find(u => u.owner === 1)!;
  assert.equal(prepareAction(game, 0, { type: 'MOVE', unitId: enemy.id, targetTileId: anyMove.targetTileId, cost: 1 }).ok, false);
  const far = game.mapData[game.mapData.length - 1];
  assert.equal(prepareAction(game, 0, { type: 'MOVE', unitId: mine.id, targetTileId: far.id, cost: 1 }).ok, false);

  // Attacking a unit that isn't in range is refused
  assert.equal(prepareAction(game, 0, { type: 'ATTACK', attackerId: mine.id, targetUnitId: enemy.id, cost: 1 }).ok, false);

  // Shop: can't buy what you can't afford, can't drop supplies across the map
  const broke = { ...game, playerGold: { 0: 0, 1: 0 } };
  assert.equal(prepareAction(broke, 0, { type: 'BUY_ITEM', itemKey: 'MEDKIT' }).ok, false);
  assert.equal(prepareAction(game, 0, { type: 'BUY_DROP', itemKey: 'MEDKIT', tileId: far.id, cost: 0, goldCost: 0 }).ok, false);
  assert.equal(prepareAction(game, 0, { type: 'BANK_REWARD', choice: 'GOLD' }).ok, false, 'no vault breached');
});

test('a breached vault must be claimed before anything else', () => {
  const game: GameState = {
    ...createGeneratedGame(settings({ mapSeed: 'VAULT1' })),
    bankRewardPending: { tileId: '0,0', playerId: 0 },
  };
  const proposal = botAction(game);
  assert.equal(prepareAction(game, 0, proposal).ok, proposal.type === 'END_TURN');
  assert.ok(prepareAction(game, 0, { type: 'BANK_REWARD', choice: 'CP' }).ok);
  const after = applyAction(game, { type: 'BANK_REWARD', choice: 'GOLD' });
  assert.equal(after.state.bankRewardPending, null);
  assert.ok(after.state.playerGold[0] > game.playerGold[0]);
});

test('viewFor: fog hides enemies out of sight, and private choices stay private', () => {
  const game = createGeneratedGame(settings({ mapSeed: 'FOGGY1', fogOfWar: true }));
  const withSecrets: GameState = {
    ...game,
    pendingDrops: [{ playerId: 1, tileId: '1,1', item: 'MEDKIT' }],
    bankRewardPending: { tileId: '2,2', playerId: 1 },
  };
  const view = viewFor(withSecrets, 0);
  const visible = new Set(view.visibleTiles);
  assert.ok(view.game.units.every((u: Unit) => u.owner === 0 || visible.has(u.tileId)));
  assert.ok(view.game.units.length < game.units.length, 'enemy squad starts out of sight');
  assert.equal(view.game.pendingDrops.length, 0);
  assert.equal(view.game.bankRewardPending, null);
  assert.equal(viewFor(withSecrets, 1).game.bankRewardPending?.playerId, 1);

  // Without fog everyone sees every unit
  const open = createGeneratedGame(settings({ mapSeed: 'FOGGY1' }));
  assert.equal(viewFor(open, 0).game.units.length, open.units.length);
});

test('eventsFor: effects out of sight are dropped under fog', () => {
  const seen = new Set(['1,1']);
  const events = [
    { kind: 'projectile' as const, from: { x: 1, y: 1 }, to: { x: 9, y: 9 }, style: 'BULLET' as const },
    { kind: 'popup' as const, at: { x: 9, y: 9 }, text: '-5', color: '#f00', lift: 10 },
    { kind: 'sound' as const, sound: 'hit' as const },
  ];
  assert.equal(eventsFor(events, true, seen, seen).length, 2);
  assert.equal(eventsFor(events, false, seen, seen).length, 3);
});

test('visibleSet: empty without fog (everything is visible), partial with it', () => {
  const open = createGeneratedGame(settings({ mapSeed: 'SIGHT1' }));
  assert.equal(visibleSet(open, 0).size, 0);
  const fog = createGeneratedGame(settings({ mapSeed: 'SIGHT1', fogOfWar: true }));
  const size = visibleSet(fog, 0).size;
  assert.ok(size > 0 && size < fog.mapData.length);
});

test('applyAction rejects post-match actions, respects bridge H variant, and viewFor redacts build coordinates under fog', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'BUILD1', fogOfWar: true }));
  const won: GameState = { ...base, winner: 0 };
  const postWin = applyAction(won, { type: 'END_TURN' });
  assert.ok(postWin.rejected, 'ended game rejects further actions');

  // Find a water/canyon tile and force an explicit H bridge even when top/bottom are land
  const waterIdx = base.mapData.findIndex(t => (t.type === 'WATER' || t.type === 'CANYON') && t.y > 0 && t.y < base.gridSize - 1);
  if (waterIdx !== -1) {
    const waterTile = base.mapData[waterIdx];
    const mapWithLandNS = base.mapData.map(t => {
      if (t.x === waterTile.x && (t.y === waterTile.y - 1 || t.y === waterTile.y + 1)) {
        return { ...t, type: 'PLAINS' as const };
      }
      if (t.y === waterTile.y && (t.x === waterTile.x - 1 || t.x === waterTile.x + 1)) {
        return { ...t, type: 'WATER' as const };
      }
      return t;
    });
    const rich: GameState = {
      ...base,
      mapData: mapWithLandNS,
      playerGold: { ...base.playerGold, 0: 500 },
      units: base.units.filter(u => u.tileId !== waterTile.id),
    };
    const prepared = prepareAction(rich, 0, { type: 'BUILD', itemKey: 'BRIDGE', tileId: waterTile.id, variant: 'H' });
    assert.ok(prepared.ok);
    const built = applyAction(rich, prepared.action);
    assert.equal(built.rejected, undefined);
    const updatedTile = built.state.mapData[waterIdx];
    assert.equal(updatedTile.type, 'BRIDGE', 'explicit H variant preserves horizontal BRIDGE');

    // Opponent under fog should see redacted build log coordinates
    const p1View = viewFor(built.state, 1);
    const buildLog = p1View.game.gameLog.find(l => l.playerId === 0 && l.message.includes('Built'));
    assert.ok(buildLog);
    assert.equal(buildLog.message.includes(`(${waterTile.x},${waterTile.y})`), false);
    const p0View = viewFor(built.state, 0);
    const ownBuildLog = p0View.game.gameLog.find(l => l.playerId === 0 && l.message.includes('Built'));
    assert.ok(ownBuildLog?.message.includes(`(${waterTile.x},${waterTile.y})`));
  }
});

test('crossfire grants +2 DMG when an armed ally also has range and LOS onto the target', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'XFIRE1', fogOfWar: false, playerCount: 2 }));
  const plainsMap = base.mapData.map(t => ({
    ...t,
    type: 'PLAINS' as const,
    hazardState: undefined,
    owner: undefined,
  }));
  const clearWeather = { ...base.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } };
  const p0Attacker = base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!;
  const p0Soldier = base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!;
  const p1Target = base.units.find(u => u.owner === 1 && u.type === 'ASSAULTER')!;

  const attacker: Unit = { ...p0Attacker, tileId: '4,4', hp: 12, maxHp: 12, ammo: 6, completed: false };
  const target: Unit = { ...p1Target, tileId: '5,4', hp: 20, maxHp: 20, ammo: 6 };
  const supportSoldier: Unit = { ...p0Soldier, tileId: '5,5', hp: 10, maxHp: 10, ammo: 6 };
  const emptySoldier: Unit = { ...supportSoldier, ammo: 0 };

  const targetTile = plainsMap.find(t => t.id === target.tileId)!;

  // Baseline attack without crossfire supporter (empty ammo ally shouldn't count)
  const soloState: GameState = {
    ...base,
    weather: clearWeather,
    mapData: plainsMap,
    units: [attacker, emptySoldier, target],
    currentPlayer: 0,
    playerCp: { ...base.playerCp, 0: 20 },
  };
  assert.equal(getCrossfireSupporters(attacker, targetTile, soloState.units, plainsMap, soloState.weather, soloState.gridSize).length, 0);
  const soloAttack = applyAction(soloState, { type: 'ATTACK', attackerId: attacker.id, targetUnitId: target.id, cost: 4 });
  assert.equal(soloAttack.rejected, undefined);
  const soloDmg = target.hp - soloAttack.state.units.find(u => u.id === target.id)!.hp;

  // Attack with armed ally in range + LOS triggers Crossfire +2 bonus
  const xfireState: GameState = {
    ...soloState,
    units: [attacker, supportSoldier, target],
  };
  const supporters = getCrossfireSupporters(attacker, targetTile, xfireState.units, plainsMap, xfireState.weather, xfireState.gridSize);
  assert.equal(supporters.length, 1);
  assert.equal(supporters[0].id, supportSoldier.id);
  const xfireAttack = applyAction(xfireState, { type: 'ATTACK', attackerId: attacker.id, targetUnitId: target.id, cost: 4 });
  assert.equal(xfireAttack.rejected, undefined);
  const xfireDmg = target.hp - xfireAttack.state.units.find(u => u.id === target.id)!.hp;
  assert.equal(xfireDmg, soloDmg + COMBAT_BONUSES.CROSSFIRE_DAMAGE);
  assert.ok(xfireAttack.state.gameLog.some(l => l.message.includes('(Crossfire)')));
});

test('captured buildings grant territory gold on END_TURN and BUY_ITEM allows targeted drop only vs AI', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'ECON1', fogOfWar: false, playerCount: 2, gameMode: 'PVE' }));
  const mapWithBuildings = base.mapData.map((t, idx) =>
    idx === 0 || idx === 1
      ? { ...t, type: 'BUILDING' as const, subType: 'WATCHTOWER' as const, owner: 1 }
      : t
  );
  const state: GameState = {
    ...base,
    mapData: mapWithBuildings,
    currentPlayer: 0,
    playerGold: { ...base.playerGold, 0: 500, 1: 100 },
  };

  assert.equal(SHOP_ITEMS.FIRST_AID.cost, 100);
  assert.equal(SHOP_ITEMS.MEDKIT.cost, 200);

  // Targeted BUY_ITEM within drop zone schedules exact tileId in PVE (vs AI)
  const dropTargets = Array.from(getSupplyDropTargets(state, 0));
  assert.ok(dropTargets.length > 0);
  const chosenTileId = dropTargets[0];
  const buyPrep = prepareAction(state, 0, { type: 'BUY_ITEM', itemKey: 'MEDKIT', tileId: chosenTileId });
  assert.ok(buyPrep.ok, 'valid drop tile should prepare cleanly vs AI');
  const afterBuy = applyAction(state, buyPrep.action);
  assert.equal(afterBuy.rejected, undefined);
  assert.equal(afterBuy.state.pendingDrops[0]?.tileId, chosenTileId);
  assert.equal(afterBuy.state.playerGold[0], 500 - SHOP_ITEMS.MEDKIT.cost);

  // First Aid Kit targeted drop (100€) lands FIRST_AID loot and heals 50% of max HP
  const faTileId = dropTargets[dropTargets.length > 1 ? 1 : 0];
  const buyFirstAidPrep = prepareAction(afterBuy.state, 0, { type: 'BUY_ITEM', itemKey: 'FIRST_AID', tileId: faTileId });
  assert.ok(buyFirstAidPrep.ok);
  const afterBuyFa = applyAction(afterBuy.state, buyFirstAidPrep.action);
  assert.equal(afterBuyFa.rejected, undefined);
  assert.equal(afterBuyFa.state.playerGold[0], 500 - SHOP_ITEMS.MEDKIT.cost - SHOP_ITEMS.FIRST_AID.cost);
  const woundedScout = afterBuyFa.state.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!;
  const scoutTile = afterBuyFa.state.mapData.find(t => t.id === woundedScout.tileId)!;
  const faInventoryState: GameState = {
    ...afterBuyFa.state,
    units: afterBuyFa.state.units.map(u => u.id === woundedScout.id ? { ...u, hp: 5 } : u),
    playerInventory: { ...afterBuyFa.state.playerInventory, 0: ['FIRST_AID'] },
    playerCp: { ...afterBuyFa.state.playerCp, 0: 20 },
  };
  const useFa = applyAction(faInventoryState, { type: 'USE_ITEM', unitId: woundedScout.id, itemIndex: 0, cost: 2 });
  assert.equal(useFa.rejected, undefined);
  assert.equal(useFa.state.units.find(u => u.id === woundedScout.id)?.hp, 5 + Math.ceil(woundedScout.maxHp * 0.5));
  const aiFirstAidDrop = applyAction(afterBuyFa.state, {
    type: 'BUY_DROP',
    itemKey: 'FIRST_AID',
    tileId: scoutTile.id,
    cost: 0,
    goldCost: SHOP_ITEMS.FIRST_AID.cost,
  });
  assert.equal(aiFirstAidDrop.rejected, undefined);
  assert.equal(aiFirstAidDrop.state.mapData.find(t => t.id === scoutTile.id)?.loot, 'FIRST_AID');

  // Multiplayer (PVP) rejects targeted drop tileId and uses random drop without tileId
  const pvpState: GameState = { ...state, settings: { ...state.settings, gameMode: 'PVP' } };
  assert.equal(prepareAction(pvpState, 0, { type: 'BUY_ITEM', itemKey: 'MEDKIT', tileId: chosenTileId }).ok, false);
  const pvpRandomPrep = prepareAction(pvpState, 0, { type: 'BUY_ITEM', itemKey: 'MEDKIT' });
  assert.ok(pvpRandomPrep.ok);
  const afterPvpRandom = applyAction(pvpState, pvpRandomPrep.action);
  assert.equal(afterPvpRandom.rejected, undefined);
  assert.equal(afterPvpRandom.state.pendingDrops.length, 1);

  // Invalid / out-of-range tile is rejected by prepareAction
  const invalidTile = mapWithBuildings.find(t => !dropTargets.includes(t.id));
  if (invalidTile) {
    const badPrep = prepareAction(state, 0, { type: 'BUY_ITEM', itemKey: 'MEDKIT', tileId: invalidTile.id });
    assert.equal(badPrep.ok, false);
  }

  // END_TURN lands drops and pays P1 base income + 2 * BUILDING_INCOME
  const afterEnd = applyAction(afterBuyFa.state, { type: 'END_TURN' });
  assert.equal(afterEnd.rejected, undefined);
  assert.equal(afterEnd.state.currentPlayer, 1);
  assert.equal(afterEnd.state.playerGold[1], 100 + GOLD_SETTINGS.INCOME_PER_TURN + 2 * GOLD_SETTINGS.BUILDING_INCOME);
  assert.equal(afterEnd.state.mapData.find(t => t.id === chosenTileId)?.loot, 'MEDKIT');
  if (faTileId !== chosenTileId) {
    assert.equal(afterEnd.state.mapData.find(t => t.id === faTileId)?.loot, 'FIRST_AID');
  }
});

test('gold economy settings drive starting gold and turn income', () => {
  assert.equal(DEFAULT_GAME_SETTINGS.startingGold, 200);
  assert.equal(DEFAULT_GAME_SETTINGS.goldIncome, 20);

  const base = createGeneratedGame(settings({
    mapSeed: 'GOLDECON', fogOfWar: false, playerCount: 2, startingGold: 300, goldIncome: 15,
  }));
  assert.equal(base.playerGold[0], 300);
  assert.equal(base.playerGold[1], 300);

  const p1Buildings = base.mapData.filter(t => t.type === 'BUILDING' && t.owner === 1).length;
  const after = applyAction(base, { type: 'END_TURN' });
  assert.equal(after.rejected, undefined);
  assert.equal(after.state.playerGold[1], 300 + 15 + p1Buildings * GOLD_SETTINGS.BUILDING_INCOME);
});

test('Doomsday escalation raises CP regen at Collapse and Meltdown', () => {
  assert.equal(getDoomsdayEscalation(29, true).stage, 'SKIRMISH');
  assert.equal(getDoomsdayEscalation(30, true).stage, 'COLLAPSE');
  assert.equal(getDoomsdayEscalation(30, true).regenBonus, 2);
  assert.equal(getDoomsdayEscalation(39, true).stage, 'COLLAPSE');
  assert.equal(getDoomsdayEscalation(40, true).stage, 'MELTDOWN');
  assert.equal(getDoomsdayEscalation(40, true).regenBonus, 4);
  assert.equal(getDoomsdayEscalation(40, false).regenBonus, 0);

  // Keep this arm on the legacy Round-30 clock so it tests the escalation maths, not the pacing table.
  const base = createGeneratedGame(settings({
    mapSeed: 'DOOMSTAGE', fogOfWar: false, playerCount: 2, victoryMode: 'DEATHMATCH', doomsdayEnabled: true,
    doomsdayStartTurn: 30,
  }));
  const stateAt = (totalTurns: number): GameState => ({
    ...base,
    totalTurns,
    // The last seat ends the round, so the completed-round counter advances before P0 regens.
    currentPlayer: 1,
    playerCp: { 0: 5, 1: 10 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpBorrowed: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
  });

  const collapse = applyAction(stateAt(29), { type: 'END_TURN' }).state;
  assert.equal(collapse.currentPlayer, 0);
  assert.equal(collapse.playerCp[0], 5 + CP_SYSTEM.REGEN_AMOUNT + 2);

  const meltdown = applyAction(stateAt(39), { type: 'END_TURN' }).state;
  assert.equal(meltdown.playerCp[0], 5 + CP_SYSTEM.REGEN_AMOUNT + 4);
});

test('Doomsday start round scales by map size and honours an explicit override', () => {
  assert.equal(getDoomsdayStartTurn({ playerCount: 2 }, 20), 8);
  assert.equal(getDoomsdayStartTurn({ playerCount: 4 }, 20), 8);
  assert.equal(getDoomsdayStartTurn({ playerCount: 4 }, 25), 10);
  assert.equal(getDoomsdayStartTurn({ playerCount: 6 }, 30), 10);
  assert.equal(getDoomsdayStartTurn({ playerCount: 2 }), 8);
  assert.equal(getDoomsdayStartTurn({ playerCount: 4 }), 10);
  assert.equal(getDoomsdayStartTurn({ playerCount: 2, doomsdayStartTurn: 30 }, 20), 30);
});

test('getAttackBlocker returns accurate tactical reasons when a shot is unavailable', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'BLOCK1', fogOfWar: false, playerCount: 2 }));
  const clearWeather = { ...base.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } };
  const plainsMap = base.mapData.map(t => ({ ...t, type: 'PLAINS' as const, hazardState: undefined }));
  const p0Sniper = base.units.find(u => u.owner === 0 && u.type === 'SNIPER')!;
  const p0Assaulter = base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!;

  const state: GameState = {
    ...base,
    weather: clearWeather,
    mapData: plainsMap,
    units: [
      { ...p0Assaulter, tileId: '2,2', ammo: 0, completed: false },
      { ...p0Sniper, tileId: '3,3', ammo: 4, completed: false },
    ],
    playerCp: { ...base.playerCp, 0: 10 },
  };
  const closeTile = plainsMap.find(t => t.id === '3,2')!;
  const farTile = plainsMap.find(t => t.id === '12,12')!;

  assert.equal(
    getAttackBlocker(state, state.units[0], closeTile),
    'Out of ammo — Field Reload first'
  );
  assert.equal(
    getAttackBlocker(state, state.units[1], closeTile),
    'Sniper needs Mountain, Dunes, or Owned Building'
  );

  const highSniperMap = plainsMap.map(t => (t.id === '3,3' ? { ...t, type: 'MOUNTAIN' as const } : t));
  const mountainState: GameState = { ...state, mapData: highSniperMap };
  assert.ok(getAttackBlocker(mountainState, mountainState.units[1], farTile)?.startsWith('Out of range'));
  assert.equal(getAttackBlocker(mountainState, mountainState.units[1], closeTile), null);
});

test('terrain pathfinding: Mountains are Sniper-only and Buildings block unowned passage (Option A)', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'OPT_A1', fogOfWar: false, playerCount: 2 }));
  const clearWeather = { ...base.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } };
  const map: Tile[] = base.mapData.map(t => ({
    ...t,
    type: 'PLAINS' as const,
    subType: undefined,
    owner: undefined,
    hazardState: undefined,
  }));
  const setTile = (id: string, patch: Partial<Tile>) => {
    const idx = map.findIndex(t => t.id === id);
    if (idx !== -1) map[idx] = { ...map[idx], ...patch };
  };
  setTile('3,2', { type: 'MOUNTAIN', height: 2 });
  setTile('2,3', { type: 'BUILDING', subType: 'BUNKER', owner: undefined });
  setTile('1,3', { type: 'BUILDING', subType: 'BUNKER', owner: 0 });
  setTile('3,3', { type: 'BUILDING', subType: 'WATCHTOWER', owner: 0 });

  const soldier = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '2,2', completed: false, hasMoved: false };
  const assaulter = { ...base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!, tileId: '2,2', completed: false, hasMoved: false };
  const sniper = { ...base.units.find(u => u.owner === 0 && u.type === 'SNIPER')!, tileId: '2,2', completed: false, hasMoved: false };

  const mkState = (u: Unit): GameState => ({
    ...base,
    weather: clearWeather,
    mapData: map,
    units: [u],
    currentPlayer: 0,
    playerCp: { ...base.playerCp, 0: 20 },
  });

  const sMoves = moveCostsFor(mkState(soldier), soldier);
  const aMoves = moveCostsFor(mkState(assaulter), assaulter);
  const nMoves = moveCostsFor(mkState(sniper), sniper);

  // Scouts and Breachers cannot step on Mountains, unowned Buildings, or owned Watchtowers,
  // while they CAN garrison an owned Bunker.
  assert.equal(sMoves.has('3,2'), false, 'Scout blocked from Mountain');
  assert.equal(aMoves.has('3,2'), false, 'Breacher blocked from Mountain');
  assert.equal(nMoves.has('3,2'), true, 'Sniper can climb Mountain');

  assert.equal(sMoves.has('2,3'), false, 'Scout blocked from unowned Building');
  assert.equal(nMoves.has('2,3'), false, 'Sniper blocked from unowned Building');

  assert.equal(sMoves.has('1,3'), true, 'Scout can enter owned Bunker');
  assert.equal(aMoves.has('1,3'), true, 'Breacher can enter owned Bunker');
  assert.equal(sMoves.has('3,3'), false, 'Scout cannot enter owned Watchtower');
  assert.equal(nMoves.has('3,3'), true, 'Sniper can enter owned Watchtower');
});

test('weather movement costs follow destination tile zone across Scorched, Monsoon, Sandstorm, and Tailwind', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'WZONE1', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => ({
    ...t,
    type: t.id === '5,5' ? ('SAND' as const) : ('PLAINS' as const),
    subType: undefined,
    owner: undefined,
    hazardState: undefined,
    zone: t.x < 5 ? 0 : 1,
  }));
  const mixedWeather = {
    playerZones: { 0: 'SCORCHED' as const, 1: 'TAILWIND' as const },
    turnsRemaining: 5,
  };
  const scoutR0 = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '4,4', rank: 0 as const, completed: false, hasMoved: false };
  const scoutR2 = { ...scoutR0, rank: 2 as const };
  const stateR0: GameState = {
    ...base,
    mapData: map,
    weather: mixedWeather,
    units: [scoutR0],
    currentPlayer: 0,
    playerCp: { ...base.playerCp, 0: 20 },
  };
  const movesR0 = moveCostsFor(stateR0, scoutR0);
  // Stepping inside Zone 0 (SCORCHED Plains) costs 2 CP; stepping across border into Zone 1 (TAILWIND Plains) costs 0.5 CP
  assert.equal(movesR0.get('3,4'), 2);
  assert.equal(movesR0.get('5,4'), 0.5);

  // Monsoon & Sandstorm slow Rank 0 Scouts (Plains in Monsoon -> 2 CP; Sand in Sandstorm -> 2 CP), while Rank 2 Scouts stay immune
  const monsoonStormState: GameState = {
    ...stateR0,
    weather: { playerZones: { 0: 'MONSOON', 1: 'SANDSTORM' }, turnsRemaining: 5 },
  };
  const mMovesR0 = moveCostsFor(monsoonStormState, scoutR0);
  assert.equal(mMovesR0.get('3,4'), 2, 'Monsoon mud slows Rank 0 Scout on Plains');
  assert.equal(mMovesR0.get('5,4'), 1, 'Sandstorm does not slow Plains');
  // Crossing to 5,5 (Zone 1 SAND in SANDSTORM): 1 (to 5,4 Plains) + 2 (to 5,5 Sandstorm Sand) = 3 CP
  assert.equal(mMovesR0.get('5,5'), 3, 'Sandstorm slows Rank 0 Scout on Sand');

  const mMovesR2 = moveCostsFor({ ...monsoonStormState, units: [scoutR2] }, scoutR2);
  assert.equal(mMovesR2.get('3,4'), 1, 'Rank 2 Elite Scout ignores Monsoon mud');
  assert.equal(mMovesR2.get('5,5'), 2, 'Rank 2 Elite Scout ignores Sandstorm Sand slowdown');
});

test('Barrier x3 builds up to 3 tiles for 150€ and Land Mine deals 8 DMG + stops move while staying hidden from enemies', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'MINE3B', fogOfWar: false, playerCount: 2 }));
  const clearWeather = { ...base.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } };
  const map: Tile[] = base.mapData.map(t => {
    if (t.id === '1,1') return { ...t, type: 'BASE' as const, owner: 0, hp: 50, maxHp: 50, hazardState: undefined };
    if (t.id === '14,14') return { ...t, type: 'BASE' as const, owner: 1, hp: 50, maxHp: 50, hazardState: undefined };
    if (t.id === '7,7') return { ...t, type: 'BUILDING' as const, subType: 'BUNKER' as const, owner: 1, hazardState: undefined };
    return { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined };
  });
  const p0Scout = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '2,2', completed: false, hasMoved: false };
  const p1Scout = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '5,7', hp: 15, maxHp: 15, completed: false, hasMoved: false };
  const state: GameState = {
    ...base,
    mapData: map,
    weather: clearWeather,
    units: [p0Scout, p1Scout],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    mines: [],
  };

  assert.equal(SHOP_ITEMS.BARRIER.cost, 150);
  assert.equal(SHOP_ITEMS.LAND_MINE.cost, 75);

  // 1. Barrier x3 places all 3 tiles atomically for 150€
  const barPrep = prepareAction(state, 0, { type: 'BUILD', itemKey: 'BARRIER', tileId: '4,4', tileIds: ['4,4', '4,5', '4,6'] });
  assert.ok(barPrep.ok);
  const afterBar = applyAction(state, barPrep.action);
  assert.equal(afterBar.rejected, undefined);
  assert.equal(afterBar.state.playerGold[0], 500 - 150);
  for (const tid of ['4,4', '4,5', '4,6']) {
    const t = afterBar.state.mapData.find(x => x.id === tid)!;
    assert.equal(t.type, 'BARRIER');
    assert.equal(t.hp, 10);
  }

  // 2. Land Mine allows planting near enemy Building (7,7) but rejects within 5-tile square radius of enemy HQ (14,14)
  const nearEnemyHq = prepareAction(afterBar.state, 0, { type: 'BUILD', itemKey: 'LAND_MINE', tileId: '9,9' });
  assert.equal(nearEnemyHq.ok, false, '5-tile square radius around enemy HQ (14,14) blocks mine placement');
  assert.equal(isWithinEnemyHqExclusion({ x: 9, y: 9 }, 0, map), true);
  assert.equal(isWithinEnemyHqExclusion({ x: 8, y: 9 }, 0, map), false);

  // Adjacent to enemy Bunker at 7,7 IS allowed because exclusion applies only to enemy HQ
  const nearBuildingPrep = prepareAction(afterBar.state, 0, { type: 'BUILD', itemKey: 'LAND_MINE', tileId: '7,6' });
  assert.ok(nearBuildingPrep.ok, 'buildings do not block land mine placement');

  // Plant mine at 6,7 right along p1Scout path from 5,7 -> 8,7
  const minePrep = prepareAction(afterBar.state, 0, { type: 'BUILD', itemKey: 'LAND_MINE', tileId: '6,7' });
  assert.ok(minePrep.ok);
  const afterMine = applyAction(afterBar.state, minePrep.action);
  assert.equal(afterMine.rejected, undefined);
  assert.equal(afterMine.state.playerGold[0], 500 - 150 - 75);
  assert.equal(afterMine.state.mines.length, 1);

  // 3. Even with fogOfWar === false, opponent viewFor hides mines and plant coordinates
  const p0View = viewFor(afterMine.state, 0);
  const p1View = viewFor(afterMine.state, 1);
  assert.equal(p0View.game.mines.length, 1);
  assert.equal(p1View.game.mines.length, 0);
  assert.equal(p1View.game.gameLog.some(l => l.message.includes('Planted Land Mine')), false);

  // 4. End turn and move P1 Scout from 5,7 -> 8,7 passing over 6,7: triggers Land Mine (8 DMG + halts on 6,7)
  const p1Turn = applyAction(afterMine.state, { type: 'END_TURN' }).state;
  const movePrep = prepareAction(p1Turn, 1, { type: 'MOVE', unitId: p1Scout.id, targetTileId: '8,7', cost: 0 });
  assert.ok(movePrep.ok);
  const afterTrigger = applyAction(p1Turn, movePrep.action);
  assert.equal(afterTrigger.rejected, undefined);
  const hitScout = afterTrigger.state.units.find(u => u.id === p1Scout.id)!;
  assert.equal(hitScout.tileId, '6,7', 'unit stops on mine tile');
  assert.equal(hitScout.hp, 15 - LAND_MINE_STATS.DAMAGE, 'mine deals 8 DMG');
  assert.equal(afterTrigger.state.playerCp[1], p1Turn.playerCp[1] - 1, 'only 1 CP spent walking onto 6,7');
  assert.equal(afterTrigger.state.mines.length, 0, 'triggered mine is consumed');
});

test('eventsFor enforces fog-of-war honesty on declarative FX events (movePath trimming, located shakes, secret mines)', () => {
  const before = new Set(['2,2', '3,2']);
  const after = new Set(['3,2', '4,2']);
  const events = [
    {
      kind: 'movePath' as const,
      unitId: 'u1',
      unitType: 'SOLDIER' as const,
      owner: 1,
      path: [
        { x: 0, y: 2 },
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ],
    },
    {
      kind: 'movePath' as const,
      unitId: 'u2',
      unitType: 'SNIPER' as const,
      owner: 1,
      path: [
        { x: 9, y: 9 },
        { x: 9, y: 8 },
      ],
    },
    { kind: 'shake' as const, intensity: 10, at: { x: 9, y: 9 } },
    { kind: 'shake' as const, intensity: 8, at: { x: 3, y: 2 } },
    {
      kind: 'hit' as const,
      targetUnitId: 'u1',
      at: { x: 3, y: 2 },
      from: { x: 9, y: 9 },
      damage: 5,
      crossfireFrom: [{ x: 2, y: 2 }, { x: 9, y: 8 }],
    },
    {
      kind: 'killed' as const,
      unitId: 'u2',
      unitType: 'SNIPER' as const,
      owner: 1,
      rank: 2,
      at: { x: 9, y: 9 },
      cause: 'COMBAT' as const,
    },
    { kind: 'mineBlast' as const, at: { x: 3, y: 2 }, damage: 8, victimDead: false },
    { kind: 'mineBlast' as const, at: { x: 8, y: 8 }, damage: 8, victimDead: true },
    { kind: 'build' as const, tiles: [{ x: 3, y: 2 }, { x: 8, y: 8 }], itemKey: 'BARRIER' as const },
    { kind: 'capture' as const, at: { x: 3, y: 2 }, owner: 0, subType: 'WATCHTOWER' as const },
    { kind: 'capture' as const, at: { x: 9, y: 9 }, owner: 1, subType: 'BUNKER' as const },
    { kind: 'spawn' as const, unitId: 'u_sp1', unitType: 'SOLDIER' as const, owner: 1, at: { x: 9, y: 9 } },
  ];

  const filtered = eventsFor(events, true, before, after);
  const movePaths = filtered.filter(e => e.kind === 'movePath');
  assert.equal(movePaths.length, 1, 'unseen movePath is dropped');
  assert.deepEqual(movePaths[0].path, [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }], 'hidden origin tiles are trimmed');

  const shakes = filtered.filter(e => e.kind === 'shake');
  assert.equal(shakes.length, 1, 'unseen located shake is dropped');
  assert.deepEqual(shakes[0].at, { x: 3, y: 2 });

  const hits = filtered.filter(e => e.kind === 'hit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].from, undefined, 'unseen attacker tile is stripped from hit event');
  assert.deepEqual(hits[0].crossfireFrom, [{ x: 2, y: 2 }], 'only visible crossfire supporters remain');

  assert.equal(filtered.filter(e => e.kind === 'killed').length, 0, 'unseen kill is hidden under fog');
  assert.equal(filtered.filter(e => e.kind === 'mineBlast').length, 1, 'only visible mine blast passes');
  assert.equal(filtered.filter(e => e.kind === 'capture').length, 1, 'only visible building capture passes');
  assert.equal(filtered.filter(e => e.kind === 'spawn').length, 0, 'unseen enemy redeploy is hidden under fog');

  const builds = filtered.filter(e => e.kind === 'build');
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0].tiles, [{ x: 3, y: 2 }]);

  // Without fog, all events pass verbatim
  assert.equal(eventsFor(events, false, before, after).length, events.length);
});

test('applyAction emits declarative animation cues and never leaks LAND_MINE build events', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'FXEV01', fogOfWar: false, playerCount: 2 }));
  const map = base.mapData.map(t => ({
    ...t,
    type: 'PLAINS' as const,
    subType: undefined,
    owner: undefined,
    hazardState: undefined,
  }));
  const clearWeather = { ...base.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } };
  const p0 = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '3,3', hp: 10, maxHp: 10, ammo: 5, completed: false, hasMoved: false };
  const p1 = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '5,3', hp: 3, maxHp: 10, ammo: 5 };
  const state: GameState = {
    ...base,
    mapData: map,
    weather: clearWeather,
    units: [p0, p1],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    mines: [],
  };

  // Planting a hidden Land Mine must NOT emit a `build` event
  const plantMine = applyAction(state, { type: 'BUILD', itemKey: 'LAND_MINE', tileId: '7,7' });
  assert.equal(plantMine.rejected, undefined);
  assert.equal(plantMine.events.some(e => e.kind === 'build'), false, 'hidden land mine never emits build event');

  // Lethal attack emits projectile (with weapon/attacker/target), hit, killed, and located shake
  const atk = applyAction(state, { type: 'ATTACK', attackerId: p0.id, targetUnitId: p1.id, cost: 3 });
  assert.equal(atk.rejected, undefined);
  const proj = atk.events.find(e => e.kind === 'projectile');
  const hit = atk.events.find(e => e.kind === 'hit');
  const killed = atk.events.find(e => e.kind === 'killed');
  const shake = atk.events.find(e => e.kind === 'shake');
  assert.ok(proj && proj.weapon === 'SOLDIER' && proj.attackerId === p0.id && proj.targetUnitId === p1.id);
  assert.ok(hit && hit.isKill === true && hit.targetUnitId === p1.id);
  assert.ok(killed && killed.unitId === p1.id && killed.cause === 'COMBAT' && killed.killerOwner === 0);
  assert.ok(shake && shake.at?.x === 5 && shake.at?.y === 3);

  // Events remain strictly JSON-serializable for Colyseus transport
  const wire = JSON.stringify(atk.events);
  assert.deepEqual(JSON.parse(wire), atk.events);
});

/** Flat CONQUER state: P0's HQ at full HP with the given P1 raiders parked inside artillery range. */
function hqSplashState(seed: string, raiderHp: number[]): { state: GameState; placed: Unit[] } {
  const base = createGeneratedGame(settings({ mapSeed: seed, fogOfWar: false, playerCount: 2, victoryMode: 'CONQUER' }));
  const hq = base.mapData.find(t => t.type === 'BASE' && t.owner === 0)!;
  const map = base.mapData.map(t =>
    t.id === hq.id
      ? { ...t, hp: BASE_STATS.HP, maxHp: BASE_STATS.HP }
      : { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined, hp: undefined, maxHp: undefined }
  );
  const spots = map
    .filter(t => t.type === 'PLAINS' && Math.abs(t.x - hq.x) + Math.abs(t.y - hq.y) <= BASE_STATS.RANGE - 1)
    .slice(0, raiderHp.length);
  assert.equal(spots.length, raiderHp.length, 'room near HQ for attackers');
  const templates = base.units.filter(u => u.owner === 1);
  const placed: Unit[] = raiderHp.map((hp, i) => ({
    ...templates[i % templates.length],
    tileId: spots[i].id,
    hp,
    maxHp: hp,
  }));
  const state: GameState = {
    ...base,
    mapData: map,
    units: [...base.units.filter(u => u.owner === 0), ...placed],
    currentPlayer: 0,
  };
  return { state, placed };
}

test('base artillery: lone target takes the full shell, extra targets take splash', () => {
  // Solo attacker — the classic single 3-5 shell
  {
    const { state, placed } = hqSplashState('HQSOLO', [20]);
    const after = applyAction(state, { type: 'END_TURN' });
    assert.equal(after.rejected, undefined);
    const dealt = placed[0].hp - after.state.units.find(u => u.id === placed[0].id)!.hp;
    assert.ok(dealt >= BASE_STATS.MIN_DMG && dealt <= BASE_STATS.MAX_DMG, `solo shell dealt ${dealt}`);
  }

  // Three attackers — weakest eats the full shell, the other two eat 2-3 splash each
  {
    const { state, placed } = hqSplashState('HQTRIO', [10, 30, 30]);
    const before = new Map(placed.map(u => [u.id, u.hp] as const));
    const after = applyAction(state, { type: 'END_TURN' });
    assert.equal(after.rejected, undefined);
    const dealt = (id: string): number => before.get(id)! - after.state.units.find(u => u.id === id)!.hp;
    const primary = dealt(placed[0].id);
    assert.ok(primary >= BASE_STATS.MIN_DMG && primary <= BASE_STATS.MAX_DMG, `primary took ${primary}`);
    for (const raider of placed.slice(1)) {
      const splash = dealt(raider.id);
      assert.ok(splash >= BASE_STATS.SPLASH_MIN_DMG && splash <= BASE_STATS.SPLASH_MAX_DMG, `splash took ${splash}`);
    }
    assert.ok(after.state.gameLog.some(l => l.message.includes('Base Artillery')));
  }
});

test('mountain tunnel: blasts a mountain into a 1-CP passage for every unit type', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'TUNNEL1', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => {
    if (t.id === '5,5') return { ...t, type: 'MOUNTAIN' as const, height: 2 };
    return { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined };
  });
  const breacher = { ...base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!, tileId: '4,5', completed: false, hasMoved: false };
  const p1Guard = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '1,1', completed: false, hasMoved: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [breacher, p1Guard],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    mines: [],
  };

  assert.equal(SHOP_ITEMS.TUNNEL.cost, 125);

  // Refused anywhere but on a mountain
  assert.equal(prepareAction(state, 0, { type: 'BUILD', itemKey: 'TUNNEL', tileId: '6,5' }).ok, false);

  // Blast the tunnel through the mountain at 5,5
  const prep = prepareAction(state, 0, { type: 'BUILD', itemKey: 'TUNNEL', tileId: '5,5' });
  assert.ok(prep.ok);
  const after = applyAction(state, prep.action);
  assert.equal(after.rejected, undefined);
  assert.equal(after.state.playerGold[0], 500 - SHOP_ITEMS.TUNNEL.cost);
  const tunnel = after.state.mapData.find(t => t.id === '5,5')!;
  assert.equal(tunnel.type, 'TUNNEL');
  assert.equal(tunnel.height, 1);
  assert.ok(after.state.gameLog.some(l => l.message.includes('Mountain Tunnel')));

  // HARD AI buys its own tunnel when a ridge walls its breacher off from the enemy
  {
    const aiBase = createGeneratedGame(settings({ mapSeed: 'AITUN1', fogOfWar: false, playerCount: 2 }));
    const wallMap: Tile[] = aiBase.mapData.map(t =>
      t.x === 8
        ? { ...t, type: 'MOUNTAIN' as const, height: 2, subType: undefined, owner: undefined, hazardState: undefined }
        : { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined }
    );
    const aiBreacher = { ...aiBase.units.find(u => u.owner === 1 && u.type === 'ASSAULTER')!, tileId: '7,7', completed: false, hasMoved: false };
    const enemyScout = { ...aiBase.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '9,7', completed: false, hasMoved: false };
    const aiState: GameState = {
      ...aiBase,
      mapData: wallMap,
      units: [aiBreacher, enemyScout],
      currentPlayer: 1,
      playerCp: { 0: 20, 1: 20 },
      playerGold: { 0: 500, 1: 500 },
      mines: [
        { id: 'm1', tileId: '7,6', owner: 1 },
        { id: 'm2', tileId: '6,7', owner: 1 },
      ],
    };
    const aiAction = botAction(aiState, 'HARD');
    assert.equal(aiAction.type, 'BUILD');
    assert.equal((aiAction as { itemKey: string }).itemKey, 'TUNNEL');
    assert.equal((aiAction as { tileId: string }).tileId, '8,7');
    const aiPrep = prepareAction(aiState, 1, aiAction);
    assert.ok(aiPrep.ok, 'AI tunnel order passes the same validation as a human build');
    const aiAfter = applyAction(aiState, aiPrep.action);
    assert.equal(aiAfter.rejected, undefined);
    assert.equal(aiAfter.state.mapData.find(t => t.id === '8,7')!.type, 'TUNNEL');
    assert.equal(aiAfter.state.playerGold[1], 500 - SHOP_ITEMS.TUNNEL.cost);
  }

  // A breacher (who could never enter mountains) now walks through for 1 CP step cost
  const step = getStepCost(tunnel, 'ASSAULTER', 0, after.state.weather, 0);
  assert.equal(step, 2, 'breacher pays 1 CP x 2 moveCost per tunnel tile');
  const movePrep = prepareAction(after.state, 0, { type: 'MOVE', unitId: breacher.id, targetTileId: '5,5', cost: 0 });
  assert.ok(movePrep.ok, 'non-sniper can enter the tunnel');
  const moved = applyAction(after.state, movePrep.action);
  assert.equal(moved.rejected, undefined);
  assert.equal(moved.state.units.find(u => u.id === breacher.id)!.tileId, '5,5');
});

test('bank raids: 15 HP vaults breached by siege, snipers barred, vaults randomized', () => {
  assert.equal(BANK_STATS.HP, 15);

  // Seeded vault rolls: cash €200–300 in €10 steps, or a dry intel cache; editor rewards kept
  const rollMap = createGeneratedGame(settings({ mapSeed: 'VAULTROLL', fogOfWar: false, playerCount: 2 })).mapData;
  const cashBank: Tile = { ...rollMap[0], type: 'BANK' as const };
  const keptBank: Tile = { ...rollMap[1], type: 'BANK' as const, bankGoldReward: 300, bankCpReward: 0 };
  initBankVaults([cashBank, keptBank], () => 0.5);
  assert.equal(cashBank.hp, 15);
  assert.equal(cashBank.maxHp, 15);
  assert.equal(cashBank.bankGoldReward, 200, 'seeded roll 0.5 lands on €200');
  assert.equal(keptBank.bankGoldReward, 300, 'explicit editor rewards are kept');
  const dryBank: Tile = { ...rollMap[2], type: 'BANK' as const };
  initBankVaults([dryBank], () => 0.1);
  assert.equal(dryBank.bankGoldReward, 0);
  assert.equal(dryBank.bankCpReward, 12);

  // Live breach: breacher shells a 250€ vault, scout pops a dry cache, sniper is barred
  const base = createGeneratedGame(settings({ mapSeed: 'VAULTB1', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => {
    if (t.id === '5,5') return { ...t, type: 'BANK' as const, height: 1, hp: 15, maxHp: 15, hackProgress: 0, bankGoldReward: 250, bankCpReward: 10 };
    if (t.id === '2,2') return { ...t, type: 'BANK' as const, height: 1, hp: 4, maxHp: 15, hackProgress: 0, bankGoldReward: 0, bankCpReward: 12 };
    if (t.id === '5,6') return { ...t, type: 'DUNES' as const, height: 2 };
    return { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined };
  });
  const raider = { ...base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!, tileId: '5,4', completed: false, hasMoved: false };
  const sniper = { ...base.units.find(u => u.owner === 0 && u.type === 'SNIPER')!, tileId: '5,6', completed: false, hasMoved: false };
  const scout = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '2,3', completed: false, hasMoved: false };
  const p1Lookout = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '9,9', completed: false, hasMoved: false };
  const live: GameState = {
    ...base,
    mapData: map,
    units: [raider, sniper, scout, p1Lookout],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    mines: [],
  };

  // Snipers can't crack vaults, even from high ground in range
  const snipePrep = prepareAction(live, 0, { type: 'SIEGE', unitId: sniper.id, tileId: '5,5', cost: getUnitAttackCost(sniper) });
  assert.equal(snipePrep.ok, false);
  assert.match((snipePrep as { error: string }).error, /vault/i);

  // First breacher shell chips the vault (8 DMG vs 20% armor) without breaching
  const prep1 = prepareAction(live, 0, { type: 'SIEGE', unitId: raider.id, tileId: '5,5', cost: getUnitAttackCost(raider) });
  assert.ok(prep1.ok);
  const s1 = applyAction(live, prep1.action);
  assert.equal(s1.rejected, undefined);
  assert.equal(s1.state.mapData.find(t => t.id === '5,5')!.hp, 7);
  assert.equal(s1.state.bankRewardPending, null);
  assert.equal(s1.state.matchStats[0].heists, 0);

  // Second shell breaches: heist counted, vault choice pending, gold claimed
  const readyAgain: GameState = {
    ...s1.state,
    units: s1.state.units.map(u => u.id === raider.id ? { ...u, completed: false } : u),
  };
  const prep2 = prepareAction(readyAgain, 0, { type: 'SIEGE', unitId: raider.id, tileId: '5,5', cost: getUnitAttackCost(raider) });
  assert.ok(prep2.ok);
  const s2 = applyAction(readyAgain, prep2.action);
  assert.equal(s2.rejected, undefined);
  const breached = s2.state.mapData.find(t => t.id === '5,5')!;
  assert.equal(breached.hp, 0);
  assert.equal(breached.hackProgress, 100);
  assert.equal(s2.state.matchStats[0].heists, 1);
  assert.deepEqual(s2.state.bankRewardPending, { tileId: '5,5', playerId: 0 });
  const claim = applyAction(s2.state, { type: 'BANK_REWARD', choice: 'GOLD' });
  assert.equal(claim.rejected, undefined);
  assert.equal(claim.state.playerGold[0], 500 + 250);

  // Dry cache: scout breach pays +12 CP instantly with no pending choice
  const dryPrep = prepareAction(live, 0, { type: 'SIEGE', unitId: scout.id, tileId: '2,2', cost: getUnitAttackCost(scout) });
  assert.ok(dryPrep.ok);
  const dry = applyAction(live, dryPrep.action);
  assert.equal(dry.rejected, undefined);
  assert.equal(dry.state.mapData.find(t => t.id === '2,2')!.hackProgress, 100);
  assert.equal(dry.state.bankRewardPending, null);
  assert.equal(dry.state.playerCp[0], 20 - getUnitAttackCost(scout) + 12 + MOMENTUM_REFUNDS.BANK);
  assert.equal(dry.state.playerCpRefunded?.[0], MOMENTUM_REFUNDS.BANK);
});

test('mutual annihilation: stronger surviving fortress wins, exact tie is an explicit draw', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'ANNIH1', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => {
    if (t.type === 'BASE' && t.owner === 0) return { ...t, hp: 10 };
    if (t.type === 'BASE' && t.owner === 1) return { ...t, hp: 40 };
    return t;
  });
  const empty: GameState = {
    ...base,
    mapData: map,
    units: [],
    graveyard: [],
    playerRespawns: { 0: 99, 1: 99 },
  };
  const prep = prepareAction(empty, empty.currentPlayer, { type: 'END_TURN' });
  assert.ok(prep.ok);
  const result = applyAction(empty, prep.action);
  assert.equal(result.rejected, undefined);
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.matchSummary?.winner, 1);

  // Exact tie: both fortresses untouched — an explicit draw, not a coin flip.
  const tiedMap: Tile[] = base.mapData.map(t =>
    t.type === 'BASE' ? { ...t, hp: 50 } : t,
  );
  const tied: GameState = { ...empty, mapData: tiedMap };
  const tiedPrep = prepareAction(tied, tied.currentPlayer, { type: 'END_TURN' });
  assert.ok(tiedPrep.ok);
  const drawn = applyAction(tied, tiedPrep.action);
  assert.equal(drawn.rejected, undefined);
  assert.equal(drawn.state.winner, 'DRAW');
  assert.equal(drawn.state.matchSummary?.winner, 'DRAW');
});

test('HARD AI skips a second tunnel next to an open lane, but still breaches double-thick walls', () => {
  const aiBase = createGeneratedGame(settings({ mapSeed: 'AITUN2', fogOfWar: false, playerCount: 2 }));
  const wallMap: Tile[] = aiBase.mapData.map(t =>
    t.x === 8
      ? { ...t, type: 'MOUNTAIN' as const, height: 2, subType: undefined, owner: undefined, hazardState: undefined }
      : { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined }
  );
  const aiBreacher = { ...aiBase.units.find(u => u.owner === 1 && u.type === 'ASSAULTER')!, tileId: '7,7', completed: false, hasMoved: false };
  const enemyScout = { ...aiBase.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '14,7', completed: false, hasMoved: false };
  const mkState = (tunnelAt: string | null): GameState => ({
    ...aiBase,
    mapData: tunnelAt
      ? wallMap.map(t => (t.id === tunnelAt ? { ...t, type: 'TUNNEL' as const, height: 1 } : t))
      : wallMap,
    units: [aiBreacher, enemyScout],
    currentPlayer: 1,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    mines: [
      { id: 'm1', tileId: '7,6', owner: 1 },
      { id: 'm2', tileId: '6,7', owner: 1 },
    ],
  });

  // Control: no open lane — the AI pays for the breach at 8,7.
  const control = botAction(mkState(null), 'HARD');
  assert.equal(control.type, 'BUILD');
  assert.equal((control as { itemKey: string }).itemKey, 'TUNNEL');
  assert.equal((control as { tileId: string }).tileId, '8,7');

  // A lane two tiles south already reaches the enemy the long way: no second blast.
  const served = botAction(mkState('8,9'), 'HARD');
  assert.ok(
    !(served.type === 'BUILD' && (served as { itemKey: string }).itemKey === 'TUNNEL'),
    `expected no second tunnel, got ${JSON.stringify(served)}`,
  );

  // Double-thick wall (still unreachable): the adjacent second blast is still allowed.
  const thickBase = createGeneratedGame(settings({ mapSeed: 'AITUN3', fogOfWar: false, playerCount: 2 }));
  const thickMap: Tile[] = thickBase.mapData.map(t =>
    t.x === 8 || t.x === 9
      ? { ...t, type: t.id === '8,9' ? ('TUNNEL' as const) : ('MOUNTAIN' as const), height: t.id === '8,9' ? 1 : 2, subType: undefined, owner: undefined, hazardState: undefined }
      : { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined }
  );
  const thickBreacher = { ...thickBase.units.find(u => u.owner === 1 && u.type === 'ASSAULTER')!, tileId: '7,7', completed: false, hasMoved: false };
  const thickEnemy = { ...thickBase.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '14,7', completed: false, hasMoved: false };
  const thick: GameState = {
    ...thickBase,
    mapData: thickMap,
    units: [thickBreacher, thickEnemy],
    currentPlayer: 1,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    mines: [
      { id: 'm1', tileId: '7,6', owner: 1 },
      { id: 'm2', tileId: '6,7', owner: 1 },
    ],
  };
  const second = botAction(thick, 'HARD');
  assert.equal(second.type, 'BUILD');
  assert.equal((second as { itemKey: string }).itemKey, 'TUNNEL');
});

test('units cannot move onto, pass through, or spawn on Bank, Base, or Barrier tiles', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'NOSTND', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => {
    if (t.id === '2,2') return { ...t, type: 'BASE' as const, owner: 0, hp: 50, maxHp: 50, hazardState: undefined };
    if (t.id === '2,3') return { ...t, type: 'BANK' as const, hp: 15, maxHp: 15, hackProgress: 0, hazardState: undefined };
    if (t.id === '3,2') return { ...t, type: 'BANK' as const, hp: 0, maxHp: 15, hackProgress: 100, hazardState: undefined };
    if (t.id === '4,3') return { ...t, type: 'BARRIER' as const, hp: 10, maxHp: 10, hazardState: undefined };
    if (t.id === '5,3') return { ...t, type: 'BASE' as const, owner: 1, hp: 50, maxHp: 50, hazardState: undefined };
    return { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined };
  });

  const scout = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '3,3', completed: false, hasMoved: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [scout],
    graveyard: [{ id: 'dead_sc', type: 'SOLDIER', owner: 0, turnsUntilRespawn: 0 }],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    playerRespawns: { 0: 0, 1: 0 },
  };

  for (const blockedId of ['2,2', '2,3', '3,2', '4,3', '5,3']) {
    const t = map.find(x => x.id === blockedId)!;
    assert.equal(getStepCost(t, 'SOLDIER', 0, state.weather, 0), null, `${t.type} at ${blockedId} is impassable`);
    assert.equal(moveCostsFor(state, scout).has(blockedId), false, `moveCostsFor excludes ${t.type} at ${blockedId}`);
    assert.equal(prepareAction(state, 0, { type: 'MOVE', unitId: scout.id, targetTileId: blockedId, cost: 0 }).ok, false);
  }

  // Corridors blocked by Bank/Base/Barrier cannot be stepped through (even if surrounded by PLAINS)
  const spawnTiles = getSpawnTiles(state, 0);
  assert.equal(spawnTiles.includes('2,2'), false, 'spawn tiles exclude Base');
  assert.equal(spawnTiles.includes('2,3'), false, 'spawn tiles exclude active Bank');
  assert.equal(spawnTiles.includes('3,2'), false, 'spawn tiles exclude breached Bank');
  for (const badSpawn of ['2,2', '2,3', '3,2']) {
    assert.equal(
      prepareAction(state, 0, { type: 'SPAWN', unitType: 'SOLDIER', tileId: badSpawn, cost: 3, deadUnitId: 'dead_sc' }).ok,
      false,
    );
    assert.ok(
      applyAction(state, { type: 'SPAWN', unitType: 'SOLDIER', tileId: badSpawn, cost: 3, deadUnitId: 'dead_sc' }).rejected,
    );
  }

  // Initial squad spawning also skips Base, Bank, and Barrier tiles
  const startingUnits = spawnUnitsForPlayers(
    map,
    { SOLDIER: 3, ASSAULTER: 2, SNIPER: 1 },
    [{ x: 2, y: 2, owner: 0 }],
  );
  for (const u of startingUnits) {
    const t = map.find(x => x.id === u.tileId)!;
    assert.notEqual(t.type, 'BASE');
    assert.notEqual(t.type, 'BANK');
    assert.notEqual(t.type, 'BARRIER');
  }
});

test('a redeploy the battery cannot pay for is rejected and spends no CP or gold', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'CPRSPN', fogOfWar: false, playerCount: 2 }));
  const cpCost = RESPAWN_CP_COST.SNIPER;
  const state: GameState = {
    ...base,
    graveyard: [{ id: 'dead_sn', type: 'SNIPER', owner: 0, turnsUntilRespawn: 0 }],
    currentPlayer: 0,
    playerCp: { 0: cpCost - 1, 1: 20 },
    playerGold: { 0: 500, 1: 500 },
    playerRespawns: { 0: 0, 1: 0 },
  };
  const tileId = getSpawnTiles(state, 0)[0];
  assert.ok(tileId, 'the generated board has a spawn tile');

  // prepareAction prices the Sniper from its class and refuses while one CP short.
  const prepared = prepareAction(state, 0, {
    type: 'SPAWN',
    unitType: 'SNIPER',
    tileId,
    cost: cpCost,
    deadUnitId: 'dead_sn',
  });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.ok === false && prepared.error, 'Not enough CP');

  // A client that claims the redeploy is free cannot underpay: applyAction re-derives the class
  // price and leaves CP, gold, respawns and the graveyard exactly as they were.
  const rejected = applyAction(state, {
    type: 'SPAWN',
    unitType: 'SNIPER',
    tileId,
    cost: 0,
    deadUnitId: 'dead_sn',
  });
  assert.equal(rejected.rejected, 'Not enough CP');
  assert.equal(rejected.state, state);
  assert.equal(rejected.state.playerCp[0], cpCost - 1);
  assert.equal(rejected.state.playerGold[0], 500);
  assert.equal(rejected.state.playerRespawns[0], 0);
  assert.equal(rejected.state.graveyard.length, 1);

  // The same redeploy succeeds with exactly enough CP, and still costs no gold.
  const paid = applyAction({ ...state, playerCp: { 0: cpCost, 1: 20 } }, {
    type: 'SPAWN',
    unitType: 'SNIPER',
    tileId,
    cost: 0,
    deadUnitId: 'dead_sn',
  });
  assert.equal(paid.rejected, undefined);
  assert.equal(paid.state.playerCp[0], 0);
  assert.equal(paid.state.playerGold[0], 500);
  assert.equal(paid.state.playerRespawns[0], 1);
  assert.equal(paid.state.graveyard.length, 0);
});

test('Overclock borrows CP once per turn and repays it automatically from the next regen', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'OVRCLK', fogOfWar: false, playerCount: 2 }));
  const state: GameState = {
    ...base,
    currentPlayer: 0,
    playerCp: { 0: 15, 1: 10 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpBorrowed: { 0: 0, 1: 0 },
    playerGold: { 0: 500, 1: 500 },
  };

  const prepared = prepareAction(state, 0, { type: 'OVERCLOCK', amount: 5 });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.deepEqual(prepared.action, { type: 'OVERCLOCK', amount: 5 });

  const borrowed = applyAction(state, { type: 'OVERCLOCK', amount: 5 });
  assert.equal(borrowed.rejected, undefined);
  assert.equal(borrowed.state.playerCp[0], 20);
  assert.equal(borrowed.state.playerCpDebt?.[0], 5);
  assert.equal(borrowed.state.playerCpBorrowed?.[0], 5);

  // One borrow per turn.
  const again = applyAction(borrowed.state, { type: 'OVERCLOCK', amount: 1 });
  assert.equal(again.rejected, 'Already overclocked this turn');
  assert.equal(again.state, borrowed.state);

  // P1's turn does not repay P0's debt; it is collected from P0's own next regen.
  const p1Turn = applyAction(borrowed.state, { type: 'END_TURN' });
  assert.equal(p1Turn.state.currentPlayer, 1);
  assert.equal(p1Turn.state.playerCpDebt?.[0], 5);
  const backToP0 = applyAction(p1Turn.state, { type: 'END_TURN' });
  assert.equal(backToP0.state.currentPlayer, 0);
  assert.equal(backToP0.state.playerCpDebt?.[0], 0);
  assert.equal(backToP0.state.playerCpBorrowed?.[0], 0);
  assert.equal(backToP0.state.playerCp[0], 30); // 20 + 15 regen - 5 repaid
});

test('Overclock cannot push CP above the battery', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'OVRCLK2', fogOfWar: false, playerCount: 2 }));
  const state: GameState = {
    ...base,
    currentPlayer: 0,
    playerCp: { 0: 28, 1: 10 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpBorrowed: { 0: 0, 1: 0 },
  };

  // The validator trims a 5 CP request to the 2 CP that still fit under the 30 CP battery.
  const prepared = prepareAction(state, 0, { type: 'OVERCLOCK', amount: 5 });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.deepEqual(prepared.action, { type: 'OVERCLOCK', amount: 2 });

  const borrowed = applyAction(state, { type: 'OVERCLOCK', amount: 5 });
  assert.equal(borrowed.rejected, undefined);
  assert.equal(borrowed.state.playerCp[0], 30);
  assert.equal(borrowed.state.playerCpDebt?.[0], 2);
  assert.equal(borrowed.state.playerCpBorrowed?.[0], 2);

  // At the battery ceiling there is nothing left to borrow.
  const full = applyAction({ ...state, playerCp: { 0: 30, 1: 10 } }, { type: 'OVERCLOCK', amount: 1 });
  assert.equal(full.rejected, 'Battery is already full');
  assert.equal(full.state.playerCp[0], 30);
});

test('a momentum refund cannot unlock a second Overclock', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'OVRCLK3', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => ({
    ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined, height: 1,
  }));
  const attacker = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '4,4', completed: false, hasMoved: false };
  const victim = { ...base.units.find(u => u.owner === 1 && u.type === 'SNIPER')!, tileId: '4,5', hp: 1, completed: false };
  const reserve = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '9,9', completed: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [attacker, victim, reserve],
    currentPlayer: 0,
    playerCp: { 0: 18, 1: 20 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpBorrowed: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
    // Isolate momentum: no first-contact grant and no live contract payout.
    firstContactDone: true,
    contract: null,
  };

  const overclocked = applyAction(state, { type: 'OVERCLOCK', amount: 2 });
  assert.equal(overclocked.rejected, undefined);
  assert.equal(overclocked.state.playerCpDebt?.[0], 2);

  const attack = applyAction(overclocked.state, {
    type: 'ATTACK', attackerId: attacker.id, targetUnitId: victim.id, cost: getUnitAttackCost(attacker),
  });
  assert.equal(attack.rejected, undefined);
  assert.equal(attack.state.playerCpDebt?.[0], 0); // the 4 CP kill refund cleared the debt
  assert.equal(attack.state.playerCp[0], 19); // 20 - 3 attack + 2 refund left after debt
  assert.equal(attack.state.playerCpBorrowed?.[0], 2); // but the borrow still happened this turn

  const second = applyAction(attack.state, { type: 'OVERCLOCK', amount: 1 });
  assert.equal(second.rejected, 'Already overclocked this turn');
  assert.equal(second.state, attack.state);

  const p1Turn = applyAction(attack.state, { type: 'END_TURN' });
  const backToP0 = applyAction(p1Turn.state, { type: 'END_TURN' });
  assert.equal(backToP0.state.playerCpBorrowed?.[0], 0, 'the next turn restores the borrow');
});

test('the AI overclocks only to finish a kill it is a few CP short of', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'AIOC1', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => ({
    ...t,
    type: 'PLAINS' as const,
    subType: undefined,
    owner: undefined,
    hazardState: undefined,
    height: 1,
  }));
  const soldier = {
    ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!,
    tileId: '4,4',
    completed: false,
    hasMoved: false,
  };
  const victim = {
    ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!,
    tileId: '4,5',
    hp: 1,
    completed: false,
  };
  const shortByOne: GameState = {
    ...base,
    mapData: map,
    units: [soldier, victim],
    currentPlayer: 0,
    playerCp: { 0: getUnitAttackCost(soldier) - 1, 1: 20 },
    playerCpDebt: { 0: 0, 1: 0 },
  };
  assert.deepEqual(botAction(shortByOne), { type: 'OVERCLOCK', amount: 1 });

  // With the shot already affordable there is nothing to borrow.
  const affordable: GameState = { ...shortByOne, playerCp: { 0: getUnitAttackCost(soldier), 1: 20 } };
  assert.notEqual(botAction(affordable).type, 'OVERCLOCK');
});

test('a kill refunds momentum CP, paying Overclock debt first', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'MOM1', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => ({
    ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined, height: 1,
  }));
  const attacker = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '4,4', completed: false, hasMoved: false };
  const victim = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '4,5', hp: 1, completed: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [attacker, victim],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerCpDebt: { 0: 2, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
    playerGold: { 0: 500, 1: 500 },
    firstContactDone: true,
    contract: null,
  };

  const result = applyAction(state, {
    type: 'ATTACK', attackerId: attacker.id, targetUnitId: victim.id, cost: getUnitAttackCost(attacker),
  });
  assert.equal(result.rejected, undefined);
  assert.equal(result.state.playerCpRefunded?.[0], 2);
  assert.equal(result.state.playerCpDebt?.[0], 0); // refund pays the debt before adding CP
  assert.equal(result.state.playerCp[0], 17); // 20 - 3 attack; the 2 CP refund went to debt
});

test('capturing a building refunds momentum CP', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'MOM2', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t =>
    t.id === '4,5'
      ? { ...t, type: 'BUILDING' as const, subType: 'WATCHTOWER' as const, owner: 1, hp: 20, maxHp: 20, hazardState: undefined }
      : { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined, height: 1 }
  );
  const scout = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '4,4', completed: false, hasMoved: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [scout],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
    firstContactDone: true,
    contract: null,
  };

  const result = applyAction(state, { type: 'SECURE', unitId: scout.id, tileId: '4,5', cost: 4 });
  assert.equal(result.rejected, undefined);
  assert.equal(result.state.playerCpRefunded?.[0], 3);
  assert.equal(result.state.playerCp[0], 19); // 20 - 4 secure + 3 refund
});

test('momentum refunds stop at the per-turn cap', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'MOM3', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => ({
    ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined, height: 1,
  }));
  const a1 = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, id: 'a1', tileId: '4,4', completed: false, hasMoved: false };
  const a2 = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, id: 'a2', tileId: '6,4', completed: false, hasMoved: false };
  const v1 = { ...base.units.find(u => u.owner === 1 && u.type === 'SNIPER')!, id: 'v1', tileId: '4,5', hp: 1, completed: false };
  const v2 = { ...base.units.find(u => u.owner === 1 && u.type === 'SNIPER')!, id: 'v2', tileId: '6,5', hp: 1, completed: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [a1, a2, v1, v2],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
    firstContactDone: true,
    contract: null,
  };

  const first = applyAction(state, { type: 'ATTACK', attackerId: 'a1', targetUnitId: 'v1', cost: getUnitAttackCost(a1) });
  assert.equal(first.rejected, undefined);
  assert.equal(first.state.playerCpRefunded?.[0], 4);
  const second = applyAction(first.state, { type: 'ATTACK', attackerId: 'a2', targetUnitId: 'v2', cost: getUnitAttackCost(a2) });
  assert.equal(second.rejected, undefined);
  assert.equal(second.state.playerCpRefunded?.[0], 6); // 4 + 4 capped at 6
  assert.equal(second.state.playerCp[0], 20); // 20 - 3 + 4 - 3 + 2
});

test('a Veteran takes exactly one perk from its class, for free', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'PERK1', fogOfWar: false, playerCount: 2 }));
  const soldier = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, rank: 1 as const };
  const enemy = base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!;
  const state: GameState = {
    ...base,
    units: [soldier, enemy],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
  };

  const rookie = prepareAction({ ...state, units: [{ ...soldier, rank: 0 as const }] }, 0, {
    type: 'CHOOSE_PERK', unitId: soldier.id, perkId: 'RELAY',
  });
  assert.equal(rookie.ok, false);
  assert.match((rookie as { error: string }).error, /Veteran/i);

  const wrongClass = prepareAction(state, 0, { type: 'CHOOSE_PERK', unitId: soldier.id, perkId: 'COLD_BORE' });
  assert.equal(wrongClass.ok, false);
  assert.match((wrongClass as { error: string }).error, /class/i);

  const prepared = prepareAction(state, 0, { type: 'CHOOSE_PERK', unitId: soldier.id, perkId: 'RELAY' });
  assert.ok(prepared.ok);
  const result = applyAction(state, prepared.action);
  assert.equal(result.state.units[0].perk, 'RELAY');
  assert.equal(result.state.playerCp[0], 20); // choosing costs no CP
  assert.equal(result.state.units[0].completed, false); // and does not consume the unit's action

  const duplicate = prepareAction(result.state, 0, { type: 'CHOOSE_PERK', unitId: soldier.id, perkId: 'SKIRMISHER' });
  assert.equal(duplicate.ok, false);
  assert.match((duplicate as { error: string }).error, /already/i);
});

test('promotion damage perks apply in the right situations', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'PERKDMG', fogOfWar: false, playerCount: 2 }));
  const plains = base.mapData.find(t => t.type === 'PLAINS')!;
  const forest: Tile = { ...plains, type: 'FOREST' };
  const target = base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!;

  const sniper = { ...base.units.find(u => u.owner === 0 && u.type === 'SNIPER')!, perk: 'COLD_BORE' as const, hasMoved: false };
  const still = calculateAttackOutcome(sniper, plains, plains, 1, target).damage;
  const moved = calculateAttackOutcome({ ...sniper, hasMoved: true }, plains, plains, 1, target).damage;
  assert.equal(still, moved + 2);

  const scout = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, perk: 'SKIRMISHER' as const };
  const fromCover = calculateAttackOutcome(scout, forest, plains, 1, target).damage;
  const fromOpen = calculateAttackOutcome({ ...scout, perk: undefined }, forest, plains, 1, target).damage;
  assert.equal(fromCover, fromOpen + 1);
  assert.equal(
    calculateAttackOutcome(scout, plains, plains, 1, target).damage,
    calculateAttackOutcome({ ...scout, perk: undefined }, plains, plains, 1, target).damage,
    'Skirmisher pays nothing without cover',
  );

  const breacher = { ...base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!, perk: 'SAPPER' as const };
  assert.equal(
    calculateDemolishDamage(breacher, plains),
    calculateDemolishDamage({ ...breacher, perk: undefined }, plains) + 2,
  );

  const watcher = { ...base.units.find(u => u.owner === 0 && u.type === 'SNIPER')!, perk: 'OVERWATCH_PLUS' as const };
  assert.equal(
    calculateOverwatchOutcome(watcher, plains, plains, 1, target).damage,
    calculateOverwatchOutcome({ ...watcher, perk: undefined }, plains, plains, 1, target).damage + 2,
  );
});

test('Bulwark reduces incoming attack damage for adjacent allies', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'PERKBW', fogOfWar: false, playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => ({
    ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, hazardState: undefined, height: 1,
  }));
  const attacker = { ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!, tileId: '4,4', completed: false, hasMoved: false };
  const target = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, tileId: '4,5', hp: 15, maxHp: 15, completed: false };
  const guard = { ...base.units.find(u => u.owner === 1 && u.type === 'ASSAULTER')!, tileId: '5,5', perk: 'BULWARK' as const, completed: false };
  const state: GameState = {
    ...base,
    mapData: map,
    units: [attacker, target, guard],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
  };

  const guarded = applyAction(state, { type: 'ATTACK', attackerId: attacker.id, targetUnitId: target.id, cost: getUnitAttackCost(attacker) });
  assert.equal(guarded.rejected, undefined);
  assert.equal(guarded.state.units.find(u => u.id === target.id)!.hp, 11); // 5 - 1

  const unguarded = applyAction(
    { ...state, units: [attacker, target] },
    { type: 'ATTACK', attackerId: attacker.id, targetUnitId: target.id, cost: getUnitAttackCost(attacker) },
  );
  assert.equal(unguarded.state.units.find(u => u.id === target.id)!.hp, 10);
});

test('Relay adds one CP regen for its owner', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'PERKRL', fogOfWar: false, playerCount: 2 }));
  const relay = { ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!, perk: 'RELAY' as const };
  const scout = base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!;
  const state: GameState = {
    ...base,
    units: [scout, relay],
    currentPlayer: 0,
    playerCp: { 0: 10, 1: 5 },
    playerCpDebt: { 0: 0, 1: 0 },
    playerCpRefunded: { 0: 0, 1: 0 },
  };

  const result = applyAction(state, { type: 'END_TURN' });
  assert.equal(result.state.currentPlayer, 1);
  assert.equal(result.state.playerCp[1], 21); // 5 + 15 regen + 1 Relay
});

test('ATTACK emits DamageBreakdown, zeroCpClutch, victimPreHp, and isMatchWinning, and eventsFor redacts hidden shooters', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'BRKDWN', fogOfWar: true, victoryMode: 'DEATHMATCH', playerCount: 2 }));
  const map: Tile[] = base.mapData.map(t => {
    if (t.id === '3,3') return { ...t, type: 'BUILDING' as const, subType: 'WATCHTOWER' as const, owner: 0, height: 2, hazardState: undefined };
    if (t.id === '3,7') return { ...t, type: 'FOREST' as const, subType: undefined, owner: undefined, height: 1, hazardState: undefined };
    return { ...t, type: 'PLAINS' as const, subType: undefined, owner: undefined, height: 1, hazardState: undefined };
  });
  const sniper: Unit = {
    ...base.units.find(u => u.owner === 0 && u.type === 'SNIPER')!,
    id: 'p0_sniper',
    tileId: '3,3',
    hp: 15,
    maxHp: 15,
    ammo: 3,
    maxAmmo: 3,
    hasMoved: false,
    completed: false,
    rank: 0,
  };
  const ally: Unit = {
    ...base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!,
    id: 'p0_ally',
    tileId: '4,7',
    hp: 15,
    maxHp: 15,
    ammo: 4,
    maxAmmo: 4,
    hasMoved: false,
    completed: false,
    rank: 0,
  };
  const victim: Unit = {
    ...base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!,
    id: 'p1_victim',
    tileId: '3,7',
    hp: 6,
    maxHp: 15,
    ammo: 4,
    maxAmmo: 4,
    hasMoved: false,
    completed: false,
    rank: 0,
  };
  const attackCost = getUnitAttackCost(sniper);
  const state: GameState = {
    ...base,
    mapData: map,
    units: [sniper, ally, victim],
    currentPlayer: 0,
    playerCp: { 0: attackCost, 1: 10 },
    playerGold: { 0: 100, 1: 0 },
    playerRespawns: { 0: 0, 1: 99 },
  };

  const res = applyAction(state, { type: 'ATTACK', attackerId: sniper.id, targetUnitId: victim.id, cost: attackCost });
  assert.equal(res.rejected, undefined);
  assert.equal(res.state.winner, 0);

  const hitEv = res.events.find((e): e is Extract<typeof e, { kind: 'hit' }> => e.kind === 'hit');
  const killEv = res.events.find((e): e is Extract<typeof e, { kind: 'killed' }> => e.kind === 'killed');
  assert.ok(hitEv?.breakdown, 'hit event carries deterministic DamageBreakdown');
  assert.equal(hitEv!.breakdown!.watchtowerBoosted, true);
  assert.equal(hitEv!.breakdown!.coverTerrain, 'FOREST');
  assert.ok(hitEv!.breakdown!.coverPct > 0);
  assert.ok(hitEv!.breakdown!.crossfireBonus > 0);

  assert.ok(killEv, 'kill event emitted');
  assert.equal(killEv!.killerUnitId, sniper.id);
  assert.equal(killEv!.killerUnitType, 'SNIPER');
  assert.equal(killEv!.victimPreHp, 6);
  assert.equal(killEv!.zeroCpClutch, true, 'spending last CP on a kill flags zeroCpClutch');
  assert.equal(killEv!.isMatchWinning, true, 'eliminating final enemy flags isMatchWinning');

  // Under Fog of War, a viewer who only sees the victim tile (3,7) and NOT the watchtower sniper (3,3)
  // must NOT be leaked `from`, `watchtowerBoosted`, `killerUnitId`, or `killerUnitType`.
  const onlyTargetSight = new Set(['3,7']);
  const fogged = eventsFor(res.events, true, onlyTargetSight, onlyTargetSight);
  const fogHit = fogged.find((e): e is Extract<typeof e, { kind: 'hit' }> => e.kind === 'hit');
  const fogKill = fogged.find((e): e is Extract<typeof e, { kind: 'killed' }> => e.kind === 'killed');
  assert.equal(fogHit?.from, undefined, 'unseen attacker origin stripped');
  assert.equal(fogHit?.breakdown?.watchtowerBoosted, false, 'unseen watchtower bonus redacted under fog');
  assert.equal(fogKill?.killerUnitId, undefined, 'unseen killerUnitId redacted under fog');
  assert.equal(fogKill?.killerUnitType, undefined, 'unseen killerUnitType redacted under fog');
  assert.equal(fogKill?.isMatchWinning, true, 'match-winning flag stays intact');

  // When the attacker origin IS visible, all metadata survives intact.
  const fullSight = new Set(['3,3', '3,7', '4,7']);
  const visible = eventsFor(res.events, true, fullSight, fullSight);
  const visHit = visible.find((e): e is Extract<typeof e, { kind: 'hit' }> => e.kind === 'hit');
  const visKill = visible.find((e): e is Extract<typeof e, { kind: 'killed' }> => e.kind === 'killed');
  assert.deepEqual(visHit?.from, { x: 3, y: 3 });
  assert.equal(visHit?.breakdown?.watchtowerBoosted, true);
  assert.equal(visKill?.killerUnitId, sniper.id);
  assert.equal(visKill?.killerUnitType, 'SNIPER');
});
