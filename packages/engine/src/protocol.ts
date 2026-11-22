/** Wire types shared by the server and the web client. */
import type { GameSettings } from './types';
import type { GameEvent } from './game/state';
import type { PlayerGameView } from './game/view';

export const ROOM_NAME = 'table';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export interface SeatInfo {
  name: string;
  isBot: boolean;
  connected: boolean;
  isHost: boolean;
  /** A bot is playing this seat's turns because the player is disconnected. */
  autopilot: boolean;
}

/**
 * Match rules the host picks in the lobby: the game's settings, all set. The seat count sets
 * the number of players; an empty `mapSeed` means a fresh map each game; `aiDifficulty` is
 * how well bots play.
 */
export type TableSettings = Required<
  Pick<GameSettings, 'unitCounts' | 'dynamicWeather' | 'fogOfWar' | 'doomsdayEnabled' | 'victoryMode' | 'aiDifficulty' | 'mutators' | 'mapSeed'>
>;

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  unitCounts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
  dynamicWeather: true,
  fogOfWar: false,
  doomsdayEnabled: false,
  victoryMode: 'CONQUER',
  aiDifficulty: 'MEDIUM',
  mutators: { blitzCp: false, scarcity: false, ironman: false },
  mapSeed: '',
};

/** Settings for a match from a table's rules (a fresh copy, safe to keep). */
export const gameSettingsFor = (table: TableSettings, playerCount: number): GameSettings => ({
  ...structuredClone(table),
  playerCount,
  gameMode: 'PVP',
  mapSeed: table.mapSeed || undefined,
});

/** A new two-player local game's settings. */
export const DEFAULT_GAME_SETTINGS: GameSettings = gameSettingsFor(DEFAULT_TABLE_SETTINGS, 2);

/** Most units of each type per squad (as on the local setup screen). */
export const UNIT_LIMITS = { SOLDIER: 5, ASSAULTER: 4, SNIPER: 3 } as const;

export interface TableView {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  seats: SeatInfo[];
  mySeat: number;
  settings: TableSettings;
  game: PlayerGameView | null;
  /**
   * Effects of the change this view brings (shots, damage numbers, sounds), to play once.
   * Empty on a resend of the same state (a reconnect, a seat change).
   */
  events: GameEvent[];
  /** Goes up with every game change, so a client can tell a new view from a resend. */
  seq: number;
}

export interface JoinOptions {
  name: string;
  /** Lasting identity kept on the device, so a player can reclaim their seat. */
  playerId: string;
}

/** Client → server message names. Payloads are validated server-side. */
export const ClientMsg = {
  sync: 'sync',
  addBot: 'addBot',
  removeSeat: 'removeSeat',
  settings: 'settings',
  start: 'start',
  action: 'action',
  rematch: 'rematch',
} as const;

/** Server → client message names. */
export const ServerMsg = {
  view: 'view',
  error: 'error',
} as const;

/**
 * Why the server closed your connection. Kept clear of Colyseus's own codes (4000 means
 * "you chose to leave", 4002 an error, 4010/42xx internal).
 */
export const CloseCode = {
  removed: 4100,
  openedElsewhere: 4101,
  restarting: 4102,
} as const;
