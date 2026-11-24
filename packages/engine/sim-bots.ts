/** Bot-match simulator: plays N full bot-vs-bot games and reports faults like a game tester.
 * Run: bun sim-bots.ts   (from packages/engine)
 */
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import type { GameAction, GameState } from './src/index';

const MAX_ACTIONS = 4000;

const DIRS4 = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
function groundDist(game: GameState, fromId: string, goalId: string, allowMountain: boolean): number {
  const { mapData, gridSize } = game;
  const dist = new Int32Array(gridSize * gridSize).fill(-1);
  const goal = mapData.find(t => t.id === goalId);
  if (!goal || goal.hazardState === 'LAVA') return -1;
  dist[goal.y * gridSize + goal.x] = 0;
  const q = [goal.y * gridSize + goal.x];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % gridSize, cy = (cur / gridSize) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
      const nIdx = ny * gridSize + nx;
      if (dist[nIdx] !== -1) continue;
      const t = mapData[nIdx];
      if (!t || t.hazardState === 'LAVA' || t.type === 'WATER' || t.type === 'CANYON' || t.type === 'BARRIER' || t.type === 'BUILDING' || (!allowMountain && t.type === 'MOUNTAIN')) continue;
      dist[nIdx] = dist[cur] + 1;
      q.push(nIdx);
    }
  }
  const from = mapData.find(t => t.id === fromId);
  return from ? dist[from.y * gridSize + from.x] : -1;
}

interface GameReport {
  seed: string;
  diff: string;
  winner: number | 'DRAW' | null;
  turns: number;
  actions: number;
  rejects: string[];
  heists: number;
  tunnels: number;
  vaultsBreached: number;
  sniperVaultAttempts: number;
  bankSieges: number;
  stalled: boolean;
  crashed: string | null;
  negGold: boolean;
  stuckPending: boolean;
  final: GameState | null;
}

function playOne(seed: string, d0: 'EASY' | 'MEDIUM' | 'HARD', d1: 'EASY' | 'MEDIUM' | 'HARD'): GameReport {
  const rep: GameReport = {
    seed, diff: `${d0}/${d1}`, winner: null, turns: 0, actions: 0, rejects: [],
    heists: 0, tunnels: 0, vaultsBreached: 0, sniperVaultAttempts: 0,
    bankSieges: 0, stalled: false, crashed: null, negGold: false, stuckPending: false,
    final: null,
  };
  let game: GameState;
  try {
    game = createGeneratedGame({ ...DEFAULT_GAME_SETTINGS, mapSeed: seed });
  } catch (e) {
    rep.crashed = `setup: ${e instanceof Error ? e.message : String(e)}`;
    return rep;
  }
  try {
    let actions = 0;
    while (game.winner === null && actions < MAX_ACTIONS) {
      const seat = game.currentPlayer;
      const proposed = botAction(game, seat === 0 ? d0 : d1) as GameAction;
      // Fault probe: sniper ordered to siege a vault (rules forbid it)
      if (proposed.type === 'SIEGE') {
        const tar = game.mapData.find(t => t.id === (proposed as { tileId: string }).tileId);
        const att = game.units.find(u => u.id === (proposed as { unitId: string }).unitId);
        if (tar?.type === 'BANK') {
          rep.bankSieges++;
          if (att?.type === 'SNIPER') rep.sniperVaultAttempts++;
        }
      }
      const prepared = prepareAction(game, seat, proposed);
      let action: GameAction;
      if (prepared.ok) {
        action = prepared.action;
      } else {
        rep.rejects.push(`${proposed.type}: ${prepared.error}`);
        action = { type: 'END_TURN' };
      }
      const result = applyAction(game, action, { autoBankReward: true });
      if (result.rejected) {
        rep.rejects.push(`${action.type}: ${result.rejected}`);
        game = applyAction(game, { type: 'END_TURN' }, { autoBankReward: true }).state;
      } else {
        game = result.state;
      }
      actions++;
    }
    rep.actions = actions;
    rep.stalled = game.winner === null;
    rep.winner = game.winner;
    rep.turns = game.totalTurns;
    rep.heists = (game.matchStats[0]?.heists ?? 0) + (game.matchStats[1]?.heists ?? 0);
    rep.tunnels = game.mapData.filter(t => t.type === 'TUNNEL').length;
    rep.vaultsBreached = game.mapData.filter(t => t.type === 'BANK' && (t.hackProgress || 0) >= 100).length;
    rep.negGold = game.playerGold[0] < 0 || game.playerGold[1] < 0;
    rep.stuckPending = game.bankRewardPending !== null && game.bankRewardPending !== undefined;
    rep.final = game;
  } catch (e) {
    rep.crashed = `turn ${game!.totalTurns}: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`;
  }
  return rep;
}

const plans: Array<[string, 'EASY' | 'MEDIUM' | 'HARD', 'EASY' | 'MEDIUM' | 'HARD']> = [];
for (let i = 1; i <= 48; i++) plans.push([`SIM${i}`, 'HARD', 'HARD']);
for (let i = 1; i <= 12; i++) plans.push([`SIMM${i}`, 'MEDIUM', 'MEDIUM']);

const reports = plans.map(([s, a, b]) => playOne(s, a, b));

for (const r of reports) {
  console.log(
    `${r.seed} [${r.diff}] winner=${r.winner} turns=${r.turns} actions=${r.actions} ` +
    `heists=${r.heists} breached=${r.vaultsBreached} tunnels=${r.tunnels} ` +
    `bankSieges=${r.bankSieges} sniperVault=${r.sniperVaultAttempts} rejects=${r.rejects.length}` +
    (r.stalled ? ' STALLED' : '') + (r.crashed ? ` CRASH: ${r.crashed}` : '') +
    (r.negGold ? ' NEGGOLD' : '') + (r.stuckPending ? ' STUCKPENDING' : ''),
  );
}

const crashes = reports.filter(r => r.crashed);
const stalled = reports.filter(r => r.stalled);
const sniperVault = reports.reduce((n, r) => n + r.sniperVaultAttempts, 0);
const totalBankSieges = reports.reduce((n, r) => n + r.bankSieges, 0);
const totalHeists = reports.reduce((n, r) => n + r.heists, 0);
const totalTunnels = reports.reduce((n, r) => n + r.tunnels, 0);
const noBreach = reports.filter(r => r.vaultsBreached === 0).length;
  const p0Wins = reports.filter(r => r.winner === 0).length;
  const p1Wins = reports.filter(r => r.winner === 1).length;
  const draws = reports.filter(r => r.winner === 'DRAW').length;
const rejectKinds = new Map<string, number>();
for (const r of reports) for (const j of r.rejects) rejectKinds.set(j, (rejectKinds.get(j) ?? 0) + 1);
const topRejects = [...rejectKinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
const avgTurns = reports.reduce((n, r) => n + r.turns, 0) / reports.length;

console.log('\n--- FAULT REPORT ---');
console.log(`games=${reports.length} crashes=${crashes.length} stalled=${stalled.length} avgTurns=${avgTurns.toFixed(1)}`);
  console.log(`wins P0=${p0Wins} P1=${p1Wins} draws=${draws}`);
console.log(`total heists=${totalHeists} vaultsBreached(total)=${reports.reduce((n, r) => n + r.vaultsBreached, 0)} gamesWithZeroBreach=${noBreach}`);
console.log(`bank siege orders=${totalBankSieges} of which by snipers=${sniperVault}`);
console.log(`tunnels built=${totalTunnels}`);
console.log(`negGold games=${reports.filter(r => r.negGold).length} stuckPending games=${reports.filter(r => r.stuckPending).length}`);
console.log('top rejects:');
for (const [k, v] of topRejects) console.log(`  ${v}x ${k}`);
for (const r of stalled) {
  const g = r.final;
  const units = g?.units.map(u => {
    const foeHq = g.mapData.find(t => t.type === 'BASE' && t.owner !== u.owner);
    const d = foeHq ? groundDist(g, u.tileId, foeHq.id, u.type === 'SNIPER') : -1;
    return `${u.type}@${u.tileId}P${u.owner}(hqDist=${d})`;
  }).join(' ') || 'none';
  const hqs = g?.mapData.filter(t => t.type === 'BASE').map(t => `P${t.owner}@${t.id}:hp${t.hp}`).join(' ') || 'none';
  console.log(`stall forensics ${r.seed}: units=[${units}] hqs=[${hqs}]`);
}
