import React from 'react';
import { TURN_BASE_OPTIONS, TURN_INCREMENT_OPTIONS, UNIT_LIMITS, type TableSettings } from '@tactical/engine';
import type { AIDifficulty, GameMutators, UnitType } from '@tactical/engine/types';
import { GOLD_SETTINGS } from '@tactical/engine/constants/Config';
import { GeoButton, GeoCard, GeoToggle, GeoWell } from './GeoPrimitives';
import { UnitGuideModal, UnitMapIcon } from './UnitDeckModal';

export const SECTION_LABEL: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 900,
  color: 'var(--op-ink-muted)',
  letterSpacing: '0.6px',
};

const UNIT_META: Array<{ type: UnitType; label: string; role: string }> = [
  { type: 'SOLDIER', label: 'SCOUT', role: 'Fast recon, captures & heists (3 CP)' },
  { type: 'ASSAULTER', label: 'BREACHER', role: 'Heavy frontline siege unit (5 CP)' },
  { type: 'SNIPER', label: 'SNIPER', role: 'High-ground precision cannon (8 CP)' },
];

export const GOLD_PRESETS = [
  { key: 'lean', label: 'LEAN', startingGold: 150, goldIncome: 15 },
  { key: 'standard', label: 'STANDARD', startingGold: 200, goldIncome: 20 },
  { key: 'frontload', label: 'FAST START', startingGold: 300, goldIncome: 15 },
] as const;

const MUTATORS: Array<{ key: keyof GameMutators; label: string; setupLabel: string }> = [
  { key: 'classicCp', label: 'Classic CP (20 Max / +10 CP/turn)', setupLabel: 'Classic CP (20 Max / +10 CP/turn)' },
  { key: 'scarcity', label: 'Scarcity (50% Ammo / +50% Bank)', setupLabel: 'Scarcity (50% Ammo / +50% Bank)' },
  { key: 'ironman', label: 'Ironman (0 Respawns)', setupLabel: 'Ironman (0 Graveyard Respawns)' },
];

export const StageShell: React.FC<{ children: React.ReactNode; width?: number }> = ({ children, width = 1140 }) => (
  <div
    className="opgeo-stage opgeo-scroll"
    style={{
      width: '100vw',
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: 'clamp(8px, 2vw, 16px)',
      boxSizing: 'border-box',
      overflowY: 'auto',
    }}
  >
    {/* margin: auto centres it when it fits, and lets it scroll from the top when it doesn't */}
    <div style={{ width: `min(${width}px, 100%)`, margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {children}
    </div>
  </div>
);

export const BrandHeader: React.FC<{ badge?: React.ReactNode; right?: React.ReactNode }> = ({ badge, right }) => (
  <GeoCard>
    <div
      style={{
        padding: '10px 16px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
        <span
          className="geo-chip"
          style={{
            background: 'var(--acc-violet)',
            color: '#FFFFFF',
            padding: '6px 14px',
            fontSize: '15px',
            fontWeight: 900,
            letterSpacing: '0.8px',
          }}
        >
          TACTICAL TILES
        </span>
        {badge}
      </div>
      {right}
    </div>
  </GeoCard>
);

type RulePatch = Partial<Pick<TableSettings, 'victoryMode' | 'doomsdayEnabled' | 'dynamicWeather' | 'fogOfWar' | 'aiDifficulty' | 'unitCounts' | 'mutators' | 'turnBaseS' | 'turnIncrementS'>>;

export const TurnClockControls: React.FC<{
  turnBaseS: number;
  turnIncrementS: number;
  disabled?: boolean;
  onPatch: (patch: RulePatch) => void;
}> = ({ turnBaseS, turnIncrementS, disabled = false, onPatch }) => (
  <>
    <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>TURN TIME (SEC)</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
      {TURN_BASE_OPTIONS.map(v => (
        <GeoButton key={v} fullWidth disabled={disabled} variant={turnBaseS === v ? 'blue' : 'default'} onClick={() => onPatch({ turnBaseS: v })} coreStyle={{ padding: '7px 4px' }}>
          {v === 0 ? 'OFF' : v}
        </GeoButton>
      ))}
    </div>
    <div style={{ fontSize: '12px', fontWeight: 800, color: 'var(--op-ink-muted)', marginTop: '6px' }}>+ SECONDS PER ACTION</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
      {TURN_INCREMENT_OPTIONS.map(v => (
        <GeoButton key={v} fullWidth disabled={disabled} variant={turnIncrementS === v ? 'mint' : 'default'} onClick={() => onPatch({ turnIncrementS: v })} coreStyle={{ padding: '7px 4px' }}>
          {v === 0 ? '+0' : '+' + v}
        </GeoButton>
      ))}
    </div>
    <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)' }}>Idle past the clock auto-ends the turn. Every action banks its bonus with no cap.</div>
  </>
);

export const VictoryModeControl: React.FC<{
  victoryMode: TableSettings['victoryMode'];
  doomsdayEnabled: boolean;
  disabled?: boolean;
  showConquerNote?: boolean;
  onPatch: (patch: RulePatch) => void;
}> = ({ victoryMode, doomsdayEnabled, disabled = false, showConquerNote = false, onPatch }) => (
  <>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
      <GeoButton
        variant={victoryMode === 'CONQUER' ? 'amber' : 'default'}
        fullWidth
        disabled={disabled}
        onClick={() => onPatch({ victoryMode: 'CONQUER' })}
      >
        CONQUER (HQ)
      </GeoButton>
      <GeoButton
        variant={victoryMode === 'DEATHMATCH' ? 'red' : 'default'}
        fullWidth
        disabled={disabled}
        onClick={() => onPatch({ victoryMode: 'DEATHMATCH' })}
      >
        DEATHMATCH
      </GeoButton>
    </div>
    {victoryMode === 'DEATHMATCH' ? (
      <GeoToggle
        label="Doomsday Protocol (Shrinking Map)"
        value={doomsdayEnabled}
        disabled={disabled}
        onChange={v => onPatch({ doomsdayEnabled: v })}
        variant="amber"
      />
    ) : showConquerNote ? (
      <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontStyle: 'italic', paddingLeft: '2px' }}>
        Destroy enemy Headquarters to win.
      </div>
    ) : null}
  </>
);

export const EnvironmentToggles: React.FC<{
  dynamicWeather: boolean;
  fogOfWar: boolean;
  disabled?: boolean;
  detailedLabels?: boolean;
  onPatch: (patch: RulePatch) => void;
}> = ({ dynamicWeather, fogOfWar, disabled = false, detailedLabels = false, onPatch }) => (
  <div className="tt-env2">
    <GeoToggle
      label={detailedLabels ? 'Dynamic Weather (Voronoi Shifts)' : 'Dynamic Weather'}
      value={dynamicWeather}
      disabled={disabled}
      onChange={v => onPatch({ dynamicWeather: v })}
    />
    <GeoToggle
      label={detailedLabels ? 'Fog of War (Line-of-Sight Vision)' : 'Fog of War'}
      value={fogOfWar}
      disabled={disabled}
      onChange={v => onPatch({ fogOfWar: v })}
    />
  </div>
);

export const SpectatorAttacksControl: React.FC<{
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}> = ({ value, disabled = false, onChange }) => (
  <GeoToggle
    label="Eliminated Player Attacks (one map effect every 2 rounds)"
    value={value}
    disabled={disabled}
    onChange={onChange}
    variant="amber"
  />
);

export const DifficultyButtons: React.FC<{
  value: AIDifficulty;
  disabled?: boolean;
  onChange: (difficulty: AIDifficulty) => void;
}> = ({ value, disabled = false, onChange }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
    {(['EASY', 'MEDIUM', 'HARD'] as AIDifficulty[]).map(d => (
      <GeoButton
        key={d}
        fullWidth
        disabled={disabled}
        variant={value === d ? (d === 'EASY' ? 'mint' : d === 'MEDIUM' ? 'amber' : 'red') : 'default'}
        onClick={() => onChange(d)}
        coreStyle={{ padding: '7px 4px' }}
      >
        {d}
      </GeoButton>
    ))}
  </div>
);

export const SquadLoadoutControls: React.FC<{
  unitCounts: TableSettings['unitCounts'];
  disabled?: boolean;
  showDetails?: boolean;
  minTotal?: number;
  onChange: (nextCounts: TableSettings['unitCounts']) => void;
}> = ({ unitCounts, disabled = false, showDetails = false, minTotal = 0, onChange }) => {

  const step = (type: UnitType, delta: number) => {
    const next = Math.max(0, Math.min(UNIT_LIMITS[type], unitCounts[type] + delta));
    const updated = { ...unitCounts, [type]: next };
    if (updated.SOLDIER + updated.ASSAULTER + updated.SNIPER < minTotal) return;
    onChange(updated);
  };

  return (
    <div className="tt-squad3">
      {UNIT_META.map(({ type, label, role }) => {
        const max = UNIT_LIMITS[type];
        return (
          <GeoWell
            key={type}
            coreStyle={{
              padding: '7px 6px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '2px',
            }}
          >
            <UnitMapIcon type={type} label={label} size={40} />
            <div style={{ fontSize: '13px', fontWeight: 900, lineHeight: 1.2, textAlign: 'center' }}>
              {label}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <GeoButton
                onClick={() => step(type, -1)}
                disabled={disabled || unitCounts[type] <= 0}
                coreStyle={{ padding: '3px 10px' }}
              >
                -
              </GeoButton>
              <span style={{ fontSize: '15px', fontWeight: 900, minWidth: '34px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                {unitCounts[type]}<span style={{ fontSize: '11px', color: 'var(--op-ink-muted)', fontWeight: 700 }}>/{max}</span>
              </span>
              <GeoButton
                onClick={() => step(type, 1)}
                disabled={disabled || unitCounts[type] >= max}
                coreStyle={{ padding: '3px 10px' }}
              >
                +
              </GeoButton>
            </div>
          </GeoWell>
        );
      })}
    </div>
  );
};

/** Single UNIT GUIDE ? button + modal. Renders in the section header row, sharing its line. */
export const SquadGuideButton: React.FC = () => {
  const [guide, setGuide] = React.useState(false);
  return (
    <>
      <GeoButton onClick={() => setGuide(true)} coreStyle={{ padding: '4px 12px', fontSize: '12px' }} title="Open the squad guide: all three units side by side">
        SQUAD GUIDE ?
      </GeoButton>
      {guide && <UnitGuideModal onClose={() => setGuide(false)} />}
    </>
  );
};

export const GoldEconomyControl: React.FC<{
  startingGold: number;
  goldIncome: number;
  disabled?: boolean;
  onChange: (startingGold: number, goldIncome: number) => void;
}> = ({ startingGold, goldIncome, disabled = false, onChange }) => (
  <>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
      {GOLD_PRESETS.map(preset => {
        const active = startingGold === preset.startingGold && goldIncome === preset.goldIncome;
        return (
          <GeoButton
            key={preset.key}
            fullWidth
            disabled={disabled}
            variant={active ? 'amber' : 'default'}
            onClick={() => onChange(preset.startingGold, preset.goldIncome)}
            coreStyle={{ padding: '6px 4px', lineHeight: 1.25 }}
          >
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 900 }}>{preset.label}</span>
            <span style={{ display: 'block', fontSize: '12px', fontWeight: 900 }}>€{preset.startingGold} / +{preset.goldIncome}</span>
          </GeoButton>
        );
      })}
    </div>
    <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)', lineHeight: 1.4 }}>
      Starting gold / income per turn. Buildings still pay +€{GOLD_SETTINGS.BUILDING_INCOME} each turn.
    </div>
  </>
);

export const MutatorToggles: React.FC<{
  mutators?: GameMutators;
  disabled?: boolean;
  detailedLabels?: boolean;
  onChange: (next: GameMutators) => void;
}> = ({ mutators, disabled = false, detailedLabels = false, onChange }) => {
  const current: GameMutators = {
    classicCp: Boolean(mutators?.classicCp),
    scarcity: Boolean(mutators?.scarcity),
    ironman: Boolean(mutators?.ironman),
  };
  return (
    <>
      {MUTATORS.map(m => (
        <GeoToggle
          key={m.key}
          label={detailedLabels ? m.setupLabel : m.label}
          value={current[m.key]}
          disabled={disabled}
          onChange={v => onChange({ ...current, [m.key]: v })}
          variant="amber"
        />
      ))}
    </>
  );
};
