import React, { useRef, useMemo } from 'react';
import { Text, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';

interface DamageTextProps {
    data: {
        id: string;
        x: number;
        y: number;
        value: string;
        color: string;
    };
}

export const DamageText: React.FC<DamageTextProps> = ({ data }) => {
    const textRef = useRef<PIXI.Text>(null);
    const ageRef = useRef(0);
    const yOffsetRef = useRef(0);

    const style = useMemo(() => new PIXI.TextStyle({
        fontFamily: 'Arial',
        fontSize: 24,
        fontWeight: 'bold',
        fill: [data.color, '#eeeeee'],
        stroke: '#000000',
        strokeThickness: 4,
        dropShadow: true,
        dropShadowColor: '#000000',
        dropShadowBlur: 2,
        dropShadowAngle: Math.PI / 6,
        dropShadowDistance: 2,
    }), [data.color]);

    useTick((delta) => {
        if (!textRef.current) return;

        ageRef.current += delta;
        yOffsetRef.current -= delta;
        textRef.current.y = data.y + yOffsetRef.current;

        const age = ageRef.current;
        if (age < 10) {
            textRef.current.scale.set(0.5 + 0.7 * (age / 10));
        } else if (age < 20) {
            textRef.current.scale.set(1.2 - 0.2 * ((age - 10) / 10));
        } else {
            textRef.current.scale.set(1.0);
        }

        if (age > 30) {
            textRef.current.alpha = Math.max(0, 1 - (age - 30) / 30);
        }
    });

    return (
        <Text
            ref={textRef}
            text={data.value}
            x={data.x}
            y={data.y}
            anchor={0.5}
            scale={0.5}
            style={style}
        />
    );
};
