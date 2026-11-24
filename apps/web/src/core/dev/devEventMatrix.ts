/**
 * Dev sandbox event matrix.
 *
 * One declarative table behind three consumers:
 * - `DevOverlay` renders it, grouped, so the panel *is* the coverage map (no hand-kept button list).
 * - `useGameStore.devFireEvent` fires the engine events a live match would emit, so what you
 *   audition is the real FX pipeline (not a hand-animated mock).
 * - `devEventMatrix.test.ts` asserts every entry's declared tier / camera style / headline against
 *   the real director and reports any cause, tier or camera profile with no way to reach it.
 *
 * Adding a kill cause, a cinematic tier or a camera style without an auditionable event fails that
 * test, which is the point: the sandbox should always be able to show you every cut the game can
 * play.
 */
import type { GameEvent, KillCause, TerrainType, UnitType, WeaponVisual } from '@tactical/engine';
import {
  classifyKillTier,
  KILL_CAM_CAUSE_LABEL,
  KILL_CAM_STYLES,
  KILL_CAM_TIERS,
  resolveKillCamNarrative,
  selectKillCamStyle,
  type KillCamCameraStyle,
  type KillCamCue,
  type KillCamNarrativeTag,
  type KillCamSubject,
  type KillCamTier,
} from '../graphics/killCam';

/** Events the sandbox can fire through the real FX pipeline to audition a cut. */
export type DevEventKind =
  // Immediate hits
  | 'ATTACK_HIT'
  | 'GRAZE_1HP'
  | 'OVERWATCH_HIT'
  // Kills by combat profile
  | 'KILL_MICRO'
  | 'KILL_CINEMATIC'
  | 'KILL_BREACHER'
  | 'KILL_LONGSHOT'
  | 'KILL_OVERKILL'
  | 'KILL_ZERO_CP'
  | 'KILL_FINAL_BLOW'
  | 'KILL_FOG_AMBUSH'
  | 'CROSSFIRE_KILL'
  | 'CORNER_KILL'
  // Kills by cause
  | 'MINE_CLICK'
  | 'OVERWATCH_KILL'
  | 'TURRET_KILL'
  | 'ARTILLERY_KILL'
  | 'LAVA_DEATH'
  | 'HQ_COLLAPSE'
  // Structures
  | 'HEIST'
  | 'BANK_DEMOLISH'
  | 'HQ_BREACH'
  | 'HQ_DESTROY'
  | 'BARRIER_DEMOLISH'
  // Match tools (no cue of their own)
  | 'POTM_REPLAY'
  | 'EXPORT_CLIP'
  | 'TURN_RECAP';

export type DevEventGroup = 'IMPACT' | 'KILL' | 'CAUSE' | 'STRUCTURE' | 'REPLAY';

/** Everything the director needs to classify a probe, minus the geometry it does not read. */
export interface DevEventProbe {
  subject: KillCamSubject;
  cause: KillCause;
  /** Explicit tier for subjects that bypass `classifyKillTier` (ATTACK / STRUCTURE). */
  tier?: KillCamTier;
  weapon?: WeaponVisual;
  distanceTiles?: number;
  rank?: number;
  victimUnitType?: UnitType;
  killerUnitType?: UnitType;
  crossfireCount?: number;
  /** Damage beyond the victim's remaining HP, which is what earns the OVERKILL cut. */
  overkill?: number;
  damage?: number;
  combo?: number;
  remainingHp?: number;
  isMatchWinning?: boolean;
  zeroCpClutch?: boolean;
  isVendetta?: boolean;
  isFirstBlood?: boolean;
  hasVisibleOrigin?: boolean;
  structureType?: 'BASE' | 'BANK' | 'BARRIER';
  title?: string;
}

export interface DevEventOutcome {
  tier: KillCamTier;
  style: KillCamCameraStyle;
  headline: string;
  tags: KillCamNarrativeTag[];
}

/** A neutral, deterministic cue so a probe can be run through the real classifiers. */
export const devProbeCue = (probe: DevEventProbe): KillCamCue => ({
  id: 1,
  tier: probe.tier ?? 'CINEMATIC',
  subject: probe.subject,
  cause: probe.cause,
  weapon: probe.weapon,
  title: probe.title,
  structureType: probe.structureType,
  victimUnitId: 'dev_victim',
  victimUnitType: probe.victimUnitType ?? 'SOLDIER',
  victimOwner: 1,
  victimRank: probe.rank ?? 0,
  victimName: 'Scout',
  killerOwner: 0,
  killerUnitType: probe.killerUnitType ?? 'SOLDIER',
  remainingHp: probe.remainingHp,
  crossfireCount: probe.crossfireCount ?? 0,
  crossfirePoints:
    probe.crossfireCount && probe.crossfireCount > 0
      ? [{ x: 40, y: 40 }, { x: 260, y: 40 }].slice(0, Math.max(1, probe.crossfireCount))
      : undefined,
  hasVisibleOrigin: probe.hasVisibleOrigin ?? true,
  zeroCpClutch: probe.zeroCpClutch,
  isMatchWinning: probe.isMatchWinning,
  isVendetta: probe.isVendetta,
  isFirstBlood: probe.isFirstBlood,
  damage: probe.damage ?? 18,
  maxHp: 21,
  overkill: probe.overkill ?? 0,
  distanceTiles: probe.distanceTiles ?? 3,
  terrain: 'FOREST',
  focusX: 320,
  focusY: 200,
  markerX: 100,
  markerY: 200,
  frameW: 320,
  frameH: 120,
  combo: probe.combo ?? 1,
  travelMs: 200,
});

/** Runs a probe through the shipped classifiers (tier -> style -> narrative). */
export const devProbeOutcome = (probe: DevEventProbe): DevEventOutcome => {
  const tier =
    probe.tier ??
    classifyKillTier({
      rank: probe.rank ?? 0,
      cause: probe.cause,
      crossfireCount: probe.crossfireCount ?? 0,
      weapon: probe.weapon,
      distanceTiles: probe.distanceTiles ?? 3,
      overkill: probe.overkill ?? 0,
      combo: probe.combo ?? 1,
      isMatchWinning: probe.isMatchWinning,
      zeroCpClutch: probe.zeroCpClutch,
      isVendetta: probe.isVendetta,
      isFirstBlood: probe.isFirstBlood,
      killerUnitType: probe.killerUnitType,
      victimUnitType: probe.victimUnitType,
    });
  const cue: KillCamCue = { ...devProbeCue(probe), tier };
  const narrative = resolveKillCamNarrative(cue, probe.combo ?? 1);
  return { tier, style: selectKillCamStyle(cue), headline: narrative.headline, tags: narrative.tags };
};

// ── Event construction ───────────────────────────────────────────────────────────────────────
// The store feeds real engine events into `fxTimeline`, which is what makes an audition honest.

export interface DevEventActor {
  id: string;
  type: UnitType;
  owner: number;
  hp: number;
  rank: number;
  x: number;
  y: number;
  terrain: TerrainType;
}

export interface DevEventContext {
  gridSize: number;
  currentPlayer: number;
  victim: DevEventActor;
  killer: DevEventActor;
  /** Two tiles around the victim, used for crossfire geometry. */
  flank: { x: number; y: number }[];
  structure: { x: number; y: number; type: 'BASE' | 'BANK' | 'BARRIER'; owner: number | null } | null;
}

const clampTile = (value: number, size: number): number => Math.max(0, Math.min(size - 1, value));

/** Places a shooter `distance` tiles from the victim on whichever side has room. */
const shooterAt = (ctx: DevEventContext, distance: number): { x: number; y: number } => ({
  x: clampTile(ctx.victim.x + (ctx.victim.x - distance >= 0 ? -distance : distance), ctx.gridSize),
  y: ctx.victim.y,
});

interface LethalOptions {
  cause: KillCause;
  weapon: WeaponVisual;
  distance?: number;
  rank?: number;
  damage?: number;
  /** Skip the tracer for environmental deaths (magma, collapsing HQ). */
  projectile?: boolean;
  crossfire?: boolean;
  zeroCpClutch?: boolean;
  isMatchWinning?: boolean;
  overkill?: boolean;
}

/** A tracer + hit + death exactly as `applyAction` would emit them for a real kill. */
const lethalBatch = (ctx: DevEventContext, opts: LethalOptions): GameEvent[] => {
  const from = opts.distance === undefined ? { x: ctx.killer.x, y: ctx.killer.y } : shooterAt(ctx, opts.distance);
  const to = { x: ctx.victim.x, y: ctx.victim.y };
  const damage = opts.damage ?? Math.max(ctx.victim.hp + 2, 12);
  const events: GameEvent[] = [];
  if (opts.projectile !== false) {
    events.push({
      kind: 'projectile',
      from,
      to,
      style: opts.weapon === 'SNIPER' ? 'LASER' : opts.weapon === 'ASSAULTER' ? 'MISSILE' : 'BULLET',
      weapon: opts.weapon,
      attackerId: ctx.killer.id,
      targetUnitId: ctx.victim.id,
      travelMs: 260,
    });
  }
  events.push({
    kind: 'hit',
    targetUnitId: ctx.victim.id,
    at: to,
    from,
    damage,
    weapon: opts.weapon,
    isKill: true,
    ...(opts.crossfire ? { crossfireFrom: ctx.flank } : {}),
    breakdown: {
      baseDamage: Math.max(1, damage - 4),
      watchtowerBoosted: opts.weapon === 'SNIPER',
      coverPct: opts.crossfire ? 0.4 : 0,
      coverTerrain: ctx.victim.terrain,
      coverArmorApplied: false,
      crossfireBonus: opts.crossfire ? 4 : 0,
    },
  });
  events.push({
    kind: 'killed',
    unitId: ctx.victim.id,
    unitType: ctx.victim.type,
    owner: ctx.victim.owner,
    rank: opts.rank ?? 0,
    at: to,
    killerOwner: ctx.killer.owner,
    killerUnitId: ctx.killer.id,
    killerUnitType: ctx.killer.type,
    victimPreHp: ctx.victim.hp,
    ...(opts.zeroCpClutch ? { zeroCpClutch: true } : {}),
    ...(opts.isMatchWinning ? { isMatchWinning: true } : {}),
    cause: opts.cause,
  });
  return events;
};

/** A structure cut is a single `structureHit` — the timeline owns the title and framing. */
export const devStructureBatch = (ctx: DevEventContext, destroyed: boolean, damage: number, matchWinning = false): GameEvent[] => {
  const at = ctx.structure;
  if (!at) return [];
  return [
    {
      kind: 'structureHit',
      at: { x: at.x, y: at.y },
      structureType: at.type,
      damage,
      destroyed,
      owner: at.owner,
      attackerOwner: ctx.currentPlayer,
      ...(matchWinning ? { isMatchWinning: true } : {}),
    },
  ];
};

export interface DevEventStage {
  victim?: { x: number; y: number };
  killer?: { x: number; y: number };
}

const victimPoint = (ctx: DevEventContext): { x: number; y: number } => ({ x: ctx.victim.x, y: ctx.victim.y });

/** Tracer + non-lethal hit + damage popup, exactly as `ATTACK` emits them. */
const hitBatch = (ctx: DevEventContext, opts: { weapon: WeaponVisual; distance: number; damage: number }): GameEvent[] => {
  const from = shooterAt(ctx, opts.distance);
  const to = victimPoint(ctx);
  return [
    {
      kind: 'projectile',
      from,
      to,
      style: opts.weapon === 'SNIPER' ? 'LASER' : opts.weapon === 'ASSAULTER' ? 'MISSILE' : 'BULLET',
      weapon: opts.weapon,
      attackerId: ctx.killer.id,
      targetUnitId: ctx.victim.id,
      travelMs: 220,
    },
    {
      kind: 'hit',
      targetUnitId: ctx.victim.id,
      at: to,
      from,
      damage: opts.damage,
      weapon: opts.weapon,
      breakdown: {
        baseDamage: opts.damage,
        watchtowerBoosted: false,
        coverPct: 0,
        coverTerrain: ctx.victim.terrain,
        coverArmorApplied: false,
        crossfireBonus: 0,
      },
    },
    { kind: 'popup', at: to, text: `-${opts.damage}`, color: '#FBBF24', lift: 22 },
  ];
};

/** March onto a land mine, then detonate: the director's 150 ms ARM beat depends on the walk. */
const mineBatch = (ctx: DevEventContext): GameEvent[] => {
  const dy = ctx.victim.y >= 2 ? -1 : 1;
  const p0 = { x: ctx.victim.x, y: clampTile(ctx.victim.y + dy * 2, ctx.gridSize) };
  const p1 = { x: ctx.victim.x, y: clampTile(ctx.victim.y + dy, ctx.gridSize) };
  const p2 = victimPoint(ctx);
  return [
    { kind: 'movePath', unitId: ctx.victim.id, unitType: ctx.victim.type, owner: ctx.victim.owner, path: [p0, p1, p2], haltedAt: 2 },
    { kind: 'mineBlast', at: p2, damage: 15, victimUnitId: ctx.victim.id, victimDead: true },
    { kind: 'sound', sound: 'explosion' },
    { kind: 'shake', intensity: 14, at: p2 },
    {
      kind: 'killed',
      unitId: ctx.victim.id,
      unitType: ctx.victim.type,
      owner: ctx.victim.owner,
      rank: ctx.victim.rank,
      at: p2,
      killerOwner: ctx.currentPlayer,
      victimPreHp: ctx.victim.hp,
      cause: 'MINE',
    },
  ];
};

/** Ambush mid-march: the runner is intercepted before reaching its destination. */
const overwatchBatch = (ctx: DevEventContext): GameEvent[] => {
  const dy = ctx.victim.y >= 2 ? -1 : 1;
  const p0 = { x: ctx.victim.x, y: clampTile(ctx.victim.y + dy * 2, ctx.gridSize) };
  const p1 = { x: ctx.victim.x, y: clampTile(ctx.victim.y + dy, ctx.gridSize) };
  const p2 = victimPoint(ctx);
  return [
    { kind: 'movePath', unitId: ctx.victim.id, unitType: ctx.victim.type, owner: ctx.victim.owner, path: [p0, p1, p2], haltedAt: 2 },
    {
      kind: 'projectile',
      from: { x: ctx.killer.x, y: ctx.killer.y },
      to: p2,
      style: 'BULLET',
      weapon: 'SOLDIER',
      attackerId: ctx.killer.id,
      targetUnitId: ctx.victim.id,
      travelMs: 240,
    },
    {
      kind: 'hit',
      targetUnitId: ctx.victim.id,
      at: p2,
      from: { x: ctx.killer.x, y: ctx.killer.y },
      damage: Math.max(12, ctx.victim.hp + 3),
      weapon: 'SOLDIER',
      isKill: true,
      breakdown: {
        baseDamage: 12,
        watchtowerBoosted: false,
        coverPct: 0,
        coverTerrain: ctx.victim.terrain,
        coverArmorApplied: false,
        crossfireBonus: 0,
      },
    },
    {
      kind: 'killed',
      unitId: ctx.victim.id,
      unitType: ctx.victim.type,
      owner: ctx.victim.owner,
      rank: ctx.victim.rank,
      at: p2,
      killerOwner: ctx.killer.owner,
      killerUnitId: ctx.killer.id,
      killerUnitType: ctx.killer.type,
      victimPreHp: ctx.victim.hp,
      cause: 'OVERWATCH',
    },
  ];
};

/** Board corner (0,0) with a distant sniper: exercises Rule-of-Thirds clamping + corner dodge. */
const CORNER_STAGE: DevEventStage = { victim: { x: 0, y: 0 }, killer: { x: 3, y: 0 } };

const cornerCtx = (ctx: DevEventContext): DevEventContext => ({
  ...ctx,
  victim: { ...ctx.victim, ...CORNER_STAGE.victim },
  killer: { ...ctx.killer, ...CORNER_STAGE.killer },
});

export interface DevEventSpec {
  kind: DevEventKind;
  /** Short button label — keeps the panel readable at 9px. */
  label: string;
  group: DevEventGroup;
  /** One-line description of what the cut you are about to see demonstrates. */
  hint: string;
  /** What the director should do. Verified by `devEventMatrix.test.ts` for every cue. */
  expect?: DevEventOutcome;
  probe?: DevEventProbe;
  /** Engine events a live match would emit for this scenario. */
  build?: (ctx: DevEventContext) => GameEvent[];
  /** Where the cut happens: the store relocates these two sprites before firing. */
  stage?: (ctx: DevEventContext) => DevEventStage;
  /** Which board structure the cut destroys; the store resolves it (brushing a barrier if needed). */
  structureTarget?: 'BANK' | 'ENEMY_HQ' | 'BARRIER';
  /** Replay/recap tools that drive existing flows instead of a single cue. */
  tool?: boolean;
}

/** Entries carry only the scenario; the expected cut is declared separately, never derived. */
const cue = (probe: DevEventProbe): { probe: DevEventProbe } => ({ probe });

const RAW_EVENTS: DevEventSpec[] = [
  // ── Impact ──────────────────────────────────────────────────────────────────────────────────
  {
    kind: 'ATTACK_HIT',
    label: 'ATTACK HIT',
    group: 'IMPACT',
    hint: 'Non-lethal hit: the crisp attack micro-cam with damage telemetry.',
    ...cue({ subject: 'ATTACK', cause: 'COMBAT', tier: 'ATTACK', weapon: 'ASSAULTER', distanceTiles: 3, remainingHp: 8 }),
    build: ctx => hitBatch(ctx, { weapon: 'ASSAULTER', distance: 3, damage: 3 }),
  },
  {
    kind: 'GRAZE_1HP',
    label: '1 HP GRAZE',
    group: 'IMPACT',
    hint: 'Lethal-looking blow that leaves 1 HP: crimson tease, amber survival flip.',
    ...cue({ subject: 'ATTACK', cause: 'COMBAT', tier: 'ATTACK', weapon: 'ASSAULTER', distanceTiles: 2, remainingHp: 1 }),
    build: ctx => hitBatch(ctx, { weapon: 'ASSAULTER', distance: 2, damage: 1 }),
  },
  {
    kind: 'OVERWATCH_HIT',
    label: 'OVERWATCH HIT',
    group: 'IMPACT',
    hint: 'Overwatch round that wounds instead of killing — attack tier, ambush eyebrow.',
    ...cue({ subject: 'ATTACK', cause: 'OVERWATCH', tier: 'ATTACK', weapon: 'SOLDIER', distanceTiles: 4, remainingHp: 6 }),
    build: ctx => {
      const from = shooterAt(ctx, 4);
      const to = { x: ctx.victim.x, y: ctx.victim.y };
      return [
        {
          kind: 'projectile',
          from,
          to,
          style: 'BULLET',
          weapon: 'SOLDIER',
          attackerId: ctx.killer.id,
          targetUnitId: ctx.victim.id,
          travelMs: 220,
        },
        {
          kind: 'hit',
          targetUnitId: ctx.victim.id,
          at: to,
          from,
          damage: 2,
          weapon: 'SOLDIER',
          breakdown: {
            baseDamage: 6,
            watchtowerBoosted: false,
            coverPct: 0,
            coverTerrain: ctx.victim.terrain,
            coverArmorApplied: false,
            crossfireBonus: 0,
          },
        },
      ];
    },
  },

  // ── Kills by combat profile ─────────────────────────────────────────────────────────────────
  {
    kind: 'KILL_MICRO',
    label: 'MICRO KILL',
    group: 'KILL',
    hint: 'Rank-and-file kill: snappy punch, no letterbox, no cinematic.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SOLDIER', distanceTiles: 1, rank: 0, combo: 1 }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SOLDIER', distance: 1, rank: 0 }),
  },
  {
    kind: 'KILL_CINEMATIC',
    label: 'ACE SNIPE',
    group: 'KILL',
    hint: 'Veteran kill: full cinematic cut with the sniper whip-pan.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SNIPER', distanceTiles: 6, rank: 3 }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SNIPER', distance: 4, rank: 3, damage: 24 }),
  },
  {
    kind: 'KILL_BREACHER',
    label: 'BREACHER ARC',
    group: 'KILL',
    hint: 'Assaulter kill: camera rides the shell along its low arc.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'ASSAULTER', distanceTiles: 3, rank: 3, killerUnitType: 'ASSAULTER' }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'ASSAULTER', distance: 3, rank: 3, damage: 30 }),
  },
  {
    kind: 'KILL_LONGSHOT',
    label: 'LONGSHOT',
    group: 'KILL',
    hint: 'Seven-plus tile sniper kill: LONGSHOT headline on the rail whip.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SNIPER', distanceTiles: 8, rank: 0 }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SNIPER', distance: 8, rank: 0, damage: 20 }),
  },
  {
    kind: 'KILL_OVERKILL',
    label: 'OVERKILL',
    group: 'KILL',
    hint: 'Damage far past the victim max HP: OVERKILL badge on a cinematic cut.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SOLDIER', distanceTiles: 1, rank: 0, overkill: 19, damage: 40 }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SOLDIER', distance: 1, damage: 40 }),
  },
  {
    kind: 'KILL_ZERO_CP',
    label: '0 CP CLUTCH',
    group: 'KILL',
    hint: 'Kill on the last command point: gold 0 CP CLUTCH headline.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SOLDIER', distanceTiles: 2, rank: 0, zeroCpClutch: true }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SOLDIER', distance: 2, damage: 16, zeroCpClutch: true }),
  },
  {
    kind: 'KILL_FINAL_BLOW',
    label: 'FINAL BLOW',
    group: 'KILL',
    hint: 'Match-winning kill: FINAL BLOW takes priority over every other badge.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SNIPER', distanceTiles: 5, rank: 0, isMatchWinning: true }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SNIPER', distance: 4, damage: 26, isMatchWinning: true }),
  },
  {
    kind: 'KILL_FOG_AMBUSH',
    label: 'FOG AMBUSH',
    group: 'KILL',
    hint: 'Origin unseen under fog: ambush eyebrow and no whip-pan (you never see the shooter).',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SNIPER', distanceTiles: 4, rank: 3, hasVisibleOrigin: false }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SNIPER', distance: 1, rank: 3, damage: 22 }),
  },
  {
    kind: 'CROSSFIRE_KILL',
    label: 'CROSSFIRE',
    group: 'KILL',
    hint: 'Two flankers triangulate the victim: wide triangle framing collapsing into the kill.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SNIPER', distanceTiles: 2, rank: 0, crossfireCount: 2 }),
    build: ctx => lethalBatch(ctx, { cause: 'COMBAT', weapon: 'SNIPER', distance: 2, rank: 0, crossfire: true }),
  },
  {
    kind: 'CORNER_KILL',
    label: 'CORNER KILL',
    group: 'KILL',
    hint: 'Kill in the board corner: Rule-of-Thirds clamping plus telemetry corner dodge.',
    ...cue({ subject: 'KILL', cause: 'COMBAT', weapon: 'SNIPER', distanceTiles: 3, rank: 3, zeroCpClutch: true }),
    stage: () => CORNER_STAGE,
    build: ctx => lethalBatch(cornerCtx(ctx), { cause: 'COMBAT', weapon: 'SNIPER', distance: 3, rank: 3, zeroCpClutch: true }),
  },

  // ── Kills by cause ──────────────────────────────────────────────────────────────────────────
  {
    kind: 'MINE_CLICK',
    label: 'MINE CLICK',
    group: 'CAUSE',
    hint: 'Land mine: 150 ms pressure-plate ARM beat, then detonation.',
    ...cue({ subject: 'KILL', cause: 'MINE', weapon: 'SIEGE', distanceTiles: 0, rank: 0 }),
    build: ctx => mineBatch(ctx),
  },
  {
    kind: 'OVERWATCH_KILL',
    label: 'OVERWATCH KILL',
    group: 'CAUSE',
    hint: 'Ambush mid-march: camera snaps onto the hidden shooter, then the runner.',
    ...cue({ subject: 'KILL', cause: 'OVERWATCH', weapon: 'SOLDIER', distanceTiles: 3, rank: 0 }),
    build: ctx => overwatchBatch(ctx),
  },
  {
    kind: 'TURRET_KILL',
    label: 'BANK TURRET',
    group: 'CAUSE',
    hint: 'Automated bank turret kill: no shooter unit, cause-labelled headline.',
    ...cue({ subject: 'KILL', cause: 'TURRET', weapon: 'TURRET', distanceTiles: 0, rank: 0 }),
    build: ctx => lethalBatch(ctx, { cause: 'TURRET', weapon: 'TURRET', distance: 2, damage: 18 }),
  },
  {
    kind: 'ARTILLERY_KILL',
    label: 'BASE ARTILLERY',
    group: 'CAUSE',
    hint: 'HQ autocannon kill: indirect-fire cause with no visible attacker.',
    ...cue({ subject: 'KILL', cause: 'ARTILLERY', weapon: 'ARTILLERY', distanceTiles: 0, rank: 0 }),
    build: ctx => lethalBatch(ctx, { cause: 'ARTILLERY', weapon: 'ARTILLERY', distance: 3, damage: 22 }),
  },
  {
    kind: 'LAVA_DEATH',
    label: 'MAGMA DEATH',
    group: 'CAUSE',
    hint: 'Terrain kill: MAGMA KILL headline with no tracer in flight.',
    ...cue({ subject: 'KILL', cause: 'LAVA', weapon: 'SIEGE', distanceTiles: 0, rank: 0 }),
    build: ctx => lethalBatch(ctx, { cause: 'LAVA', weapon: 'SIEGE', projectile: false, damage: 26 }),
  },
  {
    kind: 'HQ_COLLAPSE',
    label: 'HQ COLLAPSE',
    group: 'CAUSE',
    hint: 'Crushed by a collapsing HQ: the BASE_FALL cause and its headline.',
    ...cue({ subject: 'KILL', cause: 'BASE_FALL', weapon: 'SIEGE', distanceTiles: 0, rank: 0 }),
    build: ctx => lethalBatch(ctx, { cause: 'BASE_FALL', weapon: 'SIEGE', projectile: false, damage: 26 }),
  },

  // ── Structures ──────────────────────────────────────────────────────────────────────────────
  {
    kind: 'HEIST',
    label: 'VAULT HEIST',
    group: 'STRUCTURE',
    hint: 'Successful hack: gold VAULT BREACHED structure blowout.',
    ...cue({ subject: 'STRUCTURE', cause: 'COMBAT', tier: 'STRUCTURE', structureType: 'BANK', title: 'VAULT BREACHED' }),
    structureTarget: 'BANK',
    build: ctx =>
      ctx.structure ? [{ kind: 'heist', at: { x: ctx.structure.x, y: ctx.structure.y }, playerId: ctx.currentPlayer }] : [],
  },
  {
    kind: 'BANK_DEMOLISH',
    label: 'BANK DOWN',
    group: 'STRUCTURE',
    hint: 'Vault destroyed: full letterbox structure cut on the blast.',
    ...cue({ subject: 'STRUCTURE', cause: 'COMBAT', tier: 'STRUCTURE', structureType: 'BANK', title: 'BANK DEMOLISHED' }),
    structureTarget: 'BANK',
    build: ctx => devStructureBatch(ctx, true, 14),
  },
  {
    kind: 'HQ_BREACH',
    label: 'HQ BREACH',
    group: 'STRUCTURE',
    hint: 'First siege damage on an HQ: the "they are in" moment.',
    ...cue({ subject: 'STRUCTURE', cause: 'COMBAT', tier: 'STRUCTURE', structureType: 'BASE', title: 'HQ BREACHED' }),
    structureTarget: 'ENEMY_HQ',
    build: ctx => devStructureBatch(ctx, false, 8),
  },
  {
    kind: 'HQ_DESTROY',
    label: 'HQ DESTROYED',
    group: 'STRUCTURE',
    hint: 'Headquarters razed: match-point structure cut.',
    ...cue({
      subject: 'STRUCTURE',
      cause: 'COMBAT',
      tier: 'STRUCTURE',
      structureType: 'BASE',
      title: 'HEADQUARTERS DESTROYED',
      isMatchWinning: true,
    }),
    structureTarget: 'ENEMY_HQ',
    build: ctx => devStructureBatch(ctx, true, 50, true),
  },
  {
    kind: 'BARRIER_DEMOLISH',
    label: 'BARRIER DOWN',
    group: 'STRUCTURE',
    hint: 'Barricade demolished: structure cut on a non-vault target (brushes one if needed).',
    ...cue({ subject: 'STRUCTURE', cause: 'COMBAT', tier: 'STRUCTURE', structureType: 'BARRIER', title: 'BARRIER DEMOLISHED' }),
    structureTarget: 'BARRIER',
    build: ctx => devStructureBatch(ctx, true, 30),
  },

  // ── Match tools ─────────────────────────────────────────────────────────────────────────────
  { kind: 'POTM_REPLAY', label: 'POTM REPLAY', group: 'REPLAY', hint: 'Replays the highest-drama batch with replays tagged.', tool: true },
  { kind: 'EXPORT_CLIP', label: 'EXPORT CLIP', group: 'REPLAY', hint: 'Exports the Play-of-the-Match clip.', tool: true },
  { kind: 'TURN_RECAP', label: 'TURN RECAP', group: 'REPLAY', hint: 'Runs the 2.5× missed-action recap over a scripted enemy turn.', tool: true },
];

/**
 * The hand-written contract for every cue. Deliberately literal: if the director changes how a
 * scenario is classified, the matrix test fails instead of silently re-baselining itself.
 */
export const DEV_EVENT_EXPECTED: Partial<Record<DevEventKind, DevEventOutcome>> = {
  ATTACK_HIT: { tier: 'ATTACK', style: 'STANDARD', headline: 'DIRECT HIT', tags: [] },
  GRAZE_1HP: { tier: 'ATTACK', style: 'GRAZE_FAKEOUT', headline: '1 HP · BARELY ALIVE!', tags: ['GRAZE'] },
  OVERWATCH_HIT: { tier: 'ATTACK', style: 'STANDARD', headline: 'DIRECT HIT', tags: [] },
  KILL_MICRO: { tier: 'MICRO', style: 'STANDARD', headline: 'ELIMINATED', tags: [] },
  KILL_CINEMATIC: { tier: 'CINEMATIC', style: 'SNIPER_WHIP', headline: 'ACE DOWN', tags: ['GIANT_SLAYER'] },
  KILL_BREACHER: { tier: 'CINEMATIC', style: 'BREACHER_ARC', headline: 'ACE DOWN', tags: [] },
  KILL_LONGSHOT: { tier: 'CINEMATIC', style: 'SNIPER_WHIP', headline: 'LONGSHOT', tags: ['LONGSHOT'] },
  KILL_OVERKILL: { tier: 'CINEMATIC', style: 'STANDARD', headline: 'ELIMINATED', tags: ['OVERKILL'] },
  KILL_ZERO_CP: { tier: 'CINEMATIC', style: 'STANDARD', headline: '0 CP CLUTCH', tags: ['ZERO_CP'] },
  KILL_FINAL_BLOW: { tier: 'CINEMATIC', style: 'SNIPER_WHIP', headline: 'FINAL BLOW', tags: ['FINAL_BLOW'] },
  KILL_FOG_AMBUSH: { tier: 'CINEMATIC', style: 'STANDARD', headline: 'ACE DOWN', tags: ['GIANT_SLAYER'] },
  CROSSFIRE_KILL: { tier: 'CINEMATIC', style: 'CROSSFIRE_TRIANGLE', headline: 'ELIMINATED', tags: ['CROSSFIRE'] },
  CORNER_KILL: { tier: 'CINEMATIC', style: 'SNIPER_WHIP', headline: '0 CP CLUTCH', tags: ['ZERO_CP', 'GIANT_SLAYER'] },
  MINE_CLICK: { tier: 'CINEMATIC', style: 'MINE_CLICK', headline: 'LAND MINE KILL', tags: [] },
  OVERWATCH_KILL: { tier: 'CINEMATIC', style: 'OVERWATCH_SNAP', headline: 'OVERWATCH AMBUSH KILL', tags: [] },
  TURRET_KILL: { tier: 'CINEMATIC', style: 'STANDARD', headline: 'BANK TURRET KILL', tags: [] },
  ARTILLERY_KILL: { tier: 'CINEMATIC', style: 'STANDARD', headline: 'BASE ARTILLERY KILL', tags: [] },
  LAVA_DEATH: { tier: 'CINEMATIC', style: 'STANDARD', headline: 'MAGMA KILL', tags: [] },
  HQ_COLLAPSE: { tier: 'CINEMATIC', style: 'STANDARD', headline: 'HQ COLLAPSE KILL', tags: [] },
  HEIST: { tier: 'STRUCTURE', style: 'STRUCTURE_BLOWOUT', headline: 'VAULT BREACHED', tags: [] },
  BANK_DEMOLISH: { tier: 'STRUCTURE', style: 'STRUCTURE_BLOWOUT', headline: 'BANK DEMOLISHED', tags: [] },
  HQ_BREACH: { tier: 'STRUCTURE', style: 'STRUCTURE_BLOWOUT', headline: 'HQ BREACHED', tags: [] },
  HQ_DESTROY: { tier: 'STRUCTURE', style: 'STRUCTURE_BLOWOUT', headline: 'FINAL BLOW', tags: ['FINAL_BLOW'] },
  BARRIER_DEMOLISH: { tier: 'STRUCTURE', style: 'STRUCTURE_BLOWOUT', headline: 'BARRIER DEMOLISHED', tags: [] },
};

export const DEV_EVENT_CATALOG: DevEventSpec[] = RAW_EVENTS.map(spec => {
  const expect = DEV_EVENT_EXPECTED[spec.kind];
  return expect ? { ...spec, expect } : spec;
});

export const DEV_EVENT_MAP: Partial<Record<DevEventKind, DevEventSpec>> = Object.fromEntries(
  DEV_EVENT_CATALOG.map(spec => [spec.kind, spec]),
) as Partial<Record<DevEventKind, DevEventSpec>>;

export const DEV_EVENT_GROUPS: { id: DevEventGroup; label: string }[] = [
  { id: 'IMPACT', label: 'HITS' },
  { id: 'KILL', label: 'KILL CUTS' },
  { id: 'CAUSE', label: 'KILL CAUSES' },
  { id: 'STRUCTURE', label: 'STRUCTURES' },
  { id: 'REPLAY', label: 'MATCH TOOLS' },
];

/** The set of causes / tiers / camera styles the sandbox can currently audition. */
export interface DevEventCoverage {
  causes: KillCause[];
  tiers: KillCamTier[];
  styles: KillCamCameraStyle[];
  missingCauses: KillCause[];
  missingTiers: KillCamTier[];
  missingStyles: KillCamCameraStyle[];
  complete: boolean;
}

export const devEventCoverage = (): DevEventCoverage => {
  const specs = DEV_EVENT_CATALOG.filter(spec => spec.probe && spec.expect);
  const causes = new Set(specs.map(spec => spec.probe!.cause));
  const tiers = new Set(specs.map(spec => spec.expect!.tier));
  const styles = new Set(specs.map(spec => spec.expect!.style));
  const allCauses = Object.keys(KILL_CAM_CAUSE_LABEL) as KillCause[];
  const missingCauses = allCauses.filter(cause => !causes.has(cause));
  const missingTiers = KILL_CAM_TIERS.filter(tier => !tiers.has(tier));
  const missingStyles = KILL_CAM_STYLES.filter(style => !styles.has(style));
  return {
    causes: [...causes],
    tiers: [...tiers],
    styles: [...styles],
    missingCauses,
    missingTiers,
    missingStyles,
    complete: missingCauses.length === 0 && missingTiers.length === 0 && missingStyles.length === 0,
  };
};
