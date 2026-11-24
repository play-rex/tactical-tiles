import React, { useEffect, useState } from 'react';
import {
  decodeMapCode,
  encodeMapCode,
  generateSectorSeed,
  isClassicDynamicConfig,
  isSameMapGen,
  MAP_GEN_PRESETS,
  MAP_PRESET_BY_ID,
  normalizeSeed,
  resolveEffectiveGridSize,
  resolveMapGenKnobs,
  type MapGenConfig,
  type MapPresetId,
  type TableSettings,
} from '@tactical/engine';
import { PRESET_MAPS } from '@tactical/engine/assets/Presets';
import { useCopyState } from '../../hooks/useCopyState';
import { GeoButton, GeoChip, GeoWell } from './GeoPrimitives';
import { MapCustomizerDialog } from './MapCustomizerDialog';

export interface MapGeneratorControlsProps {
  seed: string;
  mapGen?: MapGenConfig;
  playerCount: number;
  unitCounts: TableSettings['unitCounts'];
  /** Local Setup or Online Host = true; Online Guest = false (shows crisp read-only spec summary). */
  canEdit: boolean;
  /** Online Lobby live status when host has the Generator Studio dialog open. */
  hostCustomizingMap?: boolean;
  /** Shows the 3 static handcrafted arenas as quick picks (used in Online Lobby). */
  allowStaticArenas?: boolean;
  onChange: (nextSeed: string, nextMapGen: MapGenConfig) => void;
  /** Debounced live broadcast for Online hosts tuning sliders inside Customize. */
  onLiveSync?: (nextSeed: string, nextMapGen: MapGenConfig) => void;
  onCustomizingChange?: (active: boolean) => void;
}

interface RollEntry {
  seed: string;
  mapGen: MapGenConfig;
}

const MAX_HISTORY = 8;

/** Returns human-friendly title & short spec chips describing the current MapGenConfig. */
export function describeMapGen(mapGen: MapGenConfig | undefined, playerCount: number): {
  icon: string;
  label: string;
  tagline: string;
  isCustom: boolean;
  isStatic: boolean;
  chips: string[];
} {
  if (mapGen?.staticMapId) {
    const arena = PRESET_MAPS.find(m => m.id === mapGen.staticMapId);
    if (arena) {
      return {
        icon: '🗺️',
        label: arena.name,
        tagline: `Handcrafted ${arena.width}×${arena.height} Arena (up to ${arena.baseCount}P)`,
        isCustom: false,
        isStatic: true,
        chips: [`${arena.width}×${arena.height}`, 'ARENA'],
      };
    }
  }

  if (isClassicDynamicConfig(mapGen)) {
    const sz = resolveEffectiveGridSize('AUTO', playerCount);
    return {
      icon: '🎲',
      label: 'Classic Mix',
      tagline: 'Signature 4-archetype randomizer',
      isCustom: false,
      isStatic: false,
      chips: [`${sz}×${sz}`],
    };
  }

  const knobs = resolveMapGenKnobs(mapGen);
  const sz = resolveEffectiveGridSize(knobs.gridSize, playerCount);
  const presetId = mapGen?.preset ?? 'custom';
  const meta = presetId !== 'custom' && presetId in MAP_PRESET_BY_ID ? MAP_PRESET_BY_ID[presetId] : null;
  const chips: string[] = [`${sz}×${sz}`];
  if (knobs.symmetry === 'MIRRORED' && (playerCount === 2 || playerCount === 4)) {
    chips.push('⚖️ MIRRORED');
  }
  if (knobs.waterStyle === 'ISLANDS') chips.push('🏝️ ISLANDS');
  else if (knobs.waterStyle === 'CANYON') chips.push(`🪨 ${knobs.rivers} CANYON${knobs.rivers === 1 ? '' : 'S'}`);
  else if (knobs.waterStyle === 'NONE') {
    chips.push('☀️ NO RIVERS');
    if (presetId === 'timber_ridge') chips.push('🌲 ~35% · ⛰️ ~16%');
  } else if (presetId === 'lush_valley' && !mapGen?.knobs?.rivers) {
    chips.push('🌊 1–3 RIVERS');
  } else if (knobs.waterStyle === 'RIVERS' && knobs.rivers > 0 && knobs.waterPct > 0) {
    chips.push(`🌊 ${knobs.rivers} RIVER${knobs.rivers === 1 ? '' : 'S'}`);
  }
  if (knobs.lootPct > 0) chips.push(`📦 LOOT ${knobs.lootPct}%`);

  if (meta) {
    return {
      icon: meta.icon,
      label: meta.label,
      tagline: meta.tagline,
      isCustom: false,
      isStatic: false,
      chips,
    };
  }
  return {
    icon: '⚙',
    label: 'Custom Map',
    tagline: `🌲 ${knobs.forestPct}% · ⛰️ ${knobs.mountainPct}% · 🏜️ ${knobs.desertPct}% · € ${knobs.banks} Banks`,
    isCustom: true,
    isStatic: false,
    chips,
  };
}

export const MapGeneratorControls: React.FC<MapGeneratorControlsProps> = ({
  seed,
  mapGen,
  playerCount,
  unitCounts,
  canEdit,
  hostCustomizingMap = false,
  allowStaticArenas = false,
  onChange,
  onLiveSync,
  onCustomizingChange,
}) => {
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [seedDraft, setSeedDraft] = useState(seed);
  const [history, setHistory] = useState<RollEntry[]>([]);
  const { copied, copy } = useCopyState();

  const currentConfig: MapGenConfig = mapGen ?? { preset: 'classic' };
  const info = describeMapGen(currentConfig, playerCount);
  const recipeCode = encodeMapCode(seed, currentConfig);

  useEffect(() => {
    setSeedDraft(seed);
  }, [seed]);

  const pushHistory = () => {
    const cleanSeed = normalizeSeed(seed);
    if (!cleanSeed) return;
    setHistory(prev => {
      const top = prev[prev.length - 1];
      if (top && top.seed === cleanSeed && isSameMapGen(top.mapGen, currentConfig)) return prev;
      return [...prev.slice(-(MAX_HISTORY - 1)), { seed: cleanSeed, mapGen: currentConfig }];
    });
  };

  const commitChange = (nextSeed: string, nextConfig: MapGenConfig, recordHistory = true) => {
    if (!canEdit) return;
    if (recordHistory) pushHistory();
    onChange(nextSeed, nextConfig);
  };

  const handleSelectPreset = (presetId: Exclude<MapPresetId, 'custom'>) => {
    if (!canEdit) return;
    const nextConfig: MapGenConfig = { preset: presetId };
    // Clicking the already-active preset rolls a fresh seed in that style (super snappy UX!)
    if (!currentConfig.staticMapId && isSameMapGen(currentConfig, nextConfig)) {
      commitChange(generateSectorSeed(), nextConfig);
      return;
    }
    commitChange(seed || generateSectorSeed(), nextConfig);
  };

  const handleSelectStaticArena = (arenaId: string) => {
    if (!canEdit) return;
    commitChange(seed || generateSectorSeed(), { preset: 'classic', staticMapId: arenaId });
  };

  const handleRoll = () => {
    if (!canEdit) return;
    const nextConfig: MapGenConfig = currentConfig.staticMapId ? { preset: 'classic' } : currentConfig;
    commitChange(generateSectorSeed(), nextConfig);
  };

  const handleUndoRoll = () => {
    if (!canEdit || history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    onChange(prev.seed, prev.mapGen);
  };

  const handleCommitSeedInput = () => {
    if (!canEdit) return;
    const parsed = decodeMapCode(seedDraft);
    if (!parsed) {
      setSeedDraft(seed);
      return;
    }
    const nextSeed = parsed.seed ?? seed;
    const nextConfig = parsed.mapGen ?? (currentConfig.staticMapId ? { preset: 'classic' } : currentConfig);
    if (nextSeed === seed && isSameMapGen(nextConfig, currentConfig)) {
      setSeedDraft(seed);
      return;
    }
    commitChange(nextSeed, nextConfig);
  };

  return (
    <>
      <GeoWell coreStyle={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* HEADER: STYLE TITLE + LIVE SPEC CHIPS */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontSize: '11.5px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.5px' }}>
              MAP STYLE
            </span>
            <GeoChip
              variant={info.isCustom ? 'softAmber' : info.isStatic ? 'softBlue' : 'softViolet'}
              style={{ fontSize: '10.5px', padding: '1px 7px' }}
            >
              {info.icon} {info.label.toUpperCase()}
            </GeoChip>
            {hostCustomizingMap && !canEdit && (
              <GeoChip variant="softMint" style={{ fontSize: '10px', padding: '1px 7px' }}>
                ● HOST TUNING…
              </GeoChip>
            )}
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {info.chips.map(ch => (
              <GeoChip key={ch} variant="default" style={{ fontSize: '10px', padding: '1px 6px' }}>
                {ch}
              </GeoChip>
            ))}
          </div>
        </div>

        {/* EDITABLE MODE (LOCAL SETUP & ONLINE HOST): COMPACT 3×3 PRESET GRID */}
        {canEdit ? (
          <>
            <div className="tt-preset-grid">
              {MAP_GEN_PRESETS.map(p => {
                const isActive = !currentConfig.staticMapId && currentConfig.preset === p.id;
                return (
                  <GeoButton
                    key={p.id}
                    fullWidth
                    variant={isActive ? 'violet' : 'default'}
                    title={`${p.label} — ${p.tagline}${isActive ? ' (click again to roll a fresh board)' : ''}`}
                    onClick={() => handleSelectPreset(p.id)}
                    coreStyle={{ padding: '6px 5px', fontSize: '11px', gap: '4px' }}
                  >
                    <span>{p.icon}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                  </GeoButton>
                );
              })}
            </div>

            {allowStaticArenas && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', paddingTop: '2px' }}>
                <span style={{ fontSize: '10px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.4px' }}>
                  ARENAS:
                </span>
                {PRESET_MAPS.map(arena => {
                  const tooManyPlayers = playerCount > arena.baseCount;
                  const active = currentConfig.staticMapId === arena.id;
                  const shortName =
                    arena.id === 'campaign_recon'
                      ? 'Iron Confluence'
                      : arena.id === 'campaign_canyon'
                        ? 'Dust Bowl'
                        : 'River Delta';
                  return (
                    <GeoButton
                      key={arena.id}
                      disabled={tooManyPlayers}
                      variant={active ? 'blue' : 'default'}
                      title={
                        tooManyPlayers
                          ? `${arena.name} supports up to ${arena.baseCount} players`
                          : `${arena.name} (${arena.width}×${arena.height}, up to ${arena.baseCount}P)`
                      }
                      onClick={() => handleSelectStaticArena(arena.id)}
                      coreStyle={{ padding: '3px 7px', fontSize: '10.5px' }}
                    >
                      🗺️ {shortName}
                    </GeoButton>
                  );
                })}
              </div>
            )}

            {/* SEED / RECIPE INPUT + UNDO + ROLL + CUSTOMIZE */}
            <div style={{ display: 'flex', gap: '5px', alignItems: 'stretch', flexWrap: 'wrap' }}>
              <input
                type="text"
                spellCheck={false}
                maxLength={32}
                value={seedDraft}
                placeholder="SEED or ARCH-K7M9P2"
                aria-label="Sector seed or map recipe code"
                onChange={e => setSeedDraft(e.target.value.toUpperCase())}
                onBlur={handleCommitSeedInput}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCommitSeedInput();
                }}
                style={{
                  flex: '1 1 110px',
                  minWidth: 0,
                  padding: '6px 9px',
                  background: '#FFFFFF',
                  border: '1.5px solid var(--op-line)',
                  borderRadius: '6px',
                  color: 'var(--op-ink)',
                  fontFamily: 'monospace',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  letterSpacing: '0.8px',
                  outline: 'none',
                }}
              />
              {history.length > 0 && (
                <GeoButton
                  onClick={handleUndoRoll}
                  title="Go back to previous rolled map"
                  coreStyle={{ padding: '6px 8px', fontSize: '11.5px' }}
                >
                  ↩
                </GeoButton>
              )}
              <GeoButton
                onClick={handleRoll}
                title="Roll a fresh random layout in the selected style"
                coreStyle={{ padding: '6px 10px', fontSize: '11.5px' }}
              >
                🎲 ROLL
              </GeoButton>
              <GeoButton
                variant={info.isCustom ? 'amber' : 'softBlue'}
                onClick={() => setCustomizerOpen(true)}
                title="Open Advanced Generator Studio: tune grid size, rivers, islands, mountains, symmetry & loot"
                coreStyle={{ padding: '6px 10px', fontSize: '11.5px' }}
              >
                ⚙ {info.isCustom ? 'CUSTOM' : 'CUSTOMIZE'}
              </GeoButton>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--op-ink-muted)', lineHeight: 1.3 }}>
                {info.tagline}
              </span>
              <button
                type="button"
                onClick={() => void copy(recipeCode)}
                title={`Copy shareable map code: ${recipeCode}`}
                style={{
                  border: 0,
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: 'var(--acc-blue-ink)',
                  fontFamily: 'monospace',
                }}
              >
                {copied ? 'COPIED ✓' : `📋 ${recipeCode}`}
              </button>
            </div>
          </>
        ) : (
          /* READ-ONLY GUEST SUMMARY IN ONLINE LOBBY */
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 160px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--op-ink-muted)', lineHeight: 1.35 }}>
                {info.tagline}
              </div>
              <div style={{ fontSize: '10.5px', fontWeight: 800, color: 'var(--op-ink-muted)', fontFamily: 'monospace', marginTop: '2px' }}>
                CODE: {recipeCode}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
              <GeoButton
                variant="softBlue"
                onClick={() => void copy(recipeCode)}
                coreStyle={{ padding: '5px 8px', fontSize: '11px' }}
              >
                {copied ? '✓ COPIED' : '📋 CODE'}
              </GeoButton>
              {!info.isStatic && (
                <GeoButton
                  onClick={() => setCustomizerOpen(true)}
                  coreStyle={{ padding: '5px 8px', fontSize: '11px' }}
                  title="Inspect active map generator parameters"
                >
                  🔍 SPECS
                </GeoButton>
              )}
            </div>
          </div>
        )}
      </GeoWell>

      <MapCustomizerDialog
        open={customizerOpen}
        readOnly={!canEdit}
        seed={seed}
        mapGen={currentConfig}
        playerCount={playerCount}
        unitCounts={unitCounts}
        onClose={() => setCustomizerOpen(false)}
        onApply={(nextSeed, nextConfig) => commitChange(nextSeed, nextConfig, true)}
        onLiveSync={canEdit ? onLiveSync : undefined}
        onCustomizingChange={canEdit ? onCustomizingChange : undefined}
      />
    </>
  );
};
