import assert from 'node:assert/strict';
import test from 'node:test';
import { auditBridgeOrientation, DEV_MAP_TOLERANCE, devMapReport, generateDevMap } from '@tactical/engine';

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

test('every terrain knob lands on its exact requested coverage across seeds and board sizes', () => {
  for (const gridSize of [16, 20, 28]) {
    for (const seed of ['A1', 'B2', 'C3', 'D4', 'E5']) {
      const { report } = generateDevMap({
        seed,
        gridSize,
        playerCount: 2,
        forestPct: 30,
        mountainPct: 18,
        buildingPct: 8,
        desertPct: 22,
        lootPct: 12,
        banks: 2,
        rivers: 0,
        waterPct: 0,
      });
      const where = `seed ${seed} @ ${gridSize}`;
      assert.equal(report.realized.forestPct, 30, `${where}: forest cover`);
      assert.equal(report.realized.mountainPct, 18, `${where}: mountain cover`);
      assert.equal(report.realized.desertPct, 22, `${where}: desert split`);
      assert.equal(report.realized.buildingPct, 8, `${where}: buildings`);
      assert.equal(report.realized.lootPct, 12, `${where}: loot`);
      assert.equal(report.realized.banks, 2, `${where}: banks`);
      assert.equal(report.realized.waterPct, 0, `${where}: no rivers means no water`);
      assert.equal(report.faithful, true, `${where}: report agrees with the knobs`);
    }
  }
});

test('knobs at zero build nothing, and river volume widens channels monotonically', () => {
  const bare = generateDevMap({
    seed: 'ZERO',
    gridSize: 20,
    forestPct: 0,
    mountainPct: 0,
    desertPct: 0,
    buildingPct: 0,
    lootPct: 0,
    banks: 0,
    rivers: 0,
    waterPct: 0,
  });
  assert.equal(bare.map.every(t => t.type === 'PLAINS' || t.type === 'BASE'), true, 'empty slate is just grass and HQs');

  const waterShare = (waterPct: number): number =>
    devMapReport(generateDevMap({ seed: 'RIVER', gridSize: 22, rivers: 1, waterPct }).map, 22, { rivers: 1, waterPct })
      .realized.waterPct;
  const ladder = [2, 8, 14, 22, 30].map(waterShare);
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(ladder[i] >= ladder[i - 1], `river volume ${i} is not monotonic (${ladder.join(' -> ')})`);
  }
  assert.ok(ladder[ladder.length - 1] > ladder[0] + 4, `volume 30 must be visibly wetter than 2 (${ladder.join(' -> ')})`);
  assert.equal(
    devMapReport(generateDevMap({ seed: 'DRY', gridSize: 20, rivers: 0, waterPct: 30 }).map, 20, { rivers: 0, waterPct: 30 })
      .realized.waterPct,
    0,
    'river volume alone never paints water',
  );
});

test('river volume moves smoothly: no single knob point doubles the water', () => {
  const waterShare = (waterPct: number): number =>
    devMapReport(generateDevMap({ seed: 'RIVER', gridSize: 22, rivers: 1, waterPct }).map, 22, { rivers: 1, waterPct })
      .realized.waterPct;

  // The old width brackets jumped 1 -> 2 tiles at 8/16/24, so one point of the knob doubled the
  // river. Width now comes from the requested share, so neighbours differ by a tile or two.
  for (let pct = 2; pct < 30; pct++) {
    const here = waterShare(pct);
    const next = waterShare(pct + 1);
    assert.ok(next - here <= 2, `river volume ${pct}% -> ${pct + 1}% jumped ${here}% -> ${next}%`);
  }
  assert.ok(waterShare(9) - waterShare(8) <= 1, `8% -> 9% must not double the river (${waterShare(8)}% -> ${waterShare(9)}%)`);
});

test('island boards report the sea share the sea knob maps to, not the raw knob number', () => {
  const islandBoard = (waterPct: number) =>
    generateDevMap({
      seed: 'ISLE',
      gridSize: 20,
      playerCount: 2,
      waterStyle: 'ISLANDS',
      rivers: 3,
      waterPct,
      forestPct: 16,
      mountainPct: 8,
      buildingPct: 3,
      lootPct: 0,
      banks: 2,
    });

  const full = islandBoard(26).report;
  // 26 on the sea knob maps to a 45% sea (16% + 26 × 1.1 points), the shipped archipelago curve.
  assert.equal(full.requested.waterPct, 45, 'sea volume 26 must report the 45% sea it maps to');
  assert.ok(
    Math.abs(full.realized.waterPct - full.requested.waterPct) <= DEV_MAP_TOLERANCE.waterPct,
    `island sea landed ${full.realized.waterPct}% against a ${full.requested.waterPct}% target`,
  );
  assert.equal(full.faithful, true, 'a working archipelago must not read as an unfaithful board');
  assert.ok(islandBoard(6).report.realized.waterPct < full.realized.waterPct, 'a calmer sea knob builds less water');
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

test('dev map bridges are strictly shore-aligned with zero inverted or dead-end spans across archipelago & multi-river presets', () => {
  const seeds = ['ARCH01', 'ARCH02', 'ARCH03', 'ARCH04', 'ARCH05', 'LUSH1', 'LUSH2', 'LUSH3', 'BAL01', 'WIDE9'];
  const configs = [
    // Archipelago (3 wide rivers!)
    { gridSize: 20, playerCount: 2, waterPct: 30, rivers: 3, forestPct: 16, mountainPct: 6, banks: 2 },
    { gridSize: 24, playerCount: 4, waterPct: 30, rivers: 3, forestPct: 16, mountainPct: 10, banks: 2 },
    // Lush Valley (3 rivers at volume 14)
    { gridSize: 20, playerCount: 2, waterPct: 14, rivers: 3, forestPct: 38, mountainPct: 14, banks: 2 },
    // Single & double rivers
    { gridSize: 20, playerCount: 2, waterPct: 16, rivers: 2, forestPct: 18, mountainPct: 12, banks: 2 },
  ];

  for (const cfg of configs) {
    for (const seed of seeds) {
      const { map, size } = generateDevMap({ seed, ...cfg });
      const issues = auditBridgeOrientation(map, size);
      assert.deepEqual(
        issues,
        [],
        `seed ${seed} (rivers=${cfg.rivers}, water=${cfg.waterPct}) produced glitched bridges: ${issues.map(i => i.reason).join('; ')}`,
      );
      assert.equal(allHqsConnected(map, size), true, `seed ${seed} stranded an HQ`);
    }
  }
});
