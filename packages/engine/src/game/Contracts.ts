/**
 * Phase 3 shared contracts.
 *
 * One contract per round, shared by the table, first completion only. The deck is tiered and
 * gated: a contract is only dealt when its round has arrived AND the board can actually support
 * it. "Destroy 3 units" is not hard at round 2, it is impossible — 30 CP buys two attacks and
 * the armies have not met. A contract nobody can finish is a dead HUD element, and a dead HUD
 * element teaches players to stop reading the HUD.
 */
import { getDoomsdayEscalation } from '../grid/DoomsdayManager';
import { createSeededRng } from '../utils/SeededRandom';
import type { ContractId, ContractTier, SharedContract, Unit } from '../types';
import type { GameState } from './state';

/** What just happened, in terms a contract can score. */
export type ContractEvent =
  | { kind: 'KILL'; victimRank: number; viaOverwatch: boolean; crossfire: boolean }
  | { kind: 'DAMAGE'; amount: number }
  | { kind: 'SECURE' }
  | { kind: 'HEIST' }
  | { kind: 'BARRIER_DESTROYED' };

export interface ContractDef {
  id: ContractId;
  name: string;
  tier: ContractTier;
  /** Earliest round this card can be dealt. */
  opens: number;
  requirement: string;
  target: number;
  cp: number;
  gold: number;
  /** The board must be able to support the contract. */
  board?: (state: GameState) => boolean;
  /** Optional restriction on who may claim it (needs a real army, not a lucky last shot). */
  claimableBy?: (units: Unit[], playerId: number) => boolean;
}

const aliveUnits = (state: GameState): number => state.units.length;

const hasKill = (state: GameState): boolean =>
  Object.values(state.matchStats ?? {}).some(s => (s.kills ?? 0) > 0);

const hasNeutralBuilding = (state: GameState): boolean =>
  state.mapData.some(t => t.type === 'BUILDING' && (t.owner === null || t.owner === undefined));

const hasOpenVault = (state: GameState): boolean =>
  state.mapData.some(t => t.type === 'BANK' && (t.hp ?? 0) > 0 && (t.hackProgress ?? 0) < 100);

const hasBarrier = (state: GameState): boolean =>
  state.mapData.some(t => t.type === 'BARRIER' && (t.hp ?? 0) > 0);

const hasElite = (state: GameState): boolean => state.units.some(u => (u.rank ?? 0) >= 2);

export const CONTRACTS: ContractDef[] = [
  {
    id: 'FIRST_BLOOD',
    name: 'First Blood',
    tier: 1,
    opens: 1,
    requirement: 'Score the first kill of the match',
    target: 1,
    cp: 4,
    gold: 0,
    board: state => !hasKill(state),
  },
  {
    id: 'LAND_GRAB',
    name: 'Land Grab',
    tier: 1,
    opens: 1,
    requirement: 'Secure a neutral building',
    target: 1,
    cp: 4,
    gold: 50,
    board: hasNeutralBuilding,
  },
  {
    id: 'SKIRMISH',
    name: 'Skirmish',
    tier: 1,
    opens: 1,
    requirement: 'Deal 10 damage with units',
    target: 10,
    cp: 4,
    gold: 0,
  },
  {
    id: 'BREAKTHROUGH',
    name: 'Breakthrough',
    tier: 2,
    opens: 4,
    requirement: 'Destroy an enemy unit',
    target: 1,
    cp: 6,
    gold: 0,
  },
  {
    id: 'VAULT_RACE',
    name: 'Vault Race',
    tier: 2,
    opens: 4,
    requirement: 'Complete a heist',
    target: 1,
    cp: 6,
    gold: 50,
    board: hasOpenVault,
  },
  {
    id: 'OVERWATCH_KILL',
    name: 'Overwatch Kill',
    tier: 2,
    opens: 5,
    requirement: 'Kill a unit with an Overwatch shot',
    target: 1,
    cp: 6,
    gold: 0,
  },
  {
    id: 'CROSSFIRE_KILL',
    name: 'Crossfire Kill',
    tier: 2,
    opens: 6,
    requirement: 'Kill a unit with Crossfire',
    target: 1,
    cp: 6,
    gold: 50,
    board: state => state.units.some(u => state.units.filter(o => o.owner === u.owner).length >= 3),
  },
  {
    id: 'DEMOLITION',
    name: 'Demolition',
    tier: 3,
    opens: 8,
    requirement: 'Destroy a barrier',
    target: 1,
    cp: 8,
    gold: 0,
    board: hasBarrier,
  },
  {
    id: 'ACE_HUNT',
    name: 'Ace Hunt',
    tier: 3,
    opens: 8,
    requirement: 'Kill an Elite or Ace',
    target: 1,
    cp: 8,
    gold: 75,
    board: hasElite,
  },
  {
    id: 'PURGE',
    name: 'Purge',
    tier: 3,
    opens: 10,
    requirement: 'Destroy 2 units',
    target: 2,
    cp: 8,
    gold: 0,
    board: state => aliveUnits(state) >= 6,
  },
  {
    id: 'WIPE',
    name: 'Wipe',
    tier: 3,
    opens: 14,
    requirement: 'Destroy 3 units',
    target: 3,
    cp: 10,
    gold: 100,
    board: state => aliveUnits(state) >= 8,
    claimableBy: (units, playerId) => units.filter(u => u.owner === playerId).length >= 4,
  },
];

export const CONTRACT_UNDERDOG_CP = 2;
export const CONTRACT_UNDERDOG_GOLD = 50;

/** A card stays live this many rounds, so a table has time to actually finish it. */
export const CONTRACT_DURATION_ROUNDS = 3;

export const contractDef = (id: ContractId): ContractDef | undefined =>
  CONTRACTS.find(c => c.id === id);

/** Progress this event makes toward the contract (0 when it is irrelevant). */
export const contractProgressFor = (id: ContractId, event: ContractEvent): number => {
  switch (id) {
    case 'FIRST_BLOOD':
    case 'BREAKTHROUGH':
    case 'PURGE':
    case 'WIPE':
      return event.kind === 'KILL' ? 1 : 0;
    case 'ACE_HUNT':
      return event.kind === 'KILL' && event.victimRank >= 2 ? 1 : 0;
    case 'OVERWATCH_KILL':
      return event.kind === 'KILL' && event.viaOverwatch ? 1 : 0;
    case 'CROSSFIRE_KILL':
      return event.kind === 'KILL' && event.crossfire ? 1 : 0;
    case 'SKIRMISH':
      return event.kind === 'DAMAGE' ? event.amount : 0;
    case 'LAND_GRAB':
      return event.kind === 'SECURE' ? 1 : 0;
    case 'VAULT_RACE':
      return event.kind === 'HEIST' ? 1 : 0;
    case 'DEMOLITION':
      return event.kind === 'BARRIER_DESTROYED' ? 1 : 0;
  }
};

const rngFor = (state: GameState, salt: string | number): (() => number) =>
  state.activeSeed ? createSeededRng(`${state.activeSeed}_contract_${salt}`) : Math.random;

/**
 * Picks the contract for a round, or null when the deck has nothing this board can support.
 * Higher tiers are preferred once they open, so the round reads as a story. A run of unclaimed
 * contracts drops the next deal one tier (a card the table could not finish should not be
 * replaced by its twin), and Doomsday Meltdown restricts the pool to the capstones.
 */
export const dealContract = (
  state: GameState,
  round: number,
  used: ContractId[],
  opts: { preferLowerTier?: boolean; rng?: () => number } = {},
): ContractDef | null => {
  const doomsdayActive = state.settings.victoryMode === 'DEATHMATCH' && Boolean(state.settings.doomsdayEnabled);
  const stage = getDoomsdayEscalation(round, doomsdayActive).stage;
  const eligible = CONTRACTS.filter(
    c => c.opens <= round && !used.includes(c.id) && (!c.board || c.board(state)),
  );
  if (eligible.length === 0) return null;

  const topTier = Math.max(...eligible.map(c => c.tier));
  let pool = eligible.filter(c => c.tier === topTier);
  if (opts.preferLowerTier) {
    const lower = eligible.filter(c => c.tier === topTier - 1);
    if (lower.length > 0) pool = lower;
  }
  if (stage === 'MELTDOWN') {
    const capstones = pool.filter(c => c.opens >= 10);
    if (capstones.length > 0) pool = capstones;
  }
  const rng = opts.rng ?? rngFor(state, round);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
};

export const toSharedContract = (def: ContractDef, round: number): SharedContract => ({
  id: def.id,
  tier: def.tier,
  round,
  claimedBy: null,
  rewardCp: def.cp,
  rewardGold: def.gold,
  target: def.target,
  expiresRound: round + CONTRACT_DURATION_ROUNDS - 1,
});

/** The round-1 contract, dealt as the game is created so the HUD is never empty. */
export const withOpeningContract = (state: GameState): GameState => {
  if (state.activeMission || state.settings.challengeId) return state;
  const def = dealContract(state, 1, [], { rng: rngFor(state, 1) });
  if (!def) return state;
  return {
    ...state,
    contract: toSharedContract(def, 1),
    contractsUsed: [def.id],
    contractMisses: 0,
    contractProgress: {},
  };
};

/** Seat with the weakest board: fewest living units, then least gold. -1 if none. */
export const lastPlaceSeat = (
  playerStatus: Record<number, string>,
  units: Unit[],
  playerGold: Record<number, number>,
): number => {
  let worst = -1;
  let worstUnits = Number.POSITIVE_INFINITY;
  let worstGold = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(playerStatus)) {
    const pid = Number(key);
    if (playerStatus[pid] !== 'ACTIVE') continue;
    const alive = units.filter(u => u.owner === pid).length;
    const gold = playerGold[pid] ?? 0;
    if (alive < worstUnits || (alive === worstUnits && gold < worstGold)) {
      worst = pid;
      worstUnits = alive;
      worstGold = gold;
    }
  }
  return worst;
};
