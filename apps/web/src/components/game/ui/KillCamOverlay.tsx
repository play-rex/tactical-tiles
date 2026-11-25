import React, { useEffect, useState } from 'react';
import { VETERANCY_CONFIG } from '@tactical/engine/constants/Config';
import { fxTimeline } from '../../../core/graphics/fxTimeline';
import {
  buildReceiptSteps,
  getKillCamTiming,
  KILL_CAM_CAUSE_LABEL,
  KILL_CAM_WEAPON_LABEL,
  resolveKillCamNarrative,
  type KillCamFrame,
  type KillCamNarrativeTag,
  type ReceiptStep,
} from '../../../core/graphics/killCam';
import { useGameStore } from '../../../store/useGameStore';
import { useOnline } from '../../../net/useOnline';
import { TACTICAL_VISUAL_STYLE } from '../../../core/graphics/TacticalAssets';
import { PLAYER_UI_THEME, playerDisplayName } from '../../ui/GeoPrimitives';

export { buildReceiptSteps, type ReceiptStep };

const TERRAIN_LABEL: Record<string, string> = {
  FOREST: 'FOREST',
  MOUNTAIN: 'HIGH GROUND',
  DUNES: 'DUNES',
  SAND: 'EXPOSED SAND',
  ROAD: 'ROAD',
  BUILDING: 'URBAN',
  WATER: 'WATERLINE',
  BRIDGE: 'BRIDGE',
  BRIDGE_V: 'BRIDGE',
  QUICKSAND: 'QUICKSAND',
  CANYON: 'CANYON',
  TUNNEL: 'TUNNEL',
  BASE: 'HQ PERIMETER',
  BARRIER: 'BARRIER',
  LAVA: 'MAGMA',
};

const STRUCTURE_NAME: Record<string, string> = {
  BASE: 'HEADQUARTERS',
  BANK: 'BANK VAULT',
  BARRIER: 'BARRICADE',
};

const TAG_CHIP_LABEL: Record<KillCamNarrativeTag, { label: string; tone: 'gold' | 'hot' | 'cyan' }> = {
  FINAL_BLOW: { label: 'MATCH POINT', tone: 'gold' },
  ZERO_CP: { label: '0 CP CLUTCH', tone: 'gold' },
  VENDETTA: { label: 'VENDETTA', tone: 'hot' },
  GIANT_SLAYER: { label: 'GIANT SLAYER', tone: 'gold' },
  FIRST_BLOOD: { label: 'FIRST BLOOD', tone: 'hot' },
  LONGSHOT: { label: 'LONGSHOT', tone: 'cyan' },
  OVERKILL: { label: 'OVERKILL', tone: 'hot' },
  CROSSFIRE: { label: 'CROSSFIRE', tone: 'hot' },
  GRAZE: { label: '1 HP SURVIVAL', tone: 'gold' },
};

interface KillCamBeatState {
  frame: KillCamFrame;
  dodgeRight: boolean;
}

/**
 * Reads live camera frame + projected subject screen position on rAF, re-rendering React ONLY
 * when discrete beat/flip/corner-dodge state changes (zero per-frame React churn).
 */
const useKillCamBeat = (): KillCamBeatState => {
  const [state, setState] = useState<KillCamBeatState>(() => ({
    frame: fxTimeline.getKillCamFrame(),
    dodgeRight: false,
  }));
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const next = fxTimeline.getKillCamFrame();
      const sub = fxTimeline.getKillCamSubjectScreen();
      // If a corner kill lands in the upper-right quadrant, flip telemetry to the left flank!
      const dodgeRight = next.active && sub.x > 0.56 && sub.y < 0.52;
      const key = `${next.phase}|${next.cue?.id ?? 0}|${next.combo}|${next.mode}|${next.grazeFlipped ? 1 : 0}|${dodgeRight ? 1 : 0}`;
      if (key !== lastKey) {
        lastKey = key;
        setState({ frame: next, dodgeRight });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return state;
};

const BracketFrame: React.FC<{ prelude?: boolean }> = ({ prelude = false }) => (
  <div className={`tt-killcam__brackets${prelude ? ' tt-killcam__brackets--prelude' : ''}`} aria-hidden="true">
    <i /> <i /> <i /> <i />
  </div>
);

/**
 * Kill Cam V2 Overlay:
 * - Center ~45% stays completely open; telemetry dynamically dodges upper-right corner kills.
 * - Staggered Tactical Receipt explains exact deterministic combat modifiers.
 * - Supports Land Mine `ARM` (*click*), Overwatch comms-glitch, 1-HP Graze Fake-Out flip,
 *   emergent narrative headlines, Play-of-the-Match badge, and instant click/Space/Esc skip.
 */
export const KillCamOverlay: React.FC = () => {
  const { frame, dodgeRight } = useKillCamBeat();
  const mode = useGameStore(s => s.mode);
  const playerNames = useGameStore(s => s.settings.playerNames);
  const turn = useGameStore(s => s.turnCounter);
  const seats = useOnline(s => (mode === 'ONLINE' ? s.view?.seats : undefined));

  const isAttack = frame.cue?.subject === 'ATTACK';
  const isTacticalCinematicAttack = Boolean(
    isAttack &&
    frame.cue?.tacticalItemKey &&
    (frame.cameraStyle === 'ORBITAL_DROP' || frame.cameraStyle === 'BOMBER_TRACK' || frame.cameraStyle === 'BARRAGE_WALK'),
  );
  const canSkip = frame.active && Boolean(frame.cue) && (!isAttack || isTacticalCinematicAttack);

  useEffect(() => {
    if (!canSkip) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.code === 'Space' || e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        fxTimeline.skipKillCam();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [canSkip]);

  if (!frame.active || !frame.cue) return null;
  const cue = frame.cue;
  const timing = getKillCamTiming(cue.tier, frame.mode, frame.cameraStyle);
  const cinematic = cue.tier === 'CINEMATIC';
  const isStructure = cue.subject === 'STRUCTURE';
  const victimOwner = cue.victimOwner ?? 0;
  const victimRank = cue.victimRank ?? 0;
  const narrative = resolveKillCamNarrative(cue, frame.combo);

  const killerTheme =
    cue.killerOwner !== null && PLAYER_UI_THEME[cue.killerOwner]
      ? PLAYER_UI_THEME[cue.killerOwner]
      : PLAYER_UI_THEME[0];
  const victimTheme = PLAYER_UI_THEME[victimOwner] ?? PLAYER_UI_THEME[0];
  const accent = narrative.accentGold ? '#FACC15' : (killerTheme?.badgeBg ?? '#F8FAFC');
  const accentInk = killerTheme?.badgeText ?? '#0B1220';
  const victimInk = victimTheme?.badgeBg ?? '#EF4444';

  const killerName =
    cue.killerOwner !== null
      ? playerDisplayName(cue.killerOwner, playerNames, mode === 'ONLINE' ? seats?.[cue.killerOwner]?.name : undefined)
      : 'BATTLEFIELD';
  const victimOwnerName = playerDisplayName(
    victimOwner,
    playerNames,
    mode === 'ONLINE' ? seats?.[victimOwner]?.name : undefined,
  );
  const victimUnitLabel = isStructure
    ? STRUCTURE_NAME[cue.structureType ?? 'BANK'] ?? 'STRUCTURE'
    : (cue.victimName ?? cue.victimUnitType ?? 'UNIT').toUpperCase();
  const rankLabel = (VETERANCY_CONFIG.RANK_NAMES[victimRank] ?? 'Recruit').toUpperCase();

  const speedLabel = `${timing.slowScale.toFixed(2)}×`;
  const slug = `${speedLabel} SLOW MOTION`;
  const recLabel = cue.isReplay ? '● PLAY OF THE MATCH' : '● KILL CAM';
  const dodgeClass = dodgeRight ? ' tt-killcam--dodge-right' : '';

  const style = {
    '--kc-slam': `${timing.slamMs}ms`,
    '--kc-slow': `${timing.slowMs}ms`,
    '--kc-out': `${timing.recoverMs}ms`,
    '--kc-sweep': `${timing.slamMs + timing.slowMs}ms`,
    '--kc-accent': accent,
    '--kc-accent-ink': accentInk,
    '--kc-victim': victimInk,
  } as React.CSSProperties;

  const receiptSteps = buildReceiptSteps(cue.breakdown, cue.damage, cue.subject === 'KILL');

  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    fxTimeline.skipKillCam();
  };

  // ── Stage 0: Land Mine "*click*" ARM micro-tension beat (both non-lethal & lethal mines) ──
  if (frame.phase === 'ARM') {
    return (
      <div
        className={`tt-killcam tt-killcam--prelude tt-killcam--arm${dodgeClass}`}
        data-tier={cue.tier}
        style={style}
        onClick={canSkip ? handleSkip : undefined}
        aria-hidden="true"
      >
        <div className="tt-killcam__vignette" />
        <BracketFrame prelude />
        <div className="tt-killcam__slugline tt-killcam__slugline--mine">
          <span className="tt-killcam__rec">● PROXIMITY MINE</span>
          <span className="tt-killcam__slugline-sep">/</span>
          <span>*CLICK*</span>
        </div>
      </div>
    );
  }

  // ── Non-lethal Attack Micro-Cam & 1-HP Graze Fake-Out (plus 3.5s Tactical Cinema & Air Drop cuts) ──
  if (isAttack) {
    const isGraze = frame.cameraStyle === 'GRAZE_FAKEOUT';
    const isMineAttack = cue.cause === 'MINE';
    const isAirSupplyDrop = !cue.tacticalItemKey && cue.cause === 'TACTICAL' && Boolean(cue.title);
    const tacSpec = cue.tacticalItemKey ? TACTICAL_VISUAL_STYLE[cue.tacticalItemKey] : undefined;
    const tacStyle = tacSpec
      ? ({ ...style, '--kc-accent': tacSpec.primaryHex } as React.CSSProperties)
      : isMineAttack
        ? ({ ...style, '--kc-accent': '#F97316' } as React.CSSProperties)
        : isAirSupplyDrop
          ? ({ ...style, '--kc-accent': cue.title?.includes('TACTICAL') || cue.title?.includes('DUAL') ? '#FACC15' : '#22D3EE' } as React.CSSProperties)
          : style;
    const tacSlug =
      isAirSupplyDrop
        ? (cue.title ?? 'AIR SUPPLY DROP')
        : cue.tacticalItemKey === 'PARADROP'
        ? 'AIRLIFT INBOUND'
        : cue.tacticalItemKey === 'RECON_DRONE'
          ? 'HUNTER UAV LOCK'
          : cue.tacticalItemKey === 'CARPET_RUN'
            ? 'TRI-STRIKE BOMBER'
            : cue.tacticalItemKey === 'NAPALM_LINE'
              ? 'INCENDIARY RUN'
              : cue.tacticalItemKey === 'ARTILLERY_BARRAGE'
                ? '2×10 CREEPING BARRAGE'
                : cue.tacticalItemKey === 'PRECISION_STRIKE'
                  ? 'ORBITAL LOCK-ON'
                  : 'TACTICAL STRIKE';

    if (frame.phase === 'PUSH') {
      return (
        <div
          className={`tt-killcam tt-killcam--prelude tt-killcam--attack${dodgeClass}`}
          data-tier="ATTACK"
          style={tacStyle}
          aria-hidden="true"
        >
          <BracketFrame prelude />
          {isTacticalCinematicAttack && (
            <div className="tt-killcam__slugline">
              <span className="tt-killcam__rec">● TACTICAL CAM</span>
              <span className="tt-killcam__slugline-sep">/</span>
              <span>{tacSlug}</span>
            </div>
          )}
        </div>
      );
    }

    const weaponLabel = cue.weapon ? KILL_CAM_WEAPON_LABEL[cue.weapon] : KILL_CAM_CAUSE_LABEL[cue.cause];
    const isTacticalNonDamaging = Boolean((cue.tacticalItemKey || isAirSupplyDrop) && cue.damage === 0);
    const grazeTease = isGraze && !frame.grazeFlipped;
    const grazeSurvived = isGraze && frame.grazeFlipped;

    return (
      <div
        key={`atk-${cue.id}-${grazeSurvived ? 'surv' : 'hit'}`}
        className={`tt-killcam tt-killcam--slam tt-killcam--attack${dodgeClass}${grazeTease ? ' tt-killcam--graze-tease' : ''}${grazeSurvived ? ' tt-killcam--graze-survive' : ''}`}
        data-tier="ATTACK"
        style={tacStyle}
        aria-hidden="true"
      >
        {grazeTease && <div className="tt-killcam__graze-flash" />}
        {grazeSurvived && <div className="tt-killcam__glitch-bar" />}
        {isTacticalCinematicAttack && timing.letterbox > 0 && (
          <>
            <div className="tt-killcam__bar tt-killcam__bar--top">
              <span className="tt-killcam__rec">● TACTICAL CAM</span>
              <span className="tt-killcam__bar-net">
                TURN {turn} · {tacSlug}
              </span>
            </div>
            <div className="tt-killcam__bar tt-killcam__bar--bottom">
              <span className="tt-killcam__bar-brand">TACTICAL TILES</span>
              <span className="tt-killcam__bar-net">{killerName.toUpperCase()} · PRESS SPACE TO SKIP</span>
            </div>
          </>
        )}

        <div
          className={`tt-killcam__attack-hud${grazeTease ? ' tt-killcam__attack-hud--tease' : ''}${grazeSurvived ? ' tt-killcam__attack-hud--survive' : ''}${isTacticalNonDamaging ? ' tt-killcam__attack-hud--tactical' : ''}`}
        >
          <span className="tt-killcam__attack-eyebrow">
            {grazeTease
              ? '● CRITICAL IMPACT'
              : grazeSurvived
                ? '◆ ARMOR DEFLECTED · GRAZE'
                : isMineAttack
                  ? '● LAND MINE BLAST'
                  : isAirSupplyDrop
                    ? '✈ THEATER AIR SUPPLY'
                    : tacSpec
                      ? `◆ ${tacSpec.callsign}`
                      : cue.cause === 'OVERWATCH'
                        ? 'OVERWATCH HIT'
                        : weaponLabel}
          </span>
          <div className="tt-killcam__attack-row">
            {isTacticalNonDamaging ? (
              <span className="tt-killcam__attack-tac-title">{narrative.headline}</span>
            ) : (
              <>
                <span className="tt-killcam__attack-dmg">−{cue.damage}</span>
                {cue.victimName && <span className="tt-killcam__attack-unit">{victimUnitLabel}</span>}
              </>
            )}
          </div>
          <div className="tt-killcam__attack-meta">
            {grazeSurvived ? (
              <span className="tt-killcam__attack-survive">1 HP · BARELY ALIVE!</span>
            ) : grazeTease ? (
              <span className="tt-killcam__attack-tease-label">LETHAL CHECK...</span>
            ) : isMineAttack && cue.remainingHp === 1 ? (
              <span className="tt-killcam__attack-survive">1 HP · BARELY ALIVE! · MINE DESTROYED</span>
            ) : isTacticalNonDamaging ? (
              <span>{isAirSupplyDrop ? (cue.detail ?? 'MYSTERY CRATE · CONTEST LZ') : `${killerName.toUpperCase()} · TACTICAL OPS`}</span>
            ) : cue.remainingHp !== undefined && cue.maxHp > 0 ? (
              <span>
                {cue.remainingHp} / {cue.maxHp} HP LEFT{isMineAttack ? ' · MOVE STOPPED' : ''}
              </span>
            ) : (
              <span>
                {isMineAttack ? 'BLAST TRIGGERED · MINE CLEARED' : cue.tacticalItemKey ? `${narrative.headline} · DIRECT HIT` : 'DIRECT HIT'}
              </span>
            )}
            {cue.crossfireCount > 0 && (
              <span className="tt-killcam__chip tt-killcam__chip--hot">CROSSFIRE ×{cue.crossfireCount}</span>
            )}
          </div>
          {receiptSteps.length > 0 && !grazeTease && (
            <div className="tt-killcam__receipt tt-killcam__receipt--compact">
              {receiptSteps.map((st, idx) => (
                <span key={idx} className={`tt-killcam__rstep tt-killcam__rstep--${st.tone}`}>
                  {st.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Stage 1: lethal round in flight ─────────────────────────────────────────
  if (frame.phase === 'PUSH') {
    const isOwSnap = frame.cameraStyle === 'OVERWATCH_SNAP';
    return (
      <div
        className={`tt-killcam tt-killcam--prelude tt-killcam--${cue.tier.toLowerCase()}${dodgeClass}${isOwSnap ? ' tt-killcam--ow-snap' : ''}`}
        data-tier={cue.tier}
        style={style}
        onClick={handleSkip}
        aria-hidden="true"
      >
        <div className="tt-killcam__vignette" />
        {isOwSnap && <div className="tt-killcam__glitch-bar" />}
        <BracketFrame prelude />
        <div className="tt-killcam__slugline">
          <span className="tt-killcam__rec">{recLabel}</span>
          <span className="tt-killcam__slugline-sep">/</span>
          <span>
            {isOwSnap
              ? 'OVERWATCH INTERCEPT'
              : frame.cameraStyle === 'CROSSFIRE_TRIANGLE'
                ? 'CROSSFIRE LOCK'
                : frame.cameraStyle === 'SNIPER_WHIP'
                  ? 'RAIL TRACKING'
                  : frame.cameraStyle === 'ORBITAL_DROP'
                    ? 'ORBITAL LOCK-ON'
                    : frame.cameraStyle === 'BOMBER_TRACK'
                      ? cue.tacticalItemKey === 'RECON_DRONE'
                        ? 'HUNTER UAV INTERCEPT'
                        : cue.tacticalItemKey === 'CARPET_RUN'
                          ? 'TRI-STRIKE BOMBER'
                          : 'STRIKE FLYOVER'
                      : frame.cameraStyle === 'BARRAGE_WALK'
                        ? '2×10 CREEPING BARRAGE'
                        : frame.cameraStyle === 'THEATER_SWEEP'
                          ? 'THEATER TELEMETRY'
                          : 'ROUND IN FLIGHT'}
          </span>
        </div>
        <button type="button" className="tt-killcam__skip" onClick={handleSkip} title="Skip kill cam (Space / Esc)">
          SKIP · SPACE
        </button>
      </div>
    );
  }

  // ── Stage 2: lethal blow lands ──────────────────────────────────────────────
  const preHp = cue.victimPreHp ?? cue.maxHp;
  const isOneShot = !isStructure && cue.maxHp > 0 && preHp >= cue.maxHp && cue.damage >= cue.maxHp;
  const badgeChips = narrative.tags.filter(t => t !== 'CROSSFIRE' && t !== 'GRAZE' && t !== 'OVERKILL');

  return (
    <div
      key={`kill-${cue.id}-${frame.combo}`}
      className={`tt-killcam tt-killcam--slam tt-killcam--${cue.tier.toLowerCase()}${dodgeClass}${narrative.accentGold ? ' tt-killcam--gold' : ''}`}
      data-tier={cue.tier}
      style={style}
      onClick={handleSkip}
      role="status"
      aria-live="polite"
    >
      <div className="tt-killcam__bar tt-killcam__bar--top">
        <span className="tt-killcam__rec">{recLabel}</span>
        <span className="tt-killcam__bar-net">
          TURN {turn} · {slug}
        </span>
      </div>
      <div className="tt-killcam__bar tt-killcam__bar--bottom">
        <span className="tt-killcam__bar-brand">TACTICAL TILES</span>
        <span className="tt-killcam__bar-net">
          {isStructure
            ? cue.detail ?? 'STRUCTURE LOST'
            : cue.hasVisibleOrigin === false
              ? 'UNSEEN SHOOTER'
              : cue.distanceTiles > 0
                ? `${cue.distanceTiles.toFixed(1)} TILES`
                : 'CLOSE QUARTERS'}
        </span>
      </div>

      <div className="tt-killcam__vignette" />
      <div className="tt-killcam__flash" />
      <div className="tt-killcam__scan" />
      <BracketFrame />

      <div className="tt-killcam__speed" aria-hidden="true">
        <span className="tt-killcam__speed-dot" />
        {speedLabel}
      </div>

      <div className="tt-killcam__headline-wrap">
        <div className="tt-killcam__eyebrow">
          <span className="tt-killcam__rec">●</span> {narrative.eyebrow}
        </div>
        <div className="tt-killcam__headline">{narrative.headline}</div>
      </div>

      {/* Off-center damage telemetry: dodges automatically to left flank on upper-right corner kills */}
      <div className="tt-killcam__stamp">
        {cue.damage > 0 && <span className="tt-killcam__damage">−{cue.damage}</span>}
        <span className="tt-killcam__hp">
          {isStructure
            ? 'STRUCTURE IMPACT'
            : isOneShot
              ? <>ONE-SHOT · {cue.maxHp} HP → 0</>
              : cue.victimPreHp !== undefined
                ? <>{cue.victimPreHp} HP → 0</>
                : <>LETHAL · {cue.maxHp} MAX HP</>}
          {cue.overkill > 0 ? ` · OVERKILL +${cue.overkill}` : ''}
        </span>
        {receiptSteps.length > 0 && (
          <div className="tt-killcam__receipt" aria-label="Damage breakdown">
            {receiptSteps.map((st, idx) => (
              <span
                key={idx}
                className={`tt-killcam__rstep tt-killcam__rstep--${st.tone}`}
                style={{ animationDelay: `${90 + idx * 45}ms` }}
              >
                {st.text}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="tt-killcam__cards">
        <div className="tt-killcam__card tt-killcam__card--killer">
          <span className="tt-killcam__role">{isStructure ? 'DEMOLITION' : 'EXECUTIONER'}</span>
          <span className="tt-killcam__name" style={{ color: accent }}>
            {killerName}
          </span>
          <span className="tt-killcam__meta">
            {cue.weapon
              ? KILL_CAM_WEAPON_LABEL[cue.weapon]
              : isStructure
                ? cue.structureType === 'BANK'
                  ? 'VAULT DEMOLITION'
                  : 'BASE SIEGE'
                : KILL_CAM_CAUSE_LABEL[cue.cause]}
          </span>
        </div>

        <div className="tt-killcam__slash" aria-hidden="true">
          <span />
        </div>

        <div className="tt-killcam__card tt-killcam__card--victim">
          <span className="tt-killcam__role">{isStructure ? 'DESTROYED' : 'ELIMINATED'}</span>
          <span className="tt-killcam__name">{victimUnitLabel}</span>
          <span className="tt-killcam__meta">
            {isStructure ? (
              <>{cue.victimOwner !== undefined ? victimOwnerName : 'NEUTRAL'} · STRUCTURE</>
            ) : (
              <>{victimOwnerName} · {rankLabel}</>
            )}
          </span>
        </div>
      </div>

      {isStructure && cue.detail && (
        <div className="tt-killcam__chips">
          <span className="tt-killcam__chip tt-killcam__chip--gold">{cue.detail}</span>
        </div>
      )}

      {cinematic && (
        <div className="tt-killcam__chips">
          {badgeChips.map(tag => {
            const spec = TAG_CHIP_LABEL[tag];
            return (
              <span key={tag} className={`tt-killcam__chip tt-killcam__chip--${spec.tone}`}>
                {spec.label}
              </span>
            );
          })}
          {cue.crossfireCount > 0 && (
            <span className="tt-killcam__chip tt-killcam__chip--hot">CROSSFIRE ×{cue.crossfireCount}</span>
          )}
          {cue.terrain && TERRAIN_LABEL[cue.terrain] && (
            <span className="tt-killcam__chip">{TERRAIN_LABEL[cue.terrain]}</span>
          )}
          {victimRank >= 3 && (
            <span className="tt-killcam__chip tt-killcam__chip--gold">
              ACE BOUNTY +€{VETERANCY_CONFIG.ACE_BOUNTY_GOLD}
            </span>
          )}
          {frame.combo > 1 && <span className="tt-killcam__chip tt-killcam__chip--hot">CHAIN ×{frame.combo}</span>}
        </div>
      )}

      <button type="button" className="tt-killcam__skip" onClick={handleSkip} title="Skip kill cam (Space / Esc)">
        SKIP · SPACE
      </button>

      <span className="tt-killcam__sr">
        {narrative.headline}: {killerName} {isStructure ? 'destroyed' : 'eliminated'} {victimUnitLabel}
        {!isStructure ? ` (${victimOwnerName} ${rankLabel})` : ''}
        {cue.damage > 0 ? ` for ${cue.damage} damage` : ''}.
      </span>
    </div>
  );
};
