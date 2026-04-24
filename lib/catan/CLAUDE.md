# Catan

Everything Catan-specific lives here. Split by what it describes:

- `board.ts` — static structure: hex/vertex/edge IDs, adjacency maps, resource and number constants. Pure data + tiny helpers, no game state.
- `types.ts` — `GameState`, `Phase`, sparse-storage helpers (`vertexStateOf`, `edgeStateOf`). All persisted shapes.
- `generate.ts` — fresh-game initialization: variant-keyed hex generation, `initialGameState`.
- `placement.ts` — pure rules for the initial-placement phase (validity, target-settlement derivation, snake-order turn advance, starting-resource grant). No I/O; callable from UI helpers and tests.
- `roll.ts` — pure rules for the main-phase loop (dice roll, per-hex resource distribution, forward turn rotation). No I/O; callable from UI helpers and tests.
- `build.ts` — pure rules for main-phase builds (road, settlement, city): costs, affordability, validity (including the "no road through opponent settlement" rule). No I/O; callable from UI helpers and tests.
- `trade.ts` — pure rules for player-to-player trade offers: shape validity, affordability, offer-addressing, hand swap. A game carries at most one open `TradeOffer` at a time. No I/O.
- `ports.ts` — pure rules for ports (harbors) and bank trades: which port kinds a player has access to, which bank ratios they can use (2:1 specific / 3:1 generic / 4:1 default), shape validity for multi-group bank trades, hand update. No I/O.
- `robber.ts` — pure rules for the 7-roll chain: discard requirements, robber-movement validity, steal candidates. No I/O; callable from UI helpers and tests.
- `devCards.ts` — static dev-card data: `DevCardId` union, `DEV_CARD_POOL` (title/description/icon), `DEV_DECK_COMPOSITION` (classic 14/5/2/2/2 split). Mirror of `bonuses/`.
- `bonuses/` — static bonus + curse card data. `index.ts` defines shared types (`BonusId`, `CurseId`, `Bonus`, `Curse`) and re-exports. `bonuses.ts` has `BONUS_POOL`; `curses.ts` has `CURSE_POOL`. Both pools are mirrored in the edge function.
- `bonus.ts` — pure rules for sets 1 and 2. Set 1: VP threshold (`winVPThresholdFor` takes both bonus + curse), port discount (`effectiveBankRatio`), underdog multiplier (`underdogMultiplierFor`), bricklayer alt cost (`bricklayerAltCost`, `BRICKLAYER_COST`), carpenter VP (`canBuyCarpenterVP`, `carpenterVPOf`), veteran knight tap (`availableKnightsToTap`, `canTapKnight`), gambler reroll (`canReroll`), aristocrat placement (`grantsStartingResourcesOnRound`), nomad d5 (`nomadResourceForRoll`). Set 2: populist VP (`populistBonusVPFor`, `pipCountFor`, `pipsAtVertex`), shepherd hand size (`shepherdEffectiveHandSize`, `canShepherdSwap`), ritualist (`isValidRitualTotal`, `ritualCardCost`, `dicePairForTotal`, `canRitualRoll`), fortune teller chain trigger (`fortuneTellerTriggersOn`), curio collector trigger (`curioCollectorTriggers`), metropolitan (`canBuildMoreSuperCities`, `superCityCount`, `metropolitanWheatSwapDelta`, `metropolitanCityCost`), forger (`forgerActive`, `canMoveForgerToken`, `hexesAdjacentTo`), scout (`isValidScoutSwap`, `scoutDevCardCost`), accountant (`roadRemovalSplitsBuildings`, `ROAD_REFUND`/`SETTLEMENT_REFUND`/`CITY_REFUND`/`SUPER_CITY_REFUND`/`DEV_CARD_REFUND`). Singular filename (parallel to `dev.ts`) because `bonuses/` already owns the plural name.
- `dev.ts` — pure rules for development cards: cost, deck build + shuffle, buy/play validity, Largest Army recomputation, `totalVP` (including Longest Road +2 and hidden VP cards for self-views). No I/O.
- `longestRoad.ts` — pure rules for the Longest Road bonus: `longestRoadFor` walks an edge-disjoint trail per player (opponent buildings block pass-through at interior vertices); `recomputeLongestRoad` returns the new holder (≥5 trail, strict majority; ties keep current holder). No I/O.
- `GameOverOverlay.tsx` — final-scoreboard modal shown when `games.status === 'complete'`. Reveals every player's hidden VP cards. Exports `FinalScoreButton` for the reopen affordance after dismiss.
- `gameContext.tsx` — React context that loads the per-game `games` row + `game_states` row and subscribes to realtime. Use `useGame()` in any subtree under `<GameProvider>`.

## Constants are duplicated in the edge function

`supabase/functions/game-service/index.ts` re-declares `HEXES`, `VERTICES`, `EDGES`, `adjacentVertices`, and the derived adjacency IIFEs from `board.ts`, plus the placement rules from `placement.ts`, the roll/distribution rules from `roll.ts`, the build rules from `build.ts`, the trade rules from `trade.ts`, the robber rules from `robber.ts`, the port/bank-trade rules from `ports.ts` (including `PORT_SLOTS` + `STANDARD_PORT_KINDS`), the dev-card rules from `dev.ts` + `devCards.ts` (deck composition, `DEV_CARD_COST`, `buildInitialDevDeck`, Largest Army recomputation), the Longest Road walk + recompute from `longestRoad.ts`, and `totalVP` / `findWinner` (victory at 10 VP). The Deno bundler can't reliably import up-tree from `supabase/functions/`, so we accept a single redundancy: change both when rules or board data change. The source of truth is `lib/catan/`; the edge function is the copy.

Phase sub-phases (`discard`, `move_robber`, `steal`, `road_building`) carry a `resume: ResumePhase` pointer so effects triggered from different contexts return correctly: 7-roll chain resumes to `main`, knight played before rolling resumes to `roll`, road_building resumes to whichever phase the player was in.

**post_placement** sits between `initial_placement` and `roll`, for any start-of-game bonus that needs a player decision. Today it can carry `pending.specialist` (set-1 specialist) and `pending.explorer` (set-2 explorer's 3 free roads). Both drain in parallel — once every entry resolves, the phase advances to `roll`. Players without a start-of-game bonus don't block — the phase is skipped entirely when no pending entries exist.

**Gambler roll confirmation**: for gambler players the `roll` phase carries `pending.dice` after the first roll. The player either commits (via `confirm_roll`, applying distribution / 7-chain) or rerolls once (via `reroll_dice`, setting `rerolledThisTurn`). Non-gambler rolls skip the pending state and apply atomically. Reset `rerolledThisTurn`, `boughtCarpenterVPThisTurn`, `ritualWasUsedThisTurn`, `shepherdUsedThisTurn`, `forgerMovedThisTurn` on `end_turn`.

**Set-2 sub-phases** chain via recursive `resume: Phase`:

- `scout_pick` — scout dev-card buy peek (top up-to-3); buyer picks one, the rest go to bottom of deck in drawn order. Resolved by `confirm_scout_card`.
- `curio_pick` — for any curio_collector who gained ≥1 card from a 2/12 original roll. Each pending entry independently claims +3 resources via `claim_curio`.
- `forger_pick` — head-of-queue forger picks one candidate to copy from for the token's hex on this roll, via `pick_forger_target`.

A roll that triggers both curio AND forger chains as `forger_pick(resume = curio_pick(resume = main))`. Bonus rolls (fortune_teller) never trigger these or the robber. Forger token snap on a 7 fires inside `handleMoveRobber` (gated by `from7` flag carried through the `discard`/`move_robber`/`steal` chain).

**placedTurn** (required field on occupied vertices and edges) records `state.round` at placement time. Initial-placement pieces stamp `placedTurn = 0`. Used by the accountant's liquidation gate (`placedTurn < state.round`) to enforce "not the same turn it was bought".

When in doubt, run the check scripts — `npx tsx dev/check-catan-board.ts`, `check-catan-placement.ts`, `check-catan-roll.ts`, `check-catan-build.ts`, `check-catan-trade.ts`, `check-catan-robber.ts`, `check-catan-ports.ts`, `check-catan-dev.ts`, `check-catan-longest-road.ts`, `check-catan-curses.ts`, `check-catan-bonuses.ts` — after edits. The edge function is only validated at deploy time (`npm run edge`).

## Sparse storage

`GameState.vertices` and `GameState.edges` are `Partial<Record<…, …>>`. Missing keys default to `{ occupied: false }` via `vertexStateOf` / `edgeStateOf`. Code that writes state should continue to set only occupied entries — never pre-fill 54 + 72 empty entries.
