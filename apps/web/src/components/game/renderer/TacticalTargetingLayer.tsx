import React, { useCallback, useEffect, useMemo } from 'react';
import { Container, Graphics, Text } from '@pixi/react';
import * as PIXI from 'pixi.js';
import {
  computeTacticalPercentDamage,
  isUnitVisible,
  TACTICAL_ITEMS,
  TACTICAL_MIN_HP_FLOOR,
  tacticalDamagePctFor,
  tacticalTilesFor,
} from '@tactical/engine';
import type { TacticalId, Tile, Unit } from '@tactical/engine/types';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import type { BoardRotation } from '../../../core/boardRotation';
import { TACTICAL_VISUAL_STYLE } from '../../../core/graphics/TacticalAssets';
import { useGameStore, viewerSeat, type PlacementModeState } from '../../../store/useGameStore';
import { wakeBattleRenderer } from '../../../store/useEffectStore';

/**
 * True when the active tactical pick selects specific unit/structure tiles (spotlight dims the
 * entire rest of the map strongly and dims non-targetable units so valid targets pop immediately).
 */
export function isUnitPickTacticalMode(placementMode: PlacementModeState | null): boolean {
  if (!placementMode?.active || placementMode.kind !== 'TACTICAL') return false;
  const itemKey = placementMode.itemKey as TacticalId;
  const def = TACTICAL_ITEMS[itemKey];
  if (!def) return false;
  if (def.shape === 'UNIT' || def.shape === 'UNITS3') return true;
  if (itemKey === 'SABOTAGE') return true;
  if (def.shape === 'RELOCATE' && !placementMode.tacticalUnitId) return true;
  return false;
}

const drawCornerBrackets = (
  g: PIXI.Graphics,
  px: number,
  py: number,
  color: number,
  alpha = 1,
  inset = 3,
  arm = 13,
  lineWidth = 2.8,
) => {
  const x0 = px + inset;
  const y0 = py + inset;
  const x1 = px + TILE_SIZE - inset;
  const y1 = py + TILE_SIZE - inset;
  g.lineStyle(lineWidth, color, alpha);
  // Top-left
  g.moveTo(x0, y0 + arm);
  g.lineTo(x0, y0);
  g.lineTo(x0 + arm, y0);
  // Top-right
  g.moveTo(x1 - arm, y0);
  g.lineTo(x1, y0);
  g.lineTo(x1, y0 + arm);
  // Bottom-right
  g.moveTo(x1, y1 - arm);
  g.lineTo(x1, y1);
  g.lineTo(x1 - arm, y1);
  // Bottom-left
  g.moveTo(x0 + arm, y1);
  g.lineTo(x0, y1);
  g.lineTo(x0, y1 - arm);
  g.lineStyle(0);
};

/** High-contrast double-stroked brackets (dark outer halo + bright inner rim) legible on every biome. */
const drawSpotlightBrackets = (
  g: PIXI.Graphics,
  px: number,
  py: number,
  accentColor: number,
  brightColor = 0xFFFFFF,
  inset = 3,
  arm = 13,
) => {
  drawCornerBrackets(g, px, py, 0x020617, 0.92, inset, arm, 5.2);
  drawCornerBrackets(g, px, py, accentColor, 1, inset, arm, 2.8);
  drawCornerBrackets(g, px, py, brightColor, 0.85, inset + 1, Math.max(5, arm - 7), 1.3);
};

const drawBlockedX = (g: PIXI.Graphics, px: number, py: number) => {
  g.beginFill(0xEF4444, 0.28);
  g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  g.endFill();
  g.lineStyle(2.4, 0xFCA5A5, 0.95);
  g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
  g.lineStyle(5, 0x020617, 0.75);
  g.moveTo(px + 15, py + 15);
  g.lineTo(px + TILE_SIZE - 15, py + TILE_SIZE - 15);
  g.moveTo(px + TILE_SIZE - 15, py + 15);
  g.lineTo(px + 15, py + TILE_SIZE - 15);
  g.lineStyle(2.8, 0xFCA5A5, 0.98);
  g.moveTo(px + 15, py + 15);
  g.lineTo(px + TILE_SIZE - 15, py + TILE_SIZE - 15);
  g.moveTo(px + TILE_SIZE - 15, py + 15);
  g.lineTo(px + 15, py + TILE_SIZE - 15);
  g.lineStyle(0);
};

const TAG_TEXT_STYLES = {
  kill: new PIXI.TextStyle({
    fill: '#FEF08A',
    stroke: '#7F1D1D',
    strokeThickness: 3.5,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.4,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  dmg: new PIXI.TextStyle({
    fill: '#FFF1F2',
    stroke: '#0F172A',
    strokeThickness: 3.5,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  locked: new PIXI.TextStyle({
    fill: '#FEF08A',
    stroke: '#7C2D12',
    strokeThickness: 3.8,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.4,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  ally: new PIXI.TextStyle({
    fill: '#A7F3D0',
    stroke: '#064E3B',
    strokeThickness: 3.5,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  enemy: new PIXI.TextStyle({
    fill: '#FDE68A',
    stroke: '#78350F',
    strokeThickness: 3.5,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  sabotage: new PIXI.TextStyle({
    fill: '#E9D5FF',
    stroke: '#3B0764',
    strokeThickness: 3.5,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  warn: new PIXI.TextStyle({
    fill: '#FEF08A',
    stroke: '#9A3412',
    strokeThickness: 3.5,
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
  floor: new PIXI.TextStyle({
    fill: '#CBD5E1',
    stroke: '#0F172A',
    strokeThickness: 3.2,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.3,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }),
};

type TagTone = keyof typeof TAG_TEXT_STYLES;

interface TargetBadge {
  key: string;
  x: number;
  y: number;
  text: string;
  tone: TagTone;
  bgPixi: number;
  borderPixi: number;
}

/**
 * Ground-plane Tactical Spotlight Veil (mounted BELOW units):
 * Dims every non-targetable tile under a crisp translucent dark veil so legal enemy targets,
 * airlift units, or legal landing/barrage zones jump off the map immediately.
 */
export const TacticalSpotlightGroundLayer: React.FC<{
  mapData: Tile[];
  placementMode: PlacementModeState | null;
}> = React.memo(({ mapData, placementMode }) => {
  const isTactical = Boolean(placementMode?.active && placementMode.kind === 'TACTICAL');

  const draw = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (!isTactical || !placementMode) return;

      const itemKey = placementMode.itemKey as TacticalId;
      const spec = TACTICAL_VISUAL_STYLE[itemKey];
      const accent = spec?.primaryPixi ?? 0x38BDF8;
      const unitPickMode = isUnitPickTacticalMode(placementMode);
      const validSet = new Set(placementMode.validTiles ?? []);
      const selectedSet = new Set(placementMode.selectedTiles ?? []);

      // Translucent obsidian veil over all non-pickable tiles (stronger for discrete unit picks)
      const veilAlpha = unitPickMode ? 0.56 : 0.46;

      for (let i = 0; i < mapData.length; i++) {
        const tile = mapData[i];
        const px = tile.x * TILE_SIZE;
        const py = tile.y * TILE_SIZE;
        const isPicked = selectedSet.has(tile.id);
        const isLegal = validSet.has(tile.id);

        if (!isLegal && !isPicked) {
          g.beginFill(0x020617, veilAlpha);
          g.drawRect(px, py, TILE_SIZE, TILE_SIZE);
          g.endFill();

          // Subtle diagonal hatch in zone/lane/LZ modes so blocked ground/HQ-exclusion reads without color alone
          if (!unitPickMode) {
            g.lineStyle(1, 0x94A3B8, 0.14);
            g.moveTo(px + 10, py + TILE_SIZE - 10);
            g.lineTo(px + TILE_SIZE - 10, py + 10);
            g.lineStyle(0);
          }
          continue;
        }

        if (isPicked) {
          const pickedCol = itemKey === 'PARADROP' ? 0x10B981 : 0xF59E0B;
          g.beginFill(pickedCol, 0.28);
          g.drawRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          g.endFill();
          continue;
        }

        if (unitPickMode) {
          // Bright spotlight pool under every legal target unit/building
          g.beginFill(0xFFFFFF, 0.12);
          g.drawRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          g.endFill();
          g.beginFill(accent, 0.22);
          g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.endFill();
        } else {
          // Clean, low-noise legal drop/corridor zone framing
          g.beginFill(accent, 0.11);
          g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.endFill();
          g.lineStyle(1.4, accent, 0.42);
          g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.lineStyle(0);
        }
      }
    },
    [isTactical, placementMode, mapData],
  );

  if (!isTactical) return null;
  return <Graphics draw={draw} eventMode="none" />;
});

/**
 * Top-of-sprite Standardized Tactical Targeting Overlay (mounted ABOVE units):
 * - High-contrast double-stroked brackets & instant lethal/damage/role badges on every pickable unit
 * - Numbered #1/#2/#3 Carpet Run locks & connecting bomber vector lines
 * - Paradrop PICKED origin beacon & curved airlift trajectory preview
 * - Full multi-tile hovered AoE footprint & friendly-fire warnings rendered cleanly ABOVE units
 */
export const TacticalTargetingOverlayLayer: React.FC<{
  tileById: Map<string, Tile>;
  mapRotation: BoardRotation;
}> = React.memo(({ tileById, mapRotation }) => {
  const placementMode = useGameStore(s => s.placementMode);
  const hoveredTileId = useGameStore(s => s.hoveredTileId);
  const units = useGameStore(s => s.units);
  const mapData = useGameStore(s => s.mapData);
  const gridSize = useGameStore(s => s.gridSize) || 20;
  const currentPlayer = useGameStore(s => s.currentPlayer);
  const viewer = useGameStore(viewerSeat);
  const settings = useGameStore(s => s.settings);
  const visibleTiles = useGameStore(s => s.visibleTiles);

  const isTactical = Boolean(placementMode?.active && placementMode.kind === 'TACTICAL');

  useEffect(() => {
    if (isTactical) wakeBattleRenderer(0);
  }, [isTactical, hoveredTileId, placementMode]);

  const unitByTile = useMemo(() => {
    const map = new Map<string, Unit>();
    if (!isTactical) return map;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (isUnitVisible(u, viewer, settings.fogOfWar, visibleTiles)) {
        map.set(u.tileId, u);
      }
    }
    return map;
  }, [isTactical, units, viewer, settings.fogOfWar, visibleTiles]);

  const hoveredFootprint = useMemo(() => {
    if (!isTactical || !placementMode || !hoveredTileId) return null;
    const ht = tileById.get(hoveredTileId);
    if (!ht) return null;
    const itemKey = placementMode.itemKey as TacticalId;
    const def = TACTICAL_ITEMS[itemKey];
    if (!def || def.shape === 'RELOCATE' || def.shape === 'UNITS3' || def.shape === 'UNIT') return null;
    const axis = placementMode.tacticalAxis ?? 'H';
    return tacticalTilesFor(mapData, gridSize, itemKey, ht.id, axis, 2);
  }, [isTactical, placementMode, hoveredTileId, tileById, mapData, gridSize]);

  // Pre-compute upright counter-rotated badges for pickable unit targets, locked #1/#2/#3 picks, and AoE warnings
  const badges = useMemo<TargetBadge[]>(() => {
    if (!isTactical || !placementMode) return [];
    const itemKey = placementMode.itemKey as TacticalId;
    const def = TACTICAL_ITEMS[itemKey];
    if (!def) return [];
    const out: TargetBadge[] = [];
    const selected = placementMode.selectedTiles ?? [];
    const selectedSet = new Set(selected);

    // 1. Already-locked targets (#1, #2, #3 for Carpet Run; PICKED for Paradrop Step 2)
    for (let i = 0; i < selected.length; i++) {
      const t = tileById.get(selected[i]);
      if (!t) continue;
      if (def.shape === 'UNITS3') {
        out.push({
          key: `locked_${t.id}`,
          x: t.x * TILE_SIZE + TILE_SIZE / 2,
          y: t.y * TILE_SIZE + TILE_SIZE / 2,
          text: `#${i + 1}`,
          tone: 'locked',
          bgPixi: 0xC2410C,
          borderPixi: 0xFEF08A,
        });
      } else if (def.shape === 'RELOCATE' && placementMode.tacticalUnitId) {
        out.push({
          key: `picked_${t.id}`,
          x: t.x * TILE_SIZE + TILE_SIZE / 2,
          y: t.y * TILE_SIZE + TILE_SIZE / 2,
          text: 'PICKED',
          tone: 'ally',
          bgPixi: 0x065F46,
          borderPixi: 0x6EE7B7,
        });
      }
    }

    // 2. Discrete unit/structure pick targets: instant clear % damage / 2 HP cap / role tag on every target
    if (isUnitPickTacticalMode(placementMode)) {
      const strikePct = tacticalDamagePctFor(itemKey);
      const validSet = new Set(placementMode.validTiles);
      for (const id of placementMode.validTiles) {
        if (selectedSet.has(id)) continue;
        const t = tileById.get(id);
        if (!t) continue;
        const u = unitByTile.get(id);
        const cx = t.x * TILE_SIZE + TILE_SIZE / 2;
        const cy = t.y * TILE_SIZE + TILE_SIZE / 2;

        if (strikePct > 0 && u) {
          const { dealt, hpAfter } = computeTacticalPercentDamage(u, strikePct);
          const hitsFloor = hpAfter === TACTICAL_MIN_HP_FLOOR;
          out.push({
            key: `tgt_${id}`,
            x: cx,
            y: cy,
            text: hitsFloor ? `-${dealt}→2` : `-${dealt}`,
            tone: hitsFloor ? 'warn' : 'dmg',
            bgPixi: hitsFloor ? 0x7C2D12 : 0x0F172A,
            borderPixi: hitsFloor ? 0xFBBF24 : 0xFDA4AF,
          });
        } else if (itemKey === 'SABOTAGE') {
          const isHq = t.type === 'BASE' && typeof t.owner === 'number';
          out.push({
            key: `sab_${id}`,
            x: cx,
            y: cy,
            text: isHq ? `P${t.owner! + 1} -8 CP` : 'STRIP',
            tone: 'sabotage',
            bgPixi: 0x4C1D95,
            borderPixi: 0xD8B4FE,
          });
        } else if (def.shape === 'RELOCATE' && u) {
          const isOwn = u.owner === currentPlayer;
          out.push({
            key: `para_${id}`,
            x: cx,
            y: cy,
            text: isOwn ? 'ALLY' : 'ENEMY',
            tone: isOwn ? 'ally' : 'enemy',
            bgPixi: isOwn ? 0x065F46 : 0x92400E,
            borderPixi: isOwn ? 0x6EE7B7 : 0xFDE68A,
          });
        }
      }

      // Show a muted 2 HP CAP tag on visible enemies already at the non-lethal floor so exclusions are obvious
      if (strikePct > 0 && (def.shape === 'UNIT' || def.shape === 'UNITS3')) {
        for (const [id, u] of unitByTile) {
          if (u.owner === currentPlayer || validSet.has(id) || selectedSet.has(id)) continue;
          if (u.hp > TACTICAL_MIN_HP_FLOOR) continue;
          const t = tileById.get(id);
          if (!t) continue;
          out.push({
            key: `cap_${id}`,
            x: t.x * TILE_SIZE + TILE_SIZE / 2,
            y: t.y * TILE_SIZE + TILE_SIZE / 2,
            text: '2 HP CAP',
            tone: 'floor',
            bgPixi: 0x1E293B,
            borderPixi: 0x64748B,
          });
        }
      }
    }

    // 3. Hovered AoE footprint unit callouts (shows exact % DMG / 2 HP cap / FF right on units inside Napalm or Barrage!)
    if (
      hoveredFootprint &&
      hoveredTileId &&
      placementMode.validTiles.includes(hoveredTileId) &&
      (itemKey === 'NAPALM_LINE' || itemKey === 'ARTILLERY_BARRAGE')
    ) {
      const aoePct = tacticalDamagePctFor(itemKey);
      for (const ft of hoveredFootprint) {
        const u = unitByTile.get(ft.id);
        if (!u) continue;
        const isAlly = u.owner === currentPlayer;
        const { dealt, hpAfter, atFloor } = computeTacticalPercentDamage(u, aoePct);
        const hitsFloor = !atFloor && hpAfter === TACTICAL_MIN_HP_FLOOR;
        out.push({
          key: `aoe_${ft.id}`,
          x: ft.x * TILE_SIZE + TILE_SIZE / 2,
          y: ft.y * TILE_SIZE + TILE_SIZE / 2,
          text: isAlly
            ? atFloor
              ? 'FF 0'
              : hitsFloor
                ? `FF -${dealt}→2`
                : `FF -${dealt}`
            : atFloor
              ? '2 HP CAP'
              : hitsFloor
                ? `-${dealt}→2`
                : `-${dealt}`,
          tone: atFloor ? 'floor' : isAlly || hitsFloor ? 'warn' : 'dmg',
          bgPixi: atFloor ? 0x1E293B : isAlly ? 0xB45309 : hitsFloor ? 0x7C2D12 : 0x0F172A,
          borderPixi: atFloor ? 0x64748B : isAlly ? 0xFEF08A : hitsFloor ? 0xFBBF24 : 0xFCA5A5,
        });
      }
    }

    return out;
  }, [isTactical, placementMode, tileById, unitByTile, currentPlayer, hoveredFootprint, hoveredTileId]);

  const draw = useCallback(
    (g: PIXI.Graphics) => {
      g.clear();
      if (!isTactical || !placementMode) return;

      const itemKey = placementMode.itemKey as TacticalId;
      const def = TACTICAL_ITEMS[itemKey];
      const spec = TACTICAL_VISUAL_STYLE[itemKey];
      if (!def) return;

      const accent = spec?.primaryPixi ?? 0x38BDF8;
      const rim = spec?.secondaryPixi ?? 0xBAE6FD;
      const selected = placementMode.selectedTiles ?? [];
      const selectedSet = new Set(selected);
      const validSet = new Set(placementMode.validTiles ?? []);
      const unitPickMode = isUnitPickTacticalMode(placementMode);

      // 1. Standardized high-contrast targeting brackets over every discrete pickable target
      if (unitPickMode) {
        for (const id of placementMode.validTiles) {
          if (selectedSet.has(id)) continue;
          const tile = tileById.get(id);
          if (!tile) continue;
          const px = tile.x * TILE_SIZE;
          const py = tile.y * TILE_SIZE;
          const isHovered = id === hoveredTileId;
          const u = unitByTile.get(id);
          const paraAccent =
            def.shape === 'RELOCATE' && u
              ? u.owner === currentPlayer
                ? 0x34D399
                : 0xFBBF24
              : accent;
          drawSpotlightBrackets(
            g,
            px,
            py,
            isHovered ? 0xFEF08A : paraAccent,
            0xFFFFFF,
            isHovered ? 1.5 : 3,
            isHovered ? 15 : 12,
          );
          if (isHovered) {
            g.lineStyle(2, 0xFFFFFF, 0.92);
            g.drawCircle(px + TILE_SIZE / 2, py + TILE_SIZE / 2, 16);
            g.lineStyle(0);
          }
        }
      }

      // 2. Already-locked targets (#1..#3 for Carpet Run; PICKED origin for Paradrop Step 2)
      for (let i = 0; i < selected.length; i++) {
        const tile = tileById.get(selected[i]);
        if (!tile) continue;
        const px = tile.x * TILE_SIZE;
        const py = tile.y * TILE_SIZE;
        const lockedAccent = def.shape === 'RELOCATE' ? 0x34D399 : 0xFACC15;
        drawSpotlightBrackets(g, px, py, lockedAccent, 0xFFFFFF, 2, 14);
      }

      // Connecting bomber strike corridor between locked Carpet Run targets
      if (def.shape === 'UNITS3' && selected.length >= 2) {
        const pts: { x: number; y: number }[] = [];
        for (const id of selected) {
          const t = tileById.get(id);
          if (t) pts.push({ x: t.x * TILE_SIZE + TILE_SIZE / 2, y: t.y * TILE_SIZE + TILE_SIZE / 2 });
        }
        g.lineStyle(5, 0x020617, 0.65);
        for (let i = 0; i < pts.length - 1; i++) {
          g.moveTo(pts[i].x, pts[i].y);
          g.lineTo(pts[i + 1].x, pts[i + 1].y);
        }
        g.lineStyle(2.4, 0xFDE047, 0.96);
        for (let i = 0; i < pts.length - 1; i++) {
          g.moveTo(pts[i].x, pts[i].y);
          g.lineTo(pts[i + 1].x, pts[i + 1].y);
        }
        g.lineStyle(0);
      }

      // 3. Active hover preview ABOVE units
      const ht = hoveredTileId ? tileById.get(hoveredTileId) : undefined;
      if (!ht) return;
      const isLegal = validSet.has(ht.id);
      const isPicked = selectedSet.has(ht.id);
      const axis = placementMode.tacticalAxis ?? 'H';

      // 3a. Paradrop Step 2: curved flight arc from picked unit to hovered LZ
      if (def.shape === 'RELOCATE' && placementMode.tacticalUnitId && selected[0]) {
        const fromTile = tileById.get(selected[0]);
        if (fromTile && fromTile.id !== ht.id) {
          const fx = fromTile.x * TILE_SIZE + TILE_SIZE / 2;
          const fy = fromTile.y * TILE_SIZE + TILE_SIZE / 2;
          const tx = ht.x * TILE_SIZE + TILE_SIZE / 2;
          const ty = ht.y * TILE_SIZE + TILE_SIZE / 2;
          const mx = (fx + tx) / 2;
          const my = (fy + ty) / 2 - Math.min(76, Math.hypot(tx - fx, ty - fy) * 0.24);
          const arcCol = isLegal ? 0x34D399 : 0xF87171;
          g.lineStyle(5.5, 0x020617, 0.65);
          g.moveTo(fx, fy);
          g.quadraticCurveTo(mx, my, tx, ty);
          g.lineStyle(3, arcCol, 0.96);
          g.moveTo(fx, fy);
          g.quadraticCurveTo(mx, my, tx, ty);
          g.lineStyle(0);
          g.beginFill(arcCol, 0.98);
          g.drawCircle(tx, ty, 6);
          g.endFill();
        }
        if (isLegal || isPicked) {
          g.beginFill(0x10B981, 0.22);
          g.drawRect(ht.x * TILE_SIZE + 2, ht.y * TILE_SIZE + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.endFill();
          drawSpotlightBrackets(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE, 0x34D399, 0xFFFFFF, 2, 14);
        } else {
          drawBlockedX(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE);
        }
        return;
      }

      // 3b. Discrete unit/structure pick hover (UNITS3 candidate line, Fog sensor diamond, or crimson X on blocked tile)
      if (unitPickMode) {
        if (def.shape === 'UNITS3' && isLegal && selected.length > 0) {
          const last = tileById.get(selected[selected.length - 1]);
          if (last) {
            const lx = last.x * TILE_SIZE + TILE_SIZE / 2;
            const ly = last.y * TILE_SIZE + TILE_SIZE / 2;
            const tx = ht.x * TILE_SIZE + TILE_SIZE / 2;
            const ty = ht.y * TILE_SIZE + TILE_SIZE / 2;
            g.lineStyle(4.5, 0x020617, 0.55);
            g.moveTo(lx, ly);
            g.lineTo(tx, ty);
            g.lineStyle(2.2, 0xFDE047, 0.9);
            g.moveTo(lx, ly);
            g.lineTo(tx, ty);
            g.lineStyle(0);
          }
        }
        if (itemKey === 'RECON_DRONE' && isLegal && settings.fogOfWar) {
          const cx = ht.x * TILE_SIZE + TILE_SIZE / 2;
          const cy = ht.y * TILE_SIZE + TILE_SIZE / 2;
          const rad = 5 * TILE_SIZE + TILE_SIZE * 0.35;
          g.lineStyle(2, 0x38BDF8, 0.72);
          g.moveTo(cx, cy - rad);
          g.lineTo(cx + rad, cy);
          g.lineTo(cx, cy + rad);
          g.lineTo(cx - rad, cy);
          g.closePath();
          g.lineStyle(0);
        }
        if (!isLegal && !isPicked) {
          drawBlockedX(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE);
        }
        return;
      }

      // 3c. Multi-tile AoE / Corridor footprint hover (NAPALM_LINE 1×4, ARTILLERY_BARRAGE 2×10, SMOKE_SCREEN 3×3)
      if (hoveredFootprint && hoveredFootprint.length > 0) {
        const fillCol = isLegal ? accent : 0xEF4444;
        const rimCol = isLegal ? rim : 0xFCA5A5;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let i = 0; i < hoveredFootprint.length; i++) {
          const ft = hoveredFootprint[i];
          if (ft.x < minX) minX = ft.x;
          if (ft.y < minY) minY = ft.y;
          if (ft.x > maxX) maxX = ft.x;
          if (ft.y > maxY) maxY = ft.y;

          const px = ft.x * TILE_SIZE;
          const py = ft.y * TILE_SIZE;
          g.beginFill(fillCol, isLegal ? 0.24 : 0.22);
          g.drawRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
          g.endFill();

          // Directional sweep chevrons for LINE4 & LANE
          if (def.shape === 'LINE4' || def.shape === 'LANE') {
            const cx = px + TILE_SIZE / 2;
            const cy = py + TILE_SIZE / 2;
            g.lineStyle(2.4, rimCol, isLegal ? 0.92 : 0.72);
            if (axis === 'H') {
              g.moveTo(cx - 6, cy - 8);
              g.lineTo(cx + 5, cy);
              g.lineTo(cx - 6, cy + 8);
            } else {
              g.moveTo(cx - 8, cy - 6);
              g.lineTo(cx, cy + 5);
              g.lineTo(cx + 8, cy - 6);
            }
            g.lineStyle(0);
          }

          // Highlight units caught inside the hovered AoE blast!
          const victim = unitByTile.get(ft.id);
          if (victim && isLegal && (itemKey === 'NAPALM_LINE' || itemKey === 'ARTILLERY_BARRAGE')) {
            const isAlly = victim.owner === currentPlayer;
            drawSpotlightBrackets(g, px, py, isAlly ? 0xF59E0B : 0xEF4444, 0xFEF08A, 3, 11);
          }
        }

        // Bold outer footprint perimeter (double-stroked for crisp visibility on every terrain)
        const bx = minX * TILE_SIZE;
        const by = minY * TILE_SIZE;
        const bw = (maxX - minX + 1) * TILE_SIZE;
        const bh = (maxY - minY + 1) * TILE_SIZE;
        g.lineStyle(5.5, 0x020617, 0.75);
        g.drawRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
        g.lineStyle(2.8, rimCol, 0.98);
        g.drawRect(bx + 1.5, by + 1.5, bw - 3, bh - 3);
        g.lineStyle(0);

        drawSpotlightBrackets(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE, rimCol, 0xFFFFFF, 2, 13);
      } else {
        drawBlockedX(g, ht.x * TILE_SIZE, ht.y * TILE_SIZE);
      }
    },
    [
      isTactical,
      placementMode,
      hoveredTileId,
      tileById,
      unitByTile,
      currentPlayer,
      settings.fogOfWar,
      hoveredFootprint,
    ],
  );

  if (!isTactical) return null;

  return (
    <Container name="tactical_targeting_overlay" eventMode="none">
      <Graphics draw={draw} eventMode="none" />
      {badges.map(b => (
        <Container key={b.key} x={b.x} y={b.y} angle={-mapRotation} eventMode="none">
          <Graphics
            eventMode="none"
            draw={g => {
              g.clear();
              const w = Math.max(26, b.text.length * 6.8 + 10);
              const h = 15;
              const topY = -TILE_SIZE / 2 - 2;
              g.lineStyle(1.4, b.borderPixi, 0.96);
              g.beginFill(b.bgPixi, 0.94);
              g.drawRoundedRect(-w / 2, topY, w, h, 4);
              g.endFill();
              g.lineStyle(0);
            }}
          />
          <Text
            text={b.text}
            anchor={0.5}
            x={0}
            y={-TILE_SIZE / 2 + 5.5}
            style={TAG_TEXT_STYLES[b.tone]}
          />
        </Container>
      ))}
    </Container>
  );
});
