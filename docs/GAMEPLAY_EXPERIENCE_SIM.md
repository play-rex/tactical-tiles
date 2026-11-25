# Tactical Tiles — Gameplay Experience Simulation (Playtest Lab v1)
*Canonical run: **24 Nov 2026 23:02 UTC** · 67 cells / 1,020 matches · source file `sim-results/playtest.json`*

This audit starts from a different question than the earlier ones. `GAME_EVALUATION.md`, `CP_SIMULATION_AUDIT.md`
and `PRODUCT_STRATEGY.md` asked *"who wins and how long does it take?"*. That is balance. It is not what a
player feels. A player never experiences a match — they experience a sequence of turns, most of which they
spend waiting for someone else or looking for something worth doing.

So the instrument here measures the **seat-turn**: what you could do, whether it mattered, how long you waited,
and whether the match built to a climax. Then it runs that instrument across every configuration the game ships:
2–6 players, three CP economies, eight map presets, both victory modes, all three mutators, squad decks, fog,
three bot difficulties, plus a one-change-at-a-time rule lab.

### How to read these tables

- **Every table in §2–§4 comes from one run**, the canonical `sim-results/playtest.json` named above. The JSON
  holds all 67 cell summaries, so any row can be diffed against the file.
- **Each table is followed by its run-to-run spread**, measured against the immediately previous full run
  (archived as `sim-results/playtest-prev.json`, 64 comparable cells, same code and seeds). It is the
  median and worst-case absolute change per cell for that table's cells.
- **Why the spread exists:** AI tie-breaks, base artillery and supply drops call `Math.random`
  (`CP_SIMULATION_AUDIT.md` §9), so runs are not bit-identical. The game is stable where it matters and noisy
  where it is broken: the 2P/3P core moves **±1 round and ±1 pp dead turns**, while FFA cells swing up to
  **32 rounds, 26 pp dead turns and 25 pp stall rate** — one extra freeze flips a cell's median.
- Anything quoted as a *range* (for example "67–75%") is the two-run range, and is the honest way to read a
  volatile cell. Single-run point estimates for FFA are not precise to the percentage point.
- The paired CP table in §2.1 is a **separate invocation** (`bun sim-paired-cp.ts`, output kept in
  `sim-results/paired.txt`) and is labelled as such.

---

## P0 remediation — fixed and re-measured (24 Nov, `sim-results/playtest-p0.json`)

Everything in §2–§4 below is the **pre-fix baseline** and is kept for comparison. Five code changes
were made against the §6 P0 list, then the whole 67-cell matrix was re-run to a separate file:

1. **FFA seating.** `devBaseSlots` now seats 3P/5P/6P on an inscribed ring instead of corners + edge
   midpoints (2P/4P keep the corner square their tuning depends on). The rotation is chosen for
   maximum closest-pair distance, ties broken by equal Voronoi area, and the positions are rotated per
   seed so one index does not sit on the same river mouth every match.
2. **One vault per seat.** `generateConfiguredMap` uses `max(knobs.banks, players)` as the board total,
   so the round-robin sector fill can no longer run out before every zone has one.
3. **Stalls.** Two layers: an *aggression clock* (after round 20, 10 rounds with no HQ damage bans
   Overwatch and makes every unit hunt the objective) and an *80-round backstop* that awards the match
   to the strongest fortress instead of letting it run to the action cap.
4. **Fog closure** follows from (3) rather than from its own change.
5. **Rivers stay whole.** Ring seating put seats on the mid-board line where channels run, and the
   generator carved a 5×5 HQ plaza out of every channel, so a river crossing a seat arrived as two
   stubs that stopped in open ground. Channels are now carved straight through (corner seating still
   carves around, 2P/4P untouched) and the seat slides to a dry 5×5 plaza afterwards — first by
   rotating the whole ring, then by the smallest move that keeps ≥10 tiles to every other HQ.

| Cell | rounds | dead% | stall% | heists | 2+ options% |
|---|---:|---:|---:|---:|---:|
| 2P CP20 | 35 → 32 | 43 → 42 | 0 → 0 | 1.3 → 1.3 | 45 → 47 |
| 2P CP30 | 22 → 23 | 30 → 29 | 0 → 0 | 1.3 → 1.2 | 51 → 53 |
| 3P CP30 | 19 → 13 | 26 → 14 | 0 → 0 | 0.3 → 1.3 | 60 → 75 |
| 4P CP20 | 48 → 40 | 48 → 45 | **19 → 0** | 0.4 → 1.7 | 36 → 35 |
| 4P CP30 | 22 → 28 | 35 → 33 | 0 → 0 | 0.4 → 0.9 | 48 → 45 |
| 5P CP20 | 52 → 31 | 50 → 31 | **19 → 0** | 0.7 → 2.6 | 33 → 54 |
| 5P CP30 | 26 → 22 | 30 → 20 | 0 → 0 | 0.6 → 2.4 | 50 → 66 |
| 6P CP20 | 62 → 39 | 57 → 31 | **19 → 0** | 0.4 → 3.0 | 27 → 52 |
| 6P CP30 | 35 → 24 | 31 → 22 | 0 → 0 | 0.2 → 2.8 | 48 → 63 |

### Acceptance against the §6 gates

| Gate | Target | Result |
|---|---|---|
| Stalls, every cell | < 1% | **0 of 67 cells** ✅ |
| Fog-on stall vs fog-off, same map family | within 5 pp | **0% vs 0%** (classic and preset) ✅ |
| Vault in every zone | ≥ 1 | **min 1/zone** over 30 seeds × 4 presets × 3–6P ✅ |
| Heists per match, 3–6P | ≥ 0.8 | 0.17–3.25; **4P fortress 0.17, 4P badlands 0.42** ⚠️ |
| Seat win spread, 3–6P | ≤ 10 pp | 4P **5**, 6P **9**, 3P **11**, 5P **17–19** (1,000 matches) ❌ |
| Nearest enemy, 5P/6P | ±15% | 5P 12, 6P 13 ✅ (was 10–20 at 5P) |
| River continuity, banded seeds | 1 channel per board | **1 piece on 144/144 boards** (3/5/6P × 3 presets × 16 seeds); 0 bases on water ✅ |
| Zone area, geometric | ±15% | 3P 9%, 5P/6P 4–7% ✅ (land area still varies with rivers) |

Sample: seat spreads are 150 decided matches per seat count (three fog/CP cells × 50).

### Seat assignment (why 3P read 19 pp, and what it was)

The 19 pp 3P spread in the first post-river run was **not noise and not mainly turn order**. It was a
bug introduced with the river fix, and finding it took three probes on the same cell:

1. **Not noise.** 1,000 matches over 200 maps (5 each) reproduced a **46–50%** win share for one seat
   (fair = 33%). That is ~5σ; the original 150-match sample was not misread.
2. **Not turn order.** Rotating who acts first per match moved it only **31 → 21 pp** (600 matches),
   while swapping seat labels 1↔2 on the same maps flipped the winner's *base* (16/12/22 ↔ 15/21/14).
   The advantage travels with the base, so it is a seat→base assignment problem.
3. **The assignment was pinned.** `paintChannel`-era code rotated the slot positions by a seeded
   `seatShift` *and* the owners by the same value, so the two cancelled: seat 0 sat on the same ring
   slot in **354 of 360** maps, and the relocated edge bases (which win 80–100% of their matches) were
   always the last slot, i.e. always the same seat.

Rotating the owners onto finished positions is the right shape, but two further attempts stayed
skewed: a seeded-stream shuffle from `<seed>_seats` (still correlated with the map RNG — 14,14 owned
62/322/343) and an FNV+xorshift shuffle (the permutation itself was biased, 83–249 of 167 expected per
map). The shipped version rotates by the seed's trailing base-36 digits, which is exactly uniform for
3- and 6-seat rings and leaves a 1/1296 residue at 5 seats, and is independent of how the terrain RNG
consumes the seed.

Result on the report's sample: **3P 19 → 11 pp** (27/35/38), 4P 5 pp, 6P 9 pp, 5P 15 pp. On a
1,000-match 3P probe the same build is **7 pp at CP20**, 16 pp at CP30, 13 pp with fog — the residual
tracks the cell, and part of it is structural: seat 0 draws `P1_ROUND1_CP` (15 vs 20 CP) for moving
first.

**5P was re-probed at 1,000 matches (200 maps × 5) and the 15 pp is real, not a lucky sample:**

| 5P cell | seat shares | spread | map-level 95% CI | simulated 150-match samples |
|---|---|---:|---|---|
| CP20 | 30.7 / 18.7 / 13.5 / 21.8 / 15.3 | **17.2 pp** | 12.2–23.0 | median 8 pp, p95 14 pp |
| CP30 | 22.6 / 19.1 / 11.9 / 31.1 / 15.3 | **19.2 pp** | 13.5–25.8 | median 8 pp, p95 14 pp |

Sampling 150 matches (one per map) from this same pool gives a median 8 pp spread and only a **2.5%**
chance of seeing 15 pp or more, so the report's 150-match number was in the tail — but the underlying
5P spread really is 17–19 pp. The shape is a **seat-3 deficit** (11.9–13.5% vs 20%), which is ~6σ at
n=1,000 and which the uniform ring rotation does not explain, so 5P needs its own seat-to-base
diagnosis before it can pass the gate. Per-map dominance is high: on 88/200 (CP20) and 94/200 (CP30)
maps one seat won at least four of five matches, i.e. per-map base advantage is a real force and the
pooled number depends heavily on how many distinct maps the sample covers.

**What did not get fixed: turn order (still a secondary factor).** Rotating who acts first is worth
roughly half of the old 3P gap: 31 → 21 pp on 600 matches, and an earlier 60-match 4P probe flattened
seat wins to **15/12/17/16** versus 17/22/21/**39** with seat 0 always starting. It is not the whole
gap — seat→base assignment was (see above) — but the last seat still sees every other player's move
before committing, and seat 0 still draws less opening CP. Fixing that is a turn-order rule (rotate the
first player per match, or per round), which touches protocol, UI and tests and is a design decision
rather than a defect patch.

### River continuity (added with change 5)

Old behaviour, 10 balanced boards per count: a river that crossed any ring seat was cut into **2.0
pieces at 3P, 1.9 at 5P, 1.6 at 6P** (bridges counted as channel, pieces ≥3 tiles). After the fix, the
same boards are **1.0 pieces at every count** — one channel edge to edge — with **no base standing on
water** and nearest-HQ spacing unchanged at **12–13 tiles** (3P 13, 5P 12, 6P 13 on the audit's 24-board
sample). 2P/4P maps are byte-identical to before: their corner seating never had a channel through it.

Seat ownership is deliberately not part of the terrain choice. The ring position is picked for dry
ground, then seats are assigned to those positions by the same per-seed rotation as before; picking the
seat index together with the position pinned one index to the same good ground and pushed 3P spread to
33 pp. Start units are spawned from `baseLocations.owner`, and HQ tiles are stamped from that same
owner, so a permuted seat order still spawns every army at its own base (checked on 120 maps).

One tuning question the fix opened: 3P CP30 now ends in 13 rounds with 12% dead turns and 80% of turns
offering two real options — faster and busier than 2P. Worth a look before shipping 3P as the default
party size.

### Bridge landings (25 Nov)

Play report: buildings were spawning on the tile a squad steps onto after a bridge, so the crossing led
into a wall. Measured on 480 boards (classic/balanced/lush_valley/twin_fronts × 2–6P, 24 seeds each):
**84 boards (17.5%) had at least one bridge whose landing was blocked** — on the configured presets
alone the first 180-board sample read 63/180 (35%). Two causes, both real:

1. Buildings were only kept off tiles orthogonally *touching* a deck. The landing lane — the shore plus
the tile straight beyond it along the deck axis — was unguarded, so a watchtower or bunker could sit
one step past the bridge head. At the time of the first measurement 36 decks in the 180-board preset
sample had a building on that lane, and once classic was included 38 more did (20 of those at classic
5P alone); 0 had one on the shore itself.
2. The classic generator placed its watchtowers/bunkers after bridges with **no** bridge proximity
check at all (only the contested centre outposts used one), which is why classic was worse than the
presets.

Fix, both generators (`mapPresets.ts` for configured presets, `setup.ts` for classic): no building or
peak may occupy a landing lane, and a final sweep after the last bridge pass reopens any lane — or,
when a shore's only exit is the deck itself, clears the building/peak pinning it shut.

After: **0 lane-blocked decks and 0 blocked shores in 480/480 boards**. Map audit stays green: every
base reachable on foot, walkable area in one piece, banks 1 per zone, nearest-HQ spacing 12–13 tiles at
3P/5P/6P.

### Bridges to nowhere (25 Nov, follow-up)

The remaining 10 boards were not buildings but *stubs*: a deck whose far landing was a one-tile islet
with water on three sides. Three separate causes, all fixed:

1. Classic ran its own bridge scanner (`setup.ts`) that accepted a water tile whenever the two tiles
   beside it were open ground — an islet qualifies. Spans now require both approaches to lead onward.
2. Terrain placed **after** bridges (mountains, banks, buildings) can seal a landing that looked open
   when the deck went down, so the rule is also enforced on the finished map: a crossing is a stub
   when an end landing is a *dead-end stone* (a land area under 3 tiles, with no Base/Bank on it and
   no other crossing touching it). Crossings are judged as runs by their two end landings, never by
   interior deck tiles, which have water on both perpendicular sides by construction.
3. Classic's "base is unreachable" fallback walked an L toward the target base and turned every water
   tile it stepped on into a single-tile deck. It now asks `placeEdgeAwareBridges` for a real
   shore-to-shore span across a carved corridor.

The prune is conservative in three ways, because a cosmetic clean-up must not cost reachability: a
stone carrying a second crossing is a stepping stone and stays (island chains are all inner stones);
a crossing that serves a Base or Bank directly beside the deck stays; and every removal is checked
against the *baseline* number of reachable Bases/Banks, reverting the crossing if it would reduce it.

The independent audit now judges crossings rather than single tiles and reports **0 defects on
800 boards** (classic/balanced/lush_valley/twin_fronts × 2–6P, 40 seeds each): 0 lane-blocked, 0
shore-blocked, 0 stumps — 7,748 decks. In the runs compared for this change the prune took out about
one deck in twenty (the 480-board sample went from 4,813 to 4,595 decks, though the landing-lane work
in the same series also moves that count), every one of them a crossing that ended on a stone. Island
maps keep their chains: archipelago connectivity is 24/24 boards before and after.

```bash
cd packages/engine
bun sim-playtest.ts                                  # canonical full matrix -> sim-results/playtest.json
bun sim-bridge-audit.ts 24                           # bridge landing lanes, 480 boards (add a count to widen)
SIM_OUT=sim-results/playtest-prev.json bun sim-playtest.ts   # archive a run for spread diffs
bun sim-paired-cp.ts                                 # CP20 vs CP30 on identical boards
bun sim-map-audit.ts                                 # 480 boards: connectivity, HQ spacing, banks, perches
SIM_QUICK=1 bun sim-playtest.ts                      # 2 matches/cell smoke test (writes playtest-<PHASE>.json)
SIM_PHASE=E SIM_MATCHES=30 bun sim-playtest.ts       # one phase, custom sample
MAP_SEEDS=40 bun sim-map-audit.ts
```

---

## 0. The ten numbers that matter

> **These ten are the pre-P0 baseline.** Findings 1, 2, 4 and 5 have been addressed — see
> “P0 remediation” above for the current numbers before quoting any of them.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Seats 5 and 6 cannot win.** 6P seats 5–6 won **0 of 72** decided matches this run, and **1 of 90** in the independent paired run. 5P seat 5 won **1 of 38** (0 of 37 in the previous run). Cause is geometric: four seats in corners, the 5th/6th on an **edge midpoint 10–13 tiles from two corners**, with **no bank** in their zone. | §3.4 |
| 2 | **Only the first two seats get a bank.** Banks per zone (deterministic layout): 3P `1/1/0`, 4P `1/1/0/0`, 6P `1/1/0/0/0/0`. Heists: **1.31/match at 2P, 0.19–0.44 at 3–6P** (0.31–0.44 at 3P, 0.38 at 4P, 0.19–0.38 at 6P). | §3.4 |
| 3 | **CP 30/+15 is the pacing lever.** Paired on identical boards: 2P 37→26 rounds, 43%→35% dead, 1.03→1.42 payoffs/turn; 4P **41→27 rounds, 44%→30% dead, 1.04→1.55, 4 stalls→0**; 6P 53→32, 48%→35%, 1.03→1.55, 3 stalls→0. | §2.1 |
| 4 | **Stalls are still the top defect, and now have two shapes.** 4P archipelago 67–75%, 4P fog 25–50%, 6P fog 17–42%, 5P CP20 19% in both runs. Some freezes are Overwatch standoffs; others are **near-pure `END_TURN`** (bots passing without acting). | §2.2 |
| 5 | **Fog does not cost density, it costs closure.** Dead turns barely move (classic 42%→37%, preset 42%→45%), but stalls go **0%→10% on classic** and **0%→25% on preset** (n=20); FFA fog reaches 42–50%. | §3.3 |
| 6 | **Multiplayer time is the retention cliff.** You act **50 / 33 / 25 / 20 / 17%** of the session at 2–6 players. At the shipped 30 s clock the floor is **22 min (2P) → 105 min (6P)**. | §2.4 |
| 7 | **Most turns have no objective.** 2P CP20: **73%** of turns can touch an objective, **45%** offer two or more real options. 6P CP20: **49%** and **27%**. | §2.1 |
| 8 | **CP is not why turns are empty.** Median unspent CP at end of turn is **3.4 of 20** (2P CP20) to **6.6 of 30** (6P CP30); 13–21% of turns end with half a battery idle. | §2.3 |
| 9 | **Only two knobs move the experience.** Grid 16 (24 rounds, 36% dead, 1.34 payoffs) and CP 30 (paired, above) work. HQ 35/65 HP, Doomsday at 18, equal first CP, Scout damage/cost, Sniper cost: **no reliable effect**. More banks is **harmful** (1.08→0.71 payoffs). | §4 |
| 10 | **Difficulty is a stomp dial, not a learning curve.** Density is flat across difficulties (1.04–1.17 payoffs/turn, 39–49% dead) while the result is not: EASY lost 5–15 to HARD, and in a mixed 4P table the EASY+MEDIUM seats took **2 of 20** wins. | §3.5 |

---

## 1. The instrument

### 1.1 What is measured, per seat-turn

| Metric | Player-facing meaning |
|---|---|
| **families** | Distinct legal action families at turn start (move / attack / siege / interact / overwatch / reload). 1 = railroaded, 0 = dead. |
| **i≥2** | Share of turns with **two or more ways to actually affect the board** (shoot a unit, siege an HQ/bank, secure/loot). The honest "agency" number. |
| **prog%** | Share of turns where *any* objective is available. |
| **dead%** | Turn with zero payoff events (hit, kill, structure damage, heist, promotion, capture, build, supply drop, mine). |
| **idleCP** | CP still unspent when the turn ended. |
| **play%** | Share of the match's wall-clock time this player is the one acting (= 1/N if turns are symmetric). |
| **wait** | Other players' actions that resolve before you act again. |
| **comeback** | Share of decided matches where the mid-match leader lost. |
| **climax** | Share of a match's payoff events landing in its final third. |
| **elim / elim@r** | Share of seats eliminated, and the average round it happens — how long a knocked-out player sits watching. |
| **stall** | Match that hit the action cap with no winner. |
| **clock floor** | `median rounds × players × 30 s` — the minimum a match can take at the shipped turn clock. |

Wall-clock figures use a stated model: **6 s per considered action + 5 s per turn of re-orientation**. They are
estimates, labelled as such, not measurements of humans.

### 1.2 Matrix

| Phase | Cells | Matches |
|---|---|---|
| **A** Player count 2–6 × CP 20/+10 and 30/+15, plus fog per count | 15 | 220 |
| **B** 8 map presets × 2P and 4P | 16 | 192 |
| **C** Deathmatch+Doomsday, Doomsday-Conquer, Scarcity, Ironman, Scout-heavy, Sniper-heavy × 2P/4P | 12 | 144 |
| **D** Skill ramp: EASY/EASY, MEDIUM/MEDIUM, EASY-vs-HARD, HARD-vs-EASY, 4P mixed | 5 | 92 |
| **E** Rule lab: 12 single changes + 3 fog controls (classic off/on, preset on) | 15 | 300 |
| **F** Combined packages | 4 | 72 |

Bots are the shipped `botAction` at HARD unless stated. Actions go through the real `prepareAction → applyAction`
pipeline, so illegal bot actions surface as rejects (**0.00–0.05% across all 1,020 matches**; worst cell 0.047%,
mean 0.004%, recorded per cell as `rejectRate`). Stalled matches are
excluded from pacing averages and reported separately — a 2,800-round freeze is a defect, not pacing.

---

## 2. Results

### 2.1 Player count and CP economy (balanced preset, Conquer, HARD/HARD)

| Cell | med rounds | dead% | payoff/turn | i≥2% | prog% | idleCP | play% | wait | comeback% | elim@r | stall% | clock floor |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2P CP20 | 35 | 43 | 1.10 | 45 | 73 | 3.4 | 50 | 3.0 | 25 | 34 | 0 | 35 min |
| **2P CP30** | **22** | **30** | **1.48** | 51 | 79 | 6.3 | 50 | 3.2 | 25 | 24 | 0 | 22 min |
| 3P CP20 | 28 | 40 | 1.22 | 45 | 68 | 3.6 | 33 | 5.0 | 56 | 23 | 0 | 42 min |
| **3P CP30** | **19** | **26** | **1.80** | 60 | 80 | 4.4 | 33 | 5.1 | 31 | 14 | 0 | 29 min |
| 4P CP20 | 48 | 48 | 0.98 | 36 | 61 | 4.5 | 25 | 6.9 | 62 | 34 | **19** | 96 min |
| **4P CP30** | **22** | **35** | **1.55** | 48 | 70 | 6.1 | 25 | 7.9 | 69 | 19 | 0 | 44 min |
| 5P CP20 | 52 | 50 | 0.97 | 33 | 55 | 6.2 | 20 | 6.9 | 31 | 29 | **19** | 130 min |
| **5P CP30** | **26** | **30** | **1.64** | 50 | 75 | 5.2 | 20 | 8.7 | 56 | 15 | 0 | 65 min |
| 6P CP20 | 62 | 57 | 0.83 | 27 | 49 | 8.6 | 17 | 6.7 | 62 | 31 | **19** | 186 min |
| **6P CP30** | **35** | **31** | **1.60** | 48 | 71 | 6.6 | 17 | 9.9 | 50 | 16 | 0 | 105 min |

*Run-to-run spread over these 10 cells (two full runs): rounds ±1.0 (max 16), dead ±1 pp (max 9), payoffs/turn
±0.04 (max 0.13), 2+ options ±2 pp (max 6), stalls ±0 pp (max 19). The largest swings are the FFA CP20 cells,
which freeze in one run and not the other: 6P CP20 median 46 → 62 rounds, 4P CP20 stalls 0% → 19%. The 2P and 3P
rows move by ≤1 round and ≤1 pp on dead turns (options move up to 6 pp) and are reproducible.*

**Paired CP check** — separate invocation (`sim-paired-cp.ts`, 24 boards per seat count, both economies on the
*same* board and seat order, so the battery is the only variable):

| Seats | Economy | med rounds | dead% | payoffs/turn | 2+ options | stalls | win split |
|---:|---|---:|---:|---:|---:|---:|---|
| 2 | 20/+10 | 37 | 43 | 1.03 | 43% | 0 | 15 / 9 |
| 2 | **30/+15** | **26** | **35** | **1.42** | **49%** | 0 | 15 / 9 |
| 4 | 20/+10 | 41 | 44 | 1.04 | 34% | 4 | 5 / 5 / 5 / 5 |
| 4 | **30/+15** | **27** | **30** | **1.55** | **47%** | **0** | 6 / 6 / 7 / 5 |
| 6 | 20/+10 | 53 | 48 | 1.03 | 36% | 3 | 9 / 6 / 2 / 3 / 1 / 0 |
| 6 | **30/+15** | **32** | **35** | **1.55** | **47%** | **0** | 9 / 5 / 4 / 6 / 0 / 0 |

*Paired-run spread: repeating this script with fresh seeds moved 2P CP30 from 26/35%/1.42 to 24/33%/1.43 and,
at 60 boards, 23/33%/1.43 — i.e. ±2 rounds and ±2 pp. The CP effect is far outside that.*

The CP effect is not seed luck: it survives holding the board fixed, at every seat count, and it removes stalls.
The paired run also independently reproduces the FFA seat problem (6P: seats 5 and 6 take 0 of 45 decided
matches) and shows the 4P seat split is even (`5/5/5/5`).

Read it as three separate games:

- **2P** is a real tactics game. At CP30 a turn yields ~1.5 payoffs, 51% of turns offer two real options, and
  matches end in 22 rounds / ~21 min of play.
- **4P at CP20 is the weakest cell** — 48% dead turns this run (69% last run), 0.98 payoffs, 19% stalls. CP30 on
  the same boards (paired) is 30% dead and 1.55 payoffs with zero stalls. CP30 is masking a geometry problem
  here, not fixing it (§3.4).
- **5P/6P are not ready.** They are playable at CP30 on the pacing axes, but seat fairness (§3.4) and session
  length (§2.4) disqualify them.

**Win condition mix.** 2P is decided by squad wipe 75–81% of the time and HQ destruction only 19–25%. From 3P up
it inverts: HQ destruction is 94–100% of wins. The "Conquer" fantasy is what multiplayer delivers; the 2P game
is actually a deathmatch. If the pitch is "destroy the enemy HQ", 2P does not currently sell it.

### 2.2 Stalls come in two shapes, and they scale with player count

| Cell | stall% | decided/total | dominant actions inside stalled matches |
|---|---:|---:|---|
| 4P archipelago | **75%** | 3/12 | `END_TURN` 50.5k, `OVERWATCH` 1.3k |
| 4P fog | 50% | 6/12 | `END_TURN` 22.0k, `OVERWATCH` 10.3k |
| 6P fog | 42% | 7/12 | `END_TURN` 14.3k, `OVERWATCH` 13.6k |
| 2P fog (preset) | 25% | 9/12 | `END_TURN` 5.9k, `OVERWATCH` 5.7k |
| 4P fortress | 25% | 9/12 | `END_TURN` 12.1k, `OVERWATCH` 5.1k |
| 5P CP20 | 19% | 13/16 | `END_TURN` 12.4k, `OVERWATCH` 5.0k |

*Run-to-run spread over these 6 cells: rounds ±7 (max 32), dead ±5 pp (max 9), payoffs/turn ±0.10 (max 0.18),
2+ options ±4 pp (max 6), stalls **±8 pp (max 25)**. Stall rates are the least reproducible number in this
report; read the ranges in §0/§3, not a single percentage.*

Two distinct freeze shapes are visible in the action mix:

1. **Overwatch standoff** — `OVERWATCH` roughly equal to `END_TURN` (2P fog, 4P fog, 6P fog). Two bots park on
   high ground, each refunds CP when unfired, and nothing forces resolution. This is the defect documented in
   `CP_SIMULATION_AUDIT.md` §4, still live, and worse in FFA where only one pair needs to opt out.
2. **Pass freeze** — almost pure `END_TURN` with little overwatch (4P archipelago, 4P fortress, 5P CP20). The
   bots are ending turns without acting at all: no affordable action, no reachable target, or an economy loop.
   This one is not an Overwatch bug and needs its own forensic replay; the harness now records the mix so a
   specific seed can be replayed.

### 2.3 The battery is under-spent, not over-stretched

Median CP left at end of turn: **3.4 of 20** at 2P CP20, **6.3 of 30** at 2P CP30, **6.6 of 30** at 6P CP30.
Turns that end with at least half the battery idle: **13–21%**. Meanwhile 2P CP20 can touch an objective on only
73% of turns and offers two or more real options on 45%; at 6P CP20 that is 49% and 27%.

The player is holding currency they cannot spend on anything that matters. Raising CP does not change efficiency
(it raises both payoffs and idle CP); it changes how many *meaningful* actions exist per turn, because it lets
expensive units act in the same turn as cheap ones.

### 2.4 Multiplayer wall-clock: the number that kills 5–6P

| Seats | Your share of the session | Others' actions between your turns | Floor at 30 s clock | Estimated active play |
|---:|---:|---:|---:|---:|
| 2 | 50% | 3.2 | 22 min | 21 min |
| 3 | 33% | 5.1 | 29 min | 21 min |
| 4 | 25% | 7.9 | 44 min | 36 min |
| 5 | 20% | 8.7 | 65 min | 38 min |
| 6 | 17% | 9.9 | **105 min** | 48 min |

*Run-to-run spread over these 5 cells: rounds ±1 (max 6), dead ±1 pp (max 2), payoffs ±0.04 (max 0.07),
2+ options ±1 pp (max 4), stalls ±0 pp (max 13).*

Two independent problems:

1. **Turn clock.** The default is 30 s + 15 s. A 6P match cannot finish under 105 minutes even if nobody thinks.
   That is not a "long session", it is an unusable mode.
2. **Downtime.** You wait through ~10 actions per turn at 6P — roughly a minute of watching between decisions,
   five times in a row.

Both point the same way: fewer, shorter turns per player at high seat counts (lower clock, smaller grids, or an
async mode), not more content.

### 2.5 Elimination: the other multiplayer fun-killer

| Cell | seats eliminated | avg elimination round | median match |
|---|---:|---:|---:|
| 4P CP30 | 75% | r19 | 22 |
| 5P CP30 | 80% | r15 | 26 |
| 6P CP30 | 83% | r16 | 35 |

*Run-to-run spread over these 3 cells: rounds ±5 (max 6), dead ±1 pp (max 2), payoffs/turn ±0.04 (max 0.07),
stalls ±0 pp (max 13).*

At 5P the average eliminated player is out at **round 15 of 26** — they sit out 42% of the match. Eliminated
seats are skipped by the turn loop, so there is no spectate task and no comeback: they just watch. In a game sold
on "every CP is a decision", the modal 5-player experience ends with two people not playing.

---

## 3. Configuration findings

### 3.1 Maps, 2P (n=12 each, CP20)

| Preset | med rounds | dead% | payoff/turn | i≥2% | stall% | verdict |
|---|---:|---:|---:|---:|---:|---|
| open_blitz | 27 | 41 | 1.22 | 51 | 0 | **best pacing** |
| balanced | 31 | 45 | 1.11 | 45 | 0 | baseline |
| twin_fronts | 31 | 45 | 1.06 | 40 | 0 | fine |
| badlands | 37 | 48 | 0.96 | 37 | 0 | fine |
| fortress | 39 | 51 | 0.93 | 42 | 8 | slow, 1 bank |
| lush_valley | 39 | 48 | 1.00 | 42 | 17 | dense woods stall |
| archipelago | 39 | 49 | 0.97 | 36 | **25** | unreliable |
| timber_ridge | 43 | 40 | 1.09 | 44 | 0 | fine |

*Spread over these 8 cells: rounds ±1 (max 8), dead ±2 pp (max 5), payoff ±0.02 (max 0.11), 2+ options ±1 pp
(max 5), stalls ±8 pp (max 8). 2P map *pacing* reproduces well; the stall flags do not — archipelago and
lush_valley each froze 1–3 of 12 boards depending on the run.*

### 3.2 Maps, 4P (n=12 each, CP20)

| Preset | med rounds | dead% | payoff/turn | i2% | stall% |
|---|---:|---:|---:|---:|---:|
| open_blitz | 38 | 49 | 1.00 | 28 | 0 |
| balanced | 50 | 73 | 0.49 | 18 | 0 |
| twin_fronts | 47 | 47 | 0.93 | 31 | 17 |
| badlands | 40 | 52 | 0.90 | 27 | 0 |
| fortress | 57 | 49 | 0.95 | 37 | 25 |
| lush_valley | 53 | 53 | 0.86 | 30 | 25 |
| archipelago | 59 | 63 | 0.63 | 19 | **75** |
| timber_ridge | 45 | 51 | 0.95 | 34 | 0 |

*Spread over these 8 cells: rounds ±6 (max 8), dead **±1 pp (max 26)**, payoff ±0.04 (max 0.50), 2+ options
±4 pp (max 18), stalls ±8 pp (max 8). This is the least stable table in the report: 4P balanced read 47%→73%
dead turns between runs. Treat 4P map rankings as "which maps freeze" rather than as precise pacing.*

Archipelago is not merely slow, it is often unfinishable in FFA (75% of boards froze this run, 67% last run).
Forest-heavy lush_valley, twin_fronts and fortress follow at 17–25%.

### 3.3 Fog of war: a closure problem, not a density problem

The three fog arms below are new in the canonical run and use the same seed family, so this is a like-for-like
comparison (n=20 each):

| Arm | med rounds | dead% | payoff/turn | prog% | stall% |
|---|---:|---:|---:|---:|---:|
| classic generator, fog off | 36 | 42 | 1.09 | 71 | **0** |
| classic generator, fog on | 35 | 37 | 1.13 | 70 | **10** |
| preset generator, fog on | 34 | 45 | 1.04 | 60 | **25** |
| matrix cell `2P fog` (preset, n=12) | 35 | 44 | 1.09 | 65 | 25 |

*No prior-run comparison exists for the two new classic arms; the `2P fog` matrix cell moved 42%→44% dead and
25%→25% stalls between runs.*

The earlier belief that fog destroys payoff density does **not** survive this sample: dead turns are 42%→37% on
classic and 42%→45% on preset, which is noise. What fog does is raise the chance a match never closes — 0%→10%
on classic, 0%→25% on preset — and in FFA, fog is the worst configuration in the matrix (4P 50%, 6P 42%).
Vision-limited bots stop finding each other and settle into the standoff of §2.2.

### 3.4 FFA seat geometry — the multiplayer blocker

Base positions are fixed, not generated per seed:

```
3P (20×20)  P1 2,2    P2 17,17   P3 17,2
4P (25×25)  P1 2,2    P2 22,22   P3 22,2   P4 2,22
5P (25×25)  P1 2,2    P2 22,22   P3 22,2   P4 2,22   P5 12,2   ← top edge midpoint
6P (30×30)  P1 2,2    P2 27,27   P3 27,2   P4 2,27   P5 15,2   P6 15,27
```

Measured consequences (20 boards/cell, `sim-map-audit.ts` — deterministic, so no run-to-run spread):

| Seats | territory (tiles/zone) | nearest enemy (tiles) | banks per zone |
|---|---|---|---|
| 3P | 141 / 131 / 92 | 15 / 15 / 15 | **1.0 / 1.0 / 0.0** |
| 4P | 154 / 154 / 128 / 129 | 20 / 20 / 20 / 20 | **1.0 / 1.0 / 0.0 / 0.0** |
| 5P | 96 / 143 / 93 / 131 / 106 | **10 / 20 / 10 / 20 / 10** | 1.0 / 1.0 / 0.0 / 0.0 / 0.0 |
| 6P | 126 / 129 / 126 / 128 / 158 / 159 | 13 / 12 / 12 / 13 / 12 / 12 | 1.0 / 1.0 / 0.0 / 0.0 / 0.0 / 0.0 |

- **Seat 5 is a corridor.** At 5P it sits between two corner bases at 10 tiles each, with the map border behind
  it and the smallest territory of any seat. It won **1 of 38** decided 5P matches this run, **0 of 37** last
  run, and the 6P edge seats won **0 of 72** here and **1 of 90** in the paired run.
- **Rotating the starting seat does not move the advantage** (separate rotation probe: 5 × 30 matches, start
  seat 0→4; the edge seat won almost nothing from every order). It is not turn order. It is where the base is.
- **Banks exist only for the first two seats.** The preset asks for `banks: 2`, and the generator places one bank
  per player *sector* while capping at the preset count — so 3P+ leaves every later seat with zero vaults.
  Heists: 1.31/match at 2P, 0.31–0.44 at 3P, 0.38 at 4P, 0.19–0.38 at 6P.

This is why FFA "feels" random: three of five players are structurally unable to win, and the seat that should be
the wildcard (edge seat, two neighbours) is the worst position on the board.

### 3.5 New-player experience

| Cell | win split | payoff/turn | dead% | med rounds | stall% |
|---|---|---:|---:|---:|---:|
| EASY vs EASY | 14 / 6 | 1.15 | 43 | 29 | 0 |
| MEDIUM vs MEDIUM | 10 / 10 | 1.10 | 40 | 33 | 0 |
| EASY(P1) vs HARD | **5 / 15** | 1.17 | 40 | 32 | 0 |
| HARD(P1) vs EASY | 16 / 4 | 1.16 | 39 | 33 | 0 |
| 4P mixed (EASY, MEDIUM, HARD, HARD) | **0 / 2 / 6 / 2** | 1.04 | 49 | 35 | 17 |

*Spread over these 5 cells: rounds ±2 (max 9), dead ±2 pp (max 4), payoffs ±0.02 (max 0.10), 2+ options ±1 pp
(max 5), stalls ±0 pp (max 17). The EASY-vs-HARD split moved 1–18 → 5–15 between runs: a stomp either way, but
not a stable exact ratio.*

Two separate problems hide here.

**Difficulty does not change the experience, only the winner.** Every difficulty setting produces the same
density of events (1.04–1.17 payoffs/turn, 39–49% dead). What changes is who wins: a new player on EASY against a
HARD bot takes 25% of matches, and in a mixed table the two weaker seats take 2 of 20. The lobby's difficulty
selector is a *matchmaking stomp dial*, not an on-ramp.

**The on-ramp that is missing is time-to-first-payoff: 3.3 rounds at 2P CP30, 5.3 at CP20.** At 2P that is 2–3
minutes of moving before anything happens, with no scripted first hit, no tutorial turn, and no "here is what a
shot looks like" moment. The old review flagged this qualitatively; the simulation puts a number on it, and it is
the same at every difficulty.

### 3.6 Decks, modes, mutators (CP20)

All arms share one seed family; the default row is the rule-lab baseline (n=20). Compare within the table, not
against §2.1, whose boards differ.

| Cell | 2P med / dead / payoff | 4P med / dead / payoff |
|---|---|---|
| Default | 36 / 44 / 1.08 | 43 / 51 / 0.94 |
| Deathmatch + Doomsday | 30 / 39 / 1.16 | 49 / 47 / 0.98 |
| Doomsday Conquer | 30 / 45 / 1.06 | 43 / 51 / 0.94 |
| Scarcity | 34 / 40 / 0.87 | 43 / 49 / 0.94 |
| Ironman | 22 / 42 / 1.07 | 42 / 57 / 0.72 |
| **Scout-heavy (4/1/1)** | 40 / 42 / **1.16** | 47 / 44 / **1.13** |
| Sniper-heavy (1/1/3) | 45 / **58** / 0.78 | 62 / 68 / **0.58** |

*Spread over the 13 comparable cells: rounds ±3 (max 12), dead ±1 pp (max 8), payoffs ±0.02 (max 0.18),
2+ options ±2 pp (max 16), stalls ±0 pp (max 8).*

- Deathmatch+Doomsday is *not* the pacing fix it was believed to be: 30 vs 36 rounds at 2P, and it is slower at
  4P. The earlier "make Doomsday the default" recommendation does not survive a stall-free sample.
- **The Scout deck is the most eventful configuration in the game** (1.16 payoffs/turn at both seat counts) and
  the Sniper stack is the least (0.78 / 0.58, plus the highest stall rate). Sniper-heavy is a CP sink: 8 CP per
  shot means one action a turn, which is the definition of a dead turn. The Scout's problem is not damage — it is
  that the *default* deck only has two of them.

---

## 4. The rule lab: what actually improves the experience

20 matches per arm, 2P, balanced preset, CP20 baseline, HARD/HARD.

| Change | med rounds | dead% | payoff/turn | i≥2% | stall% | verdict |
|---|---:|---:|---:|---:|---:|---|
| Baseline | 36 | 44 | 1.08 | 42 | 0 | — |
| **Grid 16×16** | **24** | **36** | **1.34** | **54** | 0 | **works** |
| **CP 25/+12** | 31 | 40 | 1.24 | 50 | 0 | **works** |
| CP 30/+15 (paired run, other boards — §2.1) | 26 | 35 | 1.42 | 49 | 0 | **works best** |
| HQ 35 HP | 31 | 44 | 1.11 | 48 | 0 | no effect |
| HQ 65 HP | 31 | 47 | 1.03 | 43 | 0 | no effect |
| Doomsday at round 18 | 36 | 52 | 0.95 | 48 | 0 | worse |
| Equal first-turn CP (no P1 handicap) | 37 | 42 | 1.06 | 44 | 0 | no benefit |
| Scout damage 5→7 | 38 | 41 | 1.12 | 45 | 0 | no effect |
| Scout attack 3→2 CP | 29 | 43 | 1.08 | 40 | 0 | pacing only |
| Sniper cost 8→9 CP | 36 | 42 | 1.11 | 42 | 0 | no effect |
| Fortress with 2 banks | 43 | 39 | 1.07 | 48 | **25** | adds stalls |
| 3 banks per board | 38 | **61** | **0.71** | **25** | 0 | **actively harmful** |

*Spread over these 12 cells: rounds ±1 (max 4), dead ±1 pp (max 5), payoffs ±0.01 (max 0.08), 2+ options ±2 pp
(max 5), stalls ±0 pp (max 5). This is the most reproducible table in the report — the verdicts are safe.*

Three conclusions that contradict the current roadmap:

1. **HQ HP is not the pacing lever.** 50→35 changes nothing (36→31 rounds, inside the spread); 65 does not
   shorten matches either. Matches end by wipe, not by siege.
2. **Doomsday is not a closer.** Starting it at round 18 does not shorten matches (36 rounds) and costs payoff
   density (1.08→0.95); only a minority of games reach it.
3. **More banks make the game worse for bots.** `banks: 3` drops payoffs to 0.71 and two-option turns to 25%:
   with more vaults, the AI converts combat CP into bank sieges and stops fighting. This is a warning for the
   "make heists a core loop" plan — the heist and the kill draw on the same battery. Human players may behave
   differently, but the CP competition is real.

**Combined packages.** `CP30 + HQ35` = 20 rounds / 31% dead / 1.45 payoffs — i.e. the same as CP30 alone
(22/30/1.48, inside the spread). `grid16 + HQ35 + doom18` = 24/40/1.21. Adding knobs on top of CP30 buys nothing;
the second-best lever is grid size, not content.

---

## 5. Ship gates (put these in CI)

Targets for a public build, with status at the best shipping configuration (CP30, 2P) from the canonical run.
Where a gate depends on a volatile cell, the two-run range is given instead of a point estimate.

| Gate | Target | Current |
|---|---|---|
| Median match length (2P) | 15–20 min of play | **21 min** ⚠️ |
| Dead turns | < 30% | **30%** ⚠️ borderline |
| Turns with 2+ real options | ≥ 50% | **51%** ⚠️ borderline |
| Stalls | < 1% | **0%** (2P) ✅ / **0–19%** (4P+) ❌ |
| Comeback rate | 30–50% | **25–44%** ⚠️ run-dependent |
| Seat bias (2P) | ≤ 10 pp | **unresolved**: 50% here, 59% last run, 62% paired |
| Seat bias (5–6P) | ≤ 10 pp | **0 of 72 wins for seat 5/6** ❌ |
| Eliminated before half-time | < 5% of seats | **~42% of seats at 5P** ❌ |
| Payoffs per turn | ≥ 1.2 | **1.48** ✅ |
| Time to first payoff | ≤ 2 rounds | **3.3** ❌ |
| Clock floor (any seat count) | ≤ 45 min | **105 min at 6P** ❌ |

A build that passes the 2P gates and fails four at 5–6P is a 2-player game with a broken multiplayer menu. Ship
2P first; gate 3–6P behind the geometry fix.

---

## 6. Ranked backlog

**P0 — correctness (do before any marketing).**

> **Status 25 Nov: 1 partially done (5P), 2–5 done.** Ring seating (3P/5P/6P), per-seat banks and
> continuous rivers shipped; stalls are 0/67 cells and fog-on matches fog-off. Seat win spread is now
> 4P 5 pp, 6P 9 pp, 3P 11 pp. The 3P regression was a **seat-to-base bug** (fixed — see “Seat
> assignment” at the top), not turn order: **turn order is only a secondary factor**, worth roughly half
> the old 3P gap (rotating who acts first moved it 31 → 21 pp). **5P's 17–19 pp over 1,000 matches is a
> separate, unfixed seat-to-base problem**: seat 3 wins 11.9–13.5% against a fair 20%, which the uniform
> ring rotation does not explain and which needs its own diagnosis before 5P can pass the gate.

1. **Fix FFA base layout.** Ring seating is in; what remains is seat-to-base assignment (5P), with turn
   order as a secondary factor. Remaining acceptance: seat win share within ±10 pp over 200 matches at
   3–6P **after** the first player is rotated per match, and 5P's seat 3 deficit closed.
   ✅ **Bridge landings stay open**: no building or peak on a shore or its landing lane, 0 lane-blocked
   decks in 480/480 boards (was 84/480 boards with a blocked landing).
   ✅ **No bridge to nowhere**: every deck joins two landings that lead somewhere, 0 stumps in 800
   boards, with Base/Bank reachability checked before every deck is removed.
   ✅ **Rivers stay continuous** with ring seating: 1 channel piece per board on 144/144 audited boards,
   no base on water, nearest-HQ spacing 12–13 tiles, and 2P/4P maps unchanged. Acceptance: no channel
   stub visible at a seat, checked on every banded preset × 3–6P.
2. ✅ **Give every seat a bank** (`max(banks, players)`; heists 0.75–3.81 at 3–6P).
3. ✅ **Kill both stall shapes** (aggression clock + 80-round backstop; 0 stalls across 67 cells).
4. ✅ **Fix fog's closure problem** (0% with fog on and off).

**P1 — pacing and session length.**
5. **Ship CP 30/+15 as the default for every seat count**, keep 20/+10 as "Classic". Paired effect: −11 rounds
   and +0.39 payoffs/turn at 2P; −14 rounds and −14 pp dead turns at 4P, and it removes every paired stall.
6. **Set the turn clock by seat count** (e.g. 45 s + 15 s at 2P, 20 s + 5 s at 5–6P) or default 4P+ to async.
   A 105-minute floor is a product bug, not a taste question.
7. **Offer 16×16 for 2P** (24 rounds, 36% dead, 1.34 payoffs, no fairness cost).
8. **Front-load the first payoff** (a scripted opening skirmish or a starting supply drop on turn 1). Target:
   first payoff at round ≤ 2 (currently 3.3–5.3). Related: **do not let one table mix EASY/MEDIUM/HARD seats** —
   the weaker seats took 2 of 20 in the mixed 4P arm. Cap the spread at one step, or label the table.

**P2 — content and identity.**
9. **Make the default deck Scout-forward** (3/1/1) or make Scouts the objective layer (cheaper `SECURE`/`LOOT`).
   The Scout-heavy deck is the most eventful configuration in the game; the Sniper stack is the least.
10. **Do not add banks or HQ-HP variants expecting pacing wins.** The lab says they do nothing or hurt. Spend
    that effort on verbs per turn instead (a second action per unit, reaction abilities).

**P3 — retention (not simulable, must be tested with humans).**
11. Daily seed + "beat my round count", local career stats surfaced in the lobby, and a shareable receipt card.
    These are hypotheses about the fourth session, not findings of this audit — the simulation can only prove
    that the *match* is worth repeating once the gates above pass.

---

## 7. Ship the instrument to production

The metrics above are cheap to log for real players and are the only way to answer the questions this audit
cannot (fun, mastery, session 4). Minimum event set:

```
turn_start   { seat, round, families, option_count, impact_options }
turn_end     { seat, round, cp_left, cp_spent, actions, payoff_events }
entity       { killed/heist/promotion/capture/siege }   // already in GameEvent
match_end    { winner, rounds, endsBy:'HQ'|'WIPE'|'CAP', seat, elim_round, seed }
```

Then compare live distributions to the bot baselines in `sim-results/playtest.json` (same field names). The first
divergence to watch: **impact_options**. If real players see fewer two-option turns than HARD bots, the game is
harder to read than it is to play — a UI problem, not a balance one.

---

## 8. Watch item and limits

- **The 2P first-seat edge is unresolved.** Seat 1 took 50% of this run's 32 decided 2P matches, 59% of the
  previous run's 32, and 62% of 118 paired matches — pooling to **108/182 (59%, p≈0.01)**, while the earlier
  690-match audit on classic maps found 49.9%. Either the preset generator is less seat-symmetric than the
  classic one, or this is a bot artefact. Run 300 paired matches split classic/preset before changing anything;
  the lab already shows removing the 15-vs-20 opening handicap does not help (§4).
- **Bots, not humans.** Every number describes HARD (or stated) AI play. Humans spend CP more aggressively, pick
  fights the AI avoids, and will heist more. Treat CP30 lethality as a floor and multi-option rates as a
  conservative estimate of what a good player sees.
- **12–20 matches per cell, two runs compared.** Pacing and density differences of 5+ pp that reproduce in both
  runs are meaningful; single-cell stall rates and FFA medians are not. The 2P/3P rows are the trustworthy ones.
- **Runs are not bit-reproducible.** AI tie-breaks, base artillery and supply drops call `Math.random`
  (`CP_SIMULATION_AUDIT.md` §9). That is why every table above carries its own spread line and why volatile cells
  are quoted as ranges.
- **The O(N) metrics are correlated.** `dead%`, `payoff/turn` and `i≥2%` move together; they are three views of
  the same "is there anything to do" question.
- **Wall-clock is modelled**, not observed: 6 s/action + 5 s/turn. The *clock floor* figures are exact given the
  shipped timer.
- **Not covered:** veterancy, items, mines, the campaign challenge ops, and every meta-progression system. Those
  need their own harness or a human cohort.
