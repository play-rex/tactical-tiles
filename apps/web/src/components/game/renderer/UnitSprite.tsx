import React, { useRef, useEffect, useCallback } from 'react';
import { useTick, Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { SafeSprite } from '../SafeSprite';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { getUnitMaxHp } from '@tactical/engine/rules/CombatRules';
import { PLAYER_UI_THEME, hexToPixiColor } from '../../ui/GeoPrimitives';
import type { BoardRotation } from '../../../core/boardRotation';

const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

const UNIT_HP_LABEL_STYLE = new PIXI.TextStyle({
    fill: '#FFFFFF',
    stroke: '#0F172A',
    strokeThickness: 3,
    fontSize: 10,
    fontWeight: 'bold',
    fontFamily: 'system-ui, -apple-system, sans-serif',
});

interface UnitSpriteProps {
    texture: PIXI.Texture;
    x: number;
    y: number;
    tileX?: number;
    tileY?: number;
    gridSize?: number;
    isSelected?: boolean;
    isReadyTurn?: boolean;
    unit: any;
    mapRotation?: BoardRotation;
    onSelectTile?: (tx: number, ty: number) => void;
    onPointerDown?: () => void;
}

const UnitSpriteComponent: React.FC<UnitSpriteProps> = ({
    texture,
    x,
    y,
    tileX,
    tileY,
    gridSize = 20,
    isSelected,
    isReadyTurn = false,
    unit,
    mapRotation = 0,
    onSelectTile,
    onPointerDown,
}) => {
    const containerRef = useRef<PIXI.Container>(null);
    const rotWrapperRef = useRef<PIXI.Container>(null);
    const visual = useRef({ x, y });
    const settledRef = useRef(true);
    const worldCenter = (gridSize * TILE_SIZE) / 2;
    const facingRef = useRef<number>(Math.atan2(worldCenter - y, worldCenter - x));

    useEffect(() => {
        visual.current = { x, y };
        if (rotWrapperRef.current) {
            rotWrapperRef.current.rotation = facingRef.current;
        }
    }, []); // Only on mount

    useEffect(() => {
        settledRef.current = false;
    }, [x, y]);

    useTick((delta) => {
        if (settledRef.current || !containerRef.current) return;

        const targetX = x;
        const targetY = y;
        const dx = targetX - visual.current.x;
        const dy = targetY - visual.current.y;
        const dist = Math.hypot(dx, dy);

        const speed = Math.min(1, 0.22 * delta);
        visual.current.x = lerp(visual.current.x, targetX, speed);
        visual.current.y = lerp(visual.current.y, targetY, speed);

        containerRef.current.x = visual.current.x;
        containerRef.current.y = visual.current.y;

        if (rotWrapperRef.current) {
            if (dist > 1.5) {
                facingRef.current = Math.atan2(dy, dx);
                rotWrapperRef.current.scale.set(1.06, 0.96);
            } else {
                const scaleSpeed = Math.min(1, 0.16 * delta);
                rotWrapperRef.current.scale.x = lerp(rotWrapperRef.current.scale.x, 1, scaleSpeed);
                rotWrapperRef.current.scale.y = lerp(rotWrapperRef.current.scale.y, 1, scaleSpeed);
            }
            const cur = rotWrapperRef.current.rotation;
            const diff = ((facingRef.current - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            rotWrapperRef.current.rotation = cur + diff * Math.min(1, 0.25 * delta);

            if (dist < 0.25 && Math.abs(diff) < 0.01 && Math.abs(rotWrapperRef.current.scale.x - 1) < 0.005) {
                visual.current.x = targetX;
                visual.current.y = targetY;
                containerRef.current.x = targetX;
                containerRef.current.y = targetY;
                rotWrapperRef.current.scale.set(1, 1);
                rotWrapperRef.current.rotation = facingRef.current;
                settledRef.current = true;
            }
        }
    });

    const drawOverwatchRing = useCallback((g: PIXI.Graphics) => {
        g.clear();
        g.lineStyle(2, 0xFFB300, 0.9);
        g.drawCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.42);
    }, []);

    const drawAceAura = useCallback((g: PIXI.Graphics) => {
        g.clear();
        g.lineStyle(2, 0xF59E0B, 0.9);
        g.drawRoundedRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4, 6);
    }, []);

    const drawSelectionBrackets = useCallback((g: PIXI.Graphics) => {
        g.clear();
        g.lineStyle(2.5, 0xFFD700, 1);
        const pad = 4;
        const arm = 12;
        const max = TILE_SIZE - pad;
        g.moveTo(pad, pad + arm); g.lineTo(pad, pad); g.lineTo(pad + arm, pad);
        g.moveTo(max - arm, pad); g.lineTo(max, pad); g.lineTo(max, pad + arm);
        g.moveTo(pad, max - arm); g.lineTo(pad, max); g.lineTo(pad + arm, max);
        g.moveTo(max - arm, max); g.lineTo(max, max); g.lineTo(max, max - arm);
    }, []);

    // A plate in the team's colour under every unit: whose it is reads at any zoom, and it
    // fades once the unit has acted this turn.
    const teamColor = hexToPixiColor((PLAYER_UI_THEME[unit.owner] ?? PLAYER_UI_THEME[0]).badgeBg);
    const drawTeamPlate = useCallback((g: PIXI.Graphics) => {
        g.clear();
        const c = TILE_SIZE / 2;
        g.lineStyle(2, 0xFFFFFF, 0.9);
        g.beginFill(teamColor, 0.38);
        g.drawCircle(c, c, TILE_SIZE * 0.45);
        g.endFill();
        g.lineStyle(4, teamColor, 1);
        g.drawCircle(c, c, TILE_SIZE * 0.45 - 3);
    }, [teamColor]);

    const maxHp = getUnitMaxHp(unit);
    const drawHudBars = useCallback((g: PIXI.Graphics) => {
        g.clear();
        const pct = Math.min(1, Math.max(0, unit.hp / maxHp));
        const color = pct > 0.5 ? 0x00FF00 : pct > 0.25 ? 0xFFA500 : 0xFF0000;

        g.beginFill(0x000000, 0.8);
        g.drawRect(8, TILE_SIZE - 10, TILE_SIZE - 16, 6);
        g.endFill();
        g.beginFill(color, 1);
        g.drawRect(9, TILE_SIZE - 9, (TILE_SIZE - 18) * pct, 4);
        g.endFill();

        if (unit.maxAmmo < 99 && unit.maxAmmo > 0) {
            const availW = TILE_SIZE - 16;
            if (unit.ammo === 0) {
                g.beginFill(0xDC2626, 0.92);
                g.drawRect(8, TILE_SIZE - 16, availW, 4);
                g.endFill();
            } else {
                const gap = 1;
                const slotW = Math.max(2, Math.min(4, Math.floor((availW - (unit.maxAmmo - 1) * gap) / unit.maxAmmo)));
                const step = slotW + gap;
                g.beginFill(0xFFD700, 0.95);
                for (let i = 0; i < Math.min(unit.ammo, unit.maxAmmo); i++) {
                    g.drawRect(8 + i * step, TILE_SIZE - 16, slotW, 4);
                }
                g.endFill();
            }
        }

        const rank = unit.rank ?? 0;
        if (rank > 0) {
            for (let i = 0; i < rank; i++) {
                const cx = 10 + i * 8;
                const cy = 9;
                g.lineStyle(1, 0x000000, 0.9);
                g.beginFill(0xFFD700, 1);
                g.drawPolygon([
                    cx, cy - 3.5,
                    cx + 3, cy,
                    cx, cy + 3.5,
                    cx - 3, cy,
                ]);
                g.endFill();
            }
        }

        if (unit.isOverwatching) {
            const bx = TILE_SIZE - 10;
            const by = 10;
            g.lineStyle(1.5, 0x000000, 0.9);
            g.beginFill(0xFFB300, 1);
            g.drawCircle(bx, by, 5);
            g.endFill();
            g.lineStyle(1.5, 0x111111, 1);
            g.moveTo(bx - 3, by);
            g.lineTo(bx + 3, by);
            g.moveTo(bx, by - 3);
            g.lineTo(bx, by + 3);
        } else if (isReadyTurn) {
            g.lineStyle(1.5, 0x0F172A, 0.9);
            g.beginFill(0x22C55E, 1);
            g.drawCircle(TILE_SIZE - 9, 9, 4);
            g.endFill();
        }
    }, [unit.hp, maxHp, unit.ammo, unit.maxAmmo, unit.rank, unit.isOverwatching, isReadyTurn]);

    return (
        <Container
            ref={containerRef}
            x={x}
            y={y}
            eventMode="none"
        >
            <Graphics draw={drawTeamPlate} alpha={unit.completed ? 0.45 : 1} />
            {unit.isOverwatching && <Graphics draw={drawOverwatchRing} />}
            {(unit.rank ?? 0) >= 3 && <Graphics draw={drawAceAura} />}
            {isSelected && <Graphics draw={drawSelectionBrackets} />}

            <Container ref={rotWrapperRef} x={TILE_SIZE / 2} y={TILE_SIZE / 2}>
                <SafeSprite
                    texture={texture}
                    width={TILE_SIZE}
                    height={TILE_SIZE}
                    tint={unit.completed ? 0x999999 : 0xFFFFFF}
                    anchor={[0.5, 0.5]}
                    x={0}
                    y={0}
                />
            </Container>

            {/* Counter-rotate HUD overlay so HP bars, text, badges, and rank stars stay upright */}
            <Container
                x={TILE_SIZE / 2}
                y={TILE_SIZE / 2}
                pivot={{ x: TILE_SIZE / 2, y: TILE_SIZE / 2 }}
                angle={-mapRotation}
            >
                <Graphics draw={drawHudBars} />
                <Text
                    text={`${unit.hp}`}
                    x={8}
                    y={TILE_SIZE - 17}
                    anchor={[0, 1]}
                    style={UNIT_HP_LABEL_STYLE}
                />
            </Container>
        </Container>
    );
};

export const UnitSprite = React.memo(UnitSpriteComponent);
