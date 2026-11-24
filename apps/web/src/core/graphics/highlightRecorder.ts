/**
 * Play-of-the-Match highlight recorder (`highlightRecorder`).
 *
 * Pure TypeScript with zero React/Pixi dependencies. Scores every combat/structure/graze batch
 * by drama and retains the strongest moments (~50 KB each): the single best one for the scoreboard
 * and clip export, plus a ranked reel that `getFilm()` cuts into one chronological story.
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

/** How many moments stay on the cutting-room floor after the top ones are kept. */
export const HIGHLIGHT_RETAINED = 12;

/** Two moments belong to the same feud when they are this close in time… */
export const FILM_CAST_WINDOW_TURNS = 6;

/** …and share a unit. Five cuts reads as a story; ten reads as a rerun. */
export const FILM_MAX_SCENES = 5;

/** The reel: one feud from its first shot to its last, across turns and seats. */
export interface MatchFilm {
  /** Chronological, so the match's history plays forward even though scenes are cut apart. */
  scenes: MatchHighlight[];
  score: number;
  headline: string;
  cast: string[];
}

/** The units whose fight a moment is: either side of every shot, blast, and death in it. */
export const highlightCast = (highlight: MatchHighlight): string[] => {
  const ids = new Set<string>();
  for (const e of highlight.events) {
    switch (e.kind) {
      case 'killed':
        ids.add(e.unitId);
        if (e.killerUnitId) ids.add(e.killerUnitId);
        break;
      case 'hit':
        if (e.targetUnitId) ids.add(e.targetUnitId);
        break;
      case 'projectile':
        if (e.attackerId) ids.add(e.attackerId);
        if (e.targetUnitId) ids.add(e.targetUnitId);
        break;
      case 'mineBlast':
        if (e.victimUnitId) ids.add(e.victimUnitId);
        break;
      case 'movePath':
      case 'heal':
      case 'promotion':
      case 'overwatchSet':
      case 'spawn':
        ids.add(e.unitId);
        break;
      default:
        break;
    }
  }
  return [...ids];
};

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
  private scenes: MatchHighlight[] = [];

  public reset(): void {
    this.best = null;
    this.scenes = [];
  }

  public getBest(): MatchHighlight | null {
    return this.best;
  }

  /** Every kept moment, ranked by drama: the raw footage a match reel is cut from. */
  public getScenes(): readonly MatchHighlight[] {
    return this.scenes;
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

    const entry: MatchHighlight = {
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

    this.scenes.push(entry);
    this.scenes.sort((a, b) => b.score - a.score || a.turn - b.turn);
    if (this.scenes.length > HIGHLIGHT_RETAINED) this.scenes.length = HIGHLIGHT_RETAINED;

    const isBest = !this.best || score >= this.best.score;
    if (isBest) this.best = entry;
    return isBest;
  }

  /**
   * The match's story, cut from the reel: the highest-drama moment and every nearby moment that
   * shares a unit with it, in chronological order. Scenes are joined by cast and time, never by a
   * continuous timeline — a feud can skip five turns and both seats and still cut together.
   */
  public getFilm(maxScenes = FILM_MAX_SCENES): MatchFilm | null {
    const anchor = this.best ?? this.scenes[0];
    if (!anchor) return null;
    const cast = highlightCast(anchor);
    const castSet = new Set(cast);

    const story = this.scenes
      .filter(scene => {
        if (scene === anchor) return true;
        if (Math.abs(scene.turn - anchor.turn) > FILM_CAST_WINDOW_TURNS) return false;
        return highlightCast(scene).some(id => castSet.has(id));
      })
      // Closest to the anchor first, so a cap keeps the feud tight around its peak.
      .sort(
        (a, b) =>
          Math.abs(a.turn - anchor.turn) - Math.abs(b.turn - anchor.turn) || b.score - a.score,
      )
      .slice(0, Math.max(1, maxScenes))
      .sort((a, b) => a.turn - b.turn || a.score - b.score);

    return {
      scenes: story,
      score: anchor.score,
      headline: anchor.headline,
      cast,
    };
  }
}

export const highlightRecorder = new HighlightRecorder();
