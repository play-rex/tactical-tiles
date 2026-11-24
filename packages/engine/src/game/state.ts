/**
 * The whole game as plain, serialisable data. The web store keeps these fields at its top
 * level (so components read them as before); the server keeps one per table.
 */
import { getEffectiveUnitAmmo } from '../rules/CombatRules';
import { UNIT_STATS } from '../constants/Config';
import type {
  BankReward,
  BuildingSubType,
  DeadUnit,
  GameMutators,
  GameSettings,
  LandMine,
  LogEntry,
  MatchPlayerStats,
  MatchSummary,
  MissionConfig,
  PendingDrop,
  Tile,
  Unit,
  UnitType,
  WeatherState,
  SupplyLootType,
} from '../types';

export type PlayerStatus = 'ACTIVE' | 'ELIMINATED';
export type InventoryItem = SupplyLootType;

export interface GameState {
  settings: GameSettings;
  mapData: Tile[];
  gridSize: number;
  units: Unit[];
  graveyard: DeadUnit[];
  currentPlayer: number;
  /** Completed rounds (Doomsday counts these). */
  totalTurns: number;
  /** Individual turns (weather changes every 5). */
  turnCounter: number;
  playerCp: Record<number, number>;
  playerGold: Record<number, number>;
  playerRespawns: Record<number, number>;
  playerStatus: Record<number, PlayerStatus>;
  playerInventory: Record<number, InventoryItem[]>;
  winner: number | null;
  activeSeed: string;
  /** Local challenge ops only; online tables never carry one. */
  activeMission: MissionConfig | null;
  matchStats: Record<number, MatchPlayerStats>;
  matchSummary: MatchSummary | null;
  bankRewardPending: BankReward | null;
  pendingDrops: PendingDrop[];
  mines: LandMine[];
  weather: WeatherState;
  gameLog: LogEntry[];
}

// ── Actions ──────────────────────────────────────────────────────

/**
 * Everything a player (or the AI) can do. `cost` is the CP the action spends; the server
 * recomputes it (see prepareAction) rather than trusting what a client sends.
 */
export type GameAction =
  | { type: 'END_TURN' }
  | { type: 'MOVE'; unitId: string; targetTileId: string; cost: number }
  | { type: 'ATTACK'; attackerId: string; targetUnitId: string; cost: number }
  | { type: 'OVERWATCH'; unitId: string; cost: number }
  | { type: 'RELOAD'; unitId: string; cost: number }
  | { type: 'SECURE'; unitId: string; tileId: string; cost: number }
  | { type: 'HEIST'; unitId: string; tileId: string; cost: number }
  | { type: 'SIEGE'; unitId: string; tileId: string; cost: number }
  | { type: 'DEMOLISH'; unitId: string; tileId: string; cost: number }
  | { type: 'LOOT'; unitId: string; tileId: string; cost: number }
  /** A supply drop placed straight onto a tile beside one of your units (the AI's shop). */
  | { type: 'BUY_DROP'; itemKey: string; tileId: string; cost: number; goldCost: number }
  | { type: 'USE_ITEM'; unitId: string; itemIndex: number; cost: number }
  | { type: 'SPAWN'; unitType: UnitType; tileId: string; cost: number; goldCost: number; deadUnitId?: string }
  /** A supply drop that lands at your chosen drop zone (or near your base) when your turn ends. */
  | { type: 'BUY_ITEM'; itemKey: string; tileId?: string }
  /** Build a Barrier wall, Land Mine, or Bridge from the shop. */
  | { type: 'BUILD'; itemKey: string; tileId: string; tileIds?: string[]; variant?: string }
  /** After a heist: take the vault's gold or its CP. */
  | { type: 'BANK_REWARD'; choice: 'GOLD' | 'CP' };

export type GameActionType = GameAction['type'];

// ── Events ───────────────────────────────────────────────────────

export type SoundName =
  | 'click' | 'move' | 'attack' | 'sniper' | 'hit' | 'explosion' | 'heist' | 'capture' | 'turn' | 'victory';

export interface TilePoint { x: number; y: number }

export type WeaponVisual = 'SOLDIER' | 'ASSAULTER' | 'SNIPER' | 'TURRET' | 'ARTILLERY' | 'SIEGE';

export type KillCause = 'COMBAT' | 'OVERWATCH' | 'MINE' | 'TURRET' | 'ARTILLERY' | 'LAVA' | 'BASE_FALL';

/**
 * What an action looked and sounded like, for the client to play back. Positions are tile
 * coordinates, so the server can leave out what a player can't see.
 */
export type GameEvent =
  | { kind: 'sound'; sound: SoundName; delayMs?: number }
  | {
      kind: 'projectile';
      from: TilePoint;
      to: TilePoint;
      style: 'BULLET' | 'LASER' | 'MISSILE';
      weapon?: WeaponVisual;
      attackerId?: string;
      targetUnitId?: string;
      delayMs?: number;
      travelMs?: number;
    }
  /** Floating text above a tile; `lift` raises it by that many pixels. */
  | { kind: 'popup'; at: TilePoint; text: string; color: string; lift: number; delayMs?: number }
  | { kind: 'shake'; intensity: number; at?: TilePoint; delayMs?: number }
  | { kind: 'movePath'; unitId: string; unitType: UnitType; owner: number; path: TilePoint[]; haltedAt?: number }
  | {
      kind: 'hit';
      targetUnitId?: string;
      at: TilePoint;
      from?: TilePoint;
      damage: number;
      weapon?: WeaponVisual;
      isKill?: boolean;
      isCrit?: boolean;
      suppressed?: boolean;
      crossfireFrom?: TilePoint[];
      delayMs?: number;
    }
  | {
      kind: 'killed';
      unitId: string;
      unitType: UnitType;
      owner: number;
      rank: number;
      at: TilePoint;
      killerOwner?: number;
      cause: KillCause;
      delayMs?: number;
    }
  | {
      kind: 'mineBlast';
      at: TilePoint;
      damage: number;
      victimUnitId?: string;
      victimDead?: boolean;
      delayMs?: number;
    }
  | {
      kind: 'structureHit';
      at: TilePoint;
      structureType: 'BASE' | 'BARRIER';
      damage: number;
      destroyed: boolean;
      owner?: number | null;
      attackerOwner?: number;
      delayMs?: number;
    }
  | { kind: 'heist'; at: TilePoint; playerId: number }
  | { kind: 'capture'; at: TilePoint; owner: number; subType?: BuildingSubType }
  | { kind: 'spawn'; unitId: string; unitType: UnitType; owner: number; at: TilePoint }
  | { kind: 'promotion'; unitId: string; at: TilePoint; rank: number; label: string }
  | { kind: 'overwatchSet'; unitId: string; at: TilePoint; owner: number }
  | { kind: 'heal'; unitId: string; at: TilePoint; amount: number; item: 'MEDKIT' | 'FIRST_AID' | 'AMMO' | 'RELOAD' }
  | { kind: 'build'; tiles: TilePoint[]; itemKey: 'BARRIER' | 'BRIDGE' }
  | { kind: 'supplyLanded'; at: TilePoint; item: SupplyLootType };

// ── Logs ─────────────────────────────────────────────────────────

let logSeq = 0;
export const createLog = (
  round: number,
  playerId: number,
  message: string,
  type: LogEntry['type'] = 'INFO',
): LogEntry => ({
  id: `${Date.now().toString(36)}${(logSeq++).toString(36)}`,
  round,
  playerId,
  message,
  type,
  timestamp: Date.now(),
});

/** The game log keeps the newest entries; a long match would otherwise grow without bound. */
export const MAX_LOG_ENTRIES = 200;

// ── Match stats ──────────────────────────────────────────────────

/** A copy of the match stats with a row for every player (zeroed where missing). */
export const cloneMatchStats = (
  stats: Record<number, MatchPlayerStats> | undefined,
  playerCount: number,
): Record<number, MatchPlayerStats> => {
  const out: Record<number, MatchPlayerStats> = {};
  for (let i = 0; i < playerCount; i++) {
    out[i] = stats?.[i]
      ? { ...stats[i] }
      : { kills: 0, unitsLost: 0, damageDealt: 0, heists: 0, buildingsSecured: 0, acesPromoted: 0 };
  }
  return out;
};

/** The player whose turn comes after `current`, skipping anyone eliminated. */
export const nextActivePlayer = (
  current: number,
  playerCount: number,
  status: Record<number, PlayerStatus>,
): number => {
  let nextId = (current + 1) % playerCount;
  let loopCount = 0;
  while (status[nextId] === 'ELIMINATED' && loopCount < playerCount) {
    nextId = (nextId + 1) % playerCount;
    loopCount++;
  }
  return nextId;
};

/** Constructs a fresh unit at full HP with effective ammo for the active mutators. */
export const createUnit = (params: {
  id: string;
  type: UnitType;
  owner: number;
  tileId: string;
  mutators?: GameMutators;
  hasMoved?: boolean;
  completed?: boolean;
}): Unit => {
  const { id, type, owner, tileId, mutators, hasMoved = false, completed = false } = params;
  const baseHp = UNIT_STATS[type].hp;
  const maxAmmo = getEffectiveUnitAmmo(type, mutators);
  return {
    id,
    type,
    tileId,
    hp: baseHp,
    maxHp: baseHp,
    ammo: maxAmmo,
    maxAmmo,
    owner,
    xp: 0,
    rank: 0,
    kills: 0,
    damageDealt: 0,
    hasMoved,
    completed,
    isOverwatching: false,
  };
};

/** Constructs a blank, serialisable GameState shell with the given settings. */
export const createEmptyGameState = (settings: GameSettings, gridSize = 20): GameState => ({
  settings,
  mapData: [],
  gridSize,
  units: [],
  graveyard: [],
  currentPlayer: 0,
  totalTurns: 0,
  turnCounter: 0,
  playerCp: {},
  playerGold: {},
  playerRespawns: {},
  playerStatus: {},
  playerInventory: {},
  winner: null,
  activeSeed: '',
  activeMission: null,
  matchStats: {},
  matchSummary: null,
  bankRewardPending: null,
  pendingDrops: [],
  mines: [],
  weather: { playerZones: {}, turnsRemaining: 5 },
  gameLog: [],
});
