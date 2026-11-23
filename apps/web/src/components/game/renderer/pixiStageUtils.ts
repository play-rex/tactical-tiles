import { useEffect, useMemo } from 'react';
import { useApp } from '@pixi/react';

export function useLowPowerStageOptions(background: number, maxDpr = 1.25) {
  return useMemo(
    () => ({
      background,
      backgroundAlpha: 1,
      antialias: false,
      autoDensity: true,
      powerPreference: 'low-power' as const,
      resolution: Math.min(window.devicePixelRatio || 1, maxDpr),
    }),
    [background, maxDpr],
  );
}

export function useCoalescedStageRender(deps: unknown[]) {
  const app = useApp();
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      if (!(app.renderer as { destroyed?: boolean })?.destroyed) {
        app.renderer.render(app.stage);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [app, ...deps]);
}
