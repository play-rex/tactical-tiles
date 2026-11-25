import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createGeneratedGame, DEFAULT_GAME_SETTINGS } from '@tactical/engine';
import { useGameStore } from '../../store/useGameStore';

/**
 * A simulated match with an eliminated bot. The AI loop applies an action every few hundred
 * milliseconds, and every one of those calls re-enters the spectator scheduler; that re-entry used
 * to reset the window timer, so the bot never fired. Here the window must fire once, on schedule.
 */
test('simulated match: an eliminated bot fires once per window despite the running action loop', () => {
  const base = createGeneratedGame({
    ...DEFAULT_GAME_SETTINGS,
    playerCount: 3,
    gameMode: 'PVE',
    mapSeed: 'SPECBOT1',
    fogOfWar: false,
    spectatorAttacks: true,
  });
  const units = base.units.filter(u => u.owner !== 1);
  useGameStore.setState({
    ...base,
    units,
    mode: 'LOCAL',
    currentScreen: 'GAME',
    isAiTurn: false,
    currentPlayer: 0,
    totalTurns: 2,
    winner: null,
    contract: null,
    contractProgress: {},
    spectatorTurn: 1,
    spectatorWindow: 0,
    spectatorUsedRound: null,
    playerStatus: { 0: 'ACTIVE', 1: 'ELIMINATED', 2: 'ACTIVE' },
    gameLog: [],
  });

  const mine = units.filter(u => u.owner === 0);
  assert.ok(mine.length >= 3, 'the simulation has enough units to keep acting');

  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // Round 3, window opens for the eliminated bot: the first action arms its attack timer.
    useGameStore.getState().executeAiAction({ type: 'RELOAD', unitId: mine[0].id, cost: 0 });
    mock.timers.tick(300);
    assert.equal(useGameStore.getState().spectatorUsedRound, null, 'nothing fired early');

    // Mid-window bot action: this used to cancel/re-arm the timer and starve the attack.
    useGameStore.getState().executeAiAction({ type: 'RELOAD', unitId: mine[1].id, cost: 0 });
    mock.timers.tick(700);
    assert.equal(useGameStore.getState().spectatorUsedRound, 3, 'the bot acted on its own window');

    // More actions and time must not produce a second effect for the same window.
    useGameStore.getState().executeAiAction({ type: 'RELOAD', unitId: mine[2].id, cost: 0 });
    mock.timers.tick(5000);
    const attacks = useGameStore.getState().gameLog.filter(l => l.message.includes('SPECTATOR ATTACK'));
    assert.equal(attacks.length, 1, 'exactly one effect per window');
  } finally {
    mock.timers.reset();
  }
});
