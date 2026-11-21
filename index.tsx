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

  let guidance = 'Select a friendly unit to command, or press TAB for next ready unit.';
  if (winner !== null) {
    guidance = `Match complete — P${winner + 1} victorious.`;
  } else if (isAiTurn) {
    guidance = `Enemy Commander (P${currentPlayer + 1}) is executing moves...`;
  } else if (bankRewardPending && bankRewardPending.playerId === currentPlayer) {
    guidance = 'Vault Breached! Choose Gold or Command Points loot in the right panel.';
  } else if (placementMode && placementMode.active) {
    guidance = 'Construction Mode: Click a highlighted cyan tile on the map to deploy, or Cancel.';
  } else if (selectedInventoryItemIndex !== null) {
    guidance = 'Inventory Supply Armed: Click a friendly unit on the map to apply item.';
  } else if (selectedGraveyardUnitId) {
    guidance = 'Reinforcement Selected: Click any green tile near your HQ to respawn.';
  } else if (selectedUnit && selectedUnit.owner === currentPlayer) {
    if (selectedUnit.isOverwatching) {
      guidance = 'Overwatch Armed: Traps first entering enemy next turn.';
    } else if (selectedUnit.type === 'SNIPER' && !canUnitAttackFromTile(selectedUnit, selectedUnitTile)) {
      guidance = 'Sniper Restriction: Move to Mountain, Dunes, or an owned Building to fire.';
    } else {
      guidance = 'Click BLUE tile to Move • RED target to Attack • O Overwatch • TAB Next Unit';
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

  // LIVE BATTLE SCREEN (OP-Chamfer Geo tuned for 20x20 / 25x25 / 30x30 maps)
  return (
    <ViewportProvider>
      <div
        className="opgeo-stage"
        style={{
          display: 'flex',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          padding: '8px',
          gap: '10px',
        }}
      >
        <WinnerOverlay />

        {/* Left Column: Disciplined width (210-255px) maximizes 25x25 square canvas area */}
        <div style={{ width: 'clamp(210px, 18vw, 255px)', height: '100%', flexShrink: 0, minHeight: 0 }}>
          <LeftPanel />
        </div>

        {/* Center Column: Slim Top Bar + Maximized Square Pixi Stage + Compact Bottom Controls */}
        <div
          style={{
            flex: 1,
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

        {/* Right Column: Disciplined width (240-290px) for Turn Info, Intel/Logs, Shop & Actions */}
        <div style={{ width: 'clamp(240px, 21vw, 290px)', height: '100%', flexShrink: 0, minHeight: 0 }}>
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
