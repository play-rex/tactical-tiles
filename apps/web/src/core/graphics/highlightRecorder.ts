/**
 * Play-of-the-Match highlight recorder (`highlightRecorder`).
 *
 * Pure TypeScript with zero React/Pixi dependencies. Scores every combat/structure/graze batch
 * by drama and retains only the single highest-scoring moment (~50 KB), ready to replay in-engine
 * or export as a broadcast WebM/PNG clip from `WinnerOverlay`.
 */
import type { GameEvent, Tile, Unit } from '@tactical/engine';

export interface MatchHighlight {
  score: number;
  turn: number;
  headline: string;
  seed: string;
  preUnits: Unit[];
  preMapData: Tile[];
  postUnits: Unit[];
  postMapData: Tile[];
  events: GameEvent[];
}

export interface HighlightScoreResult {
  score: number;
  headline: string;
}

/** Deterministic drama scorer for an action's `GameEvent[]` batch. */
export const scoreHighlightBatch = (
  events: GameEvent[],
  postUnits?: Unit[],
): HighlightScoreResult => {
  if (!events || events.length === 0) return { score: 0, headline: '' };

  let score = 0;
  let headline = '';
  const kills = events.filter((e): e is Extract<GameEvent, { kind: 'killed' }> => e.kind === 'killed');
  const hits = events.filter((e): e is Extract<GameEvent, { kind: 'hit' }> => e.kind === 'hit');
  const heists = events.filter(e => e.kind === 'heist');
  const structHits = events.filter((e): e is Extract<GameEvent, { kind: 'structureHit' }> => e.kind === 'structureHit');

  if (kills.length >= 2) {
    score += 60 * kills.length;
    headline = `${kills.length}× MULTI KILL`;
  }

  for (const k of kills) {
    let kScore = 18;
    let kLabel = 'ELIMINATED';
    if (k.isMatchWinning) {
      kScore += 100;
      kLabel = 'FINAL BLOW';
    }
    if (k.rank >= 3) {
      kScore += 45;
      if (!k.isMatchWinning) kLabel = 'ACE DOWN';
    }
    if (k.zeroCpClutch) {
      kScore += 35;
      if (!k.isMatchWinning) kLabel = '0 CP CLUTCH';
    }
    if (k.cause === 'OVERWATCH') {
      kScore += 30;
      if (kLabel === 'ELIMINATED') kLabel = 'OVERWATCH KILL';
    } else if (k.cause === 'MINE') {
      kScore += 30;
      if (kLabel === 'ELIMINATED') kLabel = 'LAND MINE KILL';
    }
    if (k.killerUnitType === 'SOLDIER' && (k.unitType === 'SNIPER' || k.rank >= 2)) {
      kScore += 28;
      if (!k.isMatchWinning) kLabel = 'GIANT SLAYER';
    }

    const matchingHit = hits.find(h => h.targetUnitId === k.unitId);
    if (matchingHit) {
      const xf = matchingHit.crossfireFrom?.length ?? 0;
      if (xf > 0) kScore += 20 * xf;
      if (matchingHit.from) {
        const dist = Math.hypot(matchingHit.from.x - k.at.x, matchingHit.from.y - k.at.y);
        if (matchingHit.weapon === 'SNIPER' && dist >= 5) {
          kScore += 22;
          if (dist >= 7 && kLabel === 'ELIMINATED') kLabel = 'LONGSHOT';
        }
      }
      if (k.victimPreHp !== undefined && matchingHit.damage - k.victimPreHp >= 10) {
        kScore += 16;
      }
    }

    score += kScore;
    if (!headline || k.isMatchWinning) headline = kLabel;
  }

  for (const s of structHits) {
    if (s.destroyed && s.structureType === 'BASE') {
      score += s.isMatchWinning ? 130 : 75;
      headline = s.isMatchWinning ? 'FINAL BLOW · HQ DESTROYED' : 'HQ DESTROYED';
    } else if (s.destroyed && s.structureType === 'BANK') {
      score += 55;
      if (!headline) headline = 'BANK DEMOLISHED';
    }
  }

  if (heists.length > 0) {
    score += 55;
    if (!headline) headline = 'VAULT BREACHED';
  }

  // Non-lethal 1-HP Graze survival is also highlight-worthy!
  if (kills.length === 0 && postUnits) {
    for (const h of hits) {
      if (!h.isKill && h.targetUnitId) {
        const survived = postUnits.find(u => u.id === h.targetUnitId);
        if (survived && survived.hp === 1) {
          score += 28;
          if (!headline) headline = '1 HP · BARELY ALIVE!';
        }
      }
    }
  }

  return { score, headline };
};

export class HighlightRecorder {
  private best: MatchHighlight | null = null;

  public reset(): void {
    this.best = null;
  }

  public getBest(): MatchHighlight | null {
    return this.best;
  }

  public record(input: {
    turn: number;
    seed: string;
    preUnits: Unit[];
    preMapData: Tile[];
    postUnits: Unit[];
    postMapData: Tile[];
    events: GameEvent[];
  }): boolean {
    const { score, headline } = scoreHighlightBatch(input.events, input.postUnits);
    if (score <= 0) return false;
    if (this.best && score < this.best.score) return false;

    this.best = {
      score,
      turn: input.turn,
      headline: headline || 'HIGHLIGHT',
      seed: input.seed,
      preUnits: input.preUnits.map(u => ({ ...u })),
      preMapData: input.preMapData.map(t => ({ ...t })),
      postUnits: input.postUnits.map(u => ({ ...u })),
      postMapData: input.postMapData.map(t => ({ ...t })),
      events: input.events,
    };
    return true;
  }
}

export const highlightRecorder = new HighlightRecorder();
