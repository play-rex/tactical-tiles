import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Container, Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { Tile } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { ParticlePool } from '../../../core/graphics/ParticlePool';
import { getPrefersReducedMotion } from '../../../core/graphics/fxTimeline';

type BurntKind = 'forest' | 'rubble' | 'dry' | 'charred';

interface BurntTile extends Tile {
  burntKind: BurntKind;
}

const TEXTURE_SIZE = 128;
const burntTextureCache = new Map<string, PIXI.Texture>();

const hash2 = (x: number, y: number, salt = 0): number => {
  const v = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

const rgba = (r: number, g: number, b: number, a: number) => `rgba(${r},${g},${b},${a})`;

/**
 * Procedural @2x burned-terrain sprites. Keeping these as one cached set of transparent canvases
 * means hundreds of lava tiles batch into a handful of textures instead of hundreds of Graphics
 * paths being rebuilt every frame.
 */
const drawAshBed = (ctx: CanvasRenderingContext2D, seed: number, strength: number) => {
  const cx = TEXTURE_SIZE / 2;
  const cy = TEXTURE_SIZE / 2;
  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 58);
  grad.addColorStop(0, rgba(12, 10, 9, 0.75 * strength));
  grad.addColorStop(0.55, rgba(19, 15, 12, 0.46 * strength));
  grad.addColorStop(1, rgba(10, 8, 7, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 54 + seed * 5, 48 + seed * 4, seed * Math.PI, 0, Math.PI * 2);
  ctx.fill();
};

const drawCracks = (ctx: CanvasRenderingContext2D, seed: number, count: number) => {
  const rnd = (i: number) => hash2(seed * 31, i, 13);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const sx = 20 + rnd(i) * 88;
    const sy = 18 + rnd(i + 9) * 92;
    ctx.strokeStyle = i % 3 === 0 ? rgba(124, 45, 18, 0.7) : rgba(87, 83, 78, 0.56);
    ctx.lineWidth = 1.1 + rnd(i + 3) * 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let px = sx;
    let py = sy;
    for (let j = 1; j <= 4; j++) {
      px += (rnd(i + j * 7) - 0.5) * 17;
      py += (rnd(i + j * 11) - 0.5) * 17;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
};

const drawEmbers = (ctx: CanvasRenderingContext2D, seed: number, count: number) => {
  for (let i = 0; i < count; i++) {
    const x = 18 + hash2(seed, i, 3) * 92;
    const y = 18 + hash2(seed, i, 7) * 92;
    const r = 1.1 + hash2(seed, i, 11) * 2.3;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
    glow.addColorStop(0, rgba(255, 245, 190, 0.60));
    glow.addColorStop(0.3, rgba(251, 146, 60, 0.42));
    glow.addColorStop(1, rgba(251, 146, 60, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
    ctx.fillStyle = rgba(255, 247, 214, 0.68);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, r * 0.55), 0, Math.PI * 2);
    ctx.fill();
  }
};

const createBurntTexture = (kind: BurntKind, variant: number): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const seed = variant * 23.7 + kind.length * 7.3;

  if (kind === 'dry') {
    // A riverbed that has been boiled dry by the advancing lava. The irregular dark bed covers
    // the original blue water tile, with pale mineral crust and deep drought cracks.
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 70);
    grad.addColorStop(0, '#332C26');
    grad.addColorStop(0.65, '#24201D');
    grad.addColorStop(1, 'rgba(18,16,15,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(7, 34);
    ctx.quadraticCurveTo(18, 4, 54, 9);
    ctx.quadraticCurveTo(92, 2, 121, 31);
    ctx.quadraticCurveTo(126, 69, 111, 105);
    ctx.quadraticCurveTo(86, 127, 51, 119);
    ctx.quadraticCurveTo(18, 126, 9, 93);
    ctx.quadraticCurveTo(1, 65, 7, 34);
    ctx.closePath();
    ctx.fill();

    drawCracks(ctx, seed + 2, 9);
    for (let i = 0; i < 11; i++) {
      const x = 17 + hash2(seed, i, 2) * 94;
      const y = 16 + hash2(seed, i, 5) * 96;
      const r = 1.5 + hash2(seed, i, 8) * 4.5;
      ctx.fillStyle = i % 3 === 0 ? 'rgba(168,162,158,0.42)' : 'rgba(87,83,78,0.55)';
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.55, hash2(seed, i, 3) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // A few pale, dry mineral channels.
    ctx.strokeStyle = 'rgba(214, 211, 209, 0.23)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, 98);
    ctx.bezierCurveTo(44, 79, 68, 89, 108, 49);
    ctx.stroke();
    return canvas;
  }

  if (kind === 'forest') {
    drawAshBed(ctx, seed, 0.65);
    // Charred root mass.
    ctx.fillStyle = '#0B0807';
    ctx.beginPath();
    ctx.ellipse(65, 102, 24, 8, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Three dead trunks with broken branches. The transparent gaps let the lava veins glow through.
    const trunks = [
      { x: 48, y: 112, h: 65, bend: -8, r: 5.2 },
      { x: 72, y: 114, h: 78, bend: 7, r: 6.2 },
      { x: 92, y: 113, h: 48, bend: 9, r: 4.1 },
    ];
    for (let i = 0; i < trunks.length; i++) {
      const t = trunks[i];
      const topX = t.x + t.bend;
      const topY = t.y - t.h;
      ctx.strokeStyle = '#0D0907';
      ctx.lineWidth = t.r * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.quadraticCurveTo(t.x - t.bend * 0.35, t.y - t.h * 0.55, topX, topY);
      ctx.stroke();

      ctx.strokeStyle = '#2A1B13';
      ctx.lineWidth = Math.max(1.2, t.r * 0.45);
      ctx.beginPath();
      ctx.moveTo(t.x - t.r * 0.25, t.y);
      ctx.quadraticCurveTo(t.x - t.bend * 0.15, t.y - t.h * 0.6, topX - 1, topY + 2);
      ctx.stroke();

      // Bare, burned branches.
      ctx.strokeStyle = '#120C09';
      ctx.lineWidth = Math.max(1.4, t.r * 0.6);
      for (let b = 0; b < 3; b++) {
        const by = t.y - t.h * (0.38 + b * 0.18);
        const side = b % 2 === 0 ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(t.x + t.bend * (1 - (b + 1) * 0.2), by);
        ctx.lineTo(t.x + side * (15 + b * 4), by - 9 - b * 3);
        ctx.lineTo(t.x + side * (20 + b * 4), by - 20 - b * 4);
        ctx.stroke();
      }
    }

    drawEmbers(ctx, seed + 5, 5);
    return canvas;
  }

  if (kind === 'rubble') {
    drawAshBed(ctx, seed, 0.76);
    // Collapsed concrete slabs, broken wall stubs and twisted rebar.
    const slabs = [
      { x: 22, y: 55, w: 54, h: 28, r: -0.22, c: '#292524' },
      { x: 61, y: 44, w: 38, h: 23, r: 0.35, c: '#44403C' },
      { x: 48, y: 81, w: 58, h: 19, r: 0.04, c: '#1C1917' },
      { x: 31, y: 91, w: 34, h: 16, r: -0.28, c: '#3F3A36' },
    ];
    for (const s of slabs) {
      ctx.save();
      ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
      ctx.rotate(s.r);
      ctx.fillStyle = s.c;
      ctx.strokeStyle = 'rgba(9,9,11,0.9)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-s.w / 2, -s.h / 2);
      ctx.lineTo(s.w / 2 - 4, -s.h / 2 + 3);
      ctx.lineTo(s.w / 2, s.h / 2 - 2);
      ctx.lineTo(-s.w / 2 + 4, s.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Crumbled top highlight.
      ctx.strokeStyle = 'rgba(168,162,158,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-s.w / 2 + 6, -s.h / 2 + 3);
      ctx.lineTo(s.w / 2 - 8, -s.h / 2 + 5);
      ctx.stroke();
      ctx.restore();
    }
    // Rebar curls.
    ctx.strokeStyle = '#7C2D12';
    ctx.lineWidth = 1.8;
    for (let i = 0; i < 4; i++) {
      const x = 31 + i * 18;
      const y = 47 + (i % 2) * 13;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 4, y - 17, x + 15, y - 20, x + 12, y - 34);
      ctx.stroke();
    }
    drawCracks(ctx, seed + 9, 5);
    drawEmbers(ctx, seed + 2, 3);
    return canvas;
  }

  drawAshBed(ctx, seed, 0.55);
  drawCracks(ctx, seed + 1, 6);
  drawEmbers(ctx, seed + 3, 2);
  return canvas;
};

const getBurntTexture = (kind: BurntKind, variant: number): PIXI.Texture => {
  const key = `${kind}:${variant}`;
  const cached = burntTextureCache.get(key);
  if (cached && !cached.baseTexture.destroyed) return cached;
  const texture = PIXI.Texture.from(createBurntTexture(kind, variant));
  texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
  burntTextureCache.set(key, texture);
  return texture;
};

const burntKindFor = (tile: Tile): BurntKind => {
  if (tile.type === 'FOREST') return 'forest';
  if (tile.type === 'BUILDING' || tile.type === 'BASE' || tile.type === 'BANK' || tile.type === 'BARRIER') return 'rubble';
  if (tile.type === 'WATER' || tile.type === 'BRIDGE') return 'dry';
  return 'charred';
};

const alphaFor = (kind: BurntKind): number => {
  switch (kind) {
    case 'dry':
      return 0.80;
    case 'rubble':
      return 0.70;
    case 'forest':
      return 0.68;
    default:
      return 0.34;
  }
};

const smokeColorFor = (kind: BurntKind): number => {
  switch (kind) {
    case 'forest':
      return 0x1C1917;
    case 'rubble':
      return 0x334155;
    case 'dry':
      return 0x94A3B8;
    default:
      return 0x292524;
  }
};

interface DoomsdayScorchLayerProps {
  mapData: Tile[];
  gridSize: number;
  animate: boolean;
  fogOfWar: boolean;
  visibleTiles: Set<string>;
  particlePoolRef: React.MutableRefObject<ParticlePool | null>;
}

/**
 * Terrain destruction caused by the Doomsday advance. Forest tiles become charred trunks, water
 * tiles become cracked dry riverbeds, structures become rubble, and the whole front exhales smoke
 * and embers. Static silhouettes are cached sprites; only a capped set of flames redraws per tick.
 */
const DoomsdayScorchLayerInner: React.FC<DoomsdayScorchLayerProps> = ({
  mapData,
  gridSize,
  animate,
  fogOfWar,
  visibleTiles,
  particlePoolRef,
}) => {
  const staticRef = useRef<PIXI.Container>(null);
  const flameRef = useRef<PIXI.Graphics>(null);
  const phaseRef = useRef(0);
  const flameAccumRef = useRef(0);
  const smokeAccumRef = useRef(0);

  const burntTiles = useMemo<BurntTile[]>(() => {
    const out: BurntTile[] = [];
    for (const tile of mapData) {
      if (tile.hazardState === 'LAVA') out.push({ ...tile, burntKind: burntKindFor(tile) });
    }
    return out;
  }, [mapData]);

  const burningTiles = useMemo(() => {
    const candidates = burntTiles.filter(t => t.burntKind === 'forest' || t.burntKind === 'rubble');
    if (candidates.length <= 20) return candidates;
    // Spread the small flame budget across the entire lava front. Taking the first N tiles in
    // row-major order makes the destruction look like a fire in one map corner as the camera pans.
    return candidates
      .map(tile => ({ tile, rank: hash2(tile.x, tile.y, 17) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 20)
      .map(entry => entry.tile);
  }, [burntTiles]);

  const boardSize = gridSize * TILE_SIZE;

  // Build the one-time destruction silhouettes imperatively so hundreds of tiles do not become
  // hundreds of React elements.
  useEffect(() => {
    const root = staticRef.current;
    if (!root) return;

    const old = root.removeChildren();
    for (const child of old) child.destroy({ children: true, texture: false, baseTexture: false });
    if (burntTiles.length === 0) return;

    for (let i = 0; i < burntTiles.length; i++) {
      const tile = burntTiles[i];
      const variant = Math.floor(hash2(tile.x, tile.y, 2) * 3);
      const sprite = new PIXI.Sprite(getBurntTexture(tile.burntKind, variant));
      sprite.anchor.set(0.5);
      sprite.position.set(tile.x * TILE_SIZE + TILE_SIZE / 2, tile.y * TILE_SIZE + TILE_SIZE / 2);
      sprite.width = TILE_SIZE * 1.04;
      sprite.height = TILE_SIZE * 1.04;
      sprite.rotation = Math.floor(hash2(tile.x, tile.y, 5) * 4) * (Math.PI / 2);
      sprite.alpha = alphaFor(tile.burntKind);
      sprite.eventMode = 'none';
      root.addChild(sprite);
    }

    return () => {
      if (!root.destroyed) {
        const children = root.removeChildren();
        for (const child of children) child.destroy({ children: true, texture: false, baseTexture: false });
      }
    };
  }, [burntTiles, boardSize]);

  const renderFlames = useCallback(
    (g: PIXI.Graphics, phase: number) => {
      g.clear();
      if (burningTiles.length === 0) return;

      for (let i = 0; i < burningTiles.length; i++) {
        const tile = burningTiles[i];
        const px = tile.x * TILE_SIZE;
        const py = tile.y * TILE_SIZE;
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;
        const seed = tile.x * 17.3 + tile.y * 9.7;
        const pulse = 0.5 + 0.5 * Math.sin(phase * 3.8 + seed);

        // A low, soft heat bloom instead of a flare that competes with the map.
        g.beginFill(0xEA580C, 0.035 + pulse * 0.025);
        g.drawEllipse(cx + Math.sin(phase + seed) * 2, cy + 8, 22, 13);
        g.endFill();

        const flameCount = tile.burntKind === 'forest' ? 2 : 1;
        for (let f = 0; f < flameCount; f++) {
          const offsetX = (hash2(tile.x, tile.y, f + 4) - 0.5) * 22;
          const sway = Math.sin(phase * 2.4 + seed + f * 2.1) * 2.6;
          const fx = cx + offsetX + sway * 0.35;
          const fy = cy + 13 + (f % 2) * 3;
          const h = 12 + hash2(tile.x, tile.y, f + 8) * 8 + pulse * 4;
          const w = 4.8 - (f % 2) * 0.8;

          g.beginFill(0xB91C1C, 0.42);
          g.drawPolygon([fx - w, fy, fx + sway, fy - h, fx + w, fy, fx, fy + 5]);
          g.endFill();

          g.beginFill(0xEA580C, 0.52);
          g.drawPolygon([fx - w * 0.62, fy - 1, fx + sway * 0.7, fy - h * 0.76, fx + w * 0.62, fy - 1, fx, fy + 3]);
          g.endFill();

          g.beginFill(0xF59E0B, 0.46);
          g.drawCircle(fx, fy - h * 0.28, 1.1 + pulse * 0.7);
          g.endFill();
        }
      }
    },
    [burningTiles],
  );

  useEffect(() => {
    const g = flameRef.current;
    if (g && !g.destroyed) renderFlames(g, phaseRef.current);
  }, [renderFlames]);

  useTick((delta) => {
    if (!animate) return;
    const reduced = getPrefersReducedMotion();
    const step = Math.min(3, Math.max(0.2, typeof delta === 'number' ? delta : 1));
    const dtMs = step * (1000 / 60);

    if (!reduced) {
      phaseRef.current += step * 0.032;
      flameAccumRef.current += dtMs;
      if (flameAccumRef.current >= 52) {
        flameAccumRef.current = 0;
        const g = flameRef.current;
        if (g && !g.destroyed) renderFlames(g, phaseRef.current);
      }
    }

    const pool = particlePoolRef.current;
    if (!pool || burntTiles.length === 0 || reduced) return;
    smokeAccumRef.current += dtMs;
    if (smokeAccumRef.current < 145) return;
    smokeAccumRef.current = 0;

    const tile = burntTiles[Math.floor(Math.random() * burntTiles.length)];
    if (fogOfWar && !visibleTiles.has(tile.id)) return;

    const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
    const isSteam = tile.burntKind === 'dry';
    pool.spawn({
      texture: 'softPuff',
      ambient: true,
      x: cx + (Math.random() - 0.5) * 34,
      y: cy + (Math.random() - 0.5) * 24,
      vx: (Math.random() - 0.5) * 15,
      vy: (Math.random() - 0.5) * 12,
      upAccel: isSteam ? 54 : 27,
      drag: 1.15,
      lifeMs: 1500 + Math.random() * 900,
      startScale: isSteam ? 0.40 : 0.28,
      endScale: isSteam ? 1.45 : 1.30,
      color: smokeColorFor(tile.burntKind),
      alpha: isSteam ? 0.24 : 0.21,
      fadeInFrac: 0.18,
      rotation: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.25,
    });

    // Every second/third plume throws a hot ember toward the camera.
    if (!isSteam && Math.random() < 0.35) {
      pool.spawn({
        texture: 'glow',
        additive: true,
        ambient: true,
        x: cx + (Math.random() - 0.5) * 26,
        y: cy + (Math.random() - 0.5) * 18,
        vx: (Math.random() - 0.5) * 24,
        vy: (Math.random() - 0.5) * 20,
        upAccel: 62,
        drag: 1.1,
        lifeMs: 420 + Math.random() * 320,
        startScale: 0.14,
        endScale: 0.03,
        color: Math.random() < 0.5 ? 0xFB923C : 0xFEF08A,
        alpha: 0.52,
      });
    }
  });

  return (
    <Container name="doomsday_burnt_terrain" eventMode="none" visible={burntTiles.length > 0}>
      <Container ref={staticRef} eventMode="none" />
      <Graphics ref={flameRef} eventMode="none" />
    </Container>
  );
};

export const DoomsdayScorchLayer: React.FC<DoomsdayScorchLayerProps> = React.memo((props) => (
  <DoomsdayScorchLayerInner {...props} />
));
