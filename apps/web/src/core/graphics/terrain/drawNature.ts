import { Tile } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import {
  classifyForestClusters,
  DESERT_TYPES,
  findMountainClusters,
  ForestVariant,
  GroveTheme,
  hash2,
  hash3,
  isCanyonLike,
  isDesertNeighborhood,
  isWaterLike,
  isWaterNeighborhood,
  MountainCluster,
  MountainNode,
  pickDuneVariant,
  pickForestVariant,
  pickMountainVariant,
  pickPlainsDetail,
  pickSandDetail,
} from './terrainVariants';

export const NATURE_PALETTE = {
  grassA: [92, 134, 62] as const,
  grassB: [115, 156, 76] as const,
  sandA: [219, 186, 126] as const,
  sandB: [192, 155, 96] as const,
  waterShallow: '#2B839C',
  waterMid: '#1F6783',
  waterDeep: '#134766',
  bankSand: '#B59E72',
  bankMoss: '#788C57',
  canyonRimLit: '#B87A4E',
  canyonMid: '#8C4E31',
  canyonWall: '#5E2E1D',
  canyonFloor: '#3A1D15',
  rockDark: '#36404F',
  rockMid: '#647082',
  rockLit: '#ABB6C6',
  rockHigh: '#C7D0DC',
  snowCap: '#E8EFF7',
  snowShadow: '#B9C8DA',
  mesaLit: '#E0A16F',
  mesaMid: '#B96A3F',
  mesaDark: '#7C3E24',
  mesaShadow: '#4D2315',
};

/** Helper: draw a jagged star-like conifer pine crown with 7–9 pointed boughs. */
function drawPineCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rot: number,
  points: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rad = i % 2 === 0 ? r : r * 0.56;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/** Helper: draw a rich organic foliage crown built from asymmetric scalloped leaf tufts (never a flat candy orb). */
function drawFoliageCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  dark: string,
  mid: string,
  lit: string,
  tip: string,
): void {
  // Base dark silhouette with 7 organic leaf lobes
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.68, 0, Math.PI * 2);
  for (let i = 0; i < 7; i++) {
    const a = seed * Math.PI * 2 + (i * Math.PI * 2) / 7 + (i % 2 === 0 ? 0.14 : -0.11);
    const dist = r * (0.42 + (i % 3) * 0.08);
    const lr = r * (0.42 + ((i + 1) % 2) * 0.09);
    const lx = cx + Math.cos(a) * dist;
    const ly = cy + Math.sin(a) * dist;
    ctx.moveTo(lx + lr, ly);
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
  }
  ctx.fill();

  // Midtone sunlit bough clusters offset slightly NW
  ctx.fillStyle = mid;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = seed * Math.PI * 2 + 0.35 + (i * Math.PI * 2) / 6;
    const dist = r * (0.28 + (i % 2) * 0.14);
    const lr = r * (0.36 + (i % 3) * 0.05);
    const lx = cx - 1.4 + Math.cos(a) * dist;
    const ly = cy - 1.4 + Math.sin(a) * dist;
    ctx.moveTo(lx + lr, ly);
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
  }
  ctx.fill();

  // Upper dappled sunlit leaf tufts on the NW crown
  ctx.fillStyle = lit;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI * 0.85 + i * 0.55 + (seed - 0.5) * 0.4;
    const dist = r * (0.22 + (i % 2) * 0.16);
    const lr = r * (0.22 + (i === 1 ? 0.07 : 0));
    const lx = cx - 1.8 + Math.cos(a) * dist;
    const ly = cy - 1.8 + Math.sin(a) * dist;
    ctx.moveTo(lx + lr, ly);
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
  }
  ctx.fill();

  // Subtle top highlight leaf flecks
  ctx.fillStyle = tip;
  ctx.beginPath();
  ctx.arc(cx - r * 0.28, cy - r * 0.26, r * 0.13, 0, Math.PI * 2);
  ctx.arc(cx - r * 0.06, cy - r * 0.36, r * 0.10, 0, Math.PI * 2);
  ctx.fill();
}

/** Helper: draw a top-down radiating desert palm tree. */
function drawPalmTree(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
): void {
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = seed * Math.PI * 2 + (i * Math.PI * 2) / fronds + (i % 2 === 0 ? 0.08 : -0.06);
    const len = r * (0.9 + (i % 2) * 0.16);
    const tipX = cx + Math.cos(a) * len;
    const tipY = cy + Math.sin(a) * len;
    const perpX = -Math.sin(a) * r * 0.24;
    const perpY = Math.cos(a) * r * 0.24;
    const midX = cx + Math.cos(a) * len * 0.55;
    const midY = cy + Math.sin(a) * len * 0.55;

    const isLit = Math.cos(a + Math.PI * 0.75) > 0;
    ctx.fillStyle = isLit ? '#5A9B41' : '#31682E';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(midX + perpX, midY + perpY, tipX, tipY);
    ctx.quadraticCurveTo(midX - perpX, midY - perpY, cx, cy);
    ctx.fill();
  }
  // Central palm crown heart
  ctx.fillStyle = '#7C5A34';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  ctx.fill();
}

/** Pass A2: Subtle ground micro-details on PLAINS & SAND so open terrain feels alive without visual clutter. */
export function drawGroundMicroDetails(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      if (t.type === 'PLAINS') {
        const detail = pickPlainsDetail(t, gridSize);
        if (detail === 'CLEAN') continue;

        if (detail === 'CLOVER_PATCH') {
          const cx = px + 16 + hash3(t.x, t.y, 11) * 32;
          const cy = py + 16 + hash3(t.x, t.y, 12) * 32;
          ctx.fillStyle = 'rgba(56, 98, 38, 0.22)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, 14 + hash3(t.x, t.y, 13) * 8, 9 + hash3(t.x, t.y, 14) * 6, hash3(t.x, t.y, 15) * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }

        if (detail === 'GRASS_TUFTS' || detail === 'CLOVER_PATCH') {
          const count = detail === 'GRASS_TUFTS' ? 3 + Math.floor(hash3(t.x, t.y, 16) * 3) : 2;
          for (let i = 0; i < count; i++) {
            const gx = px + 9 + hash3(t.x + i * 3, t.y, 20 + i) * 46;
            const gy = py + 11 + hash3(t.x, t.y + i * 5, 30 + i) * 44;
            ctx.strokeStyle = 'rgba(42, 74, 30, 0.58)';
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx - 3, gy - 5);
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + 0.5, gy - 6);
            ctx.moveTo(gx, gy);
            ctx.lineTo(gx + 3.5, gy - 4.5);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(154, 198, 98, 0.45)';
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(gx - 0.5, gy - 1);
            ctx.lineTo(gx - 2.5, gy - 5.5);
            ctx.stroke();
          }
        } else if (detail === 'WILDFLOWERS') {
          const flowerColors = ['rgba(254, 243, 199, 0.82)', 'rgba(253, 224, 71, 0.72)', 'rgba(196, 230, 255, 0.76)'];
          const clusterCount = 3 + Math.floor(hash3(t.x, t.y, 41) * 3);
          for (let i = 0; i < clusterCount; i++) {
            const fx = px + 10 + hash3(t.x + i * 7, t.y, 42 + i) * 44;
            const fy = py + 10 + hash3(t.x, t.y + i * 7, 52 + i) * 44;
            ctx.fillStyle = 'rgba(48, 86, 34, 0.48)';
            ctx.beginPath();
            ctx.arc(fx, fy + 1, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = flowerColors[Math.floor(hash3(t.x + i, t.y - i, 60) * flowerColors.length)];
            ctx.beginPath();
            ctx.arc(fx - 1, fy - 0.5, 1.35, 0, Math.PI * 2);
            ctx.arc(fx + 1.4, fy + 0.5, 1.15, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (detail === 'FIELD_PEBBLES') {
          const baseX = px + 14 + hash3(t.x, t.y, 70) * 36;
          const baseY = py + 14 + hash3(t.x, t.y, 71) * 36;
          for (let i = 0; i < 3; i++) {
            const rx = baseX + (hash3(t.x + i, t.y, 72 + i) - 0.5) * 14;
            const ry = baseY + (hash3(t.x, t.y + i, 76 + i) - 0.5) * 12;
            const rad = 2.0 + hash3(t.x + i, t.y + i, 80) * 2.2;
            ctx.fillStyle = 'rgba(22, 34, 20, 0.32)';
            ctx.beginPath();
            ctx.ellipse(rx + 1.2, ry + 1.4, rad, rad * 0.72, 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = i === 0 ? '#8E99A2' : '#737E87';
            ctx.beginPath();
            ctx.ellipse(rx, ry, rad, rad * 0.72, 0.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
            ctx.beginPath();
            ctx.arc(rx - rad * 0.3, ry - rad * 0.25, rad * 0.34, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (t.type === 'SAND') {
        const detail = pickSandDetail(t, gridSize);
        if (detail === 'CLEAN') continue;

        if (detail === 'WIND_RIPPLES') {
          const offsetY = hash3(t.x, t.y, 111) * 10;
          for (let i = 0; i < 3; i++) {
            const ry = py + 12 + offsetY + i * 14;
            ctx.strokeStyle = 'rgba(247, 229, 186, 0.45)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(px + 8, ry);
            ctx.bezierCurveTo(px + 24, ry - 4, px + 40, ry + 4, px + 56, ry - 1);
            ctx.stroke();
            ctx.strokeStyle = 'rgba(155, 116, 62, 0.32)';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(px + 8, ry + 1.8);
            ctx.bezierCurveTo(px + 24, ry - 2.2, px + 40, ry + 5.8, px + 56, ry + 0.8);
            ctx.stroke();
          }
        } else if (detail === 'SANDSTONE_SHARDS') {
          const cx = px + 16 + hash3(t.x, t.y, 121) * 32;
          const cy = py + 16 + hash3(t.x, t.y, 122) * 32;
          for (let i = 0; i < 3; i++) {
            const sx = cx + (hash3(t.x + i, t.y, 123 + i) - 0.5) * 18;
            const sy = cy + (hash3(t.x, t.y + i, 127 + i) - 0.5) * 16;
            const sz = 2.6 + hash3(t.x + i, t.y + i, 131) * 3.0;
            ctx.fillStyle = 'rgba(84, 52, 24, 0.32)';
            ctx.beginPath();
            ctx.ellipse(sx + 1.6, sy + 1.8, sz, sz * 0.65, 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = i === 0 ? '#B7794B' : '#965F38';
            ctx.beginPath();
            ctx.moveTo(sx - sz, sy + sz * 0.3);
            ctx.lineTo(sx - sz * 0.2, sy - sz * 0.75);
            ctx.lineTo(sx + sz, sy - sz * 0.1);
            ctx.lineTo(sx + sz * 0.4, sy + sz * 0.7);
            ctx.closePath();
            ctx.fill();
          }
        } else if (detail === 'DESERT_SCRUB') {
          const bx = px + 14 + hash3(t.x, t.y, 140) * 36;
          const by = py + 14 + hash3(t.x, t.y, 141) * 36;
          const isCactus = hash3(t.x, t.y, 142) > 0.55;
          ctx.fillStyle = 'rgba(72, 48, 22, 0.30)';
          ctx.beginPath();
          ctx.arc(bx + 2.5, by + 2.8, isCactus ? 4.8 : 5.6, 0, Math.PI * 2);
          ctx.fill();
          if (isCactus) {
            // Top-down ribbed desert barrel/agave rosette
            drawPineCrown(ctx, bx, by, 5.2, hash3(t.x, t.y, 143) * Math.PI, 6, '#3D6B37');
            ctx.fillStyle = '#6EA454';
            ctx.beginPath();
            ctx.arc(bx - 0.8, by - 0.8, 2.2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Dry sagebrush tuft
            ctx.fillStyle = '#6E7A4B';
            ctx.beginPath();
            ctx.arc(bx, by, 4.4, 0, Math.PI * 2);
            ctx.arc(bx + 3.2, by - 1.5, 3.0, 0, Math.PI * 2);
            ctx.arc(bx - 2.6, by + 1.8, 2.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#97A167';
            ctx.beginPath();
            ctx.arc(bx - 1, by - 1, 2.1, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (detail === 'ALKALI_CRACKS') {
          const cx = px + 18 + hash3(t.x, t.y, 150) * 28;
          const cy = py + 18 + hash3(t.x, t.y, 151) * 28;
          ctx.fillStyle = 'rgba(244, 226, 188, 0.25)';
          ctx.beginPath();
          ctx.ellipse(cx, cy, 14, 10, hash3(t.x, t.y, 152) * Math.PI, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(132, 96, 54, 0.38)';
          ctx.lineWidth = 0.9;
          for (let i = 0; i < 4; i++) {
            const a = hash3(t.x + i, t.y, 153 + i) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
            ctx.lineTo(cx + Math.cos(a + 0.45) * 14, cy + Math.sin(a + 0.45) * 12);
            ctx.stroke();
          }
        }
      }
    }
  }
}

/** Pass B1: Auto-Tiled WATER & WATER-BRIDGE Basins with organic shorelines, foam, shoals, reeds & rocks. */
export function drawWaterBasins(
  ctx: CanvasRenderingContext2D,
  wCtx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
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
      const wN = isWaterLike(nTile);
      const wS = isWaterLike(sTile);
      const wW = isWaterLike(wTile);
      const wE = isWaterLike(eTile);

      const padN = wN ? 0 : 8;
      const padS = wS ? 0 : 8;
      const padW = wW ? 0 : 8;
      const padE = wE ? 0 : 8;
      const rx = px + padW;
      const ry = py + padN;
      const rw = TILE_SIZE - padW - padE;
      const rh = TILE_SIZE - padN - padS;
      const r = 14;
      const cornerRadii: [number, number, number, number] = [
        !wN && !wW ? r : 0,
        !wN && !wE ? r : 0,
        !wS && !wE ? r : 0,
        !wS && !wW ? r : 0,
      ];

      // Shoreline bank color adapts slightly to grassy vs desert shore
      const desertEdge =
        (nTile && DESERT_TYPES.has(nTile.type)) ||
        (sTile && DESERT_TYPES.has(sTile.type)) ||
        (wTile && DESERT_TYPES.has(wTile.type)) ||
        (eTile && DESERT_TYPES.has(eTile.type));

      ctx.fillStyle = desertEdge ? '#C8AE7A' : NATURE_PALETTE.bankSand;
      ctx.beginPath();
      ctx.roundRect(
        px + (wW ? 0 : 3),
        py + (wN ? 0 : 3),
        TILE_SIZE - (wW ? 0 : 3) - (wE ? 0 : 3),
        TILE_SIZE - (wN ? 0 : 3) - (wS ? 0 : 3),
        16,
      );
      ctx.fill();

      // Wet dark shoreline trim
      ctx.fillStyle = 'rgba(54, 72, 68, 0.34)';
      ctx.beginPath();
      ctx.roundRect(
        px + (wW ? 0 : 6),
        py + (wN ? 0 : 6),
        TILE_SIZE - (wW ? 0 : 6) - (wE ? 0 : 6),
        TILE_SIZE - (wN ? 0 : 6) - (wS ? 0 : 6),
        15,
      );
      ctx.fill();

      // Shallow Turquoise Shelf
      ctx.fillStyle = NATURE_PALETTE.waterShallow;
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, cornerRadii);
      ctx.fill();

      // Mid-depth transition shelf
      const mp = 4;
      ctx.fillStyle = NATURE_PALETTE.waterMid;
      ctx.beginPath();
      ctx.roundRect(
        rx + (wW ? 0 : mp),
        ry + (wN ? 0 : mp),
        rw - (wW ? 0 : mp) - (wE ? 0 : mp),
        rh - (wN ? 0 : mp) - (wS ? 0 : mp),
        r * 0.75,
      );
      ctx.fill();

      // Deep Trench Core
      const dp = 8;
      ctx.fillStyle = NATURE_PALETTE.waterDeep;
      ctx.beginPath();
      ctx.roundRect(
        rx + (wW ? 0 : dp),
        ry + (wN ? 0 : dp),
        rw - (wW ? 0 : dp) - (wE ? 0 : dp),
        rh - (wN ? 0 : dp) - (wS ? 0 : dp),
        r * 0.55,
      );
      ctx.fill();

      // Subtle open-water variations (depth pockets / sandbars / wave glints) on non-bridge water tiles
      if (t.type === 'WATER') {
        const wVar = hash3(t.x, t.y, 170);
        if (wN && wS && wW && wE) {
          if (wVar < 0.38) {
            // Subtle deeper indigo channel pocket
            ctx.fillStyle = 'rgba(10, 38, 62, 0.42)';
            ctx.beginPath();
            ctx.ellipse(
              px + 24 + hash3(t.x, t.y, 171) * 16,
              py + 24 + hash3(t.x, t.y, 172) * 16,
              14 + hash3(t.x, t.y, 173) * 8,
              9 + hash3(t.x, t.y, 174) * 5,
              hash3(t.x, t.y, 175) * Math.PI,
              0,
              Math.PI * 2,
            );
            ctx.fill();
          } else if (wVar > 0.72) {
            // Shallow teal sandbar shoal
            ctx.fillStyle = 'rgba(56, 168, 188, 0.22)';
            ctx.beginPath();
            ctx.ellipse(px + 32, py + 32, 16, 10, hash3(t.x, t.y, 176) * Math.PI, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Crisp water surface shimmer dashes
        ctx.strokeStyle = 'rgba(186, 236, 250, 0.22)';
        ctx.lineWidth = 1.2;
        const waveCount = 2 + Math.floor(hash3(t.x, t.y, 177) * 2);
        for (let i = 0; i < waveCount; i++) {
          const wx = rx + 6 + hash3(t.x + i * 3, t.y, 178 + i) * Math.max(4, rw - 20);
          const wy = ry + 6 + hash3(t.x, t.y + i * 5, 182 + i) * Math.max(4, rh - 12);
          ctx.beginPath();
          ctx.moveTo(wx, wy);
          ctx.quadraticCurveTo(wx + 5, wy - 2, wx + 10, wy);
          ctx.stroke();
        }

        // Shoreline coastal details along exposed edges
        const hasShore = !wN || !wS || !wW || !wE;
        if (hasShore) {
          // Pale shoreline foam glint
          ctx.strokeStyle = 'rgba(218, 246, 255, 0.34)';
          ctx.lineWidth = 1.25;
          if (!wN) {
            ctx.beginPath();
            ctx.moveTo(rx + 6, ry + 2.5);
            ctx.quadraticCurveTo(px + 32, ry + 4.5, rx + rw - 6, ry + 2.5);
            ctx.stroke();
          }
          if (!wS) {
            ctx.beginPath();
            ctx.moveTo(rx + 6, ry + rh - 2.5);
            ctx.quadraticCurveTo(px + 32, ry + rh - 4.5, rx + rw - 6, ry + rh - 2.5);
            ctx.stroke();
          }
          if (!wW) {
            ctx.beginPath();
            ctx.moveTo(rx + 2.5, ry + 6);
            ctx.quadraticCurveTo(rx + 4.5, py + 32, rx + 2.5, ry + rh - 6);
            ctx.stroke();
          }
          if (!wE) {
            ctx.beginPath();
            ctx.moveTo(rx + rw - 2.5, ry + 6);
            ctx.quadraticCurveTo(rx + rw - 4.5, py + 32, rx + rw - 2.5, ry + rh - 6);
            ctx.stroke();
          }

          // Coastal lily pads / reeds on lush banks or wet rocks near rocky banks
          const shoreDetail = hash3(t.x, t.y, 188);
          const adjMountain =
            nTile?.type === 'MOUNTAIN' || sTile?.type === 'MOUNTAIN' || wTile?.type === 'MOUNTAIN' || eTile?.type === 'MOUNTAIN';
          if (adjMountain || shoreDetail > 0.78) {
            // Wet coastal rock shoal with subtle water-ring
            const rockX = !wW ? rx + 8 : !wE ? rx + rw - 9 : px + 20 + hash3(t.x, t.y, 189) * 24;
            const rockY = !wN ? ry + 8 : !wS ? ry + rh - 9 : py + 20 + hash3(t.x, t.y, 190) * 24;
            ctx.strokeStyle = 'rgba(205, 242, 255, 0.42)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(rockX, rockY, 6.2, 4.8, 0.3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = '#4E5B69';
            ctx.beginPath();
            ctx.ellipse(rockX, rockY, 4.6, 3.4, 0.3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#82909E';
            ctx.beginPath();
            ctx.ellipse(rockX - 1.1, rockY - 0.8, 2.2, 1.5, 0.3, 0, Math.PI * 2);
            ctx.fill();
          } else if (!desertEdge && shoreDetail < 0.34) {
            // Lily pads tucked near grassy/forested edge
            const lx = !wW ? rx + 9 : !wE ? rx + rw - 10 : px + 18 + hash3(t.x, t.y, 191) * 28;
            const ly = !wN ? ry + 9 : !wS ? ry + rh - 10 : py + 18 + hash3(t.x, t.y, 192) * 28;
            const padOffsets = [
              { dx: 0, dy: 0, rad: 3.8, notch: 0.4 },
              { dx: 6.5, dy: 3.2, rad: 2.9, notch: 2.1 },
              { dx: -4.2, dy: 5.5, rad: 2.4, notch: 4.0 },
            ];
            for (let p = 0; p < padOffsets.length; p++) {
              const po = padOffsets[p];
              ctx.fillStyle = p === 0 ? '#2E7D3E' : '#3E944B';
              ctx.beginPath();
              ctx.moveTo(lx + po.dx, ly + po.dy);
              ctx.arc(lx + po.dx, ly + po.dy, po.rad, po.notch + 0.35, po.notch + Math.PI * 2 - 0.35);
              ctx.closePath();
              ctx.fill();
            }
            if (shoreDetail < 0.14) {
              ctx.fillStyle = '#FCE7F3';
              ctx.beginPath();
              ctx.arc(lx + 0.4, ly - 0.2, 1.3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      // Write Water Mask (strictly matches water interior so LIVE caustics stay inside basins)
      wCtx.fillStyle = '#ffffff';
      wCtx.beginPath();
      wCtx.roundRect(rx, ry, rw, rh, cornerRadii);
      wCtx.fill();
    }
  }
}

/** Pass B2: Auto-Connected Stratified CANYON Gorges with terraced ledges & floor scree. */
export function drawCanyons(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t) continue;
      const adjCanyon =
        grid[y - 1]?.[x]?.type === 'CANYON' ||
        grid[y + 1]?.[x]?.type === 'CANYON' ||
        grid[y]?.[x - 1]?.type === 'CANYON' ||
        grid[y]?.[x + 1]?.type === 'CANYON';
      const isCanyonBridge =
        (t.type === 'BRIDGE' || t.type === 'BRIDGE_V') &&
        adjCanyon &&
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

      // Outer sunlit sandstone rim
      ctx.fillStyle = NATURE_PALETTE.canyonRimLit;
      ctx.beginPath();
      ctx.roundRect(
        px + (cW ? 0 : 3),
        py + (cN ? 0 : 3),
        TILE_SIZE - (cW ? 0 : 3) - (cE ? 0 : 3),
        TILE_SIZE - (cN ? 0 : 3) - (cS ? 0 : 3),
        10,
      );
      ctx.fill();

      // Middle terraced russet strata ledge
      ctx.fillStyle = NATURE_PALETTE.canyonMid;
      ctx.beginPath();
      ctx.roundRect(
        px + (cW ? 0 : 7),
        py + (cN ? 0 : 7),
        TILE_SIZE - (cW ? 0 : 7) - (cE ? 0 : 7),
        TILE_SIZE - (cN ? 0 : 7) - (cS ? 0 : 6),
        9,
      );
      ctx.fill();

      // Steep shadowed upper cliff wall (deeper on NW/N rim catching overhead shadow)
      ctx.fillStyle = NATURE_PALETTE.canyonWall;
      ctx.beginPath();
      ctx.roundRect(
        px + (cW ? 0 : 11),
        py + (cN ? 0 : 12),
        TILE_SIZE - (cW ? 0 : 11) - (cE ? 0 : 10),
        TILE_SIZE - (cN ? 0 : 12) - (cS ? 0 : 9),
        8,
      );
      ctx.fill();

      // Deep canyon floor
      ctx.fillStyle = NATURE_PALETTE.canyonFloor;
      ctx.beginPath();
      ctx.roundRect(
        px + (cW ? 0 : 15),
        py + (cN ? 0 : 17),
        TILE_SIZE - (cW ? 0 : 15) - (cE ? 0 : 13),
        TILE_SIZE - (cN ? 0 : 17) - (cS ? 0 : 12),
        7,
      );
      ctx.fill();

      // Canyon floor scree boulders & dry riverbed cracks
      if (t.type === 'CANYON') {
        const boulders = 2 + Math.floor(hash3(t.x, t.y, 210) * 3);
        for (let i = 0; i < boulders; i++) {
          const bx = px + 20 + hash3(t.x + i * 3, t.y, 211 + i) * 24;
          const by = py + 22 + hash3(t.x, t.y + i * 5, 216 + i) * 20;
          const br = 2 + hash3(t.x + i, t.y + i, 221) * 2.5;
          ctx.fillStyle = '#4B2E24';
          ctx.beginPath();
          ctx.ellipse(bx, by, br, br * 0.72, 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#734A38';
          ctx.beginPath();
          ctx.arc(bx - 0.6, by - 0.6, br * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
}

/** Pass B3: Varied Swirling QUICKSAND Sinkholes with sediment spirals & silt bubbles. */
export function drawQuicksand(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t || t.type !== 'QUICKSAND') continue;
      const cx = x * TILE_SIZE + 32 + (hash3(t.x, t.y, 230) - 0.5) * 4;
      const cy = y * TILE_SIZE + 32 + (hash3(t.x, t.y, 231) - 0.5) * 4;
      const tilt = (hash3(t.x, t.y, 232) - 0.5) * 0.9;
      const dir = hash3(t.x, t.y, 233) > 0.5 ? 1 : -1;

      const grad = ctx.createRadialGradient(cx, cy, 3, cx, cy, 28);
      grad.addColorStop(0, '#4E382B');
      grad.addColorStop(0.45, '#735743');
      grad.addColorStop(0.78, '#9A7D62');
      grad.addColorStop(1, 'rgba(154, 125, 98, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 28, 22, tilt, 0, Math.PI * 2);
      ctx.fill();

      // Nested vortex spiral ridges
      const rings = [
        { rx: 21, ry: 15, start: 0.2, sweep: 2.3, alpha: 0.42 },
        { rx: 14, ry: 10, start: 2.0, sweep: 2.6, alpha: 0.52 },
        { rx: 7.5, ry: 5.5, start: 0.7, sweep: 3.1, alpha: 0.62 },
      ];
      for (const ring of rings) {
        ctx.strokeStyle = `rgba(42, 28, 18, ${ring.alpha})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          cy,
          ring.rx,
          ring.ry,
          tilt,
          dir > 0 ? ring.start : Math.PI - ring.start,
          dir > 0 ? ring.start + ring.sweep : Math.PI - ring.start + ring.sweep,
        );
        ctx.stroke();
      }

      // Wet silt bubbles
      for (let b = 0; b < 3; b++) {
        const ba = hash3(t.x + b, t.y, 234 + b) * Math.PI * 2;
        const dist = 5 + hash3(t.x, t.y + b, 238 + b) * 11;
        const bx = cx + Math.cos(ba) * dist;
        const by = cy + Math.sin(ba) * dist * 0.72;
        ctx.fillStyle = 'rgba(220, 198, 168, 0.35)';
        ctx.beginPath();
        ctx.arc(bx, by, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(46, 30, 18, 0.55)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }

      // Occasional bleached driftwood twig sticking out of the rim
      if (hash3(t.x, t.y, 245) > 0.52) {
        ctx.strokeStyle = '#C9B79C';
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + 12, cy - 8);
        ctx.lineTo(cx + 21, cy - 15);
        ctx.moveTo(cx + 16, cy - 11);
        ctx.lineTo(cx + 19, cy - 8);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
  }
}

/** Pass D1: 4 Sculpted DUNES variants (Barchan Crescent, Twin Ridges, Star Dune, Rocky Drift). */
export function drawDunes(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t || t.type !== 'DUNES') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const variant = pickDuneVariant(t, gridSize);

      if (variant === 'BARCHAN_CRESCENT') {
        // Sweeping wind-carved crescent barchan dune
        ctx.fillStyle = 'rgba(72, 48, 22, 0.28)';
        ctx.beginPath();
        ctx.ellipse(px + 38, py + 41, 27, 17, -0.32, 0, Math.PI * 2);
        ctx.fill();

        // Sunlit windward backslope
        ctx.fillStyle = '#F2DAA6';
        ctx.beginPath();
        ctx.moveTo(px + 4, py + 47);
        ctx.quadraticCurveTo(px + 25, py + 8, px + 59, py + 22);
        ctx.quadraticCurveTo(px + 34, py + 30, px + 4, py + 47);
        ctx.fill();

        // Shaded leeward slipface
        ctx.fillStyle = '#BD8D4A';
        ctx.beginPath();
        ctx.moveTo(px + 4, py + 47);
        ctx.quadraticCurveTo(px + 34, py + 30, px + 59, py + 22);
        ctx.quadraticCurveTo(px + 46, py + 55, px + 14, py + 57);
        ctx.fill();

        // Bright sunlit knife-edge ridge highlight
        ctx.strokeStyle = 'rgba(255, 245, 214, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px + 7, py + 45);
        ctx.quadraticCurveTo(px + 33, py + 29, px + 56, py + 23);
        ctx.stroke();
      } else if (variant === 'TWIN_RIDGES') {
        // Two parallel wind-sculpted sand waves
        const drawWave = (ox: number, oy: number, scale: number) => {
          ctx.fillStyle = 'rgba(72, 48, 22, 0.22)';
          ctx.beginPath();
          ctx.ellipse(px + ox + 28 * scale, py + oy + 20 * scale, 22 * scale, 10 * scale, -0.25, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#EED49E';
          ctx.beginPath();
          ctx.moveTo(px + ox, py + oy + 24 * scale);
          ctx.quadraticCurveTo(px + ox + 22 * scale, py + oy + 2 * scale, px + ox + 46 * scale, py + oy + 12 * scale);
          ctx.quadraticCurveTo(px + ox + 24 * scale, py + oy + 18 * scale, px + ox, py + oy + 24 * scale);
          ctx.fill();

          ctx.fillStyle = '#C29250';
          ctx.beginPath();
          ctx.moveTo(px + ox, py + oy + 24 * scale);
          ctx.quadraticCurveTo(px + ox + 24 * scale, py + oy + 18 * scale, px + ox + 46 * scale, py + oy + 12 * scale);
          ctx.quadraticCurveTo(px + ox + 36 * scale, py + oy + 30 * scale, px + ox + 10 * scale, py + oy + 31 * scale);
          ctx.fill();
        };
        drawWave(4, 6, 0.92);
        drawWave(14, 26, 0.96);
      } else if (variant === 'STAR_DUNE') {
        // 3-armed pyramidal star dune
        const cx = px + 31 + (hash3(t.x, t.y, 410) - 0.5) * 6;
        const cy = py + 27 + (hash3(t.x, t.y, 411) - 0.5) * 6;
        ctx.fillStyle = 'rgba(72, 48, 22, 0.26)';
        ctx.beginPath();
        ctx.ellipse(cx + 6, cy + 12, 26, 17, 0.15, 0, Math.PI * 2);
        ctx.fill();

        // NW sunlit slope
        ctx.fillStyle = '#F5E0B2';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px + 6, py + 44);
        ctx.lineTo(px + 28, py + 56);
        ctx.closePath();
        ctx.fill();

        // NE mid-lit slope
        ctx.fillStyle = '#DFBA7B';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px + 58, py + 24);
        ctx.lineTo(px + 14, py + 12);
        ctx.lineTo(px + 6, py + 44);
        ctx.closePath();
        ctx.fill();

        // SE deep shadow slipface
        ctx.fillStyle = '#B88645';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px + 58, py + 24);
        ctx.lineTo(px + 52, py + 52);
        ctx.lineTo(px + 28, py + 56);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 247, 222, 0.65)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(px + 8, py + 42);
        ctx.lineTo(cx, cy);
        ctx.lineTo(px + 55, py + 25);
        ctx.stroke();
      } else {
        // ROCKY_DRIFT: Golden dune cradling weathered sandstone outcrops
        ctx.fillStyle = 'rgba(72, 48, 22, 0.26)';
        ctx.beginPath();
        ctx.ellipse(px + 36, py + 40, 26, 16, -0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#EED49E';
        ctx.beginPath();
        ctx.moveTo(px + 6, py + 48);
        ctx.quadraticCurveTo(px + 26, py + 14, px + 57, py + 26);
        ctx.quadraticCurveTo(px + 34, py + 34, px + 6, py + 48);
        ctx.fill();

        ctx.fillStyle = '#BC8C4B';
        ctx.beginPath();
        ctx.moveTo(px + 6, py + 48);
        ctx.quadraticCurveTo(px + 34, py + 34, px + 57, py + 26);
        ctx.quadraticCurveTo(px + 44, py + 54, px + 14, py + 56);
        ctx.fill();

        // Exposed ochre sandstone outcrop on the crest
        ctx.fillStyle = '#7F4428';
        ctx.beginPath();
        ctx.moveTo(px + 20, py + 34);
        ctx.lineTo(px + 30, py + 19);
        ctx.lineTo(px + 44, py + 27);
        ctx.lineTo(px + 39, py + 39);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#C97F4E';
        ctx.beginPath();
        ctx.moveTo(px + 20, py + 34);
        ctx.lineTo(px + 30, py + 19);
        ctx.lineTo(px + 35, py + 34);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

const SUN_DIR_X = -0.74;
const SUN_DIR_Y = -0.67;

function lerpRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): string {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgb(${r},${g},${bl})`;
}

/** Directional Lambertian rock shading along a 4-stop alpine granite or desert sandstone ramp. */
function shadeRockFacet(litDot: number, isDesert: boolean, elevation = 0.7): string {
  const norm = Math.max(0, Math.min(1, (litDot + 1) * 0.5 + (elevation - 0.65) * 0.08));
  if (isDesert) {
    const stops: ReadonlyArray<readonly [number, number, number]> = [
      [74, 33, 21],
      [124, 58, 34],
      [186, 102, 60],
      [234, 166, 114],
    ];
    const scaled = norm * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(scaled));
    return lerpRgb(stops[i], stops[i + 1], scaled - i);
  }
  const stops: ReadonlyArray<readonly [number, number, number]> = [
    [40, 50, 65],
    [72, 85, 105],
    [120, 134, 154],
    [194, 206, 222],
  ];
  const scaled = norm * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  return lerpRgb(stops[i], stops[i + 1], scaled - i);
}

/** Draws an organic jagged rocky polygon apron (zero boxy grid edges). */
function traceIrregularRockBlob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seedX: number,
  seedY: number,
  points = 10,
): void {
  ctx.beginPath();
  for (let i = 0; i < points; i++) {
    const a = (i * Math.PI * 2) / points;
    const jitter = 0.8 + hash3(seedX + i * 7, seedY + i * 11, 615) * 0.36;
    const px = cx + Math.cos(a) * rx * jitter;
    const py = cy + Math.sin(a) * ry * jitter;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Renders a single multi-faceted irregular massif summit with Lambertian rock faces, snow/mesa caps & rock ribs. */
function drawMassifSummit(
  ctx: CanvasRenderingContext2D,
  node: MountainNode,
  isDesert: boolean,
  isHeroSummit: boolean,
): void {
  const { tile, peakX, peakY, cx, cy, elevation, totalNeighbors } = node;
  const ribCount = 7;
  const baseScale =
    totalNeighbors === 0
      ? 0.76 + elevation * 0.16
      : 0.86 + elevation * 0.34 + (isHeroSummit ? 0.1 : 0);

  // Build 7 irregular radiating rock arêtes (ribs) around the summit
  const feet: Array<{ x: number; y: number; angle: number; snowReach: number }> = [];
  for (let k = 0; k < ribCount; k++) {
    const baseA = (k * Math.PI * 2) / ribCount - Math.PI * 0.35;
    const ang = baseA + (hash3(tile.x + k * 5, tile.y + k * 3, 620) - 0.5) * 0.42;
    const rad = (24 + hash3(tile.x + k * 9, tile.y, 621) * 11) * baseScale;
    // Slight southern down-slope stretch creates believable oblique top-down mountain volume
    const downStretch = Math.sin(ang) > 0 ? 1.14 : 0.88;
    const fx = cx + Math.cos(ang) * rad;
    const fy = cy + 4 + Math.sin(ang) * rad * downStretch;
    // Sleek, realistic alpine snowline (crisp high peaks rather than puffy blobs)
    const snowReach = 0.21 + (elevation - 0.5) * 0.26 + (hash3(tile.x, tile.y + k * 7, 622) - 0.45) * 0.14;
    feet.push({ x: fx, y: fy, angle: ang, snowReach: Math.max(0.14, Math.min(0.44, snowReach)) });
  }

  // Paint each triangular slope facet with true NW directional lighting
  for (let k = 0; k < ribCount; k++) {
    const f1 = feet[k];
    const f2 = feet[(k + 1) % ribCount];
    const midX = (f1.x + f2.x) * 0.5 - peakX;
    const midY = (f1.y + f2.y) * 0.5 - peakY;
    const len = Math.hypot(midX, midY) || 1;
    const litDot = (midX / len) * SUN_DIR_X + (midY / len) * SUN_DIR_Y;

    ctx.fillStyle = shadeRockFacet(litDot, isDesert, elevation);
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.closePath();
    ctx.fill();

    // Subtle geological rock crease / gully fold down alternate slopes
    const foldX = peakX + ((f1.x + f2.x) * 0.5 - peakX) * 0.72;
    const foldY = peakY + ((f1.y + f2.y) * 0.5 - peakY) * 0.72;
    ctx.strokeStyle =
      litDot > 0.15
        ? isDesert
          ? 'rgba(255, 224, 185, 0.22)'
          : 'rgba(232, 240, 250, 0.22)'
        : isDesert
          ? 'rgba(54, 22, 12, 0.34)'
          : 'rgba(18, 25, 36, 0.34)';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(foldX, foldY);
    ctx.stroke();

    // Desert stratified sandstone contour bands along sunlit & mid faces
    if (isDesert && litDot > -0.35) {
      ctx.strokeStyle = 'rgba(250, 206, 158, 0.28)';
      ctx.lineWidth = 1.1;
      for (const band of [0.46, 0.72]) {
        ctx.beginPath();
        ctx.moveTo(peakX + (f1.x - peakX) * band, peakY + (f1.y - peakY) * band);
        ctx.lineTo(peakX + (f2.x - peakX) * band, peakY + (f2.y - peakY) * band);
        ctx.stroke();
      }
    }
  }

  // Secondary crag shoulder sub-peak on Hero summits for sweeping Himalayan/Alpine grandeur
  if (isHeroSummit) {
    const side = hash3(tile.x, tile.y, 628) > 0.5 ? 1 : -1;
    const subX = peakX + side * 12;
    const subY = peakY + 7;
    ctx.fillStyle = shadeRockFacet(0.55, isDesert, elevation - 0.1);
    ctx.beginPath();
    ctx.moveTo(subX, subY);
    ctx.lineTo(subX - 14, subY + 18);
    ctx.lineTo(subX + 2, subY + 21);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shadeRockFacet(-0.52, isDesert, elevation - 0.1);
    ctx.beginPath();
    ctx.moveTo(subX, subY);
    ctx.lineTo(subX + 2, subY + 21);
    ctx.lineTo(subX + 14, subY + 15);
    ctx.closePath();
    ctx.fill();
  }

  // Summit crown: flat-topped eroded sandstone mesa cap (Desert) OR jagged glacial snowfield (Temperate)
  if (isDesert) {
    if (elevation >= 0.62) {
      const capR = 7 + elevation * 5;
      ctx.fillStyle = '#E6A672';
      traceIrregularRockBlob(ctx, peakX, peakY + 2, capR, capR * 0.68, tile.x + 17, tile.y + 19, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 232, 198, 0.55)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
  } else if (isHeroSummit || elevation >= 0.67) {
    for (let k = 0; k < ribCount; k++) {
      const f1 = feet[k];
      const f2 = feet[(k + 1) % ribCount];
      const midX = (f1.x + f2.x) * 0.5 - peakX;
      const midY = (f1.y + f2.y) * 0.5 - peakY;
      const len = Math.hypot(midX, midY) || 1;
      const litDot = (midX / len) * SUN_DIR_X + (midY / len) * SUN_DIR_Y;

      const s1x = peakX + (f1.x - peakX) * f1.snowReach;
      const s1y = peakY + (f1.y - peakY) * f1.snowReach;
      const s2x = peakX + (f2.x - peakX) * f2.snowReach;
      const s2y = peakY + (f2.y - peakY) * f2.snowReach;
      // Glacial snow dips narrowly into concave couloirs between rock ribs
      const gullyReach = Math.min(0.48, (f1.snowReach + f2.snowReach) * 0.58);
      const gx = peakX + ((f1.x + f2.x) * 0.5 - peakX) * gullyReach;
      const gy = peakY + ((f1.y + f2.y) * 0.5 - peakY) * gullyReach;

      ctx.fillStyle = litDot > 0.08 ? '#EEF5FC' : litDot > -0.28 ? '#C9D9EB' : '#9EB4CE';
      ctx.beginPath();
      ctx.moveTo(peakX, peakY);
      ctx.lineTo(s1x, s1y);
      ctx.lineTo(gx, gy);
      ctx.lineTo(s2x, s2y);
      ctx.closePath();
      ctx.fill();
    }
  } else if (elevation >= 0.52) {
    // Lower shoulder peaks show raw chiseled granite with thin frost ridge streaks
    ctx.strokeStyle = 'rgba(232, 241, 250, 0.72)';
    ctx.lineWidth = 1.6;
    for (let k = 0; k < ribCount; k++) {
      const f = feet[k];
      const dx = f.x - peakX;
      const dy = f.y - peakY;
      const len = Math.hypot(dx, dy) || 1;
      if ((dx / len) * SUN_DIR_X + (dy / len) * SUN_DIR_Y > 0.1) {
        ctx.beginPath();
        ctx.moveTo(peakX, peakY);
        ctx.lineTo(peakX + dx * 0.28, peakY + dy * 0.28);
        ctx.stroke();
      }
    }
  }

  // Crisp NW sunlit arête crest highlights so the silhouette reads razor-sharp at every zoom
  ctx.strokeStyle = isDesert ? 'rgba(255, 230, 194, 0.52)' : 'rgba(248, 252, 255, 0.58)';
  ctx.lineWidth = 1.2;
  for (let k = 0; k < ribCount; k++) {
    const f = feet[k];
    const dx = f.x - peakX;
    const dy = f.y - peakY;
    const len = Math.hypot(dx, dy) || 1;
    if ((dx / len) * SUN_DIR_X + (dy / len) * SUN_DIR_Y > 0.32) {
      ctx.beginPath();
      ctx.moveTo(peakX, peakY);
      ctx.lineTo(peakX + dx * 0.55, peakY + dy * 0.55);
      ctx.stroke();
    }
  }
}

/** Renders a connected multi-tile mountain range (2+ tiles) as ONE unified irregular geological massif. */
function drawUnifiedMountainRange(
  ctx: CanvasRenderingContext2D,
  cluster: MountainCluster,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
  const { nodes, links, isDesert } = cluster;

  // Precompute natural kinked saddle midpoints for every connected ridge spine in the range
  const saddles = links.map((link, idx) => {
    const a = nodes[link.a];
    const b = nodes[link.b];
    const dx = b.peakX - a.peakX;
    const dy = b.peakY - a.peakY;
    const dist = Math.hypot(dx, dy) || 1;
    const perpX = -dy / dist;
    const perpY = dx / dist;
    const kink = (hash3(a.tile.x + b.tile.x, a.tile.y + b.tile.y, 640 + idx) - 0.5) * 14;
    const midX = (a.peakX + b.peakX) * 0.5 + perpX * kink;
    const midY = (a.peakY + b.peakY) * 0.5 + perpY * kink + 4.5;
    return { a, b, midX, midY, perpX, perpY, isDiagonal: link.isDiagonal };
  });

  // Layer 1: Unified organic rocky foothill & talus scree apron (completely erases square tile seams!)
  ctx.fillStyle = isDesert ? 'rgba(92, 46, 22, 0.24)' : 'rgba(20, 28, 38, 0.24)';
  for (const n of nodes) {
    traceIrregularRockBlob(ctx, n.cx + 2, n.cy + 5, 36 + n.elevation * 6, 33 + n.elevation * 6, n.tile.x, n.tile.y, 10);
    ctx.fill();
  }
  ctx.fillStyle = isDesert ? 'rgba(148, 82, 44, 0.58)' : 'rgba(84, 95, 110, 0.58)';
  for (const n of nodes) {
    traceIrregularRockBlob(ctx, n.cx, n.cy + 3, 33 + n.elevation * 5, 30 + n.elevation * 5, n.tile.x + 3, n.tile.y + 5, 10);
    ctx.fill();
  }
  for (const s of saddles) {
    const bridgeX = (s.a.cx + s.b.cx) * 0.5;
    const bridgeY = (s.a.cy + s.b.cy) * 0.5 + 3;
    traceIrregularRockBlob(ctx, bridgeX, bridgeY, s.isDiagonal ? 28 : 25, s.isDiagonal ? 26 : 24, s.a.tile.x + 11, s.b.tile.y + 13, 8);
    ctx.fill();
  }

  // Layer 2: Unified sweeping SE Sun Cast Shadow beneath the entire massif
  ctx.fillStyle = isDesert ? 'rgba(42, 20, 10, 0.34)' : 'rgba(10, 16, 26, 0.36)';
  for (const s of saddles) {
    const sh = 14 + ((s.a.elevation + s.b.elevation) * 0.5) * 12;
    ctx.beginPath();
    ctx.moveTo(s.a.peakX, s.a.peakY);
    ctx.lineTo(s.midX, s.midY);
    ctx.lineTo(s.b.peakX, s.b.peakY);
    ctx.lineTo(s.b.cx + sh + 12, s.b.cy + sh + 10);
    ctx.lineTo(s.midX + sh + 10, s.midY + sh + 14);
    ctx.lineTo(s.a.cx + sh + 8, s.a.cy + sh + 12);
    ctx.closePath();
    ctx.fill();
  }
  for (const n of nodes) {
    const sh = 13 + n.elevation * 13;
    ctx.beginPath();
    ctx.moveTo(n.peakX, n.peakY);
    ctx.lineTo(n.cx + sh + 16, n.cy + sh + 4);
    ctx.lineTo(n.cx + sh - 2, n.cy + sh + 20);
    ctx.lineTo(n.cx - 16, n.cy + 20);
    ctx.closePath();
    ctx.fill();
  }

  // Layer 3: Sculpted Connected Mountain Ridge Spines (sunlit NW flank + deep shadowed SE cliff wall)
  const sortedSaddles = [...saddles].sort((u, v) => Math.min(u.a.peakY, u.b.peakY) - Math.min(v.a.peakY, v.b.peakY));
  for (const s of sortedSaddles) {
    const avgElev = (s.a.elevation + s.b.elevation) * 0.5;
    const flankWidth = 22 + avgElev * 11;
    // Pick the normal pointing toward the NW sun vs away into SE shadow
    const dotSun = s.perpX * SUN_DIR_X + s.perpY * SUN_DIR_Y;
    const litNX = dotSun >= 0 ? s.perpX : -s.perpX;
    const litNY = dotSun >= 0 ? s.perpY : -s.perpY;
    const darkNX = -litNX;
    const darkNY = -litNY;

    // Shaded SE ridge flank
    ctx.fillStyle = shadeRockFacet(-0.56, isDesert, avgElev);
    ctx.beginPath();
    ctx.moveTo(s.a.peakX, s.a.peakY);
    ctx.lineTo(s.midX, s.midY);
    ctx.lineTo(s.b.peakX, s.b.peakY);
    ctx.lineTo(s.b.cx + darkNX * flankWidth * 0.85, s.b.cy + 4 + darkNY * flankWidth * 0.85);
    ctx.lineTo(s.midX + darkNX * flankWidth * 1.05, s.midY + 6 + darkNY * flankWidth * 1.05);
    ctx.lineTo(s.a.cx + darkNX * flankWidth * 0.85, s.a.cy + 4 + darkNY * flankWidth * 0.85);
    ctx.closePath();
    ctx.fill();

    // Sunlit NW ridge flank
    ctx.fillStyle = shadeRockFacet(0.54, isDesert, avgElev);
    ctx.beginPath();
    ctx.moveTo(s.a.peakX, s.a.peakY);
    ctx.lineTo(s.midX, s.midY);
    ctx.lineTo(s.b.peakX, s.b.peakY);
    ctx.lineTo(s.b.cx + litNX * flankWidth * 0.85, s.b.cy + 4 + litNY * flankWidth * 0.85);
    ctx.lineTo(s.midX + litNX * flankWidth * 1.02, s.midY + 4 + litNY * flankWidth * 1.02);
    ctx.lineTo(s.a.cx + litNX * flankWidth * 0.85, s.a.cy + 4 + litNY * flankWidth * 0.85);
    ctx.closePath();
    ctx.fill();

    // Branching rocky gully ribs sloping down the ridge flanks
    ctx.strokeStyle = isDesert ? 'rgba(62, 26, 14, 0.38)' : 'rgba(22, 30, 44, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(s.midX, s.midY);
    ctx.lineTo(s.midX + darkNX * flankWidth * 0.78, s.midY + 5 + darkNY * flankWidth * 0.78);
    ctx.stroke();

    // Slender glacial snow ridge cornice ONLY across the highest alpine saddles
    if (!isDesert && Math.min(s.a.elevation, s.b.elevation) >= 0.68) {
      const snowW = 3.2 + avgElev * 2.8;
      ctx.fillStyle = '#E6EFF8';
      ctx.beginPath();
      ctx.moveTo(s.a.peakX, s.a.peakY);
      ctx.lineTo(s.midX, s.midY);
      ctx.lineTo(s.b.peakX, s.b.peakY);
      ctx.lineTo(s.b.peakX + litNX * snowW, s.b.peakY + litNY * snowW);
      ctx.lineTo(s.midX + litNX * (snowW + 1.2), s.midY + litNY * (snowW + 1.2));
      ctx.lineTo(s.a.peakX + litNX * snowW, s.a.peakY + litNY * snowW);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ADC2DA';
      ctx.beginPath();
      ctx.moveTo(s.a.peakX, s.a.peakY);
      ctx.lineTo(s.midX, s.midY);
      ctx.lineTo(s.b.peakX, s.b.peakY);
      ctx.lineTo(s.b.peakX + darkNX * snowW * 0.65, s.b.peakY + darkNY * snowW * 0.65);
      ctx.lineTo(s.midX + darkNX * (snowW * 0.72), s.midY + darkNY * (snowW * 0.72));
      ctx.lineTo(s.a.peakX + darkNX * snowW * 0.65, s.a.peakY + darkNY * snowW * 0.65);
      ctx.closePath();
      ctx.fill();
    }

    // Crisp sunlit ridge spine rim highlight
    ctx.strokeStyle = isDesert ? 'rgba(255, 224, 186, 0.48)' : 'rgba(245, 250, 255, 0.56)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(s.a.peakX, s.a.peakY);
    ctx.lineTo(s.midX, s.midY);
    ctx.lineTo(s.b.peakX, s.b.peakY);
    ctx.stroke();
  }

  // Layer 4: Multi-faceted Irregular Summits sorted North-to-South for realistic overlapping elevation depth
  const sortedNodes = [...nodes].sort((a, b) => a.peakY - b.peakY);
  const maxElev = nodes.reduce((m, n) => Math.max(m, n.elevation), 0);
  for (const n of sortedNodes) {
    const isHero =
      nodes.length >= 3 && (n.totalNeighbors >= 3 || n.elevation >= maxElev - 0.04);
    drawMassifSummit(ctx, n, isDesert, isHero);
  }

  // Layer 5: Miniature Alpine Foothill Timberline along outer temperate range borders (sells massive scale!)
  if (!isDesert) {
    const borderDirs: ReadonlyArray<readonly [number, number]> = [
      [0, 1],
      [-1, 1],
      [1, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const n of sortedNodes) {
      for (let d = 0; d < borderDirs.length; d++) {
        const [dx, dy] = borderDirs[d];
        const nx = n.x + dx;
        const ny = n.y + dy;
        if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
        const nb = grid[ny]?.[nx];
        if (!nb || (nb.type !== 'PLAINS' && nb.type !== 'FOREST')) continue;
        if (hash3(n.tile.x + d * 7, n.tile.y + d * 5, 660) < 0.48) continue;

        const baseX = n.cx + dx * 22 + (hash3(n.tile.x, n.tile.y + d, 661) - 0.5) * 10;
        const baseY = n.cy + dy * 21 + (hash3(n.tile.x + d, n.tile.y, 662) - 0.5) * 8;
        const count = 2 + (hash3(n.tile.x + d, n.tile.y, 663) > 0.6 ? 1 : 0);
        for (let p = 0; p < count; p++) {
          const tx = baseX + (p - 0.5) * 6.5;
          const ty = baseY + (p % 2 === 0 ? -2 : 2.5);
          const pr = 4.0 + hash3(n.tile.x + p, n.tile.y + d, 664) * 1.8;
          drawPineCrown(ctx, tx + 1.5, ty + 1.8, pr, p + d, 7, 'rgba(10, 18, 14, 0.36)');
          drawPineCrown(ctx, tx, ty, pr, p + d, 7, '#194127');
          drawPineCrown(ctx, tx - 0.8, ty - 0.8, pr * 0.58, p + d + 0.3, 7, '#347442');
        }
      }
    }
  }
}

/** Renders an isolated single-tile mountain peak in one of 6 biome-aware hero styles. */
function drawLoneMountain(
  ctx: CanvasRenderingContext2D,
  node: MountainNode,
  gridSize: number,
): void {
  const px = node.x * TILE_SIZE;
  const py = node.y * TILE_SIZE;
  const t = node.tile;
  const variant = pickMountainVariant(t, node.isDesert, gridSize);
  const ox = (hash2(t.x, t.y) - 0.5) * 7;
  const oy = (hash2(t.y, t.x) - 0.5) * 5;

  // Tailored SE Cast Shadow
  ctx.fillStyle = node.isDesert ? 'rgba(42, 22, 12, 0.34)' : 'rgba(12, 18, 28, 0.36)';
  if (variant === 'DESERT_MESA') {
    ctx.beginPath();
    ctx.roundRect(px + 14, py + 16, 56, 52, 12);
    ctx.fill();
  } else if (variant === 'TWIN_RIDGE') {
    ctx.beginPath();
    ctx.moveTo(px + 22, py + 16);
    ctx.lineTo(px + 48, py + 14);
    ctx.lineTo(px + 74, py + 48);
    ctx.lineTo(px + 50, py + 72);
    ctx.lineTo(px + 10, py + 56);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(px + 32, py + 12);
    ctx.lineTo(px + 72, py + 48);
    ctx.lineTo(px + 48, py + 72);
    ctx.lineTo(px + 12, py + 56);
    ctx.closePath();
    ctx.fill();
  }

  if (variant === 'ALPINE_PEAK') {
    const peakX = px + 32 + ox;
    const peakY = py + 9 + oy;
    ctx.fillStyle = 'rgba(72, 82, 96, 0.45)';
    traceIrregularRockBlob(ctx, px + 32, py + 50, 27, 12, t.x, t.y, 9);
    ctx.fill();

    drawMassifSummit(ctx, { ...node, peakX, peakY, elevation: 0.72 }, false, false);
  } else if (variant === 'TWIN_RIDGE') {
    const p1X = px + 21 + ox * 0.5;
    const p1Y = py + 15 + oy * 0.5;
    const p2X = px + 43 + ox * 0.4;
    const p2Y = py + 8 + oy * 0.5;

    ctx.fillStyle = NATURE_PALETTE.rockLit;
    ctx.beginPath();
    ctx.moveTo(p1X, p1Y);
    ctx.lineTo(px + 4, py + 52);
    ctx.lineTo(px + 23, py + 55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = NATURE_PALETTE.rockMid;
    ctx.beginPath();
    ctx.moveTo(p1X, p1Y);
    ctx.lineTo(px + 23, py + 55);
    ctx.lineTo(px + 34, py + 46);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = NATURE_PALETTE.rockHigh;
    ctx.beginPath();
    ctx.moveTo(p2X, p2Y);
    ctx.lineTo(px + 21, py + 57);
    ctx.lineTo(px + 39, py + 59);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = NATURE_PALETTE.rockMid;
    ctx.beginPath();
    ctx.moveTo(p2X, p2Y);
    ctx.lineTo(px + 39, py + 59);
    ctx.lineTo(px + 50, py + 55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = NATURE_PALETTE.rockDark;
    ctx.beginPath();
    ctx.moveTo(p2X, p2Y);
    ctx.lineTo(px + 50, py + 55);
    ctx.lineTo(px + 60, py + 46);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = NATURE_PALETTE.snowCap;
    ctx.beginPath();
    ctx.moveTo(p1X, p1Y);
    ctx.lineTo(p1X - 6, p1Y + 11);
    ctx.lineTo(p1X + 4, p1Y + 10);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(p2X, p2Y);
    ctx.lineTo(p2X - 9, p2Y + 15);
    ctx.lineTo(p2X + 1, p2Y + 12);
    ctx.lineTo(p2X + 7, p2Y + 14);
    ctx.closePath();
    ctx.fill();
  } else if (variant === 'CRAG_SPIRE') {
    const peakX = px + 33 + ox;
    const peakY = py + 6 + oy * 0.6;
    ctx.fillStyle = '#8A96A8';
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(px + 14, py + 28);
    ctx.lineTo(px + 6, py + 52);
    ctx.lineTo(px + 26, py + 58);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#525E70';
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(px + 26, py + 58);
    ctx.lineTo(px + 42, py + 56);
    ctx.lineTo(px + 46, py + 32);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2B3442';
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(px + 46, py + 32);
    ctx.lineTo(px + 42, py + 56);
    ctx.lineTo(px + 58, py + 47);
    ctx.lineTo(px + 52, py + 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#798598';
    ctx.beginPath();
    ctx.moveTo(px + 15, py + 26);
    ctx.lineTo(px + 6, py + 52);
    ctx.lineTo(px + 21, py + 53);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(229, 238, 248, 0.78)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(peakX, peakY + 1);
    ctx.lineTo(peakX - 7, peakY + 14);
    ctx.moveTo(peakX, peakY + 2);
    ctx.lineTo(peakX + 3, peakY + 11);
    ctx.stroke();
  } else if (variant === 'HIGHLAND_PINE') {
    const peakX = px + 32 + ox * 0.7;
    const peakY = py + 11 + oy * 0.6;
    drawMassifSummit(ctx, { ...node, peakX, peakY, elevation: 0.6 }, false, false);
    const pines = [
      { cx: px + 14, cy: py + 49, r: 6.2 },
      { cx: px + 24, cy: py + 53, r: 5.4 },
      { cx: px + 48, cy: py + 48, r: 5.8 },
    ];
    for (let i = 0; i < pines.length; i++) {
      const p = pines[i];
      drawPineCrown(ctx, p.cx + 1.5, p.cy + 2, p.r, i, 7, 'rgba(10, 20, 14, 0.4)');
      drawPineCrown(ctx, p.cx, p.cy, p.r, i, 7, '#1B4629');
      drawPineCrown(ctx, p.cx - 1, p.cy - 1, p.r * 0.62, i + 0.3, 7, '#347442');
    }
  } else if (variant === 'DESERT_MESA') {
    ctx.fillStyle = NATURE_PALETTE.mesaShadow;
    ctx.beginPath();
    ctx.moveTo(px + 12, py + 15);
    ctx.lineTo(px + 52, py + 13);
    ctx.lineTo(px + 60, py + 48);
    ctx.lineTo(px + 46, py + 59);
    ctx.lineTo(px + 8, py + 54);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = NATURE_PALETTE.mesaDark;
    ctx.beginPath();
    ctx.moveTo(px + 12, py + 14);
    ctx.lineTo(px + 51, py + 13);
    ctx.lineTo(px + 56, py + 44);
    ctx.lineTo(px + 44, py + 54);
    ctx.lineTo(px + 10, py + 49);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = NATURE_PALETTE.mesaMid;
    ctx.beginPath();
    ctx.moveTo(px + 12, py + 14);
    ctx.lineTo(px + 50, py + 13);
    ctx.lineTo(px + 38, py + 46);
    ctx.lineTo(px + 10, py + 48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = NATURE_PALETTE.mesaLit;
    ctx.beginPath();
    ctx.moveTo(px + 16, py + 16);
    ctx.lineTo(px + 46, py + 15);
    ctx.lineTo(px + 50, py + 31);
    ctx.lineTo(px + 39, py + 40);
    ctx.lineTo(px + 17, py + 36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 224, 184, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px + 17, py + 35);
    ctx.lineTo(px + 16, py + 16);
    ctx.lineTo(px + 46, py + 15);
    ctx.stroke();
  } else {
    // DESERT_BUTTE
    const peakX = px + 34 + ox * 0.7;
    const peakY = py + 9 + oy * 0.6;
    ctx.fillStyle = 'rgba(148, 84, 44, 0.42)';
    traceIrregularRockBlob(ctx, px + 32, py + 50, 26, 11, t.x, t.y, 9);
    ctx.fill();
    drawMassifSummit(ctx, { ...node, peakX, peakY, elevation: 0.7 }, true, false);
  }
}

/**
 * Pass D2: Realistic Irregular Mountain Ranges & Lone Peaks.
 * - Connected 8-way clusters (2+ tiles) render as unified geological massifs with organic rocky aprons,
 *   sweeping cast shadows, kinked 3D-lit spine ridges, multi-faceted summits, glacial snow cornices / desert mesas,
 *   and miniature alpine foothill pines for scale.
 * - Isolated single mountain tiles render in 6 distinct biome-aware silhouettes.
 */
export function drawMountains(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
): void {
  const clusters = findMountainClusters(grid, canonicalGrid, gridSize);
  if (clusters.length === 0) return;

  // Render multi-tile ranges and lone peaks in North-to-South order for clean overlap
  clusters.sort((a, b) => {
    const ay = a.nodes.reduce((m, n) => Math.min(m, n.peakY), Infinity);
    const by = b.nodes.reduce((m, n) => Math.min(m, n.peakY), Infinity);
    return ay - by;
  });

  for (const cluster of clusters) {
    if (cluster.nodes.length >= 2) {
      drawUnifiedMountainRange(ctx, cluster, grid, gridSize);
    } else {
      drawLoneMountain(ctx, cluster.nodes[0], gridSize);
    }
  }
}

interface TreeDrawItem {
  cx: number;
  cy: number;
  r: number;
  variant: ForestVariant;
  seed: number;
  colorPick: number;
  isStandalone: boolean;
}

/** Helper: draw a draping silvery-teal weeping willow crown. */
function drawWillowCrown(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
): void {
  const fronds = 10;
  ctx.fillStyle = '#1E524B';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < fronds; i++) {
    const a = seed * Math.PI * 2 + (i * Math.PI * 2) / fronds;
    const len = r * (0.94 + (i % 2) * 0.14);
    const tx = cx + Math.cos(a) * len;
    const ty = cy + Math.sin(a) * len;
    const isLit = Math.cos(a + Math.PI * 0.75) > -0.1;
    ctx.strokeStyle = isLit ? '#6BC2B0' : '#337A6F';
    ctx.lineWidth = r * 0.24;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a + 0.18) * len * 0.55, cy + Math.sin(a + 0.18) * len * 0.55, tx, ty);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#B5EDE1';
  ctx.beginPath();
  ctx.arc(cx - r * 0.18, cy - r * 0.18, r * 0.30, 0, Math.PI * 2);
  ctx.fill();
}

/** Helper: draw a desert savanna umbrella acacia canopy (alternate to oasis palms). */
function drawAcaciaTree(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
): void {
  drawFoliageCrown(ctx, cx, cy, r * 0.96, seed, '#3D5A27', '#628738', '#8EB049', '#BED46C');
}

/** Picks a harmonious tree species for an individual tree inside a themed 4–6 tile Forest Grove. */
function pickTreeSpeciesInGrove(theme: GroveTheme, roll: number): ForestVariant {
  if (theme === 'DESERT_OASIS') return 'DESERT_OASIS';
  if (theme === 'AUTUMN_RESERVE') {
    if (roll < 0.34) return 'GOLDEN_BIRCH';
    if (roll < 0.64) return 'CRIMSON_MAPLE';
    if (roll < 0.86) return 'BROADLEAF_OAK';
    return 'CONIFER_PINE';
  }
  if (theme === 'ALPINE_TIMBER') {
    if (roll < 0.58) return 'CONIFER_PINE';
    if (roll < 0.78) return 'BROADLEAF_OAK';
    if (roll < 0.92) return 'GOLDEN_BIRCH';
    return 'RIVERSIDE_WILLOW';
  }
  if (theme === 'SPRING_GLADE') {
    if (roll < 0.42) return 'BROADLEAF_OAK';
    if (roll < 0.72) return 'SAKURA_BLOSSOM';
    if (roll < 0.88) return 'GOLDEN_BIRCH';
    return 'RIVERSIDE_WILLOW';
  }
  // EMERALD_DEEPWOOD
  if (roll < 0.52) return 'BROADLEAF_OAK';
  if (roll < 0.78) return 'CONIFER_PINE';
  if (roll < 0.90) return 'GOLDEN_BIRCH';
  return 'CRIMSON_MAPLE';
}

/**
 * Pass D3: 7-Species Multi-Color Trees with Distinct 4–6 Tile Cohesive Forest Groves vs.
 * Sculptural Individual Standalone Specimen Trees.
 */
export function drawForests(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
): void {
  const clusters = classifyForestClusters(grid, canonicalGrid, gridSize);
  const trees: TreeDrawItem[] = [];

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const fTile = grid[y][x];
      if (!fTile || fTile.type !== 'FOREST') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const cluster = clusters.get(fTile.id);
      const isGrove = Boolean(cluster && cluster.size >= 3);
      const isDesert = cluster ? cluster.isDesert : isDesertNeighborhood(fTile, canonicalGrid, gridSize);
      const isNearWater = isWaterNeighborhood(fTile, canonicalGrid, gridSize);

      if (isGrove && cluster) {
        // Cohesive 4–6 tile Forest Grove: rich connected mossy woodland floor bridging all tiles
        const fN = grid[y - 1]?.[x]?.type === 'FOREST';
        const fS = grid[y + 1]?.[x]?.type === 'FOREST';
        const fW = grid[y]?.[x - 1]?.type === 'FOREST';
        const fE = grid[y]?.[x + 1]?.type === 'FOREST';

        ctx.fillStyle =
          cluster.theme === 'DESERT_OASIS'
            ? 'rgba(78, 126, 58, 0.40)'
            : cluster.theme === 'AUTUMN_RESERVE'
              ? 'rgba(72, 54, 24, 0.36)'
              : cluster.theme === 'SPRING_GLADE'
                ? 'rgba(42, 74, 38, 0.34)'
                : 'rgba(18, 46, 22, 0.42)';
        ctx.beginPath();
        ctx.arc(px + 32, py + 32, 33, 0, Math.PI * 2);
        if (fE) ctx.arc(px + 58, py + 32, 26, 0, Math.PI * 2);
        if (fS) ctx.arc(px + 32, py + 58, 26, 0, Math.PI * 2);
        if (fW) ctx.arc(px + 6, py + 32, 26, 0, Math.PI * 2);
        if (fN) ctx.arc(px + 32, py + 6, 26, 0, Math.PI * 2);
        ctx.fill();

        // Subtle desert oasis water glint or woodland fallen mossy log inside deep groves
        if (cluster.theme === 'DESERT_OASIS' && hash3(fTile.x, fTile.y, 265) > 0.55) {
          ctx.fillStyle = 'rgba(43, 148, 168, 0.52)';
          ctx.beginPath();
          ctx.ellipse(px + 32, py + 34, 15, 10, hash3(fTile.x, fTile.y, 266) * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        } else if (cluster.theme !== 'DESERT_OASIS' && hash3(fTile.x, fTile.y, 260) > 0.52) {
          const lx = px + 18 + hash3(fTile.x, fTile.y, 261) * 26;
          const ly = py + 22 + hash3(fTile.x, fTile.y, 262) * 20;
          const la = (hash3(fTile.x, fTile.y, 263) - 0.5) * 1.4;
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(la);
          ctx.fillStyle = '#583E28';
          ctx.beginPath();
          ctx.roundRect(-10, -2.2, 20, 4.4, 2);
          ctx.fill();
          ctx.fillStyle = '#856444';
          ctx.fillRect(-8, -1.5, 16, 1.4);
          ctx.restore();
        }

        // Dense overlapping multi-species forest canopies (5–6 crowns per tile -> true deep forest feel!)
        const count = cluster.theme === 'DESERT_OASIS' ? 4 : 5;
        for (let i = 0; i < count; i++) {
          const rx = hash3(fTile.x * 7 + i, fTile.y * 13, 270);
          const ry = hash3(fTile.x * 19, fTile.y * 5 + i, 271);
          const speciesRoll = hash3(fTile.x * 5 + i * 3, fTile.y * 11 + i, 274);
          const species = pickTreeSpeciesInGrove(cluster.theme, speciesRoll);
          const big = i === 0;
          trees.push({
            cx: px + (big ? 24 + rx * 16 : 6 + rx * 52),
            cy: py + (big ? 24 + ry * 16 : 6 + ry * 52),
            r: big ? 15.5 + rx * 4.2 : 10.5 + ry * 5.8,
            variant: species,
            seed: hash3(fTile.x + i * 3, fTile.y + i * 7, 272),
            colorPick: hash3(fTile.x * 3 + i, fTile.y * 7, 273),
            isStandalone: false,
          });
        }
      } else {
        // Individual Standalone Specimen Tree: crisp organic grass base + 1 hero sculptural tree (+ occasional sapling!)
        const variant = pickForestVariant(fTile, isDesert, gridSize, isNearWater);
        const ox = (hash3(fTile.x, fTile.y, 286) - 0.5) * 10;
        const oy = (hash3(fTile.x, fTile.y, 287) - 0.5) * 10;
        const heroX = px + 32 + ox;
        const heroY = py + 31 + oy;

        // Subtle soft ground shade ring beneath the standalone tree
        ctx.fillStyle = isDesert ? 'rgba(92, 108, 52, 0.24)' : 'rgba(22, 46, 20, 0.22)';
        ctx.beginPath();
        ctx.ellipse(heroX, heroY + 2, 22, 18, 0, 0, Math.PI * 2);
        ctx.fill();

        // Peeking warm tree trunk anchor at base
        ctx.fillStyle = '#5C3D24';
        ctx.beginPath();
        ctx.ellipse(heroX + 2.5, heroY + 11, 3.6, 5.2, -0.2, 0, Math.PI * 2);
        ctx.fill();

        const heroR = variant === 'DESERT_OASIS' ? 19 : 17.5 + hash3(fTile.x, fTile.y, 288) * 3.5;
        trees.push({
          cx: heroX,
          cy: heroY,
          r: heroR,
          variant,
          seed: hash3(fTile.x * 5, fTile.y * 7, 289),
          colorPick: hash3(fTile.x * 9, fTile.y * 3, 290),
          isStandalone: true,
        });

        // 42% of standalone tiles pair the hero tree with 1 charming smaller companion sapling
        if (hash3(fTile.x, fTile.y, 291) > 0.58 && gridSize > 1) {
          const sa = hash3(fTile.x, fTile.y, 292) * Math.PI * 2;
          const sx = Math.max(px + 12, Math.min(px + 52, heroX + Math.cos(sa) * 18));
          const sy = Math.max(py + 12, Math.min(py + 52, heroY + Math.sin(sa) * 16));
          trees.push({
            cx: sx,
            cy: sy,
            r: 8.5 + hash3(fTile.x, fTile.y, 293) * 3.0,
            variant,
            seed: hash3(fTile.x + 3, fTile.y + 5, 294),
            colorPick: hash3(fTile.x + 7, fTile.y + 1, 295),
            isStandalone: true,
          });
        }
      }
    }
  }

  // Pass 1: Unified SE cast shadows beneath all canopies
  for (const tr of trees) {
    const shX = tr.isStandalone ? 7.5 : 6.2;
    const shY = tr.isStandalone ? 8.5 : 7.2;
    if (tr.variant === 'CONIFER_PINE') {
      drawPineCrown(ctx, tr.cx + shX, tr.cy + shY, tr.r * 0.94, tr.seed * Math.PI, 8, 'rgba(10, 20, 15, 0.36)');
    } else if (tr.variant === 'DESERT_OASIS') {
      ctx.fillStyle = 'rgba(42, 34, 18, 0.28)';
      ctx.beginPath();
      ctx.ellipse(tr.cx + shX, tr.cy + shY, tr.r * 0.86, tr.r * 0.72, tr.seed, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(12, 22, 16, 0.34)';
      ctx.beginPath();
      ctx.arc(tr.cx + shX, tr.cy + shY, tr.r * 0.92, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Pass 2: Layered 7-species colorful canopies (sorted slightly by radius so big crowns overlap saplings nicely)
  for (const tr of trees) {
    if (tr.variant === 'CONIFER_PINE') {
      // Blue-Spruce / Alpine Pine Conifer
      const rot = tr.seed * Math.PI * 2;
      const isBlueSpruce = tr.colorPick > 0.45;
      drawPineCrown(ctx, tr.cx, tr.cy, tr.r, rot, 8, isBlueSpruce ? '#113A2F' : '#143822');
      drawPineCrown(ctx, tr.cx - 1.3, tr.cy - 1.3, tr.r * 0.75, rot + 0.35, 7, isBlueSpruce ? '#1F6351' : '#236339');
      drawPineCrown(ctx, tr.cx - 2.4, tr.cy - 2.4, tr.r * 0.46, rot + 0.7, 6, isBlueSpruce ? '#3E967B' : '#459457');
      ctx.fillStyle = isBlueSpruce ? '#88D8BC' : '#82CB89';
      ctx.beginPath();
      ctx.arc(tr.cx - 2.8, tr.cy - 2.8, tr.r * 0.15, 0, Math.PI * 2);
      ctx.fill();
    } else if (tr.variant === 'DESERT_OASIS') {
      if (tr.colorPick > 0.65) {
        drawAcaciaTree(ctx, tr.cx, tr.cy, tr.r, tr.seed);
      } else {
        drawPalmTree(ctx, tr.cx, tr.cy, tr.r, tr.seed);
      }
    } else if (tr.variant === 'RIVERSIDE_WILLOW') {
      drawWillowCrown(ctx, tr.cx, tr.cy, tr.r, tr.seed);
    } else if (tr.variant === 'GOLDEN_BIRCH') {
      // Natural Warm Golden-Ochre Birch (earthy honey-amber foliage, zero neon!)
      drawFoliageCrown(ctx, tr.cx, tr.cy, tr.r, tr.seed, '#6F4A16', '#A87922', '#D9AA3C', '#F2D679');
    } else if (tr.variant === 'CRIMSON_MAPLE') {
      // Natural Autumn Russet & Scarlet Maple
      drawFoliageCrown(ctx, tr.cx, tr.cy, tr.r, tr.seed, '#5D2419', '#993C24', '#CC5C30', '#E8925A');
    } else if (tr.variant === 'SAKURA_BLOSSOM') {
      // Natural Dusty-Rose Spring Cherry Blossom
      drawFoliageCrown(ctx, tr.cx, tr.cy, tr.r, tr.seed, '#733B53', '#B0617F', '#DE93B0', '#F7D5E4');
      if (tr.isStandalone && tr.r > 13) {
        ctx.fillStyle = 'rgba(247, 213, 228, 0.72)';
        ctx.beginPath();
        ctx.arc(tr.cx + tr.r * 0.85, tr.cy + tr.r * 0.65, 1.4, 0, Math.PI * 2);
        ctx.arc(tr.cx - tr.r * 0.72, tr.cy + tr.r * 0.78, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // BROADLEAF_OAK: Vibrant Emerald / Spring-Lime Woodland Oak
      const isSpringLime = tr.colorPick > 0.52;
      drawFoliageCrown(
        ctx,
        tr.cx,
        tr.cy,
        tr.r,
        tr.seed,
        isSpringLime ? '#245824' : '#1A4722',
        isSpringLime ? '#438A38' : '#2E6E35',
        isSpringLime ? '#74BA50' : '#509547',
        isSpringLime ? '#AEE078' : '#85C464',
      );
    }
  }
}
