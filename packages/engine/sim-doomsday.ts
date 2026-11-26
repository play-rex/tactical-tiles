/**
 * Deathmatch + Doomsday pacing sim.
 *
 * Runs real HARD bot matches through prepareAction -> applyAction and reports, per player count:
 * median / quartiles of match length, how often the current round-30 trigger is ever reached,
 * and what happens with earlier trigger candidates.
 *
 * Run: GAMES=60 bun sim-doomsday.ts
 *      GAMES=40 STARTS=30,20,15,12,10 bun sim-doomsday.ts
 */
import {
  applyAction,
  botAction,
  createGeneratedGame,
  prepareAction,
  DEFAULT_GAME_SETTINGS,
} from './src/index';
import type { GameAction, GameSettings, GameState } from './src/index';

const GAMES = Number(process.env.GAMES ?? 60);
const CAP = Number(process.env.CAP ?? 20000);
const COUNTS = (process.env.PLAYERS ?? '2,3,4').split(',').map(Number);
const NO_DOOMSDAY = process.env.NO_DOOMSDAY === '1';
/** DEFAULT=1 exercises the shipped player-count table instead of an explicit override. */
const DEFAULT_START = process.env.DEFAULT === '1';
const ARMS: (number | null)[] = NO_DOOMSDAY || DEFAULT_START
  ? [null]
  : (process.env.STARTS ?? '30')
      .split(',')
      .map(Number)
      .filter(n => Number.isFinite(n) && n > 0);

interface Result {
  players: number;
  start: number | null;
  seed: string;
  winner: number | 'DRAW' | null;
  rounds: number;
  actions: number;
  sawLava: boolean;
  firstLavaRound: number | null;
  activeAtEnd: number;
  final: GameState;
}

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

const settingsFor = (players: number, seed: string, start: number | null): GameSettings => ({
  ...DEFAULT_GAME_SETTINGS,
  playerCount: players,
  unitCounts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
  dynamicWeather: true,
  fogOfWar: false,
  victoryMode: 'DEATHMATCH',
  doomsdayEnabled: !NO_DOOMSDAY,
  ...(start === null ? {} : { doomsdayStartTurn: start }),
  aiDifficulty: 'HARD',
  mapSeed: seed,
  mapGen: { preset: 'balanced' },
} as GameSettings);

const playOne = (players: number, start: number | null, seed: string): Result => {
  let game: GameState = createGeneratedGame(settingsFor(players, seed, start));
  let actions = 0;
  let sawLava = false;
  let firstLavaRound: number | null = null;

  while (game.winner === null && actions < CAP) {
    const seat = game.currentPlayer;
    const proposed = botAction(game, 'HARD') as GameAction;
    const prep = prepareAction(game, seat, proposed);
    const action: GameAction = prep.ok ? prep.action : { type: 'END_TURN' };
    const res = applyAction(game, action, { autoBankReward: true });
    game = res.rejected
      ? applyAction(game, { type: 'END_TURN' }, { autoBankReward: true }).state
      : res.state;
    actions++;

    if (!sawLava && game.mapData.some(t => t.hazardState === 'LAVA')) {
      sawLava = true;
      firstLavaRound = game.totalTurns;
    }
  }

  return {
    players,
    start,
    seed,
    winner: game.winner,
    rounds: game.totalTurns,
    actions,
    sawLava,
    firstLavaRound,
    activeAtEnd: Object.values(game.playerStatus).filter(s => s === 'ACTIVE').length,
    final: game,
  };
};

const armLabel = (start: number | null) =>
  start === null ? (NO_DOOMSDAY ? 'NO DOOMSDAY' : 'SHIPPED DEFAULT') : `START ${start}`;
const all: Result[] = [];

for (const players of COUNTS) {
  for (const start of ARMS) {
    for (let i = 0; i < GAMES; i++) {
      const seed = `DD${players}P-${i}`;
      all.push(playOne(players, start, seed));
    }
  }
}

console.log(`\nDeathmatch pacing — ${GAMES} matches per arm, HARD bots, balanced maps, CAP ${CAP}`);
console.log('players  arm           median  p25–p75     mean   min–max   draws  lava reached  median first lava');
for (const players of COUNTS) {
  for (const start of ARMS) {
    const rs = all.filter(r => r.players === players && r.start === start);
    const rounds = rs.map(r => r.rounds);
    const draws = rs.filter(r => r.winner === 'DRAW').length;
    const stalled = rs.filter(r => r.winner === null).length;
    const lava = rs.filter(r => r.sawLava);
    const firstLava = lava.map(r => r.firstLavaRound ?? 0);
    console.log(
      `${String(players).padEnd(8)} ${armLabel(start).padEnd(13)} ` +
        `${quantile(rounds, 0.5).toFixed(1).padStart(6)}  ` +
        `${quantile(rounds, 0.25).toFixed(0)}–${quantile(rounds, 0.75).toFixed(0)}`.padEnd(11) +
        ` ${(rounds.reduce((a, b) => a + b, 0) / Math.max(1, rounds.length)).toFixed(1).padStart(6)}  ` +
        `${Math.min(...rounds)}–${Math.max(...rounds)}`.padEnd(9) +
        ` ${String(draws + stalled).padStart(4)}  ${String(lava.length).padStart(3)}/${rs.length}` +
        `        ${firstLava.length ? quantile(firstLava, 0.5).toFixed(0) : '—'}`,
    );
  }
}

if (!NO_DOOMSDAY) {
  console.log('\nShare of matches that reach each trigger round (same seeds):');
  for (const players of COUNTS) {
    const rows = all.filter(r => r.players === players && r.start === ARMS[0]);
    const marks = [8, 10, 12, 14, 16, 18, 20, 24, 30];
    console.log(
      `  ${players}P: ` +
        marks.map(m => `R${m} ${Math.round((rows.filter(r => r.rounds >= m).length / Math.max(1, rows.length)) * 100)}%`).join(' · '),
    );
  }
}

console.log('\nWin split by seat for each arm:');
for (const players of COUNTS) {
  for (const start of ARMS) {
    const rs = all.filter(r => r.players === players && r.start === start);
    const wins = Array.from({ length: players }, (_, pid) => rs.filter(r => r.winner === pid).length);
    console.log(`  ${players}P ${armLabel(start).padEnd(13)} ${wins.map((w, i) => `P${i + 1}:${w}`).join('  ')}  draws:${rs.filter(r => r.winner === 'DRAW').length}  stalls:${rs.filter(r => r.winner === null).length}`);
  }
}

if (process.env.DEBUG === '1') {
  console.log('\nLong 4P games:');
  const long = all.filter(r => r.players === 4 && r.rounds > 40).slice(0, 8);
  for (const r of long) {
    const z = r.final.doomsdayZone;
    const lava = r.final.mapData.filter(t => t.hazardState === 'LAVA').length;
    const units = r.final.units.map(u => `${u.owner}:${u.type}@${u.tileId}`).join(' ');
    console.log({
      seed: r.seed,
      rounds: r.rounds,
      winner: r.winner,
      center: z?.center,
      start: z?.startTurn,
      end: z?.endTurn,
      lava,
      statuses: r.final.playerStatus,
      units,
    });
  }
}

if (process.env.CENTERS === '1') {
  const centers = all
    .filter(r => r.players === 4)
    .map(r => r.final.doomsdayZone?.center)
    .filter((c): c is { x: number; y: number } => !!c);
  const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  console.log('\n4P Doomsday centres:');
  console.log(centers.map(key).join('  '));
  console.log(`unique=${new Set(centers.map(key)).size}/${centers.length}`);
}
