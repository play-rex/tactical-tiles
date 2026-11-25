import { create } from 'zustand';
import type { WeaponVisual } from '@tactical/engine';
import {
  fxTimeline,
  getPrefersReducedMotion,
  projectileColorFor,
  type AirDropAnimRequest,
  type CrossfireLockRequest,
  type DeathGhostRequest,
  type PendingDeathVisual,
  type PopupSpawnRequest,
  type ProjectileSpawnRequest,
  type ProjectileVisualStyle,
  type PromotionBurstRequest,
  type SupplyDropAnimRequest,
  type TacticalCalloutRequest,
  type TacticalFxAnimRequest,
  type TileEffectRequest,
} from '../core/graphics/fxTimeline';
import { SoundFX } from '../core/audio/SoundFX';
import type { KillCamMode } from '../core/graphics/killCam';

export type FxMode = 'ECO' | 'LIVE';

const FX_MODE_STORAGE_KEY = 'tactical_tiles_fx_mode';
const KILL_CAM_MODE_STORAGE_KEY = 'tactical_tiles_killcam_mode';

const readSavedKillCamMode = (): KillCamMode => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(KILL_CAM_MODE_STORAGE_KEY);
      if (raw === 'FULL' || raw === 'SHORT' || raw === 'OFF') {
        return raw;
      }
    }
  } catch {
    // Ignore storage unavailability
  }
  return 'FULL';
};

const saveKillCamMode = (mode: KillCamMode): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KILL_CAM_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage quota or private browsing errors
  }
};

const initialKillCamMode = readSavedKillCamMode();
fxTimeline.setKillCamMode(initialKillCamMode);

const readSavedFxMode = (): FxMode => {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(FX_MODE_STORAGE_KEY);
      if (raw === 'ECO' || raw === 'LIVE') {
        return raw;
      }
    }
  } catch {
    // Ignore storage unavailability
  }
  return getPrefersReducedMotion() ? 'ECO' : 'ECO';
};

const saveFxMode = (mode: FxMode): void => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FX_MODE_STORAGE_KEY, mode);
    }
  } catch {
    // Ignore storage quota or private browsing errors
  }
};

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
  burstRounds?: number;
}

export type CrossfireLock = CrossfireLockRequest;
export type PendingDeath = PendingDeathVisual;
export type DeathGhost = DeathGhostRequest;
export type TileEffect = TileEffectRequest;
export type TacticalCallout = TacticalCalloutRequest;
export type SupplyDropAnim = SupplyDropAnimRequest;
export type AirDropAnim = AirDropAnimRequest;
export type PromotionBurst = PromotionBurstRequest;
export type TacticalFxAnim = TacticalFxAnimRequest;

interface EffectStore {
  damagePopups: DamagePopup[];
  projectiles: Projectile[];
  crossfireLocks: CrossfireLock[];
  deferredHp: Record<string, number>;
  pendingDeaths: PendingDeath[];
  deathGhosts: DeathGhost[];
  tileEffects: TileEffect[];
  supplyDrops: SupplyDropAnim[];
  airDropAnims: AirDropAnim[];
  pendingAirDropTiles: string[];
  promotionBursts: PromotionBurst[];
  tacticalEffects: TacticalFxAnim[];
  activeCallout: TacticalCallout | null;
  fxMode: FxMode;
  killCamMode: KillCamMode;
  /** Live boolean synced on `IDLE <-> ACTIVE` transitions (used to defer modals without per-frame re-renders). */
  killCamActive: boolean;

  toggleFxMode: () => void;
  setFxMode: (mode: FxMode) => void;
  cycleKillCamMode: () => void;
  setKillCamMode: (mode: KillCamMode) => void;

  spawnPopup: (popup: PopupSpawnRequest) => void;
  addDamagePopup: (x: number, y: number, value: string, color?: string) => void;
  removePopup: (id: string) => void;

  spawnProjectile: (proj: ProjectileSpawnRequest) => void;
  addProjectile: (sx: number, sy: number, ex: number, ey: number, type?: ProjectileVisualStyle) => void;
  removeProjectile: (id: string) => void;

  spawnCrossfire: (lock: CrossfireLockRequest) => void;
  removeCrossfire: (id: string) => void;

  addDeferredHp: (unitId: string, amount: number) => void;
  clearDeferredHp: (unitId: string, amount: number) => void;

  addPendingDeath: (ghost: PendingDeathVisual) => void;
  removePendingDeath: (unitId: string) => void;

  spawnDeathGhost: (ghost: DeathGhostRequest) => void;
  removeDeathGhost: (id: string) => void;

  spawnTileEffect: (fx: TileEffectRequest) => void;
  removeTileEffect: (id: string) => void;

  spawnSupplyDrop: (drop: SupplyDropAnimRequest) => void;
  removeSupplyDrop: (id: string) => void;

  spawnAirDrop: (anim: AirDropAnimRequest) => void;
  completeAirDropTouchdown: (id: string) => void;
  removeAirDrop: (id: string) => void;
  addPendingAirDropTile: (tileId: string) => void;
  removePendingAirDropTile: (tileId: string) => void;

  spawnPromotionBurst: (burst: PromotionBurstRequest) => void;
  removePromotionBurst: (id: string) => void;

  spawnTacticalEffect: (fx: TacticalFxAnimRequest) => void;
  completeTacticalCombat: (id: string, ambientTailMs?: number) => void;
  removeTacticalEffect: (id: string) => void;

  showCallout: (callout: TacticalCalloutRequest) => void;
  dismissCallout: (id: string) => void;

  triggerScreenShake: (intensity: number) => void;
  clearAllFx: () => void;
}

let manualFxSeq = 1;

export const useEffectStore = create<EffectStore>((set, get) => ({
  damagePopups: [],
  projectiles: [],
  crossfireLocks: [],
  deferredHp: {},
  pendingDeaths: [],
  deathGhosts: [],
  tileEffects: [],
  supplyDrops: [],
  airDropAnims: [],
  pendingAirDropTiles: [],
  promotionBursts: [],
  tacticalEffects: [],
  activeCallout: null,
  fxMode: readSavedFxMode(),
  killCamMode: initialKillCamMode,
  killCamActive: fxTimeline.isKillCamActive(),

  toggleFxMode: () =>
    set(state => {
      const next: FxMode = state.fxMode === 'ECO' ? 'LIVE' : 'ECO';
      saveFxMode(next);
      return { fxMode: next };
    }),
  setFxMode: (mode) => {
    saveFxMode(mode);
    set({ fxMode: mode });
  },
  cycleKillCamMode: () => {
    const cur = get().killCamMode;
    const next: KillCamMode = cur === 'FULL' ? 'SHORT' : cur === 'SHORT' ? 'OFF' : 'FULL';
    saveKillCamMode(next);
    fxTimeline.setKillCamMode(next);
    set({ killCamMode: next });
  },
  setKillCamMode: (mode) => {
    saveKillCamMode(mode);
    fxTimeline.setKillCamMode(mode);
    set({ killCamMode: mode });
  },

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

  spawnCrossfire: (lock) => {
    set(state => ({ crossfireLocks: [...state.crossfireLocks, lock] }));
    wakeBattleRenderer(lock.durationMs + 100);
  },

  removeCrossfire: (id) => {
    set(state => {
      if (!state.crossfireLocks.some(c => c.id === id)) return state;
      return { crossfireLocks: state.crossfireLocks.filter(c => c.id !== id) };
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

  addDeferredHp: (unitId, amount) => {
    if (amount <= 0) return;
    set(state => ({
      deferredHp: {
        ...state.deferredHp,
        [unitId]: (state.deferredHp[unitId] ?? 0) + amount,
      },
    }));
  },

  clearDeferredHp: (unitId, amount) => {
    set(state => {
      const cur = state.deferredHp[unitId];
      if (!cur) return state;
      const nextVal = Math.max(0, cur - amount);
      const next = { ...state.deferredHp };
      if (nextVal <= 0) delete next[unitId];
      else next[unitId] = nextVal;
      return { deferredHp: next };
    });
  },

  addPendingDeath: (ghost) => {
    set(state => ({
      pendingDeaths: [...state.pendingDeaths.filter(d => d.unitId !== ghost.unitId), ghost],
    }));
  },

  removePendingDeath: (unitId) => {
    set(state => {
      if (!state.pendingDeaths.some(d => d.unitId === unitId)) return state;
      return { pendingDeaths: state.pendingDeaths.filter(d => d.unitId !== unitId) };
    });
  },

  spawnDeathGhost: (ghost) => {
    set(state => ({ deathGhosts: [...state.deathGhosts, ghost] }));
    wakeBattleRenderer(ghost.durationMs + 160);
  },

  removeDeathGhost: (id) => {
    set(state => {
      if (!state.deathGhosts.some(g => g.id === id)) return state;
      return { deathGhosts: state.deathGhosts.filter(g => g.id !== id) };
    });
  },

  spawnTileEffect: (fx) => {
    set(state => ({ tileEffects: [...state.tileEffects, fx] }));
    wakeBattleRenderer(fx.durationMs + 120);
  },

  removeTileEffect: (id) => {
    set(state => {
      if (!state.tileEffects.some(t => t.id === id)) return state;
      return { tileEffects: state.tileEffects.filter(t => t.id !== id) };
    });
  },

  spawnSupplyDrop: (drop) => {
    set(state => ({ supplyDrops: [...state.supplyDrops, drop] }));
    wakeBattleRenderer(drop.durationMs + 160);
  },

  removeSupplyDrop: (id) => {
    set(state => {
      if (!state.supplyDrops.some(d => d.id === id)) return state;
      return { supplyDrops: state.supplyDrops.filter(d => d.id !== id) };
    });
  },

  spawnPromotionBurst: (burst) => {
    set(state => ({ promotionBursts: [...state.promotionBursts, burst] }));
    wakeBattleRenderer(burst.durationMs + 160);
  },

  removePromotionBurst: (id) => {
    set(state => {
      if (!state.promotionBursts.some(b => b.id === id)) return state;
      return { promotionBursts: state.promotionBursts.filter(b => b.id !== id) };
    });
  },

  spawnTacticalEffect: (fx) => {
    set(state => ({ tacticalEffects: [...state.tacticalEffects, fx] }));
    wakeBattleRenderer(fx.durationMs + (fx.ambientTailMs ?? 0) + 260);
  },

  completeTacticalCombat: (id, ambientTailMs = 0) => {
    if (!ambientTailMs || ambientTailMs <= 0) {
      get().removeTacticalEffect(id);
      return;
    }
    // Keep aircraft gliding off the far map edge in live gameplay without keeping fxTimeline active.
    wakeBattleRenderer(ambientTailMs + 280);
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        get().removeTacticalEffect(id);
      }, ambientTailMs + 650);
    }
  },

  removeTacticalEffect: (id) => {
    set(state => {
      if (!state.tacticalEffects.some(t => t.id === id)) return state;
      return { tacticalEffects: state.tacticalEffects.filter(t => t.id !== id) };
    });
  },

  spawnAirDrop: (anim) => {
    set(state => ({ airDropAnims: [...state.airDropAnims, anim] }));
    wakeBattleRenderer(anim.kinematics.totalMs + 280);
  },

  completeAirDropTouchdown: (id) => {
    set(state => {
      const idx = state.airDropAnims.findIndex(a => a.id === id);
      if (idx === -1) return state;
      const next = [...state.airDropAnims];
      next[idx] = { ...next[idx], ambientOnly: true };
      return { airDropAnims: next };
    });
  },

  removeAirDrop: (id) => {
    set(state => {
      if (!state.airDropAnims.some(a => a.id === id)) return state;
      return { airDropAnims: state.airDropAnims.filter(a => a.id !== id) };
    });
  },

  addPendingAirDropTile: (tileId) => {
    set(state =>
      state.pendingAirDropTiles.includes(tileId)
        ? state
        : { pendingAirDropTiles: [...state.pendingAirDropTiles, tileId] },
    );
  },

  removePendingAirDropTile: (tileId) => {
    set(state =>
      state.pendingAirDropTiles.includes(tileId)
        ? { pendingAirDropTiles: state.pendingAirDropTiles.filter(id => id !== tileId) }
        : state,
    );
  },

  showCallout: (callout) => {
    set(state => {
      if (state.activeCallout && state.activeCallout.priority > callout.priority) {
        return state;
      }
      return { activeCallout: callout };
    });
  },

  dismissCallout: (id) => {
    set(state => (state.activeCallout?.id === id ? { activeCallout: null } : state));
  },

  triggerScreenShake: (intensity) => {
    fxTimeline.addTraumaFromIntensity(intensity);
  },

  clearAllFx: () => {
    // Match-scoped: only match start / reset / exit reach here, so the first-breach milestones
    // can be re-armed here and nowhere else.
    fxTimeline.resetMatchMemory();
    fxTimeline.clear();
  },
}));

// Wire fxTimeline's store + realistic Foley audio + wake sink once at module load
fxTimeline.configure({
  playSound: (sound) => SoundFX.play(sound),
  playWeaponFire: (weapon, burstRounds) => {
    switch (weapon) {
      case 'SOLDIER':
        SoundFX.playPistolShot();
        break;
      case 'ASSAULTER':
      case 'SIEGE':
        SoundFX.playTankCannonFire();
        break;
      case 'SNIPER':
        SoundFX.playSniperShot();
        break;
      case 'ARTILLERY': {
        const rounds = burstRounds ?? 6;
        SoundFX.playMachineGunBurst(rounds, rounds <= 4 ? 0.054 : 0.056);
        break;
      }
      case 'TURRET':
        SoundFX.playTurretShot();
        break;
      default:
        SoundFX.playPistolShot();
        break;
    }
  },
  playWeaponImpact: (weapon, burstRounds) => {
    if (weapon === 'ASSAULTER' || weapon === 'SIEGE') {
      SoundFX.playTankBlastImpact();
    } else if (weapon === 'ARTILLERY') {
      const hits = Math.max(2, Math.min(3, (burstRounds ?? 6) - 2));
      SoundFX.play('hit');
      for (let i = 1; i < hits; i++) {
        fxTimeline.schedule(i * 62, () => SoundFX.play('hit'), `mg-impact-${i + 1}`);
      }
    } else {
      SoundFX.play('hit');
    }
  },
  playTurretSwivel: () => SoundFX.playTurretSwivel(),
  playUnitMove: (unitType, durationMs, terrain) => SoundFX.playUnitMove(unitType, durationMs, terrain),
  playTacticalFoley: (kind) => {
    switch (kind) {
      case 'reload':
        SoundFX.playReload();
        break;
      case 'overwatch':
        SoundFX.playOverwatchLock();
        break;
      case 'heal':
        SoundFX.playHealFoley();
        break;
      case 'build':
        SoundFX.playBuildFoley();
        break;
    }
  },
  playTacticalSound: (itemKey, phase, meta) => SoundFX.playTacticalSound(itemKey, phase, meta),
  playAirDrop: (kind, stage) => SoundFX.playAirDrop(kind, stage),
  playKillConfirm: () => SoundFX.playKillConfirm(),
  playKillCamSting: (stage, tier, flightRealMs) => SoundFX.playKillCamSting(stage, tier, flightRealMs),
  playMineClick: () => SoundFX.playMineClick(),
  playOverwatchStatic: () => SoundFX.playOverwatchStatic(),
  playGrazeSurvive: () => SoundFX.playGrazeSurvive(),
  spawnProjectile: (proj) => useEffectStore.getState().spawnProjectile(proj),
  removeProjectile: (id) => useEffectStore.getState().removeProjectile(id),
  spawnCrossfire: (lock) => useEffectStore.getState().spawnCrossfire(lock),
  removeCrossfire: (id) => useEffectStore.getState().removeCrossfire(id),
  spawnPopup: (popup) => useEffectStore.getState().spawnPopup(popup),
  removePopup: (id) => useEffectStore.getState().removePopup(id),
  addDeferredHp: (unitId, amount) => useEffectStore.getState().addDeferredHp(unitId, amount),
  clearDeferredHp: (unitId, amount) => useEffectStore.getState().clearDeferredHp(unitId, amount),
  addPendingDeath: (ghost) => useEffectStore.getState().addPendingDeath(ghost),
  removePendingDeath: (unitId) => useEffectStore.getState().removePendingDeath(unitId),
  spawnDeathGhost: (ghost) => useEffectStore.getState().spawnDeathGhost(ghost),
  removeDeathGhost: (id) => useEffectStore.getState().removeDeathGhost(id),
  spawnTileEffect: (fx) => useEffectStore.getState().spawnTileEffect(fx),
  removeTileEffect: (id) => useEffectStore.getState().removeTileEffect(id),
  spawnSupplyDrop: (drop) => useEffectStore.getState().spawnSupplyDrop(drop),
  removeSupplyDrop: (id) => useEffectStore.getState().removeSupplyDrop(id),
  spawnAirDrop: (anim) => useEffectStore.getState().spawnAirDrop(anim),
  completeAirDropTouchdown: (id) => useEffectStore.getState().completeAirDropTouchdown(id),
  removeAirDrop: (id) => useEffectStore.getState().removeAirDrop(id),
  addPendingAirDropTile: (tileId) => useEffectStore.getState().addPendingAirDropTile(tileId),
  removePendingAirDropTile: (tileId) => useEffectStore.getState().removePendingAirDropTile(tileId),
  spawnPromotionBurst: (burst) => useEffectStore.getState().spawnPromotionBurst(burst),
  removePromotionBurst: (id) => useEffectStore.getState().removePromotionBurst(id),
  spawnTacticalEffect: (fx) => useEffectStore.getState().spawnTacticalEffect(fx),
  completeTacticalCombat: (id, ambientTailMs) => useEffectStore.getState().completeTacticalCombat(id, ambientTailMs),
  removeTacticalEffect: (id) => useEffectStore.getState().removeTacticalEffect(id),
  showCallout: (callout) => useEffectStore.getState().showCallout(callout),
  onWake: (durationMs) => wakeBattleRenderer(durationMs),
  onClearVisuals: () => {
    const st = useEffectStore.getState();
    if (
      st.projectiles.length > 0 ||
      st.damagePopups.length > 0 ||
      st.crossfireLocks.length > 0 ||
      st.pendingDeaths.length > 0 ||
      st.deathGhosts.length > 0 ||
      st.tileEffects.length > 0 ||
      st.supplyDrops.length > 0 ||
      st.airDropAnims.length > 0 ||
      st.pendingAirDropTiles.length > 0 ||
      st.promotionBursts.length > 0 ||
      st.tacticalEffects.length > 0 ||
      st.activeCallout !== null ||
      Object.keys(st.deferredHp).length > 0
    ) {
      useEffectStore.setState({
        projectiles: [],
        damagePopups: [],
        crossfireLocks: [],
        deferredHp: {},
        pendingDeaths: [],
        deathGhosts: [],
        tileEffects: [],
        supplyDrops: [],
        airDropAnims: [],
        pendingAirDropTiles: [],
        promotionBursts: [],
        tacticalEffects: [],
        activeCallout: null,
      });
    }
  },
});

fxTimeline.subscribeKillCamActive((active) => {
  if (useEffectStore.getState().killCamActive !== active) {
    useEffectStore.setState({ killCamActive: active });
  }
});
