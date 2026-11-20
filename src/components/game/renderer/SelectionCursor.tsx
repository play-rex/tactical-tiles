import React, { useRef, useCallback } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '../../../core/constants/Config';

interface SelectionCursorProps {
    x: number;
    y: number;
}

export const SelectionCursor: React.FC<SelectionCursorProps> = ({ x, y }) => {
    const graphicsRef = useRef<PIXI.Graphics>(null);
    const timeRef = useRef(0);

    useTick((delta) => {
        timeRef.current += 0.1 * delta;
        if (graphicsRef.current) {
            graphicsRef.current.alpha = 0.8 + Math.sin(timeRef.current) * 0.2;
        }
    });

    const draw = useCallback((g: PIXI.Graphics) => {
        g.clear();
        const color = 0x00FF00;
        g.lineStyle(2, color, 1);

        const cornerLen = 8;

        // Top Left
        g.moveTo(0, cornerLen);
        g.lineTo(0, 0);
        g.lineTo(cornerLen, 0);

        // Top Right
        g.moveTo(TILE_SIZE - cornerLen, 0);
        g.lineTo(TILE_SIZE, 0);
        g.lineTo(TILE_SIZE, cornerLen);

        // Bottom Right
        g.moveTo(TILE_SIZE, TILE_SIZE - cornerLen);
        g.lineTo(TILE_SIZE, TILE_SIZE);
        g.lineTo(TILE_SIZE - cornerLen, TILE_SIZE);

        // Bottom Left
        g.moveTo(cornerLen, TILE_SIZE);
        g.lineTo(0, TILE_SIZE);
        g.lineTo(0, TILE_SIZE - cornerLen);
    }, []);

    return (
        <Graphics
            ref={graphicsRef}
            draw={draw}
            x={x}
            y={y}
        />
    );
};
