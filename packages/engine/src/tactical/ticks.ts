/**
 * Delayed tactical effects: telegraphed strikes resolve on the caster's next turn, while
 * napalm, smoke and drones tick at the round boundary. Kept out of apply.ts so the round
 * bookkeeping is testable on its own.
 */
import type {
  BurningLine,
  LogEntry,
  PendingTactical,
  SmokeZone,
  TacticalId,
  TacticalSensor,
  Tile,
  Unit,
} from '../types';
import { computeTacticalPercentDamage, TACTICAL_DAMAGE_PCT, TACTICAL_ITEMS } from './catalog';
import type { TacticalFxSink } from './resolve';

const NAPALM_BURN_PCT_POINTS = TACTICAL_DAMAGE_PCT.NAPALM_BURN_PCT_POINTS;
const NAPALM_CAP_PCT_POINTS = TACTICAL_DAMAGE_PCT.NAPALM_CAP_PCT_POINTS;

const parseTilePoint = (tileId: string): Pick<Tile, 'x' | 'y'> | null => {
  const parts = tileId.split(',');
  if (parts.length !== 2) return null;
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
};

export interface TacticalTickContext {
  units: Unit[];
  damageUnit: (unitId: string, damage: number, label: string, sourceOwner?: number, itemKey?: TacticalId) => void;
  damageBarrier: (tileId: string, damage: number) => void;
  log: (message: string, type?: LogEntry['type']) => void;
  fx: TacticalFxSink;
}

/** All strikes owned by `owner` land at once, at the start of their next turn. */
export const resolveDueTacticals = (
  pending: PendingTactical[],
  owner: number,
  ctx: TacticalTickContext,
): { remaining: PendingTactical[]; resolved: number } => {
  const due = pending.filter(p => p.owner === owner);
  if (due.length === 0) return { remaining: pending, resolved: 0 };

  for (const strike of due) {
    const tileSet = new Set(strike.tiles);
    const victimIds = ctx.units.filter(u => tileSet.has(u.tileId)).map(u => u.id);
    const pts = strike.tiles.map(parseTilePoint).filter((p): p is Pick<Tile, 'x' | 'y'> => Boolean(p));
    if (pts.length > 0) {
      ctx.fx.tacticalFx?.({
        itemKey: strike.itemKey,
        phase: 'RESOLVE',
        owner: strike.owner,
        anchor: pts[0],
        tiles: pts,
        axis: strike.axis,
        width: strike.width,
        meta: { hitsCount: victimIds.length },
      });
    }
    for (const id of victimIds) {
      ctx.damageUnit(id, strike.damage, TACTICAL_ITEMS[strike.itemKey].name, strike.owner, strike.itemKey);
    }
    for (const tileId of strike.tiles) ctx.damageBarrier(tileId, strike.damage);
    ctx.log(
      `${TACTICAL_ITEMS[strike.itemKey].name} landed — ${victimIds.length} unit${victimIds.length === 1 ? '' : 's'} hit.`,
      'COMBAT',
    );
    ctx.fx.sound('explosion');
  }

  return { remaining: pending.filter(p => p.owner !== owner), resolved: due.length };
};

/** The line that can still burn this unit for the highest % (hits stores cumulative % points, cap 60%). */
const bestLineFor = (
  lines: BurningLine[],
  unitId: string,
  allowedIndices?: ReadonlySet<number>,
): { index: number; pctPoints: number } | null => {
  let best: { index: number; pctPoints: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (allowedIndices && !allowedIndices.has(i)) continue;
    const spent = lines[i].hits[unitId] ?? 0;
    const pctPoints = Math.min(NAPALM_BURN_PCT_POINTS, NAPALM_CAP_PCT_POINTS - spent);
    if (pctPoints <= 0) continue;
    if (!best || pctPoints > best.pctPoints) best = { index: i, pctPoints };
  }
  return best;
};

/** A unit that walks onto or through a burning line takes 20% current HP (min 2 HP), capped at 60% per line. */
export const applyNapalmEntry = (
  lines: BurningLine[],
  unitId: string,
  walkedTileIds: readonly string[],
  ctx: TacticalTickContext,
): BurningLine[] => {
  if (lines.length === 0 || walkedTileIds.length === 0) return lines;
  const touchedIndices = new Set<number>();
  let touchedTileId: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const hitId = walkedTileIds.find(id => lines[i].tiles.includes(id));
    if (hitId) {
      touchedIndices.add(i);
      if (!touchedTileId) touchedTileId = hitId;
    }
  }
  if (touchedIndices.size === 0) return lines;

  const best = bestLineFor(lines, unitId, touchedIndices);
  if (!best) return lines;

  const victim = ctx.units.find(u => u.id === unitId);
  if (!victim) return lines;
  const { dealt } = computeTacticalPercentDamage(victim, best.pctPoints / 100);
  if (dealt <= 0) return lines;

  const line = lines[best.index];
  const next = lines.map((item, i) =>
    i === best.index
      ? { ...item, hits: { ...item.hits, [unitId]: (item.hits[unitId] ?? 0) + best.pctPoints } }
      : item,
  );
  const burnPt = parseTilePoint(victim.tileId ?? touchedTileId ?? line.tiles[0]);
  if (burnPt) {
    ctx.fx.tacticalFx?.({
      itemKey: 'NAPALM_LINE',
      phase: 'BURN',
      owner: line.owner,
      anchor: burnPt,
      tiles: [burnPt],
    });
  }
  ctx.damageUnit(unitId, dealt, 'Napalm', line.owner, 'NAPALM_LINE');
  return next;
};

export interface TacticalRoundTick {
  burning: BurningLine[];
  smoke: SmokeZone[];
  sensors: TacticalSensor[];
}

/**
 * Round-end tick. Napalm burns whoever is standing in it (20% current HP, capped at 60% per line,
 * strict 2 HP non-lethal floor), smoke and drones lose a round, and a drone dies if stepped on.
 */
export const tickTacticalRoundEnd = (
  burning: BurningLine[],
  smoke: SmokeZone[],
  sensors: TacticalSensor[],
  ctx: TacticalTickContext,
): TacticalRoundTick => {
  const nextBurning = burning.map(line => {
    const standing = ctx.units.filter(u => line.tiles.includes(u.tileId));
    for (const unit of standing) {
      const best = bestLineFor([line], unit.id);
      if (!best) continue;
      const { dealt } = computeTacticalPercentDamage(unit, best.pctPoints / 100);
      if (dealt <= 0) continue;
      const burnPt = parseTilePoint(unit.tileId);
      if (burnPt) {
        ctx.fx.tacticalFx?.({
          itemKey: 'NAPALM_LINE',
          phase: 'BURN',
          owner: line.owner,
          anchor: burnPt,
          tiles: [burnPt],
        });
      }
      ctx.damageUnit(unit.id, dealt, 'Napalm', line.owner, 'NAPALM_LINE');
      line = {
        ...line,
        hits: { ...line.hits, [unit.id]: (line.hits[unit.id] ?? 0) + best.pctPoints },
      };
    }
    return { ...line, roundsLeft: line.roundsLeft - 1 };
  }).filter(line => line.roundsLeft > 0);

  return {
    burning: nextBurning,
    smoke: smoke.map(zone => ({ ...zone, roundsLeft: zone.roundsLeft - 1 })).filter(zone => zone.roundsLeft > 0),
    sensors: sensors
      .filter(sensor => !ctx.units.some(unit => unit.tileId === sensor.tileId && unit.owner !== sensor.owner))
      .map(sensor => ({ ...sensor, roundsLeft: sensor.roundsLeft - 1 }))
      .filter(sensor => sensor.roundsLeft > 0),
  };
};
