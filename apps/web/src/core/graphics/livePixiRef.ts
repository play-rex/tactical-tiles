/**
 * Lightweight runtime handle to the mounted PixiJS Application.
 * Kept in a zero-dependency module so store/test modules never pull `@pixi/react` into Node.
 */
export interface LivePixiAppHandle {
  view?: unknown;
  renderer?: unknown;
  ticker?: {
    add: (fn: () => void, context?: unknown, priority?: number) => void;
    remove: (fn: () => void) => void;
  };
}

let livePixiApp: LivePixiAppHandle | null = null;

export const setLivePixiApp = (app: LivePixiAppHandle | null): void => {
  livePixiApp = app;
};

export const getLivePixiApp = (): LivePixiAppHandle | null =>
  livePixiApp && !(livePixiApp.renderer as { destroyed?: boolean } | undefined)?.destroyed ? livePixiApp : null;
