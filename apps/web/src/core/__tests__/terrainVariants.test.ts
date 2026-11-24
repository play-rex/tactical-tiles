import assert from 'node:assert/strict';
import test from 'node:test';
import type { TerrainType, Tile } from '@tactical/engine/types';
import {
  findMountainClusters,
  hash3,
  isDesertNeighborhood,
  pickBankVariant,
  pickBarrierVariant,
  pickBridgeVariant,
  pickBunkerVariant,
  pickDuneVariant,
  pickForestVariant,
  pickMountainVariant,
  pickPlainsDetail,
  pickSandDetail,
  pickWatchtowerVariant,
} from '../graphics/terrain/terrainVariants';
import { generateDynamicMap } from '@tactical/engine/game/setup';
import { createSeededRng } from '@tactical/engine/utils/SeededRandom';

const makeTile = (x: number, y: number, type: TerrainType): Tile => ({
  id: `${x},${y}`,
  x,
  y,
  type,
  height: type === 'MOUNTAIN' || type === 'DUNES' ? 2 : type === 'WATER' || type === 'CANYON' ? 0 : 1,
  loot: null,
});

const buildGrid = (size: number, fill: TerrainType = 'PLAINS'): (Tile | undefined)[][] =>
  Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => makeTile(x, y, fill)),
  );

test('Terrain variants produce rich visual diversity across mountains, forests, dunes, structures, and ground details', () => {
  const size = 20;
  const mountains = new Set<string>();
  const desertMountains = new Set<string>();
  const forests = new Set<string>();
  const dunes = new Set<string>();
  const watchtowers = new Set<string>();
  const bunkers = new Set<string>();
  const barriers = new Set<string>();
  const bridges = new Set<string>();
  const plainsDetails = new Set<string>();
  const sandDetails = new Set<string>();

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      mountains.add(pickMountainVariant(makeTile(x, y, 'MOUNTAIN'), false, size));
      desertMountains.add(pickMountainVariant(makeTile(x, y, 'MOUNTAIN'), true, size));
      forests.add(pickForestVariant(makeTile(x, y, 'FOREST'), false, size));
      dunes.add(pickDuneVariant(makeTile(x, y, 'DUNES'), size));
      watchtowers.add(pickWatchtowerVariant(makeTile(x, y, 'BUILDING'), size));
      bunkers.add(pickBunkerVariant(makeTile(x, y, 'BUILDING'), size));
      barriers.add(pickBarrierVariant(makeTile(x, y, 'BARRIER'), size));
      bridges.add(pickBridgeVariant(makeTile(x, y, 'BRIDGE'), false, size));
      plainsDetails.add(pickPlainsDetail(makeTile(x, y, 'PLAINS'), size));
      sandDetails.add(pickSandDetail(makeTile(x, y, 'SAND'), size));
    }
  }

  assert.equal(mountains.size, 4, 'temperate mountains showcase all 4 alpine/highland/crag variants');
  assert.equal(desertMountains.size, 2, 'desert mountains showcase both Desert Mesa and Desert Butte');
  assert.equal(forests.size, 4, 'temperate forests showcase conifer, oak, old-growth, and autumn mix');
  assert.equal(dunes.size, 4, 'dunes showcase all 4 sculpted variants');
  assert.equal(watchtowers.size, 3, 'watchtowers showcase all 3 architectural variants');
  assert.equal(bunkers.size, 3, 'bunkers showcase all 3 fortification variants');
  assert.equal(barriers.size, 3, 'barriers showcase jersey blocks, hedgehogs, and dragon teeth');
  assert.equal(bridges.size, 2, 'water bridges mix steel truss and concrete viaduct');
  assert.equal(plainsDetails.size, 5, 'plains mix clean grass with tufts, wildflowers, pebbles, and clover');
  assert.equal(sandDetails.size, 5, 'sand mixes clean sand with ripples, shards, scrub, and alkali cracks');
});

test('Desert neighborhood detection shifts adjacent mountains to mesas/buttes and forests to palm oases', () => {
  const size = 10;
  const desertGrid = buildGrid(size, 'SAND');
  const mTile = makeTile(5, 5, 'MOUNTAIN');
  const fTile = makeTile(4, 4, 'FOREST');
  desertGrid[5][5] = mTile;
  desertGrid[4][4] = fTile;

  assert.equal(isDesertNeighborhood(mTile, desertGrid, size), true);
  assert.equal(isDesertNeighborhood(fTile, desertGrid, size), true);
  const mVar = pickMountainVariant(mTile, true, size);
  assert.ok(mVar === 'DESERT_MESA' || mVar === 'DESERT_BUTTE');
  assert.equal(pickForestVariant(fTile, true, size), 'DESERT_OASIS');

  const grassGrid = buildGrid(size, 'PLAINS');
  grassGrid[5][5] = mTile;
  grassGrid[4][4] = fTile;
  assert.equal(isDesertNeighborhood(mTile, grassGrid, size), false);
  assert.equal(isDesertNeighborhood(fTile, grassGrid, size), false);

  // Canyon bridges always pick Concrete Viaduct
  assert.equal(pickBridgeVariant(makeTile(3, 3, 'BRIDGE'), true, size), 'CONCRETE_VIADUCT');
});

test('Multi-bank maps guarantee distinct Bank Vault architectures and remain deterministic', () => {
  const size = 18;
  const banks = [
    makeTile(4, 4, 'BANK'),
    makeTile(13, 4, 'BANK'),
    makeTile(4, 13, 'BANK'),
    makeTile(13, 13, 'BANK'),
  ];
  const seedOffset = Math.floor(hash3(banks[0].x, banks[0].y, 333) * 4);
  const picked = banks.map((_, idx) => pickBankVariant(idx, seedOffset, size));

  assert.equal(new Set(picked).size, 4, '4 banks on the same map receive all 4 distinct vault designs');
  // Calling again yields identical deterministic assignments
  const pickedAgain = banks.map((_, idx) => pickBankVariant(idx, seedOffset, size));
  assert.deepEqual(picked, pickedAgain);
});

test('Single-tile editor previews (gridSize === 1) always render stable iconic hero variants', () => {
  const tile = makeTile(0, 0, 'PLAINS');
  assert.equal(pickMountainVariant(tile, false, 1), 'ALPINE_PEAK');
  assert.equal(pickForestVariant(tile, false, 1), 'BROADLEAF_OAK');
  assert.equal(pickBankVariant(0, 2, 1), 'BULLION_ROTUNDA');
  assert.equal(pickDuneVariant(tile, 1), 'BARCHAN_CRESCENT');
  assert.equal(pickWatchtowerVariant(tile, 1), 'RADAR_TOWER');
  assert.equal(pickBunkerVariant(tile, 1), 'CONCRETE_PILLBOX');
  assert.equal(pickBarrierVariant(tile, 1), 'JERSEY_BLOCKS');
  assert.equal(pickBridgeVariant(tile, false, 1), 'STEEL_TRUSS');
});

test('findMountainClusters merges 8-way irregular chains into unified massifs with taller interior peaks and non-crossing ridges', () => {
  const size = 10;
  const grid = buildGrid(size, 'PLAINS');
  // Irregular diagonal + branching alpine massif
  const coords = [
    [2, 2], [3, 2], [4, 2],
    [3, 3], [4, 3], [5, 4], // diagonal spur to (5,4)
    [2, 4], // diagonal spur to (2,4)
  ];
  for (const [x, y] of coords) grid[y][x] = makeTile(x, y, 'MOUNTAIN');
  // Isolated lone peak far away
  grid[8][8] = makeTile(8, 8, 'MOUNTAIN');

  const clusters = findMountainClusters(grid, grid, size);
  assert.equal(clusters.length, 2, '7-tile diagonal/branching range merges into 1 massif plus 1 lone peak');

  const massif = clusters.find(c => c.nodes.length === 7)!;
  assert.ok(massif, 'found 7-tile connected massif');
  assert.equal(massif.isDesert, false);
  assert.ok(massif.links.some(l => l.isDiagonal), 'diagonal ridge spur is linked smoothly');

  // Interior tile (3,3) should rise taller than outer spur tip (5,4)
  const coreNode = massif.nodes.find(n => n.x === 3 && n.y === 3)!;
  const tipNode = massif.nodes.find(n => n.x === 5 && n.y === 4)!;
  assert.ok(coreNode.totalNeighbors > tipNode.totalNeighbors);
  assert.ok(coreNode.elevation > tipNode.elevation, 'interior massif heart rises taller than outer foothill spurs');
});

test('generateDynamicMap sculpts larger irregular mountain ranges while keeping bases clear', () => {
  let maxClusterAcrossSeeds = 0;
  for (let s = 1; s <= 12; s++) {
    const { map, size, baseLocations } = generateDynamicMap(2, createSeededRng(`ALPINE_SEED_${s}`));
    const grid: (Tile | undefined)[][] = Array.from({ length: size }, () => Array(size).fill(undefined));
    for (const t of map) grid[t.y][t.x] = t;

    // Verify no mountain spawns right on top of or adjacent (dist <= 2) to player bases
    for (const base of baseLocations) {
      for (const t of map) {
        if (t.type === 'MOUNTAIN') {
          const d = Math.abs(t.x - base.x) + Math.abs(t.y - base.y);
          assert.ok(d > 2, `mountain at (${t.x},${t.y}) respects base clearance from (${base.x},${base.y})`);
        }
      }
    }

    const clusters = findMountainClusters(grid, grid, size);
    const largest = clusters.reduce((m, c) => Math.max(m, c.nodes.length), 0);
    if (largest > maxClusterAcrossSeeds) maxClusterAcrossSeeds = largest;
    assert.ok(largest >= 4, `seed ${s} produces at least one substantial mountain range (got ${largest})`);
  }
  assert.ok(maxClusterAcrossSeeds >= 7, `generated maps feature sweeping 7+ tile irregular mountain ranges (max ${maxClusterAcrossSeeds})`);
});
