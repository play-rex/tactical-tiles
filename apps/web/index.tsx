import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/opChamferGeo.css';
import './src/styles/killCam.css';
import './src/styles/devOverlay.css';
import './src/styles/tacticalTargeting.css';
import { GameRenderer } from './src/components/game/GameRenderer';
import { BankRewardModal, LeftPanel, RightPanel, WinnerOverlay } from './src/components/ui/HUD';
import { GameSetup } from './src/screens/GameSetup';
import { MapEditor } from './src/screens/MapEditor';
import { HowToPlay } from './src/screens/HowToPlay';
import { OnlineLobby } from './src/screens/OnlineLobby';
import { DevMaps } from './src/screens/DevMaps';
import { hasSavedTable, codeFromUrl, useOnline } from './src/net/useOnline';
import { useGameStore } from './src/store/useGameStore';
import { ViewportProvider } from './src/context/ViewportContext';
import { MapControls, PhoneDock } from './src/components/game/ui/MapControls';
import { MapHoverCard } from './src/components/game/ui/MapHoverCard';
import { TacticalTargetingBar } from './src/components/game/ui/TacticalTargetingBar';
import { TurnBanner } from './src/components/game/ui/TurnBanner';
import { TacticalBanner } from './src/components/game/ui/TacticalBanner';
import { KillCamOverlay } from './src/components/game/ui/KillCamOverlay';
import { RecapBanner } from './src/components/game/ui/RecapBanner';
import { DevOverlay } from './src/components/game/ui/DevOverlay';
import { CameraFollow } from './src/components/game/ui/CameraFollow';
import { useNarrow } from './src/hooks/useNarrow';
import { GeoButton, GeoCard, GeoChip, GeoWell, PLAYER_UI_THEME, playerDisplayName } from './src/components/ui/GeoPrimitives';
import { TurnClockLine } from './src/components/game/ui/TurnClock';
import { getTileByIdFast } from '@tactical/engine/grid/Pathfinding';
import { canUnitAttackFromTile } from '@tactical/engine/rules/CombatRules';
import { SoundFX } from './src/core/audio/SoundFX';
import { useEffectStore } from './src/store/useEffectStore';

const OnlineErrorToast: React.FC = () => {
  const mode = useGameStore(state => state.mode);
  const error = useOnline(state => state.error);
  const clearError = useOnline(state => state.clearError);
  if (mode !== 'ONLINE' || !error) return null;
  return (
    <div style={{ position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: 250, maxWidth: 'min(480px, calc(100vw - 24px))' }}>
      <GeoWell coreStyle={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--acc-red-soft)' }}>
        <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--acc-red-ink)' }}>{error}</span>
        <GeoButton onClick={clearError} coreStyle={{ padding: '3px 9px' }}>OK</GeoButton>
      </GeoWell>
    </div>
  );
};

/** `compact`: the phone version, with the guidance on its own line and fewer buttons. */
const TopBattleGuidanceBar: React.FC<{ compact?: boolean }> = React.memo(({ compact = false }) => {
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const isAiTurn = useGameStore(state => state.isAiTurn);
  const winner = useGameStore(state => state.winner);
  const gridSize = useGameStore(state => state.gridSize);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const units = useGameStore(state => state.units);
  const mapData = useGameStore(state => state.mapData);
  const placementMode = useGameStore(state => state.placementMode);
  const bankRewardPending = useGameStore(state => state.bankRewardPending);
  const selectedInventoryItemIndex = useGameStore(state => state.selectedInventoryItemIndex);
  const selectedGraveyardUnitId = useGameStore(state => state.selectedGraveyardUnitId);
  const resetGame = useGameStore(state => state.resetGame);
  const mapRotation = useGameStore(state => state.mapRotation);
  const rotateMap = useGameStore(state => state.rotateMap);
  const fxMode = useEffectStore(state => state.fxMode);
  const toggleFxMode = useEffectStore(state => state.toggleFxMode);
  const killCamMode = useEffectStore(state => state.killCamMode);
  const cycleKillCamMode = useEffectStore(state => state.cycleKillCamMode);
  const [muted, setMuted] = useState(() => SoundFX.isMuted());

  const killCamTitle =
    killCamMode === 'FULL'
      ? 'Kill Cam: FULL (≤4s cinematic cuts + attack micro-cam · Click for SHORT)'
      : killCamMode === 'SHORT'
        ? 'Kill Cam: SHORT (fast ~1–2s cuts + snappy attack lean · Click for OFF)'
        : 'Kill Cam: OFF (classic tactical banners only · Click for FULL)';

  const toggleMute = () => {
    const next = !muted;
    SoundFX.setMuted(next);
    setMuted(next);
  };

  const selectedUnit = units.find(u => u.id === selectedUnitId);
  const selectedUnitTile = selectedUnit ? getTileByIdFast(mapData, selectedUnit.tileId, gridSize) : undefined;
  const pTheme = PLAYER_UI_THEME[currentPlayer] || PLAYER_UI_THEME[0];

  const mode = useGameStore(state => state.mode);
  const seats = useOnline(state => state.view?.seats);
  const reconnecting = useOnline(state => state.reconnecting);
  const playerNames = useGameStore(state => state.settings.playerNames);
  const seatName = (p: number) => playerDisplayName(p, playerNames, mode === 'ONLINE' ? seats?.[p]?.name : undefined);
  const turnName = seatName(currentPlayer);

  let guidance = 'Select a unit to command, or press TAB.';
  if (mode === 'ONLINE' && reconnecting) {
    guidance = 'Connection lost — reconnecting to the table…';
  } else if (winner !== null) {
    guidance = winner === 'DRAW' ? 'Match complete — mutual annihilation. Draw.' : `Match complete — ${seatName(winner)} victorious.`;
  } else if (isAiTurn && mode === 'ONLINE') {
    const seat = seats?.[currentPlayer];
    guidance = seat?.isBot || seat?.autopilot
      ? `${seatName(currentPlayer)} — bot is playing the turn...`
      : `${seatName(currentPlayer)} is taking their turn...`;
  } else if (isAiTurn) {
    guidance = `${turnName} is executing moves...`;
  } else if (bankRewardPending && bankRewardPending.playerId === currentPlayer) {
    guidance = 'Vault Breached! Choose Euros or CP loot.';
  } else if (placementMode && placementMode.active) {
    guidance =
      placementMode.kind === 'TACTICAL'
        ? 'Tactical Targeting: Click a lit target on the spotlighted map, SPACE to flip/fire, ESC or Right-Click to cancel.'
        : placementMode.kind === 'DROP'
          ? 'Supply Airdrop: Click a highlighted amber tile, or Auto-Drop near HQ.'
          : 'Construction Mode: Click a cyan tile to deploy, or Cancel.';
  } else if (selectedInventoryItemIndex !== null) {
    guidance = 'Supply Armed: Click a friendly unit to apply.';
  } else if (selectedGraveyardUnitId) {
    guidance = 'Reinforcement: Click a green tile near HQ to respawn.';
  } else if (selectedUnit && selectedUnit.owner === currentPlayer) {
    if (selectedUnit.isOverwatching) {
      guidance = 'Overwatch Armed: Traps first entering enemy next turn.';
    } else if (selectedUnit.completed) {
      guidance = 'Unit Done: Already acted this turn (cannot move or attack) • TAB Next';
    } else if (selectedUnit.hasMoved) {
      guidance = 'Moved: Click RED target to Attack • O Overwatch • TAB Next';
    } else if (selectedUnit.type === 'SNIPER' && !canUnitAttackFromTile(selectedUnit, selectedUnitTile)) {
      guidance = 'Sniper: Move to Mountain, Dunes, or Owned Building to fire.';
    } else {
      guidance = 'BLUE Move • RED Attack • O Overwatch • R Rotate • Z Undo • TAB Next';
    }
  }

  // On a phone there's no keyboard: say what to tap instead.
  if (compact) {
    if (guidance === 'Select a unit to command, or press TAB.') guidance = 'Tap one of your units, or NEXT to cycle through them.';
    else if (guidance.startsWith('BLUE Move')) guidance = 'Tap a blue tile to move there, a red one to attack. INTEL has more actions.';
  }



  const turnChip = (
    <span
      className="geo-chip"
      style={{
        background: pTheme.badgeBg,
        color: pTheme.badgeText,
        padding: '3px 9px',
        fontSize: '12px',
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {turnName.toUpperCase()} • P{currentPlayer + 1}
    </span>
  );
  const leave = () => {
    // Online, leaving hands your seat to a bot for the rest of the match
    if (mode === 'ONLINE' && winner === null && !window.confirm('Leave the table? A bot takes over your squad.')) return;
    if (mode === 'LOCAL' && winner === null && !window.confirm('Abandon this match?')) return;
    resetGame();
  };

  if (compact) {
    return (
      <GeoCard>
        <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {turnChip}
            <TurnClockLine />
            <span style={{ flex: 1 }} />
            <GeoButton
              onClick={() => rotateMap(90)}
              variant={mapRotation === 0 ? 'default' : 'softAmber'}
              title="Rotate map view 90°"
              coreStyle={{ padding: '4px 9px' }}
            >
              ↻ {mapRotation}°
            </GeoButton>
            <GeoButton
              onClick={cycleKillCamMode}
              variant={killCamMode === 'FULL' ? 'softBlue' : killCamMode === 'SHORT' ? 'softAmber' : 'default'}
              title={killCamTitle}
              coreStyle={{ padding: '4px 8px' }}
            >
              {killCamMode === 'OFF' ? 'CAM OFF' : killCamMode === 'SHORT' ? 'CAM 1×' : 'CAM'}
            </GeoButton>
            <GeoButton
              onClick={toggleFxMode}
              variant={fxMode === 'ECO' ? 'softMint' : 'softBlue'}
              title={fxMode === 'ECO' ? 'Switch to Live Ambient Map FX (water shimmer, radar sweeps, base smoke)' : 'Pause Ambient Map FX (0% idle GPU Eco mode)'}
              coreStyle={{ padding: '4px 9px' }}
            >
              {fxMode === 'ECO' ? 'ECO' : 'LIVE'}
            </GeoButton>
            <GeoButton onClick={toggleMute} variant={muted ? 'default' : 'softBlue'} coreStyle={{ padding: '4px 9px' }}>
              {muted ? 'MUTED' : 'SOUND'}
            </GeoButton>
            <GeoButton onClick={leave} variant="softRed" coreStyle={{ padding: '4px 9px' }}>
              {mode === 'ONLINE' ? 'LEAVE' : 'QUIT'}
            </GeoButton>
          </div>
          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--op-ink-muted)', lineHeight: 1.3 }}>{guidance}</div>
        </div>
      </GeoCard>
    );
  }

  return (
    <GeoCard>
      <div
        style={{
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          minHeight: '40px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
          {turnChip}
          <GeoChip variant="softBlue" style={{ flexShrink: 0, fontFamily: 'monospace' }}>
            {gridSize}×{gridSize}
          </GeoChip>
          <span
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--op-ink-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={guidance}
          >
            {guidance}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <GeoButton
            onClick={() => rotateMap(90)}
            onContextMenu={(e) => { e.preventDefault(); rotateMap(-90); }}
            variant={mapRotation === 0 ? 'default' : 'softAmber'}
            title="Rotate map view 90° clockwise (R) • Right-click or Shift+R for counter-clockwise"
            coreStyle={{ padding: '4px 10px' }}
          >
            ↻ {mapRotation}°
          </GeoButton>
          <GeoButton
            onClick={cycleKillCamMode}
            variant={killCamMode === 'FULL' ? 'softBlue' : killCamMode === 'SHORT' ? 'softAmber' : 'default'}
            title={killCamTitle}
            coreStyle={{ padding: '4px 10px' }}
          >
            CAM: {killCamMode}
          </GeoButton>
          <GeoButton
            onClick={toggleFxMode}
            variant={fxMode === 'ECO' ? 'softMint' : 'softBlue'}
            title={
              fxMode === 'ECO'
                ? 'Eco Graphics: 0% idle GPU with 60 FPS combat FX (Click for Live Ambient Map)'
                : 'Live Map FX: Water caustics, radar sweeps, bank beacons & base smoke @ 24 FPS idle (Click to pause ambient FX)'
            }
            coreStyle={{ padding: '4px 10px' }}
          >
            {fxMode === 'ECO' ? 'FX: ECO' : 'FX: LIVE'}
          </GeoButton>
          <GeoButton
            onClick={toggleMute}
            variant={muted ? 'default' : 'softBlue'}
            title={muted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            coreStyle={{ padding: '4px 10px' }}
          >
            {muted ? 'MUTE' : 'SFX ON'}
          </GeoButton>
          <GeoButton
            onClick={leave}
            variant="softRed"
            coreStyle={{ padding: '4px 10px' }}
          >
            {mode === 'ONLINE' ? 'LEAVE TABLE' : 'ABORT MISSION'}
          </GeoButton>
        </div>
      </div>
    </GeoCard>
  );
});

/** The board in its steel tray, with the turn banner over it. */
const MapFrame: React.FC = () => (
  <div className="geo-drop geo-fill" style={{ flex: 1, minHeight: 0 }}>
    <div className="geo-backplate" />
    <div className="geo-rim" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="geo-body" style={{ flex: 1, minHeight: 0, padding: '6px', display: 'flex' }}>
        <div className="geo-frame-rim" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div className="geo-frame-core" style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
            <GameRenderer />
            <TacticalTargetingBar />
            <MapHoverCard />
            <TurnBanner />
            <TacticalBanner />
            <KillCamOverlay />
            <RecapBanner />
            <DevOverlay />
          </div>
        </div>
      </div>
    </div>
  </div>
);

type Sheet = 'SQUADS' | 'INTEL' | null;

/** Phones: the map takes the screen; squads, shop, intel and the log open as a sheet over it. */
const PhoneBattle: React.FC = () => {
  const [sheet, setSheet] = useState<Sheet>(null);
  return (
    <div
      className="opgeo-stage"
      style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100dvh', overflow: 'hidden', padding: '6px', gap: '6px' }}
    >
      <CameraFollow />
      <TopBattleGuidanceBar compact />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <MapFrame />
        {sheet && (
          <div className="tt-sheet" role="dialog" aria-label={sheet === 'SQUADS' ? 'Squads and shop' : 'Intel and log'}>
            <div style={{ flex: 1, minHeight: 0 }}>{sheet === 'SQUADS' ? <LeftPanel /> : <RightPanel />}</div>
          </div>
        )}
      </div>
      <PhoneDock sheet={sheet} onSheet={next => setSheet(cur => (cur === next ? null : next))} />
    </div>
  );
};

const App = () => {
  const currentScreen = useGameStore(state => state.currentScreen);
  const narrow = useNarrow();

  if (currentScreen === 'SETUP') {
    return <GameSetup />;
  }

  if (currentScreen === 'EDITOR') {
    return <MapEditor />;
  }

  if (currentScreen === 'TUTORIAL') {
    return <HowToPlay />;
  }

  if (currentScreen === 'ONLINE') {
    return <OnlineLobby />;
  }

  if (currentScreen === 'DEV') {
    return <DevMaps />;
  }

  return (
    <ViewportProvider>
      <OnlineErrorToast />
      <BankRewardModal />
      <WinnerOverlay />
      {narrow ? <PhoneBattle /> : <DesktopBattle />}
    </ViewportProvider>
  );
};

/** Desktop: squads and shop on the left, the map in the middle, intel and the log on the right. */
const DesktopBattle: React.FC = () => {
  return (
    <>
      <div
        className="opgeo-stage"
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100vw',
          height: '100dvh',
          overflow: 'hidden',
          padding: '8px',
          gap: '10px',
        }}
      >

        {/* Left Column: Faction Roster Stack + Pinned Field Shop */}
        <div
          style={{
            flex: '1 1 240px',
            minWidth: '235px',
            maxWidth: '450px',
            height: '100%',
            minHeight: 0,
          }}
        >
          <LeftPanel />
        </div>

        {/* Center Column: Top Bar + Tight 1:1 Steel-Tray Map + Cursor-Zone Dock */}
        <div
          style={{
            width: 'clamp(430px, min(calc(100vh - 148px), calc(100vw - 546px)), 1200px)',
            flexShrink: 0,
            minWidth: 0,
            minHeight: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <TopBattleGuidanceBar />

          <MapFrame />

          <MapControls />
        </div>

        {/* Right Column: Turn Status + Self-Sizing Tactical Intel + Always-Visible Live Logs */}
        <div
          style={{
            flex: '1.12 1 275px',
            minWidth: '265px',
            maxWidth: '505px',
            height: '100%',
            minHeight: 0,
          }}
        >
          <RightPanel />
        </div>
      </div>
    </>
  );
};

// Dev only: lets browser tests read the game state.
if (import.meta.env.DEV) (window as unknown as { __tt: unknown }).__tt = { useGameStore, useOnline };

// Opened from a table link (/t/CODE), or reloaded while seated at a table: go online.
if (codeFromUrl() || hasSavedTable()) {
  useGameStore.setState({ currentScreen: 'ONLINE' });
}

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
