import React, { useRef, useCallback } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { Projectile } from '../../../store/useEffectStore';
import { fxTimeline } from '../../../core/graphics/fxTimeline';

interface ProjectileRendererProps {
    data: Projectile;
}

export const ProjectileRenderer: React.FC<ProjectileRendererProps> = ({ data }) => {
    const graphicsRef = useRef<PIXI.Graphics>(null);
    const elapsedRef = useRef(0);

    useTick(() => {
        const g = graphicsRef.current;
        if (!g || g.destroyed) return;

        const dtMs = fxTimeline.getLastCombatDtMs();
        elapsedRef.current += dtMs;

        const travelMs = Math.max(80, data.travelMs || 170);
        const progress = Math.min(1, elapsedRef.current / travelMs);

        g.clear();

        if (data.type === 'LASER') {
            const fadeMs = 90;
            const afterProgress = Math.max(0, (elapsedRef.current - travelMs) / fadeMs);
            if (afterProgress >= 1) return;
            const beamAlpha = progress < 1 ? 0.95 : 1 - afterProgress;
            const headX = data.startX + (data.endX - data.startX) * progress;
            const headY = data.startY + (data.endY - data.startY) * progress;
            const tailFrac = Math.max(0, progress - 0.65);
            const tailX = data.startX + (data.endX - data.startX) * tailFrac;
            const tailY = data.startY + (data.endY - data.startY) * tailFrac;

            g.lineStyle(6, data.color, beamAlpha * 0.35);
            g.moveTo(tailX, tailY);
            g.lineTo(headX, headY);
            g.lineStyle(2.5, 0xFFFBEB, beamAlpha);
            g.moveTo(tailX, tailY);
            g.lineTo(headX, headY);
            return;
        }

        if (progress >= 1) return;

        const currentX = data.startX + (data.endX - data.startX) * progress;
        const currentY = data.startY + (data.endY - data.startY) * progress;
        const trailSpan = data.type === 'MISSILE' ? 0.32 : 0.26;
        const trailStart = Math.max(0, progress - trailSpan);
        const tailX = data.startX + (data.endX - data.startX) * trailStart;
        const tailY = data.startY + (data.endY - data.startY) * trailStart;

        // Soft outer tracer glow
        g.lineStyle(data.type === 'MISSILE' ? 6 : 4.5, data.color, 0.35);
        g.moveTo(tailX, tailY);
        g.lineTo(currentX, currentY);

        // Crisp hot inner tracer
        g.lineStyle(data.type === 'MISSILE' ? 2.5 : 2, 0xFFFBEB, 0.92);
        g.moveTo(tailX, tailY);
        g.lineTo(currentX, currentY);
        g.lineStyle(0);

        // Projectile head
        g.beginFill(data.color, 0.95);
        g.drawCircle(currentX, currentY, data.type === 'MISSILE' ? 5 : 3.8);
        g.endFill();
        g.beginFill(0xFFFFFF, 1);
        g.drawCircle(currentX, currentY, data.type === 'MISSILE' ? 2.5 : 1.8);
        g.endFill();
    });

    const initialDraw = useCallback((g: PIXI.Graphics) => {
        g.clear();
    }, []);

    return <Graphics ref={graphicsRef} draw={initialDraw} eventMode="none" />;
};
