import * as PIXI from 'pixi.js';
import { TerrainType, Tile, UnitType } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { type BoardRotation, rotateTileCoord } from '../boardRotation';

const DESERT_TYPES = new Set<TerrainType>(['SAND', 'DUNES', 'QUICKSAND', 'CANYON']);

const PALETTE = {
  grassA: [92, 134, 62] as const,
  grassB: [115, 156, 76] as const,
  sandA: [219, 186, 126] as const,
  sandB: [192, 155, 96] as const,
  waterShallow: '#2B839C',
  waterDeep: '#134766',
  bankSand: '#AE996D',
  forestDark: '#1E4625',
  forestMid: '#2E6633',
  forestLit: '#4E8F43',
  rockDark: '#3A4250',
  rockMid: '#647082',
  rockLit: '#A3AEBD',
  snowCap: '#E5ECF4',
  roadAsphalt: '#424956',
  roadLine: '#E2C044',
  canyonFloor: '#241714',
  canyonRim: '#845640',
};

function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) ^ 0x5bf03635;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  return smoothNoise(x, y) * 0.55 + smoothNoise(x * 2.1, y * 2.1) * 0.3 + smoothNoise(x * 4.3, y * 4.3) * 0.15;
}

function isWaterLike(t: Tile | undefined): boolean {
  return Boolean(t && (t.type === 'WATER' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V'));
}

function isRoadLike(t: Tile | undefined): boolean {
  return Boolean(t && (t.type === 'ROAD' || t.type === 'ROAD_H' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V' || t.type === 'BASE'));
}

function isCanyonLike(t: Tile | undefined): boolean {
  return Boolean(t && (t.type === 'CANYON' || t.type === 'BRIDGE' || t.type === 'BRIDGE_V'));
}

/** Stable signature capturing visual terrain topology without flickering on unit/UI selection changes. */
export function computeTerrainSignature(mapData: Tile[], gridSize: number, rotation: BoardRotation = 0): string {
  const parts = new Array<string>(mapData.length + 1);
  parts[0] = `${gridSize}@${rotation}`;
  for (let i = 0; i < mapData.length; i++) {
    const t = mapData[i];
    const looted = t.type === 'BANK' && (t.hackProgress || 0) >= 100 ? 1 : 0;
    parts[i + 1] = `${t.type}:${t.subType || ''}:${t.owner ?? ''}:${looted}`;
  }
  return parts.join('|');
}

// Module-level cached macro earth/sand FBM field keyed by size + biome signature for rapid MapEditor painting.
let cachedEarthKey = '';
let cachedEarthCanvas: HTMLCanvasElement | null = null;

function getOrBakeEarthField(grid: (Tile | undefined)[][], gridSize: number): HTMLCanvasElement {
  const desertMaskParts: string[] = [String(gridSize)];
  for (let y = 0; y < gridSize; y++) {
    let rowBits = '';
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y]?.[x];
      rowBits += t && DESERT_TYPES.has(t.type) ? '1' : '0';
    }
    desertMaskParts.push(rowBits);
  }
  const maskKey = desertMaskParts.join('/');
  if (gridSize > 1 && cachedEarthCanvas && cachedEarthKey === maskKey) {
    return cachedEarthCanvas;
  }

  // Bake macro earth noise at 16px/tile (400x400 for 25x25) — 16x fewer pixels with smooth bilinear upscale
  const scaleDiv = 4;
  const subTS = TILE_SIZE / scaleDiv;
  const W = Math.max(16, gridSize * subTS);
  const H = Math.max(16, gridSize * subTS);
  const canvas = gridSize > 1 && cachedEarthCanvas && cachedEarthCanvas.width === W
    ? cachedEarthCanvas
    : document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const img = ctx.createImageData(W, H);
  const data = img.data;

  for (let py = 0; py < H; py++) {
    const ty = Math.min(gridSize - 1, Math.floor(py / subTS));
    const fy = (py % subTS) / subTS;
    const wy = py * scaleDiv;
    for (let px = 0; px < W; px++) {
      const tx = Math.min(gridSize - 1, Math.floor(px / subTS));
      const fx = (px % subTS) / subTS;
      const wx = px * scaleDiv;
      const tile = grid[ty]?.[tx];

      let desertWeight = tile && DESERT_TYPES.has(tile.type) ? 1 : 0;
      const nLeft = tx > 0 && DESERT_TYPES.has(grid[ty]?.[tx - 1]?.type || 'PLAINS') ? 1 : 0;
      const nRight = tx < gridSize - 1 && DESERT_TYPES.has(grid[ty]?.[tx + 1]?.type || 'PLAINS') ? 1 : 0;
      const nTop = ty > 0 && DESERT_TYPES.has(grid[ty - 1]?.[tx]?.type || 'PLAINS') ? 1 : 0;
      const nBot = ty < gridSize - 1 && DESERT_TYPES.has(grid[ty + 1]?.[tx]?.type || 'PLAINS') ? 1 : 0;

      if (fx < 0.25 && nLeft !== desertWeight) desertWeight = desertWeight * (fx / 0.25) + nLeft * (1 - fx / 0.25);
      if (fx > 0.75 && nRight !== desertWeight) desertWeight = desertWeight * ((1 - fx) / 0.25) + nRight * (1 - (1 - fx) / 0.25);
      if (fy < 0.25 && nTop !== desertWeight) desertWeight = desertWeight * (fy / 0.25) + nTop * (1 - fy / 0.25);
      if (fy > 0.75 && nBot !== desertWeight) desertWeight = desertWeight * ((1 - fy) / 0.25) + nBot * (1 - (1 - fy) / 0.25);

      const n = fbm(wx * 0.015, wy * 0.015);
      const grain = fbm(wx * 0.09, wy * 0.09);
      const ripple = Math.sin(wx * 0.12 + wy * 0.07 + fbm(wx * 0.03, wy * 0.03) * 4) * 0.5 + 0.5;

      const gR = PALETTE.grassA[0] * (1 - n) + PALETTE.grassB[0] * n + (grain - 0.5) * 18;
      const gG = PALETTE.grassA[1] * (1 - n) + PALETTE.grassB[1] * n + (grain - 0.5) * 20;
      const gB = PALETTE.grassA[2] * (1 - n) + PALETTE.grassB[2] * n + (grain - 0.5) * 12;

      const sR = PALETTE.sandA[0] * (1 - ripple * 0.45) + PALETTE.sandB[0] * (ripple * 0.45) + (grain - 0.5) * 14;
      const sG = PALETTE.sandA[1] * (1 - ripple * 0.45) + PALETTE.sandB[1] * (ripple * 0.45) + (grain - 0.5) * 12;
      const sB = PALETTE.sandA[2] * (1 - ripple * 0.45) + PALETTE.sandB[2] * (ripple * 0.45) + (grain - 0.5) * 10;

      const idx = (py * W + px) * 4;
      data[idx] = Math.max(0, Math.min(255, gR * (1 - desertWeight) + sR * desertWeight));
      data[idx + 1] = Math.max(0, Math.min(255, gG * (1 - desertWeight) + sG * desertWeight));
      data[idx + 2] = Math.max(0, Math.min(255, gB * (1 - desertWeight) + sB * desertWeight));
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  if (gridSize > 1) {
    cachedEarthCanvas = canvas;
    cachedEarthKey = maskKey;
  }
  return canvas;
}

export interface BakedReconBoard {
  terrainTexture: PIXI.Texture;
  waterMaskTexture: PIXI.Texture;
}

export interface RenderedReconCanvases {
  terrainCanvas: HTMLCanvasElement;
  waterMaskCanvas: HTMLCanvasElement;
}

/**
 * Renders an entire battlefield grid onto offscreen 2D canvases using Tactical Recon HD
 * procedural layers: continuous FBM ground, auto-tiled water shorelines & roads, sculpted
 * mountains & dunes, multi-canopy tree groves, directional sun cast shadows, and structures.
 */
export function renderTacticalReconCanvases(
  mapData: Tile[],
  gridSize: number,
  rotation: BoardRotation = 0,
): RenderedReconCanvases {
  const totalPx = gridSize * TILE_SIZE;
  const grid: (Tile | undefined)[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(undefined));
  for (const t of mapData) {
    if (t.x >= 0 && t.x < gridSize && t.y >= 0 && t.y < gridSize) {
      const rot = rotateTileCoord(t.x, t.y, rotation, gridSize);
      grid[rot.y][rot.x] = t;
    }
  }

  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = totalPx;
  terrainCanvas.height = totalPx;
  const ctx = terrainCanvas.getContext('2d')!;

  const waterMaskCanvas = document.createElement('canvas');
  waterMaskCanvas.width = totalPx;
  waterMaskCanvas.height = totalPx;
  const wCtx = waterMaskCanvas.getContext('2d')!;

  // Pass A: Continuous World-Space Earth / Sand Noise
  const earthField = getOrBakeEarthField(grid, gridSize);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(earthField, 0, 0, totalPx, totalPx);

  // Faint Tactical Grid Under-Layer (keeps strategic readability under mountains/trees)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.085)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= gridSize; i++) {
    ctx.moveTo(i * TILE_SIZE + 0.5, 0);
    ctx.lineTo(i * TILE_SIZE + 0.5, totalPx);
    ctx.moveTo(0, i * TILE_SIZE + 0.5);
    ctx.lineTo(totalPx, i * TILE_SIZE + 0.5);
  }
  ctx.stroke();

  // Pass B1: Auto-Tiled WATER & WATER-BRIDGE Basins
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t || (t.type !== 'WATER' && t.type !== 'BRIDGE' && t.type !== 'BRIDGE_V')) continue;
      const nTile = grid[y - 1]?.[x];
      const sTile = grid[y + 1]?.[x];
      const wTile = grid[y]?.[x - 1];
      const eTile = grid[y]?.[x + 1];
      const adjCanyonOnly =
        (nTile?.type === 'CANYON' || sTile?.type === 'CANYON' || wTile?.type === 'CANYON' || eTile?.type === 'CANYON') &&
        nTile?.type !== 'WATER' && sTile?.type !== 'WATER' && wTile?.type !== 'WATER' && eTile?.type !== 'WATER';
      if ((t.type === 'BRIDGE' || t.type === 'BRIDGE_V') && adjCanyonOnly) continue;

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const wN = isWaterLike(grid[y - 1]?.[x]);
      const wS = isWaterLike(grid[y + 1]?.[x]);
      const wW = isWaterLike(grid[y]?.[x - 1]);
      const wE = isWaterLike(grid[y]?.[x + 1]);

      const padN = wN ? 0 : 8;
      const padS = wS ? 0 : 8;
      const padW = wW ? 0 : 8;
      const padE = wE ? 0 : 8;
      const rx = px + padW;
      const ry = py + padN;
      const rw = TILE_SIZE - padW - padE;
      const rh = TILE_SIZE - padN - padS;
      const r = 14;

      // Sandy / Mud Bank Rim
      ctx.fillStyle = PALETTE.bankSand;
      ctx.beginPath();
      ctx.roundRect(
        px + (wW ? 0 : 3),
        py + (wN ? 0 : 3),
        TILE_SIZE - (wW ? 0 : 3) - (wE ? 0 : 3),
        TILE_SIZE - (wN ? 0 : 3) - (wS ? 0 : 3),
        16
      );
      ctx.fill();

      // Shallow Turquoise Shelf
      ctx.fillStyle = PALETTE.waterShallow;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, [
        !wN && !wW ? r : 0,
        !wN && !wE ? r : 0,
        !wS && !wE ? r : 0,
        !wS && !wW ? r : 0,
      ]);
      ctx.fill();

      // Deep Trench Core
      const dp = 7;
      ctx.fillStyle = PALETTE.waterDeep;
      ctx.beginPath();
      ctx.roundRect(
        rx + (wW ? 0 : dp),
        ry + (wN ? 0 : dp),
        rw - (wW ? 0 : dp) - (wE ? 0 : dp),
        rh - (wN ? 0 : dp) - (wS ? 0 : dp),
        r * 0.6
      );
      ctx.fill();

      // Write Water Mask
      wCtx.fillStyle = '#ffffff';
      wCtx.beginPath();
      wCtx.roundRect(rx, ry, rw, rh, [
        !wN && !wW ? r : 0,
        !wN && !wE ? r : 0,
        !wS && !wE ? r : 0,
        !wS && !wW ? r : 0,
      ]);
      wCtx.fill();
    }
  }

  // Pass B2: Auto-Connected CANYON Strata Gorges (including Canyon Bridges)
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t) continue;
      const adjCanyon =
        grid[y - 1]?.[x]?.type === 'CANYON' ||
        grid[y + 1]?.[x]?.type === 'CANYON' ||
        grid[y]?.[x - 1]?.type === 'CANYON' ||
        grid[y]?.[x + 1]?.type === 'CANYON';
      const isCanyonBridge = (t.type === 'BRIDGE' || t.type === 'BRIDGE_V') && adjCanyon &&
        !(
          grid[y - 1]?.[x]?.type === 'WATER' ||
          grid[y + 1]?.[x]?.type === 'WATER' ||
          grid[y]?.[x - 1]?.type === 'WATER' ||
          grid[y]?.[x + 1]?.type === 'WATER'
        );
      if (t.type !== 'CANYON' && !isCanyonBridge) continue;

      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const cN = isCanyonLike(grid[y - 1]?.[x]);
      const cS = isCanyonLike(grid[y + 1]?.[x]);
      const cW = isCanyonLike(grid[y]?.[x - 1]);
      const cE = isCanyonLike(grid[y]?.[x + 1]);

      ctx.fillStyle = PALETTE.canyonRim;
      ctx.beginPath();
      ctx.roundRect(
        px + (cW ? 0 : 4),
        py + (cN ? 0 : 4),
        TILE_SIZE - (cW ? 0 : 4) - (cE ? 0 : 4),
        TILE_SIZE - (cN ? 0 : 4) - (cS ? 0 : 4),
        10
      );
      ctx.fill();

      ctx.fillStyle = PALETTE.canyonFloor;
      ctx.beginPath();
      ctx.roundRect(
        px + (cW ? 0 : 12),
        py + (cN ? 0 : 14),
        TILE_SIZE - (cW ? 0 : 12) - (cE ? 0 : 12),
        TILE_SIZE - (cN ? 0 : 14) - (cS ? 0 : 10),
        8
      );
      ctx.fill();
    }
  }

  // Pass B3: QUICKSAND Sinkholes
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (grid[y][x]?.type !== 'QUICKSAND') continue;
      const cx = x * TILE_SIZE + 32;
      const cy = y * TILE_SIZE + 32;
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 27);
      grad.addColorStop(0, '#5E4638');
      grad.addColorStop(0.65, '#8A6F58');
      grad.addColorStop(1, 'rgba(138, 111, 88, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 28, 22, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(50,35,25,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 18, 12, 0.15, 0.3, Math.PI * 1.7);
      ctx.stroke();
    }
  }

  // Pass C1: Auto-Connecting Asphalt ROADS
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t || (t.type !== 'ROAD' && t.type !== 'ROAD_H')) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      let rN = isRoadLike(grid[y - 1]?.[x]);
      let rS = isRoadLike(grid[y + 1]?.[x]);
      let rW = isRoadLike(grid[y]?.[x - 1]);
      let rE = isRoadLike(grid[y]?.[x + 1]);
      if (!rN && !rS && !rW && !rE) {
        if (t.type === 'ROAD_H') { rW = true; rE = true; }
        else { rN = true; rS = true; }
      }

      // Gravel shoulder
      ctx.fillStyle = 'rgba(130, 122, 106, 0.65)';
      if (rN) ctx.fillRect(px + 13, py, 38, 32);
      if (rS) ctx.fillRect(px + 13, py + 32, 38, 32);
      if (rW) ctx.fillRect(px, py + 13, 32, 38);
      if (rE) ctx.fillRect(px + 32, py + 13, 32, 38);
      ctx.beginPath();
      ctx.arc(px + 32, py + 32, 19, 0, Math.PI * 2);
      ctx.fill();

      // Asphalt surface
      ctx.fillStyle = PALETTE.roadAsphalt;
      if (rN) ctx.fillRect(px + 17, py, 30, 32);
      if (rS) ctx.fillRect(px + 17, py + 32, 30, 32);
      if (rW) ctx.fillRect(px, py + 17, 32, 30);
      if (rE) ctx.fillRect(px + 32, py + 17, 32, 30);
      ctx.beginPath();
      ctx.arc(px + 32, py + 32, 15, 0, Math.PI * 2);
      ctx.fill();

      // Dashed highway stripes
      ctx.strokeStyle = PALETTE.roadLine;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      if (rN) { ctx.moveTo(px + 32, py); ctx.lineTo(px + 32, py + 32); }
      if (rS) { ctx.moveTo(px + 32, py + 32); ctx.lineTo(px + 32, py + TILE_SIZE); }
      if (rW) { ctx.moveTo(px, py + 32); ctx.lineTo(px + 32, py + 32); }
      if (rE) { ctx.moveTo(px + 32, py + 32); ctx.lineTo(px + TILE_SIZE, py + 32); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Pass C2: Riveted Steel Truss BRIDGES (Horizontal & Vertical, swapped when rotated 90°/270°)
  const swapBridgeAxes = rotation === 90 || rotation === 270;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t || (t.type !== 'BRIDGE' && t.type !== 'BRIDGE_V')) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const isVertical = swapBridgeAxes ? t.type !== 'BRIDGE_V' : t.type === 'BRIDGE_V';

      ctx.save();
      if (isVertical) {
        ctx.translate(px + 32, py + 32);
        ctx.rotate(Math.PI / 2);
        ctx.translate(-32, -32);
      } else {
        ctx.translate(px, py);
      }

      // Shadow onto water/canyon below
      ctx.fillStyle = 'rgba(0, 10, 22, 0.42)';
      ctx.fillRect(0, 16, TILE_SIZE, 42);
      // Concrete abutments
      ctx.fillStyle = '#858F9E';
      ctx.fillRect(0, 8, 8, 48);
      ctx.fillRect(TILE_SIZE - 8, 8, 8, 48);
      // Steel roadway deck
      ctx.fillStyle = '#535B69';
      ctx.fillRect(4, 13, TILE_SIZE - 8, 38);
      // Deck ribs
      ctx.strokeStyle = '#363C47';
      ctx.lineWidth = 1.5;
      for (let i = 10; i < TILE_SIZE - 6; i += 8) {
        ctx.beginPath();
        ctx.moveTo(i, 14);
        ctx.lineTo(i, 50);
        ctx.stroke();
      }
      // Riveted trusses
      ctx.fillStyle = '#9BA5B5';
      ctx.fillRect(2, 10, TILE_SIZE - 4, 5);
      ctx.fillRect(2, 49, TILE_SIZE - 4, 5);
      ctx.restore();
    }
  }

  // Pass D1: Sculpted DUNES
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (grid[y][x]?.type !== 'DUNES') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      ctx.fillStyle = 'rgba(72, 48, 22, 0.28)';
      ctx.beginPath();
      ctx.ellipse(px + 38, py + 40, 28, 18, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EBD2A0';
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 46);
      ctx.quadraticCurveTo(px + 28, py + 10, px + 58, py + 24);
      ctx.quadraticCurveTo(px + 32, py + 32, px + 4, py + 46);
      ctx.fill();
      ctx.fillStyle = '#BC8E4E';
      ctx.beginPath();
      ctx.moveTo(px + 4, py + 46);
      ctx.quadraticCurveTo(px + 32, py + 32, px + 58, py + 24);
      ctx.quadraticCurveTo(px + 44, py + 54, px + 14, py + 56);
      ctx.fill();
    }
  }

  // Pass D2: Sculpted Granite MOUNTAINS (SE Sun Cast Shadows -> Faceted Peaks + Snow Cap)
  ctx.fillStyle = 'rgba(12, 18, 28, 0.36)';
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (grid[y][x]?.type !== 'MOUNTAIN') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      ctx.beginPath();
      ctx.moveTo(px + 32, py + 12);
      ctx.lineTo(px + 72, py + 48);
      ctx.lineTo(px + 48, py + 72);
      ctx.lineTo(px + 12, py + 56);
      ctx.closePath();
      ctx.fill();
    }
  }

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const mTile = grid[y][x];
      if (mTile?.type !== 'MOUNTAIN') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const ox = (hash2(mTile.x, mTile.y) - 0.5) * 8;
      const oy = (hash2(mTile.y, mTile.x) - 0.5) * 6;
      const peakX = px + 32 + ox;
      const peakY = py + 10 + oy;

      ctx.fillStyle = PALETTE.rockLit;
      ctx.beginPath();
      ctx.moveTo(peakX, peakY);
      ctx.lineTo(px + 6, py + 54);
      ctx.lineTo(px + 30, py + 58);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = PALETTE.rockMid;
      ctx.beginPath();
      ctx.moveTo(peakX, peakY);
      ctx.lineTo(px + 30, py + 58);
      ctx.lineTo(px + 44, py + 56);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = PALETTE.rockDark;
      ctx.beginPath();
      ctx.moveTo(peakX, peakY);
      ctx.lineTo(px + 44, py + 56);
      ctx.lineTo(px + 58, py + 48);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = PALETTE.snowCap;
      ctx.beginPath();
      ctx.moveTo(peakX, peakY);
      ctx.lineTo(peakX - 10, peakY + 16);
      ctx.lineTo(peakX + 2, peakY + 13);
      ctx.lineTo(peakX + 8, peakY + 15);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Pass D3: Multi-Canopy FOREST Groves (Moss Bed + Clustered Shadows + Tree Crowns)
  const trees: Array<{ cx: number; cy: number; r: number }> = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const fTile = grid[y][x];
      if (fTile?.type !== 'FOREST') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      ctx.fillStyle = 'rgba(20, 42, 18, 0.35)';
      ctx.beginPath();
      ctx.arc(px + 32, py + 32, 30, 0, Math.PI * 2);
      ctx.fill();

      for (let i = 0; i < 5; i++) {
        const rx = hash2(fTile.x * 7 + i, fTile.y * 13);
        const ry = hash2(fTile.x * 19, fTile.y * 5 + i);
        trees.push({
          cx: px + 10 + rx * 44,
          cy: py + 10 + ry * 44,
          r: 11 + hash2(i + fTile.x, fTile.y + i) * 7,
        });
      }
    }
  }
  ctx.fillStyle = 'rgba(12, 22, 16, 0.38)';
  for (const tr of trees) {
    ctx.beginPath();
    ctx.arc(tr.cx + 7, tr.cy + 8, tr.r * 0.96, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const tr of trees) {
    ctx.fillStyle = PALETTE.forestDark;
    ctx.beginPath();
    ctx.arc(tr.cx, tr.cy, tr.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.forestMid;
    ctx.beginPath();
    ctx.arc(tr.cx - 1.5, tr.cy - 1.5, tr.r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.forestLit;
    ctx.beginPath();
    ctx.arc(tr.cx - 3.5, tr.cy - 3.5, tr.r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pass E: Military Structures (BARRIER, WATCHTOWER/BUNKER, BANK VAULT, FORTIFIED BASE HQ)
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      if (t.type === 'BARRIER') {
        ctx.fillStyle = 'rgba(10,14,20,0.4)';
        ctx.fillRect(px + 10, py + 18, 48, 36);
        ctx.fillStyle = '#4E5663';
        ctx.fillRect(px + 8, py + 14, 48, 12);
        ctx.fillRect(px + 8, py + 38, 48, 12);
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(px + 12, py + 16, 10, 8);
        ctx.fillRect(px + 34, py + 16, 10, 8);
        ctx.fillRect(px + 12, py + 40, 10, 8);
        ctx.fillRect(px + 34, py + 40, 10, 8);
      } else if (t.type === 'BUILDING') {
        if (t.subType === 'BUNKER') {
          // Reinforced Concrete Pillbox Bunker
          ctx.fillStyle = 'rgba(10,16,24,0.45)';
          ctx.beginPath();
          ctx.roundRect(px + 11, py + 14, 48, 46, 8);
          ctx.fill();
          ctx.fillStyle = '#475569';
          ctx.beginPath();
          ctx.roundRect(px + 8, py + 8, 48, 48, 8);
          ctx.fill();
          ctx.fillStyle = '#64748B';
          ctx.beginPath();
          ctx.roundRect(px + 13, py + 13, 38, 38, 5);
          ctx.fill();
          // Firing Slits
          ctx.fillStyle = '#0F172A';
          ctx.fillRect(px + 20, py + 18, 24, 5);
          ctx.fillRect(px + 20, py + 41, 24, 5);
          ctx.fillRect(px + 18, py + 24, 5, 16);
          ctx.fillRect(px + 41, py + 24, 5, 16);
        } else {
          // Elevated Steel Watchtower
          ctx.fillStyle = 'rgba(10,16,24,0.45)';
          ctx.beginPath();
          ctx.moveTo(px + 18, py + 18);
          ctx.lineTo(px + 64, py + 32);
          ctx.lineTo(px + 54, py + 64);
          ctx.lineTo(px + 14, py + 52);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = '#64748B';
          ctx.beginPath();
          ctx.roundRect(px + 10, py + 10, 44, 44, 6);
          ctx.fill();
          ctx.strokeStyle = '#94A3B8';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 13, py + 13, 38, 38);
          ctx.fillStyle = '#1E293B';
          ctx.beginPath();
          ctx.arc(px + 32, py + 32, 12, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#CBD5E1';
          ctx.beginPath();
          ctx.arc(px + 30, py + 30, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (t.type === 'BANK') {
        const isLooted = (t.hackProgress || 0) >= 100;
        ctx.fillStyle = 'rgba(10,16,24,0.42)';
        ctx.beginPath();
        ctx.roundRect(px + 12, py + 14, 48, 48, 8);
        ctx.fill();
        ctx.fillStyle = isLooted ? '#475569' : '#94A3B8';
        ctx.beginPath();
        ctx.roundRect(px + 6, py + 6, 52, 52, 6);
        ctx.fill();
        ctx.fillStyle = isLooted ? '#1E293B' : '#334155';
        ctx.beginPath();
        ctx.roundRect(px + 12, py + 12, 40, 40, 4);
        ctx.fill();
        if (isLooted) {
          ctx.strokeStyle = '#64748B';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px + 32, py + 32, 12, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeStyle = '#FBBF24';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px + 32, py + 32, 13, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#F59E0B';
          ctx.beginPath();
          ctx.arc(px + 32, py + 32, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (t.type === 'BASE') {
        const factionColors = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#00ACC1'];
        const fCol = t.owner !== undefined ? (factionColors[t.owner % 6] || '#94A3B8') : '#94A3B8';
        ctx.fillStyle = 'rgba(10,16,24,0.48)';
        ctx.beginPath();
        ctx.roundRect(px + 8, py + 12, 54, 54, 10);
        ctx.fill();
        ctx.fillStyle = '#6B7280';
        ctx.beginPath();
        ctx.roundRect(px + 4, py + 4, 56, 56, 8);
        ctx.fill();
        ctx.fillStyle = '#374151';
        ctx.beginPath();
        ctx.roundRect(px + 10, py + 10, 44, 44, 5);
        ctx.fill();
        ctx.strokeStyle = fCol;
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 8, py + 8, 48, 48);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px + 32, py + 32, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#1F2937';
        ctx.beginPath();
        ctx.arc(px + 32, py + 32, 8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return { terrainCanvas, waterMaskCanvas };
}

/**
 * Bakes an entire battlefield grid into PixiJS GPU textures using Tactical Recon HD procedural layers.
 */
export function bakeTacticalReconBoard(mapData: Tile[], gridSize: number, rotation: BoardRotation = 0): BakedReconBoard {
  const { terrainCanvas, waterMaskCanvas } = renderTacticalReconCanvases(mapData, gridSize, rotation);
  return {
    terrainTexture: PIXI.Texture.from(terrainCanvas),
    waterMaskTexture: PIXI.Texture.from(waterMaskCanvas),
  };
}

/**
 * Generates a soft blurred radial Fog of War PIXI Texture (bilinear-scaled over the map
 * to eliminate harsh square shadow edges while faithfully obscuring unseen tiles).
 */
export function bakeSoftFogTexture(mapData: Tile[], visibleTiles: Set<string>, gridSize: number): PIXI.Texture {
  const cellPx = 12;
  const W = gridSize * cellPx;
  const H = gridSize * cellPx;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = W;
  maskCanvas.height = H;
  const mCtx = maskCanvas.getContext('2d')!;

  // Deep navy rather than black, so hidden ground reads as night, not as a hole in the map.
  mCtx.fillStyle = '#060B18';
  for (const tile of mapData) {
    if (!visibleTiles.has(tile.id)) {
      mCtx.fillRect(tile.x * cellPx, tile.y * cellPx, cellPx, cellPx);
    }
  }

  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = W;
  blurCanvas.height = H;
  const bCtx = blurCanvas.getContext('2d')!;
  bCtx.filter = 'blur(5px)';
  bCtx.globalAlpha = 0.8;
  bCtx.drawImage(maskCanvas, 0, 0);

  return PIXI.Texture.from(blurCanvas, { scaleMode: PIXI.SCALE_MODES.LINEAR });
}

/** Generates a crisp @2x (128x128) emoji-free Tactical Recon HD sprite for a single tile type (used in Map Editor & fallbacks). */
export function createReconTileTexture(key: string): PIXI.Texture {
  const singleTile: Tile = {
    id: '0,0',
    x: 0,
    y: 0,
    type: (key === 'BANK_EMPTY' ? 'BANK' : key) as TerrainType,
    height: key === 'MOUNTAIN' || key === 'DUNES' ? 2 : key === 'WATER' || key === 'CANYON' ? 0 : 1,
    loot: null,
    hackProgress: key === 'BANK_EMPTY' ? 100 : 0,
    subType: key === 'BUILDING' ? 'WATCHTOWER' : undefined,
  };
  const { terrainTexture } = bakeTacticalReconBoard([singleTile], 1);
  return terrainTexture;
}

/** Generates crisp @2x (128x128) top-down Tactical Recon HD unit sprites with distinct class silhouettes. */
export function createReconUnitTexture(factionHex: string, type: UnitType): PIXI.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;

  // Tailored Ground Contact Shadow per Class Silhouette
  ctx.fillStyle = 'rgba(8, 12, 20, 0.45)';
  ctx.beginPath();
  if (type === 'SOLDIER') {
    ctx.ellipse(cx + 4, cy + 6, 26, 19, 0, 0, Math.PI * 2);
  } else if (type === 'ASSAULTER') {
    ctx.roundRect(cx - 38, cy - 34, 86, 78, 12);
  } else {
    ctx.ellipse(cx + 4, cy + 7, 36, 22, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(2, 2); // crisp 2x vector coordinates inside 64x64 model space

  if (type === 'SOLDIER') {
    // SCOUT: Compact Aerodynamic Recon Fast-Attack Buggy (No long barrel, full faction trim + radar dome)
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-13, -12.5, 7, 4.5);
    ctx.fillRect(4, -12.5, 7, 4.5);
    ctx.fillRect(-13, 8, 7, 4.5);
    ctx.fillRect(4, 8, 7, 4.5);

    // Tapered bullet/wedge fast-recon body colored boldly in faction color
    ctx.fillStyle = factionHex;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-15, -8.5);
    ctx.lineTo(7, -8.5);
    ctx.quadraticCurveTo(16, -5, 16, 0);
    ctx.quadraticCurveTo(16, 5, 7, 8.5);
    ctx.lineTo(-15, 8.5);
    ctx.quadraticCurveTo(-17, 0, -15, -8.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Dark tinted canopy slit
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(1, -5.5, 7, 11, 2.5);
    ctx.fill();

    // Amber recon headlights
    ctx.fillStyle = '#FDE047';
    ctx.fillRect(12.5, -5.5, 2.5, 3);
    ctx.fillRect(12.5, 2.5, 2.5, 3);

    // Rotating Recon Radar / Sensor Dish on rear deck (distinct from cannon barrels!)
    ctx.fillStyle = '#E2E8F0';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(-6, 0, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(-6, 0, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'ASSAULTER') {
    // BREACHER: Massive Wide Heavy Bulldozer Siege Tank (Huge wide treads + front hazard siege plow + twin heavy cannons)
    // Heavy oversized caterpillar treads
    ctx.fillStyle = '#0F172A';
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(-22, -21, 40, 9.5, 2);
    ctx.roundRect(-22, 11.5, 40, 9.5, 2);
    ctx.fill();
    ctx.stroke();

    // Wide Heavy Front Siege Ram / Dozer Shield across entire front nose
    ctx.fillStyle = '#CBD5E1';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(13, -22);
    ctx.lineTo(22, -18);
    ctx.lineTo(22, 18);
    ctx.lineTo(13, 22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Amber hazard stripes on Siege Plow
    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(15.5, -16, 4, 7);
    ctx.fillRect(15.5, -3.5, 4, 7);
    ctx.fillRect(15.5, 9, 4, 7);

    // Chunky Armored Hull
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(-20, -14.5, 34, 29, 3);
    ctx.fill();
    ctx.stroke();

    // Giant Wide Faction Heavy Turret
    ctx.fillStyle = factionHex;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.roundRect(-14, -10.5, 22, 21, 3);
    ctx.fill();
    ctx.stroke();

    // Twin Heavy Thick Siege Cannons
    ctx.fillStyle = '#E2E8F0';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 0.8;
    ctx.fillRect(6, -6.5, 18, 4.5);
    ctx.strokeRect(6, -6.5, 18, 4.5);
    ctx.fillRect(6, 2, 18, 4.5);
    ctx.strokeRect(6, 2, 18, 4.5);
  } else {
    // SNIPER: Deployed Tripod / Delta Recon Marksman Platform + Ultra-Long Needle Railgun & Cyan Optic Glint
    // Wide Y-shaped Deployed Rear Stabilizer Outriggers (distinct spider/tripod footprint!)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(-19, -18);
    ctx.moveTo(-4, 0); ctx.lineTo(-19, 18);
    ctx.stroke();
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(-4, 0); ctx.lineTo(-19, -18);
    ctx.moveTo(-4, 0); ctx.lineTo(-19, 18);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Sharp Forward-Pointing Triangular Delta Carapace
    ctx.fillStyle = '#3F5931'; // Olive ghillie/camo armor
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-12, -13);
    ctx.lineTo(-7, 0);
    ctx.lineTo(-12, 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bold Faction Delta Core
    ctx.fillStyle = factionHex;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Ultra-Long Needle Rail Barrel extending straight out front + Suppressor tip
    ctx.fillStyle = '#F8FAFC';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 0.8;
    ctx.fillRect(0, -1.6, 29, 3.2);
    ctx.strokeRect(0, -1.6, 29, 3.2);
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(22, -2.5, 7, 5);

    // Bright Cyan Laser / Optic Scope Glint on Sniper Mount
    ctx.fillStyle = '#38BDF8';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.arc(3, -3.5, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
  return PIXI.Texture.from(canvas);
}
