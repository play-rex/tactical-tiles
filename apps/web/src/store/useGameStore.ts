/**
 * The game screen's state: the game itself (the engine's GameState, kept at the top level so
 * components read `units`, `mapData`… directly) plus selection and highlighting.
 *
 * Local games (hot-seat and vs AI) apply actions here with the engine. Online games send
 * them to the server and show the views it sends back (see applyServerView).
 */
import { create } from 'zustand';
import { CP_SYSTEM, DEFAULT_GRID_SIZE, OVERWATCH_STATS, SHOP_ITEMS, TILE_SIZE, UNIT_COSTS } from '@tactical/engine/constants/Config';
import type { GameSettings, MissionConfig, SavedMap, Tile } from '@tactical/engine/types';
import { canConstructOnTile, canUnitEnterOverwatch, getUnitAttackCost } from '@tactical/engine/rules/CombatRules';
import { CareerStorage } from '@tactical/engine/storage/CareerStatsManager';
import {
  applyAction,
  botAction,
  cloneTiles,
  createChallengeGame,
  createCustomMapGame,
  createGeneratedGame,
  getSpawnTiles,
  getUnitOptions,
  DEFAULT_GAME_SETTINGS,
  INTERACT_COST,
  spawnBlocker,
  visibleSet,
  type GameAction,
  type GameEvent,
  type GameState,
  type TableView,
} from '@tactical/engine';
import { useEffectStore } from './useEffectStore';
import { SoundFX } from '../core/audio/SoundFX';

export type Screen = 'SETUP' | 'GAME' | 'EDITOR' | 'TUTORIAL' | 'ONLINE';

/** How the store reaches the server during an online game (set by the online store). */
export interface OnlineBridge {
  send: (action: GameAction) => void;
  leave: () => void;
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

  // Shop placement
  placementMode: { active: boolean; itemKey: string; cost: number; variant?: string } | null;

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
  getTileAt: (gridX: number, gridY: number) => Tile | undefined;
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
  cancelPlacement: () => void;

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

/** Play an action's effects: shots, damage numbers, screen shake and sounds. */
const playEvents = (events: GameEvent[]) => {
  const fxStore = useEffectStore.getState();
  const center = (p: { x: number; y: number }) => [p.x * TILE_SIZE + TILE_SIZE / 2, p.y * TILE_SIZE + TILE_SIZE / 2] as const;
  for (const e of events) {
    if (e.kind === 'sound') SoundFX.play(e.sound);
    else if (e.kind === 'shake') fxStore.triggerScreenShake(e.intensity);
    else if (e.kind === 'popup') {
      const [x, y] = center(e.at);
      fxStore.addDamagePopup(x, y - e.lift, e.text, e.color);
    } else {
      const [sx, sy] = center(e.from);
      const [ex, ey] = center(e.to);
      fxStore.addProjectile(sx, sy, ex, ey, e.style);
    }
  }
};

const emptyGame = (settings: GameSettings): GameState => ({
  settings,
  mapData: [],
  gridSize: DEFAULT_GRID_SIZE,
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
  activeMission: null as MissionConfig | null,
  matchStats: {},
  matchSummary: null,
  bankRewardPending: null,
  pendingDrops: [],
  weather: { playerZones: {}, turnsRemaining: 5 },
  gameLog: [],
});

export const useGameStore = create<GameStore>((set, get) => {
  /** Start a local game. */
  const beginLocal = (game: GameState, lastCustomMap: Tile[] | null) => {
    set({
      ...game,
      ...CLEAR_SELECTION,
      lastCustomMap,
      mode: 'LOCAL',
      visibleTiles: visibleSet(game, 0),
      isAiTurn: false,
      currentScreen: 'GAME',
    });
  };

  return {
    ...emptyGame(DEFAULT_GAME_SETTINGS),
    ...CLEAR_SELECTION,
    currentScreen: 'SETUP',
    mode: 'LOCAL',
    mySeat: 0,
    online: null,
    localSettings: null,
    onlineSeq: -1,
    lastCustomMap: null,
    visibleTiles: new Set(),
    isAiTurn: false,
    mapToEdit: null,

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
      if (get().mode === 'ONLINE') {
        get().online?.leave();
        get().exitOnline();
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

    getTileAt: (gridX, gridY) => {
      const { mapData, gridSize } = get();
      return mapData[gridY * gridSize + gridX];
    },

    setHoveredTile: (tileId) => {
      if (get().hoveredTileId !== tileId) set({ hoveredTileId: tileId });
    },

    handleGraveyardSelect: (deadUnitId) => {
      const state = get();
      if (state.isAiTurn) return;
      if (spawnBlocker(state, state.currentPlayer, deadUnitId)) return;
      set({
        ...CLEAR_SELECTION,
        selectedGraveyardUnitId: deadUnitId,
        validSpawnTiles: getSpawnTiles(state, state.currentPlayer),
      });
    },

    selectInventoryItem: (index) => {
      set({
        selectedInventoryItemIndex: index,
        selectedUnitId: null,
        selectedGraveyardUnitId: null,
        validMoveTiles: [],
        validAttackTargets: [],
      });
    },

    selectNextReadyUnit: () => {
      const { units, currentPlayer, selectedUnitId, mapData, isAiTurn, winner } = get();
      if (isAiTurn || winner !== null) return;
      const ready = units.filter(u => u.owner === currentPlayer && !u.completed);
      if (ready.length === 0) return;
      const currentIdx = ready.findIndex(u => u.id === selectedUnitId);
      const next = ready[(currentIdx + 1) % ready.length];
      const tile = mapData.find(t => t.id === next.tileId);
      if (tile) get().handleTileClick(tile.x, tile.y);
    },

    reloadUnit: () => {
      const { selectedUnitId, units, playerCp, currentPlayer, isAiTurn } = get();
      const unit = isAiTurn ? undefined : units.find(u => u.id === selectedUnitId && u.owner === currentPlayer);
      if (!unit || unit.completed || unit.ammo >= unit.maxAmmo) return;
      if ((playerCp[currentPlayer] ?? 0) < CP_SYSTEM.RELOAD_COST) return;
      get().executeAiAction({ type: 'RELOAD', unitId: unit.id, cost: CP_SYSTEM.RELOAD_COST });
    },

    enterOverwatch: () => {
      const { selectedUnitId, units, playerCp, currentPlayer, mapData, isAiTurn } = get();
      const unit = isAiTurn ? undefined : units.find(u => u.id === selectedUnitId && u.owner === currentPlayer);
      if (!unit) return;
      const tile = mapData.find(t => t.id === unit.tileId);
      if (!canUnitEnterOverwatch(unit, tile, playerCp[currentPlayer] ?? 0)) return;
      get().executeAiAction({ type: 'OVERWATCH', unitId: unit.id, cost: OVERWATCH_STATS[unit.type].cost });
    },

    handleTileClick: (x, y) => {
      const state = get();
      const {
        units, currentPlayer, selectedUnitId, selectedGraveyardUnitId, selectedInventoryItemIndex,
        validMoveCosts, mapData, validAttackTargets, winner, graveyard, validSpawnTiles, settings, isAiTurn, placementMode,
      } = state;

      const clickedTileId = `${x},${y}`;
      const tile = mapData.find(t => t.id === clickedTileId);
      // A unit you can see (under fog, only those in your sight)
      const viewer = viewerSeat(state);
      const seenUnit = units.find(
        u => u.tileId === clickedTileId && (!settings.fogOfWar || u.owner === viewer || state.visibleTiles.has(clickedTileId)),
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

      // Placing a Barrier or Bridge bought from the shop
      if (placementMode && placementMode.active && tile) {
        if (canConstructOnTile(placementMode.itemKey, tile, units)) {
          get().executeAiAction({ type: 'BUILD', itemKey: placementMode.itemKey, tileId: clickedTileId, variant: placementMode.variant });
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

      // Select one of your ready units and show what it can do
      if (clickedUnit && clickedUnit.owner === currentPlayer && !clickedUnit.completed) {
        if (tile) {
          const opts = getUnitOptions(state, clickedUnit, state.visibleTiles);
          SoundFX.play('click');
          set({
            ...CLEAR_SELECTION,
            hoveredTileId: state.hoveredTileId,
            selectedUnitId: clickedUnit.id,
            selectedTileId: clickedTileId,
            validMoveCosts: opts.moveCosts,
            validMoveTiles: Array.from(opts.moveCosts.keys()),
            validAttackTargets: opts.attackTargets,
            validSecureTile: opts.secureTiles[0] ?? null,
            validHeistTile: opts.heistTiles[0] ?? null,
            validSiegeTile: opts.siegeTiles[0] ?? null,
            validLootTile: opts.lootTiles[0] ?? null,
            validDemolishTile: opts.demolishTiles[0] ?? null,
          });
        }
        return;
      }

      // Anything else (an enemy, a unit that has acted, a tile): inspect it
      inspect();
    },

    secureBuilding: () => {
      const { selectedUnitId, validSecureTile } = get();
      if (selectedUnitId && validSecureTile) get().executeAiAction({ type: 'SECURE', unitId: selectedUnitId, tileId: validSecureTile, cost: INTERACT_COST });
    },

    heistBank: () => {
      const { selectedUnitId, validHeistTile } = get();
      if (selectedUnitId && validHeistTile) get().executeAiAction({ type: 'HEIST', unitId: selectedUnitId, tileId: validHeistTile, cost: INTERACT_COST });
    },

    siegeBase: () => {
      const { selectedUnitId, validSiegeTile, units } = get();
      const unit = units.find(u => u.id === selectedUnitId);
      if (selectedUnitId && validSiegeTile && unit) {
        get().executeAiAction({ type: 'SIEGE', unitId: selectedUnitId, tileId: validSiegeTile, cost: getUnitAttackCost(unit) });
      }
    },

    demolishBarrier: () => {
      const { selectedUnitId, validDemolishTile, units } = get();
      const unit = units.find(u => u.id === selectedUnitId);
      if (selectedUnitId && validDemolishTile && unit) {
        get().executeAiAction({ type: 'DEMOLISH', unitId: selectedUnitId, tileId: validDemolishTile, cost: getUnitAttackCost(unit) });
      }
    },

    lootSupply: () => {
      const { selectedUnitId, validLootTile } = get();
      if (selectedUnitId && validLootTile) get().executeAiAction({ type: 'LOOT', unitId: selectedUnitId, tileId: validLootTile, cost: INTERACT_COST });
    },

    resolveBankReward: (choice) => {
      if (get().bankRewardPending) get().executeAiAction({ type: 'BANK_REWARD', choice });
    },

    buyShopItem: (itemKey: string, variant?: string) => {
      const { currentPlayer, playerGold, isAiTurn } = get();
      const item = SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS];
      if (!item || isAiTurn || playerGold[currentPlayer] < item.cost) return;
      if (item.type === 'CONSTRUCT') {
        // Pick where to build next
        set({ placementMode: { active: true, itemKey, cost: item.cost, variant }, selectedUnitId: null, validMoveTiles: [] });
        return;
      }
      get().executeAiAction({ type: 'BUY_ITEM', itemKey });
    },

    cancelPlacement: () => set({ placementMode: null }),

    endTurn: () => get().executeAiAction({ type: 'END_TURN' }),

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
      set({
        ...next,
        ...CLEAR_SELECTION,
        // While the AI plays, keep whatever you're inspecting
        ...(aiNext ? { selectedUnitId: state.selectedUnitId, selectedTileId: state.selectedTileId } : {}),
        visibleTiles: visibleSet(next, next.settings.gameMode === 'PVE' ? 0 : next.currentPlayer),
        isAiTurn: aiNext,
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
      const game = pv.game;
      const isAiTurn = game.winner === null && game.currentPlayer !== view.mySeat;
      if (view.seq === state.onlineSeq && state.mode === 'ONLINE') {
        // Same game (only the seats changed): keep everything, so nothing redraws.
        set({ mySeat: view.mySeat, isAiTurn });
        return;
      }
      set({
        ...game,
        ...CLEAR_SELECTION,
        // While others play, keep whatever you're inspecting
        ...(isAiTurn ? { selectedUnitId: state.selectedUnitId, selectedTileId: state.selectedTileId } : {}),
        mode: 'ONLINE',
        mySeat: view.mySeat,
        onlineSeq: view.seq,
        lastCustomMap: null,
        visibleTiles: new Set(pv.visibleTiles),
        isAiTurn,
        currentScreen: 'GAME',
      });
      playEvents(view.events);
    },

    exitOnline: () => {
      const { localSettings } = get();
      set({
        ...emptyGame(localSettings ?? DEFAULT_GAME_SETTINGS),
        ...CLEAR_SELECTION,
        mode: 'LOCAL',
        online: null,
        localSettings: null,
        onlineSeq: -1,
        isAiTurn: false,
        currentScreen: 'ONLINE',
      });
    },
  };
});
