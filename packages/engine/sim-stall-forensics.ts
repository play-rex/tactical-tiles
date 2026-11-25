/** Forensics for the CP30/CP20 stalemates: what is the last surviving squad actually doing? */
import {
  applyAction, botAction, createGeneratedGame, prepareAction, DEFAULT_GAME_SETTINGS,
} from './src/index';
import { TERRAIN_COSTS } from './src/constants/Config';

const SEED = process.env.SEED ?? 'STD0FO';
const CLASSIC = process.env.CLASSIC === '1';
const MAP = process.env.MAP ?? 'fortress';

const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

const groundReach = (g: any, fromId: string, goalId: string) => {
  const size = g.gridSize;
  const idx = (x: number, y: number) => y * size + x;
  const start = g.mapData.find((t: any) => t.id === fromId);
  const goal = g.mapData.find((t: any) => t.id === goalId);
  if (!start || !goal) return { reachable: false, dist: -1 };
  const dist = new Int32Array(size * size).fill(-1);
  const q: number[] = [idx(start.x, start.y)];
  dist[idx(start.x, start.y)] = 0;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % size, cy = (cur - cx) / size;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const ni = idx(nx, ny);
      if (dist[ni] !== -1) continue;
      if (nx === goal.x && ny === goal.y) return { reachable: true, dist: dist[cur] + 1 };
      const t = g.mapData[ni];
      if (!t || t.hazardState === 'LAVA' || (TERRAIN_COSTS[t.type] ?? 99) >= 90) continue;
      dist[ni] = dist[cur] + 1;
      q.push(ni);
    }
  }
  return { reachable: false, dist: -1 };
};

let g: any = createGeneratedGame({
  ...DEFAULT_GAME_SETTINGS,
  mapSeed: SEED,
  mapGen: { preset: MAP },
  victoryMode: 'CONQUER',
  aiDifficulty: 'HARD',
  mutators: { classicCp: CLASSIC, scarcity: false, ironman: false },
} as any);

const trace: string[] = [];
const typeCounts: Record<string, number> = {};
let guard = 0;
let seat = g.currentPlayer;
let turnActions = 0;
let turnTypes: string[] = [];

while (g.winner === null && guard < 4000) {
  const cur = g.currentPlayer;
  const proposed: any = botAction(g, 'HARD');
  const prep = prepareAction(g, cur, proposed);
  const action: any = prep.ok ? prep.action : { type: 'END_TURN' };
  if (action.type === 'END_TURN') {
    if (turnTypes.length > 0) {
      trace.push(`R${g.totalTurns} P${cur} [${g.playerCp[cur]}cp] ${turnTypes.join(', ')}`);
      if (trace.length > 60) trace.shift();
    }
    turnTypes = [];
  } else {
    const u = g.units.find((x: any) => x.id === (action.unitId ?? action.attackerId));
    const dest = action.targetTileId ?? action.tileId ?? action.targetUnitId ?? '';
    turnTypes.push(`${action.type}${u ? `(${u.type[0]}@${u.tileId}->${dest})` : `(${dest})`}`);
    typeCounts[action.type] = (typeCounts[action.type] ?? 0) + 1;
  }
  const res = applyAction(g, action, { autoBankReward: true });
  if (res.rejected) {
    const end = applyAction(g, { type: 'END_TURN' }, { autoBankReward: true });
    g = end.state;
  } else g = res.state;
  guard++;
}

const hq = (owner: number) => g.mapData.find((t: any) => t.type === 'BASE' && t.owner === owner);
console.log(`seed=${SEED} map=${MAP} rounds=${g.totalTurns} actions=${guard} winner=${g.winner}`);
console.log(`type counts over whole match:`, typeCounts);
console.log(`HQs: P0 ${hq(0)?.hp}hp @${hq(0)?.id} | P1 ${hq(1)?.hp}hp @${hq(1)?.id}`);
console.log(`CP now: ${JSON.stringify(g.playerCp)}  gold: ${JSON.stringify(g.playerGold)}`);
console.log('\nsurviving units:');
for (const u of g.units) {
  const enemyHq = hq(u.owner === 0 ? 1 : 0);
  const reach = enemyHq ? groundReach(g, u.tileId, enemyHq.id) : { reachable: false, dist: -1 };
  console.log(
    `  P${u.owner} ${u.type} @${u.tileId} hp${u.hp} ammo${u.ammo} rank${u.rank ?? 0} ` +
    `moved=${u.hasMoved} done=${u.completed} ow=${u.isOverwatching} rooted=${u.isRooted} ` +
    `-> enemy HQ reachable=${reach.reachable} dist=${reach.dist}`,
  );
}
console.log('\nlast turns:');
for (const line of trace.slice(-25)) console.log('  ' + line);
