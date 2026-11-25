import type { PerkId, UnitType } from '../types';

export interface PerkDef {
  id: PerkId;
  name: string;
  /** One-line rule text shown on the promotion card. */
  blurb: string;
}

/** Each class offers exactly two perks at Veteran; the pick is permanent. */
export const PERKS_BY_CLASS: Record<UnitType, PerkDef[]> = {
  SOLDIER: [
    { id: 'RELAY', name: 'Relay', blurb: '+1 CP regen while alive' },
    { id: 'SKIRMISHER', name: 'Skirmisher', blurb: '+1 damage when firing from cover' },
  ],
  ASSAULTER: [
    { id: 'BULWARK', name: 'Bulwark', blurb: 'Adjacent allies take 1 less damage' },
    { id: 'SAPPER', name: 'Sapper', blurb: '+2 damage vs Barriers' },
  ],
  SNIPER: [
    { id: 'COLD_BORE', name: 'Cold Bore', blurb: '+2 damage if it has not moved' },
    { id: 'OVERWATCH_PLUS', name: 'Overwatch+', blurb: '+2 damage on Overwatch shots' },
  ],
};

export const PERK_LABELS: Record<PerkId, string> = {
  RELAY: 'Relay',
  SKIRMISHER: 'Skirmisher',
  BULWARK: 'Bulwark',
  SAPPER: 'Sapper',
  COLD_BORE: 'Cold Bore',
  OVERWATCH_PLUS: 'Overwatch+',
};

export const isPerkForClass = (type: UnitType, perk: PerkId): boolean =>
  PERKS_BY_CLASS[type].some(p => p.id === perk);
