
export const DEFAULT_GRID_SIZE = 20; // Used for fallback/initialization
export const GRID_SIZE = DEFAULT_GRID_SIZE; // Alias for backward compatibility
export const TILE_SIZE = 64; // Pixels per tile

// Camera Constraints
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3.0;

export const BASE_STATS = {
  HP: 50,
  RANGE: 4,
  MIN_DMG: 3,
  MAX_DMG: 5,
  SPLASH_MIN_DMG: 2,
  SPLASH_MAX_DMG: 3
};

export const BANK_STATS = {
  RANGE: 2,
  DAMAGE: 4, // Flat damage for bank defense
  HP: 15 // Vault integrity: breached by siege, never by Snipers
};

export const BARRIER_STATS = {
  HP: 10,
  BUILD_COUNT: 3,
};

export const LAND_MINE_STATS = {
  DAMAGE: 8,
  ENEMY_HQ_EXCLUSION_RADIUS: 5,
};

export const MAX_RESPAWNS = 2;

/**
 * Stalemate backstop: a match where no HQ has fallen by this round is decided on fortress
 * strength instead of running forever. Longest healthy cell in the playtest lab is 62 rounds.
 */
export const MATCH_ROUND_CAP = 80;

/** Rounds without any HQ damage before bots abandon Overwatch and march on the objective. */
export const AGGRESSION_AFTER_ROUNDS = 10;

/** The aggression clock never starts before this round, so healthy short matches are untouched. */
export const AGGRESSION_START_ROUND = 20;

export const DOOMSDAY_SETTINGS = {
  START_TURN: 30,
  SHRINK_INTERVAL: 5,
  DAMAGE: 999
};

/** Doomsday-only escalation, tied to the ring clock rather than fixed match rounds. */
export const DOOMSDAY_ESCALATION = {
  COLLAPSE_REGEN_BONUS: 2,
  MELTDOWN_REGEN_BONUS: 4,
  /** Ring index that triggers Meltdown: 0 is the edge, so 2 is the third ring. */
  MELTDOWN_RING: 2,
} as const;

// Command Point (Battery) System
export const CP_SYSTEM = {
  MAX_CP: 30,
  REGEN_AMOUNT: 15,
  P1_ROUND1_CP: 22,
  RELOAD_COST: 5,
  /** CP a player may borrow on their turn; repaid automatically from the next regen. */
  OVERCLOCK_MAX: 5,
};

/**
 * Gold paid for a CP reward that would overflow the battery. Priced off the verbs: a 75€ mine
 * deals about what a 5 CP attack does, so 1 CP ≈ 15€. Never let a capped reward evaporate.
 */
export const CP_OVERFLOW_GOLD_RATE = 15;

/** Rarity is also the round a tactical weapon first becomes buyable. */
export const TACTICAL_TIERS = {
  COMMON: 2,
  RARE: 5,
  EPIC: 10,
} as const;

/** Per-weapon cooldown in rounds after a seat fires that tactical weapon. */
export const TACTICAL_COOLDOWN_ROUNDS = 3;

/** Theater Air Supply Drop schedule (Field every 3 rounds, Tactical every 6 rounds). */
export const AIR_DROP_SCHEDULE = {
  FIELD_INTERVAL: 3,
  TACTICAL_INTERVAL: 6,
  DISPATCH_LEAD_ROUNDS: 2,
  FLARE_LEAD_ROUNDS: 1,
  HQ_MIN_DISTANCE: 4,
  DUAL_PLANE_STAGGER_MS: 950,
} as const;

export const GOLD_SETTINGS = {
  INITIAL_GOLD: 200,
  INCOME_PER_TURN: 20,
  BUILDING_INCOME: 5,
  HEIST_REWARD_GOLD: 200,
  HEIST_REWARD_CP: 10,
};

export const COMBAT_BONUSES = {
  CROSSFIRE_DAMAGE: 2,
};

export const RESPAWN_TIMERS = {
  SOLDIER: 2,
  ASSAULTER: 4,
  SNIPER: 5,
};

/**
 * CP price to bring a fallen unit back. Redeploying is a tempo purchase, not a gold purchase:
 * it costs about what that unit costs to fire, so the choice is "the body or another action".
 */
export const RESPAWN_CP_COST = {
  SOLDIER: 3,
  ASSAULTER: 5,
  SNIPER: 8,
};


export const SHOP_ITEMS = {
  AMMO_REFILL: { cost: 50, name: 'Ammo Drop', type: 'CONSUMABLE' },
  FIRST_AID: { cost: 100, name: 'First Aid Kit (50% Heal)', type: 'CONSUMABLE' },
  MEDKIT: { cost: 200, name: 'Medkit (Full Heal)', type: 'CONSUMABLE' },
  LAND_MINE: { cost: 75, name: 'Land Mine', type: 'CONSTRUCT' },
  BARRIER: { cost: 150, name: 'Deploy Barrier (x3)', type: 'CONSTRUCT' },
  BRIDGE: { cost: 100, name: 'Deploy Bridge', type: 'CONSTRUCT' }, // Consolidated
  TUNNEL: { cost: 125, name: 'Mountain Tunnel', type: 'CONSTRUCT' },
};

// Fallback colors if sprites fail to load
export const TERRAIN_COLORS: Record<string, string> = {
  PLAINS: '#8BC34A',
  FOREST: '#388E3C',
  MOUNTAIN: '#795548',
  WATER: '#2196F3',
  BASE: '#607D8B',
  ROAD: '#9E9E9E',
  ROAD_H: '#9E9E9E',
  BRIDGE: '#8D6E63',
  BRIDGE_V: '#8D6E63',
  TUNNEL: '#4E443E',
  BANK: '#FFD700',
  BUILDING: '#546E7A',
  BARRIER: '#263238',
  SAND: '#E6C288',
  DUNES: '#D4A35B',
  QUICKSAND: '#A1887F',
  CANYON: '#5D4037',
};

export const HEIGHT_COLORS: Record<number, string> = {
  0: '#1a1a1a', 
  1: '#000000', 
  2: '#ffffff', 
  3: '#ffffff', 
  4: '#000000', // For Barriers (visual trick if needed)
};

export const TERRAIN_COSTS: Record<string, number> = {
  PLAINS: 1, 
  ROAD: 1,
  ROAD_H: 1,   
  BRIDGE: 1,
  BRIDGE_V: 1,
  TUNNEL: 1,
  FOREST: 2, 
  MOUNTAIN: 3, // Cost 3 means walkable but expensive
  WATER: 99, 
  BASE: 99,
  BANK: 99,
  BUILDING: 1,
  BARRIER: 99,
  SAND: 1,
  DUNES: 2,
  QUICKSAND: 3,
  CANYON: 99, // Impassable for movement, but allows shooting
};

// Percentage of damage reduction (0.0 - 1.0). Negative means taking MORE damage.
export const TERRAIN_DEFENSE: Record<string, number> = {
  PLAINS: 0,
  ROAD: 0,
  ROAD_H: 0,
  BRIDGE: 0,
  BRIDGE_V: 0,
  TUNNEL: 0,
  FOREST: 0.4, // 40% Defense
  MOUNTAIN: 0.4, // Also provides Evasion logic
  WATER: 0,
  BASE: 0.2,
  BANK: 0.2,
  BUILDING: 0.5, // Base defense
  BARRIER: 0.8, // High cover
  SAND: -0.1, // EXPOSED: Takes 10% MORE damage
  DUNES: 0.2, // Hull down
  QUICKSAND: 0,
  CANYON: 0,
};

// Building Specializations
export const BUILDING_STATS = {
  WATCHTOWER: { rangeBonus: 4, damageBonus: 1.2, defense: 0.3, name: 'Watchtower' },
  BUNKER: { rangeBonus: 2, damageBonus: 1.0, defense: 0.5, name: 'Bunker' },
};

export const UNIT_STATS = {
  SOLDIER: { 
    moveCost: 1, 
    attackCost: 3, 
    hp: 15, 
    damage: 5, 
    range: 3, 
    ammo: 10,
    maxAmmo: 10,
    vision: 4,
    name: 'Scout' 
  },
  ASSAULTER: { 
    moveCost: 2, 
    attackCost: 5, 
    hp: 30, 
    damage: 10, 
    range: 4, 
    ammo: 6,
    maxAmmo: 6,
    vision: 3,
    name: 'Breacher' 
  },
  SNIPER: { 
    moveCost: 2, 
    attackCost: 8, 
    hp: 10, 
    damage: 20, 
    range: 7, 
    ammo: 3,
    maxAmmo: 3,
    vision: 5,
    name: 'Sniper' 
  },
};

export const VETERANCY_CONFIG = {
  XP_THRESHOLDS: [0, 2, 5, 9] as const,
  RANK_NAMES: ['Recruit', 'Veteran', 'Elite', 'Ace'] as const,
  RANK_LABELS: ['', '★ VETERAN', '★★ ELITE', '★★★ ACE'] as const,
  RANK_HP_MULT: 0.2,
  AMMO_BONUS_RANK1: {
    SOLDIER: 2,
    ASSAULTER: 2,
    SNIPER: 1,
  },
  ACE_BOUNTY_GOLD: 75,
  ELITE_BREACHER_COVER_DR: 2,
  ELITE_SNIPER_DMG_BONUS: 2,
  ACE_SCOUT_DMG_BONUS: 2,
  ACE_BREACHER_DMG_BONUS: 2,
};

/** CP paid back when a turn produces a real result; the loop that funds the next play. */
export const MOMENTUM_REFUNDS = {
  CAP: 6,
  KILL: { SOLDIER: 2, ASSAULTER: 3, SNIPER: 4 } as Record<'SOLDIER' | 'ASSAULTER' | 'SNIPER', number>,
  BANK: 4,
  CAPTURE: 3,
};

export const OVERWATCH_STATS: Record<'SOLDIER' | 'ASSAULTER' | 'SNIPER', { cost: number; damage: number; refund: number }> = {
  SOLDIER: { cost: 3, damage: 4, refund: 1 },
  ASSAULTER: { cost: 4, damage: 7, refund: 2 },
  SNIPER: { cost: 6, damage: 14, refund: 3 },
};

export const MUTATOR_CONFIG = {
  CLASSIC_CP: {
    MAX_CP: 20,
    REGEN_AMOUNT: 10,
    P1_ROUND1_CP: 15,
  },
  SCARCITY: {
    AMMO_MULT: 0.5,
    BANK_REWARD_MULT: 1.5,
  },
  IRONMAN: {
    MAX_RESPAWNS: 0,
  },
};

// 6 Distinct Colors for Party Mode
export const PLAYER_COLORS: Record<number, string> = {
  0: '#E53935', // Red
  1: '#1E88E5', // Blue
  2: '#43A047', // Green
  3: '#FDD835', // Yellow
  4: '#8E24AA', // Purple
  5: '#00ACC1', // Cyan
};

export const UI_COLORS = {
  MOVE_HIGHLIGHT: 'rgba(0, 100, 255, 0.4)',
  ATTACK_HIGHLIGHT: 'rgba(255, 0, 0, 0.4)',
  SELECTION_HALO: 'rgba(255, 255, 0, 0.5)',
  PATH_LINE: 'rgba(255, 255, 255, 0.8)',
  SPAWN_HIGHLIGHT: 'rgba(0, 255, 0, 0.4)',
  ACTION_HIGHLIGHT: 'rgba(255, 165, 0, 0.5)', // Orange for Secure/Hack
};
