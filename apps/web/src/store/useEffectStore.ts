import { create } from 'zustand';
import type { WeaponVisual } from '@tactical/engine';
import {
  fxTimeline,
  projectileColorFor,
  type PopupSpawnRequest,
  type ProjectileSpawnRequest,
  type ProjectileVisualStyle,
} from '../core/graphics/fxTimeline';
import { SoundFX } from '../core/audio/SoundFX';

export type FxMode = 'ECO' | 'LIVE';

const wakeListeners = new Set<(durationMs?: number) => void>();

/** Wakes PixiJS WebGL rendering cleanly without triggering React re-renders (0 = single frame). */
export const wakeBattleRenderer = (durationMs = 600) => {
  wakeListeners.forEach(fn => fn(durationMs));
};

export const subscribeRendererWake = (fn: (durationMs?: number) => void): (() => void) => {
  wakeListeners.add(fn);
  return () => {
    wakeListeners.delete(fn);
  };
};

export interface DamagePopup {
  id: string;
  x: number;
  y: number;
  value: string;
  color: string;
  durationMs: number;
}

export interface Projectile {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  type: ProjectileVisualStyle;
  weapon?: WeaponVisual;
  color: number;
  travelMs: number;
}

interface EffectStore {
  damagePopups: DamagePopup[];
  projectiles: Projectile[];
  fxMode: FxMode;

  toggleFxMode: () => void;
  setFxMode: (mode: FxMode) => void;

  spawnPopup: (popup: PopupSpawnRequest) => void;
  addDamagePopup: (x: number, y: number, value: string, color?: string) => void;
  removePopup: (id: string) => void;

  spawnProjectile: (proj: ProjectileSpawnRequest) => void;
  addProjectile: (sx: number, sy: number, ex: number, ey: number, type?: ProjectileVisualStyle) => void;
  removeProjectile: (id: string) => void;

  triggerScreenShake: (intensity: number) => void;
  clearAllFx: () => void;
}

let manualFxSeq = 1;

export const useEffectStore = create<EffectStore>((set, get) => ({
  damagePopups: [],
  projectiles: [],
  fxMode: 'ECO',

  toggleFxMode: () => set(state => ({ fxMode: state.fxMode === 'ECO' ? 'LIVE' : 'ECO' })),
  setFxMode: (mode) => set({ fxMode: mode }),

  spawnProjectile: (proj) => {
    set(state => ({ projectiles: [...state.projectiles, proj] }));
    wakeBattleRenderer(proj.travelMs + 220);
  },

  addProjectile: (sx, sy, ex, ey, type = 'BULLET') => {
    const id = `manual_proj_${manualFxSeq++}`;
    const travelMs = type === 'LASER' ? 140 : type === 'MISSILE' ? 220 : 170;
    const color = projectileColorFor(type);
    get().spawnProjectile({ id, startX: sx, startY: sy, endX: ex, endY: ey, type, color, travelMs });
    fxTimeline.schedule(travelMs + 60, () => get().removeProjectile(id), 'manual-proj-cleanup');
  },

  removeProjectile: (id) => {
    set(state => {
      if (!state.projectiles.some(p => p.id === id)) return state;
      return { projectiles: state.projectiles.filter(p => p.id !== id) };
    });
  },

  spawnPopup: (popup) => {
    set(state => ({ damagePopups: [...state.damagePopups, popup] }));
    wakeBattleRenderer(popup.durationMs + 160);
  },

  addDamagePopup: (x, y, value, color = '#ffffff') => {
    const id = `manual_pop_${manualFxSeq++}`;
    const durationMs = 960;
    get().spawnPopup({ id, x, y, value, color, durationMs });
    fxTimeline.schedule(durationMs, () => get().removePopup(id), 'manual-pop-cleanup');
  },

  removePopup: (id) => {
    set(state => {
      if (!state.damagePopups.some(p => p.id === id)) return state;
      return { damagePopups: state.damagePopups.filter(p => p.id !== id) };
    });
  },

  triggerScreenShake: (intensity) => {
    fxTimeline.addTraumaFromIntensity(intensity);
  },

  clearAllFx: () => {
    fxTimeline.clear();
  },
}));

// Wire fxTimeline's store + audio + wake sink once at module load
fxTimeline.configure({
  playSound: (sound) => SoundFX.play(sound),
  spawnProjectile: (proj) => useEffectStore.getState().spawnProjectile(proj),
  removeProjectile: (id) => useEffectStore.getState().removeProjectile(id),
  spawnPopup: (popup) => useEffectStore.getState().spawnPopup(popup),
  removePopup: (id) => useEffectStore.getState().removePopup(id),
  onWake: (durationMs) => wakeBattleRenderer(durationMs),
  onClearVisuals: () => {
    const st = useEffectStore.getState();
    if (st.projectiles.length > 0 || st.damagePopups.length > 0) {
      useEffectStore.setState({ projectiles: [], damagePopups: [] });
    }
  },
});
