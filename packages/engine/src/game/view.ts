/**
 * What one player is allowed to know. With fog of war on, enemy units outside their sight,
 * where enemy moves went and effects they couldn't have seen are left out. Other players'
 * private choices (supplies on the way, an unclaimed vault) are never shared.
 */
import { visibleSet } from './options';
import type { GameEvent, GameState } from './state';

export interface PlayerGameView {
  game: GameState;
  /** Tile ids this player can see. Empty when fog of war is off: then everything is visible. */
  visibleTiles: string[];
}

/** `visible` is the seat's sight (visibleSet), when the caller has already worked it out. */
export function viewFor(state: GameState, seat: number, visible = visibleSet(state, seat)): PlayerGameView {
  const fog = state.settings.fogOfWar;
  const revealTraps = (state.trapRevealRound?.[seat] ?? 0) >= state.totalTurns + 1;
  const game: GameState = {
    ...state,
    pendingDrops: state.pendingDrops.filter(d => d.playerId === seat),
    // Free crate vouchers stay private so enemies cannot peek what surprise item you pulled.
    playerShopVouchers: { [seat]: [...(state.playerShopVouchers?.[seat] ?? [])] },
    playerTacticalVouchers: { [seat]: [...(state.playerTacticalVouchers?.[seat] ?? [])] },
    // Minefield Snapshot and Radar Sweep expose enemy traps to their buyer for one round.
    mines: (state.mines ?? []).filter(m => revealTraps || m.owner === seat),
    // Active drone sensors are public so enemies can hunt and step on them (Director Plan §8.5a).
    sensors: state.sensors ?? [],
    bankRewardPending: state.bankRewardPending?.playerId === seat ? state.bankRewardPending : null,
    // Hidden traps and private Minefield Snapshots stay visible only to the buyer.
    // Surprise crate contents stay private to the looter!
    gameLog: state.gameLog
      .filter(
        l =>
          l.playerId === seat ||
          (!l.message.startsWith('Planted Land Mine') && !l.message.startsWith('Minefield Snapshot')),
      )
      .map(l =>
        l.playerId !== seat &&
        (l.message.startsWith('Field Supply Crate:') || l.message.startsWith('Tactical Supply Crate:'))
          ? {
              ...l,
              message: l.message.startsWith('Tactical Supply Crate:')
                ? 'Claimed a Tactical Supply Crate'
                : 'Claimed a Field Supply Crate',
            }
          : l,
      ),
  };
  if (fog) {
    game.units = state.units.filter(u => u.owner === seat || visible.has(u.tileId));
    // Move logs name the destination tile and build/paradrop logs name coordinates: hide/redact under fog.
    game.gameLog = game.gameLog
      .filter(l => l.type !== 'MOVE' || l.playerId === seat)
      .map(l =>
        l.playerId !== seat &&
        l.type === 'ECONOMY' &&
        (l.message.startsWith('Built ') || l.message.startsWith('Paradrop:'))
          ? { ...l, message: l.message.replace(/ at .+$/, '') }
          : l
      );
  }
  return { game, visibleTiles: [...visible] };
}

/**
 * The effects of an action a player gets to see: anything that starts or lands on a tile
 * they could see before or after it. Sounds always play, as they do at a shared screen.
 */
export function eventsFor(
  events: GameEvent[],
  fog: boolean,
  before: Set<string>,
  after: Set<string>,
  seat?: number,
): GameEvent[] {
  const seen = (p: { x: number; y: number }) => !fog || before.has(`${p.x},${p.y}`) || after.has(`${p.x},${p.y}`);
  if (!fog && seat === undefined) return events;
  const visibleHitOrigins = new Set<string>();
  for (const e of events) {
    if (e.kind === 'hit' && e.targetUnitId && e.from && seen(e.from)) {
      visibleHitOrigins.add(e.targetUnitId);
    }
  }
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'sound':
        out.push(e);
        break;
      case 'shake':
        if (!fog || !e.at || seen(e.at)) out.push(e);
        break;
      case 'projectile':
        if (!fog || seen(e.from) || seen(e.to)) out.push(e);
        break;
      case 'killed':
        if (!fog || seen(e.at)) {
          const originSeen = !fog || visibleHitOrigins.has(e.unitId);
          out.push(
            originSeen
              ? e
              : {
                  ...e,
                  killerUnitId: undefined,
                  killerUnitType: undefined,
                },
          );
        }
        break;
      case 'popup':
      case 'mineBlast':
      case 'structureHit':
      case 'heist':
      case 'capture':
      case 'spawn':
      case 'promotion':
      case 'overwatchSet':
      case 'heal':
      case 'supplyLanded':
        if (!fog || seen(e.at)) out.push(e);
        break;
      case 'airDrop':
        // Theater air supply planes and parachutes are public sky events for every seat.
        out.push(e);
        break;
      case 'hit':
        if (!fog || seen(e.at)) {
          const originSeen = !fog || Boolean(e.from && seen(e.from));
          const visibleCrossfire = fog ? e.crossfireFrom?.filter(seen) : e.crossfireFrom;
          out.push({
            ...e,
            from: originSeen ? e.from : undefined,
            crossfireFrom: visibleCrossfire && visibleCrossfire.length > 0 ? visibleCrossfire : undefined,
            breakdown: e.breakdown
              ? originSeen
                ? e.breakdown
                : { ...e.breakdown, watchtowerBoosted: false }
              : undefined,
          });
        }
        break;
      case 'movePath': {
        if (!fog) {
          out.push(e);
          break;
        }
        // Trim strictly to visible tiles so hidden enemy origin/intermediate tiles never leak under fog.
        const visiblePath = e.path.filter(seen);
        if (visiblePath.length >= 2) {
          out.push({ ...e, path: visiblePath, haltedAt: undefined });
        }
        break;
      }
      case 'build': {
        if (!fog) {
          out.push(e);
          break;
        }
        const visibleTiles = e.tiles.filter(seen);
        if (visibleTiles.length > 0) {
          out.push({ ...e, tiles: visibleTiles });
        }
        break;
      }
      case 'tacticalFx': {
        const isOwner = seat === undefined || seat === e.owner;
        // Private trap reveal: buyer only, even with fog off.
        if (e.itemKey === 'MINEFIELD_SNAPSHOT') {
          if (isOwner) out.push(e);
          break;
        }
        // Radar Sweep wave is public, but enemy contact pings stay private to the caster.
        if (e.itemKey === 'RADAR_SWEEP') {
          out.push(isOwner ? e : { ...e, pings: undefined });
          break;
        }
        // Overclock Core: never leak hidden ally positions in fog.
        if (e.itemKey === 'OVERCLOCK_CORE') {
          if (!fog || isOwner) {
            out.push(e);
          } else {
            const visiblePings = e.pings?.filter(seen);
            if (seen(e.anchor) || (visiblePings && visiblePings.length > 0)) {
              out.push({ ...e, pings: visiblePings });
            }
          }
          break;
        }
        // Napalm burns on individual units must not leak unseen enemy positions under fog.
        if (e.phase === 'BURN') {
          if (!fog || seen(e.anchor)) out.push(e);
          break;
        }
        // Single-tile covert drops / sabotage obey fog visibility.
        if (e.itemKey === 'PARADROP' || e.itemKey === 'SABOTAGE') {
          if (
            !fog ||
            isOwner ||
            seat === e.meta?.victimOwner ||
            seen(e.anchor) ||
            (e.meta?.from && seen(e.meta.from))
          ) {
            out.push(e);
          }
          break;
        }
        // Public telegraphs, active fire/smoke/drone deployment, and ordnance passes over public marks.
        out.push(e);
        break;
      }
    }
  }
  return out;
}
