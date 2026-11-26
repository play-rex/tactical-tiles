/**
 * The local match in progress (hot-seat or vs AI), kept in localStorage so a reload puts you back
 * on the board. Online tables don't need this: the server holds them and the client reconnects.
 */
import type { GameState } from '@tactical/engine';
import type { Tile } from '@tactical/engine/types';

const STORAGE_KEY = 'tt:localMatch';
/** Bump when the saved shape changes in a way old saves can't be read as. */
const VERSION = 1;

/**
 * Every GameState field. The `satisfies` makes the compiler flag a field added to GameState
 * and not listed here, so a save never silently drops part of the match.
 */
const GAME_STATE_KEYS = {
  settings: true,
  mapData: true,
  gridSize: true,
  units: true,
  graveyard: true,
  currentPlayer: true,
  totalTurns: true,
  turnCounter: true,
  lastHqDamageRound: true,
  playerCp: true,
  playerCpDebt: true,
  playerCpBorrowed: true,
  playerCpRefunded: true,
  playerGold: true,
  playerRespawns: true,
  playerStatus: true,
  playerInventory: true,
  playerShopVouchers: true,
  playerTacticalVouchers: true,
  airDrops: true,
  airDropMeta: true,
  winner: true,
  activeSeed: true,
  doomsdayZone: true,
  activeMission: true,
  matchStats: true,
  matchSummary: true,
  bankRewardPending: true,
  pendingDrops: true,
  mines: true,
  weather: true,
  gameLog: true,
  firstContactDone: true,
  contract: true,
  contractsUsed: true,
  contractMisses: true,
  contractProgress: true,
  finalPush: true,
  spectatorTurn: true,
  spectatorWindow: true,
  spectatorUsedRound: true,
  tacticalRound: true,
  tacticalCooldowns: true,
  freeTacticalRound: true,
  trapRevealRound: true,
  radarRound: true,
  overclockCharges: true,
  pendingTacticals: true,
  burningLines: true,
  smokeZones: true,
  sensors: true,
} satisfies Record<keyof GameState, true>;

const KEYS = Object.keys(GAME_STATE_KEYS) as (keyof GameState)[];

export interface SavedLocalMatch {
  game: GameState;
  lastCustomMap: Tile[] | null;
}

/** Just the GameState fields of `s` (the store carries UI state alongside them). */
export const extractGameState = (s: GameState): GameState => {
  const out: Partial<Record<keyof GameState, unknown>> = {};
  for (const k of KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as unknown as GameState;
};

/** True when any GameState field changed between two store snapshots. */
export const gameStateChanged = (a: GameState, b: GameState) => KEYS.some(k => a[k] !== b[k]);

export function saveLocalMatch(game: GameState, lastCustomMap: Tile[] | null) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: VERSION, game: extractGameState(game), lastCustomMap }),
    );
  } catch {
    // Storage full or blocked: the match just won't survive a reload.
  }
}

export function loadLocalMatch(): SavedLocalMatch | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const game = parsed?.game;
    if (
      parsed?.v !== VERSION ||
      !game ||
      !Array.isArray(game.mapData) ||
      game.mapData.length === 0 ||
      !Array.isArray(game.units) ||
      typeof game.currentPlayer !== 'number' ||
      !game.settings
    ) {
      clearLocalMatch();
      return null;
    }
    return { game, lastCustomMap: Array.isArray(parsed.lastCustomMap) ? parsed.lastCustomMap : null };
  } catch {
    clearLocalMatch();
    return null;
  }
}

export function clearLocalMatch() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
