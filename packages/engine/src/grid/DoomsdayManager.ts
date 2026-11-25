
import { Tile, HazardState } from '../types';
import { DOOMSDAY_ESCALATION, DOOMSDAY_SETTINGS } from '../constants/Config';

export type DoomsdayStage = 'SKIRMISH' | 'COLLAPSE' | 'MELTDOWN';

export interface DoomsdayEscalation {
    stage: DoomsdayStage;
    label: string;
    /** Total CP regen bonus added on top of the player's battery rules. */
    regenBonus: number;
    roundsUntilNextStage: number | null;
}

/**
 * The escalation clock uses the same completed-round counter as updateDoomsdayState.
 * It is only meaningful for Deathmatch + Doomsday; passing enabled=false returns Skirmish.
 */
export const getDoomsdayEscalation = (currentTurn: number, enabled = true): DoomsdayEscalation => {
    if (!enabled) {
        return { stage: 'SKIRMISH', label: 'Skirmish', regenBonus: 0, roundsUntilNextStage: null };
    }
    const collapseTurn = DOOMSDAY_SETTINGS.START_TURN;
    const meltdownTurn = collapseTurn + DOOMSDAY_ESCALATION.MELTDOWN_RING * DOOMSDAY_SETTINGS.SHRINK_INTERVAL;
    if (currentTurn < collapseTurn) {
        return {
            stage: 'SKIRMISH',
            label: 'Skirmish',
            regenBonus: 0,
            roundsUntilNextStage: collapseTurn - currentTurn,
        };
    }
    if (currentTurn < meltdownTurn) {
        return {
            stage: 'COLLAPSE',
            label: 'Collapse',
            regenBonus: DOOMSDAY_ESCALATION.COLLAPSE_REGEN_BONUS,
            roundsUntilNextStage: meltdownTurn - currentTurn,
        };
    }
    return {
        stage: 'MELTDOWN',
        label: 'Meltdown',
        regenBonus: DOOMSDAY_ESCALATION.MELTDOWN_REGEN_BONUS,
        roundsUntilNextStage: null,
    };
};

export const getRingIndex = (x: number, y: number, gridSize: number): number => {
    // Calculate distance from the nearest edge
    // Ring 0 is the outermost edge
    return Math.min(x, gridSize - 1 - x, y, gridSize - 1 - y);
};

export const updateDoomsdayState = (mapData: Tile[], currentTurn: number, gridSize: number): Tile[] => {
    return mapData.map(tile => {
        const ring = getRingIndex(tile.x, tile.y, gridSize);
        
        // Calculate the turn when this ring becomes lava
        const lavaTurn = DOOMSDAY_SETTINGS.START_TURN + (ring * DOOMSDAY_SETTINGS.SHRINK_INTERVAL);
        
        let hazard: HazardState = 'SAFE';
        
        if (currentTurn >= lavaTurn) {
            hazard = 'LAVA';
        } else if (currentTurn >= lavaTurn - 1) {
            // One turn warning
            hazard = 'WARNING';
        }

        // Optimization: Don't create new object if state hasn't changed
        if (tile.hazardState === hazard) return tile;

        return { ...tile, hazardState: hazard };
    });
};
