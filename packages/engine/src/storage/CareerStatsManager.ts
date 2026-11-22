import { AIDifficulty, GameMode, MatchPlayerStats, MatchSummary, Unit, UnitType, VictoryMode } from '../types';
import { UNIT_STATS } from '../constants/Config';

const CAREER_STORAGE_KEY = 'tactical_tiles_career_stats';

export type EfficiencyGrade = 'S' | 'A' | 'B' | 'C' | 'D';
export type ChallengeMedal = 'S' | 'A' | 'B';

export interface CareerStats {
    gamesPlayed: number;
    wins: number;
    losses: number;
    currentStreak: number;
    bestStreak: number;
    bestGrade: EfficiencyGrade | null;
    fastestWinRounds: number | null;
    totalKills: number;
    totalAcesPromoted: number;
    challengeMedals: Record<string, ChallengeMedal>;
}

const GRADE_ORDER: EfficiencyGrade[] = ['S', 'A', 'B', 'C', 'D'];
const MEDAL_ORDER: ChallengeMedal[] = ['S', 'A', 'B'];

const DEFAULT_CAREER: CareerStats = {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    bestStreak: 0,
    bestGrade: null,
    fastestWinRounds: null,
    totalKills: 0,
    totalAcesPromoted: 0,
    challengeMedals: {}
};

export const CareerStorage = {
    get(): CareerStats {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return { ...DEFAULT_CAREER };
            }
            const raw = window.localStorage.getItem(CAREER_STORAGE_KEY);
            if (!raw) return { ...DEFAULT_CAREER };
            return { ...DEFAULT_CAREER, ...JSON.parse(raw) };
        } catch {
            return { ...DEFAULT_CAREER };
        }
    },

    recordMatch(summary: MatchSummary): CareerStats {
        const cur = CareerStorage.get();
        const isWin = summary.isHumanWin;
        const nextStreak = isWin ? cur.currentStreak + 1 : 0;

        let nextBestGrade = cur.bestGrade;
        if (isWin) {
            if (!nextBestGrade || GRADE_ORDER.indexOf(summary.grade) < GRADE_ORDER.indexOf(nextBestGrade)) {
                nextBestGrade = summary.grade;
            }
        }

        const nextFastest =
            isWin && (cur.fastestWinRounds === null || summary.rounds < cur.fastestWinRounds)
                ? summary.rounds
                : cur.fastestWinRounds;

        const p0Stats = summary.playerStats[0];
        const nextMedals = { ...(cur.challengeMedals || {}) };
        if (summary.challengeId && summary.challengeMedal && isWin) {
            const prevMedal = nextMedals[summary.challengeId];
            if (!prevMedal || MEDAL_ORDER.indexOf(summary.challengeMedal) < MEDAL_ORDER.indexOf(prevMedal)) {
                nextMedals[summary.challengeId] = summary.challengeMedal;
            }
        }

        const updated: CareerStats = {
            gamesPlayed: cur.gamesPlayed + 1,
            wins: cur.wins + (isWin ? 1 : 0),
            losses: cur.losses + (isWin ? 0 : 1),
            currentStreak: nextStreak,
            bestStreak: Math.max(cur.bestStreak, nextStreak),
            bestGrade: nextBestGrade,
            fastestWinRounds: nextFastest,
            totalKills: cur.totalKills + (p0Stats?.kills ?? 0),
            totalAcesPromoted: cur.totalAcesPromoted + (p0Stats?.acesPromoted ?? 0),
            challengeMedals: nextMedals
        };

        try {
            if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(updated));
            }
        } catch {
            // Ignore storage errors
        }

        return updated;
    }
};

export const calculateMatchScorecard = (params: {
    winner: number;
    rounds: number;
    victoryMode: VictoryMode;
    gameMode: GameMode;
    aiDifficulty: AIDifficulty;
    seed: string;
    playerStats: Record<number, MatchPlayerStats>;
    playerRespawns: Record<number, number>;
    units: Unit[];
    parRoundsOverride?: number;
    challengeId?: string;
}): MatchSummary => {
    const {
        winner,
        rounds,
        victoryMode,
        gameMode,
        aiDifficulty,
        seed,
        playerStats,
        playerRespawns,
        units,
        parRoundsOverride,
        challengeId
    } = params;

    const parRounds = parRoundsOverride ?? (victoryMode === 'CONQUER' ? 20 : 25);
    const isHumanWin = winner === 0;
    const refStats = playerStats[winner] || {
        kills: 0,
        unitsLost: 0,
        damageDealt: 0,
        heists: 0,
        buildingsSecured: 0,
        acesPromoted: 0
    };
    const respawnsUsed = playerRespawns[winner] || 0;

    // Speed (50 pts max) + Preservation (35 pts max) + Capped Objectives (15 pts max)
    const overtime = Math.max(0, rounds - parRounds);
    const speedScore = Math.max(0, 50 - overtime * 2);
    const preservationScore = Math.max(0, 35 - refStats.unitsLost * 10 - respawnsUsed * 5);
    const objectiveRaw =
        refStats.heists * 6 + refStats.buildingsSecured * 4 + refStats.acesPromoted * 5 +
        (challengeId && isHumanWin ? 10 : 0);
    const objectiveScore = Math.min(15, objectiveRaw);

    let totalScore = Math.round(speedScore + preservationScore + objectiveScore);
    if (gameMode === 'PVE' && aiDifficulty === 'EASY' && !challengeId) {
        totalScore = Math.min(totalScore, 88); // Cap Easy skirmish below S-Rank
    }

    let grade: EfficiencyGrade = 'D';
    if (totalScore >= 90) grade = 'S';
    else if (totalScore >= 76) grade = 'A';
    else if (totalScore >= 60) grade = 'B';
    else if (totalScore >= 42) grade = 'C';

    const challengeMedal: ChallengeMedal | undefined =
        challengeId && isHumanWin
            ? (grade === 'S' ? 'S' : grade === 'A' ? 'A' : 'B')
            : undefined;

    // Pick MVP among surviving units of the winning player
    const winnerUnits = units.filter(u => u.owner === winner);
    let mvp: MatchSummary['mvp'] = null;
    if (winnerUnits.length > 0) {
        const sorted = [...winnerUnits].sort((a, b) => {
            const sa = (a.kills || 0) * 5 + (a.xp || 0) * 2 + Math.floor((a.damageDealt || 0) / 8);
            const sb = (b.kills || 0) * 5 + (b.xp || 0) * 2 + Math.floor((b.damageDealt || 0) / 8);
            return sb - sa;
        });
        const best = sorted[0];
        mvp = {
            unitId: best.id,
            unitName: UNIT_STATS[best.type].name,
            unitType: best.type as UnitType,
            owner: best.owner,
            rank: (best.rank || 0) as 0 | 1 | 2 | 3,
            kills: best.kills || 0,
            damageDealt: best.damageDealt || 0
        };
    }

    return {
        winner,
        isHumanWin,
        rounds,
        parRounds,
        score: totalScore,
        grade,
        seed,
        challengeId,
        challengeMedal,
        playerStats,
        mvp
    };
};
