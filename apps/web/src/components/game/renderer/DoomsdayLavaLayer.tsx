import React, { useEffect, useRef } from 'react';
import { Container, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import type { DoomsdayZone } from '@tactical/engine/types';
import { getDoomsdayNextRadius, getDoomsdayRadius } from '@tactical/engine/grid/DoomsdayManager';
import { TILE_SIZE } from '@tactical/engine/constants/Config';

/**
 * Doomsday lava field.
 *
 * This is deliberately not a full-screen colour wash. It is a quiet, semi-transparent layer of
 * cooled lava crust with a few slow ember seams, drawn as a world-space mesh over the board. The
 * mesh vertices and UVs are fixed in board coordinates, so the field is locked to the terrain and
 * cannot drift with the camera or filter area. One draw call; no filter render target.
 *
 * The tile hazard remains gameplay-authoritative; this only supplies the soft edge and material
 * treatment between the tile states. The warning band and rim stay restrained so they read as
 * part of the tactical map instead of an overlay.
 */

const LAVA_VERTEX = `
precision highp float;

attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;

uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;

varying vec2 vTextureCoord;

void main() {
  vTextureCoord = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}
`;

const LAVA_FRAGMENT = `
precision highp float;

varying vec2 vTextureCoord;

uniform float uTime;
uniform vec2  uCenter;
uniform float uRadius;
uniform float uNextRadius;
uniform float uGrid;
uniform float uWarning;
uniform float uHeat;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));

  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += valueNoise(p) * amp;
    p = rot * p * 2.03 + 17.17;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = vTextureCoord * uGrid;
  float d = distance(p, uCenter);

  // Only a hint of contour movement, so the safe boundary never looks like a wobbling blob.
  float drift = uTime * 0.012;
  float edgeNoise = fbm(p * 0.34 + vec2(drift, -drift * 0.7));
  float edgeDist = d + (edgeNoise - 0.5) * 0.08;
  float lavaMask = smoothstep(uRadius - 0.58, uRadius + 0.10, edgeDist);

  // Broad crust noise. The motion is intentionally slow enough to sit behind the map animation.
  vec2 flow = p * 0.20;
  flow += vec2(
    fbm(flow * 0.80 + vec2(uTime * 0.010, -uTime * 0.007)),
    fbm(flow * 0.80 + vec2(-uTime * 0.008, uTime * 0.012))
  ) * 0.26;

  float crust = fbm(flow + vec2(uTime * 0.014, -uTime * 0.010));
  float seams = fbm(p * 0.50 + vec2(crust * 0.82, uTime * 0.010));
  float seam = smoothstep(0.48, 0.70, seams) * smoothstep(0.10, 0.62, crust);
  float ember = seam * (0.52 + uHeat * 0.20);
  float emberField = smoothstep(0.20, 0.78, crust);

  // Thin isolines through the slow crust noise read as molten fissures rather than a flat wash.
  float fissure = 1.0 - smoothstep(0.0, 0.045, abs(seams - 0.58));
  float fissureGlow = 1.0 - smoothstep(0.0, 0.10, abs(seams - 0.58));

  // Sparse hot pinpricks: enough to suggest molten rock under the crust, not a light show.
  float glint = smoothstep(0.93, 0.99, fbm(p * 2.7 + vec2(uTime * 0.020, -uTime * 0.016)));

  vec3 charred = vec3(0.052, 0.030, 0.025);
  vec3 ash     = vec3(0.145, 0.086, 0.064);
  vec3 warm    = vec3(0.420, 0.090, 0.020);
  vec3 hot     = vec3(0.720, 0.220, 0.040);

  vec3 col = mix(charred, ash, 0.36 + crust * 0.38);
  col = mix(col, warm, emberField * 0.38 + ember);
  col = mix(col, hot, seam * smoothstep(0.48, 0.90, crust) * 0.38 + glint * 0.26);
  col = mix(col, warm, fissureGlow * 0.22);
  col = mix(col, hot, fissure * 0.52);

  // A thin cooled lip, not a white-hot ring. It keeps the circle readable at map zoom.
  float rim = exp(-pow((edgeDist - uRadius) / 0.10, 2.0));
  col = mix(col, vec3(0.78, 0.29, 0.065), rim * 0.38);

  // The warning band is mostly an amber stain in the ground, never a glowing overlay.
  float band = smoothstep(uNextRadius - 0.30, uNextRadius + 0.30, d)
             * (1.0 - smoothstep(uRadius - 0.30, uRadius + 0.30, d));
  float bandPulse = 0.5 + 0.5 * sin(uTime * 0.9 - d * 1.3);
  col = mix(col, vec3(0.54, 0.21, 0.055), band * (0.07 + 0.035 * bandPulse) * uWarning);

  float alpha = lavaMask * (0.52 + crust * 0.06 + seam * 0.22 + fissure * 0.20 + glint * 0.12);
  alpha = max(alpha, rim * 0.44);
  alpha = max(alpha, band * (0.045 + 0.025 * bandPulse) * uWarning);
  alpha = clamp(alpha, 0.0, 0.78);

  gl_FragColor = vec4(col * alpha, alpha);
}
`;

interface DoomsdayLavaLayerProps {
  zone: DoomsdayZone;
  gridSize: number;
  totalTurns: number;
  animate: boolean;
}

const DoomsdayLavaLayerInner: React.FC<DoomsdayLavaLayerProps> = ({ zone, gridSize, totalTurns, animate }) => {
  const rootRef = useRef<PIXI.Container>(null);
  const shaderRef = useRef<PIXI.Shader | null>(null);
  const timeRef = useRef(0);

  const boardSize = gridSize * TILE_SIZE;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const shader = PIXI.Shader.from(LAVA_VERTEX, LAVA_FRAGMENT, {
      uTime: 0,
      uCenter: [zone.center.x, zone.center.y],
      uRadius: zone.startRadius,
      uNextRadius: zone.startRadius,
      uGrid: gridSize,
      uWarning: 0,
      uHeat: 0,
    });

    const geometry = new PIXI.Geometry()
      .addAttribute(
        'aVertexPosition',
        [0, 0, boardSize, 0, boardSize, boardSize, 0, boardSize],
        2,
      )
      .addAttribute('aTextureCoord', [0, 0, 1, 0, 1, 1, 0, 1], 2)
      .addIndex([0, 1, 2, 0, 2, 3]);

    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.name = 'doomsday_lava_field_surface';
    mesh.eventMode = 'none';
    mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
    root.addChild(mesh);
    shaderRef.current = shader;

    const radius = getDoomsdayRadius(zone, totalTurns);
    const nextRadius = getDoomsdayNextRadius(zone, totalTurns);
    const span = Math.max(0.001, zone.startRadius - zone.endRadius);
    const heat = Math.max(0, Math.min(1, (zone.startRadius - radius) / span));

    shader.uniforms.uCenter = [zone.center.x, zone.center.y];
    shader.uniforms.uRadius = radius;
    shader.uniforms.uNextRadius = nextRadius;
    shader.uniforms.uGrid = gridSize;
    shader.uniforms.uWarning = nextRadius < radius - 0.01 ? 1 : 0;
    shader.uniforms.uHeat = heat;
    shader.uniforms.uTime = animate ? timeRef.current : 0;

    return () => {
      if (mesh.parent === root) root.removeChild(mesh);
      if (shaderRef.current === shader) shaderRef.current = null;
      if (!mesh.destroyed) mesh.destroy();
      geometry.destroy();
      shader.destroy();
    };
  }, [boardSize]);

  useEffect(() => {
    const current = shaderRef.current;
    if (!current) return;

    const radius = getDoomsdayRadius(zone, totalTurns);
    const nextRadius = getDoomsdayNextRadius(zone, totalTurns);
    const span = Math.max(0.001, zone.startRadius - zone.endRadius);
    const heat = Math.max(0, Math.min(1, (zone.startRadius - radius) / span));

    current.uniforms.uCenter = [zone.center.x, zone.center.y];
    current.uniforms.uRadius = radius;
    current.uniforms.uNextRadius = nextRadius;
    current.uniforms.uGrid = gridSize;
    current.uniforms.uWarning = nextRadius < radius - 0.01 ? 1 : 0;
    current.uniforms.uHeat = heat;
    if (!animate) {
      timeRef.current = 0;
      current.uniforms.uTime = 0;
    }
  }, [zone, totalTurns, gridSize, animate]);

  useTick(delta => {
    if (!animate) return;
    const current = shaderRef.current;
    if (!current) return;

    const step = Math.min(3, Math.max(0.2, typeof delta === 'number' ? delta : 1));
    timeRef.current += step / 60;
    current.uniforms.uTime = timeRef.current;
  });

  return <Container ref={rootRef} name="doomsday_lava_field" eventMode="none" />;
};

export const DoomsdayLavaLayer: React.FC<DoomsdayLavaLayerProps> = React.memo(props => {
  if (!props.zone) return null;
  return <DoomsdayLavaLayerInner {...props} />;
});
