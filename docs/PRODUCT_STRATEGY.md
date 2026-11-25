# Tactical Tiles — Player Psychology, Retention & Go-To-Market Audit (v2)
*Principal Game Director · Behavioral Psychologist · Indie Publishing Strategist*
*24 Nov 2026 · Engine `packages/engine` · Server `apps/server` · Client `apps/web`*

*Method: rulebook extracted from source; **339 headless matches** run through the real `prepareAction → applyAction` pipeline (`packages/engine/sim-psych.ts`, 100 HARD/HARD + 80 rush + 60 turtle + 25 Deathmatch + 25 deck-mix + a 60-game fault sim in `sim-bots.ts`); TTK recomputed by calling the shipped `calculateAttackOutcome` / `calculateSiegeDamage` with shipped constants. Every number below is reproducible with `cd packages/engine && bun sim-psych.ts` / `bun sim-bots.ts`.*

> **This report supersedes the earlier version of this file.** The code moved (kill-cam, drama reel, clip export, map presets, loot changes), and the previous headline diagnosis — "the battery runs dry" — is **contradicted by the current measurements** (§3.2). The new diagnosis is different and more actionable.

---

## 0. Executive Verdict

**Overall: 5.0 / 10. Stage: late prototype, one loop away from a vertical slice.**

The *craft* is 9/10. The *game* is 5/10. That gap is still the whole story — but it closed on the presentation side and opened on the pacing side.

What exists now is a tactical engine with genuinely best-in-class feedback: a procedural Web-Audio battlefield (`SoundFX.ts:20–26`), trauma-based camera shake and hit-stop (`fxTimeline.ts:737–755`), a **frame-driven kill-cam director** with six camera profiles, tiers and an emergent narrative resolver (`killCam.ts:1–40`), a broadcast overlay with damage-decomposition stamps (`KillCamOverlay.tsx`), a **cut drama reel** of the match's whole first-to-last fight (`highlightRecorder.getFilm()` / `recapPlayer.startFilm()`, `highlightRecorder.ts:231`), and **one-click `.webm` export with a `.png` share-card fallback** (`clipExporter.ts:7–8`, `HUD.tsx:1560–1647`). Most shipped indie tactics games do not have that pipeline at all. This one has it and does not exploit it (§6.1).

What does **not** exist is a reason to press Play a fourth time, and — more urgently — a reason to press End Turn at all: **62.1% of player-turns produce zero payoff events** (no hit, kill, heist, promotion, capture or build), while **44% of turns end with 10+ CP still in the battery**. That pairing is the new headline: the game is not starved of resources, it is starved of *verbs*.

**Single strongest design hook:** the shared 20-CP battery (`Config.ts:44`) over one 4-unit squad. Every move, shot, heist and reload draws from one pool, so a turn is a portfolio-allocation puzzle, not a unit-activation checklist. Neither *Into the Breach* nor *Wargroove* has this.

**Single strongest marketing hook:** the kill-cam + `.webm` export + drama reel. It is already built, already deterministic, and already produces a legible 3-second story. It is currently buried on the post-match screen.

**Single fatal flaw:** turns are mostly administration. 2.3 actions per turn, 0.77 payoff events per turn, and a median of 25 rounds (`sim-psych.ts` HARD/HARD, n=100). A player does ~110 actions per match, and fewer than one per turn does anything visible.

**If launched today** (itch.io / CrazyGames / a Discord Activity): median session ~2–3 matches, 20–35 minutes, then churn. The first match impresses, the second teaches the Sniper line, the third exposes that there is nothing to chase and nothing to do on half the turns.

---

## 1. The Brutal Truth Scorecard

| Dimension | Score | Evidence, not vibe |
|---|---:|---|
| **Addictiveness** | **5 / 10** | Per-event juice is 9/10 (kill-cam tiers, hit-stop, procedural audio, damage stamps). Per-turn cadence is 3/10: **62.1% dead turns**, 0.77 payoff/turn, 2.3 actions/turn (HARD/HARD, n=100). No meta hook at all. |
| **Onboarding clarity** | **5 / 10** | No scripted first match; "How To Play" is a static manual reached from setup (`GameSetup.tsx:130,336` → `HowToPlay.tsx:54`). The damage pipeline stacks cover (0–80%), watchtower ×1.2, Sand −10%, crossfire +2, Elite Breacher −2, veterancy (`CombatRules.ts` `computeDamageOutcome`). The pre-shot breakdown is excellent (`HUD.tsx:934,938,974`) but only *after* you hover the right thing. |
| **Replayability** | **4 / 10** | 4 procedural archetypes (`setup.ts:73`), 9 generator presets (`mapPresets.ts:58`) + 3 hand-built arenas (`Presets.ts:273,284,295`), 5 challenge ops (`ChallengeOps.ts:56,119,172,229,278`), 3 units, 3 mutators. No factions, commanders, daily, ladder, or unlocks. Career is `localStorage` (`CareerStatsManager.ts:40,46,96`). |
| **Streamability / GIF appeal** | **6.5 / 10** | Kill-cam punch-ins, letterboxing, Dutch tilt, "OVERWATCH SNAP"/"CROSSFIRE_TRIANGLE" profiles (`killCam.ts:34–40`), match drama reel, `.webm` export. This is now genuinely clip-worthy — but the export is a **file download** (`clipExporter.ts:19–35`), not a link, and there is no account or seed-challenge URL to make a clip travel. |
| **Commercial readiness** | **4.5 / 10** | Server authority (`prepareAction` recomputes every cost), fog-honest views (`view.ts`), turn clock with hard auto-end (`TableRoom.ts:674–686`), 180 s reconnect hold (`TableRoom.ts:72,772`), bot cover (`TableRoom.ts:705–716`), per-table file persistence (`store.ts`). Missing: accounts, profiles, ladder, tutorial, mobile-first touch pass, store/monetization surface. |

**Player value if shipped today:** ~1.5–2 hours of delight, 0 hours of obligation. Good jam game; not yet a product.

---

## 2. Extracted Rulebook & Stat Matrix

**Loop.** 2–6 seats. One CP battery per seat: max 20, +10/turn, P1 opens on 15 (`Config.ts:44`). Units act individually, each once per turn, all drawing from that battery. Conquer = destroy the enemy HQ (50 HP, 20% armor); Deathmatch = wipe squads; Doomsday lava starts at round 30 and eats a ring every 5 (`Config.ts:37–41`). Default table settings are **Conquer, 30 s + 15 s clock** (`protocol.ts:79–90`).

**Units** (`Config.ts:161`):

| Unit | HP | Dmg | CP/shot | Range | Ammo | Vision | Cost | Identity |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Scout | 15 | 5 | 3 | 3 | 10 | 4 | €50 | Bodies, vision, vault cracking |
| Breacher | 30 | 10 | 5 | 4 | 6 | 3 | €150 | Frontline, HQ sieger |
| Sniper | 10 | 20 | 8 | 7 | 3 | 5 | €300 | Deletes from high ground only |

**TTK, computed by calling the shipped damage functions** (`calculateAttackOutcome`, `calculateSiegeDamage`):

| Attacker | vs Plains | forest 40% | bunker 50% | from Watchtower | Breacher in forest | HQ (50 HP, 20%) | HQ CP total | Bank (15 HP) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Scout (3 CP) | 5 | 3 | 2 | 6 | 10 shots / 30 CP | **4 dmg → 13 shots** | **39 CP** | 4 dmg → 4 shots |
| Breacher (5 CP) | 10 | 6 | 5 | 12 | 5 shots / 25 CP | **8 dmg → 7 shots** | **35 CP** | 8 dmg → 2 shots |
| Sniper (8 CP) | 20 | 12 | 10 | 24 | 3 shots / 24 CP | **16 dmg → 4 shots** | **32 CP** | 16 dmg → 1 shot |

The Sniper is the most CP-efficient killer *and* sieger; its only tax is high-ground positioning (`canUnitAttackFromTile`, `CombatRules.ts`). That single table still explains the meta.

**What is thin or missing:** no healing outside consumables, no HQ repair, no supply lines, no commander identity, no fog threat overlay, no ranked/daily, and — despite everything else being deterministic — **base artillery still calls `Math.random`** (`CombatRules.ts:331–334`), as does supply-drop placement. Replays are therefore not bit-exact.

---

## 3. Simulation & Math Findings

### 3.1 Match outcomes (fresh run, 24 Nov)

| Scenario | n | P0 / P1 | Median rounds | Avg (max) | Stalls | Dead turns | Payoff/turn | Actions/turn | CP left/turn | Rounds ≥30 |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| HARD vs HARD, Conquer | 100 | **46 / 53** | **25** | 40.4 (82) | 1 | **62.1%** | 0.77 | 2.3 | **9.2** | 30% |
| RUSH(P0) vs HARD | 40 | **0 / 40** | 23 | 23.7 (45) | 0 | 33.8% | 1.16 | 2.6 | 5.9 | 10% |
| HARD vs RUSH(P1) | 40 | **39 / 0** | 26 | 62.7* | 1 | 72.1%* | 0.46* | 1.8 | 13.8 | 28% |
| TURTLE(P0) vs HARD | 30 | 10 / 15 | 26 | 163.5 (**415**) | **5** | **92.7%** | 0.15 | 2.3 | 12.0 | 47% |
| HARD vs TURTLE(P1) | 30 | 15 / 13 | 33 | 79.5 (116) | **2** | 82.5% | 0.34 | 2.7 | 8.8 | 60% |
| HARD, Deathmatch + Doomsday | 25 | 15 / 10 | 25 | 32.2 (71) | 0 | 47.3% | **1.01** | **3.1** | **5.5** | 40% |
| Sniper-heavy vs default deck | 25 | 14 / 11 | 28 | 38.7 (**243**) | 0 | 59.8% | 0.79 | 2.7 | 5.6 | 40% |

\* inflated by one stalled 800-action game; median is the honest figure.

*Dead turn = a seated turn that ends with zero `hit / killed / structureHit / heist / promotion / capture / build / supplyLanded` events. This is conservative: it excludes movement, sounds, popups and reloads.*

*Run-to-run variance (base artillery and drops are RNG): HARD/HARD P0 has measured 44–46, dead turns 61.9–62.2%, median 24–25 across three runs. Treat ±5 points as noise; the structural numbers (rush 0–80, turtle stalls, 20–25× unit efficiency gap) are stable.*

### 3.2 The correction that matters: it is not a CP problem

The previous audit blamed dead turns on the battery running dry. The current instrument says the opposite:

- Average **CP left at end of turn: 9.2 of a 20-point battery** (regen is 10).
- **44%** of turns end with **≥10 CP unspent**; only **24%** end at 0 CP.
- The fully-committed configurations are exactly the ones with worse pacing anyway: Deathmatch/Doomsday spends 9.3 CP/turn and leaves 5.5, yet still has 47% dead turns.

So the constraint is **action supply, not resource supply**: 4 units, each acting once, with a 30–50% chance that no unit has a shot, a heist, a build, a promotion or a capture available. Players end the turn holding a third of their battery because there is nothing legal *and worth doing* to spend it on.

That reframes the fix list entirely: **hand the player more verbs per turn, not more CP.**

### 3.3 Other hard numbers

- **Opening cadence:** first blood median round 2; **first HQ damage median round 11**; 9.4 kills, 1.11 heists, **9.97 promotions** and 5.0 HQ shots per match.
- **First-player advantage:** 46/53 (+1 stall) is not a real edge; the 15-vs-20 opening CP handicap (`Config.ts:44`) works. Do not touch it.
- **Rush is a trap, and it is *interesting*:** 0 wins in 80 attempts, but rush produces the *highest* payoff density (1.15/turn) and 12 HQ shots per match. Aggression is eventful and losing — exactly the wrong lesson to teach a new player without a tutorial frame.
- **Turtling is viable and toxic:** 7 stalls in 60 games, longest **415 rounds**, 92.7% dead turns, 0.15 payoff/turn. A defensive policy that wins 10/25 as P0 is a retention bomb.
- **Comeback rate at round 10: 37%** (HARD/HARD). Leads decay rather than convert — drama is healthy, closure is not (no closing mechanic between round 15 and Doomsday at 30, which only 30% of matches reach).
- **Unit utility across all matches:** Scout 1,625 deaths / 3,500 damage = **2.2 per death**; Breacher 292 / 8,379 = **28.7**; Sniper 412 / 18,241 = **44.3**. The Scout is a stat block, not a character.
- **Fault sim (`sim-bots.ts`, 60 games):** 0 crashes, 0 rejected actions, 0 stuck pending drops, 0 negative gold, 63 heists, 210 bank-siege orders of which **0 by Snipers**, 6 tunnels. The rules layer is solid.

---

## 4. Part 1 — Dopamine, Juice & the Compulsion Loop

### 4.1 Micro-dopamine hit rate

The *event design* is exceptional and now includes a full directorial layer: `killCam.ts` defines four tiers (`ATTACK / MICRO / CINEMATIC / STRUCTURE`), six camera profiles (sniper whip, mine click, overwatch snap, crossfire triangle…), a 150 ms pre-detonation beat, adaptive slow-motion, and a narrative resolver that picks the headline ("ACE BOUNTY", "OVERKILL") from deterministic match facts (`killCam.ts:1–40,345`). `fxTimeline.ts` owns hit-stop (`:737`), trauma decay (~450 ms, `:302`), death ghosts (550 ms, `:306`) and honours `prefers-reduced-motion` (`:421`). `SoundFX.ts` synthesises everything from oscillators/noise/impulses (`:20–26`) across 10 sound events.

The problem is **frequency**:

- HARD/HARD produces **0.77 payoff events per player-turn** and **2.3 actions per turn**.
- **62.1% of turns contain none of them.** In a 4-player-turn round that is ~2.5 turns of pure repositioning/reloading/ending — every single round.
- The best-scheduled mode is Deathmatch + Doomsday (47.3% dead, 3.1 actions/turn, 0 stalls), and it is **not the default** (`protocol.ts:84` sets `CONQUER`).
- Doomsday's guaranteed climax still starts at round 30 (`Config.ts:38`) and only **30%** of Conquer matches get there.

**Verdict: juice 9/10, beat chart 4/10.** The game is engineered for spikes and scheduled for lulls.

### 4.2 Clutch / swing factor

Real peaks exist and are engineered: Overwatch intercepts a unit mid-path; a bank heist under turret fire (15 HP vault, 4 dmg at range 2, `BANK_STATS`); an Elite Sniper at 22 damage clearing exact cover breakpoints; a Crossfire kill with the triangle camera profile. Comeback 37% at round 10 confirms matches are not decided early.

But peaks are rare and *private*: 1.11 heists/match, 5 HQ shots/match. The dominant experience is still a Sniper trading 16-damage siege shots into a static HQ across four turns — mathematically optimal, emotionally flat. There is no ritual around **the last CP**, because the battery usually still has 9 points in it when the turn ends.

### 4.3 Cognitive load vs flow state

Nine systems compete in match one: shared CP, weather zones (reroll every 5 turns), bank turrets, heists, crossfire, suppression, overwatch, quicksand, veterancy, ammo. Each is clean; together, "why did my shot do 6 instead of 10?" needs: `10 base × 1.0 watchtower × (1 − 0.40 forest) = 6`, possibly `−2` Elite Breacher armor, possibly `+2` crossfire. Seven modifiers, three operations, rounding.

The game *does* answer it, twice: the pre-shot breakdown (`HUD.tsx:934–974`, LETHAL badge) and the kill-cam receipt (`clipExporter.ts:14` builds receipt steps from `buildReceiptSteps`). That is above genre average. The failure is **sequencing**: the explanation arrives at hover time and kill time, never during a guided first minute. There is no tutorial state in the codebase (grep for `tutorial` returns only the `HowToPlay` screen and the `openTutorial` action). Expected time-to-model: 2–3 matches, 30–45 minutes — past the 60-second window a web game gets.

### 4.4 The "one more match" hook

- **Not RNG.** Damage is deterministic; artillery is 3–5 and drops are placement-only. A genuine trust asset.
- **Partly "I misread the board"** — the good *Into the Breach* attribution.
- **Mostly "nothing happened on my turn"** — the bad attribution. 62% dead turns means the modal loss feels like *inertia*, not a mistake.
- **And then the loop ends.** Winner overlay offers grade, MVP, seed, `⬇ EXPORT CLIP` (`HUD.tsx:1647`) and Return to Base. Career is local-only (`CareerStatsManager.ts:40–46`). Online rematch is **host-gated** (`TableRoom.ts:389–393`). No daily, no ladder, no unlock, no next objective, and no "your friend's seed" link.

The clip export is the one hook that already points outward — and it currently terminates in the player's Downloads folder.

---

## 5. Part 2 — Replayability & Meta-Progression

### 5.1 Content exhaustion curve

| Hour | Seen | State |
|---|---|---|
| **0–1** | One tutorial-less match, 3 units, first heist, first promotion, first kill-cam | Delight; confusion about damage numbers |
| **1–3** | 4 map archetypes, 9 presets, sniper line discovered, 1 challenge op | "This is clever" |
| **3–6** | All 5 ops (`ChallengeOps.ts`), 3 mutators, 3 arenas, grades S–D | "I have solved it: screen with Breachers, siege with Snipers" |
| **6–10** | Nothing new. Same roster, same optimal line, same 25-round shape | Churn |

The puzzle is solved around **hour 6**, not because the map generator is weak — it is strong (island carving, bridge spacing, mountain clusters, 9 curated presets) — but because **one unit line dominates and every match starts from the same symmetric state**.

### 5.2 Lowest-effort, highest-impact replayability for *this* codebase

1. **Commander perks (3 pre-match identities).** `GameSettings` gains `commander?`; modifiers resolve in `CombatRules`/`apply`. No new art; reuses badge/label language. This is the only change that alters the solved opening.
2. **Daily seeded skirmish + leaderboard.** Map and weather are already seeded (`SeededRandom.ts`); fix the two `Math.random` calls and the match is bit-exact. One server row per UTC day (seed, par, top 100) on the existing `TableStore` pattern (`store.ts`). Infinite content, ~3 days.
3. **Async nudge + "my games".** The turn clock already supports `0` (`protocol.ts:88–89`), the server is authoritative, and rooms persist to disk. What is missing is a 24–72 h clock preset, a list of your open tables, and a notification.
4. **Asymmetric loadouts.** `unitCounts` already varies per mission (`ChallengeOps.ts` placements); exposing a 6-point pre-match pick per seat is a UI screen, not an engine change.

### 5.3 Async vs sync — the fit is closer than the defaults suggest

A 25-round match is ~48 player-turns × 2.3 actions ≈ **110 actions**. At 4–6 s of human thought per action that is **7–11 minutes** — short enough for a live duel, long enough that a 30 s clock (`protocol.ts:88`) punishes the battery puzzle it is supposed to showcase.

**Recommendation:** ship two clock presets — `LIVE: 90 s + 30 s` and `ASYNC: 24 h` — and make **Async the default for online**. Keep 30 s for tournaments. The blocker is not rules, it is the meta layer: 180 s reconnect hold (`TableRoom.ts:72`), no push, no "your turn" surface outside the tab, no persistent player identity.

---

## 6. Part 3 — Marketing, Positioning & Commercial Viability

### 6.1 The 3-second GIF test

**Would a scroller stop now? Sometimes — the materials exist, the packaging does not.**

What is now possible in one clip: a 150 ms pre-detonation beat, a weapon-specific camera whip, an anime impact frame, a letterboxed slow-motion kill, a damage stamp naming the cause, and a match-winning headline — exported as `.webm` (`clipExporter.ts:159–163`) or a `.png` peak-frame card.

Why it still under-performs:

- **The clip is a file, not a link.** No upload, no URL, no auto-caption, no seed. A Reddit post needs a hosted MP4/GIF; the player has to go find their Downloads folder and re-upload.
- **No single legible *verb*.** *Into the Breach* sells "punch a bug through a mountain". Tactical Tiles sells "a 64 px sprite takes 16 off a 50 HP bar". The kill-cam is the right camera; the game still lacks a *subject* worth filming (no commander, no giant unit, no signature ability).
- **No challenge surface.** "Beat my seed in 19 rounds" is the cheapest shareable artifact in the genre and it does not exist.

**Highest-leverage next visual step (not another camera):** a **shared "receipt card"** — the final board baked as an image with the kill-cam's own narrative lines, the seed, the grade, and a one-tap re-challenge link. Half the components already exist (`clipExporter` share card, `MapPreviewModal` board baking, `resolveKillCamNarrative`).

### 6.2 Positioning & comp titles

**Target player:** 25–40, PC/web, has played *Into the Breach* or *Advance Wars*, has 15 minutes and a browser tab, prefers deterministic puzzles to army building. Secondary: async mobile 4X players (*Polytopia*) who want real combat.

**Elevator pitch:**
> **"Advance Wars with one shared battery — every shot, every step, every reload comes out of the same 20 points."**

**Store line:** *"One battery. Three specialists. Fifteen minutes. Spend it right."*

| vs | Wins | Crushed |
|---|---|---|
| **Into the Breach** | Real PvP, veterancy, economic raiding, generated highlight film | ITB's perfect information and 8-second clarity; ITB never has an empty turn |
| **Polytopia** | Actual tactical combat, no pay-to-win tribes, deterministic combat | Async UX, factions, charm, notification loop, mobile polish |
| **Wargroove** | 10–15 min matches, CP puzzle, no build-order homework | Unit personality, campaign, commander powers, art budget |
| **Marvel Snap** | Spatial depth, one-screen legibility at its best | 3-minute match, cosmetic economy, live-ops cadence |

### 6.3 Distribution & monetization fit

| | **Path A — F2P web/mobile viral** | **Path B — Paid Steam/itch ($5–12)** |
|---|---|---|
| Fit with current code | **Excellent.** React + Pixi + Colyseus, server-authoritative, instant link, no install | Poor. No campaign spine, no cloud saves, no controller pass, no store wrapper |
| Missing | 60-second onboarding, mobile touch pass, daily loop, accounts, share links | 8–12 h campaign, meta progression, packaging, store assets |
| Time to launch | **2–4 weeks** | 4–6 months |
| Revenue shape | Low ARPU, high reach via CrazyGames / Poki / Discord Activities / PWA | Higher ARPU, brutal discoverability |

**Recommendation: Path A now, Path B as 1.0 after the daily loop proves retention.** The architecture is a web game whether you like it or not — file-backed rooms, a React HUD, a tunnel deployment. Monetize cosmetics + a $4.99 "Ops Pack"; **never** sell CP, damage or units. Determinism and fairness are the only trust assets this game has.

---

## 7. The "Fun Killers" Audit — Top 5

1. **Turns are administration.** 62.1% of turns produce no payoff, 2.3 actions/turn, and 44% of turns end with 10+ CP unspent (`sim-psych.ts`). The player holds a loaded battery with nothing worth firing at. *This is the #1 retention leak.*
2. **Rush is a 0–80 trap the game never explains.** It is the most *eventful* way to lose (1.15 payoff/turn, 12 HQ shots) and it always loses — free base artillery and bank turrets (`apply.ts`) plus cover make naked aggression mathematically wrong. New players conclude "unfair", not "screen and siege".
3. **Sniper monoculture, fake loadout choice.** 44.3 damage per death vs the Scout's 2.2; best killer and best sieger (32 CP vs 39 for Scout). Every optimal list is the same list. Elites/Snipers also produce 10 promotions per match, so the veterancy fantasy is spent on one unit type.
4. **No threat projection.** You can preview your own shot (`HUD.tsx:934`), but not the enemy's next-turn kill box. Turret and HQ ranges only surface on hover (`GameRenderer.tsx` hover layer ~`:583–663`). A 7-range Sniper that kills from off-screen reads as a gotcha, not a lesson.
5. **The loop ends at the victory screen — and the best asset is locked behind it.** Grade, MVP, seed, Export Clip, Return to Base. Career is local (`CareerStatsManager.ts:40`), rematch is host-only (`TableRoom.ts:389`), and the exported clip has no link, no seed challenge, no landing page. The game's most shareable artifact is a dead end.

---

## 8. The "Dopamine & Viral Loop" Upgrade Plan — 5 Transformations

Ordered by impact per engineering day, all specified against the real architecture.

### 1. Overdrive — spend idle CP to act again *(engine, ~2 days)*
Diagnosis §3.2 says the problem is verbs, not points. Let a **completed** unit take one more action for a surcharge: `+2 CP` over its normal cost (`validate.ts` action costs, `apply.ts` completed flag). The 9.2 CP left per turn becomes 2–4 extra meaningful actions; the battery becomes the *choice* it was sold as ("do I overdrive the Sniper now or bank for a heist?"). Keep it deterministic, cap at one overdrive per unit per turn, and surface it as a glowing "OVERDRIVE +2" cost on the unit card. Re-run `sim-psych.ts` afterwards — the metric to move is **dead turns 62% → <45%** and **payoff/turn 0.77 → >1.0**.

### 2. Momentum: kills bank ammo and XP, not CP *(engine, ~1 day)*
CP is not scarce, so the old "+2 CP on kill" idea is wrong now. Instead: a kill refunds **1 ammo** and grants **+1 XP** to the killer (`apply.ts` `applyUnitXp` path). Ammo is the genuine second constraint (Sniper: 3 rounds, reload 5 CP), and promotions are already the game's most reliable dopamine beat (9.97/match). This makes aggression self-sustaining and pushes units toward the rank thresholds (`VETERANCY_CONFIG.XP_THRESHOLDS`) without touching damage.

### 3. Threat overlay — show the enemy's next-turn kill box *(client, ~2–3 days)*
One toggle (hold `T` / a button) that draws every enemy's current coverage with the shipped functions: `getUnitRange` + `hasLineOfSight` + `getOverwatchCoverageTiles` (`CombatRules.ts`, `OverwatchRules.ts`). Colour by lethality (kills your unit this turn = red). This is the single biggest onboarding fix after the tutorial, and it converts "gotcha" deaths into planning. Rendering hooks already exist in the hover/marker layers (`GameRenderer.tsx:383,583`).

### 4. Daily seeded skirmish + hosted result card *(engine + server, ~3–4 days)*
Thread the seed through the last two `Math.random` calls (`CombatRules.ts:331–334`, drop placement), then one server row per UTC day on the existing `TableStore` pattern: seed, par rounds, top 100. Add a **"DAILY"** card on `GameSetup.tsx`, three attempts, a share string, and a `/d/<seed>` entry point that boots that exact board. The drama reel/clip export becomes the submission ("here is my 19-round clear").

### 5. Commander identities — 3 loadouts that change the opening *(engine + setup UI, ~4 days)*
`GameSettings.commander`, resolved in `CombatRules`/`apply`:
- **VANGUARD** — Overdrive costs +1 instead of +2, Scouts €40 (tempo/aggression)
- **MARSHAL** — siege damage +25%, Breachers +5 HP (attrition)
- **GHOST** — Snipers 7 CP, +1 vision, −1 ammo (finesse)

No new art, no new units, and it directly attacks the solved "Breacher screen + Sniper siege" line that §5.1 identifies as the hour-6 churn cause.

---

## 9. Six-Pillar Breakdown

| Pillar | Score | Strength | Flaw |
|---|---:|---|---|
| **1. Core loop & tactical depth** | **7.5** | Shared battery; Sniper high-ground gate; Watchtower/Bunker specialization; crossfire +2; Overwatch with refund; weather shifts range/cost. Rush provably non-dominant. | Optimal play collapses to one line; Scout has no combat identity (2.2 dmg/death); the battery is under-spent, so its promise is unfulfilled. |
| **2. Balance & pacing** | **5.0** | No first-player edge (46/53); deterministic damage; 37% comeback at R10; Deathmatch+Doomsday is the tightest mode (47% dead, 3.1 actions/turn, 0 stalls). | 62.1% dead turns; turtle 7 stalls/60 and 415 rounds; Doomsday at R30 is seen by 30% of Conquer matches; artillery RNG. |
| **3. Multiplayer readiness** | **7.5** | Server recomputes every cost (`prepareAction`), fog-honest views, reconnect hold, bot cover, hard turn-clock auto-end (`TableRoom.ts:674–686`), file persistence. | No accounts/ELO; host-only rematch; 180 s reconnect; no async nudge; no anti-abandon consequences. |
| **4. UI/UX & game feel** | **8.5** | Pre-commit damage breakdown + LETHAL badge; kill-cam tiers and narrative resolver; broadcast receipt; drama reel; procedural audio; reduced-motion support. | No enemy threat overlay; no guided first match; the best juice (kill cam) is sized for lethal moments that occur ~9 times per 25-round match. |
| **5. Replayability** | **4.0** | 4 archetypes + 9 presets + 3 arenas + 5 ops + 3 mutators + grades; strong map generation. | No commanders, daily, ladder, unlocks or account; local-only career; solved roster by hour 6. |
| **6. Code architecture** | **8.0** | Pure engine; one rules pipeline for local/AI/server; visual systems frame-driven and React-free (`killCam.ts`, `fxTimeline.ts`); 60-game fault sim clean. | `apply.ts` 1,513-line switch; `useGameStore.ts` 1,927 lines; two `Math.random` calls break replay determinism. |

**Overall: 5.0/10 · late prototype.**

---

## 10. Top 5 High-Impact Fixes (Impact ÷ Effort)

| # | Fix | Why it moves the numbers | Effort | Where |
|---|---|---|---|---|
| **1** | **Overdrive (act again for +2 CP)** | Turns idle CP into verbs; targets the 62% dead-turn hole without buffing damage | **M** | `validate.ts`, `apply.ts` completed flag, `HUD.tsx` unit card |
| **2** | **Make Deathmatch + Doomsday the quick-play default; Doomsday at R20** | Best measured pacing (47% dead, 3.1 actions/turn, 0 stalls) and guarantees a climax inside the median match | **XS** | `protocol.ts:79–90`, `Config.ts:38` |
| **3** | **Hosted seed challenge + share card** | Turns the existing clip/share-card pipeline into distribution; adds the missing "one more" without new gameplay | **S–M** | `clipExporter.ts`, `/d/<seed>` route, `GameSetup.tsx` |
| **4** | **Enemy threat/Kill-box overlay** | Converts gotcha deaths into planning; cheapest onboarding win | **S** | `GameRenderer.tsx` marker layer, `CombatRules.getUnitRange`, `OverwatchRules.getOverwatchCoverageTiles` |
| **5** | **Daily seeded skirmish + leaderboard** | Infinite content and a reason to return tomorrow; deterministic engine already 95% there | **M** | `CombatRules.ts:331`, `store.ts`, `TableRoom.ts` |

Do **1 + 2 this week** (both are engine/config-level and directly attack the two numbers this report cares about), then re-run `sim-psych.ts` before building anything larger.

---

## 11. Go-To-Market Blueprint (one page)

**Positioning:** "One battery. Three specialists. Fifteen minutes. Spend it right."
**Category:** async tactical duel — not 4X, not roguelike.
**Target:** *Into the Breach* / *Advance Wars* players with a browser tab; async *Polytopia* players who want real combat.
**Platform:** web first (CrazyGames / Poki / Discord Activity), PWA for mobile; Steam only after a campaign spine exists.
**Price:** free core + $4.99 Ops Pack + cosmetic commanders. Never sell power.
**Hook asset:** hosted kill-cam clip with the damage receipt and the seed in the caption.
**Retention asset:** daily seed + streak + three commanders.
**First 1,000 retained players:**

1. **Seed the loop (week 1–2).** Ship the hosted clip + `/d/<seed>` challenge link. Post three clips/week to r/TurnBasedTactics, r/WebGames, r/IndieGaming and the ITB/Polytopia Discords with "play my seed, no install". Target 10k opens, 25% match-start.
2. **Convert in 60 seconds (week 2–3).** Replace the setup screen as the landing experience with **PLAY NOW → a scripted 3-unit match** vs a weak bot: one forced move, one forced kill with the decomposition shown *before* the shot, one forced heist, then "now do it with 20 CP". Setup becomes "Custom Match". Target first-match completion ≥60%.
3. **Retain on a 7-day arc (week 3–6).** Daily seed → streak → commander unlock at day 1/3/7; weekly board reset; "rematch a friend" deep link into an async table. Gate on **D7 ≥ 12%** and **≥3 matches/session**. If D7 misses, the problem is cadence (§3.2), not content.

**Do not:** add a fourth unit type, a fog toggle, or a ranked ladder before dead turns are fixed. Content cannot save a game that spends three of every five turns doing nothing.

---

## Appendix — reproduction & citations

- **Rules/stats:** `Config.ts:37–41` (Doomsday), `:44` (CP battery), `:161` (units), `:197` (`VETERANCY_CONFIG`), `:214` (`OVERWATCH_STATS`), `:220` (`MUTATOR_CONFIG`); damage `CombatRules.ts:269–334`; siege `:297–310`; high-ground gate `CombatRules.ts` `canUnitAttackFromTile`.
- **Pacing/FX:** `fxTimeline.ts:302` (trauma decay), `:306` (ghost 550 ms), `:421` (reduced motion), `:737` (hit-stop); `killCam.ts:1–40,345`; `SoundFX.ts:20–26`; clip export `clipExporter.ts:7–8,19–35,159–163`; export button `HUD.tsx:1568–1647`; drama reel `highlightRecorder.ts:231`, `recapPlayer.ts:247`.
- **Multiplayer:** `TableRoom.ts:66–72` (timings: bot 450–800 ms, autopilot 4 s, reconnect 180 s), `:389–393` (host-only rematch), `:674–716` (turn expiry + bot steps), `:771–773` (reconnect hold); persistence `store.ts`; clocks `protocol.ts:79–90`.
- **Content:** `setup.ts:73` (4 archetypes), `mapPresets.ts:58` (9 presets), `Presets.ts:273–295` (3 arenas), `ChallengeOps.ts:56–278` (5 ops), `CareerStatsManager.ts:40–96` (localStorage career), `GameSetup.tsx:130,336` (manual, no tutorial).
- **Simulation:** `packages/engine/sim-psych.ts` (100 HARD/HARD, 40+40 rush, 30+30 turtle, 25 Deathmatch+Doomsday, 25 deck-mix; 3,000-action cap; `autoBankReward: true`; dead turn = zero payoff events; CP-left sampled at END_TURN) and `packages/engine/sim-bots.ts` (60-game fault/crash run). Run both with `bun` from `packages/engine`. `sim-psych.ts` gained three metrics for this audit: `actions/turn`, `CPleft/turn`, `turns@0CP` / `turns@10+CP`, and `R30+` share.
