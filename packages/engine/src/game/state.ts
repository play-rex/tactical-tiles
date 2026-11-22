/**
 * The whole game as plain, serialisable data. The web store keeps these fields at its top
 * level (so components read them as before); the server keeps one per table.
 */
import type {
  BankReward,
  DeadUnit,
  GameSettings,
  LogEntry,
  MatchPlayerStats,
  MatchSummary,
  MissionConfig,
  PendingDrop,
  Tile,
  Unit,
  UnitType,
  WeatherState,
} from '../types';

export type PlayerStatus = 'ACTIVE' | 'ELIMINATED';
export type InventoryItem = 'AMMO' | 'MEDKIT';

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
  /** A supply drop that lands near your base when your turn ends (the player's shop). */
  | { type: 'BUY_ITEM'; itemKey: string }
  /** Build a Barrier or Bridge from the shop. */
  | { type: 'BUILD'; itemKey: string; tileId: string; variant?: string }
  /** After a heist: take the vault's gold or its CP. */
  | { type: 'BANK_REWARD'; choice: 'GOLD' | 'CP' };

export type GameActionType = GameAction['type'];

// ── Events ───────────────────────────────────────────────────────

export type SoundName =
  | 'click' | 'move' | 'attack' | 'sniper' | 'hit' | 'explosion' | 'heist' | 'capture' | 'turn' | 'victory';

export interface TilePoint { x: number; y: number }

/**
 * What an action looked and sounded like, for the client to play back. Positions are tile
 * coordinates, so the server can leave out what a player can't see.
 */
export type GameEvent =
  | { kind: 'sound'; sound: SoundName }
  | { kind: 'projectile'; from: TilePoint; to: TilePoint; style: 'BULLET' | 'LASER' | 'MISSILE' }
  /** Floating text above a tile; `lift` raises it by that many pixels. */
  | { kind: 'popup'; at: TilePoint; text: string; color: string; lift: number }
  | { kind: 'shake'; intensity: number };

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
