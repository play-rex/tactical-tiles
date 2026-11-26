import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Container, Graphics, Text, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type {
  BurningLine,
  LandMine,
  PendingTactical,
  SmokeZone,
  TacticalAxis,
  TacticalSensor,
  Tile,
  Unit,
} from '@tactical/engine/types';
import { isUnitVisible } from '@tactical/engine';
import { PLAYER_COLORS, TILE_SIZE } from '@tactical/engine/constants/Config';
import { SafeSprite } from '../SafeSprite';
import { getTexture } from '../../../core/graphics/TextureManager';
import { TACTICAL_VISUAL_STYLE } from '../../../core/graphics/TacticalAssets';
import { hexToPixiColor } from '../../ui/GeoPrimitives';
import type { BoardRotation } from '../../../core/boardRotation';
import type { ParticlePool } from '../../../core/graphics/ParticlePool';
import { getPrefersReducedMotion } from '../../../core/graphics/fxTimeline';

const BADGE_ANCHOR = { x: 0.5, y: 1 };

// Engine tactical arrays are optional on a freshly created GameState and only get populated by
// the first round tick. Stable empty fallbacks keep the board renderable on turn 1 instead of
// throwing on `.map` and unmounting the whole viewport until END TURN.
const NO_PENDING_TACTICALS: PendingTactical[] = [];
const NO_BURNING_LINES: BurningLine[] = [];
const NO_REVEALED_MINES: LandMine[] = [];
const NO_SMOKE_ZONES: SmokeZone[] = [];
const NO_SENSORS: TacticalSensor[] = [];

const TELEGRAPH_TEXT_STYLE = new PIXI.TextStyle({
  fill: '#FFF1F2',
  fontSize: 9,
  fontWeight: '900',
  stroke: '#881337',
  strokeThickness: 3,
  letterSpacing: 0.4,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const NAPALM_TEXT_STYLE = new PIXI.TextStyle({
  fill: '#FEF08A',
  fontSize: 9,
  fontWeight: '900',
  stroke: '#7C2D12',
  strokeThickness: 3,
  letterSpacing: 0.4,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const SMOKE_TEXT_STYLE = new PIXI.TextStyle({
  fill: '#F1F5F9',
  fontSize: 9,
  fontWeight: '900',
  stroke: '#0F172A',
  strokeThickness: 3,
  letterSpacing: 0.5,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const DRONE_OWN_TEXT_STYLE = new PIXI.TextStyle({
  fill: '#BAE6FD',
  fontSize: 9,
  fontWeight: '900',
  stroke: '#0C4A6E',
  strokeThickness: 3,
  letterSpacing: 0.4,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const DRONE_ENEMY_TEXT_STYLE = new PIXI.TextStyle({
  fill: '#FECDD3',
  fontSize: 9,
  fontWeight: '900',
  stroke: '#881337',
  strokeThickness: 3,
  letterSpacing: 0.4,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const ENEMY_MINE_TEXT_STYLE = new PIXI.TextStyle({
  fill: '#67E8F9',
  fontSize: 8.5,
  fontWeight: '900',
  stroke: '#7F1D1D',
  strokeThickness: 3,
  letterSpacing: 0.3,
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

function inferAxisFromTiles(tiles: Tile[], explicit?: TacticalAxis): TacticalAxis {
  if (explicit) return explicit;
  if (tiles.length < 2) return 'H';
  const spanX = Math.max(...tiles.map(t => t.x)) - Math.min(...tiles.map(t => t.x));
  const spanY = Math.max(...tiles.map(t => t.y)) - Math.min(...tiles.map(t => t.y));
  return spanY > spanX ? 'V' : 'H';
}

function drawDashedRect(
  g: PIXI.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha: number,
  lineWidth = 2,
  dash = 8,
  gap = 5,
): void {
  g.lineStyle(lineWidth, color, alpha);
  const drawEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return;
    const ux = dx / len;
    const uy = dy / len;
    let d = 0;
    while (d < len) {
      const end = Math.min(len, d + dash);
      g.moveTo(x1 + ux * d, y1 + uy * d);
      g.lineTo(x1 + ux * end, y1 + uy * end);
      d += dash + gap;
    }
  };
  drawEdge(x, y, x + w, y);
  drawEdge(x + w, y, x + w, y + h);
  drawEdge(x + w, y + h, x, y + h);
  drawEdge(x, y + h, x, y);
  g.lineStyle(0);
}

function drawChevron(
  g: PIXI.Graphics,
  cx: number,
  cy: number,
  axis: TacticalAxis,
  size: number,
  color: number,
  alpha: number,
  width = 2.4,
): void {
  g.lineStyle(width, color, alpha);
  if (axis === 'H') {
    g.moveTo(cx - size * 0.65, cy - size);
    g.lineTo(cx + size * 0.55, cy);
    g.lineTo(cx - size * 0.65, cy + size);
  } else {
    g.moveTo(cx - size, cy - size * 0.65);
    g.lineTo(cx, cy + size * 0.55);
    g.lineTo(cx + size, cy - size * 0.65);
  }
  g.lineStyle(0);
}

function tileBounds(tiles: Tile[]): { minX: number; minY: number; maxX: number; maxY: number; midTile: Tile } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
  }
  const midTile = tiles[Math.floor(tiles.length / 2)] ?? tiles[0];
  return { minX, minY, maxX, maxY, midTile };
}

export interface TacticalGroundLayerProps {
  tileById: Map<string, Tile>;
  pendingTacticals?: PendingTactical[];
  burningLines?: BurningLine[];
  overclockCharges?: Record<number, number>;
  revealedEnemyMines?: LandMine[];
  units: Unit[];
  viewer: number;
  fogOfWar: boolean;
  visibleTiles: Set<string>;
  mapRotation: BoardRotation;
  animate: boolean;
  particlePoolRef: React.MutableRefObject<ParticlePool | null>;
}

/**
 * Persistent ground-plane tactical states (under units):
 * - Napalm burning lanes with dancing multi-layer flames & charred tarmac
 * - Public strike telegraphs (Precision Strike laser designator, Carpet Run corridor, Artillery Barrage kill-box)
 * - Overclock Core electric-gold ready unit halos
 * - Enemy mines revealed via Minefield Snapshot
 */
export const TacticalGroundLayer: React.FC<TacticalGroundLayerProps> = React.memo(({
  tileById,
  pendingTacticals = NO_PENDING_TACTICALS,
  burningLines = NO_BURNING_LINES,
  overclockCharges,
  revealedEnemyMines = NO_REVEALED_MINES,
  units,
  viewer,
  fogOfWar,
  visibleTiles,
  mapRotation,
  animate,
  particlePoolRef,
}) => {
  const gfxRef = useRef<PIXI.Graphics>(null);
  const phaseRef = useRef(0);
  const accumRef = useRef(0);
  const emberTickRef = useRef(0);
  const reducedMotion = getPrefersReducedMotion();
  const shouldAnimate = animate && !reducedMotion;

  const resolvedPending = useMemo(() => {
    return pendingTacticals
      .map(p => {
        const tiles = p.tiles.map(id => tileById.get(id)).filter((t): t is Tile => Boolean(t));
        if (tiles.length === 0) return null;
        const axis = inferAxisFromTiles(tiles, p.axis);
        const bounds = tileBounds(tiles);
        const width = p.width ?? (p.itemKey === 'ARTILLERY_BARRAGE' && tiles.length > 10 ? 2 : 1);
        const label =
          p.itemKey === 'PRECISION_STRIKE'
            ? `STRIKE -${p.damage}`
            : p.itemKey === 'CARPET_RUN'
              ? `CARPET -${p.damage}`
              : `BARRAGE ${width}×10`;
        return { p, tiles, axis, bounds, width, label };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [pendingTacticals, tileById]);

  const resolvedBurning = useMemo(() => {
    return burningLines
      .map(line => {
        const tiles = line.tiles.map(id => tileById.get(id)).filter((t): t is Tile => Boolean(t));
        if (tiles.length === 0) return null;
        const bounds = tileBounds(tiles);
        return { line, tiles, bounds };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [burningLines, tileById]);

  const overclockedTiles = useMemo(() => {
    const out: { tile: Tile; color: number }[] = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if ((overclockCharges?.[u.owner] ?? 0) <= 0 || u.completed) continue;
      if (!isUnitVisible(u, viewer, fogOfWar, visibleTiles)) continue;
      const tile = tileById.get(u.tileId);
      if (tile) out.push({ tile, color: hexToPixiColor(PLAYER_COLORS[u.owner] || '#FACC15') });
    }
    return out;
  }, [units, overclockCharges, viewer, fogOfWar, visibleTiles, tileById]);

  const resolvedEnemyMines = useMemo(() => {
    const out: { mine: LandMine; tile: Tile }[] = [];
    for (let i = 0; i < revealedEnemyMines.length; i++) {
      const m = revealedEnemyMines[i];
      const tile = tileById.get(m.tileId);
      if (tile) out.push({ mine: m, tile });
    }
    return out;
  }, [revealedEnemyMines, tileById]);

  const hasContent =
    resolvedPending.length > 0 ||
    resolvedBurning.length > 0 ||
    overclockedTiles.length > 0 ||
    resolvedEnemyMines.length > 0;

  const renderGround = useCallback((g: PIXI.Graphics, phase: number) => {
    g.clear();
    if (!hasContent) return;

    // Slow gentle pulse (<= 1.2 Hz, strictly WCAG 2.3.1 flash-safe)
    const pulse = 0.5 + 0.5 * Math.sin(phase * 1.35);

    // 1. NAPALM BURNING LINES — charred ground bed + dancing multi-layer flame tongues
    for (let i = 0; i < resolvedBurning.length; i++) {
      const { tiles, bounds } = resolvedBurning[i];
      const bx = bounds.minX * TILE_SIZE;
      const by = bounds.minY * TILE_SIZE;
      const bw = (bounds.maxX - bounds.minX + 1) * TILE_SIZE;
      const bh = (bounds.maxY - bounds.minY + 1) * TILE_SIZE;

      for (let j = 0; j < tiles.length; j++) {
        const t = tiles[j];
        const px = t.x * TILE_SIZE;
        const py = t.y * TILE_SIZE;
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;

        // Scorched charcoal asphalt base
        g.beginFill(0x1C0A00, 0.52);
        g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.endFill();

        // Glowing ember heat pool
        g.beginFill(0xEA580C, 0.28 + pulse * 0.14);
        g.drawEllipse(cx, cy, 25, 22);
        g.endFill();

        // 5 dancing layered flame tongues per tile
        for (let f = 0; f < 5; f++) {
          const seed = t.x * 13 + t.y * 7 + f * 2.1;
          const sway = Math.sin(phase * 3.1 + seed) * 3.2;
          const fx = px + 12 + f * 10 + sway * 0.4;
          const fy = cy + 10 + Math.cos(seed) * 7;
          const h = 13 + ((f % 3) * 4) + Math.sin(phase * 4.2 + seed) * 3.5;
          const w = 6.5 - (f % 2) * 1.1;

          // Outer crimson flame
          g.beginFill(0xDC2626, 0.8);
          g.drawPolygon([
            fx - w, fy,
            fx + sway * 0.6, fy - h,
            fx + w, fy,
            fx, fy + 4,
          ]);
          g.endFill();

          // Inner orange flame
          g.beginFill(0xF97316, 0.9);
          g.drawPolygon([
            fx - w * 0.65, fy - 1,
            fx + sway * 0.45, fy - h * 0.76,
            fx + w * 0.65, fy - 1,
            fx, fy + 2.5,
          ]);
          g.endFill();

          // White-gold flame core
          g.beginFill(0xFEF08A, 0.92);
          g.drawCircle(fx, fy - h * 0.25, 2.6);
          g.endFill();
        }
      }

      // Outer incendiary containment border
      g.lineStyle(2.4, 0xF97316, 0.78 + pulse * 0.18);
      g.drawRect(bx + 2, by + 2, bw - 4, bh - 4);
      g.lineStyle(0);
    }

    // 2. PENDING TELEGRAPHED STRIKES (PRECISION_STRIKE, CARPET_RUN, ARTILLERY_BARRAGE)
    for (let i = 0; i < resolvedPending.length; i++) {
      const { p, tiles, axis, bounds } = resolvedPending[i];
      const visual = TACTICAL_VISUAL_STYLE[p.itemKey];
      const ownerColor = hexToPixiColor(PLAYER_COLORS[p.owner] || visual.primaryHex);

      if (p.itemKey === 'PRECISION_STRIKE') {
        const t = tiles[0];
        const px = t.x * TILE_SIZE;
        const py = t.y * TILE_SIZE;
        const cx = px + TILE_SIZE / 2;
        const cy = py + TILE_SIZE / 2;

        g.beginFill(visual.primaryPixi, 0.22 + pulse * 0.14);
        g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        g.endFill();

        // Outer rotating laser designator ring
        const rOuter = 23 + pulse * 3;
        g.lineStyle(2.4, visual.primaryPixi, 0.92);
        g.drawCircle(cx, cy, rOuter);
        g.lineStyle(1.4, visual.secondaryPixi, 0.85);
        g.drawCircle(cx, cy, 11);

        // 4 rotating sight ticks
        const spin = phase * 0.55;
        g.lineStyle(2.2, 0xFFF1F2, 0.95);
        for (let k = 0; k < 4; k++) {
          const ang = spin + (Math.PI / 2) * k;
          g.moveTo(cx + Math.cos(ang) * 14, cy + Math.sin(ang) * 14);
          g.lineTo(cx + Math.cos(ang) * (rOuter + 4), cy + Math.sin(ang) * (rOuter + 4));
        }

        // Laser center dot
        g.lineStyle(0);
        g.beginFill(0xFFFFFF, 0.98);
        g.drawCircle(cx, cy, 3.2);
        g.endFill();
        g.beginFill(ownerColor, 0.95);
        g.drawCircle(px + 9, py + 9, 4);
        g.endFill();
      } else {
        // CARPET_RUN or ARTILLERY_BARRAGE corridor
        const isBarrage = p.itemKey === 'ARTILLERY_BARRAGE';
        const bx = bounds.minX * TILE_SIZE;
        const by = bounds.minY * TILE_SIZE;
        const bw = (bounds.maxX - bounds.minX + 1) * TILE_SIZE;
        const bh = (bounds.maxY - bounds.minY + 1) * TILE_SIZE;

        for (let j = 0; j < tiles.length; j++) {
          const t = tiles[j];
          const px = t.x * TILE_SIZE;
          const py = t.y * TILE_SIZE;
          const cx = px + TILE_SIZE / 2;
          const cy = py + TILE_SIZE / 2;

          // Marching wave brightness along the strike corridor
          const wave = 0.5 + 0.5 * Math.sin(phase * 2.2 - j * 0.55);
          g.beginFill(visual.primaryPixi, 0.16 + wave * 0.14);
          g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.endFill();

          // Subtle inner hazard corner ticks
          g.lineStyle(1.4, visual.secondaryPixi, 0.55 + wave * 0.3);
          g.moveTo(px + 5, py + 12);
          g.lineTo(px + 5, py + 5);
          g.lineTo(px + 12, py + 5);
          g.moveTo(px + TILE_SIZE - 12, py + TILE_SIZE - 5);
          g.lineTo(px + TILE_SIZE - 5, py + TILE_SIZE - 5);
          g.lineTo(px + TILE_SIZE - 5, py + TILE_SIZE - 12);
          g.lineStyle(0);

          // Directional bombing/creeping chevrons
          drawChevron(g, cx, cy, axis, isBarrage ? 8 : 10, visual.secondaryPixi, 0.52 + wave * 0.42, isBarrage ? 2.1 : 2.6);
        }

        // Bold corridor perimeter & owner beacon dot
        g.lineStyle(2.8, visual.primaryPixi, 0.92);
        g.drawRect(bx + 2, by + 2, bw - 4, bh - 4);
        drawDashedRect(g, bx + 5, by + 5, bw - 10, bh - 10, visual.secondaryPixi, 0.72, 1.5, 9, 6);
        g.beginFill(ownerColor, 0.96);
        g.drawCircle(bx + 10, by + 10, 4.2);
        g.endFill();
      }
    }

    // 3. OVERCLOCK CORE — electric-gold hexagonal surge halo on active ready units
    for (let i = 0; i < overclockedTiles.length; i++) {
      const { tile } = overclockedTiles[i];
      const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const r = 24 + pulse * 2.5;

      g.lineStyle(2.2, 0xFACC15, 0.72 + pulse * 0.24);
      for (let s = 0; s < 6; s++) {
        const a0 = (Math.PI / 3) * s + phase * 0.35;
        const a1 = (Math.PI / 3) * (s + 1) + phase * 0.35;
        if (s === 0) g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      }
      g.lineStyle(1.3, 0x38BDF8, 0.65);
      g.drawCircle(cx, cy, r - 4);
      g.lineStyle(0);
    }

    // 4. REVEALED ENEMY MINES (from Minefield Snapshot)
    for (let i = 0; i < resolvedEnemyMines.length; i++) {
      const { tile } = resolvedEnemyMines[i];
      const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const r = 15 + pulse * 3;

      g.beginFill(0x991B1B, 0.42);
      g.lineStyle(2.2, 0x22D3EE, 0.92);
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r, cy);
      g.closePath();
      g.endFill();

      // Inner warning X
      g.lineStyle(2, 0xFCA5A5, 0.96);
      g.moveTo(cx - 5, cy - 5);
      g.lineTo(cx + 5, cy + 5);
      g.moveTo(cx + 5, cy - 5);
      g.lineTo(cx - 5, cy + 5);
      g.lineStyle(0);
    }
  }, [hasContent, resolvedBurning, resolvedPending, overclockedTiles, resolvedEnemyMines]);

  useEffect(() => {
    const g = gfxRef.current;
    if (g && !g.destroyed) renderGround(g, phaseRef.current);
  }, [renderGround]);

  useTick((delta) => {
    if (!shouldAnimate || !hasContent) return;
    const dt = typeof delta === 'number' ? delta : 1;
    accumRef.current += dt;
    if (accumRef.current < 3) return;
    phaseRef.current += 0.045 * accumRef.current;
    emberTickRef.current += accumRef.current;
    accumRef.current = 0;

    const g = gfxRef.current;
    if (g && !g.destroyed) renderGround(g, phaseRef.current);

    // Subtle ambient rising embers over active Napalm lines in LIVE mode
    if (resolvedBurning.length > 0 && emberTickRef.current >= 18) {
      emberTickRef.current = 0;
      const pool = particlePoolRef.current;
      if (pool) {
        const lineEntry = resolvedBurning[Math.floor(Math.random() * resolvedBurning.length)];
        const tile = lineEntry.tiles[Math.floor(Math.random() * lineEntry.tiles.length)];
        pool.spawn({
          texture: 'shard',
          additive: true,
          ambient: true,
          x: tile.x * TILE_SIZE + 14 + Math.random() * (TILE_SIZE - 28),
          y: tile.y * TILE_SIZE + 14 + Math.random() * (TILE_SIZE - 28),
          vx: (Math.random() - 0.5) * 24,
          vy: (Math.random() - 0.5) * 24,
          upAccel: 95,
          drag: 1.5,
          lifeMs: 520 + Math.random() * 260,
          startScale: 0.24,
          endScale: 0.04,
          color: Math.random() < 0.5 ? 0xFEF08A : 0xF97316,
          alpha: 0.9,
          vr: (Math.random() - 0.5) * 8,
        });
      }
    }
  });

  if (!hasContent) return null;

  return (
    <Container name="tactical_ground_hazards" eventMode="none">
      <Graphics ref={gfxRef} eventMode="none" />

      {resolvedBurning.map(({ line, bounds }) => (
        <Container
          key={`napalm_lbl_${line.id}`}
          x={bounds.midTile.x * TILE_SIZE + TILE_SIZE / 2}
          y={bounds.midTile.y * TILE_SIZE + TILE_SIZE / 2}
          angle={-mapRotation}
        >
          <Text
            text={`NAPALM · ${line.roundsLeft}R`}
            anchor={BADGE_ANCHOR}
            x={0}
            y={TILE_SIZE / 2 - 3}
            style={NAPALM_TEXT_STYLE}
          />
        </Container>
      ))}

      {resolvedPending.map(({ p, bounds, label }) => (
        <Container
          key={`pending_lbl_${p.id}`}
          x={bounds.midTile.x * TILE_SIZE + TILE_SIZE / 2}
          y={bounds.midTile.y * TILE_SIZE + TILE_SIZE / 2}
          angle={-mapRotation}
        >
          <Text
            text={label}
            anchor={BADGE_ANCHOR}
            x={0}
            y={TILE_SIZE / 2 - 3}
            style={TELEGRAPH_TEXT_STYLE}
          />
        </Container>
      ))}

      {resolvedEnemyMines.map(({ mine, tile }) => (
        <Container
          key={`enemy_mine_lbl_${mine.id}`}
          x={tile.x * TILE_SIZE + TILE_SIZE / 2}
          y={tile.y * TILE_SIZE + TILE_SIZE / 2}
          angle={-mapRotation}
        >
          <Text
            text="ENEMY MINE"
            anchor={BADGE_ANCHOR}
            x={0}
            y={TILE_SIZE / 2 - 3}
            style={ENEMY_MINE_TEXT_STYLE}
          />
        </Container>
      ))}
    </Container>
  );
});

export interface TacticalAirLayerProps {
  tileById: Map<string, Tile>;
  smokeZones?: SmokeZone[];
  sensors?: TacticalSensor[];
  viewer: number;
  mapRotation: BoardRotation;
  animate: boolean;
}

const DroneHoverSprite: React.FC<{
  sensor: TacticalSensor;
  tile: Tile;
  isOwn: boolean;
  mapRotation: BoardRotation;
  animate: boolean;
}> = React.memo(({ sensor, tile, isOwn, mapRotation, animate }) => {
  const spriteRef = useRef<PIXI.Container>(null);
  const phaseRef = useRef(tile.x * 0.7 + tile.y * 1.1);
  const texture = getTexture('TACTICAL_RECON_DRONE');
  const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
  const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
  const ownerColor = hexToPixiColor(PLAYER_COLORS[sensor.owner] || '#38BDF8');

  useTick((delta) => {
    if (!animate) return;
    const c = spriteRef.current;
    if (!c || c.destroyed) return;
    phaseRef.current += (typeof delta === 'number' ? delta : 1) * 0.055;
    const bob = Math.sin(phaseRef.current) * 2.6;
    c.y = -6 + bob;
    c.rotation = Math.sin(phaseRef.current * 0.6) * 0.08;
  });

  const drawShadowAndRing = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      // Soft altitude drop shadow
      g.beginFill(0x020617, 0.34);
      g.drawEllipse(0, 12, 17, 9);
      g.endFill();
      // Faction-tinted tactical telemetry ring
      g.lineStyle(2, isOwn ? 0x38BDF8 : 0xF43F5E, 0.9);
      g.drawCircle(0, 0, 21);
      g.lineStyle(1.4, ownerColor, 0.85);
      g.drawCircle(0, 0, 16);
      g.lineStyle(0);
    },
    [isOwn, ownerColor],
  );

  return (
    <Container x={cx} y={cy} angle={-mapRotation} eventMode="none">
      <Graphics draw={drawShadowAndRing} eventMode="none" />
      <Container ref={spriteRef} x={0} y={-6} eventMode="none">
        {texture && (
          <SafeSprite
            texture={texture}
            anchor={0.5}
            x={0}
            y={0}
            width={46}
            height={46}
            eventMode="none"
          />
        )}
      </Container>
      <Text
        text={isOwn ? `UAV · ${sensor.roundsLeft}R` : `ENEMY UAV · ${sensor.roundsLeft}R`}
        anchor={BADGE_ANCHOR}
        x={0}
        y={TILE_SIZE / 2 - 2}
        style={isOwn ? DRONE_OWN_TEXT_STYLE : DRONE_ENEMY_TEXT_STYLE}
      />
    </Container>
  );
});

const SmokeZoneCloud: React.FC<{
  zone: SmokeZone;
  tiles: Tile[];
  mapRotation: BoardRotation;
  animate: boolean;
}> = React.memo(({ zone, tiles, mapRotation, animate }) => {
  const cloudRef = useRef<PIXI.Container>(null);
  const phaseRef = useRef(0);
  const smokeTex = getTexture('TACTICAL_SMOKE_PUFF');
  const bounds = useMemo(() => tileBounds(tiles), [tiles]);

  const drawPerimeter = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      const bx = bounds.minX * TILE_SIZE;
      const by = bounds.minY * TILE_SIZE;
      const bw = (bounds.maxX - bounds.minX + 1) * TILE_SIZE;
      const bh = (bounds.maxY - bounds.minY + 1) * TILE_SIZE;

      // Subtle grey-blue obscurant bed so units underneath remain selectable
      g.beginFill(0x94A3B8, 0.24);
      g.drawRect(bx + 2, by + 2, bw - 4, bh - 4);
      g.endFill();

      drawDashedRect(g, bx + 2, by + 2, bw - 4, bh - 4, 0xCBD5E1, 0.82, 2, 8, 5);
    },
    [bounds],
  );

  useTick((delta) => {
    if (!animate) return;
    const c = cloudRef.current;
    if (!c || c.destroyed) return;
    phaseRef.current += (typeof delta === 'number' ? delta : 1) * 0.02;
    const kids = c.children;
    for (let i = 0; i < kids.length; i++) {
      const sp = kids[i] as PIXI.Sprite;
      const p = phaseRef.current + i * 1.15;
      sp.alpha = 0.44 + 0.14 * Math.sin(p);
      sp.rotation = Math.sin(p * 0.5) * 0.18 + (i % 4) * 0.8;
    }
  });

  return (
    <Container name={`smoke_zone_${zone.id}`} eventMode="none">
      <Graphics draw={drawPerimeter} eventMode="none" />
      {smokeTex && (
        <Container ref={cloudRef} eventMode="none">
          {tiles.map((t, idx) => (
            <SafeSprite
              key={`${zone.id}_puff_${t.id}`}
              texture={smokeTex}
              anchor={0.5}
              x={t.x * TILE_SIZE + TILE_SIZE / 2 + ((idx % 3) - 1) * 5}
              y={t.y * TILE_SIZE + TILE_SIZE / 2 + (Math.floor(idx / 3) - 1) * 4}
              width={TILE_SIZE * 1.32}
              height={TILE_SIZE * 1.32}
              alpha={0.5}
              rotation={(idx % 4) * 0.8}
              eventMode="none"
            />
          ))}
        </Container>
      )}
      <Container
        x={bounds.midTile.x * TILE_SIZE + TILE_SIZE / 2}
        y={bounds.midTile.y * TILE_SIZE + TILE_SIZE / 2}
        angle={-mapRotation}
      >
        <Text
          text={`SMOKE · ${zone.roundsLeft}R`}
          anchor={BADGE_ANCHOR}
          x={0}
          y={TILE_SIZE / 2 - 3}
          style={SMOKE_TEXT_STYLE}
        />
      </Container>
    </Container>
  );
});

/**
 * Persistent aerial tactical layer (above units & targeting reticles):
 * - Volumetric 3×3 Smoke Screen clouds with LOS-block perimeters
 * - Hovering Recon Drones with subtle owner 5-tile sensor range diamonds
 */
export const TacticalAirLayer: React.FC<TacticalAirLayerProps> = React.memo(({
  tileById,
  smokeZones = NO_SMOKE_ZONES,
  sensors = NO_SENSORS,
  viewer,
  mapRotation,
  animate,
}) => {
  const reducedMotion = getPrefersReducedMotion();
  const shouldAnimate = animate && !reducedMotion;

  const resolvedSmoke = useMemo(() => {
    return smokeZones
      .map(zone => {
        const tiles = zone.tiles.map(id => tileById.get(id)).filter((t): t is Tile => Boolean(t));
        return tiles.length > 0 ? { zone, tiles } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [smokeZones, tileById]);

  const resolvedSensors = useMemo(() => {
    return sensors
      .map(sensor => {
        const tile = tileById.get(sensor.tileId);
        return tile ? { sensor, tile } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [sensors, tileById]);

  const drawSensorRanges = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      for (let i = 0; i < resolvedSensors.length; i++) {
        const { sensor, tile } = resolvedSensors[i];
        if (sensor.owner !== viewer) continue;
        const cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
        const radius = 5 * TILE_SIZE + TILE_SIZE * 0.35;
        g.lineStyle(1.4, 0x38BDF8, 0.28);
        g.moveTo(cx, cy - radius);
        g.lineTo(cx + radius, cy);
        g.lineTo(cx, cy + radius);
        g.lineTo(cx - radius, cy);
        g.closePath();
        g.lineStyle(0);
      }
    },
    [resolvedSensors, viewer],
  );

  if (resolvedSmoke.length === 0 && resolvedSensors.length === 0) return null;

  return (
    <Container name="tactical_air_layer" eventMode="none">
      <Graphics draw={drawSensorRanges} eventMode="none" />
      {resolvedSmoke.map(({ zone, tiles }) => (
        <SmokeZoneCloud
          key={zone.id}
          zone={zone}
          tiles={tiles}
          mapRotation={mapRotation}
          animate={shouldAnimate}
        />
      ))}
      {resolvedSensors.map(({ sensor, tile }) => (
        <DroneHoverSprite
          key={sensor.id}
          sensor={sensor}
          tile={tile}
          isOwn={sensor.owner === viewer}
          mapRotation={mapRotation}
          animate={shouldAnimate}
        />
      ))}
    </Container>
  );
});
