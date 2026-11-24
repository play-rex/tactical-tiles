import React, { useEffect, useRef } from 'react';
import { Container, useApp, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import {
  getPrefersReducedMotion,
  subscribeReducedMotion,
} from '../../../core/graphics/fxTimeline';

let cachedCausticTexture: PIXI.Texture | null = null;

/** Pre-bakes a seamless tileable 128×128 specular water caustic texture once. */
const getCausticTexture = (): PIXI.Texture => {
  if (cachedCausticTexture && !cachedCausticTexture.baseTexture.destroyed) {
    return cachedCausticTexture;
  }
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    // Soft diagonal specular wave bands wrapping seamlessly at tile edges
    const bands = [
      { y: 18, amp: 5, lw: 3.5, alpha: 0.42 },
      { y: 52, amp: 6, lw: 4.5, alpha: 0.55 },
      { y: 88, amp: 4.5, lw: 3.0, alpha: 0.38 },
      { y: 116, amp: 5.5, lw: 4.0, alpha: 0.48 },
    ];
    for (const b of bands) {
      ctx.strokeStyle = `rgba(224, 242, 254, ${b.alpha})`;
      ctx.lineWidth = b.lw;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let x = 0; x <= size; x += 8) {
        const py = b.y + Math.sin((x / size) * Math.PI * 2 + b.y * 0.1) * b.amp;
        if (x === 0) ctx.moveTo(x, py);
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
    // Soft sun-glint caustic diamonds
    const glints = [
      { x: 24, y: 34, r: 9 },
      { x: 84, y: 20, r: 7 },
      { x: 64, y: 74, r: 10 },
      { x: 110, y: 102, r: 8 },
      { x: 18, y: 104, r: 7 },
    ];
    for (const gl of glints) {
      const grad = ctx.createRadialGradient(gl.x, gl.y, 0, gl.x, gl.y, gl.r);
      grad.addColorStop(0, 'rgba(255,255,255,0.68)');
      grad.addColorStop(0.5, 'rgba(186,230,253,0.22)');
      grad.addColorStop(1, 'rgba(186,230,253,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gl.x - gl.r, gl.y - gl.r, gl.r * 2, gl.r * 2);
    }
  }
  const tex = PIXI.Texture.from(canvas);
  tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
  cachedCausticTexture = tex;
  return tex;
};

interface WaterShimmerLayerProps {
  waterMaskTexture: PIXI.Texture;
  boardSize: number;
  animate: boolean;
}

/**
 * Rotation-safe masked water caustic shimmer mounted directly above `terrainTexture`
 * (outside `rotated_board`, inside `WorldShakeContainer`) so it stays pixel-locked
 * with `bakedBoard.waterMaskTexture` across 0°/90°/180°/270° rotations.
 * Completely hidden in ECO mode or under `prefers-reduced-motion` for zero stencil cost.
 */
export const WaterShimmerLayer: React.FC<WaterShimmerLayerProps> = React.memo(
  ({ waterMaskTexture, boardSize, animate }) => {
    const app = useApp();
    const rootRef = useRef<PIXI.Container>(null);
    const layerARef = useRef<PIXI.TilingSprite | null>(null);
    const layerBRef = useRef<PIXI.TilingSprite | null>(null);
    const maskSpriteRef = useRef<PIXI.Sprite | null>(null);
    const reducedMotionRef = useRef<boolean>(getPrefersReducedMotion());

    useEffect(() => {
      reducedMotionRef.current = getPrefersReducedMotion();
      return subscribeReducedMotion((reduced) => {
        reducedMotionRef.current = reduced;
        if (rootRef.current && !rootRef.current.destroyed) {
          rootRef.current.visible = animate && !reduced;
        }
      });
    }, [animate]);

    useEffect(() => {
      const root = rootRef.current;
      if (!root) return;

      const causticTex = getCausticTexture();
      const maskedGroup = new PIXI.Container();
      maskedGroup.eventMode = 'none';

      const layerA = new PIXI.TilingSprite(causticTex, boardSize, boardSize);
      layerA.alpha = 0.24;
      layerA.tint = 0xBAE6FD;
      layerA.blendMode = PIXI.BLEND_MODES.ADD;
      layerA.eventMode = 'none';

      const layerB = new PIXI.TilingSprite(causticTex, boardSize, boardSize);
      layerB.alpha = 0.14;
      layerB.tint = 0xE0F2FE;
      layerB.tileScale.set(0.76, 0.76);
      layerB.tilePosition.set(42, 28);
      layerB.blendMode = PIXI.BLEND_MODES.ADD;
      layerB.eventMode = 'none';

      const maskSprite = new PIXI.Sprite(waterMaskTexture);
      maskSprite.width = boardSize;
      maskSprite.height = boardSize;
      maskSprite.eventMode = 'none';

      maskedGroup.addChild(layerA);
      maskedGroup.addChild(layerB);
      maskedGroup.mask = maskSprite;

      root.addChild(maskedGroup);
      root.addChild(maskSprite);
      root.visible = animate && !reducedMotionRef.current;

      layerARef.current = layerA;
      layerBRef.current = layerB;
      maskSpriteRef.current = maskSprite;

      return () => {
        layerARef.current = null;
        layerBRef.current = null;
        maskSpriteRef.current = null;
        maskedGroup.mask = null;
        if (!maskedGroup.destroyed) maskedGroup.destroy({ children: true });
        if (!maskSprite.destroyed) maskSprite.destroy({ texture: false, baseTexture: false });
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (rootRef.current && !rootRef.current.destroyed) {
        rootRef.current.visible = animate && !reducedMotionRef.current;
      }
      if (layerARef.current && !layerARef.current.destroyed) {
        layerARef.current.width = boardSize;
        layerARef.current.height = boardSize;
      }
      if (layerBRef.current && !layerBRef.current.destroyed) {
        layerBRef.current.width = boardSize;
        layerBRef.current.height = boardSize;
      }
      if (maskSpriteRef.current && !maskSpriteRef.current.destroyed) {
        maskSpriteRef.current.texture = waterMaskTexture;
        maskSpriteRef.current.width = boardSize;
        maskSpriteRef.current.height = boardSize;
      }
    }, [waterMaskTexture, boardSize, animate]);

    useTick(() => {
      if (!animate || reducedMotionRef.current) return;
      const layerA = layerARef.current;
      const layerB = layerBRef.current;
      if (!layerA || !layerB || layerA.destroyed || layerB.destroyed) return;

      const dtSec = Math.min(0.05, Math.max(0, ((app as any)?.ticker?.deltaMS ?? 16.67) / 1000));
      layerA.tilePosition.x = (layerA.tilePosition.x + 12 * dtSec) % 128;
      layerA.tilePosition.y = (layerA.tilePosition.y + 6.5 * dtSec) % 128;
      layerB.tilePosition.x = (layerB.tilePosition.x - 7.5 * dtSec + 128) % 128;
      layerB.tilePosition.y = (layerB.tilePosition.y + 9.5 * dtSec) % 128;
    });

    return <Container ref={rootRef} name="water_shimmer" eventMode="none" />;
  },
);
