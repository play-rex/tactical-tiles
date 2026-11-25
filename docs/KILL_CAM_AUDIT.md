# Tactical Tiles — Kill Cam Animation & Game Direction Audit
*Game Director & Lead Game Animator review · 24 Nov 2026*
*Scope: `killCam.ts`, `KillCamOverlay.tsx`, `killCam.css`, `GameViewport.tsx`, `fxTimeline.ts`, `SoundFX.ts`, `ProjectileRenderer.tsx`, `DeathGhostLayer.tsx`, `HUD.tsx`, `useGameStore.ts`*

---

## 1. Executive Summary

The kill-cam architecture is unusually well engineered for a 2D web tactics game. Rather than hacking a post-death freeze-frame onto the UI, the client exploits the engine's full-batch `GameEvent[]` contract to start camera pre-roll **at muzzle release** and dilate a single unified combat clock so projectiles, particles, recoil, popups, and death ghosts stay locked in phase.

Its first revision, however, had **six concrete integration bugs**, a **center-screen staging violation**, **sniper/audio slow-mo seams**, and **no player-facing pacing control** (skip or short/off modes).

---

## 2. What Already Works Great (Keep & Protect)

1. **Predictive Pre-Roll (`killCam.ts` / `fxTimeline.ts`):** Knowing lethality up front lets the camera begin pushing in before impact—the exact technique used in *XCOM* and *Fire Emblem*.
2. **Split Film-Clock vs. Combat-Clock (`fxTimeline.ts`):** `KillCamDirector.step(rawDtMs)` runs in real wall-clock time and drives `combatDtMs = rawDtMs * timeScale`, while trauma screen-shake decays in real time (`rawDtMs`) so impacts stay tactile instead of syrupy.
3. **Pure-TS Testable Director & Reduced Motion:** Zero React/Pixi coupling in `killCam.ts`, solid unit tests (`killCam.test.ts`), and `prefers-reduced-motion` honored cleanly across camera, shake, and CSS.
4. **First-Breach Memory (`resetMatchMemory` vs. `clear`):** Routine siege hits on an already-breached HQ/Bank stay quiet while first-breach and destruction moments still earn the camera.

---

## 3. Animator & Director Findings (Issues & Agreed Direction)

### A. Pacing, Modes & Attack Micro-Cam (Updated Design Direction)
* **Original critique:** Both `CINEMATIC` (~5.0s) and `MICRO` (~4.2s) were unskippable and locked input (`pointer-events: auto`), risking fatigue across ~10 kills/match.
* **Updated 3-Mode Design (`FULL` | `SHORT` | `OFF`) + Instant Skip (`Click` / `Space` / `Esc`):**
  * **`FULL` (Default — Capped ≤ 4.0s):** Keeps the dramatic theatrical experience capped cleanly at ~3.8s max (`CINEMATIC` ~3.8s, `MICRO` ~3.2s, `STRUCTURE` ~2.6s), paired with a snappy **non-lethal Attack Micro-Cam** (~0.8s, non-blocking, no letterbox) so *every* shot carries kinetic camera weight while kills still explode into full cinema.
  * **`SHORT` (Speed / Competitive Cut):** Snappy animator timings—`ATTACK` ~0.5s subtle camera lean, `MICRO` ~0.95s kinetic punch, `CINEMATIC` ~1.9s tight broadcast slam, `STRUCTURE` ~1.6s.
  * **`OFF`:** Disables camera hijack and overlays completely and restores classic `TacticalBanner` callouts.
  * **Instant Skip:** Clicking the overlay/Skip button or pressing `Space`/`Esc` cancels active kill/structure cuts cleanly without re-triggering on deferred impact.

### B. Staging Violation (Fixed)
* **Problem:** `.tt-killcam__stamp` placed `clamp(46px, 8.4vw, 104px)` damage numerals at `top: 40%`—directly over the centered victim, projectile impact, and explosion particles.
* **Fix:** Keep the central ~45% action stage completely clear. Move the damage/HP stamp to an off-center upper-right tactical telemetry cluster so the eye reads the silhouette, projectile strike, and particles first, then sweeps naturally to the numbers and cards.

### C. Slow-Mo Visual & Audio Seams
1. **Sniper Beam Freeze (`ProjectileRenderer.tsx`):** `sweepT` clamped at `55%` of `travelMs`, freezing the laser mid-screen for >1 second before impact during slow-mo. Sweeping across `92%` of `travelMs` keeps motion alive right up to perforation.
2. **In-Flight Audio Vacuum (`SoundFX.ts`):** `playKillCamSting('IN')` lasted `0.16s` while `PUSH` lasted `1.8–2.7s`, leaving dead silence before impact. Scaling the filtered riser + sub-bass tension swell to the actual real-time flight duration (with a brief pre-impact duck) preserves suspense.
3. **Terrain Upscale Cap & Exit Hitch (`GameViewport.tsx`):**
   * Capping `cropScale` at `3.8×` visibly softened the `1×` baked terrain canvas; tightening to `2.6×` keeps ground detail sharp.
   * Previously `RECOVER` zoomed out while staying pinned to the kill point, then triggered a second `280ms` pan back to `saved.x/y`. Blending both scale and center back to `saved` during `RECOVER` creates a single silky curve, and delta-normalizing pan smoothing (`k`) fixes 120Hz/144Hz monitors.
4. **Death Silhouette Detail (`DeathGhostLayer.tsx`, `GameRenderer.tsx`):** Worth a Phase 2 pass—preserve actual unit facing/ammo in `PendingDeathsLayer` and add directional knockback/debris tumble to `DeathGhostSprite` so close-ups feel physical rather than icon-shrinking.

### D. Concrete Bugs Identified & Fixed
| # | Bug | Root Cause | Fix |
|---|---|---|---|
| 1 | **Rotated map zooms to wrong spot** | `CinematicCameraController` ignored `mapRotation` (`rotateBoardPoint`) and didn't swap `frameW`/`frameH` on 90°/270°. | Transform center via `rotateBoardPoint` and swap frame axes on 90°/270°. |
| 2 | **Modals cover HQ Destruction & Vault Heist** | `WinnerOverlay` (`z: 100`) and `BankRewardModal` (`z: 200`) mounted immediately over `KillCamOverlay` (`z: 44`). | Gate both modals on `!killCamActive` (reactive boolean in `useEffectStore`). |
| 3 | **AI plays straight through kill cam** | `runAiLoop` fired next bot action after fixed `700ms`. | Wait for `!fxTimeline.isKillCamActive()` (+ brief settle beat) before firing next bot move. |
| 4 | **Overwatch & Mine surprise spoiler** | `preRoll()` fired at `t = 0` when a unit started marching toward a trap, flashing `ROUND IN FLIGHT` before ambush/mine detonation. | Schedule `preRoll` at projectile `startMs` for ranged/Overwatch kills; never pre-roll `MINE`/`LAVA`/`BASE_FALL`. |
| 5 | **Wrong unit info, Rank 2 label & Ace HP** | `cue.victimName` was unused; Rank 2 printed `VETERAN` instead of `ELITE`; `maxHp` ignored Veterancy HP bonuses; damaged finishes claimed full `maxHp → 0`. | Compute rank-adjusted `maxHp`, render unit class + player badge, use `VETERANCY_CONFIG.RANK_NAMES`, distinguish `ONE-SHOT` vs. `LETHAL`. |
| 6 | **Double banner, combo anim & structure letterbox** | `MICRO` fired both `KillCamOverlay` and `TacticalBanner`; missing `key` prevented combo CSS re-slam; `STRUCTURE` returned `letterbox: 0` while showing letterbox bars. | Suppress `TacticalBanner` whenever a kill cam cue plays; key overlay on `cue.id + combo`; derive `letterbox` from `timing.letterbox`. |

---

## 4. How the Kill Cam Boosts Game Attractiveness

* **Fixes the 3-Second Scroll Test:** Top-down 64px grid tactics struggle to grab eyes in short social clips. Camera choreography + kinetic typography converts abstract grid state into an unmistakable esports highlight.
* **Emotional Memory:** Turns deterministic arithmetic into memorable stories (*"my Ace Sniper crossed the river under crossfire to end the match"*).
* **Next-Level Opportunity — Spectacle as Onboarding:** *Tactical Tiles* stacks up to 7 damage modifiers (Watchtower ×1.2, Cover, Sand −10%, Elite Breacher −2, Crossfire +2, Rank). Printing the **Tactical Receipt** right inside the kill cam teaches players *why* a shot dealt exact lethal damage while making clips look galaxy-brained.

---

## 5. High-Impact Presentation Upgrades (Roadmap)

1. **Tactical X-Ray Blueprint Impact Frame:** Brief 180ms high-contrast cyan/obsidian blueprint flash on `SLAM` showing line-of-fire geometry, shattered cover badge, Crossfire triangulation rays, and exact math receipt (`20 × 1.2 TOWER − 40% FOREST + 2 CROSSFIRE = 16 LETHAL`).
2. **Weapon-Directed Cinematography:**
   * *Rail Sniper:* Whip-pan riding the laser tip with subtle 2° dutch-tilt.
   * *Land Mine:* Zero pre-roll → 140ms micro-freeze with a metallic *CLICK* + red blink under the boot → explosive punch-in.
   * *Overwatch:* Comms-static snap-cut onto the ambusher before cutting back to the halted target.
   * *Crossfire:* Pull wide to frame the full glowing amber triangulation before snapping into the intersection.
3. **"1 HP · SURVIVED!" Graze Fake-Out:** When a non-lethal attack leaves a unit at 1 HP, flash an amber survival stamp inside the Attack Micro-Cam.
4. **Emergent Headlines:** `0 CP BUZZER BEATER` (spent exact last CP), `GIANT SLAYER` (Scout kills Sniper/Ace), `VENDETTA` (avenge a fallen squadmate).
5. **Async "While You Were Away" Action Reel & Play-of-the-Match Export:** Fast-forward routine opponent moves at 3× and drop into Kill Cam for ambushes/kills; export the top-scored clip from `WinnerOverlay` via `MediaRecorder`.
6. **Permanent Battlefield Scars & Unlockable Kill-Cam Lenses:** Keep subtle scorch/wreck decals for the full match; offer cosmetic Kill-Cam themes (*Blueprint Noir, Thermal Recon, CRT Radar*) as Challenge Op / Daily Streak rewards.

---

## 6. High-Impact Gameplay Features (Rooted in the Shared 20-CP Battery)

1. **Battery Overclock (Tempo Debt) + `+2 CP` Kill Momentum:** Allow redlining up to `+5 CP` borrowed from next turn's regen (visible to the opponent as a counter-attack window), paired with `+2 CP` instant refund on kill/heist to eliminate the 35.6% dead-turn lull.
2. **Positional Unit Combos (Breacher Shove + Scout Laser Paint):**
   * *Breacher Concussive Shove:* Push target 1 tile backward—off Mountain sniper perches, onto Land Mines, into Quicksand/Lava, into Overwatch cones, or into walls for `+4 CRUSH`.
   * *Scout Laser Paint (2 CP):* Halves target cover and lets Snipers fire without high ground, turning the Scout from 1.4-dmg fodder into an essential spotter.
3. **Mid-Match Anti-Turtle Flashpoints:** 1-turn-telegraphed contested objectives every 4–5 turns (*EMP Payload* to disable HQ/Bank turrets for 2 turns, *Comms Uplink* for `+10 CP` surge + Fog reveal, *HVT Bounty*).
4. **Interactive Weather Physics:** Ignitable *Scorched* Forests, 2-tile knockback in *Tailwind*, supercharged *Monsoon* Watchtowers, and `-2 CP` ambush Overwatch + acoustic sonar pings in *Fog*.
5. **Deterministic Bluffing ("Signal Decoys"):** Cheap hologram / false-Overwatch threat rings that bait opponents into burning CP or wasting Sniper shots.
6. **Daily 1-Turn Lethal Puzzles:** 60-second Wordle-style daily checkmate boards that teach stacked modifiers by doing and always pay off with a shareable Kill Cam finale.
