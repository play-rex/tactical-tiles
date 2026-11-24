/** Wire types shared by the server and the web client. */
import type { BuildingSubType, GameSettings, MapGenConfig, TerrainType, Unit } from './types';
import type { GameEvent } from './game/state';
import type { PlayerGameView } from './game/view';

/** Fog-honest record of one opponent action that occurred while this player was away. */
export interface MissedActionBatch {
  seq: number;
  actorSeat: number;
  round: number;
  /** Visible units right before this action ran, so fast-forward recap never teleports sprites. */
  preUnits: Unit[];
  events: GameEvent[];
}

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
  /** Host granted this player direct map editing access in the lobby. */
  canEditMap?: boolean;
  /** Host locked this player from editing or suggesting map changes in the lobby. */
  mapLocked?: boolean;
}

export interface MapTilePatch {
  x: number;
  y: number;
  type: TerrainType;
  height: number;
  subType?: BuildingSubType;
  owner?: number | null;
  bankGoldReward?: number;
  bankCpReward?: number;
}

export interface MapDraftState {
  seat: number;
  name: string;
  edits: MapTilePatch[];
}

export interface MapSuggestion {
  seat: number;
  name: string;
  edits: MapTilePatch[];
}

/**
 * Match rules the host picks in the lobby: the game's settings, all set. The seat count sets
 * the number of players; an empty `mapSeed` means a fresh map each game; `aiDifficulty` is
 * how well bots play.
 */
export type TableSettings = Required<
  Pick<GameSettings, 'unitCounts' | 'dynamicWeather' | 'fogOfWar' | 'doomsdayEnabled' | 'victoryMode' | 'aiDifficulty' | 'mutators' | 'mapSeed'>
> & {
  /** Seconds a turn starts with. 0 = no timer. Host picks 0 (off) | 30 | 45 | 60 | 90. */
  turnBaseS: number;
  /** Seconds banked after every action. 0 = no increment. Host picks 0 | 15 | 30 | 45 | 60. */
  turnIncrementS: number;
  /** Optional map generation preset & advanced knobs (omit for classic dynamic randomizer). */
  mapGen?: MapGenConfig;
  /** Optional sparse tile overrides from host/editor inline map edits in the lobby. */
  mapEdits?: MapTilePatch[];
  /** Whether unlocked non-editor guests can submit map suggestions (default true). */
  suggestionsEnabled?: boolean;
};

export const TURN_BASE_OPTIONS = [0, 30, 45, 60, 90] as const;
export const TURN_INCREMENT_OPTIONS = [0, 15, 30, 45, 60] as const;

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  unitCounts: { SOLDIER: 2, ASSAULTER: 1, SNIPER: 1 },
  dynamicWeather: true,
  fogOfWar: false,
  doomsdayEnabled: false,
  victoryMode: 'CONQUER',
  aiDifficulty: 'MEDIUM',
  mutators: { blitzCp: false, scarcity: false, ironman: false },
  mapSeed: '',
  turnBaseS: 30,
  turnIncrementS: 15,
};

/** Settings for a match from a table's rules (a fresh copy, safe to keep). */
export const gameSettingsFor = (table: TableSettings, playerCount: number): GameSettings => {
  const { turnBaseS: _base, turnIncrementS: _inc, mapEdits: _edits, suggestionsEnabled: _sug, ...rest } = table;
  void _base;
  void _inc;
  void _edits;
  void _sug;
  return {
    ...structuredClone(rest),
    playerCount,
    gameMode: 'PVP',
    mapSeed: table.mapSeed || undefined,
  };
};

/** A new two-player local game's settings. */
export const DEFAULT_GAME_SETTINGS: GameSettings = gameSettingsFor(DEFAULT_TABLE_SETTINGS, 2);

/** Most units of each type per squad (as on the local setup screen). */
export const UNIT_LIMITS = { SOLDIER: 5, ASSAULTER: 4, SNIPER: 3 } as const;

export interface TurnClock {
  /** Server timestamp (ms) when this view was built. */
  sentAt: number;
  /** Server timestamp (ms) when the current turn expires. */
  deadline: number;
  baseS: number;
  incrementS: number;
  seat: number;
  turnKey: string;
}

export interface TableView {
  code: string;
  status: 'lobby' | 'playing' | 'finished';
  seats: SeatInfo[];
  mySeat: number;
  settings: TableSettings;
  turnClock: TurnClock | null;
  game: PlayerGameView | null;
  /** Transient live map draft currently being edited in the lobby (cleared on apply/cancel/start). */
  liveDraft?: MapDraftState | null;
  /** True while the host has the Advanced Map Generator dialog open in the lobby. */
  hostCustomizingMap?: boolean;
  /** Pending map edit suggestions submitted by unlocked guests for the host to review. */
  mapSuggestions?: MapSuggestion[];
  /**
   * Effects of the change this view brings (shots, damage numbers, sounds), to play once.
   * Empty on a resend of the same state (a reconnect, a seat change).
   */
  events: GameEvent[];
  /** Fog-filtered opponent actions missed since the client's `lastSeq` (for While-You-Were-Away recap). */
  missedActions?: MissedActionBatch[];
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
  setSeatMapAccess: 'setSeatMapAccess',
  mapDraft: 'mapDraft',
  mapCommitEdit: 'mapCommitEdit',
  mapSuggest: 'mapSuggest',
  resolveSuggestion: 'resolveSuggestion',
  mapCustomizing: 'mapCustomizing',
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
