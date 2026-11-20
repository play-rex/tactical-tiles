import React, { useRef, useEffect } from 'react';
import { useTick, Container, Graphics } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { SafeSprite } from '../SafeSprite';
import { TILE_SIZE } from '../../../core/constants/Config';
import { getUnitMaxHp } from '../../../core/rules/CombatRules';

// Helper lerp
const lerp = (start: number, end: number, alpha: number) => start + (end - start) * alpha;

interface UnitSpriteProps {
    texture: PIXI.Texture;
    x: number;
    y: number;
    isSelected?: boolean;
    unit: any;
    onPointerDown?: () => void;
}

export const UnitSprite: React.FC<UnitSpriteProps> = ({ texture, x, y, isSelected, unit, onPointerDown }) => {
    // We render the Container at the target position initially, 
    // but we hijack its position update in useTick to do it smoothly.
    
    // Actually, to avoid jumping, we should init visualPos to x,y once.
    const containerRef = useRef<PIXI.Container>(null);
    const spriteRef = useRef<PIXI.Sprite>(null);
    
    // Store current visual position in ref to avoid re-renders
    const visual = useRef({ x, y });

    // Sync ref on mount (optional, or rely on x prop)
    useEffect(() => {
        visual.current = { x, y };
    }, []); // Only on mount

    useTick((delta) => {
        if (!containerRef.current) return;

        // Target is the prop x/y (which changes when unit moves in store)
        const targetX = x;
        const targetY = y;
        
        // Interpolation
        const speed = 0.2 * delta;
        visual.current.x = lerp(visual.current.x, targetX, speed);
        visual.current.y = lerp(visual.current.y, targetY, speed);
        
        // Apply position to container
        containerRef.current.x = visual.current.x;
        containerRef.current.y = visual.current.y;

        // Velocity for Squash/Stretch
        const vx = Math.abs(targetX - visual.current.x);
        const vy = Math.abs(targetY - visual.current.y);
        const velocity = vx + vy;

        if (spriteRef.current) {
            if (velocity > 1.0) { // Moving
                // Stretch X, Squash Y slightly (or bounce)
                // Simple deform
                spriteRef.current.scale.set(1.1, 0.9);
            } else {
                // Return to normal
                const scaleSpeed = 0.15 * delta;
                spriteRef.current.scale.x = lerp(spriteRef.current.scale.x, 1, scaleSpeed);
                spriteRef.current.scale.y = lerp(spriteRef.current.scale.y, 1, scaleSpeed);
            }
        }
    });

    return (
        <Container 
            ref={containerRef}
            x={x} // Fallback / Start
            y={y}
            eventMode="static"
            cursor="pointer"
            pointerdown={(e) => {
                e.stopPropagation();
                onPointerDown?.();
            }}
        >
            {/* Overwatch Stance Ring */}
            {unit.isOverwatching && (
                <Graphics
                    draw={g => {
                        g.clear();
                        g.lineStyle(2, 0xFFB300, 0.9);
                        g.drawCircle(TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE * 0.42);
                    }}
                />
            )}

            {/* Ace Veterancy Gold Aura */}
            {(unit.rank ?? 0) >= 3 && (
                <Graphics
                    draw={g => {
                        g.clear();
                        g.lineStyle(2, 0xF59E0B, 0.9);
                        g.drawRoundedRect(2, 2, TILE_SIZE - 4, TILE_SIZE - 4, 6);
                    }}
                />
            )}

             {/* Selection Halo */}
            {isSelected && (
                <Graphics 
                    draw={g => {
                        g.clear();
                        g.lineStyle(2, 0xFFD700, 1);
                        g.drawRect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8);
                    }}
                />
            )}

            {/* Unit Sprite - Anchored Center for Scaling */}
            <SafeSprite
                ref={spriteRef}
                texture={texture}
                width={TILE_SIZE}
                height={TILE_SIZE}
                tint={unit.completed ? 0x999999 : 0xFFFFFF}
                anchor={[0.5, 0.5]}
                x={TILE_SIZE / 2}
                y={TILE_SIZE / 2}
            />
            
            {/* HP Bar, Ammo & Rank Chevrons */}
             <Graphics 
                draw={g => {
                    g.clear();
                    const maxHp = getUnitMaxHp(unit);
                    const pct = Math.min(1, Math.max(0, unit.hp / maxHp));
                    const color = pct > 0.5 ? 0x00FF00 : pct > 0.25 ? 0xFFA500 : 0xFF0000;
                    
                    g.beginFill(0x000000, 0.8);
                    g.drawRect(8, TILE_SIZE - 10, TILE_SIZE - 16, 6);
                    g.endFill();
                    g.beginFill(color, 1);
                    g.drawRect(9, TILE_SIZE - 9, (TILE_SIZE - 18) * pct, 4);
                    g.endFill();

                    // Ammo Pips
                    if(unit.maxAmmo < 99) {
                        g.beginFill(0xFFD700);
                        for(let i=0; i<unit.ammo; i++) {
                            g.drawRect(8 + (i*5), TILE_SIZE - 16, 4, 4);
                        }
                        g.endFill();
                    }

                    // Veterancy Rank Pips (1..3 gold diamonds at top-left)
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
                                cx - 3, cy
                            ]);
                            g.endFill();
                        }
                    }

                    // Overwatch Reticle Badge (top-right)
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
                    }
                }}
            />
        </Container>
    );
};
