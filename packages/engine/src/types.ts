
export type TerrainType = 'PLAINS' | 'FOREST' | 'MOUNTAIN' | 'WATER' | 'BASE' | 'ROAD' | 'ROAD_H' | 'BRIDGE' | 'BRIDGE_V' | 'BANK' | 'BUILDING' | 'BARRIER' | 'SAND' | 'DUNES' | 'QUICKSAND' | 'CANYON' | 'TUNNEL';

export type BuildingSubType = 'WATCHTOWER' | 'BUNKER' | 'NONE';

// Zone ID maps directly to Player ID for Voronoi logic
export type ZoneType = number; 

export type WeatherType = 'CLEAR' | 'SCORCHED' | 'MONSOON' | 'FOG' | 'TAILWIND' | 'SANDSTORM';

export type HazardState = 'SAFE' | 'WARNING' | 'LAVA';

export type GameMode = 'PVP' | 'PVE';
export type VictoryMode = 'CONQUER' | 'DEATHMATCH';
export type AIDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type MapPresetId =
  | 'classic'
  | 'balanced'
  | 'lush_valley'
  | 'archipelago'
  | 'badlands'
  | 'fortress'
  | 'twin_fronts'
  | 'timber_ridge'
  | 'open_blitz'
  | 'custom';

export type WaterStyle = 'RIVERS' | 'ISLANDS' | 'CANYON' | 'NONE';
export type MapSymmetry = 'ORGANIC' | 'MIRRORED';
export type GridSizeOption = 'AUTO' | 16 | 20 | 25 | 30;

export interface MapGenKnobs {
  gridSize: GridSizeOption;
  waterStyle: WaterStyle;
  /** Waterways / straits count (0–3). */
  rivers: number;
  /** River channel width / island sea volume (0–30). */
  waterPct: number;
  /** Forest cover share (0–55). */
  forestPct: number;
  /** Mountain range share (0–40). */
  mountainPct: number;
  /** Desert sand/dunes share (0–100). */
  desertPct: number;
  /** Watchtowers & bunkers share (0–15). */
  buildingPct: number;
  /** Loose supply loot share (0–40). */
  lootPct: number;
  /** Bank vaults count (0–4). */
  banks: number;
  /** Short asphalt highway approaches extending from primary bridges. */
  roads: boolean;
  /** 180° rotational mirror fairness (2P/4P) or natural organic geography. */
  symmetry: MapSymmetry;
}

export interface MapGenConfig {
  preset: MapPresetId;
  /** Optional handcrafted static arena ID (e.g. 'campaign_recon') playable online or locally. */
  staticMapId?: string;
  /** Custom overrides applied on top of the preset defaults. */
  knobs?: Partial<MapGenKnobs>;
}

export interface WeatherState {
  playerZones: Record<number, WeatherType>; // Weather for each player's Voronoi zone
  turnsRemaining: number;
}

export interface GameMutators {
  classicCp: boolean;
  scarcity: boolean;
  ironman: boolean;
}

// ── Phase 3 match arc ────────────────────────────────────────────

export type ContractId =
  | 'FIRST_BLOOD'
  | 'LAND_GRAB'
  | 'SKIRMISH'
  | 'BREAKTHROUGH'
  | 'VAULT_RACE'
  | 'OVERWATCH_KILL'
  | 'CROSSFIRE_KILL'
  | 'DEMOLITION'
  | 'ACE_HUNT'
  | 'PURGE'
  | 'WIPE';

export type ContractTier = 1 | 2 | 3;

/** The round's shared contract. One at a time; first completion only. */
export interface SharedContract {
  id: ContractId;
  tier: ContractTier;
  /** Round this contract was dealt for. */
  round: number;
  /** Seat that completed it, or null while it is live. */
  claimedBy: number | null;
  rewardCp: number;
  rewardGold: number;
  target: number;
  /** Last round this card is live (dealt round + duration - 1). */
  expiresRound?: number;
}

/** One Final Push token per player: granted once, spent once. */
export type FinalPushStatus = 'READY' | 'USED';

// ── Tactical weapons ─────────────────────────────────────────────

export type TacticalId =
  | 'MINEFIELD_SNAPSHOT'
  | 'RECON_DRONE'
  | 'SMOKE_SCREEN'
  | 'RADAR_SWEEP'
  | 'PRECISION_STRIKE'
  | 'SABOTAGE'
  | 'NAPALM_LINE'
  | 'PARADROP'
  | 'CARPET_RUN'
  | 'ARTILLERY_BARRAGE'
  | 'OVERCLOCK_CORE';

export type TacticalAxis = 'H' | 'V';

export type TacticalFxPhase = 'ACTIVATE' | 'MARK' | 'RESOLVE' | 'BURN';

/** A telegraphed strike that lands at the start of the buyer's next turn. */
export interface PendingTactical {
  id: string;
  owner: number;
  itemKey: TacticalId;
  tiles: string[];
  damage: number;
  axis?: TacticalAxis;
  width?: 1 | 2;
}

/** A napalm line burning for two round ticks. `hits` enforces the 8-damage cap per unit. */
export interface BurningLine {
  id: string;
  owner: number;
  tiles: string[];
  roundsLeft: number;
  hits: Record<string, number>;
  axis?: TacticalAxis;
}

/** A smoke cloud that blocks line of sight for two rounds. */
export interface SmokeZone {
  id: string;
  owner: number;
  tiles: string[];
  roundsLeft: number;
}

/** A recon drone: extra sight for its owner, destroyed by an enemy entering its tile. */
export interface TacticalSensor {
  id: string;
  owner: number;
  tileId: string;
  roundsLeft: number;
}

/** Map-level effects an eliminated player may fire from their window. */
export type SpectatorEffectId =
  | 'STATIC_STORM'
  | 'SUPPLY_DROP'
  | 'REPAIR_SURGE'
  | 'BANK_BOOM'
  | 'WAR_LEVY';

export interface GameSettings {
  playerCount: number; // 2 to 6
  /** Local hot-seat display names (seat order). Empty entries fall back to Player N. */
  playerNames?: string[];
  unitCounts: {
    SOLDIER: number;
    ASSAULTER: number;
    SNIPER: number;
  };
  dynamicWeather: boolean;
  fogOfWar: boolean;
  doomsdayEnabled: boolean;
  /** Optional first-lava round override; defaults to the map-size pacing table. */
  doomsdayStartTurn?: number;
  /** Optional fixed circle center for scripted missions; otherwise the balanced selector picks it. */
  doomsdayCenter?: { x: number; y: number };
  gameMode: GameMode; 
  victoryMode?: VictoryMode;
  aiDifficulty: AIDifficulty;
  mapSeed?: string;
  mapGen?: MapGenConfig;
  mutators?: GameMutators;
  /** Starting gold per seat. Defaults to GOLD_SETTINGS.INITIAL_GOLD. */
  startingGold?: number;
  /** Gold granted at the start of each turn, before building income. */
  goldIncome?: number;
  /** Eliminated players may fire one map effect on alternating rounds. Defaults to on. */
  spectatorAttacks?: boolean;
  /** Periodic 3-round Field / 6-round Tactical theater air drops. Defaults to on (off in Challenge Ops). */
  airDropsEnabled?: boolean;
  challengeId?: string;
}

/** A PUBG-style closing circle for Deathmatch + Doomsday. */
export interface DoomsdayZone {
  /** Circle centre in tile coordinates (fractional centres are allowed). */
  center: { x: number; y: number };
  /** First completed round in which the circle starts closing. */
  startTurn: number;
  /** Round by which the final circle has been reached. */
  endTurn: number;
  startRadius: number;
  endRadius: number;
  shrinkInterval: number;
  stageCount: number;
}

export interface MissionUnitPlacement {
  type: UnitType;
  x: number;
  y: number;
  owner: number;
  rank?: UnitRank;
  hp?: number;
}

export interface MissionConfig {
  id: string;
  title: string;
  subtitle: string;
  briefing: string;
  difficultyLabel: 'STANDARD' | 'HARD' | 'EXTREME';
  gridSize: number;
  seed: string;
  settings: Partial<GameSettings>;
  startingRound?: number;
  startingGold?: Record<number, number>;
  startingCp?: Record<number, number>;
  turnLimit?: number;
  surviveTurns?: number;
  requiredHeists?: number;
  targetKillType?: { owner: number; minRank: UnitRank };
  parRounds: number;
  buildMap: () => Tile[];
  placements: MissionUnitPlacement[];
}

export interface Tile {
  id: string; 
  x: number; 
  y: number; 
  type: TerrainType;
  height: number; 
  
  // Voronoi Zone Logic (Owner ID of the zone)
  zone?: ZoneType;
  
  // Doomsday Logic
  hazardState?: HazardState;

  // Building / Bank / Base Logic
  subType?: BuildingSubType; 
  owner?: number | null; // null = Neutral
  capturedByOwners?: number[]; // Prevents repeat capture XP farming
  hackProgress?: number; // 0-100 for Banks
  
  // Custom Bank Rewards
  bankGoldReward?: number;
  bankCpReward?: number;
  
  hp?: number; // For Base
  maxHp?: number; // For Base
  
  // Drops
  loot?: SupplyLootType | null;
}

export interface SavedMap {
  id: string;
  name: string;
  author: string;
  createdAt: number;
  width: number;
  height: number;
  data: Tile[];
  isPreset: boolean;
  baseCount: number;
}

export type UnitType = 'SOLDIER' | 'ASSAULTER' | 'SNIPER';

export type UnitRank = 0 | 1 | 2 | 3;

export type PerkId =
  | 'RELAY'
  | 'SKIRMISHER'
  | 'BULWARK'
  | 'SAPPER'
  | 'COLD_BORE'
  | 'OVERWATCH_PLUS';

export interface Unit {
  id: string;
  type: UnitType;
  tileId: string; 
  
  // Stats
  hp: number;
  maxHp?: number;
  ammo: number;
  maxAmmo: number;
  owner: number;

  // Veterancy
  xp?: number;
  rank?: UnitRank;
  /** The one Veteran perk chosen for this unit, if any. */
  perk?: PerkId;
  kills?: number;
  damageDealt?: number;
  
  // State Flags
  hasMoved: boolean;    
  completed: boolean;
  isRooted?: boolean; // Effect from Quicksand
  isOverwatching?: boolean;
}

export interface MatchPlayerStats {
  kills: number;
  unitsLost: number;
  damageDealt: number;
  heists: number;
  buildingsSecured: number;
  acesPromoted: number;
}

export interface MatchSummary {
  winner: number | 'DRAW';
  isHumanWin: boolean;
  rounds: number;
  parRounds: number;
  score: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  seed: string;
  challengeId?: string;
  challengeMedal?: 'S' | 'A' | 'B';
  playerStats: Record<number, MatchPlayerStats>;
  mvp: {
    unitId: string;
    unitName: string;
    unitType: UnitType;
    owner: number;
    rank: UnitRank;
    kills: number;
    damageDealt: number;
  } | null;
}

export interface DeadUnit {
  id: string;
  type: UnitType;
  owner: number;
  turnsUntilRespawn: number;
}

export interface PlayerState {
  cp: number;
  gold: number;
  eliminated: boolean;
}

export interface BankReward {
  tileId: string;
  playerId: number;
}

export type ShopConstructId = 'LAND_MINE' | 'BARRIER' | 'BRIDGE' | 'TUNNEL';

export type AirDropKind = 'FIELD' | 'TACTICAL';
export type AirDropPhase = 'DISPATCH' | 'FLARE';

export type SupplyLootType = 'AMMO' | 'MEDKIT' | 'FIRST_AID' | 'FIELD_SUPPLY' | 'TACTICAL_SUPPLY';

/** An active theater air supply drop progressing from DISPATCH (L-2) -> FLARE (L-1) -> DROP (L). */
export interface ActiveAirDrop {
  id: string;
  kind: AirDropKind;
  /** Round on which the crate lands (3, 6, 9... for FIELD; 6, 12, 18... for TACTICAL). */
  landingRound: number;
  phase: AirDropPhase;
  /** Approximate 5x5 sector center shown at L-2 before exact LZ is flared at L-1. */
  sectorCenter: { x: number; y: number };
  /** Exact landing tile id — populated ONLY at FLARE (L-1) so players cannot peek early. */
  tileId?: string;
  /** Exact landing coordinates — populated ONLY at FLARE (L-1). */
  at?: { x: number; y: number };
  /** Seeded plane approach heading in radians. */
  headingRad: number;
}

/** Bookkeeping for mystery crate landing rounds and Tactical Drop anti-streak / no-repeat memory. */
export interface AirDropMeta {
  /** Maps landed mystery crate tileId -> landingRound (drives round-scaled Tactical tier weights on LOOT). */
  crateRounds: Record<string, number>;
  /** Tier rolled by the most recent opened Tactical Supply Crate (prevents back-to-back Epics). */
  lastTacticalTier?: 'COMMON' | 'RARE' | 'EPIC';
  /** Weapon rolled by the most recent opened Tactical Supply Crate (prevents immediate repeat). */
  lastTacticalId?: TacticalId;
  /** Number of mystery crates opened so far (guarantees distinct deterministic RNG streams). */
  openedCount: number;
  /** Last LZ coordinates so consecutive drops rotate across map lanes. */
  lastLz?: { x: number; y: number };
}

export interface PendingDrop {
  playerId: number;
  tileId: string;
  item: SupplyLootType;
}

export interface LandMine {
  id: string;
  tileId: string;
  owner: number;
}

export interface LogEntry {
  id: string;
  round: number;
  playerId: number; // -1 for Neutral/Environment
  message: string;
  type?: 'COMBAT' | 'MOVE' | 'ECONOMY' | 'INFO';
  timestamp: number;
}
