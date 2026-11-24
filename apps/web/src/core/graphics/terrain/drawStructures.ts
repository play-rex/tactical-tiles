import { Tile } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { type BoardRotation } from '../../boardRotation';
import {
  BankVariant,
  hash3,
  isRoadLike,
  pickBankVariant,
  pickBarrierVariant,
  pickBridgeVariant,
  pickBunkerVariant,
  pickWatchtowerVariant,
} from './terrainVariants';

const FACTION_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#00ACC1'];

/** Pass C1: Auto-Connecting Asphalt ROADS with wear variation, cracks, and intersection markings. */
export function drawRoads(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
): void {
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
        if (t.type === 'ROAD_H') {
          rW = true;
          rE = true;
        } else {
          rN = true;
          rS = true;
        }
      }
      const connections = (rN ? 1 : 0) + (rS ? 1 : 0) + (rW ? 1 : 0) + (rE ? 1 : 0);

      // Gravel shoulder
      ctx.fillStyle = 'rgba(130, 122, 106, 0.68)';
      if (rN) ctx.fillRect(px + 13, py, 38, 32);
      if (rS) ctx.fillRect(px + 13, py + 32, 38, 32);
      if (rW) ctx.fillRect(px, py + 13, 32, 38);
      if (rE) ctx.fillRect(px + 32, py + 13, 32, 38);
      ctx.beginPath();
      ctx.arc(px + 32, py + 32, 19, 0, Math.PI * 2);
      ctx.fill();

      // Asphalt surface (slight per-tile weathering shade)
      const shadeShift = Math.floor((hash3(t.x, t.y, 310) - 0.5) * 8);
      ctx.fillStyle = `rgb(${66 + shadeShift}, ${73 + shadeShift}, ${86 + shadeShift})`;
      if (rN) ctx.fillRect(px + 17, py, 30, 32);
      if (rS) ctx.fillRect(px + 17, py + 32, 30, 32);
      if (rW) ctx.fillRect(px, py + 17, 32, 30);
      if (rE) ctx.fillRect(px + 32, py + 17, 32, 30);
      ctx.beginPath();
      ctx.arc(px + 32, py + 32, 15, 0, Math.PI * 2);
      ctx.fill();

      // Subtle worn tarmac patch or fine crack on ~45% of road tiles
      const wear = hash3(t.x, t.y, 312);
      if (wear > 0.55) {
        ctx.fillStyle = 'rgba(34, 39, 48, 0.35)';
        ctx.beginPath();
        ctx.roundRect(
          px + 22 + hash3(t.x, t.y, 313) * 10,
          py + 22 + hash3(t.x, t.y, 314) * 10,
          9,
          7,
          2,
        );
        ctx.fill();
      } else if (wear < 0.28) {
        ctx.strokeStyle = 'rgba(26, 30, 38, 0.52)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(px + 22, py + 28);
        ctx.lineTo(px + 28, py + 33);
        ctx.lineTo(px + 35, py + 31);
        ctx.stroke();
      }

      // Crisp intersection stop bars on 3-way and 4-way junctions
      if (connections >= 3) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.38)';
        if (rN) ctx.fillRect(px + 20, py + 12, 24, 2.5);
        if (rS) ctx.fillRect(px + 20, py + 49.5, 24, 2.5);
        if (rW) ctx.fillRect(px + 12, py + 20, 2.5, 24);
        if (rE) ctx.fillRect(px + 49.5, py + 20, 2.5, 24);
      }

      // Dashed highway centerline stripes
      ctx.strokeStyle = '#E2C044';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      if (rN) {
        ctx.moveTo(px + 32, py);
        ctx.lineTo(px + 32, py + 32);
      }
      if (rS) {
        ctx.moveTo(px + 32, py + 32);
        ctx.lineTo(px + 32, py + TILE_SIZE);
      }
      if (rW) {
        ctx.moveTo(px, py + 32);
        ctx.lineTo(px + 32, py + 32);
      }
      if (rE) {
        ctx.moveTo(px + 32, py + 32);
        ctx.lineTo(px + TILE_SIZE, py + 32);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Pass C2: 2 Bridge Architectures (Riveted Steel Truss & Concrete Highway Viaduct). */
export function drawBridges(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  gridSize: number,
  rotation: BoardRotation,
): void {
  const swapBridgeAxes = rotation === 90 || rotation === 270;
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t || (t.type !== 'BRIDGE' && t.type !== 'BRIDGE_V')) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      const isVertical = swapBridgeAxes ? t.type !== 'BRIDGE_V' : t.type === 'BRIDGE_V';
      const adjCanyon =
        grid[y - 1]?.[x]?.type === 'CANYON' ||
        grid[y + 1]?.[x]?.type === 'CANYON' ||
        grid[y]?.[x - 1]?.type === 'CANYON' ||
        grid[y]?.[x + 1]?.type === 'CANYON';
      const variant = pickBridgeVariant(t, adjCanyon, gridSize);

      ctx.save();
      if (isVertical) {
        ctx.translate(px + 32, py + 32);
        ctx.rotate(Math.PI / 2);
        ctx.translate(-32, -32);
      } else {
        ctx.translate(px, py);
      }

      // Shadow onto water/canyon below
      ctx.fillStyle = 'rgba(0, 10, 22, 0.44)';
      ctx.fillRect(0, 17, TILE_SIZE, 42);

      if (variant === 'CONCRETE_VIADUCT') {
        // Heavy Concrete Highway Viaduct (canyon / highway span)
        ctx.fillStyle = '#94A3B8';
        ctx.fillRect(0, 9, TILE_SIZE, 46);
        // Paved roadway deck
        ctx.fillStyle = '#47505E';
        ctx.fillRect(0, 15, TILE_SIZE, 34);
        // Concrete expansion joints
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(10, 15);
        ctx.lineTo(10, 49);
        ctx.moveTo(54, 15);
        ctx.lineTo(54, 49);
        ctx.stroke();
        // Dashed yellow road stripe
        ctx.strokeStyle = '#E2C044';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(2, 32);
        ctx.lineTo(TILE_SIZE - 2, 32);
        ctx.stroke();
        ctx.setLineDash([]);
        // Molded concrete side parapets with sunlit top rim
        ctx.fillStyle = '#CBD5E1';
        ctx.fillRect(0, 10, TILE_SIZE, 5);
        ctx.fillRect(0, 49, TILE_SIZE, 5);
        ctx.fillStyle = '#64748B';
        ctx.fillRect(0, 14, TILE_SIZE, 1.5);
        ctx.fillRect(0, 53, TILE_SIZE, 1.5);
        // Parapet support pillars
        ctx.fillStyle = '#E2E8F0';
        for (const bx of [6, 22, 42, 58]) {
          ctx.fillRect(bx - 2, 9, 4, 6);
          ctx.fillRect(bx - 2, 49, 4, 6);
        }
      } else {
        // Riveted Military Steel Truss Bridge
        ctx.fillStyle = '#858F9E';
        ctx.fillRect(0, 8, 8, 48);
        ctx.fillRect(TILE_SIZE - 8, 8, 8, 48);

        // Amber/black hazard strips on entry abutments
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(1, 10, 4, 6);
        ctx.fillRect(1, 48, 4, 6);
        ctx.fillRect(TILE_SIZE - 5, 10, 4, 6);
        ctx.fillRect(TILE_SIZE - 5, 48, 4, 6);

        // Steel roadway deck
        ctx.fillStyle = '#505967';
        ctx.fillRect(4, 14, TILE_SIZE - 8, 36);

        // Deck plate ribs
        ctx.strokeStyle = '#343A46';
        ctx.lineWidth = 1.4;
        for (let i = 10; i < TILE_SIZE - 6; i += 8) {
          ctx.beginPath();
          ctx.moveTo(i, 15);
          ctx.lineTo(i, 49);
          ctx.stroke();
        }

        // Subtle steel tire runner strips
        ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.fillRect(6, 21, TILE_SIZE - 12, 4);
        ctx.fillRect(6, 39, TILE_SIZE - 12, 4);

        // Riveted upper & lower steel trusses
        ctx.fillStyle = '#A0AAB9';
        ctx.fillRect(2, 10, TILE_SIZE - 4, 5);
        ctx.fillRect(2, 49, TILE_SIZE - 4, 5);
        ctx.fillStyle = '#475569';
        for (let r = 8; r < TILE_SIZE - 6; r += 10) {
          ctx.fillRect(r, 11.5, 2, 2);
          ctx.fillRect(r, 50.5, 2, 2);
        }
      }

      ctx.restore();
    }
  }
}

/** Pass C3: Blasted Mountain TUNNEL cuttings — excavated floor, rock walls, railed drive with dark portals. */
export function drawTunnels(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  canonicalGrid: (Tile | undefined)[][],
  gridSize: number,
  rotation: BoardRotation = 0,
): void {
  const swapTunnelAxes = rotation === 90 || rotation === 270;
  const isWall = (x: number, y: number): boolean => {
    const n = y >= 0 && y < gridSize && x >= 0 && x < gridSize ? canonicalGrid[y][x] : undefined;
    return !n || n.type === 'MOUNTAIN';
  };
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y]?.[x];
      if (!t || t.type !== 'TUNNEL') continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      // Portal axis comes from the canonical (unrotated) neighbors — like the bridge
      // type — then axis-swaps for 90/270 rotations, so portals stay glued to the gap.
      const openH = !isWall(t.x - 1, t.y) || !isWall(t.x + 1, t.y);
      const openV = !isWall(t.x, t.y - 1) || !isWall(t.x, t.y + 1);
      const vertical = swapTunnelAxes ? openH && !openV : openV && !openH;
      ctx.save();
      if (vertical) {
        ctx.translate(px + 32, py + 32);
        ctx.rotate(Math.PI / 2);
        ctx.translate(-32, -32);
      } else {
        ctx.translate(px, py);
      }
      // Excavated rock floor
      ctx.fillStyle = '#453B34';
      ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      // Blasted speckles (stable per tile)
      for (let i = 0; i < 42; i++) {
        const sx = Math.floor(hash3(t.x * 7 + i, t.y * 13 + i, 77) * 60) + 2;
        const sy = Math.floor(hash3(t.x * 11 + i, t.y * 5 + i, 78) * 60) + 2;
        ctx.fillStyle = i % 2 === 0 ? '#52463D' : '#332B26';
        ctx.fillRect(sx, sy, 2, 2);
      }
      // Rock walls top & bottom with sunlit inner rims
      ctx.fillStyle = '#2B2420';
      ctx.fillRect(0, 0, TILE_SIZE, 13);
      ctx.fillRect(0, 51, TILE_SIZE, 13);
      ctx.fillStyle = '#5A4E44';
      ctx.fillRect(0, 12, TILE_SIZE, 2);
      ctx.fillRect(0, 50, TILE_SIZE, 2);
      // Rock cracks on the walls
      ctx.strokeStyle = '#1B1512';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const cx = 8 + Math.floor(hash3(t.x * 3 + i, t.y * 9 + i, 79) * 48);
        ctx.beginPath();
        ctx.moveTo(cx, 2);
        ctx.lineTo(cx + 3, 7);
        ctx.lineTo(cx - 2, 11);
        ctx.stroke();
        const bx = 8 + Math.floor(hash3(t.x * 5 + i, t.y * 2 + i, 80) * 48);
        ctx.beginPath();
        ctx.moveTo(bx, 62);
        ctx.lineTo(bx + 3, 57);
        ctx.lineTo(bx - 2, 53);
        ctx.stroke();
      }
      // Mine-cart rails along the drive with timber sleepers
      ctx.fillStyle = '#4A3826';
      for (let sx = 4; sx < TILE_SIZE; sx += 9) {
        ctx.fillRect(sx, 24, 4, 18);
      }
      ctx.fillStyle = '#8A93A0';
      ctx.fillRect(0, 27, TILE_SIZE, 2.4);
      ctx.fillRect(0, 36, TILE_SIZE, 2.4);
      ctx.fillStyle = '#C7CEDA';
      ctx.fillRect(0, 27, TILE_SIZE, 1);
      ctx.fillRect(0, 36, TILE_SIZE, 1);
      // Dark portal mouths left & right (tunnel continues into the rock)
      ctx.fillStyle = '#0A0C10';
      ctx.fillRect(0, 14, 8, 38);
      ctx.fillRect(TILE_SIZE - 8, 14, 8, 38);
      // Timber portal frames
      ctx.fillStyle = '#6B4A2F';
      ctx.fillRect(8, 14, 3, 38);
      ctx.fillRect(TILE_SIZE - 11, 14, 3, 38);
      ctx.fillRect(8, 12, TILE_SIZE - 16, 3);
      ctx.fillRect(8, 51, TILE_SIZE - 16, 3);
      ctx.fillStyle = '#9C7043';
      ctx.fillRect(8, 12, TILE_SIZE - 16, 1.2);
      // Amber work lamps on both rock walls with soft glow
      const lamp = (lx: number, ly: number): void => {
        const g = ctx.createRadialGradient(lx, ly, 0.5, lx, ly, 9);
        g.addColorStop(0, 'rgba(245, 185, 66, 0.85)');
        g.addColorStop(1, 'rgba(245, 185, 66, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - 9, ly - 9, 18, 18);
        ctx.fillStyle = '#F5B942';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
        ctx.fill();
      };
      lamp(20, 7);
      lamp(44, 7);
      lamp(20, 57);
      lamp(44, 57);
      ctx.restore();
    }
  }
}

/** Draws one of 4 distinct architectural Bank Vault styles (intact + breached/looted states). */
function drawBankVariant(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  variant: BankVariant,
  isLooted: boolean,
): void {
  const cx = px + 32;
  const cy = py + 32;

  // Ground drop shadow
  ctx.fillStyle = 'rgba(10, 16, 24, 0.46)';
  ctx.beginPath();
  ctx.roundRect(px + 10, py + 13, 50, 48, 9);
  ctx.fill();

  if (variant === 'BULLION_ROTUNDA') {
    // 1. Central Bullion Rotunda: marble colonnade + ribbed golden dome vault
    ctx.fillStyle = isLooted ? '#475569' : '#CBD5E1';
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(px + 6, py + 6, 52, 52, 8);
    ctx.fill();
    ctx.stroke();

    // Inner stone plaza floor
    ctx.fillStyle = isLooted ? '#1E293B' : '#475569';
    ctx.beginPath();
    ctx.roundRect(px + 11, py + 11, 42, 42, 6);
    ctx.fill();

    // 4 Corner laser-turret pedestals
    const corners = [
      [px + 11, py + 11],
      [px + 53, py + 11],
      [px + 11, py + 53],
      [px + 53, py + 53],
    ];
    for (const [kx, ky] of corners) {
      ctx.fillStyle = isLooted ? '#334155' : '#94A3B8';
      ctx.beginPath();
      ctx.arc(kx, ky, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = isLooted ? '#0F172A' : '#F59E0B';
      ctx.beginPath();
      ctx.arc(kx, ky, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Circular colonnade drum
    ctx.fillStyle = isLooted ? '#334155' : '#E2E8F0';
    ctx.beginPath();
    ctx.arc(cx, cy, 19, 0, Math.PI * 2);
    ctx.fill();

    // Central ribbed dome
    if (isLooted) {
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Scorch fissures
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 6);
      ctx.lineTo(cx + 8, cy + 7);
      ctx.moveTo(cx + 6, cy - 9);
      ctx.lineTo(cx - 7, cy + 9);
      ctx.stroke();
    } else {
      const domeGrad = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, 16);
      domeGrad.addColorStop(0, '#FEF08A');
      domeGrad.addColorStop(0.55, '#F59E0B');
      domeGrad.addColorStop(1, '#92400E');
      ctx.fillStyle = domeGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 15, 0, Math.PI * 2);
      ctx.fill();

      // Radial dome ribs
      ctx.strokeStyle = 'rgba(120, 53, 15, 0.55)';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15);
        ctx.stroke();
      }
      // Golden finial crown
      ctx.fillStyle = '#FFFBEB';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === 'RESERVE_VAULT') {
    // 2. Fortified Reserve Vault: chamfered steel fortress + massive spoked vault door wheel
    ctx.fillStyle = isLooted ? '#334155' : '#64748B';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(px + 13, py + 5);
    ctx.lineTo(px + 51, py + 5);
    ctx.lineTo(px + 59, py + 13);
    ctx.lineTo(px + 59, py + 51);
    ctx.lineTo(px + 51, py + 59);
    ctx.lineTo(px + 13, py + 59);
    ctx.lineTo(px + 5, py + 51);
    ctx.lineTo(px + 5, py + 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner armored vault plate
    ctx.fillStyle = isLooted ? '#1E293B' : '#334155';
    ctx.beginPath();
    ctx.roundRect(px + 11, py + 11, 42, 42, 5);
    ctx.fill();

    // Twin recessed gold bullion skylight bars on top & bottom edges
    ctx.fillStyle = isLooted ? '#475569' : '#FBBF24';
    ctx.fillRect(px + 19, py + 8, 26, 3.2);
    ctx.fillRect(px + 19, py + 52.8, 26, 3.2);

    if (isLooted) {
      // Dark breached vault shaft + blown door resting off-center
      ctx.fillStyle = '#090D16';
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx + 6, cy + 5, 10, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Heavy steel & gold vault door bezel
      ctx.fillStyle = '#94A3B8';
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.arc(cx, cy, 12.5, 0, Math.PI * 2);
      ctx.fill();

      // Bright golden locking wheel + 6 spokes
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
        ctx.stroke();
      }
      ctx.fillStyle = '#FEF08A';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === 'TREASURY_CITADEL') {
    // 3. Imperial Treasury Citadel: stepped dark-basalt & gold-trimmed pyramid vault
    ctx.fillStyle = isLooted ? '#334155' : '#475569';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.6;
    ctx.fillRect(px + 6, py + 6, 52, 52);
    ctx.strokeRect(px + 6, py + 6, 52, 52);

    // 4-plane stepped pyramid roof (NW sunlit / SE shaded)
    const tiers = [
      { inset: 10, lit: isLooted ? '#475569' : '#64748B', dark: isLooted ? '#1E293B' : '#334155', trim: isLooted ? '#475569' : '#D97706' },
      { inset: 17, lit: isLooted ? '#334155' : '#94A3B8', dark: isLooted ? '#0F172A' : '#475569', trim: isLooted ? '#64748B' : '#FBBF24' },
    ];
    for (const tier of tiers) {
      const i = tier.inset;
      // Lit NW half
      ctx.fillStyle = tier.lit;
      ctx.beginPath();
      ctx.moveTo(px + i, py + i);
      ctx.lineTo(px + TILE_SIZE - i, py + i);
      ctx.lineTo(px + i, py + TILE_SIZE - i);
      ctx.closePath();
      ctx.fill();
      // Shaded SE half
      ctx.fillStyle = tier.dark;
      ctx.beginPath();
      ctx.moveTo(px + TILE_SIZE - i, py + i);
      ctx.lineTo(px + TILE_SIZE - i, py + TILE_SIZE - i);
      ctx.lineTo(px + i, py + TILE_SIZE - i);
      ctx.closePath();
      ctx.fill();
      // Gold cornice border
      ctx.strokeStyle = tier.trim;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(px + i, py + i, TILE_SIZE - i * 2, TILE_SIZE - i * 2);
    }

    // Center treasury skylight crest
    if (isLooted) {
      ctx.fillStyle = '#0B1120';
      ctx.fillRect(px + 23, py + 23, 18, 18);
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(px + 23, py + 23, 18, 18);
    } else {
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.moveTo(cx, py + 20);
      ctx.lineTo(px + 44, cy);
      ctx.lineTo(cx, py + 44);
      ctx.lineTo(px + 20, cy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FEF08A';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 4. Armored Trade Exchange / Helipad Bullion Depot
    ctx.fillStyle = isLooted ? '#334155' : '#526072';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(px + 5, py + 7, 54, 50, 7);
    ctx.fill();
    ctx.stroke();

    // Recessed armored rooftop deck
    ctx.fillStyle = isLooted ? '#1E293B' : '#263244';
    ctx.beginPath();
    ctx.roundRect(px + 10, py + 11, 44, 42, 4);
    ctx.fill();

    // Armored side blast shutter vents
    ctx.fillStyle = '#111827';
    for (let v = 0; v < 3; v++) {
      ctx.fillRect(px + 13, py + 14 + v * 14, 4, 8);
      ctx.fillRect(px + 47, py + 14 + v * 14, 4, 8);
    }

    // Gold-ringed bullion vault helipad centerpiece
    ctx.strokeStyle = isLooted ? '#64748B' : '#FACC15';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    if (isLooted) {
      ctx.fillStyle = '#090D16';
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy - 7);
      ctx.lineTo(cx + 7, cy + 7);
      ctx.stroke();
    } else {
      // Crisp golden vault bar emblem inside pad
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(cx - 6, cy - 7, 3, 14);
      ctx.fillRect(cx + 3, cy - 7, 3, 14);
      ctx.fillRect(cx - 6, cy - 1.5, 12, 3);
      // Corner amber approach beacons
      ctx.fillStyle = '#FEF08A';
      ctx.fillRect(px + 11, py + 11, 3, 3);
      ctx.fillRect(px + 50, py + 11, 3, 3);
      ctx.fillRect(px + 11, py + 50, 3, 3);
      ctx.fillRect(px + 50, py + 50, 3, 3);
    }
  }
}

/** Pass E: Military Structures (Varied BARRIERS, WATCHTOWERS, BUNKERS, BANK VAULTS, FORTIFIED BASES). */
export function drawStructures(
  ctx: CanvasRenderingContext2D,
  grid: (Tile | undefined)[][],
  mapData: Tile[],
  gridSize: number,
): void {
  // Precompute canonical Bank ordering & map-level seed offset so bank variants are guaranteed distinct & rotation-invariant
  const canonicalBanks = mapData
    .filter(t => t.type === 'BANK')
    .sort((a, b) => a.y * gridSize + a.x - (b.y * gridSize + b.x));
  const bankIndexById = new Map<string, number>();
  canonicalBanks.forEach((b, idx) => bankIndexById.set(b.id, idx));
  const bankSeedOffset =
    canonicalBanks.length > 0
      ? Math.floor(hash3(canonicalBanks[0].x, canonicalBanks[0].y, 333) * 4)
      : 0;

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = grid[y][x];
      if (!t) continue;
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;

      if (t.type === 'BARRIER') {
        const variant = pickBarrierVariant(t, gridSize);
        const adjBarV =
          grid[y - 1]?.[x]?.type === 'BARRIER' || grid[y + 1]?.[x]?.type === 'BARRIER';
        const adjBarH =
          grid[y]?.[x - 1]?.type === 'BARRIER' || grid[y]?.[x + 1]?.type === 'BARRIER';
        const roadH =
          isRoadLike(grid[y]?.[x - 1]) || isRoadLike(grid[y]?.[x + 1]);
        const verticalAlign = (adjBarV && !adjBarH) || (!adjBarH && roadH);

        ctx.save();
        if (verticalAlign) {
          ctx.translate(px + 32, py + 32);
          ctx.rotate(Math.PI / 2);
          ctx.translate(-32, -32);
        } else {
          ctx.translate(px, py);
        }

        if (variant === 'JERSEY_BLOCKS') {
          ctx.fillStyle = 'rgba(10, 14, 20, 0.42)';
          ctx.fillRect(10, 18, 48, 36);
          // Concrete Jersey Barriers
          ctx.fillStyle = '#56606E';
          ctx.fillRect(8, 13, 48, 13);
          ctx.fillRect(8, 38, 48, 13);
          ctx.fillStyle = '#8B95A5';
          ctx.fillRect(9, 14, 46, 3.5);
          ctx.fillRect(9, 39, 46, 3.5);
          // Hazard stripes
          ctx.fillStyle = '#F59E0B';
          ctx.fillRect(12, 17, 9, 7);
          ctx.fillRect(28, 17, 9, 7);
          ctx.fillRect(44, 17, 8, 7);
          ctx.fillRect(12, 42, 9, 7);
          ctx.fillRect(28, 42, 9, 7);
          ctx.fillRect(44, 42, 8, 7);
        } else if (variant === 'CZECH_HEDGEHOGS') {
          // 3 Steel Anti-Tank X-Hedgehogs + Coiled Razor Wire
          ctx.strokeStyle = 'rgba(203, 213, 225, 0.55)';
          ctx.lineWidth = 1.2;
          for (let w = 10; w <= 54; w += 7) {
            ctx.beginPath();
            ctx.arc(w, 32, 6, 0, Math.PI * 2);
            ctx.stroke();
          }
          const spots = [15, 32, 49];
          for (const sx of spots) {
            // Cast shadow
            ctx.strokeStyle = 'rgba(10, 14, 20, 0.45)';
            ctx.lineWidth = 4.5;
            ctx.beginPath();
            ctx.moveTo(sx - 6, 25);
            ctx.lineTo(sx + 10, 41);
            ctx.moveTo(sx + 10, 25);
            ctx.lineTo(sx - 6, 41);
            ctx.stroke();
            // Dark steel girders
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 4.2;
            ctx.beginPath();
            ctx.moveTo(sx - 8, 22);
            ctx.lineTo(sx + 8, 38);
            ctx.moveTo(sx + 8, 22);
            ctx.lineTo(sx - 8, 38);
            ctx.stroke();
            // Sunlit steel highlight
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(sx - 7, 22);
            ctx.lineTo(sx + 7, 36);
            ctx.moveTo(sx + 7, 22);
            ctx.lineTo(sx - 7, 36);
            ctx.stroke();
            // Center rivet bolt
            ctx.fillStyle = '#F59E0B';
            ctx.beginPath();
            ctx.arc(sx, 30, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          // DRAGONS_TEETH: Reinforced Concrete Tank-Trap Pyramids + Sandbag Rear Bolster
          ctx.fillStyle = 'rgba(10, 14, 20, 0.4)';
          ctx.fillRect(8, 16, 50, 36);
          // Olive sandbag rear wall
          for (let bx = 10; bx <= 46; bx += 11) {
            ctx.fillStyle = '#6E6648';
            ctx.beginPath();
            ctx.roundRect(bx, 39, 10, 10, 3);
            ctx.fill();
            ctx.fillStyle = '#928862';
            ctx.beginPath();
            ctx.roundRect(bx + 1, 40, 8, 4, 2);
            ctx.fill();
          }
          // 3 Sloped concrete Dragon's Teeth pyramids
          for (const tx of [16, 32, 48]) {
            ctx.fillStyle = '#94A3B8';
            ctx.beginPath();
            ctx.moveTo(tx, 14);
            ctx.lineTo(tx - 8, 34);
            ctx.lineTo(tx, 34);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.moveTo(tx, 14);
            ctx.lineTo(tx + 8, 34);
            ctx.lineTo(tx, 34);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#E2E8F0';
            ctx.fillRect(tx - 1.5, 14, 3, 3);
          }
        }
        ctx.restore();
      } else if (t.type === 'BUILDING') {
        if (t.subType === 'BUNKER') {
          const variant = pickBunkerVariant(t, gridSize);
          if (variant === 'CONCRETE_PILLBOX') {
            // 1. Reinforced Concrete Pillbox Bunker
            ctx.fillStyle = 'rgba(10, 16, 24, 0.46)';
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
            // Roof hatch & vent
            ctx.fillStyle = '#94A3B8';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#1E293B';
            ctx.lineWidth = 1.4;
            ctx.stroke();
          } else if (variant === 'HEX_CASEMATE') {
            // 2. Hexagonal Armored Casemate with Camo Tarp Corner
            ctx.fillStyle = 'rgba(10, 16, 24, 0.48)';
            ctx.beginPath();
            ctx.arc(px + 35, py + 36, 25, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#475569';
            ctx.strokeStyle = '#1E293B';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (i * Math.PI) / 3 + Math.PI / 6;
              const hx = px + 32 + Math.cos(a) * 25;
              const hy = py + 32 + Math.sin(a) * 25;
              if (i === 0) ctx.moveTo(hx, hy);
              else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#64748B';
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
              const a = (i * Math.PI) / 3 + Math.PI / 6;
              const hx = px + 32 + Math.cos(a) * 18;
              const hy = py + 32 + Math.sin(a) * 18;
              if (i === 0) ctx.moveTo(hx, hy);
              else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.fill();

            // Dark blast slits
            ctx.fillStyle = '#0F172A';
            ctx.fillRect(px + 22, py + 15, 20, 4);
            ctx.fillRect(px + 22, py + 45, 20, 4);

            // Drab olive camo net draped over NW corner
            ctx.fillStyle = 'rgba(63, 98, 48, 0.88)';
            ctx.beginPath();
            ctx.moveTo(px + 12, py + 18);
            ctx.lineTo(px + 32, py + 12);
            ctx.lineTo(px + 28, py + 31);
            ctx.lineTo(px + 12, py + 34);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(101, 134, 68, 0.72)';
            ctx.fillRect(px + 16, py + 19, 8, 5);
          } else {
            // 3. Sandbagged Earth-Berm Trench Bunker
            ctx.fillStyle = 'rgba(14, 18, 12, 0.42)';
            ctx.beginPath();
            ctx.arc(px + 34, py + 35, 26, 0, Math.PI * 2);
            ctx.fill();
            // Earth berm mound
            ctx.fillStyle = '#5C533D';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 26, 0, Math.PI * 2);
            ctx.fill();
            // Ring of sandbags
            for (let i = 0; i < 10; i++) {
              const a = (i * Math.PI * 2) / 10;
              const sx = px + 32 + Math.cos(a) * 20;
              const sy = py + 32 + Math.sin(a) * 20;
              ctx.fillStyle = i % 2 === 0 ? '#8C805C' : '#786D4E';
              ctx.beginPath();
              ctx.arc(sx, sy, 5.2, 0, Math.PI * 2);
              ctx.fill();
            }
            // Sunken armored steel command roof
            ctx.fillStyle = '#334155';
            ctx.strokeStyle = '#94A3B8';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.roundRect(px + 18, py + 18, 28, 28, 4);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#0F172A';
            ctx.fillRect(px + 23, py + 23, 18, 4);
            ctx.fillRect(px + 23, py + 37, 18, 4);
            ctx.fillStyle = '#64748B';
            ctx.fillRect(px + 24, py + 29, 16, 6);
          }
        } else {
          // WATCHTOWER (3 variations — sensor center strictly at px+32, py+32 for LivingMapLayer radar cone!)
          const variant = pickWatchtowerVariant(t, gridSize);
          // Elevated tower cast shadow
          ctx.fillStyle = 'rgba(10, 16, 24, 0.45)';
          ctx.beginPath();
          ctx.moveTo(px + 18, py + 18);
          ctx.lineTo(px + 64, py + 32);
          ctx.lineTo(px + 54, py + 64);
          ctx.lineTo(px + 14, py + 52);
          ctx.closePath();
          ctx.fill();

          if (variant === 'RADAR_TOWER') {
            // 1. Steel Recon Radar Tower
            ctx.fillStyle = '#64748B';
            ctx.beginPath();
            ctx.roundRect(px + 10, py + 10, 44, 44, 6);
            ctx.fill();
            ctx.strokeStyle = '#94A3B8';
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 13, py + 13, 38, 38);
            // Catwalk corner stanchions
            ctx.fillStyle = '#E2E8F0';
            ctx.fillRect(px + 11, py + 11, 4, 4);
            ctx.fillRect(px + 49, py + 11, 4, 4);
            ctx.fillRect(px + 11, py + 49, 4, 4);
            ctx.fillRect(px + 49, py + 49, 4, 4);
            // Central radar housing
            ctx.fillStyle = '#1E293B';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 12, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#CBD5E1';
            ctx.beginPath();
            ctx.arc(px + 30, py + 30, 5, 0, Math.PI * 2);
            ctx.fill();
          } else if (variant === 'COMMS_OUTPOST') {
            // 2. Octagonal Reinforced Comms Relay Outpost
            ctx.fillStyle = '#475569';
            ctx.strokeStyle = '#CBD5E1';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(px + 20, py + 8);
            ctx.lineTo(px + 44, py + 8);
            ctx.lineTo(px + 56, py + 20);
            ctx.lineTo(px + 56, py + 44);
            ctx.lineTo(px + 44, py + 56);
            ctx.lineTo(px + 20, py + 56);
            ctx.lineTo(px + 8, py + 44);
            ctx.lineTo(px + 8, py + 20);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Inner deck & comms array ribs
            ctx.fillStyle = '#334155';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 17, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#94A3B8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(px + 16, py + 32);
            ctx.lineTo(px + 48, py + 32);
            ctx.moveTo(px + 32, py + 16);
            ctx.lineTo(px + 32, py + 48);
            ctx.stroke();
            // Glowing recon sensor core
            ctx.fillStyle = '#0F172A';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#38BDF8';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 4.2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // 3. Elevated Sandbagged Sniper Crow's Nest
            // Corner steel cross-struts
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(px + 10, py + 10);
            ctx.lineTo(px + 54, py + 54);
            ctx.moveTo(px + 54, py + 10);
            ctx.lineTo(px + 10, py + 54);
            ctx.stroke();
            // Timber/steel platform
            ctx.fillStyle = '#75644C';
            ctx.strokeStyle = '#3E3326';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.roundRect(px + 11, py + 11, 42, 42, 5);
            ctx.fill();
            ctx.stroke();
            // Sandbag parapet trim along edges
            ctx.fillStyle = '#9C8F6B';
            ctx.fillRect(px + 13, py + 11, 38, 4.5);
            ctx.fillRect(px + 13, py + 48.5, 38, 4.5);
            ctx.fillRect(px + 11, py + 15, 4.5, 34);
            ctx.fillRect(px + 48.5, py + 15, 4.5, 34);
            // Central spotting cupola
            ctx.fillStyle = '#1E293B';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#94A3B8';
            ctx.beginPath();
            ctx.arc(px + 32, py + 32, 5.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (t.type === 'BANK') {
        const isLooted = (t.hackProgress || 0) >= 100;
        const idx = bankIndexById.get(t.id) ?? 0;
        const variant = pickBankVariant(idx, bankSeedOffset, gridSize);
        drawBankVariant(ctx, px, py, variant, isLooted);
      } else if (t.type === 'BASE') {
        const fCol =
          t.owner !== undefined && t.owner !== null
            ? FACTION_COLORS[t.owner % 6] || '#94A3B8'
            : '#94A3B8';

        // Heavy bunker drop shadow
        ctx.fillStyle = 'rgba(10, 16, 24, 0.52)';
        ctx.beginPath();
        ctx.roundRect(px + 7, py + 11, 54, 52, 10);
        ctx.fill();

        // Outer octagonal armored concrete bunker base
        ctx.fillStyle = '#4B5563';
        ctx.strokeStyle = '#1F2937';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px + 14, py + 4);
        ctx.lineTo(px + 50, py + 4);
        ctx.lineTo(px + 60, py + 14);
        ctx.lineTo(px + 60, py + 50);
        ctx.lineTo(px + 50, py + 60);
        ctx.lineTo(px + 14, py + 60);
        ctx.lineTo(px + 4, py + 50);
        ctx.lineTo(px + 4, py + 14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner sloped reinforced steel command deck
        ctx.fillStyle = '#334155';
        ctx.beginPath();
        ctx.roundRect(px + 10, py + 10, 44, 44, 6);
        ctx.fill();

        // Subtle armored roof seam lines & exhaust vent grates
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 12, py + 12, 40, 40);
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(px + 44, py + 13, 6, 4);
        ctx.fillRect(px + 14, py + 47, 6, 4);

        // Faction-colored armored corner bolsters (high readability at any zoom)
        ctx.fillStyle = fCol;
        ctx.fillRect(px + 12, py + 7, 14, 4);
        ctx.fillRect(px + 38, py + 7, 14, 4);
        ctx.fillRect(px + 12, py + 53, 14, 4);
        ctx.fillRect(px + 38, py + 53, 14, 4);
        ctx.fillRect(px + 7, py + 12, 4, 14);
        ctx.fillRect(px + 7, py + 38, 4, 14);
        ctx.fillRect(px + 53, py + 12, 4, 14);
        ctx.fillRect(px + 53, py + 38, 4, 14);

        // Recessed heavy turret slewing ring + radial rivets (strictly aligned with LivingMapLayer!)
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.arc(px + 32, py + 32, 17, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#94A3B8';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(px + 32, py + 32, 16, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#E2E8F0';
        for (let b = 0; b < 8; b++) {
          const ang = (b * Math.PI) / 4;
          ctx.beginPath();
          ctx.arc(px + 32 + Math.cos(ang) * 16, py + 32 + Math.sin(ang) * 16, 1.3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Inner turret bearing well
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.arc(px + 32, py + 32, 11, 0, Math.PI * 2);
        ctx.fill();

        // Single-tile editor/palette preview includes static twin-MG turret icon
        if (gridSize === 1) {
          ctx.save();
          ctx.translate(px + 32, py + 32);
          ctx.rotate(-0.65);
          ctx.fillStyle = '#475569';
          ctx.strokeStyle = '#E2E8F0';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.roundRect(-10, -9, 18, 18, 3);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = fCol;
          ctx.beginPath();
          ctx.arc(-2, 0, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#E2E8F0';
          ctx.fillRect(6, -5.5, 17, 3.2);
          ctx.fillRect(6, 2.3, 17, 3.2);
          ctx.restore();
        }
      }
    }
  }
}
