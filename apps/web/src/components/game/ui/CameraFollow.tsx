import { useEffect } from 'react';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import { useViewportContext } from '../../../context/ViewportContext';
import { useGameStore } from '../../../store/useGameStore';
import { wakeBattleRenderer } from '../../../store/useEffectStore';

/**
 * On a phone only part of the map fits: glide to your squad when your turn starts, and to
 * each unit you pick. (On a desktop the whole map is in view, so this isn't mounted.)
 */
export const CameraFollow = () => {
  const { viewport } = useViewportContext();
  const selectedUnitId = useGameStore(s => s.selectedUnitId);
  const turnCounter = useGameStore(s => s.turnCounter);
  const myMove = useGameStore(s => !s.isAiTurn && s.winner === null);

  const glideTo = (tileIds: string[]) => {
    const { mapData, gridSize } = useGameStore.getState();
    const tiles = tileIds.map(id => getTileByIdFast(mapData, id, gridSize)).filter(Boolean);
    if (!viewport || tiles.length === 0) return;
    const x = (tiles.reduce((sum, t) => sum + t!.x, 0) / tiles.length + 0.5) * TILE_SIZE;
    const y = (tiles.reduce((sum, t) => sum + t!.y, 0) / tiles.length + 0.5) * TILE_SIZE;
    wakeBattleRenderer(500);
    viewport.animate({ position: { x, y }, time: 400, ease: 'easeInOutQuad' });
  };

  useEffect(() => {
    if (!myMove) return;
    const { units, currentPlayer } = useGameStore.getState();
    glideTo(units.filter(u => u.owner === currentPlayer).map(u => u.tileId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMove, turnCounter, viewport]);

  useEffect(() => {
    const unit = useGameStore.getState().units.find(u => u.id === selectedUnitId);
    if (unit) glideTo([unit.tileId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnitId]);

  return null;
};
