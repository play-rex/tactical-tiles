/**
 * The whole game as plain, serialisable data. The web store keeps these fields at its top
 * level (so components read them as before); the server keeps one per table.
 */
import { getEffectiveUnitAmmo } from '../rules/CombatRules';
import { UNIT_STATS } from '../constants/Config';
import type {
  ActiveAirDrop,
  AirDropKind,
  AirDropMeta,
  BankReward,
  BuildingSubType,
  ContractId,
  DeadUnit,
  DoomsdayZone,
  FinalPushStatus,
  SharedContract,
  ShopConstructId,
  SpectatorEffectId,
  BurningLine,
  PendingTactical,
  SmokeZone,
  TacticalAxis,
  TacticalFxPhase,
  TacticalId,
  TacticalSensor,
  GameMutators,
  GameSettings,
  LandMine,
  LogEntry,
  MatchPlayerStats,
  MatchSummary,
  MissionConfig,
  PendingDrop,
  PerkId,
  TerrainType,
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
  /** Round the last enemy HQ took damage; drives the AI aggression clock and the backstop. */
  lastHqDamageRound: number;
  playerCp: Record<number, number>;
  /** CP borrowed via Overclock, repaid automatically from the next turn's regen. */
  playerCpDebt?: Record<number, number>;
  /** CP borrowed this turn. Stays set even if a refund clears the debt, so one borrow per turn. */
  playerCpBorrowed?: Record<number, number>;
  /** Momentum CP refunded this turn, capped per player. */
  playerCpRefunded?: Record<number, number>;
  playerGold: Record<number, number>;
  playerRespawns: Record<number, number>;
  playerStatus: Record<number, PlayerStatus>;
  playerInventory: Record<number, InventoryItem[]>;
  /** Free Field Shop construct vouchers won from Field Supply Crates (e.g. LAND_MINE, BARRIER, BRIDGE, TUNNEL). */
  playerShopVouchers?: Record<number, ShopConstructId[]>;
  /** Free Tactical Weapon vouchers won from Tactical Supply Crates (bypasses round unlock & cooldown). */
  playerTacticalVouchers?: Record<number, TacticalId[]>;
  /** Active incoming Theater Air Supply Drops (DISPATCH at L-2, FLARE at L-1). */
  airDrops?: ActiveAirDrop[];
  /** Mystery crate landing-round bookkeeping & Tactical anti-streak memory. */
  airDropMeta?: AirDropMeta;
  winner: number | 'DRAW' | null;
  activeSeed: string;
  /** The match's closing-circle plan, computed once at setup. */
  doomsdayZone?: DoomsdayZone;
  /** Local challenge ops only; online tables never carry one. */
  activeMission: MissionConfig | null;
  matchStats: Record<number, MatchPlayerStats>;
  matchSummary: MatchSummary | null;
  bankRewardPending: BankReward | null;
  pendingDrops: PendingDrop[];
  mines: LandMine[];
  weather: WeatherState;
  gameLog: LogEntry[];
  /** Phase 3: first direct attack/Overwatch hit has already paid out. */
  firstContactDone?: boolean;
  /** The round's shared contract, if the deck had anything this board could support. */
  contract?: SharedContract | null;
  /** Contract ids already dealt this match (no repeats). */
  contractsUsed?: ContractId[];
  /** Consecutive contracts that expired unclaimed; drives the tier drop and doubled bonus. */
  contractMisses?: number;
  /** Per-seat progress toward the live contract. */
  contractProgress?: Record<number, number>;
  /** Final Push token per seat. Absent means never granted. */
  finalPush?: Record<number, FinalPushStatus>;
  /** Eliminated seat holding this round's spectator-attack window, if any. */
  spectatorTurn?: number | null;
  /** Windows opened so far; rotates the window through the eliminated seats. */
  spectatorWindow?: number;
  /** Round whose window has already been spent (one effect per window). */
  spectatorUsedRound?: number | null;
  /** Round in which each seat last bought a tactical weapon (one per round). */
  tacticalRound?: Record<number, number>;
  /** Round at which a specific tactical weapon comes off its 3-round cooldown per seat. */
  tacticalCooldowns?: Record<number, Partial<Record<TacticalId, number>>>;
  /** Round in which each seat spent its free round-2 Common pick. */
  freeTacticalRound?: Record<number, number>;
  /** Round in which a seat's trap reveal is live. */
  trapRevealRound?: Record<number, number>;
  /** Round in which a seat's radar reveal is live. */
  radarRound?: Record<number, number>;
  /** Remaining Overclock Core attack refunds per seat. */
  overclockCharges?: Record<number, number>;
  /** Telegraphed strikes waiting for the owner's next turn. */
  pendingTacticals?: PendingTactical[];
  /** Burning napalm lines, ticked at round end. */
  burningLines?: BurningLine[];
  /** Smoke clouds, ticked at round end. */
  smokeZones?: SmokeZone[];
  /** Recon drones, ticked at round end. */
  sensors?: TacticalSensor[];
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
  | { type: 'SIEGE'; unitId: string; tileId: string; cost: number }
  | { type: 'DEMOLISH'; unitId: string; tileId: string; cost: number }
  | { type: 'LOOT'; unitId: string; tileId: string; cost: number }
  /** A supply drop placed straight onto a tile beside one of your units (the AI's shop). */
  | { type: 'BUY_DROP'; itemKey: string; tileId: string; cost: number; goldCost: number }
  | { type: 'USE_ITEM'; unitId: string; itemIndex: number; cost: number }
  | { type: 'SPAWN'; unitType: UnitType; tileId: string; cost: number; deadUnitId?: string }
  /** A supply drop that lands at your chosen drop zone (or near your base) when your turn ends. */
  | { type: 'BUY_ITEM'; itemKey: string; tileId?: string }
  /** Build a Barrier wall, Land Mine, or Bridge from the shop. */
  | { type: 'BUILD'; itemKey: string; tileId: string; tileIds?: string[]; variant?: string }
  /** After a heist: take the vault's gold or its CP. */
  | { type: 'BANK_REWARD'; choice: 'GOLD' | 'CP' }
  /** Borrow CP now; the next turn's regen repays it automatically. */
  | { type: 'OVERCLOCK'; amount: number }
  /** Take the one-time Veteran perk. Free, and does not end the unit's action. */
  | { type: 'CHOOSE_PERK'; unitId: string; perkId: PerkId }
  /** Spend the once-per-match Final Push token: refill CP and clear Overclock debt. */
  | { type: 'FINAL_PUSH' }
  /** An eliminated player's window: fire one map effect. */
  | { type: 'SPECTATOR_ATTACK'; effectId: SpectatorEffectId }
  /** Buy and fire one tactical weapon. Gold-only; round cap and 3-round per-weapon cooldown enforced by engine. */
  | {
      type: 'USE_TACTICAL';
      itemKey: TacticalId;
      tileId?: string;
      /** Multi-target unit tiles for Carpet Run (1–3 distinct visible enemy unit tiles). */
      tileIds?: string[];
      /** Selected unit ID for Paradrop airlift relocation (own or enemy unit). */
      unitId?: string;
      axis?: TacticalAxis;
      width?: 1 | 2;
    };

export type GameActionType = GameAction['type'];

// ── Events ───────────────────────────────────────────────────────

export type SoundName =
  | 'click' | 'move' | 'attack' | 'sniper' | 'hit' | 'explosion' | 'heist' | 'capture' | 'turn' | 'victory';

export interface TilePoint { x: number; y: number }

export type WeaponVisual =
  | 'SOLDIER'
  | 'ASSAULTER'
  | 'SNIPER'
  | 'TURRET'
  | 'ARTILLERY'
  | 'SIEGE'
  | 'TACTICAL_DRONE'
  | 'TACTICAL_STRIKE'
  | 'TACTICAL_CARPET'
  | 'TACTICAL_BARRAGE'
  | 'TACTICAL_NAPALM';

export type KillCause = 'COMBAT' | 'OVERWATCH' | 'MINE' | 'TURRET' | 'ARTILLERY' | 'LAVA' | 'BASE_FALL' | 'TACTICAL';

/** Deterministic damage decomposition carried on combat hits for the Tactical Receipt. */
export interface DamageBreakdown {
  baseDamage: number;
  watchtowerBoosted: boolean;
  /** Terrain defense fraction (e.g. 0.4 for Forest, -0.1 for exposed Sand). */
  coverPct: number;
  coverTerrain?: TerrainType;
  /** True when Elite Breacher cover armor (-2 DMG) reduced the hit. */
  coverArmorApplied: boolean;
  crossfireBonus: number;
  isOverwatch?: boolean;
}

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
      breakdown?: DamageBreakdown;
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
      killerUnitId?: string;
      killerUnitType?: UnitType;
      victimPreHp?: number;
      zeroCpClutch?: boolean;
      isMatchWinning?: boolean;
      cause: KillCause;
      delayMs?: number;
    }
  | {
      kind: 'mineBlast';
      at: TilePoint;
      damage: number;
      victimUnitId?: string;
      victimDead?: boolean;
      mineOwner?: number;
      delayMs?: number;
    }
  | {
      kind: 'structureHit';
      at: TilePoint;
      structureType: 'BASE' | 'BARRIER' | 'BANK';
      damage: number;
      destroyed: boolean;
      owner?: number | null;
      attackerOwner?: number;
      isMatchWinning?: boolean;
      delayMs?: number;
    }
  | { kind: 'heist'; at: TilePoint; playerId: number }
  | { kind: 'capture'; at: TilePoint; owner: number; subType?: BuildingSubType }
  | { kind: 'spawn'; unitId: string; unitType: UnitType; owner: number; at: TilePoint }
  | { kind: 'promotion'; unitId: string; at: TilePoint; rank: number; label: string }
  | { kind: 'overwatchSet'; unitId: string; at: TilePoint; owner: number }
  | { kind: 'heal'; unitId: string; at: TilePoint; amount: number; item: 'MEDKIT' | 'FIRST_AID' | 'AMMO' | 'RELOAD' }
  | { kind: 'build'; tiles: TilePoint[]; itemKey: 'BARRIER' | 'BRIDGE' | 'TUNNEL' }
  | { kind: 'supplyLanded'; at: TilePoint; item: SupplyLootType }
  | {
      kind: 'airDrop';
      dropId: string;
      dropKind: AirDropKind;
      at: TilePoint;
      headingRad: number;
      staggerMs?: number;
      isDualConvoy?: boolean;
      rerouted?: boolean;
      companionAt?: TilePoint;
    }
  | {
      kind: 'tacticalFx';
      itemKey: TacticalId;
      phase: TacticalFxPhase;
      owner: number;
      anchor: TilePoint;
      tiles: TilePoint[];
      pings?: TilePoint[];
      axis?: TacticalAxis;
      width?: 1 | 2;
      meta?: {
        sabotageKind?: 'CP' | 'STRIP';
        cpDrained?: number;
        victimOwner?: number;
        hitsCount?: number;
        from?: TilePoint;
        unitType?: UnitType;
      };
      delayMs?: number;
    };

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
  lastHqDamageRound: 0,
  playerCp: {},
  playerCpDebt: {},
  playerCpBorrowed: {},
  playerCpRefunded: {},
  playerGold: {},
  playerRespawns: {},
  playerStatus: {},
  playerInventory: {},
  playerShopVouchers: {},
  playerTacticalVouchers: {},
  airDrops: [],
  airDropMeta: { crateRounds: {}, openedCount: 0 },
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
  firstContactDone: false,
  contract: null,
  contractsUsed: [],
  contractMisses: 0,
  contractProgress: {},
  finalPush: {},
  spectatorTurn: null,
  spectatorWindow: 0,
  spectatorUsedRound: null,
});
