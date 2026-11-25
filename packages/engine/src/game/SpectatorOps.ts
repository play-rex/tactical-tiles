/**
 * Eliminated players are not dead weight. On alternating rounds one eliminated seat holds a
 * "spectator attack" window and may nudge the map: a storm, a crate, a repair, a vault bump,
 * a levy. Effects are map-level or underdog-tilted, never aimed at a named player, and can
 * never kill a unit, damage a building or pay a bounty — an eliminated player can soften a
 * lane, not decide the match.
 */
import type { SpectatorEffectId } from '../types';
import type { GameState } from './state';
import { createSeededRng } from '../utils/SeededRandom';

export interface SpectatorEffectDef {
  id: SpectatorEffectId;
  name: string;
  blurb: string;
}

export const SPECTATOR_EFFECTS: SpectatorEffectDef[] = [
  {
    id: 'STATIC_STORM',
    name: 'Static Storm',
    blurb: '2 damage around a random empty tile. Cannot kill.',
  },
  {
    id: 'SUPPLY_DROP',
    name: 'Supply Drop',
    blurb: 'A supply crate lands on a random open tile.',
  },
  {
    id: 'REPAIR_SURGE',
    name: 'Repair Surge',
    blurb: "Last place's most damaged unit heals 5 HP.",
  },
  {
    id: 'BANK_BOOM',
    name: 'Bank Boom',
    blurb: 'Every unbreached vault gains €50.',
  },
  {
    id: 'WAR_LEVY',
    name: 'War Levy',
    blurb: 'Every surviving player gains €30.',
  },
];

export const SPECTATOR_FIRST_ROUND = 3;
export const SPECTATOR_WINDOW_EVERY = 2;

/** True on rounds 3, 5, 7, … — one window every two rounds, so the table gets breathing room. */
export const isSpectatorWindowRound = (round: number): boolean =>
  round >= SPECTATOR_FIRST_ROUND && (round - SPECTATOR_FIRST_ROUND) % SPECTATOR_WINDOW_EVERY === 0;

export const spectatorEffectDef = (id: SpectatorEffectId): SpectatorEffectDef | undefined =>
  SPECTATOR_EFFECTS.find(e => e.id === id);

/** The next round that can hold a window (3, 5, 7, …), strictly after `round`. */
export const nextSpectatorWindowRound = (round: number): number => {
  if (round < SPECTATOR_FIRST_ROUND) return SPECTATOR_FIRST_ROUND;
  return SPECTATOR_FIRST_ROUND + (Math.floor((round - SPECTATOR_FIRST_ROUND) / SPECTATOR_WINDOW_EVERY) + 1) * SPECTATOR_WINDOW_EVERY;
};

const hasOpenGround = (state: GameState): boolean =>
  state.mapData.some(
    t =>
      (t.type === 'PLAINS' || t.type === 'FOREST' || t.type === 'SAND' || t.type === 'DUNES') &&
      t.hazardState !== 'LAVA' &&
      !state.units.some(u => u.tileId === t.id),
  );

/**
 * What an AI seat fires when its window opens. Only effects the board can actually absorb are in
 * the pool, so a bot never burns its window on a guaranteed rejection; the pick is deterministic
 * per match, round and seat so a replay reads the same.
 */
export const chooseBotSpectatorEffect = (state: GameState, seat: number): SpectatorEffectId => {
  const rng = createSeededRng(`${state.activeSeed ?? 'local'}_bot_spectator_${state.totalTurns + 1}_${seat}`);
  const damaged = state.units.some(u => u.hp < (u.maxHp ?? u.hp));
  const openVault = state.mapData.some(
    t => t.type === 'BANK' && (t.hackProgress ?? 0) < 100 && (t.bankGoldReward ?? 0) > 0,
  );

  const pool: SpectatorEffectId[] = ['WAR_LEVY'];
  if (hasOpenGround(state)) pool.push('STATIC_STORM', 'SUPPLY_DROP');
  if (damaged) pool.push('REPAIR_SURGE');
  if (openVault) pool.push('BANK_BOOM');
  return pool[Math.floor(rng() * pool.length)];
};
