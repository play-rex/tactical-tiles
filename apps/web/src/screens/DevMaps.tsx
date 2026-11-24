import React from 'react';
import {
  DEFAULT_DEV_MAP_OPTIONS,
  DEV_TERRAIN_LABEL,
  devBaseSlots,
  devMapReport,
  summarizeDevMap,
  type DevMapOptions,
} from '@tactical/engine';
import { PLAYER_COLORS } from '@tactical/engine/constants/Config';
import { useGameStore } from '../store/useGameStore';
import { GeoButton, GeoCard, GeoChip, GeoWell } from '../components/ui/GeoPrimitives';
import { MapPreviewCard } from '../components/ui/MapPreviewModal';
import {
  BrandHeader,
  SECTION_LABEL,
  SquadGuideButton,
  SquadLoadoutControls,
  StageShell,
} from '../components/ui/MatchRulesControls';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  onChange: (value: number) => void;
}

/** Aluminum OP slider row matching the setup deck's rule controls. */
const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 1, suffix = '', hint, onChange }) => (
  <label style={{ display: 'grid', gap: 4 }}>
    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink)' }}>{label}</span>
      <span style={{ fontSize: '12px', fontWeight: 900, color: 'var(--acc-blue-ink)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {suffix}
      </span>
    </span>
    <input
      className="opgeo-range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{ width: '100%' }}
    />
    {hint ? <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--op-ink-muted)', lineHeight: 1.35 }}>{hint}</span> : null}
  </label>
);

/** Recessed aluminum well grouping a run of sliders under a section label. */
const FieldGroup: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <GeoWell coreStyle={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
    {title ? (
      <div style={{ ...SECTION_LABEL, fontSize: '11px', letterSpacing: '0.5px', color: 'var(--acc-blue-ink)' }}>{title}</div>
    ) : null}
    {children}
  </GeoWell>
);

const PRESETS: { id: string; label: string; patch: Partial<DevMapOptions> }[] = [
  { id: 'balanced', label: 'BALANCED', patch: { forestPct: 18, mountainPct: 12, waterPct: 10, desertPct: 0, buildingPct: 4, lootPct: 6, rivers: 1, banks: 2 } },
  { id: 'lush', label: 'LUSH VALLEY', patch: { forestPct: 38, mountainPct: 14, waterPct: 16, desertPct: 0, buildingPct: 3, lootPct: 10, rivers: 1, banks: 2 } },
  { id: 'badlands', label: 'BADLANDS', patch: { forestPct: 4, mountainPct: 22, waterPct: 0, desertPct: 78, buildingPct: 5, lootPct: 8, rivers: 0, banks: 1 } },
  { id: 'archipelago', label: 'ARCHIPELAGO', patch: { forestPct: 16, mountainPct: 6, waterPct: 30, desertPct: 0, buildingPct: 2, lootPct: 12, rivers: 3, banks: 2 } },
  { id: 'fortress', label: 'FORTRESS', patch: { forestPct: 10, mountainPct: 34, waterPct: 6, desertPct: 0, buildingPct: 13, lootPct: 2, rivers: 1, banks: 0 } },
  { id: 'twin', label: 'TWIN FRONTS', patch: { forestPct: 20, mountainPct: 12, waterPct: 12, desertPct: 50, buildingPct: 4, lootPct: 4, rivers: 1, banks: 2 } },
  { id: 'timber', label: 'TIMBER RIDGE', patch: { forestPct: 35, mountainPct: 16, waterPct: 0, desertPct: 0, buildingPct: 4, lootPct: 6, rivers: 0, banks: 2 } },
  { id: 'empty', label: 'EMPTY SLATE', patch: { forestPct: 0, mountainPct: 0, waterPct: 0, desertPct: 0, buildingPct: 0, lootPct: 0, rivers: 0, banks: 0 } },
];

/** Counts the sandbox shows under the preview, in a stable order. */
const SUMMARY_ORDER = ['PLAINS', 'SAND', 'DUNES', 'FOREST', 'MOUNTAIN', 'WATER', 'BRIDGE', 'BUILDING', 'BANK', 'BASE'];

const SEED_INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '8px 10px',
  background: '#FFFFFF',
  border: '1.5px solid var(--op-line)',
  borderRadius: '6px',
  color: 'var(--op-ink)',
  fontFamily: 'monospace',
  fontSize: '13px',
  fontWeight: 800,
  letterSpacing: '1px',
  outline: 'none',
};

export const DevMaps: React.FC = () => {
  const devOptions = useGameStore(s => s.devOptions);
  const devPreview = useGameStore(s => s.devPreview);
  const setDevOptions = useGameStore(s => s.setDevOptions);
  const rollDevSeed = useGameStore(s => s.rollDevSeed);
  const exitDevMaps = useGameStore(s => s.exitDevMaps);
  const launchDevSandbox = useGameStore(s => s.launchDevSandbox);
  const devBotMatch = useGameStore(s => s.devBotMatch);
  const setDevBotMatch = useGameStore(s => s.setDevBotMatch);
  const settings = useGameStore(s => s.settings);
  const setGameSettings = useGameStore(s => s.setGameSettings);

  const rawCounts = summarizeDevMap(devPreview);
  const counts: Record<string, number> = {
    ...rawCounts,
    BRIDGE: (rawCounts.BRIDGE ?? 0) + (rawCounts.BRIDGE_V ?? 0),
  };
  const size = Math.round(Math.sqrt(devPreview.length));
  const fidelity = devMapReport(devPreview, size, devOptions);
  const FIDELITY_ROWS = [
    ['FOREST', 'forestPct'],
    ['MOUNTAIN', 'mountainPct'],
    ['DESERT', 'desertPct'],
    ['RIVER BED', 'waterPct'],
    ['BUILDINGS', 'buildingPct'],
    ['LOOT', 'lootPct'],
  ] as const;
  const seatColors = devBaseSlots(size, devOptions.playerCount);
  const totalUnits = settings.unitCounts.SOLDIER + settings.unitCounts.ASSAULTER + settings.unitCounts.SNIPER;

  return (
    <StageShell width={1140}>
      <BrandHeader
        badge={
          <>
            <GeoChip variant="softViolet" style={{ padding: '5px 10px' }}>
              DEV SANDBOX
            </GeoChip>
            <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>
              SCRATCH BATTLEFIELD · FREE PLACEMENT · EVENT AUDITION
            </span>
          </>
        }
        right={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <GeoButton onClick={rollDevSeed} coreStyle={{ padding: '7px 14px' }} title="Roll a fresh sector seed">
              🎲 ROLL SECTOR
            </GeoButton>
            <GeoButton onClick={exitDevMaps} coreStyle={{ padding: '7px 14px' }}>
              ← BACK TO SETUP
            </GeoButton>
          </div>
        }
      />

      <div
        className="tt-cols"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(290px, 38%) minmax(0, 1fr)',
          gap: '14px',
          alignItems: 'stretch',
        }}
      >
        {/* LEFT: SEED + LIVE PREVIEW */}
        <GeoCard fill>
          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
            <div style={{ ...SECTION_LABEL }}>1. BOARD SOURCE</div>

            <FieldGroup>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)' }}>SHAREABLE SECTOR SEED</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    spellCheck={false}
                    maxLength={12}
                    value={devOptions.seed}
                    onChange={e => setDevOptions({ seed: e.target.value.toUpperCase().slice(0, 12) })}
                    style={SEED_INPUT_STYLE}
                  />
                  <GeoButton onClick={rollDevSeed} title="Roll Random Sector Seed" coreStyle={{ padding: '7px 12px' }}>
                    🎲 ROLL
                  </GeoButton>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.4 }}>
                    Same seed, same battlefield — tweak the knobs freely.
                  </span>
                  <GeoButton onClick={() => setDevOptions({ ...DEFAULT_DEV_MAP_OPTIONS })} coreStyle={{ padding: '5px 9px', fontSize: '11px' }}>
                    RESET
                  </GeoButton>
                </div>
              </div>
            </FieldGroup>

            <MapPreviewCard
              game={{ mapData: devPreview, gridSize: size, units: [], activeSeed: devOptions.seed }}
              title={`Sector ${devOptions.seed}`}
              subtitle={`${devOptions.playerCount} Seats · ${size}×${size} Scratch Board`}
              seedLabel={devOptions.seed}
              maxPreviewPx={220}
            />

            <FieldGroup title="KNOB FIDELITY · BUILT / ASKED">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px' }}>
                {FIDELITY_ROWS.map(([label, key]) => {
                  const built = fidelity.realized[key];
                  const asked = fidelity.requested[key];
                  const off = Math.abs(built - asked) > 2;
                  return (
                    <div
                      key={key}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11.5px', fontWeight: 700 }}
                    >
                      <span style={{ color: 'var(--op-ink-muted)' }}>{label}</span>
                      <span style={{ color: off ? 'var(--acc-red-ink, #b42318)' : 'var(--op-ink)', fontVariantNumeric: 'tabular-nums' }}>
                        {built}% {off ? '·' : '='} {asked}%
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11.5px', fontWeight: 700 }}>
                  <span style={{ color: 'var(--op-ink-muted)' }}>BANKS</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fidelity.realized.banks} = {fidelity.requested.banks}
                  </span>
                </div>
              </div>
              <GeoChip variant={fidelity.faithful ? 'softMint' : 'softViolet'} style={{ alignSelf: 'flex-start', fontSize: '10.5px' }}>
                {fidelity.faithful ? 'ON TARGET' : 'RIVERS CARVE THROUGH COVER'}
              </GeoChip>
            </FieldGroup>

            <FieldGroup title="BOARD CONTENT">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                {SUMMARY_ORDER.filter(k => counts[k]).map(k => (
                  <GeoChip key={k} variant="softBlue" style={{ fontSize: '11px', padding: '2px 7px' }}>
                    {DEV_TERRAIN_LABEL[k] ?? k} {counts[k]}
                  </GeoChip>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {seatColors.map((slot, i) => (
                  <span
                    key={i}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11px', fontWeight: 800, color: 'var(--op-ink-muted)' }}
                  >
                    <i style={{ width: 8, height: 8, background: PLAYER_COLORS[i] ?? '#94a3b8', display: 'inline-block' }} />
                    P{i + 1} @ {slot.x},{slot.y}
                  </span>
                ))}
              </div>
            </FieldGroup>
          </div>
        </GeoCard>

        {/* RIGHT: GENERATION KNOBS + SQUAD + LAUNCH */}
        <GeoCard fill>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '12px', height: '100%' }}>
            <div className="tt-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', flex: 1 }}>
              {/* COLUMN A: TERRAIN & OBJECTS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ ...SECTION_LABEL }}>2. TERRAIN &amp; OBSTACLES</div>

                <FieldGroup>
                  <Slider label="GRID SIZE" value={devOptions.gridSize} min={12} max={32} step={2} suffix="×" onChange={v => setDevOptions({ gridSize: v })} />
                  <Slider
                    label="SEATS"
                    value={devOptions.playerCount}
                    min={2}
                    max={6}
                    onChange={v => setDevOptions({ playerCount: v })}
                    hint="Each seat stamps one HQ, cleared in a 5×5 plaza"
                  />
                </FieldGroup>

                <FieldGroup>
                  <Slider label="FOREST COVER" value={devOptions.forestPct} min={0} max={55} suffix="%" onChange={v => setDevOptions({ forestPct: v })} />
                  <Slider label="MOUNTAIN RANGE" value={devOptions.mountainPct} min={0} max={40} suffix="%" onChange={v => setDevOptions({ mountainPct: v })} />
                  <Slider label="RIVER VOLUME" value={devOptions.waterPct} min={0} max={30} suffix="%" onChange={v => setDevOptions({ waterPct: v })} />
                  <Slider
                    label="RIVERS"
                    value={devOptions.rivers}
                    min={0}
                    max={3}
                    onChange={v => setDevOptions({ rivers: v })}
                    hint="Bridges auto-align across land and water edges so nobody is cut off"
                  />
                  <Slider label="DESERT SPLIT" value={devOptions.desertPct} min={0} max={100} suffix="%" onChange={v => setDevOptions({ desertPct: v })} />
                </FieldGroup>

                <FieldGroup>
                  <Slider
                    label="BUILDINGS"
                    value={devOptions.buildingPct}
                    min={0}
                    max={15}
                    suffix="%"
                    onChange={v => setDevOptions({ buildingPct: v })}
                    hint="Watchtowers fire; bunkers give cover"
                  />
                  <Slider label="LOOSE LOOT" value={devOptions.lootPct} min={0} max={40} suffix="%" onChange={v => setDevOptions({ lootPct: v })} />
                  <Slider label="BANKS" value={devOptions.banks} min={0} max={4} onChange={v => setDevOptions({ banks: v })} />
                </FieldGroup>
              </div>

              {/* COLUMN B: SQUAD, PRESETS, REMINDERS */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ ...SECTION_LABEL, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <span>3. STARTING SQUAD ({totalUnits} UNITS)</span>
                  <SquadGuideButton />
                </div>

                <SquadLoadoutControls
                  unitCounts={settings.unitCounts}
                  showDetails
                  onChange={unitCounts => setGameSettings({ unitCounts })}
                />

                <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>GENERATION PRESETS</div>
                <FieldGroup>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {PRESETS.map(p => (
                      <GeoButton
                        key={p.id}
                        variant="softViolet"
                        onClick={() => setDevOptions(p.patch)}
                        coreStyle={{ padding: '5px 9px', fontSize: '11px' }}
                      >
                        {p.label}
                      </GeoButton>
                    ))}
                  </div>
                </FieldGroup>

                <FieldGroup title="AT LAUNCH">
                  <div style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--op-ink)', fontWeight: 600 }}>
                    A real match opens on this board with the dev panel attached: paint terrain, drop units and structures
                    anywhere, and fire any kill-cam event on demand.
                  </div>
                  <GeoChip variant="softMint" style={{ alignSelf: 'flex-start' }}>
                    PURE SANDBOX ON BY DEFAULT
                  </GeoChip>
                  <div style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--op-ink-muted)' }}>
                    No ranges, no movement points, no CP: click a unit, then any tile to teleport it — or click an enemy,
                    bank, enemy HQ or barrier to strike it.
                  </div>
                </FieldGroup>
              </div>
            </div>

            <GeoButton
              variant={devBotMatch ? 'mint' : 'softViolet'}
              fullWidth
              onClick={() => setDevBotMatch(!devBotMatch)}
              title="Both seats play themselves: launch a self-playing match and just watch"
              coreStyle={{ padding: '10px 14px', fontSize: '12px', fontWeight: 900, letterSpacing: '0.8px' }}
            >
              {devBotMatch ? '🤖 BOT MATCH ON · BOTH SEATS PLAY THEMSELVES' : '🤖 BOT MATCH OFF · HOT-SEAT SANDBOX'}
            </GeoButton>

            <GeoButton
              variant="mint"
              fullWidth
              onClick={launchDevSandbox}
              coreStyle={{ padding: '14px 18px', fontSize: '15px', fontWeight: 900, letterSpacing: '1px' }}
            >
              {devBotMatch ? 'WATCH SIMULATED MATCH →' : 'LAUNCH SANDBOX →'}
            </GeoButton>
          </div>
        </GeoCard>
      </div>
    </StageShell>
  );
};
