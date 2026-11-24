import assert from 'node:assert/strict';
import test from 'node:test';
import { botAction, DEFAULT_GAME_SETTINGS, type GameEvent } from '@tactical/engine';
import { BANK_STATS, BASE_STATS } from '@tactical/engine/constants/Config';
import { useGameStore } from '../../store/useGameStore';
import { highlightRecorder } from '../graphics/highlightRecorder';
import { recapPlayer } from '../graphics/recapPlayer';

const boot = () => {
  useGameStore.setState({
    settings: { ...DEFAULT_GAME_SETTINGS, gameMode: 'PVP', playerCount: 2, mapSeed: 'SIEGE' },
  });
  useGameStore.getState().setDevOptions({ seed: 'SIEGE', gridSize: 12, banks: 2, playerCount: 2 });
  useGameStore.getState().launchDevSandbox();
  useGameStore.getState().setDevFreeplay(true);
};

test('bot match: both seats are AI-driven, so a simulated match runs itself', () => {
  boot();
  assert.equal(useGameStore.getState().settings.gameMode, 'PVP', 'the sandbox opens as hot-seat');

  // Turning bots on relaunches the same board with an AI seat on both sides.
  useGameStore.getState().setDevBotMatch(true);
  const launched = useGameStore.getState();
  assert.equal(launched.devBotMatch, true);
  assert.equal(launched.settings.gameMode, 'PVE', 'bot match runs under AI rules');
  assert.equal(launched.settings.fogOfWar, false, 'no fog: you are watching, not playing');
  assert.equal(launched.devFreeplay, false, 'the simulation runs real rules, not the free-CP sandbox');
  assert.equal(launched.isAiTurn, true, 'seat 0 is locked to the bot as well');

  // The brain acts for the opening seat and the board stays AI-locked afterwards.
  const action = botAction(launched);
  launched.executeAiAction(action);
  const after = useGameStore.getState();
  assert.equal(after.winner, null, 'the simulation did not end on one action');
  assert.equal(after.isAiTurn, true, 'still AI-driven after seat 0 acts');

  useGameStore.getState().setDevBotMatch(false);
  assert.equal(useGameStore.getState().devBotMatch, false);
  assert.equal(useGameStore.getState().isAiTurn, false, 'switching bots off hands the board back');
});

test('pure sandbox: clicking a bank strikes it instead of parking the unit on it', () => {
  boot();
  const s = useGameStore.getState();
  const bank = s.mapData.find(t => t.type === 'BANK');
  const unit = s.units.find(u => u.owner === 0);
  assert.ok(bank, 'dev map has a bank');
  assert.ok(unit, 'player 0 spawned a unit');
  assert.equal(bank.hp, BANK_STATS.HP, 'dev banks carry vault hp');

  useGameStore.setState({ selectedUnitId: unit.id, selectedTileId: unit.tileId });
  useGameStore.getState().handleTileClick(bank.x, bank.y);

  const after = useGameStore.getState();
  const bankAfter = after.mapData.find(t => t.id === bank.id)!;
  assert.ok((bankAfter.hp ?? 0) < BANK_STATS.HP, `bank took damage (hp=${bankAfter.hp})`);
  assert.equal(after.units.find(u => u.id === unit.id)!.tileId, unit.tileId, 'unit stayed put');
});

test('pure sandbox: clicking an enemy HQ sieges it; units cannot stay on own HQ, breached bank, or barrier', () => {
  boot();
  const s = useGameStore.getState();
  const unit = s.units.find(u => u.owner === 0)!;
  const enemyHq = s.mapData.find(t => t.type === 'BASE' && t.owner === 1)!;
  const ownHq = s.mapData.find(t => t.type === 'BASE' && t.owner === 0)!;
  const bank = s.mapData.find(t => t.type === 'BANK')!;

  useGameStore.setState({ selectedUnitId: unit.id, selectedTileId: unit.tileId });
  useGameStore.getState().handleTileClick(enemyHq.x, enemyHq.y);
  let after = useGameStore.getState();
  assert.ok((after.mapData.find(t => t.id === enemyHq.id)!.hp ?? 0) < BASE_STATS.HP, 'enemy HQ took damage');
  assert.equal(after.units.find(u => u.id === unit.id)!.tileId, unit.tileId, 'unit did not walk into the HQ');

  // Clicking own HQ does not teleport the unit onto the Base tile
  const moved = after.units.find(u => u.id === unit.id)!;
  useGameStore.setState({ selectedUnitId: moved.id });
  useGameStore.getState().handleTileClick(ownHq.x, ownHq.y);
  after = useGameStore.getState();
  assert.equal(after.units.find(u => u.id === unit.id)!.tileId, moved.tileId, 'unit cannot stand on own HQ');

  // Even a breached bank or placed barrier cannot hold a unit
  useGameStore.setState({
    mapData: after.mapData.map(t => (t.id === bank.id ? { ...t, hp: 0, hackProgress: 100 } : t)),
  });
  useGameStore.getState().devMoveUnit(unit.id, bank.id);
  assert.equal(useGameStore.getState().units.find(u => u.id === unit.id)!.tileId, moved.tileId, 'unit cannot stand on breached bank');

  const openTile = after.mapData.find(t => t.type === 'PLAINS' && !after.units.some(u => u.tileId === t.id))!;
  useGameStore.getState().devPlace(openTile.x, openTile.y, { kind: 'STRUCTURE', structure: 'BARRIER', owner: 0 });
  useGameStore.getState().devMoveUnit(unit.id, openTile.id);
  assert.equal(useGameStore.getState().units.find(u => u.id === unit.id)!.tileId, moved.tileId, 'unit cannot stand on barrier');
  useGameStore.getState().devPlace(ownHq.x, ownHq.y, { kind: 'UNIT', unitType: 'SOLDIER', owner: 0 });
  assert.equal(useGameStore.getState().units.some(u => u.tileId === ownHq.id), false, 'cannot brush-place unit on Base');
});

test('end-of-match scoreboard stays held until the drama reel actually starts', () => {
  boot();
  const s = useGameStore.getState();
  const victim = s.units.find(u => u.owner === 1);
  const killer = s.units.find(u => u.owner === 0);
  assert.ok(victim && killer, 'both seats have units');

  const killBatch = (): GameEvent[] => [
    { kind: 'hit', targetUnitId: victim.id, at: { x: 1, y: 1 }, damage: 12, isKill: true, weapon: 'SNIPER' },
    {
      kind: 'killed',
      unitId: victim.id,
      unitType: victim.type,
      owner: victim.owner,
      rank: 0,
      at: { x: 1, y: 1 },
      killerUnitId: killer.id,
      killerOwner: killer.owner,
      cause: 'COMBAT',
    },
  ];
  highlightRecorder.reset();
  for (const turn of [2, 5]) {
    highlightRecorder.record({
      turn,
      seed: 'SIEGE',
      preUnits: s.units,
      preMapData: s.mapData,
      postUnits: s.units,
      postMapData: s.mapData,
      events: killBatch(),
    });
  }

  // The winning board is on screen with the reel cued but not started: the modal must wait.
  useGameStore.setState({ winner: 0, finalePending: true });
  assert.equal(useGameStore.getState().playMatchFilm(), true);
  assert.equal(useGameStore.getState().finalePending, false, 'the hold hands over to the reel');
  assert.equal(recapPlayer.isActive(), true, 'the reel owns the screen, so no results flash');

  // Skipping the reel releases the scoreboard.
  recapPlayer.stop();
  assert.equal(useGameStore.getState().finalePending, false);
  highlightRecorder.reset();
});
