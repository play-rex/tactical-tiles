/** The computer player: picks the next action for whoever's turn it is. */
import { getBestAIAction } from '../ai/AIBrain';
import { chooseTacticalAction } from '../tactical/ai';
import type { AIDifficulty } from '../types';
import type { GameAction, GameState } from './state';

export function botAction(state: GameState, difficulty: AIDifficulty = state.settings.aiDifficulty): GameAction {
  const p = state.currentPlayer;
  // Tactical weapons are the first thing a bot checks: the cheapest unlocked weapon that has
  // a real target, at most once per round (the engine enforces the same cap for humans).
  const tactical = chooseTacticalAction(state, p, difficulty);
  if (tactical) return tactical;
  return getBestAIAction({
    mapData: state.mapData,
    units: state.units,
    currentPlayer: p,
    playerCp: state.playerCp[p],
    playerCpDebt: state.playerCpDebt?.[p] ?? 0,
    playerCpBorrowed: state.playerCpBorrowed?.[p] ?? 0,
    playerGold: state.playerGold[p],
    playerRespawns: state.playerRespawns[p] || 0,
    playerInventory: state.playerInventory[p],
    weather: state.weather,
    mines: state.mines,
    difficulty,
    graveyard: state.graveyard,
    victoryMode: state.settings.victoryMode,
    gridSize: state.gridSize,
    settings: state.settings,
    totalTurns: state.totalTurns,
    lastHqDamageRound: state.lastHqDamageRound,
    contract: state.contract ?? null,
    finalPush: state.finalPush?.[p],
    airDrops: state.airDrops,
    smokeZones: state.smokeZones,
  }) as GameAction;
}
