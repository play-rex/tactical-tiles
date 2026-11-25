/**
 * Bot shopping for tactical weapons. Scores every legal weapon by real battlefield value
 * (expected % current HP damage, AoE/Barrier value, Overwatch/Sniper smoke protection,
 * Watchtower/HQ disruption, pre-turn Overclock/Radar/Snapshot/Paradrop prep, and round-based
 * gold saving for R5 Rares & R10 Epics) instead of blindly picking the cheapest item.
 */
import { getManhattanDistance, getNeighbors } from '../grid/Pathfinding';
import { getUnitMaxHp } from '../rules/CombatRules';
import { visibleSet } from '../game/options';
import type { GameAction, GameState } from '../game/state';
import type { TacticalAxis, TacticalId, Tile, Unit } from '../types';
import {
  TACTICAL_DAMAGE_PCT,
  TACTICAL_IDS,
  TACTICAL_ITEMS,
  TACTICAL_MIN_HP_FLOOR,
  computeTacticalPercentDamage,
  currentRoundOf,
  hasTacticalVoucher,
  tacticalIsFree,
} from './catalog';
import { hqExclusionTiles, tacticalTilesFor } from './geometry';
import { legalParadropDestinations, tacticalBlocker } from './rules';

interface TacticalTarget {
  tileId?: string;
  tileIds?: string[];
  unitId?: string;
  axis?: TacticalAxis;
  width?: 1 | 2;
}

interface ScoredCandidate {
  itemKey: TacticalId;
  target: TacticalTarget;
  score: number;
  cost: number;
  preTurnReady: boolean;
}

const priceOf = (state: GameState, seat: number, itemKey: TacticalId): number =>
  tacticalIsFree(state, seat, itemKey) ? 0 : TACTICAL_ITEMS[itemKey].cost;

const visibleEnemies = (state: GameState, seat: number, visible: Set<string> | null): Unit[] =>
  state.units.filter(u => u.owner !== seat && (!visible || visible.has(u.tileId)));

/** Deterministic ±14% doctrine variance keyed by seat/round/weapon for natural match-to-match variety. */
const deterministicFactor = (round: number, seat: number, itemKey: TacticalId, unitCount: number): number => {
  let h = (round * 41 + seat * 23 + unitCount * 13) | 0;
  for (let i = 0; i < itemKey.length; i++) {
    h = (Math.imul(h, 31) + itemKey.charCodeAt(i)) | 0;
  }
  const norm = ((h >>> 0) % 1000) / 1000; // [0, 1)
  return 0.86 + norm * 0.28; // [0.86, 1.14)
};

/** Highest-scoring axis-aligned corridor for Napalm (1×4) or Artillery Barrage (2×10). */
const evaluateLineCandidate = (
  state: GameState,
  seat: number,
  itemKey: 'NAPALM_LINE' | 'ARTILLERY_BARRAGE',
  enemies: Unit[],
  visible: Set<string> | null,
  tileById: Map<string, Tile>,
): { target: TacticalTarget; score: number } | null => {
  const isBarrage = itemKey === 'ARTILLERY_BARRAGE';
  const length = isBarrage ? 10 : 4;
  const width: 1 | 2 = isBarrage ? 2 : 1;
  const pct = isBarrage ? TACTICAL_DAMAGE_PCT.ARTILLERY_BARRAGE : TACTICAL_DAMAGE_PCT.NAPALM_DROP;

  const enemyAt = new Map(enemies.map(u => [u.tileId, u]));
  const allyTiles = new Set(state.units.filter(u => u.owner === seat).map(u => u.tileId));
  const excluded = isBarrage ? hqExclusionTiles(state.mapData, state.gridSize) : null;

  let bestTarget: TacticalTarget | null = null;
  let bestScore = 0;

  for (const anchor of state.mapData) {
    if (visible && !visible.has(anchor.id)) continue;
    for (const axis of ['H', 'V'] as const) {
      const tiles = tacticalTilesFor(state.mapData, state.gridSize, itemKey, anchor.id, axis, width);
      if (!tiles || tiles.length !== length * width) continue;
      if (excluded && tiles.some(tile => excluded.has(tile.id))) continue;

      let totalDealt = 0;
      let hitCount = 0;
      let allyCount = 0;
      let barriersHit = 0;
      let bonus = 0;

      for (const tile of tiles) {
        if (allyTiles.has(tile.id)) allyCount++;
        if (isBarrage && tile.type === 'BARRIER') barriersHit++;
        const enemy = enemyAt.get(tile.id);
        if (enemy) {
          const { dealt } = computeTacticalPercentDamage(enemy, pct);
          if (dealt > 0) {
            totalDealt += dealt;
            hitCount++;
            if (enemy.type === 'SNIPER') bonus += 6;
            if ((enemy.rank ?? 0) >= 2) bonus += 5;
            if (!isBarrage) {
              const t = tileById.get(enemy.tileId);
              if (t && (t.type === 'BRIDGE' || t.type === 'BRIDGE_V' || t.type === 'BUILDING' || enemy.isRooted)) {
                bonus += 8;
              }
            }
          }
        }
      }

      if (allyCount > 0) continue; // Avoid friendly fire
      if (isBarrage) {
        if (hitCount < 2 && !(hitCount >= 1 && barriersHit >= 1) && !(hitCount === 1 && totalDealt >= 14)) continue;
      } else {
        if (hitCount < 1) continue;
      }

      const score = totalDealt * (isBarrage ? 2.9 : 2.7) + hitCount * 10 + barriersHit * 14 + bonus;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = width === 2 ? { tileId: anchor.id, axis, width: 2 } : { tileId: anchor.id, axis };
      }
    }
  }

  return bestTarget ? { target: bestTarget, score: bestScore } : null;
};

const evaluateCandidate = (
  state: GameState,
  seat: number,
  itemKey: TacticalId,
  enemies: Unit[],
  allies: Unit[],
  visible: Set<string> | null,
  tileById: Map<string, Tile>,
): ScoredCandidate | null => {
  const cost = priceOf(state, seat, itemKey);
  const round = currentRoundOf(state);
  const isFree = cost === 0;
  const hasVoucher = hasTacticalVoucher(state, seat, itemKey);
  const freeBonus = hasVoucher ? 35 : isFree ? 28 : 0;
  const costDrag = cost * 0.03;

  switch (itemKey) {
    case 'MINEFIELD_SNAPSHOT': {
      if ((state.trapRevealRound?.[seat] ?? 0) >= round) return null;
      const enemyMines = (state.mines ?? []).filter(m => m.owner !== seat);
      if (enemyMines.length === 0) return null;
      const readyAllies = allies.filter(u => !u.completed);
      let closeMineCount = 0;
      for (const m of enemyMines) {
        const mt = tileById.get(m.tileId);
        if (!mt) continue;
        if (
          readyAllies.some(a => {
            const at = tileById.get(a.tileId);
            return at ? getManhattanDistance(at, mt) <= 4 : false;
          })
        ) {
          closeMineCount++;
        }
      }
      // Paid Snapshot only fires when a ready ally is genuinely pushing into a minefield (free R2/voucher always fires).
      if (!isFree && closeMineCount === 0) return null;
      const raw = isFree
        ? 28 + Math.min(24, enemyMines.length * 10)
        : 22 + closeMineCount * 12 + Math.min(8, enemyMines.length * 3);
      return {
        itemKey,
        target: {},
        score: raw + freeBonus - costDrag,
        cost,
        preTurnReady: closeMineCount > 0,
      };
    }

    case 'RECON_DRONE': {
      const eligible = enemies.filter(e => e.hp > TACTICAL_MIN_HP_FLOOR);
      if (eligible.length === 0) return null;
      const ownSensors = (state.sensors ?? []).filter(s => s.owner === seat);
      let best: { unit: Unit; score: number } | null = null;
      for (const e of eligible) {
        const { dealt } = computeTacticalPercentDamage(e, TACTICAL_DAMAGE_PCT.RECON_DRONE);
        if (dealt <= 0) continue;
        let sc = dealt * 2.4;
        if (e.type === 'SNIPER') sc += 5;
        if ((e.rank ?? 0) >= 2) sc += 5;
        if (state.settings.fogOfWar) {
          const et = tileById.get(e.tileId);
          const alreadyCovered = et
            ? ownSensors.some(s => {
                const st = tileById.get(s.tileId);
                return st ? getManhattanDistance(st, et) <= 4 : false;
              })
            : false;
          if (!alreadyCovered) sc += 10;
        }
        if (!best || sc > best.score) best = { unit: e, score: sc };
      }
      if (!best) return null;
      return {
        itemKey,
        target: { tileId: best.unit.tileId },
        score: best.score + freeBonus - costDrag,
        cost,
        preTurnReady: false,
      };
    }

    case 'SMOKE_SCREEN': {
      // Drop 3×3 smoke in true emergencies: breaking an enemy Overwatch cone blocking a ready ally,
      // or shielding a wounded completed ally from a perched enemy Sniper at end-of-turn.
      const smokedTiles = new Set((state.smokeZones ?? []).flatMap(z => z.tiles));
      let best: { tileId: string; score: number; preTurn: boolean } | null = null;
      for (const ally of allies) {
        if (smokedTiles.has(ally.tileId)) continue;
        const at = tileById.get(ally.tileId);
        if (!at) continue;
        const hpRatio = ally.hp / Math.max(1, getUnitMaxHp(ally));
        let owThreats = 0;
        let sniperThreats = 0;
        for (const e of enemies) {
          const et = tileById.get(e.tileId);
          if (!et) continue;
          const dist = getManhattanDistance(at, et);
          if (e.isOverwatching && dist <= 5) {
            owThreats++;
          } else if (e.type === 'SNIPER' && e.ammo > 0 && dist <= 8 && hpRatio <= 0.55) {
            const etTile = tileById.get(e.tileId);
            const perched = Boolean(
              etTile &&
                (etTile.type === 'MOUNTAIN' ||
                  etTile.type === 'DUNES' ||
                  (etTile.type === 'BUILDING' && etTile.owner === e.owner)),
            );
            if (perched) sniperThreats++;
          }
        }
        if (owThreats === 0 && sniperThreats === 0) continue;
        // Pre-turn smoke only to mask an enemy Overwatcher directly (never blind our own ready shooter on its own tile)
        const preTurn = owThreats > 0 && !ally.completed;
        const targetTileId = preTurn
          ? (enemies.find(e => {
              const et = tileById.get(e.tileId);
              return e.isOverwatching && et && getManhattanDistance(at, et) <= 5;
            })?.tileId ?? ally.tileId)
          : ally.tileId;
        const sc = 22 + owThreats * 16 + sniperThreats * 14 + (hpRatio <= 0.45 ? 8 : 0);
        if (!best || sc > best.score) best = { tileId: targetTileId, score: sc, preTurn };
      }
      if (!best) return null;
      return {
        itemKey,
        target: { tileId: best.tileId },
        score: best.score + freeBonus - costDrag,
        cost,
        preTurnReady: best.preTurn,
      };
    }

    case 'RADAR_SWEEP': {
      if (!state.settings.fogOfWar) return null;
      if ((state.radarRound?.[seat] ?? 0) >= round) return null;
      const totalEnemies = state.units.filter(u => u.owner !== seat).length;
      const hiddenCount = Math.max(0, totalEnemies - enemies.length);
      if (hiddenCount === 0) return null;
      // Paid Radar only fires when blind (≤1 visible enemy and ≥2 hidden), so it doesn't spam when already in combat.
      if (!isFree && (enemies.length > 1 || hiddenCount < 2)) return null;
      const readyAllies = allies.some(u => !u.completed);
      const raw = 24 + Math.min(24, hiddenCount * 7) + (enemies.length === 0 ? 10 : 0) + (readyAllies ? 6 : 0);
      return {
        itemKey,
        target: {},
        score: raw + freeBonus - costDrag,
        cost,
        preTurnReady: readyAllies,
      };
    }

    case 'PRECISION_STRIKE': {
      const eligible = enemies.filter(e => e.hp > TACTICAL_MIN_HP_FLOOR);
      if (eligible.length === 0) return null;
      let best: { unit: Unit; score: number } | null = null;
      for (const e of eligible) {
        const { dealt } = computeTacticalPercentDamage(e, TACTICAL_DAMAGE_PCT.PRECISION_STRIKE);
        if (dealt <= 0) continue;
        const et = tileById.get(e.tileId);
        const perched = Boolean(
          e.type === 'SNIPER' &&
            et &&
            (et.type === 'MOUNTAIN' || (et.type === 'BUILDING' && et.subType === 'WATCHTOWER')),
        );
        let sc = dealt * 2.25;
        if (e.type === 'SNIPER') sc += perched ? 14 : 9;
        if ((e.rank ?? 0) >= 2) sc += 7;
        if (e.type === 'ASSAULTER' && e.hp >= 20) sc += 4;
        if (!best || sc > best.score) best = { unit: e, score: sc };
      }
      if (!best) return null;
      return {
        itemKey,
        target: { tileId: best.unit.tileId },
        score: best.score + freeBonus - costDrag,
        cost,
        preTurnReady: best.unit.hp >= 18,
      };
    }

    case 'SABOTAGE': {
      const structures = state.mapData.filter(
        tile =>
          tile.type === 'BUILDING' &&
          tile.owner !== null &&
          tile.owner !== undefined &&
          tile.owner !== seat &&
          tile.subType !== undefined &&
          tile.subType !== 'NONE' &&
          (!visible || visible.has(tile.id)),
      );
      let bestTile: Tile | null = null;
      let bestScore = 0;
      for (const s of structures) {
        const sc = s.subType === 'WATCHTOWER' ? 48 : 40;
        if (sc > bestScore) {
          bestScore = sc;
          bestTile = s;
        }
      }
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
      if (enemyHqs[0]) {
        const enemyCp = state.playerCp[enemyHqs[0].owner!] ?? 0;
        const hqScore = 24 + Math.min(22, Math.max(0, enemyCp - 8) * 2.2);
        if (hqScore > bestScore) {
          bestScore = hqScore;
          bestTile = enemyHqs[0];
        }
      }
      if (!bestTile) return null;
      return {
        itemKey,
        target: { tileId: bestTile.id },
        score: bestScore + freeBonus - costDrag,
        cost,
        preTurnReady: bestScore >= 40,
      };
    }

    case 'NAPALM_LINE': {
      const res = evaluateLineCandidate(state, seat, 'NAPALM_LINE', enemies, visible, tileById);
      if (!res) return null;
      return {
        itemKey,
        target: res.target,
        score: res.score + freeBonus - costDrag,
        cost,
        preTurnReady: res.score >= 38,
      };
    }

    case 'PARADROP': {
      // 1. Pluck a perched enemy Sniper off a Watchtower/Mountain onto exposed open ground.
      const perchedEnemy = enemies.find(e => {
        const t = tileById.get(e.tileId);
        return t && (t.type === 'MOUNTAIN' || (t.type === 'BUILDING' && t.subType === 'WATCHTOWER'));
      });
      if (perchedEnemy) {
        const dests = legalParadropDestinations(state, seat, perchedEnemy.id, visible);
        const exposed = dests.find(id => tileById.get(id)?.type === 'SAND') ?? dests[0];
        if (exposed) {
          return {
            itemKey,
            target: { unitId: perchedEnemy.id, tileId: exposed },
            score: 54 + freeBonus - costDrag,
            cost,
            preTurnReady: true,
          };
        }
      }
      // 2. Airlift a ready healthy ally (Breacher/Scout) far from the front into flank range.
      const candidates = allies
        .filter(u => !u.completed && u.ammo >= 2 && u.hp >= 10)
        .sort((a, b) => (b.type === 'ASSAULTER' ? 1 : 0) - (a.type === 'ASSAULTER' ? 1 : 0));
      const ownUnit = candidates[0];
      if (!ownUnit || enemies.length === 0) return null;
      const ownTile = tileById.get(ownUnit.tileId);
      if (!ownTile) return null;
      const nearestDist = Math.min(
        ...enemies.map(e => {
          const et = tileById.get(e.tileId);
          return et ? getManhattanDistance(ownTile, et) : 99;
        }),
      );
      if (nearestDist <= 5 && !hasVoucher) return null;
      const legalDestSet = new Set(legalParadropDestinations(state, seat, ownUnit.id, visible));
      for (const enemy of enemies) {
        const et = tileById.get(enemy.tileId);
        if (!et) continue;
        for (const nb of getNeighbors(et, state.mapData, state.gridSize)) {
          if (legalDestSet.has(nb.id)) {
            return {
              itemKey,
              target: { unitId: ownUnit.id, tileId: nb.id },
              score: 46 + freeBonus - costDrag,
              cost,
              preTurnReady: true,
            };
          }
        }
      }
      return null;
    }

    case 'CARPET_RUN': {
      const eligible = enemies
        .filter(e => e.hp > TACTICAL_MIN_HP_FLOOR)
        .map(e => ({ unit: e, dealt: computeTacticalPercentDamage(e, TACTICAL_DAMAGE_PCT.CARPET_RUN).dealt }))
        .filter(x => x.dealt > 0)
        .sort((a, b) => b.dealt - a.dealt);
      if (eligible.length < (hasVoucher ? 1 : 2)) return null;
      const picked = eligible.slice(0, 3);
      const totalDealt = picked.reduce((s, x) => s + x.dealt, 0);
      const raw = totalDealt * 2.8 + picked.length * 9;
      return {
        itemKey,
        target: { tileId: picked[0].unit.tileId, tileIds: picked.map(x => x.unit.tileId) },
        score: raw + freeBonus - costDrag,
        cost,
        preTurnReady: true,
      };
    }

    case 'ARTILLERY_BARRAGE': {
      const res = evaluateLineCandidate(state, seat, 'ARTILLERY_BARRAGE', enemies, visible, tileById);
      if (!res) return null;
      return {
        itemKey,
        target: res.target,
        score: res.score + freeBonus - costDrag,
        cost,
        preTurnReady: true,
      };
    }

    case 'OVERCLOCK_CORE': {
      if ((state.overclockCharges?.[seat] ?? 0) > 0) return null;
      const cp = state.playerCp[seat] ?? 0;
      if (cp >= 24) return null;
      const readyAttackers = allies.filter(u => !u.completed && u.ammo > 0);
      if (readyAttackers.length === 0) return null;
      const enemyInReach = readyAttackers.some(a => {
        const at = tileById.get(a.tileId);
        if (!at) return false;
        return enemies.some(e => {
          const et = tileById.get(e.tileId);
          return et ? getManhattanDistance(at, et) <= 9 : false;
        });
      });
      if (!enemyInReach && !hasVoucher) return null;
      const raw = 38 + Math.min(24, readyAttackers.length * 10) + (cp <= 15 ? 8 : 0);
      return {
        itemKey,
        target: {},
        score: raw + freeBonus - costDrag,
        cost,
        preTurnReady: true,
      };
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

  const allies = state.units.filter(u => u.owner === seat);
  const hasReadyUnit = allies.some(u => !u.completed);
  const endOfTurnPhase = !hasReadyUnit || (state.playerCp[seat] ?? 0) < 5;

  const gold = state.playerGold[seat] ?? 0;
  const visible = state.settings.fogOfWar ? visibleSet(state, seat) : null;
  const enemies = visibleEnemies(state, seat, visible);
  const tileById = new Map(state.mapData.map(t => [t.id, t]));

  const hasCriticalAlly = allies.some(u => u.hp <= getUnitMaxHp(u) * 0.45);

  let best: ScoredCandidate | null = null;
  let bestAdjustedScore = -Infinity;

  for (const itemKey of TACTICAL_IDS) {
    const cost = priceOf(state, seat, itemKey);
    if (cost > gold) continue;

    const candidate = evaluateCandidate(state, seat, itemKey, enemies, allies, visible, tileById);
    if (!candidate) continue;
    if (!endOfTurnPhase && !candidate.preTurnReady && !hasTacticalVoucher(state, seat, itemKey)) {
      continue;
    }
    if (tacticalBlocker(state, seat, itemKey, { ...candidate.target, visible })) continue;

    let adjusted = candidate.score;
    if (hasCriticalAlly && cost > 0 && gold - cost < 100) {
      adjusted -= 10;
    }

    // Round-aware saving discipline: don't burn gold on marginal Commons right before R5 Rares or R10 Epics.
    if (cost > 0) {
      let minThreshold = 30;
      if (round >= 3 && round <= 4 && gold < 200) {
        minThreshold = 34; // Save toward R5 Rares unless strong play
      } else if (round >= 9 && gold < 275 && cost < 200) {
        minThreshold = 42; // Save toward R10 Epics unless high-impact Rare
      }
      if (adjusted < minThreshold) continue;
    }

    const jittered = adjusted * deterministicFactor(round, seat, itemKey, state.units.length);
    if (jittered > bestAdjustedScore) {
      bestAdjustedScore = jittered;
      best = candidate;
    }
  }

  return best ? { type: 'USE_TACTICAL', itemKey: best.itemKey, ...best.target } : null;
};
