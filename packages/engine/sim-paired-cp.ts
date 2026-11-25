/**
 * Paired CP A/B — the controlled version of the CP economy comparison.
 *
 * sim-playtest.ts gives every cell its own seed set, which is right for breadth but leaves the
 * CP20-vs-CP30 gap open to "maybe those boards were just better". This runs both economies on
 * the SAME board and the same seat order, so the only difference is the battery.
 *
 * Run: cd packages/engine && bun sim-paired-cp.ts
 *      PAIRS=40 PAIR_PLAYERS=2,4,6 bun sim-paired-cp.ts
 */
import {
  applyAction,
  botAction,
  createGeneratedGame,
  getUnitOptions,
  prepareAction,
  visibleSet,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import { CP_SYSTEM } from './src/constants/Config';

const PAYOFF = new Set([
  'hit', 'killed', 'structureHit', 'heist', 'promotion', 'mineBlast',
  'capture', 'build', 'supplyLanded',
]);

interface Result {
  rounds: number;
  turns: number;
  deadTurns: number;
  payoff: number;
  impactTurns: number;
  stall: boolean;
  winner: number | 'DRAW' | null;
}

interface Economy { label: string; maxCp: number; regen: number; p1: number }
const ECONOMIES: Economy[] = [
  { label: '20/+10', maxCp: 20, regen: 10, p1: 15 },
  { label: '30/+15', maxCp: 30, regen: 15, p1: 22 },
];

const play = (players: number, economy: Economy, seed: string): Result => {
  CP_SYSTEM.MAX_CP = economy.maxCp;
  CP_SYSTEM.REGEN_AMOUNT = economy.regen;
  CP_SYSTEM.P1_ROUND1_CP = economy.p1;
  let g = createGeneratedGame({
    ...DEFAULT_GAME_SETTINGS,
    playerCount: players,
    mapSeed: seed,
    mapGen: { preset: 'balanced' },
    mutators: { classicCp: false, scarcity: false, ironman: false },
  });
  const cap = players <= 2 ? 4000 : 6000;
  let actions = 0;
  const r: Result = { rounds: 0, turns: 0, deadTurns: 0, payoff: 0, impactTurns: 0, stall: false, winner: null };
  let seat = -1;
  let turnPayoff = 0;

  while (g.winner === null && actions < cap) {
    const cur = g.currentPlayer;
    if (cur !== seat) {
      if (seat !== -1) {
        r.turns++;
        if (turnPayoff === 0) r.deadTurns++;
        turnPayoff = 0;
      }
      seat = cur;
      // Turn-opening agency, same definition as sim-playtest.ts.
      const vis = visibleSet(g, cur);
      let impact = 0;
      for (const u of g.units.filter(u => u.owner === cur && !u.completed)) {
        const o = getUnitOptions(g, u, vis);
        impact += o.attackTargets.length + o.siegeTiles.length + o.secureTiles.length + o.lootTiles.length;
      }
      if (impact >= 2) r.impactTurns++;
    }

    const prep = prepareAction(g, cur, botAction(g, 'HARD'));
    const action = prep.ok ? prep.action : ({ type: 'END_TURN' } as const);
    const res = applyAction(g, action, { autoBankReward: true });
    if (res.rejected) {
      g = applyAction(g, { type: 'END_TURN' }, { autoBankReward: true }).state;
    } else {
      for (const e of res.events) {
        if (PAYOFF.has(e.kind)) {
          r.payoff++;
          turnPayoff++;
        }
      }
      g = res.state;
    }
    actions++;
  }
  r.turns++;
  if (turnPayoff === 0) r.deadTurns++;
  r.rounds = g.totalTurns;
  r.winner = g.winner;
  r.stall = g.winner === null;
  return r;
};

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const PAIRS = Number(process.env.PAIRS ?? 24);
const PLAYERS = (process.env.PAIR_PLAYERS ?? '2,4,6').split(',').map(Number);

console.log(`${PAIRS} pairs per seat count, identical boards, HARD/HARD, balanced preset\n`);
console.log('seats  economy   medR  dead%  pay/t  2+opt%  stalls  win split');

for (const players of PLAYERS) {
  const arms = Object.fromEntries(ECONOMIES.map(e => [e.label, [] as Result[]]));
  for (let i = 0; i < PAIRS; i++) {
    const seed = `PAIR${players}${String(i).padStart(4, '0')}XY`;
    for (const economy of ECONOMIES) arms[economy.label].push(play(players, economy, seed));
  }
  for (const [label, all] of Object.entries(arms)) {
    const done = all.filter(x => !x.stall);
    const turns = done.reduce((s, x) => s + x.turns, 0) || 1;
    const wins = Array.from({ length: players }, (_, seat) => done.filter(x => x.winner === seat).length);
    console.log(
      String(players).padStart(5) +
        `  ${label.padEnd(8)}` +
        String(median(done.map(x => x.rounds))).padStart(5) +
        `${((100 * done.reduce((s, x) => s + x.deadTurns, 0)) / turns).toFixed(0)}%`.padStart(7) +
        (done.reduce((s, x) => s + x.payoff, 0) / turns).toFixed(2).padStart(7) +
        `${((100 * done.reduce((s, x) => s + x.impactTurns, 0)) / turns).toFixed(0)}%`.padStart(8) +
        String(all.filter(x => x.stall).length).padStart(8) +
        `  ${wins.map(w => `${w}`).join('/')}`,
    );
  }
}
