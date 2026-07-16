# Extra build times — special build phase

## Status — IMPLEMENTED (pending edge deploy)

Implemented on branch `extra-build-times`. `npx tsc --noEmit` + `eslint .` clean; all
`dev/check-catan-*.ts` pass (incl. new `acrossSeat` / `specialBuildQueue` tests in
`check-catan-roll.ts`).

**Config reshaped (supersedes the original plumbing commit):** the single
`extraBuildTimes: 'every-turn'|'across'|'off'` field became `extraBuild: { enabled,
buildPhases: 'every'|'across', moreThanSeven }` — a top-level on/off plus two sub-toggles
(cadence, and "only build while holding > 7 cards"). Create-game shows a `CompactToggleRow`
plus two `SegmentedRow`s (only when the table would seat 5+).

**Not yet done — must happen on merge:** `npm run edge` (the engine mirror lives in
`supabase/functions/game-service/index.ts`; real games run server-side). No DB migration
(config is JSONB; a legacy game with no `extraBuild` defaults to disabled).

**Known limitation:** a `scout` bonus player can't buy a dev card during an SBP slot (the peek
`scout_pick.resume` can't carry the build queue) — server rejects it, client hides the button.

## Goal

Implement the Catan 5–6 player **special build phase** (SBP), driven by the already-shipped
`GameConfig.extraBuild` (`{ enabled, buildPhases: 'every' | 'across', moreThanSeven }`). Only
applies to games with **>4 players** (`player_order.length > 4`); a no-op otherwise and when
`extraBuild.enabled` is false.

During an SBP slot, a player who is **not** the current turn-holder may:

- build road / settlement / city
- buy a dev card
- do a bank/port trade (4:1 / 3:1 / 2:1)

and may **not**: roll, move robber, trade with other players, play a dev card, build a
super-city, buy a carpenter VP, tap a knight, or liquidate. (Per requirements Q&A — matches
the official expansion's restricted build window.)

## Locked decisions (from requirements Q&A)

1. **All three settings now**, via one queue-based phase. `!enabled` and 2–4 player games skip
   the phase entirely (fully backward-compatible).
2. **Allowed actions** = build road/settlement/city, buy dev card, bank/port trade only.
3. **Odd-player 'across' mapping** = builder is `(ender + ⌊N/2⌋) mod N`. Uniform with even N
   (`N/2`). For N=5 the offset is 2.
4. **`moreThanSeven`** = when true, a queued player may build during the SBP only while their
   resource-card count is `> 7` (the discard threshold), enforced per-action (see below).

## Config → builder queue

At `end_turn` by the player at seat `X` (= `current_turn`), with `N = player_order.length` and
`eb = state.config.extraBuild`:

- **`!eb.enabled`** or **`N ≤ 4`** → queue `[]` (no SBP; today's behavior).
- **`buildPhases === 'across'`** → `[(X + ⌊N/2⌋) mod N]` — exactly one builder ("the player
  across the table", or for odd N the slot just past directly-across). Every player
  special-builds once per round.
- **`buildPhases === 'every'`** → all **other** players in clockwise order starting from the
  next seat: `[(X+1)%N, (X+2)%N, …, (X+N-1)%N]` (N-1 entries). The next roller `X+1` is
  **included** (Q1 resolved: faithful — they SBP-build then take their normal turn).

`queue[0]` is the **acting** builder; the rest are pending. Order = the order they act.

Pure helper (client + edge mirror), added to `lib/catan/roll.ts`:

```ts
export function acrossSeat(idx: number, n: number): number {
	return (idx + Math.floor(n / 2)) % n
}
// Order = who acts, front to back. [] when no SBP applies.
export function specialBuildQueue(
	eb: ExtraBuildConfig,
	enderIdx: number,
	n: number
): number[] {
	if (n <= 4 || !eb.enabled) return []
	if (eb.buildPhases === 'across') return [acrossSeat(enderIdx, n)]
	// every: all others, clockwise from the next seat
	return Array.from({ length: n - 1 }, (_, k) => (enderIdx + 1 + k) % n)
}
```

### `moreThanSeven` gate

When `eb.moreThanSeven` is true, a player may only build/buy/bank-trade during their SBP slot
while holding **> 7 resource cards** (sum of `resources`, matching the discard threshold).
Enforced in two places, both consulting the current hand:

- **Auto-skip / `canTakeSpecialBuildAction`** returns false if `eb.moreThanSeven && handSize ≤
  7`, so an under-threshold player is skipped rather than prompted.
- **Per-action gate** in the four build/buy/bank handlers: reject an SBP action when
  `eb.moreThanSeven && handSize ≤ 7`. Checked against the hand *before* the action, so a player
  may keep building only while still over the line (a build that drops them to ≤7 is their last
  in that slot). Bank trades are hand-size-neutral, so an over-threshold player keeps access.

## Phase model

New `Phase` variant (client `lib/catan/types.ts` + edge mirror):

```ts
| { kind: 'special_build'; queue: number[] }
```

- `queue[0]` = acting builder; `queue.slice(1)` = pending. No `resume` pointer — an SBP always
  precedes the next player's `roll`.
- Carried entirely in the JSONB `game_states.phase`, like the existing `discard.pending`,
  `curio_pick.pending`, `forger_pick.queue` idioms → **no DB migration**.

### current_turn model (Option B — chosen)

`end_turn` keeps its existing semantics — it **still bumps `current_turn` to `X+1`**, bumps
`round`, and resets the outgoing player's per-turn flags — and only changes the **target
phase**: instead of `{ kind: 'roll' }` it writes `{ kind: 'special_build', queue }` when the
queue is non-empty. When the queue drains, phase flips to `{ kind: 'roll' }` for the
already-set `current_turn` (`X+1`). Rationale: minimal change to `end_turn`; the SBP actor is
fully derived from the phase queue, not `current_turn`; and in `every-turn` the first builder
(`X+1`) coincides with `current_turn`, so no mismatch for that slot.

## Server changes — `supabase/functions/game-service/index.ts`

### `Phase` mirror
Add the `special_build` variant (declared alongside the others near line 1264).

### `handleEndTurn` (lines 3833–3908)
After computing `nextTurn`, the flag resets, and `nextRound` (all unchanged):

1. Read `eb = state.config.extraBuild` (default via `parseGameConfig` upstream).
2. `let queue = specialBuildQueue(eb, game.current_turn!, game.player_order.length)`.
3. **Auto-skip** leading builders who cannot act (see below): drop them from the front.
4. If `queue.length > 0`: write `phase: { kind: 'special_build', queue }` (instead of
   `{ kind: 'roll' }`); still write `players: nextPlayers`, `round: nextRound`; still update
   `games.current_turn = nextTurn` + append the `turn_ended` event. Fire the `your_turn`
   notification to **`player_order[queue[0]]`** (the acting builder) instead of to `nextTurn`.
5. If `queue.length === 0`: unchanged — phase `roll`, notify `nextTurn`.

### New `handleEndSpecialBuild` + action `end_special_build`
- Add body type `{ action: 'end_special_build'; game_id: string }`, switch case, and handler.
- Gating: `game.status === 'active'`, `state.phase.kind === 'special_build'`, `meIdx =
  currentPlayerIndex(game, me)` non-null, and **`state.phase.queue[0] === meIdx`** (403
  otherwise). This is the `forger_pick` head-of-queue precedent (`head.idx !== meIdx`).
- Pop the head. Auto-skip the new leading builders. Then:
  - remaining non-empty → `phase: { kind: 'special_build', queue: remaining }`; notify
    `player_order[remaining[0]]`.
  - remaining empty → `phase: { kind: 'roll' }`; notify `player_order[current_turn]`
    (the roller).
- **Age curse:** on pop, reset the finishing builder's `cardsSpentThisTurn` to 0 iff
  `curse === 'age'` — the SBP slot is a self-contained spend window, mirroring `end_turn`'s
  reset for the outgoing player, so SBP spend never leaks into that player's own turn budget.
  (No other per-turn flag is touched, since the actions that set them — reroll, carpenter VP,
  ritual, shepherd, forger move, dev play — are all disallowed in the SBP.)

### Auto-skip helper
A queued builder is **skipped** (removed without a slot) iff they have **no possible SBP
action**: cannot afford+place a road, settlement, or city, and cannot buy a dev card — **or**
`eb.moreThanSeven` is set and their hand is ≤ 7. Compute server-side from existing pure rules
(`canAffordPurchase` + `validBuildRoadEdges` / `validBuildSettlementVertices` /
`validBuildCityVertices`, plus `config.devCards && devDeck.length > 0 &&
canAffordPurchase(p,'dev_card')`). Shared helper (client + edge), e.g. in `build.ts` (reads
`state.config.extraBuild.moreThanSeven` + the player's hand size):

```ts
export function canTakeSpecialBuildAction(state: GameState, idx: number): boolean
```

Auto-skip runs (a) when building the queue in `end_turn`, and (b) after each pop in
`handleEndSpecialBuild` — draining the front while `!canTakeSpecialBuildAction(head)`. See
open question Q2 (whether to include auto-skip at all).

### Relax build/buy/bank gating for the SBP actor
Four spots currently enforce `phase.kind !== 'main'` **and** `current_turn !== meIdx`. Each
must additionally accept: `phase.kind === 'special_build' && phase.queue[0] === meIdx`
**and** (`!eb.moreThanSeven || handSize(player) > 7`). The `meIdx` used for cost/validation is
already the caller's own seat (`currentPlayerIndex`), so builds correctly attribute to the
acting player. Factor the SBP-actor test into a shared helper so all four call sites (and the
client) agree, e.g. `isSpecialBuildActor(game, state, meIdx)`.

- **`preflightBuild`** (3910–3931) — covers `build_settlement`, `build_city`,
  `build_super_city`, `liquidate`. ⚠️ Only settlement/city/road should be reachable via SBP;
  **super-city and liquidate must stay main-only**. So do **not** blanket-widen
  `preflightBuild`. Instead add an SBP-aware variant used only by the SBP-eligible handlers,
  or pass an `allowSpecialBuild` flag and have `build_super_city`/`liquidate` pass `false`.
- **`handleBuildRoad`** (3954–4066) — already multi-phase (`main` | `road_building`); add
  `special_build` (actor = queue head). `road_building` stays actor = `current_turn`.
- **`handleBankTrade`** (4832–4888) — add the `special_build` branch.
- **`handleBuyDevCard`** (4890+) — add the `special_build` branch; keep the
  `config.devCards` check.

All other turn-scoped handlers (roll, robber, player-trade, play_dev_card, super_city,
carpenter, tap_knight, ritual, shepherd, forger, liquidate) keep the strict `main` +
`current_turn` gate → automatically blocked during SBP.

### Notifications
Reuse the existing `your_turn` / gate `yourTurn` kind for SBP slots (no `_notify` change — the
`NotificationKind` union is closed and `your_turn` reads as "it's your turn to act"). The
acting builder is notified on slot entry and on each queue advance; the roller is notified when
the queue drains.

## Client changes

### Types + pure rules
- `lib/catan/types.ts` — add the `special_build` Phase variant; export `ExtraBuildTimes` is
  already present. (`roll.ts` will import it for `specialBuildQueue`.)
- `lib/catan/roll.ts` — add `acrossSeat` + `specialBuildQueue`.
- `lib/catan/build.ts` — add `canTakeSpecialBuildAction`.
- `lib/catan/dev.ts` — widen `canBuyDevCard(state, meIdx, currentTurn)` so the acting player
  is `state.phase.kind === 'main' ? currentTurn : state.phase.kind === 'special_build' ?
  state.phase.queue[0] : -1`, and accept both phases. (Edge inlines its own gate — mirror the
  branch there.)

### `app/game/[id].tsx` (`GameBody`)
Derive:
```ts
const sbActor = gameState?.phase.kind === 'special_build' ? gameState.phase.queue[0] : null
const isMySpecialBuild = sbActor !== null && sbActor === meIdx
```
Enablement (widen **per-action**, not the shared `canBuildThisTurn`, so trade/super-city/
carpenter stay main-only):
- road / settlement / city buttons: `(canBuildThisTurn || isMySpecialBuild) && affordable &&
  validSpots`.
- `dev_card`: use the widened `canBuyDevCard`.
- **board interactivity** (line 1290): `buildTool && (isMyActiveTurn || isMySpecialBuild) &&
  !tradePanelOpen`.
- **bank trade**: enable the Trade button when `isMySpecialBuild`, but open `TradePanel` in a
  new **bank-only** mode (hide the player-trade composer). Player-trade stays main-only.
- super-city / carpenter / accountant / player-trade / play-dev buttons: **unchanged**
  (`canBuildThisTurn` = main + current_turn) → disabled during SBP.

### New `SpecialBuildBar` (mutually-exclusive status bar, like `DiscardBar` / `RobberStatus`)
Rendered when `phase.kind === 'special_build'`:
- **actor view** (`isMySpecialBuild`): "Special build — build, buy, or bank trade" + a
  **"Done building"** button → `onEndSpecialBuild` → `endSpecialBuild(gameId)` store action →
  edge `end_special_build`.
- **spectator view**: "Special build — {name} is building" (name from
  `players[sbActor]` / profile), optionally list the remaining queue count.

`MainLoopBar` already returns null unless phase is `roll`/`main`, so it won't show End-turn
during SBP — the SBP bar owns the "done" affordance.

### `TradePanel` (`lib/catan/TradePanel.tsx`)
Add a `bankOnly?: boolean` prop; when set, render only the bank/port composer (hide the
player-to-player composer + send-offer button). Passed true when opened from an SBP slot.

### Turn indicator (`PlayerStrip`)
Optional polish: when `phase.kind === 'special_build'`, additionally highlight `sbActor` (pass
it down) so the highlighted box matches who's acting. Low priority; the SBP bar already names
the actor.

### Store — `lib/stores/useGamesStore.ts`
Add `endSpecialBuild(gameId)` → `callGameService({ action: 'end_special_build', game_id }, …)`
(thin wrapper like `endTurn`).

## Validation

- `dev/check-catan-roll.ts` — add tests for `acrossSeat` (even N/2, odd ⌊N/2⌋) and
  `specialBuildQueue`: `off`/`N≤4` → `[]`; `across` → single correct seat for N=5 and N=6
  (assert the full round maps each seat to a distinct builder); `every-turn` → the N-1 others
  in clockwise order from `X+1`.
- Optionally a `dev/check-catan-special-build.ts` exercising `canTakeSpecialBuildAction` and a
  mini end_turn→special_build→end_special_build→roll drain on a constructed state.

## Non-goals

- No player-to-player trading, dev-card play, robber, roll, super-city, carpenter VP, tap, or
  liquidate during the SBP.
- No new DB migration (JSONB phase).
- No new notification kind (reuse `your_turn`).
- No change to 2–4 player games or `off` games.

## Deploy checklist

- `npm run check` + `dev/check-catan-*.ts` pass.
- **`npm run edge`** to deploy the mirrored engine (real games run server-side).

## Resolved questions

- **Q1 — `every-turn` and the next roller → KEEP FAITHFUL.** The next player `X+1` is included
  in the queue (acts in the SBP, then rolls their own turn). Queue = all others clockwise from
  `X+1`.
- **Q2 — Auto-skip → YES.** Queued players with no affordable/legal build or buy are dropped
  from the front automatically; the queue only stops on players who can actually act.
