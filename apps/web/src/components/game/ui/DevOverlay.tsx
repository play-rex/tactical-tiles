import React, { useState } from 'react';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { useViewportContext } from '../../../context/ViewportContext';
import { unrotateBoardPoint } from '../../../core/boardRotation';
import { useGameStore, type DevBrush, type DevEventKind } from '../../../store/useGameStore';

const TERRAIN_BRUSHES: { label: string; brush: DevBrush }[] = [
  { label: 'GRASS', brush: { kind: 'TERRAIN', terrain: 'PLAINS' } },
  { label: 'SAND', brush: { kind: 'TERRAIN', terrain: 'SAND' } },
  { label: 'FOREST', brush: { kind: 'TERRAIN', terrain: 'FOREST' } },
  { label: 'MOUNTAIN', brush: { kind: 'TERRAIN', terrain: 'MOUNTAIN' } },
  { label: 'WATER', brush: { kind: 'TERRAIN', terrain: 'WATER' } },
  { label: 'BRIDGE', brush: { kind: 'TERRAIN', terrain: 'BRIDGE' } },
];

const STRUCTURE_BRUSHES: { label: string; brush: DevBrush }[] = [
  { label: 'HQ P1', brush: { kind: 'STRUCTURE', structure: 'BASE', owner: 0 } },
  { label: 'HQ P2', brush: { kind: 'STRUCTURE', structure: 'BASE', owner: 1 } },
  { label: 'BANK', brush: { kind: 'STRUCTURE', structure: 'BANK', owner: 0 } },
  { label: 'TOWER', brush: { kind: 'STRUCTURE', structure: 'WATCHTOWER', owner: 0 } },
  { label: 'BUNKER', brush: { kind: 'STRUCTURE', structure: 'BUNKER', owner: 0 } },
  { label: 'BARRIER', brush: { kind: 'STRUCTURE', structure: 'BARRIER', owner: 0 } },
];

const UNIT_BRUSHES: { label: string; brush: DevBrush }[] = [
  { label: 'SCOUT P1', brush: { kind: 'UNIT', unitType: 'SOLDIER', owner: 0 } },
  { label: 'BREACHER P1', brush: { kind: 'UNIT', unitType: 'ASSAULTER', owner: 0 } },
  { label: 'SNIPER P1', brush: { kind: 'UNIT', unitType: 'SNIPER', owner: 0 } },
  { label: 'SCOUT P2', brush: { kind: 'UNIT', unitType: 'SOLDIER', owner: 1 } },
  { label: 'BREACHER P2', brush: { kind: 'UNIT', unitType: 'ASSAULTER', owner: 1 } },
  { label: 'SNIPER P2', brush: { kind: 'UNIT', unitType: 'SNIPER', owner: 1 } },
];

const EVENTS: { label: string; kind: DevEventKind }[] = [
  { label: 'ATTACK HIT', kind: 'ATTACK_HIT' },
  { label: '1 HP GRAZE', kind: 'GRAZE_1HP' },
  { label: 'CINEMATIC KILL', kind: 'KILL_CINEMATIC' },
  { label: 'MICRO KILL', kind: 'KILL_MICRO' },
  { label: 'MINE CLICK', kind: 'MINE_CLICK' },
  { label: 'OVERWATCH KILL', kind: 'OVERWATCH_KILL' },
  { label: 'CROSSFIRE KILL', kind: 'CROSSFIRE_KILL' },
  { label: 'CORNER KILL', kind: 'CORNER_KILL' },
  { label: 'VAULT HEIST', kind: 'HEIST' },
  { label: 'BANK DEMOLISHED', kind: 'BANK_DEMOLISH' },
  { label: 'HQ BREACH', kind: 'HQ_BREACH' },
  { label: 'HQ DESTROYED', kind: 'HQ_DESTROY' },
  { label: 'POTM REPLAY', kind: 'POTM_REPLAY' },
  { label: 'EXPORT CLIP', kind: 'EXPORT_CLIP' },
  { label: 'TURN RECAP', kind: 'TURN_RECAP' },
];

const chip = (active: boolean): React.CSSProperties => ({
  background: active ? 'linear-gradient(180deg,#38bdf8,#0ea5e9)' : 'rgba(15,23,36,0.92)',
  border: `1px solid ${active ? '#0284c7' : 'rgba(148,163,184,0.35)'}`,
  color: active ? '#04121e' : '#cbd5e1',
  padding: '4px 7px',
  fontSize: 8.5,
  fontWeight: 900,
  letterSpacing: '0.14em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

const eventChip: React.CSSProperties = {
  background: 'linear-gradient(180deg,#1e293b,#0f172a)',
  border: '1px solid rgba(56,189,248,0.45)',
  color: '#7dd3fc',
  padding: '5px 8px',
  fontSize: 8.5,
  fontWeight: 900,
  letterSpacing: '0.14em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * Sandbox-only overlay.
 *
 * - A click-through layer turns the board into a paint surface while a brush is armed (same
 *   rotated-world → canonical-tile mapping the renderer uses for hover, so it works at any rotation
 *   and zoom).
 * - The panel fires scripted events through the real FX pipeline, so what you audition is exactly
 *   what a live match plays.
 */
export const DevOverlay: React.FC = () => {
  const devSandbox = useGameStore(s => s.devSandbox);
  const devPlace = useGameStore(s => s.devPlace);
  const devFireEvent = useGameStore(s => s.devFireEvent);
  const devFreeplay = useGameStore(s => s.devFreeplay);
  const setDevFreeplay = useGameStore(s => s.setDevFreeplay);
  const resetGame = useGameStore(s => s.resetGame);
  const mapRotation = useGameStore(s => s.mapRotation);
  const gridSize = useGameStore(s => s.gridSize);
  const { viewport } = useViewportContext();

  const [brush, setBrush] = useState<DevBrush | null>(null);
  const [open, setOpen] = useState(true);

  if (!devSandbox) return null;
  const boardSize = gridSize * TILE_SIZE;

  const paint = (clientX: number, clientY: number, rect: DOMRect) => {
    if (!brush || !viewport || viewport.destroyed) return;
    const world = viewport.toWorld(clientX - rect.left, clientY - rect.top);
    const unrot = unrotateBoardPoint(world.x, world.y, mapRotation, boardSize);
    const gx = Math.floor(unrot.x / TILE_SIZE);
    const gy = Math.floor(unrot.y / TILE_SIZE);
    if (gx < 0 || gx >= gridSize || gy < 0 || gy >= gridSize) return;
    devPlace(gx, gy, brush);
  };

  const toggle = (next: DevBrush) => {
    setBrush(cur => (JSON.stringify(cur) === JSON.stringify(next) ? null : next));
  };

  return (
    <>
      {brush && (
        <div
          onPointerDown={e => {
            e.preventDefault();
            paint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          style={{ position: 'absolute', inset: 0, zIndex: 43, cursor: 'crosshair', touchAction: 'none' }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          zIndex: 45,
          maxWidth: 'calc(100% - 16px)',
          background: 'rgba(6,10,17,0.94)',
          border: '1px solid rgba(56,189,248,0.4)',
          boxShadow: '0 16px 40px -18px #000',
          padding: '7px 9px',
          display: 'grid',
          gap: 6,
          color: '#cbd5e1',
          fontFamily: '"Space Grotesk","Avenir Next",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.24em', color: '#7dd3fc' }}>DEV</span>
          <button onClick={() => setOpen(v => !v)} style={{ ...chip(false), padding: '2px 6px' }}>
            {open ? 'HIDE' : 'SHOW'}
          </button>
          <button
            onClick={() => setDevFreeplay(!devFreeplay)}
            title="No ranges, no CP, no turn lock: teleport units and strike anywhere"
            style={{ ...chip(devFreeplay), padding: '2px 6px' }}
          >
            PURE SANDBOX {devFreeplay ? 'ON' : 'OFF'}
          </button>
          {brush && (
            <button onClick={() => setBrush(null)} style={{ ...chip(true), padding: '2px 6px' }}>
              BRUSH ON · CLEAR
            </button>
          )}
          <button onClick={resetGame} style={{ ...chip(false), padding: '2px 6px', marginLeft: 'auto' }}>
            EXIT DEV
          </button>
        </div>

        {open && (
          <>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {EVENTS.map(ev => (
                <button key={ev.kind} onClick={() => devFireEvent(ev.kind)} style={eventChip}>
                  {ev.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 520 }}>
              {TERRAIN_BRUSHES.map(item => (
                <button
                  key={item.label}
                  onClick={() => toggle(item.brush)}
                  style={chip(JSON.stringify(brush) === JSON.stringify(item.brush))}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 520 }}>
              {STRUCTURE_BRUSHES.map(item => (
                <button
                  key={item.label}
                  onClick={() => toggle(item.brush)}
                  style={chip(JSON.stringify(brush) === JSON.stringify(item.brush))}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 520 }}>
              {UNIT_BRUSHES.map(item => (
                <button
                  key={item.label}
                  onClick={() => toggle(item.brush)}
                  style={chip(JSON.stringify(brush) === JSON.stringify(item.brush))}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <span style={{ fontSize: 8.5, letterSpacing: '0.12em', color: '#64748b' }}>
              {brush
                ? 'CLICK THE BOARD TO PLACE · BRUSH STAYS ARMED'
                : devFreeplay
                  ? 'CLICK A UNIT, THEN ANY TILE TO TELEPORT IT · CLICK AN ENEMY, BANK, ENEMY HQ OR BARRIER TO STRIKE — NO RANGE, NO CP'
                  : 'PICK A BRUSH, THEN CLICK THE BOARD'}
            </span>
          </>
        )}
      </div>
    </>
  );
};
