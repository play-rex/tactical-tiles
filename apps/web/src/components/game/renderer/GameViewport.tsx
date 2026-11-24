import React, { useEffect, useRef } from 'react';
import { Container, PixiComponent, useApp, useTick } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { useViewportContext } from '../../../context/ViewportContext';
import { rotateBoardPoint } from '../../../core/boardRotation';
import { fxTimeline, getPrefersReducedMotion, subscribeReducedMotion } from '../../../core/graphics/fxTimeline';
import { computeClampedKillCamViewport } from '../../../core/graphics/killCam';
import { useGameStore } from '../../../store/useGameStore';

interface ViewportComponentProps {
    app: PIXI.Application;
    width: number;
    height: number;
    worldWidth: number;
    worldHeight: number;
    children?: React.ReactNode;
}

/**
 * The live viewport instance.
 *
 * `PixiComponent.create` runs on the render pass, so publishing the viewport through React state
 * from there is a render-phase update that React can drop — the camera context then stays `null`
 * forever and nothing (kill cam, keyboard pan, fit/zoom buttons) can steer the board. The instance
 * is registered here instead and `GameViewport` publishes it to the context from an effect.
 */
let liveViewport: Viewport | null = null;
export const getLiveViewport = (): Viewport | null =>
    liveViewport && !liveViewport.destroyed ? liveViewport : null;

/**
 * Show the whole map, or on a tall screen (a phone held upright) fill its height and let the
 * sides pan: fitting the width there leaves the map a thin strip with tiny units.
 */
export const frameMap = (viewport: Viewport) => {
    if (viewport.screenHeight > viewport.screenWidth * 1.25) viewport.fitHeight(viewport.worldHeight, true);
    else viewport.fit();
    viewport.moveCenter(viewport.worldWidth / 2, viewport.worldHeight / 2);
};

const PixiViewport = PixiComponent<ViewportComponentProps, Viewport>('GameViewport', {
    create: (props) => {
        const viewport = new Viewport({
            screenWidth: props.width,
            screenHeight: props.height,
            worldWidth: props.worldWidth,
            worldHeight: props.worldHeight,
            ticker: props.app.ticker,
            events: props.app.renderer.events // For Pixi v7
        } as any);
        
        // Compatibility with Pixi v7
        (viewport as any).eventMode = 'static';

        viewport
            .drag({
                mouseButtons: 'left',
                wheel: false // Disable wheel drag, use for zoom
            })
            .pinch()
            .wheel({
                percent: 0.05,  // Slower zoom speed (5%)
                smooth: 20,     // High smoothing for trackpads
                interrupt: false
            })
            .decelerate({
                friction: 0.95, // Glass-like slides
                bounce: 0.8
            })
            .clampZoom({ minScale: 0.1, maxScale: 4.0 }) 
            .clamp({ direction: 'all' });

        // Prevent browser scrolling
        (viewport as any).on('wheel', (e: any) => {
            e.event.preventDefault();
        });

        frameMap(viewport);

        liveViewport = viewport;

        return viewport;
    },
    applyProps: (instance, oldProps, newProps) => {
         if (instance.destroyed) return;
         const oldP = oldProps as ViewportComponentProps;
         const newP = newProps as ViewportComponentProps;
         
         const hasResized = newP.width !== oldP.width || newP.height !== oldP.height || 
             newP.worldWidth !== oldP.worldWidth || newP.worldHeight !== oldP.worldHeight;

         if (hasResized) {
             instance.resize(newP.width, newP.height, newP.worldWidth, newP.worldHeight);
             frameMap(instance);
         }
    },
    willUnmount: (instance) => {
        if (liveViewport === instance) liveViewport = null;
        try {
            if (!instance.destroyed) {
                instance.plugins.pause('drag');
                instance.plugins.pause('wheel');
                instance.plugins.pause('pinch');
                instance.plugins.pause('decelerate');
                instance.plugins.pause('clamp');
                instance.plugins.pause('clampZoom');
            }
            const vpAny = instance as any;
            if (vpAny.options?.ticker?._head && vpAny.tickerFunction) {
                vpAny.options.ticker.remove(vpAny.tickerFunction);
            }
            if (vpAny.options) {
                vpAny.options.noTicker = true;
            }
        } catch (e) {
            console.warn("Viewport unmount cleanup suppressed:", e);
        }
    }
});

// Logic-only component for smoother updates
export const KeyboardPanController = () => {
    const { viewport } = useViewportContext();
    const keys = useRef<{ [key: string]: boolean }>({});

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
        const onKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        }
    }, []);

    useTick((delta) => {
        const vp = viewport ?? getLiveViewport();
        if (!vp || vp.destroyed) return;
        // The kill-cam rig owns the camera for its beat; never fight it with key panning.
        if (fxTimeline.getKillCamFrame().active) return;

        const speed = 15 * delta;
        // Divide speed by scale so panning doesn't feel ultra-fast when zoomed in
        const adjustedSpeed = speed / vp.scale.x; 

        if (keys.current['ArrowUp'] || keys.current['KeyW']) vp.moveCenter(vp.center.x, vp.center.y - adjustedSpeed);
        if (keys.current['ArrowDown'] || keys.current['KeyS']) vp.moveCenter(vp.center.x, vp.center.y + adjustedSpeed);
        if (keys.current['ArrowLeft'] || keys.current['KeyA']) vp.moveCenter(vp.center.x - adjustedSpeed, vp.center.y);
        if (keys.current['ArrowRight'] || keys.current['KeyD']) vp.moveCenter(vp.center.x + adjustedSpeed, vp.center.y);
    });

    return null;
};

/**
 * Kill-cam camera rig with Rule-of-Thirds corner clamping.
 *
 * Pans onto weapon-directed framing targets, applies soft edge clamping + a Dutch-tilt zoom
 * floor so corner battles never expose out-of-bounds void, publishes the subject's screen
 * coordinates so `KillCamOverlay` dynamically dodges corners, and returns smoothly to the
 * player's exact saved zoom & centre in one continuous curve.
 */
const CinematicCameraController = () => {
    const { viewport } = useViewportContext();
    const savedRef = useRef<{ x: number; y: number; scale: number } | null>(null);

    useTick((delta) => {
        const vp = viewport ?? getLiveViewport();
        if (!vp || vp.destroyed) return;

        const frame = fxTimeline.getKillCamFrame();
        if (frame.active && frame.cue) {
            if (!savedRef.current) {
                savedRef.current = { x: vp.center.x, y: vp.center.y, scale: vp.scale.x };
                for (const plugin of ['drag', 'pinch', 'wheel', 'decelerate', 'clamp', 'clampZoom'] as const) {
                    try {
                        vp.plugins.pause(plugin);
                    } catch {
                        // Plugin may be disabled on this surface
                    }
                }
            }
            const saved = savedRef.current;
            const { mapRotation, gridSize } = useGameStore.getState();
            const boardSize = (gridSize || 20) * TILE_SIZE;
            const rotCenter = rotateBoardPoint(frame.centerX, frame.centerY, mapRotation, boardSize);
            const rotSubject = rotateBoardPoint(frame.cue.focusX, frame.cue.focusY, mapRotation, boardSize);
            const rotated90 = mapRotation === 90 || mapRotation === 270;
            const effFrameW = rotated90 ? frame.frameH : frame.frameW;
            const effFrameH = rotated90 ? frame.frameW : frame.frameH;

            const usableH = vp.screenHeight * (1 - 0.24 * frame.letterbox);
            const fitScale = Math.min(
                vp.screenWidth / Math.max(64, effFrameW),
                usableH / Math.max(64, effFrameH),
            );
            const maxCrop = Math.min(2.6, Math.max(saved.scale * 4.5, 2.0));
            const cropScale = Math.max(saved.scale, Math.min(fitScale, maxCrop));
            const desiredScale = saved.scale + (cropScale - saved.scale) * frame.fit;

            // Rule-of-Thirds soft clamping keeps corner fights filled with terrain, never grey void.
            const rawGoalX = rotCenter.x + (saved.x - rotCenter.x) * frame.recover;
            const rawGoalY = rotCenter.y + (saved.y - rotCenter.y) * frame.recover;
            const clampBlend = frame.phase === 'RECOVER' ? 1 - frame.recover : Math.min(1, frame.fit * 1.45);
            const clamped = computeClampedKillCamViewport({
                targetX: rawGoalX,
                targetY: rawGoalY,
                subjectX: rotSubject.x,
                subjectY: rotSubject.y,
                desiredScale,
                screenWidth: vp.screenWidth,
                screenHeight: vp.screenHeight,
                boardSize,
                dutchTiltRad: frame.dutchTiltRad,
                clampBlend,
                maxBleedPx: 22,
                maxScale: maxCrop,
            });

            fxTimeline.setKillCamSubjectScreen(clamped.subjectScreenX, clamped.subjectScreenY);

            if (Math.abs(vp.scale.x - clamped.scale) > 0.0005) {
                vp.setZoom(clamped.scale, true);
            }
            const c = vp.center;
            const safeDelta = Math.min(2, Math.max(0.2, typeof delta === 'number' && Number.isFinite(delta) ? delta : 1));
            const k = 1 - Math.pow(1 - 0.24, safeDelta);
            vp.moveCenter(c.x + (clamped.centerX - c.x) * k, c.y + (clamped.centerY - c.y) * k);
        } else if (savedRef.current) {
            const saved = savedRef.current;
            savedRef.current = null;
            fxTimeline.setKillCamSubjectScreen(0.5, 0.5);
            const distToSaved = Math.hypot(vp.center.x - saved.x, vp.center.y - saved.y);
            const scaleDiff = Math.abs(vp.scale.x - saved.scale);
            if (distToSaved < 2 && scaleDiff < 0.01) {
                vp.setZoom(saved.scale, true);
                vp.moveCenter(saved.x, saved.y);
            } else {
                try {
                    vp.animate({
                        position: new PIXI.Point(saved.x, saved.y),
                        scale: saved.scale,
                        time: 240,
                        ease: 'easeOutQuad',
                        removeOnInterrupt: true,
                    });
                } catch {
                    vp.setZoom(saved.scale, true);
                    vp.moveCenter(saved.x, saved.y);
                }
            }
            for (const plugin of ['drag', 'pinch', 'wheel', 'decelerate', 'clamp', 'clampZoom'] as const) {
                try {
                    vp.plugins.resume(plugin);
                } catch {
                    // Plugin may be disabled on this surface
                }
            }
        }
    });

    return null;
};

/**
 * Zero-drift trauma camera shake + Dutch-tilt + transient 2-beat Anime Impact Frame / Recon
 * Slate ColorMatrixFilter container.
 *
 * `schematicOverlay` renders as a sibling ABOVE the graded world container so cyan/crimson/amber
 * world-space tactical vectors stay at 100% full color contrast while inheriting exact shake & tilt.
 */
const WorldShakeContainer: React.FC<{
    children?: React.ReactNode;
    schematicOverlay?: React.ReactNode;
}> = ({ children, schematicOverlay }) => {
    const { viewport } = useViewportContext();
    const shakeRef = useRef<PIXI.Container>(null);
    const gradeRef = useRef<PIXI.Container>(null);
    const filterRef = useRef<PIXI.ColorMatrixFilter | null>(null);
    const filterAttachedRef = useRef(false);
    const reducedMotionRef = useRef<boolean>(getPrefersReducedMotion());

    useEffect(() => {
        reducedMotionRef.current = getPrefersReducedMotion();
        return subscribeReducedMotion((reduced) => {
            reducedMotionRef.current = reduced;
            if (reduced) {
                if (shakeRef.current && !shakeRef.current.destroyed) {
                    shakeRef.current.position.set(0, 0);
                    shakeRef.current.pivot.set(0, 0);
                    shakeRef.current.rotation = 0;
                }
                if (gradeRef.current && !gradeRef.current.destroyed && filterAttachedRef.current) {
                    gradeRef.current.filters = null;
                    filterAttachedRef.current = false;
                }
            }
        });
    }, []);

    useTick(() => {
        const container = shakeRef.current;
        if (!container || container.destroyed) return;
        const vp = viewport ?? getLiveViewport();
        const scale = vp && !vp.destroyed ? vp.scale.x : 1;
        const reduced = reducedMotionRef.current;
        const offset = fxTimeline.getShakeOffset(scale, reduced);
        const frame = fxTimeline.getKillCamFrame();

        // Apply Dutch-tilt around the current viewport center so tilting never shifts framing.
        const tilt = !reduced && frame.active ? frame.dutchTiltRad : 0;
        if (Math.abs(tilt) > 0.0004 && vp && !vp.destroyed) {
            const cx = vp.center.x;
            const cy = vp.center.y;
            container.pivot.set(cx, cy);
            container.position.set(cx + offset.x, cy + offset.y);
            container.rotation = tilt;
        } else {
            if (container.rotation !== 0) container.rotation = 0;
            if (container.pivot.x !== 0 || container.pivot.y !== 0) container.pivot.set(0, 0);
            if (container.x !== offset.x || container.y !== offset.y) {
                container.position.set(offset.x, offset.y);
            }
        }

        // Transient ColorMatrixFilter: 0% GPU cost when idle (`filters = null`).
        const graded = gradeRef.current;
        if (!graded || graded.destroyed) return;
        const flashGrade = !reduced && frame.active ? frame.impactFlashGrade : 0;
        const desat = !reduced && frame.active ? frame.worldDesat : 0;

        if (flashGrade > 0.015 || desat > 0.015) {
            if (!filterRef.current) {
                filterRef.current = new PIXI.ColorMatrixFilter();
            }
            const cm = filterRef.current;
            cm.reset();
            if (flashGrade > 0.015) {
                // Beat A (0–55ms): crisp high-contrast anime luminance flash pop!
                cm.desaturate();
                cm.contrast(0.65 * flashGrade, true);
                cm.brightness(1 + 0.42 * flashGrade, true);
            } else {
                // Beat B (SLAM -> SLOW): cool recon slate grade so glowing schematics pop.
                const d = Math.min(0.82, desat * 0.85);
                const s = 1 - d;
                // Custom cool slate desaturation matrix (subtle cyan-indigo shadow tint)
                const lr = 0.2126;
                const lg = 0.7152;
                const lb = 0.0722;
                const rTint = 1 - d * 0.14;
                const gTint = 1 - d * 0.04;
                const bTint = 1 + d * 0.12;
                cm.matrix = [
                    (lr * d + s) * rTint, lg * d * rTint, lb * d * rTint, 0, -0.02 * d,
                    lr * d * gTint, (lg * d + s) * gTint, lb * d * gTint, 0, -0.01 * d,
                    lr * d * bTint, lg * d * bTint, (lb * d + s) * bTint, 0, 0.04 * d,
                    0, 0, 0, 1, 0,
                ];
            }
            if (!filterAttachedRef.current) {
                graded.filters = [cm];
                filterAttachedRef.current = true;
            }
        } else if (filterAttachedRef.current) {
            graded.filters = null;
            filterAttachedRef.current = false;
        }
    });

    return (
        <Container ref={shakeRef} name="world_shake_root">
            <Container ref={gradeRef} name="world_grade_root">
                {children}
            </Container>
            {schematicOverlay}
        </Container>
    );
};

export const GameViewport = (
    props: Omit<ViewportComponentProps, 'app'> & {
        setViewport: (viewport: Viewport | null) => void;
        schematicOverlay?: React.ReactNode;
    },
) => {
    const app = useApp();
    const { children, schematicOverlay, setViewport, ...rest } = props;

    useEffect(() => {
        let raf = 0;
        // `create` runs on the render pass; publish once the instance actually exists.
        const publish = () => {
            const vp = getLiveViewport();
            if (vp) setViewport(vp);
            else raf = requestAnimationFrame(publish);
        };
        publish();
        return () => {
            cancelAnimationFrame(raf);
            setViewport(null);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    return (
        <>
            <PixiViewport app={app} {...rest}>
                <WorldShakeContainer schematicOverlay={schematicOverlay}>{children}</WorldShakeContainer>
            </PixiViewport>
            <KeyboardPanController />
            <CinematicCameraController />
        </>
    );
};
