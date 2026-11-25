# Tactical Tiles — Game Review, Simulation Findings & Development Roadmap

## Verdict: Is It Interesting, Fun, and Addictive?

- **Interesting? Yes — genuinely clever core design.**
  Having an entire squad share **one Command Point battery (`20` max, `+10`/turn, `15` for P1 on Round 1)** turns every movement, attack, heist, and reload into an interconnected macro puzzle. Locking Snipers to **Mountains, Dunes, or owned Buildings** and shifting **Voronoi weather zones** every 5 turns keeps the battlefield dynamic.
- **Fun? Yes — especially in 1v1 PvE and local PvP.**
  Pulling off a `BANK` heist inside turret range (`2` tiles, `4 DMG`), bridging rivers mid-match, trapping units in `QUICKSAND`, or racing Doomsday lava creates real tactical tension.
- **Addictive? Engaging in bursts, needing 3 retention pillars to reach "one more turn" compulsion:**
  1. **Unit Veterancy & Promotions** (mid-match unit growth & emotional survival stakes)
  2. **Overwatch / Reaction Fire** (enemy-turn tension & tactical mind games)
  3. **Post-Match Grades, Deterministic Seeds & Challenge Ops** ("one more try" replay hooks)

---

## Audited Future Development Plan (Systems & Game-Theory Verified)

### Milestone 1: Unit Veterancy, Deterministic Seeds & After-Action Career Loop *(Implementing Now)*
1. **Role-Based Unit Veterancy (`★` / `★★` / `★★★`):**
   - **Loophole-Free XP Sources:**
     - `+2 XP` per kill (`+3 XP` when slaying Rank `2+` Elite/Ace)
     - `+1 XP` for damaging a live enemy unit (non-lethal attack)
     - `+2 XP` per Bank Heist (`HEIST`) or Base Destruction (`SIEGE` kill)
     - `+1 XP` per first-time Building capture by that player (`capturedByOwners` tracked per tile so flipping buildings back and forth yields `0` repeat XP)
     - **`0 XP`** for hitting Barriers (`DEMOLISH`) or poking Bases without destroying them
   - **Breakpoint-Verified Promotion Ranks (Reset to Rank `0` on death/respawn):**
     - **Rank 1 — Veteran (`2 XP`, `★`):** `+20%` base `maxHp` (Scout `+3 → 18`, Breacher `+6 → 36`, Sniper `+2 → 12`) + immediate heal for that delta, plus `+maxAmmo` (`+2` Scout/Breacher, `+1` Sniper). Clears key survival thresholds (Sniper survives `10 DMG` Breacher shot; Breacher survives `20 + 12` Sniper combo).
     - **Rank 2 — Elite (`5 XP`, `★★`):**
       - *Scout:* `+1` Vision (`4 → 5`) and ignores `SCORCHED`/`MONSOON` Plains movement penalties.
       - *Breacher:* `-2` flat incoming damage when defending on cover (`TERRAIN_DEFENSE > 0` or owned `BUNKER`, min `1` DMG); later gains Overwatch pin-immunity in Milestone 2.
       - *Sniper:* Attack CP cost reduced `8 → 7 CP` and `+2` Base DMG (`20 → 22`, clearing `Math.floor` rounding against `FOREST` `13` and `BUNKER` `11`).
     - **Rank 3 — Ace (`9 XP`, `★★★`):** Second `+20%` base `maxHp` + immediate heal, plus class capstones without printing infinite CP:
       - *Scout Ace:* `+2` Base DMG (`5 → 7`) and Attack CP cost `3 → 2 CP`.
       - *Breacher Ace:* `+2` Base DMG (`10 → 12`) and Siege Piercing (ignores `20%` Base Armor on `SIEGE`).
       - *Sniper Ace:* `MOUNTAIN` and `DUNES` movement cost reduced to `1 CP/tile`.
       - **Ace Bounty:** Slaying a Rank `3` Ace pays **`+$75 Gold`** to the killer's owner.
2. **Deterministic 6-Character Sector Seeds & Deterministic Presets:**
   - Replace `Math.random()` inside map generation (`generateDynamicMap`) and `PRESET_MAPS` (`'DUSTBOWL'`, `'RIVERDELTA'`) with a Mulberry32 PRNG so every seed and preset builds the exact same map reliably.
   - Keep map generation RNG isolated from runtime Drop Pod/AI randomness, with a separate deterministic weather seed (`seed + '_weather'`) so **"Retry This Seed"** replays the exact battlefield.
3. **After-Action Scorecard, Grades (`S–D`) & Local Career Record:**
   - Victory/Defeat overlay displays Efficiency Grade (`S` through `D` anchored on Round Par + Squad Preservation, capped at `A` on `EASY` so farming can't cheese `S`), MVP Unit spotlight, Combat/Economy breakdown, Sector Seed copy/retry (`RETRY THIS SEED`), and persistent `localStorage` Commander Career stats (Wins, Win Streak, Best Grade, Fastest Win, Aces Promoted).

### Milestone 2: Enemy-Turn Tension (Overwatch & Fog Ambush)
- **CP-Balanced Overwatch Stance (Damage/CP ≤ Active Shot + 50% Unfired Refund):**
  - Scout `3 CP` stance → `4 DMG` (`1 CP` unused refund); Breacher `4 CP` → `7 DMG` (`2 CP` refund); Sniper `6 CP` → `14 DMG` (`3 CP` refund).
  - Unfired Overwatch refunds 50% CP (clamped to `MAX_CP = 20`) at the start of the unit's next turn so zone denial doesn't fatally punish a turn when the enemy stays back.
- **Step-by-Step `getMovePath` Interception & Safety Rules:**
  - Triggers along `getMovePath` on the first tile entering an Overwatcher's `effectiveRange`, `hasLineOfSight`, and (when `fogOfWar` is ON) friendly `calculateVisibility`.
  - Max `1` Overwatch trigger per `MOVE` action; deducts only the CP actually walked up to the halt tile; never pins onto a pass-through tile occupied by a friendly unit (steps back to last free tile); Elite Breachers (`★★`) resist pinning and finish their move.
  - **Suppression Counterplay:** Taking *any* damage immediately cancels `isOverwatching` (`SUPPRESSED!`), and `FOG`/`SANDSTORM`/`BARRIER` block Overwatch lines.

### Milestone 3: Curated "Tactical Ops" Challenges & Setup Mutators
- **Mission Engine Extension (`missionConfig`):** Support custom victory/loss triggers (`turnLimit`, `surviveTurns`, `requiredHeists`, pre-placed squads, starting round for Doomsday Blitz).
- **5 Asymmetric Challenge Operations (`CHALLENGES` tab on `GameSetup`):** *Iron Bridge Holdout*, *Vault Zero Fog Heist*, *Red Dunes Duel*, *Doomsday Meltdown*, and *Ace Hunt* with tracked `S/A/B` medals.
- **Setup Mutators:** Optional `Classic CP` (`+10` regen / `20` max), `Scarcity` (`50%` ammo / `+50%` Bank Gold), and `Ironman` (`0` graveyard respawns).
- **Gold Economy Presets:** `Lean` (€150 start / +€15 per turn), `Standard` (€200 / +€20, default), and `Fast Start` (€300 / +€15).

---

## Simulation Benchmarks Baseline (Current Engine — 160 Matches)

| Scenario | Win Split | Avg Rounds | Timeout % | Unreachable / Invariants |
| :--- | :--- | :---: | :---: | :---: |
| **Random Conquer (`HARD` vs `HARD`, 40 matches)** | `P1: 19, P2: 16, TO: 5` | `43.4` | `12.5%` | `0` / `0` |
| **Random Conquer + Fog (`HARD` vs `HARD`, 30 matches)** | `P1: 13, P2: 15, TO: 2` | `37.0` | `6.7%` | `0` / `0` |
| **Deathmatch + Doomsday (`HARD` vs `HARD`, 30 matches)** | `P1: 17, P2: 13` | `30.0` | `0%` | `0` / `0` |
| **Preset Dust Bowl (`HARD` vs `HARD`, 15 matches)** | `P1: 10, P2: 3, TO: 2` | `49.4` | `13.3%` | `0` / `0` |
| **Preset Delta 4P (`HARD` FFA, 15 matches)** | `P1: 1, P2: 3, P3: 4, P4: 7` | `51.3` | `0%` | `0` / `0` |
| **`EASY` (P1) vs `HARD` (P2) (15 matches)** | `HARD: 13, EASY: 0, TO: 2` | `38.2` | `13.3%` | `0` / `0` |
| **`HARD` (P1) vs `EASY` (P2) (15 matches)** | `HARD: 8, EASY: 0, TO: 7` | `55.3` | `46.7%` | `0` / `0` |
