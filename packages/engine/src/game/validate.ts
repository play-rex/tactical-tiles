/**
 * Checks an action from a player against the rules before it is applied. Costs are worked
 * out here from the game, never taken from the message, so a client can't pay less than the
 * rules say. The local game skips this (its UI only offers legal actions); the server and
 * the bots always go through it.
 */
import { BARRIER_STATS, CP_SYSTEM, OVERWATCH_STATS, RESPAWN_CP_COST, SHOP_ITEMS } from '../constants/Config';
import { getManhattanDistance, getValidMovesWithParents, hasLineOfSight } from '../grid/Pathfinding';
import { canConstructOnTile, canUnitAttackFromTile, canUnitEnterOverwatch, getEffectiveCpRules, getUnitAttackCost, getUnitRange } from '../rules/CombatRules';
import { isPerkForClass } from '../constants/Perks';
import { SPECTATOR_EFFECTS } from './SpectatorOps';
import {
  INTERACT_COST,
  dropTilesFor,
  getSupplyDropTargets,
  isConstruct,
  isConsumable,
  isValidSpawnTile,
  interactOptionsFor,
  spawnBlocker,
  tileOf,
  visibleSet,
} from './options';
import type { GameAction, GameState } from './state';

export type Prepared =
  | { ok: true; action: GameAction; error?: undefined }
  | { ok: false; error: string; action?: undefined };

const fail = (error: string): Prepared => ({ ok: false, error });
const ok = (action: GameAction): Prepared => ({ ok: true, action });

export function prepareAction(state: GameState, seat: number, action: GameAction, knownVisible?: Set<string>): Prepared {
  if (state.winner !== null) return fail('The match is over');

  // An eliminated seat acts out of turn, but only inside its own window and only once.
  if (action.type === 'SPECTATOR_ATTACK') {
    if (state.settings.spectatorAttacks === false) return fail('Spectator attacks are off');
    if (seat !== state.spectatorTurn) return fail('No spectator window is open');
    if (state.playerStatus[seat] !== 'ELIMINATED') return fail('Only an eliminated player holds that window');
    if (state.spectatorUsedRound === state.totalTurns + 1) return fail('Window already used this round');
    if (!SPECTATOR_EFFECTS.some(e => e.id === action.effectId)) return fail('Unknown spectator effect');
    return ok({ type: 'SPECTATOR_ATTACK', effectId: action.effectId });
  }

  if (seat !== state.currentPlayer) return fail("It isn't your turn");
  if (state.playerStatus[seat] === 'ELIMINATED') return fail("You're out of this match");

  // A breached vault waits for its reward: choose it (or end the turn and lose it) first.
  const pending = state.bankRewardPending;
  if (pending && pending.playerId === seat && action.type !== 'BANK_REWARD' && action.type !== 'END_TURN') {
    return fail('Choose the vault reward first');
  }

  const cp = state.playerCp[seat] ?? 0;
  const gold = state.playerGold[seat] ?? 0;
  const ownUnit = (id: string) => state.units.find(u => u.id === id && u.owner === seat);
  // Units that have acted this turn are done.
  const readyUnit = (id: string) => {
    const u = ownUnit(id);
    return u && !u.completed ? u : undefined;
  };
  const getVisible = () => (state.settings.fogOfWar ? (knownVisible ?? visibleSet(state, seat)) : null);
  const interactionsOf = (id: string) => {
    const u = readyUnit(id);
    return u ? interactOptionsFor(state, u) : null;
  };
  const afford = (cost: number, a: GameAction) => (cp >= cost ? ok(a) : fail('Not enough CP'));

  switch (action.type) {
    case 'END_TURN':
      return ok({ type: 'END_TURN' });

    case 'CHOOSE_PERK': {
      const unit = ownUnit(action.unitId);
      if (!unit) return fail('Pick one of your units');
      if ((unit.rank ?? 0) < 1) return fail('Only a Veteran can take a perk');
      if (unit.perk) return fail('That unit already has a perk');
      if (!isPerkForClass(unit.type, action.perkId)) return fail('That perk is not available to this class');
      return ok({ type: 'CHOOSE_PERK', unitId: unit.id, perkId: action.perkId });
    }

    case 'FINAL_PUSH': {
      if (state.settings.victoryMode !== 'DEATHMATCH') return fail('Final Push is a Deathmatch rule');
      if ((state.finalPush?.[seat] ?? null) !== 'READY') return fail('No Final Push token');
      return ok({ type: 'FINAL_PUSH' });
    }

    case 'OVERCLOCK': {
      const amount = Math.floor(action.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > CP_SYSTEM.OVERCLOCK_MAX) {
        return fail(`Borrow 1 to ${CP_SYSTEM.OVERCLOCK_MAX} CP`);
      }
      if ((state.playerCpBorrowed?.[seat] ?? 0) > 0 || (state.playerCpDebt?.[seat] ?? 0) > 0) {
        return fail('Already overclocked this turn');
      }
      const cap = getEffectiveCpRules(state.settings.mutators).maxCp;
      if (cp >= cap) return fail('Battery is already full');
      return ok({ type: 'OVERCLOCK', amount: Math.min(amount, cap - cp) });
    }

    case 'MOVE': {
      const unit = readyUnit(action.unitId);
      const startTile = unit ? tileOf(state, unit.tileId) : undefined;
      const cost =
        unit && startTile && !unit.hasMoved && cp > 0 && !unit.isRooted
          ? getValidMovesWithParents(
              startTile,
              cp,
              state.mapData,
              state.units,
              unit.type,
              seat,
              state.weather,
              state.gridSize,
              unit.rank ?? 0,
              action.targetTileId,
            ).validMoves.get(action.targetTileId)
          : undefined;
      if (cost === undefined) return fail("That unit can't move there");
      return afford(cost, { type: 'MOVE', unitId: action.unitId, targetTileId: action.targetTileId, cost });
    }

    case 'ATTACK': {
      const unit = readyUnit(action.attackerId);
      const attTile = unit ? tileOf(state, unit.tileId) : undefined;
      const cost = unit ? getUnitAttackCost(unit) : 0;
      const target = unit ? state.units.find(u => u.id === action.targetUnitId && u.owner !== seat) : undefined;
      const tarTile = target ? tileOf(state, target.tileId) : undefined;
      if (!unit || !attTile || !tarTile || cp < cost || unit.ammo <= 0 || !canUnitAttackFromTile(unit, attTile)) {
        return fail("That target isn't in range");
      }
      const range = getUnitRange(unit, state.mapData, state.weather, attTile);
      const vis = getVisible();
      if (
        getManhattanDistance(attTile, tarTile) > range ||
        (vis && !vis.has(tarTile.id)) ||
        !hasLineOfSight(attTile, tarTile, state.mapData, unit.type, state.weather, state.gridSize)
      ) {
        return fail("That target isn't in range");
      }
      return afford(cost, { type: 'ATTACK', attackerId: action.attackerId, targetUnitId: action.targetUnitId, cost });
    }

    case 'SIEGE':
    case 'DEMOLISH': {
      const unit = readyUnit(action.unitId);
      const attTile = unit ? tileOf(state, unit.tileId) : undefined;
      const cost = unit ? getUnitAttackCost(unit) : 0;
      const tarTile = tileOf(state, action.tileId);
      if (action.type === 'SIEGE' && tarTile?.type === 'BANK' && unit?.type === 'SNIPER') {
        return fail("Snipers can't crack vaults");
      }
      const validType =
        tarTile &&
        (tarTile.hp || 0) > 0 &&
        (action.type === 'DEMOLISH'
          ? tarTile.type === 'BARRIER'
          : action.type === 'SIEGE' && tarTile.type === 'BANK'
            ? (tarTile.hackProgress || 0) < 100
            : state.settings.victoryMode === 'CONQUER' && tarTile.type === 'BASE' && tarTile.owner !== seat);
      if (!unit || !attTile || !validType || cp < cost || unit.ammo <= 0 || !canUnitAttackFromTile(unit, attTile)) {
        return fail("That target isn't in range");
      }
      const range = getUnitRange(unit, state.mapData, state.weather, attTile);
      const vis = getVisible();
      if (
        getManhattanDistance(attTile, tarTile) > range ||
        (vis && !vis.has(tarTile.id)) ||
        !hasLineOfSight(attTile, tarTile, state.mapData, unit.type, state.weather, state.gridSize)
      ) {
        return fail("That target isn't in range");
      }
      return afford(cost, { type: action.type, unitId: action.unitId, tileId: action.tileId, cost });
    }

    case 'SECURE':
    case 'LOOT': {
      const opts = interactionsOf(action.unitId);
      const tiles = action.type === 'SECURE' ? opts?.secureTiles : opts?.lootTiles;
      if (!tiles?.includes(action.tileId)) return fail("That unit can't reach it");
      return afford(INTERACT_COST, { type: action.type, unitId: action.unitId, tileId: action.tileId, cost: INTERACT_COST });
    }

    case 'OVERWATCH': {
      const unit = readyUnit(action.unitId);
      const tile = unit ? tileOf(state, unit.tileId) : undefined;
      if (!unit || !canUnitEnterOverwatch(unit, tile, cp)) return fail("That unit can't go on Overwatch");
      return ok({ type: 'OVERWATCH', unitId: unit.id, cost: OVERWATCH_STATS[unit.type].cost });
    }

    case 'RELOAD': {
      const unit = readyUnit(action.unitId);
      if (!unit || unit.ammo >= unit.maxAmmo) return fail("That unit can't reload");
      return afford(CP_SYSTEM.RELOAD_COST, { type: 'RELOAD', unitId: unit.id, cost: CP_SYSTEM.RELOAD_COST });
    }

    case 'USE_ITEM': {
      const unit = ownUnit(action.unitId);
      const inv = state.playerInventory[seat] ?? [];
      if (!unit) return fail('Pick one of your units');
      if (!Number.isInteger(action.itemIndex) || !inv[action.itemIndex]) return fail('No such item');
      return ok({ type: 'USE_ITEM', unitId: unit.id, itemIndex: action.itemIndex, cost: 0 });
    }

    case 'SPAWN': {
      if (!action.deadUnitId) return fail('Pick a fallen unit');
      const blocked = spawnBlocker(state, seat, action.deadUnitId);
      if (blocked) return fail(blocked);
      if (!isValidSpawnTile(state, seat, action.tileId)) return fail("Can't redeploy there");
      const dead = state.graveyard.find(u => u.id === action.deadUnitId)!;
      const cost = RESPAWN_CP_COST[dead.type];
      return afford(cost, {
        type: 'SPAWN',
        unitType: dead.type,
        tileId: action.tileId,
        cost,
        deadUnitId: dead.id,
      });
    }

    case 'BUY_DROP': {
      if (!isConsumable(action.itemKey)) return fail('Not a supply item');
      const goldCost = SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS].cost;
      if (gold < goldCost) return fail('Not enough Euros');
      if (!dropTilesFor(state, seat).has(action.tileId)) return fail('Drops land beside your own units');
      return ok({ type: 'BUY_DROP', itemKey: action.itemKey, tileId: action.tileId, cost: 0, goldCost });
    }

    case 'BUY_ITEM': {
      if (!isConsumable(action.itemKey)) return fail('Not a supply item');
      if (gold < SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS].cost) return fail('Not enough Euros');
      if (action.tileId !== undefined) {
        if (state.settings.gameMode !== 'PVE') return fail('Targeted drops are only available vs AI');
        if (!getSupplyDropTargets(state, seat).has(action.tileId)) return fail('Pick a drop zone near your HQ or squad');
        const vis = getVisible();
        if (vis && !vis.has(action.tileId)) return fail('Drop zone must be visible');
        return ok({ type: 'BUY_ITEM', itemKey: action.itemKey, tileId: action.tileId });
      }
      return ok({ type: 'BUY_ITEM', itemKey: action.itemKey });
    }

    case 'BUILD': {
      if (!isConstruct(action.itemKey)) return fail('Not something you can build');
      if (gold < SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS].cost) return fail('Not enough Euros');
      const vis = action.itemKey === 'LAND_MINE' ? getVisible() : null;
      const unitsForBuild = vis
        ? state.units.filter(u => u.owner === seat || vis.has(u.tileId))
        : state.units;
      const ctx = { playerId: seat, mapData: state.mapData, mines: state.mines };

      if (action.itemKey === 'BARRIER') {
        const targetIds = action.tileIds && action.tileIds.length > 0
          ? Array.from(new Set(action.tileIds))
          : [action.tileId];
        if (targetIds.length < 1 || targetIds.length > BARRIER_STATS.BUILD_COUNT) {
          return fail(`Choose 1 to ${BARRIER_STATS.BUILD_COUNT} tiles for Barrier`);
        }
        for (const tid of targetIds) {
          const t = tileOf(state, tid);
          if (!t || !canConstructOnTile('BARRIER', t, unitsForBuild, ctx)) return fail("Can't build there");
        }
        return ok({ type: 'BUILD', itemKey: action.itemKey, tileId: targetIds[0], tileIds: targetIds });
      }

      const tile = tileOf(state, action.tileId);
      if (!tile || !canConstructOnTile(action.itemKey, tile, unitsForBuild, ctx)) return fail("Can't build there");
      const variant = action.itemKey === 'BRIDGE' && (action.variant === 'H' || action.variant === 'V') ? action.variant : undefined;
      return ok({ type: 'BUILD', itemKey: action.itemKey, tileId: tile.id, variant });
    }

    case 'BANK_REWARD': {
      if (!pending || pending.playerId !== seat) return fail('No vault to claim');
      return ok({ type: 'BANK_REWARD', choice: action.choice === 'CP' ? 'CP' : 'GOLD' });
    }
  }
  return fail('Unknown action');
}
