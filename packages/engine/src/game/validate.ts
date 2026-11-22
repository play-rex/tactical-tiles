/**
 * Checks an action from a player against the rules before it is applied. Costs are worked
 * out here from the game, never taken from the message, so a client can't pay less than the
 * rules say. The local game skips this (its UI only offers legal actions); the server and
 * the bots always go through it.
 */
import { CP_SYSTEM, OVERWATCH_STATS, SHOP_ITEMS, UNIT_COSTS } from '../constants/Config';
import { canConstructOnTile, canUnitEnterOverwatch, getUnitAttackCost } from '../rules/CombatRules';
import {
  attackOptionsFor,
  dropTilesFor,
  getSpawnTiles,
  INTERACT_COST,
  interactOptionsFor,
  isConstruct,
  isConsumable,
  moveCostsFor,
  spawnBlocker,
  visibleSet,
} from './options';
import type { GameAction, GameState } from './state';

export type Prepared =
  | { ok: true; action: GameAction; error?: undefined }
  | { ok: false; error: string; action?: undefined };

const fail = (error: string): Prepared => ({ ok: false, error });
const ok = (action: GameAction): Prepared => ({ ok: true, action });

export function prepareAction(state: GameState, seat: number, action: GameAction): Prepared {
  if (state.winner !== null) return fail('The match is over');
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
  // Only the part of a unit's options an action needs: pathfinding for moves, sight for shots.
  const attacksOf = (id: string) => {
    const u = readyUnit(id);
    return u ? attackOptionsFor(state, u, visibleSet(state, seat)) : null;
  };
  const interactionsOf = (id: string) => {
    const u = readyUnit(id);
    return u ? interactOptionsFor(state, u) : null;
  };
  const afford = (cost: number, a: GameAction) => (cp >= cost ? ok(a) : fail('Not enough CP'));

  switch (action.type) {
    case 'END_TURN':
      return ok({ type: 'END_TURN' });

    case 'MOVE': {
      const unit = readyUnit(action.unitId);
      const cost = unit ? moveCostsFor(state, unit).get(action.targetTileId) : undefined;
      if (cost === undefined) return fail("That unit can't move there");
      return afford(cost, { type: 'MOVE', unitId: action.unitId, targetTileId: action.targetTileId, cost });
    }

    case 'ATTACK': {
      const opts = attacksOf(action.attackerId);
      if (!opts?.attackTargets.includes(action.targetUnitId)) return fail("That target isn't in range");
      const cost = getUnitAttackCost(ownUnit(action.attackerId)!);
      return afford(cost, { type: 'ATTACK', attackerId: action.attackerId, targetUnitId: action.targetUnitId, cost });
    }

    case 'SIEGE':
    case 'DEMOLISH': {
      const opts = attacksOf(action.unitId);
      const tiles = action.type === 'SIEGE' ? opts?.siegeTiles : opts?.demolishTiles;
      if (!tiles?.includes(action.tileId)) return fail("That target isn't in range");
      const cost = getUnitAttackCost(ownUnit(action.unitId)!);
      return afford(cost, { type: action.type, unitId: action.unitId, tileId: action.tileId, cost });
    }

    case 'SECURE':
    case 'HEIST':
    case 'LOOT': {
      const opts = interactionsOf(action.unitId);
      const tiles = action.type === 'SECURE' ? opts?.secureTiles : action.type === 'HEIST' ? opts?.heistTiles : opts?.lootTiles;
      if (!tiles?.includes(action.tileId)) return fail("That unit can't reach it");
      return afford(INTERACT_COST, { type: action.type, unitId: action.unitId, tileId: action.tileId, cost: INTERACT_COST });
    }

    case 'OVERWATCH': {
      const unit = readyUnit(action.unitId);
      const tile = unit && state.mapData.find(t => t.id === unit.tileId);
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
      if (!getSpawnTiles(state, seat).includes(action.tileId)) return fail("Can't redeploy there");
      const dead = state.graveyard.find(u => u.id === action.deadUnitId)!;
      return ok({
        type: 'SPAWN',
        unitType: dead.type,
        tileId: action.tileId,
        cost: 0,
        goldCost: UNIT_COSTS[dead.type],
        deadUnitId: dead.id,
      });
    }

    case 'BUY_DROP': {
      if (!isConsumable(action.itemKey)) return fail('Not a supply item');
      const goldCost = SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS].cost;
      if (gold < goldCost) return fail('Not enough gold');
      if (!dropTilesFor(state, seat).has(action.tileId)) return fail('Drops land beside your own units');
      return ok({ type: 'BUY_DROP', itemKey: action.itemKey, tileId: action.tileId, cost: 0, goldCost });
    }

    case 'BUY_ITEM': {
      if (!isConsumable(action.itemKey)) return fail('Not a supply item');
      if (gold < SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS].cost) return fail('Not enough gold');
      return ok({ type: 'BUY_ITEM', itemKey: action.itemKey });
    }

    case 'BUILD': {
      if (!isConstruct(action.itemKey)) return fail('Not something you can build');
      if (gold < SHOP_ITEMS[action.itemKey as keyof typeof SHOP_ITEMS].cost) return fail('Not enough gold');
      const tile = state.mapData.find(t => t.id === action.tileId);
      if (!tile || !canConstructOnTile(action.itemKey, tile, state.units)) return fail("Can't build there");
      const variant = action.variant === 'V' ? 'V' : undefined;
      return ok({ type: 'BUILD', itemKey: action.itemKey, tileId: tile.id, variant });
    }

    case 'BANK_REWARD': {
      if (!pending || pending.playerId !== seat) return fail('No vault to claim');
      return ok({ type: 'BANK_REWARD', choice: action.choice === 'CP' ? 'CP' : 'GOLD' });
    }
  }
  return fail('Unknown action');
}
