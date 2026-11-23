/**
 * The game screen's state: the game itself (the engine's GameState, kept at the top level so
 * components read `units`, `mapData`… directly) plus selection and highlighting.
 *
 * Local games (hot-seat and vs AI) apply actions here with the engine. Online games send
 * them to the server and show the views it sends back (see applyServerView).
 */
import { create } from 'zustand';
import { BARRIER_STATS, CP_SYSTEM, DEFAULT_GRID_SIZE, OVERWATCH_STATS, SHOP_ITEMS, UNIT_COSTS } from '@tactical/engine/constants/Config';
import type { GameSettings, SavedMap, Tile, Unit, WeatherState } from '@tactical/engine/types';
import { getStepCost, getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import { canConstructOnTile, canUnitEnterOverwatch, getUnitAttackCost, isWithinEnemyHqExclusion } from '@tactical/engine/rules/CombatRules';
import { CareerStorage } from '@tactical/engine/storage/CareerStatsManager';
import {
  applyAction,
  botAction,
  cloneTiles,
  createChallengeGame,
  createCustomMapGame,
  createEmptyGameState,
  createGeneratedGame,
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
  type TableView,
} from '@tactical/engine';
import { useEffectStore } from './useEffectStore';
import { fxTimeline } from '../core/graphics/fxTimeline';
import { SoundFX } from '../core/audio/SoundFX';
import {
  type BoardRotation,
  nextBoardRotation,
  readSavedBoardRotation,
  saveBoardRotation,
} from '../core/boardRotation';

export type Screen = 'SETUP' | 'GAME' | 'EDITOR' | 'TUTORIAL' | 'ONLINE';

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
  validHeistTile: string | null;
  validSiegeTile: string | null;
  validLootTile: string | null;
  validDemolishTile: string | null;

  /** Input is locked: the AI is playing (local), or it isn't your turn (online). */
  isAiTurn: boolean;

  // Editor
  mapToEdit: SavedMap | null;

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
  heistBank: () => void;
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
  validHeistTile: null,
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

/** Play an action's effects through the synchronized FX timeline. */
const playEvents = (events: GameEvent[]) => {
  // Ensure effect store sink is registered before dispatching timeline cues
  void useEffectStore.getState();
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
    validHeistTile: opts.heistTiles[0] ?? null,
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
    sel.validHeistTile !== null ||
    sel.validLootTile !== null ||
    canUnitEnterOverwatch(unit, tile, cp) ||
    (unit.ammo < unit.maxAmmo && cp >= CP_SYSTEM.RELOAD_COST)
  );
};

export const useGameStore = create<GameStore>((set, get) => {
  /** Start a local game. */
  const beginLocal = (game: GameState, lastCustomMap: Tile[] | null) => {
    useEffectStore.getState().clearAllFx();
    set({
      ...commitGameView(get(), game, visibleSet(game, 0), 0, false, false),
      lastCustomMap,
      lastMoveSnapshot: null,
      mapFeedback: null,
      mode: 'LOCAL',
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

    setGameSettings: (newSettings) => {
      set(state => ({ settings: { ...state.settings, ...newSettings } }));
    },

    startGame: () => {
      set({ currentScreen: 'GAME' });
      get().initializeMap();
    },

    openEditor: () => set({ currentScreen: 'EDITOR', mapToEdit: null }),
    exitEditor: () => set({ currentScreen: 'SETUP' }),
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
        if (state.validHeistTile === clickedTileId) {
          get().executeAiAction({ type: 'HEIST', unitId: attacker.id, tileId: clickedTileId, cost: INTERACT_COST });
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
          moveBlocker = "Can't move — already moved this turn (Attack, Overwatch, or click again to deselect)";
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

    heistBank: () => dispatchSelectedUnitAction(get().validHeistTile, (unitId, tileId) => ({ type: 'HEIST', unitId, tileId, cost: INTERACT_COST })),

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
      setTimeout(() => {
        const state = get();
        if (state.mode !== 'LOCAL' || state.winner !== null || state.currentScreen !== 'GAME' || !state.isAiTurn) return;
        get().executeAiAction(botAction(state));
      }, 700);
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
      playEvents(result.events);
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

    // ── Online ──────────────────────────────────────────────────

    enterOnline: (bridge) => {
      // Called again on each reconnect: keep the local settings saved the first time, and the
      // seq, so the effects already played aren't played again.
      const { settings, localSettings } = get();
      set({ online: bridge, localSettings: localSettings ?? settings });
    },

    applyServerView: (view) => {
      const state = get();
      const pv = view.game;
      if (!pv) {
        // Back in the lobby (or the table has no game yet)
        if (state.mode === 'ONLINE') set({ mode: 'LOCAL', currentScreen: 'ONLINE', mapData: [], units: [] });
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
        useEffectStore.getState().clearAllFx();
      }
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
      playEvents(view.events);
    },

    exitOnline: () => {
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
