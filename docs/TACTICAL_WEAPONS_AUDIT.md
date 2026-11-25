# Tactical Weapons — Game Director Audit & Animation/FX Bible

> **Scope:** Full architectural, balance, UX, and kinesthetic audit of all **11 Tactical Weapons** (`packages/engine/src/tactical/`) and **8 Standard Unit/Structure/Trap Attacks**, plus complete implementation specifications for every procedural asset, animation keyframe timeline, particle recipe, Foley sound layer, and camera choreography shipped in this pass.

---

## 1. Executive Verdict & Director's Scorecard

The underlying Tactical Weapons rules engine (`packages/engine/src/tactical/`) had a **remarkably strong conceptual foundation** — gold-only single-use tools decoupled from CP, a 1/round anti-spam cap, a free Round 2 Common onboarding pick, public telegraphs that create genuine movement counterplay, and pure-TypeScript deterministic footprints (`geometry.ts`).

However, prior to this pass, **the system was effectively half-shipped at the player-experience layer**: every visible tile lit up regardless of legality, illegal picks logged silently to `console.error`, `MapHoverCard` fell through to `"DEPLOY BRIDGE / NEED WATER OR CANYON"`, none of the persistent tactical board states (`pendingTacticals`, `burningLines`, `smokeZones`, `sensors`, revealed enemy mines) were rendered on the canvas, and there were zero weapon-specific animations, particle bursts, audio Foley cues, or tactical camera profiles.

| Pillar | Pre-Audit Grade | Post-Pass Grade | Summary |
| :--- | :---: | :---: | :--- |
| **Core Loop & Counterplay Design** | **B+** | **A-** | Clean gold sink, 1/round cap, public telegraphs, drone stomp counterplay now visible. |
| **Rules Correctness & Edge Cases** | **C+** | **A-** | Fixed Smoke vs Overwatch, Sabotage `NONE` waste, Napalm origin/attribution, Undo state loss, fog leaks. |
| **Targeting & Rejection UX** | **D** | **A** | Exact `legalTacticalAnchors` filtering, multi-tile footprint + directional preview, exact `MapHoverCard` & toast feedback. |
| **Board Readability (Persistent State)** | **F** | **A** | Dedicated `TacticalGroundLayer` (below units) & `TacticalAirLayer` (above units) render every hazard, cloud, drone, halo & telegraph. |
| **Animation, FX & Kinesthetics** | **F** | **A** | Bespoke `@2x` procedural aircraft/missiles/chutes/drones, 11 weapon timelines, 8 new particle presets, upgraded unit attacks. |
| **Audio Foley & Signposting** | **F** | **A-** | Dedicated procedural Web Audio military Foley for all 11 weapons (sonar, rotors, canisters, AWACS, JDAM, EMP, afterburners, barrage). |
| **Camera Choreography** | **D** | **A** | 4 new tactical camera styles (`ORBITAL_DROP`, `BOMBER_TRACK`, `BARRAGE_WALK`, `THEATER_SWEEP`) + blueprint schematics + Kill Cam labels. |
| **Economy & Tier Balance** | **C+** | **C+** *(Roadmap)* | Carpet Run vs Artillery Barrage and Overclock Core pricing need follow-up tuning (see §4). |
| **AI Tactical Usage** | **C-** | **C-** *(Roadmap)* | Cheapest-first sorting & zero friendly-fire modeling remain priority AI follow-ups (see §4). |

---

## 2. What Works Great (Protect These Pillars)

1. **Gold-Only Economy Sink (`tactical/rules.ts`):** Keeping tactical weapons purely on Euros creates meaningful tension against Buying Units, Bridges/Barriers, and Supply Drops without competing for movement/attack CP.
2. **One-Per-Round Anti-Spam Cap + Free Round 2 Common:** Prevents lategame snowballing where a bank-heist leader drops three barrages in one turn, while Round 2's free Common teaches the shop naturally every match.
3. **Public Telegraphs on Heavy Ordnance:** Precision Strike, Carpet Run, and Artillery Barrage announce their exact kill-box a turn early. That turns heavy ordnance from frustrating "unavoidable off-screen damage" into high-agency area denial — forcing enemies off Watchtowers, Banks, and Bunkers.
4. **Pure-TS Shared Geometry (`tactical/geometry.ts`):** Using `tacticalTilesFor` and `tacticalBlocker` as the single source of truth across engine validation, server checks, hover previews, and legal anchor highlighting prevents client/server desync permanently.
5. **Non-Blocking Smoke Semantics:** Blocking sniping and Overwatch both ways without blocking movement or radius fog gives Smoke Screen a crisp tactical identity (crossing kill-zones safely) without confusing vision rules.

---

## 3. Critical Bugs & UX Failures Found & Fixed in This Pass

### Targeting & Rejection UX
* **Every Visible Tile Lit Up (`useGameStore.ts`):** `useTacticalWeapon` previously highlighted all tiles in `visibleTiles` (or the entire map), even off-board lanes, HQ-excluded tiles, occupied Paradrop tiles, and invalid Sabotage tiles.
  * **Fix:** Exported `legalTacticalAnchors(state, seat, itemKey, targeting)` in [rules.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/tactical/rules.ts) backed directly by `tacticalBlocker`, wired it into `useTacticalWeapon`, `setTacticalAxis`, and `setTacticalWidth`, with automatic `H → V` fallback if one axis has zero legal anchors.
* **Silent Rejection (`useGameStore.ts`, `useOnline.ts`):** Illegal clicks and rejected actions only called `console.error`.
  * **Fix:** `handleTileClick` computes the exact `tacticalBlocker` reason and fires `showMapFeedback(..., 'warn')`; `executeAiAction` (for human turns) and online `ServerMsg.error` both surface `showMapFeedback` directly on the board.
* **`MapHoverCard` Bridge Fallthrough Bug ([MapHoverCard.tsx](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/components/game/ui/MapHoverCard.tsx)):** `placementMode?.active` had no `kind === 'TACTICAL'` branch and fell straight through to `"DEPLOY BRIDGE / NEED WATER OR CANYON"`!
  * **Fix:** Added a dedicated tactical targeting hover card showing weapon name, `FREE` or `€cost`, shape/axis badge, visible enemy count inside footprint, friendly-fire warning (`⚠ N ALLY FF`), or exact `tacticalBlocker` rejection reason on illegal tiles, plus board hazard inspect tags (`SMOKE`, `NAPALM`, `INCOMING STRIKE`, `RECON DRONE`, `REVEALED ENEMY MINE`).
* **Missing Multi-Tile Footprint Preview ([GameRenderer.tsx](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/components/game/GameRenderer.tsx)):** Hovering while aiming `ZONE3`, `LINE4`, `CARPET`, or `LANE` gave no preview of which tiles would be hit.
  * **Fix:** `HoverOverlayLayer` now renders the exact `tacticalTilesFor` multi-tile footprint, directional sweep chevrons, Recon Drone 5-tile Manhattan diamond, and crimson illegal-anchor X warning.

### Engine Rules, Netcode, & State Bugs
* **Smoke Screen Ignored by Overwatch ([OverwatchRules.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/rules/OverwatchRules.ts)):** Despite the shop blurb and `DIRECTOR_PLAN.md` §8.3 promising Smoke blocks Overwatch both ways, `getOverwatchCoverageTiles` and `resolveMoveWithOverwatch` never consulted `smokeZones`.
  * **Fix:** Wired `smokeZones` + `smokeBlocksLine` into `OverwatchRules.ts`, `apply.ts`, `hoverMovePreview.ts`, `GameRenderer.tsx`, and `MapHoverCard.tsx`.
* **Sabotage Accepted Unspecialized Buildings ([rules.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/tactical/rules.ts)):** `isEnemyStructure` allowed targeting `subType === 'NONE'` buildings, letting players spend €175 for zero effect in `resolve.ts`.
  * **Fix:** Required `tile.subType !== undefined && tile.subType !== 'NONE'`.
* **Napalm Entry Burn Bugs ([apply.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/game/apply.ts), [ticks.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/tactical/ticks.ts)):**
  1. `MOVE` passed the full path including `path[0]`, burning units simply for stepping *off* a fire tile onto clean ground.
  2. `applyNapalmEntry` scanned untouched lines in `bestLineFor`.
  3. Burn damage & kill credit were attributed to `currentPlayer` instead of `line.owner`.
  * **Fix:** Sliced `path.slice(1)`, restricted `bestLineFor` to `touchedIndices`, and attributed damage/kills to `line.owner`.
* **Undo Move Wiped All Tactical State ([useGameStore.ts](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/store/useGameStore.ts)):** `pickGameState` omitted all 9 tactical state fields (`tacticalRound`, `freeTacticalRound`, `trapRevealRound`, `radarRound`, `overclockCharges`, `pendingTacticals`, `burningLines`, `smokeZones`, `sensors`).
  * **Fix:** Included all 9 fields in `pickGameState`.
* **Kill Cam Misattributed Tactical Kills ([apply.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/game/apply.ts), [state.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/game/state.ts)):** Tactical strikes emitted `weapon: 'ARTILLERY'` and `cause: 'ARTILLERY'`, displaying `"BASE ARTILLERY / HQ AUTOCANNON"` on JDAM, Carpet Run, Barrage, and Napalm kills.
  * **Fix:** Added `KillCause = 'TACTICAL'` and `WeaponVisual = 'TACTICAL_STRIKE' | 'TACTICAL_CARPET' | 'TACTICAL_BARRAGE' | 'TACTICAL_NAPALM'`.
* **Fog & Sensor Visibility Leaks ([view.ts](file:///Users/vedamsh/Tactical_Tiles/packages/engine/src/game/view.ts), [TableRoom.ts](file:///Users/vedamsh/Tactical_Tiles/apps/server/src/TableRoom.ts)):** Enemy `sensors` were hidden (preventing §8.5a stomp counterplay), `Minefield Snapshot` log entries leaked, `Paradrop:` coordinates leaked in logs under fog, and revealed enemy mines were filtered out by `GameRenderer` (`m.owner === viewer`).
  * **Fix:** Made `sensors` public in `viewFor`, hid Snapshot logs & redacted Paradrop coordinates under fog, added fog-honest seat-aware `eventsFor` filtering for `tacticalFx`, and split `revealedEnemyMines` in `GameRenderer.tsx`.

---

## 4. Remaining Balance, Spec & AI Recommendations (Director Roadmap)

These intentional balance/spec decisions were left untouched in this pass so we wouldn't surprise-alter gameplay tuning without Director sign-off:

### P0 — Spec Compliance Gaps vs `DIRECTOR_PLAN.md` §8
1. **Rule 10 HQ Exclusion:** `tacticalBlocker` currently enforces HQ + 8-neighbor exclusion only on `LANE` (`ARTILLERY_BARRAGE`), leaving `PRECISION_STRIKE` and `CARPET_RUN` able to strike HQ perimeters. Decide whether to extend `hqExclusionTiles` to all telegraphed strikes per §8.3a.
2. **Doomsday `LAVA` Legality:** `rules.ts` checks `tile.hazardState !== 'LAVA'` for `PARADROP` only — consider blocking `RECON_DRONE` and `SMOKE_SCREEN` on active magma tiles.
3. **Non-HQ Building Damage:** `damageTacticalBarrier` in `apply.ts` only damages `BARRIER` tiles, not Watchtowers/Bunkers (which lack `hp` today), even though Precision Strike's blurb states *"Hits units and non-HQ structures."* Either add destructible specialization/HP damage on Watchtowers/Bunkers or clarify copy to *"Hits units and barriers."*
4. **Overlapping Strike Stacking:** `resolveDueTacticals` applies each pending strike independently rather than taking the single highest damage instance per tile per round (§8.2).
5. **Fog-Off Fallbacks:** §8.3 promises Recon Drone reveals mines within 3 tiles and Radar Sweep reveals telegraphs/mines when Fog of War is off. Currently neither weapon has a fog-off fallback (and Tunnels are already public terrain, making Minefield Snapshot's *"and tunnel"* copy slightly misleading).

### P1 — Economy & Cost-Efficiency Balance Critique
| Weapon | Tier / Round | Cost | Footprint / Output | Cost Efficiency Critique | Recommended Tuning |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **Precision Strike** | Rare (R5) | €175 | 1 tile, 8 DMG, 1-turn telegraph | Easy to dodge for 1–2 CP; outclassed at €175 by instant Sabotage (-8 CP or tower strip). | **10–12 DMG** (punishes rooted/fortified perches & breaks Barriers in 1 hit) or drop to **€140**. |
| **Carpet Run** | Epic (R10) | €275 | 3 tiles, 8 DMG, 1-turn telegraph | **€91.7/tile** — heavily dominated at R10+ by Artillery Barrage (**€15/tile** at 2×10) except right next to HQs. | Move to **Rare (R6, €225)** OR buff to **10 DMG + shreds Barriers** so Carpet Run owns *heavy breach* while Barrage owns *lane denial*. |
| **Artillery Barrage** | Epic (R10) | €300 | 10 or 20 tiles, 8 DMG, 1-turn telegraph | **2×10 is strictly superior** to 1×10 unless dodging friendlies or an HQ exclusion zone, for identical €300 cost. | Differentiate width: **1×10 = 9 DMG**, **2×10 = 6 DMG** (concentrated vs suppression) or **€260 (1×10) / €320 (2×10)**. |
| **Overclock Core** | Epic (R10) | €300 | Next 3 attacks refund 2 CP (max +6 CP) | **€50/CP** — weak vs €15/CP overflow rate and €175 Sabotage (-8 CP = €21.9/CP). | Drop to **€220** or raise to **+3 CP × 3 attacks (9 CP)** with temporary cap overflow allowed. |
| **Paradrop** | Rare (R5) | €250 | 1 Scout (costs 1 respawn slot), acts next turn | High €250 + respawn slot cost for a base Scout; players expect choice or impact on landing. | Clarify *"Drop a reserve Scout"* in HUD, and consider granting **Overwatch-ready** or **+2 cover armor on drop turn**. |

### P2 — AI Tactical Intelligence (`packages/engine/src/tactical/ai.ts`)
1. **Cheapest-First Bias:** `chooseTacticalAction` sorts unlocked items ascending by price, so a rich Round 12 AI buys €75 `MINEFIELD_SNAPSHOT` and burns its 1/round cap instead of firing €300 `ARTILLERY_BARRAGE`. Score candidates by expected tactical value and pick the highest-value action.
2. **Friendly-Fire Blindness:** `findLineTarget` counts enemy tiles hit without penalizing friendly units inside Napalm / Carpet Run / Barrage footprints.
3. **First-Match Scan Bias:** Picks the first tile in row-major order rather than maximizing target count/HP value, and never uses `SMOKE_SCREEN` defensively.

---

## 5. Animation, Asset, FX, Audio, & Camera Architecture

### Core Technical Pillars
* **Zero External Fetch Overhead (`@2x` Procedural Assets):** All 9 tactical sprites are baked once into offscreen canvases inside [TacticalAssets.ts](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/core/graphics/TacticalAssets.ts) and preloaded via [TextureManager.ts](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/core/graphics/TextureManager.ts):
  * `TACTICAL_RECON_DRONE` (128×128), `TACTICAL_STRIKE_JET` & `_SHADOW` (192×192), `TACTICAL_HEAVY_BOMBER` & `_SHADOW` (240×240), `TACTICAL_JDAM_MISSILE` (96×96), `TACTICAL_PARADROP_CHUTE` (128×128), `TACTICAL_SMOKE_PUFF` (128×128), `TACTICAL_CRATER_DECAL` (128×128).
* **Two-Plane Persistent Layering ([TacticalBoardLayer.tsx](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/components/game/renderer/TacticalBoardLayer.tsx)):**
  * `TacticalGroundLayer` renders **under units** (Napalm flames, strike telegraphs, Overclock halos, revealed enemy mines).
  * `TacticalAirLayer` renders **above units & targeting reticles** (volumetric 3×3 Smoke clouds, hovering Recon Drones + owner 5-tile sensor diamonds).
* **Synchronized Impact Timeline ([fxTimeline.ts](file:///Users/vedamsh/Tactical_Tiles/apps/web/src/core/graphics/fxTimeline.ts)):**
  * Resolving tacticals pre-register per-tile impact delays (`tacticalImpactByTile`), holding `pendingDeaths` and `deferredHp` until the exact millisecond each JDAM, bomber stick, or creeping artillery shell lands.
  * Transient animations step on `fxTimeline.getLastCombatDtMs()`, so Kill Cam slow-motion and hit-stop dilate aircraft, missiles, chutes, and craters smoothly.
* **Rotation-Safe Verticality:** All vertical descents (`TACTICAL_JDAM_MISSILE`, `TACTICAL_PARADROP_CHUTE`, mortar arcs, smoke rise, barrage shells) project along `screenUpVector(mapRotation)` and counter-rotate sprites by `-mapRotation` so nothing ever drops sideways on 90°/180°/270° rotated boards.
* **ECO Mode (0% GPU Idle) & WCAG 2.3.1 Safety:**
  * `TacticalBoardLayer` renders crisp static compositions immediately in `ECO` and only continuously ticks in `LIVE` mode (when `!prefers-reduced-motion`).
  * All persistent pulse frequencies stay $\le 1.35\text{ rad/s}$ ($\approx 0.2\text{–}1.2\text{ Hz}$), strictly under the WCAG 2.3.1 3-flashes-per-second threshold.
  * Every transient FX increments/decrements `activeVisualCount` symmetrically so `fxTimeline.isActive()` settles back to `false` cleanly for 0% idle GPU.

---

## 6. Weapon-by-Weapon Bible — All 11 Tactical Weapons

### 1. Minefield Snapshot (`MINEFIELD_SNAPSHOT` · Common · €75 · `NONE`)
* **Identity:** `#22D3EE` / `#34D399` · Callsign `SUBSURFACE LIDAR`
* **Board Persistent Visual:** Revealed enemy mines render in `TacticalGroundLayer` with a pulsing cyan-red sonar lock diamond, inner warning X, and counter-rotated `ENEMY MINE` badge.
* **Animation Keyframes (`880 ms`):**
  * `0–880 ms`: Dual expanding subsurface cyan-emerald lidar rings sweeping outward from caster anchor across `0.78 × boardPx`.
  * As the ring radius crosses each revealed enemy mine in `pings`, a sharp diamond reticle flares around the mine + `sonarPing` particle burst (`60 ms`).
* **Foley Audio (`SoundFX.ts`):** Subsurface ground-penetrating low sine sweep (`190 → 62 Hz`), bandpass lidar hum (`520 → 2200 Hz`), and up to 5 staggered metallic contact pings (`1680+ Hz`).
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` pulse (`120 ms`).
* **Fog Honesty:** Completely private to buyer (`eventsFor` strips event for all non-owners).

### 2. Recon Drone (`RECON_DRONE` · Common · €100 · `TILE`)
* **Identity:** `#38BDF8` / `#BAE6FD` · Callsign `OPTICAL RECON UAV`
* **Asset:** `TACTICAL_RECON_DRONE` (128×128 carbon-fiber quad-rotor with optical gimbal lens & wingtip LEDs).
* **Board Persistent Visual:** Hovering UAV in `TacticalAirLayer` with soft altitude drop shadow, gentle vertical bob + yaw in `LIVE`, faction-tinted telemetry ring, owner-only 5-tile Manhattan sensor diamond, and `UAV · NR` / `ENEMY UAV · NR` badge.
* **Animation Keyframes (`780 ms`):**
  * `0–380 ms`: Drone dives vertically down `screenUpVector` (`140 px → 0 px`) as ground shadow sharpens.
  * `260–780 ms`: Expanding 5-tile cyan diamond optical calibration pulse + `sonarPing` lock burst at `340 ms`.
* **Foley Audio:** Quad-rotor turbine buzz descent (`1450 → 820 Hz` + sawtooth rotor hum) + optical gimbal calibration click (`340 ms`).
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` (`280 ms`).
* **Fog Honesty:** Public once placed so enemies can spot and step on it to destroy it.

### 3. Smoke Screen (`SMOKE_SCREEN` · Common · €120 · `ZONE3`)
* **Identity:** `#CBD5E1` / `#94A3B8` · Callsign `THERMAL OBSCURANT`
* **Asset:** `TACTICAL_SMOKE_PUFF` (128×128 6-lobe volumetric cloud sprite).
* **Board Persistent Visual:** Crisp dashed LOS-block perimeter enclosing the 3×3 cloud in `TacticalAirLayer`, subtle translucent slate obscurant bed (units stay clickable), 9 layered drifting `TACTICAL_SMOKE_PUFF` sprites, and `SMOKE · NR` badge.
* **Animation Keyframes (`920 ms`):**
  * `0–370 ms`: 3 white-hot mortar canisters arc in (`0 ms`, `65 ms`, `130 ms`) with smoking trails.
  * `190–920 ms`: Pressurized volumetric puffs expand across all 9 tiles + `smokeBloom` particle bursts (`210 ms`).
* **Foley Audio:** Triple muffled mortar *pop-thump* (`0 / 75 / 150 ms`) + `720 ms` pressurized thermal smoke hiss.
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` (`220 ms`).
* **Fog Honesty:** Public cloud (visible to all seats).

### 4. Radar Sweep (`RADAR_SWEEP` · Rare · €150 · `NONE`)
* **Identity:** `#10B981` / `#6EE7B7` · Callsign `AWACS THEATER SWEEP`
* **Animation Keyframes (`1020 ms`):**
  * `0–1020 ms`: Full-board emerald-cyan AWACS scan bar sweeps across the entire map with a 6-band fading phosphor curtain behind it.
  * As the beam crosses each enemy unit in `pings`, a glowing green targeting reticle & crosshair locks onto the contact + staggered `sonarPing` particles (`220 + i*75 ms`).
* **Foley Audio:** Wide Doppler phased-array sweep (`340 → 2650 Hz`, `850 ms`) + cascading AWACS contact blips.
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` (`140 ms`).
* **Fog Honesty:** Sweep wave is public (table is warned), while `pings` coordinates are stripped for non-owners in `eventsFor`.

### 5. Precision Strike (`PRECISION_STRIKE` · Rare · €175 · `TILE`)
* **Identity:** `#F43F5E` / `#FDA4AF` · Callsign `ORBITAL JDAM STRIKE`
* **Asset:** `TACTICAL_JDAM_MISSILE` (96×96 hypersonic tungsten kinetic dart with crimson guidance band) + `TACTICAL_CRATER_DECAL`.
* **Persistent Telegraph (`MARK`):** Pulsing rose target designator ring, 4 rotating sight ticks, center laser dot, faction indicator, `STRIKE -8` badge.
* **Animation Keyframes:**
  * `MARK` (`420 ms`): Converging crimson laser crosshair lock.
  * `RESOLVE` (`1080 ms`):
    * `0–360 ms`: Vertical crimson orbital designation beam down `screenUpVector` (`520 px`).
    * `110–360 ms`: `TACTICAL_JDAM_MISSILE` plunges straight down with quadratic acceleration + Mach vapor shock rings.
    * `360 ms` (**Synced Impact**): `orbitalBeam` + `explosion` + `concreteDebris` particles, `44 ms` hit-stop, `0.72` camera trauma, vertical plasma column, twin shockwaves, `TACTICAL_CRATER_DECAL`, unit damage/kill release.
* **Foley Audio:** `MARK` = sharp optical double-click + designator lock chirp; `RESOLVE` = descending hypersonic whistle (`2150 → 320 Hz`) → seismic sub-bass warhead blast at `350 ms`.
* **Camera:** **`ORBITAL_DROP`** — tight top-down zoom convergence (`0.032 rad` tilt) + crimson orbital sight rail schematic; escalates to `CINEMATIC` (`PRECISION STRIKE KILL`) on kill.

### 6. Sabotage (`SABOTAGE` · Rare · €175 · `TILE`)
* **Identity:** `#C084FC` / `#38BDF8` · Callsign `CYBER-EMP DISRUPTOR`
* **Animation Keyframes (`760 ms`):**
  * `0–220 ms`: Collapsing violet-cyan EMP containment sphere pulls inward onto the target tile.
  * `190–760 ms`: 6 animated jagged procedural EMP lightning bolts crackle radially outward + `empArc` particle burst (`200 ms`) + `0.32` trauma + `SABOTAGE -8 CP` or `SABOTAGE: STRIPPED` popup.
* **Foley Audio:** High-voltage capacitor discharge sawtooth drop (`920 → 48 Hz`), saturated high-pass electric crackle, and metallic shear (`STRIP`) or comms glitch (`CP`).
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` (`200 ms`).
* **Fog Honesty:** Visible to caster, victim seat, or observers with sight on target tile.

### 7. Napalm Line (`NAPALM_LINE` · Rare · €250 · `LINE4`)
* **Identity:** `#F97316` / `#FDE047` · Callsign `INCENDIARY FLYOVER`
* **Asset:** `TACTICAL_STRIKE_JET` + `TACTICAL_STRIKE_JET_SHADOW` (192×192 swept-wing jet with twin afterburners & underwing canisters).
* **Persistent Board Hazard:** Charred asphalt bed, glowing ember heat pool, 5 layered dancing crimson/orange/gold flame tongues per tile in `TacticalGroundLayer`, ambient rising ember sparks in `LIVE`, and `NAPALM · NR` badge.
* **Animation Keyframes:**
  * `ACTIVATE` (`960 ms`): Strike jet & offset shadow scream along the 4-tile axis (`0–680 ms`), igniting tiles sequentially (`160 / 255 / 350 / 445 ms`) with `napalmFlame` bursts and `0.28` trauma pulses.
  * `BURN` (`520 ms`): Vertical crimson-gold sear flare + `napalmFlame` burst when a unit enters or ends round in fire.
* **Foley Audio:** `ACTIVATE` = low-altitude afterburner jet scream (`1650 → 290 Hz`) + 4 staggered incendiary *whoomph* blasts; `BURN` = flame-sear roar + crackling embers.
* **Camera:** **`BOMBER_TRACK`** tracking dolly riding the strike jet along the 4-tile corridor; escalates to `CINEMATIC` (`NAPALM LINE KILL`) on lethal burn.

### 8. Paradrop (`PARADROP` · Rare · €250 · `TILE`)
* **Identity:** `#34D399` / `#A7F3D0` · Callsign `COMBAT INSERTION`
* **Asset:** `TACTICAL_PARADROP_CHUTE` (128×128 5-cell tactical ram-air canopy with golden insertion chevron).
* **Animation Keyframes (`860 ms`):**
  * `0–640 ms`: Pulsing emerald LZ smoke beacon on target tile while `TACTICAL_PARADROP_CHUTE` + taut shroud lines + trooper silhouette sway gently down `screenUpVector` (`210 px → 0 px`) as ground shadow sharpens.
  * `640 ms`: Crisp touchdown ripple, `dustPuff` + emerald `shockwaveRing`, `0.20` trauma.
* **Foley Audio:** Distant turboprop rumble (`420 → 180 Hz`) → nylon canopy snap-open (`160 ms`) → heavy touchdown thud (`620 ms`) + VHF radio confirm (`680 ms`).
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` (`640 ms`).
* **Fog Honesty:** Obeys fog visibility on target tile; log coordinates redacted for opponents under fog.

### 9. Carpet Run (`CARPET_RUN` · Epic · €275 · `CARPET`)
* **Identity:** `#FB923C` / `#EF4444` · Callsign `HEAVY BOMBER STICK`
* **Asset:** `TACTICAL_HEAVY_BOMBER` + `TACTICAL_HEAVY_BOMBER_SHADOW` (240×240 stealth flying-wing bomber with 4 recessed heat plumes & glowing bomb bay) + `TACTICAL_CRATER_DECAL`.
* **Persistent Telegraph (`MARK`):** Linked 3-tile amber-crimson saturation corridor with bold perimeter, dashed inner line, marching directional chevrons along `axis`, and `CARPET -8` badge.
* **Animation Keyframes:**
  * `MARK` (`480 ms`): Rapid 3-tile sequential corridor lock-on sweep (`0 / 70 / 140 ms`).
  * `RESOLVE` (`1140 ms`):
    * `0–780 ms`: Heavy stealth bomber + shadow cruise smoothly along `axis`.
    * Falling bomb silhouettes drop (`140 ms` fall) onto tiles 0, 1, 2, detonating at **`200 ms`, `335 ms`, `470 ms`** with `explosion` + `shockwaveRing` + `concreteDebris`, `0.54` trauma each, and `TACTICAL_CRATER_DECAL` craters. Unit hits/kills synchronize to their exact tile index!
* **Foley Audio:** `MARK` = 3 ascending air-support coordinate clicks; `RESOLVE` = deep stealth bomber rumble + 3 staggered heavy HE tank-blast detonations (`200 / 335 / 470 ms`).
* **Camera:** **`BOMBER_TRACK`** — tracking dolly panning from entry tile to exit tile (`0.022 rad` bank) + corridor rail blueprint schematic; escalates to `CINEMATIC` (`CARPET RUN KILL`) on kill.

### 10. Artillery Barrage (`ARTILLERY_BARRAGE` · Epic · €300 · `LANE` 1×10 or 2×10)
* **Identity:** `#EF4444` / `#F59E0B` · Callsign `CREEPING BARRAGE`
* **Asset:** Steep-angle glowing 155mm shells + `TACTICAL_CRATER_DECAL`.
* **Persistent Telegraph (`MARK`):** Full 1×10 or 2×10 kill-box corridor with marching wave glow, per-tile hazard corner ticks, creeping directional chevrons, and `BARRAGE 1×10` / `2×10` badge.
* **Animation Keyframes:**
  * `MARK` (`560 ms`): Fast cascading 10-step kill-box lock-on ripple (`35 ms/step`).
  * `RESOLVE` (`180 + steps*75 + 560 ms` ≈ `1490 ms`):
    * Creeping walking shell wall advances step `0..9` (`75 ms/step`; width-2 alternates side shell `+28 ms`).
    * Each tile receives a `150 ms` plunging incandescent shell streak down `screenUpVector` → `explosion` + `shockwaveRing` + `0.42` trauma + `TACTICAL_CRATER_DECAL`. Every unit/barrier hit or kill synchronizes to its exact step millisecond!
* **Foley Audio:** `MARK` = 4 ascending fire-direction plot clicks; `RESOLVE` = distant battery salvo punch + rolling creeping thunder (`10` staggered saturated explosions down the lane).
* **Camera:** **`BARRAGE_WALK`** — creeping corridor dolly walking smoothly down the 10-tile lane (`0.018 rad` tilt) + sector-tick blueprint rails; escalates to `CINEMATIC` (`ARTILLERY BARRAGE KILL`) on kill.

### 11. Overclock Core (`OVERCLOCK_CORE` · Epic · €300 · `NONE`)
* **Identity:** `#FACC15` / `#38BDF8` · Callsign `REACTOR OVERCHARGE`
* **Board Persistent Visual:** Electric-gold rotating hexagonal charge halo + cyan inner ring under every ready visible unit belonging to the overclocked seat, plus HUD `⚡ OVERCLOCK N/3` chip in `TacticalShop` and `+2 CP ⚡` popups on each refunded attack.
* **Animation Keyframes (`840 ms`):**
  * `0–840 ms`: Golden-cyan reactor shockwave radiates from caster HQ/origin while animated crackling energy tethers arc directly to every friendly unit in `pings` + `overclockSurge` particle bursts (`80 ms`).
* **Foley Audio:** Rising harmonic reactor spool-up (`140 → 560 Hz` triangle + `600 → 3400 Hz` bandpass whine) + crisp high-voltage lock-in snap (`380 ms`).
* **Camera:** Non-blocking `ATTACK` tier · `THEATER_SWEEP` (`140 ms`).
* **Fog Honesty:** Under fog, opponent only sees ally tether pings on tiles within their own sight.

---

## 7. Standard Unit, Structure, & Trap Attack Upgrades

All existing weapons were audited alongside tactical weapons and upgraded for stronger silhouette contrast and tactile punch:

| Weapon / Cause | Visual Animation (`ProjectileRenderer.tsx` / Layers) | Particle & Impact Spec (`fxTimeline.ts` / `ParticlePool.ts`) | Audio Foley (`SoundFX.ts`) | Camera Profile (`killCam.ts`) |
| :--- | :--- | :--- | :--- | :--- |
| **Scout Carbine (`SOLDIER`)** | **Upgraded:** 3-round staggered high-velocity tactical carbine burst (`0 / 24 / 48 ms`) with micro-spread. | Muzzle flash + **new `brassCasing`** glinting shell ejection arc + ricochet `impactSparks` + `3.8 px` recoil. | Dry 9mm supersonic snap + slide cycle clack. | `STANDARD` (`MICRO` / `ATTACK` / `GRAZE_FAKEOUT`). |
| **Breacher Siege Gun (`ASSAULTER`)** | Armored missile fuselage + stabilizer fins + flickering rocket flame + low parabolic arc shadow + smoke ribbon. | Heavy `1.55×` muzzle flash + **new twin breech backblast `dustPuff`** + full `explosion` + `shockwaveRing` + `1350 ms` crater `scorch` + `34 ms` hit-stop. | Tank cannon chest boom + steel breech clank + rocket whoosh + HE blast impact. | **`BREACHER_ARC`** (follows shell arc) + `CROSSFIRE_TRIANGLE`. |
| **Rail Sniper (`SNIPER`)** | Crimson-white rail beam + **new 3 ionized rail acceleration rings** + **muzzle optic glint** + over-penetration exit streak. | Sharp recoil (`7 px`) + rose `impactSparks` + `shockwaveRing` + `42 ms` lethal hit-stop. | High-energy rail crack + mechanical bolt-action cycle (`+200 / +260 ms`). | **`SNIPER_WHIP`** (holds high-ground perch `28%`, whip-pans down beam). |
| **Bank Security Turret (`TURRET`)** | Twin-rail white-gold security pulse + **new ionized gold capacitor muzzle flare ring**. | Turret origin flash + `impactSparks` + sequenced strictly before HQ sweeps. | Twin high-energy security servo lock & pulse. | `CINEMATIC` (`BANK TURRET KILL`). |
| **Base HQ Autocannon (`ARTILLERY`)** | Rotating twin-barrel turret pre-slews (`115 ms`) then fires alternating 6-round (single) or 4-round (multi-target) incandescent `.50 cal` tracer streams. | Alternating left/right barrel muzzle flashes + **new `brassCasing`** ejection + staggered impact sparks. | Hydraulic servo swivel + saturated `.50 cal` burst + concrete brass clinks. | `CINEMATIC` (`BASE ARTILLERY KILL`). |
| **Demolition / Siege (`SIEGE`)** | High screen-upright parabolic arc + **new tangent-oriented finned mortar warhead silhouette** + altitude ground shadow. | `explosion` + **new `concreteDebris`** tumbling masonry chunks & mortar dust + secondary explosions on HQ breach. | Heavy cannon boom + HE blast + gravel/debris shower. | **`STRUCTURE_BLOWOUT`** (spinning vault tumbler or HQ breach grid). |
| **Land Mine (`MINE`)** | Single-pulse crimson `mineFlash` (`360 ms`, WCAG safe) + `1750 ms` charred crater `scorch`. | `explosion` + `1.5× shockwaveRing` + `45 ms` kill hit-stop. | `150 ms` mechanical `*click*` detent (`ARM`) → heavy detonation + debris. | **`MINE_CLICK`** (`150 ms` `ARM` pressure-plate freeze + blinking LED). |
| **Overwatch Ambush (`OVERWATCH`)** | Mid-march movement pause (`overwatchPauseMs`) aligned to shot arrival + `PINNED!` / `SUPPRESSED!` popups. | Weapon-matched fire/impact + `overwatchRing` on arming. | Comms-static glitch snap (`playOverwatchStatic`) + weapon Foley. | **`OVERWATCH_SNAP`** (snaps to hidden shooter `0..32%`, zips to runner). |

---

---

## 9. Tactical Weapons V2 Overhaul (Shipped)

Following live playtest review and Game Director sign-off, a full V2 gameplay, animation, and cinematography pass shipped on top of the initial audit:

### Gameplay & Balance Rules V2
1. **Instant Resolution (Zero 1-Turn Waiting Telegraphs):** Every tactical weapon resolves immediately on cast so enemy units cannot simply step out of the zone for 1 CP.
2. **3-Round Per-Weapon Cooldown (`TACTICAL_COOLDOWN_ROUNDS = 3`):** Firing a tactical weapon in round `R` locks that specific weapon until round `R + 3` (`tacticalCooldowns[seat][itemKey] = R + 3`), displayed as crisp `CD 3R` / `CD 2R` / `CD 1R` badges in `TacticalShop.tsx` alongside the existing 1-tactical-per-round cap.
3. **Unit-Targeted Strikes & Multi-Target Carpet Run:**
   * **`PRECISION_STRIKE` (€175, Rare, `UNIT`):** Locks 1 visible enemy unit directly for **instant 8 DMG** orbital JDAM impact (`420 ms` dive).
   * **`CARPET_RUN` (€275, Epic, `UNITS3`):** Locks **1 to 3 distinct visible enemy units** anywhere on the map (with `FIRE SALVO (N/3)` early fire or auto-fire on 3rd pick) for **instant 6 DMG** curved homing cruise warheads (`280 / 480 / 680 ms`).
   * **`RECON_DRONE` → "Hunter Drone" (€100, Common, `UNIT`):** Instant **3 DMG** swooping attack UAV (`280 ms` 3-round burst); in **Fog of War** mode, also leaves a 3-round Recon Sensor at the target tile.
4. **`ARTILLERY_BARRAGE` (€300, Epic, Always `2×10`):** Removed the obsolete `1×10` width toggle; Barrage is always a **2×10 (20-tile)** corridor dealing **instant 8 DMG** to units and barriers (friendly fire ON, HQ + 8-neighbor exclusion enforced).
5. **`NAPALM_LINE` (€250, Rare, `LINE4`, Friendly Fire ON):** Deals **instant 6 DMG** on drop as the strike jet sweeps over each tile (`220 + i*110 ms`) + tiles burn for **2 rounds** dealing **6 DMG** on entry/pass-through or round end (capped at **12 DMG** per unit per line).
6. **`PARADROP` 7B — Tactical Airlift (€250, Rare, `RELOCATE`):** Instant 2-step relocation (no respawn slot consumed): Step 1 selects **any visible alive unit** (yours or an enemy); Step 2 selects open unoccupied ground (`canHoldParadrop`). Clears `isRooted` & `isOverwatching`; marks own unit `hasMoved: true`. **Anti-cheese guardrails when airlifting an enemy unit:** blocked from dropping onto **Lava**, active **Napalm**, **Land Mines**, or within **caster's HQ autocannon range (`BASE_STATS.RANGE = 4`)**.
7. **`RADAR_SWEEP` (€150, Rare, `fogOnly: true`):** Automatically hidden in the shop and rejected by engine rules whenever `settings.fogOfWar` is OFF. **`MINEFIELD_SNAPSHOT` (€75, Common)** retained intact as a high-skill private enemy mine reveal.

### Full-Map Edge-to-Edge Flights, Non-Blocking Ambient Exit Tails, & 3.5–4.0s Cameras
* **New Procedural `@2x` Assets (`TacticalAssets.ts`):** Added `TACTICAL_CARGO_PLANE` / `_SHADOW` (240×240 quad-turboprop C-130 airlifter with spinning prop discs & emerald cargo ramp glow) and `TACTICAL_CRUISE_BOMB` (64×64 guided glide warhead with booster plume).
* **Full-Map Edge-to-Edge Flights + Lively Exit Cruise (`TacticalFxLayer.tsx`, `useEffectStore.ts`):** `fullMapFlightLine()` projects every aircraft (`TACTICAL_STRIKE_JET`, `TACTICAL_HEAVY_BOMBER`, `TACTICAL_CARGO_PLANE`, `TACTICAL_RECON_DRONE`) from beyond one edge of the entire 20×20 board to past the opposite horizon with dual wingtip contrails. Once the strike/camera cut completes (`durationMs`), `fxTimeline` hands off `ambientTailMs` (`1.8–3.6 s`) via `completeTacticalCombat` so `fxTimeline.isActive()` settles immediately — unlocking gameplay clicks, turns, and the compact Dev Dock while planes keep cruising lazily off the far horizon at 60 FPS!
* **3.5–4.0s Cinematic Tactical Cameras (`killCam.ts`, `KillCamSchematicLayer.tsx`, `KillCamOverlay.tsx`):** Added `TACTICAL_MAJOR_TIMING` so `ORBITAL_DROP`, `BOMBER_TRACK`, and `BARRAGE_WALK` run **~3.5–3.6 s** for non-lethal strikes (with `0.85` cinematic letterbox & Space/Esc skip) and **~3.75–3.95 s** for lethal tactical Kill Cams in `FULL` mode (while `SHORT` stays ~1.3–1.9 s and `OFF`/`prefers-reduced-motion` stay instant), complete with multi-target `waypoints` camera panning across Carpet Run targets and Paradrop pickup-to-LZ corridors.
* **Compact Auto-Hiding Dev Sandbox (`DevOverlay.tsx`, `devOverlay.css`):** Replaced the oversized multi-panel sandbox HUD with a single-row ~85px bottom dock (`z-index: 42 < KillCam 44`) featuring an `AUTO-HIDE` toggle that collapses cleanly during FX/Kill Cams and folds to a 28px bar while painting.

---

## 8. Dev Sandbox Verification Coverage

Every single weapon and camera cut is live-auditionable via the **Dev Sandbox (`DevOverlay.tsx`)** under the **`TACTICALS`** group (`devEventMatrix.ts`):
* **Causes Covered:** `8 / 8` (`COMBAT`, `OVERWATCH`, `MINE`, `TURRET`, `ARTILLERY`, `LAVA`, `BASE_FALL`, **`TACTICAL`**)
* **Tiers Covered:** `4 / 4` (`ATTACK`, `MICRO`, `CINEMATIC`, `STRUCTURE`)
* **Camera Styles Covered:** `12 / 12` (all 8 original profiles + **`ORBITAL_DROP`**, **`BOMBER_TRACK`**, **`BARRAGE_WALK`**, **`THEATER_SWEEP`**)
* **All 11 Tactical Weapons:** Dedicated audition buttons (`SNAPSHOT`, `HUNTER UAV`, `SMOKE 3×3`, `RADAR SWEEP`, `SABOTAGE EMP`, `AIRLIFT DROP`, `OVERCLOCK`, `NAPALM JET`, `PRECISION KILL`, `CARPET ×3 KILL`, `BARRAGE KILL`) driving the real `fxTimeline` → `TacticalFxLayer` → `ParticlePool` → `SoundFX` → `KillCamDirector` pipeline.
