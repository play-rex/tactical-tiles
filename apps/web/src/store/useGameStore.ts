/**
 * The game screen's state: the game itself (the engine's GameState, kept at the top level so
 * components read `units`, `mapData`… directly) plus selection and highlighting.
 *
 * Local games (hot-seat and vs AI) apply actions here with the engine. Online games send
 * them to the server and show the views it sends back (see applyServerView).
 */
import { create } from 'zustand';
import { BANK_STATS, BARRIER_STATS, BASE_STATS, CP_SYSTEM, DEFAULT_GRID_SIZE, OVERWATCH_STATS, SHOP_ITEMS, UNIT_COSTS } from '@tactical/engine/constants/Config';
import type { GameSettings, SavedMap, TerrainType, Tile, Unit, UnitRank, UnitType, WeatherState } from '@tactical/engine/types';
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
  DEFAULT_GAME_SETTINGS,
  INTERACT_COST,
  isUnitVisible,
  spawnBlocker,
  visibleSet,
  type GameAction,
  type GameEvent,
  type GameState,
  type MissedActionBatch,
  type TableView,
} from '@tactical/engine';
import { useEffectStore } from './useEffectStore';
import { fxTimeline } from '../core/graphics/fxTimeline';
import { highlightRecorder } from '../core/graphics/highlightRecorder';
import { recapPlayer, type RecapBridge } from '../core/graphics/recapPlayer';
import { SoundFX } from '../core/audio/SoundFX';
import {
  type BoardRotation,
  nextBoardRotation,
  readSavedBoardRotation,
  saveBoardRotation,
} from '../core/boardRotation';

export type Screen = 'SETUP' | 'GAME' | 'EDITOR' | 'TUTORIAL' | 'ONLINE' | 'DEV';

/** What the sandbox brush drops on the tile you click. */
export type DevBrush =
  | { kind: 'TERRAIN'; terrain: TerrainType }
  | { kind: 'STRUCTURE'; structure: 'BASE' | 'BANK' | 'BARRIER' | 'WATCHTOWER' | 'BUNKER'; owner: number }
  | { kind: 'UNIT'; unitType: UnitType; owner: number };

/** Events the sandbox can fire through the real FX pipeline to audition a cut. */
export type DevEventKind =
  | 'ATTACK_HIT'
  | 'GRAZE_1HP'
  | 'KILL_CINEMATIC'
  | 'KILL_MICRO'
  | 'MINE_CLICK'
  | 'OVERWATCH_KILL'
  | 'CROSSFIRE_KILL'
  | 'CORNER_KILL'
  | 'HEIST'
  | 'BANK_DEMOLISH'
  | 'HQ_BREACH'
  | 'HQ_DESTROY'
  | 'POTM_REPLAY'
  | 'EXPORT_CLIP'
  | 'TURN_RECAP';

/** How the store reaches the server during an online game (set by the online store). */
export interface OnlineBridge {
  send: (action: GameAction) => void;
  leave: () => void;
}

export interface PlacementModeState {
  active: boolean;
  itemKey: string;
  cost: number;
  kind: 'CONSTRUCT' | 'DROP';
  validTiles: string[];
  selectedTiles?: string[];
  requiredCount?: number;
  variant?: string;
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
  devPlace: (x: number, y: number, brush: DevBrush) => void;
  devFireEvent: (kind: DevEventKind) => void;
  /** Pure sandbox: no ranges, no CP, no turn lock. Units teleport and strike anywhere. */
  devFreeplay: boolean;
  setDevFreeplay: (on: boolean) => void;
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
const aiPlays = (s: Pick<GameState, 'winner' | 'currentPlayer' | 'settings'>) =>
  s.winner === null && s.currentPlayer === 1 && s.settings.gameMode === 'PVE';

/**
 * Whose eyes the map is drawn through (under fog, what they can see): your seat online,
 * seat 0 against the AI, and whoever's turn it is at a shared screen.
 */
export const viewerSeat = (s: Pick<GameStore, 'mode' | 'mySeat' | 'currentPlayer' | 'settings'>): number =>
  s.mode === 'ONLINE' ? s.mySeat : s.settings.gameMode === 'PVE' ? 0 : s.currentPlayer;

/** Every seat's battery at full: pure sandbox testing is never gated on command points. */
const topUpPlayerCp = (cp: Record<number, number>): Record<number, number> =>
  Object.fromEntries(Object.keys(cp).map(seat => [Number(seat), CP_SYSTEM.MAX_CP]));

let aiLoopSeq = 0;

/** Play an action's effects through the synchronized FX timeline. */
const playEvents = (events: GameEvent[], unitSnapshot?: Unit[], fallbackUnits?: Unit[]) => {
  // Ensure effect store sink is registered before dispatching timeline cues
  void useEffectStore.getState();
  const unitsForLookup = unitSnapshot;
  const preFallback = fallbackUnits ?? useGameStore.getState().units;
  fxTimeline.configure({
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
  prev.challengeId === next.challengeId &&
  prev.unitCounts.SOLDIER === next.unitCounts.SOLDIER &&
  prev.unitCounts.ASSAULTER === next.unitCounts.ASSAULTER &&
  prev.unitCounts.SNIPER === next.unitCounts.SNIPER &&
  Boolean(prev.mutators?.blitzCp) === Boolean(next.mutators?.blitzCp) &&
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
  gameLog: s.gameLog,
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
  const createRecapBridge = (liveUnits: Unit[], liveMapData: Tile[]): RecapBridge => ({
    applyDisplaySnapshot: (units, mapData) => {
      set(mapData ? { units, mapData } : { units });
    },
    restoreLiveState: () => {
      set({ units: liveUnits, mapData: liveMapData });
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
    set({
      ...commitGameView(get(), game, visibleSet(game, 0), 0, false, false),
      lastCustomMap,
      lastMoveSnapshot: null,
      mapFeedback: null,
      mode: 'LOCAL',
      // A normal match never inherits the sandbox panel; launchDevSandbox opts back in.
      devSandbox: false,
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
    mapToEdit: null,
    mapFeedback: null,
    lastMoveSnapshot: null,
    devSandbox: false,
    devFreeplay: true,
    devOptions: DEFAULT_DEV_MAP_OPTIONS,
    devPreview: generateDevMap(DEFAULT_DEV_MAP_OPTIONS).map,

    setGameSettings: (newSettings) => {
      set(state => ({ settings: { ...state.settings, ...newSettings } }));
    },

    startGame: () => {
      set({ currentScreen: 'GAME' });
      get().initializeMap();
    },

    openEditor: () => set({ currentScreen: 'EDITOR', mapToEdit: null }),
    exitEditor: () => set({ currentScreen: 'SETUP' }),

    openDevMaps: () =>
      set(state => ({ currentScreen: 'DEV', devPreview: generateDevMap(state.devOptions).map })),
    exitDevMaps: () => set({ currentScreen: 'SETUP', devSandbox: false }),
    setDevOptions: (patch) => {
      const devOptions = { ...get().devOptions, ...patch };
      set({ devOptions, devPreview: generateDevMap(devOptions).map });
    },
    rollDevSeed: () => get().setDevOptions({ seed: generateSectorSeed() }),
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
      const { settings, devOptions, devPreview } = get();
      const game = createCustomMapGame(
        // Hot-seat rules so no bot fights over the sandbox while you're testing.
        { ...settings, playerCount: devOptions.playerCount, mapSeed: devOptions.seed, gameMode: 'PVP' },
        devPreview,
      );
      beginLocal(game, cloneTiles(devPreview));
      set({
        devSandbox: true,
        currentScreen: 'GAME',
        playerCp: get().devFreeplay ? topUpPlayerCp(get().playerCp) : get().playerCp,
      });
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

      if (kind === 'ATTACK_HIT' || kind === 'GRAZE_1HP') {
        const victim = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        if (!victim) return;
        const attacker = state.units.find(u => u.owner !== victim.owner) ?? victim;
        const victimTile = tileOf(victim.tileId);
        const attackerTile = tileOf(attacker.tileId);
        if (!victimTile || !attackerTile) return;
        const weapon = attacker.type === 'SNIPER' ? 'SNIPER' : attacker.type === 'ASSAULTER' ? 'ASSAULTER' : 'SOLDIER';
        const isGraze = kind === 'GRAZE_1HP';
        const preHp = isGraze ? Math.max(victim.hp, Math.min(getUnitMaxHp(victim), 10)) : victim.hp;
        const preUnits = state.units.map(u => (u.id === victim.id ? { ...u, hp: preHp } : u));
        const dmg = isGraze ? Math.max(1, preHp - 1) : Math.max(1, Math.min(8, preHp - 1));
        const postHp = isGraze ? 1 : Math.max(1, preHp - dmg);
        const nextUnits = state.units.map(u => (u.id === victim.id ? { ...u, hp: postHp } : u));
        const events: GameEvent[] = [
          {
            kind: 'projectile',
            from: { x: attackerTile.x, y: attackerTile.y },
            to: { x: victimTile.x, y: victimTile.y },
            style: weapon === 'SNIPER' ? 'LASER' : weapon === 'ASSAULTER' ? 'MISSILE' : 'BULLET',
            weapon,
            attackerId: attacker.id,
            targetUnitId: victim.id,
            travelMs: 220,
          },
          {
            kind: 'hit',
            targetUnitId: victim.id,
            at: { x: victimTile.x, y: victimTile.y },
            from: { x: attackerTile.x, y: attackerTile.y },
            damage: dmg,
            weapon,
            breakdown: {
              baseDamage: dmg + 2,
              watchtowerBoosted: weapon === 'SNIPER',
              coverPct: isGraze ? 0.2 : 0,
              coverTerrain: victimTile.type,
              coverArmorApplied: false,
              crossfireBonus: 0,
            },
          },
          {
            kind: 'popup',
            at: { x: victimTile.x, y: victimTile.y },
            text: `-${dmg}`,
            color: isGraze ? '#F59E0B' : '#FBBF24',
            lift: 22,
          },
        ];
        recordDev(events, preUnits, nextUnits);
        playEvents(events, nextUnits, preUnits);
        set({ units: nextUnits });
        return;
      }

      if (kind === 'MINE_CLICK') {
        const victim = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        if (!victim) return;
        const vt = tileOf(victim.tileId);
        if (!vt) return;
        const dx = vt.x >= 2 ? -1 : 1;
        const p0 = { x: clampGrid(vt.x + dx * 2), y: vt.y };
        const p1 = { x: clampGrid(vt.x + dx), y: vt.y };
        const p2 = { x: vt.x, y: vt.y };
        const preUnits = state.units.map(u => (u.id === victim.id ? { ...u, tileId: `${p0.x},${p0.y}` } : u));
        const postUnits = state.units.filter(u => u.id !== victim.id);
        const events: GameEvent[] = [
          {
            kind: 'movePath',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            path: [p0, p1, p2],
            haltedAt: 2,
          },
          { kind: 'mineBlast', at: p2, damage: 15, victimUnitId: victim.id, victimDead: true },
          { kind: 'sound', sound: 'explosion' },
          { kind: 'shake', intensity: 14, at: p2 },
          {
            kind: 'killed',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            rank: (victim.rank ?? 0) as UnitRank,
            at: p2,
            killerOwner: state.currentPlayer,
            victimPreHp: victim.hp,
            cause: 'MINE',
          },
        ];
        recordDev(events, preUnits, postUnits);
        playEvents(events, postUnits, preUnits);
        set({ units: postUnits, selectedUnitId: null });
        return;
      }

      if (kind === 'OVERWATCH_KILL') {
        const victim = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        if (!victim) return;
        const killer = state.units.find(u => u.owner !== victim.owner) ?? victim;
        const vt = tileOf(victim.tileId);
        const kt = tileOf(killer.tileId);
        if (!vt || !kt) return;
        const dy = vt.y >= 2 ? -1 : 1;
        const p0 = { x: vt.x, y: clampGrid(vt.y + dy * 2) };
        const p1 = { x: vt.x, y: clampGrid(vt.y + dy) };
        const p2 = { x: vt.x, y: vt.y };
        const weapon = killer.type === 'SNIPER' ? 'SNIPER' : killer.type === 'ASSAULTER' ? 'ASSAULTER' : 'SOLDIER';
        const preUnits = state.units.map(u => (u.id === victim.id ? { ...u, tileId: `${p0.x},${p0.y}` } : u));
        const postUnits = state.units.filter(u => u.id !== victim.id);
        const events: GameEvent[] = [
          {
            kind: 'movePath',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            path: [p0, p1, p2],
            haltedAt: 2,
          },
          {
            kind: 'projectile',
            from: { x: kt.x, y: kt.y },
            to: p2,
            style: weapon === 'SNIPER' ? 'LASER' : weapon === 'ASSAULTER' ? 'MISSILE' : 'BULLET',
            weapon,
            attackerId: killer.id,
            targetUnitId: victim.id,
            travelMs: 240,
          },
          {
            kind: 'hit',
            targetUnitId: victim.id,
            at: p2,
            from: { x: kt.x, y: kt.y },
            damage: Math.max(12, victim.hp + 3),
            weapon,
            isKill: true,
            breakdown: {
              baseDamage: 12,
              watchtowerBoosted: false,
              coverPct: 0,
              coverTerrain: vt.type,
              coverArmorApplied: false,
              crossfireBonus: 0,
            },
          },
          {
            kind: 'killed',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            rank: (victim.rank ?? 0) as UnitRank,
            at: p2,
            killerOwner: killer.owner,
            killerUnitId: killer.id,
            killerUnitType: killer.type,
            victimPreHp: victim.hp,
            cause: 'OVERWATCH',
          },
        ];
        recordDev(events, preUnits, postUnits);
        playEvents(events, postUnits, preUnits);
        set({ units: postUnits, selectedUnitId: null });
        return;
      }

      if (kind === 'CROSSFIRE_KILL' || kind === 'CORNER_KILL') {
        const victim = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        if (!victim) return;
        const killer =
          state.units.find(u => u.owner !== victim.owner && u.type === 'SNIPER') ??
          state.units.find(u => u.owner !== victim.owner) ??
          victim;
        const isCorner = kind === 'CORNER_KILL';
        const vt = isCorner ? { x: 0, y: 0, type: tileOf('0,0')?.type ?? ('PLAINS' as const) } : tileOf(victim.tileId);
        const kt = isCorner
          ? { x: Math.min(7, state.gridSize - 1), y: Math.min(5, state.gridSize - 1) }
          : tileOf(killer.tileId);
        if (!vt || !kt) return;
        const preUnits = isCorner
          ? state.units.map(u =>
              u.id === victim.id
                ? { ...u, tileId: `${vt.x},${vt.y}` }
                : u.id === killer.id
                  ? { ...u, tileId: `${kt.x},${kt.y}` }
                  : u,
            )
          : state.units;
        const postUnits = preUnits.filter(u => u.id !== victim.id);
        const allies = isCorner
          ? undefined
          : [
              { x: clampGrid(vt.x + (vt.x > 2 ? -2 : 2)), y: clampGrid(vt.y + (vt.y > 2 ? -1 : 1)) },
              { x: clampGrid(vt.x + (vt.x < state.gridSize - 3 ? 2 : -2)), y: clampGrid(vt.y + (vt.y < state.gridSize - 3 ? 1 : -1)) },
            ];
        const dmg = isCorner ? 22 : 19;
        const events: GameEvent[] = [
          {
            kind: 'projectile',
            from: { x: kt.x, y: kt.y },
            to: { x: vt.x, y: vt.y },
            style: 'LASER',
            weapon: 'SNIPER',
            attackerId: killer.id,
            targetUnitId: victim.id,
            travelMs: 320,
          },
          {
            kind: 'hit',
            targetUnitId: victim.id,
            at: { x: vt.x, y: vt.y },
            from: { x: kt.x, y: kt.y },
            damage: dmg,
            weapon: 'SNIPER',
            isKill: true,
            crossfireFrom: allies,
            breakdown: {
              baseDamage: 12,
              watchtowerBoosted: true,
              coverPct: isCorner ? 0.2 : 0.4,
              coverTerrain: isCorner ? vt.type : 'FOREST',
              coverArmorApplied: false,
              crossfireBonus: isCorner ? 0 : 4,
            },
          },
          {
            kind: 'killed',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            rank: (isCorner ? Math.max(victim.rank ?? 0, 1) : 3) as UnitRank,
            at: { x: vt.x, y: vt.y },
            killerOwner: killer.owner,
            killerUnitId: killer.id,
            killerUnitType: 'SNIPER',
            victimPreHp: victim.hp,
            zeroCpClutch: !isCorner,
            cause: 'COMBAT',
          },
        ];
        recordDev(events, preUnits, postUnits);
        playEvents(events, postUnits, preUnits);
        set({ units: postUnits, selectedUnitId: null });
        return;
      }

      if (kind === 'KILL_CINEMATIC' || kind === 'KILL_MICRO') {
        const victim = state.units.find(u => u.owner !== state.currentPlayer) ?? state.units[0];
        if (!victim) return;
        const killer = state.units.find(u => u.owner !== victim.owner) ?? victim;
        const victimTile = tileOf(victim.tileId);
        const killerTile = tileOf(killer.tileId);
        if (!victimTile || !killerTile) return;
        const cinematic = kind === 'KILL_CINEMATIC';
        const weapon = killer.type === 'SNIPER' ? 'SNIPER' : killer.type === 'ASSAULTER' ? 'ASSAULTER' : 'SOLDIER';
        const postUnits = state.units.filter(u => u.id !== victim.id);
        const events: GameEvent[] = [
          {
            kind: 'projectile',
            from: { x: killerTile.x, y: killerTile.y },
            to: { x: victimTile.x, y: victimTile.y },
            style: weapon === 'SNIPER' ? 'LASER' : weapon === 'ASSAULTER' ? 'MISSILE' : 'BULLET',
            weapon,
            attackerId: killer.id,
            targetUnitId: victim.id,
            travelMs: cinematic ? 360 : 220,
          },
          {
            kind: 'hit',
            targetUnitId: victim.id,
            at: { x: victimTile.x, y: victimTile.y },
            from: { x: killerTile.x, y: killerTile.y },
            damage: cinematic ? 24 : 7,
            weapon,
            isKill: true,
            breakdown: {
              baseDamage: cinematic ? 20 : 7,
              watchtowerBoosted: cinematic && weapon === 'SNIPER',
              coverPct: 0,
              coverTerrain: victimTile.type,
              coverArmorApplied: false,
              crossfireBonus: 0,
            },
          },
          {
            kind: 'killed',
            unitId: victim.id,
            unitType: victim.type,
            owner: victim.owner,
            rank: cinematic ? 3 : 0,
            at: { x: victimTile.x, y: victimTile.y },
            killerOwner: killer.owner,
            killerUnitId: killer.id,
            killerUnitType: killer.type,
            victimPreHp: victim.hp,
            cause: 'COMBAT',
          },
        ];
        recordDev(events, state.units, postUnits);
        playEvents(events, postUnits, state.units);
        set({ units: postUnits, selectedUnitId: null });
        return;
      }

      const bankTile = state.mapData.find(t => t.type === 'BANK');
      const enemyBase =
        state.mapData.find(t => t.type === 'BASE' && t.owner !== state.currentPlayer) ??
        state.mapData.find(t => t.type === 'BASE');

      if (kind === 'HEIST') {
        const at = bankTile ?? enemyBase;
        if (!at) return;
        const events: GameEvent[] = [{ kind: 'heist', at: { x: at.x, y: at.y }, playerId: state.currentPlayer }];
        recordDev(events, state.units, state.units);
        playEvents(events);
        return;
      }

      if (kind === 'BANK_DEMOLISH') {
        if (!bankTile) return;
        const events: GameEvent[] = [
          {
            kind: 'structureHit',
            at: { x: bankTile.x, y: bankTile.y },
            structureType: 'BANK',
            damage: 14,
            destroyed: true,
            owner: bankTile.owner ?? null,
            attackerOwner: state.currentPlayer,
          },
        ];
        recordDev(events, state.units, state.units);
        playEvents(events);
        return;
      }

      if (!enemyBase) return;
      const events: GameEvent[] = [
        {
          kind: 'structureHit',
          at: { x: enemyBase.x, y: enemyBase.y },
          structureType: 'BASE',
          damage: kind === 'HQ_DESTROY' ? 50 : 8,
          destroyed: kind === 'HQ_DESTROY',
          owner: enemyBase.owner ?? null,
          attackerOwner: state.currentPlayer,
          isMatchWinning: kind === 'HQ_DESTROY',
        },
      ];
      recordDev(events, state.units, state.units);
      playEvents(events);
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
      if (get().mode === 'ONLINE') {
        get().online?.leave();
        return;
      }
      set({
        currentScreen: 'SETUP',
        winner: null,
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

      // Pure sandbox: pick a unit, click any tile to teleport it, click an enemy to strike it.
      // No ranges, no CP, no terrain costs and no turn order — nothing here mutates the rules.
      if (state.devSandbox && state.devFreeplay) {
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

      // Not your move (someone else's turn, a vault to claim, or the match is over): you can
      // still inspect anything you can see.
      if (winner !== null || state.bankRewardPending || isAiTurn) {
        inspect();
        return;
      }

      // Placing a Barrier wall, Land Mine, Bridge, or Airdrop Beacon bought from the shop
      if (placementMode && placementMode.active && tile) {
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
          get().executeAiAction({ type: 'SPAWN', unitType: deadUnit.type, tileId: clickedTileId, cost: 0, goldCost: UNIT_COSTS[deadUnit.type], deadUnitId: deadUnit.id });
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
      if (!item || isAiTurn || winner !== null || playerGold[currentPlayer] < item.cost) return;
      if (item.type === 'CONSTRUCT') {
        const ctx = { playerId: currentPlayer, mapData: state.mapData, mines: state.mines };
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
            cost: item.cost,
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
      if (mode !== 'LOCAL' || !isAiTurn || winner !== null || settings.gameMode !== 'PVE' || currentScreen !== 'GAME') return;
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

      const result = applyAction(state, action, { autoBankReward: state.isAiTurn });
      if (result.rejected) {
        console.error(`Action rejected (${result.rejected})`, action);
        // Keep the AI from stalling on an action it can't afford
        if (state.isAiTurn && action.type !== 'END_TURN') get().executeAiAction({ type: 'END_TURN' });
        return;
      }
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
    },

    playPlayOfTheMatch: (onDone) => {
      const highlight = highlightRecorder.getBest();
      if (!highlight) {
        onDone?.();
        return false;
      }
      if (recapPlayer.isActive()) recapPlayer.stop();
      const { units, mapData } = get();
      recapPlayer.startPotmReplay(highlight, createRecapBridge(units, mapData), onDone);
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
