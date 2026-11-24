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
  assert.equal(forests.size, 6, 'temperate trees showcase all 6 colorful species (oak, pine, golden birch, crimson maple, sakura blossom, riverside willow)');
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

test('generateDynamicMap scales larger flanking mountain ranges & forest groves cleanly across 20x20 and 25x25 maps', () => {
  let sawDesert = false;
  let sawRoads = false;
  let sawCanyon = false;
  let maxMtn20 = 0;
  let maxMtn25 = 0;

  const countForestClusters4 = (grid: (Tile | undefined)[][], size: number): number[] => {
    const vis = new Uint8Array(size * size);
    const out: number[] = [];
    const dirs = [[0,-1],[-1,0],[1,0],[0,1]];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (grid[y][x]?.type !== 'FOREST' || vis[y * size + x]) continue;
        const q = [[x, y]];
        vis[y * size + x] = 1;
        let count = 0;
        while (q.length) {
          const [cx, cy] = q.shift()!;
          count++;
          for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || nx >= size || ny < 0 || ny >= size || vis[ny * size + nx]) continue;
            if (grid[ny][nx]?.type === 'FOREST') {
              vis[ny * size + nx] = 1;
              q.push([nx, ny]);
            }
          }
        }
        out.push(count);
      }
    }
    return out.sort((a, b) => b - a);
  };

  for (let s = 1; s <= 15; s++) {
    const players = s >= 12 ? 4 : 2;
    const { map, size, baseLocations } = generateDynamicMap(players, createSeededRng(`AUDIT-${String(s).padStart(2, '0')}`));
    const grid: (Tile | undefined)[][] = Array.from({ length: size }, () => Array(size).fill(undefined));
    for (const t of map) grid[t.y][t.x] = t;

    if (map.some(t => t.type === 'SAND' || t.type === 'DUNES')) sawDesert = true;
    if (map.some(t => t.type === 'ROAD' || t.type === 'ROAD_H')) sawRoads = true;
    if (map.some(t => t.type === 'CANYON')) sawCanyon = true;

    // Every map has meaningful bridges across a flowing river or canyon divide
    const bridges = map.filter(t => t.type === 'BRIDGE' || t.type === 'BRIDGE_V').length;
    assert.ok(bridges >= 3, `seed ${s} has meaningful river/canyon bridges (got ${bridges})`);

    // Verify no mountain spawns adjacent to player bases
    for (const base of baseLocations) {
      for (const t of map) {
        if (t.type === 'MOUNTAIN') {
          const d = Math.abs(t.x - base.x) + Math.abs(t.y - base.y);
          assert.ok(d > 2, `mountain at (${t.x},${t.y}) respects base clearance from (${base.x},${base.y})`);
        }
      }
    }

    // Mountain ranges: 20x20 has 1-2 larger flanking ranges (<=9) + smaller ridges & 1-2 tile outcrops;
    // 25x25 scales up to larger sweeping ranges (<=12) + outcrops!
    const mtnClusters = findMountainClusters(grid, grid, size).map(c => c.nodes.length);
    const largestMtn = mtnClusters.reduce((m, n) => Math.max(m, n), 0);
    const multiRanges = mtnClusters.filter(n => n >= 2).length;
    const smallOutcrops = mtnClusters.filter(n => n <= 2).length;
    const maxCap = players === 2 ? 9 : 12;
    if (players === 2) maxMtn20 = Math.max(maxMtn20, largestMtn);
    else maxMtn25 = Math.max(maxMtn25, largestMtn);

    assert.ok(largestMtn >= 5 && largestMtn <= maxCap, `seed ${s} (${size}x${size}) hero mountain range fits 5..${maxCap} tiles (got ${largestMtn})`);
    assert.ok(multiRanges >= (players === 2 ? 5 : 8), `seed ${s} has rich spread flanking mountain ranges (got ${multiRanges})`);
    assert.ok(smallOutcrops >= 3, `seed ${s} includes 1–2 tile mountain outcrops for flanking cover (got ${smallOutcrops})`);

    // Forest groves: 20x20 has 1–2 cohesive groves (4–8 tiles); 25x25 scales to 2–3 larger groves (5–10 tiles), plus richly scattered solo trees!
    const forestClusters = countForestClusters4(grid, size);
    const multiTileForests = forestClusters.filter(n => n >= 2);
    const loneTrees = forestClusters.filter(n => n === 1);
    const maxGroves = players === 2 ? 2 : 3;
    const maxGroveCap = players === 2 ? 8 : 10;
    assert.ok(multiTileForests.length >= 1 && multiTileForests.length <= maxGroves, `seed ${s} has 1..${maxGroves} cohesive forest groves (got ${multiTileForests.length}: [${multiTileForests.join(',')}])`);
    for (const gSize of multiTileForests) {
      assert.ok(gSize >= 4 && gSize <= maxGroveCap, `seed ${s} forest grove covers 4..${maxGroveCap} tiles (got ${gSize})`);
    }
    assert.ok(loneTrees.length >= (players === 2 ? 30 : 50), `seed ${s} scatters rich standalone individual trees (got ${loneTrees.length})`);
  }

  assert.ok(maxMtn20 >= 7 && maxMtn20 <= 9, `20x20 maps include 7–9 tile hero flanking ranges (max ${maxMtn20})`);
  assert.ok(maxMtn25 >= 8 && maxMtn25 <= 12, `25x25 maps scale up to larger 8–12 tile ranges (max ${maxMtn25})`);
  assert.ok(sawDesert && sawRoads && sawCanyon, '15 randomized maps showcase varied desert, canyon, and road archetypes');
});
