import React, { useCallback, useMemo } from 'react';
import { Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { BoardRotation } from '../../../core/boardRotation';

const APRON_TILES = 4;
const APRON_PX = APRON_TILES * TILE_SIZE; // 256px bleed beyond every map edge

const COORD_LABEL_STYLE = new PIXI.TextStyle({
  fontFamily: '"Space Grotesk", ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 10,
  fontWeight: '700',
  fill: '#64748B',
  letterSpacing: 1.5,
});

const colLetter = (idx: number): string => {
  if (idx < 26) return String.fromCharCode(65 + idx);
  return `${String.fromCharCode(65 + Math.floor(idx / 26) - 1)}${String.fromCharCode(65 + (idx % 26))}`;
};

interface PerimeterApronLayerProps {
  gridSize: number;
  mapRotation: BoardRotation;
}

/**
 * Dark anodized Command-Table Topo Perimeter Apron extending 4 tiles (256 px) beyond all 4 sides
 * of the playable battlefield. Eliminates flat light-grey void during corner kill-cam zooms,
 * Dutch-tilt rotations, and 14 px trauma camera shakes while framing the map like a war table.
 */
export const PerimeterApronLayer: React.FC<PerimeterApronLayerProps> = React.memo(({ gridSize, mapRotation }) => {
  const boardSize = gridSize * TILE_SIZE;

  const drawApron = useCallback((g: PIXI.Graphics) => {
    g.clear();
    const min = -APRON_PX;
    const max = boardSize + APRON_PX;
    const span = max - min;

    // 4 dark outer perimeter slabs (never overdraws the inner playable terrain)
    g.beginFill(0x0B1220, 1);
    g.drawRect(min, min, span, APRON_PX); // Top
    g.drawRect(min, boardSize, span, APRON_PX); // Bottom
    g.drawRect(min, 0, APRON_PX, boardSize); // Left
    g.drawRect(boardSize, 0, APRON_PX, boardSize); // Right
    g.endFill();

    // Subtle 64px tactical topo grid lines across the outer table margin
    g.lineStyle(1, 0x334155, 0.24);
    for (let x = min; x <= max; x += TILE_SIZE) {
      if (x > 0 && x < boardSize) {
        g.moveTo(x, min);
        g.lineTo(x, 0);
        g.moveTo(x, boardSize);
        g.lineTo(x, max);
      } else {
        g.moveTo(x, min);
        g.lineTo(x, max);
      }
    }
    for (let y = min; y <= max; y += TILE_SIZE) {
      if (y > 0 && y < boardSize) {
        g.moveTo(min, y);
        g.lineTo(0, y);
        g.moveTo(boardSize, y);
        g.lineTo(max, y);
      } else {
        g.moveTo(min, y);
        g.lineTo(max, y);
      }
    }

    // Subtle recessed steel table shadow around the playable map rim
    g.lineStyle(12, 0x020617, 0.55);
    g.drawRect(-6, -6, boardSize + 12, boardSize + 12);

    // Fine diagonal caution hatch strip right outside the steel frame (14px band)
    g.lineStyle(1.2, 0x38BDF8, 0.14);
    const step = 16;
    for (let i = 0; i < boardSize; i += step) {
      // Top & bottom ticks
      g.moveTo(i, -12);
      g.lineTo(i + 8, -4);
      g.moveTo(i, boardSize + 4);
      g.lineTo(i + 8, boardSize + 12);
      // Left & right ticks
      g.moveTo(-12, i);
      g.lineTo(-4, i + 8);
      g.moveTo(boardSize + 4, i);
      g.lineTo(boardSize + 12, i + 8);
    }

    // Crisp outer rim line & corner brackets framing the tactical table
    g.lineStyle(2, 0x475569, 0.72);
    g.drawRect(-14, -14, boardSize + 28, boardSize + 28);

    // Corner precision ticks
    const cArm = 26;
    g.lineStyle(2.5, 0x38BDF8, 0.45);
    // TL
    g.moveTo(-22, -22 + cArm); g.lineTo(-22, -22); g.lineTo(-22 + cArm, -22);
    // TR
    g.moveTo(boardSize + 22 - cArm, -22); g.lineTo(boardSize + 22, -22); g.lineTo(boardSize + 22, -22 + cArm);
    // BR
    g.moveTo(boardSize + 22, boardSize + 22 - cArm); g.lineTo(boardSize + 22, boardSize + 22); g.lineTo(boardSize + 22 - cArm, boardSize + 22);
    // BL
    g.moveTo(-22 + cArm, boardSize + 22); g.lineTo(-22, boardSize + 22); g.lineTo(-22, boardSize + 22 - cArm);
    g.lineStyle(0);
  }, [boardSize]);

  // Precompute every-2-tiles coordinate labels around the board perimeter (upright in screen space)
  const ticks = useMemo(() => {
    const items: { key: string; text: string; x: number; y: number }[] = [];
    for (let i = 0; i < gridSize; i += 2) {
      const mid = i * TILE_SIZE + TILE_SIZE / 2;
      const col = colLetter(i);
      const row = String(i + 1).padStart(2, '0');
      items.push({ key: `t_${i}`, text: col, x: mid, y: -24 });
      items.push({ key: `b_${i}`, text: col, x: mid, y: boardSize + 24 });
      items.push({ key: `l_${i}`, text: row, x: -26, y: mid });
      items.push({ key: `r_${i}`, text: row, x: boardSize + 26, y: mid });
    }
    return items;
  }, [gridSize, boardSize]);

  return (
    <Container name="command_table_perimeter" eventMode="none">
      <Graphics draw={drawApron} eventMode="none" />
      <Container
        x={boardSize / 2}
        y={boardSize / 2}
        pivot={{ x: boardSize / 2, y: boardSize / 2 }}
        angle={mapRotation}
        eventMode="none"
      >
        {ticks.map(t => (
          <Text
            key={t.key}
            text={t.text}
            x={t.x}
            y={t.y}
            anchor={0.5}
            angle={-mapRotation}
            style={COORD_LABEL_STYLE}
          />
        ))}
      </Container>
    </Container>
  );
});
