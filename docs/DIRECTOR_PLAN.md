# Director Plan — Making Every Turn Feel New

A game-director's plan for Tactical Tiles: what to add so that each turn, each round and each
match contains something the player has not seen yet — without adding unit types, maps or
side systems the engine cannot cheaply support.

This builds on the existing documents:

- `GAME_REVIEW.md` — milestones and roadmap
- `GAMEPLAY_EXPERIENCE_SIM.md` — the playtest numbers this plan is measured against
- `GAME_EVALUATION.md`, `CP_SIMULATION_AUDIT.md` — balance audits
- `KILL_CAM_AUDIT.md` — the FX/kill-cam grammar and earlier feature sketches
- `PRODUCT_STRATEGY.md` — positioning

---

## 0. The one rule

> Every turn must contain a **FIRST**, a **CHOICE** or a **CONSEQUENCE**.

- **FIRST** — an event that has not happened yet this match (a new weather front, a
  flashpoint lighting up, a promotion offered).
- **CHOICE** — two or more *real* CP options whose outcomes differ (not "move here or move
  there").
- **CONSEQUENCE** — the previous turn's spend visibly pays off now: a bank completes, a
  sniper's angle opens, a shove created the lane.

If a turn has none of the three, it is a dead turn, and dead turns are the only thing the
player actually feels as boredom. Content does not fix dead turns; **tempo** does.

### Why this framing, and not "add more stuff"

The sim already tells us where the game leaks:

| Symptom | Measured | Implication |
| --- | --- | --- |
| Dead turns | ~30% of all turns | Nearly a third of the match is "nothing" |
| Turns with 2+ real options | 51% | Half the time the "choice" is fake |
| First payoff | round 3.3 (CP30, 2P) | The hook arrives too late |
| Median unspent CP | 3.4–6.6 | The battery is not the constraint; options are |
| 2P CP30 match length | 22 rounds | Long enough that flat stretches are lethal |
| More banks | 1.08 → 0.71 payoffs, two-option 25% | **Sideways content makes it worse** |
| 5P eliminated players | sit out ~42% of the match | Dead time for real people |

The lesson is inverted from typical advice: adding a fourth unit, a fifth map feature or more
banks **lowers** payoff density, because it dilutes the map and gives players more ways to do
nothing. Everything below is therefore sorted by *fixes an existing leak* before *adds a new
toy*.

---

## 1. Per turn — make each turn a decision with teeth

### 1.1 CP Overclock (tempo debt) — highest value

On your turn you may take up to **+5 CP** immediately, never pushing the battery above its
normal maximum. Every point taken this way is repaid
from your regen over the next turns (a visible debt badge), and the debt carries a small
interest: `+1 CP per 5 overdrawn` if not cleared within two rounds.

- Why: median unspent CP of 3.4–6.6 means players routinely *cannot* afford the play they
  want. Overclock converts "I can't" into "I can, and now it costs me next turn" — which is a
  real choice with a visible consequence (the CONSEQUENCE half of the rule).
- Expected effect: fewer dead turns, earlier first payoff, and a bigger spread between
  cautious and aggressive play, which is what makes replays differ.
- Implementation: `CP_SYSTEM` in `packages/engine/src/constants/Config.ts`, plus a new action
  case in `apply.ts`; expose debt in the player view so the UI can show it.

### 1.2 Momentum refunds — the "payoff" loop

Refund CP on the turn something resolves, so a good turn *funds* the next one:

- **Kill:** refund 2 CP (Scout), 3 (Breacher), 4 (Sniper) — i.e. a partial refund of the shot.
- **Bank completion:** refund 4 CP.
- **Building capture:** refund 3 CP.
- **Rescue/defuse:** refund 3 CP.

Cap the total refund per turn at 6 CP so the loop cannot run away. This is the single cheapest
way to make a turn feel like a story beat: "I killed the sniper, and that gave me the tempo to
push."

### 1.3 Free verbs (0–1 CP) — cut for phase 1

Evaluated and dropped. The three proposed verbs were **Mark** (Scout, 0 CP: +1 damage from the
next attack), **Shove** (Breacher, 1 CP: push an adjacent enemy one tile) and **Brace** (any
unit, 0 CP: +1 armour, cannot move).

- The premise — "at 0 CP a player has no legal action" — does not hold here: 30 CP battery,
  +15 regen, most actions 2–6 CP, and the sim measured 0.00% of turns blocked by CP. The real
  dead turn is "no good target", which Mark and Brace do not fix.
- The cost is permanent: three action types, validation, AI candidates, animations and tutorial
  text. Shove needs a forced-movement ruleset (lava, mines, water, map edges, occupied tiles);
  Brace rewards standing still; Mark duplicates the existing Crossfire bonus.
- Revisit only if phase-1 measurement shows no-action turns above 10% after overclock and
  refunds. If so, add **Brace only**, as a 0 CP alternative to passing.

### 1.4 CP residue sink — cut

Reserve and Suppress added end-of-turn bookkeeping and a second decision phase for a resource
that already has good sinks. Overclock and momentum refunds turn residue into tempo instead of
storing it.

### 1.5 Promotion as a choice — locked spec

Current rank bonuses stay exactly as they are: Veteran is +20% max HP and +2/+2/+1 ammo; Elite
is +1 Scout vision, −2 cover damage for the Breacher, and +2 damage / −1 attack cost for the
Sniper; Ace is +20% max HP again plus the Scout/Breacher damage and Scout attack-cost bonuses.
The new part is **one additional perk, chosen once, at Veteran (rank 1)**. Elite and Ace remain
automatic stat bumps — no second or third choice, so a promoted unit creates one decision, not
three.

**Timing.** Promotions happen during someone else's action, so the pick is deferred and never
blocks play. A unit at rank 1 without a perk has a pending promotion. On the owner's turn the
HUD shows a **FIELD PROMOTION** card; choosing is a 0 CP action that does not mark the unit as
acted and can be done at any point in the turn. A unit killed before choosing loses the pick.
The AI chooses at the start of its turn.

| Class | Perk A | Perk B |
| --- | --- | --- |
| Scout | **Relay** — +1 CP regen while alive (cap +1 per player) | **Skirmisher** — +1 damage when attacking from cover |
| Breacher | **Bulwark** — adjacent allies take 1 less damage (non-stacking) | **Sapper** — +2 damage vs Barriers |
| Sniper | **Cold Bore** — +2 damage if it has not moved this turn | **Overwatch+** — +2 damage on Overwatch shots |

Two concepts from the original draft are deferred rather than half-built:

- **Ghost** (invisible while stationary in cover) needs visibility exceptions on server, client
  and AI, and hidden units with limited counterplay. It belongs in a later stealth pass.
- **Demolition** (walls cost 1 less) is invisible in this economy: walls are bought with gold,
  and 43% of players can already afford a €150 item. Sapper gives the Breacher a concrete,
  loud wall answer instead.
- **Overwatch+** is defined as +2 damage because "crit" is only a visual flag for damage ≥ 7,
  not a damage rule.

### 1.6 Phase 1 build order and gates

| Step | Scope | Acceptance gate |
| --- | --- | --- |
| 1. CP Overclock | `OVERCLOCK` action (+1–5, once per turn, never above the normal battery cap), `playerCpDebt` and a separate once-per-turn borrow flag, automatic repayment from next regen, HUD debt badge, AI borrows only when a kill/capture/bank is short by ≤3 | Borrow, repay, cap, double-borrow rejected; sim run recorded |
| 2. Momentum refunds | Kill 2/3/4 CP by class; bank breach 4; building capture 3; automatic, cap 6 CP per turn; refunds pay debt first, then add CP | Per-source, cap and debt-first tests; economy + playtest sims |
| 3. Promotion choice | `perk` field, `CHOOSE_PERK` action, six perk effects, AI preferences, HUD card + unit chip + receipt lines | Per-perk tests, wrong-class / rank-0 / duplicate-pick rejections; playtest sim |
| 4. Report | Deltas written back here | Median unspent CP ≤3 (baseline 3.4–6.6); no-action turns counted; rounds stay 26–33; stalls stay 0% |

Overclock carries no interest: with a 10 CP regen and a 5 CP maximum debt, any debt clears on
the next turn, so an interest rule would never fire. Debt and refunds are automatic — no prompt,
no claim action.

### 1.7 Phase 1 — built and measured

All three steps are implemented: `OVERCLOCK` and `CHOOSE_PERK` actions, `playerCpDebt` and
`playerCpRefunded`, automatic debt collection and refunds (refunds pay debt first), all six perk
effects, AI perk picks, and the HUD debt badge / promotion alert / promotion card.

Sims on the same seeds, HARD bots, 10 matches per CP cell:

| Metric | Before phase 1 | After phase 1 |
| --- | --- | --- |
| Median rounds | 29.4 | 27.5 |
| Dead turns | 32.0% | 30.6% |
| Stalls | 0% | 0% |
| Rejected actions | 0.00–0.04% | 0.00–0.02% |
| Respawns per match (2P) | 4.00 | 4.00 |
| €150 item affordable | 43% of turns | 48% of turns |

Nothing exploded: no stall cells, no rejection spike, and match length stayed inside the
26–33 target band on the median. The changes are within the noise of a 10-match sample, so this
is a safety pass, not proof of a pacing shift.

Caveats: the engine still has unseeded AI tie-breaks; individual cells swing hard (one 6P cell
hit the 80-round cap). The sims do not export CP residue or perk-pick counts, so the "median
unspent CP ≤3" gate is not measured yet. The HUD was typechecked but not clicked through, and
the AI takes the safe default per class (Relay / Bulwark / Cold Bore), so the alternate half of
each pair is currently a human-only choice.

**Post-measurement CP change (current default):** the battery is now **30 max / +15 regen**
(Player 1 opens at 22). A fresh 10-match sample lands at a median of ~22 rounds (2P 22–24,
3P 12–14, 4P 24–26, 5P 23–24, 6P 24–27), with dead turns 10–33%, zero stalls and rejects at
most 0.03%. That is the CP30 profile the old matrix already measured, now the default. Classic CP is the
opt-in slow mode: **20 max / +10 regen / 15 opening CP**. Its UI labels state those numbers,
the mutator test asserts every Classic value is below the default, and the sim A-matrix
compares CP20 (Classic) against CP30 (default); the F packages combine Classic with HQ35.
The CP audit and paired-CP scripts apply those batteries to `CP_SYSTEM` instead of only
relabelling them.

---

## 2. Per round — one authored event on top of the sim

### 2.1 Situation Cards (cut)

> Cut after review: only Ceasefire had a real decision, and even that needs a different turn-based
definition. Supply drops will be scheduled separately; Bounty belongs in underdog contracts;
EMP and Blackout duplicate other systems or tax verbs without creating a choice.

A single shared modifier, visible to everyone, resolved at end of round:

- **Supply Drop** — a crate lands on a telegraphed tile; first unit to reach it gets +5 CP.
- **EMP** — this round, overwatch and reload cost double; aggression is rewarded.
- **Bounty** — the current kill leader is marked; killing that unit pays 6 CP.
- **Blackout** — fog of war applies even if disabled, for one round only.
- **Ceasefire** — no attacks on the first half of the round; repositioning round.

Why this works where "more content" fails: the card changes the *value* of existing verbs for
exactly one round, so it produces novelty without new assets, and it is fully telegraphed, so
it creates anticipation rather than confusion. Deal from a small deck, no repeats within a
match, so a 22-round game sees most of them once.

### 2.2 Weather as an action (cut)

> Cut: weather already rerolls every 5 turns. A CP-pin action is a low-impact sink with extra UI;
make the forecast more visible instead.

Weather already rerolls every 5 turns per Voronoi zone (`CLEAR, SCORCHED, MONSOON, FOG,
TAILWIND, SANDSTORM`). Right now it is scenery. Make it something a player can *do*:

- **Weather Pin** (3 CP): reroll the weather in one zone, once per match per player.
- On reroll, show the front moving across the map for ~1s, with the affected tiles tinting —
  this doubles as a camera beat (see §4).

Now the forecast strip is a resource: players plan around it, and one player can break the
other's plan with it.

### 2.3 Doomsday escalation track (shipped)

Only active when **Deathmatch + Doomsday** is enabled. It follows the ring clock, so it works at
every player count and stays out of Conquer:

1. **Skirmish** — before the first ring melts: baseline CP.
2. **Collapse** — first ring melts (engine turn 30): all players get **+2 CP regen**.
3. **Meltdown** — third ring begins (engine turn 40): all players get **+4 CP regen total**.

The HUD shows the countdown before Collapse and the live stage afterward. The lava itself
supplies the damage escalation; no separate damage or reload exceptions are needed.

### 2.4 Telegraphed flashpoints (cut)

> Cut: overlaps with scheduled supply drops and needs map-specific objective/AI work. Keep it as
a scenario modifier if it is ever needed.

Two rounds ahead, announce a contest objective: "Round 12: the northern bridge becomes a
supply line — hold it for 6 CP a round." Players spend the two rounds *before* it positioning,
which is exactly the kind of forward planning that makes a match feel authored.

---

## 3. Match arc — give the whole game a shape

Phase 2 changed what a turn is *worth*. Phase 3 changes why the *next* round matters: contact
pays immediately, one contract gives every round a named goal, and a Final Push turns the finish
into a climax instead of a CP crawl. §3.4 keeps eliminated players in the match with limited map
effects; external viewer seats are still §9.5 work.

### 3.1 First contact pays (shipped)

The first **direct ATTACK** or **Overwatch hit** between two different players: attacker **+3 CP**,
defender **+2 CP**, once per match, then the camera runs the pair push (§4).

- Direct only. Mines, splash, bank and HQ damage do not count — those are opening moves, not the
  moment two armies meet.
- The defender is paid too. Being shot is the moment you enter the match; the +2 is the "you can
  answer" grant, and it stops first contact from being a free tempo gift to the aggressor.
- Fires **once per match globally**, not once per pair. In 4P+ the second and third pairs do not
  get a second helping.

### 3.2 Shared contracts with round gates (shipped)

One contract at a time, shared by the whole table. Dealt at the start of a round, visible in the
HUD, **first completion only**, expires when the round ends, no repeats in a match. Round 1 gets
its card as the game is created (`withOpeningContract`), so the strip is never empty; the deck
only runs in PVP matches, never in challenge ops.

Three gates decide whether a contract can be dealt. All three must pass:

1. **Tier opens by round.** The deck is tiered and a tier's earliest round is a hard floor.
2. **The board can support it.** Never deal a contract nobody could complete: Ace Hunt needs an
   Elite on the board, Vault Race needs a funded bank, a 3-kill contract needs 8 living units.
3. **The match is still live.** No deal once a winner exists or with fewer than two players alive.

| Contract | Tier | Opens | Board gate | Pay |
| --- | --- | --- | --- | --- |
| First Blood | 1 | R1 | no kill yet this match | +4 CP |
| Land Grab — secure a building | 1 | R1 | a neutral building exists | +4 CP, +€50 |
| Skirmish — deal 10 damage | 1 | R1 | — | +4 CP |
| Breakthrough — destroy a unit | 2 | R4 | — | +6 CP |
| Vault Race — complete a heist | 2 | R4 | a bank holds gold | +6 CP, +€50 |
| Overwatch Kill | 2 | R5 | an enemy unit is in range of one of yours | +6 CP |
| Crossfire Kill | 2 | R6 | you field 3+ units | +6 CP, +€50 |
| Demolition — destroy a barrier | 3 | R8 | a barrier stands | +8 CP |
| Ace Hunt — kill an Elite or Ace | 3 | R8 | any player has an Elite+ unit | +8 CP, +€75 |
| Purge — destroy 2 units | 3 | R10 | 6+ units alive | +8 CP |
| Wipe — destroy 3 units | 3 | R14 | 8+ units alive, you field 4+ | +10 CP, +€100 |

Why the gates matter: "destroy 3 units" at round 2 is not hard, it is **impossible** — a 30 CP
battery buys two attacks, the board holds four units, and the players have not met yet. A contract
that cannot be completed is a dead HUD element, and a dead HUD element teaches players to ignore
the HUD. The round floor is also what makes the deck read as a story: skirmish goals first, first
blood and heists next, demolition and ace hunting once the armies are built.

**Tier follows the match, not the clock alone.** Once Doomsday reaches **Collapse** (turn 30) the
tier floor is 3 for the rest of the match; during **Meltdown** only the capstones are eligible.
Same coupling as §2.3 — the ring clock is the match clock.

**Each card runs a three-round window** (`CONTRACT_DURATION_ROUNDS`), so a table actually has time
to finish it; progress accumulates while it is live and the HUD shows the rounds left. A card is
only replaced after its window closes — an unclaimed one then counts as a miss, the next deal
drops one tier (if a lower card is left) and doubles the underdog bonus. An unclaimable contract
must not be replaced by the same contract. When the deck runs dry the cycle refreshes instead of
leaving the strip empty.

**Underdog bonus:** the last-place player, if they are the one who completes it, gets an extra
**+2 CP and +€50** (doubled to +4/+€100 after an expired contract). The bonus follows the
*completion*, not the deal, so the leader can still race them for it.

**Capped CP becomes gold.** A CP reward that would overflow the battery pays the excess out at
**€15 per CP** (`CP_OVERFLOW_GOLD_RATE`), priced off the verbs — a 75€ mine does about what a 5 CP
attack does. A reward is never silently swallowed because the battery happened to be full.

**HUD:** one strip under the round counter — name, requirement, reward, progress pip (`2/3`), and
the underdog tag when it applies.

**AI:** bots add contract progress to their action score (kill, capture and heist weight +50%
while that contract is live). Without it they lose every race and the system is free CP for
whoever reads the HUD.

### 3.3 Final Push (shipped)

One token per player, once per match, granted by match state rather than a fixed round:

- **Deathmatch + Doomsday:** granted at **Collapse** (turn 30).
- **Deathmatch without Doomsday:** granted when total living units ≤ 4, or when any player is down
  to 1 unit, whichever comes first.
- **Conquer:** not used. The base is already the clock.

Using it on your turn refills CP to max and clears Overclock debt. No extra turn, no free unit, no
damage. It is one full battery at the exact moment the match is decided, so the last rounds are
the ones with the most actions in them. HUD shows a token beside the CP bar that pulses on grant
and greys out when spent; grant and use both log to the table.

### 3.4 Spectator attacks — eliminated players (shipped)

Not external viewers: a **seated player whose army is gone** keeps a way to affect the match
instead of idling until the scoreboard. No spectator seat, no `/watch` route and no delayed view
are involved — the eliminated player is still a player, still connected, and already has a
fog-honest view.

**Cadence is the whole design.** An eliminated player who can act every round is a second, hidden
player; one who acts every four rounds is weather.

- **One window every two rounds**, rounds 3, 5, 7, … (`isSpectatorWindowRound`), rotating through
  the eliminated seats in seat order. With eliminated P3 and P5: P3 gets 3, 7, 11, 15 and P5 gets
  5, 9, 13, 17. If P3 fires on 13, P5's next window is 15 and P3 is back on 17.
- **One effect per window.** The window belongs to the round; firing consumes it and standing down
  consumes it. No banking a window for later.
- **It is not a turn.** The active player keeps playing; the eliminated seat acts out of turn and
  `prepareAction` validates that the action comes from the current window holder.
- **Map, never a player.** Effects are map-level or underdog-tilted, never aimed at a named player:

  | Effect | What it does |
  | --- | --- |
  | Static Storm | 2 damage around a random empty tile. Cannot kill. |
  | Supply Drop | A crate lands on a random open tile. |
  | Repair Surge | Last place's most damaged unit heals 5. |
  | Bank Boom | Every unbreached vault gains €50. |
  | War Levy | Every surviving player gains €30. |

- **Cannot decide a fight.** No effect may reduce a unit below 1 HP, damage a building, or grant
  XP, gold or kill credit. Storm damage is applied raw, with no attacker, so no bounty and no
  veterancy.
- **A setup switch, not a rule.** `Eliminated Player Attacks` sits under GOLD ECONOMY on the setup
  screen and in the online host rules (`disabled` for non-hosts during the lobby). **On by default**,
  locked when the match starts. Off means no windows at all.
- **AI seats take their windows too.** A bot that is out of units fires one effect on its window
  (server bots and full bot simulations alike), so a simulated match never leaves eliminated seats
  silently skipping their attacks.
- **The console, not an overlay.** The eliminated player's roster card becomes a **Spectator
  Console**: every attack is listed with its description, and the card states the exact window
  state — `WINDOW OPEN`, `USED` with the next window round, `STOOD DOWN`, `STANDBY` with the next
  round, or `OFF` when the setup switch is off. Buttons are disabled whenever the window is not
  theirs to spend, so "can I act?" is answered without opening a log.

### 3.5 What Phase 3 does *not* touch

- No new unit, terrain or building.
- No contract in the opening two rounds that needs more than one attack to finish.
- No spectator ability that can kill, siege or pay a bounty.
- No change to Conquer scoring.

---

## 4. Camera grammar — the visual counterpart of the same rule

The FX layer (`apps/web/src/core/graphics/fxTimeline.ts`, `killCam.ts`) already has
`FULL`/`SHORT`/`OFF` and tiers `ATTACK`/`MICRO`/`CINEMATIC`/`STRUCTURE`, capped at 4s. The
problem is not the camera quality, it is *policy*: the camera only reacts to violence, so a
quiet turn looks like nothing happened.

Adopt a **camera budget per turn** (one major move, one minor move):

| Beat | Shot | Budget |
| --- | --- | --- |
| New weather front | Slow push following the tint across zones | major |
| Situation Card dealt | Quick card slam + 0.4s push to the objective tile | minor |
| First contact | Slow pair push, both squads framed | major (once/match) |
| Bank secured | 0.6s orbit on the building, coins FX | major |
| Promotion offered | 0.8s push on the unit, perk cards slide in | major |
| Kill | existing kill cam (unchanged) | major |
| Nothing happened | **Ambient drift**: slow 1.5s pan toward the highest-threat enemy | minor |
| Turn start (opponent's last move) | 1s "threat peek" at the unit that ended nearest you | minor |

Two rules to enforce in `fxTimeline.ts`:

1. **Never show nothing.** If a turn produced no qualifying beat, play the ambient drift. The
   camera always moves *toward* something interesting, so the eye always has a reason to stay.
2. **Never two majors in a row** and never exceed 4s total per turn — protect the pace the
   `KILL_CAM_AUDIT.md` already established.

---

## 5. Build order

Do these in order; each is independently shippable and measurable.

1. **CP Overclock + momentum refunds + one free verb** (§1.1–1.3).
   Validate with `cd packages/engine && bun sim-playtest.ts`.
   Targets: dead turns below 20%, two-option turns above 65%, first payoff before round 3.0.
2. **Doomsday escalation track** (§2.3). Deathmatch + Doomsday only.
   Target: endgame CP tempo rises without adding stalls or rejected actions.
3. **Promotion choice** (§1.5).
   Target: every promoted unit has a distinct perk identity.
4. **Camera grammar** (§4). Ship the ambient drift and turn-start threat peek first — they are
   the cheapest and they affect every single turn.
5. **First contact CP** (§3.1). Shipped: direct ATTACK and Overwatch hits, once per match.
6. **Contracts** (§3.2). Shipped: deal/claim/expire state, tier and board gates, HUD strip, AI
   weighting. Target: 35–55% of contracts claimed, and zero deals whose board gate was false.
7. **Final Push** (§3.3). Shipped: trigger, token, CP refill; bots spend theirs.
8. **Spectator attacks** (§3.4). Shipped: eliminated-player windows, the effect deck and the
   `Eliminated Player Attacks` setup toggle. External viewer seats remain §9.5 work.

---

## 6. How to know it worked

Re-run `bun sim-playtest.ts` before and after each batch and compare:

- dead-turn % (target: <20%)
- % of turns with 2+ real options (target: >65%)
- time to first payoff (target: <3.0 rounds)
- median unspent CP (target: <3)
- match length spread across CP settings (want tournaments shorter, not longer)
- contract claim rate (target: 35–55%) and rounds with a live contract (want 100%)
- come-from-behind wins in 5P — the only real test of the underdog lever
- elimination sit-out % in 5P (target: <25%)

If a change improves novelty but worsens payoff density, it is the banks:3 mistake again —
revert it rather than layering another system on top.

---

## 7. What not to do

- Do not add a fourth unit type before dead turns are under 20%. It spreads the map thinner.
- Do not add more banks, more terrain types or bigger maps; the sim measured the opposite effect.
- Do not gate any of this behind new art: every item above reuses existing FX, existing verbs
  and existing CP. Novelty here is *scheduling*, not assets.
- Do not let camera majors stack; pacing is the thing that makes a 22-round match watchable.

---

## 8. Tactical Weapons (the one-shot abilities)

Idea under review: each player gets a **tactical weapon** — a single-use, map-scale ability
(multi-target air strike, radar sweep, …) — either bought in the shop with Euros or granted
free on a timer (e.g. every 10 turns you pick one).

```chart
{
  "type": "bar",
  "title": "Chart title",
  "x": "label",
  "series": [
    {
      "key": "value",
      "label": "Value"
    }
  ],
  "data": [
    {
      "label": "A",
      "value": 3
    },
    {
      "label": "B",
      "value": 5
    },
    {
      "label": "C",
      "value": 4
    }
  ]
}
```

### 8.1 The verdict: shop, not a timer

The economy already grants the timer, but the player holds the dial.

- `GOLD_SETTINGS`: start 150, `+10/turn`, `+5` per owned building, heist pays `200` gold.
- A Common at 75–120 is affordable in the **first three rounds** on start gold; a Rare at
  150–250 lands **around round 8–12** on income alone — the same cadence as "free every 10
  turns" — except the player can speed it up by holding buildings or heisting, or slow it down
  by spending on units instead.
- A hard "every 10 turns" metronome is predictable: players learn the beat, and the ability
stops being an event after the first match. It also gives a second, invisible currency (the
clock) that the opponent cannot read — the opposite of the telegraphing we want.
- A 22-round 2P match gives only **two** free picks. Too rare to be a mechanic, too regular
to be a surprise.

**Recommendation: buy them from the existing shop as a new `TACTICAL` item class**, with two
supporting tweaks so the shop is not just a rich-get-richer lever:

1. **One free starter pick at round 2** from a 3-card offer, **Common only**. The pick costs no
   gold, but it counts as that player's tactical for round 2 and for the turn it is used, so
   nobody gets two weapons in one turn. The offer expires at the end of round 2. Only Common is
   ever free — Rares and Epics are always paid. This puts a tactical beat inside the first three
   rounds, where the sim says payoff arrives too late (round 3.3).
2. **Heists fund weapons.** Banks/heists already pay 200 gold; making gold the path to
   tactical weapons turns the heist into the *reason* you buy a weapon. That raises heist
   payoff without adding more banks — the exact mistake (`banks:3` dropped payoff density
   1.08 → 0.71) this plan avoids.

So: shop primary, plus a free early pick, plus one earnable coupon per heist. The timer
version is the weakest of the three.

**Tier gates (adopted).** Rarity is also an unlock round, not just a price: **Common opens at
round 2, Rare at round 5, Epic at round 10** (`TACTICAL_TIERS`). Nothing is buyable in round 1 —
the opening turn belongs to units, and the first tactical beat is the free round-2 pick. Gold
decides whether you can afford a weapon; the round decides whether it exists yet. That turns
one long price list into three shop eras — the opening (cheap, tactical), the mid-game plateau
(denial and information), and the endgame (map-scale strikes) — and it stops an early heist
from buying the finale. The shop card for a locked weapon shows `OPENS ROUND N`, so the player
can plan around it instead of discovering it.

### 8.2 The calibration rule: a tactical never one-shots a healthy unit

Current numbers: Scout 15 HP, Breacher 30 HP, Sniper 10 HP; damage 5 / 10 / 20.

**Design rule (adopted): every tactical weapon deals at most 8 damage, and no tactical
instance may deal 10 or more.** Since the Sniper has the lowest HP pool at 10, 8 damage
mathematically cannot kill *any* unit that is at full health — while it still leaves a Sniper
on 2 HP for a 3 CP Scout shot to finish.

| Weapon damage | vs full-HP Scout (15) | vs full-HP Breacher (30) | vs full-HP Sniper (10) | Judgement |
| --- | --- | --- | --- | --- |
| 5 dmg | 10 left | 25 left | 5 left | Too weak — a scratch, no FIRST |
| **8 dmg** | **7 left** | **22 left** | **2 left** | **The sweet spot: always survivable, always meaningful** |
| 10 dmg | 5 left | 20 left | **dead** | Breaks the rule — no |
| 12 dmg | 3 left | 18 left | **dead** | Mars a Sniper's only advantage: being unseen |

Why 8 and not "somewhere under 10":

- **It is a setup, never a solve.** 8 damage plus any surviving attack from a real unit is a
  two-action combo — the tactical *creates* the kill and the unit *takes* it. That is a much
  better turn than "I pressed a button and a Sniper died for free."
- **It cannot be priced into fairness at 10.** A Sniper shot is 20 damage for 8 CP *and* needs a
  10 HP unit standing in line of sight. A gold-only 30-damage strike has no such cost, so no
  price makes it honest — it just becomes a tax on ever fielding a Sniper.
- **The rule is testable.** One assertion — `TACTICAL_MAX_DAMAGE < MIN_UNIT_HP` — protects every
  future weapon, including ones we have not designed yet. Any proposed 10+ weapon must be
  redesigned, not re-priced.

The other half of the fix is unchanged and still required:

- **Telegraph it.** AoE strikes mark their target tiles at the end of your turn and land at the
  start of your *next* turn, so both players get one turn to scatter. Survivability then comes
  from two directions at once — the damage cap *and* the warning. (This also gives the camera
  its best new shot: the red rings and the incoming whistle.)
- **One strike per target, not stacked.** A unit caught in two overlapping strikes takes only
  the highest instance, so a triple strike is area denial, not a hidden nuke.

### 8.3 The roster

Priced against units (Scout 50, Breacher 150, Sniper 300) so buying a weapon always competes
with buying a body — that competition is the whole decision.

**Status: implemented.** The rules below live in `packages/engine/src/tactical/` — `catalog`
(items, tiers, free pick), `geometry` (footprints, smoke LOS), `rules` (purchase legality),
`resolve` (per-weapon effect) and `ticks` (telegraph and round-end hazards). The shop card is
`apps/web/src/components/ui/TacticalShop.tsx`. FX animations are still to come. Buying is using
— a tactical resolves (or arms its telegraph) as part of the purchase, so there is no inventory
to manage. Overclock Core is the one effect that is carried. The free round-2 pick draws from
the Common row only; it is the one weapon that costs nothing.

**Common — opens at round 2**

| Weapon | Cost | Rules |
| --- | --- | --- |
| **Minefield Snapshot** | 75 | Reveal every enemy Land Mine and Tunnel on the map to you for 1 round. Private: the rest of the table is not told. Does not reveal units. |
| **Recon Drone** | 100 | Place a sensor on a visible tile: 5 vision for 3 rounds; destroyed when an enemy unit enters its tile. Without fog it reveals enemy mines and tunnels within 3 tiles instead. |
| **Smoke Screen** | 120 | 3×3 zone for 2 rounds. Blocks line of sight both ways: no sniping and no overwatch through or into it. Does not block movement, and does not reduce fog vision. |

**Rare — opens at round 5**

| Weapon | Cost | Rules |
| --- | --- | --- |
| **Radar Sweep** | 150 | One full round of server-side sight: every enemy unit is visible to you. Public — the log announces it. Without fog, reveals enemy mines, tunnels and telegraphed strikes for that round instead. |
| **Precision Strike** | 175 | 8 damage to one visible tile, telegraphed 1 round. Hits units and non-HQ structures. A full-HP Sniper survives on 2 HP. |
| **Sabotage** | 175 | Drain 8 CP from one visible enemy battery, or strip one non-HQ structure's specialization. |
| **Napalm Line** | 250 | 1×4 line burns for 2 rounds: 4 damage on entry and 4 at each round end. Units only, friendly fire on. Exact clock in §8.3a. |
| **Paradrop** | 250 | Spend one respawn slot to land a unit at full HP on any visible tile at least 4 tiles from your HQ. It cannot act on the turn it lands. |

**Epic — opens at round 10**

| Weapon | Cost | Rules |
| --- | --- | --- |
| **Carpet Run** | 275 | 8 damage to three adjacent visible tiles, telegraphed 1 round. Friendly fire on. |
| **Artillery Barrage** | 300 | 10-tile axis-aligned lane, 1 or 2 wide, telegraphed 1 round, then the shells walk it: 8 damage to every unit in the lane, once. Exact rules in §8.3a. |
| **Overclock Core** | 300 | Each of your next three attacks refunds 2 CP, never above the battery cap. |

**Why the two cuts**

- **Decoy Hologram (130, Common) — cut.** A fake unit is either a real entity or a client lie.
  As a real entity it is a 130g body that soaks a 20-damage Sniper shot, which is a unit purchase
  in disguise; as a client illusion it cannot survive server-authoritative fog, replays or the
  kill cam. Its only counterplay is "waste a shot", which taxes attacking instead of asking a
  question.
- **EMP Burst (200, Rare) — cut.** It taxes existing verbs (overwatch, reload) inside a zone
  instead of adding a new one — the same reason §2.1 cut EMP from the situation deck. It needs
  two rounds of per-tile debuff state and a new "cannot reload" validation path for an effect
  the player mostly experiences as a greyed-out button. Overwatch already has a cheap answer:
  Smoke blocks its line of sight.

**The shop still answers itself where it should.** Snapshot answers mines, Smoke answers snipers
*and* overwatch, Sabotage answers a turtled structure. Damage weapons are not answered by buying
a mirror — they are answered by moving, which is free and always available (rule 2, §8.5).

### 8.3a Exact rules for the two area weapons

These are the two weapons whose wording caused real ambiguity; they are specified here rather
than in a table cell, and the engine should implement this text literally.

**Napalm Line — the burn clock**

- **Shape and placement.** 4 tiles in a straight horizontal or vertical line. The anchor tile
  must be visible; the line may run into fog.
- **Burn window.** Placed during round N, burns until the end of round N+1. That is exactly two
  round ticks, regardless of player count.
- **Trigger 1 — entry.** A unit that moves onto a burning tile takes 4 damage, once per move,
  no matter how many burning tiles it crosses. A unit that starts its move on a burning tile
  takes no entry damage for standing still.
- **Trigger 2 — round end.** At the end of round N and the end of round N+1, every unit standing
  on a burning tile takes 4.
- **So yes: a unit still standing in it in the second round takes damage again.** A unit that
  stands in the fire from placement to burnout takes 4 + 4 = 8, the per-instance cap. A unit
  that walks in and out in the same round takes 4 once (entry), and nothing at round end.
- **Per-instance total cap.** One Napalm Line can deal at most **8 total** to the same unit,
  however many times it enters, leaves and re-enters. Track damage per unit per line and stop
  paying out at 8. Two overlapping lines do not add: each tick the unit takes the highest single
  line's damage.
- **What it does not do.** It never damages HQs, banks, bridges, structures or loot. It does not
  block movement or line of sight. It ignores terrain defense and never triggers overwatch,
  crossfire, momentum or first contact.
- **Visibility.** Burning tiles are public while they burn, even in fog — fire is self-revealing.
  It reveals the fire, never the units standing in it.
- **Bookkeeping.** One `burningLines` entry `{ tiles, roundsLeft: 2, owner }`, ticked at round
  end. Entry damage is resolved inside MOVE, once per action — not per path step, which is the
  bug this wording exists to prevent.

**Artillery Barrage — the walking lane**

- **Shape.** 10 tiles long, 1 or 2 tiles wide (the buyer picks), axis-aligned, placed by anchor
  + orientation. The 10 is the run; the width is the only shape choice (1×10 or 2×10). It must
  fit entirely on the board.
- **Placement legality.** The anchor must be visible. No tile of the lane may be an HQ tile or
  one of the 8 tiles around any HQ. No tile may be outside the live Doomsday ring.
- **Telegraph.** The full lane is marked when bought and resolves at the start of the caster's
  next turn — one full round of warning. The mark is public to every seat even in fog, because
  the victim has to be able to walk out of it.
- **Resolution.** The shells walk from the near end to the far end (FX only). Every unit standing
  in the lane takes **8 damage once**, friendly fire included. Two tactical instances in the same
  round do not stack — the unit takes the highest one.
- **Structures.** 8 damage to non-HQ structures (Watchtower, Bunker, Relay). HQs, banks, bridges
  and loot are immune.
- **No lingering hazard.** After the pass the lane is clear; craters are cosmetic.
- **Fog.** Hidden units are still hit — an explosion does not need to see you — but the caster's
  log shows only "N units hit". No tiles, no names, no damage numbers and no FX on tiles the
  caster cannot see. The victim sees the full hit. The kill cam and recap follow the same filter.
- **It cannot end Conquer.** HQ immunity is absolute. In Deathmatch it can finish a wounded last
  unit, which is legal under rule 5 (§8.5).

### 8.4 The radar specifically: make it a reveal, not a peek

Fog is enforced **on the server**: `viewFor` strips enemy units outside `visibleSet` before the
view is sent, so a hidden unit's position is not in the client at all. A "show enemies for
4–5 seconds" client effect is therefore impossible to implement honestly — the server would
have to send the positions, and once sent they live in the client forever (trivially cheatable,
and visible in the replay).

Do this instead:

- **Radar Sweep = a temporary sight override for one full round**: the seat's `visibleSet` is
  widened server-side for the duration, so the normal fog pipeline reveals them and nothing
  extra is leaked. It ends on the round tick, not on a stopwatch.
- Visually it is a sweep across the map with contacts pinging — the same read as the 4–5
  seconds idea, but it costs one keyboard-simple change in `visibleSet`/`viewFor` instead of a
  netcode exception.
- Also: 4–5 seconds is not a unit of time in a turn-based game with replay. "One round" is.

### 8.5 Rules that keep them fun instead of swingy

1. **One tactical per turn**, and at most one purchase per round per player. Prevents a
   gold-rich leader from deleting a turn.
2. **AoE is always telegraphed one round.** Damage arrives after the victim gets to move.
3. **No tactical instance deals 10+ damage** (`TACTICAL_MAX_DAMAGE = 8 < MIN_UNIT_HP`), so a
   full-health unit can never be deleted by a weapon alone. Weapons set up kills; units finish
   them. The cap is per instance as well as per hit: Napalm's 4 + 4 over two rounds sums to its
   8, and one line can never pay out more than 8 to the same unit.
4. **Tactical damage ignores terrain defense** (it is the answer to a Bunker turtle) **but never
   triggers overwatch, crossfire, momentum or first contact**, so it cannot chain.
5. **Objectives are immune.** No tactical damages an HQ, bank, bridge or loot, captures a
   building, or moves the Doomsday ring. Killing units is allowed, including the last unit of a
   Deathmatch: the 8 cap means a weapon can only ever finish a wounded unit, never delete a
   healthy one.
6. **Global reveal effects are capped at one round** and are public: the log says "Radar Sweep
   active", so the opponent knows they are seen.
7. **Answerable by play, not by a mirror purchase.** Every area weapon is dodged by movement
   (rule 2); the denial and information weapons have cheap shop answers (Snapshot vs mines,
   Smoke vs snipers and overwatch). Do not add a weapon whose only purpose is to counter another
   weapon.
8. **Tier gates are hard.** Nothing is buyable in round 1. No amount of gold buys a Rare before
   round 5 or an Epic before round 10; the shop shows `OPENS ROUND N`. Common opens at round 2.
9. **Friendly fire is always on** for area weapons: no smart targeting, no owner filter.
10. **No spawn camping.** No mark may cover an HQ tile or its 8 neighbours, in either mode.

### 8.5a Mode rules

**Conquer (HQ).**

- HQ and bank immunity means a weapon can never take an objective or skip a siege; the HQ still
  has to die to a unit.
- Structure damage can strip a Bunker or Watchtower (Sabotage, strikes), which is the intended
  answer to a turtle, but it cannot capture the tile.
- The free round-2 pick stays Common-only. Conquer's opening is the HQ race; a Rare there would
  distort it.
- A telegraphed lane across the approaches is a zoning tool in front of an HQ, not a win button.

**Deathmatch (and Doomsday).**

- Weapons may kill; they may not touch the ring, delay it, or damage a unit the lava has already
  consumed.
- A mark placed before the ring melts resolves only on tiles still inside the live ring. Lava
  wins the overlap.
- The HQ exclusion (rule 10) doubles as respawn protection, because Deathmatch redeploys at the
  HQ.
- In 4P/6P the 10-tile lane punishes clumped formations; the one-round telegraph and friendly
  fire are the brakes. Do not shrink them for player count.
- Doomsday's CP escalation does not interact with weapons: they are gold-only.

**Fog of War.**

- **Placement.** Line, lane and zone weapons need only the **anchor** tile visible; the effect
  may extend into fog. Single-target weapons (Precision Strike, Sabotage, Paradrop) need the
  target itself visible.
- **Damage in fog never leaks.** Hidden units take damage and die normally, but the attacker's
  log shows a hit count only: no tiles, no names, no FX on unseen tiles. The victim always sees
  the full hit. Kill cam, damage popups and recap obey the same filter.
- **Marks are public.** Telegraphs are drawn for every seat even in fog, because dodging requires
  seeing them. A mark never reveals a unit.
- **Active hazards are public.** Burning napalm, smoke and drone sensors are visible on the map
  while active, even outside your sight. They reveal the effect, never the units inside.
- **Radar Sweep is the one deliberate reveal:** a server-side `visibleSet` override for one
  round, announced publicly.
- **Snapshot is private:** only the buyer sees the traps.
- **Smoke is line-of-sight only.** This engine's fog is radius-based (`calculateVisibility`), so
  smoke does not shrink vision. Say that in the rules text instead of implying a second fog
  system.

### 8.6 Implementation sketch

- `Config.ts`: `TACTICAL_TIERS = { COMMON: 2, RARE: 5, EPIC: 10 }`; `SHOP_ITEMS` gains
  `TACTICAL` entries alongside `CONSUMABLE` / `CONSTRUCT`, each with `tier`, `shape` (`SINGLE` |
  `LINE4` | `LANE_10x1_2` | `ZONE3` | `SELF`), `damage`, `telegraphRounds`, `burnRounds`,
  `friendlyFire`, `hitsStructures`, `hitsObjectives: false`.
- `validate.ts`: a `BUY_ITEM` / `USE_TACTICAL` case that checks gold, the tier round, the
  one-per-round and one-per-turn caps, anchor visibility, board fit, the HQ exclusion and the
  live Doomsday ring.
- `apply.ts`: buying resolves immediately; telegraphed strikes write a pending entry that
  resolves on the round tick (reuse the existing `pendingDrops` / land-mine tick pattern);
  Napalm writes a `burningLines` entry ticked at round end; entry damage lives in MOVE and is
  applied once per action, not per path step; a unit takes only the highest tactical hit in a
  round.
- `view.ts`: telegraph marks are public; fog damage is summarised as a hit count for the
  attacker. Do not send hidden units or their tiles to the client — the server already strips
  them, and the new events must not undo that.
- **Bots (shipped):** `botAction` asks `chooseTacticalAction` (`tactical/ai.ts`) first. It shops
  late in the turn (battery under 5 CP or every unit has acted), walks the unlocked list from
  cheapest up, and takes the first weapon with a real target — mine reveal if enemy traps exist,
  drone/radar only under fog, the lowest-HP unit for Precision, a structure or 8+ CP battery for
  Sabotage, a 4-line/3-line/10-lane that catches enough enemies, a flank drop for Paradrop, and
  Overclock only when the battery is low. One purchase per round, tier gates included. EASY
  bots opt out; bots skip Smoke until their target picker models the LOS it removes.
- `sim-playtest.ts`: add a weapon ledger (bought / used / payoff per weapon) so the lab can
  report weapons bought per match and payoff events per weapon. Success = weapons appear in
  ~60–80% of matches, and the dead-turn % does not rise (a weapon turn must still be a turn).

### 8.8 Does gold need to go up?

Yes — but less than it feels, and for a specific reason. First, what gold actually pays for:

- **Respawns cost CP, not gold** (`RESPAWN_CP_COST` in `Config.ts`: Scout 3, Breacher 5,
  Sniper 8; `MAX_RESPAWNS` is 2). Redeploying is a tempo purchase now — see §8.8c for the
  measured result.
- **Shop consumables**: Ammo Drop 50, Land Mine 75, First Aid 100, Bridge 100, Tunnel 125,
  Barrier 150, Medkit 200.
- **You cannot buy units.** There is no unit purchase action — gold only buys consumables (and,
  once they ship, weapons). So raising starting gold does **not** flood the map with bodies; it
  only buys items and weapons. That makes a start-gold bump far safer than it looks.

> The ledger below was built while respawns were still gold-priced (the rule until §8.8c). Its
> respawn line overstates the drain badly; every "left for weapons" figure is roughly €100 per
> seat low under the current CP-priced redeploy.

**The ledger for a typical 22-round 2P match (one player):**

| Line | Now (150 start, +10/turn) | Proposed (200 start, +15/turn) |
| --- | --- | --- |
| Starting gold | 150 | 200 |
| Trickle over 22 rounds | 220 | 330 |
| Buildings (2 held, ~half the match) | ~110 | ~110 |
| Heists (1–2 × 200) | 200–400 | 200–400 |
| **Total income** | **~680–880** | **~840–1040** |
| Respawns (4 losses, mixed types) | ~350–450 | ~350–450 |
| Ammo drops + consumables | ~150 | ~150 |
| **Left for weapons** | **~180–280** | **~340–440** |

So today's economy leaves roughly **two Common weapons per match** — the mechanic would exist
but rarely define a match, and the first buy would land around round 5–8, exactly when the
early game has already gone quiet.

**Recommendation: 200 start, 15 per turn.** Both, not one:

- **200 start** is the important half. It puts the first weapon purchase in rounds 1–3, next to
  the free round-2 pick, so players meet the system before the match's slow middle. It cannot
  buy a unit, so it cannot break opening balance.
- **15/turn** is the modest half: +5/turn is about **+110 gold per match**, which buys one more
  Common weapon *or* a third of a Breacher respawn. That is the difference between "weapons are
  a garnish" and "weapons are a plan", and it still leaves a Sniper respawn (300) as a
  genuinely painful 20 rounds of trickle — so heists stay the way you fund an army.

The resulting split is the one we want: **the trickle buys tactics, heists buy armies.**
At 15/turn a player can afford a Common weapon every 5–7 rounds — the "one tactical beat per
~6 turns" cadence you wanted from the timer, except the player controls it.

Do **not** also raise heist gold. Heists already pay 200 gold + 10 CP; with weapons as a new
sink, that payout becomes more valuable on its own, which is how you raise heist payoff without
adding banks.

Two blockers before trusting any number here:

1. **The lab cannot measure gold.** `sim-playtest.ts` tracks no gold, no purchases and no
   respawn spending, so `bun sim-playtest.ts` will happily show "no change" for a 50% economy
   swing. Add a gold ledger to the sim (earned / spent on respawns / spent on items / spent on
   weapons / left over at match end) before tuning, and sanity-check the table above against it.
2. **The AI never buys weapons.** `AIBrain.ts` only issues `BUY_DROP` (ammo). If weapons live in
   the shop and bots ignore them, every local/PvE match is asymmetric — add a simple rule
   ("buy the cheapest useful tactical every N rounds, or when gold > 250") in the same change.

### 8.8b What the economy lab actually measured

`packages/engine/sim-economy.ts` (new) runs real HARD-bot matches with the gold knobs overridden
and keeps a per-seat ledger: starting gold, trickle, building income, heists, ace bounties,
respawn spend, item spend, and gold still in hand when the match ends. 40 two-player + 20
four-player matches per arm, balanced maps, no fog:

| Arm | € left at turn end | can afford €150 weapon | can afford €300 | broke turns (<€50) | carried out | 4P median rounds |
| --- | --- | --- | --- | --- | --- | --- |
| 150 / +10 (now) | 102 | 34% | 0% | 28% | 87 | 38 |
| **200 / +15** | 118 | 40% | 2% | 22% | 111 | 43 |
| **250 / +20** | 142 | 45% | 7% | 18% | 157 | 44 |
| **300 / +15** | 141 | 45% | 7% | 17% | 128 | 48 |

Three findings that change the §8.8 argument:

1. **Respawns are not the drain the ledger assumed.** Bots hit the 2-respawn cap in nearly every
   match, but 3.9 of those 4.0 respawns are Scouts (€50): per seat they spend ~€100 on respawns,
   not the ~€400 the table above projected. The expensive Sniper redeploy almost never fires
   because Snipers rarely die. So "raise gold so you can afford to respawn" is not the real need.
2. **The real need is a sink, and it is exactly weapons.** Spend rate holds at ~87–89% in every
   arm because bots convert surplus into ammo/medkits (10.8 → 15.5 items per match). The visible
   difference between arms is purchasing power: affordable-weapon turns go 34% → 40% → 45%.
3. **Heists are ~3–5% of income in bot play**, not the 200–400 per match §8.8 budgets. Weapons
   cannot be funded by assuming heists; they are funded by trickle + start, which is why the
   start number matters more than the per-turn number.

Verdict from the data: **keep 200/+15 as the ship value** if weapons land at 150–200. It removes
most dead-money turns (28% → 22% broke) with the smallest carry-out change. **250/+20 is the
ceiling** if weapons are meant to be a core system: it buys the same 45% affordability and the
best late-match cadence, at the cost of €70 more carried out per seat and +6 rounds in 4P.
**300/+15 is a front-load, not an upgrade** — identical affordability to 250/+20, less late-game
support, and the longest 4P matches (48 rounds); pick it only if the first weapon must appear in
rounds 1–3. Do not combine a 300 start with +20 income.

**§8.8c revises this verdict.** With respawns no longer paid in gold, the shipped 150/+10 arm
already reaches 43% weapon-affordability and carries out €93/seat — roughly the old 250/+20 arm.

**Final shipping presets (setup):** **150/+15 (Lean)**, **200/+20 (Standard, default)**, and
**300/+15 (Fast Start)**. These are per-match settings, not global constants. A full 40×2P /
20×4P `sim-economy.ts` sample ran cleanly: 200/+20 produced 22/29 median rounds and 52%/36%
€150-weapon affordability, versus 23/27 and 40%/38% for 150/+15 and 24/25 and 46%/42% for
300/+15. The 4P ordering is within sample noise; the old 150/+10 control remains the historical
baseline in the table above.

### 8.8c What happened when redeploys moved to CP

Shipped: the gold cost is gone from `SPAWN` and replaced with `RESPAWN_CP_COST` (Scout 3 /
Breacher 5 / Sniper 8); `MAX_RESPAWNS` stays 2. `prepareAction` and `applyAction` both price
from the fallen unit's class, so a client cannot redeploy a Sniper at Scout prices. The AI checks
CP in `checkSpawn`, which runs before any other spending, so it never proposes a spawn the
battery cannot pay for.

Before/after on identical seeds — economy lab (40 2P + 20 4P matches per arm, all four gold
arms) and playtest phase A (10 matches × the ten CP cells), HARD bots:

| Metric (mean of the ten CP cells) | Before | After |
| --- | --- | --- |
| Median rounds | 28.6 | 29.4 |
| Dead turns | 30.3% | 32.0% |
| Comebacks | 55% | 60% |
| Eliminations | 70.8% | 71.0% |
| Stalls | 0% | 0% |
| Idle CP at end of turn | 4.2 | 4.1 |

Redeploys per match: **3.98 → 3.98 (2P)**, **7.85 → 7.90 (4P)**, still ~98% Scouts (3.9 of 4.0).
The CP price did not suppress respawns, because 3 CP is one Scout shot and the battery almost
always has it: **0.00% of turns in every arm had a ready body the battery could not pay for**,
and rejected actions stayed at 0.00–0.02%.

Gold moved exactly as predicted: the ~€103 per seat that used to buy respawns went straight into
consumables (items per match 10.4 → 12.1 in 2P; per-seat item spend €578 → €702), so **carried-out
gold did not rise** (€98 → €93 per seat in 2P). The change deletes a fake gold sink — it does
not create a hoard. With no wave of lost respawns, eliminations, comebacks and stalls all sit
within seed noise of the old rules.

Caveats: n = 10 per playtest cell and 40/20 per economy cell, and the engine still has unseeded
`Math.random` in AI tie-breaks, artillery and drops, so single-cell swings of a few points are
noise. The Sniper's 8 CP is the price a human will actually feel: it is a full shot out of the
battery on the turn its body comes back, which is the intended trade.

### 8.9 One-line answer

Tactical weapons are a good fit **because they are CP-free and unit-free** — they are the one
thing in the game that can produce a FIRST on a turn with no battery left, which is exactly
the 30% dead-turn problem. But sell them, do not clock them; **gate them by round, not by price
alone** (Common at 2, Rare at 5, Epic at 10); telegraph every area effect; cap every instance at
8 damage so nothing full-HP ever dies to gold alone; make objectives immune; and treat fog as a
rule, not an afterthought — hit counts for the attacker, full information for the victim. Then
gold stays a real choice and a weapon can create a turn without deciding a match.

## 9. Gap audit — what's actually missing

Audited the source before writing this (52k LOC across `apps/web`, `apps/server`,
`packages/engine`). The short version: **this game is exceptional at the next four seconds and
thin at the next four matches.** Kill cam, FX, weather, living map, telegraphed drama — best in
class. Continuity, onboarding and social presence — largely absent.

### 9.1 What already exists (do not rebuild)

| System | State | Evidence |
| --- | --- | --- |
| After-action scorecard | Solid: score/100, S–D grade, par rounds, K/D/dmg/heists/secured/aces, MVP, seed copy | `HUD.tsx` `MatchScorecardSummary` |
| Career totals | Exists: W/L/D, streak, best grade, fastest win, aces, per-op medals | `CareerStatsManager.ts` |
| Challenge ops | Exists: `CHALLENGE_OPERATIONS` + S/A/B medals + mutators (blitz, scarcity, ironman) | `assets/ChallengeOps.ts` |
| AI difficulty | Exists: EASY/MEDIUM/HARD with real behavioural differences (HARD buys mines/tunnels) | `AIBrain.ts` |
| Online rooms | Exists: codes, 30s reconnect grace, 24h boot restore | `TableRoom.ts` |
| Audio | Procedural synth foley, no asset files (small download, good) | `core/audio/SoundFX.ts` |
| Accessibility | Reduced-motion live-toggled, mute, kill-cam mode persisted | `fxTimeline.ts`, `useEffectStore.ts` |

So the honest gaps are not "add a score screen". They're the five below, in impact order.

### 9.2 Ranked gaps

**1. No first run — the biggest gap.** There is no `firstRun`/`hasPlayed` flag anywhere, and `HowToPlay`
is a 319-line static scroll. A new player meets 3 unit types, 30 CP, weather zones, fog, heists,
overwatch, veterancy and now tactical weapons before their first click. The fix is not a better
manual — it's a **scripted 3-turn operation** on a fixed tiny map: move → attack → overwatch, with
the existing scripted-dev harness driving the enemy. That single flow teaches the verbs *and*
solves §1's dead-turn problem for novices, because they learn to spend CP.

**2. Nothing is remembered.** `recordMatch` stores aggregates only — no list of matches, no seeds,
no "the 4-round game where the Scout survived". The seed is copyable at the end screen and then
lost forever. Add a **bounded match history (last 20): seed, mode, rounds, grade, opponent, MVP**.
It costs a localStorage array, and it turns the career line into a library you can replay from —
which makes your existing recap/POTM code reachable long after the match.

**3. The career is a status line, not a screen.** Today it renders as one dense string in
`GameSetup.tsx`: `0W–0L • 1/9 OPS • BEST - • STREAK 0 • NO WIN • 0 ACES`. All of the numbers are
already computed; none of them are *shown*. A "DOSSIER" screen (grade history sparkline, op medal
board, best/fastest records) is pure presentation over data that exists — the cheapest retention
work in the codebase.

**4. Silence between turns, and no audio bed.** `SoundFX` is all one-shots: no music, no ambience,
and no off-turn cue. In a turn-based game the longest silence is *the other player thinking* —
that's where sessions die. Three cheap wins: a low procedural ambience bed that shifts with the
§2.3 escalation stage, a distinct "your turn" cue (also fires when tabbed out), and a soft
tension riser when a telegraphed strike is pending.

**5. Nothing is shareable.** `replayMode` exists inside `fxTimeline` for Play-of-the-Match, but
there is no URL, no watcher path, no `?watch=` route — and zero spectator code (`spectat:` 0 hits).
You already have server-authoritative `viewFor` and table snapshots, so a **read-only spectator
seat** (`/watch/CODE`, delayed by one round so it can't be used to cheat) is mostly a room-seat
variant. It also gives your drama somewhere to go after the match ends.

### 9.3 Add now, small

- **AI buys tactical weapons (shipped).** `botAction` checks `chooseTacticalAction` before the
  regular brain: cheapest useful unlocked weapon, once per round, late in the turn. It shares the
  human tier gates and free round-2 pick. EASY bots still skip the shop; bots do not buy Smoke yet
  because their target picker does not model its LOS block.
- **A gold ledger in `sim-playtest.ts`** (see §8.8) — no gold is tracked there today, so economy
  tuning is currently unmeasurable.
- **Colour-blind safe ownership.** Ownership is colour-coded (red/mint) and this is a game where
  reading whose unit is whose *is* the skill. A shape/pattern overlay on the team ring is a few
  hours and removes the only "some players literally cannot play this" class of bug.

### 9.4 Park these (real, but not yet)

- **Mobile/touch.** Only `touchstart` to prevent page scroll; `GameSetup` has zero responsive
  breakpoints; `HUD` is 1694 lines of fixed layout. This is a second client, not a task. Worth it
  only once the desktop loop retains.
- **Matchmaking / public games.** Invite codes are enough while the population is small; public
  queues make a small game feel emptier, not fuller.
- **Chat / emotes.** Tempting, but 6 canned pings ("watch left", "nice") cover 80% of the value at
  5% of the risk. Revisit after spectators exist.
- **Live telemetry.** Career lives in per-browser localStorage and nothing aggregates. Instead of
  building analytics, add an **"export match log"** button on the scorecard — you get real human
  matches to feed the sim, and the player gets something to share.

### 9.5 The one-sentence version

The engine has no equal at *making a turn feel like something*; the missing work is making a
**session** and a **career** feel like something — first run, memory of matches, a dossier, sound
between turns, and a seat for the person watching.
