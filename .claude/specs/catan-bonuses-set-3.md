# Catan bonuses — set 3

Wires gameplay effects for the 7 bonuses with `set: '3'` in
`lib/catan/bonuses/bonuses.ts`. Third and final batch after
`catan-bonuses-set-1.md` and `catan-bonuses-set-2.md`, both live.

Depends on: set 1 (`post_placement` phase + `pending` drain model, gambler
roll-pending shape, BuildTradeBar special-button styling, bonus-aware helper
conventions in `lib/catan/bonus.ts`) and set 2 (`super_city` VertexBuilding
precedent, recursive `resume: Phase` sub-phase chaining, `*PickOverlay`
pattern, `placedTurn` fields).

## Scope — all 7 set-3 bonuses

- `merchant` — any time you make a bank/port trade, you may pay N additional
  of the trade's input resource to receive N additional resources of your
  choice (a 1:1 side-conversion riding a valid bank trade). Applies to any
  bank trade, including the default 4:1.
- `plutocrat` — every time you gain ≥2 of a single resource from a roll, gain
  50% more of that resource (floor). Per-resource, per-roll.
- `fencer` — start of game: place tokens on two empty edges. No other player
  may ever build a road on a fenced edge. When the fencer builds a road on
  their own fenced edge, it costs 1 card — either 1 Wood or 1 Brick (their
  choice) — instead of 1 Wood + 1 Brick.
- `smith` — may substitute Brick for Ore and vice versa when paying for
  buildings, dev cards, and bank/port trades.
- `investor` — once your total VP is ≥3, during your turn you may set aside 3
  of one resource to gain an "investment token" for it, with no cap on how
  many. At the start of each of your turns, gain 1 resource per token.
  Invested cards are set aside — not stealable and not counted toward the
  7-discard hand limit.
- `magician` — after your own roll resolves, you may once discard N+1 cards to
  additionally receive the production of a number N away from the actual
  result (your choice of direction). Only you gain from it.
- `haunt` — start of game: secretly pick two currently-buildable vertices.
  When a spot becomes unbuildable via a neighbor being built (the spot itself
  still empty), a "ghost" settlement spawns there for you: it produces
  resources like a settlement but is worth 0 VP and is fully non-interfering
  (does not enforce the distance rule for others, does not block opponent
  road networks). If a spot is built on directly, no ghost spawns there.

## Locked decisions (from clarification)

1. **Magician scope** — only the magician's own-turn roll triggers the
   window. No reacting to opponents' rolls.
2. **Haunt ghosts** — fully non-interfering: produce + are steal targets, but
   do NOT enforce distance for others and do NOT block opponent road
   networks. Ghost spawns only when a spot is blocked by a _neighbor_ build
   (spot still empty); a direct build on the spot yields no ghost.
3. **Investor gate** — the 3-VP threshold gates the _entire_ ability: you
   cannot invest at all until total VP (including hidden VP cards) ≥ 3.
   Payout also requires ≥3.
4. **Merchant trigger** — any bank trade counts, including the default 4:1.
5. **Fencer cost** — a reserved-edge road costs 1 card: Wood or Brick, the
   fencer's choice.
6. **Fencer tokens** — placed on any empty edge; building the reserved road
   later still requires normal connectivity to the fencer's network.
7. **Smith scope** — Brick↔Ore substitution applies to builds, bank/port
   trades, AND dev-card purchases (fungible everywhere a cost is paid).
8. **Magician uses** — once per roll. Direction (result ±N) is the magician's
   choice; N ≥ 1, discarding N+1 cards; the phantom number must land in 2..12
   (a phantom 7 produces nothing).

## Architecture

- Behaviour helpers extend `lib/catan/bonus.ts` under a new
  `=== Set 3 ===` section. Static data stays in `bonuses/bonuses.ts`.
- New building kind `'ghost'` joins `VERTEX_BUILDINGS` in `board.ts`. Like
  `super_city` (set 2) it ripples through distribution, VP, counts, caps,
  power pips, longest road, palette, and rendering — but as a _0-VP,
  non-blocking_ building rather than a high-value one.
- New `GameState.fenceTokens?: Partial<Record<Edge, number>>` — edge → owning
  fencer player index. Public (every client needs to know which edges are
  reserved). Consumed (deleted) when the fencer finally builds the road.
- New per-player state: `investments` (token counts) and `hauntSpots` (secret
  vertices). `hauntSpots` is _soft-hidden_ — stored in shared state but never
  rendered for other players, matching how opponents' hidden VP dev cards are
  already handled (revealed only if a ghost spawns). Documented as a known
  limitation, not a hard secrecy guarantee.
- New actions (edge function):
    - `place_fence_token` (fencer; post_placement)
    - `set_haunt_spots` (haunt; post_placement)
    - `invest` (investor; main)
    - `cast_magic` / `skip_magic` (magician; new `magician_pick` sub-phase)
- Existing actions extended (optional payloads, gated on bonus):
    - `bank_trade` — `merchant` add-on payload.
    - `build_road` — `fencePay?: 'wood' | 'brick'` for reserved-edge builds.
    - `build_road` / `build_settlement` / `build_city` /
      `build_super_city` / `buy_dev_card` — `smithSwap?: number`.
- Existing handlers extended:
    - `handleRoll` — plutocrat gain bump (via `distributeResources`), and
      entering `magician_pick` after the roller's roll resolves.
    - `handleBuildSettlement` — run haunt-ghost trigger resolution after any
      settlement is placed (any player).
    - `handleEndTurn` — investor start-of-turn payout for the incoming player.
    - Post-initial-placement transition — populate `pending.fencer` and
      `pending.haunt` alongside `pending.specialist` / `pending.explorer`.

## Shared helpers (additions to `lib/catan/bonus.ts`)

### merchant

- `isValidMerchantAddon(give: ResourceHand, addon: MerchantAddon): boolean` —
  the base `give` must be a single-resource stack; `addon.resource` must equal
  that resource; `addon.count ≥ 1`; `sum(addon.take) === addon.count`;
  `take` uses only non-negative amounts. (`MerchantAddon = { resource:
Resource; count: number; take: ResourceHand }`.)
- The merchant portion is a straight 1:1: deduct `count` of `resource`, add
  `take`. Applied on top of the base bank trade's hand update.

### plutocrat

- `plutocratGain(hand: ResourceHand): ResourceHand` — returns a hand where
  each resource r with `hand[r] ≥ 2` is increased by `floor(hand[r] / 2)`.
  Applied to a plutocrat player's _summed_ roll gain inside
  `distributeResources` (after all their buildings are tallied), so 2→3, 3→4,
  4→6, 5→7. Does NOT feed `distributeResourcesByHex` (forger copies base
  per-hex gains; the plutocrat's roll-total bump is separate).

### fencer

- `FENCE_TOKEN_COUNT = 2`.
- `fenceOwner(state, edge): number | null` — reads `state.fenceTokens`.
- `isFenceReservedAgainst(state, edge, playerIdx): boolean` — true iff a
  fence token exists on `edge` owned by someone other than `playerIdx` (this
  edge is off-limits to `playerIdx`).
- `FENCE_ROAD_COST(pay: 'wood' | 'brick'): ResourceHand` — 1 of `pay`, 0 else.
- `canBuildFenceRoad(state, playerIdx, edge, pay): boolean` — bonus fencer,
  the edge carries the player's own token, edge unoccupied, passes the normal
  connectivity rule, and the hand has ≥1 of `pay`.

### smith

- `SMITH_SWAPPABLE = { brick: 'ore', ore: 'brick' } as const`.
- Every standard build/dev cost has at most one of {brick, ore} non-zero.
  `smithCostOf(bonus, standardCost, swap: number): ResourceHand` — if bonus is
  smith and the cost has a brick component, move `clamp(smithSwap, 0,
cost.brick)` units to ore; symmetrically for an ore component. Non-smith →
  standard cost.
- `isValidSmithSwap(standardCost, swap): boolean`.
- `smithPortResourceOk(locked: Resource | null, giveResource, isSmith)` —
  for a 2:1 specific port, a smith may satisfy a `brick` lock with `ore` and
  vice versa. Used by `isValidBankTradeShape`.

### investor

- `INVEST_TRIO = 3`.
- `investorTokenCount(p): number` — sum of `p.investments`.
- `canInvest(p, resource, totalVP): boolean` — bonus investor, `totalVP ≥ 3`,
  `p.resources[resource] ≥ 3`. Tokens are uncapped.
- `investorPayout(p): ResourceHand` — 1 per token per resource (the hand
  granted at the start of the investor's turn).

### magician

- `magicianCanCast(p): boolean` — bonus magician.
- `isValidMagicTarget(actualTotal, target): boolean` — integer target in
  2..12, `target !== actualTotal`.
- `magicDiscardCount(actualTotal, target): number` —
  `Math.abs(target - actualTotal) + 1`.

### haunt

- `HAUNT_SPOT_COUNT = 2`.
- `isGhost(vs): boolean`.
- `resolveHauntGhosts(state): { state, spawned: { player, vertex }[] }` — for
  every haunt player, for each remaining spot: if the spot vertex is now
  occupied → drop it (no ghost); else if a neighbor vertex is occupied (spot
  became unbuildable) → occupy the spot with a `ghost` for that player,
  `placedTurn = state.round`, and drop it from `hauntSpots`. Re-run to a fixed
  point (a spawned ghost can block another spot). Pure; callers apply it after
  any settlement build.

## Per-bonus implementation notes

### merchant

- `bank_trade { game_id, give, receive, merchant? }`. When `merchant` is
  present: gate on bonus, validate the base `(give, receive)` via
  `isValidBankTradeShape` AND `isValidMerchantAddon(give, merchant)`, confirm
  the hand affords `give` + `merchant.count` of `merchant.resource`. Apply the
  base bank trade, then deduct `count` of `resource` and add `merchant.take`.
- The base trade's `give` is required to be a single-resource stack when a
  merchant add-on is attached (so "the input resource" is unambiguous).
- Event: extend the bank-trade event with the merchant add-on (`+N in, +N
out`), or a dedicated `merchant_trade` event carrying both halves.
- UI: `TradePanel` bank composer gains a merchant add-on row (only for the
  merchant, only when the give side is a single resource): a stepper for N
  extra input + a small picker distributing N receives. Rides the same submit.

### plutocrat

- Integrated into `distributeResources`: after tallying a player's per-roll
  hand, if the player is plutocrat, replace it with `plutocratGain(hand)`.
- Only fires on non-7 rolls (a 7 distributes nothing). No discard interaction.
- Public — nothing hidden; the extra cards just land in the hand.
- Event: fold into the existing roll/distribution logging (a `plutocrat_bonus`
  event per plutocrat player who benefited, for history readability).

### fencer

- Post-placement: transition seeds `pending.fencer[idx] = 2` for each fencer.
- Action `place_fence_token { game_id, edge }`:
    - phase = post_placement, `pending.fencer[meIdx] > 0`.
    - edge unoccupied AND not already fenced (by anyone).
    - Effect: `fenceTokens[edge] = meIdx`, decrement the counter; drop the
      entry at 0. Parallel with specialist/explorer/haunt — drains
      independently, off-turn permitted.
- Road builds honor fences everywhere they check road validity:
    - `isValidBuildRoadEdge` returns false when
      `isFenceReservedAgainst(state, edge, playerIdx)` (blocks non-owners
      permanently).
    - `validBuildRoadEdges` inherits this.
- Reserved-edge build: `build_road { game_id, edge, fencePay? }`. When the
  edge carries the player's own fence token: gate on `canBuildFenceRoad`,
  charge `FENCE_ROAD_COST(fencePay ?? 'wood')` (default Wood; validate the
  chosen resource is affordable), place the road, and **delete the fence
  token** (its job is done). Longest-road recompute runs as for any road.
- `cardsSpentThisTurn` (age curse) counts the 1 card actually paid.
- Event: `fence_token` (edge) on placement; reserved-edge builds fold into
  the normal build event (note the discount).
- UI: post_placement fencer layer (reuse the board edge-pick highlight, gated
  on `pending.fencer[me] > 0`), a new `FenceTokenPiece` rendered on reserved
  edges (distinct from a road), and the build layer offering own-fence edges
  with the 1-card cost (a Wood/Brick toggle when the player has both).

### smith

- Build/buy handlers accept `smithSwap?: number`. The effective cost is
  `smithCostOf(p.bonus, standardCost, smashSwap)`; affordability + deduction
  use it. `smithSwap` and metropolitan's `swapDelta` / bricklayer's
  `use_bricklayer` are mutually exclusive by bonus (one bonus per player).
- `canAffordPurchase` / `effectiveCostFor` in `build.ts` gain smith awareness
  so button-gating and highlight logic match the server. (A smith with no
  `smithSwap` requested still needs the affordability check to consider the
  fungible pool for enabling the button; the client then submits the concrete
  `smithSwap` it computed.)
- Ports: `isValidBankTradeShape` consults `smithPortResourceOk` so a smith may
  use a 2:1-brick port to give ore (and 2:1-ore to give brick). Generic
  3:1/4:1 already accept any resource — unchanged.
- Dev cards: `buy_dev_card` applies `smithSwap` to the ore component of the
  dev cost (scout's swap is a different bonus; not combinable).
- UI: build/dev buttons show the smith substitution as an alternate cost line
  (like bricklayer's), with a small Brick↔Ore toggle when both payment routes
  are affordable.

### investor

- `PlayerState.investments?: Partial<Record<Resource, number>>`.
- Action `invest { game_id, resource }`:
    - phase = main, current turn = me, bonus investor.
    - `canInvest(me, resource, totalVP(state, meIdx))` — the ≥3-VP gate blocks
      investing entirely below the threshold; needs ≥3 of `resource`.
    - Effect: deduct 3 of `resource`; `investments[resource] += 1`. No cap on
      tokens; may invest multiple times per turn.
    - Runs `applyEndOfActionChecks` (no VP change, but keeps the pattern).
- Start-of-turn payout: in `handleEndTurn`, after computing the incoming
  active player, if they are an investor with ≥1 token AND `totalVP ≥ 3`, add
  `investorPayout` to their hand before the roll phase begins. Log
  `investor_payout` (resources gained).
- No withdrawal (tokens are permanent; investor is not accountant).
- Invested cards are excluded from steal + 7-discard automatically because
  they live in `investments`, not `resources` — `stealCandidates` /
  `handSize` read `resources` only. No change needed there.
- `totalVP` is unaffected by investments (they are not VP).
- UI: `BuildTradeBar` "Invest" button (bonus-gated; enabled when the ≥3-VP
  gate is met, some resource ≥3, tokens<6) opening a resource picker. Show the
  player's investment tokens on `PlayerStrip` / `PlayerDetailOverlay` (public
  — a small per-resource token count). Start-of-turn payout surfaces via the
  action log / a brief animation (optional; reuse an existing gain animation).

### magician

- New phase `{ kind: 'magician_pick'; resume: Phase; roller: number; roll:
DiceRoll }`.
- After the roller's roll fully resolves (distribution + any 7-chain), and
  before returning to `main`, if the roller is a magician wrap the resume
  chain so `magician_pick` fires **first** (outermost), then any curio /
  forger reactions, then `main`:
  `magician_pick(resume = forger_pick?(resume = curio_pick?(resume = main)))`.
  The phantom production does not affect curio/forger inputs (those read the
  actual roll's per-hex gains, already computed), so magician-first is safe.
  A magician can never also be a fortune_teller (one bonus per player), so no
  interaction with bonus rolls.
- Action `cast_magic { game_id, target, discard }`:
    - phase = magician_pick, `roller === meIdx`.
    - `isValidMagicTarget(totalDice(roll), target)`.
    - `discard` totals `magicDiscardCount(total, target)` and is a valid
      subset of the hand.
    - Effect: deduct `discard`; compute `distributeResources(state, target)`
      and add only `result[meIdx]` to the magician's hand (phantom 7 → nothing;
      robber-occupied hexes still don't produce). Advance to `resume`.
- Action `skip_magic { game_id }` — `roller === meIdx`; advance to `resume`.
- Event: `magic_cast` (target, discarded, gained).
- UI: `MagicianPickOverlay` for the roller during `magician_pick`: shows the
  actual roll, a number picker (2..12) with the live card cost (`|Δ|+1`) and a
  discard selector, a preview of resources gained, plus Cast / Skip. Other
  players see a brief "waiting on X" state (their turn isn't blocked long — the
  magician is the active player).

### haunt

- `PlayerState.hauntSpots?: Vertex[]` (soft-hidden; see Architecture).
- Post-placement: seed `pending.haunt = [idx…]` for haunt players.
- Action `set_haunt_spots { game_id, spots: [Vertex, Vertex] }`:
    - phase = post_placement, `meIdx ∈ pending.haunt`.
    - Two distinct vertices, each a currently buildable location
      (`isValidSettlementVertex(state, v)` — pure distance rule, no
      connectivity/ownership requirement). Effect: set `hauntSpots`, remove
      `meIdx` from pending.
- New building kind `'ghost'`:
    - Distribution: `distributeResources` / `distributeResourcesByHex` base =
      1 for `'ghost'` (same as settlement). Underdog/city multipliers N/A
      (ghost is its own kind).
    - `totalVP`: ghost contributes 0.
    - Counts/caps: `settlementCountFor` excludes ghosts (they don't consume
      the settlement supply). `cityCountFor` already excludes them. Populist
      (`building === 'settlement'`) already excludes them.
    - Distance rule: `isValidSettlementVertex` / `isValidBuildSettlementVertex`
      neighbor scan skips ghost-occupied neighbors (ghosts don't prevent
      building within one hex). The exact ghost vertex stays occupied (can't
      build directly on it).
    - Longest road: `longestRoadFor` treats a ghost as non-blocking — an
      opponent's trail passes through a ghost vertex as if empty (for the
      owner it never blocked anyway).
    - Power curse pips: a ghost counts as a producing building (settlement =
      pips) for its owner's power-pip total, since it produces resources.
    - City upgrade: impossible — `isValidBuildCityVertex` requires
      `building === 'settlement'`, so ghosts are excluded automatically.
    - Steal: a ghost is an occupied vertex owned by the haunt player, so
      `stealCandidates` already includes them when a ghost sits by the robber.
    - Port access: a ghost on a port vertex grants the haunt player that port
      (it's a building there; consistent with "collects resources as normal").
      Automatic via `playerPortKinds`.
- Trigger resolution: after every settlement build (in `handleBuildSettlement`,
  for any builder), run `resolveHauntGhosts` to a fixed point. Ghost spawns
  are logged `ghost_spawned` (player, vertex) and are public from then on.
  Also run once at each ghost spawn's fixed point so chained blocks resolve.
- `set_haunt_spots` is the only place spots are set; a spot built on directly
  is dropped with no ghost (handled inside `resolveHauntGhosts`).
- UI: `set_haunt_spots` picker during post_placement (board vertex-pick layer,
  pick 2), rendered only for the local haunt player. `BoardView` / new
  `GhostPiece` (or a `VertexPiece` `'ghost'` variant) renders ghosts
  translucently. Secret spots are never drawn for other players.
- Event: `haunt_spots_set` (no coordinates in the public log — just "chose
  their haunts"), `ghost_spawned` (player, vertex).

## Cross-cutting type changes

- `lib/catan/types.ts`:
    - `PlayerState`:
        - `investments?: Partial<Record<Resource, number>>`
        - `hauntSpots?: Vertex[]`
    - `GameState.fenceTokens?: Partial<Record<Edge, number>>`
    - `Phase`:
        - `post_placement.pending` gains
          `fencer?: Partial<Record<number, number>>` and `haunt?: number[]`.
        - New `{ kind: 'magician_pick'; resume: Phase; roller: number; roll:
DiceRoll }`.
- `lib/catan/board.ts`: `VERTEX_BUILDINGS` adds `'ghost'`.
- `lib/catan/palette.ts`: color/legend entry for ghost + fence token.
- `lib/catan/roll.ts`: plutocrat gain bump; ghost = 1 in both distribute
  helpers.
- `lib/catan/ports.ts`: merchant add-on has no port-rule change (applied in
  the handler); smith brick↔ore lock relaxation in `isValidBankTradeShape`.
- `lib/catan/build.ts`: fence-reservation block in road validity; smith
  awareness in `effectiveCostFor` / `canAffordPurchase`; ghost handling in
  settlement distance checks and counts.
- `lib/catan/placement.ts`: ghost-aware neighbor scan in
  `isValidSettlementVertex`.
- `lib/catan/longestRoad.ts`: ghosts are non-blocking.
- `lib/catan/curses.ts`: `settlementCountFor` excludes ghosts; power-pip
  counting includes ghosts as producers.
- `lib/catan/dev.ts`: `totalVP` ghost = 0 (and drives the investor gate +
  magician N/A).

## Edge function

Mirror every helper, field, phase, and handler. New handlers:

- `handlePlaceFenceToken`
- `handleSetHauntSpots`
- `handleInvest`
- `handleCastMagic`
- `handleSkipMagic`

Updated handlers:

- `handleBankTrade` — merchant add-on; smith brick↔ore lock relaxation.
- `handleBuildRoad` — fence-reservation block + reserved-edge discount +
  token consumption; smith swap.
- `handleBuildSettlement` — smith swap + `resolveHauntGhosts` after placement.
- `handleBuildCity` / `handleBuildSuperCity` / `handleBuyDevCard` — smith swap.
- `handleRoll` — plutocrat bump (through `distributeResources`); enter
  `magician_pick` when the roller is a magician.
- `handleEndTurn` — investor start-of-turn payout for the incoming player.
- Post-initial-placement transition — populate `pending.fencer` +
  `pending.haunt`.

## Events

- `merchant_trade` — base trade + add-on (or extend the bank-trade event).
- `plutocrat_bonus` — player, extra gained.
- `fence_token` — edge (placement).
- `invest` — resource (trio set aside).
- `investor_payout` — resources gained at turn start.
- `magic_cast` — target number, discarded, gained.
- `haunt_spots_set` — player only (coordinates stay private).
- `ghost_spawned` — player, vertex.
- Smith / fencer-discount builds fold into the existing build events.

## UI inventory

- `TradePanel` — merchant add-on row; smith Brick↔Ore toggle on bank rows.
- `BuildTradeBar` — "Invest" button (investor); smith alternate-cost line +
  toggle on build buttons.
- `PostPlacementOverlay` — fencer token-placement layer + haunt spot-pick
  layer, alongside the existing specialist/explorer layers.
- `BoardView` — `FenceTokenPiece` on reserved edges; `'ghost'` VertexPiece
  variant.
- `MagicianPickOverlay` — new, for `magician_pick`.
- `PlayerStrip` / `PlayerDetailOverlay` — investment-token badge (public).
- `DevCardHand` / build buttons — smith substitution affordance.
- `create-game.tsx` — unlock the Set 3 checkbox (remove the `setId === '3'`
  lock at line ~307).
- `GameOverOverlay` — nothing new for VP (ghosts are 0, investments are 0);
  no scoreboard line needed.

## Check script

`dev/check-catan-bonuses.ts` — add one section per set-3 bonus (plutocrat gain
table, smith cost swaps, merchant add-on validity, fence reservation +
discount, investor gate/payout, magician target validity + phantom
production, haunt trigger resolution incl. the direct-build no-ghost case and
the chained-block fixed point).

## Implementation order

1. Types (PlayerState fields, `GameState.fenceTokens`, `'ghost'` building,
   `magician_pick` + post_placement pending extensions).
2. plutocrat (distribute post-process — smallest).
3. smith (cost substitution across builds / dev / ports).
4. merchant (bank_trade add-on).
5. fencer (post_placement tokens + reserved-edge build discount + reservation
   block).
6. investor (invest action + turn-start payout + ≥3-VP gate).
7. magician (`magician_pick` sub-phase + phantom production).
8. haunt (ghost building kind throughout + trigger resolution + secret spots).
9. Edge-function mirror pass.
10. `create-game.tsx` Set 3 unlock.
11. `dev/check-catan-bonuses.ts` extensions + `npm run check` +
    `npm run edge` + `npm run format`.
