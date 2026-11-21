
import * as PIXI from 'pixi.js';
import { Assets } from 'pixi.js';
import { PLAYER_COLORS } from '../constants/Config';
import { UnitType } from '../types';
import { createReconTileTexture, createReconUnitTexture } from './TacticalReconRenderer';

const TERRAIN_KEYS = [
  'PLAINS', 'FOREST', 'MOUNTAIN', 'WATER', 'BASE',
  'ROAD', 'ROAD_H', 'BRIDGE', 'BRIDGE_V', 'BANK', 'BANK_EMPTY',
  'BUILDING', 'BARRIER', 'SAND', 'DUNES', 'QUICKSAND', 'CANYON',
];

const UNIT_TYPES: UnitType[] = ['SOLDIER', 'ASSAULTER', 'SNIPER'];

let preloadPromise: Promise<void> | null = null;

export const TextureManager = {
  get: (key: string): PIXI.Texture => {
    if (!key) return PIXI.Texture.WHITE;

    // 1. Prefer procedural Tactical Recon HD textures in LegacyTextureCache so static emoji PNGs never shadow them
    const legacyKey = key.toUpperCase();
    // @ts-ignore
    if (window.LegacyTextureCache && window.LegacyTextureCache[legacyKey]) {
      // @ts-ignore
      return window.LegacyTextureCache[legacyKey];
    }

    // 2. Fallback to Pixi Assets cache
    if (Assets.cache.has(key)) {
      return Assets.get(key);
    }

    return PIXI.Texture.WHITE;
  },

  preloadTextures: async () => {
    if (preloadPromise) return preloadPromise;

    preloadPromise = (async () => {
      // @ts-ignore
      window.LegacyTextureCache = window.LegacyTextureCache || {};

      const registerTex = (k: string, tex: PIXI.Texture) => {
        // @ts-ignore
        window.LegacyTextureCache[k] = tex;
        Assets.cache.set(k, tex);
      };

      // Build crisp Tactical Recon HD tile sprites (zero emoji PNGs!)
      for (const key of TERRAIN_KEYS) {
        registerTex(`TERRAIN_${key}`, createReconTileTexture(key));
      }

      // Build crisp @2x top-down Tactical Recon HD unit sprites for all 6 players
      Object.entries(PLAYER_COLORS).forEach(([pid, color]) => {
        for (const uType of UNIT_TYPES) {
          registerTex(`UNIT_P${pid}_${uType}`, createReconUnitTexture(color, uType));
        }
      });

      const createTextureFromCanvas = (drawFn: (ctx: CanvasRenderingContext2D) => void, w: number, h: number) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (ctx) {
          drawFn(ctx);
          return PIXI.Texture.from(c);
        }
        return PIXI.Texture.WHITE;
      };

      // 1. PARTICLE_RAIN: 2x10px white rectangle
      const rainTex = createTextureFromCanvas(ctx => {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 2, 10);
      }, 2, 10);
      registerTex('PARTICLE_RAIN', rainTex);

      // 2. PARTICLE_DUST: 4px white circle
      const dustTex = createTextureFromCanvas(ctx => {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(2, 2, 2, 0, Math.PI * 2);
        ctx.fill();
      }, 4, 4);
      registerTex('PARTICLE_DUST', dustTex);

      // 3. NOISE_MAP (lightweight 128x128)
      const noiseTex = createTextureFromCanvas(ctx => {
        const idata = ctx.createImageData(128, 128);
        const buffer = new Uint32Array(idata.data.buffer);
        for (let i = 0; i < buffer.length; i++) {
          const v = (Math.random() * 255) | 0;
          buffer[i] = (255 << 24) | (v << 16) | (v << 8) | v;
        }
        ctx.putImageData(idata, 0, 0);
      }, 128, 128);
      registerTex('NOISE_MAP', noiseTex);
    })();

    return preloadPromise;
  }
};


export const getTexture = TextureManager.get;
export const preloadTextures = TextureManager.preloadTextures;

