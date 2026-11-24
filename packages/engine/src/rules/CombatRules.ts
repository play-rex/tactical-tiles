import { GameMutators, LandMine, TerrainType, Tile, Unit, UnitRank, UnitType, WeatherState } from '../types';
import { BUILDING_STATS, TERRAIN_DEFENSE, UNIT_STATS, BASE_STATS, LAND_MINE_STATS, VETERANCY_CONFIG, OVERWATCH_STATS, MUTATOR_CONFIG, CP_SYSTEM, MAX_RESPAWNS, GOLD_SETTINGS } from '../constants/Config';

/**
 * Returns active CP caps and regeneration accounting for the Blitz CP mutator.
 */
export const getEffectiveCpRules = (mutators?: GameMutators): {
    maxCp: number;
    regenAmount: number;
    p1Round1Cp: number;
} => {
    if (mutators?.blitzCp) {
        return {
            maxCp: MUTATOR_CONFIG.BLITZ_CP.MAX_CP,
            regenAmount: MUTATOR_CONFIG.BLITZ_CP.REGEN_AMOUNT,
            p1Round1Cp: MUTATOR_CONFIG.BLITZ_CP.P1_ROUND1_CP
        };
    }
    return {
        maxCp: CP_SYSTEM.MAX_CP,
        regenAmount: CP_SYSTEM.REGEN_AMOUNT,
        p1Round1Cp: CP_SYSTEM.P1_ROUND1_CP
    };
};

/**
 * Returns maximum graveyard respawns allowed per player (0 under Ironman).
 */
export const getEffectiveMaxRespawns = (mutators?: GameMutators): number => {
    return mutators?.ironman ? MUTATOR_CONFIG.IRONMAN.MAX_RESPAWNS : MAX_RESPAWNS;
};

/**
 * Returns starting/refill max ammo for a unit type (50% rounded up under Scarcity).
 */
export const getEffectiveUnitAmmo = (unitType: UnitType, mutators?: GameMutators): number => {
    const base = UNIT_STATS[unitType].ammo;
    if (!mutators?.scarcity) return base;
    return Math.max(1, Math.ceil(base * MUTATOR_CONFIG.SCARCITY.AMMO_MULT));
};

/**
 * Returns Bank Heist Gold/CP rewards (+50% under Scarcity).
 */
export const getEffectiveBankRewards = (
    tile?: Tile,
    mutators?: GameMutators
): { gold: number; cp: number } => {
    const baseGold = tile?.bankGoldReward ?? GOLD_SETTINGS.HEIST_REWARD_GOLD;
    const baseCp = tile?.bankCpReward ?? GOLD_SETTINGS.HEIST_REWARD_CP;
    if (!mutators?.scarcity) return { gold: baseGold, cp: baseCp };
    return {
        gold: Math.round(baseGold * MUTATOR_CONFIG.SCARCITY.BANK_REWARD_MULT),
        cp: Math.round(baseCp * MUTATOR_CONFIG.SCARCITY.BANK_REWARD_MULT)
    };
};

export interface AttackOutcome {
    damage: number;
    defense: number;
    watchtowerBoosted: boolean;
    coverArmorApplied: boolean;
    crossfireBonus: number;
}

/**
 * Returns the maximum HP of a unit, accounting for Veteran (Rank 1) and Ace (Rank 3) bonuses.
 */
export const getUnitMaxHp = (unit: Unit): number => {
    if (unit.maxHp !== undefined) return unit.maxHp;
    const baseHp = UNIT_STATS[unit.type].hp;
    const rank = unit.rank ?? 0;
    const bonusPerTier = Math.round(baseHp * VETERANCY_CONFIG.RANK_HP_MULT);
    let maxHp = baseHp;
    if (rank >= 1) maxHp += bonusPerTier;
    if (rank >= 3) maxHp += bonusPerTier;
    return maxHp;
};

/**
 * Returns a unit's effective attack CP cost including Elite Sniper (-1) and Ace Scout (-1) perks.
 */
export const getUnitAttackCost = (unit: Unit): number => {
    const base = UNIT_STATS[unit.type].attackCost;
    const rank = unit.rank ?? 0;
    if (unit.type === 'SNIPER' && rank >= 2) return Math.max(1, base - 1);
    if (unit.type === 'SOLDIER' && rank >= 3) return Math.max(1, base - 1);
    return base;
};

/**
 * Returns a unit's effective base damage including veterancy rank bonuses.
 */
export const getUnitBaseDamage = (unit: Unit): number => {
    let dmg = UNIT_STATS[unit.type].damage;
    const rank = unit.rank ?? 0;
    if (unit.type === 'SNIPER' && rank >= 2) dmg += VETERANCY_CONFIG.ELITE_SNIPER_DMG_BONUS;
    if (unit.type === 'SOLDIER' && rank >= 3) dmg += VETERANCY_CONFIG.ACE_SCOUT_DMG_BONUS;
    if (unit.type === 'ASSAULTER' && rank >= 3) dmg += VETERANCY_CONFIG.ACE_BREACHER_DMG_BONUS;
    return dmg;
};

/**
 * Returns a unit's effective vision radius including Elite Scout (+1) perk.
 */
export const getUnitVision = (unit: Unit): number => {
    let vision = UNIT_STATS[unit.type].vision;
    if (unit.type === 'SOLDIER' && (unit.rank ?? 0) >= 2) {
        vision += 1;
    }
    return vision;
};

/**
 * Maps accumulated XP to rank 0..3.
 */
export const getRankForXp = (xp: number): UnitRank => {
    const t = VETERANCY_CONFIG.XP_THRESHOLDS;
    if (xp >= t[3]) return 3;
    if (xp >= t[2]) return 2;
    if (xp >= t[1]) return 1;
    return 0;
};

/**
 * Applies XP to a unit and updates rank, maxHp (with instant delta heal), and Rank 1 ammo cap.
 */
export const applyUnitXp = (
    unit: Unit,
    gainedXp: number
): { unit: Unit; promotedTo: UnitRank | null } => {
    if (gainedXp <= 0) return { unit, promotedTo: null };

    const oldRank = (unit.rank ?? 0) as UnitRank;
    const nextXp = (unit.xp ?? 0) + gainedXp;
    const newRank = getRankForXp(nextXp);

    const baseHp = UNIT_STATS[unit.type].hp;
    const hpBonus = Math.round(baseHp * VETERANCY_CONFIG.RANK_HP_MULT);

    let nextMaxHp = getUnitMaxHp(unit);
    let nextHp = unit.hp;
    let nextMaxAmmo = unit.maxAmmo;
    let nextAmmo = unit.ammo;

    if (oldRank < 1 && newRank >= 1) {
        nextMaxHp += hpBonus;
        nextHp += hpBonus;
        const ammoBonus = VETERANCY_CONFIG.AMMO_BONUS_RANK1[unit.type];
        nextMaxAmmo += ammoBonus;
        nextAmmo += ammoBonus;
    }

    if (oldRank < 3 && newRank >= 3) {
        nextMaxHp += hpBonus;
        nextHp += hpBonus;
    }

    return {
        unit: {
            ...unit,
            xp: nextXp,
            rank: newRank,
            hp: Math.min(nextMaxHp, nextHp),
            maxHp: nextMaxHp,
            ammo: nextAmmo,
            maxAmmo: nextMaxAmmo
        },
        promotedTo: newRank > oldRank ? newRank : null
    };
};

/**
 * Checks whether a unit is allowed to initiate an attack/siege/demolish from its current tile.
 * Snipers require high ground (Mountain, Dunes) or an owned Building.
 */
export const canUnitAttackFromTile = (unit: Unit, tile: Tile | undefined): boolean => {
    if (!tile) return false;
    if (unit.type !== 'SNIPER') return true;
    if (tile.type === 'MOUNTAIN' || tile.type === 'DUNES') return true;
    return tile.type === 'BUILDING' && tile.owner === unit.owner;
};

/**
 * Computes effective attack range including owned buildings and local zone weather.
 */
export const getUnitRange = (unit: Unit, mapData: Tile[], weather: WeatherState, originTile?: Tile): number => {
    let range = UNIT_STATS[unit.type].range;
    const tile = originTile ?? mapData.find(t => t.id === unit.tileId);

    if (tile?.type === 'BUILDING' && tile.owner === unit.owner) {
        if (tile.subType === 'WATCHTOWER') range += BUILDING_STATS.WATCHTOWER.rangeBonus;
        if (tile.subType === 'BUNKER') range += BUILDING_STATS.BUNKER.rangeBonus;
    }

    if (tile?.zone !== undefined) {
        const wType = weather.playerZones[tile.zone] || 'CLEAR';
        if (wType === 'TAILWIND') range += 1;
        if (wType === 'FOG' && unit.type === 'SNIPER') range = Math.min(range, 3);
        if (wType === 'SANDSTORM') range = Math.min(range, 3);
    }

    return range;
};

/**
 * Checks whether a unit can activate Overwatch stance from its current tile and CP budget.
 */
export const canUnitEnterOverwatch = (unit: Unit, tile: Tile | undefined, currentCp: number): boolean => {
    if (!tile || unit.completed || unit.isOverwatching || unit.ammo <= 0) return false;
    if (currentCp < OVERWATCH_STATS[unit.type].cost) return false;
    return canUnitAttackFromTile(unit, tile);
};

const computeDamageOutcome = (
    baseDamage: number,
    attacker: Unit,
    attTile: Tile | undefined,
    targetTile: Tile | undefined,
    targetOwner: number,
    targetUnit?: Unit,
    crossfireBonus = 0
): AttackOutcome => {
    if (!attTile || !targetTile) {
        return { damage: 0, defense: 0, watchtowerBoosted: false, coverArmorApplied: false, crossfireBonus: 0 };
    }

    let dmg = baseDamage;
    const watchtowerBoosted =
        attTile.type === 'BUILDING' &&
        attTile.subType === 'WATCHTOWER' &&
        attTile.owner === attacker.owner;

    if (watchtowerBoosted) {
        dmg *= BUILDING_STATS.WATCHTOWER.damageBonus;
    }

    let defense = TERRAIN_DEFENSE[targetTile.type] || 0;
    const isOwnedBunker =
        targetTile.type === 'BUILDING' &&
        targetTile.subType === 'BUNKER' &&
        targetTile.owner === targetOwner;
    if (isOwnedBunker) {
        defense = BUILDING_STATS.BUNKER.defense;
    }

    let damage = Math.max(1, Math.floor(dmg * (1 - defense)));

    const hasPositiveCover = defense > 0;
    const coverArmorApplied =
        Boolean(targetUnit) &&
        targetUnit!.type === 'ASSAULTER' &&
        (targetUnit!.rank ?? 0) >= 2 &&
        hasPositiveCover;

    if (coverArmorApplied) {
        damage = Math.max(1, damage - VETERANCY_CONFIG.ELITE_BREACHER_COVER_DR);
    }

    const appliedCrossfire = crossfireBonus > 0 ? crossfireBonus : 0;
    damage += appliedCrossfire;

    return { damage, defense, watchtowerBoosted, coverArmorApplied, crossfireBonus: appliedCrossfire };
};

/**
 * Computes unit-vs-unit attack damage including Watchtower bonus, terrain cover, Elite Breacher cover armor, and optional Crossfire bonus.
 */
export const calculateAttackOutcome = (
    attacker: Unit,
    attTile: Tile | undefined,
    targetTile: Tile | undefined,
    targetOwner: number,
    targetUnit?: Unit,
    crossfireBonus = 0
): AttackOutcome => {
    return computeDamageOutcome(getUnitBaseDamage(attacker), attacker, attTile, targetTile, targetOwner, targetUnit, crossfireBonus);
};

/**
 * Computes Overwatch reaction shot damage using OVERWATCH_STATS base damage and standard terrain/cover modifiers.
 */
export const calculateOverwatchOutcome = (
    attacker: Unit,
    attTile: Tile | undefined,
    targetTile: Tile | undefined,
    targetOwner: number,
    targetUnit?: Unit
): AttackOutcome => {
    return computeDamageOutcome(OVERWATCH_STATS[attacker.type].damage, attacker, attTile, targetTile, targetOwner, targetUnit);
};

/**
 * Computes damage dealt to an enemy Base — or a Bank vault — during a Siege action.
 * Scales with unit attack power (and Watchtower boost) against the target's armor (bypassed by Ace Breacher).
 */
export const calculateSiegeDamage = (attacker: Unit, attTile: Tile | undefined, targetType: TerrainType = 'BASE'): number => {
    let dmg = getUnitBaseDamage(attacker);
    if (
        attTile &&
        attTile.type === 'BUILDING' &&
        attTile.subType === 'WATCHTOWER' &&
        attTile.owner === attacker.owner
    ) {
        dmg *= BUILDING_STATS.WATCHTOWER.damageBonus;
    }
    const isAceBreacher = attacker.type === 'ASSAULTER' && (attacker.rank ?? 0) >= 3;
    const targetDefense = isAceBreacher ? 0 : (TERRAIN_DEFENSE[targetType] || 0);
    return Math.max(1, Math.floor(dmg * (1 - targetDefense)));
};

/**
 * Computes damage dealt to a Barrier during a Demolish action.
 */
export const calculateDemolishDamage = (attacker: Unit, attTile: Tile | undefined): number => {
    let dmg = getUnitBaseDamage(attacker);
    if (
        attTile &&
        attTile.type === 'BUILDING' &&
        attTile.subType === 'WATCHTOWER' &&
        attTile.owner === attacker.owner
    ) {
        dmg *= BUILDING_STATS.WATCHTOWER.damageBonus;
    }
    return Math.max(1, Math.floor(dmg));
};

/**
 * Rolls Base automated artillery damage within the configured [MIN_DMG, MAX_DMG] range.
 */
export const getBaseArtilleryDamage = (): number => {
    const span = BASE_STATS.MAX_DMG - BASE_STATS.MIN_DMG + 1;
    return BASE_STATS.MIN_DMG + Math.floor(Math.random() * span);
};

/**
 * Rolls Base splash damage dealt to each additional enemy in range beyond the primary target.
 */
export const getBaseArtillerySplashDamage = (): number => {
    const span = BASE_STATS.SPLASH_MAX_DMG - BASE_STATS.SPLASH_MIN_DMG + 1;
    return BASE_STATS.SPLASH_MIN_DMG + Math.floor(Math.random() * span);
};

export interface ConstructContext {
    playerId?: number;
    mapData?: Tile[];
    mines?: LandMine[];
}

/**
 * Checks whether `tile` falls within the 5-tile square radius exclusion zone around any enemy HQ.
 */
export const isWithinEnemyHqExclusion = (
    tile: Pick<Tile, 'x' | 'y'>,
    playerId: number,
    mapData: Tile[],
    radius = LAND_MINE_STATS.ENEMY_HQ_EXCLUSION_RADIUS
): boolean =>
    mapData.some(
        t =>
            t.type === 'BASE' &&
            t.owner !== undefined &&
            t.owner !== playerId &&
            Math.max(Math.abs(tile.x - t.x), Math.abs(tile.y - t.y)) <= radius
    );

/**
 * Checks whether a shop construction item (BARRIER, LAND_MINE, BRIDGE, or TUNNEL) can be placed on a tile.
 */
export const canConstructOnTile = (
    itemKey: string,
    tile: Tile,
    units: Unit[],
    ctx?: ConstructContext
): boolean => {
    const isOccupied = units.some(u => u.tileId === tile.id);
    const isStructure =
        tile.type === 'BASE' ||
        tile.type === 'BANK' ||
        tile.type === 'BUILDING' ||
        tile.type === 'BARRIER';
    if (isOccupied || isStructure || tile.hazardState === 'LAVA') return false;

    if (ctx?.mines && ctx.playerId !== undefined) {
        if (ctx.mines.some(m => m.tileId === tile.id && m.owner === ctx.playerId)) return false;
    }

    if (itemKey === 'BARRIER') {
        return (
            tile.type !== 'WATER' &&
            tile.type !== 'BRIDGE' &&
            tile.type !== 'BRIDGE_V' &&
            tile.type !== 'CANYON'
        );
    }

    if (itemKey === 'LAND_MINE') {
        if (tile.type === 'WATER' || tile.type === 'CANYON' || tile.type === 'MOUNTAIN') return false;
        if (ctx?.mapData && ctx.playerId !== undefined && isWithinEnemyHqExclusion(tile, ctx.playerId, ctx.mapData)) {
            return false;
        }
        return true;
    }

    if (itemKey === 'BRIDGE') {
        return tile.type === 'WATER' || tile.type === 'CANYON';
    }

    if (itemKey === 'TUNNEL') {
        return tile.type === 'MOUNTAIN';
    }

    return false;
};

/**
 * Determines horizontal ('BRIDGE') vs vertical ('BRIDGE_V') bridge sprite orientation from neighbors.
 */
export const resolveBridgeVariant = (
    tile: Tile,
    mapData: Tile[],
    gridSize: number
): 'BRIDGE' | 'BRIDGE_V' => {
    const isPassableLand = (x: number, y: number): boolean => {
        if (x < 0 || x >= gridSize || y < 0 || y >= gridSize) return false;
        const neighbor = mapData[y * gridSize + x];
        return !!neighbor && neighbor.type !== 'WATER' && neighbor.type !== 'CANYON';
    };

    const horizLand = isPassableLand(tile.x - 1, tile.y) || isPassableLand(tile.x + 1, tile.y);
    const vertLand = isPassableLand(tile.x, tile.y - 1) || isPassableLand(tile.x, tile.y + 1);

    if (vertLand && !horizLand) return 'BRIDGE_V';
    return 'BRIDGE';
};

/** A tile a supply drop can land on. */
export const canHoldDrop = (t: Tile | undefined): t is Tile =>
    !!t && !t.loot && t.type !== 'WATER' && t.type !== 'BARRIER' && t.type !== 'BASE' && t.type !== 'BUILDING' &&
    t.type !== 'BANK' && t.type !== 'CANYON' && t.hazardState !== 'LAVA';
