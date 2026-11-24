import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GAME_SETTINGS } from '@tactical/engine';
import { BANK_STATS, BASE_STATS } from '@tactical/engine/constants/Config';
import { useGameStore } from '../../store/useGameStore';

const boot = () => {
  useGameStore.setState({
    settings: { ...DEFAULT_GAME_SETTINGS, gameMode: 'PVP', playerCount: 2, mapSeed: 'SIEGE' },
  });
  useGameStore.getState().setDevOptions({ seed: 'SIEGE', gridSize: 12, banks: 2, playerCount: 2 });
  useGameStore.getState().launchDevSandbox();
  useGameStore.getState().setDevFreeplay(true);
};

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
