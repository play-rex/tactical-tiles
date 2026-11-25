import React, { useEffect, useRef, useState } from 'react';
import { Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { subscribeUnitLocate, type UnitLocatePing } from '../../../core/unitLocate';
import { wakeBattleRenderer } from '../../../store/useEffectStore';

const LIFE_MS = 1600;

/**
 * A short gold pulse over the unit picked in the squad HUD: two expanding rings, corner brackets
 * on its tile and a centre diamond, so a click in the roster visibly answers on the map.
 */
export const UnitLocatePingLayer: React.FC = () => {
  const [ping, setPing] = useState<UnitLocatePing | null>(null);
  const graphicsRef = useRef<PIXI.Graphics>(null);
  const startedAtRef = useRef(0);

  useEffect(
    () =>
      subscribeUnitLocate(next => {
        startedAtRef.current = performance.now();
        setPing(next);
        wakeBattleRenderer(LIFE_MS + 300);
      }),
    [],
  );

  useTick(() => {
    const g = graphicsRef.current;
    if (!g || !ping) return;

    const progress = (performance.now() - startedAtRef.current) / LIFE_MS;
    if (progress >= 1) {
      g.clear();
      setPing(null);
      return;
    }

    const fade = 1 - progress;
    g.clear();

    // Tile brackets frame the spot without hiding the unit sprite.
    const half = TILE_SIZE * 0.47;
    const arm = TILE_SIZE * 0.2;
    g.lineStyle(2, 0xfbbf24, 0.45 + fade * 0.55);
    g.moveTo(-half, -half + arm); g.lineTo(-half, -half); g.lineTo(-half + arm, -half);
    g.moveTo(half - arm, -half); g.lineTo(half, -half); g.lineTo(half, -half + arm);
    g.moveTo(half, half - arm); g.lineTo(half, half); g.lineTo(half - arm, half);
    g.moveTo(-half + arm, half); g.lineTo(-half, half); g.lineTo(-half, half - arm);

    // Two rings, the outer expanding faster, so the eye lands on the tile.
    g.lineStyle(3, 0xfbbf24, 0.9 * fade);
    g.drawCircle(0, 0, TILE_SIZE * (0.34 + progress * 1.05));
    g.lineStyle(1.5, 0xffffff, 0.75 * fade);
    g.drawCircle(0, 0, TILE_SIZE * (0.2 + progress * 0.55));

    // Centre diamond keeps a steady mark after the rings have grown past the tile.
    const diamond = TILE_SIZE * 0.15 * (1 + Math.sin(progress * Math.PI) * 0.35);
    g.beginFill(0xfbbf24, 0.92 * fade);
    g.drawPolygon([0, -diamond, diamond, 0, 0, diamond, -diamond, 0]);
    g.endFill();
  });

  if (!ping) return null;
  const [tileX, tileY] = ping.tileId.split(',').map(Number);
  if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) return null;

  return (
    <Graphics
      ref={graphicsRef}
      x={(tileX + 0.5) * TILE_SIZE}
      y={(tileY + 0.5) * TILE_SIZE}
      eventMode="none"
    />
  );
};
