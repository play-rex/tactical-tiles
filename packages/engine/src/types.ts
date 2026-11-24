
export type TerrainType = 'PLAINS' | 'FOREST' | 'MOUNTAIN' | 'WATER' | 'BASE' | 'ROAD' | 'ROAD_H' | 'BRIDGE' | 'BRIDGE_V' | 'BANK' | 'BUILDING' | 'BARRIER' | 'SAND' | 'DUNES' | 'QUICKSAND' | 'CANYON' | 'TUNNEL';

export type BuildingSubType = 'WATCHTOWER' | 'BUNKER' | 'NONE';

// Zone ID maps directly to Player ID for Voronoi logic
export type ZoneType = number; 

export type WeatherType = 'CLEAR' | 'SCORCHED' | 'MONSOON' | 'FOG' | 'TAILWIND' | 'SANDSTORM';

export type HazardState = 'SAFE' | 'WARNING' | 'LAVA';

export type GameMode = 'PVP' | 'PVE';
export type VictoryMode = 'CONQUER' | 'DEATHMATCH';
export type AIDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface WeatherState {
  playerZones: Record<number, WeatherType>; // Weather for each player's Voronoi zone
  turnsRemaining: number;
}

export interface GameMutators {
  blitzCp: boolean;
  scarcity: boolean;
  ironman: boolean;
}

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
  gameMode: GameMode; 
  victoryMode?: VictoryMode;
  aiDifficulty: AIDifficulty;
  mapSeed?: string;
  mutators?: GameMutators;
  challengeId?: string;
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
  winner: number;
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

export type SupplyLootType = 'AMMO' | 'MEDKIT' | 'FIRST_AID';

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
