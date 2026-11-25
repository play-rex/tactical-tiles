import React, { useEffect, useRef, useState } from 'react';
import { TILE_SIZE } from '@tactical/engine/constants/Config';
import { useViewportContext } from '../../../context/ViewportContext';
import { unrotateBoardPoint } from '../../../core/boardRotation';
import { useGameStore, type DevBrush } from '../../../store/useGameStore';
import { useEffectStore } from '../../../store/useEffectStore';
import { fxTimeline } from '../../../core/graphics/fxTimeline';
import {
  DEV_EVENT_CATALOG,
  DEV_EVENT_GROUPS,
  devEventCoverage,
  type DevEventGroup,
  type DevEventKind,
} from '../../../core/dev/devEventMatrix';
import { KILL_CAM_CAUSE_LABEL, KILL_CAM_STYLES, KILL_CAM_TIERS } from '../../../core/graphics/killCam';

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

/** The panel renders the coverage matrix, so no cut can exist without a way to audition it. */
const COVERAGE = devEventCoverage();

type DevTabId = DevEventGroup | 'BRUSHES';
type BrushSubTab = 'TERRAIN' | 'STRUCTURES' | 'UNITS';

const TABS: { id: DevTabId; label: string }[] = [
  // Put Tactical Weapons first for fast auditioning, followed by all remaining event groups + Brushes.
  ...DEV_EVENT_GROUPS.filter(g => g.id === 'TACTICAL'),
  ...DEV_EVENT_GROUPS.filter(g => g.id !== 'TACTICAL'),
  { id: 'BRUSHES', label: 'BRUSHES' },
];

/**
 * Compact, content-first Dev Sandbox dock:
 * - Single-row tabs + single-row action strip keeps dock height under ~90px (<12% of map viewport).
 * - Automatically slides completely out of view while FX or Kill Cams play (z-index 42 < KillCam 44)
 *   so animations and camera cuts are 100% unobstructed, then returns when settled.
 * - Armed brushes fold the strip down to a single 28px bar while painting on the board.
 */
export const DevOverlay: React.FC = () => {
  const devSandbox = useGameStore(s => s.devSandbox);
  const devPlace = useGameStore(s => s.devPlace);
  const devFireEvent = useGameStore(s => s.devFireEvent);
  const devFreeplay = useGameStore(s => s.devFreeplay);
  const setDevFreeplay = useGameStore(s => s.setDevFreeplay);
  const devBotMatch = useGameStore(s => s.devBotMatch);
  const setDevBotMatch = useGameStore(s => s.setDevBotMatch);
  const resetGame = useGameStore(s => s.resetGame);
  const mapRotation = useGameStore(s => s.mapRotation);
  const gridSize = useGameStore(s => s.gridSize);
  const killCamActive = useEffectStore(s => s.killCamActive);
  const { viewport } = useViewportContext();

  const [brush, setBrush] = useState<{ label: string; brush: DevBrush } | null>(null);
  const [open, setOpen] = useState(() => !useGameStore.getState().devBotMatch);
  const [activeTab, setActiveTab] = useState<DevTabId>('TACTICAL');
  const [brushSubTab, setBrushSubTab] = useState<BrushSubTab>('TERRAIN');
  const [autoHideOnFx, setAutoHideOnFx] = useState(true);
  const [fxActive, setFxActive] = useState(() => fxTimeline.isActive());
  const [lastFired, setLastFired] = useState<{ kind: DevEventKind; label: string } | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setOpen(!devBotMatch);
  }, [devBotMatch]);

  useEffect(() => {
    return fxTimeline.subscribeActive(active => setFxActive(active));
  }, []);

  // Backtick (`) toggles Dev Dock cleanly without touching unit hotkeys
  useEffect(() => {
    if (!devSandbox) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '`') {
        e.preventDefault();
        setOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [devSandbox]);

  if (!devSandbox) return null;
  const boardSize = gridSize * TILE_SIZE;

  const paint = (clientX: number, clientY: number, rect: DOMRect) => {
    if (!brush || !viewport || viewport.destroyed) return;
    const world = viewport.toWorld(clientX - rect.left, clientY - rect.top);
    const unrot = unrotateBoardPoint(world.x, world.y, mapRotation, boardSize);
    const gx = Math.floor(unrot.x / TILE_SIZE);
    const gy = Math.floor(unrot.y / TILE_SIZE);
    if (gx < 0 || gx >= gridSize || gy < 0 || gy >= gridSize) return;
    devPlace(gx, gy, brush.brush);
  };

  const toggleBrush = (item: { label: string; brush: DevBrush }) => {
    setBrush(cur => (cur && JSON.stringify(cur.brush) === JSON.stringify(item.brush) ? null : item));
  };

  const triggerEvent = (kind: DevEventKind, label: string) => {
    setLastFired({ kind, label });
    devFireEvent(kind);
  };

  const selectTab = (id: DevTabId) => {
    setActiveTab(id);
    if (!open) setOpen(true);
    tabRefs.current[id]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = TABS.length - 1;
    else return;
    e.preventDefault();
    const nextTab = TABS[nextIdx];
    selectTab(nextTab.id);
    tabRefs.current[nextTab.id]?.focus();
  };

  const watchingAnimation = autoHideOnFx && (killCamActive || fxActive);
  const showDrawerBody = open && !brush;
  const activeEvents = activeTab !== 'BRUSHES' ? DEV_EVENT_CATALOG.filter(spec => spec.group === activeTab) : [];
  const activeBrushes =
    brushSubTab === 'TERRAIN'
      ? TERRAIN_BRUSHES
      : brushSubTab === 'STRUCTURES'
        ? STRUCTURE_BRUSHES
        : UNIT_BRUSHES;

  const totalCauses = Object.keys(KILL_CAM_CAUSE_LABEL).length;
  const totalTiers = KILL_CAM_TIERS.length;
  const totalStyles = KILL_CAM_STYLES.length;
  const covSummary = `CAUSES ${COVERAGE.causes.length}/${totalCauses} · TIERS ${COVERAGE.tiers.length}/${totalTiers} · CAMERAS ${COVERAGE.styles.length}/${totalStyles}${COVERAGE.complete ? ' · COMPLETE' : ''}`;

  return (
    <>
      {brush && (
        <div
          onPointerDown={e => {
            e.preventDefault();
            paint(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          style={{ position: 'absolute', inset: 0, zIndex: 41, cursor: 'crosshair', touchAction: 'none' }}
        />
      )}

      {watchingAnimation && !killCamActive && (
        <button
          type="button"
          className="tt-devdock__watchpill"
          onClick={() => setAutoHideOnFx(false)}
          title="Dock auto-hidden while animation plays — click to pin open"
        >
          ▶ PLAYING · PIN DEV
        </button>
      )}

      <div
        className={`tt-devdock${!showDrawerBody ? ' tt-devdock--collapsed' : ''}${watchingAnimation ? ' tt-devdock--watching' : ''}`}
      >
        <div className="tt-devdock__bar">
          <span className="tt-devdock__badge">{devBotMatch ? 'SIM' : 'DEV'}</span>
          <button
            type="button"
            className="tt-devdock__chip"
            onClick={() => {
              if (brush) setBrush(null);
              else setOpen(v => !v);
            }}
            title="Toggle Dev Dock (shortcut: `)"
          >
            {brush ? `BRUSH: ${brush.label} · CLEAR` : open ? 'HIDE' : 'TOOLS'}
          </button>

          {lastFired && (
            <button
              type="button"
              className="tt-devdock__chip tt-devdock__chip--replay"
              onClick={() => triggerEvent(lastFired.kind, lastFired.label)}
              title={`Replay ${lastFired.label}`}
            >
              ↻ {lastFired.label}
            </button>
          )}

          <button
            type="button"
            className={`tt-devdock__chip${devFreeplay ? ' tt-devdock__chip--active' : ''}`}
            onClick={() => setDevFreeplay(!devFreeplay)}
            title="No ranges, no CP, no turn lock: teleport units and strike anywhere"
          >
            SANDBOX {devFreeplay ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            className={`tt-devdock__chip${devBotMatch ? ' tt-devdock__chip--active' : ''}`}
            onClick={() => setDevBotMatch(!devBotMatch)}
            title="Both seats play themselves so you can watch live animations"
          >
            BOTS {devBotMatch ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            className={`tt-devdock__chip${autoHideOnFx ? ' tt-devdock__chip--active' : ''}`}
            onClick={() => setAutoHideOnFx(v => !v)}
            title="Automatically hide the Dev Dock while weapon animations and Kill Cams play"
          >
            AUTO-HIDE {autoHideOnFx ? 'ON' : 'OFF'}
          </button>

          <span
            className="tt-devdock__cov"
            style={{ color: COVERAGE.complete ? '#4ade80' : '#f59e0b' }}
            title={covSummary}
          >
            {COVERAGE.complete ? `✓ ${COVERAGE.styles.length}/${totalStyles} CAMS` : 'INCOMPLETE'}
          </span>

          <button type="button" className="tt-devdock__chip" onClick={resetGame}>
            EXIT
          </button>
        </div>

        {showDrawerBody && (
          <>
            <div className="tt-devdock__tablist" role="tablist" aria-label="Dev sandbox categories">
              {TABS.map((tab, idx) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={el => {
                      tabRefs.current[tab.id] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`devtab-${tab.id}`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    className="tt-devdock__tab"
                    onClick={() => selectTab(tab.id)}
                    onKeyDown={e => handleTabKeyDown(e, idx)}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div
              className="tt-devdock__strip"
              role="tabpanel"
              aria-labelledby={`devtab-${activeTab}`}
            >
              {activeTab === 'BRUSHES' ? (
                <>
                  {(['TERRAIN', 'STRUCTURES', 'UNITS'] as BrushSubTab[]).map(sub => (
                    <button
                      key={sub}
                      type="button"
                      className={`tt-devdock__chip${brushSubTab === sub ? ' tt-devdock__chip--active' : ''}`}
                      onClick={() => setBrushSubTab(sub)}
                    >
                      {sub}
                    </button>
                  ))}
                  <span className="tt-devdock__sep" aria-hidden="true" />
                  {activeBrushes.map(item => (
                    <button
                      key={item.label}
                      type="button"
                      className="tt-devdock__event"
                      onClick={() => toggleBrush(item)}
                      title="Click to arm brush, then click map tiles to paint"
                    >
                      {item.label}
                    </button>
                  ))}
                </>
              ) : (
                activeEvents.map(spec => (
                  <button
                    key={spec.kind}
                    type="button"
                    className="tt-devdock__event"
                    onClick={() => triggerEvent(spec.kind, spec.label)}
                    title={spec.hint}
                  >
                    {spec.label}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
};
