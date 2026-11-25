import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction,
  createGeneratedGame,
  prepareAction,
  DEFAULT_GAME_SETTINGS,
  type GameAction,
  type GameState,
} from '../src/index';
import { CONTRACTS, dealContract } from '../src/game/Contracts';
import { chooseBotSpectatorEffect, nextSpectatorWindowRound } from '../src/game/SpectatorOps';
import { CP_SYSTEM } from '../src/constants/Config';
import type { GameSettings, SharedContract, Unit } from '../src/types';

const settings = (over: Partial<GameSettings> = {}): GameSettings => ({ ...DEFAULT_GAME_SETTINGS, ...over });

const clearBoard = (base: GameState) => ({
  map: base.mapData.map(t => ({
    ...t,
    type: 'PLAINS' as const,
    hazardState: undefined as undefined,
    owner: undefined as number | null | undefined,
    hp: undefined as number | undefined,
    maxHp: undefined as number | undefined,
    subType: undefined,
    loot: null,
  })),
  weather: { ...base.weather, playerZones: { 0: 'CLEAR' as const, 1: 'CLEAR' as const } },
});

test('first contact pays the attacker +3 and the defender +2, once per match', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'CONTACT1', fogOfWar: false, playerCount: 2 }));
  const { map, weather } = clearBoard(base);
  const a0 = base.units.find(u => u.owner === 0 && u.type === 'ASSAULTER')!;
  const a1 = base.units.find(u => u.owner === 0 && u.type === 'SOLDIER')!;
  const d0 = base.units.find(u => u.owner === 1 && u.type === 'ASSAULTER')!;
  const d1 = base.units.find(u => u.owner === 1 && u.type === 'SOLDIER')!;

  const attacker: Unit = { ...a0, tileId: '4,4', hp: 30, maxHp: 30, ammo: 6, completed: false };
  const second: Unit = { ...a1, tileId: '6,4', hp: 20, maxHp: 20, ammo: 6, completed: false };
  const victim: Unit = { ...d0, tileId: '5,4', hp: 30, maxHp: 30, ammo: 6 };
  const victim2: Unit = { ...d1, tileId: '7,4', hp: 20, maxHp: 20, ammo: 6 };

  const state: GameState = {
    ...base,
    mapData: map,
    weather,
    units: [attacker, second, victim, victim2],
    currentPlayer: 0,
    playerCp: { ...base.playerCp, 0: 20, 1: 20 },
    contract: null,
    contractProgress: {},
    firstContactDone: false,
  };

  const hit = applyAction(state, { type: 'ATTACK', attackerId: attacker.id, targetUnitId: victim.id, cost: 5 });
  assert.equal(hit.rejected, undefined);
  assert.equal(hit.state.playerCp[0], 18, '20 - 5 CP attack + 3 CP contact');
  assert.equal(hit.state.playerCp[1], 22, 'defender keeps 20 and gains 2');
  assert.equal(hit.state.firstContactDone, true);
  assert.ok(hit.state.gameLog.some(l => l.message.startsWith('FIRST CONTACT')));

  const next = applyAction(hit.state, { type: 'ATTACK', attackerId: second.id, targetUnitId: victim2.id, cost: 5 });
  assert.equal(next.rejected, undefined);
  assert.equal(next.state.playerCp[0], 13, 'second exchange pays nothing');
  assert.equal(next.state.playerCp[1], 22);
});

test('contracts are gated by round and by what the board can support', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'CONTRACT1', fogOfWar: false, playerCount: 2 }));
  const early = dealContract(base, 1, []);
  assert.ok(early, 'round 1 deals a contract');
  assert.equal(early!.tier, 1, 'round 1 only opens tier 1');

  const tier1Used = CONTRACTS.filter(c => c.tier === 1).map(c => c.id);
  const mid = dealContract(base, 4, tier1Used);
  assert.ok(mid);
  assert.equal(mid!.tier, 2, 'round 4 opens tier 2');

  // A small, clean board has no barrier, no Elite and fewer than 6 units: nothing in tier 3 fits.
  const small: GameState = {
    ...base,
    units: base.units.slice(0, 4),
    mapData: base.mapData.map(t =>
      t.type === 'BARRIER' ? { ...t, type: 'PLAINS' as const, hp: undefined, maxHp: undefined } : t,
    ),
  };
  const nonTier3 = CONTRACTS.filter(c => c.tier !== 3).map(c => c.id);
  assert.equal(dealContract(small, 20, nonTier3), null, 'never deals a card the board cannot support');

  // The same board with 8 units makes Wipe legal at round 14.
  const crowded: GameState = {
    ...small,
    units: Array.from({ length: 8 }, (_, i) => ({ ...small.units[i % small.units.length], id: `u${i}` })),
  };
  const late = dealContract(crowded, 14, nonTier3);
  assert.ok(late);
  assert.equal(late!.id, 'WIPE');
});

test('a shared contract pays the first completion only, and the underdog bonus follows the claim', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'CLAIM1', fogOfWar: false, playerCount: 2 }));
  const { map, weather } = clearBoard(base);
  const attacker = base.units.find(u => u.owner === 0)!;
  const support = { ...base.units.find(u => u.owner === 0 && u.id !== attacker.id)!, tileId: '9,9' };
  const extra = { ...support, id: 'extra-0', tileId: '9,8' };
  const victim = { ...base.units.find(u => u.owner === 1)!, tileId: '5,4', hp: 5, maxHp: 5 };
  const bystander = { ...base.units.find(u => u.owner === 1 && u.id !== victim.id)!, tileId: '9,10' };

  const contract: SharedContract = {
    id: 'FIRST_BLOOD',
    tier: 1,
    round: 1,
    claimedBy: null,
    rewardCp: 4,
    rewardGold: 0,
    target: 1,
  };
  const state: GameState = {
    ...base,
    mapData: map,
    weather,
    units: [
      { ...attacker, tileId: '4,4', hp: 30, maxHp: 30, ammo: 6, completed: false },
      { ...support, hp: 20, maxHp: 20, ammo: 0 },
      { ...extra, hp: 20, maxHp: 20, ammo: 0 },
      { ...victim },
      { ...bystander, hp: 20, maxHp: 20, ammo: 0 },
    ],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 200, 1: 200 },
    firstContactDone: true,
    contract,
    contractProgress: {},
    contractsUsed: ['FIRST_BLOOD'],
    contractMisses: 0,
  };

  const attack: GameAction = { type: 'ATTACK', attackerId: attacker.id, targetUnitId: victim.id, cost: 5 };
  // A control run on the same board with no contract isolates the payout from momentum refunds.
  const control = applyAction({ ...state, contract: null }, attack);
  const res = applyAction(state, attack);
  assert.equal(res.rejected, undefined);
  assert.equal(res.state.contract?.claimedBy, 0);
  assert.equal(res.state.playerCp[0] - control.state.playerCp[0], 4, 'contract pays +4 CP');
  assert.equal(res.state.playerGold[0], control.state.playerGold[0], 'no underdog bonus for the leader');
  assert.equal(res.state.contractProgress?.[0], 1);

  // The same kill by the other seat cannot claim it a second time.
  const other = applyAction(
    { ...res.state, currentPlayer: 1 },
    { type: 'ATTACK', attackerId: res.state.units.find(u => u.owner === 1)!.id, targetUnitId: res.state.units.find(u => u.owner === 0)!.id, cost: 5 },
  );
  assert.equal(other.rejected, undefined);
  assert.equal(other.state.contract?.claimedBy, 0, 'first completion only');
});

test('the last-place claimant gets the underdog bonus, doubled after an expired contract', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'DOG1', fogOfWar: false, playerCount: 2 }));
  const { map, weather } = clearBoard(base);
  const lone = base.units.find(u => u.owner === 0)!;
  const e0 = base.units.find(u => u.owner === 1)!;
  const e1 = base.units.filter(u => u.owner === 1)[1]!;
  const e2 = base.units.filter(u => u.owner === 1)[2]!;

  const contract: SharedContract = {
    id: 'FIRST_BLOOD',
    tier: 1,
    round: 1,
    claimedBy: null,
    rewardCp: 4,
    rewardGold: 0,
    target: 1,
  };
  const state: GameState = {
    ...base,
    mapData: map,
    weather,
    units: [
      { ...lone, tileId: '4,4', hp: 30, maxHp: 30, ammo: 6, completed: false },
      { ...e0, tileId: '5,4', hp: 5, maxHp: 5 },
      { ...e1, tileId: '9,9' },
      { ...e2, tileId: '9,10' },
    ],
    currentPlayer: 0,
    playerCp: { 0: 20, 1: 20 },
    playerGold: { 0: 200, 1: 200 },
    firstContactDone: true,
    contract,
    contractProgress: {},
    contractsUsed: ['FIRST_BLOOD'],
    contractMisses: 1,
  };

  const attack: GameAction = { type: 'ATTACK', attackerId: lone.id, targetUnitId: e0.id, cost: 5 };
  const control = applyAction({ ...state, contract: null }, attack);
  const res = applyAction(state, attack);
  assert.equal(res.rejected, undefined);
  assert.equal(res.state.playerCp[0] - control.state.playerCp[0], 8, '4 CP reward + doubled 4 CP underdog');
  assert.equal(res.state.playerGold[0] - control.state.playerGold[0], 100, '50 gold underdog, doubled');
  assert.equal(res.state.contractMisses, 0, 'a claim resets the miss streak');
});

test('a contract holds the board for three rounds, then expires and is replaced', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'EXPIRE1', fogOfWar: false, playerCount: 2 }));
  assert.ok(base.contract, 'the match opens with a contract');
  const opening = base.contract!;
  assert.equal(opening.round, 1);
  assert.equal(opening.expiresRound, 3, 'rounds 1-3 inclusive');

  let game = base;
  const round = () => {
    game = applyAction(game, { type: 'END_TURN' }).state;
    game = applyAction(game, { type: 'END_TURN' }).state;
    return game.totalTurns + 1;
  };

  assert.equal(round(), 2);
  assert.equal(game.contract?.id, opening.id, 'same card in round 2');
  assert.equal(game.contractMisses, 0, 'a live card is not a miss');

  assert.equal(round(), 3);
  assert.equal(game.contract?.id, opening.id, 'same card in round 3');
  assert.equal(game.contractMisses, 0);

  assert.equal(round(), 4);
  assert.equal(game.contract?.round, 4, 'replaced when the window closes');
  assert.equal(game.contractMisses, 1, 'the unclaimed card counts as one miss');
  assert.notEqual(game.contract?.id, opening.id, 'no immediate repeat');
  assert.equal(game.contractProgress?.[0] ?? 0, 0, 'fresh progress for the new card');
  assert.ok(game.contractsUsed?.includes(opening.id));
});

test('a CP reward that overflows the battery pays the excess out as gold', () => {
  const base = createGeneratedGame(settings({ mapSeed: 'OVERFLOW1', fogOfWar: false, playerCount: 2 }));
  const { map, weather } = clearBoard(base);
  const attacker = base.units.find(u => u.owner === 0)!;
  const support = { ...base.units.find(u => u.owner === 0 && u.id !== attacker.id)!, tileId: '9,9' };
  const extra = { ...support, id: 'extra-0', tileId: '9,8' };
  const victim = { ...base.units.find(u => u.owner === 1)!, tileId: '5,4', hp: 5, maxHp: 5 };
  const bystander = { ...base.units.find(u => u.owner === 1 && u.id !== victim.id)!, tileId: '9,10' };

  const contract: SharedContract = {
    id: 'PURGE',
    tier: 3,
    round: 1,
    claimedBy: null,
    rewardCp: 8,
    rewardGold: 0,
    target: 2,
    expiresRound: 3,
  };
  const state: GameState = {
    ...base,
    mapData: map,
    weather,
    units: [
      { ...attacker, tileId: '4,4', hp: 30, maxHp: 30, ammo: 6, completed: false },
      { ...support, hp: 20, maxHp: 20, ammo: 0 },
      { ...extra, hp: 20, maxHp: 20, ammo: 0 },
      { ...victim },
      { ...bystander, hp: 20, maxHp: 20, ammo: 0 },
    ],
    currentPlayer: 0,
    playerCp: { 0: CP_SYSTEM.MAX_CP, 1: 20 },
    playerGold: { 0: 200, 1: 200 },
    firstContactDone: true,
    contract,
    contractProgress: { 0: 1 },
    contractsUsed: ['PURGE'],
    contractMisses: 0,
  };

  const res = applyAction(state, { type: 'ATTACK', attackerId: attacker.id, targetUnitId: victim.id, cost: 5 });
  assert.equal(res.rejected, undefined);
  assert.equal(res.state.contract?.claimedBy, 0);
  // 8 CP reward at 25/30: 5 fit, 3 overflow at €15 each. (The kill's momentum refund can then
  // push the battery slightly past the cap until the next turn, which is pre-existing behaviour.)
  assert.ok(res.state.playerCp[0] >= CP_SYSTEM.MAX_CP, 'no reward CP is lost');
  assert.equal(res.state.playerGold[0], 200 + 3 * 15);
  assert.ok(res.state.gameLog.some(l => l.message.includes('converted')));
});

const eliminatedSpectatorGame = (spectatorAttacks: boolean): GameState => {
  const base = createGeneratedGame(settings({ mapSeed: 'SPEC1', fogOfWar: false, playerCount: 3 }));
  return {
    ...base,
    units: base.units.filter(u => u.owner !== 2),
    playerStatus: { 0: 'ACTIVE', 1: 'ACTIVE', 2: 'ELIMINATED' },
    settings: { ...base.settings, spectatorAttacks },
    currentPlayer: 0,
    winner: null,
    contract: null,
    contractProgress: {},
    spectatorWindow: 0,
    spectatorTurn: null,
    spectatorUsedRound: null,
  };
};

test('an eliminated player holds one map-effect window every other round', () => {
  let game = eliminatedSpectatorGame(true);
  for (let i = 0; i < 4; i++) game = applyAction(game, { type: 'END_TURN' }).state;
  assert.equal(game.totalTurns, 2, 'two full rounds completed');
  assert.equal(game.spectatorTurn, 2, 'round 3 opens the window for the eliminated seat');
  assert.equal(game.spectatorUsedRound, null);

  // Only the window holder may act, and it may do so out of turn.
  assert.equal(prepareAction(game, 0, { type: 'SPECTATOR_ATTACK', effectId: 'WAR_LEVY' }).ok, false);
  assert.ok(prepareAction(game, 2, { type: 'SPECTATOR_ATTACK', effectId: 'WAR_LEVY' }).ok);

  const beforeGold = { ...game.playerGold };
  const used = applyAction(game, { type: 'SPECTATOR_ATTACK', effectId: 'WAR_LEVY' });
  assert.equal(used.rejected, undefined);
  assert.equal(used.state.playerGold[0], beforeGold[0] + 30);
  assert.equal(used.state.playerGold[1], beforeGold[1] + 30);
  assert.equal(used.state.playerGold[2], beforeGold[2], 'the eliminated seat pays itself nothing');
  assert.equal(used.state.currentPlayer, game.currentPlayer, 'the active turn is untouched');
  assert.equal(used.state.spectatorUsedRound, 3, 'the window is spent');

  assert.equal(
    applyAction(used.state, { type: 'SPECTATOR_ATTACK', effectId: 'WAR_LEVY' }).rejected,
    'Window already used this round',
  );

  // Round 4 closes the window; round 5 opens the next one.
  let later = used.state;
  for (let i = 0; i < 4; i++) later = applyAction(later, { type: 'END_TURN' }).state;
  assert.equal(later.totalTurns, 4);
  assert.equal(later.spectatorTurn, 2, 'round 5 window');
  assert.equal(later.spectatorUsedRound, null);
});

test('an eliminated bot fires a window it can use, and the next-window helper points forward', () => {
  assert.equal(nextSpectatorWindowRound(1), 3);
  assert.equal(nextSpectatorWindowRound(3), 5);
  assert.equal(nextSpectatorWindowRound(4), 5);
  assert.equal(nextSpectatorWindowRound(5), 7);

  let game = eliminatedSpectatorGame(true);
  for (let i = 0; i < 4; i++) game = applyAction(game, { type: 'END_TURN' }).state;
  assert.equal(game.spectatorTurn, 2);

  const effect = chooseBotSpectatorEffect(game, 2);
  const result = applyAction(game, { type: 'SPECTATOR_ATTACK', effectId: effect });
  assert.equal(result.rejected, undefined);
  assert.equal(result.state.spectatorUsedRound, 3);
  assert.equal(result.state.spectatorTurn, 2, 'the window stays open for the rest of the round');
});

test('the eliminated-player attack setting switches the windows off', () => {
  let game = eliminatedSpectatorGame(false);
  for (let i = 0; i < 4; i++) game = applyAction(game, { type: 'END_TURN' }).state;
  assert.equal(game.totalTurns, 2);
  assert.equal(game.spectatorTurn, null);
  assert.equal(prepareAction(game, 2, { type: 'SPECTATOR_ATTACK', effectId: 'WAR_LEVY' }).ok, false);
});

test('Final Push is granted in a Deathmatch endgame and refills the battery exactly once', () => {
  const base = createGeneratedGame(settings({
    mapSeed: 'PUSH1',
    fogOfWar: false,
    playerCount: 2,
    victoryMode: 'DEATHMATCH',
    doomsdayEnabled: false,
  }));
  const lone = base.units.filter(u => u.owner === 0).slice(0, 1);
  const enemy = base.units.filter(u => u.owner === 1).slice(0, 1);
  const trimmed: GameState = {
    ...base,
    units: [
      { ...lone[0], hp: 30, maxHp: 30, ammo: 6 },
      { ...enemy[0], hp: 30, maxHp: 30, ammo: 6 },
    ],
    playerCp: { 0: 3, 1: 4 },
    playerCpDebt: { 0: 4, 1: 0 },
  };

  const ended = applyAction(trimmed, { type: 'END_TURN' });
  assert.equal(ended.rejected, undefined);
  assert.equal(ended.state.finalPush?.[0], 'READY');
  assert.equal(ended.state.finalPush?.[1], 'READY');

  // Back to seat 0 with a partly drained battery and Overclock debt.
  const ready: GameState = {
    ...ended.state,
    currentPlayer: 0,
    playerCp: { ...ended.state.playerCp, 0: 3 },
    playerCpDebt: { ...ended.state.playerCpDebt, 0: 4 },
  };
  assert.ok(prepareAction(ready, 0, { type: 'FINAL_PUSH' }).ok);

  const used = applyAction(ready, { type: 'FINAL_PUSH' });
  assert.equal(used.rejected, undefined);
  assert.equal(used.state.playerCp[0], CP_SYSTEM.MAX_CP);
  assert.equal(used.state.playerCpDebt?.[0], 0);
  assert.equal(used.state.finalPush?.[0], 'USED');

  const again = applyAction(used.state, { type: 'FINAL_PUSH' });
  assert.equal(again.rejected, 'No Final Push token');
});
