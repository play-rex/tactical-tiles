/**
 * Bot shopping for tactical weapons. Respects all targeting rules, fog-only Radar Sweep,
 * 3-round per-weapon cooldowns, anti-cheese Paradrop guardrails, and friendly-fire avoidance.
 */
import { getNeighbors } from '../grid/Pathfinding';
import { visibleSet } from '../game/options';
import type { GameAction, GameState } from '../game/state';
import type { TacticalAxis, TacticalId, Tile, Unit } from '../types';
import { TACTICAL_IDS, TACTICAL_ITEMS, TACTICAL_MIN_HP_FLOOR, currentRoundOf, tacticalIsFree } from './catalog';
import { hqExclusionTiles, tacticalTilesFor } from './geometry';
import { legalParadropDestinations, tacticalBlocker } from './rules';

interface TacticalTarget {
  tileId?: string;
  tileIds?: string[];
  unitId?: string;
  axis?: TacticalAxis;
  width?: 1 | 2;
}

const priceOf = (state: GameState, seat: number, itemKey: TacticalId): number =>
  tacticalIsFree(state, seat, itemKey) ? 0 : TACTICAL_ITEMS[itemKey].cost;

const tileOf = (state: GameState, tileId: string): Tile | undefined =>
  state.mapData.find(t => t.id === tileId);

const visibleEnemies = (state: GameState, seat: number, visible: Set<string> | null): Unit[] =>
  state.units.filter(u => u.owner !== seat && (!visible || visible.has(u.tileId)));

/** Highest-scoring axis-aligned corridor that avoids hitting friendly units. */
const findLineTarget = (
  state: GameState,
  seat: number,
  itemKey: TacticalId,
  enemies: Unit[],
  visible: Set<string> | null,
  length: number,
  width: 1 | 2,
  minScore: number,
): TacticalTarget | null => {
  const enemyAt = new Map(enemies.map(u => [u.tileId, u]));
  const allyTiles = new Set(state.units.filter(u => u.owner === seat).map(u => u.tileId));
  const excluded = itemKey === 'ARTILLERY_BARRAGE' ? hqExclusionTiles(state.mapData, state.gridSize) : null;
  let bestTarget: TacticalTarget | null = null;
  let bestScore = minScore - 1;

  for (const anchor of state.mapData) {
    if (visible && !visible.has(anchor.id)) continue;
    for (const axis of ['H', 'V'] as const) {
      const tiles = tacticalTilesFor(state.mapData, state.gridSize, itemKey, anchor.id, axis, width);
      if (!tiles || tiles.length !== length * width) continue;
      if (excluded && tiles.some(tile => excluded.has(tile.id))) continue;
      let sc = 0;
      for (const tile of tiles) {
        if (allyTiles.has(tile.id)) sc -= 3;
        const enemy = enemyAt.get(tile.id);
        if (enemy) sc += enemy.type === 'SNIPER' ? 2 : 1;
      }
      if (sc > bestScore) {
        bestScore = sc;
        bestTarget = width === 2 ? { tileId: anchor.id, axis, width: 2 } : { tileId: anchor.id, axis };
      }
    }
  }
  return bestTarget;
};

const targetFor = (
  state: GameState,
  seat: number,
  itemKey: TacticalId,
  enemies: Unit[],
  visible: Set<string> | null,
): TacticalTarget | null => {
  switch (itemKey) {
    case 'MINEFIELD_SNAPSHOT':
      return (state.mines ?? []).some(m => m.owner !== seat) ? {} : null;

    case 'RECON_DRONE': {
      // % of current HP gets the biggest chunk off high-HP enemies (strict > 2 HP floor).
      const target = [...enemies]
        .filter(e => e.hp > TACTICAL_MIN_HP_FLOOR)
        .sort((a, b) => b.hp - a.hp)[0];
      return target ? { tileId: target.tileId } : null;
    }

    case 'SMOKE_SCREEN':
      return null;

    case 'RADAR_SWEEP':
      return state.settings.fogOfWar ? {} : null;

    case 'PRECISION_STRIKE': {
      // 75% current HP (min 2 HP) shreds high-HP Breachers & Aces hardest!
      const sorted = [...enemies]
        .filter(e => e.hp > TACTICAL_MIN_HP_FLOOR)
        .sort((a, b) => b.hp - a.hp);
      return sorted[0] ? { tileId: sorted[0].tileId } : null;
    }

    case 'SABOTAGE': {
      const structure = state.mapData.find(
        tile =>
          tile.type === 'BUILDING' &&
          tile.owner !== null &&
          tile.owner !== undefined &&
          tile.owner !== seat &&
          tile.subType !== undefined &&
          tile.subType !== 'NONE' &&
          (!visible || visible.has(tile.id)),
      );
      if (structure) return { tileId: structure.id };
      const enemyHqs = state.mapData
        .filter(
          tile =>
            tile.type === 'BASE' &&
            tile.owner !== null &&
            tile.owner !== undefined &&
            tile.owner !== seat &&
            (tile.hp ?? 1) > 0 &&
            state.playerStatus?.[tile.owner] !== 'ELIMINATED' &&
            (state.playerCp[tile.owner] ?? 0) >= 8,
        )
        .sort((a, b) => (state.playerCp[b.owner!] ?? 0) - (state.playerCp[a.owner!] ?? 0));
      return enemyHqs[0] ? { tileId: enemyHqs[0].id } : null;
    }

    case 'NAPALM_LINE':
      return findLineTarget(state, seat, itemKey, enemies, visible, 4, 1, 1);

    case 'PARADROP': {
      // Relocate a high-threat perched enemy Sniper off a Watchtower/Mountain, or drop own Assault unit near combat.
      const perchedEnemy = enemies.find(e => {
        const t = tileOf(state, e.tileId);
        return t && (t.type === 'MOUNTAIN' || (t.type === 'BUILDING' && t.subType === 'WATCHTOWER'));
      });
      if (perchedEnemy) {
        const dests = legalParadropDestinations(state, seat, perchedEnemy.id, visible);
        const exposed = dests.find(id => tileOf(state, id)?.type === 'SAND') ?? dests[0];
        if (exposed) return { unitId: perchedEnemy.id, tileId: exposed };
      }
      const ownUnit = state.units.find(u => u.owner === seat && !u.completed);
      if (!ownUnit || enemies.length === 0) return null;
      const legalDestSet = new Set(legalParadropDestinations(state, seat, ownUnit.id, visible));
      for (const enemy of enemies) {
        const et = tileOf(state, enemy.tileId);
        if (!et) continue;
        for (const nb of getNeighbors(et, state.mapData, state.gridSize)) {
          if (legalDestSet.has(nb.id)) return { unitId: ownUnit.id, tileId: nb.id };
        }
      }
      return null;
    }

    case 'CARPET_RUN': {
      const eligible = enemies.filter(e => e.hp > TACTICAL_MIN_HP_FLOOR);
      if (eligible.length < 2) return null;
      const picked = [...eligible]
        .sort((a, b) => b.hp - a.hp)
        .slice(0, 3)
        .map(u => u.tileId);
      return picked.length > 0 ? { tileId: picked[0], tileIds: picked } : null;
    }

    case 'ARTILLERY_BARRAGE':
      return findLineTarget(state, seat, itemKey, enemies, visible, 10, 2, 2);

    case 'OVERCLOCK_CORE': {
      if ((state.overclockCharges?.[seat] ?? 0) > 0) return null;
      if ((state.playerCp[seat] ?? 0) >= 15) return null;
      const ready = state.units.some(u => u.owner === seat && !u.completed && u.ammo > 0);
      return ready ? {} : null;
    }

    default:
      return null;
  }
};

/** The next tactical action this bot wants, or null when none is worth buying right now. */
export const chooseTacticalAction = (
  state: GameState,
  seat = state.currentPlayer,
  difficulty = state.settings.aiDifficulty,
): GameAction | null => {
  if (state.winner !== null) return null;
  if (state.playerStatus[seat] === 'ELIMINATED') return null;
  if (difficulty === 'EASY') return null;

  const round = currentRoundOf(state);
  const hasAnyVoucher = (state.playerTacticalVouchers?.[seat]?.length ?? 0) > 0;
  if (round < 2 && !hasAnyVoucher) return null;
  if ((state.tacticalRound?.[seat] ?? 0) === round) return null;

  const hasReadyUnit = state.units.some(u => u.owner === seat && !u.completed);
  if (hasReadyUnit && (state.playerCp[seat] ?? 0) >= 5) return null;

  const gold = state.playerGold[seat] ?? 0;
  const visible = state.settings.fogOfWar ? visibleSet(state, seat) : null;
  const enemies = visibleEnemies(state, seat, visible);

  const candidates = TACTICAL_IDS
    .filter(itemKey => priceOf(state, seat, itemKey) <= gold)
    .sort((a, b) => priceOf(state, seat, a) - priceOf(state, seat, b));

  for (const itemKey of candidates) {
    const target = targetFor(state, seat, itemKey, enemies, visible);
    if (!target) continue;
    if (tacticalBlocker(state, seat, itemKey, { ...target, visible })) continue;
    return { type: 'USE_TACTICAL', itemKey, ...target };
  }
  return null;
};
