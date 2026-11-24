import React, { useEffect } from 'react';
import { useEffectStore } from '../../../store/useEffectStore';
import { useGameStore } from '../../../store/useGameStore';
import { useOnline } from '../../../net/useOnline';
import { PLAYER_UI_THEME, playerDisplayName } from '../../ui/GeoPrimitives';

/**
 * Non-blocking chamfered hardware callout toast (`ELIMINATED!`, `ACE DOWN!`,
 * `VAULT BREACHED!`, `BASE BREACHED!`) synced to combat impact via `fxTimeline`.
 * Positioned in the upper battlefield lane so it never overlaps `TurnBanner`.
 */
export const TacticalBanner: React.FC = () => {
  const activeCallout = useEffectStore(s => s.activeCallout);
  const dismissCallout = useEffectStore(s => s.dismissCallout);
  const mode = useGameStore(s => s.mode);
  const playerNames = useGameStore(s => s.settings.playerNames);
  const seats = useOnline(s => (mode === 'ONLINE' ? s.view?.seats : undefined));

  useEffect(() => {
    if (!activeCallout) return;
    const id = activeCallout.id;
    const timer = setTimeout(() => dismissCallout(id), activeCallout.durationMs);
    return () => clearTimeout(timer);
  }, [activeCallout, dismissCallout]);

  if (!activeCallout) return null;

  const hasFaction =
    activeCallout.accentPlayer !== null &&
    activeCallout.accentPlayer >= 0 &&
    Boolean(PLAYER_UI_THEME[activeCallout.accentPlayer]);

  const theme = hasFaction ? PLAYER_UI_THEME[activeCallout.accentPlayer!] : null;

  let plateBg = '#1E293B';
  let plateText = '#F8FAFC';
  let accentBar = '#EF4444';

  if (activeCallout.tone === 'heist') {
    plateBg = '#B45309';
    plateText = '#FFFBEB';
    accentBar = '#FDE047';
  } else if (activeCallout.tone === 'base') {
    plateBg = theme ? theme.badgeBg : '#B91C1C';
    plateText = theme ? theme.badgeText : '#FFFFFF';
    accentBar = '#FDE047';
  } else if (activeCallout.tone === 'ace') {
    plateBg = theme ? theme.badgeBg : '#1E293B';
    plateText = theme ? theme.badgeText : '#FFFBEB';
    accentBar = '#FACC15';
  } else if (theme) {
    plateBg = theme.badgeBg;
    plateText = theme.badgeText;
    accentBar = '#FFFFFF';
  }

  const actorTag =
    hasFaction && activeCallout.accentPlayer !== null
      ? playerDisplayName(activeCallout.accentPlayer, playerNames, seats?.[activeCallout.accentPlayer]?.name)
      : null;

  return (
    <div
      className="tt-tactical-banner"
      key={activeCallout.id}
      style={{ ['--tt-callout-ms' as string]: `${activeCallout.durationMs}ms` }}
      role="status"
      aria-live="polite"
    >
      <div
        className="tt-tactical-banner__plate"
        style={{ background: plateBg, color: plateText, borderLeft: `5px solid ${accentBar}` }}
      >
        <span className="tt-tactical-banner__title">{activeCallout.headline}</span>
        <span className="tt-tactical-banner__sub">
          {actorTag ? `${actorTag} · ${activeCallout.subtext}` : activeCallout.subtext}
        </span>
      </div>
    </div>
  );
};
