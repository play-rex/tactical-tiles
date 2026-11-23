/**
 * Zero-allocation dual-batch PixiJS pooled particle engine.
 *
 * Pre-bakes 5 soft procedural textures once on offscreen canvases and reuses a fixed
 * pool of sprites split across NORMAL and ADDITIVE blend containers (2 draw calls total).
 * Supports screen-upright gravity rotated by `-mapRotation` so smoke, embers, and heal orbs
 * always rise vertically in viewer space regardless of board rotation.
 */
import * as PIXI from 'pixi.js';
import type { BoardRotation } from '../boardRotation';
import type { ParticleEmitRequest } from './fxTimeline';

type TextureKind = 'softPuff' | 'spark' | 'ring' | 'glow' | 'shard';

interface ParticleTextures {
  softPuff: PIXI.Texture;
  spark: PIXI.Texture;
  ring: PIXI.Texture;
  glow: PIXI.Texture;
  shard: PIXI.Texture;
}

interface ParticleSlot {
  sprite: PIXI.Sprite;
  active: boolean;
  ageMs: number;
  lifeMs: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Acceleration along screen-up vector (px/s²). Positive = floats up, negative = falls down. */
  upAccel: number;
  /** Exponential velocity damping per second (0..10). */
  drag: number;
  startScaleX: number;
  startScaleY: number;
  endScaleX: number;
  endScaleY: number;
  startAlpha: number;
  peakAlpha: number;
  fadeInFrac: number;
  rotation: number;
  vr: number;
  alignToVelocity: boolean;
}

interface SpawnSpec {
  texture: TextureKind;
  additive?: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  upAccel?: number;
  drag?: number;
  lifeMs: number;
  startScale: number;
  endScale: number;
  startScaleY?: number;
  endScaleY?: number;
  color: number;
  alpha: number;
  fadeInFrac?: number;
  rotation?: number;
  vr?: number;
  alignToVelocity?: boolean;
}

let cachedTextures: ParticleTextures | null = null;

const makeCanvasTexture = (size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, height = size): PIXI.Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    draw(ctx, size);
  }
  return PIXI.Texture.from(canvas);
};

const getParticleTextures = (): ParticleTextures => {
  if (
    cachedTextures &&
    !cachedTextures.softPuff.baseTexture.destroyed &&
    !cachedTextures.spark.baseTexture.destroyed &&
    !cachedTextures.ring.baseTexture.destroyed &&
    !cachedTextures.glow.baseTexture.destroyed &&
    !cachedTextures.shard.baseTexture.destroyed
  ) {
    return cachedTextures;
  }

  // 1. Soft feathered puff (dust / smoke)
  const softPuff = makeCanvasTexture(48, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 2, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.58)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

  // 2. Elongated streak spark (ricochets, shrapnel, muzzle jets)
  const spark = makeCanvasTexture(
    48,
    (ctx, w) => {
      const h = 16;
      const cy = h / 2;
      const g = ctx.createLinearGradient(0, cy, w, cy);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.75)');
      g.addColorStop(0.82, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0.2)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(w * 0.56, cy, w * 0.44, h * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    16,
  );

  // 3. Soft-edged shockwave / ripple ring
  const ring = makeCanvasTexture(96, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, c * 0.56, c, c, c * 0.98);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.22)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.98)');
    g.addColorStop(0.92, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

  // 4. Additive radial glow orb (muzzle flash, plasma, heal aura)
  const glow = makeCanvasTexture(64, (ctx, s) => {
    const c = s / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.52, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });

  // 5. Faceted diamond shard (leaves, debris, coins, embers)
  const shard = makeCanvasTexture(24, (ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c, 2);
    ctx.lineTo(s - 4, c);
    ctx.lineTo(c, s - 2);
    ctx.lineTo(4, c);
    ctx.closePath();
    ctx.fill();
  });

  cachedTextures = { softPuff, spark, ring, glow, shard };
  return cachedTextures;
};

/** Board-space unit vector pointing screen-up for any client map rotation. */
export const screenUpVector = (rotation: BoardRotation): { x: number; y: number } => {
  switch (rotation) {
    case 90:
      return { x: -1, y: 0 };
    case 180:
      return { x: 0, y: 1 };
    case 270:
      return { x: 1, y: 0 };
    default:
      return { x: 0, y: -1 };
  }
};

const randRange = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

const NORMAL_POOL_CAPACITY = 128;
const ADDITIVE_POOL_CAPACITY = 96;

export class ParticlePool {
  public readonly root: PIXI.Container;
  private readonly normalContainer: PIXI.Container;
  private readonly additiveContainer: PIXI.Container;
  private readonly normalSlots: ParticleSlot[] = [];
  private readonly additiveSlots: ParticleSlot[] = [];
  private readonly textures: ParticleTextures;
  private normalCursor = 0;
  private additiveCursor = 0;
  private activeCount = 0;
  private mapRotation: BoardRotation = 0;
  private destroyed = false;

  constructor(rootContainer: PIXI.Container) {
    this.root = rootContainer;
    this.textures = getParticleTextures();

    this.normalContainer = new PIXI.Container();
    this.normalContainer.eventMode = 'none';
    this.additiveContainer = new PIXI.Container();
    this.additiveContainer.eventMode = 'none';

    this.root.addChild(this.normalContainer);
    this.root.addChild(this.additiveContainer);

    this.initPool(this.normalSlots, this.normalContainer, NORMAL_POOL_CAPACITY, PIXI.BLEND_MODES.NORMAL);
    this.initPool(this.additiveSlots, this.additiveContainer, ADDITIVE_POOL_CAPACITY, PIXI.BLEND_MODES.ADD);
  }

  private initPool(
    target: ParticleSlot[],
    container: PIXI.Container,
    capacity: number,
    blendMode: PIXI.BLEND_MODES,
  ): void {
    for (let i = 0; i < capacity; i++) {
      const sprite = new PIXI.Sprite(this.textures.softPuff);
      sprite.anchor.set(0.5);
      sprite.visible = false;
      sprite.eventMode = 'none';
      sprite.blendMode = blendMode;
      container.addChild(sprite);
      target.push({
        sprite,
        active: false,
        ageMs: 0,
        lifeMs: 1,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        upAccel: 0,
        drag: 0,
        startScaleX: 1,
        startScaleY: 1,
        endScaleX: 1,
        endScaleY: 1,
        startAlpha: 1,
        peakAlpha: 1,
        fadeInFrac: 0.1,
        rotation: 0,
        vr: 0,
        alignToVelocity: false,
      });
    }
  }

  public setMapRotation(rotation: BoardRotation): void {
    this.mapRotation = rotation;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public hasActiveParticles(): boolean {
    return this.activeCount > 0;
  }

  private acquireSlot(additive: boolean): ParticleSlot {
    const list = additive ? this.additiveSlots : this.normalSlots;
    const len = list.length;
    let cursor = additive ? this.additiveCursor : this.normalCursor;

    for (let i = 0; i < len; i++) {
      const idx = (cursor + i) % len;
      if (!list[idx].active) {
        cursor = (idx + 1) % len;
        if (additive) this.additiveCursor = cursor;
        else this.normalCursor = cursor;
        return list[idx];
      }
    }

    // Pool saturated: recycle oldest active slot cleanly
    const slot = list[cursor];
    if (slot.active) {
      slot.active = false;
      this.activeCount = Math.max(0, this.activeCount - 1);
    }
    cursor = (cursor + 1) % len;
    if (additive) this.additiveCursor = cursor;
    else this.normalCursor = cursor;
    return slot;
  }

  public spawn(spec: SpawnSpec): void {
    if (this.destroyed) return;
    const slot = this.acquireSlot(Boolean(spec.additive));
    slot.active = true;
    slot.ageMs = 0;
    slot.lifeMs = Math.max(40, spec.lifeMs);
    slot.x = spec.x;
    slot.y = spec.y;
    slot.vx = spec.vx;
    slot.vy = spec.vy;
    slot.upAccel = spec.upAccel ?? 0;
    slot.drag = spec.drag ?? 2.5;
    slot.startScaleX = spec.startScale;
    slot.startScaleY = spec.startScaleY ?? spec.startScale;
    slot.endScaleX = spec.endScale;
    slot.endScaleY = spec.endScaleY ?? spec.endScale;
    slot.peakAlpha = spec.alpha;
    slot.fadeInFrac = spec.fadeInFrac ?? 0.08;
    slot.alignToVelocity = Boolean(spec.alignToVelocity);
    slot.rotation = spec.alignToVelocity ? Math.atan2(spec.vy, spec.vx) : (spec.rotation ?? 0);
    slot.vr = spec.vr ?? 0;

    const sp = slot.sprite;
    sp.texture = this.textures[spec.texture];
    sp.tint = spec.color;
    sp.position.set(slot.x, slot.y);
    sp.scale.set(slot.startScaleX, slot.startScaleY);
    sp.rotation = slot.rotation;
    sp.alpha = slot.fadeInFrac > 0 ? 0.01 : slot.peakAlpha;
    sp.visible = true;

    this.activeCount++;
  }

  public emit(req: ParticleEmitRequest): void {
    if (this.destroyed) return;
    const s = req.scale ?? 1;
    const x = req.x;
    const y = req.y;
    const dir = req.angle ?? 0;
    const up = screenUpVector(this.mapRotation);

    switch (req.preset) {
      case 'muzzleFlash': {
        const col = req.color ?? 0xFDE047;
        // Intense core flash
        this.spawn({
          texture: 'glow',
          additive: true,
          x,
          y,
          vx: Math.cos(dir) * 20,
          vy: Math.sin(dir) * 20,
          drag: 8,
          lifeMs: 95,
          startScale: 0.42 * s,
          endScale: 0.1 * s,
          color: 0xFFFBEB,
          alpha: 0.95,
          fadeInFrac: 0,
        });
        this.spawn({
          texture: 'glow',
          additive: true,
          x,
          y,
          vx: Math.cos(dir) * 35,
          vy: Math.sin(dir) * 35,
          drag: 7,
          lifeMs: 120,
          startScale: 0.62 * s,
          endScale: 0.18 * s,
          color: col,
          alpha: 0.85,
          fadeInFrac: 0,
        });
        // Forward jet sparks
        const sparkCount = Math.round(5 * s);
        for (let i = 0; i < sparkCount; i++) {
          const ang = dir + randRange(-0.42, 0.42);
          const spd = randRange(130, 270) * s;
          this.spawn({
            texture: 'spark',
            additive: true,
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            drag: 6,
            lifeMs: randRange(110, 190),
            startScale: randRange(0.32, 0.55) * s,
            endScale: 0.08 * s,
            color: i % 2 === 0 ? 0xFFFBEB : col,
            alpha: 0.95,
            fadeInFrac: 0,
            alignToVelocity: true,
          });
        }
        // Subtle gunsmoke wisps
        for (let i = 0; i < 2; i++) {
          const ang = dir + randRange(-0.65, 0.65);
          const spd = randRange(25, 65) * s;
          this.spawn({
            texture: 'softPuff',
            x: x + randRange(-3, 3),
            y: y + randRange(-3, 3),
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: 35,
            drag: 4,
            lifeMs: randRange(260, 420),
            startScale: 0.24 * s,
            endScale: 0.65 * s,
            color: 0xE2E8F0,
            alpha: 0.36,
          });
        }
        break;
      }

      case 'impactSparks': {
        const col = req.color ?? 0xFBBF24;
        // Core impact flare
        this.spawn({
          texture: 'glow',
          additive: true,
          x,
          y,
          vx: 0,
          vy: 0,
          drag: 4,
          lifeMs: 130,
          startScale: 0.55 * s,
          endScale: 0.12 * s,
          color: 0xFFFFFF,
          alpha: 0.95,
          fadeInFrac: 0,
        });
        // Directional ricochet sparks
        const count = Math.round(10 * s);
        for (let i = 0; i < count; i++) {
          const spread = i < count * 0.7 ? randRange(-1.05, 1.05) : randRange(-Math.PI, Math.PI);
          const ang = dir + spread;
          const spd = randRange(95, 280) * s;
          this.spawn({
            texture: 'spark',
            additive: true,
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: -120,
            drag: 4.5,
            lifeMs: randRange(160, 310),
            startScale: randRange(0.35, 0.62) * s,
            endScale: 0.08 * s,
            color: i % 3 === 0 ? 0xFFFBEB : col,
            alpha: 0.95,
            fadeInFrac: 0,
            alignToVelocity: true,
          });
        }
        // Impact smoke puffs
        for (let i = 0; i < 4; i++) {
          const ang = randRange(0, Math.PI * 2);
          const spd = randRange(18, 55) * s;
          this.spawn({
            texture: 'softPuff',
            x: x + randRange(-5, 5),
            y: y + randRange(-5, 5),
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: 42,
            drag: 3.5,
            lifeMs: randRange(300, 480),
            startScale: 0.3 * s,
            endScale: 0.85 * s,
            color: i % 2 === 0 ? 0x64748B : 0xCBD5E1,
            alpha: 0.42,
          });
        }
        break;
      }

      case 'explosion': {
        // Hot blast core
        this.spawn({
          texture: 'glow',
          additive: true,
          x,
          y,
          vx: 0,
          vy: 0,
          drag: 3,
          lifeMs: 220,
          startScale: 0.75 * s,
          endScale: 1.55 * s,
          color: 0xFEF08A,
          alpha: 0.95,
          fadeInFrac: 0,
        });
        this.spawn({
          texture: 'glow',
          additive: true,
          x,
          y,
          vx: 0,
          vy: 0,
          drag: 2,
          lifeMs: 320,
          startScale: 0.9 * s,
          endScale: 2.1 * s,
          color: 0xF97316,
          alpha: 0.78,
          fadeInFrac: 0.05,
        });
        // Radial shrapnel sparks
        const sparkCount = Math.round(16 * s);
        for (let i = 0; i < sparkCount; i++) {
          const ang = (Math.PI * 2 * i) / sparkCount + randRange(-0.22, 0.22);
          const spd = randRange(120, 320) * s;
          this.spawn({
            texture: 'spark',
            additive: true,
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: -140,
            drag: 3.8,
            lifeMs: randRange(220, 440),
            startScale: randRange(0.45, 0.78) * s,
            endScale: 0.1 * s,
            color: pick([0xFFFBEB, 0xFDE047, 0xFB923C, 0xEF4444]),
            alpha: 0.98,
            fadeInFrac: 0,
            alignToVelocity: true,
          });
        }
        // Billowing smoke cloud
        const smokeCount = Math.round(10 * s);
        for (let i = 0; i < smokeCount; i++) {
          const ang = randRange(0, Math.PI * 2);
          const spd = randRange(24, 90) * s;
          this.spawn({
            texture: 'softPuff',
            x: x + randRange(-10, 10) * s,
            y: y + randRange(-10, 10) * s,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: 55,
            drag: 2.8,
            lifeMs: randRange(440, 740),
            startScale: randRange(0.45, 0.75) * s,
            endScale: randRange(1.25, 1.85) * s,
            color: pick([0x334155, 0x475569, 0x1E293B, 0x78716C]),
            alpha: 0.56,
            fadeInFrac: 0.12,
          });
        }
        // Glowing debris shards
        const shardCount = Math.round(8 * s);
        for (let i = 0; i < shardCount; i++) {
          const ang = randRange(0, Math.PI * 2);
          const spd = randRange(75, 185) * s;
          this.spawn({
            texture: 'shard',
            x,
            y,
            vx: Math.cos(ang) * spd + up.x * 40,
            vy: Math.sin(ang) * spd + up.y * 40,
            upAccel: -220,
            drag: 2.2,
            lifeMs: randRange(340, 560),
            startScale: randRange(0.32, 0.55) * s,
            endScale: 0.12 * s,
            color: pick([0xF97316, 0xEF4444, 0x475569]),
            alpha: 0.9,
            rotation: randRange(0, Math.PI * 2),
            vr: randRange(-9, 9),
          });
        }
        break;
      }

      case 'shockwaveRing': {
        this.spawn({
          texture: 'ring',
          additive: true,
          x,
          y,
          vx: 0,
          vy: 0,
          drag: 0,
          lifeMs: 360,
          startScale: 0.18 * s,
          endScale: 1.55 * s,
          color: req.color ?? 0xF97316,
          alpha: 0.85,
          fadeInFrac: 0.04,
        });
        break;
      }

      case 'overwatchRing': {
        for (let i = 0; i < 2; i++) {
          this.spawn({
            texture: 'ring',
            additive: true,
            x,
            y,
            vx: 0,
            vy: 0,
            drag: 0,
            lifeMs: 360 + i * 140,
            startScale: (0.28 + i * 0.14) * s,
            endScale: (1.05 + i * 0.35) * s,
            color: 0xFFB300,
            alpha: 0.78 - i * 0.2,
            fadeInFrac: 0.06,
          });
        }
        break;
      }

      case 'dustPuff': {
        const col = req.color ?? 0xD6C29F;
        for (let i = 0; i < 4; i++) {
          const ang = dir + Math.PI + randRange(-0.9, 0.9);
          const spd = randRange(16, 48) * s;
          this.spawn({
            texture: 'softPuff',
            x: x + randRange(-8, 8),
            y: y + randRange(-8, 8),
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: 24,
            drag: 3.4,
            lifeMs: randRange(280, 440),
            startScale: randRange(0.24, 0.36) * s,
            endScale: randRange(0.62, 0.92) * s,
            color: col,
            alpha: 0.45,
          });
        }
        break;
      }

      case 'leafBurst': {
        for (let i = 0; i < 5; i++) {
          const ang = randRange(0, Math.PI * 2);
          const spd = randRange(25, 72) * s;
          this.spawn({
            texture: 'shard',
            x: x + randRange(-8, 8),
            y: y + randRange(-8, 8),
            vx: Math.cos(ang) * spd + up.x * 24,
            vy: Math.sin(ang) * spd + up.y * 24,
            upAccel: -90,
            drag: 2.5,
            lifeMs: randRange(340, 520),
            startScale: randRange(0.3, 0.46) * s,
            endScale: 0.16 * s,
            color: pick([0x4ADE80, 0x22C55E, 0x84CC16, 0x15803D]),
            alpha: 0.85,
            rotation: randRange(0, Math.PI * 2),
            vr: randRange(-7, 7),
          });
        }
        break;
      }

      case 'waterRipple': {
        for (let i = 0; i < 2; i++) {
          this.spawn({
            texture: 'ring',
            x,
            y,
            vx: 0,
            vy: 0,
            drag: 0,
            lifeMs: 420 + i * 110,
            startScale: (0.16 + i * 0.08) * s,
            endScale: (0.85 + i * 0.25) * s,
            color: 0x7DD3FC,
            alpha: 0.62 - i * 0.18,
            fadeInFrac: 0.08,
          });
        }
        break;
      }

      case 'healPulse': {
        this.spawn({
          texture: 'ring',
          additive: true,
          x,
          y,
          vx: 0,
          vy: 0,
          drag: 0,
          lifeMs: 440,
          startScale: 0.22 * s,
          endScale: 1.05 * s,
          color: 0x34D399,
          alpha: 0.78,
        });
        for (let i = 0; i < 10; i++) {
          const offset = randRange(-18, 18);
          const sideX = -up.y * offset;
          const sideY = up.x * offset;
          this.spawn({
            texture: 'glow',
            additive: true,
            x: x + sideX,
            y: y + sideY + randRange(-8, 8),
            vx: up.x * randRange(40, 95) * s,
            vy: up.y * randRange(40, 95) * s,
            upAccel: 35,
            drag: 1.8,
            lifeMs: randRange(360, 620),
            startScale: randRange(0.18, 0.34) * s,
            endScale: 0.05 * s,
            color: i % 3 === 0 ? 0xECFDF5 : 0x22C55E,
            alpha: 0.9,
          });
        }
        break;
      }

      case 'goldBurst': {
        const count = Math.round(12 * s);
        for (let i = 0; i < count; i++) {
          const spread = randRange(-1.1, 1.1);
          const upAng = Math.atan2(up.y, up.x) + spread;
          const spd = randRange(70, 175) * s;
          this.spawn({
            texture: i % 2 === 0 ? 'shard' : 'glow',
            additive: i % 2 !== 0,
            x: x + randRange(-6, 6),
            y: y + randRange(-6, 6),
            vx: Math.cos(upAng) * spd,
            vy: Math.sin(upAng) * spd,
            upAccel: -240,
            drag: 1.6,
            lifeMs: randRange(380, 650),
            startScale: randRange(0.26, 0.48) * s,
            endScale: 0.08 * s,
            color: pick([0xFEF08A, 0xFACC15, 0xF59E0B]),
            alpha: 0.95,
            rotation: randRange(0, Math.PI * 2),
            vr: randRange(-10, 10),
          });
        }
        break;
      }

      case 'constructionDust': {
        for (let i = 0; i < 8; i++) {
          const ang = (Math.PI * 2 * i) / 8 + randRange(-0.2, 0.2);
          const spd = randRange(25, 78) * s;
          this.spawn({
            texture: 'softPuff',
            x: x + Math.cos(ang) * 10,
            y: y + Math.sin(ang) * 10,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            upAccel: 30,
            drag: 3.4,
            lifeMs: randRange(320, 520),
            startScale: 0.3 * s,
            endScale: 0.85 * s,
            color: pick([0xCBD5E1, 0xD6C29F, 0x94A3B8]),
            alpha: 0.52,
          });
        }
        for (let i = 0; i < 5; i++) {
          const ang = randRange(0, Math.PI * 2);
          const spd = randRange(65, 145) * s;
          this.spawn({
            texture: 'spark',
            additive: true,
            x,
            y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            drag: 5,
            lifeMs: randRange(160, 260),
            startScale: 0.32 * s,
            endScale: 0.06 * s,
            color: 0x38BDF8,
            alpha: 0.9,
            fadeInFrac: 0,
            alignToVelocity: true,
          });
        }
        break;
      }

      case 'lavaSplash': {
        this.spawn({
          texture: 'glow',
          additive: true,
          x,
          y,
          vx: 0,
          vy: 0,
          drag: 2,
          lifeMs: 320,
          startScale: 0.7 * s,
          endScale: 1.4 * s,
          color: 0xEF4444,
          alpha: 0.85,
        });
        for (let i = 0; i < 12; i++) {
          const upAng = Math.atan2(up.y, up.x) + randRange(-1.2, 1.2);
          const spd = randRange(65, 170) * s;
          this.spawn({
            texture: 'shard',
            additive: i % 2 === 0,
            x: x + randRange(-8, 8),
            y: y + randRange(-8, 8),
            vx: Math.cos(upAng) * spd,
            vy: Math.sin(upAng) * spd,
            upAccel: -230,
            drag: 1.8,
            lifeMs: randRange(320, 560),
            startScale: randRange(0.28, 0.5) * s,
            endScale: 0.08 * s,
            color: pick([0xFEF08A, 0xF97316, 0xDC2626]),
            alpha: 0.95,
            vr: randRange(-8, 8),
          });
        }
        for (let i = 0; i < 5; i++) {
          this.spawn({
            texture: 'softPuff',
            x: x + randRange(-10, 10),
            y: y + randRange(-10, 10),
            vx: up.x * randRange(25, 60),
            vy: up.y * randRange(25, 60),
            upAccel: 55,
            drag: 2,
            lifeMs: randRange(420, 650),
            startScale: 0.35 * s,
            endScale: 1.15 * s,
            color: 0x27272A,
            alpha: 0.55,
          });
        }
        break;
      }
    }
  }

  public update(dtMs: number): void {
    if (this.destroyed || dtMs <= 0 || this.activeCount === 0) return;
    const dtSec = dtMs / 1000;
    const up = screenUpVector(this.mapRotation);

    this.stepList(this.normalSlots, dtMs, dtSec, up.x, up.y);
    this.stepList(this.additiveSlots, dtMs, dtSec, up.x, up.y);
  }

  private stepList(list: ParticleSlot[], dtMs: number, dtSec: number, upX: number, upY: number): void {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.active) continue;

      p.ageMs += dtMs;
      if (p.ageMs >= p.lifeMs) {
        p.active = false;
        p.sprite.visible = false;
        this.activeCount = Math.max(0, this.activeCount - 1);
        continue;
      }

      if (p.drag > 0) {
        const damp = Math.max(0, 1 - p.drag * dtSec);
        p.vx *= damp;
        p.vy *= damp;
      }
      if (p.upAccel !== 0) {
        p.vx += upX * p.upAccel * dtSec;
        p.vy += upY * p.upAccel * dtSec;
      }

      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;

      const t = p.ageMs / p.lifeMs;
      const sx = p.startScaleX + (p.endScaleX - p.startScaleX) * t;
      const sy = p.startScaleY + (p.endScaleY - p.startScaleY) * t;

      let alpha: number;
      if (p.fadeInFrac > 0 && t < p.fadeInFrac) {
        alpha = p.peakAlpha * (t / p.fadeInFrac);
      } else {
        const fadeOut = (t - p.fadeInFrac) / Math.max(0.001, 1 - p.fadeInFrac);
        // Smooth ease-out opacity
        alpha = p.peakAlpha * (1 - fadeOut * fadeOut);
      }

      if (p.alignToVelocity) {
        if (Math.abs(p.vx) + Math.abs(p.vy) > 1) {
          p.rotation = Math.atan2(p.vy, p.vx);
        }
      } else if (p.vr !== 0) {
        p.rotation += p.vr * dtSec;
      }

      const sp = p.sprite;
      sp.position.set(p.x, p.y);
      sp.scale.set(sx, sy);
      sp.rotation = p.rotation;
      sp.alpha = Math.max(0, alpha);
    }
  }

  public clear(): void {
    const reset = (list: ParticleSlot[]) => {
      for (let i = 0; i < list.length; i++) {
        list[i].active = false;
        list[i].sprite.visible = false;
      }
    };
    reset(this.normalSlots);
    reset(this.additiveSlots);
    this.activeCount = 0;
  }

  public destroy(): void {
    this.destroyed = true;
    this.clear();
    if (!this.normalContainer.destroyed) {
      this.normalContainer.destroy({ children: true });
    }
    if (!this.additiveContainer.destroyed) {
      this.additiveContainer.destroy({ children: true });
    }
  }
}
