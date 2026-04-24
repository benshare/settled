# Catan bonuses — set 2

Wires gameplay effects for the 10 bonuses with `set: '2'` in
`lib/catan/bonuses/bonuses.ts`. Parallel pass to `catan-bonuses-set-1.md`,
which is now live; this is the next batch.

Depends on: `catan-bonuses-set-1.md` (post_placement phase, gambler
roll-pending shape, BuildTradeBar carpenter button styling pattern,
PlayerStrip bonus badge, GameOverOverlay scoreboard line per bonus VP).

## Scope — all 10 set-2 bonuses

- `scout` — buying a dev card: may swap one required resource for a
  duplicate of one of the others, then draw 3 from the deck, choose 1,
  return the other two to the bottom in their drawn order.
- `accountant` — during your turn, liquidate any of your own buildings or
  unused dev cards back into their full resource cost. Cannot liquidate
  something bought this turn; cannot liquidate a road that, removed,
  would split your road network so two of your buildings are no longer
  road-connected.
- `explorer` — start of game: place 3 free roads. Standard road
  connectivity still required.
- `ritualist` — start of turn: may discard 2 cards (no city) or 3 cards
  (≥1 city) to choose the dice value (2..12). No other player receives
  resources from this roll. A chosen 7 still triggers the 7-chain.
- `populist` — each settlement (not city/super_city) whose adjacent hex
  pips total < 5 is worth +1 VP.
- `fortune_teller` — after every doubles or 7 roll, take a second roll;
  only the fortune_teller gains resources from it. No chaining.
- `shepherd` — if turn starts with ≥4 sheep, may discard 2 sheep to take
  2 resources of choice. Sheep are excluded from the 7-discard hand-size
  total.
- `metropolitan` — new "super_city" building kind, upgrades from a city
  for the standard city cost (2 wheat + 3 ore). Worth 3 VP, distributes
  3 per adjacent producing hex. Cap of 1 per player. Also: when paying
  for a city OR super_city, the player may replace N of the 2 wheat
  in the cost with N additional ore (one-directional wheat → ore).
- `curio_collector` — when a 2 or 12 is rolled and the player gained
  ≥1 card from it, take 3 additional resources of choice.
- `forger` — receives a `forgerToken: Hex | null` field. Inactive at
  start of game; activates the first time a 7 is rolled and snaps to
  whichever hex the robber lands on after that 7. On every subsequent 7
  the token re-snaps to the new robber hex. Before the player's own
  roll, they may move the token to a hex adjacent to its current hex.
  Whenever the token's hex produces resources, the forger picks one
  other player and copies whatever resources THAT player gained from
  that hex on the same roll.

## Architecture

- Set-2 helpers extend `lib/catan/bonus.ts`. The file's docstring
  already covers set 1; new sections are appended per bonus.
- New action handlers (edge function):
    - `liquidate` (accountant)
    - `ritual_roll` (ritualist; alternative to `roll`)
    - `shepherd_swap` (shepherd)
    - `place_explorer_road` (explorer; only valid in post_placement)
    - `claim_curio` (curio_collector; resolves a `pending.curio` entry)
    - `move_forger_token` (forger; phase = `roll`, optional pre-roll)
    - `pick_forger_target` (forger; resolves a `pending.forger` entry)
    - `confirm_scout_card` (scout; resolves a `pending.scout` entry —
      pick which of the three drawn cards to keep)
- Existing handlers extended:
    - `handleBuyDevCard`: scout's alt-cost path + 3-card peek (creates
      `pending.scout` entry instead of immediately committing the
      drawn card).
    - `handleRoll`: fortune_teller extra roll, curio_collector trigger,
      forger production, super_city distribution multiplier.
    - `handleBuildCity`: metropolitan wheat↔ore swap on cost.
    - `handleEndTurn`: reset `ritualWasUsedThisTurn`, `shepherdUsedThisTurn`.
    - Post-initial-placement transition: include `pending.explorer` if
      any explorer players present.
- Robber `requiredDiscards`: shepherd subtracts sheep from the hand
  size used for the > 7 check.
- New `'super_city'` enters `VertexBuilding`. Touches: BoardView /
  VertexPiece / placement adjacency rules / palette / scoring /
  distribution / power curse pip-counting / build cap handling.

## Shared helpers (additions to `lib/catan/bonus.ts`)

- `populistBonusVPFor(state, playerIdx): number` — counts the player's
  settlements (only) whose adjacent producing-hex pips sum to < 5,
  returns the count (each contributes +1 VP).
- `pipCountFor(hexNumber): number` — 1/2/3/4/5 for {2,12}/{3,11}/{4,10}/
  {5,9}/{6,8}. Desert hexes contribute 0.
- `shepherdEffectiveHandSize(p): number` — `handSize - sheep` if bonus
  is shepherd, else `handSize`.
- `canShepherdSwap(p): boolean` — bonus shepherd && sheep ≥ 4 &&
  !shepherdUsedThisTurn.
- `metropolitanCostOptions(p): Array<{wheat,ore}>` — list of legal
  payment splits given current hand for the city cost. UI uses this.
- `rolledHasDouble(d: DiceRoll): boolean`.
- `forgerActive(p): boolean` and `forgerHexFor(state, idx): Hex | null`.
- `accountantRefundFor(target): ResourceHand` — full cost of the
  liquidated piece.
- `superCityCount(state, idx): number`, `canBuildMoreSuperCities(state, idx): boolean`.

## Per-bonus implementation notes

### scout

- Buying a dev card: action gains optional `swap?: { from: Resource;
to: Resource }` payload. `from` must be one of the three standard
  cost resources; `to` must be one of the others. Hand check:
  cost = standard − {from: 1} + {to: 1}. Bricklayer alt cost is NOT
  combinable with scout swap (scout text is "one of the required
  resources").
- After paying, the handler draws the top 3 cards from `devDeck` (or
  fewer if the deck has < 3) into a per-player `pending.scout` entry:
  `{ playerIdx, cards: DevCardId[] }`. The state moves to a new sub-
  phase `{ kind: 'scout_pick', resume: ResumePhase, owner: number,
cards: DevCardId[] }`. Only the owner can act; others see a "waiting
  on …" badge.
- `confirm_scout_card { game_id, index: 0 | 1 | 2 }` adds the chosen
  card to the player's hand (with `purchasedTurn = state.round`,
  matching the standard buy), sends the other two to the bottom of
  `devDeck` in their drawn order, transitions back to `resume`.
- If the deck had < 3 cards: pick is among whatever was drawn; the
  rest still flush to bottom.
- Event: `scout_buy` (cost paid, swap if any), `scout_pick`
  (chosen card id; hidden cards from the drawn-but-returned).

### accountant

- New action `liquidate { game_id, target }` where `target` is one of:
    - `{ kind: 'road', edge: Edge }`
    - `{ kind: 'settlement', vertex: Vertex }`
    - `{ kind: 'city', vertex: Vertex }`
    - `{ kind: 'super_city', vertex: Vertex }`
    - `{ kind: 'dev_card', index: number }` — index into
      `player.devCards`. Includes VP cards (the player loses 1 VP per
      VP card liquidated and is refunded the dev-card cost).
- Validity:
    - phase = `main`; current turn = me; bonus = accountant.
    - Piece is mine.
    - Piece's `placedTurn` (new field) < `state.round`. Same for dev
      cards via existing `purchasedTurn`.
    - Roads: removing the edge must not split the player's
      road-connected building set into multiple components. We compute
      this with a graph BFS over the player's roads + buildings: build
      the graph minus the candidate edge, then for each pair of the
      player's settlements/cities/super_cities, verify they remain in
      the same connected component (or that there is at most one
      component touching any of the player's buildings).
- Refund: full standard cost of the piece.
    - road: 1 brick + 1 wood
    - settlement: 1 brick + 1 wood + 1 sheep + 1 wheat
    - city: 2 wheat + 3 ore (unchanged — even if metropolitan paid via
      wheat↔ore swap, refund is the canonical cost; the swap is pay-
      time only). City liquidation reverts the vertex to a settlement.
    - super_city: 2 wheat + 3 ore. Reverts the vertex to a city.
    - dev_card: 1 sheep + 1 wheat + 1 ore.
- Refund credits resources back to the player's hand.
- Largest army: liquidating a Knight that has been played is impossible
  (only unused dev cards qualify). Liquidating a Knight that hasn't
  been played reduces the player's deck count but doesn't touch
  `devCardsPlayed`, so largest army doesn't move.
- Longest Road: removing a road triggers `recomputeLongestRoad` after
  the action (already wired for road builds).
- Win check: liquidation runs `findWinner` afterwards; possible (though
  unusual) for it to trigger via populist (a city → settlement
  conversion could re-qualify under the < 5 pips rule).
- New persistent field on `EdgeState` and `VertexState` for occupied
  entries: `placedTurn: number` (REQUIRED, not optional). Set on
  every build / placement (initial placement uses round 0 since
  `state.round` increments only on end_turn). Liquidation gate
  compares against `state.round`. Legacy games (without the field)
  will fail strict parsing and refuse to load — acceptable since
  bonuses are an opt-in game flag and no existing accountant games
  exist.
- Event: `liquidate` (kind, refund hand).

### explorer

- After the last initial-placement road, post_placement gains a
  `pending.explorer: Record<number, number>` map (player idx →
  remaining roads, initialised to 3 for each explorer player).
- Specialist still resolves first (or in parallel — they're
  independent; both must drain before transitioning to roll).
- Action `place_explorer_road { game_id, edge }` validity:
    - phase = post_placement and `phase.pending.explorer[meIdx] > 0`.
    - Edge passes `isValidBuildRoadEdge(state, meIdx, edge)`. (Same
      connectivity rule as paid roads — we're treating the explorer's
      starting two settlements as the connection seed.)
- Effect: place the road, decrement the counter; remove the entry
  when it reaches 0.
- Order: parallel — every explorer player can place independently.
  UI shows the road-pick layer for each explorer player who has
  remaining roads, even off-turn.
- Longest road: recompute after each explorer road so an early lead
  shows on the strip. Findwinner doesn't fire — phase isn't main.
- Event: `explorer_road` (edge).

### ritualist

- New action `ritual_roll { game_id, discard: ResourceHand, total: number }`.
    - phase = roll, current turn = me, bonus = ritualist.
    - `total ∈ {2..6, 8..12}` — **ritualist may not choose 7**.
    - Required cost: `(cityCountFor + superCityCount) >= 1 ? 3 : 2`
      cards total in `discard`. Cards must come from the player's hand.
    - Cannot have already used `ritualWasUsedThisTurn` (one per turn).
- Effect: deduct the discarded resources, set
  `ritualWasUsedThisTurn = true`, then enter the same downstream
  flow as a normal roll EXCEPT distribution skips every player who
  isn't the ritualist. (No 7 path needed since ritualist can't pick 7.)
- For dice display, store synthetic dice in
  `phase.roll` (split: e.g., total 8 → {a:4,b:4} default split). The
  edge function picks a deterministic split that sums to total.
- Gambler interaction: ritualist uses `ritual_roll` instead of `roll`,
  so the gambler reroll path doesn't apply (intentional; the player is
  already paying to choose).
- Fortune teller interaction: a synthetic doubles still triggers
  fortune_teller's bonus roll chain (acceptable quirk; only matters if
  the player held both bonuses, which is impossible).
- Event: `ritual_roll` (total, cost paid).

### populist

- `totalVP` adds `populistBonusVPFor(state, idx)` for populist players.
- Recompute happens on every action that modifies vertex buildings
  (already centralised in `applyEndOfActionChecks` → `findWinner`).
- "Settlements only" — cities and super_cities don't qualify even if
  they had qualified as settlements before being upgraded (an upgrade
  is a tradeoff vs. retaining the bonus VP).
- Public — visible on PlayerStrip totalVP.

### fortune_teller

- After the original roll (and its 7-chain if 7) fully resolves AND
  any curio/forger picks for the original roll resolve, if the active
  player is fortune_teller AND the original roll was doubles or 7,
  fire a bonus roll:
    - Roll fresh dice.
    - Distribute via `distributeResources`, then keep only the
      fortune_teller player's gain (zero out other players' gains).
    - **Bonus rolls chain**: if the bonus roll is itself doubles or
      7, fire another bonus roll. Repeat until a bonus roll is neither.
    - **No robber on bonus rolls**: a 7 on a bonus roll produces
      nothing for anyone (no discard / move_robber / steal). It still
      counts as a chain trigger, so another bonus roll fires.
    - Curio and forger triggers do NOT fire on bonus rolls (only on
      the original roll).
- Implementation: synchronous loop inside the handler that resolves
  the active player's roll cycle. Each iteration logs a
  `fortune_teller_roll` event.
- Event: `fortune_teller_roll` (dice, gain).

### shepherd

- `requiredDiscards` for shepherd uses `handSize - sheep` instead of
  `handSize` for the > 7 check, and the discard amount itself is also
  computed against the sheep-excluded total.
- New action `shepherd_swap { game_id, take: [Resource, Resource] }`:
    - phase = roll (start of turn, before rolling); current turn = me;
      bonus = shepherd; `!shepherdUsedThisTurn`; sheep ≥ 4.
    - `take` is two resources (duplicates allowed, sheep allowed).
    - Effect: deduct 2 sheep, add `take[0]` and `take[1]`, set
      `shepherdUsedThisTurn = true`. Reset on end_turn.
- One use per turn even if sheep ≥ 6.
- Event: `shepherd_swap` (take).
- UI: small "shepherd" button that only shows in roll phase for the
  acting player when eligible. Discard bar shows a "sheep don't count"
  hint when shepherd && total > 7 but effective ≤ 7.

### metropolitan

- New `VertexBuilding` member: `'super_city'`.
- `BUILD_COSTS.city` unchanged (2 wheat + 3 ore). Super city upgrade
  cost = same (2 wheat + 3 ore).
- New build kind handling:
    - `canBuildMoreSuperCities(state, idx) = bonus === 'metropolitan' && superCityCount(state, idx) < 1`.
    - `isValidBuildSuperCityVertex(state, idx, vertex)`: vertex must be
      the player's city; bonus must be metropolitan; cap not reached;
      passes power curse check.
    - Action `build_super_city { game_id, vertex, swap_wheat_to_ore?: number }`.
      Wheat↔ore swap also available on `build_city`. Validate non-
      negative swap; affordability checked with adjusted cost.
- `distributeResources`: super_city contributes 3 per producing hex
  (city = 2; settlement = 1; super_city = 3). Underdog still
  multiplies on top.
- `totalVP`: super_city contributes 3 (settlement = 1, city = 2).
- Power curse: super_city contributes 3 pips per adjacent hex (city
  was 2). `canPlaceUnderPower` for a super_city upgrade checks
  before/after = 2/3 (a +1 pip change), same delta as settlement → city,
  so the existing helper works without change.
- Liquidation: super_city → city refund 2 wheat + 3 ore (NOT cumulative
  with the settlement → city refund — the city must be liquidated
  separately if the player wants both refunds).
- Wheat→ore swap is one-directional: pay 0..2 ore in place of 0..2
  wheat. Net cost: (2 − Δ) wheat + (3 + Δ) ore for Δ in {0, 1, 2}.
  UI offers a small ↕ control on the build cost widget showing the
  three options when the player has any choice.
- BoardView / VertexPiece: render super_city distinctly (e.g. taller
  silhouette + small "+" badge or crown).
- Build cap badge on PlayerStrip ignores super_city (still 4 cities
  cap; super_city is its own slot).
- Event: `build_super_city` (vertex, paid hand).

### curio_collector

- When `total === 2 || total === 12`, after distribution the edge
  function inspects each curio_collector player's gain. For any
  player whose gain hand sums to ≥ 1 card from this roll, push an
  entry into `phase.pending.curio: number[]`. State enters a sub-phase
  `{ kind: 'curio_pick', resume: ResumePhase, pending: number[] }`.
- Action `claim_curio { game_id, take: Resource[] }`:
    - phase = curio_pick; `meIdx` in pending.
    - `take.length === 3`.
    - Effect: add the 3 resources to the player's hand; remove meIdx
      from pending. When pending empties, transition to `resume`.
- Concurrent across multiple curio_collector players (each one acts
  independently).
- Event: `curio_collected` (take).

### forger

- `PlayerState.forgerToken?: Hex` — undefined until the first 7
  is rolled (any player's roll), then set to whichever hex the robber
  lands on at the end of that 7's chain (after `move_robber` resolves).
- On every subsequent 7 the token re-snaps to the new robber hex
  (regardless of whether the forger is the rolling player).
- Robber on the token's hex: production gating still applies (a hex
  with the robber produces nothing for anyone), so forger doesn't
  trigger from a token hex sitting under the robber.
- Pre-roll move: action `move_forger_token { game_id, hex }`:
    - phase = roll; current turn = me; bonus = forger; token defined.
    - `hex` must be adjacent to current `forgerToken` (shares a
      vertex). Desert allowed — it just doesn't produce.
    - Effect: update `forgerToken`. Optional, at most once per turn
      (tracked via `forgerMovedThisTurn`).
- Production trigger: only on the **original roll** (NOT on
  fortune_teller bonus rolls). For each forger player whose token's
  hex produces (number === total AND not the robber's hex), look up
  the per-player per-hex gain. If at least one OTHER player gained
  ≥ 1 card from the token's hex on this roll, queue the forger pick
  (`phase.pending.forger`).
- Action `pick_forger_target { game_id, target: number }`:
    - phase = forger_pick; head of queue is mine.
    - target is in candidates.
    - Effect: add the target's per-hex gain (the resources the target
      received from the token's hex on this roll) to the forger's
      hand, pop the queue. When queue empties, advance to `resume`.
- If no other player gained from the token's hex: skip silently.
- Order with curio: curio fires before forger (curio resolves any
  `pending.curio` entries, then forger queues kick in). They're both
  parallel-pickable across affected players.
- Event: `forger_token_set`, `forger_token_move`, `forger_copy`
  (target, gain).

## Cross-cutting type changes

- `lib/catan/types.ts`:
    - `PlayerState`:
        - `boughtCarpenterVPThisTurn` already exists.
        - Add `ritualWasUsedThisTurn?: boolean` (reset on end_turn).
        - Add `shepherdUsedThisTurn?: boolean` (reset on end_turn).
        - Add `forgerToken?: Hex`.
        - Add `forgerMovedThisTurn?: boolean` (reset on end_turn).
    - `VertexState`: when `occupied: true`, add `placedTurn: number`.
    - `EdgeState`: when `occupied: true`, add `placedTurn: number`.
    - `Phase`:
        - `post_placement` gains `pending.explorer?: Record<number, number>`.
        - New: `{ kind: 'scout_pick', resume: ResumePhase, owner: number, cards: DevCardId[] }`.
        - New: `{ kind: 'curio_pick', resume: ResumePhase, pending: number[] }`.
        - New: `{ kind: 'forger_pick', resume: ResumePhase, queue: { idx: number; hex: Hex; candidates: number[] }[] }`.
- `lib/catan/board.ts`: `VERTEX_BUILDINGS` adds `'super_city'`.
- `lib/catan/build.ts`:
    - `BUILD_COSTS` keyed by `BuildKind` (unchanged).
    - New `canBuildMoreSuperCities`, `isValidBuildSuperCityVertex`,
      `validBuildSuperCityVertices`. New `BuildKind` member
      `'super_city'`? — no; super_city is a separate action with its
      own validity helpers, not on the build bar's existing kinds.
      The standard `BuildKind = 'road' | 'settlement' | 'city'` stays
      untouched. Super city's UI affordance is a small extra button on
      the build bar (visible only when bonus = metropolitan).
- `lib/catan/dev.ts`:
    - `totalVP` adds super_city VP contribution + populist bonus.
    - `findWinner` now also runs after liquidation (no API change;
      callers in handlers add it).
- `lib/catan/roll.ts`:
    - Returns also a per-hex breakdown for forger lookup.
    - Super city pays 3.
- `lib/catan/robber.ts`: shepherd hand-size adjustment.

## UI

- `lib/catan/PostPlacementOverlay.tsx`: add an `ExplorerPlaceOverlay` /
  inline strip that surfaces "Place 3 free roads" with a counter for
  the local explorer player. Shares the standard road-pick layer
  (BoardView's existing road highlight pulses) — the layer is
  conditioned on `phase === post_placement` AND `pending.explorer[me] > 0`.
- `BuildTradeBar`: add a `metropolitanEnabled?: boolean` build button
  ("Super City") wired to a `onBuildSuperCity` callback. Style
  similar to the carpenter button (accent colour distinct).
- `BoardView` / `VertexPiece`: render `super_city` building variant.
- `RollBar` (the existing roll affordance): add a `Ritual` button for
  ritualist players. Clicking opens a picker modal: number 2..12 plus
  resource-discard picker totalling the cost (2 or 3). Submitting
  fires `ritual_roll`.
- `RollBar` again: add a `Shepherd swap` button for shepherd players
  in roll phase when ≥ 4 sheep.
- `RollBar` for forger players: small "Move forger token" affordance
  when token defined.
- New `ScoutPickOverlay`: full-screen during `scout_pick` for the
  buying player; shows the 3 drawn cards face-up and a Confirm.
  Spectator view is a "waiting on X to peek" overlay.
- New `CurioPickOverlay`: similar pattern, for `curio_pick`.
- New `ForgerPickOverlay`: similar pattern, for `forger_pick`. Lists
  candidate players and the gain each received from the token's hex.
- `DiscardBar`: when shepherd, badge "Sheep don't count toward your
  hand limit".
- `PlayerStrip`: VP totals already account for `totalVP`. Populist's
  +1s flow through automatically; no UI work.
- `GameOverOverlay` scoreboard: add lines for super_city VP and
  populist bonus VP.

## Edge function

Mirror every helper, every new field, every new phase, every new
handler. New handlers:

- `handleLiquidate`
- `handleRitualRoll`
- `handleShepherdSwap`
- `handlePlaceExplorerRoad`
- `handleClaimCurio`
- `handleMoveForgerToken`
- `handlePickForgerTarget`
- `handleConfirmScoutCard`
- `handleBuildSuperCity`

Updated handlers:

- `handleBuyDevCard` — scout swap + 3-card draw transition into
  scout_pick.
- `handleRoll` — fortune_teller extra roll, super_city distribution,
  curio trigger, forger production, forger token re-snap on 7.
- `handleBuildCity` — wheat↔ore swap.
- Post-initial-placement transition — populate `pending.explorer`.
- `handleEndTurn` — reset all per-turn flags.

## Events

- `scout_buy` — cost paid, swap details.
- `scout_pick` — chosen card id (other ids returned to bottom).
- `liquidate` — kind, refund hand.
- `explorer_road` — edge.
- `ritual_roll` — total, cost.
- `shepherd_swap` — take.
- `curio_collected` — take.
- `forger_token_set` — initial hex.
- `forger_token_move` — new hex.
- `forger_copy` — target idx, gain.
- `fortune_teller_roll` — dice, gain.
- `build_super_city` — vertex, paid hand.

## Check script

`dev/check-catan-bonuses.ts` already exists for set 1; extend with one
section per set-2 bonus.

## Implementation order

1. Type additions (PlayerState fields, VertexState/EdgeState
   `placedTurn`, new Phase variants, `super_city` to
   `VertexBuilding`).
2. populist (smallest — totalVP only).
3. shepherd (small handler + discard exemption).
4. ritualist (alternate roll handler).
5. fortune_teller (handleRoll extension).
6. curio_collector (handleRoll trigger + new sub-phase).
7. metropolitan (super_city throughout: types, palette, build,
   distribute, vp, ports). Most invasive of the "data" bonuses.
8. explorer (post_placement extension + new handler + UI layer).
9. scout (dev card buy split + scout_pick sub-phase).
10. forger (token state, distribute helper, new sub-phase, UI move).
11. accountant (placedTurn fields, liquidation handler, road-graph
    disconnect check).
12. Edge function mirror pass.
13. `dev/check-catan-bonuses.ts` extensions.
14. `npm run check` + `npm run edge` + `npm run format`.

## Question resolutions (locked)

1. **Scout deck order** — player sees 3 cards in drawn order; chosen
   card moves to hand; other two go to bottom of deck preserving
   drawn order.
2. **Scout × bricklayer** — do not stack. Scout swap is mutually
   exclusive with the bricklayer alt cost.
3. **Scout deck size** — if deck has ≥ 1 card, scout proceeds with
   `min(3, deck.length)` cards. Empty deck → buy is rejected.
4. **Accountant refund** — full standard cost (city → settlement
   reverts the vertex; super_city → city reverts).
5. **Accountant dev card scope** — all dev cards in hand including
   VP cards (player loses 1 VP per VP card liquidated).
6. **Explorer connectivity** — same as paid roads (must connect to
   the player's own settlement/city or to one of their existing
   roads, including previously placed explorer roads).
7. **Explorer order** — parallel: every explorer player places
   independently, off-turn permitted, in any order.
8. **Ritualist cost gate** — 2 cards if `cityCount + superCityCount ===
0`, else 3 cards. Super_city counts as a city.
9. **Ritualist may not choose 7** — `total ∈ {2..6, 8..12}`.
10. **Fortune teller chains** — bonus rolls themselves trigger another
    bonus roll if doubles or 7. Chain terminates on first non-doubles
    non-7 result.
11. **Fortune teller bonus 7** — bonus roll of 7 produces nothing
    for anyone; no 7-chain (no discards / robber). Still chains.
12. **Fortune teller × curio/forger** — curio and forger fire only
    on the original roll, not on bonus rolls.
13. **Shepherd swap** — once per turn even if sheep ≥ 6.
14. **Metropolitan super_city cost** — same as city (2 wheat + 3 ore).
15. **Metropolitan wheat↔ore swap** — one-directional only (wheat →
    ore: pay extra ore in place of wheat).
16. **Metropolitan power** — super_city pips = 3, build delta from
    city to super_city is +1 per adjacent hex (same delta as
    settlement→city, so existing `canPlaceUnderPower` works).
17. **Curio trigger** — fires only when the player gained ≥ 1 card
    from the 2/12 original roll.
18. **Forger token activation** — activates the FIRST time a 7 is
    rolled by any player; snaps to the post-7 robber hex.
19. **Forger move** — at most once per turn, only to a vertex-adjacent
    hex.
20. **Forger production** — copies one chosen other player's gain
    from the TOKEN'S HEX specifically (not the full roll). Multiple
    eligible players → forger picks one. No eligible player → silent
    skip.
21. **Forger × robber** — robber-occupied hex doesn't produce; forger
    doesn't trigger from such a hex.
22. **placedTurn migration** — required field, no fallback. Legacy
    games refuse to load.
