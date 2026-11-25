/**
 * The rules of a turn: apply one action to a game and get the next game back, plus the
 * effects (shots, damage numbers, sounds) for a client to play. Pure apart from the dice
 * (base artillery and where a supply drop lands use Math.random).
 */
import {
  BANK_STATS,
  BARRIER_STATS,
  BASE_STATS,
  COMBAT_BONUSES,
  CP_OVERFLOW_GOLD_RATE,
  CP_SYSTEM,
  DOOMSDAY_ESCALATION,
  DOOMSDAY_SETTINGS,
  GOLD_SETTINGS,
  MOMENTUM_REFUNDS,
  LAND_MINE_STATS,
  MATCH_ROUND_CAP,
  OVERWATCH_STATS,
  RESPAWN_CP_COST,
  RESPAWN_TIMERS,
  SHOP_ITEMS,
  TACTICAL_COOLDOWN_ROUNDS,
  UNIT_STATS,
  VETERANCY_CONFIG,
} from '../constants/Config';
import type { ActiveAirDrop, AirDropMeta, BuildingSubType, BurningLine, DeadUnit, FinalPushStatus, LandMine, LogEntry, MatchPlayerStats, PendingDrop, PendingTactical, SharedContract, ShopConstructId, SmokeZone, SupplyLootType, TacticalId, TacticalSensor, TerrainType, Tile, Unit, UnitType } from '../types';
import { isSpectatorWindowRound, SPECTATOR_EFFECTS } from './SpectatorOps';
import {
  advanceAirDropsForRound,
  rollFieldSupplyCrate,
  rollTacticalSupplyCrate,
  type AirDropFlightPlan,
} from './airDrops';
import {
  TACTICAL_ITEMS,
  TACTICAL_MIN_HP_FLOOR,
  applyNapalmEntry,
  hasTacticalVoucher,
  resolveDueTacticals,
  resolveTactical,
  tacticalBlocker,
  tacticalIsFree,
  tacticalIsRound2StarterFree,
  tacticalTilesFor,
  tickTacticalRoundEnd,
  type TacticalFxEventInput,
} from '../tactical';
import { CONTRACT_DURATION_ROUNDS, CONTRACT_UNDERDOG_CP, CONTRACT_UNDERDOG_GOLD, contractDef, contractProgressFor, dealContract, lastPlaceSeat, toSharedContract, type ContractEvent } from './Contracts';
import { isPerkForClass, PERK_LABELS } from '../constants/Perks';
import { getManhattanDistance, getTileByIdFast } from '../grid/Pathfinding';
import { getDoomsdayEscalation, updateDoomsdayState } from '../grid/DoomsdayManager';
import {
  applyUnitXp,
  calculateAttackOutcome,
  calculateDemolishDamage,
  calculateOverwatchOutcome,
  calculateSiegeDamage,
  canConstructOnTile,
  canHoldDrop,
  canUnitEnterOverwatch,
  getBaseArtilleryDamage,
  getBaseArtillerySplashDamage,
  getEffectiveBankRewards,
  getEffectiveCpRules,
  getEffectiveMaxRespawns,
  getUnitBaseDamage,
  getUnitMaxHp,
  resolveBridgeVariant,
} from '../rules/CombatRules';
import { resolveMoveWithOverwatch } from '../rules/OverwatchRules';
import { calculateMatchScorecard } from '../storage/CareerStatsManager';
import { createSeededRng } from '../utils/SeededRandom';
import { getCrossfireSupporters, getSupplyDropTargets, isConstruct, isConsumable, isValidSpawnTile, visibleSet } from './options';
import { rollWeather } from './setup';
import {
  createLog,
  createUnit,
  cloneMatchStats,
  MAX_LOG_ENTRIES,
  nextActivePlayer,
  type DamageBreakdown,
  type GameAction,
  type GameEvent,
  type GameState,
  type KillCause,
  type SoundName,
  type TilePoint,
  type WeaponVisual,
} from './state';

const itemKeyToLoot = (itemKey: string): SupplyLootType =>
  itemKey === 'AMMO_REFILL' ? 'AMMO' : itemKey === 'FIRST_AID' ? 'FIRST_AID' : 'MEDKIT';

export interface ApplyOptions {
  /**
   * The acting player is a bot: after a heist it takes the vault's gold or CP at once
   * instead of leaving the choice open.
   */
  autoBankReward?: boolean;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  /** Set when the action couldn't be applied; `state` is then the game unchanged. */
  rejected?: string;
}

const pt = (tile: Pick<Tile, 'x' | 'y'>): TilePoint => ({ x: tile.x, y: tile.y });

/** Collects an action's effects as it resolves. */
class Fx {
  events: GameEvent[] = [];
  sound(sound: SoundName, delayMs?: number) {
    this.events.push(delayMs !== undefined ? { kind: 'sound', sound, delayMs } : { kind: 'sound', sound });
  }
  projectile(
    from: Tile,
    to: Tile,
    style: 'BULLET' | 'LASER' | 'MISSILE',
    meta?: { weapon?: WeaponVisual; attackerId?: string; targetUnitId?: string; delayMs?: number; travelMs?: number },
  ) {
    this.events.push({
      kind: 'projectile',
      from: pt(from),
      to: pt(to),
      style,
      ...(meta?.weapon ? { weapon: meta.weapon } : {}),
      ...(meta?.attackerId ? { attackerId: meta.attackerId } : {}),
      ...(meta?.targetUnitId ? { targetUnitId: meta.targetUnitId } : {}),
      ...(meta?.delayMs !== undefined ? { delayMs: meta.delayMs } : {}),
      ...(meta?.travelMs !== undefined ? { travelMs: meta.travelMs } : {}),
    });
  }
  popup(at: Tile, text: string, color: string, lift: number, delayMs?: number) {
    this.events.push(
      delayMs !== undefined
        ? { kind: 'popup', at: pt(at), text, color, lift, delayMs }
        : { kind: 'popup', at: pt(at), text, color, lift },
    );
  }
  shake(intensity: number, at?: Tile, delayMs?: number) {
    this.events.push({
      kind: 'shake',
      intensity,
      ...(at ? { at: pt(at) } : {}),
      ...(delayMs !== undefined ? { delayMs } : {}),
    });
  }
  movePath(unit: Pick<Unit, 'id' | 'type' | 'owner'>, path: Tile[], haltedAt?: number) {
    if (path.length < 2) return;
    this.events.push({
      kind: 'movePath',
      unitId: unit.id,
      unitType: unit.type,
      owner: unit.owner,
      path: path.map(pt),
      ...(haltedAt !== undefined ? { haltedAt } : {}),
    });
  }
  hit(params: {
    targetUnitId?: string;
    at: Tile;
    from?: Tile;
    damage: number;
    weapon?: WeaponVisual;
    isKill?: boolean;
    isCrit?: boolean;
    suppressed?: boolean;
    crossfireFrom?: Tile[];
    breakdown?: DamageBreakdown;
    delayMs?: number;
  }) {
    const crossfirePts = params.crossfireFrom && params.crossfireFrom.length > 0 ? params.crossfireFrom.map(pt) : undefined;
    this.events.push({
      kind: 'hit',
      ...(params.targetUnitId ? { targetUnitId: params.targetUnitId } : {}),
      at: pt(params.at),
      ...(params.from ? { from: pt(params.from) } : {}),
      damage: params.damage,
      ...(params.weapon ? { weapon: params.weapon } : {}),
      ...(params.isKill ? { isKill: true } : {}),
      ...(params.isCrit ? { isCrit: true } : {}),
      ...(params.suppressed ? { suppressed: true } : {}),
      ...(crossfirePts ? { crossfireFrom: crossfirePts } : {}),
      ...(params.breakdown ? { breakdown: params.breakdown } : {}),
      ...(params.delayMs !== undefined ? { delayMs: params.delayMs } : {}),
    });
  }
  killed(
    unit: Pick<Unit, 'id' | 'type' | 'owner' | 'rank'> & { hp?: number },
    at: Tile,
    cause: KillCause,
    killerOwner?: number,
    meta?: { killerUnitId?: string; killerUnitType?: UnitType; zeroCpClutch?: boolean },
  ) {
    this.events.push({
      kind: 'killed',
      unitId: unit.id,
      unitType: unit.type,
      owner: unit.owner,
      rank: unit.rank ?? 0,
      at: pt(at),
      ...(killerOwner !== undefined ? { killerOwner } : {}),
      ...(meta?.killerUnitId ? { killerUnitId: meta.killerUnitId } : {}),
      ...(meta?.killerUnitType ? { killerUnitType: meta.killerUnitType } : {}),
      ...(unit.hp !== undefined ? { victimPreHp: unit.hp } : {}),
      ...(meta?.zeroCpClutch ? { zeroCpClutch: true } : {}),
      cause,
    });
  }
  mineBlast(at: Tile, damage: number, victimUnitId?: string, victimDead?: boolean, mineOwner?: number) {
    this.events.push({
      kind: 'mineBlast',
      at: pt(at),
      damage,
      ...(victimUnitId ? { victimUnitId } : {}),
      ...(victimDead !== undefined ? { victimDead } : {}),
      ...(mineOwner !== undefined ? { mineOwner } : {}),
    });
  }
  structureHit(
    at: Tile,
    structureType: 'BASE' | 'BARRIER' | 'BANK',
    damage: number,
    destroyed: boolean,
    owner?: number | null,
    attackerOwner?: number,
  ) {
    this.events.push({
      kind: 'structureHit',
      at: pt(at),
      structureType,
      damage,
      destroyed,
      ...(owner !== undefined ? { owner } : {}),
      ...(attackerOwner !== undefined ? { attackerOwner } : {}),
    });
  }
  heist(at: Tile, playerId: number) {
    this.events.push({ kind: 'heist', at: pt(at), playerId });
  }
  capture(at: Tile, owner: number, subType?: BuildingSubType) {
    this.events.push({
      kind: 'capture',
      at: pt(at),
      owner,
      ...(subType ? { subType } : {}),
    });
  }
  spawn(unitId: string, unitType: UnitType, owner: number, at: Tile) {
    this.events.push({ kind: 'spawn', unitId, unitType, owner, at: pt(at) });
  }
  promotion(unitId: string, at: Tile, rank: number, label: string) {
    this.events.push({ kind: 'promotion', unitId, at: pt(at), rank, label });
  }
  overwatchSet(unitId: string, at: Tile, owner: number) {
    this.events.push({ kind: 'overwatchSet', unitId, at: pt(at), owner });
  }
  heal(unitId: string, at: Tile, amount: number, item: 'MEDKIT' | 'FIRST_AID' | 'AMMO' | 'RELOAD') {
    this.events.push({ kind: 'heal', unitId, at: pt(at), amount, item });
  }
      build(tiles: Tile[], itemKey: 'BARRIER' | 'BRIDGE' | 'TUNNEL') {
    if (tiles.length === 0) return;
    this.events.push({ kind: 'build', tiles: tiles.map(pt), itemKey });
  }
  supplyLanded(at: Tile, item: SupplyLootType) {
    this.events.push({ kind: 'supplyLanded', at: pt(at), item });
  }
  airDrop(plan: AirDropFlightPlan) {
    this.events.push({
      kind: 'airDrop',
      dropId: plan.dropId,
      dropKind: plan.dropKind,
      at: { x: plan.at.x, y: plan.at.y },
      headingRad: plan.headingRad,
      ...(plan.staggerMs ? { staggerMs: plan.staggerMs } : {}),
      ...(plan.isDualConvoy ? { isDualConvoy: true } : {}),
      ...(plan.rerouted ? { rerouted: true } : {}),
      ...(plan.companionAt ? { companionAt: { x: plan.companionAt.x, y: plan.companionAt.y } } : {}),
    });
  }
  tacticalFx(input: TacticalFxEventInput) {
    this.events.push({
      kind: 'tacticalFx',
      itemKey: input.itemKey,
      phase: input.phase,
      owner: input.owner,
      anchor: pt(input.anchor),
      tiles: input.tiles.map(pt),
      ...(input.pings && input.pings.length > 0 ? { pings: input.pings.map(pt) } : {}),
      ...(input.axis ? { axis: input.axis } : {}),
      ...(input.width ? { width: input.width } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
    });
  }
}

const grantUnitXp = (
  unitsList: Unit[],
  unitId: string,
  gainedXp: number,
  map: Tile[],
  gridSize: number,
  playerId: number,
  round: number,
  matchStats: Record<number, MatchPlayerStats>,
  extraLogs: LogEntry[],
  fx: Fx,
): Unit[] => {
  if (gainedXp <= 0) return unitsList;
  return unitsList.map(u => {
    if (u.id !== unitId) return u;
    const { unit: promotedUnit, promotedTo } = applyUnitXp(u, gainedXp);
    if (promotedTo !== null) {
      const uTile = getTileByIdFast(map, promotedUnit.tileId, gridSize);
      const rankLabel = VETERANCY_CONFIG.RANK_LABELS[promotedTo];
      if (uTile) {
        fx.promotion(promotedUnit.id, uTile, promotedTo, rankLabel);
        fx.popup(uTile, rankLabel, '#FFD700', 24);
      }
      fx.sound('capture');
      const rankName = VETERANCY_CONFIG.RANK_NAMES[promotedTo];
      extraLogs.push(createLog(round, playerId, `${UNIT_STATS[promotedUnit.type].name} promoted to ${rankName}!`, 'COMBAT'));
      if (promotedTo === 3 && matchStats[playerId]) {
        matchStats[playerId].acesPromoted += 1;
      }
    }
    return promotedUnit;
  });
};

const pushGraveyard = (graveyard: GameState['graveyard'], unit: Pick<Unit, 'id' | 'type' | 'owner'>) => {
  graveyard.push({ id: unit.id, type: unit.type, owner: unit.owner, turnsUntilRespawn: RESPAWN_TIMERS[unit.type] });
};

const applyUnitHit = (params: {
  unitsList: Unit[];
  target: Unit;
  targetTile: Tile | undefined;
  dmg: number;
  suppressLogPlayerId: number;
  suppressMessage: string;
  graveyard: GameState['graveyard'];
  round: number;
  extraLogs: LogEntry[];
  fx: Fx;
}): { unitsList: Unit[]; killed: boolean } => {
  const { unitsList, target, targetTile, dmg, suppressLogPlayerId, suppressMessage, graveyard, round, extraLogs, fx } = params;
  const remainingHp = target.hp - dmg;
  if (remainingHp <= 0) {
    pushGraveyard(graveyard, target);
    return { unitsList: unitsList.filter(u => u.id !== target.id), killed: true };
  }
  if (target.isOverwatching && dmg > 0) {
    if (targetTile) fx.popup(targetTile, 'SUPPRESSED!', '#FF9800', 28);
    extraLogs.push(createLog(round, suppressLogPlayerId, suppressMessage, 'COMBAT'));
  }
  return {
    killed: false,
    unitsList: unitsList.map(u =>
      u.id === target.id ? { ...u, hp: remainingHp, isOverwatching: dmg > 0 ? false : u.isOverwatching } : u,
    ),
  };
};

const grantAceBounty = (params: {
  victim: Unit;
  rewardPlayer: number;
  popupTile: Tile | undefined;
  round: number;
  nextPlayerGold: Record<number, number>;
  extraLogs: LogEntry[];
  fx: Fx;
}) => {
  const { victim, rewardPlayer, popupTile, round, nextPlayerGold, extraLogs, fx } = params;
  if ((victim.rank ?? 0) < 3) return;
  nextPlayerGold[rewardPlayer] = (nextPlayerGold[rewardPlayer] ?? 0) + VETERANCY_CONFIG.ACE_BOUNTY_GOLD;
  if (popupTile) fx.popup(popupTile, `+€${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} BOUNTY`, '#FFD700', 36);
  extraLogs.push(createLog(round, rewardPlayer, `Ace Bounty claimed! +€${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} Euros`, 'ECONOMY'));
};

const detonateMineOnUnit = (params: {
  victim: Unit;
  mineOwner: number;
  tile: Tile;
  damage: number;
  destTileId?: string;
  markMoved?: boolean;
  isRooted?: boolean;
  unitsList: Unit[];
  graveyardList: DeadUnit[];
  round: number;
  nextPlayerGold: Record<number, number>;
  nextMatchStats: Record<number, MatchPlayerStats>;
  extraLogs: LogEntry[];
  fx: Fx;
}): { units: Unit[]; victimDead: boolean; mineLog: LogEntry } => {
  const {
    victim, mineOwner, tile, damage, destTileId, markMoved, isRooted,
    unitsList, graveyardList, round, nextPlayerGold, nextMatchStats, extraLogs, fx,
  } = params;
  const victimDead = victim.hp - damage <= 0;
  fx.mineBlast(tile, damage, victim.id, victimDead, mineOwner);
  fx.sound('explosion');
  fx.popup(tile, 'LAND MINE!', '#EF4444', 34);
  fx.popup(tile, `-${damage}`, '#FF6D00', 14);
  fx.shake(9, tile);
  if (victimDead) {
    fx.killed(victim, tile, 'MINE', mineOwner);
  }
  if (nextMatchStats[mineOwner]) {
    nextMatchStats[mineOwner].damageDealt += damage;
    if (victimDead) nextMatchStats[mineOwner].kills += 1;
  }
  let nextUnits = unitsList;
  if (victimDead) {
    nextUnits = nextUnits.filter(u => u.id !== victim.id);
    pushGraveyard(graveyardList, victim);
    if (nextMatchStats[victim.owner]) {
      nextMatchStats[victim.owner].unitsLost += 1;
    }
    grantAceBounty({ victim, rewardPlayer: mineOwner, popupTile: tile, round, nextPlayerGold, extraLogs, fx });
  } else {
    nextUnits = nextUnits.map(u => u.id === victim.id ? {
      ...u,
      hp: victim.hp - damage,
      ...(destTileId !== undefined ? { tileId: destTileId } : {}),
      ...(markMoved !== undefined ? { hasMoved: markMoved } : {}),
      ...(isRooted !== undefined ? { isRooted } : {}),
    } : u);
  }
  const mineLog = createLog(
    round,
    mineOwner,
    `LAND MINE! ${UNIT_STATS[victim.type].name} triggered a mine (-${damage} HP${victimDead ? ', ELIMINATED' : ''})`,
    'COMBAT',
  );
  return { units: nextUnits, victimDead, mineLog };
};

const applyCombatOutcomeToStatsAndXp = (params: {
  attackerId: string;
  attackerOwner: number;
  attTile: Tile | undefined;
  victim: Unit;
  dmg: number;
  isKill: boolean;
  unitsList: Unit[];
  map: Tile[];
  gridSize: number;
  round: number;
  nextPlayerGold: Record<number, number>;
  nextMatchStats: Record<number, MatchPlayerStats>;
  extraLogs: LogEntry[];
  fx: Fx;
}): Unit[] => {
  const { attackerId, attackerOwner, attTile, victim, dmg, isKill, map, gridSize, round, nextPlayerGold, nextMatchStats, extraLogs, fx } = params;
  let updatedUnits = params.unitsList;

  if (nextMatchStats[attackerOwner]) {
    nextMatchStats[attackerOwner].damageDealt += dmg;
    if (isKill) nextMatchStats[attackerOwner].kills += 1;
  }

  if (isKill) {
    if (nextMatchStats[victim.owner]) {
      nextMatchStats[victim.owner].unitsLost += 1;
    }
    grantAceBounty({
      victim,
      rewardPlayer: attackerOwner,
      popupTile: attTile,
      round,
      nextPlayerGold,
      extraLogs,
      fx,
    });
    const xpGain = (victim.rank ?? 0) >= 2 ? 3 : 2;
    updatedUnits = grantUnitXp(updatedUnits, attackerId, xpGain, map, gridSize, attackerOwner, round, nextMatchStats, extraLogs, fx);
  } else if (dmg > 0) {
    updatedUnits = grantUnitXp(updatedUnits, attackerId, 1, map, gridSize, attackerOwner, round, nextMatchStats, extraLogs, fx);
  }

  return updatedUnits;
};

const actionCost = (action: GameAction): number => ('cost' in action ? action.cost : 0);

export function applyAction(state: GameState, action: GameAction, options: ApplyOptions = {}): ApplyResult {
  const {
    mapData, units, currentPlayer, playerCp, playerGold, graveyard, settings, weather, playerRespawns,
    totalTurns, turnCounter, playerStatus, gridSize, bankRewardPending, pendingDrops, playerInventory,
    playerCpDebt = {},
    playerCpBorrowed = {},
    playerCpRefunded = {},
    mines = [],
    firstContactDone = false,
    contract = null,
    contractsUsed = [],
    contractProgress = {},
    contractMisses = 0,
    finalPush = {},
    spectatorTurn = null,
    spectatorWindow = 0,
    spectatorUsedRound = null,
    pendingTacticals = [],
    burningLines = [],
    smokeZones = [],
    sensors = [],
    tacticalRound = {},
    tacticalCooldowns = {},
    freeTacticalRound = {},
    trapRevealRound = {},
    radarRound = {},
    overclockCharges = {},
    playerShopVouchers = {},
    playerTacticalVouchers = {},
    airDrops = [],
    airDropMeta = { crateRounds: {}, openedCount: 0 },
  } = state;
  const reject = (reason: string): ApplyResult => ({ state, events: [], rejected: reason });
  const fx = new Fx();

  if (state.winner !== null) return reject('Match is already over');

  // Not enough CP for the action (ending the turn and a spectator window are always free)
  if (action.type !== 'END_TURN' && action.type !== 'SPECTATOR_ATTACK' && playerCp[currentPlayer] < actionCost(action)) {
    return reject('Not enough CP');
  }

  let newMap = [...mapData];
  let newUnits = [...units];
  const newPlayerCpDebt = { ...playerCpDebt };
  const newPlayerCpBorrowed = { ...playerCpBorrowed };
  const newPlayerCpRefunded = { ...playerCpRefunded };
  let newGraveyard = [...graveyard];
  let newWinner = state.winner;
  let newTotalTurns = totalTurns;
  const nextPlayerStatus = { ...playerStatus };
  const newWeather = { ...weather, playerZones: { ...weather.playerZones } };
  let newBankReward = bankRewardPending;
  let newPendingDrops: PendingDrop[] = pendingDrops;
  let newMines: LandMine[] = [...mines];
  let newPendingTacticals: PendingTactical[] = [...pendingTacticals];
  let newBurningLines: BurningLine[] = burningLines.map(line => ({ ...line, hits: { ...line.hits } }));
  let newSmokeZones: SmokeZone[] = [...smokeZones];
  let newSensors: TacticalSensor[] = [...sensors];
  const newTacticalRound = { ...tacticalRound };
  const newTacticalCooldowns: Record<number, Partial<Record<TacticalId, number>>> = {};
  for (const key of Object.keys(tacticalCooldowns)) {
    const seatKey = Number(key);
    newTacticalCooldowns[seatKey] = { ...(tacticalCooldowns[seatKey] ?? {}) };
  }
  const newFreeTacticalRound = { ...freeTacticalRound };
  const newTrapRevealRound = { ...trapRevealRound };
  const newRadarRound = { ...radarRound };
  const newOverclockCharges = { ...overclockCharges };

  const nextPlayerCp = { ...playerCp };
  const nextPlayerGold = { ...playerGold };
  const nextPlayerRespawns = { ...playerRespawns };
  const nextPlayerInventory = { ...playerInventory };
  const nextPlayerShopVouchers: Record<number, ShopConstructId[]> = {};
  for (const key of Object.keys(playerShopVouchers)) {
    const seatKey = Number(key);
    nextPlayerShopVouchers[seatKey] = [...(playerShopVouchers[seatKey] ?? [])];
  }
  const nextPlayerTacticalVouchers: Record<number, TacticalId[]> = {};
  for (const key of Object.keys(playerTacticalVouchers)) {
    const seatKey = Number(key);
    nextPlayerTacticalVouchers[seatKey] = [...(playerTacticalVouchers[seatKey] ?? [])];
  }
  let newAirDrops: ActiveAirDrop[] = airDrops.map(d => ({ ...d, sectorCenter: { ...d.sectorCenter } }));
  let newAirDropMeta: AirDropMeta = {
    crateRounds: { ...(airDropMeta?.crateRounds ?? {}) },
    lastTacticalTier: airDropMeta?.lastTacticalTier,
    lastTacticalId: airDropMeta?.lastTacticalId,
    openedCount: airDropMeta?.openedCount ?? 0,
    lastLz: airDropMeta?.lastLz ? { ...airDropMeta.lastLz } : undefined,
  };
  const nextMatchStats = cloneMatchStats(state.matchStats, settings.playerCount);
  let newMatchSummary = state.matchSummary;

  let logEntry: LogEntry | null = null;
  const extraLogs: LogEntry[] = [];
  const currentRound = totalTurns + 1;
  let nextLastHqDamageRound = state.lastHqDamageRound ?? 0;

  const tacticalWeaponVisualFor = (itemKey?: TacticalId): WeaponVisual => {
    switch (itemKey) {
      case 'RECON_DRONE':
        return 'TACTICAL_DRONE';
      case 'PRECISION_STRIKE':
        return 'TACTICAL_STRIKE';
      case 'CARPET_RUN':
        return 'TACTICAL_CARPET';
      case 'ARTILLERY_BARRAGE':
        return 'TACTICAL_BARRAGE';
      case 'NAPALM_LINE':
        return 'TACTICAL_NAPALM';
      default:
        return 'TACTICAL_STRIKE';
    }
  };

  /** Tactical damage is owner-attributed, fog-safe, and strictly non-lethal (never below 2 HP). */
  const damageTacticalUnit = (
    fallbackOwner: number,
    unitId: string,
    damage: number,
    label: string,
    sourceOwner?: number,
    itemKey?: TacticalId,
  ): void => {
    const victim = newUnits.find(u => u.id === unitId);
    if (!victim || damage <= 0) return;
    const clamped = Math.min(damage, Math.max(0, victim.hp - TACTICAL_MIN_HP_FLOOR));
    if (clamped <= 0) return;
    const owner = sourceOwner ?? fallbackOwner;
    const weapon = tacticalWeaponVisualFor(itemKey);
    const tile = getTileByIdFast(newMap, victim.tileId, gridSize);
    if (nextMatchStats[owner]) nextMatchStats[owner].damageDealt += clamped;
    if (tile) {
      fx.hit({ targetUnitId: victim.id, at: tile, damage: clamped, weapon, isKill: false });
      fx.popup(tile, itemKey === 'NAPALM_LINE' ? `-${clamped} 🔥` : `-${clamped}`, itemKey === 'NAPALM_LINE' ? '#FB923C' : '#FF6D00', 16);
      fx.shake(4, tile);
    }
    newUnits = newUnits.map(u => (u.id === victim.id ? { ...u, hp: victim.hp - clamped } : u));
    void label;
  };

  /** Barrages damage barriers; HQs, banks and bridges stay immune. */
  const damageTacticalBarrier = (tileId: string, damage: number): void => {
    const tile = getTileByIdFast(newMap, tileId, gridSize);
    if (!tile || tile.type !== 'BARRIER' || (tile.hp ?? 0) <= 0) return;
    const hp = Math.max(0, (tile.hp ?? 0) - damage);
    newMap = newMap.map(t =>
      t.id !== tileId
        ? t
        : hp <= 0
          ? { ...t, type: 'PLAINS' as const, hp: undefined, maxHp: undefined, height: 1 }
          : { ...t, hp },
    );
    fx.sound('explosion');
  };

  // ── Phase 3 match arc state ──
  let newFirstContactDone = firstContactDone;
  let newContract: SharedContract | null = contract;
  let newContractsUsed = [...contractsUsed];
  let newContractProgress = { ...contractProgress };
  let newContractMisses = contractMisses;
  const newFinalPush: Record<number, FinalPushStatus> = { ...finalPush };
  let newSpectatorTurn: number | null = spectatorTurn;
  let newSpectatorWindow = spectatorWindow;
  let newSpectatorUsedRound: number | null = spectatorUsedRound;

  const spendCp = (cost: number) => {
    nextPlayerCp[currentPlayer] -= cost;
  };
  const spendGold = (cost: number) => {
    nextPlayerGold[currentPlayer] -= cost;
  };
  /**
   * Momentum refund: pays outstanding Overclock debt first, then adds CP, and stops at the
   * per-turn cap so a chain of kills cannot refill the whole battery.
   */
  /** True when a living ally with Bulwark stands next to the target. */
  const hasAdjacentBulwark = (target: Unit): boolean => {
    const t = getTileByIdFast(newMap, target.tileId, gridSize);
    if (!t) return false;
    return newUnits.some(u => {
      if (u.id === target.id || u.owner !== target.owner || u.perk !== 'BULWARK') return false;
      const ut = getTileByIdFast(newMap, u.tileId, gridSize);
      return !!ut && getManhattanDistance(t, ut) === 1;
    });
  };
  const refundCp = (playerId: number, amount: number): number => {
    const used = newPlayerCpRefunded[playerId] ?? 0;
    const granted = Math.min(amount, Math.max(0, MOMENTUM_REFUNDS.CAP - used));
    if (granted <= 0) return 0;
    newPlayerCpRefunded[playerId] = used + granted;
    const debt = newPlayerCpDebt[playerId] ?? 0;
    const toDebt = Math.min(debt, granted);
    if (toDebt > 0) newPlayerCpDebt[playerId] = debt - toDebt;
    const toCp = granted - toDebt;
    if (toCp > 0) nextPlayerCp[playerId] = (nextPlayerCp[playerId] ?? 0) + toCp;
    return granted;
  };

  // ── Phase 3 match arc ──
  const arcCpRules = getEffectiveCpRules(settings.mutators);
  /** Adds CP up to the battery cap and pays any overflow out as gold. Returns CP granted. */
  const awardCp = (playerId: number, amount: number): number => {
    if (amount <= 0) return 0;
    const held = nextPlayerCp[playerId] ?? 0;
    const room = Math.max(0, arcCpRules.maxCp - held);
    const granted = Math.min(amount, room);
    nextPlayerCp[playerId] = held + granted;
    const overflow = amount - granted;
    if (overflow > 0) {
      const converted = overflow * CP_OVERFLOW_GOLD_RATE;
      nextPlayerGold[playerId] = (nextPlayerGold[playerId] ?? 0) + converted;
      extraLogs.push(createLog(
        currentRound,
        playerId,
        `Battery full: ${overflow} CP converted to +€${converted}`,
        'ECONOMY',
      ));
    }
    return granted;
  };

  /**
   * The first direct exchange of the match pays both sides once: the attacker for starting it,
   * the defender so being shot is not a silent tempo loss. Direct attacks and Overwatch hits
   * only — mines, turrets and artillery are the map, not two armies meeting.
   */
  const grantFirstContact = (attacker: number, defender: number, at?: Tile): void => {
    if (newFirstContactDone || attacker === defender) return;
    newFirstContactDone = true;
    awardCp(attacker, 3);
    awardCp(defender, 2);
    extraLogs.push(createLog(currentRound, attacker, 'FIRST CONTACT! +3 CP (+2 CP to the defender)', 'COMBAT'));
    if (at) {
      fx.popup(at, 'FIRST CONTACT!', '#FDE047', 42);
      fx.sound('click');
    }
  };

  /** Scores one event toward the round's shared contract, and pays it out on completion. */
  const recordContract = (playerId: number, event: ContractEvent): void => {
    const live = newContract;
    if (!live || live.claimedBy !== null) return;
    const delta = contractProgressFor(live.id, event);
    if (delta <= 0) return;
    const next = Math.min(live.target, (newContractProgress[playerId] ?? 0) + delta);
    newContractProgress[playerId] = next;
    if (next < live.target) return;

    const def = contractDef(live.id);
    if (def?.claimableBy && !def.claimableBy(newUnits, playerId)) return;

    // The underdog bonus follows the completion, not the deal: the leader can still race for it.
    const underdog = lastPlaceSeat(nextPlayerStatus, newUnits, nextPlayerGold) === playerId;
    const multiplier = newContractMisses > 0 ? 2 : 1;
    const bonusCp = underdog ? CONTRACT_UNDERDOG_CP * multiplier : 0;
    const bonusGold = underdog ? CONTRACT_UNDERDOG_GOLD * multiplier : 0;
    const totalCp = live.rewardCp + bonusCp;
    const totalGold = live.rewardGold + bonusGold;
    const grantedCp = awardCp(playerId, totalCp);
    nextPlayerGold[playerId] = (nextPlayerGold[playerId] ?? 0) + totalGold;
    newContract = { ...live, claimedBy: playerId };
    newContractMisses = 0;

    const purse = [grantedCp > 0 ? `+${grantedCp} CP` : '', totalGold > 0 ? `+€${totalGold}` : ''].filter(Boolean).join(' ');
    extraLogs.push(createLog(
      currentRound,
      playerId,
      `CONTRACT: ${def?.name ?? live.id} complete! ${purse}${underdog ? ' (underdog)' : ''}`,
      'ECONOMY',
    ));
    const holder = newUnits.find(u => u.owner === playerId);
    const holderTile = holder ? getTileByIdFast(newMap, holder.tileId, gridSize) : undefined;
    if (holderTile) {
      fx.popup(holderTile, grantedCp > 0 ? `CONTRACT +${grantedCp} CP` : 'CONTRACT COMPLETE', '#34D399', 46);
      fx.sound('capture');
    }
  };

  switch (action.type) {
    case 'MOVE': {
      const mUnit = newUnits.find(u => u.id === action.unitId);
      if (!mUnit) return reject('Unit not found');
      const moveResolution = resolveMoveWithOverwatch({
        movingUnit: mUnit,
        targetTileId: action.targetTileId,
        mapData: newMap,
        units: newUnits,
        weather,
        gridSize,
        fogOfWar: settings.fogOfWar,
        maxBudget: playerCp[currentPlayer],
        mines: newMines,
        smokeZones: newSmokeZones,
      });

      // Only the CP actually walked is spent (it matters when Overwatch or a Land Mine halts the unit early)
      spendCp(moveResolution.actualCost);

      const destTile = moveResolution.finalTile ?? getTileByIdFast(newMap, action.targetTileId, gridSize);
      const trig = moveResolution.trigger;
      const mineTrig = moveResolution.mineTrigger;

      if (moveResolution.path.length >= 2) {
        const walkedPath =
          moveResolution.finalIndex >= 1
            ? moveResolution.path.slice(0, moveResolution.finalIndex + 1)
            : trig
              ? [moveResolution.path[0], trig.interceptTile, moveResolution.path[0]]
              : moveResolution.path.slice(0, 1);
        fx.movePath(mUnit, walkedPath, moveResolution.haltedEarly ? moveResolution.finalIndex : undefined);
      }

      if (trig) {
        const shooter = newUnits.find(u => u.id === trig.overwatcherId);
        const shooterTile = shooter ? getTileByIdFast(newMap, shooter.tileId, gridSize) : undefined;
        const interceptTile = trig.interceptTile;

        if (shooter) {
          fx.sound(shooter.type === 'SNIPER' ? 'sniper' : 'attack');
          fx.sound('hit');
          if (shooterTile) {
            const owOutcome = calculateOverwatchOutcome(shooter, shooterTile, interceptTile, mUnit.owner, mUnit);
            fx.projectile(shooterTile, interceptTile, shooter.type === 'SNIPER' ? 'LASER' : 'BULLET', {
              weapon: shooter.type,
              attackerId: shooter.id,
              targetUnitId: mUnit.id,
            });
            fx.hit({
              targetUnitId: mUnit.id,
              at: interceptTile,
              from: shooterTile,
              damage: trig.damage,
              weapon: shooter.type,
              isKill: trig.victimDead,
              isCrit: trig.damage >= 7,
              breakdown: {
                baseDamage: OVERWATCH_STATS[shooter.type].damage,
                watchtowerBoosted: owOutcome.watchtowerBoosted,
                coverPct: owOutcome.defense,
                coverTerrain: interceptTile.type,
                coverArmorApplied: owOutcome.coverArmorApplied,
                crossfireBonus: 0,
                isOverwatch: true,
              },
            });
            fx.popup(interceptTile, `-${trig.damage}`, '#FF6D00', 12);
            fx.shake(trig.damage > 5 ? 10 : 5, interceptTile);
          }
          if (trig.victimDead) {
            fx.killed(mUnit, interceptTile, 'OVERWATCH', shooter.owner, {
              killerUnitId: shooter.id,
              killerUnitType: shooter.type,
            });
            const refund = refundCp(shooter.owner, MOMENTUM_REFUNDS.KILL[mUnit.type]);
            if (refund > 0) {
              fx.popup(interceptTile, `+${refund} CP`, '#38BDF8', 34);
              extraLogs.push(createLog(currentRound, shooter.owner, `Momentum: +${refund} CP`, 'ECONOMY'));
            }
          }

          newUnits = newUnits.map(u => {
            if (u.id !== shooter.id) return u;
            return {
              ...u,
              isOverwatching: false,
              ammo: Math.max(0, u.ammo - 1),
              damageDealt: (u.damageDealt ?? 0) + trig.damage,
              kills: (u.kills ?? 0) + (trig.victimDead ? 1 : 0),
            };
          });

          if (trig.victimDead) {
            newUnits = newUnits.filter(u => u.id !== mUnit.id);
            pushGraveyard(newGraveyard, mUnit);
            logEntry = createLog(
              currentRound,
              shooter.owner,
              `OVERWATCH KILL! ${UNIT_STATS[shooter.type].name} eliminated ${UNIT_STATS[mUnit.type].name} (-${trig.damage} HP)`,
              'COMBAT',
            );
          } else {
            const isQuicksand = destTile?.type === 'QUICKSAND';
            const finalTileId = destTile ? destTile.id : mUnit.tileId;
            newUnits = newUnits.map(u => u.id === mUnit.id ? {
              ...u,
              tileId: finalTileId,
              hp: mUnit.hp - trig.damage,
              hasMoved: true,
              isRooted: isQuicksand,
            } : u);

            if (destTile && !mineTrig) {
              if (trig.pinResisted) {
                fx.popup(destTile, 'PIN RESISTED!', '#4CAF50', 26);
                extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} resisted Overwatch pin!`, 'COMBAT'));
              } else if (moveResolution.haltedEarly) {
                fx.popup(destTile, 'PINNED!', '#FF9800', 26);
              }
            }

            logEntry = createLog(
              currentRound,
              shooter.owner,
              `OVERWATCH! ${UNIT_STATS[shooter.type].name} hit ${UNIT_STATS[mUnit.type].name} (-${trig.damage} HP)`,
              'COMBAT',
            );
            if (isQuicksand && !mineTrig) {
              extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} stuck in Quicksand!`, 'INFO'));
            }
          }

          newUnits = applyCombatOutcomeToStatsAndXp({
            attackerId: shooter.id,
            attackerOwner: shooter.owner,
            attTile: shooterTile,
            victim: mUnit,
            dmg: trig.damage,
            isKill: trig.victimDead,
            unitsList: newUnits,
            map: newMap,
            gridSize,
            round: currentRound,
            nextPlayerGold,
            nextMatchStats,
            extraLogs,
            fx,
          });
          recordContract(shooter.owner, { kind: 'DAMAGE', amount: trig.damage });
          if (trig.victimDead) {
            recordContract(shooter.owner, {
              kind: 'KILL',
              victimRank: mUnit.rank ?? 0,
              viaOverwatch: true,
              crossfire: false,
            });
          }
          grantFirstContact(shooter.owner, mUnit.owner, shooterTile);
        }
      }

      if (mineTrig) {
        newMines = newMines.filter(m => m.id !== mineTrig.mineId);
        const curMover = newUnits.find(u => u.id === mUnit.id);
        if (curMover) {
          const isQuicksand = destTile?.type === 'QUICKSAND';
          const finalTileId = destTile ? destTile.id : curMover.tileId;
          const mineRes = detonateMineOnUnit({
            victim: curMover,
            mineOwner: mineTrig.mineOwner,
            tile: mineTrig.interceptTile,
            damage: mineTrig.damage,
            destTileId: finalTileId,
            markMoved: true,
            isRooted: isQuicksand,
            unitsList: newUnits,
            graveyardList: newGraveyard,
            round: currentRound,
            nextPlayerGold,
            nextMatchStats,
            extraLogs,
            fx,
          });
          newUnits = mineRes.units;
          if (logEntry) {
            extraLogs.push(mineRes.mineLog);
          } else {
            logEntry = mineRes.mineLog;
          }
          if (!mineRes.victimDead && isQuicksand && !trig) {
            extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[curMover.type].name} stuck in Quicksand!`, 'INFO'));
          }
        }
      } else if (!trig) {
        const isQuicksand = destTile?.type === 'QUICKSAND';
        newUnits = newUnits.map(u => u.id === action.unitId ? {
          ...u,
          tileId: destTile ? destTile.id : action.targetTileId,
          hasMoved: true,
          isRooted: isQuicksand,
        } : u);
        fx.sound('move');

        logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} moved to (${destTile?.x},${destTile?.y})`, 'MOVE');
        if (isQuicksand) {
          extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[mUnit.type].name} stuck in Quicksand!`, 'INFO'));
        }
      }

      // Napalm entry damage: once per move, capped per line, excluding the origin tile so walking off fire does not double-burn.
      if (newBurningLines.length > 0) {
        const moveEvent = fx.events.find(e => e.kind === 'movePath' && e.unitId === action.unitId);
        const walked = moveEvent && moveEvent.kind === 'movePath'
          ? moveEvent.path.slice(1).map(p => `${p.x},${p.y}`)
          : destTile && destTile.id !== mUnit.tileId
            ? [destTile.id]
            : [];
        const beforeNapalm = newBurningLines;
        newBurningLines = applyNapalmEntry(newBurningLines, action.unitId, walked, {
          units: newUnits,
          damageUnit: (id, dmg, label, sourceOwner, itemKey) =>
            damageTacticalUnit(currentPlayer, id, dmg, label, sourceOwner, itemKey),
          damageBarrier: damageTacticalBarrier,
          log: (message, type) => extraLogs.push(createLog(currentRound, currentPlayer, message, type)),
          fx,
        });
        if (newBurningLines !== beforeNapalm) {
          extraLogs.push(createLog(currentRound, currentPlayer, 'Napalm burns a unit crossing the line.', 'COMBAT'));
        }
      }
      break;
    }
    case 'OVERWATCH': {
      const unit = newUnits.find(u => u.id === action.unitId);
      const uTile = unit ? getTileByIdFast(newMap, unit.tileId, gridSize) : undefined;
      if (!unit || !canUnitEnterOverwatch(unit, uTile, playerCp[currentPlayer])) {
        return reject('Cannot enter Overwatch');
      }
      spendCp(actionCost(action));
      newUnits = newUnits.map(u => u.id === unit.id ? { ...u, isOverwatching: true, completed: true } : u);
      if (uTile) {
        fx.overwatchSet(unit.id, uTile, currentPlayer);
        fx.popup(uTile, 'OVERWATCH', '#FFB300', 20);
      }
      fx.sound('click');
      logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} set Overwatch (${action.cost} CP)`, 'COMBAT');
      break;
    }
    case 'RELOAD': {
      const unit = newUnits.find(u => u.id === action.unitId);
      if (!unit) return reject('Unit not found');
      spendCp(actionCost(action));
      const added = Math.max(1, Math.ceil(unit.maxAmmo / 2));
      const nextAmmo = Math.min(unit.maxAmmo, unit.ammo + added);
      const uTile = getTileByIdFast(newMap, unit.tileId, gridSize);
      newUnits = newUnits.map(u => u.id === unit.id ? { ...u, ammo: nextAmmo, completed: true } : u);
      if (uTile) {
        fx.heal(unit.id, uTile, Math.max(0, nextAmmo - unit.ammo), 'RELOAD');
        fx.popup(uTile, `+${Math.max(0, nextAmmo - unit.ammo)} AMMO`, '#FBBF24', 20);
      }
      fx.sound('click');
      logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} Field Reloaded (${nextAmmo}/${unit.maxAmmo} Ammo)`, 'ECONOMY');
      break;
    }
    case 'LOOT': {
      const unit = newUnits.find(u => u.id === action.unitId);
      const tile = getTileByIdFast(newMap, action.tileId, gridSize);
      if (!unit || !tile || !tile.loot) return reject('No loot to pick up');
      spendCp(actionCost(action));
      const lootItem = tile.loot;
      newUnits = newUnits.map(u => u.id === unit.id ? { ...u, completed: true } : u);
      newMap = newMap.map(t => t.id === tile.id ? { ...t, loot: null } : t);

      if (lootItem === 'FIELD_SUPPLY') {
        const reward = rollFieldSupplyCrate(
          { mapData: newMap, activeSeed: state.activeSeed },
          tile.id,
          currentRound,
          newAirDropMeta.openedCount,
        );
        newAirDropMeta.openedCount += 1;
        delete newAirDropMeta.crateRounds[tile.id];
        if (reward.category === 'CONSUMABLE') {
          const currentInv = nextPlayerInventory[currentPlayer] || [];
          nextPlayerInventory[currentPlayer] = [...currentInv, reward.item];
        } else {
          const curVouchers = nextPlayerShopVouchers[currentPlayer] ?? [];
          nextPlayerShopVouchers[currentPlayer] = [...curVouchers, reward.itemKey];
        }
        fx.popup(tile, `FIELD: ${reward.label.toUpperCase()}!`, '#22D3EE', 30);
        fx.sound('capture');
        logEntry = createLog(
          currentRound,
          currentPlayer,
          `Field Supply Crate: ${reward.label}${reward.category === 'CONSTRUCT' ? ' (FREE in Shop)' : ''}`,
          'ECONOMY',
        );
        break;
      }

      if (lootItem === 'TACTICAL_SUPPLY') {
        const reward = rollTacticalSupplyCrate(
          {
            settings,
            mines: newMines,
            activeSeed: state.activeSeed,
            airDropMeta: newAirDropMeta,
          },
          currentPlayer,
          tile.id,
          currentRound,
        );
        newAirDropMeta.openedCount += 1;
        newAirDropMeta.lastTacticalTier = reward.tier;
        newAirDropMeta.lastTacticalId = reward.itemKey;
        delete newAirDropMeta.crateRounds[tile.id];
        const curTacVouchers = nextPlayerTacticalVouchers[currentPlayer] ?? [];
        nextPlayerTacticalVouchers[currentPlayer] = [...curTacVouchers, reward.itemKey];
        const tierColor = reward.tier === 'EPIC' ? '#FACC15' : reward.tier === 'RARE' ? '#FB923C' : '#38BDF8';
        fx.popup(tile, `${reward.tier}: ${reward.label.toUpperCase()}!`, tierColor, 34);
        fx.shake(4, tile);
        fx.sound('capture');
        logEntry = createLog(
          currentRound,
          currentPlayer,
          `Tactical Supply Crate: ${reward.label} (${reward.tier} · FREE!)`,
          'ECONOMY',
        );
        break;
      }

      // Standard loose loot goes to the player's inventory, to use later
      const currentInv = nextPlayerInventory[currentPlayer] || [];
      nextPlayerInventory[currentPlayer] = [...currentInv, lootItem];
      fx.sound('click');
      logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} retrieved ${lootItem} to Inventory`, 'ECONOMY');
      break;
    }
    case 'USE_ITEM': {
      const itemIndex = action.itemIndex;
      const inv = nextPlayerInventory[currentPlayer];
      const item = inv?.[itemIndex];
      const unit = item ? newUnits.find(u => u.id === action.unitId) : undefined;
      if (!item || !unit) return reject('Cannot use item');
      spendCp(actionCost(action));
      const uTile = getTileByIdFast(newMap, unit.tileId, gridSize);
      if (item === 'MEDKIT') {
        const maxHp = getUnitMaxHp(unit);
        const healed = Math.max(0, maxHp - unit.hp);
        newUnits = newUnits.map(u => u.id === unit.id ? { ...u, hp: maxHp } : u);
        if (uTile) {
          fx.heal(unit.id, uTile, healed, 'MEDKIT');
          fx.popup(uTile, healed > 0 ? `+${healed} HP` : 'FULL HP', '#22C55E', 22);
        }
        fx.sound('capture');
      } else if (item === 'FIRST_AID') {
        const maxHp = getUnitMaxHp(unit);
        const healAmt = Math.ceil(maxHp * 0.5);
        const nextHp = Math.min(maxHp, unit.hp + healAmt);
        const healed = Math.max(0, nextHp - unit.hp);
        newUnits = newUnits.map(u => u.id === unit.id ? { ...u, hp: nextHp } : u);
        if (uTile) {
          fx.heal(unit.id, uTile, healed, 'FIRST_AID');
          fx.popup(uTile, healed > 0 ? `+${healed} HP` : 'FULL HP', '#22C55E', 22);
        }
        fx.sound('capture');
      } else if (item === 'AMMO') {
        const addedAmmo = Math.max(0, unit.maxAmmo - unit.ammo);
        newUnits = newUnits.map(u => u.id === unit.id ? { ...u, ammo: u.maxAmmo } : u);
        if (uTile) {
          fx.heal(unit.id, uTile, addedAmmo, 'AMMO');
          fx.popup(uTile, addedAmmo > 0 ? `+${addedAmmo} AMMO` : 'FULL AMMO', '#FBBF24', 22);
        }
        fx.sound('click');
      }
      const newInvList = [...inv];
      newInvList.splice(itemIndex, 1);
      nextPlayerInventory[currentPlayer] = newInvList;
      const itemLabel = item === 'FIRST_AID' ? 'First Aid Kit' : item;
      logEntry = createLog(currentRound, currentPlayer, `Used ${itemLabel} on ${UNIT_STATS[unit.type].name}`, 'ECONOMY');
      break;
    }
    case 'SECURE': {
      const unit = newUnits.find(u => u.id === action.unitId);
      const targetTile = getTileByIdFast(newMap, action.tileId, gridSize);
      if (!unit || !targetTile) return reject('Cannot secure building');
      spendCp(actionCost(action));
      const alreadyCapturedByPlayer = targetTile.capturedByOwners?.includes(currentPlayer) ?? false;
      newMap = newMap.map(t => {
        if (t.id !== action.tileId) return t;
        return {
          ...t,
          owner: currentPlayer,
          capturedByOwners: alreadyCapturedByPlayer ? t.capturedByOwners : [...(t.capturedByOwners ?? []), currentPlayer],
        };
      });
      newUnits = newUnits.map(u => u.id === action.unitId ? { ...u, completed: true } : u);
      if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].buildingsSecured += 1;
      if (!alreadyCapturedByPlayer) {
        newUnits = grantUnitXp(newUnits, unit.id, 1, newMap, gridSize, currentPlayer, currentRound, nextMatchStats, extraLogs, fx);
        const refund = refundCp(currentPlayer, MOMENTUM_REFUNDS.CAPTURE);
        if (refund > 0) {
          fx.popup(targetTile, `+${refund} CP`, '#38BDF8', 30);
          extraLogs.push(createLog(currentRound, currentPlayer, `Momentum: +${refund} CP`, 'ECONOMY'));
        }
      }
      fx.capture(targetTile, currentPlayer, targetTile.subType);
      fx.sound('capture');
      recordContract(currentPlayer, { kind: 'SECURE' });
      logEntry = createLog(currentRound, currentPlayer, `Secured a Building`, 'ECONOMY');
      break;
    }
    case 'BANK_REWARD': {
      if (!bankRewardPending) return reject('No vault to claim');
      spendCp(actionCost(action));
      const tile = getTileByIdFast(newMap, bankRewardPending.tileId, gridSize);
      const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(tile, settings.mutators);
      const pid = bankRewardPending.playerId;
      if (action.choice === 'GOLD') nextPlayerGold[pid] = nextPlayerGold[pid] + goldReward;
      else nextPlayerCp[pid] = nextPlayerCp[pid] + cpReward;
      newBankReward = null;
      break;
    }
    case 'ATTACK': {
      const att = newUnits.find(u => u.id === action.attackerId);
      const tar = newUnits.find(u => u.id === action.targetUnitId);
      if (!att || !tar) return reject('Invalid attack target');
      spendCp(actionCost(action));

      // Overclock Core refunds 2 CP per attack for three attacks, never above the battery cap.
      const overclock = newOverclockCharges[currentPlayer] ?? 0;
      const attTile = getTileByIdFast(mapData, att.tileId, gridSize);
      const tarTile = getTileByIdFast(mapData, tar.tileId, gridSize);
      if (overclock > 0) {
        const cpCap = getEffectiveCpRules(settings.mutators).maxCp;
        const refund = Math.min(2, Math.max(0, cpCap - (nextPlayerCp[currentPlayer] ?? 0)));
        if (refund > 0) {
          nextPlayerCp[currentPlayer] = (nextPlayerCp[currentPlayer] ?? 0) + refund;
          newOverclockCharges[currentPlayer] = overclock - 1;
          if (attTile) fx.popup(attTile, `+${refund} CP ⚡`, '#FACC15', 30);
          extraLogs.push(createLog(currentRound, currentPlayer, `Overclock Core refunded ${refund} CP`, 'ECONOMY'));
        }
      }
      const crossfireSupporters = tarTile ? getCrossfireSupporters(att, tarTile, newUnits, mapData, weather, gridSize) : [];
      const crossfireBonus = crossfireSupporters.length > 0 ? COMBAT_BONUSES.CROSSFIRE_DAMAGE : 0;
      const outcome = calculateAttackOutcome(att, attTile, tarTile, tar.owner, tar, crossfireBonus);
      const bulwarkArmor = hasAdjacentBulwark(tar) ? 1 : 0;
      const finalDmg = Math.max(1, outcome.damage - bulwarkArmor);
      const remainingHp = tar.hp - finalDmg;
      const isKill = remainingHp <= 0;
      const zeroCpClutch = isKill && action.cost > 0 && (nextPlayerCp[currentPlayer] ?? 0) === 0;

      const crossfireTiles = crossfireSupporters
        .map(s => getTileByIdFast(mapData, s.tileId, gridSize))
        .filter((t): t is Tile => Boolean(t));

      fx.sound(att.type === 'SNIPER' ? 'sniper' : 'attack');
      fx.sound('hit');
      if (attTile && tarTile) {
        fx.projectile(attTile, tarTile, att.type === 'SNIPER' ? 'LASER' : 'BULLET', {
          weapon: att.type,
          attackerId: att.id,
          targetUnitId: tar.id,
        });
        fx.hit({
          targetUnitId: tar.id,
          at: tarTile,
          from: attTile,
          damage: finalDmg,
          weapon: att.type,
          isKill,
          isCrit: crossfireBonus > 0 || finalDmg >= 7,
          suppressed: Boolean(tar.isOverwatching && finalDmg > 0 && !isKill),
          crossfireFrom: crossfireTiles,
          breakdown: {
            baseDamage: getUnitBaseDamage(att),
            watchtowerBoosted: outcome.watchtowerBoosted,
            coverPct: outcome.defense,
            coverTerrain: tarTile.type,
            coverArmorApplied: outcome.coverArmorApplied,
            crossfireBonus: outcome.crossfireBonus,
          },
        });
        fx.popup(tarTile, `-${finalDmg}`, '#FF0000', 10);
        if (crossfireBonus > 0) fx.popup(tarTile, `CROSSFIRE +${crossfireBonus}`, '#F59E0B', 26);
        if (bulwarkArmor > 0) fx.popup(tarTile, 'BULWARK -1', '#22D3EE', 22);
        fx.shake(finalDmg > 5 ? 12 : 4, tarTile);
        if (isKill) {
          fx.killed(tar, tarTile, 'COMBAT', currentPlayer, {
            killerUnitId: att.id,
            killerUnitType: att.type,
            zeroCpClutch,
          });
        }
      }

      newUnits = newUnits.map(u => {
        if (u.id === att.id) {
          return {
            ...u,
            completed: true,
            ammo: u.ammo - 1,
            damageDealt: (u.damageDealt ?? 0) + finalDmg,
            kills: (u.kills ?? 0) + (isKill ? 1 : 0),
          };
        }
        return u;
      });

      const hitResult = applyUnitHit({
        unitsList: newUnits,
        target: tar,
        targetTile: tarTile,
        dmg: finalDmg,
        suppressLogPlayerId: currentPlayer,
        suppressMessage: `${UNIT_STATS[tar.type].name} Overwatch SUPPRESSED!`,
        graveyard: newGraveyard,
        round: currentRound,
        extraLogs,
        fx,
      });
      newUnits = applyCombatOutcomeToStatsAndXp({
        attackerId: att.id,
        attackerOwner: currentPlayer,
        attTile,
        victim: tar,
        dmg: finalDmg,
        isKill: hitResult.killed,
        unitsList: hitResult.unitsList,
        map: newMap,
        gridSize,
        round: currentRound,
        nextPlayerGold,
        nextMatchStats,
        extraLogs,
        fx,
      });
      recordContract(currentPlayer, { kind: 'DAMAGE', amount: finalDmg });
      if (hitResult.killed) {
        recordContract(currentPlayer, {
          kind: 'KILL',
          victimRank: tar.rank ?? 0,
          viaOverwatch: false,
          crossfire: crossfireBonus > 0,
        });
      }
      grantFirstContact(currentPlayer, tar.owner, tarTile);
      if (hitResult.killed) {
        const refund = refundCp(currentPlayer, MOMENTUM_REFUNDS.KILL[tar.type]);
        if (refund > 0) {
          if (tarTile) fx.popup(tarTile, `+${refund} CP`, '#38BDF8', 34);
          extraLogs.push(createLog(currentRound, currentPlayer, `Momentum: +${refund} CP`, 'ECONOMY'));
        }
      }
      const msg = `${UNIT_STATS[att.type].name} hit ${UNIT_STATS[tar.type].name} for ${finalDmg} dmg${crossfireBonus > 0 ? ' (Crossfire)' : ''}${hitResult.killed ? ' (KILL)' : ''}`;
      logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
      break;
    }
    case 'SIEGE': {
      const att = newUnits.find(u => u.id === action.unitId);
      const targetTile = getTileByIdFast(newMap, action.tileId, gridSize);
      if (!att || !targetTile || targetTile.hp === undefined) return reject('Invalid siege target');
      const isBank = targetTile.type === 'BANK';
      spendCp(actionCost(action));
      const attTile = getTileByIdFast(mapData, att.tileId, gridSize);
      const siegeDmg = calculateSiegeDamage(att, attTile, isBank ? 'BANK' : 'BASE');
      const newHp = Math.max(0, targetTile.hp - siegeDmg);
      if (!isBank && siegeDmg > 0) nextLastHqDamageRound = currentRound;
      newMap = newMap.map(t => t.id === action.tileId
        ? { ...t, hp: newHp, ...(isBank && newHp === 0 ? { hackProgress: 100 } : {}) }
        : t);
      if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].damageDealt += siegeDmg;
      newUnits = newUnits.map(u => u.id === att.id ? {
        ...u,
        completed: true,
        ammo: u.ammo - 1,
        damageDealt: (u.damageDealt ?? 0) + siegeDmg,
      } : u);

      if (attTile) {
        fx.projectile(attTile, targetTile, 'MISSILE', { weapon: 'SIEGE', attackerId: att.id });
        fx.structureHit(targetTile, isBank ? 'BANK' : 'BASE', siegeDmg, newHp === 0, targetTile.owner, currentPlayer);
        fx.popup(targetTile, `-${siegeDmg}`, '#FF4500', 20);
        fx.shake(newHp === 0 ? 18 : 8, targetTile);
      }
      fx.sound(newHp === 0 ? 'explosion' : 'attack');
      if (newHp > 0) fx.sound('hit');

      let msg = `${UNIT_STATS[att.type].name} sieged Base (-${siegeDmg} HP)`;
      let logKind: 'COMBAT' | 'ECONOMY' = 'COMBAT';
      if (isBank) {
        msg = `${UNIT_STATS[att.type].name} shelled Bank Vault (-${siegeDmg} HP)`;
        if (newHp === 0) {
          if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].heists += 1;
          recordContract(currentPlayer, { kind: 'HEIST' });
          newUnits = grantUnitXp(newUnits, att.id, 2, newMap, gridSize, currentPlayer, currentRound, nextMatchStats, extraLogs, fx);
          fx.heist(targetTile, currentPlayer);
          fx.sound('heist');
          const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(targetTile, settings.mutators);
          if (goldReward > 0) {
            if (options.autoBankReward) {
              const hasOtherActiveUnits = newUnits.some(u => u.owner === currentPlayer && !u.completed);
              if (nextPlayerCp[currentPlayer] < 8 && hasOtherActiveUnits) {
                nextPlayerCp[currentPlayer] += cpReward;
                msg = `Vault Breached! AI claimed +${cpReward} CP`;
              } else {
                nextPlayerGold[currentPlayer] += goldReward;
                msg = `Vault Breached! AI claimed +€${goldReward} Euros`;
              }
              newBankReward = null;
            } else {
              newBankReward = { tileId: action.tileId, playerId: currentPlayer };
              msg = `Vault Breached! Choose the loot`;
            }
          } else {
            nextPlayerCp[currentPlayer] += cpReward;
            msg = `Vault came up dry — seized intel +${cpReward} CP`;
          }
          const refund = refundCp(currentPlayer, MOMENTUM_REFUNDS.BANK);
          if (refund > 0) {
            fx.popup(targetTile, `+${refund} CP`, '#38BDF8', 30);
            extraLogs.push(createLog(currentRound, currentPlayer, `Momentum: +${refund} CP`, 'ECONOMY'));
          }
          logKind = 'ECONOMY';
        }
      } else if (newHp === 0) {
        const eliminatedId = targetTile.owner!;
        nextPlayerStatus[eliminatedId] = 'ELIMINATED';
        const wipedCount = newUnits.filter(u => u.owner === eliminatedId).length;
        if (nextMatchStats[eliminatedId]) nextMatchStats[eliminatedId].unitsLost += wipedCount;
        newUnits = newUnits.filter(u => u.owner !== eliminatedId);
        newUnits = grantUnitXp(newUnits, att.id, 2, newMap, gridSize, currentPlayer, currentRound, nextMatchStats, extraLogs, fx);
        msg += ' - BASE DESTROYED';
      }
      logEntry = createLog(currentRound, currentPlayer, msg, logKind);
      break;
    }
    case 'DEMOLISH': {
      const att = newUnits.find(u => u.id === action.unitId);
      const barrierTile = getTileByIdFast(newMap, action.tileId, gridSize);
      if (!att || !barrierTile || barrierTile.hp === undefined) return reject('Invalid demolish target');
      spendCp(actionCost(action));
      const attTile = getTileByIdFast(mapData, att.tileId, gridSize);
      const dmg = calculateDemolishDamage(att, attTile);
      const newHp = Math.max(0, barrierTile.hp - dmg);

      if (attTile) {
        fx.projectile(attTile, barrierTile, 'MISSILE', { weapon: 'SIEGE', attackerId: att.id });
        fx.structureHit(barrierTile, 'BARRIER', dmg, newHp === 0);
        fx.popup(barrierTile, `-${dmg}`, '#FFA500', 20);
        fx.shake(newHp === 0 ? 9 : 5, barrierTile);
      }
      fx.sound(newHp === 0 ? 'explosion' : 'attack');

      newMap = newMap.map(t => t.id === action.tileId ? { ...t, hp: newHp } : t);
      newUnits = newUnits.map(u => u.id === att.id ? { ...u, completed: true, ammo: u.ammo - 1 } : u);

      let msg = `${UNIT_STATS[att.type].name} attacked Barrier (-${dmg} HP)`;
      if (newHp === 0) {
        // A destroyed barrier leaves plains
        newMap = newMap.map(t => t.id === action.tileId ? { ...t, type: 'PLAINS', hp: undefined, maxHp: undefined, height: 1 } : t);
        recordContract(currentPlayer, { kind: 'BARRIER_DESTROYED' });
        msg = `${UNIT_STATS[att.type].name} destroyed a Barrier!`;
      }
      logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
      break;
    }
    case 'SPAWN': {
      if ((nextPlayerRespawns[currentPlayer] || 0) >= getEffectiveMaxRespawns(settings.mutators)) {
        return reject('No respawns left');
      }
      if (!action.deadUnitId) return reject('Missing unit to redeploy');
      const fallen = newGraveyard.find(u => u.id === action.deadUnitId && u.owner === currentPlayer);
      if (!fallen) return reject('Missing unit to redeploy');
      // The price comes from the fallen unit's class, not from the message, so a redeploy can't
      // be bought at another class's CP price.
      const cpCost = RESPAWN_CP_COST[fallen.type] ?? 0;
      if (playerCp[currentPlayer] < cpCost) return reject('Not enough CP');
      if (!isValidSpawnTile({ mapData: newMap, units: newUnits, gridSize }, currentPlayer, action.tileId)) {
        return reject("Can't redeploy there");
      }
      spendCp(cpCost);
      const unitType = fallen.type as UnitType;
      newGraveyard = newGraveyard.filter(u => u.id !== action.deadUnitId);
      nextPlayerRespawns[currentPlayer] = (nextPlayerRespawns[currentPlayer] || 0) + 1;
      newUnits.push(createUnit({
        id: action.deadUnitId,
        type: unitType,
        owner: currentPlayer,
        tileId: action.tileId,
        mutators: settings.mutators,
        hasMoved: true,
        completed: true,
      }));
      const spawnTile = getTileByIdFast(newMap, action.tileId, gridSize);
      if (spawnTile) fx.spawn(action.deadUnitId, unitType, currentPlayer, spawnTile);
      fx.sound('capture');
      logEntry = createLog(currentRound, currentPlayer, `Redeployed ${UNIT_STATS[unitType].name}`, 'ECONOMY');
      break;
    }
    case 'BUY_DROP': {
      const goldCost = action.goldCost || 0;
      if (nextPlayerGold[currentPlayer] < goldCost) return reject('Not enough Euros');
      spendCp(actionCost(action));
      spendGold(goldCost);
      const itemKey = action.itemKey;
      // The AI's drop lands at once, on the tile it picked
      const lootItem = itemKeyToLoot(itemKey);
      newMap = newMap.map(t => t.id === action.tileId ? { ...t, loot: lootItem } : t);
      logEntry = createLog(currentRound, currentPlayer, `Purchased ${SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS].name}`, 'ECONOMY');
      break;
    }
    case 'BUY_ITEM': {
      if (!isConsumable(action.itemKey)) return reject('Not a supply item');
      const item = SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS];
      if (nextPlayerGold[currentPlayer] < item.cost) return reject('Not enough Euros');
      const lootType = itemKeyToLoot(action.itemKey);
      let targetTileId: string | undefined;
      if (action.tileId !== undefined && settings.gameMode === 'PVE') {
        if (!getSupplyDropTargets(state, currentPlayer).has(action.tileId)) return reject('Invalid drop zone');
        targetTileId = action.tileId;
      } else {
        // Random drop: lands 3–9 tiles from HQ, or a random valid zone near friendly units
        const base = newMap.find(t => t.type === 'BASE' && t.owner === currentPlayer);
        if (base) {
          for (let i = 0; i < 20; i++) {
            const dist = 3 + Math.floor(Math.random() * 7);
            const angle = Math.random() * Math.PI * 2;
            const rx = Math.round(base.x + Math.cos(angle) * dist);
            const ry = Math.round(base.y + Math.sin(angle) * dist);
            if (rx >= 0 && rx < gridSize && ry >= 0 && ry < gridSize) {
              const t = newMap[ry * gridSize + rx];
              if (canHoldDrop(t)) {
                targetTileId = t.id;
                break;
              }
            }
          }
        }
        if (!targetTileId) {
          const candidates = Array.from(getSupplyDropTargets(state, currentPlayer));
          if (candidates.length > 0) {
            targetTileId = candidates[Math.floor(Math.random() * candidates.length)];
          }
        }
      }
      if (!targetTileId) return reject('Nowhere to drop supplies');
      spendCp(actionCost(action));
      spendGold(item.cost);
      newPendingDrops = [...pendingDrops, { playerId: currentPlayer, tileId: targetTileId, item: lootType }];
      logEntry = createLog(currentRound, currentPlayer, `Purchased ${item.name}`, 'ECONOMY');
      break;
    }
    case 'BUILD': {
      if (!isConstruct(action.itemKey)) return reject('Not something you can build');
      const item = SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS];
      const shopVouchers = nextPlayerShopVouchers[currentPlayer] ?? [];
      const voucherIdx = shopVouchers.indexOf(action.itemKey as ShopConstructId);
      const useVoucher = voucherIdx >= 0;
      if (!useVoucher && nextPlayerGold[currentPlayer] < item.cost) return reject('Not enough Euros');
      const payConstructCost = () => {
        if (useVoucher) {
          const nextList = [...shopVouchers];
          nextList.splice(voucherIdx, 1);
          nextPlayerShopVouchers[currentPlayer] = nextList;
        } else {
          spendGold(item.cost);
        }
      };
      const flareTileIds = new Set(
        newAirDrops
          .filter(d => d.phase === 'FLARE' && d.tileId)
          .map(d => d.tileId!),
      );
      const ctx = { playerId: currentPlayer, mapData: newMap, mines: newMines, flareTileIds };

      if (action.itemKey === 'BARRIER') {
        const targetIds = action.tileIds && action.tileIds.length > 0
          ? Array.from(new Set(action.tileIds))
          : [action.tileId];
        if (targetIds.length < 1 || targetIds.length > BARRIER_STATS.BUILD_COUNT) {
          return reject(`Choose 1 to ${BARRIER_STATS.BUILD_COUNT} tiles for Barrier`);
        }
        const targetTiles: Tile[] = [];
        for (const tid of targetIds) {
          const t = getTileByIdFast(newMap, tid, gridSize);
          if (!t || !canConstructOnTile('BARRIER', t, newUnits, ctx)) return reject("Can't build there");
          targetTiles.push(t);
        }
        spendCp(actionCost(action));
        payConstructCost();
        const targetSet = new Set(targetIds);
        newMap = newMap.map(t =>
          targetSet.has(t.id)
            ? { ...t, type: 'BARRIER' as const, height: 1, hp: BARRIER_STATS.HP, maxHp: BARRIER_STATS.HP }
            : t
        );
        fx.build(targetTiles, 'BARRIER');
        fx.sound('capture');
        const coords = targetTiles.map(t => `(${t.x},${t.y})`).join(', ');
        logEntry = createLog(currentRound, currentPlayer, `Built ${item.name}${useVoucher ? ' (Free Voucher)' : ''} at ${coords}`, 'ECONOMY');
        break;
      }

      if (action.itemKey === 'LAND_MINE') {
        const tile = getTileByIdFast(newMap, action.tileId, gridSize);
        if (!tile) return reject("Can't build there");
        const unitsForBuild = settings.fogOfWar
          ? newUnits.filter(u => u.owner === currentPlayer || visibleSet(state, currentPlayer).has(u.tileId))
          : newUnits;
        if (!canConstructOnTile('LAND_MINE', tile, unitsForBuild, ctx)) return reject("Can't build there");
        spendCp(actionCost(action));
        payConstructCost();
        const hiddenEnemy = newUnits.find(u => u.tileId === tile.id && u.owner !== currentPlayer);
        if (hiddenEnemy) {
          const mineRes = detonateMineOnUnit({
            victim: hiddenEnemy,
            mineOwner: currentPlayer,
            tile,
            damage: LAND_MINE_STATS.DAMAGE,
            unitsList: newUnits,
            graveyardList: newGraveyard,
            round: currentRound,
            nextPlayerGold,
            nextMatchStats,
            extraLogs,
            fx,
          });
          newUnits = mineRes.units;
          extraLogs.push(mineRes.mineLog);
        } else {
          newMines = [...newMines, { id: `mine_${turnCounter}_${newMines.length}_${tile.id}`, tileId: tile.id, owner: currentPlayer }];
          fx.sound('click');
        }
        logEntry = createLog(currentRound, currentPlayer, `Planted Land Mine${useVoucher ? ' (Free Voucher)' : ''} at (${tile.x},${tile.y})`, 'ECONOMY');
        break;
      }

      if (action.itemKey === 'TUNNEL') {
        const tunnelTile = getTileByIdFast(newMap, action.tileId, gridSize);
        if (!tunnelTile || !canConstructOnTile('TUNNEL', tunnelTile, newUnits, ctx)) return reject("Can't build there");
        spendCp(actionCost(action));
        payConstructCost();
        newMap = newMap.map(t => t.id === tunnelTile.id ? { ...t, type: 'TUNNEL' as const, height: 1, hp: undefined, maxHp: undefined } : t);
        fx.build([tunnelTile], 'TUNNEL');
        fx.sound('capture');
        logEntry = createLog(currentRound, currentPlayer, `Built ${item.name}${useVoucher ? ' (Free Voucher)' : ''} at (${tunnelTile.x},${tunnelTile.y})`, 'ECONOMY');
        break;
      }

      const tile = getTileByIdFast(newMap, action.tileId, gridSize);
      if (!tile || !canConstructOnTile(action.itemKey, tile, newUnits, ctx)) return reject("Can't build there");
      const newType: TerrainType = action.variant === 'V'
        ? 'BRIDGE_V'
        : action.variant === 'H'
          ? 'BRIDGE'
          : resolveBridgeVariant(tile, newMap, gridSize);
      spendCp(actionCost(action));
      payConstructCost();
      newMap = newMap.map(t => t.id === tile.id ? { ...t, type: newType, height: 1, hp: undefined, maxHp: undefined } : t);
      fx.build([tile], 'BRIDGE');
      fx.sound('capture');
      logEntry = createLog(currentRound, currentPlayer, `Built ${item.name}${useVoucher ? ' (Free Voucher)' : ''} at (${tile.x},${tile.y})`, 'ECONOMY');
      break;
    }
    case 'USE_TACTICAL': {
      const def = TACTICAL_ITEMS[action.itemKey];
      if (!def) return reject('Unknown tactical weapon');
      const visible = settings.fogOfWar ? visibleSet(state, currentPlayer) : null;
      const blocked = tacticalBlocker(state, currentPlayer, action.itemKey, {
        tileId: action.tileId,
        tileIds: action.tileIds,
        unitId: action.unitId,
        axis: action.axis,
        width: action.width,
        visible,
      });
      if (blocked) return reject(blocked);
      const tiles = tacticalTilesFor(
        newMap,
        gridSize,
        action.itemKey,
        action.tileId,
        action.axis,
        2,
        action.tileIds,
      );
      if (!tiles) return reject('That footprint does not fit on the board');

      const usingVoucher = hasTacticalVoucher(state, currentPlayer, action.itemKey);
      const round2Free = !usingVoucher && tacticalIsRound2StarterFree(state, currentPlayer, action.itemKey);
      const free = usingVoucher || round2Free || tacticalIsFree(state, currentPlayer, action.itemKey);
      if (usingVoucher) {
        const curList = [...(nextPlayerTacticalVouchers[currentPlayer] ?? [])];
        const vIdx = curList.indexOf(action.itemKey);
        if (vIdx >= 0) curList.splice(vIdx, 1);
        nextPlayerTacticalVouchers[currentPlayer] = curList;
      } else if (!free) {
        if (nextPlayerGold[currentPlayer] < def.cost) return reject('Not enough Euros');
        nextPlayerGold[currentPlayer] = nextPlayerGold[currentPlayer] - def.cost;
      }
      newTacticalRound[currentPlayer] = currentRound;
      if (!usingVoucher) {
        newTacticalCooldowns[currentPlayer] = {
          ...(newTacticalCooldowns[currentPlayer] ?? {}),
          [action.itemKey]: currentRound + TACTICAL_COOLDOWN_ROUNDS,
        };
      }
      if (round2Free) newFreeTacticalRound[currentPlayer] = currentRound;

      resolveTactical({
        state,
        seat: currentPlayer,
        round: currentRound,
        itemKey: action.itemKey,
        tiles,
        unitId: action.unitId,
        axis: action.axis,
        width: 2,
        fx,
        log: (message, type = 'ECONOMY') => extraLogs.push(createLog(currentRound, currentPlayer, message, type)),
        revealTraps: round => {
          newTrapRevealRound[currentPlayer] = round;
        },
        radar: round => {
          newRadarRound[currentPlayer] = round;
        },
        addPending: pending => {
          newPendingTacticals.push(pending);
        },
        addBurning: line => {
          newBurningLines.push(line);
        },
        addSmoke: zone => {
          newSmokeZones.push(zone);
        },
        addSensor: sensor => {
          newSensors.push(sensor);
        },
        grantOverclock: charges => {
          newOverclockCharges[currentPlayer] = (newOverclockCharges[currentPlayer] ?? 0) + charges;
        },
        stripStructure: tileId => {
          newMap = newMap.map(t => (t.id === tileId ? { ...t, subType: 'NONE' as const } : t));
        },
        drainCp: (owner, amount) => {
          nextPlayerCp[owner] = Math.max(0, (nextPlayerCp[owner] ?? 0) - amount);
        },
        damageUnit: (id, dmg, label, sourceOwner, itemKey) =>
          damageTacticalUnit(currentPlayer, id, dmg, label, sourceOwner, itemKey),
        damageBarrier: damageTacticalBarrier,
        relocateUnit: (unitId, destTileId) => {
          const unit = newUnits.find(u => u.id === unitId);
          const fromTile = unit ? getTileByIdFast(newMap, unit.tileId, gridSize) : undefined;
          const destTile = getTileByIdFast(newMap, destTileId, gridSize);
          if (!unit || !fromTile || !destTile) return null;
          newUnits = newUnits.map(u =>
            u.id === unitId
              ? {
                  ...u,
                  tileId: destTileId,
                  isRooted: false,
                  isOverwatching: false,
                  ...(u.owner === currentPlayer ? { hasMoved: true } : {}),
                }
              : u,
          );
          // Stepping/dropping onto an enemy sensor destroys it.
          newSensors = newSensors.filter(s => !(s.tileId === destTileId && s.owner !== unit.owner));
          return { from: fromTile, to: destTile, unitType: unit.type, owner: unit.owner };
        },
      });
      logEntry = createLog(currentRound, currentPlayer, `Tactical: ${def.name}`, 'ECONOMY');
      break;
    }
    case 'CHOOSE_PERK': {
      const unit = newUnits.find(u => u.id === action.unitId && u.owner === currentPlayer);
      if (!unit) return reject('Pick one of your units');
      if ((unit.rank ?? 0) < 1) return reject('Only a Veteran can take a perk');
      if (unit.perk) return reject('That unit already has a perk');
      if (!isPerkForClass(unit.type, action.perkId)) return reject('That perk is not available to this class');
      newUnits = newUnits.map(u => u.id === unit.id ? { ...u, perk: action.perkId } : u);
      logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} took ${PERK_LABELS[action.perkId]}`, 'INFO');
      break;
    }
    case 'OVERCLOCK': {
      const amount = Math.floor(action.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > CP_SYSTEM.OVERCLOCK_MAX) {
        return reject(`Borrow 1 to ${CP_SYSTEM.OVERCLOCK_MAX} CP`);
      }
      if ((newPlayerCpBorrowed[currentPlayer] ?? 0) > 0 || (newPlayerCpDebt[currentPlayer] ?? 0) > 0) {
        return reject('Already overclocked this turn');
      }
      const cpRules = getEffectiveCpRules(settings.mutators);
      const cap = cpRules.maxCp;
      const held = nextPlayerCp[currentPlayer] ?? 0;
      if (held >= cap) return reject('Battery is already full');
      const granted = Math.min(amount, cap - held);
      nextPlayerCp[currentPlayer] = held + granted;
      newPlayerCpDebt[currentPlayer] = granted;
      newPlayerCpBorrowed[currentPlayer] = granted;
      fx.sound('click');
      logEntry = createLog(currentRound, currentPlayer, `Overclocked +${granted} CP (repays next turn)`, 'ECONOMY');
      break;
    }
    case 'SPECTATOR_ATTACK': {
      if (settings.spectatorAttacks === false) return reject('Spectator attacks are off for this match');
      const seat = newSpectatorTurn;
      if (seat === null || seat === undefined || nextPlayerStatus[seat] !== 'ELIMINATED') {
        return reject('No spectator window is open');
      }
      if (newSpectatorUsedRound === currentRound) return reject('Window already used this round');
      const def = SPECTATOR_EFFECTS.find(e => e.id === action.effectId);
      if (!def) return reject('Unknown spectator effect');

      const rng = state.activeSeed
        ? createSeededRng(`${state.activeSeed}_spectator_${currentRound}_${seat}`)
        : Math.random;
      const openTiles = newMap.filter(t =>
        (t.type === 'PLAINS' || t.type === 'FOREST' || t.type === 'SAND' || t.type === 'DUNES') &&
        t.hazardState !== 'LAVA' &&
        !newUnits.some(u => u.tileId === t.id),
      );
      const pickOpenTile = (): Tile | undefined =>
        openTiles.length > 0 ? openTiles[Math.floor(rng() * openTiles.length)] : undefined;
      let msg = '';

      switch (action.effectId) {
        case 'WAR_LEVY': {
          for (let pid = 0; pid < settings.playerCount; pid++) {
            if (nextPlayerStatus[pid] !== 'ACTIVE') continue;
            nextPlayerGold[pid] = (nextPlayerGold[pid] ?? 0) + 30;
          }
          msg = 'War Levy — every surviving player +€30';
          break;
        }
        case 'BANK_BOOM': {
          newMap = newMap.map(t =>
            t.type === 'BANK' && (t.hackProgress ?? 0) < 100 && (t.bankGoldReward ?? 0) > 0
              ? { ...t, bankGoldReward: (t.bankGoldReward ?? 0) + 50 }
              : t,
          );
          msg = 'Bank Boom — every open vault +€50';
          break;
        }
        case 'SUPPLY_DROP': {
          const tile = pickOpenTile();
          if (!tile) return reject('No open ground for a supply drop');
          const items: SupplyLootType[] = ['AMMO', 'FIRST_AID', 'MEDKIT'];
          const item = items[Math.floor(rng() * items.length)];
          newMap = newMap.map(t => (t.id === tile.id ? { ...t, loot: item } : t));
          fx.supplyLanded(tile, item);
          fx.sound('capture');
          msg = `Supply Drop — ${item} crate landed`;
          break;
        }
        case 'REPAIR_SURGE': {
          const worstSeat = lastPlaceSeat(nextPlayerStatus, newUnits, nextPlayerGold);
          const hurt = newUnits
            .filter(u => u.hp < (u.maxHp ?? u.hp))
            .sort((a, b) => {
              const aLost = a.hp / (a.maxHp ?? a.hp);
              const bLost = b.hp / (b.maxHp ?? b.hp);
              if (worstSeat >= 0 && (a.owner === worstSeat) !== (b.owner === worstSeat)) {
                return a.owner === worstSeat ? -1 : 1;
              }
              return aLost - bLost;
            })[0];
          if (!hurt) return reject('No damaged unit to repair');
          const healed = Math.min(5, (hurt.maxHp ?? hurt.hp) - hurt.hp);
          newUnits = newUnits.map(u => (u.id === hurt.id ? { ...u, hp: u.hp + healed } : u));
          const hurtTile = getTileByIdFast(newMap, hurt.tileId, gridSize);
          if (hurtTile) {
            fx.heal(hurt.id, hurtTile, healed, 'FIRST_AID');
            fx.popup(hurtTile, `+${healed} HP`, '#4ADE80', 24);
          }
          msg = `Repair Surge — P${hurt.owner + 1} ${UNIT_STATS[hurt.type].name} +${healed} HP`;
          break;
        }
        case 'STATIC_STORM': {
          const tile = pickOpenTile();
          if (!tile) return reject('No open ground for a storm');
          const victims = newUnits.filter(u => {
            const ut = getTileByIdFast(newMap, u.tileId, gridSize);
            return ut && getManhattanDistance(ut, tile) <= 1;
          });
          let hits = 0;
          for (const victim of victims) {
            // Never lethal: a spectator may soften a lane, not decide a fight.
            const dmg = Math.min(2, Math.max(0, victim.hp - 1));
            if (dmg <= 0) continue;
            newUnits = newUnits.map(u => (u.id === victim.id ? { ...u, hp: u.hp - dmg } : u));
            const vt = getTileByIdFast(newMap, victim.tileId, gridSize);
            if (vt) {
              fx.hit({ targetUnitId: victim.id, at: vt, damage: dmg, weapon: 'ARTILLERY' });
              fx.popup(vt, `-${dmg}`, '#A78BFA', 18);
            }
            hits += 1;
          }
          msg = hits > 0 ? `Static Storm — ${hits} unit(s) caught for 2` : 'Static Storm — the storm missed';
          break;
        }
      }

      newSpectatorUsedRound = currentRound;
      fx.sound('click');
      logEntry = createLog(currentRound, seat, `SPECTATOR ATTACK — ${msg}`, 'COMBAT');
      break;
    }
    case 'FINAL_PUSH': {
      if (settings.victoryMode !== 'DEATHMATCH') return reject('Final Push is a Deathmatch rule');
      if (newFinalPush[currentPlayer] !== 'READY') return reject('No Final Push token');
      newFinalPush[currentPlayer] = 'USED';
      const rules = getEffectiveCpRules(settings.mutators);
      nextPlayerCp[currentPlayer] = rules.maxCp;
      newPlayerCpDebt[currentPlayer] = 0;
      // The borrow flag stays set: a refill must not unlock a second Overclock this turn.
      const holder = newUnits.find(u => u.owner === currentPlayer);
      const holderTile = holder ? getTileByIdFast(newMap, holder.tileId, gridSize) : undefined;
      if (holderTile) {
        fx.popup(holderTile, 'FINAL PUSH', '#F472B6', 44);
        fx.shake(6, holderTile);
      }
      fx.sound('turn');
      logEntry = createLog(currentRound, currentPlayer, 'FINAL PUSH! Battery refilled.', 'ECONOMY');
      break;
    }
    case 'END_TURN': {
      newBankReward = null;
      logEntry = createLog(currentRound, currentPlayer, `Ended Turn`, 'INFO');

      // Supplies bought this turn land now
      for (const drop of pendingDrops) {
        const dropTile = getTileByIdFast(newMap, drop.tileId, gridSize);
        if (dropTile) {
          const idx = dropTile.y * gridSize + dropTile.x;
          newMap[idx] = { ...newMap[idx], loot: drop.item };
          fx.supplyLanded(dropTile, drop.item);
        }
      }
      newPendingDrops = [];

      const nextId = nextActivePlayer(currentPlayer, settings.playerCount, nextPlayerStatus);

      // Telegraphed strikes land at the start of the buyer's next turn.
      const dueStrikes = resolveDueTacticals(newPendingTacticals, nextId, {
        units: newUnits,
        damageUnit: (id, dmg, label, sourceOwner, itemKey) =>
          damageTacticalUnit(nextId, id, dmg, label, sourceOwner, itemKey),
        damageBarrier: damageTacticalBarrier,
        log: (message, type) => extraLogs.push(createLog(currentRound, nextId, message, type)),
        fx,
      });
      newPendingTacticals = dueStrikes.remaining;

      // A fresh turn gets a fresh momentum budget and a fresh Overclock allowance.
      newPlayerCpRefunded[nextId] = 0;
      newPlayerCpBorrowed[nextId] = 0;
      if (nextId === 0 || nextId < currentPlayer) newTotalTurns += 1;
      if (newTotalTurns > totalTurns) {
        const tick = tickTacticalRoundEnd(newBurningLines, newSmokeZones, newSensors, {
          units: newUnits,
          damageUnit: (id, dmg, label, sourceOwner, itemKey) =>
            damageTacticalUnit(currentPlayer, id, dmg, label, sourceOwner, itemKey),
          damageBarrier: damageTacticalBarrier,
          log: (message, type) => extraLogs.push(createLog(currentRound, -1, message, type)),
          fx,
        });
        newBurningLines = tick.burning;
        newSmokeZones = tick.smoke;
        newSensors = tick.sensors;
      }
      const newTurnCounter = turnCounter + 1;

      if (newTurnCounter > 0 && newTurnCounter % 5 === 0 && settings.dynamicWeather) {
        const weatherRng = state.activeSeed
          ? createSeededRng(`${state.activeSeed}_weather_${newTurnCounter}`)
          : Math.random;
        Object.keys(newWeather.playerZones).forEach(key => {
          newWeather.playerZones[parseInt(key)] = rollWeather(weatherRng);
        });
        newWeather.turnsRemaining = 5;
      } else {
        newWeather.turnsRemaining = 5 - (newTurnCounter % 5);
      }

      let overwatchRefund = 0;
      newUnits.forEach(u => {
        if (u.owner === nextId && u.isOverwatching) overwatchRefund += OVERWATCH_STATS[u.type].refund;
      });

      const cp = nextPlayerCp[nextId];
      const cpRules = getEffectiveCpRules(settings.mutators);
      const doomsdayActive = settings.victoryMode === 'DEATHMATCH' && settings.doomsdayEnabled;
      const escalation = getDoomsdayEscalation(newTotalTurns, doomsdayActive);
      const regenAmount = cpRules.regenAmount + escalation.regenBonus;
      const collapseTurn = DOOMSDAY_SETTINGS.START_TURN;
      const meltdownTurn = collapseTurn + DOOMSDAY_ESCALATION.MELTDOWN_RING * DOOMSDAY_SETTINGS.SHRINK_INTERVAL;
      if (doomsdayActive && (newTotalTurns === collapseTurn || newTotalTurns === meltdownTurn)) {
        extraLogs.push(createLog(currentRound, -1, `Doomsday ${escalation.label}: all CP regen +${escalation.regenBonus}`, 'ECONOMY'));
      }
      // Relay counts once per player, no matter how many Scouts carry it.
      const relayBonus = newUnits.some(u => u.owner === nextId && u.perk === 'RELAY') ? 1 : 0;
      if (relayBonus > 0) {
        extraLogs.push(createLog(currentRound, nextId, `Relay: +1 CP regen`, 'ECONOMY'));
      }
      // Overclock debt is collected automatically out of this regen before any CP is added.
      const debt = newPlayerCpDebt[nextId] ?? 0;
      const repaid = Math.min(debt, regenAmount);
      if (repaid > 0) {
        newPlayerCpDebt[nextId] = debt - repaid;
        extraLogs.push(createLog(currentRound, nextId, `Overclock debt repaid -${repaid} CP`, 'ECONOMY'));
      }
      nextPlayerCp[nextId] = Math.min(
        cpRules.maxCp,
        cp + regenAmount - repaid + overwatchRefund + relayBonus,
      );
      if (overwatchRefund > 0) {
        extraLogs.push(createLog(currentRound, nextId, `Unfired Overwatch refunded +${overwatchRefund} CP`, 'INFO'));
      }
      let ownedBuildings = 0;
      for (let i = 0; i < newMap.length; i++) {
        if (newMap[i].type === 'BUILDING' && newMap[i].owner === nextId) ownedBuildings++;
      }
      const buildingGold = ownedBuildings * GOLD_SETTINGS.BUILDING_INCOME;
      nextPlayerGold[nextId] += (settings.goldIncome ?? GOLD_SETTINGS.INCOME_PER_TURN) + buildingGold;
      if (buildingGold > 0) {
        extraLogs.push(createLog(currentRound, nextId, `Territory income: +€${buildingGold} from ${ownedBuildings} Building${ownedBuildings > 1 ? 's' : ''}`, 'ECONOMY'));
      }

      newGraveyard = newGraveyard.map(u => {
        if (u.owner === nextId && u.turnsUntilRespawn > 0) return { ...u, turnsUntilRespawn: u.turnsUntilRespawn - 1 };
        return u;
      });

      // The next player's units get a fresh turn. A unit standing in quicksand can't move
      // this turn (it can still act).
      newUnits = newUnits.map(u => {
        if (u.owner !== nextId) return u;
        const tile = getTileByIdFast(newMap, u.tileId, gridSize);
        const onQuicksand = tile?.type === 'QUICKSAND';
        return { ...u, hasMoved: onQuicksand, completed: false, isRooted: false, isOverwatching: false };
      });

      // ── Environment: Doomsday lava, bank turrets, base artillery ──

      if (settings.victoryMode === 'DEATHMATCH' && settings.doomsdayEnabled) {
        newMap = updateDoomsdayState(newMap, newTotalTurns, gridSize);
        const lavaTiles = new Set(newMap.filter(t => t.hazardState === 'LAVA').map(t => t.id));
        newMines = newMines.filter(m => !lavaTiles.has(m.tileId));
        const meltingUnits = newUnits.filter(u => lavaTiles.has(u.tileId));
        if (meltingUnits.length > 0) {
          newUnits = newUnits.filter(u => !lavaTiles.has(u.tileId));
          meltingUnits.forEach(u => {
            if (nextMatchStats[u.owner]) nextMatchStats[u.owner].unitsLost += 1;
            const meltTile = getTileByIdFast(newMap, u.tileId, gridSize);
            if (meltTile) {
              fx.killed(u, meltTile, 'LAVA');
              fx.shake(5, meltTile);
            }
            pushGraveyard(newGraveyard, u);
            extraLogs.push(createLog(currentRound, -1, `${UNIT_STATS[u.type].name} melted in Lava!`, 'COMBAT'));
          });
        }
      }

      // ── Theater Air Supply Drops (3-round Field / 6-round Tactical cadence) ──
      if (newTotalTurns > totalTurns) {
        const nextRoundNum = newTotalTurns + 1;
        const nextDoomsdayRing =
          settings.victoryMode === 'DEATHMATCH' &&
          settings.doomsdayEnabled &&
          newTotalTurns + 2 >= DOOMSDAY_SETTINGS.START_TURN
            ? Math.floor((newTotalTurns + 2 - DOOMSDAY_SETTINGS.START_TURN) / DOOMSDAY_SETTINGS.SHRINK_INTERVAL)
            : -1;
        const dropTick = advanceAirDropsForRound(
          {
            settings,
            activeMission: state.activeMission,
            mapData: newMap,
            gridSize,
            playerStatus: nextPlayerStatus,
            burningLines: newBurningLines,
            activeSeed: state.activeSeed,
            airDrops: newAirDrops,
            airDropMeta: newAirDropMeta,
          },
          nextRoundNum,
          nextDoomsdayRing,
        );
        newAirDrops = dropTick.airDrops;
        newAirDropMeta = dropTick.airDropMeta;

        for (const plan of dropTick.landed) {
          const idx = plan.at.y * gridSize + plan.at.x;
          if (newMap[idx]) {
            newMap[idx] = {
              ...newMap[idx],
              loot: plan.dropKind === 'TACTICAL' ? 'TACTICAL_SUPPLY' : 'FIELD_SUPPLY',
            };
          }
          fx.airDrop(plan);
          extraLogs.push(
            createLog(
              nextRoundNum,
              -1,
              `${plan.dropKind === 'TACTICAL' ? 'Tactical' : 'Field'} Supply Crate dropped at (${plan.at.x},${plan.at.y})${plan.rerouted ? ' (re-routed)' : ''}!`,
              'ECONOMY',
            ),
          );
        }
        for (const f of dropTick.flared) {
          if (f.at) {
            extraLogs.push(
              createLog(
                nextRoundNum,
                -1,
                `Signal Flare lit at (${f.at.x},${f.at.y}): ${f.kind === 'TACTICAL' ? 'Tactical' : 'Field'} Supply Drop lands next round!`,
                'INFO',
              ),
            );
          }
        }
        if (dropTick.dispatched.length >= 2) {
          extraLogs.push(
            createLog(
              nextRoundNum,
              -1,
              `Air Convoy Dispatched: Field + Tactical Supply Drops arriving in 2 rounds (R${dropTick.dispatched[0].landingRound}).`,
              'INFO',
            ),
          );
        } else if (dropTick.dispatched.length === 1) {
          const d = dropTick.dispatched[0];
          extraLogs.push(
            createLog(
              nextRoundNum,
              -1,
              `Air Dispatch: ${d.kind === 'TACTICAL' ? 'Tactical' : 'Field'} Supply Drop arriving in 2 rounds (R${d.landingRound}).`,
              'INFO',
            ),
          );
        }
      }

      // Automated defences fire at the weakest unit in range.
      // When splashRoll is provided (Base artillery), every other enemy in range
      // also takes a reduced splash hit.
      const fireAutomatedDefense = (
        origin: Tile,
        range: number,
        dmg: number,
        candidates: Unit[],
        sourceLabel: string,
        projType: 'LASER' | 'MISSILE',
        colorHex: string,
        splashRoll?: () => number,
      ) => {
        const inRange = (u: Unit): boolean => {
          const ut = getTileByIdFast(newMap, u.tileId, gridSize);
          return !!ut && getManhattanDistance(ut, origin) <= range;
        };
        let target: Unit | null = null;
        for (const u of candidates) {
          if (!inRange(u)) continue;
          if (!target || u.hp < target.hp) target = u;
        }
        if (!target) return;
        const primaryId = target.id;

        const strikeTarget = (victim: Unit, strikeDmg: number): void => {
          const live = newUnits.find(x => x.id === victim.id);
          if (!live || live.hp <= 0) return;
          strikeAutomatedTarget(live, strikeDmg);
        };

        const strikeAutomatedTarget = (liveTarget: Unit, strikeDmg: number): void => {
          const tarTile = getTileByIdFast(newMap, liveTarget.tileId, gridSize);
          const weapon: WeaponVisual = projType === 'LASER' ? 'TURRET' : 'ARTILLERY';
          const willKill = liveTarget.hp - strikeDmg <= 0;
          if (tarTile) {
            fx.sound(projType === 'LASER' ? 'sniper' : 'attack');
            fx.sound('hit');
            fx.projectile(origin, tarTile, projType, { weapon, targetUnitId: liveTarget.id });
            fx.hit({
              targetUnitId: liveTarget.id,
              at: tarTile,
              from: origin,
              damage: strikeDmg,
              weapon,
              isKill: willKill,
              suppressed: Boolean(liveTarget.isOverwatching && strikeDmg > 0 && !willKill),
            });
            fx.popup(tarTile, `-${strikeDmg}`, colorHex, 14);
            fx.shake(willKill ? 10 : 4, tarTile);
            if (willKill) {
              fx.killed(liveTarget, tarTile, projType === 'LASER' ? 'TURRET' : 'ARTILLERY');
            }
          }

          extraLogs.push(createLog(currentRound, -1, `${sourceLabel} hit P${liveTarget.owner + 1} ${UNIT_STATS[liveTarget.type].name} (-${strikeDmg} HP)`, 'COMBAT'));
          const hit = applyUnitHit({
            unitsList: newUnits,
            target: liveTarget,
            targetTile: tarTile,
            dmg: strikeDmg,
            suppressLogPlayerId: liveTarget.owner,
            suppressMessage: `${sourceLabel} suppressed ${UNIT_STATS[liveTarget.type].name}'s Overwatch!`,
            graveyard: newGraveyard,
            round: currentRound,
            extraLogs,
            fx,
          });
          newUnits = hit.unitsList;
          if (hit.killed) {
            if (nextMatchStats[liveTarget.owner]) nextMatchStats[liveTarget.owner].unitsLost += 1;
            extraLogs.push(createLog(currentRound, -1, `${sourceLabel} killed P${liveTarget.owner + 1} ${UNIT_STATS[liveTarget.type].name}`, 'COMBAT'));
          }
        };

        strikeTarget(target, dmg);

        if (splashRoll) {
          for (const u of candidates) {
            if (u.id === primaryId || !inRange(u)) continue;
            strikeTarget(u, splashRoll());
          }
        }
      };

      const activeBanks = newMap.filter(t => t.type === 'BANK' && (t.hackProgress || 0) < 100);
      activeBanks.forEach(bank => {
        fireAutomatedDefense(bank, BANK_STATS.RANGE, BANK_STATS.DAMAGE, newUnits, 'Bank Turret', 'LASER', '#FFD700');
      });

      if (settings.victoryMode === 'CONQUER') {
        const myBases = newMap.filter(t => t.type === 'BASE' && t.owner === currentPlayer && (t.hp || 0) > 0);
        myBases.forEach(base => {
          const enemyUnits = newUnits.filter(u => u.owner !== currentPlayer);
          fireAutomatedDefense(base, BASE_STATS.RANGE, getBaseArtilleryDamage(), enemyUnits, 'Base Artillery', 'MISSILE', '#FF5722', getBaseArtillerySplashDamage);
        });
      }
      break;
    }
  }

  // Any mode: a side with no live units and no way to redeploy is out — it can never
  // affect the game again, so leaving it "active" only produces infinite passing.
  const effectiveMaxRespawns = getEffectiveMaxRespawns(settings.mutators);
  for (let pid = 0; pid < settings.playerCount; pid++) {
    if (nextPlayerStatus[pid] === 'ELIMINATED') continue;
    const aliveCount = newUnits.filter(u => u.owner === pid).length;
    const hasRespawnAvailable =
      (nextPlayerRespawns[pid] || 0) < effectiveMaxRespawns && newGraveyard.some(g => g.owner === pid);
    if (aliveCount === 0 && !hasRespawnAvailable) {
      nextPlayerStatus[pid] = 'ELIMINATED';
      extraLogs.push(createLog(currentRound, -1, `Player ${pid + 1} eliminated!`, 'COMBAT'));
    }
  }

  // Last one standing wins (Conquer, Deathmatch and missions alike)
  const activePlayers = Object.entries(nextPlayerStatus)
    .filter(([, status]) => status === 'ACTIVE')
    .map(([pid]) => parseInt(pid, 10));
  if (activePlayers.length === 1) {
    newWinner = activePlayers[0];
  } else if (activePlayers.length === 0 && newWinner === null) {
    // Mutual annihilation: every army is gone, so surviving fortress strength decides.
    // Highest total HQ HP wins — damaging the enemy fortress while dying is earned.
    // An exact tie (e.g. both fortresses untouched) is an explicit draw, not a coin flip.
    let bestPid = -1;
    let bestHp = -1;
    let tied = false;
    for (let pid = 0; pid < settings.playerCount; pid++) {
      const hqHp = newMap
        .filter(t => t.type === 'BASE' && t.owner === pid)
        .reduce((sum, t) => sum + (t.hp || 0), 0);
      if (hqHp > bestHp) {
        bestHp = hqHp;
        bestPid = pid;
        tied = false;
      } else if (hqHp === bestHp) {
        tied = true;
      }
    }
    if (tied || bestPid === -1) {
      newWinner = 'DRAW';
      extraLogs.push(createLog(currentRound, -1, 'Mutual annihilation — both fortresses stand equal. Draw!', 'COMBAT'));
    } else {
      newWinner = bestPid;
      extraLogs.push(createLog(currentRound, bestPid, `Mutual annihilation — Player ${bestPid + 1}'s fortress stands strongest!`, 'COMBAT'));
    }
  }

  // ── Match-level stalemate backstop ──
  // Some boards (islands, fog, heavy forest) let both sides settle into a standoff that neither
  // can break: no HQ damage, no eliminations, just passing until the action cap. Rather than let
  // that run forever, fortress strength decides at the cap — HQ HP first, then surviving army,
  // then unspent CP — exactly the tiebreak already used for mutual annihilation.
  if (newWinner === null && !state.activeMission && newTotalTurns >= MATCH_ROUND_CAP) {
    let bestPid = -1;
    let bestScore = -1;
    let tie = false;
    for (let pid = 0; pid < settings.playerCount; pid++) {
      if (nextPlayerStatus[pid] !== 'ACTIVE') continue;
      const hqHp = newMap
        .filter(t => t.type === 'BASE' && t.owner === pid)
        .reduce((sum, t) => sum + (t.hp || 0), 0);
      const armyHp = newUnits.filter(u => u.owner === pid).reduce((sum, u) => sum + u.hp, 0);
      const score = hqHp * 1000 + armyHp * 10 + (nextPlayerCp[pid] ?? 0);
      if (score > bestScore) {
        bestScore = score;
        bestPid = pid;
        tie = false;
      } else if (score === bestScore) {
        tie = true;
      }
    }
    newWinner = tie || bestPid === -1 ? 'DRAW' : bestPid;
    extraLogs.push(createLog(
      currentRound,
      -1,
      newWinner === 'DRAW'
        ? `Round ${MATCH_ROUND_CAP} — fortresses and armies stand equal. Draw!`
        : `Round ${MATCH_ROUND_CAP} — Player ${newWinner + 1} holds the strongest position!`,
      'COMBAT',
    ));
  }

  const actualNextPlayer = action.type === 'END_TURN'
    ? nextActivePlayer(state.currentPlayer, settings.playerCount, nextPlayerStatus)
    : currentPlayer;

  const mission = state.activeMission;
  if (mission && newWinner === null) {
    if (mission.targetKillType) {
      const targetRemaining = newUnits.some(
        u => u.owner === mission.targetKillType!.owner && (u.rank ?? 0) >= mission.targetKillType!.minRank,
      );
      if (!targetRemaining) {
        newWinner = 0;
        extraLogs.push(createLog(currentRound, 0, 'All Command Targets Eliminated — Mission Complete!', 'INFO'));
      }
    }
    if (newWinner === null && mission.requiredHeists && (nextMatchStats[0]?.heists ?? 0) >= mission.requiredHeists) {
      newWinner = 0;
      newBankReward = null;
      extraLogs.push(createLog(currentRound, 0, 'Vault Objectives Completed — Mission Complete!', 'ECONOMY'));
    }
    if (newWinner === null && action.type === 'END_TURN' && actualNextPlayer === 0) {
      const elapsedCompleted = newTotalTurns - (mission.startingRound ?? 0);
      const p0Alive = nextPlayerStatus[0] === 'ACTIVE' && newUnits.some(u => u.owner === 0);
      if (mission.surviveTurns && elapsedCompleted >= mission.surviveTurns && p0Alive) {
        newWinner = 0;
        extraLogs.push(createLog(currentRound, 0, `Held the line for ${mission.surviveTurns} rounds — Mission Complete!`, 'INFO'));
      } else if (mission.turnLimit && elapsedCompleted >= mission.turnLimit) {
        newWinner = 1;
        extraLogs.push(createLog(currentRound, -1, `Turn Limit (${mission.turnLimit} rounds) expired — Mission Failed`, 'INFO'));
      }
    }
  }

  // ── Phase 3 match arc: Final Push tokens and the next round's contract ──
  if (newWinner === null && !mission) {
    // Final Push: one battery refill per player, granted by match state rather than a round number.
    if (settings.victoryMode === 'DEATHMATCH') {
      const doomsdayActive = Boolean(settings.doomsdayEnabled);
      const living = newUnits.length;
      const someoneAtOne = Object.keys(nextPlayerStatus).some(key => {
        const pid = Number(key);
        return nextPlayerStatus[pid] === 'ACTIVE' && newUnits.filter(u => u.owner === pid).length === 1;
      });
      const triggered = doomsdayActive
        ? newTotalTurns >= DOOMSDAY_SETTINGS.START_TURN
        : living <= 4 || someoneAtOne;
      if (triggered) {
        for (let pid = 0; pid < settings.playerCount; pid++) {
          if (nextPlayerStatus[pid] !== 'ACTIVE' || newFinalPush[pid]) continue;
          newFinalPush[pid] = 'READY';
          extraLogs.push(createLog(currentRound, pid, 'FINAL PUSH ready: refill your battery (once).', 'INFO'));
        }
      }
    }

    // Contracts run a fixed window (CONTRACT_DURATION_ROUNDS) so the table has time to finish
    // one. A card is only replaced after its window closes; an unclaimed one counts as a miss.
    // The deck refreshes rather than leaving the HUD empty once every card has been used.
    const activeCount = Object.values(nextPlayerStatus).filter(status => status === 'ACTIVE').length;
    if (newTotalTurns > totalTurns && activeCount >= 2) {
      const nextRound = newTotalTurns + 1;
      const expiresRound = newContract
        ? (newContract.expiresRound ?? newContract.round + CONTRACT_DURATION_ROUNDS - 1)
        : 0;
      if (nextRound > expiresRound) {
        const ending = newContract;
        if (ending && ending.claimedBy === null) {
          newContractMisses += 1;
          extraLogs.push(createLog(
            nextRound,
            -1,
            `Contract expired: ${contractDef(ending.id)?.name ?? ending.id}`,
            'INFO',
          ));
        }
        newContract = null;
        const board = { ...state, units: newUnits, mapData: newMap, matchStats: nextMatchStats };
        let dealt = dealContract(board, nextRound, newContractsUsed, {
          preferLowerTier: newContractMisses > 0,
        });
        if (!dealt && newContractsUsed.length > 0) {
          // Deck exhausted: start a fresh cycle, avoiding an immediate repeat of the card just closed.
          newContractsUsed = ending ? [ending.id] : [];
          dealt = dealContract(board, nextRound, newContractsUsed, {
            preferLowerTier: newContractMisses > 0,
          });
        }
        if (dealt) {
          newContract = toSharedContract(dealt, nextRound);
          newContractProgress = {};
          newContractsUsed = [...newContractsUsed, dealt.id];
          extraLogs.push(createLog(
            nextRound,
            -1,
            `Contract: ${dealt.name} — ${dealt.requirement} (+${dealt.cp} CP${dealt.gold ? `, +€${dealt.gold}` : ''})`,
            'INFO',
          ));
        }
      }
    }

    // ── Spectator attacks: eliminated seats take turns holding a window ──
    // One window every two rounds, rotating through the eliminated seats, so the table never
    // takes a spectator effect on back-to-back rounds.
    if (newTotalTurns > totalTurns) {
      const nextRound = newTotalTurns + 1;
      const eliminated = Array.from({ length: settings.playerCount }, (_, pid) => pid)
        .filter(pid => nextPlayerStatus[pid] === 'ELIMINATED');
      if (settings.spectatorAttacks !== false && eliminated.length > 0 && isSpectatorWindowRound(nextRound)) {
        const seat = eliminated[newSpectatorWindow % eliminated.length];
        newSpectatorTurn = seat;
        newSpectatorWindow += 1;
        newSpectatorUsedRound = null;
        extraLogs.push(createLog(
          nextRound,
          -1,
          `Spectator window: P${seat + 1} may fire one map effect this round.`,
          'INFO',
        ));
      } else {
        newSpectatorTurn = null;
      }
    }
  }

  if (newWinner !== null) {
    if (state.winner === null) {
      // Tag the decisive kill or structure destruction so the Kill Cam escalates to FINAL BLOW.
      for (let i = fx.events.length - 1; i >= 0; i--) {
        const ev = fx.events[i];
        if (ev.kind === 'killed') {
          ev.isMatchWinning = true;
          break;
        }
        if (ev.kind === 'structureHit' && ev.destroyed && ev.structureType === 'BASE') {
          ev.isMatchWinning = true;
          break;
        }
      }
      const roundsTaken = mission
        ? Math.max(1, newTotalTurns - (mission.startingRound ?? 0) + 1)
        : Math.max(1, newTotalTurns + 1);
      newMatchSummary = calculateMatchScorecard({
        winner: newWinner,
        rounds: roundsTaken,
        victoryMode: settings.victoryMode,
        gameMode: settings.gameMode,
        aiDifficulty: settings.aiDifficulty,
        seed: state.activeSeed || '',
        playerStats: nextMatchStats,
        playerRespawns: nextPlayerRespawns,
        units: newUnits,
        parRoundsOverride: mission?.parRounds,
        challengeId: mission?.id,
      });
    }
    fx.sound('victory');
  } else if (action.type === 'END_TURN') {
    fx.sound('turn');
  }

  const allNewLogs = [...extraLogs.reverse()];
  if (logEntry) allNewLogs.push(logEntry);

  return {
    events: fx.events,
    state: {
      ...state,
      mapData: newMap,
      units: newUnits,
      graveyard: newGraveyard,
      playerCp: nextPlayerCp,
      playerCpDebt: newPlayerCpDebt,
      playerCpBorrowed: newPlayerCpBorrowed,
      playerCpRefunded: newPlayerCpRefunded,
      playerGold: nextPlayerGold,
      playerRespawns: nextPlayerRespawns,
      playerStatus: nextPlayerStatus,
      playerInventory: nextPlayerInventory,
      playerShopVouchers: nextPlayerShopVouchers,
      playerTacticalVouchers: nextPlayerTacticalVouchers,
      airDrops: newAirDrops,
      airDropMeta: newAirDropMeta,
      winner: newWinner,
      matchStats: nextMatchStats,
      matchSummary: newMatchSummary,
      totalTurns: newTotalTurns,
      lastHqDamageRound: nextLastHqDamageRound,
      firstContactDone: newFirstContactDone,
      contract: newContract,
      contractsUsed: newContractsUsed,
      contractMisses: newContractMisses,
      contractProgress: newContractProgress,
      finalPush: newFinalPush,
      spectatorTurn: newSpectatorTurn,
      spectatorWindow: newSpectatorWindow,
      spectatorUsedRound: newSpectatorUsedRound,
      tacticalRound: newTacticalRound,
      tacticalCooldowns: newTacticalCooldowns,
      freeTacticalRound: newFreeTacticalRound,
      trapRevealRound: newTrapRevealRound,
      radarRound: newRadarRound,
      overclockCharges: newOverclockCharges,
      pendingTacticals: newPendingTacticals,
      burningLines: newBurningLines,
      smokeZones: newSmokeZones,
      sensors: newSensors,
      turnCounter: action.type === 'END_TURN' ? turnCounter + 1 : turnCounter,
      weather: newWeather,
      currentPlayer: actualNextPlayer,
      bankRewardPending: newBankReward,
      pendingDrops: newPendingDrops,
      mines: newMines,
      gameLog: [...allNewLogs, ...state.gameLog].slice(0, MAX_LOG_ENTRIES),
    },
  };
}
