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
  const game: GameState = {
    ...state,
    pendingDrops: state.pendingDrops.filter(d => d.playerId === seat),
    mines: (state.mines ?? []).filter(m => m.owner === seat),
    bankRewardPending: state.bankRewardPending?.playerId === seat ? state.bankRewardPending : null,
    // Hidden traps are visible only to the player who placed them even when Fog of War is off.
    gameLog: state.gameLog.filter(l => l.playerId === seat || !l.message.startsWith('Planted Land Mine')),
  };
  if (fog) {
    game.units = state.units.filter(u => u.owner === seat || visible.has(u.tileId));
    // Move logs name the destination tile and build logs name construction coordinates: hide/redact under fog.
    game.gameLog = game.gameLog
      .filter(l => l.type !== 'MOVE' || l.playerId === seat)
      .map(l =>
        l.playerId !== seat && l.type === 'ECONOMY' && l.message.startsWith('Built ')
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
export function eventsFor(events: GameEvent[], fog: boolean, before: Set<string>, after: Set<string>): GameEvent[] {
  if (!fog) return events;
  const seen = (p: { x: number; y: number }) => before.has(`${p.x},${p.y}`) || after.has(`${p.x},${p.y}`);
  const out: GameEvent[] = [];
  for (const e of events) {
    switch (e.kind) {
      case 'sound':
        out.push(e);
        break;
      case 'shake':
        if (!e.at || seen(e.at)) out.push(e);
        break;
      case 'projectile':
        if (seen(e.from) || seen(e.to)) out.push(e);
        break;
      case 'popup':
      case 'killed':
      case 'mineBlast':
      case 'structureHit':
      case 'heist':
      case 'promotion':
      case 'overwatchSet':
      case 'heal':
      case 'supplyLanded':
        if (seen(e.at)) out.push(e);
        break;
      case 'hit':
        if (seen(e.at)) {
          const visibleCrossfire = e.crossfireFrom?.filter(seen);
          out.push({
            ...e,
            from: e.from && seen(e.from) ? e.from : undefined,
            crossfireFrom: visibleCrossfire && visibleCrossfire.length > 0 ? visibleCrossfire : undefined,
          });
        }
        break;
      case 'movePath': {
        // Trim strictly to visible tiles so hidden enemy origin/intermediate tiles never leak under fog.
        const visiblePath = e.path.filter(seen);
        if (visiblePath.length >= 2) {
          out.push({ ...e, path: visiblePath, haltedAt: undefined });
        }
        break;
      }
      case 'build': {
        const visibleTiles = e.tiles.filter(seen);
        if (visibleTiles.length > 0) {
          out.push({ ...e, tiles: visibleTiles });
        }
        break;
      }
    }
  }
  return out;
}
