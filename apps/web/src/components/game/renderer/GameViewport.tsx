import React, { useEffect, useRef } from 'react';
import { PixiComponent, useApp, useTick } from '@pixi/react';
import { Viewport } from 'pixi-viewport';
import * as PIXI from 'pixi.js';
import { useViewportContext } from '../../../context/ViewportContext';
import { useEffectStore } from '../../../store/useEffectStore';

interface ViewportComponentProps {
    app: PIXI.Application;
    width: number;
    height: number;
    worldWidth: number;
    worldHeight: number;
    setViewportRef: (viewport: Viewport) => void;
    children?: React.ReactNode;
}

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

        // Prevent browser scolling
        (viewport as any).on('wheel', (e: any) => {
            e.event.preventDefault();
        });

        frameMap(viewport);

        // Expose ref
        props.setViewportRef(viewport);

        return viewport;
    },
    applyProps: (instance, oldProps, newProps) => {
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
        try {
            instance.plugins.pause('drag');
            instance.plugins.pause('wheel');
            instance.plugins.pause('pinch');
            instance.plugins.pause('decelerate');
            instance.plugins.pause('clamp');
            instance.plugins.pause('clampZoom');
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
        if (!viewport) return;
        
        const speed = 15 * delta;
        // Divide speed by scale so panning doesn't feel ultra-fast when zoomed in
        const adjustedSpeed = speed / viewport.scale.x; 

        if (keys.current['ArrowUp'] || keys.current['KeyW']) viewport.moveCenter(viewport.center.x, viewport.center.y - adjustedSpeed);
        if (keys.current['ArrowDown'] || keys.current['KeyS']) viewport.moveCenter(viewport.center.x, viewport.center.y + adjustedSpeed);
        if (keys.current['ArrowLeft'] || keys.current['KeyA']) viewport.moveCenter(viewport.center.x - adjustedSpeed, viewport.center.y);
        if (keys.current['ArrowRight'] || keys.current['KeyD']) viewport.moveCenter(viewport.center.x + adjustedSpeed, viewport.center.y);
    });

    return null;
};

const ScreenShakeController = () => {
    const { viewport } = useViewportContext();
    const shakeIntensity = useEffectStore(state => state.shakeIntensity);
    const reduceShake = useEffectStore(state => state.reduceShake);

    useTick((delta) => {
        if (!viewport || shakeIntensity <= 0.1) return;

        // Apply shake (Drift method - simple impact)
        // High frequency shake
        const power = shakeIntensity * ((Math.random() > 0.5) ? 1 : -1);
        const powerY = shakeIntensity * ((Math.random() > 0.5) ? 1 : -1);

        viewport.x += power;
        viewport.y += powerY;

        // Damping
        reduceShake();
    });

    return null;
};

export const GameViewport = (props: Omit<ViewportComponentProps, 'app' | 'setViewportRef'> & { setViewport: (viewport: Viewport) => void }) => {
    const app = useApp();
    
    return (
        <>
            <PixiViewport app={app} setViewportRef={props.setViewport} {...props} />
            <KeyboardPanController />
            <ScreenShakeController />
        </>
    );
};

