# Tactical Tiles — Game Evaluation & Market Value Report
*Independent panel audit · 23 Nov 2026 · evidence-backed, simulation-driven*
*Engine: `packages/engine` · Server: `apps/server/src/TableRoom.ts` · Client: `apps/web/src`*

## 1. Executive Verdict & Real Value Assessment

**Overall score: 6.8 / 10 — Playable Prototype bordering on Vertical Slice.**

| Pillar | Score |
|---|---|
| 1. Core Loop & Tactical Depth | 7.5 |
| 2. Mathematical Balance & Pacing | 6.0 |
| 3. Multiplayer Readiness & Edge Cases | 6.5 |
| 4. UI/UX, Readability & Game Feel | 7.5 |
| 5. Replayability & Progression | 6.0 |
| 6. Code Architecture & Maintainability | 7.5 |

**Current stage: Playable Prototype** (full loop works local + online + bots; no progression/meta hooks shipped — veterancy/missions exist in code as `VETERANCY_CONFIG`, `ChallengeOps`, `CareerStatsManager` but the retention loop they promise is not yet the shipped experience).

**If launched today (itch.io / Steam / mobile):** average player stays **2–4 sessions (~3–6 hours total)** then churns. Why: the first sessions genuinely surprise (shared-battery CP puzzle, heists, bank turrets, weather zones), but matches run **~30+ rounds median** with a **~8–14% stalemate rate**, there is **no turn timer** (a griefer can hold a table hostage forever), and after ~3 matches there is nothing new to chase — no ranked, no unlocks, no daily seed.
**Strongest hook:** the shared Command-Point battery (`CP_SYSTEM`, `Config.ts`) — every move/shot/heist/reload draws from one 20-CP pool. It turns each turn into a macro-puzzle no single-unit-activation tactics game offers.
**Biggest fatal flaw:** pacing + stalemates. Median 32 rounds to kill a 50-HP HQ while snipers one-shot scouts creates long, swingy games where optimal play is often "turtle behind cover and wait" — compounded by no turn timer online.

## 2. Simulation & Math Findings (Hard Data)

All numbers below were generated from the actual engine code (`sim-audit.mts`, since removed; loop = `prepareAction` → `applyAction` exactly as the server does). **210 matches total.**

### 2.1 TTK matrices (deterministic, from `CombatRules.ts` + `Config.ts`)

Base stats (`UNIT_STATS`): Scout 15 HP / 5 dmg / 3 CP / rng 3 · Breacher 30 HP / 10 dmg / 5 CP / rng 4 · Sniper 10 HP / 20 dmg / 8 CP / rng 7. Damage = `floor(base × (1 − cover))`, min 1.

| Attacker \ Defender (PLAINS, 0 cover) | Scout (15) | Breacher (30) | Sniper (10) |
|---|---|---|---|
| Scout (5) | 3 shots | 6 shots | 2 shots |
| Breacher (10) | **2 shots** | 3 shots | 1 shot |
| Sniper (20) | **1 shot** | **2 shots** | **1 shot** |

Cover check (verified in code): Breacher vs Scout on FOREST (40%) → `floor(10×0.6)` = **6 dmg** ✓.

**Siege TTK vs HQ (50 HP, 20% base armor, `calculateSiegeDamage`):**

| Attacker | Dmg/shot | Shots to kill HQ | CP per shot | Total CP |
|---|---|---|---|---|
| Scout | 4 | 13 | 3 | 39 |
| Breacher | 8 | 7 | 5 | 35 |
| **Sniper** | **16** | **4** | 8 | **32** |

Damage-per-CP: Sniper 2.5 > Breacher 2.0 > Scout 1.67 — the Sniper is the most CP-efficient unit at *both* killing and sieging, gated only by its positioning restriction (`canUnitAttackFromTile`: MOUNTAIN/DUNES/owned BUILDING).

### 2.2 Match simulations (210 matches, `botAction` HARD AI + scripted rush policy)

| Scenario | Split (n) | Avg rounds | Median | Min–Max | Timeout* |
|---|---|---|---|---|---|
| Mixed HARD / scripted-Rush, Conquer (n=80) | P1 39 – P2 30 | 222† | **32** | 17–1462 | 13.8% |
| HARD vs HARD, Conquer (n=80) | P1 30 – P2 44 (P1 40.5%) | 138† | **32** | 7–1452 | 7.5% |
| HARD vs HARD, Deathmatch + Doomsday (n=50) | P1 21 – P2 29 | **25.1** | ~22 | 11–70 | 0% |

\* Timeout = hit the 3,000-action safety cap with no winner (stalemate / endless turtle).
† Averages are dragged up by capped stalemate games; **median is the honest pacing number**.

**Findings:**
- **No systematic first-player advantage.** P1 opens with 15 CP vs 20 (`P1_ROUND1_CP`, `setup.ts`) and the data agrees: 40.5% P1 in a pure HARD run vs 54% P1 in the repo's own 160-match baseline (`GAME_REVIEW.md`) — i.e. noise around 50/50, not a structural edge. The compensating handicap works.
- **Rush does not dominate.** The scripted beeline-HQ policy won no more than the balanced HARD bot; the AI's siege scores (base kill = 9999 priority, `AIBrain.ts`) plus base artillery (`BASE_STATS` 3–5 dmg, rng 4) punish naked rushes. Optimal play is mixed arms, not one strategy — the core loop survives its biggest risk.
- **Conquer pacing is slow; Deathmatch is brisk.** Median 32 rounds for Conquer vs ~25 (avg, no timeouts) for Deathmatch+Doomsday. A 7-round minimum Conquer win vs 1,400+ round stalemates = enormous variance; matches lack a chess-clock or sudden-death beyond optional Doomsday.
- **Stalemate rate 7.5–13.8%** corroborates the repo's own 12.5% figure. Causes observed in code: mutual turtling behind BARRIER cover (80% defense, `TERRAIN_DEFENSE`), snipers unable to reposition without high ground, gold stalls where neither side can afford respawns (Breacher 150 / Sniper 300, `UNIT_COSTS`).
- **Unit utility: no unit is mathematically useless, but the Scout is the weakest link.** Scouts deal the worst damage-per-CP (1.67), need 13 siege shots, and die to any single Sniper/Breacher shot. Their justification is purely economic: cheapest respawn (50), 10 ammo, vision 4, and immunity perks at Elite. In a Conquer meta decided by 4-shot Sniper sieges, Scouts are objective-grabbers, not fighters — acceptable, but thin.

## 3. Detailed Pillar Breakdown (with `file:line` citations)

### Pillar 1 — Core Loop & Tactical Depth: 7.5/10
Genuine trade-offs verified in code: shared CP battery (`CP_SYSTEM: MAX_CP 20, REGEN 10`, `Config.ts:56`), Sniper gating (`canUnitAttackFromTile`, `CombatRules.ts`), Watchtower/Bunker specialization (`BUILDING_STATS`), Crossfire +2 (`COMBAT_BONUSES`), Overwatch with 50% refund (`OVERWATCH_STATS`, `apply.ts` END_TURN refund), weather that changes range/vision/cost (`getUnitRange`, `getStepCost`, `Pathfinding.ts`), bank-turret zoning (`BANK_STATS RANGE 2 / DMG 4`). Rush ≠ dominant (see §2.2). Deduction: optimal play still converges on Sniper-siege + Breacher-screen; Scouts lack a combat identity.

### Pillar 2 — Mathematical Balance & Pacing: 6.0/10
First-player advantage: none found (see §2.2). Match length: Conquer median 32 rounds is a slog for a "quick tactics" pitch; Deathmatch+Doomsday (avg 25, 0 timeouts) is the best-paced mode and should arguably be the default demo mode. No unit is strictly dominated, but Sniper siege efficiency (4 shots vs 13) makes HQ defense the whole game. Veterancy breakpoints check out exactly as documented (`VETERANCY_CONFIG`, `CombatRules.ts:applyUnitXp`): Scout 15→18, Breacher 30→36, Sniper 10→12; Elite Sniper 22 dmg → `floor(22×0.6)`=13 vs FOREST, `floor(22×0.5)`=11 vs BUNKER ✓ — the design team did real threshold math. Determinism gap: map/weather seeds are Mulberry32 (`SeededRandom.ts`) but **base artillery and supply-drop placement use `Math.random`** (`getBaseArtilleryDamage`, `apply.ts` BUY_ITEM) — "Retry This Seed" cannot truly replay a match.

### Pillar 3 — Multiplayer Readiness & Edge Cases: 6.5/10
Strengths (`TableRoom.ts`, `validate.ts`, `view.ts`): server-authoritative — costs recomputed in `prepareAction`, never trusted from client; fog-of-war views strip unseen units, mines, drops, and vault state (`viewFor`); per-seat event filtering (`eventsFor`); snapshots persisted every change and restored after deploys (`store.ts`, snapshot v1); reconnect-by-`playerId` with 3-min hold; bot autopilot covers disconnects (4 s) and post-restart grace (30 s); rate limits (40 joins/min, 40 msg/s). **Gaps:** (a) **No turn timer** — `scheduleAutoTurn` returns immediately for a connected human (`TableRoom.ts`: "a person is playing: wait for them"), so one griefer/AFK holds the table forever; (b) no anti-stall/sudden-death in Conquer without Doomsday; (c) bot plays at full HARD strength for departees, which can feel punitive; (d) `Math.random` in AI/shop means client-predicted and server states can diverge cosmetically (no desync of authority, but replays differ).

### Pillar 4 — UI/UX, Readability & Game Feel: 7.5/10
Best-in-class for a prototype: pre-commit damage preview with LETHAL badge, cover/crossfire/suppression notes (`HUD.tsx: HoveredTacticalPreview`, `hoverMovePreview.ts: computeUnitAttackPreview`); move preview shows CP cost, quicksand/turret/artillery warnings, and Overwatch-on-path warnings with pin-resist notes; illegal-target clicks explain *why* (`getAttackBlocker`); PixiJS renderer with projectiles, damage popups, screen shake, sound cues (`GameRenderer.tsx`, `SoundFX.ts`, `apply.ts` Fx events); board rotation, camera follow, map hover cards; `useNarrow` hook for small screens. Deductions: fog-of-war + 6-player + weather-zone readability on tiny maps is untested; no colorblind-safe palette pass evident (`PLAYER_COLORS` red/green adjacent); no threat-range overlay toggle spotted — you see *your* shot preview but not *enemy* ranges at a glance.

### Pillar 5 — Replayability & Progression: 6.0/10
Systems present in code: seeded maps + presets + editor (`Presets.ts`, `MapEditor.tsx`), 5 challenge ops + mutators (`ChallengeOps.ts`, `GameSetup.tsx` CHALLENGES tab), veterancy ranks, scorecard grades S–D, career localStorage (`CareerStatsManager.ts`). But: career is local-only (no server persistence, no ranked), challenge/medal content is thin (5 ops), and the online lobby loop is play-again-by-hand (`rematch` requires host). Three matches exhaust the novelty for most players; the "one more try" hooks (grades, seeds, medals) exist but are not surfaced as a progression system.

### Pillar 6 — Code Architecture & Maintainability: 7.5/10
Exemplary separation: `packages/engine` is pure TypeScript with zero I/O except two `Math.random` calls (flagged above); transport (`protocol.ts`, Colyseus `TableRoom`) and rendering (React+Pixi) are cleanly split; `prepareAction`/`applyAction`/`viewFor` give a single rules pipeline shared by local play, bots, and server — the test suite (`engine.test.ts`) plays full bot games *through* the validator, which is exactly right. Minor debts: `apply.ts` is ~1,100 lines (god-function switch); `TableRoom.ts` mixes match control with persistence; `useGameStore.ts` is very large; magic numbers in AI scoring (`AIBrain.ts:evaluatePosition`) are untuned constants.

## 4. Top 5 High-Impact Fixes (ranked by Impact ÷ Effort)

1. **Add a turn timer (e.g. 90 s + 30 s increment), auto-END_TURN on expiry.** *Impact: highest — unblocks public online play; Effort: small* (server `clock.setTimeout` in `scheduleAutoTurn`; client countdown in HUD). Without this, ranked/public tables are griefable on day one.
2. **Make Deathmatch + Doomsday (or a sudden-death variant) the default quick-play mode; cap Conquer HQ at ~30 HP or add round-25 sudden death.** *Impact: fixes the #1 churn driver (32-round median, 8–14% stalemates); Effort: small* (`DOOMSDAY_SETTINGS.START_TURN`, `BASE_STATS.HP` — both one-line config changes; verify with the sim script).
3. **Seed the remaining RNG (base artillery, drop placement, EASY-AI jitter) from the match seed.** *Impact: true "Retry This Seed" + real replays/spectating; Effort: small* (thread a PRNG through `applyAction`/`AIBrain`; `SeededRandom.ts` already exists).
4. **Give Scouts a combat identity: +1 siege damage or cheaper attack (3→2 CP) at base, not only at Ace.** *Impact: ends Sniper-siege monoculture; Effort: trivial* (`UNIT_STATS.SOLDIER`). Re-run the TTK table + 80-match sim to confirm rush still doesn't dominate.
5. **Ship one server-persisted progression hook: ranked ELO or persistent career + daily seed.** *Impact: the entire 4th-session retention cliff; Effort: medium* (`TableStore` already persists tables — extend to player records; surface `MatchSummary` grade/seed in the lobby). Even ELO-only would 2× playtime.

---
*Method: rulebook extracted from `Config.ts`, `CombatRules.ts`, `Pathfinding.ts`, `apply.ts`, `validate.ts`, `options.ts`, `setup.ts`, `AIBrain.ts`, `TableRoom.ts`, `view.ts`, `HUD.tsx`, `hoverMovePreview.ts`; 210 headless matches run through the real `prepareAction`→`applyAction` pipeline; all math recomputed from shipped constants. Temp simulation file removed after the run.*
