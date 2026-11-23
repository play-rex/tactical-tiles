import React, { useEffect, useState } from 'react';
import { useGameStore } from '../../../store/useGameStore';
import { useOnline } from '../../../net/useOnline';
import { PLAYER_UI_THEME, playerDisplayName } from '../../ui/GeoPrimitives';

/**
 * A banner over the map each time you can act: your turn online or against the AI, and each
 * player's turn at a shared screen (so the next player knows to take the device).
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
  const seatName = useOnline(s => (mode === 'ONLINE' ? s.view?.seats[currentPlayer]?.name : undefined));
  const displayName = playerDisplayName(currentPlayer, playerNames, seatName);
  const [shown, setShown] = useState<number | null>(null);

  const myMove = !isAiTurn && winner === null;
  useEffect(() => {
    if (!myMove) return;
    setShown(turnCounter);
    const t = setTimeout(() => setShown(null), 1700);
    return () => clearTimeout(t);
  }, [myMove, turnCounter, currentPlayer]);

  if (shown === null || !myMove) return null;
  const theme = PLAYER_UI_THEME[currentPlayer] ?? PLAYER_UI_THEME[0];
  const sharedScreen = mode === 'LOCAL' && gameMode !== 'PVE';
  const title = sharedScreen ? `${displayName} — you're up` : `${displayName} — your turn`;

  return (
    <div className="tt-turn-banner" key={`${shown}-${currentPlayer}`} role="status" aria-live="polite">
      <div className="tt-turn-banner__plate" style={{ background: theme.badgeBg, color: theme.badgeText }}>
        <span className="tt-turn-banner__title">{title}</span>
        <span className="tt-turn-banner__sub">
          Round {totalTurns + 1} · Player {currentPlayer + 1}
        </span>
      </div>
    </div>
  );
};
