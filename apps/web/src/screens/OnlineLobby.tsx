import React, { useEffect, useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS, type TableSettings, type TableView } from '@tactical/engine';
import { normalizeSeed } from '@tactical/engine/utils/SeededRandom';
import { GeoButton, GeoCard, GeoChip, GeoWell, PLAYER_UI_THEME } from '../components/ui/GeoPrimitives';
import {
  BrandHeader,
  DifficultyButtons,
  EnvironmentToggles,
  MutatorToggles,
  SECTION_LABEL,
  SquadLoadoutControls,
  StageShell,
  VictoryModeControl,
} from '../components/ui/MatchRulesControls';
import { useCopyState } from '../hooks/useCopyState';
import { codeFromUrl, goHome, tablePath, useOnline } from '../net/useOnline';
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

const Header: React.FC<{ right?: React.ReactNode }> = ({ right }) => (
  <BrandHeader badge={<GeoChip variant="softBlue" style={{ padding: '5px 10px' }}>ONLINE</GeoChip>} right={right} />
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
  const name = useOnline(s => s.name);
  const setName = useOnline(s => s.setName);
  const createTable = useOnline(s => s.createTable);
  const joinTable = useOnline(s => s.joinTable);
  const busy = useOnline(s => s.busy);
  const [code, setCode] = useState(() => codeFromUrl() ?? '');
  const back = () => {
    goHome();
    useGameStore.setState({ currentScreen: 'SETUP' });
  };
  const named = name.trim().length > 0;

  return (
    <StageShell width={560}>
      <Header right={<GeoButton onClick={back} coreStyle={{ padding: '7px 14px' }}>← LOCAL GAME</GeoButton>} />
      <ErrorBar />
      <GeoCard>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={SECTION_LABEL}>1. YOUR CALLSIGN</div>
          <input
            style={inputStyle}
            placeholder="Name other players will see"
            maxLength={20}
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />

          <div style={SECTION_LABEL}>2. START A TABLE</div>
          <GeoButton variant="blue" fullWidth disabled={!named || busy} onClick={() => void createTable()} coreStyle={{ padding: '11px' }}>
            CREATE TABLE
          </GeoButton>
          <div style={{ fontSize: '12px', color: 'var(--op-ink-muted)' }}>
            You'll get a 4-letter code to share. Fill empty seats with bots.
          </div>

          <div style={SECTION_LABEL}>…OR JOIN ONE</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '4px', textAlign: 'center' }}
              placeholder="CODE"
              maxLength={4}
              value={code}
              onChange={e => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())}
              onKeyDown={e => {
                if (e.key === 'Enter' && named && code.length === 4 && !busy) void joinTable(code);
              }}
            />
            <GeoButton variant="mint" disabled={!named || code.length !== 4 || busy} onClick={() => void joinTable(code)} coreStyle={{ padding: '10px 18px' }}>
              JOIN
            </GeoButton>
          </div>
        </div>
      </GeoCard>
    </StageShell>
  );
};

/** The host's rules. Everyone sees them; only the host can change them. */
const RulesPanel: React.FC<{ settings: TableSettings; isHost: boolean; hasBots: boolean }> = ({ settings, isHost, hasBots }) => {
  const updateSettings = useOnline(s => s.updateSettings);
  const set = (patch: Partial<TableSettings>) => updateSettings({ ...settings, ...patch });
  const total = settings.unitCounts.SOLDIER + settings.unitCounts.ASSAULTER + settings.unitCounts.SNIPER;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', opacity: isHost ? 1 : 0.85 }}>
      <div style={SECTION_LABEL}>RULES {isHost ? '' : '(SET BY THE HOST)'}</div>
      <VictoryModeControl
        victoryMode={settings.victoryMode}
        doomsdayEnabled={settings.doomsdayEnabled}
        disabled={!isHost}
        onPatch={set}
      />
      <EnvironmentToggles
        dynamicWeather={settings.dynamicWeather}
        fogOfWar={settings.fogOfWar}
        disabled={!isHost}
        onPatch={set}
      />

      <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>SQUAD ({total} UNITS EACH)</div>
      <SquadLoadoutControls
        unitCounts={settings.unitCounts}
        disabled={!isHost}
        minTotal={1}
        onChange={unitCounts => set({ unitCounts })}
      />

      {hasBots && (
        <>
          <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>BOT SKILL</div>
          <DifficultyButtons value={settings.aiDifficulty} disabled={!isHost} onChange={aiDifficulty => set({ aiDifficulty })} />
        </>
      )}

      <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>MUTATORS</div>
      <MutatorToggles mutators={settings.mutators} disabled={!isHost} onChange={mutators => set({ mutators })} />

      <div style={{ ...SECTION_LABEL, marginTop: '4px' }}>SECTOR SEED (OPTIONAL)</div>
      <SeedInput value={settings.mapSeed} disabled={!isHost} onCommit={mapSeed => set({ mapSeed })} />
    </div>
  );
};

/** Sent when you leave the field, not on every keystroke. */
const SeedInput: React.FC<{ value: string; disabled: boolean; onCommit: (v: string) => void }> = ({ value, disabled, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const clean = normalizeSeed(draft);
    if (clean !== value) onCommit(clean);
  };
  return (
    <input
      style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '2px' }}
      placeholder="Random map each game"
      maxLength={12}
      value={draft}
      disabled={disabled}
      onChange={e => setDraft(normalizeSeed(e.target.value))}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
};

/** At a table, before the match: who's in, the rules, and Start. */
const Lobby: React.FC<{ view: TableView }> = ({ view }) => {
  const addBot = useOnline(s => s.addBot);
  const removeSeat = useOnline(s => s.removeSeat);
  const start = useOnline(s => s.start);
  const leave = useOnline(s => s.leave);
  const me = view.seats[view.mySeat];
  const isHost = Boolean(me?.isHost);
  const { copied, copy } = useCopyState();
  const link = `${location.origin}${tablePath(view.code)}`;
  const canStart = view.seats.length >= MIN_PLAYERS;

  return (
    <StageShell width={900}>
      <Header right={<GeoButton variant="softRed" onClick={() => void leave()} coreStyle={{ padding: '7px 14px' }}>LEAVE TABLE</GeoButton>} />
      <ErrorBar />
      <div className="tt-cols" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 42%) minmax(0, 1fr)', gap: '14px', alignItems: 'start' }}>
        <GeoCard>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={SECTION_LABEL}>TABLE CODE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '34px', fontWeight: 900, letterSpacing: '8px', color: 'var(--acc-violet-ink)' }}>{view.code}</span>
              <GeoButton variant="softViolet" onClick={() => void copy(link)} coreStyle={{ padding: '6px 12px' }}>
                {copied ? 'COPIED ✓' : 'COPY LINK'}
              </GeoButton>
            </div>

            <div style={{ ...SECTION_LABEL, marginTop: '6px' }}>
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
    </StageShell>
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
        <StageShell width={400}>
          <GeoCard>
            <div style={{ padding: '20px', textAlign: 'center', fontWeight: 800 }}>Connecting…</div>
          </GeoCard>
        </StageShell>
      );
    }
    return <Landing />;
  }
  return <Lobby view={view} />;
};
