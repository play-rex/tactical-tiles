import React from 'react';
import { UNIT_LIMITS, type TableSettings } from '@tactical/engine';
import type { AIDifficulty, GameMutators, UnitType } from '@tactical/engine/types';
import { GeoButton, GeoCard, GeoToggle, GeoWell } from './GeoPrimitives';

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

const MUTATORS: Array<{ key: keyof GameMutators; label: string; setupLabel: string }> = [
  { key: 'blitzCp', label: 'Blitz CP (30 Max / +15 CP/turn)', setupLabel: 'Blitz CP (30 Max / +15 CP/turn)' },
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

type RulePatch = Partial<Pick<TableSettings, 'victoryMode' | 'doomsdayEnabled' | 'dynamicWeather' | 'fogOfWar' | 'aiDifficulty' | 'unitCounts' | 'mutators'>>;

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
  <>
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
  </>
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
    <>
      {UNIT_META.map(({ type, label, role }) => {
        const max = UNIT_LIMITS[type];
        return (
          <GeoWell
            key={type}
            coreStyle={{
              padding: showDetails ? '8px 10px' : '6px 10px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: showDetails ? '8px' : undefined,
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 900 }}>
                {label}
                {showDetails && (
                  <span style={{ fontSize: '12px', color: 'var(--op-ink-muted)', fontWeight: 600 }}> (Max {max})</span>
                )}
              </div>
              {showDetails && <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)' }}>{role}</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <GeoButton
                onClick={() => step(type, -1)}
                disabled={disabled || unitCounts[type] <= 0}
                coreStyle={{ padding: showDetails ? '4px 10px' : '3px 10px' }}
              >
                -
              </GeoButton>
              <span style={{ fontSize: '15px', fontWeight: 900, width: '18px', textAlign: 'center' }}>
                {unitCounts[type]}
              </span>
              <GeoButton
                onClick={() => step(type, 1)}
                disabled={disabled || unitCounts[type] >= max}
                coreStyle={{ padding: showDetails ? '4px 10px' : '3px 10px' }}
              >
                +
              </GeoButton>
            </div>
          </GeoWell>
        );
      })}
    </>
  );
};

export const MutatorToggles: React.FC<{
  mutators?: GameMutators;
  disabled?: boolean;
  detailedLabels?: boolean;
  onChange: (next: GameMutators) => void;
}> = ({ mutators, disabled = false, detailedLabels = false, onChange }) => {
  const current: GameMutators = {
    blitzCp: Boolean(mutators?.blitzCp),
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
