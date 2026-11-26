/**
 * The game screen's state: the game itself (the engine's GameState, kept at the top level so
 * components read `units`, `mapData`… directly) plus selection and highlighting.
 *
 * Local games (hot-seat and vs AI) apply actions here with the engine. Online games send
 * them to the server and show the views it sends back (see applyServerView).
 */
import { create } from 'zustand';
import { BANK_STATS, BARRIER_STATS, BASE_STATS, CP_SYSTEM, DEFAULT_GRID_SIZE, OVERWATCH_STATS, RESPAWN_CP_COST, SHOP_ITEMS } from '@tactical/engine/constants/Config';
import type { GameSettings, SavedMap, TacticalId, TerrainType, Tile, Unit, UnitRank, UnitType, WeatherState } from '@tactical/engine/types';
import { getStepCost, getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import { canConstructOnTile, canUnitEnterOverwatch, getUnitAttackCost, getUnitMaxHp, isWithinEnemyHqExclusion } from '@tactical/engine/rules/CombatRules';
import { CareerStorage } from '@tactical/engine/storage/CareerStatsManager';
import {
  applyAction,
  botAction,
  cloneTiles,
  createChallengeGame,
  createCustomMapGame,
  createEmptyGameState,
  createGeneratedGame,
  createUnit,
  generateDevMap,
  generateSectorSeed,
  DEFAULT_DEV_MAP_OPTIONS,
  type DevMapOptions,
  getAttackBlocker,
  getSpawnTiles,
  getSupplyDropTargets,
  getUnitOptions,
  hasTacticalVoucher,
  DEFAULT_GAME_SETTINGS,
  INTERACT_COST,
  isSameMapGen,
  isUnitVisible,
  legalParadropDestinations,
  legalTacticalAnchors,
  paradropDestinationBlocker,
  spawnBlocker,
  TACTICAL_ITEMS,
  tacticalBlocker,
  tacticalCooldownLeft,
  tacticalIsFree,
  tacticalUnlockRound,
  visibleSet,
  type GameAction,
  type GameEvent,
  type GameState,
  type MissedActionBatch,
  type TableView,
} from '@tactical/engine';
import { chooseBotSpectatorEffect } from '@tactical/engine/game/SpectatorOps';
import { useEffectStore } from './useEffectStore';
import { fxTimeline } from '../core/graphics/fxTimeline';
import { DEV_EVENT_MAP, devStructureBatch, type DevEventContext, type DevEventKind } from '../core/dev/devEventMatrix';
import { highlightRecorder } from '../core/graphics/highlightRecorder';
import { recapPlayer, type RecapBridge } from '../core/graphics/recapPlayer';
import { SoundFX } from '../core/audio/SoundFX';
import {
  type BoardRotation,
  nextBoardRotation,
  readSavedBoardRotation,
  saveBoardRotation,
} from '../core/boardRotation';
import { clearLocalMatch, gameStateChanged, loadLocalMatch, saveLocalMatch } from '../core/storage/localMatchSave';

export type Screen = 'SETUP' | 'GAME' | 'EDITOR' | 'TUTORIAL' | 'ONLINE' | 'DEV';

/** What the sandbox brush drops on the tile you click. */
export type DevBrush =
  | { kind: 'TERRAIN'; terrain: TerrainType }
  | { kind: 'STRUCTURE'; structure: 'BASE' | 'BANK' | 'BARRIER' | 'WATCHTOWER' | 'BUNKER'; owner: number }
  | { kind: 'UNIT'; unitType: UnitType; owner: number };

/** Events the sandbox can fire through the real FX pipeline to audition a cut. */
export type { DevEventKind } from '../core/dev/devEventMatrix';

/** How the store reaches the server during an online game (set by the online store). */
export interface OnlineBridge {
  send: (action: GameAction) => void;
  leave: () => void;
}

export interface PlacementModeState {
  active: boolean;
  itemKey: string;
  cost: number;
  kind: 'CONSTRUCT' | 'DROP' | 'TACTICAL';
  validTiles: string[];
  selectedTiles?: string[];
  requiredCount?: number;
  variant?: string;
  /** Tactical footprint orientation; H walks +x, V walks +y. */
  tacticalAxis?: 'H' | 'V';
  /** Artillery Barrage lane width (always 2×10). */
  tacticalWidth?: 1 | 2;
  /** Picked unit ID during Step 2 of Paradrop airlift relocation. */
  tacticalUnitId?: string;
}

export interface MapFeedback {
  id: number;
  tileId: string;
  text: string;
  tone: 'warn' | 'info';
}

interface MoveUndoSnapshot {
  game: GameState;
  unitId: string;
  originTileId: string;
}

interface GameStore extends GameState {
  currentScreen: Screen;
  /** LOCAL: this device plays every seat (hot-seat / vs AI). ONLINE: you play `mySeat`. */
  mode: 'LOCAL' | 'ONLINE';
  mySeat: number;
  online: OnlineBridge | null;
  /** The setup screen's settings, kept aside while an online table's rules are in play. */
  localSettings: GameSettings | null;
  /** The last online view applied, so a resent view doesn't replay its effects. */
  onlineSeq: number;

  lastCustomMap: Tile[] | null;

  // Client camera orientation (never synced to/from other players)
  mapRotation: BoardRotation;

  // Shop placement
  placementMode: PlacementModeState | null;
  mapFeedback: MapFeedback | null;
  lastMoveSnapshot: MoveUndoSnapshot | null;

  // Fog of war: what the player at this screen can see
  visibleTiles: Set<string>;

  // Selection
  selectedUnitId: string | null;
  selectedTileId: string | null;
  hoveredTileId: string | null;
  selectedGraveyardUnitId: string | null;
  selectedInventoryItemIndex: number | null;

  // Valid moves/targets for the selection
  validMoveCosts: Map<string, number>;
  validMoveParents: Map<string, string | null>;
  validMoveTiles: string[];
  validAttackTargets: string[];
  validSpawnTiles: string[];
  validSecureTile: string | null;
  validSiegeTile: string | null;
  validLootTile: string | null;
  validDemolishTile: string | null;

  /** Input is locked: the AI is playing (local), or it isn't your turn (online). */
  isAiTurn: boolean;

  // Editor
  mapToEdit: SavedMap | null;

  // Dev sandbox: a param-driven board with free placement and scripted event playback
  /** True while a sandbox match runs: unlocks the dev panel and free placement. */
  devSandbox: boolean;
  devOptions: DevMapOptions;
  devPreview: Tile[];
  openDevMaps: () => void;
  exitDevMaps: () => void;
  setDevOptions: (patch: Partial<DevMapOptions>) => void;
  rollDevSeed: () => void;
  launchDevSandbox: () => void;
  /** Back to the local match saved before a reload, if there is one. True when one was restored. */
  resumeLocalMatch: () => boolean;
  devPlace: (x: number, y: number, brush: DevBrush) => void;
  devFireEvent: (kind: DevEventKind) => void;
  /** Pure sandbox: no ranges, no CP, no turn lock. Units teleport and strike anywhere. */
  devFreeplay: boolean;
  setDevFreeplay: (on: boolean) => void;
  /** Bot match: both seats play themselves so you can watch a full simulated game. */
  devBotMatch: boolean;
  setDevBotMatch: (on: boolean) => void;
  devMoveUnit: (unitId: string, tileId: string) => void;
  devAttackUnit: (attackerId: string, targetId: string) => void;
  /** Strike a structure (bank vault, enemy HQ, barrier) from anywhere, ignoring range and CP. */
  devSiegeStructure: (attackerId: string, tileId: string) => void;

  // Setup
  setGameSettings: (settings: Partial<GameSettings>) => void;
  startGame: () => void;
  startChallenge: (challengeId: string) => void;
  openEditor: () => void;
  exitEditor: () => void;
  openTutorial: () => void;
  exitTutorial: () => void;
  openOnline: () => void;
  loadMapAndStart: (customMap: Tile[]) => void;
  loadMapIntoEditor: (map: SavedMap) => void;

  // Game
  initializeMap: () => void;
  rotateMap: (delta?: 90 | -90) => void;
  setMapRotation: (rot: BoardRotation) => void;
  handleTileClick: (x: number, y: number) => void;
  clearSelection: () => void;
  setHoveredTile: (tileId: string | null) => void;
  handleGraveyardSelect: (deadUnitId: string) => void;
  /** Select a unit straight from the HUD roster (no map click): command it if it can act, else inspect it. */
  selectUnitById: (unitId: string) => void;
  selectInventoryItem: (index: number | null) => void;
  selectNextReadyUnit: () => void;
  reloadUnit: () => void;
  enterOverwatch: () => void;
  endTurn: () => void;
  resetGame: () => void;
  retryCurrentMatch: () => void;

  secureBuilding: () => void;
  siegeBase: () => void;
  demolishBarrier: () => void;
  lootSupply: () => void;
  resolveBankReward: (choice: 'GOLD' | 'CP') => void;
  buyShopItem: (itemKey: string, variant?: string) => void;
  useTacticalWeapon: (itemKey: TacticalId) => void;
  setTacticalAxis: (axis: 'H' | 'V') => void;
  confirmTacticalStrike: () => void;
  resetParadropPick: () => void;
  confirmConstruct: () => void;
  confirmAutoDrop: () => void;
  cancelPlacement: () => void;
  undoLastMove: () => void;
  showMapFeedback: (tileId: string, text: string, tone?: 'warn' | 'info') => void;
  clearMapFeedback: () => void;

  /** Every game action goes through here: applied locally, or sent to the server online. */
  executeAiAction: (action: GameAction) => void;
  runAiLoop: () => void;

  // Replay & broadcast export
  playPlayOfTheMatch: (onDone?: () => void) => boolean;
  /** The end-of-match reel: the best feud cut from first shot to last, across turns and seats. */
  playMatchFilm: (onDone?: () => void) => boolean;
  /** The match is over but the end-of-match cutscene hasn't claimed the screen yet. */
  finalePending: boolean;
  exportPlayOfTheMatch: (onStatus?: (msg: string) => void) => Promise<'webm' | 'png' | 'unsupported'>;

  // Online
  enterOnline: (bridge: OnlineBridge) => void;
  applyServerView: (view: TableView) => void;
  exitOnline: () => void;
}

/** Selection and highlights cleared, as after every action. */
const CLEAR_SELECTION = {
  selectedUnitId: null,
  selectedTileId: null,
  hoveredTileId: null,
  selectedGraveyardUnitId: null,
  selectedInventoryItemIndex: null,
  validMoveCosts: new Map<string, number>(),
  validMoveParents: new Map<string, string | null>(),
  validMoveTiles: [] as string[],
  validAttackTargets: [] as string[],
  validSpawnTiles: [] as string[],
  validSecureTile: null,
  validSiegeTile: null,
  validLootTile: null,
  validDemolishTile: null,
  placementMode: null,
};


/** Local vs-AI games: the AI plays seat 1. */
/** Bot-match mode: every seat is driven by the AI, so you can watch a full simulated game. */
let botMatchActive = false;

/** Cued once per match, so the winning board never replays the reel on a re-render. */
let matchFilmPlayed = false;

const aiPlays = (s: Pick<GameState, 'winner' | 'currentPlayer' | 'settings'>) =>
  s.winner === null && s.settings.gameMode === 'PVE' && (botMatchActive || s.currentPlayer === 1);

/**
 * Eliminated AI seats take their window too (PvE and full bot simulations), so a simulated match
 * does not leave half the table silently skipping its attacks. The action loop calls this after
 * every action: the timer is keyed by window, and an already-armed window is left alone, otherwise
 * each bot action would push the attack back forever and it would never fire.
 */
let spectatorTimer: ReturnType<typeof setTimeout> | null = null;
let spectatorTimerKey = '';

const cancelBotSpectator = () => {
  if (spectatorTimer !== null) clearTimeout(spectatorTimer);
  spectatorTimer = null;
  spectatorTimerKey = '';
};

const scheduleBotSpectator = () => {
  const state = useGameStore.getState();
  const seat = state.spectatorTurn;
  const round = state.totalTurns + 1;
  const botSeat =
    state.settings.gameMode === 'PVE' &&
    (botMatchActive || (seat !== null && seat !== undefined && seat !== 0));
  if (
    state.mode !== 'LOCAL' ||
    state.currentScreen !== 'GAME' ||
    state.winner !== null ||
    seat === null ||
    seat === undefined ||
    state.playerStatus[seat] !== 'ELIMINATED' ||
    state.spectatorUsedRound === round ||
    !botSeat
  ) {
    cancelBotSpectator();
    return;
  }

  const key = `${round}:${seat}`;
  if (spectatorTimer !== null && spectatorTimerKey === key) return; // same window, already counting
  cancelBotSpectator();
  spectatorTimerKey = key;
  spectatorTimer = setTimeout(() => {
    spectatorTimer = null;
    spectatorTimerKey = '';
    const now = useGameStore.getState();
    if (
      now.mode !== 'LOCAL' ||
      now.currentScreen !== 'GAME' ||
      now.winner !== null ||
      now.spectatorTurn !== seat ||
      now.spectatorUsedRound === now.totalTurns + 1
    ) return;
    now.executeAiAction({ type: 'SPECTATOR_ATTACK', effectId: chooseBotSpectatorEffect(now, seat) });
  }, 900);
};

/**
 * Whose eyes the map is drawn through (under fog, what they can see): your seat online,
 * seat 0 against the AI, and whoever's turn it is at a shared screen.
 */
export const viewerSeat = (s: Pick<GameStore, 'mode' | 'mySeat' | 'currentPlayer' | 'settings'>): number =>
  s.mode === 'ONLINE' ? s.mySeat : s.settings.gameMode === 'PVE' ? 0 : s.currentPlayer;

/** Every seat's battery at full: pure sandbox testing is never gated on command points. */
const topUpPlayerCp = (cp: Record<number, number>): Record<number, number> =>
  Object.fromEntries(Object.keys(cp).map(seat => [Number(seat), CP_SYSTEM.MAX_CP]));

/** Pure sandbox tactical view: unlocks all tiers, Euros, and cooldowns without altering live match rules. */
const sandboxTacticalState = (state: GameStore): GameState => ({
  ...state,
  totalTurns: Math.max(state.totalTurns, 9),
  playerGold: {
    ...state.playerGold,
    [state.currentPlayer]: Math.max(state.playerGold[state.currentPlayer] ?? 0, 5000),
  },
  tacticalRound: {},
  tacticalCooldowns: {},
});

let aiLoopSeq = 0;

/** Play an action's effects through the synchronized FX timeline. */
const playEvents = (events: GameEvent[], unitSnapshot?: Unit[], fallbackUnits?: Unit[]) => {
  // Ensure effect store sink is registered before dispatching timeline cues
  void useEffectStore.getState();
  const unitsForLookup = unitSnapshot;
  const preFallback = fallbackUnits ?? useGameStore.getState().units;
  fxTimeline.configure({
    getGridSize: () => useGameStore.getState().gridSize || 20,
    getUnitInfo: (unitId) => {
      const primary = unitsForLookup ?? useGameStore.getState().units;
      const u = primary.find(item => item.id === unitId) ?? preFallback.find(item => item.id === unitId);
      if (!u) return undefined;
      return {
        type: u.type,
        owner: u.owner,
        rank: (u.rank ?? 0) as UnitRank,
        hp: u.hp,
        maxHp: getUnitMaxHp(u),
        ammo: u.ammo,
        maxAmmo: u.maxAmmo,
      };
    },
  });
  fxTimeline.dispatchGameEvents(events);
};

const sameArr = (a: number[] | undefined, b: number[] | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => v === b[i]));

const tileUnchanged = (a: Tile, b: Tile) =>
  a.id === b.id &&
  a.type === b.type &&
  a.height === b.height &&
  a.owner === b.owner &&
  a.hp === b.hp &&
  a.maxHp === b.maxHp &&
  a.hackProgress === b.hackProgress &&
  a.loot === b.loot &&
  a.hazardState === b.hazardState &&
  a.zone === b.zone &&
  sameArr(a.capturedByOwners, b.capturedByOwners);

const reuseMapData = (prev: Tile[], next: Tile[]): Tile[] => {
  if (prev.length !== next.length) return next;
  let diffIdx = -1;
  for (let i = 0; i < next.length; i++) {
    if (!tileUnchanged(prev[i], next[i])) {
      diffIdx = i;
      break;
    }
  }
  if (diffIdx === -1) return prev;
  const out = next.slice();
  for (let i = 0; i < diffIdx; i++) out[i] = prev[i];
  for (let i = diffIdx + 1; i < next.length; i++) {
    if (tileUnchanged(prev[i], next[i])) out[i] = prev[i];
  }
  return out;
};

const unitUnchanged = (a: Unit, b: Unit) =>
  a.tileId === b.tileId &&
  a.hp === b.hp &&
  a.maxHp === b.maxHp &&
  a.ammo === b.ammo &&
  a.maxAmmo === b.maxAmmo &&
  a.owner === b.owner &&
  a.xp === b.xp &&
  a.rank === b.rank &&
  a.kills === b.kills &&
  a.damageDealt === b.damageDealt &&
  a.hasMoved === b.hasMoved &&
  a.completed === b.completed &&
  Boolean(a.isOverwatching) === Boolean(b.isOverwatching) &&
  Boolean(a.isRooted) === Boolean(b.isRooted);

const reuseUnits = (prev: Unit[], next: Unit[]): Unit[] => {
  if (prev.length === next.length) {
    let allSame = true;
    for (let i = 0; i < next.length; i++) {
      if (prev[i].id !== next[i].id || !unitUnchanged(prev[i], next[i])) {
        allSame = false;
        break;
      }
    }
    if (allSame) return prev;
  }
  const byId = new Map<string, Unit>();
  for (const u of prev) byId.set(u.id, u);
  return next.map(u => {
    const old = byId.get(u.id);
    return old && unitUnchanged(old, u) ? old : u;
  });
};

const reuseWeather = (prev: WeatherState, next: WeatherState): WeatherState => {
  if (prev.turnsRemaining !== next.turnsRemaining) return next;
  const prevKeys = Object.keys(prev.playerZones);
  const nextKeys = Object.keys(next.playerZones);
  if (prevKeys.length !== nextKeys.length) return next;
  for (const k of nextKeys) {
    if (prev.playerZones[Number(k)] !== next.playerZones[Number(k)]) return next;
  }
  return prev;
};

const reuseSettings = (prev: GameSettings, next: GameSettings): GameSettings =>
  prev.playerCount === next.playerCount &&
  prev.dynamicWeather === next.dynamicWeather &&
  prev.fogOfWar === next.fogOfWar &&
  prev.doomsdayEnabled === next.doomsdayEnabled &&
  prev.gameMode === next.gameMode &&
  prev.victoryMode === next.victoryMode &&
  prev.aiDifficulty === next.aiDifficulty &&
  prev.mapSeed === next.mapSeed &&
  isSameMapGen(prev.mapGen, next.mapGen) &&
  prev.challengeId === next.challengeId &&
  prev.unitCounts.SOLDIER === next.unitCounts.SOLDIER &&
  prev.unitCounts.ASSAULTER === next.unitCounts.ASSAULTER &&
  prev.unitCounts.SNIPER === next.unitCounts.SNIPER &&
  Boolean(prev.mutators?.classicCp) === Boolean(next.mutators?.classicCp) &&
  Boolean(prev.mutators?.scarcity) === Boolean(next.mutators?.scarcity) &&
  Boolean(prev.mutators?.ironman) === Boolean(next.mutators?.ironman) &&
  (prev.playerNames ?? []).join('\u0000') === (next.playerNames ?? []).join('\u0000')
    ? prev
    : next;

const reuseVisibleTiles = (prev: Set<string>, nextIds: string[]): Set<string> =>
  prev.size === nextIds.length && nextIds.every(id => prev.has(id)) ? prev : new Set(nextIds);

const commitGameView = (
  state: GameStore,
  game: GameState,
  visibleTiles: Set<string>,
  viewer: number,
  isAiTurn: boolean,
  keepSelection: boolean,
) => {
  let selectedUnitId: string | null = null;
  let selectedTileId: string | null = null;
  if (keepSelection) {
    selectedTileId = state.selectedTileId;
    if (state.selectedUnitId) {
      const target = game.units.find(
        u => u.id === state.selectedUnitId && isUnitVisible(u, viewer, game.settings.fogOfWar, visibleTiles),
      );
      if (target) {
        selectedUnitId = target.id;
        selectedTileId = target.tileId;
      }
    }
  }
  return {
    ...game,
    ...CLEAR_SELECTION,
    selectedUnitId,
    selectedTileId,
    visibleTiles,
    isAiTurn,
    currentScreen: 'GAME' as const,
  };
};

let feedbackSeq = 0;

const pickGameState = (s: GameState): GameState => ({
  settings: s.settings,
  mapData: s.mapData,
  gridSize: s.gridSize,
  units: s.units,
  graveyard: s.graveyard,
  currentPlayer: s.currentPlayer,
  totalTurns: s.totalTurns,
  turnCounter: s.turnCounter,
  playerCp: s.playerCp,
  playerCpDebt: s.playerCpDebt,
  playerCpBorrowed: s.playerCpBorrowed,
  playerCpRefunded: s.playerCpRefunded,
  playerGold: s.playerGold,
  playerRespawns: s.playerRespawns,
  playerStatus: s.playerStatus,
  playerInventory: s.playerInventory,
  winner: s.winner,
  activeSeed: s.activeSeed,
  activeMission: s.activeMission,
  matchStats: s.matchStats,
  matchSummary: s.matchSummary,
  bankRewardPending: s.bankRewardPending,
  pendingDrops: s.pendingDrops,
  mines: s.mines,
  weather: s.weather,
  lastHqDamageRound: s.lastHqDamageRound,
  gameLog: s.gameLog,
  spectatorTurn: s.spectatorTurn,
  spectatorWindow: s.spectatorWindow,
  spectatorUsedRound: s.spectatorUsedRound,
  tacticalRound: s.tacticalRound,
  tacticalCooldowns: s.tacticalCooldowns,
  freeTacticalRound: s.freeTacticalRound,
  trapRevealRound: s.trapRevealRound,
  radarRound: s.radarRound,
  overclockCharges: s.overclockCharges,
  pendingTacticals: s.pendingTacticals,
  burningLines: s.burningLines,
  smokeZones: s.smokeZones,
  sensors: s.sensors,
});

const optionsSelectionFor = (game: GameState, unit: Unit, visibleTiles: Set<string>) => {
  const opts = getUnitOptions(game, unit, visibleTiles);
  return {
    selectedUnitId: unit.id,
    selectedTileId: unit.tileId,
    validMoveCosts: opts.moveCosts,
    validMoveParents: opts.moveParents,
    validMoveTiles: Array.from(opts.moveCosts.keys()),
    validAttackTargets: opts.attackTargets,
    validSecureTile: opts.secureTiles[0] ?? null,
    validSiegeTile: opts.siegeTiles[0] ?? null,
    validLootTile: opts.lootTiles[0] ?? null,
    validDemolishTile: opts.demolishTiles[0] ?? null,
  };
};

const hasFollowUpAction = (game: GameState, unit: Unit, sel: ReturnType<typeof optionsSelectionFor>) => {
  const tile = getTileByIdFast(game.mapData, unit.tileId, game.gridSize);
  const cp = game.playerCp[game.currentPlayer] ?? 0;
  return (
    sel.validAttackTargets.length > 0 ||
    sel.validSiegeTile !== null ||
    sel.validDemolishTile !== null ||
    sel.validSecureTile !== null ||
    sel.validLootTile !== null ||
    canUnitEnterOverwatch(unit, tile, cp) ||
    (unit.ammo < unit.maxAmmo && cp >= CP_SYSTEM.RELOAD_COST)
  );
};

export const useGameStore = create<GameStore>((set, get) => {
  /** Builds a bridge that lets `recapPlayer` step through snapshots and always restore the live board. */
  const createRecapBridge = (
    liveUnits: Unit[],
    liveMapData: Tile[],
    /** Restored with the board when a replay revealed ground the viewer never scouted. */
    liveVisible?: Set<string>,
  ): RecapBridge => ({
    applyDisplaySnapshot: (units, mapData) => {
      set(mapData ? { units, mapData } : { units });
    },
    restoreLiveState: () => {
      set(
        liveVisible
          ? { units: liveUnits, mapData: liveMapData, visibleTiles: liveVisible }
          : { units: liveUnits, mapData: liveMapData },
      );
    },
    dispatchEvents: (events, postUnits) => {
      playEvents(events, postUnits, get().units);
    },
  });

  /** Start a local game. */
  const beginLocal = (game: GameState, lastCustomMap: Tile[] | null) => {
    recapPlayer.stop();
    highlightRecorder.reset();
    useEffectStore.getState().clearAllFx();
    // A fresh board is never a bot match until the caller says so (launchDevSandbox re-arms it).
    botMatchActive = false;
    matchFilmPlayed = false;
    aiLoopSeq++;
    set({
      ...commitGameView(get(), game, visibleSet(game, 0), 0, false, false),
      lastCustomMap,
      lastMoveSnapshot: null,
      mapFeedback: null,
      mode: 'LOCAL',
      // A normal match never inherits the sandbox panel; launchDevSandbox opts back in.
      devSandbox: false,
      finalePending: false,
    });
  };

  /** Dispatch a fixed-cost or attack-cost selected-unit action when allowed. */
  const dispatchSelectedUnitAction = (
    tile: string | null,
    build: (unitId: string, tileId: string, unit: Unit) => GameAction,
  ) => {
    const { selectedUnitId, units, isAiTurn, winner } = get();
    if (isAiTurn || winner !== null || !selectedUnitId || !tile) return;
    const unit = units.find(u => u.id === selectedUnitId);
    if (!unit) return;
    get().executeAiAction(build(selectedUnitId, tile, unit));
  };

  return {
    ...createEmptyGameState(DEFAULT_GAME_SETTINGS, DEFAULT_GRID_SIZE),
    ...CLEAR_SELECTION,
    currentScreen: 'SETUP',
    mode: 'LOCAL',
    mySeat: 0,
    online: null,
    localSettings: null,
    onlineSeq: -1,
    lastCustomMap: null,
    mapRotation: readSavedBoardRotation(),
    visibleTiles: new Set(),
    isAiTurn: false,
    finalePending: false,
    mapToEdit: null,
    mapFeedback: null,
    lastMoveSnapshot: null,
    devSandbox: false,
    devFreeplay: true,
    devBotMatch: false,
    devOptions: DEFAULT_DEV_MAP_OPTIONS,
    devPreview: generateDevMap(DEFAULT_DEV_MAP_OPTIONS).map,

    setGameSettings: (newSettings) => {
      set(state => ({ settings: { ...state.settings, ...newSettings } }));
    },

    resumeLocalMatch: () => {
      const saved = loadLocalMatch();
      if (!saved) return false;
      const { game } = saved;
      beginLocal(game, saved.lastCustomMap);
      // Hot-seat shows the board from the seat whose turn it is; vs AI always from seat 0.
      const viewer = game.settings.gameMode === 'PVE' ? 0 : game.currentPlayer;
      const ai = aiPlays(game);
      set({ visibleTiles: visibleSet(game, viewer), isAiTurn: ai });
      if (ai) get().runAiLoop();
      scheduleBotSpectator();
      return true;
    },

    startGame: () => {
      set({ currentScreen: 'GAME' });
      get().initializeMap();
    },

    openEditor: () => set({ currentScreen: 'EDITOR', mapToEdit: null }),
    exitEditor: () => set({ currentScreen: 'SETUP' }),

    openDevMaps: () =>
      set(state => ({ currentScreen: 'DEV', devPreview: generateDevMap(state.devOptions).map })),
    exitDevMaps: () => {
      botMatchActive = false;
      aiLoopSeq++;
      set({ currentScreen: 'SETUP', devSandbox: false, devBotMatch: false, isAiTurn: false, finalePending: false });
    },
    setDevOptions: (patch) => {
      const devOptions = { ...get().devOptions, ...patch };
      set({ devOptions, devPreview: generateDevMap(devOptions).map });
    },
    rollDevSeed: () => get().setDevOptions({ seed: generateSectorSeed() }),
    setDevBotMatch: (on) => {
      if (!on) {
        botMatchActive = false;
        aiLoopSeq++;
        set({ devBotMatch: false, isAiTurn: false });
        return;
      }
      set({ devBotMatch: true });
      const state = get();
      // A hot-seat sandbox has no AI seat: relaunch it as a bot match on the same board/settings.
      if (state.devSandbox && state.settings.gameMode !== 'PVE') {
        get().launchDevSandbox();
        return;
      }
      set({ isAiTurn: state.currentScreen === 'GAME' });
      if (state.currentScreen === 'GAME' && state.devSandbox) get().runAiLoop();
    },
    setDevFreeplay: (on) =>
      set(state => ({
        devFreeplay: on,
        ...CLEAR_SELECTION,
        selectedUnitId: null,
        // Entering pure sandbox tops the battery up: nothing should be gated on CP while testing.
        playerCp: on ? topUpPlayerCp(state.playerCp) : state.playerCp,
      })),
    devMoveUnit: (unitId, tileId) => {
      const state = get();
      if (!state.devSandbox || !state.devFreeplay) return;
      if (!state.units.some(u => u.id === unitId)) return;
      // Units may not stand on Banks, Bases, or Barriers even in freeplay teleport.
      const targetTile = getTileByIdFast(state.mapData, tileId, state.gridSize);
      if (!targetTile || targetTile.type === 'BANK' || targetTile.type === 'BASE' || targetTile.type === 'BARRIER') return;
      if (state.units.some(u => u.tileId === tileId && u.id !== unitId)) return;
      set({
        units: state.units.map(u => (u.id === unitId ? { ...u, tileId, hasMoved: false, completed: false } : u)),
        selectedUnitId: unitId,
        selectedTileId: tileId,
        hoveredTileId: tileId,
      });
    },
    devAttackUnit: (attackerId, targetId) => {
      const state = get();
      if (!state.devSandbox || !state.devFreeplay) return;
      if (state.mode === 'ONLINE') return;
      const ammoBefore = new Map(state.units.map(u => [u.id, u.ammo] as const));
      // Straight into the engine's combat resolution: validation (range, line of sight, CP, ammo,
      // whose turn it is) is the only thing skipped, so damage, crossfire, deaths and kill cams are
      // the real thing.
      const result = applyAction(state, { type: 'ATTACK', attackerId, targetUnitId: targetId, cost: 0 });
      if (result.rejected) return;
      const next = result.state;
      highlightRecorder.record({
        turn: next.totalTurns + 1,
        seed: next.activeSeed,
        preUnits: state.units,
        preMapData: state.mapData,
        postUnits: next.units,
        postMapData: next.mapData,
        events: result.events,
      });
      playEvents(result.events, next.units, state.units);
      const viewer = next.settings.gameMode === 'PVE' ? 0 : next.currentPlayer;
      const committed = commitGameView(state, next, visibleSet(next, viewer), viewer, false, false);
      set({
        ...committed,
        // Nothing in the sandbox runs out: no ammo, no readiness, no match end.
        units: next.units.map(u => ({
          ...u,
          completed: false,
          hasMoved: false,
          ammo: Math.max(u.ammo, ammoBefore.get(u.id) ?? u.ammo),
        })),
        winner: null,
        matchSummary: null,
        selectedUnitId: attackerId,
        selectedTileId: next.units.find(u => u.id === attackerId)?.tileId ?? null,
        placementMode: null,
        playerCp: topUpPlayerCp(next.playerCp),
      });
    },
    devSiegeStructure: (attackerId, tileId) => {
      const state = get();
      if (!state.devSandbox || !state.devFreeplay) return;
      if (state.mode === 'ONLINE') return;
      const tile = getTileByIdFast(state.mapData, tileId, state.gridSize);
      // Structures without hp are not siege targets; the engine would reject them anyway.
      if (!tile || tile.hp === undefined) return;
      const ammoBefore = new Map(state.units.map(u => [u.id, u.ammo] as const));
      const result =
        tile.type === 'BARRIER'
          ? applyAction(state, { type: 'DEMOLISH', unitId: attackerId, tileId, cost: 0 })
          : applyAction(state, { type: 'SIEGE', unitId: attackerId, tileId, cost: 0 });
      if (result.rejected) return;
      const next = result.state;
      highlightRecorder.record({
        turn: next.totalTurns + 1,
        seed: next.activeSeed,
        preUnits: state.units,
        preMapData: state.mapData,
        postUnits: next.units,
        postMapData: next.mapData,
        events: result.events,
      });
      playEvents(result.events, next.units, state.units);
      const viewer = next.settings.gameMode === 'PVE' ? 0 : next.currentPlayer;
      const committed = commitGameView(state, next, visibleSet(next, viewer), viewer, false, false);
      set({
        ...committed,
        // Same as unit strikes: nothing runs out and the match never ends mid-test.
        units: next.units.map(u => ({
          ...u,
          completed: false,
          hasMoved: false,
          ammo: Math.max(u.ammo, ammoBefore.get(u.id) ?? u.ammo),
        })),
        winner: null,
        matchSummary: null,
        bankRewardPending: null,
        selectedUnitId: attackerId,
        selectedTileId: next.units.find(u => u.id === attackerId)?.tileId ?? null,
        placementMode: null,
        playerCp: topUpPlayerCp(next.playerCp),
      });
    },
    launchDevSandbox: () => {
      const { settings, devOptions, devPreview, devBotMatch } = get();
      const game = createCustomMapGame(
        // Bot match: PVE rules so both seats are AI-driven; otherwise hot-seat with no bot.
        {
          ...settings,
          playerCount: devOptions.playerCount,
          mapSeed: devOptions.seed,
          gameMode: devBotMatch ? 'PVE' : 'PVP',
          fogOfWar: devBotMatch ? false : settings.fogOfWar,
        },
        devPreview,
      );
      beginLocal(game, cloneTiles(devPreview));
      botMatchActive = devBotMatch;
      set({
        devSandbox: true,
        currentScreen: 'GAME',
        isAiTurn: devBotMatch,
        // A simulated match runs the real rules on the real game screen: no free CP, no cheat
        // placement. The brush/event panel stays available if you want to interrupt it.
        devFreeplay: devBotMatch ? false : get().devFreeplay,
        playerCp: !devBotMatch && get().devFreeplay ? topUpPlayerCp(get().playerCp) : get().playerCp,
      });
      if (devBotMatch) get().runAiLoop();
    },
    devPlace: (x, y, brush) => {
      const state = get();
      if (!state.devSandbox) return;
      const tileId = `${x},${y}`;
      const tile = getTileByIdFast(state.mapData, tileId, state.gridSize);
      if (!tile) return;

      if (brush.kind === 'UNIT') {
        if (tile.type === 'BANK' || tile.type === 'BASE' || tile.type === 'BARRIER') return;
        if (state.units.some(u => u.tileId === tileId)) return;
        const unit = createUnit({
          id: `dev_${state.units.length}_${Date.now().toString(36)}`,
          type: brush.unitType,
          owner: brush.owner,
          tileId,
        });
        set({ units: [...state.units, unit], selectedUnitId: unit.id });
        return;
      }

      if (
        brush.kind === 'STRUCTURE' &&
        (brush.structure === 'BASE' || brush.structure === 'BANK' || brush.structure === 'BARRIER') &&
        state.units.some(u => u.tileId === tileId)
      ) {
        return;
      }

      const mapData = state.mapData.map(t => {
        if (t.id !== tileId) return t;
        if (brush.kind === 'TERRAIN') {
          const height = brush.terrain === 'MOUNTAIN' || brush.terrain === 'DUNES' ? 2 : brush.terrain === 'WATER' ? 0 : 1;
          return { ...t, type: brush.terrain, height, subType: undefined, owner: undefined };
        }
        if (brush.structure === 'BASE') {
          return { ...t, type: 'BASE' as const, owner: brush.owner, height: 1, hp: BASE_STATS.HP, maxHp: BASE_STATS.HP, subType: undefined };
        }
        if (brush.structure === 'BANK') {
          return {
            ...t,
            type: 'BANK' as const,
            owner: null,
            height: 1,
            hp: BANK_STATS.HP,
            maxHp: BANK_STATS.HP,
            hackProgress: 0,
            subType: undefined,
          };
        }
        if (brush.structure === 'BARRIER') {
          return {
            ...t,
            type: 'BARRIER' as const,
            owner: null,
            height: 1,
            hp: BARRIER_STATS.HP,
            maxHp: BARRIER_STATS.HP,
            subType: undefined,
          };
        }
        return {
          ...t,
          type: 'BUILDING' as const,
          subType: brush.structure === 'WATCHTOWER' ? ('WATCHTOWER' as const) : ('BUNKER' as const),
          owner: null,
          height: 1,
        };
      });
      set({ mapData });
    },
    devFireEvent: (kind) => {
      const state = get();
      if (!state.devSandbox) return;
      const tileOf = (tileId: string) => getTileByIdFast(state.mapData, tileId, state.gridSize);
      const clampGrid = (v: number) => Math.max(0, Math.min(state.gridSize - 1, v));

      const recordDev = (events: GameEvent[], preUnits: Unit[], postUnits: Unit[]) => {
        highlightRecorder.record({
          turn: state.totalTurns + 1,
          seed: state.activeSeed || state.devOptions.seed,
          preUnits,
          preMapData: state.mapData,
          postUnits,
          postMapData: state.mapData,
          events,
        });
      };

      /** Dispatches a synthesized batch and commits the resulting unit roster (deaths included). */
      const fireBatch = (
        events: GameEvent[],
        positions: Record<string, string> = {},
        preHp?: { unitId: string; hp: number },
      ) => {
        if (events.length === 0) return;
        const dead = new Set<string>();
        for (const e of events) {
          if (e.kind === 'killed') dead.add(e.unitId);
          else if (e.kind === 'mineBlast' && e.victimDead && e.victimUnitId) dead.add(e.victimUnitId);
        }
        // Non-lethal matrix hits still wound the targeted unit so the board matches the cut.
        const hitDamage = new Map<string, number>();
        for (const e of events) {
          if (e.kind === 'hit' && !e.isKill) hitDamage.set(e.targetUnitId, (hitDamage.get(e.targetUnitId) ?? 0) + e.damage);
        }
        // A staged cut (corner framing, or a 1-HP graze victim) presents the actors as the cue
        // telemetry describes them, so the director classifies the situation the panel advertises.
        const staged = state.units.map(u => {
          const tileId = positions[u.id];
          const hp = preHp && preHp.unitId === u.id ? preHp.hp : undefined;
          if (!tileId && hp === undefined) return u;
          return { ...u, ...(tileId ? { tileId } : {}), ...(hp !== undefined ? { hp } : {}) };
        });
        const postUnits = staged
          .filter(u => !dead.has(u.id))
          .map(u => {
            const dmg = hitDamage.get(u.id);
            return dmg ? { ...u, hp: Math.max(1, u.hp - dmg) } : u;
          });
        recordDev(events, staged, postUnits);
        playEvents(events, postUnits, staged);
        set({ units: postUnits, selectedUnitId: null });
      };

      /** Geometry for matrix-built events: the first enemy as victim, its opponent as killer. */
      const devCtx = (): DevEventContext | null => {
        const victimUnit = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        const killerUnit = victimUnit ? state.units.find(u => u.owner !== victimUnit.owner) ?? victimUnit : undefined;
        const victimTile = victimUnit ? tileOf(victimUnit.tileId) : null;
        const killerTile = killerUnit ? tileOf(killerUnit.tileId) : null;
        if (!victimUnit || !killerUnit || !victimTile || !killerTile) return null;
        return {
          gridSize: state.gridSize,
          currentPlayer: state.currentPlayer,
          victim: {
            id: victimUnit.id,
            type: victimUnit.type,
            owner: victimUnit.owner,
            hp: victimUnit.hp,
            rank: victimUnit.rank ?? 0,
            x: victimTile.x,
            y: victimTile.y,
            terrain: victimTile.type,
          },
          killer: {
            id: killerUnit.id,
            type: killerUnit.type,
            owner: killerUnit.owner,
            hp: killerUnit.hp,
            rank: killerUnit.rank ?? 0,
            x: killerTile.x,
            y: killerTile.y,
            terrain: killerTile.type,
          },
          flank: [
            { x: clampGrid(victimTile.x + (victimTile.x > 2 ? -2 : 2)), y: clampGrid(victimTile.y + (victimTile.y > 2 ? -1 : 1)) },
            { x: clampGrid(victimTile.x + (victimTile.x < state.gridSize - 3 ? 2 : -2)), y: clampGrid(victimTile.y + (victimTile.y < state.gridSize - 3 ? 1 : -1)) },
          ],
          structure: null,
        };
      };

      const ensureDemoHighlight = () => {
        if (highlightRecorder.getBest()) return;
        const victim = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        const killer = state.units.find(u => victim && u.owner !== victim.owner) ?? victim;
        if (!victim || !killer) return;
        const vt = tileOf(victim.tileId);
        const kt = tileOf(killer.tileId);
        if (!vt || !kt) return;
        const flank = { x: clampGrid(vt.x + (vt.x > 2 ? -2 : 2)), y: clampGrid(vt.y + (vt.y > 2 ? -1 : 1)) };
        const events: GameEvent[] = [
          {
            kind: 'projectile',
            from: { x: kt.x, y: kt.y },
            to: { x: vt.x, y: vt.y },
            style: 'LASER',
            weapon: 'SNIPER',
            attackerId: killer.id,
            targetUnitId: victim.id,
            travelMs: 280,
          },
          {
            kind: 'hit',
            targetUnitId: victim.id,
            at: { x: vt.x, y: vt.y },
            from: { x: kt.x, y: kt.y },
            damage: 18,
            weapon: 'SNIPER',
            isKill: true,
            crossfireFrom: [flank],
            breakdown: {
              baseDamage: 12,
              watchtowerBoosted: true,
              coverPct: 0.4,
              coverTerrain: 'FOREST',
              coverArmorApplied: false,
              crossfireBonus: 2,
            },
          },
          {
            kind: 'killed',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            rank: 3,
            at: { x: vt.x, y: vt.y },
            killerOwner: killer.owner,
            killerUnitId: killer.id,
            killerUnitType: killer.type,
            victimPreHp: victim.hp,
            zeroCpClutch: true,
            cause: 'COMBAT',
          },
        ];
        recordDev(events, state.units, state.units.filter(u => u.id !== victim.id));
      };

      if (kind === 'POTM_REPLAY') {
        ensureDemoHighlight();
        get().playPlayOfTheMatch();
        return;
      }

      if (kind === 'EXPORT_CLIP') {
        ensureDemoHighlight();
        void get().exportPlayOfTheMatch();
        return;
      }

      if (kind === 'TURN_RECAP') {
        const enemyUnits = state.units.filter(u => u.owner !== state.currentPlayer);
        const friendlyUnits = state.units.filter(u => u.owner === state.currentPlayer);
        const mover1 = enemyUnits[0] ?? state.units[0];
        const mover2 = enemyUnits[1] ?? mover1;
        const target = friendlyUnits[0] ?? state.units[1] ?? mover1;
        if (!mover1 || !mover2 || !target) return;
        const m1Tile = tileOf(mover1.tileId);
        const m2Tile = tileOf(mover2.tileId);
        const tTile = tileOf(target.tileId);
        if (!m1Tile || !m2Tile || !tTile) return;
        const step1 = { x: clampGrid(m1Tile.x + (m1Tile.x < state.gridSize - 2 ? 1 : -1)), y: m1Tile.y };
        const step2 = { x: clampGrid(m2Tile.x), y: clampGrid(m2Tile.y + (m2Tile.y < state.gridSize - 2 ? 1 : -1)) };
        const afterMove1 = state.units.map(u => (u.id === mover1.id ? { ...u, tileId: `${step1.x},${step1.y}` } : u));
        const afterMove2 = afterMove1.map(u => (u.id === mover2.id ? { ...u, tileId: `${step2.x},${step2.y}` } : u));
        const batches: MissedActionBatch[] = [
          {
            seq: 1,
            actorSeat: mover1.owner,
            round: state.totalTurns + 1,
            preUnits: state.units.map(u => ({ ...u })),
            events: [
              {
                kind: 'movePath',
                unitId: mover1.id,
                unitType: mover1.type,
                owner: mover1.owner,
                path: [{ x: m1Tile.x, y: m1Tile.y }, step1],
              },
            ],
          },
          {
            seq: 2,
            actorSeat: mover2.owner,
            round: state.totalTurns + 1,
            preUnits: afterMove1.map(u => ({ ...u })),
            events: [
              {
                kind: 'movePath',
                unitId: mover2.id,
                unitType: mover2.type,
                owner: mover2.owner,
                path: [{ x: m2Tile.x, y: m2Tile.y }, step2],
              },
            ],
          },
          {
            seq: 3,
            actorSeat: mover1.owner,
            round: state.totalTurns + 1,
            preUnits: afterMove2.map(u => ({ ...u })),
            events: [
              {
                kind: 'projectile',
                from: step1,
                to: { x: tTile.x, y: tTile.y },
                style: 'LASER',
                weapon: 'SNIPER',
                attackerId: mover1.id,
                targetUnitId: target.id,
                travelMs: 240,
              },
              {
                kind: 'hit',
                targetUnitId: target.id,
                at: { x: tTile.x, y: tTile.y },
                from: step1,
                damage: target.hp + 4,
                weapon: 'SNIPER',
                isKill: true,
                breakdown: {
                  baseDamage: 12,
                  watchtowerBoosted: true,
                  coverPct: 0,
                  coverTerrain: tTile.type,
                  coverArmorApplied: false,
                  crossfireBonus: 2,
                },
              },
              {
                kind: 'killed',
                unitId: target.id,
                unitType: target.type,
                owner: target.owner,
                rank: (target.rank ?? 0) as UnitRank,
                at: { x: tTile.x, y: tTile.y },
                killerOwner: mover1.owner,
                killerUnitId: mover1.id,
                killerUnitType: mover1.type,
                victimPreHp: target.hp,
                cause: 'COMBAT',
              },
            ],
          },
        ];
        recapPlayer.startMissedRecap(batches, createRecapBridge(state.units, state.mapData));
        return;
      }

      // ── Every auditionable cut comes from the coverage matrix: one builder feeds the panel, the
      //    store and the contract test, so a button can never advertise a cut it does not play.
      const spec = DEV_EVENT_MAP[kind];
      if (!spec || !spec.build) return;

      const base = devCtx();
      if (!base) return;

      let structure: DevEventContext['structure'] = null;
      if (spec.structureTarget === 'BARRIER') {
        const existing = state.mapData.find(t => t.type === 'BARRIER');
        if (existing) {
          structure = { x: existing.x, y: existing.y, type: 'BARRIER', owner: existing.owner ?? null };
        } else {
          const spots = [
            { x: clampGrid(base.victim.x + 1), y: base.victim.y },
            { x: clampGrid(base.victim.x - 1), y: base.victim.y },
            { x: base.victim.x, y: clampGrid(base.victim.y + 1) },
            { x: base.victim.x, y: clampGrid(base.victim.y - 1) },
          ];
          const spot = spots.find(p => {
            const t = tileOf(`${p.x},${p.y}`);
            return !!t && t.type === 'PLAINS' && !state.units.some(u => u.tileId === t.id);
          });
          if (!spot) return;
          // Nothing to blow up yet: drop one beside the victim so the cut can be auditioned.
          get().devPlace(spot.x, spot.y, { kind: 'STRUCTURE', structure: 'BARRIER', owner: 0 });
          const brushed = getTileByIdFast(get().mapData, `${spot.x},${spot.y}`, state.gridSize);
          if (brushed) structure = { x: brushed.x, y: brushed.y, type: 'BARRIER', owner: brushed.owner ?? null };
        }
      } else if (spec.structureTarget) {
        const target =
          spec.structureTarget === 'BANK'
            ? state.mapData.find(t => t.type === 'BANK')
            : state.mapData.find(t => t.type === 'BASE' && t.owner !== state.currentPlayer) ??
              state.mapData.find(t => t.type === 'BASE');
        if (target) {
          structure = {
            x: target.x,
            y: target.y,
            type: target.type as 'BASE' | 'BANK' | 'BARRIER',
            owner: target.owner ?? null,
          };
        }
      }
      if (spec.structureTarget && !structure) return;

      const stage = spec.stage?.(base);
      const ctx: DevEventContext = {
        ...base,
        structure,
        victim: stage?.victim ? { ...base.victim, ...stage.victim } : base.victim,
        killer: stage?.killer ? { ...base.killer, ...stage.killer } : base.killer,
      };
      const positions: Record<string, string> = {};
      if (stage?.victim) positions[base.victim.id] = `${stage.victim.x},${stage.victim.y}`;
      if (stage?.killer) positions[base.killer.id] = `${stage.killer.x},${stage.killer.y}`;

      // An ATTACK cue's `remainingHp` is the victim's HP at cue time, which is what decides the
      // graze fake-out: present the victim in that state before the round lands.
      const preHp =
        spec.probe?.subject === 'ATTACK' && spec.probe.remainingHp !== undefined
          ? { unitId: base.victim.id, hp: spec.probe.remainingHp }
          : undefined;

      fireBatch(spec.build(ctx), positions, preHp);
    },
    openTutorial: () => set({ currentScreen: 'TUTORIAL' }),
    exitTutorial: () => set({ currentScreen: 'SETUP' }),
    openOnline: () => set({ currentScreen: 'ONLINE' }),
    loadMapIntoEditor: (map: SavedMap) => set({ currentScreen: 'EDITOR', mapToEdit: map }),

    rotateMap: (delta = 90) => {
      const next = nextBoardRotation(get().mapRotation, delta);
      saveBoardRotation(next);
      set({ mapRotation: next });
    },

    setMapRotation: (rot) => {
      saveBoardRotation(rot);
      set({ mapRotation: rot });
    },

    loadMapAndStart: (customMap: Tile[]) => {
      beginLocal(createCustomMapGame(get().settings, customMap), cloneTiles(customMap));
    },

    initializeMap: () => {
      beginLocal(createGeneratedGame(get().settings), null);
    },

    startChallenge: (challengeId: string) => {
      const game = createChallengeGame(get().settings, challengeId);
      if (game) beginLocal(game, null);
    },

    resetGame: () => {
      recapPlayer.stop();
      highlightRecorder.reset();
      useEffectStore.getState().clearAllFx();
      botMatchActive = false;
      matchFilmPlayed = false;
      aiLoopSeq++;
      if (get().mode === 'ONLINE') {
        get().online?.leave();
        return;
      }
      set({
        currentScreen: 'SETUP',
        winner: null,
        finalePending: false,
        matchSummary: null,
        activeMission: null,
        mapData: [],
        units: [],
        gameLog: [],
        lastCustomMap: null,
        lastMoveSnapshot: null,
        mapFeedback: null,
      });
    },

    retryCurrentMatch: () => {
      const { activeMission, lastCustomMap, activeSeed, settings, mode } = get();
      if (mode === 'ONLINE') return;
      if (activeMission) {
        get().startChallenge(activeMission.id);
        return;
      }
      if (lastCustomMap) {
        get().loadMapAndStart(lastCustomMap);
        return;
      }
      set({ settings: { ...settings, mapSeed: activeSeed } });
      get().startGame();
    },

    setHoveredTile: (tileId) => {
      if (get().hoveredTileId !== tileId) set({ hoveredTileId: tileId });
    },

    handleGraveyardSelect: (deadUnitId) => {
      const state = get();
      if (state.isAiTurn || state.winner !== null) return;
      if (spawnBlocker(state, state.currentPlayer, deadUnitId)) return;
      set({
        ...CLEAR_SELECTION,
        hoveredTileId: state.hoveredTileId,
        selectedGraveyardUnitId: deadUnitId,
        validSpawnTiles: getSpawnTiles(state, state.currentPlayer),
      });
    },

    selectUnitById: (unitId) => {
      const state = get();
      if (state.winner !== null) return;
      const unit = state.units.find(u => u.id === unitId);
      if (!unit) return;
      const viewer = viewerSeat(state);
      if (!isUnitVisible(unit, viewer, state.settings.fogOfWar, state.visibleTiles)) return;
      const canCommand =
        !state.isAiTurn &&
        !unit.completed &&
        unit.owner === state.currentPlayer &&
        state.playerStatus[state.currentPlayer] !== 'ELIMINATED';
      if (canCommand) {
        set({
          ...CLEAR_SELECTION,
          ...optionsSelectionFor(state, unit, state.visibleTiles),
          hoveredTileId: unit.tileId,
        });
        return;
      }
      // Already acted, or it isn't this seat's turn: look at it without offering commands.
      set({
        ...CLEAR_SELECTION,
        selectedUnitId: unit.id,
        selectedTileId: unit.tileId,
        hoveredTileId: unit.tileId,
      });
    },

    selectInventoryItem: (index) => {
      const state = get();
      if (state.isAiTurn || state.winner !== null) return;
      if (index === null) {
        set({ selectedInventoryItemIndex: null });
        return;
      }
      set({
        ...CLEAR_SELECTION,
        hoveredTileId: state.hoveredTileId,
        selectedInventoryItemIndex: index,
      });
    },

    selectNextReadyUnit: () => {
      const { units, currentPlayer, selectedUnitId, mapData, gridSize, isAiTurn, winner } = get();
      if (isAiTurn || winner !== null) return;
      const ready = units.filter(u => u.owner === currentPlayer && !u.completed);
      if (ready.length === 0) return;
      const currentIdx = ready.findIndex(u => u.id === selectedUnitId);
      const next = ready[(currentIdx + 1) % ready.length];
      const tile = getTileByIdFast(mapData, next.tileId, gridSize);
      if (tile) get().handleTileClick(tile.x, tile.y);
    },

    reloadUnit: () => {
      const { selectedUnitId, units, playerCp, currentPlayer, isAiTurn, winner } = get();
      const unit = isAiTurn || winner !== null ? undefined : units.find(u => u.id === selectedUnitId && u.owner === currentPlayer);
      if (!unit || unit.completed || unit.ammo >= unit.maxAmmo) return;
      if ((playerCp[currentPlayer] ?? 0) < CP_SYSTEM.RELOAD_COST) return;
      get().executeAiAction({ type: 'RELOAD', unitId: unit.id, cost: CP_SYSTEM.RELOAD_COST });
    },

    enterOverwatch: () => {
      const { selectedUnitId, units, playerCp, currentPlayer, mapData, gridSize, isAiTurn, winner } = get();
      const unit = isAiTurn || winner !== null ? undefined : units.find(u => u.id === selectedUnitId && u.owner === currentPlayer);
      if (!unit) return;
      const tile = getTileByIdFast(mapData, unit.tileId, gridSize);
      if (!canUnitEnterOverwatch(unit, tile, playerCp[currentPlayer] ?? 0)) return;
      get().executeAiAction({ type: 'OVERWATCH', unitId: unit.id, cost: OVERWATCH_STATS[unit.type].cost });
    },

    handleTileClick: (x, y) => {
      const state = get();
      const {
        units, currentPlayer, selectedUnitId, selectedGraveyardUnitId, selectedInventoryItemIndex,
        validMoveCosts, mapData, gridSize, validAttackTargets, winner, graveyard, validSpawnTiles, settings, isAiTurn, placementMode,
      } = state;

      const clickedTileId = `${x},${y}`;
      const tile = getTileByIdFast(mapData, clickedTileId, gridSize);
      // A unit you can see (under fog, only those in your sight)
      const viewer = viewerSeat(state);
      const seenUnit = units.find(
        u => u.tileId === clickedTileId && isUnitVisible(u, viewer, settings.fogOfWar, state.visibleTiles),
      );
      /** Look at a unit or tile without commanding it: its card shows in Tactical Intel. */
      const inspect = () =>
        set({
          ...CLEAR_SELECTION,
          hoveredTileId: state.hoveredTileId,
          placementMode: state.placementMode,
          selectedUnitId: seenUnit?.id ?? null,
          selectedTileId: clickedTileId,
        });

      const sandboxFree = state.devSandbox && state.devFreeplay;

      // Not your move (someone else's turn, a vault to claim, or the match is over): you can
      // still inspect anything you can see.
      if (!sandboxFree && (winner !== null || state.bankRewardPending || isAiTurn)) {
        inspect();
        return;
      }

      // Placing a Tactical Weapon, Barrier wall, Land Mine, Bridge, or Airdrop Beacon bought from the shop.
      // Runs BEFORE pure-sandbox teleport so armed weapons/builds work identically in Dev Sandbox!
      if (placementMode && placementMode.active && tile && !isAiTurn && winner === null) {
        if (placementMode.kind === 'TACTICAL') {
          const itemKey = placementMode.itemKey as TacticalId;
          const def = TACTICAL_ITEMS[itemKey];
          const visible = state.settings.fogOfWar ? state.visibleTiles : null;
          const tacState = sandboxFree ? sandboxTacticalState(state) : state;

          // Carpet Run: pick 1 to 3 distinct visible enemy units; fires immediately on 3rd pick or when no more enemies remain.
          if (def?.shape === 'UNITS3') {
            const prevSelected = placementMode.selectedTiles ?? [];
            if (prevSelected.includes(clickedTileId)) {
              const nextSelected = prevSelected.filter(id => id !== clickedTileId);
              const validTiles = legalTacticalAnchors(tacState, currentPlayer, itemKey, {
                tileIds: nextSelected,
                visible,
              });
              set({ placementMode: { ...placementMode, selectedTiles: nextSelected, validTiles } });
              SoundFX.play('click');
              return;
            }
            if (!placementMode.validTiles.includes(clickedTileId)) {
              get().showMapFeedback(clickedTileId, 'Pick visible enemy units (up to 3 targets)', 'warn');
              return;
            }
            const nextSelected = [...prevSelected, clickedTileId];
            const remaining = legalTacticalAnchors(tacState, currentPlayer, itemKey, {
              tileIds: nextSelected,
              visible,
            });
            if (nextSelected.length >= 3 || remaining.length === 0) {
              set({ placementMode: null });
              get().executeAiAction({
                type: 'USE_TACTICAL',
                itemKey,
                tileId: nextSelected[0],
                tileIds: nextSelected,
              });
              return;
            }
            set({ placementMode: { ...placementMode, selectedTiles: nextSelected, validTiles: remaining } });
            SoundFX.play('click');
            return;
          }

          // Paradrop: Step 1 pick any visible unit (yours or enemy); Step 2 pick open landing tile.
          if (def?.shape === 'RELOCATE') {
            if (!placementMode.tacticalUnitId) {
              const picked = state.units.find(
                u => u.tileId === clickedTileId && (!visible || u.owner === currentPlayer || visible.has(u.tileId)),
              );
              if (!picked) {
                get().showMapFeedback(clickedTileId, 'Step 1: Pick any visible unit (yours or enemy) to airlift', 'warn');
                return;
              }
              const dests = legalParadropDestinations(tacState, currentPlayer, picked.id, visible);
              if (dests.length === 0) {
                get().showMapFeedback(clickedTileId, 'No legal landing tiles available for that unit', 'warn');
                return;
              }
              SoundFX.play('click');
              set({
                placementMode: {
                  ...placementMode,
                  tacticalUnitId: picked.id,
                  selectedTiles: [picked.tileId],
                  validTiles: dests,
                },
              });
              return;
            }

            const pickedUnit = state.units.find(u => u.id === placementMode.tacticalUnitId);
            if (!pickedUnit) {
              set({ placementMode: null });
              return;
            }
            if (clickedTileId === pickedUnit.tileId) {
              const unitTiles = legalTacticalAnchors(tacState, currentPlayer, itemKey, { visible });
              SoundFX.play('click');
              set({
                placementMode: {
                  ...placementMode,
                  tacticalUnitId: undefined,
                  selectedTiles: undefined,
                  validTiles: unitTiles,
                },
              });
              return;
            }
            if (!placementMode.validTiles.includes(clickedTileId)) {
              const reason =
                paradropDestinationBlocker(tacState, currentPlayer, pickedUnit.owner, pickedUnit.tileId, tile, visible) ??
                'Pick a highlighted open landing tile';
              get().showMapFeedback(clickedTileId, reason, 'warn');
              return;
            }
            set({ placementMode: null });
            get().executeAiAction({
              type: 'USE_TACTICAL',
              itemKey,
              unitId: pickedUnit.id,
              tileId: clickedTileId,
            });
            return;
          }

          if (!placementMode.validTiles.includes(clickedTileId)) {
            const reason =
              tacticalBlocker(tacState, currentPlayer, itemKey, {
                tileId: clickedTileId,
                axis: placementMode.tacticalAxis,
                width: def?.shape === 'LANE' ? 2 : undefined,
                visible,
              }) ?? 'Pick a highlighted tile for the tactical weapon';
            get().showMapFeedback(clickedTileId, reason, 'warn');
            return;
          }
          const action = {
            type: 'USE_TACTICAL' as const,
            itemKey,
            tileId: clickedTileId,
            axis: placementMode.tacticalAxis,
            width: def?.shape === 'LANE' ? (2 as const) : undefined,
          };
          set({ placementMode: null });
          get().executeAiAction(action);
          return;
        }
        if (placementMode.kind === 'CONSTRUCT') {
          const requiredCount = placementMode.requiredCount ?? 1;
          const prevSelected = placementMode.selectedTiles ?? [];
          if (requiredCount > 1) {
            if (prevSelected.includes(clickedTileId)) {
              set({
                placementMode: {
                  ...placementMode,
                  selectedTiles: prevSelected.filter(id => id !== clickedTileId),
                },
              });
              SoundFX.play('click');
              return;
            }
            if (placementMode.validTiles.includes(clickedTileId)) {
              const nextSelected = [...prevSelected, clickedTileId];
              if (nextSelected.length >= requiredCount) {
                get().executeAiAction({
                  type: 'BUILD',
                  itemKey: placementMode.itemKey,
                  tileId: nextSelected[0],
                  tileIds: nextSelected,
                  variant: placementMode.variant,
                });
              } else {
                set({ placementMode: { ...placementMode, selectedTiles: nextSelected } });
                SoundFX.play('click');
              }
            } else {
              get().showMapFeedback(clickedTileId, 'Pick a highlighted cyan tile to place Barrier', 'warn');
            }
            return;
          }

          if (placementMode.validTiles.includes(clickedTileId)) {
            get().executeAiAction({ type: 'BUILD', itemKey: placementMode.itemKey, tileId: clickedTileId, variant: placementMode.variant });
          } else if (placementMode.itemKey === 'LAND_MINE' && isWithinEnemyHqExclusion(tile, currentPlayer, mapData)) {
            get().showMapFeedback(clickedTileId, 'Cannot place Land Mine within 5 tiles of enemy HQ', 'warn');
          } else {
            get().showMapFeedback(clickedTileId, 'Pick a highlighted cyan tile to build', 'warn');
          }
          return;
        }
        if (placementMode.validTiles.includes(clickedTileId)) {
          get().executeAiAction({ type: 'BUY_ITEM', itemKey: placementMode.itemKey, tileId: clickedTileId });
        } else {
          get().showMapFeedback(clickedTileId, 'Pick a highlighted cyan drop zone', 'warn');
        }
        return;
      }

      // Pure sandbox: pick a unit, click any tile to teleport it, click an enemy to strike it.
      // No ranges, no CP, no terrain costs and no turn order — nothing here mutates the rules.
      if (sandboxFree) {
        const unitHere = units.find(u => u.tileId === clickedTileId);
        const selected = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null;
        if (selected && unitHere && unitHere.owner !== selected.owner) {
          get().devAttackUnit(selected.id, unitHere.id);
          return;
        }
        if (selected && !unitHere) {
          // A bank vault, an enemy HQ or a barrier is a target, not a landing pad: strike it
          // instead of parking the unit on top of it.
          const structureTarget =
            tile !== null &&
            tile !== undefined &&
            tile.hp !== undefined &&
            ((tile.type === 'BANK' && (tile.hackProgress ?? 0) < 100) ||
              (tile.type === 'BASE' && tile.owner !== selected.owner) ||
              tile.type === 'BARRIER');
          if (structureTarget) {
            get().devSiegeStructure(selected.id, clickedTileId);
            return;
          }
          if (tile && (tile.type === 'BANK' || tile.type === 'BASE' || tile.type === 'BARRIER')) {
            return;
          }
          get().devMoveUnit(selected.id, clickedTileId);
          return;
        }
        set({
          ...CLEAR_SELECTION,
          selectedUnitId: unitHere?.id ?? null,
          selectedTileId: clickedTileId,
          hoveredTileId: clickedTileId,
        });
        return;
      }

      const clickedUnit = seenUnit;

      // Using a supply item: click one of your units (anything else cancels)
      if (selectedInventoryItemIndex !== null) {
        if (clickedUnit && clickedUnit.owner === currentPlayer) {
          get().executeAiAction({ type: 'USE_ITEM', unitId: clickedUnit.id, itemIndex: selectedInventoryItemIndex, cost: 0 });
        }
        set({ selectedInventoryItemIndex: null });
        return;
      }

      // Redeploy a fallen unit
      if (selectedGraveyardUnitId && validSpawnTiles.includes(clickedTileId)) {
        const deadUnit = graveyard.find(u => u.id === selectedGraveyardUnitId);
        if (deadUnit) {
          get().executeAiAction({ type: 'SPAWN', unitType: deadUnit.type, tileId: clickedTileId, cost: RESPAWN_CP_COST[deadUnit.type], deadUnitId: deadUnit.id });
          return;
        }
      }

      const attacker = selectedUnitId ? units.find(u => u.id === selectedUnitId) : undefined;

      if (attacker && clickedUnit && validAttackTargets.includes(clickedUnit.id)) {
        get().executeAiAction({ type: 'ATTACK', attackerId: attacker.id, targetUnitId: clickedUnit.id, cost: getUnitAttackCost(attacker) });
        return;
      }
      if (attacker && state.validSiegeTile === clickedTileId) {
        get().executeAiAction({ type: 'SIEGE', unitId: attacker.id, tileId: clickedTileId, cost: getUnitAttackCost(attacker) });
        return;
      }
      if (attacker && state.validDemolishTile === clickedTileId) {
        get().executeAiAction({ type: 'DEMOLISH', unitId: attacker.id, tileId: clickedTileId, cost: getUnitAttackCost(attacker) });
        return;
      }
      if (selectedUnitId && validMoveCosts.has(clickedTileId)) {
        get().executeAiAction({ type: 'MOVE', unitId: selectedUnitId, targetTileId: clickedTileId, cost: validMoveCosts.get(clickedTileId) || 0 });
        return;
      }

      // Adjacent interactable tiles can be clicked directly once in range
      if (attacker && !attacker.completed && attacker.owner === currentPlayer && clickedTileId !== attacker.tileId) {
        if (state.validSecureTile === clickedTileId) {
          get().executeAiAction({ type: 'SECURE', unitId: attacker.id, tileId: clickedTileId, cost: INTERACT_COST });
          return;
        }
        if (state.validLootTile === clickedTileId) {
          get().executeAiAction({ type: 'LOOT', unitId: attacker.id, tileId: clickedTileId, cost: INTERACT_COST });
          return;
        }
      }

      // Switch immediately when clicking another ready friendly unit
      if (clickedUnit && clickedUnit.owner === currentPlayer && !clickedUnit.completed && clickedUnit.id !== attacker?.id) {
        if (tile) {
          SoundFX.play('click');
          set({
            ...CLEAR_SELECTION,
            hoveredTileId: state.hoveredTileId,
            ...optionsSelectionFor(state, clickedUnit, state.visibleTiles),
          });
        }
        return;
      }

      // Clicking an un-targetable enemy while inspecting or commanding one of your units explains why
      if (attacker && attacker.owner === currentPlayer && clickedUnit && clickedUnit.owner !== currentPlayer && tile) {
        const blocker = attacker.completed
          ? 'Already acted this turn — cannot attack anymore'
          : getAttackBlocker(state, attacker, tile, state.visibleTiles);
        if (blocker && state.mapFeedback?.tileId !== clickedTileId) {
          get().showMapFeedback(clickedTileId, blocker, 'warn');
          return;
        }
      }

      // Clicking empty ground while an already-moved/rooted unit is active or onto Sniper-only / sealed terrain explains why
      if (attacker && attacker.owner === currentPlayer && !attacker.completed && !clickedUnit && tile && clickedTileId !== attacker.tileId) {
        let moveBlocker: string | null = null;
        if (tile.type === 'MOUNTAIN' && attacker.type !== 'SNIPER') {
          moveBlocker = 'Only Snipers can climb Mountains — flank around';
        } else if (tile.type === 'BUILDING' && tile.owner !== currentPlayer) {
          moveBlocker = 'Unowned building blocks passage — secure from an adjacent tile first';
        } else if (tile.type === 'BUILDING' && tile.owner === currentPlayer && tile.subType === 'WATCHTOWER' && attacker.type !== 'SNIPER') {
          moveBlocker = 'Watchtower perches are reserved for Snipers';
        } else if (attacker.isRooted && getStepCost(tile, attacker.type, currentPlayer, state.weather, attacker.rank ?? 0) !== null) {
          moveBlocker = 'Rooted in Quicksand — cannot move this turn';
        } else if (attacker.hasMoved && getStepCost(tile, attacker.type, currentPlayer, state.weather, attacker.rank ?? 0) !== null) {
          moveBlocker = "Can't move — already moved this turn (Attack, Overwatch, or Right-Click to deselect)";
        }
        if (moveBlocker && state.mapFeedback?.tileId !== clickedTileId) {
          get().showMapFeedback(clickedTileId, moveBlocker, 'warn');
          return;
        }
      }

      // Re-clicking your currently selected ready unit keeps selection & shows status if already moved
      if (clickedUnit && clickedUnit.owner === currentPlayer && !clickedUnit.completed && clickedUnit.id === attacker?.id) {
        if (attacker.hasMoved) {
          get().showMapFeedback(clickedTileId, 'Already moved this turn — Attack, Action, or Overwatch (O)', 'warn');
        }
        return;
      }

      // Clicking one of your completed units inspects it AND makes clear it already finished this turn
      if (clickedUnit && clickedUnit.owner === currentPlayer && clickedUnit.completed) {
        inspect();
        get().showMapFeedback(clickedTileId, 'Done this turn — already attacked or acted', 'warn');
        return;
      }

      // Anything else (an enemy, a unit that has acted, a tile): inspect it
      inspect();
    },

    secureBuilding: () => dispatchSelectedUnitAction(get().validSecureTile, (unitId, tileId) => ({ type: 'SECURE', unitId, tileId, cost: INTERACT_COST })),


    siegeBase: () => dispatchSelectedUnitAction(get().validSiegeTile, (unitId, tileId, unit) => ({ type: 'SIEGE', unitId, tileId, cost: getUnitAttackCost(unit) })),

    demolishBarrier: () => dispatchSelectedUnitAction(get().validDemolishTile, (unitId, tileId, unit) => ({ type: 'DEMOLISH', unitId, tileId, cost: getUnitAttackCost(unit) })),

    lootSupply: () => dispatchSelectedUnitAction(get().validLootTile, (unitId, tileId) => ({ type: 'LOOT', unitId, tileId, cost: INTERACT_COST })),

    resolveBankReward: (choice) => {
      if (get().bankRewardPending) get().executeAiAction({ type: 'BANK_REWARD', choice });
    },

    buyShopItem: (itemKey: string, variant?: string) => {
      const state = get();
      const { currentPlayer, playerGold, isAiTurn, winner } = state;
      const item = SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS];
      const hasShopVoucher = (state.playerShopVouchers?.[currentPlayer] ?? []).includes(itemKey as any);
      if (!item || isAiTurn || winner !== null || (!hasShopVoucher && playerGold[currentPlayer] < item.cost)) return;
      if (item.type === 'CONSTRUCT') {
        const flareTileIds = new Set(
          (state.airDrops ?? [])
            .filter(d => d.phase === 'FLARE' && d.tileId)
            .map(d => d.tileId!),
        );
        const ctx = { playerId: currentPlayer, mapData: state.mapData, mines: state.mines, flareTileIds };
        const validTiles = state.mapData
          .filter(t => canConstructOnTile(itemKey, t, state.units, ctx))
          .map(t => t.id);
        if (validTiles.length === 0) {
          get().showMapFeedback(
            state.units.find(u => u.owner === currentPlayer)?.tileId ?? state.mapData[0]?.id ?? '0,0',
            `No valid tiles available for ${item.name}`,
            'warn',
          );
          return;
        }
        const requiredCount = itemKey === 'BARRIER' ? Math.min(BARRIER_STATS.BUILD_COUNT, validTiles.length) : 1;
        set({
          ...CLEAR_SELECTION,
          hoveredTileId: state.hoveredTileId,
          placementMode: {
            active: true,
            itemKey,
            cost: hasShopVoucher ? 0 : item.cost,
            kind: 'CONSTRUCT',
            validTiles,
            selectedTiles: [],
            requiredCount,
            variant,
          },
        });
        return;
      }
      if (state.mode === 'ONLINE' || state.settings.gameMode !== 'PVE') {
        get().executeAiAction({ type: 'BUY_ITEM', itemKey });
        return;
      }
      const dropSet = getSupplyDropTargets(state, currentPlayer);
      const validTiles = state.settings.fogOfWar
        ? Array.from(dropSet).filter(id => state.visibleTiles.has(id))
        : Array.from(dropSet);
      if (validTiles.length === 0) {
        get().executeAiAction({ type: 'BUY_ITEM', itemKey });
        return;
      }
      set({
        ...CLEAR_SELECTION,
        hoveredTileId: state.hoveredTileId,
        placementMode: { active: true, itemKey, cost: item.cost, kind: 'DROP', validTiles },
      });
    },

    useTacticalWeapon: (itemKey) => {
      const state = get();
      const { currentPlayer, isAiTurn, winner, mode, mySeat, totalTurns } = state;
      const def = TACTICAL_ITEMS[itemKey];
      if (!def || isAiTurn || winner !== null) return;
      if (mode === 'ONLINE' && mySeat !== currentPlayer) return;
      const sandboxFree = state.devSandbox && state.devFreeplay;
      const tacState = sandboxFree ? sandboxTacticalState(state) : state;
      const round = totalTurns + 1;
      const anchorFallback =
        state.units.find(u => u.owner === currentPlayer)?.tileId ??
        state.mapData.find(t => t.type === 'BASE' && t.owner === currentPlayer)?.id ??
        state.mapData[0]?.id ??
        '0,0';
      const feedback = (text: string) => {
        get().showMapFeedback(anchorFallback, text, 'warn');
      };
      if (def.fogOnly && !state.settings.fogOfWar) {
        return feedback(`${def.name} is only available with Fog of War on`);
      }
      const hasVoucher = hasTacticalVoucher(state, currentPlayer, itemKey);
      if (!sandboxFree) {
        if (!hasVoucher && round < tacticalUnlockRound(itemKey)) return feedback(`${def.name} opens at round ${tacticalUnlockRound(itemKey)}`);
        if ((state.tacticalRound?.[currentPlayer] ?? 0) === round) return feedback('One tactical weapon per round');
        const cd = tacticalCooldownLeft(state, currentPlayer, itemKey);
        if (!hasVoucher && cd > 0) return feedback(`${def.name} is on cooldown (${cd} round${cd === 1 ? '' : 's'} left)`);
      }
      const free = sandboxFree || hasVoucher || tacticalIsFree(state, currentPlayer, itemKey);
      if (!free && (state.playerGold[currentPlayer] ?? 0) < def.cost) return feedback('Not enough Euros');
      if (def.shape === 'NONE') {
        set({ placementMode: null });
        get().executeAiAction({ type: 'USE_TACTICAL', itemKey });
        return;
      }
      const visible = state.settings.fogOfWar ? state.visibleTiles : null;
      const isDirectional = def.shape === 'LINE4' || def.shape === 'LANE';
      let axis: 'H' | 'V' = 'H';
      let validTiles = legalTacticalAnchors(tacState, currentPlayer, itemKey, {
        axis: isDirectional ? axis : undefined,
        width: def.shape === 'LANE' ? 2 : undefined,
        visible,
      });
      if (validTiles.length === 0 && isDirectional) {
        const altTiles = legalTacticalAnchors(tacState, currentPlayer, itemKey, {
          axis: 'V',
          width: def.shape === 'LANE' ? 2 : undefined,
          visible,
        });
        if (altTiles.length > 0) {
          axis = 'V';
          validTiles = altTiles;
        }
      }
      if (validTiles.length === 0) {
        if (def.shape === 'UNIT' || def.shape === 'UNITS3') {
          const hasAnyVisibleEnemy = state.units.some(
            u => u.owner !== currentPlayer && (!visible || visible.has(u.tileId)),
          );
          return feedback(
            hasAnyVisibleEnemy
              ? 'All visible enemy units are already at the 2 HP tactical floor'
              : 'No visible enemy units to target',
          );
        }
        if (def.shape === 'RELOCATE') {
          return feedback('No visible units to airlift');
        }
        if (itemKey === 'SABOTAGE') {
          return feedback('No valid enemy HQ or specialized structure available');
        }
        return feedback(`No legal target tiles for ${def.name}`);
      }
      set({
        ...CLEAR_SELECTION,
        hoveredTileId: state.hoveredTileId,
        placementMode: {
          active: true,
          itemKey,
          cost: free ? 0 : def.cost,
          kind: 'TACTICAL',
          validTiles,
          selectedTiles: def.shape === 'UNITS3' ? [] : undefined,
          requiredCount: def.shape === 'UNITS3' ? 3 : undefined,
          tacticalAxis: isDirectional ? axis : undefined,
          tacticalWidth: def.shape === 'LANE' ? 2 : undefined,
          tacticalUnitId: undefined,
        },
      });
    },

    setTacticalAxis: (axis) => {
      const state = get();
      const placementMode = state.placementMode;
      if (placementMode?.kind !== 'TACTICAL') return;
      const itemKey = placementMode.itemKey as TacticalId;
      const def = TACTICAL_ITEMS[itemKey];
      const tacState = state.devSandbox && state.devFreeplay ? sandboxTacticalState(state) : state;
      const validTiles = legalTacticalAnchors(tacState, state.currentPlayer, itemKey, {
        axis,
        width: def?.shape === 'LANE' ? 2 : undefined,
        visible: state.settings.fogOfWar ? state.visibleTiles : null,
      });
      set({ placementMode: { ...placementMode, tacticalAxis: axis, validTiles } });
      if (validTiles.length === 0) {
        const anchor = state.hoveredTileId ?? state.units.find(u => u.owner === state.currentPlayer)?.tileId ?? state.mapData[0]?.id ?? '0,0';
        get().showMapFeedback(
          anchor,
          `No legal ${axis === 'V' ? 'vertical' : 'horizontal'} anchors for ${def?.name ?? 'tactical'}`,
          'warn',
        );
      }
    },

    confirmTacticalStrike: () => {
      const { placementMode, isAiTurn, winner } = get();
      if (!placementMode || !placementMode.active || placementMode.kind !== 'TACTICAL' || isAiTurn || winner !== null) return;
      const itemKey = placementMode.itemKey as TacticalId;
      const selected = placementMode.selectedTiles ?? [];
      if (TACTICAL_ITEMS[itemKey]?.shape !== 'UNITS3' || selected.length === 0) return;
      set({ placementMode: null });
      get().executeAiAction({
        type: 'USE_TACTICAL',
        itemKey,
        tileId: selected[0],
        tileIds: selected,
      });
    },

    resetParadropPick: () => {
      const state = get();
      const placementMode = state.placementMode;
      if (!placementMode || placementMode.kind !== 'TACTICAL' || placementMode.itemKey !== 'PARADROP') return;
      const visible = state.settings.fogOfWar ? state.visibleTiles : null;
      const tacState = state.devSandbox && state.devFreeplay ? sandboxTacticalState(state) : state;
      const unitTiles = legalTacticalAnchors(tacState, state.currentPlayer, 'PARADROP', { visible });
      SoundFX.play('click');
      set({
        placementMode: {
          ...placementMode,
          tacticalUnitId: undefined,
          selectedTiles: undefined,
          validTiles: unitTiles,
        },
      });
    },

    confirmConstruct: () => {
      const { placementMode, isAiTurn, winner } = get();
      const selected = placementMode?.selectedTiles ?? [];
      if (!placementMode || !placementMode.active || placementMode.kind !== 'CONSTRUCT' || selected.length === 0 || isAiTurn || winner !== null) {
        return;
      }
      get().executeAiAction({
        type: 'BUILD',
        itemKey: placementMode.itemKey,
        tileId: selected[0],
        tileIds: selected,
        variant: placementMode.variant,
      });
    },

    confirmAutoDrop: () => {
      const { placementMode, isAiTurn, winner } = get();
      if (!placementMode || !placementMode.active || placementMode.kind !== 'DROP' || isAiTurn || winner !== null) return;
      get().executeAiAction({ type: 'BUY_ITEM', itemKey: placementMode.itemKey });
    },

    cancelPlacement: () => set({ placementMode: null }),

    clearSelection: () => {
      const st = get();
      if (st.placementMode?.active) {
        set({ placementMode: null });
        SoundFX.play('click');
        return;
      }
      if (st.selectedInventoryItemIndex !== null) {
        set({ selectedInventoryItemIndex: null });
        SoundFX.play('click');
        return;
      }
      if (st.selectedUnitId || st.selectedTileId || st.selectedGraveyardUnitId) {
        set({
          ...CLEAR_SELECTION,
          hoveredTileId: st.hoveredTileId,
        });
        SoundFX.play('click');
      }
    },

    showMapFeedback: (tileId, text, tone = 'info') => {
      const id = ++feedbackSeq;
      set({ mapFeedback: { id, tileId, text, tone } });
      setTimeout(() => {
        if (get().mapFeedback?.id === id) set({ mapFeedback: null });
      }, 1900);
    },

    clearMapFeedback: () => set({ mapFeedback: null }),

    undoLastMove: () => {
      const state = get();
      const snap = state.lastMoveSnapshot;
      if (!snap || state.mode !== 'LOCAL' || state.isAiTurn || state.winner !== null || state.settings.fogOfWar) return;
      const viewer = viewerSeat(state);
      const vis = visibleSet(snap.game, viewer);
      const unit = snap.game.units.find(u => u.id === snap.unitId);
      set({
        ...commitGameView(state, snap.game, vis, viewer, false, false),
        ...(unit && !unit.completed ? optionsSelectionFor(snap.game, unit, vis) : {}),
        lastMoveSnapshot: null,
      });
      SoundFX.play('click');
      get().showMapFeedback(snap.originTileId, 'Move undone', 'info');
    },

    endTurn: () => {
      if (get().winner === null) get().executeAiAction({ type: 'END_TURN' });
    },

    runAiLoop: () => {
      const { isAiTurn, winner, settings, currentScreen, mode } = get();
      if (mode !== 'LOCAL' || !isAiTurn || winner !== null || (!botMatchActive && settings.gameMode !== 'PVE') || currentScreen !== 'GAME') return;
      const seq = ++aiLoopSeq;
      const fireAiStep = () => {
        if (seq !== aiLoopSeq) return;
        const state = get();
        if (state.mode !== 'LOCAL' || state.winner !== null || state.currentScreen !== 'GAME' || !state.isAiTurn) return;
        // Never fire the next bot action through the middle of a kill cam or attack micro-cam.
        if (fxTimeline.isKillCamActive()) {
          const unsub = fxTimeline.subscribeKillCamActive((active) => {
            if (active) return;
            unsub();
            setTimeout(fireAiStep, 220);
          });
          return;
        }
        get().executeAiAction(botAction(state));
      };
      setTimeout(fireAiStep, 700);
    },

    executeAiAction: (action) => {
      const state = get();
      if (state.mode === 'ONLINE') {
        // The server applies it and sends everyone the result
        state.online?.send(action);
        set({ placementMode: null, selectedInventoryItemIndex: null });
        return;
      }

      const movedOriginId =
        action.type === 'MOVE' ? state.units.find(u => u.id === action.unitId)?.tileId : undefined;
      const preSnapshot =
        state.mode === 'LOCAL' && !state.isAiTurn && !state.settings.fogOfWar && action.type === 'MOVE'
          ? pickGameState(state)
          : null;

      const isSandboxTactical = state.devSandbox && state.devFreeplay && action.type === 'USE_TACTICAL';
      const sourceState = isSandboxTactical ? sandboxTacticalState(state) : state;

      const result = applyAction(sourceState, action, { autoBankReward: state.isAiTurn });
      if (result.rejected) {
        console.error(`Action rejected (${result.rejected})`, action);
        if (!state.isAiTurn) {
          const actionTileId =
            ('tileId' in action && typeof action.tileId === 'string' && action.tileId) ||
            ('targetTileId' in action && typeof action.targetTileId === 'string' && action.targetTileId) ||
            state.hoveredTileId ||
            state.units.find(u => u.owner === state.currentPlayer)?.tileId ||
            state.mapData.find(t => t.type === 'BASE' && t.owner === state.currentPlayer)?.id ||
            state.mapData[0]?.id ||
            '0,0';
          get().showMapFeedback(actionTileId, result.rejected, 'warn');
        }
        // Keep the AI from stalling on an action it can't afford
        if (state.isAiTurn && action.type !== 'END_TURN') get().executeAiAction({ type: 'END_TURN' });
        return;
      }
      const next = isSandboxTactical
        ? {
            ...result.state,
            totalTurns: state.totalTurns,
            tacticalRound: {},
            tacticalCooldowns: {},
            winner: null,
            matchSummary: null,
            playerCp: topUpPlayerCp(result.state.playerCp),
            playerGold: state.playerGold,
          }
        : result.state;
      highlightRecorder.record({
        turn: next.totalTurns + 1,
        seed: next.activeSeed,
        preUnits: state.units,
        preMapData: state.mapData,
        postUnits: next.units,
        postMapData: next.mapData,
        events: result.events,
      });
      playEvents(result.events, next.units, state.units);
      if (state.winner === null && next.winner !== null && next.matchSummary) {
        CareerStorage.recordMatch(next.matchSummary);
      }

      const aiNext = aiPlays(next);
      const viewer = next.settings.gameMode === 'PVE' ? 0 : next.currentPlayer;
      const nextVis = visibleSet(next, viewer);
      const committed = commitGameView(state, next, nextVis, viewer, aiNext, aiNext);

      // Keep unit selected after MOVE when follow-up actions (Attack / Overwatch / Capture) remain available
      let autoSelect = {};
      if (!aiNext && !state.isAiTurn && action.type === 'MOVE' && next.winner === null) {
        const movedUnit = next.units.find(u => u.id === action.unitId);
        if (movedUnit && movedUnit.owner === viewer && !movedUnit.completed) {
          const sel = optionsSelectionFor(next, movedUnit, nextVis);
          if (hasFollowUpAction(next, movedUnit, sel)) autoSelect = sel;
        }
      }

      const triggeredTrap = result.events.some(
        e => e.kind === 'projectile' || (e.kind === 'sound' && e.sound === 'explosion'),
      );
      const saveUndo =
        action.type === 'MOVE' && preSnapshot && movedOriginId && next.winner === null && !aiNext && !triggeredTrap
          ? { game: preSnapshot, unitId: action.unitId, originTileId: movedOriginId }
          : null;

      set({
        ...committed,
        ...autoSelect,
        lastMoveSnapshot: saveUndo,
        ...(aiNext || action.type === 'END_TURN' ? { mapFeedback: null } : {}),
      });
      if (aiNext) get().runAiLoop();
      scheduleBotSpectator();

      // The match ends like a broadcast: the winning cut lands, then the cutscene plays, and only
      // then the scoreboard. `finalePending` holds the results across the cue delay, when neither a
      // kill cam nor a recap is on screen yet; it clears the moment the cutscene takes over.
      if (state.winner === null && next.winner !== null && !matchFilmPlayed) {
        matchFilmPlayed = true;
        const cueAfterCut = (play: () => void) => {
          set({ finalePending: true });
          // Safety net: a cue that never lands must not leave the results unreachable.
          setTimeout(() => {
            if (get().finalePending) set({ finalePending: false });
          }, 12_000);
          const run = () => {
            const current = get();
            if (current.currentScreen === 'GAME' && current.winner !== null && current.mode === 'LOCAL') play();
          };
          if (fxTimeline.isKillCamActive()) {
            const unsub = fxTimeline.subscribeKillCamActive(active => {
              if (active) return;
              unsub();
              setTimeout(run, 900);
            });
          } else {
            setTimeout(run, 900);
          }
        };

        const film = highlightRecorder.getFilm();
        if (film && film.scenes.length > 1) {
          cueAfterCut(() => get().playMatchFilm());
        } else if (botMatchActive) {
          // A simulated match with no feud to cut keeps its single-moment Play of the Match replay.
          cueAfterCut(() => get().playPlayOfTheMatch());
        }
      }
    },

    playPlayOfTheMatch: (onDone) => {
      const highlight = highlightRecorder.getBest();
      if (!highlight) {
        onDone?.();
        return false;
      }
      if (recapPlayer.isActive()) recapPlayer.stop();
      set({ finalePending: false });
      const { units, mapData } = get();
      recapPlayer.startPotmReplay(highlight, createRecapBridge(units, mapData), onDone);
      return true;
    },

    playMatchFilm: (onDone) => {
      const film = highlightRecorder.getFilm();
      if (!film || film.scenes.length === 0) {
        set({ finalePending: false });
        onDone?.();
        return false;
      }
      if (recapPlayer.isActive()) recapPlayer.stop();
      // The reel is taking the screen now, so the held scoreboard hands over to `recapActive`.
      set({ finalePending: false });
      const { units, mapData, settings, visibleTiles } = get();
      if (film.scenes.length === 1) {
        recapPlayer.startPotmReplay(film.scenes[0], createRecapBridge(units, mapData), onDone);
        return true;
      }
      // A reel is a broadcast replay: it may show ground the viewer never scouted, so fog lifts for
      // the duration and the live visibility set comes back with the board when it ends.
      const restoreVisibility = settings.fogOfWar ? visibleTiles : undefined;
      if (settings.fogOfWar) set({ visibleTiles: new Set(mapData.map(t => t.id)) });
      recapPlayer.startFilm(film.scenes, createRecapBridge(units, mapData, restoreVisibility), onDone);
      return true;
    },

    exportPlayOfTheMatch: async (onStatus) => {
      const highlight = highlightRecorder.getBest();
      if (!highlight) return 'unsupported';
      const { exportPlayOfTheMatchClip } = await import('../core/graphics/clipExporter');
      return exportPlayOfTheMatchClip({
        seed: highlight.seed,
        turn: highlight.turn,
        onStatus,
        runReplay: (done) => {
          get().playPlayOfTheMatch(done);
        },
      });
    },

    // ── Online ──────────────────────────────────────────────────

    enterOnline: (bridge) => {
      // Called again on each reconnect: keep the local settings saved the first time, and the
      // seq, so the effects already played aren't played again.
      const { settings, localSettings } = get();
      set({ online: bridge, localSettings: localSettings ?? settings });
    },

    applyServerView: (view) => {
      if (recapPlayer.isActive() && view.seq !== get().onlineSeq) {
        // Restore authoritative live board before diffing/applying the incoming update.
        recapPlayer.stop();
      }
      const state = get();
      const pv = view.game;
      if (!pv) {
        // Back in the lobby (or the table has no game yet)
        if (state.mode === 'ONLINE') {
          recapPlayer.stop();
          highlightRecorder.reset();
          set({ mode: 'LOCAL', currentScreen: 'ONLINE', mapData: [], units: [] });
        }
        return;
      }
      const rawGame = pv.game;
      const isAiTurn = rawGame.winner === null && rawGame.currentPlayer !== view.mySeat;
      if (view.seq === state.onlineSeq && state.mode === 'ONLINE') {
        // Same game (only the seats changed): keep everything, so nothing redraws.
        set({ mySeat: view.mySeat, isAiTurn });
        return;
      }
      const hadGame = state.mode === 'ONLINE' && state.mapData.length > 0;
      if (!hadGame) {
        recapPlayer.stop();
        highlightRecorder.reset();
        useEffectStore.getState().clearAllFx();
      }
      const prevUnits = state.units;
      const prevMapData = state.mapData;
      const nextGame: GameState = hadGame
        ? {
            ...rawGame,
            mapData: reuseMapData(state.mapData, rawGame.mapData),
            units: reuseUnits(state.units, rawGame.units),
            weather: reuseWeather(state.weather, rawGame.weather),
            settings: reuseSettings(state.settings, rawGame.settings),
          }
        : rawGame;
      const nextVisible = hadGame ? reuseVisibleTiles(state.visibleTiles, pv.visibleTiles) : new Set(pv.visibleTiles);
      let autoSelect = {};
      if (!isAiTurn && !state.isAiTurn && rawGame.winner === null && state.selectedUnitId) {
        const prevUnit = state.units.find(u => u.id === state.selectedUnitId);
        const nextUnit = nextGame.units.find(u => u.id === state.selectedUnitId);
        if (prevUnit && nextUnit && !prevUnit.hasMoved && nextUnit.hasMoved && !nextUnit.completed && nextUnit.owner === view.mySeat) {
          const sel = optionsSelectionFor(nextGame, nextUnit, nextVisible);
          if (hasFollowUpAction(nextGame, nextUnit, sel)) autoSelect = sel;
        }
      }
      if (hadGame && view.events.length > 0) {
        highlightRecorder.record({
          turn: nextGame.totalTurns + 1,
          seed: nextGame.activeSeed,
          preUnits: prevUnits,
          preMapData: prevMapData,
          postUnits: nextGame.units,
          postMapData: nextGame.mapData,
          events: view.events,
        });
      }
      set({
        ...commitGameView(state, nextGame, nextVisible, view.mySeat, isAiTurn, isAiTurn),
        ...autoSelect,
        mode: 'ONLINE',
        mySeat: view.mySeat,
        onlineSeq: view.seq,
        lastCustomMap: null,
        lastMoveSnapshot: null,
        ...(isAiTurn ? { mapFeedback: null } : {}),
      });
      if (view.missedActions && view.missedActions.length > 0) {
        recapPlayer.startMissedRecap(view.missedActions, createRecapBridge(nextGame.units, nextGame.mapData));
      } else {
        playEvents(view.events, nextGame.units, prevUnits);
      }
    },

    exitOnline: () => {
      recapPlayer.stop();
      highlightRecorder.reset();
      useEffectStore.getState().clearAllFx();
      const { localSettings } = get();
      set({
        ...createEmptyGameState(localSettings ?? DEFAULT_GAME_SETTINGS, DEFAULT_GRID_SIZE),
        ...CLEAR_SELECTION,
        mode: 'LOCAL',
        online: null,
        localSettings: null,
        onlineSeq: -1,
        isAiTurn: false,
        lastMoveSnapshot: null,
        mapFeedback: null,
        currentScreen: 'ONLINE',
      });
    },
  };
});

/**
 * Keep the local match saved so a reload doesn't lose it. Sandboxes and bot matches are left out
 * (they're throwaway), and the save goes once the match is over or you head back to setup.
 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useGameStore.subscribe((state, prev) => {
  const playing =
    state.mode === 'LOCAL' &&
    state.currentScreen === 'GAME' &&
    !state.devSandbox &&
    !botMatchActive &&
    state.mapData.length > 0;
  if (!playing || state.winner !== null) {
    // Only drop the save on a real exit, not on screens you can visit mid-match (rules, etc.).
    if (state.mode === 'ONLINE' || state.currentScreen === 'SETUP' || state.currentScreen === 'DEV' || state.winner !== null || state.devSandbox) {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = null;
      clearLocalMatch();
    }
    return;
  }
  if (prev.currentScreen === 'GAME' && !gameStateChanged(state, prev)) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const s = useGameStore.getState();
    if (s.mode === 'LOCAL' && s.currentScreen === 'GAME' && s.winner === null && !s.devSandbox && !botMatchActive) {
      saveLocalMatch(s, s.lastCustomMap);
    }
  }, 300);
});
