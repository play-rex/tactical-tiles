import { useEffect } from 'react';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import { useViewportContext } from '../../../context/ViewportContext';
import { useGameStore } from '../../../store/useGameStore';
import { wakeBattleRenderer } from '../../../store/useEffectStore';
import { rotateBoardPoint } from '../../../core/boardRotation';

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
    if (!viewport || viewport.destroyed || tileIds.length === 0) return;
    const { mapData, gridSize, mapRotation } = useGameStore.getState();
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const id of tileIds) {
      const t = getTileByIdFast(mapData, id, gridSize);
      if (t) {
        sumX += t.x;
        sumY += t.y;
        count++;
      }
    }
    if (count === 0) return;
    const rawX = (sumX / count + 0.5) * TILE_SIZE;
    const rawY = (sumY / count + 0.5) * TILE_SIZE;
    const { x, y } = rotateBoardPoint(rawX, rawY, mapRotation, gridSize * TILE_SIZE);
    wakeBattleRenderer(500);
    viewport.animate({ position: { x, y }, time: 400, ease: 'easeInOutQuad' });
  };

  useEffect(() => {
    if (!myMove || !viewport || viewport.destroyed) return;
    const { units, currentPlayer } = useGameStore.getState();
    glideTo(units.filter(u => u.owner === currentPlayer).map(u => u.tileId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myMove, turnCounter, viewport]);

  useEffect(() => {
    if (!selectedUnitId || !viewport || viewport.destroyed) return;
    const unit = useGameStore.getState().units.find(u => u.id === selectedUnitId);
    if (unit) glideTo([unit.tileId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnitId, viewport]);

  return null;
};
