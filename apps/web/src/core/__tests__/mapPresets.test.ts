import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditBridgeOrientation,
  createGeneratedGame,
  decodeMapCode,
  DEFAULT_GAME_SETTINGS,
  encodeMapCode,
  generateConfiguredMap,
  isFootPassable,
  MAP_GEN_PRESETS,
  resolveMapGenKnobs,
  rollWildcardKnobs,
  type MapGenConfig,
  type Tile,
} from '@tactical/engine';
import { createSeededRng } from '@tactical/engine/utils/SeededRandom';

const allAnchorsReachable = (map: Tile[], size: number): boolean => {
  const anchors = map.filter(t => t.type === 'BASE' || t.type === 'BANK');
  if (anchors.length <= 1) return true;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < size && y < size ? map[y * size + x] : null);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  const seen = new Set<string>();
  const queue: Tile[] = [];
  for (const [dx, dy] of dirs) {
    const nb = at(anchors[0].x + dx, anchors[0].y + dy);
    if (nb && isFootPassable(nb)) {
      seen.add(nb.id);
      queue.push(nb);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of dirs) {
      const nb = at(cur.x + dx, cur.y + dy);
      if (!nb || seen.has(nb.id) || !isFootPassable(nb)) continue;
      seen.add(nb.id);
      queue.push(nb);
    }
  }
  return anchors.every(a =>
    dirs.some(([dx, dy]) => {
      const nb = at(a.x + dx, a.y + dy);
      return !!nb && seen.has(nb.id);
    }),
  );
};

test('all curated map presets produce valid shore-aligned bridges and full HQ/Bank connectivity across seeds & player counts', () => {
  const seeds = ['ALPHA1', 'BRAVO2', 'CHARL3', 'DELTA4', 'ECHO55', 'FOXT66'];
  for (const preset of MAP_GEN_PRESETS) {
    if (preset.id === 'classic') continue;
    for (const playerCount of [2, 4]) {
      for (const seed of seeds) {
        const { map, size, baseLocations } = generateConfiguredMap(playerCount, seed, { preset: preset.id });
        assert.equal(baseLocations.length, playerCount, `${preset.id} ${seed} ${playerCount}P base count`);
        const issues = auditBridgeOrientation(map, size);
        assert.deepEqual(
          issues,
          [],
          `${preset.id} ${seed} ${playerCount}P bridge issues: ${issues.map(i => i.reason).join('; ')}`,
        );
        assert.equal(
          allAnchorsReachable(map, size),
          true,
          `${preset.id} ${seed} ${playerCount}P stranded an HQ or Bank`,
        );
      }
    }
  }
});

test('Archipelago, Timber Ridge, Balanced diagonal rivers, and Lush Valley variants behave as tuned', () => {
  const arch = generateConfiguredMap(2, 'ISLAND7', { preset: 'archipelago' });
  assert.ok(arch.map.filter(t => t.type === 'WATER').length > 60, 'Archipelago has substantial sea coverage');
  assert.ok(
    arch.map.some(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V'),
    'Archipelago places bridges across straits',
  );
  assert.deepEqual(auditBridgeOrientation(arch.map, arch.size), []);

  // Timber Ridge: zero rivers/water, ~30-42% forest & ~12-21% mountain variants
  const forestCounts = new Set<number>();
  for (let i = 0; i < 12; i++) {
    const timber = generateConfiguredMap(2, `WOOD${i}`, { preset: 'timber_ridge' });
    assert.equal(timber.map.some(t => t.type === 'WATER' || t.type === 'CANYON'), false, 'Timber Ridge has no rivers');
    const fPct = (timber.map.filter(t => t.type === 'FOREST').length / timber.map.length) * 100;
    const mPct = (timber.map.filter(t => t.type === 'MOUNTAIN').length / timber.map.length) * 100;
    assert.ok(fPct >= 26 && fPct <= 45, `Timber Ridge forestPct ${fPct.toFixed(1)}% in expected band`);
    assert.ok(mPct >= 10 && mPct <= 24, `Timber Ridge mountainPct ${mPct.toFixed(1)}% in expected band`);
    forestCounts.add(Math.round(fPct / 5));
    assert.equal(allAnchorsReachable(timber.map, timber.size), true);
  }
  assert.ok(forestCounts.size >= 2, 'Timber Ridge produces distinct forest/mountain variants across seeds');

  // Balanced generates sweeping diagonal rivers (spanning both X and Y ranges) as well as orthogonal rivers
  let sawDiagonal = false;
  for (let i = 0; i < 16; i++) {
    const bal = generateConfiguredMap(2, `BALD${i}`, { preset: 'balanced' });
    assert.deepEqual(auditBridgeOrientation(bal.map, bal.size), []);
    const water = bal.map.filter(t => t.type === 'WATER' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V');
    const xs = water.map(t => t.x);
    const ys = water.map(t => t.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX >= 10 && spanY >= 10) sawDiagonal = true;
  }
  assert.equal(sawDiagonal, true, 'Balanced generates sweeping diagonal rivers across seeds');

  // Lush Valley keeps water volume light & playable (< 24%) while varying across 1–3 river layouts
  const waterRatios: number[] = [];
  for (let i = 0; i < 12; i++) {
    const lush = generateConfiguredMap(2, `LUSHV${i}`, { preset: 'lush_valley' });
    const waterTiles = lush.map.filter(t => t.type === 'WATER' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V').length;
    const ratio = waterTiles / lush.map.length;
    waterRatios.push(ratio);
    assert.ok(ratio > 0.04 && ratio < 0.24, `Lush Valley seed LUSHV${i} water ratio ${ratio.toFixed(2)} stays balanced & playable`);
    assert.deepEqual(auditBridgeOrientation(lush.map, lush.size), []);
  }
  assert.ok(Math.max(...waterRatios) - Math.min(...waterRatios) > 0.02, 'Lush Valley varies across 1–3 river layouts');
});

test('Mirrored 180° symmetry builds exact rotationally symmetric terrain, bridges, banks & outposts for 2P and 4P', () => {
  for (const presetId of ['balanced', 'lush_valley', 'archipelago', 'timber_ridge'] as const) {
    for (const playerCount of [2, 4]) {
      const cfg: MapGenConfig = { preset: presetId, knobs: { symmetry: 'MIRRORED' } };
      const { map, size } = generateConfiguredMap(playerCount, 'MIRR09', cfg);
      assert.deepEqual(auditBridgeOrientation(map, size), []);
      assert.equal(allAnchorsReachable(map, size), true);
      for (const t of map) {
        const mt = map[(size - 1 - t.y) * size + (size - 1 - t.x)];
        assert.equal(
          t.type,
          mt.type,
          `${presetId} ${playerCount}P mismatch at (${t.x},${t.y})=${t.type} vs (${mt.x},${mt.y})=${mt.type}`,
        );
        assert.equal(t.subType, mt.subType, `${presetId} ${playerCount}P subType mismatch at (${t.x},${t.y})`);
      }
    }
  }
});

test('Map recipe codes round-trip cleanly for presets, classic, static arenas, and custom knob sets', () => {
  const archCode = encodeMapCode('K7M9P2', { preset: 'archipelago' });
  assert.equal(archCode, 'ARCH-K7M9P2');
  assert.deepEqual(decodeMapCode(archCode), { seed: 'K7M9P2', mapGen: { preset: 'archipelago' } });

  const customKnobs = resolveMapGenKnobs({
    preset: 'custom',
    knobs: {
      gridSize: 25,
      waterStyle: 'ISLANDS',
      rivers: 2,
      waterPct: 22,
      forestPct: 33,
      mountainPct: 19,
      desertPct: 45,
      buildingPct: 9,
      lootPct: 18,
      banks: 3,
      roads: false,
      symmetry: 'MIRRORED',
    },
  });
  const customCode = encodeMapCode('Z9X8C7', { preset: 'custom', knobs: customKnobs });
  const decoded = decodeMapCode(customCode);
  assert.equal(decoded?.seed, 'Z9X8C7');
  assert.equal(decoded?.mapGen?.preset, 'custom');
  assert.deepEqual(decoded?.mapGen?.knobs, customKnobs);

  // Plain seed stays plain
  assert.deepEqual(decodeMapCode('abc123'), { seed: 'ABC123' });

  // Static arena code round-trips
  const staticCode = encodeMapCode('ANY', { preset: 'classic', staticMapId: 'campaign_delta' });
  assert.deepEqual(decodeMapCode(staticCode), { mapGen: { preset: 'classic', staticMapId: 'campaign_delta' } });
});

test('createGeneratedGame honors mapGen presets, manual grid size, and static arenas while keeping classic untouched', () => {
  const classicA = createGeneratedGame({ ...DEFAULT_GAME_SETTINGS, mapSeed: 'SAME01' });
  const classicB = createGeneratedGame({ ...DEFAULT_GAME_SETTINGS, mapSeed: 'SAME01', mapGen: { preset: 'classic' } });
  assert.deepEqual(
    classicA.mapData.map(t => t.type),
    classicB.mapData.map(t => t.type),
    'classic preset matches default generateDynamicMap bit-for-bit',
  );

  const compact = createGeneratedGame({
    ...DEFAULT_GAME_SETTINGS,
    playerCount: 2,
    mapSeed: 'TINY16',
    mapGen: { preset: 'custom', knobs: { gridSize: 16, waterStyle: 'RIVERS', rivers: 1, waterPct: 10 } },
  });
  assert.equal(compact.gridSize, 16);
  assert.equal(compact.mapData.length, 256);

  const staticGame = createGeneratedGame({
    ...DEFAULT_GAME_SETTINGS,
    playerCount: 2,
    mapSeed: 'STATIC',
    mapGen: { preset: 'classic', staticMapId: 'campaign_recon' },
  });
  assert.equal(staticGame.gridSize, 25);

  // Wildcard knobs always produce legal playable boards
  const rng = createSeededRng('WILD1');
  for (let i = 0; i < 6; i++) {
    const knobs = rollWildcardKnobs(rng);
    const g = createGeneratedGame({
      ...DEFAULT_GAME_SETTINGS,
      mapSeed: `WLD${i}`,
      mapGen: { preset: 'custom', knobs },
    });
    assert.deepEqual(auditBridgeOrientation(g.mapData, g.gridSize), []);
    assert.equal(allAnchorsReachable(g.mapData, g.gridSize), true);
  }
});

test('all default presets start with exactly 1 fair crate per player at equal HQ distance', () => {
  for (const preset of MAP_GEN_PRESETS) {
    for (const playerCount of [2, 4]) {
      const game = createGeneratedGame({
        ...DEFAULT_GAME_SETTINGS,
        playerCount,
        mapSeed: `FAIR${playerCount}`,
        mapGen: { preset: preset.id },
      });
      const lootTiles = game.mapData.filter(t => Boolean(t.loot));
      assert.equal(
        lootTiles.length,
        playerCount,
        `${preset.id} ${playerCount}P must spawn exactly ${playerCount} starting crates (got ${lootTiles.length})`,
      );
      // Every starting crate carries the exact same item type for opening fairness
      const items = new Set(lootTiles.map(t => t.loot));
      assert.equal(items.size, 1, `${preset.id} ${playerCount}P starting crates share identical item type`);

      // Each crate sits at equal Manhattan distance from its closest HQ
      const bases = game.mapData.filter(t => t.type === 'BASE');
      const hqDists = lootTiles.map(lt =>
        Math.min(...bases.map(b => Math.abs(lt.x - b.x) + Math.abs(lt.y - b.y))),
      );
      assert.equal(
        new Set(hqDists).size,
        1,
        `${preset.id} ${playerCount}P starting crates must be equidistant from HQs (got ${hqDists.join(', ')})`,
      );
    }
  }
});
