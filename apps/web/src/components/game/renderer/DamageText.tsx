import React, { useRef, useMemo } from 'react';
import { Container, Text, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { BoardRotation } from '../../../core/boardRotation';
import type { DamagePopup } from '../../../store/useEffectStore';
import { fxTimeline } from '../../../core/graphics/fxTimeline';

interface DamageTextProps {
    data: DamagePopup;
    mapRotation?: BoardRotation;
}

export const DamageText: React.FC<DamageTextProps> = ({ data, mapRotation = 0 }) => {
    const textRef = useRef<PIXI.Text>(null);
    const elapsedRef = useRef(0);

    const style = useMemo(() => new PIXI.TextStyle({
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 23,
        fontWeight: '900',
        fill: [data.color, '#F8FAFC'],
        stroke: '#0F172A',
        strokeThickness: 4,
    }), [data.color]);

    useTick(() => {
        const text = textRef.current;
        if (!text || text.destroyed) return;

        const dtMs = fxTimeline.getLastCombatDtMs();
        elapsedRef.current += dtMs;

        const durationMs = Math.max(400, data.durationMs || 960);
        const t = Math.min(1, elapsedRef.current / durationMs);

        // Ease-out upward float (~44px total in viewer-upright space)
        const riseEase = 1 - Math.pow(1 - t, 2.2);
        text.y = -44 * riseEase;

        // Snappy impact pop-in (0 -> 140ms overshoot -> 260ms settle)
        if (elapsedRef.current < 130) {
            const p = elapsedRef.current / 130;
            text.scale.set(0.55 + 0.65 * p);
        } else if (elapsedRef.current < 260) {
            const p = (elapsedRef.current - 130) / 130;
            text.scale.set(1.2 - 0.2 * p);
        } else {
            text.scale.set(1.0);
        }

        // Smooth fade-out in final 42%
        if (t > 0.58) {
            const fade = (t - 0.58) / 0.42;
            text.alpha = Math.max(0, 1 - fade * fade);
        } else {
            text.alpha = 1;
        }
    });

    return (
        <Container x={data.x} y={data.y} angle={-mapRotation} eventMode="none">
            <Text
                ref={textRef}
                text={data.value}
                x={0}
                y={0}
                anchor={0.5}
                scale={0.55}
                style={style}
            />
        </Container>
    );
};
