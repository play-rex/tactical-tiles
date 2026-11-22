import { create } from 'zustand';

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

interface DamagePopup {
    id: string;
    x: number;
    y: number;
    value: string;
    color: string;
}

interface Projectile {
    id: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    type: 'BULLET' | 'MISSILE' | 'LASER';
    color: number;
}

interface EffectStore {
    damagePopups: DamagePopup[];
    shakeIntensity: number;
    projectiles: Projectile[];
    fxMode: FxMode;

    toggleFxMode: () => void;
    setFxMode: (mode: FxMode) => void;
    
    addDamagePopup: (x: number, y: number, value: string, color?: string) => void;
    removePopup: (id: string) => void;
    
    addProjectile: (sx: number, sy: number, ex: number, ey: number, type?: 'BULLET' | 'MISSILE' | 'LASER') => void;
    removeProjectile: (id: string) => void;

    triggerScreenShake: (intensity: number) => void;
    reduceShake: () => void;
}

export const useEffectStore = create<EffectStore>((set, get) => ({
    damagePopups: [],
    shakeIntensity: 0,
    projectiles: [],
    fxMode: 'ECO',

    toggleFxMode: () => set(state => ({ fxMode: state.fxMode === 'ECO' ? 'LIVE' : 'ECO' })),
    setFxMode: (mode) => set({ fxMode: mode }),

    addProjectile: (sx, sy, ex, ey, type = 'BULLET') => {
        const id = Math.random().toString(36).substr(2, 9);
        const color = type === 'LASER' ? 0xFF0000 : (type === 'MISSILE' ? 0xFFA500 : 0xFFFF00);
        
        set(state => ({
            projectiles: [...state.projectiles, { id, startX: sx, startY: sy, endX: ex, endY: ey, type, color }]
        }));
        wakeBattleRenderer(450);

        // Remove after animation (approx 300ms)
        setTimeout(() => get().removeProjectile(id), 300);
    },

    removeProjectile: (id) => {
        set(state => ({
            projectiles: state.projectiles.filter(p => p.id !== id)
        }));
    },

    addDamagePopup: (x, y, value, color = '#ffffff') => {
        const id = Math.random().toString(36).substr(2, 9);
        const popup = { id, x, y, value, color };
        
        set(state => ({
            damagePopups: [...state.damagePopups, popup]
        }));
        wakeBattleRenderer(1150);

        // Auto-remove after 1 second (animation duration)
        setTimeout(() => get().removePopup(id), 1000);
    },

    removePopup: (id) => {
        set(state => ({
            damagePopups: state.damagePopups.filter(p => p.id !== id)
        }));
    },

    triggerScreenShake: (intensity) => {
        // Add to current intensity to stack shakes explicitly, or just set max
        set(state => ({ shakeIntensity: Math.max(state.shakeIntensity, intensity) }));
        wakeBattleRenderer(550);
    },

    reduceShake: () => {
        set(state => {
            const next = state.shakeIntensity * 0.9;
            return { shakeIntensity: next < 0.05 ? 0 : next };
        });
    }
}));
