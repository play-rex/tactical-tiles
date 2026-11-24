/**
 * Fog-honest "While You Were Away" Turn Recap & Play-of-the-Match sequencer (`recapPlayer`).
 *
 * Steps through missed opponent actions at 2.5× fast-forward for routine moves and drops
 * automatically to 1.0× + full Kill Cam on ambushes, heists, breaches, and kills, always
 * restoring the exact live authoritative board on completion or `SKIP`.
 */
import type { GameEvent, MissedActionBatch, Tile, Unit } from '@tactical/engine';
import { fxTimeline } from './fxTimeline';

export interface RecapStatus {
  active: boolean;
  kind: 'RECAP' | 'POTM' | null;
  step: number;
  total: number;
  fastForward: boolean;
  label: string;
}

const IDLE_STATUS: RecapStatus = {
  active: false,
  kind: null,
  step: 0,
  total: 0,
  fastForward: false,
  label: '',
};

/** Returns true when a batch deserves full 1.0× dramatic speed rather than 2.5× fast-forward. */
export const isDramaticRecapBatch = (events: GameEvent[]): boolean =>
  events.some(
    e =>
      e.kind === 'killed' ||
      e.kind === 'heist' ||
      e.kind === 'mineBlast' ||
      (e.kind === 'structureHit' && (e.destroyed || e.structureType === 'BASE' || e.structureType === 'BANK')),
  );

type StatusListener = (status: RecapStatus) => void;

export interface RecapBridge {
  applyDisplaySnapshot: (units: Unit[], mapData?: Tile[]) => void;
  restoreLiveState: () => void;
  dispatchEvents: (events: GameEvent[], postUnits?: Unit[]) => void;
}

export class RecapPlayer {
  private status: RecapStatus = IDLE_STATUS;
  private listeners = new Set<StatusListener>();
  private generation = 0;
  private activeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubKillCam: (() => void) | null = null;
  private activeBridge: RecapBridge | null = null;
  private activeOnDone: (() => void) | null = null;

  public getStatus(): RecapStatus {
    return this.status;
  }

  public isActive(): boolean {
    return this.status.active;
  }

  public subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(next: RecapStatus): void {
    this.status = next;
    this.listeners.forEach(fn => fn(next));
  }

  private cleanupWaiters(): void {
    if (this.activeTimer !== null) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.unsubKillCam) {
      this.unsubKillCam();
      this.unsubKillCam = null;
    }
  }

  /** Cancels any active recap or POTM replay and snaps cleanly back to the live board. */
  public stop(): void {
    this.generation++;
    this.cleanupWaiters();
    fxTimeline.setPlaybackSpeed(1);
    fxTimeline.setReplayMode(false);
    fxTimeline.clear();
    const bridge = this.activeBridge;
    const done = this.activeOnDone;
    this.activeBridge = null;
    this.activeOnDone = null;
    if (this.status.active) {
      this.setStatus(IDLE_STATUS);
    }
    bridge?.restoreLiveState();
    done?.();
  }

  /** Plays back missed opponent actions (2.5× routine moves, 1.0× dramatic kills/ambushes). */
  public startMissedRecap(batches: MissedActionBatch[], bridge: RecapBridge, onDone?: () => void): void {
    if (!batches || batches.length === 0) {
      onDone?.();
      return;
    }
    this.stop();
    const gen = ++this.generation;
    this.activeBridge = bridge;
    this.activeOnDone = onDone ?? null;

    const runIndex = (idx: number) => {
      if (gen !== this.generation) return;
      if (idx >= batches.length) {
        this.finish(gen);
        return;
      }

      const batch = batches[idx];
      const dramatic = isDramaticRecapBatch(batch.events);
      const nextUnits = idx + 1 < batches.length ? batches[idx + 1].preUnits : undefined;
      fxTimeline.setPlaybackSpeed(dramatic ? 1 : 2.5);

      this.setStatus({
        active: true,
        kind: 'RECAP',
        step: idx + 1,
        total: batches.length,
        fastForward: !dramatic,
        label: dramatic ? 'KEY MOMENT' : 'ENEMY TURN',
      });

      // Render exact pre-action units briefly, then dispatch synchronized FX!
      bridge.applyDisplaySnapshot(batch.preUnits);
      bridge.dispatchEvents(batch.events, nextUnits);

      const advanceNext = () => {
        if (gen !== this.generation) return;
        this.cleanupWaiters();
        this.activeTimer = setTimeout(() => runIndex(idx + 1), dramatic ? 260 : 120);
      };

      if (dramatic) {
        let sawKillCam = fxTimeline.isKillCamActive();
        this.unsubKillCam = fxTimeline.subscribeKillCamActive((active) => {
          if (gen !== this.generation) return;
          if (active) {
            sawKillCam = true;
            if (this.activeTimer !== null) {
              clearTimeout(this.activeTimer);
              this.activeTimer = null;
            }
          } else if (sawKillCam) {
            advanceNext();
          }
        });
        if (!sawKillCam) {
          this.activeTimer = setTimeout(advanceNext, 1100);
        }
      } else {
        this.activeTimer = setTimeout(advanceNext, 420);
      }
    };

    runIndex(0);
  }

  /** Plays a single Play-of-the-Match highlight in FULL kill-cam mode, then restores live state. */
  public startPotmReplay(
    highlight: {
      headline: string;
      preUnits: Unit[];
      preMapData: Tile[];
      postUnits: Unit[];
      postMapData: Tile[];
      events: GameEvent[];
    },
    bridge: RecapBridge,
    onDone?: () => void,
  ): void {
    this.stop();
    const gen = ++this.generation;
    this.activeBridge = bridge;
    this.activeOnDone = onDone ?? null;

    fxTimeline.setPlaybackSpeed(1);
    fxTimeline.setReplayMode(true);

    this.setStatus({
      active: true,
      kind: 'POTM',
      step: 1,
      total: 1,
      fastForward: false,
      label: highlight.headline || 'PLAY OF THE MATCH',
    });

    bridge.applyDisplaySnapshot(highlight.preUnits, highlight.preMapData);

    // Brief 180ms pre-beat so the viewer registers the pre-shot board state before muzzle flash.
    this.activeTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      bridge.dispatchEvents(highlight.events, highlight.postUnits);
      bridge.applyDisplaySnapshot(highlight.postUnits, highlight.postMapData);

      let sawKillCam = fxTimeline.isKillCamActive();
      this.unsubKillCam = fxTimeline.subscribeKillCamActive((active) => {
        if (gen !== this.generation) return;
        if (active) {
          sawKillCam = true;
          if (this.activeTimer !== null) {
            clearTimeout(this.activeTimer);
            this.activeTimer = null;
          }
        } else if (sawKillCam) {
          this.cleanupWaiters();
          this.activeTimer = setTimeout(() => this.finish(gen), 220);
        }
      });
      if (!sawKillCam) {
        this.activeTimer = setTimeout(() => this.finish(gen), 1300);
      }
    }, 180);
  }

  private finish(gen: number): void {
    if (gen !== this.generation) return;
    this.cleanupWaiters();
    fxTimeline.setPlaybackSpeed(1);
    fxTimeline.setReplayMode(false);
    const bridge = this.activeBridge;
    const done = this.activeOnDone;
    this.activeBridge = null;
    this.activeOnDone = null;
    this.setStatus(IDLE_STATUS);
    bridge?.restoreLiveState();
    done?.();
  }
}

export const recapPlayer = new RecapPlayer();
