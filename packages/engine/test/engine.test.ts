import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction,
  botAction,
  createGeneratedGame,
  eventsFor,
  getAttackBlocker,
  getCrossfireSupporters,
  getSupplyDropTargets,
  prepareAction,
  viewFor,
  visibleSet,
  DEFAULT_GAME_SETTINGS,
  moveCostsFor,
  type GameAction,
  type GameState,
} from '../src/index';
import { COMBAT_BONUSES, GOLD_SETTINGS, LAND_MINE_STATS, SHOP_ITEMS } from '../src/constants/Config';
import { isWithinEnemyHqExclusion } from '../src/rules/CombatRules';
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
