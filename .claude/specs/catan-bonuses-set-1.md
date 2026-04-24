# Catan bonuses — set 1

Wires gameplay effects for the 10 bonuses with `set: '1'` in
`lib/catan/bonuses/bonuses.ts`. Until now bonuses have been dealt and stored
on `PlayerState.bonus` but had no mechanical effect. Curses are already live
(see `catan-curses.md`); this is the parallel pass for bonuses.

Depends on: `catan-curses.md` (shares helpers, findWinner pattern, BuildTradeBar
badge pattern, tooltip primitive).

## Scope — all 10 set-1 bonuses

- `specialist` — declare a resource at start of game; port trades with that
  resource as input pay 1 fewer.
- `gambler` — after rolling, optionally reroll once; only the second result
  counts.
- `veteran` — during your turn, discard a used Knight to gain 2 resources of
  choice. Knights still count for Largest Army.
- `hoarder` — 7-roll: you never lose cards even if hand > 7.
- `underdog` — 1- and 2-pip hexes produce double resources for you.
- `nomad` — desert acts as a random resource for you, activated by 7. After
  the robber is moved, roll a die to determine which resource it produces.
- `carpenter` — once per turn, spend 4 Wood for 1 VP.
- `thrill_seeker` — you need one fewer VP to win.
- `bricklayer` — may pay 4 Brick for any building.
- `aristocrat` — receive starting resources from **both** starting
  settlements (not just the round-2 one).

## Architecture

- New `lib/catan/bonuses.ts` for behaviour (parallel to `curses.ts`). Static
  data stays in `lib/catan/bonuses/bonuses.ts`.
- Each rule takes the player's bonus id (or undefined) as input — no global
  effect registry. One bonus per player, no stacking with curses that
  conflict (impossible by construction anyway — avarice vs hoarder never
  co-exist on the same player).
- Existing helpers get bonus-aware variants or an optional bonus arg:
  roll flow (gambler confirm/reroll), `distributeResources` (underdog),
  `requiredDiscards` (hoarder), `isValidBankTradeShape` + `applyBankTrade`
  (specialist), `findWinner` (thrill_seeker), `isValidBuildRoadEdge` /
  `isValidBuildSettlementVertex` / `isValidBuildCityVertex` / dev-card buy
  (bricklayer alt cost), placement round-1 grant (aristocrat).
- **New top-level phase `post_placement`** (between `initial_placement` and
  `main`). "Start of game" bonuses resolve here. For set 1 the only one is
  specialist; future sets (explorer, fencer, haunt) will use the same phase.
  Each player with a pending start-of-game task has an entry; the phase
  advances when all entries resolve. For set 1 it's a simple sub-phase:
  every specialist player must call `set_specialist_resource` before the
  game enters `main`. Non-specialists don't block it.
- **New sub-state for gambler: roll confirmation.** The existing `roll`
  phase is replaced by a two-step flow for gambler players only: after
  `roll`, if the current player has the gambler bonus, the phase becomes
  `{kind: 'roll', pending: {dice, confirmed: false}}`. The player either
  confirms (distribution / 7-chain fires) or rerolls once. Non-gambler
  players flow through unchanged (roll → distribute, atomic).
- New actions needed: `set_specialist_resource` (one-time during
  `post_placement`), `confirm_roll` + `reroll_dice` (gambler),
  `tap_knight` (veteran — renamed from "discard"), `buy_carpenter_vp`
  (carpenter). Nomad's per-7 d5 fires inline inside the existing roll
  handler's 7 branch; every nomad player receives 1 random resource as
  part of the 7's resolution.
- Edge function mirrors all of the above. New check script
  `dev/check-catan-bonuses.ts`.

## Shared helpers (new `lib/catan/bonuses.ts`)

- `bonusOf(state, playerIdx): BonusId | undefined`
- `hasBonus(state, playerIdx, id: BonusId): boolean`
- `winVPThresholdFor(bonus, curse): number` — **replaces** the curses-only
  helper. `ambition` → 11, `thrill_seeker` → 9, plain → 10. If both apply (by
  construction impossible — one player can't have both), ambition wins.
- Specialist: `specialistPortDiscount(bonus, chosen, giveResource, baseRatio)`
- Underdog: `underdogMultiplierFor(bonus, hexNumber): 1 | 2` — 2 iff bonus is
  underdog and `hexNumber ∈ {2, 3, 11, 12}` (1- and 2-pip numbers).
- Hoarder: integrated into `requiredDiscards` via a bonus-aware override.
- Bricklayer: `bricklayerAltCost(bonus): ResourceHand | null` —
  `{ brick: 4, … }` or null.
- Gambler: a boolean `PlayerState.rerolledThisTurn` flag; reset on `end_turn`.
- Carpenter: `PlayerState.carpenterVP?: number` counter; `PlayerState.boughtCarpenterVPThisTurn?: boolean` flag, reset on `end_turn`.
- Nomad: transient `GameState.nomadDesertResource` is not stored — the die
  roll happens inline in the 7-chain handler and is applied to the robber's
  current hex at distribution time. See "nomad" notes.

## Per-bonus implementation notes

### specialist

- Resolves in the new `post_placement` phase. After the last initial-
  placement road is placed, `phase` becomes
  `{kind: 'post_placement', pending: {specialist: number[]}}` where
  `pending.specialist` is the list of player indices with the specialist
  bonus. The phase advances to `{kind: 'roll'}` when the list is empty.
  Non-specialists have nothing to do and don't block.
- Action `set_specialist_resource { game_id, resource }` — valid only while
  `phase.kind === 'post_placement'` and `meIdx` is in
  `phase.pending.specialist`. Sets `PlayerState.specialistResource`, removes
  `meIdx` from `pending.specialist`, and when the list empties transitions
  to `{kind: 'roll'}`.
- `PlayerState.specialistResource: Resource` (required once declared).
- `ports.ts.isValidBankTradeShape` and `applyBankTrade` apply a −1 to the
  effective ratio whenever the `give` side matches the declared resource.
  Minimum ratio stays at 2:1 (2:1 specific ports unchanged; 3:1 → 2:1 on
  declared resource; 4:1 → 3:1).
- Picks are made simultaneously — each specialist player sees a picker
  immediately upon entering `post_placement`. Picks aren't turn-serialized.
- UI:
    - A full-screen "declare your specialty" modal pops for specialist
      players during `post_placement`.
    - Specialist resource badge visible on PlayerStrip for everyone (public).
    - TradePanel bank row highlights the declared resource with a discount
      badge on the player's own row.

### gambler

- Reroll is scheduled BEFORE any downstream effect fires — not an unwind.
- New phase shape: `{kind: 'roll', pending?: {dice: DiceRoll}}`. When a
  gambler player rolls, the handler sets `pending.dice` but does not
  distribute. UI shows the dice and offers "Confirm" / "Reroll".
- Actions:
    - `confirm_roll { game_id }` — applies distribution (or fires the
      7-chain). Sets `rerolledThisTurn = true` only if a reroll was used.
    - `reroll_dice { game_id }` — valid once per turn
      (`!p.rerolledThisTurn`). Generates new dice, overwrites `pending.dice`,
      flips `rerolledThisTurn = true`, stays in `roll`. After a reroll the
      player can only `confirm_roll`.
- `PlayerState.rerolledThisTurn?: boolean`, reset on `end_turn`.
- Non-gambler players retain the existing atomic flow — `roll` action
  distributes immediately.
- Event: log the original + rerolled dice on a `reroll` event so the
  history is reconstructable.

### veteran

- Mechanic renamed from "discard" to **"tap"**: a knight is tapped to
  collect 2 resources of choice, but stays in the played-knight count for
  Largest Army. Visually the knight card gains a "tapped" state (rotated /
  dimmed / spent-looking).
- `PlayerState.tappedKnights?: number` — count of knights that have been
  tapped (so `devCardsPlayed.knight - tappedKnights` is the number of
  still-untapped played knights available to tap).
- New action `tap_knight { game_id, chosen: [Resource, Resource] }`.
  Valid when `phase.kind === 'main'` AND the player is current AND bonus is
  veteran AND `devCardsPlayed.knight > (tappedKnights ?? 0)`.
- UI: on DevCardHand's "played" section, each played knight shows either
  a "Tap for 2 resources" button (if the player is veteran and at least
  one knight is still untapped) or an "already tapped" dimmed state. The
  picker re-uses the Year of Plenty resource picker pattern.

### hoarder

- `requiredDiscards` returns 0 for cursed `avarice` and for bonus `hoarder`
  overrides. Implementation: extend the existing curse-aware switch to also
  check bonus. No new field.
- UI: DiscardBar shows a "protected by Hoarder" message when `hoarder &&
hand > 7`.

### underdog

- `distributeResources` multiplies the per-building gain by
  `underdogMultiplierFor(bonus, hd.number)` when the owning player has
  underdog. City still 2× settlement, so a city on a 2-pip hex is 4.
- Covers actual hex numbers 2, 3, 11, 12 (and the "pip" framing in the card
  text matches 1-pip for 2/12 and 2-pip for 3/11). Q4 confirms.
- Also applies to nomad's rolled-on-7 desert? Nomad produces only on 7, so
  the hex's "number" is irrelevant (nomad's effect stands alone).

### nomad

- Unrelated to the robber. Every 7 rolled, every nomad player receives 1
  resource chosen by a server-side d5 roll. Applied inline inside
  `handleRoll`'s 7-branch, BEFORE computing required discards (so the
  gained card counts toward hand-size discard checks — this matches
  "activated by 7" semantically).
- `pending[playerIdx]` for discards is recomputed against the post-grant
  hand.
- Logged as a `nomad_produce` event per grant.

### carpenter

- `PlayerState.carpenterVP?: number` — cumulative.
- `PlayerState.boughtCarpenterVPThisTurn?: boolean` — reset on `end_turn`.
- New action `buy_carpenter_vp { game_id }`:
    - `phase.kind === 'main'`
    - `bonus === 'carpenter'`
    - `!p.boughtCarpenterVPThisTurn`
    - `p.resources.wood >= 4`
    - Deduct 4 wood, `carpenterVP++`, `boughtCarpenterVPThisTurn = true`.
    - Runs `applyEndOfActionChecks` → can trigger findWinner.
- `totalVP` adds `p.carpenterVP ?? 0`.
- Does **not** count toward the `age` curse turn cap (age counts only
  standard builds: road / settlement / city / dev-card buy). Carpenter VP
  is a bonus-specific spend, so it bypasses `canSpendUnderAge`.
- UI: bonus-gated button rendered on the BuildTradeBar, styled
  distinctly from the standard build buttons (carpenter icon + its own
  accent colour) so it reads as a "special" action rather than a build.
  Disabled when already bought this turn or when wood < 4.
- GameOverOverlay scoreboard: separate "Carpenter VP" line per player who
  has any.

### thrill_seeker

- `winVPThresholdFor(bonus, curse)` returns 9 when bonus is thrill_seeker.
- `findWinner` already uses the curse-aware variant (lifted in
  catan-curses). Extend to accept bonus too.
- UI: PlayerStrip VP progress already reads thresholds; no new widget
  needed, but the progress bar max shrinks.

### bricklayer

- `bricklayerAltCost(bonus)` returns `{brick: 4}` (other resources 0) when
  bonus is bricklayer. Affordability check passes if either the standard
  cost OR the 4-Brick alternative clears.
- Applies to roads, settlements, cities, AND dev-card purchases.
- UI: per-build button shows alt cost under the normal one, greying out the
  option that's not payable. When both payable, active player chooses via a
  small toggle on the button press (or we default to the cheaper option
  and let them flip — decide during implementation).
- Edge-function build handlers (`handleBuildRoad`, `handleBuildSettlement`,
  `handleBuildCity`, `handleBuyDevCard`) accept an optional
  `use_bricklayer: boolean` flag. When true, gate on
  `bonus === 'bricklayer'` and charge 4 Brick instead of the standard cost.
- Age interaction: `cardsSpentThisTurn` feeds off the actual cost paid, so
  a bricklayer-built road costs 4 cards (not 2) for age-cap purposes.

### aristocrat

- In placement `place_settlement`, extend the grant gate to
  `round === 2 || bonus === 'aristocrat'`. Aristocrat receives adjacent
  resources for both their round-1 and round-2 settlement placements.

## Cross-cutting edits

- `lib/catan/types.ts`:
    - `PlayerState.specialistResource?: Resource`
    - `PlayerState.rerolledThisTurn?: boolean`
    - `PlayerState.boughtCarpenterVPThisTurn?: boolean`
    - `PlayerState.carpenterVP?: number`
    - `PlayerState.tappedKnights?: number`
    - `Phase` gains `{kind: 'post_placement', pending: {specialist: number[]}}`
    - `Phase['roll']` gains optional `pending: {dice: DiceRoll}` for gambler.
- `lib/catan/bonuses.ts`: new, with helpers above.
- `lib/catan/curses.ts`: merge `winVPThresholdFor` to take `(bonus, curse)`.
- `lib/catan/roll.ts`: `distributeResources` takes `(state, total)` still,
  but applies `underdogMultiplierFor` per owning player.
- `lib/catan/ports.ts`: apply specialist discount in shape-validity and
  hand-apply functions.
- `lib/catan/robber.ts`: `requiredDiscards` returns 0 for hoarder.
- `lib/catan/build.ts`: affordability accepts alt cost for bricklayer.
- `lib/catan/placement.ts`: placement starting-resource gate widened.
- `lib/catan/dev.ts`: `totalVP` + `findWinner` include carpenter VP &
  thrill_seeker threshold.
- Edge function: mirror every change. New handlers:
  `handleSetSpecialist`, `handleConfirmRoll`, `handleRerollDice`,
  `handleTapKnight`, `handleBuyCarpenterVP`. Extend `handleRoll` to
  (a) grant nomad d5 resource per nomad player before the 7-chain
  resolves, and (b) leave dice in `phase.pending` for gambler players
  instead of distributing. Extend `handleBuildRoad/Settlement/City` and
  `handleBuyDevCard` to accept `use_bricklayer`. Reset
  `rerolledThisTurn`, `boughtCarpenterVPThisTurn` in `handleEndTurn`.
  On transition from `initial_placement` to main flow, enter
  `post_placement` iff any player has a start-of-game bonus (set 1: only
  specialist).
- UI:
    - New "Tap knight → 2 resources" UI on DevCardHand (veteran). Button on
      each untapped played knight; tapped knights render visibly spent.
      Picker re-uses the Year of Plenty two-resource picker pattern.
    - Specially-styled "4 Wood → 1 VP" button on BuildTradeBar (carpenter).
    - RollBar: when a gambler player rolls, the dice show with "Confirm" /
      "Reroll" buttons until the player commits. Non-gambler players see no
      change to the roll flow.
    - TradePanel: bank row highlights declared specialist resource and
      shows a "−1" tag on the matching give row.
    - BuildTradeBar build buttons (and BuyDevCard): secondary "4 Brick"
      cost row for bricklayer.
    - PlayerStrip VP progress: bar accounts for thrill_seeker / ambition
      threshold (already curse-aware; extend).
    - A full-screen "declare your specialty" modal during `post_placement`
      for specialist players.
    - PlayerStrip: specialist resource badge (public).
    - GameOverOverlay scoreboard: carpenter VP appears as its own line.
- Events:
    - `specialist_set` (declared resource)
    - `reroll` (dice replaced, old/new totals)
    - `knight_tapped` (veteran, +2 resources)
    - `nomad_produce` (player, resource)
    - `carpenter_vp` (spent 4 wood, carpenter VP +1)
    - No separate `bricklayer_used` — bundle into the existing build event.

## Check script

`dev/check-catan-bonuses.ts`: one section per bonus with table-driven cases.
Parallel to `check-catan-curses.ts`.

## Implementation order

1. Shared `bonuses.ts` + new `PlayerState` fields + `winVPThresholdFor`
   unification.
2. `thrill_seeker` (smallest — threshold only).
3. `aristocrat` (placement gate widened).
4. `underdog` (distributeResources path).
5. `hoarder` (requiredDiscards path).
6. `bricklayer` (build affordability + handlers).
7. `specialist` (ports + declare action).
8. `carpenter` (new action + UI button + totalVP).
9. `veteran` (new action + UI button).
10. `gambler` (reroll mechanic + UI).
11. `nomad` (7-chain extension + d5 roll + event).
12. Edge function mirror pass.
13. `dev/check-catan-bonuses.ts` + `npm run check` + `npm run edge` +
    `npm run format`.

## Question resolutions (locked)

1. **Specialist** — declared during a new `post_placement` phase inserted
   between `initial_placement` and `main`. This phase generalizes to any
   "start of game" bonus. For set 1 only specialist needs it.
2. **Gambler** — reroll decision is made before distribution or 7-chain
   fires. Dice sit in `phase.pending.dice`; actions `confirm_roll` /
   `reroll_dice` drive the transition. No rollback semantics needed.
3. **Veteran** — "tap", not "discard". Knight stays in
   `devCardsPlayed.knight` for Largest Army; `tappedKnights` counter tracks
   how many have already been used for the 2-resource grant.
4. **Underdog** — hex numbers {2, 3, 11, 12} (1-pip and 2-pip).
5. **Nomad** — every 7, each nomad player gets 1 random resource via
   server-side d5 roll. Unrelated to robber destination.
6. **Carpenter UI** — specially-styled button on BuildTradeBar.
7. **Carpenter × age** — carpenter VP purchase does NOT count against
   age's turn cap. Only standard builds count toward age.
8. **Bricklayer scope** — roads, settlements, cities, and dev-card
   purchases.
9. **Aristocrat** — grants resources for both round-1 and round-2
   settlement placements.
10. **Bricklayer event** — bundle into the normal build event.
11. **Specialist visibility** — public on PlayerStrip.
12. **Gambler interaction** — reroll happens before any effect fires, so
    there are no cross-chain complications. Rerolled-into-7 starts a fresh
    7-chain; rerolled-out-of-7 cancels it before discards happen.
