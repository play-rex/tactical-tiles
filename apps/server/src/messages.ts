/** Shapes of what clients may send. Anything else is dropped as malformed. */
import { UNIT_LIMITS } from '@tactical/engine';
import { SHOP_ITEMS, UNIT_STATS } from '@tactical/engine/constants/Config';
import { z } from 'zod';

export const joinOptions = z.object({
  name: z.string().trim().min(1).max(20),
  /** Kept on the player's device; lets them reclaim their seat later. */
  playerId: z.string().min(8).max(64),
});

const unitCount = (max: number) => z.number().int().min(0).max(max);

export const settingsMsg = z.object({
  unitCounts: z
    .object({
      SOLDIER: unitCount(UNIT_LIMITS.SOLDIER),
      ASSAULTER: unitCount(UNIT_LIMITS.ASSAULTER),
      SNIPER: unitCount(UNIT_LIMITS.SNIPER),
    })
    .refine(c => c.SOLDIER + c.ASSAULTER + c.SNIPER > 0, 'A squad needs at least one unit'),
  dynamicWeather: z.boolean(),
  fogOfWar: z.boolean(),
  doomsdayEnabled: z.boolean(),
  victoryMode: z.enum(['CONQUER', 'DEATHMATCH']),
  aiDifficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
  mutators: z.object({ blitzCp: z.boolean(), scarcity: z.boolean(), ironman: z.boolean() }),
  mapSeed: z.string().max(12).regex(/^[A-Za-z0-9]*$/),
  turnBaseS: z.number().int().refine(v => [0, 30, 45, 60, 90].includes(v), 'Invalid turn time'),
  turnIncrementS: z.number().int().refine(v => [0, 15, 30, 45, 60].includes(v), 'Invalid increment'),
});

export const removeSeatMsg = z.object({ seat: z.number().int().min(0) });

const id = z.string().min(1).max(32);
const cost = z.number().int().min(0).max(1000);
const keysOf = (o: object) => Object.keys(o) as [string, ...string[]];
const itemKey = z.enum(keysOf(SHOP_ITEMS));

/** Game actions. Costs are recomputed by the server (prepareAction); they're only shape-checked here. */
export const actionMsg = z.discriminatedUnion('type', [
  z.object({ type: z.literal('END_TURN') }),
  z.object({ type: z.literal('MOVE'), unitId: id, targetTileId: id, cost }),
  z.object({ type: z.literal('ATTACK'), attackerId: id, targetUnitId: id, cost }),
  z.object({ type: z.literal('OVERWATCH'), unitId: id, cost }),
  z.object({ type: z.literal('RELOAD'), unitId: id, cost }),
  z.object({ type: z.enum(['SECURE', 'HEIST', 'SIEGE', 'DEMOLISH', 'LOOT']), unitId: id, tileId: id, cost }),
  z.object({ type: z.literal('USE_ITEM'), unitId: id, itemIndex: z.number().int().min(0).max(99), cost }),
  z.object({
    type: z.literal('SPAWN'),
    unitType: z.enum(keysOf(UNIT_STATS)),
    tileId: id,
    cost,
    goldCost: cost,
    deadUnitId: id,
  }),
  z.object({ type: z.literal('BUY_ITEM'), itemKey, tileId: id.optional() }),
  z.object({ type: z.literal('BUILD'), itemKey, tileId: id, tileIds: z.array(id).min(1).max(3).optional(), variant: z.enum(['H', 'V']).optional() }),
  z.object({ type: z.literal('BANK_REWARD'), choice: z.enum(['GOLD', 'CP']) }),
]);
