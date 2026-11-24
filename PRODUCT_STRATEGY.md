# Tactical Tiles — Player Psychology, Addiction & Go-To-Market Audit
*Principal Game Director / Behavioral Psychologist / Indie Publishing Strategist review*
*24 Nov 2026 · Engine `packages/engine` · Server `apps/server` · Client `apps/web`*
*Method: rulebook extracted from source, 290 headless matches instrumented through the real `prepareAction → applyAction` pipeline, TTK recomputed from shipped constants. The harness is kept at `packages/engine/sim-psych.ts` (`bun sim-psych.ts`) so every number below can be reproduced.*

---

## 0. Executive Verdict

**Overall: 4.6 / 10. Stage: late prototype / pre-vertical-slice.**

The *craft* is 8/10. The *game* is 5/10. That gap is the whole story.

What exists is an unusually well-built tactical engine with genuinely best-in-class moment-to-moment feedback: a procedural Web-Audio battlefield (machine-gun bursts, tank treads, brass casings), 32–48 ms hit-stop on impacts, trauma-based camera shake, a synchronized FX timeline that pauses a unit mid-stride when an Overwatch shot intercepts it (`fxTimeline.ts:1414`, `:1543`, `:573`). Most shipped indie tactics games do not feel this good on a single trigger pull.

What does **not** exist is a reason to press "Play" a fourth time. In 100 HARD-vs-HARD matches, **35.6% of all player-turns produced zero payoff events** (no hit, kill, heist, promotion, capture or build). A pure-turtle policy produced **~90% empty turns and 8 stalemates in 60 games**. Rush is not merely suboptimal — it went **0–80**. And there is no meta layer at all: no daily, no ranked, no unlocks, no server-side career (`CareerStatsManager.ts:4` is `localStorage`).

**Single strongest hook:** the shared 20-CP battery (`Config.ts:44`). Every move, shot, heist and reload draws from one pool, so each turn is a portfolio-allocation puzzle rather than a unit-activation checklist. That is a real, defensible mechanic that *Into the Breach* and *Wargroove* do not have.

**Single fatal flaw:** the battery is also the only pacing valve, and it runs dry. A 10 CP/turn economy against an 8 CP sniper shot means most turns are one meaningful action plus bookkeeping — or, after a bad plan, nothing at all. The game's best idea is currently its biggest source of dead air.

**If launched today** (itch.io / CrazyGames link): median session **2–4 matches (~45–70 minutes)**, then churn. The first match surprises, the second teaches the sniper meta, the third reveals there is nothing left to chase.

---

## 1. The Brutal Truth Scorecard

| Dimension | Score | The evidence, not the vibe |
|---|---:|---|
| **Addictiveness** | **5 / 10** | Excellent per-event juice, weak per-turn cadence, no meta hook. 100 HARD/HARD matches: **35.6% dead turns**, 1.28 payoff events/turn, median 25 rounds. Fixing cadence alone is worth ~2 points. |
| **Onboarding clarity** | **5 / 10** | No interactive tutorial — "How To Play" opens an 8-section static manual (`GameSetup.tsx:317` → `HowToPlay.tsx`). The damage pipeline has **7 stacking modifiers** (Watchtower ×1.2, cover 0–80%, Sniper high-ground gate, Elite Breacher −2, Crossfire +2, Sand −10%, veterancy). Pre-shot tooltip is genuinely good (`HUD.tsx:927–966`, LETHAL badge) — but only *after* you already know what to hover. |
| **Replayability** | **4 / 10** | 3 preset maps + 4 procedural archetypes (`setup.ts:69–75`), 5 challenge ops (`ChallengeOps.ts`), 3 unit types, 3 mutators. No factions, no commanders, no unlocks, no daily seed, no ranked. Content exhaustion lands around **hour 6–10**. |
| **Streamability / GIF appeal** | **5 / 10** | Beautiful frames (muzzle flash, tracers, death ghosts, "OVERWATCH KILL!" callouts) but the readable unit is a 64px sprite on a 20×20 grid. At thumbnail size a 3-second clip reads as "units sliding on a grid". No single legible spectacle verb. |
| **Commercial readiness** | **4 / 10** | Server-authoritative play, reconnect, auto-bot cover, turn clocks (`TableRoom.ts:572–628`) — the hard part is done. Missing: accounts, profile persistence, tutorial, mobile touch pass, store/monetization surface, any retention loop. |

**Player value if shipped today:** ~**1.5 hours of delight** and **0 hours of obligation**. That is a good jam game and a bad product.

**Where the prior audit (`GAME_EVALUATION.md`) is now stale:** it claims "no turn timer". There *is* one — `TableRoom.ts:610` schedules a hard auto-end on `turnDeadline`, the lobby exposes it (`OnlineLobby.tsx:161`, options 0/30/45/60/90 + 0/15/30/45/60 increment). It also claims a 32-round median; the current engine measures **median 25** (100 matches). Use this report's numbers.

---

## 2. Extracted Rulebook & Stat Matrix (Phase 1)

**Core loop.** 2–6 seats. Each seat has one CP battery: max 20, +10/turn, P1 opens with 15 (`Config.ts:44`). Units act individually but all draw from that battery; a unit that acts is `completed` for the turn. A turn ends only when the player chooses, or when CP runs out. Conquer = destroy enemy HQ (50 HP, 20 % armor); Deathmatch = wipe squads; Doomsday lava starts round 30 and eats one ring every 5 (`Config.ts:37`).

**Units** (`Config.ts:161`):

| Unit | HP | Dmg | CP/shot | Range | Ammo | Vision | Cost | Identity |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Scout | 15 | 5 | 3 | 3 | 10 | 4 | €50 | Vision, bodies, vault cracking |
| Breacher | 30 | 10 | 5 | 4 | 6 | 3 | €150 | Frontline, best HQ sieger |
| Sniper | 10 | 20 | 8 | 7 | 3 | 5 | €300 | Deletes, but must fire from Mountain/Dunes/owned Building |

**Damage:** `max(1, floor(base × (1 − cover) × watchtower) − eliteBreacherArmor + crossfire)` (`CombatRules.ts` `computeDamageOutcome`). Cover: forest 40 %, mountain 40 %, building 50 %, bunker 50 %, barrier 80 %, sand **−10 %** (`Config.ts` `TERRAIN_DEFENSE`).

**TTK, recomputed from shipped constants:**

| Attacker | Dmg/CP | Kills 30 HP Breacher in forest | HQ shots (20 % armor) | HQ CP total |
|---|---:|---:|---:|---:|
| Scout | **1.67** | 10 shots | **13** | 39 |
| Breacher | 2.00 | 5 shots | 7 | 35 |
| Sniper | **2.50** | 3 shots | **4** | **32** |

The Sniper is the most CP-efficient unit at *both* killing and sieging. Its only cost is positioning. That single line explains the entire meta.

**Missing / thin mechanics:** no unit healing outside consumables, no HQ repair, no supply lines, no commander identity, no turn-order initiative choice, no fog-of-war threat overlay (only hover rings on turrets/bases, `GameRenderer.tsx:663`), no replays (base artillery and drop placement still call `Math.random`).

---

## 3. Simulation & Math Findings (Phase 2)

290 matches, all through `prepareAction → applyAction` (server-equivalent). Plus the repo's 60-match fault sim: **0 crashes, 0 rejects, 0 stalls**.

| Scenario | n | P0 / P1 | Median rounds | Avg | Stall | **Dead turns** | Payoff / turn | Comeback (behind at R10 wins) |  |
|---|---:|---|---:|---:|---:|---:|---:|---:| --- |
| HARD vs HARD, Conquer | 100 | 44 / 56 | **25** | 24.3 | 0 | **35.6 %** | 1.28 | 39 % |  |
| RUSH(P0) vs HARD | 40 | **0 / 40** | 24 | 24.6 | 0 | 28.7 % | 1.24 | 0 % |  |
| HARD vs RUSH(P1) | 40 | **38 / 0** | 23 | 96.5 | 2 | 81.8 % | 0.32 | 8 % |  |
| TURTLE(P0) vs HARD | 30 | 17 / 10 | 28 | 101.4 | **3** | 87.6 % | 0.25 | 37 % |  |
| HARD vs TURTLE(P1) | 30 | 7 / **18** | 34 | 150.3 | **5** | 91.3 % | 0.19 | 36 % |  |
| HARD, Deathmatch + Doomsday | 25 | 10 / 15 | 22 | 24.6 | 0 | 34.8 % | 1.32 | 28 % |  |
| Sniper-heavy vs Scout-heavy | 25 | 15 / 10 | 26 | 27.3 | 0 | 50.1 % | 1.03 | 44 % |  |

*Dead turn = a seated turn ending with zero `hit/killed/structureHit/heist/promotion/capture/build/supplyLanded` events. Payoff excludes movement, sounds and popups, so it is conservative.*

*Run-to-run note: base artillery and supply drops still call `Math.random`, so identical seeds vary. Across repeated runs the HARD/HARD split moved 38–45 % P0 and dead turns 35–37 %; treat gaps under ~5 points as noise. The structural findings (rush 0 wins, turtle stalls, 1.4 vs 38.6 damage-per-death) were stable across every run.*

**Opening cadence (HARD/HARD):** first blood median **round 2**; first HQ damage median **round 7**; 10.0 kills, 1.10 heists, **8.89 promotions** per match; 10.1 CP spent per turn (i.e. the battery is fully consumed every turn — there is no slack).

**Unit utility across all 290 matches:**

| Unit | Deaths | Total damage | Damage per death |
|---|---:|---:|---:|
| Scout | 1,769 | 2,530 | **1.4** |
| Breacher | 327 | 8,224 | 25.1 |
| Sniper | 425 | 16,395 | **38.6** |

**Five hard conclusions.**

1. **First-player advantage is fixed.** 44/56 over 100 matches is noise. The 15-vs-20 opening CP handicap works (`Config.ts:44`, `setup.ts`). Do not touch it.
2. **Rush is not a strategy; it is a trap.** 0 wins in 80 attempts from either seat. The defender's free automated fire (bank turret 4 dmg + HQ artillery 3–5 + splash, `apply.ts:1225`) plus cover makes naked aggression suicide. The problem is not balance — it is *player expectation*. Every new player will try this, lose, and blame the game.
3. **Turtling is viable and lethal to the product.** 8 stalls in 60 turtle games, and the longest ran **429 rounds** (with several over 240). A defensive policy that wins 18/30 as P1 while producing 91 % empty turns is a retention bomb.
4. **The Scout is a stat block, not a character.** 1.4 damage per death. Its economic justification (cheap respawn, vision, vault cracking) is real but invisible; players experience it as "my unit dies and does nothing". Loadout choice is therefore fake: everyone converges on Breacher screen + Sniper siege.
5. **Swing is healthy; closure is not.** 39 % of matches are won by the player who was behind at round 10 — that is drama, not a coin flip. But the same data shows leads decay rather than convert, which is exactly why games reach round 40. There is no "closing mechanic" between round 15 and Doomsday at 30.

**Time model.** Median 25 rounds = 50 player-turns at ~3–5 actions each (~150–250 actions). At the server's 450–800 ms bot cadence (`TableRoom.ts:64`) an AI match is ~3 minutes of watching. At a human ~4 s/action it is **15–18 minutes** — a good async session, a poor live duel.

---

## 4. Part 1 — Dopamine, "Juice" & Compulsion Loop

### 4.1 Micro-dopamine hit rate

The *event design* is excellent. A single kill can fire, in order: muzzle flash → weapon-specific audio → projectile with per-weapon travel time → hit-stop 42 ms → trauma shake → damage popup (960 ms, `fxTimeline.ts:267`) → death ghost (550 ms, `:268`) → kill callout → promotion burst (780 ms) → screen-space callout. That is a 1.5–2 s choreographed sequence, not a number popup. Crossfire even draws lock lines from every supporting ally before the shot lands.

The problem is **frequency and distribution**, not quality.

- HARD/HARD produces **1.28 payoff events per player-turn**. With ~4.3 actions per turn and ~15 s of human decision time, that is roughly **one meaningful dopamine event every 12–15 seconds** — acceptable in isolation.
- But **35.6 % of turns contain none**. Those turns are 4–6 actions of repositioning, reloading, securing, and ending. At 15–20 s each, a player experiences a **20–30 second stretch of pure administration every third turn**, in a game whose entire pitch is "20 CP of clever".
- Deathmatch + Doomsday is the best-paced mode measured: 34.8 % dead turns, 1.32 payoff/turn, median 22 rounds, zero stalls. It is a better default than the current Conquer default (`protocol.ts` `DEFAULT_TABLE_SETTINGS.victoryMode: 'CONQUER'`).
- Doomsday is the only *guaranteed* climax generator and it starts at round 30 (`Config.ts:37`) — **after the median match has already ended at 25**. Most players never see the game's best spectacle.

**Verdict:** the juice is 8/10; the *beat chart* is 5/10. The game is engineered for spikes but scheduled for lulls.

### 4.2 Clutch / swing factor

Genuine emotional peaks exist and are engineered, not accidental:

- **Overwatch ambush** intercepts a moving unit mid-path, pins it, and the FX timeline literally pauses the march at the intercept tile (`fxTimeline.ts` move/overwatch choreography; `apply.ts:644`). This is the best moment in the game.
- **Bank heist under turret fire** — 15 HP vault, 4 dmg/turn turret at range 2 (`Config.ts` `BANK_STATS`), Scout needs 4 shots, Breacher 2. A real risk/reward squeeze.
- **Elite Sniper** at 22 dmg + 7 CP clears exact cover breakpoints (forest 13, bunker 11) — the design team did genuine threshold math here.
- **Comeback rate 39 %** confirms matches are not decided early.

But the peaks are *rare and private*. Heists occur **1.10 times per match**. Overwatch kills are rarer still. The dominant experience is a sniper trading 16-damage siege shots into a static HQ over 4 turns — mathematically optimal, emotionally flat. There is no "last-CP headshot" ritual because there is no presentation of *the last CP*. The HUD shows a battery number; it does not scream "3 CP LEFT — ONE SHOT".

### 4.3 Cognitive load vs flow

Nine systems compete for working memory in the first match: shared CP, weather zones (change every 5 turns, `apply.ts:1153`), bank turrets, heists, crossfire, suppression, overwatch, quicksand, veterancy, ammo. Individually each is clean. Together, a new player must answer "why did my shot do 6 instead of 10?" by composing:

`10 base × 1.0 (no watchtower) × (1 − 0.40 forest) = 6`, and then possibly `−2 elite breacher armor` or `+2 crossfire`.

That is **seven modifiers across three operations**, with rounding. The game *does* answer the question — `HUD.tsx:927–932` prints the exact decomposition ("Target Cover: -40% DMG", "Crossfire Ally: +2 DMG") and a LETHAL badge at `:966`. That is genuinely above genre average and should be protected.

The failure is **before** the hover. The manual (`HowToPlay.tsx`) is eight sections of prose and tables. There is **no scripted first match**, no forced kill, no forced heist, no "here is why that number was 6". Cognition is front-loaded into reading instead of doing. Expected time-to-model for a new player: **2–3 matches, 30–45 minutes** — far past the 60-second window a web game gets.

### 4.4 The "one more match" hook

When a player loses today, what do they attribute it to?

- **Not RNG.** Damage is deterministic; the only randomness is base artillery 3–5 and drop placement. That is a genuine asset.
- **Partly "I misread the board."** Good — that is the *Into the Breach* attribution you want.
- **But mostly "I ran out of CP and watched."** That is the bad attribution. The 35.6 % dead-turn rate means a meaningful share of losses feel like *resource starvation*, not a clever mistake.
- **And then there is no next step.** The winner overlay offers grade, MVP, seed, and "Return to Base" (`HUD.tsx:1518–1622`). Career is `localStorage` only (`CareerStatsManager.ts:4`). Online rematch is host-gated. No daily, no ladder, no unlock, no next objective.

**The compulsion loop currently ends at the exact moment it should begin.** The seed/grade system is a good "one more try" *seed* (pun intended) but it is not surfaced as a progression.

---

## 5. Part 2 — Replayability & Meta-Progression

### 5.1 Content exhaustion curve

| Hour | What the player has seen | State |
|---|---|---|
| **0–1** | 1 tutorial-less match, 3 units, bank heist, 1 promotion, first HQ siege | Delight, confusion about damage numbers |
| **1–3** | All 4 map archetypes (`setup.ts:69`), sniper meta discovered, 1 challenge op | "This is clever" |
| **3–10** | All 5 challenge ops (`ChallengeOps.ts`), all 3 mutators, all 3 presets, grades S–D | "I have solved it: screen with Breachers, siege with Snipers" |
| **10–30** | Nothing new. Same 3 units, same 4 topologies, same optimal line | Churn |

The tactical puzzle is **solved at roughly hour 6**, not because the map generator is weak (it is good: four archetypes, river carving, bridge spacing, mountain clusters) but because **the unit roster has one dominant line and no asymmetric starting states**. Variety of *terrain* cannot compensate for singularity of *strategy*.

### 5.2 Lowest-effort, highest-impact replayability

Ranked by (retention impact ÷ engineering effort), against *this* codebase:

1. **Commander perks (pre-match, 3 choices).** Add `commander?: 'VANGUARD' | 'MARSHAL' | 'GHOST'` to `GameSettings` and resolve 2–3 modifiers in `CombatRules`/`apply`. No new art: reuse existing sprite + a colored badge. Immediate build diversity, zero new unit models.
   - VANGUARD: +2 CP on kill (fixes dead turns *and* rewards aggression).
   - MARSHAL: +25 % siege damage, Scouts cost €40.
   - GHOST: Snipers 7 CP, +1 vision, −1 ammo.
2. **Daily seeded skirmish + leaderboard.** Map and weather are already seeded (`SeededRandom.ts`, weather keyed `seed_weather_${turn}` at `apply.ts:1153`). Fix the two `Math.random` calls (base artillery, drops), then one server row per day: seed, par, top 100. This is infinite content for ~2 days of work.
3. **Roguelike draft between rounds (challenge mode only).** After each op, pick 1 of 3: +1 ammo, +2 CP/turn, a free Barrier, a Veteran promotion. Uses existing mutator plumbing (`MUTATOR_CONFIG`) and `MissionConfig`; no new combat code.
4. **Asymmetric loadouts.** `unitCounts` already exists in settings and varies by seat in `ChallengeOps` placements. Let each seat pick 4 units from a 6-point budget before the match. One UI screen, engine already supports it.

**Do #1 and #2 first.** Together they convert a solved puzzle into a daily habit.

### 5.3 Async vs sync multiplayer

**Async is the correct fit, and the code is closer to it than the defaults suggest.**

- The CP battery demands 20–60 s of planning. A 30 s base clock (`DEFAULT_TABLE_SETTINGS.turnBaseS: 30`) actively punishes the game's own core puzzle.
- A median match is 50 turns. Live, that is 25–40 minutes of two people staring at each other's clocks; async, it is a 2-day board game by text.
- Turn timers already support `0 = off` (`TableRoom.ts:572–580`) and the clock is server-authoritative with increments. So "play-by-mail" is one preset away.
- **What blocks it:** reconnect hold is **180 s** (`TableRoom.ts:68`), there is no notification/push, no "your turn" badge outside the tab, and no per-match persistence beyond a day (`README.md`). An async mode needs a 24–72 h clock, a persistent "my games" list, and a nudge.

**Recommendation:** ship **two clocks as presets** — `LIVE: 90 s + 30 s` and `ASYNC: 24 h` — and make Async the default for online. Keep the 30 s option for tournaments only.

---

## 6. Part 3 — Marketing, Positioning & Commercial Viability

### 6.1 The 3-second GIF test

**Will a scroller stop? Probably not — yet.**

What a 3-second loop currently shows: a top-down 20×20 pixel-art field, a small unit sliding two tiles, a tracer, a red "-16", a small shake. At 400 px wide on a phone, the unit is ~12 pixels. The *best* frame — a sniper shot with hit-stop and an "OVERWATCH KILL" callout — is legible but not *distinctive*; it reads as "generic tactics game".

Compare to clips that stop scrollers: *Into the Breach* (a mech punches a bug through a mountain into another bug), *Marvel Snap* (cards flip and a location explodes), *Polytopia* (a giant army appears on a tiny map). Each has **one legible verb with a consequence you can read without context**.

**The single highest-leverage visual upgrade:** a **350 ms kill-cam** — on a lethal hit, punch the camera in ~1.6×, drop time to 0.35×, keep the shake and audio, and stamp the *cause* ("CROSSFIRE +2 • 22 DMG • ACE BOUNTY +€75"). This is a presentation-layer change: `fxTimeline` already owns hit-stop, trauma, callouts and death ghosts; it needs a camera-focus track and a `GameRenderer` viewport tween. It turns the game's best systemic moment (a stacked-modifier kill) into its best *thumbnail*. That is the clip you post.

### 6.2 Positioning & comp titles

**Exact target player:** 25–40, PC/web, has played *Into the Breach* or *Advance Wars*, has 15 minutes and a browser tab, likes deterministic puzzles more than army building. Secondary: async mobile 4X players (*Polytopia*) who want actual combat.

**One-sentence pitch:**
> **"Advance Wars' fog-of-war chess match, where every unit drinks from one shared 20-point battery."**

Shorter, for a store page: **"One battery. Three specialists. Fifteen minutes. Spend it right."**

| vs | Tactical Tiles wins | Tactical Tiles gets crushed |
|---|---|---|
| **Into the Breach** | Real PvP, unit persistence/veterancy, economic raiding | ITB's perfect information and 8-second "obvious brilliant move" clarity; ITB never has a dead turn |
| **Polytopia** | Actual tactical combat depth, no pay-to-win tribes | Async UX, factions, mobile polish, art charm, notification loop |
| **Wargroove** | Match length (15 min vs 45), CP puzzle, no build-order homework | Unit identity and personality, campaign, commander powers, art |
| **Marvel Snap** | Simultaneous depth per minute, spatial play | Snap's 3-minute match, one-screen legibility, cosmetic economy |

**Positioning sentence for the store:** "A 15-minute async tactics duel with deterministic damage, no dice, and one battery you will absolutely mismanage."

### 6.3 Distribution & monetization

| | **Path A — F2P web/mobile viral** | **Path B — Paid Steam/itch ($5–12)** |
|---|---|---|
| Fit with current code | **Excellent.** React + Pixi + Colyseus, instant link, no build pipeline, online already server-authoritative | Poor today. No campaign, no save, no controller/keyboard pass, no Steam wrapper |
| What's missing | 60-second onboarding, mobile touch layout, daily loop, cosmetics, account persistence | 8–12 h campaign, meta progression, cloud saves, packaging, store assets |
| Time to launch | **2–4 weeks of focused work** | 4–6 months |
| Revenue ceiling | Low per user, high ceiling via Discord Activities / CrazyGames | Higher per user, brutal discoverability |

**Recommendation: Path A now, Path B as the "1.0" after the daily loop proves retention.** The codebase is a web game whether you like it or not — Colyseus rooms, a Cloudflare tunnel, a React HUD. Shipping it to Steam first would mean fighting the architecture for a market that will not forgive the missing campaign. Ship it where "click a link, play in 10 seconds" is the distribution advantage.

**Monetization that fits the design:** cosmetic commanders + a $4.99 "Campaign Ops" pack (the 5 challenge ops expanded to 20). **Do not** sell CP, units or damage. The entire promise is determinism and fairness; pay-for-power would poison the only trust asset the game has.

### 6.4 Three-step launch loop to the first 1,000 retained players

**Step 1 — Seed the loop (week 1–2).**
Ship: daily seeded skirmish, shareable result card ("I beat SEED `K7QX` in 19 rounds — S grade"), and the kill-cam. Post 3 clips/week to r/TurnBasedTactics, r/WebGames, r/IndieGaming, plus the *Into the Breach* and *Polytopia* Discords with the framing "play my seed, no install". Target: 10k link opens, 25 % → match start.

**Step 2 — Convert in 60 seconds (week 2–3).**
Replace the setup screen as the landing experience with **"PLAY NOW" → a scripted 3-unit tutorial match** vs a weak bot: forced move, forced kill (with the damage decomposition shown *before* the shot), forced heist, then "now do it with 20 CP". The setup screen becomes "Custom Match". Target: first-match completion ≥ 60 %.

**Step 3 — Retain on a 7-day arc (week 3–6).**
Daily seed → streak → commander unlock at day 1 / 3 / 7; weekly leaderboard reset; "rematch a friend" deep link that opens an async table. Instrument D1/D7 and median matches/session. Success gate: **D7 ≥ 12 %** and **≥ 3 matches per session**. If D7 misses, the problem is cadence (dead turns), not content — go back to §7.1.

---

## 7. The "Fun Killers" Audit — Top 5

1. **The battery runs dry, so turns run empty.** 35.6 % dead turns; 10.1 CP spent per turn against 10 regenerated means zero slack. A player who mispositions has no recovery action, only "end turn". *This is the #1 retention leak and the #1 fix.*
2. **Rush is a 0–80 trap.** The intuitive fantasy loses every time, and the game never tells the player why. Free automated defenses (`apply.ts:1225`) plus cover make aggression mathematically wrong. New players do not conclude "I should screen and siege"; they conclude "this game is unfair".
3. **Sniper monoculture / fake loadout choice.** 2.50 dmg/CP at range 7, best siege unit, 38.6 damage per death. The Scout deals 1.4 damage per death. Every optimal list is the same list; every match converges to the same siege line.
4. **No threat projection.** You can preview *your* shot (`HUD.tsx:861`), but not the enemy's kill box. Turret/base ranges only appear on hover (`GameRenderer.tsx:663`). A 7-range sniper that kills from off-screen reads as a gotcha, not a lesson.
5. **The loop ends at the victory screen.** Grade, MVP, seed, "Return to Base". Career is local-only; rematch is host-only; no daily, no ladder, no unlock. The game asks "one more?" and then removes the button.

---

## 8. The "Dopamine & Viral Loop" Upgrade Plan — 5 Transformations

Ordered by impact per engineering day. Each is specified against the actual architecture.

### 1. Momentum CP — refund tempo for aggression *(engine, ~1 day)*
On a kill or heist, immediately refund **+2 CP** to the acting player (cap at `MAX_CP`). This does three things at once: it pays the player for the fun verb, it converts a dead turn into a follow-up action, and it makes aggression economically correct without buffing raw damage. Add in `apply.ts` `ATTACK`/`SIEGE` success paths next to `grantAceBounty`; surface it as a floating "+2 CP TEMPO" popup (the FX pipeline already handles popups). Re-run the sim: expect dead turns ↓ 8–12 pts, median rounds ↓ 2–3, rush win rate up from 0 % (a good thing — it should be *viable*, not dominant).

### 2. Kill-cam + "why it died" stamp *(client, ~2–3 days)*
On `killed`, pause 350 ms, zoom to 1.6× on the victim, run time at 0.35×, then stamp the decomposition: `10 × 0.6 (FOREST) + 2 (CROSSFIRE) = 8`. `FxTimeline` already has `triggerHitStop` (`:573`), trauma (`:582`), death ghosts and callouts — add a `focus` cue type and let `GameViewport` tween zoom/pan. This simultaneously fixes onboarding (the "why 6 not 10" question) and produces the 3-second clip. **Highest marketing leverage in the entire list.**

### 3. Daily Seeded Skirmish + server leaderboard *(engine + server, ~3 days)*
Thread the match seed into the last two `Math.random` calls (`getBaseArtilleryDamage`, supply-drop tile). Map + weather are already deterministic. Add one server table keyed by UTC date storing seed, par, and top 100 results; a "DAILY" button on setup; 3 attempts/day; a share string. `TableStore` already persists rooms — extend the same pattern to results. This is the "one more match" hook the game is missing.

### 4. Commander perks — 3 loadout identities *(engine + setup UI, ~3–4 days)*
`GameSettings.commander`, resolved in `CombatRules` (damage/range/CP) and `apply` (economy). Three identities, each pushing a different verb:
- **VANGUARD** — +2 CP on kill, Scouts €40 (aggression/tempo)
- **MARSHAL** — +25 % HQ siege, Breachers +5 HP (siege/attrition)
- **GHOST** — Snipers 7 CP and +1 vision, −1 ammo (finesse/ambush)

No new art. Reuses the existing badge/label language. Instantly makes the "screen + sniper" line non-mandatory.

### 5. Shareable match card + seed challenge link *(client, ~2 days)*
Reuse the canvas snapshot machinery in `MapPreviewModal` to render a final-board card: winner, grade, seed, "beat my 19-round run", and a copyable link that starts that seed. Add a "CHALLENGE A FRIEND" button on the winner overlay (`HUD.tsx:1518`). This closes the viral loop the async design already supports.

---

## 9. Six-Pillar Breakdown (with citations)

| Pillar | Score | Strength | Flaw |
|---|---:|---|---|
| **1. Core loop & tactical depth** | **7.5** | Shared battery (`Config.ts:44`); Sniper high-ground gate (`CombatRules.ts` `canUnitAttackFromTile`); Watchtower/Bunker specialization; crossfire +2; Overwatch with refund (`Config.ts:214`); weather changes range/cost. Rush is provably non-dominant. | Optimal play collapses to Breacher screen + Sniper siege. Scout has no combat identity (1.4 dmg/death). |
| **2. Balance & pacing** | **6.0** | No first-player edge (44/56). Deterministic damage. 39 % comeback rate. Deathmatch+Doomsday is tight (median 22, zero stalls). | 35.6 % dead turns; turtle → 91 % dead + 8 stalls/60; Doomsday at R30 arrives after the median match (R25); base artillery RNG. |
| **3. Multiplayer readiness** | **7.5** | Server authority via `prepareAction` (costs recomputed, never trusted); per-seat fog views (`view.ts`); snapshots + reconnect; auto-bot cover; **turn clock with hard auto-end** (`TableRoom.ts:610`); rate limits. | No accounts/ELO; no async nudge; 180 s reconnect hold (`TableRoom.ts:68`); host-only rematch; replays not deterministic (two `Math.random`). |
| **4. UI/UX & game feel** | **8.0** | Pre-commit damage preview with LETHAL badge (`HUD.tsx:927–966`); explains blockers in words (`getAttackBlocker`); CP-costed move previews; procedural audio; hit-stop/trauma; `prefers-reduced-motion` support (`fxTimeline.ts`). | No persistent enemy threat overlay; no kill-cam; 7-modifier damage model is only explained after hover; manual instead of tutorial. |
| **5. Replayability** | **4.0** | 4 map archetypes, 3 presets, 5 challenge ops, 3 mutators, grades/medals, seeded retry. | No commanders/factions/daily/ranked/unlocks; career is `localStorage` (`CareerStatsManager.ts:4`); content exhausted ~hour 6. |
| **6. Architecture** | **8.0** | Pure engine, zero I/O except 2 `Math.random`; shared rules pipeline for local/AI/server; 60-match fault sim clean. | `apply.ts` is a 1,456-line switch; `useGameStore.ts` 1,071 lines; AI magic numbers (siege priority 120/9999, `AIBrain.ts:633–635`). |

---

## 10. Top 5 High-Impact Fixes (ranked by Impact ÷ Effort)

| # | Fix | Why | Effort | Where |
|---|---|---|---|---|
| **1** | **Momentum CP (+2 on kill/heist)** | Attacks the 35.6 % dead-turn hole and makes aggression viable without buffing damage | **XS** | `apply.ts` ATTACK/SIEGE success; `Config.ts` constant |
| **2** | **Make Deathmatch+Doomsday the quick-play default; start Doomsday at R20** | Best measured pacing (34.8 % dead, median 22, 0 stalls); guarantees a climax before median match end | **XS** | `protocol.ts` `DEFAULT_TABLE_SETTINGS`; `Config.ts` `DOOMSDAY_SETTINGS.START_TURN` |
| **3** | **Kill-cam + damage decomposition stamp** | Fixes onboarding *and* is the only clip likely to stop a scroller | **S–M** | `fxTimeline.ts` (focus cue), `GameViewport.tsx`, `HUD.tsx` |
| **4** | **Daily seed + server leaderboard** | Infinite content, the missing "one more match", ~3 days | **M** | `CombatRules.ts` RNG, `TableRoom`/`TableStore`, `GameSetup.tsx` |
| **5** | **Commander perks (3 identities)** | Ends the sniper monoculture and fake loadout choice | **M** | `GameSettings`, `CombatRules.ts`, `MatchRulesControls.tsx` |

**Do 1 and 2 this week.** They are config-level changes that move the two numbers this report is most worried about (dead turns and pacing). Then measure again before building anything larger.

---

## 11. Go-To-Market Blueprint (one page)

**Positioning:** "One battery. Three specialists. Fifteen minutes. Spend it right."
**Category:** async tactical duel (not 4X, not roguelike).
**Target:** *Into the Breach* / *Advance Wars* players with a browser tab; async *Polytopia* players who want real combat.
**Platform:** web first (CrazyGames/Poki/Discord Activity), PWA for mobile; Steam only after a campaign exists.
**Price:** free core + $4.99 Ops pack + cosmetic commanders. Never sell power.
**Hook asset:** kill-cam clip with a stacked-modifier stamp.
**Retention asset:** daily seed + streak + 3 commanders.
**First 1,000:** daily seed → 60-second tutorial match → 7-day commander unlock arc. Gate on D7 ≥ 12 %, ≥ 3 matches/session.
**Do not:** add a 4th unit type, a fog toggle, or a ranked ladder before cadence is fixed. Content will not save a game that spends a third of its turns doing nothing.

---

### Appendix — reproduction notes

- Stats: `Config.ts:44,161,197,214`; damage pipeline `CombatRules.ts` `computeDamageOutcome`; siege `calculateSiegeDamage`.
- Pacing/FX: `fxTimeline.ts:267–270` (popup 960 ms, ghost 550 ms, promotion 780 ms), `:1414/:1492/:1543` (hit-stop 42/45/48 ms), `:573/:582` (hit-stop/trauma), callouts `:1546/:1691/:1804`.
- Multiplayer: `TableRoom.ts:64` bot cadence, `:68` 180 s reconnect, `:572–628` clocks/auto-end, `:1225` (in `apply.ts`) free automated defenses.
- Content: `ChallengeOps.ts` (5 ops), `Presets.ts` (3 maps), `setup.ts:69–75` (4 archetypes), `CareerStatsManager.ts:4` (localStorage).
- Simulation: 290 matches, 2 seats, HARD bots + scripted rush/turtle policies, `prepareAction → applyAction`, 3,000-action cap, `autoBankReward: true`. Dead turn = zero payoff events in a seated turn. Reproduce with `cd packages/engine && bun sim-psych.ts`.
