# Tactical Tiles — CP Battery & Map Simulation Audit
*690 bot-vs-bot matches across two CP economies (plus a calibration arm) and five map presets · 24 Nov 2026*

## 1. What was run

| | |
|---|---|
| Harness | `packages/engine/sim-cp-audit.ts` (fault forensics: `sim-stall-forensics.ts`) |
| Pipeline | `botAction` → `prepareAction` → `applyAction({ autoBankReward: true })` — the same three calls the server makes, so illegal actions surface as rejects instead of desyncs |
| Mode | Conquer · HARD bots both seats · dynamic weather · fog off · default 4-unit squad (2 Scout / 1 Breacher / 1 Sniper) · 2 players |
| Requested matrix | 150 games at **CP 20 / +10** and 150 at **CP 30 / +15**, 30 per map per economy |
| Maps | `balanced`, `archipelago`, `badlands`, `fortress`, `open_blitz` |
| Calibration | 150 games at **CP 25 / +12** (`CP_OVERRIDE`) + 240 extra CP 30 games to test seat balance |
| Action cap | 4,000 actions/match (a match that hits it is logged as a stall) |

Both economies already exist in code: `CP_SYSTEM` (`Config.ts:44`) and `MUTATOR_CONFIG.CLASSIC_CP` (`Config.ts:221`), selected by `getEffectiveCpRules` (`CombatRules.ts:7`). Player 1's opening handicap scales with them (15 Classic → 22 default), keeping roughly the same ~75 % ratio.

```
cd packages/engine
GAMES_PER_CELL=30 bun sim-cp-audit.ts                  # the requested 300
CP_OVERRIDE=25/12/18 VARIANT_FILTER='CP 25/+12' GAMES_PER_CELL=30 SEED_OFFSET=300 bun sim-cp-audit.ts
SEED=STD0FO bun sim-stall-forensics.ts                  # replay one frozen match
```

## 2. Headline result

Stalled matches excluded (the honest read; see §4 for why that matters):

| Metric | CP 20 / +10 | CP 25 / +12 | CP 30 / +15 |
|---|---|---|---|
| Median rounds | **35** | **32** | **25** |
| Average rounds | 39.9 | 33.2 | 25.7 |
| p10 / p90 | 24 / 57 | 21 / 45 | 17 / 34 |
| Stalls (hit action cap) | **10 / 150 (6.7 %)** | 0–3 / 150 | **1 / 150 (0.7 %)** |
| Games over 50 rounds | 20 % | 8 % | 1 % |
| Wins by destroying the HQ (the actual objective) | 34 % | 35 % | **44 %** |
| Wins by wiping the squad | 66 % | 65 % | 56 % |
| Actions per turn | 3.0 | 3.1 | 3.3 |
| CP spent per turn | 9.2 | 11.0 | 13.6 |
| Turns ending with zero CP | 32 % | 29 % | 29 % |
| Turns ending with ≥ half the battery unused | 22 % | 22 % | 18 % |
| Dead turns (no hit, kill, capture, loot, promotion, heal) | 50 % | 49 % | **43 %** |
| Payoff events per turn | 1.16 | 1.28 | **1.57** |
| Round of first HQ damage | 14 | 10 | **7** |
| Heists per match | 1.01 | 0.97 | 0.95 |
| Kills per match | 9.4 | 9.5 | 9.3 |
| Promotions per match | 13.2 | 12.5 | 11.4 |
| Longest run of rounds with no payoff event | 120 | 130 | 89 |
| Games frozen ≥ 20 rounds | 6 | 7 | 2 |
| Median gold left at end | €85 | €75 | €70 |
| P0 win share (95 % CI) | 49 % ±8 | 51 % ±8 | 47 % ±8 |

**Seat balance:** across all 674 decided games P0 won 336 (49.9 %). Pooled over three economies and 690 matches there is **no first- or second-seat advantage**. The 22-vs-30 opening handicap in Blitz is doing the same job the 15-vs-20 handicap does.

**Verdict.**
- **20 / +10 is too tight.** It converts into a 35-round median, 20 % of games past 50 rounds, 6.7 % never ending, and half of all turns producing nothing. Sniper 8 CP + move 2 CP is 10 of a 10-CP regen, so a turn is often *one* unit acting.
- **30 / +15 is the best of the three for pacing** and is the only arm where the intended win condition (HQ destruction) is the most common way to win. It costs ~7 % of games ending before round 15 and enables CP-burst lines that 20 cannot (§5).
- **25 / +12 is the better *tactical* pace** (median 32, p90 45) but does not fix the stall bug any better than 30 does — the freeze is AI-side, not economic (§4). Fix that first, then choose 25 or 30 on taste.

## 3. What the battery actually does (the important design finding)

CP is a **flow, not a stock**, and the cap is almost never the binding constraint.

- Average CP available at turn start is **13.8** (20/+10), **16.6** (25/+12), **20.0** (30/+15) — never the nominal 20/25/30, because players spend down each turn.
- Utilisation (spent ÷ available) is **67 %, 66 %, 68 %** — identical across all three. Raising the battery does not make players more efficient.
- Regen lost to the cap: ~91 CP per match at 20/+10, ~92 at 25/+12, ~75 at 30/+15 (25 %, 22 %, 20 % of turns start already full).
- Throughput rises 47 % (9.2 → 13.6 CP/turn) but actions per turn rise only 10 % (3.0 → 3.3). The extra CP buys **better actions, not more decisions**: Overwatch falls from 11.4 % to 7.9 % of actions, Siege rises from 5.3 % to 8.4 %, Attack from 18.8 % to 19.1 %.
- With a 4-unit squad where each unit acts once per turn (`completed: true` on attack/siege/etc.), 30 CP is frequently more than the squad can legally spend. That is why 18–22 % of turns still end with half a battery idle at every setting.

**Implication for development:** the CP knob is a *pacing/lethality* dial, not a depth dial. If the goal is more interesting turns, add CP sinks (a second action per unit, reaction abilities, squad-size scaling) rather than more regen. If the goal is shorter matches, 30/+15 already delivers it.

Secondary finding: a bank heist that pays CP can push a turn past the cap — the observed maximum single-turn spend is **21.9 CP at a 20 cap** and **31.0 CP at a 30 cap**. Heists are the only way to exceed the battery, which is a nice design hook and worth surfacing in the UI ("vault CP can overflow the battery this turn").

## 4. The real defect: the AI freezes in an Overwatch standoff (P0)

**6.7 % of 20/+10 matches never end** (10/150; 23 % of Fortress games, 10 % of Archipelago). Forensics on `STD0FO` (`sim-stall-forensics.ts`):

```
seed=STD0FO map=fortress rounds=1373 actions=4000 winner=null
type counts: { MOVE: 49, OVERWATCH: 1135, ATTACK: 27, ... }
HQs: P0 50hp @17,2 | P1 50hp @2,17      CP now: {"0":20,"1":20}   gold: €20105 / €39460
P0 SNIPER @16,5 -> enemy HQ reachable=true dist=26
P1 ASSAULTER @9,14 / P1 SNIPER @10,13 -> enemy HQ reachable=true dist=20/18
last turns: R1346..R1371 = "P0 OVERWATCH(S@16,5)" / "P1 OVERWATCH(S@10,13)" forever
```

Two snipers sit ~14 tiles apart, each on high ground/owned building, each within the AI's `effectiveRange + 4` "watchingApproach" window (`AIBrain.ts:801`), so both choose Overwatch (score 32, `AIBrain.ts:809`) over advancing. Overwatch also refunds 3 CP when unfired, so the stance is self-funding. Nothing ever forces a resolution: HQs at full HP, €20k unspent, 1,135 Overwatch orders.

There *is* an anti-stall guard (`AIBrain.ts:480`), but its trigger is too narrow — it requires **every remaining side to be at ≤1 unit**. Every observed stall has 1v2, 2v1 or 2v2 survivors, so `lastStand` never turns on.

```
// AIBrain.ts:480 comment claims "every remaining side fields ≤1 unit"
// Observed stalls: units 1/2, 1/3, 2/1, 2/2  ->  guard never fires
```

**Fix (highest-value work in this audit):**
1. Broaden `lastStand`: fire when *no side can reinforce* (respawns exhausted **and** no affordable/available spawn tile) **or** total units on board ≤ 3 — not "every side ≤ 1".
2. Add a global aggression clock: if no HQ damage for N rounds (N ≈ 10–12, i.e. beyond p90 of normal games), zero out Overwatch scoring and the "hold position" term, and force HQ marching/sieging.
3. Add a match-level stalemate rule as a backstop: after ~40 rounds with no HQ damage, enable sudden death (Doomsday ring or HQ armour decay). A 20/+10 Fortress game reaching 1,924 rounds is a product defect, not a strategy.

Evidence that this is engine-wide and not just Fortress: the longest payoff-free run is **3,787–3,825 rounds**, including 3 Archipelago games and 1 Blitz game (`BTZ0FO`, 674 rounds).

## 5. CP-specific balance notes

- **Sniper volley ceiling.** HQ siege damage is `floor(baseDmg × 1 − 0.2 armour)`; a Sniper on an owned Watchtower does `floor(20 × 1.2 × 0.8) = 19` per shot (`calculateSiegeDamage`, `CombatRules.ts:297`). HQ HP is 50 (`BASE_STATS`). Three Sniper sieges = **57 damage for 24 CP** — a legal one-turn HQ kill at a 30 cap, **mathematically impossible at a 20 cap** (max 2 shots = 38). The default 4-unit squad cannot exceed ~37 HQ damage per turn, but `UNIT_LIMITS.SNIPER = 3` allows a stacked squad, and a heist CP payout can fund the 24 CP in one turn. No bot ever did it (best observed burst: 29), so this is a *human-player* risk to test before shipping 30/+15 as the default.
- **Speed floor.** 7 % of 30/+15 games end before round 15 (vs 0 % at 20/+10). For a "quick tactics" pitch that is fine; for a mode intended to show off banks/weather/veterancy it is too fast. Consider 30/+15 as the *default* online mode and 20/+10 as "Classic / long".
- **Veterancy saturates.** 11–13 promotions per match on a 4-unit squad means rank-ups are routine, not a reward arc. XP thresholds are `[0, 2, 5, 9]` (`VETERANCY_CONFIG`) and respawns create fresh Recruits that re-climb immediately. If veterancy is meant to matter, raise thresholds relative to damage-per-turn or make ranks persist through respawn.

## 6. Map audit

### 6.1 Per-preset gameplay (CP 20/+10 → CP 30/+15)

| Preset | Median rounds | Stalls | First HQ hit | Heists/match | Banks untouched |
|---|---|---|---|---|---|
| balanced | 31 → 26 | 0 → 0 | 12 → 6 | 1.23 → 1.10 | 17 % → 17 % |
| archipelago | 40 (avg 207) → 28 | **3 → 0** | 25 → 13 | 1.13 → 1.33 | 10 % |
| badlands | 40 → 26 | 0 → 0 | 16 → 8 | 1.13 → 1.13 | 17 % → 20 % |
| fortress | **57 (avg 389)** → 32 | **7 → 1 (23 % → 3 %)** | 22 → 12 | **0.17 → 0.20** | **83 % → 80 %** |
| open_blitz | 28 → 19 | 0 → 0 | 6 → 3 | 1.13 → 0.93 | 30 % → 27 % |

### 6.2 Board shape (60 boards per preset)

| Preset | Passable | Water | Forest | Mountain | Sand/Dunes | Buildings | Banks | Bridges | Perch gap | Cover gap | Bank-dist gap |
|---|---|---|---|---|---|---|---|---|---|---|---|
| balanced | 89 % | 10 % | 18 % | 12 % | 0 | 16 | 2.0 | 8.5 | 33 % | 14 % | 3.1 |
| archipelago | 60 % | 39 % | 16 % | 8 % | 0 | 12 | 2.0 | 23.1 | 31 % | 16 % | 4.1 |
| badlands | 99 % | 0 | 4 % | 20 % | 59 % / 25 dunes | 20 | 2.0 | 0 | 19 % | 17 % | 3.3 |
| fortress | 91 % | 8 % | 10 % | 28 % | 0 | **39** | **1.0** | 6.3 | 20 % | 10 % | 3.0 |
| open_blitz | 99 % | 0 | 6 % | **4 %** | 9 % | 8 | 2.0 | 0 | **46 %** | **33 %** | 3.4 |

- **Fortress is broken as an objective map.** The preset asks for `banks: 1` (`mapPresets.ts`), so 80–83 % of matches never breach a vault and heists drop to 0.17/match. Combined with 39 buildings and 28 % mountain it is also the slowest (`avg` 389 rounds at 20/+10) and the stall hotspot. **Set `banks: 2` minimum for every competitive preset** and treat `banks: 1` as a scenario/intel mode only.
- **Open Blitz has the worst terrain fairness.** With only 4 % mountain and 6 % forest, Sniper high ground is scarce, and the per-zone split averages a **46 % perch gap and 33 % cover gap** — one side reliably gets the high ground. Openness is the point of the preset, but three or four guaranteed symmetric perches (one per sector) would keep the sniper unit playable without densifying the map.
- **No preset is seat-biased.** Open Blitz's 63 % P0 share at 30/+15 (n=30) did not replicate: 240 fresh games gave **53 % (20/+10) and 49 % (30/+15)**. Small-sample map results in §6.1 should be read the same way.
- **All 300 boards are HQ-connected** (BFS on foot over `TERRAIN_COSTS < 90`, goal tile entered explicitly) and the HQ-to-HQ walking distance is a constant **30 tiles** on a 20×20. At ~3 tiles/turn that is ~10 rounds of pure march before contact — the root cause of the 50 % dead-turn rate and the late first HQ hit.

### 6.3 Pacing lever
Median 35 rounds at 20/+10 with contact at round 14 means **40 % of the match is approach**. Options, cheapest first: allow a forward deploy/one-time airdrop of a unit toward the centre, place HQs 6–8 tiles closer (≈22-tile walk), or resolve `AUTO` grid size for 2P to **16×16** (`resolveEffectiveGridSize` currently returns 20 for 2 players and `minGridSizeForPlayers(2)` is 16).

## 7. Combat & unit balance (per match, both economies)

| Unit | Deaths | Damage dealt | Siege damage |
|---|---|---|---|
| Scout ×2 | **7.3** (78 % of all deaths) | 70.8 → 43.8 | 24.3 → 27.9 |
| Breacher ×1 | 1.2 → 1.1 | 89.5 → 104.7 | 16.8 → 21.1 |
| Sniper ×1 | 0.9 → 1.0 | 103.2 → 105.9 | 6.6 → 13.3 |

Per unit, the Sniper deals ~4× a Scout's damage and dies ~4× less often; the Scout is 15 HP, 5 damage, 3 CP per shot. Scouts absorb 78 % of all deaths while contributing the least damage. They are not useless (cheap LoS screens, loot grabbers, 10 ammo), but the "cheap objective-grabber" identity is thin: `SECURE` is only 3.3 % and `LOOT` 8.0 % of actions. Two candidate fixes: give Scouts the cheapest Overwatch (already 3 CP) plus a capture-speed perk (2 CP `SECURE`), or make `LOOT`/`SECURE` Scout-exclusive discounts so cheap bodies own the objective layer.

Note the CP30 shift: Scout damage falls 70.8 → 43.8 while Breacher/Sniper rise — with a bigger battery the AI hands the shots to the expensive units. Any unit-utility comparison must therefore be quoted per economy.

## 8. Economy

- Heists are roughly **one per match** and **29–31 % of matches never touch a bank**. The vault is a side objective, not a loop.
- Gold is tight in normal games (median **€70–85** at the end) — the shop prices (`SHOP_ITEMS` €50–300) are well tuned for that. It only inflates (€20k–39k) in frozen matches, because the AI stops buying once it parks. So "gold inflation" is a symptom of §4, not an economy bug.
- `BANK_REWARD` never appears in the action mix because the harness (and the server path used here) runs `autoBankReward: true`. Real players choose gold vs CP; the 12-CP intel vault is the more interesting option, since it can overflow the battery (§3).
- Upkeep is not the constraint: gold income (€10/turn + €5/building) never blocks respawns in these samples (`SPAWN` 2.4–3.2 % of actions, 0 `negGold` matches).

## 9. Correctness & determinism

Clean across 690 matches: **0 crashes, 0 rejected bot actions, 0 negative gold, 0 CP-over-cap, 0 stuck `bankRewardPending`, 0 completed-unit leaks**. The `prepareAction` → `applyAction` contract holds, and the Blitz mutator wires `maxCp`/`regen`/`p1Round1Cp` correctly (`cpRulesMismatch=0` in every arm). The engine is solid; the problems are behaviour and content.

**Seed replay is broken.** Two identical runs of the same 4 seeds produced different matches:

```
run1: STD1BA winner=0 rounds=36 kills=11 | STD3BA winner=1 rounds=26
run2: STD1BA winner=1 rounds=36 kills=10 | STD3BA winner=0 rounds=45
```

Non-determinism sources: AI tie-break jitter (`AIBrain.ts:221, 458, 608, 786`), base artillery damage (`CombatRules.ts:333, 341`), and supply-drop landing (`apply.ts:1057–1073`) all call `Math.random`. Map generation *is* seeded (`createSeededRng`), so a shared map code (`encodeMapCode`) reproduces the board but not the match. That breaks "Retry this seed", verified replays, and any seed-based tournament format. Threading a seeded RNG through `GameState` (and using it in those five places) would fix it.

## 10. Recommended order of work

| # | Work | Why (evidence) |
|---|---|---|
| 1 | Broaden the AI `lastStand` trigger + add a no-HQ-damage aggression clock + a stalemate backstop | 6.7 % of 20/+10 games never end; 23 % on Fortress; 1,135 consecutive Overwatch orders |
| 2 | Ship **30/+15 as the default**, keep 20/+10 as "Classic" (or pick 25/+12 after human playtests) | median 35 → 25 rounds, stalls 6.7 % → 0.7 %, HQ wins 34 % → 44 %, dead turns 50 % → 43 % |
| 3 | `banks: 2` minimum for competitive presets; fix Fortress | 80–83 % of Fortress matches never breach a vault |
| 4 | Add per-zone terrain parity (or default `MIRRORED` for online) | 46 % perch gap / 33 % cover gap on Open Blitz |
| 5 | Shorten the approach: 16×16 for 2P, closer HQs, or a forward deploy | 30-tile walk = ~10 rounds of march; 50 % dead turns; first HQ hit round 14 |
| 6 | Make the RNG seeded end-to-end | same-seed runs diverge (AI jitter, artillery, drops) |
| 7 | Give Scouts an objective identity; re-tune veterancy thresholds | Scouts: 78 % of deaths, lowest damage per unit; 11–13 promotions/match |
| 8 | Audit the stacked-Sniper HQ burst before defaulting 30/+15 | 3 sieges = 57 dmg / 24 CP vs a 50 HP HQ |
| 9 | Surface heist CP overflow in the HUD | observed 21.9 CP spent in a 20-cap turn via a vault payout |

## 11. Limits of this audit

- Bots only. Human players will spend CP more aggressively (burst sieges, Overwatch baiting), so the CP30 numbers are a floor on lethality, not a ceiling.
- One mode, one squad, two players: Conquer, default 2/1/1, fog off, no Doomsday, no Scarcity/Ironman, no 3–6 player boards.
- Weather is on and reshuffles every 5 turns, but its effects were not isolated.
- The 4,000-action cap defines "stall"; games at 1,900 rounds are also counted in the age-80+ bucket, so averages including stalls are reported separately from the stall-free medians.
- 30 games per map/variant is enough for pacing and small for win-rate claims; the Open Blitz retest (240 games) is the model for any future map-balance claim.
