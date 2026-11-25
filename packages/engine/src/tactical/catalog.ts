/**
 * The tactical weapon shop list. Rarity is also the unlock round: a Common can be bought from
 * round 2, a Rare from round 5, an Epic from round 10. Each weapon acts immediately, counts as
 * the seat's one tactical for that round, and enters a 3-round individual cooldown.
 */
import { TACTICAL_TIERS } from '../constants/Config';
import type { GameState } from '../game/state';
import type { TacticalId, Unit } from '../types';

/** Strict non-lethal floor: Tactical Weapons can never drop a unit below 2 HP. */
export const TACTICAL_MIN_HP_FLOOR = 2;

/** Percentage of target CURRENT HP dealt by each damaging Tactical Weapon (floored at 2 HP). */
export const TACTICAL_DAMAGE_PCT = {
  RECON_DRONE: 0.4,
  PRECISION_STRIKE: 0.75,
  CARPET_RUN: 0.5,
  ARTILLERY_BARRAGE: 0.5,
  NAPALM_DROP: 0.4,
  NAPALM_BURN: 0.2,
  /** Per-line cap in percentage points (40% drop + 20% burn = 60%). */
  NAPALM_CAP_PCT_POINTS: 60,
  NAPALM_DROP_PCT_POINTS: 40,
  NAPALM_BURN_PCT_POINTS: 20,
} as const;

export const tacticalDamagePctFor = (itemKey: TacticalId): number => {
  switch (itemKey) {
    case 'PRECISION_STRIKE':
      return TACTICAL_DAMAGE_PCT.PRECISION_STRIKE;
    case 'CARPET_RUN':
      return TACTICAL_DAMAGE_PCT.CARPET_RUN;
    case 'ARTILLERY_BARRAGE':
      return TACTICAL_DAMAGE_PCT.ARTILLERY_BARRAGE;
    case 'RECON_DRONE':
      return TACTICAL_DAMAGE_PCT.RECON_DRONE;
    case 'NAPALM_LINE':
      return TACTICAL_DAMAGE_PCT.NAPALM_DROP;
    default:
      return 0;
  }
};

/**
 * Computes exact non-lethal Tactical Weapon damage (`% of current HP`, strict min 2 HP floor).
 * Units already at 1–2 HP take 0 DMG and are never healed or killed by Tactical Weapons.
 */
export const computeTacticalPercentDamage = (
  unit: Pick<Unit, 'hp'>,
  pct: number,
): { raw: number; dealt: number; hpAfter: number; atFloor: boolean } => {
  const maxAllowed = Math.max(0, unit.hp - TACTICAL_MIN_HP_FLOOR);
  if (maxAllowed <= 0 || pct <= 0) {
    return { raw: 0, dealt: 0, hpAfter: unit.hp, atFloor: unit.hp <= TACTICAL_MIN_HP_FLOOR };
  }
  const raw = Math.max(1, Math.round(unit.hp * pct));
  const dealt = Math.min(raw, maxAllowed);
  return { raw, dealt, hpAfter: unit.hp - dealt, atFloor: false };
};

export type TacticalTier = keyof typeof TACTICAL_TIERS;
export type TacticalTierOrder = 'COMMON' | 'RARE' | 'EPIC';

/** What the player has to point at when buying. */
export type TacticalShape = 'NONE' | 'TILE' | 'UNIT' | 'UNITS3' | 'RELOCATE' | 'LINE4' | 'LANE' | 'ZONE3';

export interface TacticalDef {
  name: string;
  tier: TacticalTier;
  cost: number;
  shape: TacticalShape;
  /** True when the weapon only applies in Fog of War matches (hidden otherwise). */
  fogOnly?: boolean;
  /** One-line shop copy, also used as the button tooltip. */
  blurb: string;
}

export const TACTICAL_TIER_ORDER: TacticalTierOrder[] = ['COMMON', 'RARE', 'EPIC'];

export const TACTICAL_ITEMS: Record<TacticalId, TacticalDef> = {
  MINEFIELD_SNAPSHOT: {
    name: 'Minefield Snapshot',
    tier: 'COMMON',
    cost: 75,
    shape: 'NONE',
    blurb: 'Reveal every enemy land mine for one round. Private to you.',
  },
  RECON_DRONE: {
    name: 'Hunter Drone',
    tier: 'COMMON',
    cost: 100,
    shape: 'UNIT',
    blurb: 'Instant 40% current HP drone strike (min 2 HP) onto one visible enemy unit. In Fog mode, leaves a 3-round sensor.',
  },
  SMOKE_SCREEN: {
    name: 'Smoke Screen',
    tier: 'COMMON',
    cost: 120,
    shape: 'ZONE3',
    blurb: '3×3 smoke for 2 rounds. Blocks sniping and Overwatch both ways; not movement or fog.',
  },
  RADAR_SWEEP: {
    name: 'Radar Sweep',
    tier: 'RARE',
    cost: 150,
    shape: 'NONE',
    fogOnly: true,
    blurb: 'Fog of War only: see every enemy unit for one round. Public: the table is told.',
  },
  PRECISION_STRIKE: {
    name: 'Precision Strike',
    tier: 'RARE',
    cost: 175,
    shape: 'UNIT',
    blurb: 'Instant 75% current HP orbital JDAM strike (min 2 HP) onto one visible enemy unit.',
  },
  SABOTAGE: {
    name: 'Sabotage',
    tier: 'RARE',
    cost: 175,
    shape: 'TILE',
    blurb: 'Click an enemy HQ base to drain 8 CP from that player, or strip a specialized enemy building.',
  },
  NAPALM_LINE: {
    name: 'Napalm Line',
    tier: 'RARE',
    cost: 250,
    shape: 'LINE4',
    blurb: 'Instant 40% current HP drop + 4 tiles burn for 2 rounds (20% on entry/round-end, cap 60%, min 2 HP). Friendly fire on.',
  },
  PARADROP: {
    name: 'Paradrop',
    tier: 'RARE',
    cost: 250,
    shape: 'RELOCATE',
    blurb: 'Airlift any visible unit (yours or an enemy) to open ground. Enemies cannot drop onto traps, fire, or HQ range.',
  },
  CARPET_RUN: {
    name: 'Carpet Run',
    tier: 'EPIC',
    cost: 275,
    shape: 'UNITS3',
    blurb: 'Instant 50% current HP guided bomber strikes (min 2 HP) onto up to 3 distinct visible enemy units.',
  },
  ARTILLERY_BARRAGE: {
    name: 'Artillery Barrage',
    tier: 'EPIC',
    cost: 300,
    shape: 'LANE',
    blurb: 'Instant 50% current HP (min 2 HP) across a 2×10 corridor & demolishes barriers. Friendly fire on; avoids HQs.',
  },
  OVERCLOCK_CORE: {
    name: 'Overclock Core',
    tier: 'EPIC',
    cost: 300,
    shape: 'NONE',
    blurb: 'Your next three attacks each refund 2 CP, never above the battery cap.',
  },
};

export const TACTICAL_IDS = Object.keys(TACTICAL_ITEMS) as TacticalId[];

export const tacticalUnlockRound = (itemKey: TacticalId): number =>
  TACTICAL_TIERS[TACTICAL_ITEMS[itemKey].tier];

export const currentRoundOf = (state: Pick<GameState, 'totalTurns'>): number =>
  state.totalTurns + 1;

/** Remaining cooldown rounds for `itemKey` on `seat` (0 means ready to fire). */
export const tacticalCooldownLeft = (
  state: Pick<GameState, 'totalTurns' | 'tacticalCooldowns'>,
  seat: number,
  itemKey: TacticalId,
): number => {
  const readyRound = state.tacticalCooldowns?.[seat]?.[itemKey] ?? 0;
  return Math.max(0, readyRound - currentRoundOf(state));
};

/** How many free Tactical Supply Crate vouchers `seat` holds for `itemKey`. */
export const tacticalVoucherCount = (
  state: Pick<GameState, 'playerTacticalVouchers'>,
  seat: number,
  itemKey: TacticalId,
): number => (state.playerTacticalVouchers?.[seat] ?? []).filter(id => id === itemKey).length;

export const hasTacticalVoucher = (
  state: Pick<GameState, 'playerTacticalVouchers'>,
  seat: number,
  itemKey: TacticalId,
): boolean => tacticalVoucherCount(state, seat, itemKey) > 0;

/** True specifically for the round-2 starter free Common pick (not a supply-crate voucher). */
export const tacticalIsRound2StarterFree = (
  state: Pick<GameState, 'totalTurns' | 'freeTacticalRound'>,
  seat: number,
  itemKey: TacticalId,
): boolean =>
  currentRoundOf(state) === 2 &&
  TACTICAL_ITEMS[itemKey].tier === 'COMMON' &&
  (state.freeTacticalRound?.[seat] ?? 0) !== 2;

/**
 * True when `itemKey` costs €0 for `seat` — either via a looted Tactical Supply Crate voucher
 * or the round-2 starter free Common pick.
 */
export const tacticalIsFree = (
  state: Pick<GameState, 'totalTurns' | 'freeTacticalRound' | 'playerTacticalVouchers'>,
  seat: number,
  itemKey: TacticalId,
): boolean =>
  hasTacticalVoucher(state, seat, itemKey) || tacticalIsRound2StarterFree(state, seat, itemKey);

export const tacticalPriceFor = (
  state: Pick<GameState, 'totalTurns' | 'freeTacticalRound' | 'playerTacticalVouchers'>,
  seat: number,
  itemKey: TacticalId,
): number => (tacticalIsFree(state, seat, itemKey) ? 0 : TACTICAL_ITEMS[itemKey].cost);
