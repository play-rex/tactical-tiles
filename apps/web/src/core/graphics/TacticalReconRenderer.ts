import * as PIXI from 'pixi.js';
import { TerrainType, Tile, UnitType } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { type BoardRotation, rotateTileCoord } from '../boardRotation';
import { DESERT_TYPES, fbm } from './terrain/terrainVariants';
import {
  drawCanyons,
  drawDunes,
  drawForests,
  drawGroundMicroDetails,
  drawMountains,
  drawQuicksand,
  drawWaterBasins,
  NATURE_PALETTE,
} from './terrain/drawNature';
import { drawBridges, drawRoads, drawStructures } from './terrain/drawStructures';

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

      const gR = NATURE_PALETTE.grassA[0] * (1 - n) + NATURE_PALETTE.grassB[0] * n + (grain - 0.5) * 18;
      const gG = NATURE_PALETTE.grassA[1] * (1 - n) + NATURE_PALETTE.grassB[1] * n + (grain - 0.5) * 20;
      const gB = NATURE_PALETTE.grassA[2] * (1 - n) + NATURE_PALETTE.grassB[2] * n + (grain - 0.5) * 12;

      const sR = NATURE_PALETTE.sandA[0] * (1 - ripple * 0.45) + NATURE_PALETTE.sandB[0] * (ripple * 0.45) + (grain - 0.5) * 14;
      const sG = NATURE_PALETTE.sandA[1] * (1 - ripple * 0.45) + NATURE_PALETTE.sandB[1] * (ripple * 0.45) + (grain - 0.5) * 12;
      const sB = NATURE_PALETTE.sandA[2] * (1 - ripple * 0.45) + NATURE_PALETTE.sandB[2] * (ripple * 0.45) + (grain - 0.5) * 10;

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
  const canonicalGrid: (Tile | undefined)[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(undefined));
  for (const t of mapData) {
    if (t.x >= 0 && t.x < gridSize && t.y >= 0 && t.y < gridSize) {
      canonicalGrid[t.y][t.x] = t;
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

  // Pass A2: Subtle ground micro-details on PLAINS & SAND (tufts, wildflowers, pebbles, sand ripples, scrub)
  drawGroundMicroDetails(ctx, grid, gridSize);

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

  // Pass B1–B3: Auto-Tiled Water Basins, Stratified Canyons, & Swirling Quicksand
  drawWaterBasins(ctx, wCtx, grid, gridSize);
  drawCanyons(ctx, grid, gridSize);
  drawQuicksand(ctx, grid, gridSize);

  // Pass C1–C2: Auto-Connecting Roads & Dual-Style Bridges
  drawRoads(ctx, grid, gridSize);
  drawBridges(ctx, grid, gridSize, rotation);

  // Pass D1–D3: Varied Sculpted Dunes, Biome-Aware Mountain Ranges, & Multi-Species Forests
  drawDunes(ctx, grid, gridSize);
  drawMountains(ctx, grid, canonicalGrid, gridSize);
  drawForests(ctx, grid, canonicalGrid, gridSize);

  // Pass E: Varied Military Structures (Barriers, Watchtowers, Bunkers, 4 Bank Vault Styles, Fortified Bases)
  drawStructures(ctx, grid, mapData, gridSize);

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
