import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameEvent, Tile, Unit } from '@tactical/engine';
import {
  FILM_MAX_SCENES,
  HighlightRecorder,
  highlightCast,
  type MatchHighlight,
} from '../graphics/highlightRecorder';
import { RecapPlayer, type FilmScene, type RecapBridge, type RecapStatus } from '../graphics/recapPlayer';

const unit = (id: string, owner = 0): Unit =>
  ({ id, type: 'SOLDIER', owner, tileId: '1,1', hp: 10, maxHp: 10, ammo: 3, maxAmmo: 3, xp: 0, rank: 0, kills: 0, damageDealt: 0, hasMoved: false, completed: false }) as unknown as Unit;

const tile = { id: '1,1', x: 1, y: 1, type: 'PLAINS', height: 1 } as unknown as Tile;

const killBatch = (victim: string, killer: string, rank = 0, winning = false): GameEvent[] => [
  { kind: 'hit', targetUnitId: victim, at: { x: 1, y: 1 }, from: { x: 2, y: 1 }, damage: 12, weapon: 'SNIPER', isKill: true },
  {
    kind: 'killed',
    unitId: victim,
    unitType: 'SOLDIER',
    owner: 0,
    rank,
    at: { x: 1, y: 1 },
    killerUnitId: killer,
    killerOwner: 1,
    cause: 'COMBAT',
    victimPreHp: 12,
    ...(winning ? { isMatchWinning: true } : {}),
  },
];

const recordKill = (
  recorder: HighlightRecorder,
  turn: number,
  victim: string,
  killer: string,
  rank = 0,
  winning = false,
) =>
  recorder.record({
    turn,
    seed: 'SEED',
    preUnits: [unit(victim), unit(killer, 1)],
    preMapData: [tile],
    postUnits: [unit(killer, 1)],
    postMapData: [tile],
    events: killBatch(victim, killer, rank, winning),
  });

const scene = (turn: number, victim: string, killer: string): FilmScene => ({
  headline: 'ELIMINATED',
  turn,
  preUnits: [unit(victim), unit(killer, 1)],
  preMapData: [tile],
  postUnits: [unit(killer, 1)],
  postMapData: [tile],
  events: killBatch(victim, killer),
});

test('getFilm cuts the reel into one feud, first shot to last, across turns and seats', () => {
  const recorder = new HighlightRecorder();
  recordKill(recorder, 3, 'u_a', 'u_b');
  recordKill(recorder, 7, 'u_c', 'u_b', 3, true); // the anchor: ace down on the match-winning beat
  recordKill(recorder, 9, 'u_a', 'u_c');
  recordKill(recorder, 8, 'u_x', 'u_y'); // unrelated fight, outside the feud

  const best = recorder.getBest();
  assert.equal(best?.turn, 7, 'the scoreboard still gets the single highest-drama moment');

  const film = recorder.getFilm();
  assert.ok(film);
  assert.equal(film.score, best?.score ?? -1);
  assert.deepEqual(
    film.scenes.map(s => s.turn),
    [3, 7, 9],
    'the feud plays chronologically even though its scenes are turns apart',
  );
  assert.deepEqual(film.cast.sort(), ['u_b', 'u_c'], 'cast is both sides of the anchor, not the victim alone');
  assert.ok(film.scenes.some(s => s.events.some(e => e.kind === 'killed' && e.unitId === 'u_c')));
});

test('a reel caps at FILM_MAX_SCENES and never drops its anchor', () => {
  const recorder = new HighlightRecorder();
  for (let i = 0; i < 8; i++) recordKill(recorder, 10 + i, `u_a${i}`, 'u_b');
  const anchor = recorder.getBest();
  const film = recorder.getFilm();
  assert.ok(film && anchor);
  assert.equal(film.scenes.length, FILM_MAX_SCENES);
  assert.ok(film.scenes.includes(anchor), 'the highest-drama beat is always in the cut');
  const turns = film.scenes.map(s => s.turn);
  assert.deepEqual(turns, [...turns].sort((a, b) => a - b), 'the cut is ordered chronologically');
});

test('highlightCast links both sides of a shot, so a kill and its killer share a scene', () => {
  const sample: MatchHighlight = {
    score: 18,
    turn: 1,
    headline: 'ELIMINATED',
    seed: 'SEED',
    preUnits: [],
    preMapData: [],
    postUnits: [],
    postMapData: [],
    events: killBatch('u_a', 'u_b'),
  };
  assert.deepEqual(highlightCast(sample).sort(), ['u_a', 'u_b']);
});

test('startFilm plays every scene in order, then restores the live board', { timeout: 8000 }, async () => {
  const player = new RecapPlayer();
  const calls: string[] = [];
  const steps: number[] = [];
  const bridge: RecapBridge = {
    applyDisplaySnapshot: (units, mapData) => calls.push(`snap:${units[0]?.id ?? 'none'}:${mapData?.length ?? 0}`),
    restoreLiveState: () => calls.push('restore'),
    dispatchEvents: (events) => calls.push(`events:${events[0].kind}`),
  };

  player.subscribe((status: RecapStatus) => {
    if (status.active && status.kind === 'FILM') steps.push(status.step);
  });

  await new Promise<void>(resolve => {
    player.startFilm([scene(3, 'u_a', 'u_b'), scene(9, 'u_c', 'u_d')], bridge, resolve);
  });

  assert.deepEqual(steps, [1, 2], 'each cut reports its place in the reel');
  assert.deepEqual(calls, [
    'snap:u_a:1',
    'events:hit',
    'snap:u_b:1',
    'snap:u_c:1',
    'events:hit',
    'snap:u_d:1',
    'restore',
  ]);
  assert.equal(player.isActive(), false, 'the reel releases the board for the results modal');
  assert.equal(player.getStatus().kind, null);
});
