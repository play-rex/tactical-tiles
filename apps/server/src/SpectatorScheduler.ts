/**
 * One timer per spectator window. The bot action loop calls `arm` after every action, so an
 * already-armed window must be left alone: re-arming on every action is exactly how the window
 * used to be pushed back forever. Only a new window (or a spent one) replaces the timer.
 */
export interface SpectatorWindowState {
  seat: number | null | undefined;
  round: number;
  usedRound: number | null | undefined;
}

export interface TimerClock {
  setTimeout(callback: () => void, ms: number): { clear(): void };
}

export class SpectatorScheduler {
  private pending: { clear(): void } | null = null;
  private key = '';

  constructor(private readonly clock: TimerClock) {}

  /** The window this scheduler is currently counting down, as `round:seat` ('' when idle). */
  get armedKey(): string {
    return this.key;
  }

  arm(state: SpectatorWindowState, fire: (seat: number) => void, delayMs: number): void {
    const { seat, round, usedRound } = state;
    if (seat === null || seat === undefined || usedRound === round) {
      this.cancel();
      return;
    }
    const key = `${round}:${seat}`;
    if (this.pending !== null && this.key === key) return; // same window, already counting
    this.cancel();
    this.key = key;
    this.pending = this.clock.setTimeout(() => {
      this.pending = null;
      this.key = '';
      fire(seat);
    }, delayMs);
  }

  cancel(): void {
    this.pending?.clear();
    this.pending = null;
    this.key = '';
  }
}
