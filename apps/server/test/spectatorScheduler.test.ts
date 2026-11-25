import assert from 'node:assert/strict';
import test from 'node:test';
import { SpectatorScheduler, type TimerClock } from '../src/SpectatorScheduler';

/** A deterministic clock: timers fire in order as simulated time advances. */
class FakeClock implements TimerClock {
  private nextId = 1;
  private timers = new Map<number, { at: number; callback: () => void }>();
  now = 0;

  setTimeout(callback: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, callback });
    return { clear: () => { this.timers.delete(id); } };
  }

  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
    }
    this.now = target;
  }

  get pending() {
    return this.timers.size;
  }
}

test('a bot window fires exactly once per window even though every action re-arms it', () => {
  const clock = new FakeClock();
  const scheduler = new SpectatorScheduler(clock);
  const fired: string[] = [];
  const fire = (seat: number) => fired.push(`${seat}@${clock.now}`);

  scheduler.arm({ seat: 2, round: 3, usedRound: null }, fire, 800);
  clock.advance(300);
  // The ongoing bot loop calls arm() after its next action, 300ms into the window.
  scheduler.arm({ seat: 2, round: 3, usedRound: null }, fire, 800);
  assert.equal(scheduler.armedKey, '3:2');
  clock.advance(500);
  assert.deepEqual(fired, ['2@800'], 'the original window timer was not pushed back');

  // After firing, the same window never schedules another effect.
  scheduler.arm({ seat: 2, round: 3, usedRound: 3 }, fire, 800);
  clock.advance(5000);
  assert.deepEqual(fired, ['2@800']);
  assert.equal(clock.pending, 0);
});

test('a new window replaces the timer, and a different seat takes the window over', () => {
  const clock = new FakeClock();
  const scheduler = new SpectatorScheduler(clock);
  const fired: string[] = [];
  const fire = (seat: number) => fired.push(`${seat}@${clock.now}`);

  scheduler.arm({ seat: 2, round: 3, usedRound: null }, fire, 800);
  clock.advance(300);
  scheduler.arm({ seat: 3, round: 3, usedRound: null }, fire, 800);
  clock.advance(1000);
  assert.deepEqual(fired, ['3@1100'], 'only the seat that actually holds the window fires');

  scheduler.arm({ seat: 3, round: 5, usedRound: null }, fire, 800);
  clock.advance(800);
  assert.deepEqual(fired, ['3@1100', '3@2100'], 'the next window fires again');
});
