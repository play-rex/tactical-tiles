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
    bankRewardPending: state.bankRewardPending?.playerId === seat ? state.bankRewardPending : null,
  };
  if (fog) {
    game.units = state.units.filter(u => u.owner === seat || visible.has(u.tileId));
    // Move logs name the destination tile: only your own are kept.
    game.gameLog = state.gameLog.filter(l => l.type !== 'MOVE' || l.playerId === seat);
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
  return events.filter(e => {
    if (e.kind === 'projectile') return seen(e.from) || seen(e.to);
    if (e.kind === 'popup') return seen(e.at);
    return true;
  });
}
