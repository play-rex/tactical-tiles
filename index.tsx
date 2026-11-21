import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/opChamferGeo.css';
import { GameRenderer } from './src/components/game/GameRenderer';
import { LeftPanel, RightPanel, WinnerOverlay } from './src/components/ui/HUD';
import { GameSetup } from './src/screens/GameSetup';
import { MapEditor } from './src/screens/MapEditor';
import { HowToPlay } from './src/screens/HowToPlay';
import { useGameStore } from './src/store/useGameStore';
import { ViewportProvider } from './src/context/ViewportContext';
import { MapControls } from './src/components/game/ui/MapControls';
import { GeoButton, GeoCard, GeoChip } from './src/components/ui/GeoPrimitives';
import { canUnitAttackFromTile } from './src/core/rules/CombatRules';
import { SoundFX } from './src/core/audio/SoundFX';
import { PLAYER_UI_THEME } from './src/components/ui/GeoPrimitives';

const TopBattleGuidanceBar: React.FC = () => {
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
  const [muted, setMuted] = useState(() => SoundFX.isMuted());

  const toggleMute = () => {
    const next = !muted;
    SoundFX.setMuted(next);
    setMuted(next);
  };

  const selectedUnit = units.find(u => u.id === selectedUnitId);
  const selectedUnitTile = selectedUnit ? mapData.find(t => t.id === selectedUnit.tileId) : undefined;
  const pTheme = PLAYER_UI_THEME[currentPlayer] || PLAYER_UI_THEME[0];

  let guidance = 'Select a friendly unit to command (or press TAB).';
  if (winner !== null) {
    guidance = `Match complete — P${winner + 1} victorious.`;
  } else if (isAiTurn) {
    guidance = `Enemy Commander (P${currentPlayer + 1}) is executing moves...`;
  } else if (bankRewardPending && bankRewardPending.playerId === currentPlayer) {
    guidance = 'Vault Breached! Choose Gold or CP loot.';
  } else if (placementMode && placementMode.active) {
    guidance = 'Construction Mode: Click a cyan tile to deploy, or Cancel.';
  } else if (selectedInventoryItemIndex !== null) {
    guidance = 'Supply Armed: Click a friendly unit to apply.';
  } else if (selectedGraveyardUnitId) {
    guidance = 'Reinforcement: Click a green tile near HQ to respawn.';
  } else if (selectedUnit && selectedUnit.owner === currentPlayer) {
    if (selectedUnit.isOverwatching) {
      guidance = 'Overwatch Armed: Traps first entering enemy next turn.';
    } else if (selectedUnit.type === 'SNIPER' && !canUnitAttackFromTile(selectedUnit, selectedUnitTile)) {
      guidance = 'Sniper: Move to Mountain, Dunes, or Building to fire.';
    } else {
      guidance = 'BLUE Move • RED Attack • O Overwatch • TAB Next';
    }
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
            {isAiTurn ? `P${currentPlayer + 1} AI` : `P${currentPlayer + 1} TURN`}
          </span>
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
            onClick={toggleMute}
            variant={muted ? 'default' : 'softBlue'}
            title={muted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
            coreStyle={{ padding: '4px 10px' }}
          >
            {muted ? 'MUTE' : 'SFX ON'}
          </GeoButton>
          <GeoButton
            onClick={() => resetGame()}
            variant="softRed"
            coreStyle={{ padding: '4px 10px' }}
          >
            ABORT MISSION
          </GeoButton>
        </div>
      </div>
    </GeoCard>
  );
};

const App = () => {
  const currentScreen = useGameStore(state => state.currentScreen);

  if (currentScreen === 'SETUP') {
    return <GameSetup />;
  }

  if (currentScreen === 'EDITOR') {
    return <MapEditor />;
  }

  if (currentScreen === 'TUTORIAL') {
    return <HowToPlay />;
  }

  // LIVE BATTLE SCREEN (OP-Chamfer Geo Tight 1:1 Map + Cursor-Zone Dock)
  return (
    <ViewportProvider>
      <div
        className="opgeo-stage"
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          padding: '8px',
          gap: '10px',
        }}
      >
        <WinnerOverlay />

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

          <div className="geo-drop geo-fill" style={{ flex: 1, minHeight: 0 }}>
            <div className="geo-backplate" />
            <div className="geo-rim" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <div className="geo-body" style={{ flex: 1, minHeight: 0, padding: '6px', display: 'flex' }}>
                <div className="geo-frame-rim" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  <div
                    className="geo-frame-core"
                    style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
                  >
                    <GameRenderer />
                  </div>
                </div>
              </div>
            </div>
          </div>

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
    </ViewportProvider>
  );
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
