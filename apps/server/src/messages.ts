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

const terrainType = z.enum([
  'PLAINS', 'FOREST', 'MOUNTAIN', 'WATER', 'BASE', 'ROAD', 'ROAD_H',
  'BRIDGE', 'BRIDGE_V', 'BANK', 'BUILDING', 'BARRIER', 'SAND', 'DUNES', 'QUICKSAND', 'CANYON',
]);

const mapTilePatchSchema = z.object({
  x: z.number().int().min(0).max(49),
  y: z.number().int().min(0).max(49),
  type: terrainType,
  height: z.number().int().min(0).max(3),
  subType: z.enum(['WATCHTOWER', 'BUNKER', 'NONE']).optional(),
  owner: z.number().int().min(0).max(5).nullable().optional(),
  bankGoldReward: z.number().int().min(0).max(1000).optional(),
  bankCpReward: z.number().int().min(0).max(100).optional(),
});

const mapGenKnobsSchema = z.object({
  gridSize: z.union([z.literal('AUTO'), z.literal(16), z.literal(20), z.literal(25), z.literal(30)]).optional(),
  waterStyle: z.enum(['RIVERS', 'ISLANDS', 'CANYON', 'NONE']).optional(),
  rivers: z.number().int().min(0).max(3).optional(),
  waterPct: z.number().int().min(0).max(30).optional(),
  forestPct: z.number().int().min(0).max(55).optional(),
  mountainPct: z.number().int().min(0).max(40).optional(),
  desertPct: z.number().int().min(0).max(100).optional(),
  buildingPct: z.number().int().min(0).max(15).optional(),
  lootPct: z.number().int().min(0).max(40).optional(),
  banks: z.number().int().min(0).max(4).optional(),
  roads: z.boolean().optional(),
  symmetry: z.enum(['ORGANIC', 'MIRRORED']).optional(),
});

export const mapGenSchema = z.object({
  preset: z.enum([
    'classic',
    'balanced',
    'lush_valley',
    'archipelago',
    'badlands',
    'fortress',
    'twin_fronts',
    'timber_ridge',
    'open_blitz',
    'custom',
  ]),
  staticMapId: z.enum(['campaign_recon', 'campaign_canyon', 'campaign_delta']).optional(),
  knobs: mapGenKnobsSchema.optional(),
});

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
  mapGen: mapGenSchema.optional(),
  turnBaseS: z.number().int().refine(v => [0, 30, 45, 60, 90].includes(v), 'Invalid turn time'),
  turnIncrementS: z.number().int().refine(v => [0, 15, 30, 45, 60].includes(v), 'Invalid increment'),
  mapEdits: z.array(mapTilePatchSchema).max(900).optional(),
  suggestionsEnabled: z.boolean().optional(),
});

export const mapCustomizingMsg = z.object({
  active: z.boolean(),
});

export const removeSeatMsg = z.object({ seat: z.number().int().min(0) });

export const seatMapAccessMsg = z.object({
  seat: z.number().int().min(0),
  canEditMap: z.boolean(),
  mapLocked: z.boolean(),
});

export const mapEditsPayloadMsg = z.object({
  edits: z.array(mapTilePatchSchema).max(900).nullable(),
});

export const resolveSuggestionMsg = z.object({
  seat: z.number().int().min(0),
  accept: z.boolean(),
});

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
