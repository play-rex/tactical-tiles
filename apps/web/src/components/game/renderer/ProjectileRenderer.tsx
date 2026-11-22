import React, { useRef, useCallback } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';

interface ProjectileRendererProps {
    data: {
        id: string;
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        color: number;
    }
}

export const ProjectileRenderer: React.FC<ProjectileRendererProps> = ({ data }) => {
    const graphicsRef = useRef<PIXI.Graphics>(null);
    const progressRef = useRef(0);

    useTick((delta) => {
        const g = graphicsRef.current;
        if (!g) return;

        progressRef.current = Math.min(1, progressRef.current + 0.2 * delta);
        const progress = progressRef.current;

        g.clear();
        if (progress >= 1) return;

        const currentX = data.startX + (data.endX - data.startX) * progress;
        const currentY = data.startY + (data.endY - data.startY) * progress;

        g.beginFill(data.color);
        g.drawCircle(currentX, currentY, 4);
        g.endFill();

        const trailStart = Math.max(0, progress - 0.2);
        g.lineStyle(2, data.color, 0.5);
        g.moveTo(
            data.startX + (data.endX - data.startX) * trailStart,
            data.startY + (data.endY - data.startY) * trailStart
        );
        g.lineTo(currentX, currentY);
    });

    const initialDraw = useCallback((g: PIXI.Graphics) => {
        g.clear();
    }, []);

    return <Graphics ref={graphicsRef} draw={initialDraw} />;
};
