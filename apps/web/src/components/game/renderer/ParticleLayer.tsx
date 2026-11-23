import React, { useEffect, useRef } from 'react';
import { Container } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { BoardRotation } from '../../../core/boardRotation';
import { ParticlePool } from '../../../core/graphics/ParticlePool';

interface ParticleLayerProps {
  mapRotation: BoardRotation;
  poolRef: React.MutableRefObject<ParticlePool | null>;
}

/**
 * Single Pixi Container hosting the zero-allocation pooled particle system.
 * Driven directly by `FxTimelineDriver` so particle stepping respects hit-stop and delta clamping.
 */
export const ParticleLayer: React.FC<ParticleLayerProps> = React.memo(({ mapRotation, poolRef }) => {
  const containerRef = useRef<PIXI.Container>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const pool = new ParticlePool(root);
    pool.setMapRotation(mapRotation);
    poolRef.current = pool;

    return () => {
      poolRef.current = null;
      pool.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    poolRef.current?.setMapRotation(mapRotation);
  }, [mapRotation, poolRef]);

  return <Container ref={containerRef} name="pooled_particles" eventMode="none" />;
});
