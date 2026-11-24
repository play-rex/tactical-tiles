import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  createGeneratedGame,
  decodeMapCode,
  detectMatchingPreset,
  encodeMapCode,
  generateSectorSeed,
  GRID_SIZE_OPTIONS,
  isClassicDynamicConfig,
  MAP_GEN_PRESETS,
  MAP_PRESET_BY_ID,
  minGridSizeForPlayers,
  normalizeSeed,
  resolveEffectiveGridSize,
  resolveMapGenKnobs,
  rollWildcardKnobs,
  type GridSizeOption,
  type MapGenConfig,
  type MapGenKnobs,
  type MapPresetId,
  type MapSymmetry,
  type TableSettings,
  type Tile,
  type WaterStyle,
} from '@tactical/engine';
import { renderTacticalReconCanvases } from '../../core/graphics/TacticalReconRenderer';
import { useCopyState } from '../../hooks/useCopyState';
import { GeoButton, GeoCard, GeoChip, GeoToggle, GeoWell, PLAYER_UI_THEME } from './GeoPrimitives';
import { SECTION_LABEL } from './MatchRulesControls';

export interface MapCustomizerDialogProps {
  open: boolean;
  readOnly?: boolean;
  seed: string;
  mapGen?: MapGenConfig;
  playerCount: number;
  unitCounts: TableSettings['unitCounts'];
  onClose: () => void;
  onApply: (nextSeed: string, nextMapGen: MapGenConfig) => void;
  /** Optional debounced live broadcast hook for Online Lobby hosts so guests watch changes live. */
  onLiveSync?: (nextSeed: string, nextMapGen: MapGenConfig) => void;
  /** Notifies Online Lobby when host opens/closes the customizer dialog. */
  onCustomizingChange?: (active: boolean) => void;
}

const WATER_STYLES: ReadonlyArray<{ id: WaterStyle; label: string; icon: string }> = [
  { id: 'RIVERS', label: 'Rivers', icon: '🌊' },
  { id: 'ISLANDS', label: 'Islands', icon: '🏝️' },
  { id: 'CANYON', label: 'Canyon', icon: '🪨' },
  { id: 'NONE', label: 'Dry', icon: '☀️' },
];

interface KnobSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

const KnobSlider: React.FC<KnobSliderProps> = ({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  hint,
  disabled = false,
  onChange,
}) => (
  <div style={{ display: 'grid', gap: '3px' }}>
    <label
      htmlFor={id}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', cursor: disabled ? 'default' : 'pointer' }}
    >
      <span style={{ fontSize: '11.5px', fontWeight: 900, color: 'var(--op-ink)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--acc-blue-ink)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {suffix}
      </span>
    </label>
    <input
      id={id}
      className="opgeo-range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-valuetext={`${value}${suffix}`}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%' }}
    />
    {hint ? (
      <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--op-ink-muted)', lineHeight: 1.3 }}>
        {hint}
      </span>
    ) : null}
  </div>
);

/** Draws HD map + clean HQ & Bank overlays onto the customizer preview canvas. */
function drawPreviewCanvas(canvas: HTMLCanvasElement, mapData: Tile[], gridSize: number): void {
  const { terrainCanvas } = renderTacticalReconCanvases(mapData, gridSize, 0);
  if (canvas.width !== terrainCanvas.width) canvas.width = terrainCanvas.width;
  if (canvas.height !== terrainCanvas.height) canvas.height = terrainCanvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(terrainCanvas, 0, 0);

  const tilePx = canvas.width / Math.max(1, gridSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const tile of mapData) {
    if (tile.type === 'BANK') {
      const cx = (tile.x + 0.5) * tilePx;
      const cy = (tile.y + 0.5) * tilePx;
      const r = tilePx * 0.34;
      ctx.fillStyle = '#1C1200';
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1C1200';
      ctx.font = `900 ${Math.round(r * 1.25)}px system-ui, -apple-system, sans-serif`;
      ctx.fillText('€', cx, cy + 0.5);
    } else if (tile.type === 'BASE' && typeof tile.owner === 'number') {
      const cx = (tile.x + 0.5) * tilePx;
      const cy = (tile.y + 0.5) * tilePx;
      const theme = PLAYER_UI_THEME[tile.owner] ?? PLAYER_UI_THEME[0];
      const boxW = tilePx * 0.86;
      const boxH = tilePx * 0.56;
      const rx = cx - boxW / 2;
      const ry = cy - boxH / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.roundRect(rx - 2, ry - 2, boxW + 4, boxH + 4, 5);
      ctx.fill();
      ctx.fillStyle = theme.badgeBg;
      ctx.beginPath();
      ctx.roundRect(rx, ry, boxW, boxH, 4);
      ctx.fill();
      ctx.fillStyle = theme.badgeText;
      ctx.font = `900 ${Math.round(boxH * 0.72)}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(`P${tile.owner + 1}`, cx, cy + 0.5);
    }
  }
}

export const MapCustomizerDialog: React.FC<MapCustomizerDialogProps> = ({
  open,
  readOnly = false,
  seed,
  mapGen,
  playerCount,
  unitCounts,
  onClose,
  onApply,
  onLiveSync,
  onCustomizingChange,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const headingId = useId();
  const baseId = useId();
  const { copied, copy } = useCopyState();

  const [draftSeed, setDraftSeed] = useState(seed);
  const [seedText, setSeedText] = useState(seed);
  const [draftPreset, setDraftPreset] = useState<MapPresetId>(mapGen?.preset ?? 'classic');
  const [draftKnobs, setDraftKnobs] = useState<MapGenKnobs>(() => resolveMapGenKnobs(mapGen));
  const [classicPure, setClassicPure] = useState<boolean>(() => isClassicDynamicConfig(mapGen));

  const wasOpenRef = useRef(false);
  const appliedRef = useRef(false);
  const initialSnapshotRef = useRef<{ seed: string; mapGen: MapGenConfig }>({
    seed,
    mapGen: mapGen ?? { preset: 'classic' },
  });
  const liveTimerRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onLiveSyncRef = useRef(onLiveSync);
  onLiveSyncRef.current = onLiveSync;
  const onCustomizingChangeRef = useRef(onCustomizingChange);
  onCustomizingChangeRef.current = onCustomizingChange;

  const cancelLiveTimer = useCallback(() => {
    if (liveTimerRef.current !== null) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
  }, []);

  const buildDraftConfig = useCallback(
    (preset: MapPresetId, knobs: MapGenKnobs, isPureClassic: boolean): MapGenConfig => {
      if (isPureClassic && preset === 'classic') return { preset: 'classic' };
      const matched = detectMatchingPreset(knobs);
      if (matched !== 'custom') return { preset: matched };
      return { preset: 'custom', knobs };
    },
    [],
  );

  const scheduleLiveSync = useCallback(
    (nextSeed: string, nextConfig: MapGenConfig, immediate = false) => {
      if (readOnly || !onLiveSyncRef.current) return;
      cancelLiveTimer();
      if (immediate) {
        onLiveSyncRef.current(nextSeed, nextConfig);
        return;
      }
      liveTimerRef.current = window.setTimeout(() => {
        liveTimerRef.current = null;
        onLiveSyncRef.current?.(nextSeed, nextConfig);
      }, 180);
    },
    [readOnly, cancelLiveTimer],
  );

  // Sync open/close lifecycle cleanly via native showModal()
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;

    if (open) {
      if (!el.open) el.showModal();
      if (justOpened) {
        const cleanSeed = normalizeSeed(seed) || generateSectorSeed();
        const cfg: MapGenConfig = mapGen?.staticMapId ? { preset: 'balanced' } : (mapGen ?? { preset: 'classic' });
        appliedRef.current = false;
        initialSnapshotRef.current = { seed: cleanSeed, mapGen: mapGen ?? { preset: 'classic' } };
        setDraftSeed(cleanSeed);
        setSeedText(cleanSeed);
        setDraftPreset(cfg.preset);
        setDraftKnobs(resolveMapGenKnobs(cfg));
        setClassicPure(isClassicDynamicConfig(cfg));
        if (!readOnly) onCustomizingChangeRef.current?.(true);
      }
    } else if (el.open) {
      el.close();
    }
  }, [open, seed, mapGen, readOnly]);

  // Keep external updates in sync while in read-only guest inspection mode
  useEffect(() => {
    if (!open || !readOnly) return;
    const cleanSeed = normalizeSeed(seed) || seed;
    const cfg = mapGen ?? { preset: 'classic' };
    setDraftSeed(cleanSeed);
    setSeedText(cleanSeed);
    setDraftPreset(cfg.preset);
    setDraftKnobs(resolveMapGenKnobs(cfg));
    setClassicPure(isClassicDynamicConfig(cfg));
  }, [open, readOnly, seed, mapGen]);

  // Listen to native `close` (handles Esc, closedby="any", and Safari backdrop fallback)
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    const handleClose = () => {
      cancelLiveTimer();
      if (!readOnly) {
        if (!appliedRef.current && onLiveSyncRef.current) {
          onLiveSyncRef.current(initialSnapshotRef.current.seed, initialSnapshotRef.current.mapGen);
        }
        onCustomizingChangeRef.current?.(false);
      }
      onCloseRef.current();
    };
    el.addEventListener('close', handleClose);

    if ('closedBy' in HTMLDialogElement.prototype) {
      return () => el.removeEventListener('close', handleClose);
    }

    // Safari fallback for closedby="any"
    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== el) return;
      const rect = el.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) el.close();
    };
    el.addEventListener('click', handleBackdropClick);
    return () => {
      el.removeEventListener('close', handleClose);
      el.removeEventListener('click', handleBackdropClick);
    };
  }, [cancelLiveTimer, readOnly]);

  useEffect(() => () => cancelLiveTimer(), [cancelLiveTimer]);

  const draftConfig = useMemo(
    () => buildDraftConfig(draftPreset, draftKnobs, classicPure),
    [buildDraftConfig, draftPreset, draftKnobs, classicPure],
  );

  const previewGame = useMemo(() => {
    if (!open) return null;
    return createGeneratedGame({
      playerCount,
      unitCounts,
      dynamicWeather: false,
      fogOfWar: false,
      doomsdayEnabled: false,
      gameMode: 'PVP',
      victoryMode: 'CONQUER',
      aiDifficulty: 'MEDIUM',
      mapSeed: draftSeed,
      mapGen: draftConfig,
    });
  }, [open, playerCount, unitCounts, draftSeed, draftConfig]);

  useEffect(() => {
    if (!open || !previewGame || !canvasRef.current) return;
    drawPreviewCanvas(canvasRef.current, previewGame.mapData, previewGame.gridSize);
  }, [open, previewGame]);

  const boardStats = useMemo(() => {
    if (!previewGame) return { bridges: 0, banks: 0, towers: 0, bunkers: 0, waterPct: 0, forestPct: 0, mountainPct: 0 };
    let bridgeTiles = 0;
    let banks = 0;
    let towers = 0;
    let bunkers = 0;
    let water = 0;
    let forest = 0;
    let mountain = 0;
    for (const t of previewGame.mapData) {
      if (t.type === 'BRIDGE' || t.type === 'BRIDGE_V') bridgeTiles++;
      else if (t.type === 'BANK') banks++;
      else if (t.type === 'BUILDING' && t.subType === 'WATCHTOWER') towers++;
      else if (t.type === 'BUILDING' && t.subType === 'BUNKER') bunkers++;
      else if (t.type === 'WATER' || t.type === 'CANYON') water++;
      else if (t.type === 'FOREST') forest++;
      else if (t.type === 'MOUNTAIN') mountain++;
    }
    const n = Math.max(1, previewGame.mapData.length);
    return {
      bridges: bridgeTiles,
      banks,
      towers,
      bunkers,
      waterPct: Math.round(((water + bridgeTiles) / n) * 100),
      forestPct: Math.round((forest / n) * 100),
      mountainPct: Math.round((mountain / n) * 100),
    };
  }, [previewGame]);

  const updateKnobs = (patch: Partial<MapGenKnobs>, immediate = false) => {
    if (readOnly) return;
    const nextKnobs: MapGenKnobs = { ...draftKnobs, ...patch };
    // Switching away from DRY auto-gives a sensible default river/volume so the user sees water right away
    if (patch.waterStyle && patch.waterStyle !== 'NONE') {
      if (nextKnobs.waterPct === 0) nextKnobs.waterPct = patch.waterStyle === 'ISLANDS' ? 24 : 12;
      if (nextKnobs.rivers === 0) nextKnobs.rivers = patch.waterStyle === 'ISLANDS' ? 3 : 1;
    } else if (patch.waterStyle === 'NONE') {
      nextKnobs.rivers = 0;
      nextKnobs.waterPct = 0;
    }
    const matched = detectMatchingPreset(nextKnobs);
    setClassicPure(false);
    setDraftPreset(matched);
    setDraftKnobs(nextKnobs);
    scheduleLiveSync(draftSeed, buildDraftConfig(matched, nextKnobs, false), immediate);
  };

  const selectPreset = (presetId: Exclude<MapPresetId, 'custom'>) => {
    if (readOnly) return;
    const isClassic = presetId === 'classic';
    const nextKnobs = { ...MAP_PRESET_BY_ID[presetId].knobs };
    setClassicPure(isClassic);
    setDraftPreset(presetId);
    setDraftKnobs(nextKnobs);
    scheduleLiveSync(draftSeed, isClassic ? { preset: 'classic' } : { preset: presetId }, true);
  };

  const handleRollSeed = () => {
    if (readOnly) return;
    const next = generateSectorSeed();
    setDraftSeed(next);
    setSeedText(next);
    scheduleLiveSync(next, draftConfig, true);
  };

  const handleCommitSeedText = () => {
    if (readOnly) return;
    const parsed = decodeMapCode(seedText);
    if (!parsed) {
      setSeedText(draftSeed);
      return;
    }
    const nextSeed = parsed.seed ?? draftSeed;
    if (parsed.mapGen && !parsed.mapGen.staticMapId) {
      const isClassic = isClassicDynamicConfig(parsed.mapGen);
      const nextKnobs = resolveMapGenKnobs(parsed.mapGen);
      setClassicPure(isClassic);
      setDraftPreset(parsed.mapGen.preset);
      setDraftKnobs(nextKnobs);
      setDraftSeed(nextSeed);
      setSeedText(nextSeed);
      scheduleLiveSync(nextSeed, parsed.mapGen, true);
    } else {
      setDraftSeed(nextSeed);
      setSeedText(nextSeed);
      scheduleLiveSync(nextSeed, draftConfig, true);
    }
  };

  const handleWildcard = () => {
    if (readOnly) return;
    const nextSeed = generateSectorSeed();
    const nextKnobs = rollWildcardKnobs();
    setClassicPure(false);
    setDraftPreset('custom');
    setDraftKnobs(nextKnobs);
    setDraftSeed(nextSeed);
    setSeedText(nextSeed);
    scheduleLiveSync(nextSeed, { preset: 'custom', knobs: nextKnobs }, true);
  };

  const handleReset = () => {
    if (readOnly) return;
    const baseId: Exclude<MapPresetId, 'custom'> =
      draftPreset !== 'custom' && draftPreset in MAP_PRESET_BY_ID ? draftPreset : 'balanced';
    selectPreset(baseId);
  };

  const handleApply = () => {
    cancelLiveTimer();
    appliedRef.current = true;
    onApply(draftSeed, draftConfig);
    dialogRef.current?.close();
  };

  const handleCancel = () => {
    appliedRef.current = false;
    dialogRef.current?.close();
  };

  const recipeCode = encodeMapCode(draftSeed, draftConfig);
  const minGrid = minGridSizeForPlayers(playerCount);
  const effectiveGrid = resolveEffectiveGridSize(draftKnobs.gridSize, playerCount);
  const mirrorSupported = playerCount === 2 || playerCount === 4;
  const activeMeta =
    draftPreset !== 'custom' && draftPreset in MAP_PRESET_BY_ID ? MAP_PRESET_BY_ID[draftPreset] : null;

  return (
    <dialog
      ref={dialogRef}
      className="tt-map-dialog"
      aria-labelledby={headingId}
      style={{ maxWidth: 'min(96vw, 1020px)' }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div style={{ width: 'min(94vw, 980px)', maxHeight: '92dvh', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <GeoCard hug>
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: 0 }}>
            {/* HEADER */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h1 id={headingId} style={{ margin: 0, fontSize: '15px', fontWeight: 900, letterSpacing: '0.5px', color: 'var(--op-ink)' }}>
                  {readOnly ? 'BATTLEFIELD SPECS (HOST)' : 'MAP GENERATOR STUDIO'}
                </h1>
                <GeoChip variant={activeMeta ? 'softViolet' : 'softAmber'} style={{ fontSize: '11px', padding: '2px 8px' }}>
                  {activeMeta ? `${activeMeta.icon} ${activeMeta.label.toUpperCase()}` : '⚙ CUSTOM'}
                </GeoChip>
                {!readOnly && onLiveSync && (
                  <GeoChip variant="softMint" style={{ fontSize: '10px', padding: '2px 7px' }}>
                    ● LIVE LOBBY PREVIEW
                  </GeoChip>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <GeoButton
                  variant="softBlue"
                  onClick={() => void copy(recipeCode)}
                  coreStyle={{ padding: '5px 10px', fontSize: '11px' }}
                  title={`Copy shareable map recipe code (${recipeCode})`}
                >
                  {copied ? 'COPIED ✓' : `📋 ${recipeCode}`}
                </GeoButton>
                <GeoButton onClick={handleCancel} coreStyle={{ padding: '5px 10px' }} aria-label="Close map customizer">
                  ✕
                </GeoButton>
              </div>
            </div>

            {/* BODY: 2-COLUMN LIVE PREVIEW + SLIDERS */}
            <div
              className="tt-cols"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(270px, 43%) minmax(0, 1fr)',
                gap: '12px',
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              {/* LEFT: LIVE PREVIEW + PRESET QUICK-BAR + SEED */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
                <div
                  style={{
                    background: '#1E2736',
                    border: '2px solid var(--op-line)',
                    borderRadius: '6px',
                    padding: '6px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  <canvas
                    ref={canvasRef}
                    style={{
                      width: 'min(320px, 100%, 44dvh)',
                      height: 'min(320px, 100%, 44dvh)',
                      aspectRatio: '1 / 1',
                      display: 'block',
                      borderRadius: '4px',
                    }}
                  />
                </div>

                {/* Live stats strip */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  <GeoChip variant="softBlue" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                    {previewGame?.gridSize ?? effectiveGrid}×{previewGame?.gridSize ?? effectiveGrid}
                  </GeoChip>
                  <GeoChip variant="softAmber" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                    € {boardStats.banks} BANK{boardStats.banks === 1 ? '' : 'S'}
                  </GeoChip>
                  {boardStats.bridges > 0 && (
                    <GeoChip variant="softMint" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                      🌉 {boardStats.bridges} BRIDGE TILES
                    </GeoChip>
                  )}
                  <GeoChip variant="default" style={{ fontSize: '10.5px', padding: '2px 7px' }}>
                    🌲 {boardStats.forestPct}% · ⛰️ {boardStats.mountainPct}% · 🌊 {boardStats.waterPct}%
                  </GeoChip>
                </div>

                {/* Seed / Recipe input */}
                <GeoWell coreStyle={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 900, color: 'var(--op-ink-muted)' }}>
                    SECTOR SEED OR RECIPE CODE
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      spellCheck={false}
                      maxLength={32}
                      disabled={readOnly}
                      value={seedText}
                      placeholder="K7M9P2 or ARCH-K7M9P2"
                      onChange={e => setSeedText(e.target.value.toUpperCase())}
                      onBlur={handleCommitSeedText}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCommitSeedText();
                      }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 9px',
                        background: '#FFFFFF',
                        border: '1.5px solid var(--op-line)',
                        borderRadius: '6px',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        fontWeight: 800,
                        letterSpacing: '0.8px',
                        color: 'var(--op-ink)',
                        outline: 'none',
                      }}
                    />
                    {!readOnly && (
                      <GeoButton onClick={handleRollSeed} title="Roll a fresh seed in this style" coreStyle={{ padding: '6px 10px', fontSize: '11px' }}>
                        🎲 ROLL
                      </GeoButton>
                    )}
                  </div>
                </GeoWell>

                {/* Quick preset templates */}
                {!readOnly && (
                  <GeoWell coreStyle={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 900, color: 'var(--op-ink-muted)' }}>
                      START FROM A PRESET
                    </div>
                    <div className="tt-preset-grid">
                      {MAP_GEN_PRESETS.map(p => (
                        <GeoButton
                          key={p.id}
                          fullWidth
                          variant={draftPreset === p.id ? 'violet' : 'default'}
                          title={p.tagline}
                          onClick={() => selectPreset(p.id)}
                          coreStyle={{ padding: '5px 4px', fontSize: '10.5px', gap: '4px' }}
                        >
                          <span>{p.icon}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                        </GeoButton>
                      ))}
                    </div>
                  </GeoWell>
                )}
              </div>

              {/* RIGHT: SCROLLABLE SLIDER WELLS */}
              <div
                className="opgeo-scroll"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  overflowY: 'auto',
                  maxHeight: '64dvh',
                  paddingRight: '4px',
                }}
              >
                {classicPure && (
                  <GeoWell coreStyle={{ padding: '9px 11px', background: 'var(--acc-blue-soft)' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 800, color: 'var(--acc-blue-ink)', lineHeight: 1.4 }}>
                      🎲 <strong>Classic Mix</strong> automatically varies between River Valley, Forked River, Frontier River &amp; Canyon Divide. Adjust any control below to switch into custom tuning.
                    </div>
                  </GeoWell>
                )}

                {/* 1. BOARD SIZE & FAIRNESS */}
                <GeoWell coreStyle={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <div style={{ ...SECTION_LABEL, fontSize: '11px', color: 'var(--acc-blue-ink)' }}>
                    1. BOARD SIZE &amp; FAIRNESS
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 900, color: 'var(--op-ink)' }}>
                      GRID SIZE <span style={{ fontWeight: 700, color: 'var(--op-ink-muted)' }}>({effectiveGrid}×{effectiveGrid} active)</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px' }}>
                      {GRID_SIZE_OPTIONS.map((opt: GridSizeOption) => {
                        const tooSmall = opt !== 'AUTO' && opt < minGrid;
                        return (
                          <GeoButton
                            key={String(opt)}
                            fullWidth
                            disabled={readOnly || tooSmall}
                            variant={!classicPure && draftKnobs.gridSize === opt ? 'blue' : classicPure && opt === 'AUTO' ? 'blue' : 'default'}
                            onClick={() => updateKnobs({ gridSize: opt }, true)}
                            title={tooSmall ? `Requires at least ${minGrid}×${minGrid} for ${playerCount} players` : undefined}
                            coreStyle={{ padding: '6px 4px', fontSize: '11px' }}
                          >
                            {opt === 'AUTO' ? 'AUTO' : `${opt}×`}
                          </GeoButton>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 900, color: 'var(--op-ink)' }}>LAYOUT SYMMETRY</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      {([
                        ['ORGANIC', '🌍 ORGANIC', 'Natural geography with sector-fair banks'],
                        ['MIRRORED', '⚖️ MIRRORED 180°', 'Identical mirrored halves for competitive PvP'],
                      ] as Array<[MapSymmetry, string, string]>).map(([sym, label, tip]) => (
                        <GeoButton
                          key={sym}
                          fullWidth
                          disabled={readOnly}
                          variant={draftKnobs.symmetry === sym ? (sym === 'MIRRORED' ? 'mint' : 'violet') : 'default'}
                          title={tip}
                          onClick={() => updateKnobs({ symmetry: sym }, true)}
                          coreStyle={{ padding: '6px 8px', fontSize: '11px' }}
                        >
                          {label}
                        </GeoButton>
                      ))}
                    </div>
                    {draftKnobs.symmetry === 'MIRRORED' && !mirrorSupported && (
                      <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--acc-amber-ink)' }}>
                        180° mirror applies to 2P &amp; 4P matches; {playerCount}P automatically uses sector-fair balance.
                      </div>
                    )}
                  </div>
                </GeoWell>

                {/* 2. WATERWAYS & BIOME */}
                <GeoWell coreStyle={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <div style={{ ...SECTION_LABEL, fontSize: '11px', color: 'var(--acc-blue-ink)' }}>
                    2. WATERWAYS &amp; BIOME
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
                    {WATER_STYLES.map(ws => (
                      <GeoButton
                        key={ws.id}
                        fullWidth
                        disabled={readOnly}
                        variant={!classicPure && draftKnobs.waterStyle === ws.id ? 'blue' : 'default'}
                        onClick={() => updateKnobs({ waterStyle: ws.id }, true)}
                        coreStyle={{ padding: '6px 4px', fontSize: '11px', gap: '4px' }}
                      >
                        <span>{ws.icon}</span>
                        <span>{ws.label}</span>
                      </GeoButton>
                    ))}
                  </div>

                  {draftKnobs.waterStyle !== 'NONE' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <KnobSlider
                        id={`${baseId}-rivers`}
                        label={
                          draftKnobs.waterStyle === 'ISLANDS'
                            ? 'ISLAND CHAINS'
                            : draftKnobs.waterStyle === 'CANYON'
                              ? 'CANYON GORGES'
                              : 'RIVERS'
                        }
                        value={draftKnobs.rivers}
                        min={draftKnobs.waterStyle === 'ISLANDS' ? 1 : 0}
                        max={3}
                        disabled={readOnly}
                        onChange={v => updateKnobs({ rivers: v })}
                      />
                      <KnobSlider
                        id={`${baseId}-water`}
                        label={
                          draftKnobs.waterStyle === 'ISLANDS'
                            ? 'SEA COVERAGE'
                            : draftKnobs.waterStyle === 'CANYON'
                              ? 'GORGE WIDTH'
                              : 'RIVER VOLUME'
                        }
                        value={draftKnobs.waterPct}
                        min={0}
                        max={30}
                        suffix="%"
                        disabled={readOnly}
                        onChange={v => updateKnobs({ waterPct: v })}
                      />
                    </div>
                  )}

                  <KnobSlider
                    id={`${baseId}-desert`}
                    label="DESERT BIOME"
                    value={draftKnobs.desertPct}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    hint="Adds golden sand, elevated dunes, and quicksand hazards above 50%"
                    disabled={readOnly}
                    onChange={v => updateKnobs({ desertPct: v })}
                  />
                </GeoWell>

                {/* 3. TERRAIN & COVER */}
                <GeoWell coreStyle={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <div style={{ ...SECTION_LABEL, fontSize: '11px', color: 'var(--acc-blue-ink)' }}>
                    3. TERRAIN &amp; COVER
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <KnobSlider
                      id={`${baseId}-forest`}
                      label="FOREST COVER"
                      value={draftKnobs.forestPct}
                      min={0}
                      max={55}
                      suffix="%"
                      disabled={readOnly}
                      onChange={v => updateKnobs({ forestPct: v })}
                    />
                    <KnobSlider
                      id={`${baseId}-mountain`}
                      label="MOUNTAIN RANGES"
                      value={draftKnobs.mountainPct}
                      min={0}
                      max={40}
                      suffix="%"
                      disabled={readOnly}
                      onChange={v => updateKnobs({ mountainPct: v })}
                    />
                  </div>
                  <GeoToggle
                    label="Tactical Road Approaches (highways off primary bridges)"
                    value={draftKnobs.roads}
                    disabled={readOnly}
                    onChange={v => updateKnobs({ roads: v }, true)}
                  />
                </GeoWell>

                {/* 4. OBJECTIVES & LOOT */}
                <GeoWell coreStyle={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <div style={{ ...SECTION_LABEL, fontSize: '11px', color: 'var(--acc-blue-ink)' }}>
                    4. OBJECTIVES &amp; SUPPLIES
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <KnobSlider
                      id={`${baseId}-banks`}
                      label="BANK VAULTS"
                      value={draftKnobs.banks}
                      min={0}
                      max={4}
                      disabled={readOnly}
                      onChange={v => updateKnobs({ banks: v })}
                    />
                    <KnobSlider
                      id={`${baseId}-buildings`}
                      label="OUTPOSTS"
                      value={draftKnobs.buildingPct}
                      min={0}
                      max={15}
                      suffix="%"
                      hint="Watchtowers & Bunkers"
                      disabled={readOnly}
                      onChange={v => updateKnobs({ buildingPct: v })}
                    />
                  </div>
                  <KnobSlider
                    id={`${baseId}-loot`}
                    label="LOOSE SUPPLY LOOT"
                    value={draftKnobs.lootPct}
                    min={0}
                    max={40}
                    suffix="%"
                    hint="Ammo refills & medkits scattered on walkable ground"
                    disabled={readOnly}
                    onChange={v => updateKnobs({ lootPct: v })}
                  />
                </GeoWell>
              </div>
            </div>

            {/* FOOTER ACTIONS */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {readOnly ? (
                <GeoButton variant="mint" fullWidth onClick={handleCancel} coreStyle={{ padding: '9px' }}>
                  CLOSE SPECS
                </GeoButton>
              ) : (
                <>
                  <GeoButton onClick={handleReset} coreStyle={{ padding: '8px 12px', fontSize: '11.5px' }} title="Reset sliders back to current preset defaults">
                    ↺ RESET
                  </GeoButton>
                  <GeoButton
                    variant="softViolet"
                    onClick={handleWildcard}
                    coreStyle={{ padding: '8px 12px', fontSize: '11.5px' }}
                    title="Randomize sliders + seed for a surprise battlefield"
                  >
                    🎰 MIX IT UP
                  </GeoButton>
                  <div style={{ flex: 1 }} />
                  <GeoButton onClick={handleCancel} coreStyle={{ padding: '8px 14px', fontSize: '12px' }}>
                    CANCEL
                  </GeoButton>
                  <GeoButton variant="mint" onClick={handleApply} coreStyle={{ padding: '8px 18px', fontSize: '12.5px', fontWeight: 900 }}>
                    ✓ APPLY MAP
                  </GeoButton>
                </>
              )}
            </div>
          </div>
        </GeoCard>
      </div>
    </dialog>
  );
};
