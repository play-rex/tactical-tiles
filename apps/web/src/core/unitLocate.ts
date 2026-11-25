/**
 * "Look here" pings from the squad HUD to the board. Kept outside the game store: a ping is a
 * transient UI cue, not match state, so it must never travel through snapshots or replays.
 */
export interface UnitLocatePing {
  id: number;
  tileId: string;
  owner: number;
}

type Listener = (ping: UnitLocatePing) => void;

let seq = 0;
const listeners = new Set<Listener>();

/** Point the board at one unit's tile. Every mounted ping layer plays the same pulse. */
export const pingUnitLocation = (tileId: string, owner: number): UnitLocatePing => {
  const ping = { id: ++seq, tileId, owner };
  for (const listener of [...listeners]) listener(ping);
  return ping;
};

export const subscribeUnitLocate = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
