/**
 * The rules of a turn: apply one action to a game and get the next game back, plus the
 * effects (shots, damage numbers, sounds) for a client to play. Pure apart from the dice
 * (base artillery and where a supply drop lands use Math.random).
 */
import {
  BANK_STATS,
  BARRIER_STATS,
  BASE_STATS,
  GOLD_SETTINGS,
  OVERWATCH_STATS,
  RESPAWN_TIMERS,
  SHOP_ITEMS,
  UNIT_STATS,
  VETERANCY_CONFIG,
} from '../constants/Config';
import type { LogEntry, MatchPlayerStats, PendingDrop, TerrainType, Tile, Unit, UnitType } from '../types';
import { updateDoomsdayState } from '../grid/DoomsdayManager';
import {
  applyUnitXp,
  calculateAttackOutcome,
  calculateDemolishDamage,
  calculateSiegeDamage,
  canConstructOnTile,
  canHoldDrop,
  canUnitEnterOverwatch,
  getBaseArtilleryDamage,
  getEffectiveBankRewards,
  getEffectiveCpRules,
  getEffectiveMaxRespawns,
  getEffectiveUnitAmmo,
  getUnitMaxHp,
  resolveBridgeVariant,
} from '../rules/CombatRules';
import { resolveMoveWithOverwatch } from '../rules/OverwatchRules';
import { calculateMatchScorecard } from '../storage/CareerStatsManager';
import { createSeededRng } from '../utils/SeededRandom';
import { isConstruct, isConsumable } from './options';
import { rollWeather } from './setup';
import {
  createLog,
  cloneMatchStats,
  MAX_LOG_ENTRIES,
  nextActivePlayer,
  type GameAction,
  type GameEvent,
  type GameState,
  type SoundName,
} from './state';

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

/** Collects an action's effects as it resolves. */
class Fx {
  events: GameEvent[] = [];
  sound(sound: SoundName) {
    this.events.push({ kind: 'sound', sound });
  }
  projectile(from: Tile, to: Tile, style: 'BULLET' | 'LASER' | 'MISSILE') {
    this.events.push({ kind: 'projectile', from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, style });
  }
  popup(at: Tile, text: string, color: string, lift: number) {
    this.events.push({ kind: 'popup', at: { x: at.x, y: at.y }, text, color, lift });
  }
  shake(intensity: number) {
    this.events.push({ kind: 'shake', intensity });
  }
}

const grantUnitXp = (
  unitsList: Unit[],
  unitId: string,
  gainedXp: number,
  map: Tile[],
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
      const uTile = map.find(t => t.id === promotedUnit.tileId);
      if (uTile) fx.popup(uTile, VETERANCY_CONFIG.RANK_LABELS[promotedTo], '#FFD700', 24);
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

const applyCombatOutcomeToStatsAndXp = (params: {
  attackerId: string;
  attackerOwner: number;
  attTile: Tile | undefined;
  victim: Unit;
  dmg: number;
  isKill: boolean;
  unitsList: Unit[];
  map: Tile[];
  round: number;
  nextPlayerGold: Record<number, number>;
  nextMatchStats: Record<number, MatchPlayerStats>;
  extraLogs: LogEntry[];
  fx: Fx;
}): Unit[] => {
  const { attackerId, attackerOwner, attTile, victim, dmg, isKill, map, round, nextPlayerGold, nextMatchStats, extraLogs, fx } = params;
  let updatedUnits = params.unitsList;

  if (nextMatchStats[attackerOwner]) {
    nextMatchStats[attackerOwner].damageDealt += dmg;
    if (isKill) nextMatchStats[attackerOwner].kills += 1;
  }

  if (isKill) {
    if (nextMatchStats[victim.owner]) {
      nextMatchStats[victim.owner].unitsLost += 1;
    }
    if ((victim.rank ?? 0) >= 3) {
      nextPlayerGold[attackerOwner] = (nextPlayerGold[attackerOwner] ?? 0) + VETERANCY_CONFIG.ACE_BOUNTY_GOLD;
      if (attTile) fx.popup(attTile, `+$${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} BOUNTY`, '#FFD700', 36);
      extraLogs.push(createLog(round, attackerOwner, `Ace Bounty claimed! +$${VETERANCY_CONFIG.ACE_BOUNTY_GOLD} Gold`, 'ECONOMY'));
    }
    const xpGain = (victim.rank ?? 0) >= 2 ? 3 : 2;
    updatedUnits = grantUnitXp(updatedUnits, attackerId, xpGain, map, attackerOwner, round, nextMatchStats, extraLogs, fx);
  } else if (dmg > 0) {
    updatedUnits = grantUnitXp(updatedUnits, attackerId, 1, map, attackerOwner, round, nextMatchStats, extraLogs, fx);
  }

  return updatedUnits;
};

const actionCost = (action: GameAction): number => ('cost' in action ? action.cost : 0);

export function applyAction(state: GameState, action: GameAction, options: ApplyOptions = {}): ApplyResult {
  const {
    mapData, units, currentPlayer, playerCp, playerGold, graveyard, settings, weather, playerRespawns,
    totalTurns, turnCounter, playerStatus, gridSize, bankRewardPending, pendingDrops, playerInventory,
  } = state;
  const reject = (reason: string): ApplyResult => ({ state, events: [], rejected: reason });
  const fx = new Fx();

  // Not enough CP for the action (ending the turn is always free)
  if (action.type !== 'END_TURN' && playerCp[currentPlayer] < actionCost(action)) {
    return reject('Not enough CP');
  }

  let newMap = [...mapData];
  let newUnits = [...units];
  let newCp = playerCp[currentPlayer];
  let newGold = playerGold[currentPlayer];
  let newGraveyard = [...graveyard];
  let newWinner = state.winner;
  let newTotalTurns = totalTurns;
  const nextPlayerStatus = { ...playerStatus };
  const newWeather = { ...weather, playerZones: { ...weather.playerZones } };
  let newBankReward = bankRewardPending;
  let newPendingDrops: PendingDrop[] = pendingDrops;

  const nextPlayerCp = { ...playerCp };
  const nextPlayerGold = { ...playerGold };
  const nextPlayerRespawns = { ...playerRespawns };
  const nextPlayerInventory = { ...playerInventory };
  const nextMatchStats = cloneMatchStats(state.matchStats, settings.playerCount);
  let newMatchSummary = state.matchSummary;

  let logEntry: LogEntry | null = null;
  const extraLogs: LogEntry[] = [];
  const currentRound = totalTurns + 1;

  if (action.type !== 'END_TURN') {
    newCp -= actionCost(action);
    nextPlayerCp[currentPlayer] = newCp;
  }

  switch (action.type) {
    case 'MOVE': {
      const mUnit = newUnits.find(u => u.id === action.unitId);
      if (mUnit) {
        const moveResolution = resolveMoveWithOverwatch({
          movingUnit: mUnit,
          targetTileId: action.targetTileId,
          mapData: newMap,
          units: newUnits,
          weather,
          gridSize,
          fogOfWar: settings.fogOfWar,
          maxBudget: playerCp[currentPlayer],
        });

        // Only the CP actually walked is spent (it matters when Overwatch pins the unit early)
        newCp = playerCp[currentPlayer] - moveResolution.actualCost;
        nextPlayerCp[currentPlayer] = newCp;

        const destTile = moveResolution.finalTile ?? newMap.find(t => t.id === action.targetTileId);
        const trig = moveResolution.trigger;

        if (trig) {
          const shooter = newUnits.find(u => u.id === trig.overwatcherId);
          const shooterTile = shooter ? newMap.find(t => t.id === shooter.tileId) : undefined;
          const interceptTile = trig.interceptTile;

          if (shooter) {
            fx.sound(shooter.type === 'SNIPER' ? 'sniper' : 'attack');
            fx.sound('hit');
            if (shooterTile) {
              fx.projectile(shooterTile, interceptTile, shooter.type === 'SNIPER' ? 'LASER' : 'BULLET');
              fx.popup(interceptTile, `-${trig.damage}`, '#FF6D00', 12);
              fx.shake(trig.damage > 5 ? 10 : 5);
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
              newGraveyard.push({ id: mUnit.id, type: mUnit.type, owner: mUnit.owner, turnsUntilRespawn: RESPAWN_TIMERS[mUnit.type] });
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

              if (destTile) {
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
              if (isQuicksand) {
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
              round: currentRound,
              nextPlayerGold,
              nextMatchStats,
              extraLogs,
              fx,
            });
          }
        } else {
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
      }
      break;
    }
    case 'OVERWATCH': {
      const unit = newUnits.find(u => u.id === action.unitId);
      const uTile = unit ? newMap.find(t => t.id === unit.tileId) : undefined;
      if (!unit || !canUnitEnterOverwatch(unit, uTile, playerCp[currentPlayer])) {
        // Illegal Overwatch: give back the CP taken up front
        newCp = playerCp[currentPlayer];
        nextPlayerCp[currentPlayer] = newCp;
        break;
      }
      newUnits = newUnits.map(u => u.id === unit.id ? { ...u, isOverwatching: true, completed: true } : u);
      if (uTile) fx.popup(uTile, 'OVERWATCH', '#FFB300', 20);
      fx.sound('click');
      logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} set Overwatch (${action.cost} CP)`, 'COMBAT');
      break;
    }
    case 'RELOAD': {
      const unit = newUnits.find(u => u.id === action.unitId);
      if (unit) {
        const added = Math.max(1, Math.ceil(unit.maxAmmo / 2));
        const nextAmmo = Math.min(unit.maxAmmo, unit.ammo + added);
        newUnits = newUnits.map(u => u.id === unit.id ? { ...u, ammo: nextAmmo, completed: true } : u);
        fx.sound('click');
        logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} Field Reloaded (${nextAmmo}/${unit.maxAmmo} Ammo)`, 'ECONOMY');
      }
      break;
    }
    case 'LOOT': {
      const unit = newUnits.find(u => u.id === action.unitId);
      const tile = newMap.find(t => t.id === action.tileId);
      if (unit && tile && tile.loot) {
        // Loot goes to the player's inventory, to use later
        const lootItem = tile.loot;
        const currentInv = nextPlayerInventory[currentPlayer] || [];
        nextPlayerInventory[currentPlayer] = [...currentInv, lootItem];
        newUnits = newUnits.map(u => u.id === unit.id ? { ...u, completed: true } : u);
        newMap = newMap.map(t => t.id === tile.id ? { ...t, loot: null } : t);
        logEntry = createLog(currentRound, currentPlayer, `${UNIT_STATS[unit.type].name} retrieved ${lootItem} to Inventory`, 'ECONOMY');
      }
      break;
    }
    case 'USE_ITEM': {
      const itemIndex = action.itemIndex;
      const inv = nextPlayerInventory[currentPlayer];
      if (inv && inv[itemIndex]) {
        const item = inv[itemIndex];
        const unit = newUnits.find(u => u.id === action.unitId);
        if (unit) {
          if (item === 'MEDKIT') {
            newUnits = newUnits.map(u => u.id === unit.id ? { ...u, hp: getUnitMaxHp(u) } : u);
          } else if (item === 'AMMO') {
            newUnits = newUnits.map(u => u.id === unit.id ? { ...u, ammo: u.maxAmmo } : u);
          }
          const newInvList = [...inv];
          newInvList.splice(itemIndex, 1);
          nextPlayerInventory[currentPlayer] = newInvList;
          logEntry = createLog(currentRound, currentPlayer, `Used ${item} on ${UNIT_STATS[unit.type].name}`, 'ECONOMY');
        }
      }
      break;
    }
    case 'SECURE': {
      const unit = newUnits.find(u => u.id === action.unitId);
      const targetTile = newMap.find(t => t.id === action.tileId);
      if (unit && targetTile) {
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
          newUnits = grantUnitXp(newUnits, unit.id, 1, newMap, currentPlayer, currentRound, nextMatchStats, extraLogs, fx);
        }
        fx.sound('capture');
        logEntry = createLog(currentRound, currentPlayer, `Secured a Building`, 'ECONOMY');
      }
      break;
    }
    case 'HEIST': {
      const unit = newUnits.find(u => u.id === action.unitId);
      if (unit) {
        const bankTile = newMap.find(t => t.id === action.tileId);
        newUnits = newUnits.map(u => u.id === action.unitId ? { ...u, completed: true } : u);
        newMap = newMap.map(t => t.id === action.tileId ? { ...t, hackProgress: 100 } : t);
        if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].heists += 1;
        newUnits = grantUnitXp(newUnits, unit.id, 2, newMap, currentPlayer, currentRound, nextMatchStats, extraLogs, fx);
        fx.sound('heist');

        if (options.autoBankReward) {
          const { gold: goldReward, cp: cpReward } = getEffectiveBankRewards(bankTile, settings.mutators);
          const hasOtherActiveUnits = newUnits.some(u => u.owner === currentPlayer && !u.completed);
          const chooseCp = newCp < 8 && hasOtherActiveUnits;
          if (chooseCp) {
            nextPlayerCp[currentPlayer] += cpReward;
            logEntry = createLog(currentRound, currentPlayer, `Heist Successful! AI claimed +${cpReward} CP`, 'ECONOMY');
          } else {
            nextPlayerGold[currentPlayer] += goldReward;
            logEntry = createLog(currentRound, currentPlayer, `Heist Successful! AI claimed +${goldReward} Gold`, 'ECONOMY');
          }
          newBankReward = null;
        } else {
          newBankReward = { tileId: action.tileId, playerId: currentPlayer };
          logEntry = createLog(currentRound, currentPlayer, `Heist Successful! Bank Vault Breached`, 'ECONOMY');
        }
      }
      break;
    }
    case 'BANK_REWARD': {
      if (!bankRewardPending) return reject('No vault to claim');
      const tile = newMap.find(t => t.id === bankRewardPending.tileId);
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
      if (att && tar) {
        const attTile = mapData.find(t => t.id === att.tileId);
        const tarTile = mapData.find(t => t.id === tar.tileId);
        const { damage: finalDmg } = calculateAttackOutcome(att, attTile, tarTile, tar.owner, tar);
        const remainingHp = tar.hp - finalDmg;
        const isKill = remainingHp <= 0;

        fx.sound(att.type === 'SNIPER' ? 'sniper' : 'attack');
        fx.sound('hit');
        if (attTile && tarTile) {
          fx.projectile(attTile, tarTile, att.type === 'SNIPER' ? 'LASER' : 'BULLET');
          fx.popup(tarTile, `-${finalDmg}`, '#FF0000', 10);
          fx.shake(finalDmg > 5 ? 12 : 4);
        }

        const wasOverwatching = Boolean(tar.isOverwatching);
        newUnits = newUnits.map(u => {
          if (u.id === tar.id) {
            return { ...u, hp: remainingHp, isOverwatching: (finalDmg > 0 ? false : u.isOverwatching) };
          }
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

        let msg = `${UNIT_STATS[att.type].name} hit ${UNIT_STATS[tar.type].name} for ${finalDmg} dmg`;
        if (isKill) {
          newUnits = newUnits.filter(u => u.id !== tar.id);
          newGraveyard.push({ id: tar.id, type: tar.type, owner: tar.owner, turnsUntilRespawn: RESPAWN_TIMERS[tar.type] });
          msg += ' (KILL)';
        } else if (wasOverwatching && finalDmg > 0) {
          if (tarTile) fx.popup(tarTile, 'SUPPRESSED!', '#FF9800', 28);
          extraLogs.push(createLog(currentRound, currentPlayer, `${UNIT_STATS[tar.type].name} Overwatch SUPPRESSED!`, 'COMBAT'));
        }

        newUnits = applyCombatOutcomeToStatsAndXp({
          attackerId: att.id,
          attackerOwner: currentPlayer,
          attTile,
          victim: tar,
          dmg: finalDmg,
          isKill,
          unitsList: newUnits,
          map: newMap,
          round: currentRound,
          nextPlayerGold,
          nextMatchStats,
          extraLogs,
          fx,
        });
        logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
      }
      break;
    }
    case 'SIEGE': {
      const att = newUnits.find(u => u.id === action.unitId);
      const baseTile = newMap.find(t => t.id === action.tileId);
      if (att && baseTile && baseTile.hp !== undefined) {
        const attTile = mapData.find(t => t.id === att.tileId);
        const siegeDmg = calculateSiegeDamage(att, attTile);
        const newHp = Math.max(0, baseTile.hp - siegeDmg);
        newMap = newMap.map(t => t.id === action.tileId ? { ...t, hp: newHp } : t);
        if (nextMatchStats[currentPlayer]) nextMatchStats[currentPlayer].damageDealt += siegeDmg;
        newUnits = newUnits.map(u => u.id === att.id ? {
          ...u,
          completed: true,
          ammo: u.ammo - 1,
          damageDealt: (u.damageDealt ?? 0) + siegeDmg,
        } : u);

        if (attTile) {
          fx.projectile(attTile, baseTile, 'MISSILE');
          fx.popup(baseTile, `-${siegeDmg}`, '#FF4500', 20);
          fx.shake(newHp === 0 ? 18 : 8);
        }
        fx.sound(newHp === 0 ? 'explosion' : 'attack');
        if (newHp > 0) fx.sound('hit');

        let msg = `${UNIT_STATS[att.type].name} sieged Base (-${siegeDmg} HP)`;
        if (newHp === 0) {
          const eliminatedId = baseTile.owner!;
          nextPlayerStatus[eliminatedId] = 'ELIMINATED';
          const wipedCount = newUnits.filter(u => u.owner === eliminatedId).length;
          if (nextMatchStats[eliminatedId]) nextMatchStats[eliminatedId].unitsLost += wipedCount;
          newUnits = newUnits.filter(u => u.owner !== eliminatedId);
          newUnits = grantUnitXp(newUnits, att.id, 2, newMap, currentPlayer, currentRound, nextMatchStats, extraLogs, fx);
          msg += ' - BASE DESTROYED';
        }
        logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
      }
      break;
    }
    case 'DEMOLISH': {
      const att = newUnits.find(u => u.id === action.unitId);
      const barrierTile = newMap.find(t => t.id === action.tileId);
      if (att && barrierTile && barrierTile.hp !== undefined) {
        const attTile = mapData.find(t => t.id === att.tileId);
        const dmg = calculateDemolishDamage(att, attTile);
        const newHp = Math.max(0, barrierTile.hp - dmg);

        if (attTile) {
          fx.projectile(attTile, barrierTile, 'MISSILE');
          fx.popup(barrierTile, `-${dmg}`, '#FFA500', 20);
          fx.shake(5);
        }
        fx.sound(newHp === 0 ? 'explosion' : 'attack');

        newMap = newMap.map(t => t.id === action.tileId ? { ...t, hp: newHp } : t);
        newUnits = newUnits.map(u => u.id === att.id ? { ...u, completed: true, ammo: u.ammo - 1 } : u);

        let msg = `${UNIT_STATS[att.type].name} attacked Barrier (-${dmg} HP)`;
        if (newHp === 0) {
          // A destroyed barrier leaves plains
          newMap = newMap.map(t => t.id === action.tileId ? { ...t, type: 'PLAINS', hp: undefined, maxHp: undefined, height: 1 } : t);
          msg = `${UNIT_STATS[att.type].name} destroyed a Barrier!`;
        }
        logEntry = createLog(currentRound, currentPlayer, msg, 'COMBAT');
      }
      break;
    }
    case 'SPAWN': {
      if ((nextPlayerRespawns[currentPlayer] || 0) >= getEffectiveMaxRespawns(settings.mutators)) break;
      const goldCost = action.goldCost || 0;
      if (newGold < goldCost) break;
      newGold -= goldCost;
      nextPlayerGold[currentPlayer] = newGold;

      if (action.deadUnitId) {
        const unitType = action.unitType as UnitType;
        const baseHp = UNIT_STATS[unitType].hp;
        const maxAmmoCap = getEffectiveUnitAmmo(unitType, settings.mutators);
        newGraveyard = newGraveyard.filter(u => u.id !== action.deadUnitId);
        nextPlayerRespawns[currentPlayer] = (nextPlayerRespawns[currentPlayer] || 0) + 1;
        newUnits.push({
          id: action.deadUnitId, type: unitType, owner: currentPlayer,
          tileId: action.tileId, hp: baseHp,
          maxHp: baseHp,
          ammo: maxAmmoCap,
          maxAmmo: maxAmmoCap,
          xp: 0, rank: 0, kills: 0, damageDealt: 0,
          hasMoved: true, completed: true, isOverwatching: false,
        });
        logEntry = createLog(currentRound, currentPlayer, `Redeployed ${UNIT_STATS[unitType].name}`, 'ECONOMY');
      }
      break;
    }
    case 'BUY_DROP': {
      const goldCost = action.goldCost || 0;
      const itemKey = action.itemKey;
      newGold -= goldCost;
      nextPlayerGold[currentPlayer] = newGold;
      // The AI's drop lands at once, on the tile it picked
      const lootItem = itemKey === 'AMMO_REFILL' ? 'AMMO' : 'MEDKIT';
      newMap = newMap.map(t => t.id === action.tileId ? { ...t, loot: lootItem } : t);
      logEntry = createLog(currentRound, currentPlayer, `Purchased ${SHOP_ITEMS[itemKey as keyof typeof SHOP_ITEMS].name}`, 'ECONOMY');
      break;
    }
    case 'BUY_ITEM': {
      if (!isConsumable(action.itemKey)) return reject('Not a supply item');
      const item = SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS];
      if (newGold < item.cost) return reject('Not enough gold');
      const lootType: 'AMMO' | 'MEDKIT' = action.itemKey === 'AMMO_REFILL' ? 'AMMO' : 'MEDKIT';
      // The drop lands 3–9 tiles from your base, on the first suitable spot found
      const base = newMap.find(t => t.type === 'BASE' && t.owner === currentPlayer);
      let targetTileId = base?.id;
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
      if (!targetTileId) return reject('Nowhere to drop supplies');
      newGold -= item.cost;
      nextPlayerGold[currentPlayer] = newGold;
      newPendingDrops = [...pendingDrops, { playerId: currentPlayer, tileId: targetTileId, item: lootType }];
      logEntry = createLog(currentRound, currentPlayer, `Purchased ${item.name}`, 'ECONOMY');
      break;
    }
    case 'BUILD': {
      if (!isConstruct(action.itemKey)) return reject('Not something you can build');
      const item = SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS];
      const tile = newMap.find(t => t.id === action.tileId);
      if (!tile || !canConstructOnTile(action.itemKey, tile, newUnits)) return reject("Can't build there");
      if (newGold < item.cost) return reject('Not enough gold');
      let newType: TerrainType = tile.type;
      let newHeight = tile.height;
      let newHp: number | undefined;
      let newMaxHp: number | undefined;
      if (action.itemKey === 'BARRIER') {
        newType = 'BARRIER';
        newHeight = 1;
        newHp = BARRIER_STATS.HP;
        newMaxHp = BARRIER_STATS.HP;
      } else if (action.itemKey === 'BRIDGE') {
        newType = action.variant === 'V' ? 'BRIDGE_V' : resolveBridgeVariant(tile, newMap, gridSize);
        newHeight = 1;
      }
      newMap = newMap.map(t => t.id === tile.id ? { ...t, type: newType, height: newHeight, hp: newHp, maxHp: newMaxHp } : t);
      newGold -= item.cost;
      nextPlayerGold[currentPlayer] = newGold;
      fx.sound('capture');
      logEntry = createLog(currentRound, currentPlayer, `Built ${item.name} at (${tile.x},${tile.y})`, 'ECONOMY');
      break;
    }
    case 'END_TURN': {
      newBankReward = null;
      logEntry = createLog(currentRound, currentPlayer, `Ended Turn`, 'INFO');

      // Supplies bought this turn land now
      pendingDrops.forEach(drop => {
        newMap = newMap.map(t => (t.id === drop.tileId ? { ...t, loot: drop.item } : t));
      });
      newPendingDrops = [];

      const nextId = nextActivePlayer(currentPlayer, settings.playerCount, nextPlayerStatus);
      if (nextId === 0 || nextId < currentPlayer) newTotalTurns += 1;
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
      nextPlayerCp[nextId] = Math.min(cpRules.maxCp, cp + cpRules.regenAmount + overwatchRefund);
      if (overwatchRefund > 0) {
        extraLogs.push(createLog(currentRound, nextId, `Unfired Overwatch refunded +${overwatchRefund} CP`, 'INFO'));
      }
      nextPlayerGold[nextId] += GOLD_SETTINGS.INCOME_PER_TURN;

      newGraveyard = newGraveyard.map(u => {
        if (u.owner === nextId && u.turnsUntilRespawn > 0) return { ...u, turnsUntilRespawn: u.turnsUntilRespawn - 1 };
        return u;
      });

      // The next player's units get a fresh turn. A unit standing in quicksand can't move
      // this turn (it can still act).
      newUnits = newUnits.map(u => {
        if (u.owner !== nextId) return u;
        const tile = newMap.find(t => t.id === u.tileId);
        const onQuicksand = tile?.type === 'QUICKSAND';
        return { ...u, hasMoved: onQuicksand, completed: false, isRooted: false, isOverwatching: false };
      });

      // ── Environment: Doomsday lava, bank turrets, base artillery ──

      if (settings.victoryMode === 'DEATHMATCH' && settings.doomsdayEnabled) {
        newMap = updateDoomsdayState(newMap, newTotalTurns, gridSize);
        const lavaTiles = new Set(newMap.filter(t => t.hazardState === 'LAVA').map(t => t.id));
        const meltingUnits = newUnits.filter(u => lavaTiles.has(u.tileId));
        if (meltingUnits.length > 0) {
          newUnits = newUnits.filter(u => !lavaTiles.has(u.tileId));
          meltingUnits.forEach(u => {
            if (nextMatchStats[u.owner]) nextMatchStats[u.owner].unitsLost += 1;
            newGraveyard.push({ id: u.id, type: u.type, owner: u.owner, turnsUntilRespawn: RESPAWN_TIMERS[u.type] });
            extraLogs.push(createLog(currentRound, -1, `${UNIT_STATS[u.type].name} melted in Lava!`, 'COMBAT'));
          });
        }
      }

      // Automated defences fire at the weakest unit in range
      const fireAutomatedDefense = (
        origin: Tile,
        range: number,
        dmg: number,
        candidates: Unit[],
        sourceLabel: string,
        projType: 'LASER' | 'MISSILE',
        colorHex: string,
      ) => {
        const inRange = candidates.filter(u => {
          const ut = newMap.find(t => t.id === u.tileId);
          return ut ? Math.abs(ut.x - origin.x) + Math.abs(ut.y - origin.y) <= range : false;
        });
        if (inRange.length === 0) return;

        inRange.sort((a, b) => a.hp - b.hp);
        const target = inRange[0];
        const newHp = target.hp - dmg;
        const tarTile = newMap.find(t => t.id === target.tileId);
        if (tarTile) {
          fx.projectile(origin, tarTile, projType);
          fx.popup(tarTile, `-${dmg}`, colorHex, 14);
          fx.shake(newHp <= 0 ? 10 : 4);
        }

        const targetWasOverwatching = Boolean(target.isOverwatching);
        extraLogs.push(createLog(currentRound, -1, `${sourceLabel} hit P${target.owner + 1} ${UNIT_STATS[target.type].name} (-${dmg} HP)`, 'COMBAT'));
        newUnits = newUnits.map(u => u.id === target.id ? {
          ...u,
          hp: newHp,
          isOverwatching: (dmg > 0 ? false : u.isOverwatching),
        } : u);
        if (newHp <= 0) {
          newUnits = newUnits.filter(u => u.id !== target.id);
          if (nextMatchStats[target.owner]) nextMatchStats[target.owner].unitsLost += 1;
          newGraveyard.push({ id: target.id, type: target.type, owner: target.owner, turnsUntilRespawn: RESPAWN_TIMERS[target.type] });
          extraLogs.push(createLog(currentRound, -1, `${sourceLabel} killed P${target.owner + 1} ${UNIT_STATS[target.type].name}`, 'COMBAT'));
        } else if (targetWasOverwatching && dmg > 0) {
          if (tarTile) fx.popup(tarTile, 'SUPPRESSED!', '#FF9800', 28);
          extraLogs.push(createLog(currentRound, target.owner, `${sourceLabel} suppressed ${UNIT_STATS[target.type].name}'s Overwatch!`, 'COMBAT'));
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
          fireAutomatedDefense(base, BASE_STATS.RANGE, getBaseArtilleryDamage(), enemyUnits, 'Base Artillery', 'MISSILE', '#FF5722');
        });
      }
      break;
    }
  }

  // Deathmatch: a player with no units left and no way to redeploy is out
  const effectiveMaxRespawns = getEffectiveMaxRespawns(settings.mutators);
  if (settings.victoryMode === 'DEATHMATCH') {
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
  }

  // Last one standing wins (Conquer, Deathmatch and missions alike)
  const activePlayers = Object.entries(nextPlayerStatus)
    .filter(([, status]) => status === 'ACTIVE')
    .map(([pid]) => parseInt(pid, 10));
  if (activePlayers.length === 1) {
    newWinner = activePlayers[0];
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

  if (newWinner !== null) {
    if (state.winner === null) {
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
      playerGold: nextPlayerGold,
      playerRespawns: nextPlayerRespawns,
      playerStatus: nextPlayerStatus,
      playerInventory: nextPlayerInventory,
      winner: newWinner,
      matchStats: nextMatchStats,
      matchSummary: newMatchSummary,
      totalTurns: newTotalTurns,
      turnCounter: action.type === 'END_TURN' ? turnCounter + 1 : turnCounter,
      weather: newWeather,
      currentPlayer: actualNextPlayer,
      bankRewardPending: newBankReward,
      pendingDrops: newPendingDrops,
      gameLog: [...allNewLogs, ...state.gameLog].slice(0, MAX_LOG_ENTRIES),
    },
  };
}
