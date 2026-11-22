/** The computer player: picks the next action for whoever's turn it is. */
import { getBestAIAction } from '../ai/AIBrain';
import type { AIDifficulty } from '../types';
import type { GameAction, GameState } from './state';

export function botAction(state: GameState, difficulty: AIDifficulty = state.settings.aiDifficulty): GameAction {
  const p = state.currentPlayer;
  return getBestAIAction({
    mapData: state.mapData,
    units: state.units,
    currentPlayer: p,
    playerCp: state.playerCp[p],
    playerGold: state.playerGold[p],
    playerRespawns: state.playerRespawns[p] || 0,
    playerInventory: state.playerInventory[p],
    weather: state.weather,
    difficulty,
    graveyard: state.graveyard,
    victoryMode: state.settings.victoryMode,
    gridSize: state.gridSize,
    settings: state.settings,
    totalTurns: state.totalTurns,
  }) as GameAction;
}
