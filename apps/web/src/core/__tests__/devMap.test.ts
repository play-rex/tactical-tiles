import assert from 'node:assert/strict';
import test from 'node:test';
import { generateDevMap } from '@tactical/engine';

const walkable = (type: string) => type !== 'WATER';

/** Every HQ must be reachable on foot from the first one, or the sandbox strand a player. */
const allHqsConnected = (map: { x: number; y: number; type: string }[], size: number): boolean => {
  const hqs = map.filter(t => t.type === 'BASE');
  if (hqs.length === 0) return false;
  const seen = new Set<string>([`${hqs[0].x},${hqs[0].y}`]);
  const queue = [hqs[0]];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cur.x + dx;
      const y = cur.y + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const tile = map.find(t => t.x === x && t.y === y);
      if (!tile || !walkable(tile.type)) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(tile);
    }
  }
  return hqs.every(hq => seen.has(`${hq.x},${hq.y}`));
};

test('dev map rebuilds the same battlefield for the same options and seed', () => {
  const a = generateDevMap({ seed: 'ALPHA', gridSize: 18, forestPct: 20, mountainPct: 15, rivers: 2 });
  const b = generateDevMap({ seed: 'ALPHA', gridSize: 18, forestPct: 20, mountainPct: 15, rivers: 2 });
  assert.deepEqual(a.map.map(t => t.type), b.map.map(t => t.type));
  assert.deepEqual(a.map.map(t => t.id), b.map.map(t => t.id));
});

test('dev map responds to the terrain knobs', () => {
  const bare = generateDevMap({
    seed: 'KNOBS',
    gridSize: 20,
    forestPct: 0,
    mountainPct: 0,
    waterPct: 0,
    rivers: 0,
    buildingPct: 0,
    desertPct: 0,
    lootPct: 0,
  });
  assert.equal(bare.map.some(t => t.type === 'FOREST'), false);
  assert.equal(bare.map.some(t => t.type === 'MOUNTAIN'), false);
  assert.equal(bare.map.some(t => t.type === 'WATER'), false);

  const lush = generateDevMap({ seed: 'KNOBS', gridSize: 20, forestPct: 45, mountainPct: 30, waterPct: 20, rivers: 2 });
  assert.ok(lush.map.filter(t => t.type === 'FOREST').length > 40);
  assert.ok(lush.map.filter(t => t.type === 'MOUNTAIN').length > 25);
  assert.ok(lush.map.some(t => t.type === 'WATER' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V'));
});

test('dev map stamps one HQ per seat and keeps them connected on river-heavy boards', () => {
  for (const seed of ['SEED1', 'SEED2', 'SEED3', 'WET']) {
    const { map, size } = generateDevMap({
      seed,
      gridSize: 22,
      playerCount: 4,
      waterPct: 30,
      rivers: 3,
      mountainPct: 20,
    });
    assert.equal(map.filter(t => t.type === 'BASE').length, 4);
    assert.equal(allHqsConnected(map, size), true, `seed ${seed} left an HQ unreachable`);
  }
});

test('dev map honours bank and loot requests', () => {
  const { map } = generateDevMap({
    seed: 'LOOT',
    gridSize: 24,
    banks: 3,
    lootPct: 15,
    forestPct: 0,
    mountainPct: 0,
    rivers: 0,
    waterPct: 0,
  });
  assert.equal(map.filter(t => t.type === 'BANK').length, 3);
  assert.ok(map.some(t => !!t.loot));
});
