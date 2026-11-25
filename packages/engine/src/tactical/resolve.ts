/**
 * What each tactical weapon does when bought. Every weapon resolves immediately on purchase
 * through this single context, keeping local play, multiplayer server, and bots in lockstep.
 */
import type { GameState, SoundName, TilePoint } from '../game/state';
import { computeTacticalPercentDamage, TACTICAL_DAMAGE_PCT } from './catalog';
import type {
  BurningLine,
  LogEntry,
  PendingTactical,
  SmokeZone,
  TacticalAxis,
  TacticalFxPhase,
  TacticalId,
  TacticalSensor,
  Tile,
  UnitType,
} from '../types';

export interface TacticalFxEventInput {
  itemKey: TacticalId;
  phase: TacticalFxPhase;
  owner: number;
  anchor: Pick<Tile, 'x' | 'y'>;
  tiles: Pick<Tile, 'x' | 'y'>[];
  pings?: Pick<Tile, 'x' | 'y'>[];
  axis?: TacticalAxis;
  width?: 1 | 2;
  meta?: {
    sabotageKind?: 'CP' | 'STRIP';
    cpDrained?: number;
    victimOwner?: number;
    hitsCount?: number;
    from?: TilePoint;
    unitType?: UnitType;
  };
}

export interface TacticalFxSink {
  sound: (sound: SoundName) => void;
  popup: (at: Tile, text: string, color: string, lift: number) => void;
  shake: (intensity: number, at?: Tile) => void;
  tacticalFx?: (input: TacticalFxEventInput) => void;
}

export interface TacticalResolveContext {
  state: GameState;
  seat: number;
  round: number;
  itemKey: TacticalId;
  /** Tiles the weapon touches; empty for self-buffs. */
  tiles: Tile[];
  /** Selected unit ID for Paradrop airlift relocation. */
  unitId?: string;
  axis?: TacticalAxis;
  width?: 1 | 2;
  fx: TacticalFxSink;
  log: (message: string, type?: LogEntry['type']) => void;
  revealTraps: (round: number) => void;
  radar: (round: number) => void;
  addPending: (pending: PendingTactical) => void;
  addBurning: (line: BurningLine) => void;
  addSmoke: (zone: SmokeZone) => void;
  addSensor: (sensor: TacticalSensor) => void;
  grantOverclock: (charges: number) => void;
  stripStructure: (tileId: string) => void;
  drainCp: (owner: number, amount: number) => void;
  damageUnit: (unitId: string, damage: number, label: string, sourceOwner?: number, itemKey?: TacticalId) => void;
  damageBarrier: (tileId: string, damage: number) => void;
  relocateUnit: (
    unitId: string,
    destTileId: string,
  ) => { from: Tile; to: Tile; unitType: UnitType; owner: number } | null;
}

const tag = (round: number, seat: number, itemKey: TacticalId): string =>
  `tac_${itemKey}_${round}_${seat}`;

const seatOriginTile = (state: GameState, seat: number): Pick<Tile, 'x' | 'y'> => {
  const hq = state.mapData.find(t => t.type === 'BASE' && t.owner === seat);
  if (hq) return hq;
  const ownUnit = state.units.find(u => u.owner === seat);
  if (ownUnit) {
    const ut = state.mapData.find(t => t.id === ownUnit.tileId);
    if (ut) return ut;
  }
  const mid = Math.floor(state.gridSize / 2);
  return { x: mid, y: mid };
};

export const resolveTactical = (ctx: TacticalResolveContext): void => {
  const { itemKey, round, seat, tiles, fx, log, axis } = ctx;
  const anchor = tiles[0];

  switch (itemKey) {
    case 'MINEFIELD_SNAPSHOT': {
      ctx.revealTraps(round);
      const origin = seatOriginTile(ctx.state, seat);
      const minePings = (ctx.state.mines ?? [])
        .filter(m => m.owner !== seat)
        .map(m => ctx.state.mapData.find(t => t.id === m.tileId))
        .filter((t): t is Tile => Boolean(t));
      fx.tacticalFx?.({
        itemKey,
        phase: 'ACTIVATE',
        owner: seat,
        anchor: origin,
        tiles: [origin],
        pings: minePings,
        meta: { hitsCount: minePings.length },
      });
      fx.sound('click');
      log(
        minePings.length > 0
          ? `Minefield Snapshot: ${minePings.length} enemy land mine${minePings.length === 1 ? '' : 's'} revealed this round.`
          : 'Minefield Snapshot: sweep clear — no enemy mines detected.',
        'ECONOMY',
      );
      return;
    }

    case 'RECON_DRONE': {
      if (!anchor) return;
      const victim = ctx.state.units.find(u => u.tileId === anchor.id && u.owner !== seat);
      const origin = seatOriginTile(ctx.state, seat);
      fx.tacticalFx?.({
        itemKey,
        phase: 'RESOLVE',
        owner: seat,
        anchor,
        tiles: [anchor],
        meta: { from: { x: origin.x, y: origin.y }, hitsCount: victim ? 1 : 0 },
      });
      let dealt = 0;
      if (victim) {
        dealt = computeTacticalPercentDamage(victim, TACTICAL_DAMAGE_PCT.RECON_DRONE).dealt;
        if (dealt > 0) ctx.damageUnit(victim.id, dealt, 'Hunter Drone', seat, itemKey);
      }
      if (ctx.state.settings.fogOfWar && !(ctx.state.sensors ?? []).some(s => s.tileId === anchor.id && s.owner === seat)) {
        ctx.addSensor({
          id: tag(round, seat, itemKey),
          owner: seat,
          tileId: anchor.id,
          roundsLeft: 3,
        });
      }
      fx.sound('hit');
      log(
        ctx.state.settings.fogOfWar
          ? `Hunter Drone struck (${anchor.x},${anchor.y}) for ${dealt} DMG (40% HP) and deployed a 3-round sensor.`
          : `Hunter Drone struck (${anchor.x},${anchor.y}) for ${dealt} DMG (40% HP).`,
        'COMBAT',
      );
      return;
    }

    case 'SMOKE_SCREEN':
      if (!anchor) return;
      ctx.addSmoke({
        id: tag(round, seat, itemKey),
        owner: seat,
        tiles: tiles.map(t => t.id),
        roundsLeft: 2,
      });
      fx.tacticalFx?.({
        itemKey,
        phase: 'ACTIVATE',
        owner: seat,
        anchor,
        tiles,
      });
      fx.popup(anchor, 'SMOKE 3×3', '#CBD5E1', 26);
      fx.shake(4, anchor);
      fx.sound('explosion');
      log(`Smoke Screen deployed at (${anchor.x},${anchor.y}).`, 'ECONOMY');
      return;

    case 'RADAR_SWEEP': {
      ctx.radar(round);
      ctx.revealTraps(round);
      const origin = seatOriginTile(ctx.state, seat);
      const enemyPings = ctx.state.units
        .filter(u => u.owner !== seat)
        .map(u => ctx.state.mapData.find(t => t.id === u.tileId))
        .filter((t): t is Tile => Boolean(t));
      fx.tacticalFx?.({
        itemKey,
        phase: 'ACTIVATE',
        owner: seat,
        anchor: origin,
        tiles: [origin],
        pings: enemyPings,
        meta: { hitsCount: enemyPings.length },
      });
      fx.sound('click');
      log(`Radar Sweep active for P${seat + 1} — every enemy unit is visible this round.`, 'INFO');
      return;
    }

    case 'PRECISION_STRIKE': {
      if (!anchor) return;
      const victim = ctx.state.units.find(u => u.tileId === anchor.id && u.owner !== seat);
      fx.tacticalFx?.({
        itemKey,
        phase: 'RESOLVE',
        owner: seat,
        anchor,
        tiles: [anchor],
        meta: { hitsCount: victim ? 1 : 0 },
      });
      let dealt = 0;
      if (victim) {
        dealt = computeTacticalPercentDamage(victim, TACTICAL_DAMAGE_PCT.PRECISION_STRIKE).dealt;
        if (dealt > 0) ctx.damageUnit(victim.id, dealt, 'Precision Strike', seat, itemKey);
      }
      fx.sound('explosion');
      log(`Precision Strike hit (${anchor.x},${anchor.y}) for ${dealt} DMG (75% HP, min 2 HP).`, 'COMBAT');
      return;
    }

    case 'CARPET_RUN': {
      if (tiles.length === 0 || !anchor) return;
      const targets = tiles
        .map(t => ctx.state.units.find(u => u.tileId === t.id && u.owner !== seat))
        .filter((u): u is NonNullable<typeof u> => Boolean(u));
      fx.tacticalFx?.({
        itemKey,
        phase: 'RESOLVE',
        owner: seat,
        anchor: tiles[0],
        tiles,
        meta: { hitsCount: targets.length },
      });
      for (const victim of targets) {
        const { dealt } = computeTacticalPercentDamage(victim, TACTICAL_DAMAGE_PCT.CARPET_RUN);
        if (dealt > 0) ctx.damageUnit(victim.id, dealt, 'Carpet Run', seat, itemKey);
      }
      fx.sound('explosion');
      log(
        `Carpet Run struck ${targets.length} target${targets.length === 1 ? '' : 's'} for 50% HP each (min 2 HP).`,
        'COMBAT',
      );
      return;
    }

    case 'ARTILLERY_BARRAGE': {
      if (tiles.length === 0 || !anchor) return;
      const tileSet = new Set(tiles.map(t => t.id));
      const victims = ctx.state.units.filter(u => tileSet.has(u.tileId));
      fx.tacticalFx?.({
        itemKey,
        phase: 'RESOLVE',
        owner: seat,
        anchor,
        tiles,
        axis: axis ?? 'H',
        width: 2,
        meta: { hitsCount: victims.length },
      });
      for (const victim of victims) {
        const { dealt } = computeTacticalPercentDamage(victim, TACTICAL_DAMAGE_PCT.ARTILLERY_BARRAGE);
        if (dealt > 0) ctx.damageUnit(victim.id, dealt, 'Artillery Barrage', seat, itemKey);
      }
      for (const t of tiles) {
        ctx.damageBarrier(t.id, 10);
      }
      fx.sound('explosion');
      log(
        `Artillery Barrage (2×10) struck ${victims.length} unit${victims.length === 1 ? '' : 's'} for 50% HP (min 2 HP).`,
        'COMBAT',
      );
      return;
    }

    case 'NAPALM_LINE': {
      if (tiles.length === 0 || !anchor) return;
      const tileIds = tiles.map(t => t.id);
      const tileSet = new Set(tileIds);
      const standingUnits = ctx.state.units.filter(u => tileSet.has(u.tileId));
      const initialHits: Record<string, number> = {};
      for (const u of standingUnits) {
        initialHits[u.id] = TACTICAL_DAMAGE_PCT.NAPALM_DROP_PCT_POINTS;
      }
      ctx.addBurning({
        id: tag(round, seat, itemKey),
        owner: seat,
        tiles: tileIds,
        roundsLeft: 2,
        hits: initialHits,
        axis: axis ?? 'H',
      });
      fx.tacticalFx?.({
        itemKey,
        phase: 'ACTIVATE',
        owner: seat,
        anchor,
        tiles,
        axis: axis ?? 'H',
        meta: { hitsCount: standingUnits.length },
      });
      for (const u of standingUnits) {
        const { dealt } = computeTacticalPercentDamage(u, TACTICAL_DAMAGE_PCT.NAPALM_DROP);
        if (dealt > 0) ctx.damageUnit(u.id, dealt, 'Napalm', seat, itemKey);
      }
      fx.popup(anchor, 'NAPALM LINE', '#F97316', 28);
      fx.shake(7, anchor);
      fx.sound('explosion');
      log(
        standingUnits.length > 0
          ? `Napalm Line scorched ${standingUnits.length} unit${standingUnits.length === 1 ? '' : 's'} (40% HP, min 2 HP) and burns for 2 rounds.`
          : `Napalm Line burning (${tiles.length} tiles) for 2 rounds.`,
        'COMBAT',
      );
      return;
    }

    case 'SABOTAGE': {
      if (!anchor) return;
      const enemyStructure =
        anchor.type === 'BUILDING' &&
        anchor.owner !== null &&
        anchor.owner !== undefined &&
        anchor.owner !== seat &&
        anchor.subType !== undefined &&
        anchor.subType !== 'NONE';
      if (enemyStructure) {
        ctx.stripStructure(anchor.id);
        fx.tacticalFx?.({
          itemKey,
          phase: 'ACTIVATE',
          owner: seat,
          anchor,
          tiles: [anchor],
          meta: { sabotageKind: 'STRIP', victimOwner: anchor.owner ?? undefined },
        });
        fx.popup(anchor, 'STRIPPED!', '#C084FC', 28);
        fx.shake(7, anchor);
        fx.sound('explosion');
        log(`Sabotage: stripped the specialization at (${anchor.x},${anchor.y}).`, 'ECONOMY');
        return;
      }
      const enemyHq =
        anchor.type === 'BASE' &&
        anchor.owner !== null &&
        anchor.owner !== undefined &&
        anchor.owner !== seat &&
        (anchor.hp ?? 1) > 0 &&
        ctx.state.playerStatus?.[anchor.owner] !== 'ELIMINATED';
      if (enemyHq) {
        const victimOwner = anchor.owner!;
        const beforeCp = ctx.state.playerCp[victimOwner] ?? 0;
        const drained = Math.min(8, beforeCp);
        ctx.drainCp(victimOwner, 8);
        fx.tacticalFx?.({
          itemKey,
          phase: 'ACTIVATE',
          owner: seat,
          anchor,
          tiles: [anchor],
          meta: { sabotageKind: 'CP', cpDrained: drained, victimOwner },
        });
        fx.popup(anchor, `-${drained} CP`, '#C084FC', 28);
        fx.shake(6, anchor);
        fx.sound('explosion');
        log(`Sabotage: drained ${drained} CP from P${victimOwner + 1} HQ.`, 'ECONOMY');
      }
      return;
    }

    case 'PARADROP': {
      if (!anchor || !ctx.unitId) return;
      const moved = ctx.relocateUnit(ctx.unitId, anchor.id);
      if (moved) {
        fx.tacticalFx?.({
          itemKey,
          phase: 'ACTIVATE',
          owner: seat,
          anchor: moved.to,
          tiles: [moved.from, moved.to],
          meta: {
            from: { x: moved.from.x, y: moved.from.y },
            victimOwner: moved.owner,
            unitType: moved.unitType,
          },
        });
        fx.popup(moved.to, moved.owner === seat ? 'AIRLIFTED!' : 'RELOCATED!', '#34D399', 30);
        fx.shake(4, moved.to);
        fx.sound('capture');
        log(
          moved.owner === seat
            ? `Paradrop: airlifted unit to (${moved.to.x},${moved.to.y}).`
            : `Paradrop: extracted P${moved.owner + 1} unit to (${moved.to.x},${moved.to.y}).`,
          'ECONOMY',
        );
      }
      return;
    }

    case 'OVERCLOCK_CORE': {
      ctx.grantOverclock(3);
      const origin = seatOriginTile(ctx.state, seat);
      const squadPings = ctx.state.units
        .filter(u => u.owner === seat)
        .map(u => ctx.state.mapData.find(t => t.id === u.tileId))
        .filter((t): t is Tile => Boolean(t));
      fx.tacticalFx?.({
        itemKey,
        phase: 'ACTIVATE',
        owner: seat,
        anchor: origin,
        tiles: [origin],
        pings: squadPings,
        meta: { hitsCount: 3 },
      });
      const popAt = squadPings[0] ?? ctx.state.mapData.find(t => t.x === origin.x && t.y === origin.y);
      if (popAt) fx.popup(popAt, 'OVERCLOCK ×3', '#FACC15', 30);
      fx.shake(3);
      fx.sound('click');
      log('Overclock Core online: the next three attacks refund 2 CP each.', 'ECONOMY');
      return;
    }

    default:
      return;
  }
};
