import React, { useRef, useCallback } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { Projectile } from '../../../store/useEffectStore';
import type { BoardRotation } from '../../../core/boardRotation';
import { fxTimeline } from '../../../core/graphics/fxTimeline';
import { screenUpVector } from '../../../core/graphics/ParticlePool';

interface ProjectileRendererProps {
    data: Projectile;
    mapRotation?: BoardRotation;
}

const MG_BARREL_SIDES = [-4, 4, -4, 4, -4, 4] as const;
const MG_TARGET_SPREAD = [-3.5, 4.2, -1.5, 2.8, -4.4, 1.8] as const;
const MG_ROUND_INTERVAL_MS = 56;

export const ProjectileRenderer: React.FC<ProjectileRendererProps> = ({ data, mapRotation = 0 as BoardRotation }) => {
    const graphicsRef = useRef<PIXI.Graphics>(null);
    const elapsedRef = useRef(0);

    useTick(() => {
        const g = graphicsRef.current;
        if (!g || g.destroyed) return;

        const dtMs = fxTimeline.getLastCombatDtMs();
        elapsedRef.current += dtMs;
        const elapsed = elapsedRef.current;

        const travelMs = Math.max(85, data.travelMs || 170);
        const dx = data.endX - data.startX;
        const dy = data.endY - data.startY;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / dist;
        const uy = dy / dist;
        const px = -uy;
        const py = ux;

        g.clear();

        // 1. SNIPER RAIL BEAM — blazing crimson-white rail snap + lingering narrowing afterglow
        if (data.weapon === 'SNIPER') {
            const afterglowMs = 180;
            const totalMs = travelMs + afterglowMs;
            if (elapsed >= totalMs) return;

            const sweepT = Math.min(1, elapsed / (travelMs * 0.92));
            const headX = data.startX + dx * sweepT;
            const headY = data.startY + dy * sweepT;
            const fadeT = elapsed > travelMs ? (elapsed - travelMs) / afterglowMs : 0;
            const alpha = Math.max(0, 1 - fadeT * fadeT);
            const widthScale = Math.max(0.2, 1 - fadeT * 0.78);

            g.lineStyle(10 * widthScale, 0xE11D48, alpha * 0.28);
            g.moveTo(data.startX, data.startY);
            g.lineTo(headX, headY);
            g.lineStyle(5 * widthScale, 0xFB7185, alpha * 0.68);
            g.moveTo(data.startX, data.startY);
            g.lineTo(headX, headY);
            g.lineStyle(2.2 * widthScale, 0xFFFFFF, alpha);
            g.moveTo(data.startX, data.startY);
            g.lineTo(headX, headY);

            // Ionized rail acceleration rings pulsing along the sniper trajectory + muzzle optic glint
            const ringCount = 3;
            for (let r = 0; r < ringCount; r++) {
                const frac = (r + 1) / (ringCount + 1);
                if (sweepT < frac) continue;
                const rx = data.startX + dx * frac;
                const ry = data.startY + dy * frac;
                const rSize = (5 + fadeT * 10) * widthScale;
                g.lineStyle(1.6 * widthScale, 0xFDA4AF, alpha * 0.72);
                g.moveTo(rx - px * rSize, ry - py * rSize);
                g.lineTo(rx + px * rSize, ry + py * rSize);
            }
            if (fadeT < 0.45) {
                const glintA = (1 - fadeT / 0.45) * 0.9;
                g.lineStyle(1.8, 0xFFFFFF, glintA);
                g.moveTo(data.startX - px * 11, data.startY - py * 11);
                g.lineTo(data.startX + px * 11, data.startY + py * 11);
            }
            g.lineStyle(0);

            if (sweepT >= 0.96 && alpha > 0.12) {
                // High-velocity rail over-penetration exit streak extending past the target!
                const exitLen = (32 + fadeT * 52) * Math.min(1, alpha * 1.4);
                const exitX = data.endX + ux * exitLen;
                const exitY = data.endY + uy * exitLen;
                g.lineStyle(7 * widthScale, 0xE11D48, alpha * 0.36);
                g.moveTo(data.endX, data.endY);
                g.lineTo(exitX, exitY);
                g.lineStyle(2.4 * widthScale, 0xFFFFFF, alpha * 0.92);
                g.moveTo(data.endX, data.endY);
                g.lineTo(exitX, exitY);

                const ringR = 6 + fadeT * 22;
                g.lineStyle(2.2 * widthScale, 0xFB7185, alpha * 0.88);
                g.drawCircle(data.endX, data.endY, ringR);
                g.lineStyle(0);
                g.beginFill(0xFFFFFF, alpha * 0.95);
                g.drawCircle(data.endX, data.endY, 4.8 * widthScale);
                g.endFill();
            }
            return;
        }

        // 2. BASE DEFENSE HEAVY MACHINE GUN — rapid alternating twin-barrel tracer stream (6 single, 4 multi-target)
        if (data.weapon === 'ARTILLERY') {
            const barrelOffset = Math.min(24, dist * 0.35);
            const roundTravel = Math.max(90, travelMs);
            const rounds = Math.max(1, Math.min(6, data.burstRounds ?? 6));
            const intervalMs = rounds <= 4 ? 54 : MG_ROUND_INTERVAL_MS;

            for (let r = 0; r < rounds; r++) {
                const localElapsed = elapsed - r * intervalMs;
                if (localElapsed < 0) continue;
                const p = localElapsed / roundTravel;
                if (p >= 1) continue;

                const side = MG_BARREL_SIDES[r];
                const spread = MG_TARGET_SPREAD[r];
                const sx = data.startX + ux * barrelOffset + px * side;
                const sy = data.startY + uy * barrelOffset + py * side;
                const ex = data.endX + px * spread;
                const ey = data.endY + py * spread;

                const headX = sx + (ex - sx) * p;
                const headY = sy + (ey - sy) * p;
                const tailP = Math.max(0, p - 0.3);
                const tailX = sx + (ex - sx) * tailP;
                const tailY = sy + (ey - sy) * tailP;

                // Glowing incandescent .50 cal tracer streak
                g.lineStyle(5, 0xF97316, 0.38);
                g.moveTo(tailX, tailY);
                g.lineTo(headX, headY);
                g.lineStyle(2.2, 0xFEF08A, 0.96);
                g.moveTo(tailX, tailY);
                g.lineTo(headX, headY);
                g.lineStyle(0);

                g.beginFill(0xFFFFFF, 1);
                g.drawCircle(headX, headY, 2.4);
                g.endFill();
            }
            return;
        }

        // 3. BREACHER TANK BLAST MISSILE — armored warhead, rocket exhaust flame, smoke ribbon & low arc shadow
        if (data.weapon === 'ASSAULTER') {
            const progress = Math.min(1, elapsed / travelMs);
            if (progress >= 1) return;

            const up = screenUpVector(mapRotation);
            const lowArcMax = Math.min(30, Math.max(12, dist * 0.08));
            const heightAt = (t: number) => lowArcMax * 4 * t * (1 - t);
            const barrelStart = Math.min(18, dist * 0.25);
            const sx = data.startX + ux * barrelStart;
            const sy = data.startY + uy * barrelStart;
            const spanX = data.endX - sx;
            const spanY = data.endY - sy;

            const pointAt = (t: number) => {
                const h = heightAt(t);
                return {
                    x: sx + spanX * t + up.x * h,
                    y: sy + spanY * t + up.y * h,
                };
            };

            // Ground shadow tracking underneath missile
            const gx = sx + spanX * progress;
            const gy = sy + spanY * progress;
            g.beginFill(0x0F172A, 0.34);
            g.drawEllipse(gx, gy, 7.5, 4);
            g.endFill();

            // Thick billowing rocket smoke trail
            const trailStart = Math.max(0, progress - 0.48);
            const steps = 8;
            let prev = pointAt(trailStart);
            for (let i = 1; i <= steps; i++) {
                const frac = i / steps;
                const sampleT = trailStart + (progress - trailStart) * frac;
                const cur = pointAt(sampleT);
                g.lineStyle(2 + frac * 6.5, 0xCBD5E1, frac * 0.42);
                g.moveTo(prev.x, prev.y);
                g.lineTo(cur.x, cur.y);
                prev = cur;
            }

            // Missile heading tangent
            const head = pointAt(progress);
            const back = pointAt(Math.max(0, progress - 0.06));
            const mdx = head.x - back.x;
            const mdy = head.y - back.y;
            const mLen = Math.max(0.001, Math.hypot(mdx, mdy));
            const mux = mdx / mLen;
            const muy = mdy / mLen;
            const mpx = -muy;
            const mpy = mux;

            // Flickering rocket motor exhaust plume
            const flicker = 0.85 + Math.sin(elapsed * 0.14) * 0.25;
            const flameTailX = head.x - mux * (17 * flicker);
            const flameTailY = head.y - muy * (17 * flicker);
            g.lineStyle(8.5, 0xEA580C, 0.48);
            g.moveTo(flameTailX, flameTailY);
            g.lineTo(head.x - mux * 3, head.y - muy * 3);
            g.lineStyle(4.2, 0xFDE047, 0.94);
            g.moveTo(head.x - mux * (11 * flicker), head.y - muy * (11 * flicker));
            g.lineTo(head.x - mux * 2, head.y - muy * 2);
            g.lineStyle(0);

            // Armored steel missile body + red-orange warhead cone + stabilizer fins
            const noseX = head.x + mux * 7;
            const noseY = head.y + muy * 7;
            const midX = head.x + mux * 1;
            const midY = head.y + muy * 1;
            const tailX = head.x - mux * 8;
            const tailY = head.y - muy * 8;

            // Fins
            g.beginFill(0x475569, 1);
            g.drawPolygon([
                tailX + mpx * 5.2, tailY + mpy * 5.2,
                tailX + mux * 4 + mpx * 2.2, tailY + muy * 4 + mpy * 2.2,
                tailX + mux * 4 - mpx * 2.2, tailY + muy * 4 - mpy * 2.2,
                tailX - mpx * 5.2, tailY - mpy * 5.2,
            ]);
            g.endFill();

            // Fuselage
            g.beginFill(0xE2E8F0, 1);
            g.drawPolygon([
                midX + mpx * 2.8, midY + mpy * 2.8,
                tailX + mpx * 2.6, tailY + mpy * 2.6,
                tailX - mpx * 2.6, tailY - mpy * 2.6,
                midX - mpx * 2.8, midY - mpy * 2.8,
            ]);
            g.endFill();

            // Red/amber high-explosive nose cone
            g.beginFill(0xEF4444, 1);
            g.drawPolygon([
                noseX, noseY,
                midX + mpx * 3.0, midY + mpy * 3.0,
                midX - mpx * 3.0, midY - mpy * 3.0,
            ]);
            g.endFill();

            // Hot rocket nozzle glow
            g.beginFill(0xFFFFFF, 0.98);
            g.drawCircle(tailX, tailY, 2.4);
            g.endFill();
            return;
        }

        // 4. BANK TURRET / GENERIC LASER — precision golden-amber twin-rail security pulse
        if (data.weapon === 'TURRET' || data.type === 'LASER') {
            const fadeMs = 105;
            if (elapsed >= travelMs + fadeMs) return;
            const progress = Math.min(1, elapsed / travelMs);
            const after = Math.max(0, (elapsed - travelMs) / fadeMs);
            const alpha = progress < 1 ? 0.95 : Math.max(0, 1 - after);
            const headX = data.startX + dx * progress;
            const headY = data.startY + dy * progress;
            const tailFrac = Math.max(0, progress - 0.72);
            const tailX = data.startX + dx * tailFrac;
            const tailY = data.startY + dy * tailFrac;

            g.lineStyle(7, data.color, alpha * 0.3);
            g.moveTo(tailX, tailY);
            g.lineTo(headX, headY);

            // Ionized gold capacitor discharge ring at Bank Turret muzzle
            if (progress < 0.65) {
                const capA = (1 - progress / 0.65) * 0.85;
                g.lineStyle(2, 0xFDE047, capA);
                g.drawCircle(data.startX, data.startY, 7 + progress * 16);
            }

            for (const off of [-2, 2]) {
                g.lineStyle(1.8, 0xFFFBEB, alpha * 0.92);
                g.moveTo(tailX + px * off, tailY + py * off);
                g.lineTo(headX + px * off, headY + py * off);
            }
            g.lineStyle(0);
            g.beginFill(0xFFFFFF, alpha);
            g.drawCircle(headX, headY, 3.2);
            g.endFill();
            return;
        }

        // 5. SIEGE / MISSILE — screen-upright parabolic arc + finned mortar warhead + smoke ribbon
        if (data.weapon === 'SIEGE' || data.type === 'MISSILE') {
            const progress = Math.min(1, elapsed / travelMs);
            if (progress >= 1) return;

            const up = screenUpVector(mapRotation);
            const arcMax = Math.min(96, Math.max(38, dist * 0.24));
            const heightAt = (t: number) => arcMax * 4 * t * (1 - t);
            const pointAt = (t: number) => {
                const h = heightAt(t);
                return {
                    x: data.startX + dx * t + up.x * h,
                    y: data.startY + dy * t + up.y * h,
                };
            };

            const gx = data.startX + dx * progress;
            const gy = data.startY + dy * progress;
            const curH = heightAt(progress);
            const altitudeNorm = curH / Math.max(1, arcMax);

            g.beginFill(0x0F172A, 0.36 - altitudeNorm * 0.16);
            g.drawEllipse(gx, gy, 7.5 - altitudeNorm * 2.5, 4.5 - altitudeNorm * 1.4);
            g.endFill();

            const trailSpan = 0.34;
            const trailStart = Math.max(0, progress - trailSpan);
            const steps = 7;
            let prevPt = pointAt(trailStart);
            for (let i = 1; i <= steps; i++) {
                const frac = i / steps;
                const sampleT = trailStart + (progress - trailStart) * frac;
                const curPt = pointAt(sampleT);
                g.lineStyle(1.5 + frac * 4.5, 0xCBD5E1, frac * 0.45);
                g.moveTo(prevPt.x, prevPt.y);
                g.lineTo(curPt.x, curPt.y);
                prevPt = curPt;
            }

            const head = pointAt(progress);
            const back = pointAt(Math.max(0, progress - 0.055));
            const sdx = head.x - back.x;
            const sdy = head.y - back.y;
            const sLen = Math.max(0.001, Math.hypot(sdx, sdy));
            const sux = sdx / sLen;
            const suy = sdy / sLen;
            const spx = -suy;
            const spy = sux;

            g.lineStyle(5.5, 0xF97316, 0.65);
            g.moveTo(back.x, back.y);
            g.lineTo(head.x, head.y);
            g.lineStyle(2.5, 0xFEF08A, 0.98);
            g.moveTo(back.x, back.y);
            g.lineTo(head.x, head.y);
            g.lineStyle(0);

            // Finned mortar warhead silhouette oriented along arc tangent
            const tailX = head.x - sux * 7;
            const tailY = head.y - suy * 7;
            const noseX = head.x + sux * 7.5;
            const noseY = head.y + suy * 7.5;
            g.beginFill(0x334155, 1);
            g.drawPolygon([
                tailX + spx * 5, tailY + spy * 5,
                head.x - sux * 1 + spx * 2, head.y - suy * 1 + spy * 2,
                head.x - sux * 1 - spx * 2, head.y - suy * 1 - spy * 2,
                tailX - spx * 5, tailY - spy * 5,
            ]);
            g.endFill();
            g.beginFill(0xFB923C, 1);
            g.drawPolygon([
                noseX, noseY,
                head.x - sux * 2 + spx * 3.4, head.y - suy * 2 + spy * 3.4,
                head.x - sux * 2 - spx * 3.4, head.y - suy * 2 - spy * 3.4,
            ]);
            g.endFill();
            g.beginFill(0xFFFFFF, 1);
            g.drawCircle(head.x + sux * 2, head.y + suy * 2, 2.2);
            g.endFill();
            return;
        }

        // 6. SCOUT CARBINE BURST (SOLDIER & default BULLET) — crisp 3-round staggered tactical burst
        const barrelStart = Math.min(12, dist * 0.2);
        const sx = data.startX + ux * barrelStart;
        const sy = data.startY + uy * barrelStart;
        const burstDelays = [0, 24, 48];
        const burstOffsets = [0, -2.2, 2.1];
        const roundTravel = Math.max(70, travelMs - 48);

        for (let b = 0; b < burstDelays.length; b++) {
            const localMs = elapsed - burstDelays[b];
            if (localMs < 0) continue;
            const progress = localMs / roundTravel;
            if (progress >= 1) continue;

            const off = burstOffsets[b];
            const ox = sx + px * off * 0.4;
            const oy = sy + py * off * 0.4;
            const ex = data.endX + px * off;
            const ey = data.endY + py * off;
            const headX = ox + (ex - ox) * progress;
            const headY = oy + (ey - oy) * progress;
            const tailP = Math.max(0, progress - 0.3);
            const tailX = ox + (ex - ox) * tailP;
            const tailY = oy + (ey - oy) * tailP;

            g.lineStyle(3.6, 0xF59E0B, 0.38);
            g.moveTo(tailX, tailY);
            g.lineTo(headX, headY);
            g.lineStyle(1.7, 0xFFFBEB, 0.98);
            g.moveTo(tailX, tailY);
            g.lineTo(headX, headY);
            g.lineStyle(0);

            g.beginFill(0xFDE047, 0.98);
            g.drawCircle(headX, headY, 2.4);
            g.endFill();
            g.beginFill(0xFFFFFF, 1);
            g.drawCircle(headX, headY, 1.2);
            g.endFill();
        }
    });

    const initialDraw = useCallback((g: PIXI.Graphics) => {
        g.clear();
    }, []);

    return <Graphics ref={graphicsRef} draw={initialDraw} eventMode="none" />;
};
