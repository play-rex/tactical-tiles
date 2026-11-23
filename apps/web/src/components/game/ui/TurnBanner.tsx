import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../../store/useGameStore';
import { useOnline } from '../../../net/useOnline';
import { PLAYER_UI_THEME, playerDisplayName } from '../../ui/GeoPrimitives';

/**
 * A banner over the map at the start of every turn: calls out your turn to act,
 * other players' turns online / vs AI, and who takes the device on shared-screen play.
 */
export const TurnBanner: React.FC = () => {
  const currentPlayer = useGameStore(s => s.currentPlayer);
  const turnCounter = useGameStore(s => s.turnCounter);
  const totalTurns = useGameStore(s => s.totalTurns);
  const isAiTurn = useGameStore(s => s.isAiTurn);
  const winner = useGameStore(s => s.winner);
  const mode = useGameStore(s => s.mode);
  const gameMode = useGameStore(s => s.settings.gameMode);
  const playerNames = useGameStore(s => s.settings.playerNames);
  const activeSeat = useOnline(s => (mode === 'ONLINE' ? s.view?.seats[currentPlayer] : undefined));
  const displayName = playerDisplayName(currentPlayer, playerNames, activeSeat?.name);
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (winner !== null) {
      setShown(null);
      return;
    }
    setShown(turnCounter);
    const t = setTimeout(() => setShown(null), 1700);
    return () => clearTimeout(t);
  }, [turnCounter, currentPlayer, winner]);

  if (shown === null || winner !== null) return null;
  const theme = PLAYER_UI_THEME[currentPlayer] ?? PLAYER_UI_THEME[0];
  const sharedScreen = mode === 'LOCAL' && gameMode !== 'PVE';
  const title = isAiTurn
    ? `${displayName}'s Turn`
    : sharedScreen
      ? `${displayName} — You're Up`
      : `${displayName} — Your Turn`;
  const roleTag = isAiTurn
    ? activeSeat?.isBot
      ? ' · Bot'
      : mode === 'LOCAL' && gameMode === 'PVE'
        ? ' · AI'
        : ''
    : '';

  return (
    <div className="tt-turn-banner" key={`${shown}-${currentPlayer}`} role="status" aria-live="polite">
      <div className="tt-turn-banner__plate" style={{ background: theme.badgeBg, color: theme.badgeText }}>
        <span className="tt-turn-banner__title">{title}</span>
        <span className="tt-turn-banner__sub">
          Round {totalTurns + 1} · Player {currentPlayer + 1}{roleTag}
        </span>
      </div>
    </div>
  );
};
