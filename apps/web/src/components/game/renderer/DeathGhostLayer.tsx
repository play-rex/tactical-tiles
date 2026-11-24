import React, { useCallback, useEffect, useRef } from 'react';
import { Container, Graphics, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { SafeSprite } from '../SafeSprite';
import { getTexture } from '../../../core/graphics/TextureManager';
import {
  fxTimeline,
  getPrefersReducedMotion,
  subscribeReducedMotion,
} from '../../../core/graphics/fxTimeline';
import { useEffectStore, type DeathGhost } from '../../../store/useEffectStore';

const DeathGhostSprite: React.FC<{ data: DeathGhost }> = React.memo(({ data }) => {
  const rootRef = useRef<PIXI.Container>(null);
  const flashRef = useRef<PIXI.Graphics>(null);
  const elapsedRef = useRef(0);
  const reducedMotionRef = useRef<boolean>(getPrefersReducedMotion());

  const cx = data.x + TILE_SIZE / 2;
  const cy = data.y + TILE_SIZE / 2;
  const hasAngle = typeof data.incomingAngle === 'number' && Number.isFinite(data.incomingAngle);
  const knockDirX = hasAngle ? Math.cos(data.incomingAngle!) : 0;
  const knockDirY = hasAngle ? Math.sin(data.incomingAngle!) : -1;
  const spinSign = knockDirX >= 0 ? 1 : -1;
  const knockDistPx = data.cause === 'MINE' ? 22 : hasAngle ? 19 : 12;

  useEffect(() => {
    reducedMotionRef.current = getPrefersReducedMotion();
    return subscribeReducedMotion((reduced) => {
      reducedMotionRef.current = reduced;
    });
  }, []);

  const drawFlash = useCallback((g: PIXI.Graphics) => {
    g.clear();
    g.beginFill(0xFFE4E6, 1);
    g.drawCircle(0, 0, TILE_SIZE * 0.44);
    g.endFill();
  }, []);

  useTick(() => {
    const root = rootRef.current;
    if (!root || root.destroyed) return;

    const dtMs = fxTimeline.getLastCombatDtMs();
    elapsedRef.current += dtMs;
    const elapsed = elapsedRef.current;
    const duration = Math.max(200, data.durationMs || 550);
    const t = Math.min(1, elapsed / duration);

    // Single-pulse impact flash over first 95ms
    if (flashRef.current && !flashRef.current.destroyed) {
      const flashT = elapsed / 95;
      if (flashT < 1) {
        flashRef.current.visible = true;
        flashRef.current.alpha = (1 - flashT) * 0.9;
      } else {
        flashRef.current.visible = false;
      }
    }

    if (reducedMotionRef.current) {
      root.position.set(cx, cy);
      root.scale.set(1, 1);
      root.rotation = 0;
      root.alpha = Math.max(0, 1 - t * t);
      return;
    }

    // Physical knockback trajectory along incoming bullet vector + impact squash-stretch tumble
    if (t < 0.15) {
      const p = t / 0.15;
      const push = knockDistPx * 0.25 * p;
      root.position.set(cx + knockDirX * push, cy + knockDirY * push);
      root.scale.set(1 + 0.18 * p, 1 - 0.12 * p);
      root.rotation = spinSign * 0.12 * p;
      root.alpha = 1;
    } else {
      const p = (t - 0.15) / 0.85;
      const easeOut = 1 - Math.pow(1 - p, 2.3);
      const easeIn = p * p;
      const push = knockDistPx * (0.25 + 0.75 * easeOut);
      root.position.set(cx + knockDirX * push, cy + knockDirY * push);
      const sc = Math.max(0.24, 1.12 - 0.88 * easeIn);
      root.scale.set(sc, sc * (1 - 0.08 * p));
      root.rotation = spinSign * (0.12 + 0.82 * easeOut);
      root.alpha = Math.max(0, 1 - Math.pow(p, 1.4));
    }
  });

  const texture = getTexture(`UNIT_P${data.owner}_${data.unitType}`);

  return (
    <Container ref={rootRef} x={cx} y={cy} eventMode="none">
      <SafeSprite
        texture={texture}
        width={TILE_SIZE}
        height={TILE_SIZE}
        tint={0xFCA5A5}
        anchor={[0.5, 0.5]}
        x={0}
        y={0}
      />
      <Graphics ref={flashRef} draw={drawFlash} eventMode="none" />
    </Container>
  );
});

/** Isolated layer rendering 550ms dying unit sprites with directional knockback tumble. */
export const DeathGhostLayer: React.FC = React.memo(() => {
  const deathGhosts = useEffectStore(state => state.deathGhosts);
  if (deathGhosts.length === 0) return null;
  return (
    <Container name="death_ghosts" eventMode="none">
      {deathGhosts.map(ghost => (
        <DeathGhostSprite key={ghost.id} data={ghost} />
      ))}
    </Container>
  );
});
