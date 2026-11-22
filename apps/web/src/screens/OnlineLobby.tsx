import React, { useEffect, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, UNIT_LIMITS, type TableSettings, type TableView } from '@tactical/engine';
import type { AIDifficulty, UnitType } from '@tactical/engine/types';
import { GeoButton, GeoCard, GeoChip, GeoToggle, GeoWell, PLAYER_UI_THEME } from '../components/ui/GeoPrimitives';
import { codeFromUrl, useOnline } from '../net/useOnline';
import { useGameStore } from '../store/useGameStore';

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px',
  background: '#FFFFFF',
  border: '1.5px solid var(--op-line)',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 700,
  fontFamily: 'inherit',
  color: 'var(--op-ink)',
};

const label: React.CSSProperties = { fontSize: '12px', fontWeight: 900, color: 'var(--op-ink-muted)', letterSpacing: '0.6px' };

const UNIT_META: { type: UnitType; label: string }[] = [
  { type: 'SOLDIER', label: 'SCOUT' },
  { type: 'ASSAULTER', label: 'BREACHER' },
  { type: 'SNIPER', label: 'SNIPER' },
];

const Stage: React.FC<{ children: React.ReactNode; width?: number }> = ({ children, width = 760 }) => (
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
    <div style={{ width: `min(${width}px, 100%)`, margin: 'auto 0', display: 'flex', flexDirection: 'column', gap: '14px' }}>{children}</div>
  </div>
);

const Header: React.FC<{ right?: React.ReactNode }> = ({ right }) => (
  <GeoCard>
    <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          className="geo-chip"
          style={{ background: 'var(--acc-violet)', color: '#FFFFFF', padding: '6px 14px', fontSize: '15px', fontWeight: 900, letterSpacing: '0.8px' }}
        >
          TACTICAL TILES
        </span>
        <GeoChip variant="softBlue" style={{ padding: '5px 10px' }}>ONLINE</GeoChip>
      </div>
      {right}
    </div>
  </GeoCard>
);

const ErrorBar: React.FC = () => {
  const error = useOnline(s => s.error);
  const clearError = useOnline(s => s.clearError);
  if (!error) return null;
  return (
    <GeoWell coreStyle={{ padding: '9px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', background: 'var(--acc-red-soft)' }}>
      <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--acc-red-ink)' }}>{error}</span>
      <GeoButton onClick={clearError} coreStyle={{ padding: '4px 10px' }}>OK</GeoButton>
    </GeoWell>
  );
};

/** Not at a table yet: pick a name, then start one or join one by code. */
const Landing: React.FC = () => {
  const { name, setName, createTable, joinTable, busy } = useOnline();
  const [code, setCode] = useState(() => codeFromUrl() ?? '');
  const back = () => {
    history.replaceState(null, '', '/');
    useGameStore.setState({ currentScreen: 'SETUP' });
  };
  const named = name.trim().length > 0;

  return (
    <Stage width={560}>
      <Header right={<GeoButton onClick={back} coreStyle={{ padding: '7px 14px' }}>← LOCAL GAME</GeoButton>} />
      <ErrorBar />
      <GeoCard>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={label}>1. YOUR CALLSIGN</div>
          <input
            style={inputStyle}
            placeholder="Name other players will see"
            maxLength={20}
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />

          <div style={label}>2. START A TABLE</div>
          <GeoButton variant="blue" fullWidth disabled={!named || busy} onClick={() => void createTable()} coreStyle={{ padding: '11px' }}>
            CREATE TABLE
          </GeoButton>
          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)' }}>
            You'll get a 4-letter code to share. Fill empty seats with bots.
          </div>

          <div style={label}>…OR JOIN ONE</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '4px', textAlign: 'center' }}
              placeholder="CODE"
              maxLength={4}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && named && code.length === 4) void joinTable(code);
              }}
            />
            <GeoButton variant="mint" disabled={!named || code.length !== 4 || busy} onClick={() => void joinTable(code)} coreStyle={{ padding: '10px 18px' }}>
              JOIN
            </GeoButton>
          </div>
        </div>
      </GeoCard>
    </Stage>
  );
};

const MUTATORS: Array<[keyof TableSettings['mutators'], string]> = [
  ['blitzCp', 'Blitz CP (30 Max / +15 CP/turn)'],
  ['scarcity', 'Scarcity (50% Ammo / +50% Bank)'],
  ['ironman', 'Ironman (0 Respawns)'],
];

/** The host's rules. Everyone sees them; only the host can change them. */
const RulesPanel: React.FC<{ settings: TableSettings; isHost: boolean; hasBots: boolean }> = ({ settings, isHost, hasBots }) => {
  const updateSettings = useOnline(s => s.updateSettings);
  const set = (patch: Partial<TableSettings>) => updateSettings({ ...settings, ...patch });
  const total = settings.unitCounts.SOLDIER + settings.unitCounts.ASSAULTER + settings.unitCounts.SNIPER;
  const count = (type: UnitType, delta: number) => {
    const next = Math.max(0, Math.min(UNIT_LIMITS[type], settings.unitCounts[type] + delta));
    const counts = { ...settings.unitCounts, [type]: next };
    if (counts.SOLDIER + counts.ASSAULTER + counts.SNIPER === 0) return;
    set({ unitCounts: counts });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: isHost ? 1 : 0.85 }}>
      <div style={label}>RULES {isHost ? '' : '(SET BY THE HOST)'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        <GeoButton variant={settings.victoryMode === 'CONQUER' ? 'amber' : 'default'} fullWidth disabled={!isHost} onClick={() => set({ victoryMode: 'CONQUER' })}>
          CONQUER (HQ)
        </GeoButton>
        <GeoButton variant={settings.victoryMode === 'DEATHMATCH' ? 'red' : 'default'} fullWidth disabled={!isHost} onClick={() => set({ victoryMode: 'DEATHMATCH' })}>
          DEATHMATCH
        </GeoButton>
      </div>
      {settings.victoryMode === 'DEATHMATCH' && (
        <GeoToggle label="Doomsday Protocol (Shrinking Map)" value={settings.doomsdayEnabled} disabled={!isHost} onChange={v => set({ doomsdayEnabled: v })} variant="amber" />
      )}
      <GeoToggle label="Dynamic Weather" value={settings.dynamicWeather} disabled={!isHost} onChange={v => set({ dynamicWeather: v })} />
      <GeoToggle label="Fog of War" value={settings.fogOfWar} disabled={!isHost} onChange={v => set({ fogOfWar: v })} />

      <div style={{ ...label, marginTop: '4px' }}>SQUAD ({total} UNITS EACH)</div>
      {UNIT_META.map(({ type, label: name }) => (
        <GeoWell key={type} coreStyle={{ padding: '6px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 900 }}>{name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <GeoButton disabled={!isHost || settings.unitCounts[type] <= 0} onClick={() => count(type, -1)} coreStyle={{ padding: '3px 10px' }}>-</GeoButton>
            <span style={{ fontSize: '15px', fontWeight: 900, width: '18px', textAlign: 'center' }}>{settings.unitCounts[type]}</span>
            <GeoButton disabled={!isHost || settings.unitCounts[type] >= UNIT_LIMITS[type]} onClick={() => count(type, 1)} coreStyle={{ padding: '3px 10px' }}>+</GeoButton>
          </div>
        </GeoWell>
      ))}

      {hasBots && (
        <>
          <div style={{ ...label, marginTop: '4px' }}>BOT SKILL</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {(['EASY', 'MEDIUM', 'HARD'] as AIDifficulty[]).map(d => (
              <GeoButton
                key={d}
                fullWidth
                disabled={!isHost}
                variant={settings.aiDifficulty === d ? (d === 'EASY' ? 'mint' : d === 'MEDIUM' ? 'amber' : 'red') : 'default'}
                onClick={() => set({ aiDifficulty: d })}
                coreStyle={{ padding: '7px 4px' }}
              >
                {d}
              </GeoButton>
            ))}
          </div>
        </>
      )}

      <div style={{ ...label, marginTop: '4px' }}>MUTATORS</div>
      {MUTATORS.map(([key, text]) => (
        <GeoToggle key={key} label={text} value={settings.mutators[key]} disabled={!isHost} onChange={v => set({ mutators: { ...settings.mutators, [key]: v } })} variant="amber" />
      ))}

      <div style={{ ...label, marginTop: '4px' }}>SECTOR SEED (OPTIONAL)</div>
      <SeedInput value={settings.mapSeed} disabled={!isHost} onCommit={mapSeed => set({ mapSeed })} />
    </div>
  );
};

/** Sent when you leave the field, not on every keystroke. */
const SeedInput: React.FC<{ value: string; disabled: boolean; onCommit: (v: string) => void }> = ({ value, disabled, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '2px' }}
      placeholder="Random map each game"
      maxLength={12}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase())}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
};

/** At a table, before the match: who's in, the rules, and Start. */
const Lobby: React.FC<{ view: TableView }> = ({ view }) => {
  const { addBot, removeSeat, start, leave } = useOnline();
  const me = view.seats[view.mySeat];
  const isHost = Boolean(me?.isHost);
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/t/${view.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const canStart = view.seats.length >= MIN_PLAYERS;

  return (
    <Stage width={900}>
      <Header right={<GeoButton variant="softRed" onClick={() => void leave()} coreStyle={{ padding: '7px 14px' }}>LEAVE TABLE</GeoButton>} />
      <ErrorBar />
      <div className="tt-cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 42%) minmax(0, 1fr)', gap: '14px', alignItems: 'start' }}>
        <GeoCard>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={label}>TABLE CODE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '34px', fontWeight: 900, letterSpacing: '8px', color: 'var(--acc-violet-ink)' }}>{view.code}</span>
              <GeoButton variant="softViolet" onClick={() => void copy()} coreStyle={{ padding: '6px 12px' }}>
                {copied ? 'COPIED ✓' : 'COPY LINK'}
              </GeoButton>
            </div>

            <div style={{ ...label, marginTop: '6px' }}>
              SEATS ({view.seats.length}/{MAX_PLAYERS})
            </div>
            {view.seats.map((s, i) => {
              const theme = PLAYER_UI_THEME[i] ?? PLAYER_UI_THEME[0];
              return (
                <GeoWell key={i} coreStyle={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="geo-chip" style={{ background: theme.badgeBg, color: theme.badgeText, padding: '2px 8px', fontSize: '12px', fontWeight: 900 }}>
                    P{i + 1}
                  </span>
                  <span style={{ flex: 1, fontSize: '14px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.name}
                    {i === view.mySeat ? ' (you)' : ''}
                  </span>
                  {s.isHost && <GeoChip variant="softAmber" style={{ padding: '1px 7px' }}>HOST</GeoChip>}
                  {s.isBot && <GeoChip variant="softViolet" style={{ padding: '1px 7px' }}>BOT</GeoChip>}
                  {!s.isBot && !s.connected && <GeoChip variant="softRed" style={{ padding: '1px 7px' }}>AWAY</GeoChip>}
                  {isHost && i !== view.mySeat && (
                    <GeoButton onClick={() => removeSeat(i)} coreStyle={{ padding: '2px 8px' }}>✕</GeoButton>
                  )}
                </GeoWell>
              );
            })}
            {isHost && view.seats.length < MAX_PLAYERS && (
              <GeoButton variant="softViolet" fullWidth onClick={addBot}>+ ADD BOT</GeoButton>
            )}

            <div style={{ marginTop: '8px' }}>
              {isHost ? (
                <GeoButton variant="blue" fullWidth disabled={!canStart} onClick={start} coreStyle={{ padding: '12px' }}>
                  {canStart ? `START MATCH (${view.seats.length} PLAYERS) →` : 'NEED 2 SEATS — SHARE THE CODE OR ADD A BOT'}
                </GeoButton>
              ) : (
                <GeoWell coreStyle={{ padding: '10px', textAlign: 'center', fontSize: '13px', fontWeight: 800, color: 'var(--op-ink-muted)' }}>
                  Waiting for the host to start…
                </GeoWell>
              )}
            </div>
          </div>
        </GeoCard>

        <GeoCard>
          <div style={{ padding: '16px' }}>
            <RulesPanel settings={view.settings} isHost={isHost} hasBots={view.seats.some(s => s.isBot)} />
          </div>
        </GeoCard>
      </div>
    </Stage>
  );
};

export const OnlineLobby: React.FC = () => {
  const view = useOnline(s => s.view);
  const busy = useOnline(s => s.busy);
  const resume = useOnline(s => s.resume);

  // Back at a table you were seated at (a reload): rejoin it.
  useEffect(() => {
    void resume();
  }, [resume]);

  if (!view) {
    if (busy) {
      return (
        <Stage width={400}>
          <GeoCard>
            <div style={{ padding: '20px', textAlign: 'center', fontWeight: 800 }}>Connecting…</div>
          </GeoCard>
        </Stage>
      );
    }
    return <Landing />;
  }
  return <Lobby view={view} />;
};
