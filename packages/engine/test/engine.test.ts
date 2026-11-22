import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction,
  botAction,
  createGeneratedGame,
  eventsFor,
  prepareAction,
  viewFor,
  visibleSet,
  DEFAULT_GAME_SETTINGS,
  moveCostsFor,
  type GameAction,
  type GameState,
} from '../src/index';
import type { GameSettings, Unit } from '../src/types';

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
