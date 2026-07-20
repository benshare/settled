# Trade proposal/acceptance modes (automatic vs. confirm)

A per-game config choice for how player-to-player trade offers resolve.

- **Automatic** (today's behaviour, the backfill default): when an addressed
  player taps **Accept**, the swap executes immediately and the offer closes.
- **Confirm**: tapping **Accept** does _not_ execute the trade. It registers an
  acceptance and notifies the proposer. Multiple addressees can accept. The
  **proposer** then picks one acceptance to **Confirm**, which executes the swap
  with that player and closes the offer.

Everything currently runs on automatic; legacy games (no stored value) parse as
automatic so nothing in flight changes.

## Config

New field on `GameConfig` (`lib/catan/types.ts`):

```ts
export const TRADE_MODES = ['automatic', 'confirm'] as const
export type TradeMode = (typeof TRADE_MODES)[number]

export type GameConfig = {
	// …existing…
	tradeMode: TradeMode
}
```

- `DEFAULT_CONFIG.tradeMode = 'automatic'`.
- `parseGameConfig` reads `src.tradeMode === 'confirm' ? 'confirm' : 'automatic'`
  (defensive; any missing/unknown value → `'automatic'`, so legacy rows and
  partially-written rows stay on today's behaviour). No migration — `config` is
  stored raw JSONB and read defensively server-side, same pattern as
  `numberLayout`/`honk`.
- `summarizeGameConfig`: surface `"Confirm trades"` only when
  `config.tradeMode !== DEFAULT_CONFIG.tradeMode` (i.e. when `'confirm'`).
- Mirror into `GameDefaults` (`lib/stores/useProfileStore.ts`): add
  `settings.tradeMode`, default `'automatic'`, parsed defensively in
  `parseGameDefaults`; add to `DEFAULT_GAME_DEFAULTS`.

### Create-game UI

`app/(app)/create-game.tsx`, in the **Game settings** `CollapsibleSection`
(alongside Dev cards / Random numbers / Honking). A **SegmentedRow** (reuse the
existing component used by Extra-build) labelled **"Trades"** with options
`Automatic` / `Confirm`, wired to a `tradeMode` state + `setTouched(true)`.
Thread it through `savedDefaults`, `currentDefaults`, the `dirty` check, the
mount-reset `useEffect`, `onCreate`'s config payload, and `onSaveDefaults`
(via `currentDefaults`) — exactly the pattern `numberLayout` already follows.

Copy: title `Trades`, description e.g. _"Confirm: you approve each acceptance
before the swap. Automatic: the first accepter trades instantly."_

## Data model — `TradeOffer`

Add one optional field (`lib/catan/types.ts` + the edge-function mirror):

```ts
export type TradeOffer = {
	// …existing: id, from, to, give, receive, createdAt, rejectedBy?…
	// Indexes of addressed players who have accepted and are awaiting the
	// proposer's confirmation (confirm mode only). Never contains `from`; a
	// player is in at most one of acceptedBy / rejectedBy. Readers default a
	// missing array to []. Unused in automatic mode.
	acceptedBy?: number[]
}
```

Still **at most one open offer at a time** (rides `phase.main.trade`). No new DB
column — `acceptedBy` lives inside the existing `phase` JSON.

### trade.ts helpers (pure, mirrored in edge fn)

- `acceptedByOf(offer): number[]` → `offer.acceptedBy ?? []` (parallels
  `rejectedByOf`).
- Reuse `isOfferAddressedTo`, `addresseesOf`, `rejectedByOf`,
  `isOfferRejectedByAll`, `applyTradeToPlayers`, `canAfford` unchanged.
- `isOfferRejectedByAll` is unaffected: an accepter is not in `rejectedBy`, so
  an offer with a live acceptance is never "rejected by all" and won't
  auto-cancel. (Only relevant if _every_ addressee rejects.)

## Behaviour by mode

### Automatic (unchanged)

`handleAcceptTrade` executes the swap and clears `phase.trade`, emits
`trade_accepted`, notifies the proposer. Exactly as today.

### Confirm

**Accept** (`accept_trade`, an addressee): when
`state.config.tradeMode === 'confirm'`, do **not** swap. Instead:

- Guard: offer open + addressed to me + I can afford `offer.receive` (same
  affordability precheck as today, so I can't accept a trade I can't pay).
- Add `meIdx` to `acceptedBy` (idempotent — if already present, no-op `ok`).
  If I was in `rejectedBy`, remove me from it (accepting overrides a prior
  reject — but in practice a rejecter's banner is hidden, so this is defensive).
- Persist `phase.trade` with the updated `acceptedBy`.
- Emit ephemeral event `trade_accept_offered` (see Events) — omitted from the
  action log, not counted by stats.
- Notify the proposer with a new kind `trade_accept_offered`
  (`gate: 'trade'`) — "X wants to trade" — so they know they can confirm.

**Withdraw** (reuse `reject_trade`, an addressee who already accepted): the
existing Reject path already appends `meIdx` to `rejectedBy`. Extend it to also
**remove `meIdx` from `acceptedBy`** so a player can back out of a pending
acceptance. After withdrawal their banner hides (they're now a rejecter). No new
action — Reject serves double duty as "withdraw" for someone who had accepted.

**Confirm** (new action `confirm_trade`, the **proposer** only):

```ts
type ConfirmTradeBody = {
	action: 'confirm_trade'
	game_id: string
	offer_id: string
	with: number // the accepter index to trade with
}
```

- Guards: game active; `phase.kind === 'main'`; offer open + id matches;
  `meIdx === offer.from` (proposer only); `game.current_turn === offer.from`
  (it's still the proposer's turn — offers only exist on their main phase);
  `with` is a valid index present in `acceptedBy`; both parties can still
  afford (`offer.from` can afford `give`, `with` can afford `receive`) — same
  re-check `handleAcceptTrade` does today, since hands can shift between accept
  and confirm.
- Apply `applyTradeToPlayers(players, offer.from, with, give, receive)`, clear
  `phase.trade` (`{ ...phase, trade: null }`), persist players + phase.
- Emit `trade_accepted` with `from: offer.from`, `to: with` — the **same event
  shape automatic mode emits**, so ActionLog ("X traded with Y") and gameStats
  Friendliest/Antisocial counting keep working with zero changes.
- Notify the confirmed player (kind `trade_accepted`, `gate: 'trade'`).

**Cancel** (`cancel_trade`, proposer): unchanged — clears the offer regardless
of pending acceptances.

## Events

`trade_accepted` is emitted only on the actual swap — on `accept_trade` in
automatic mode, and on `confirm_trade` in confirm mode. Its shape is identical
in both, so stats + action log are untouched.

New ephemeral kind (proposer-facing negotiation noise, **omitted** from the
action log via the existing `default: return null`, ignored by stats):

```ts
| { kind: 'trade_accept_offered'; offer_id: string; from: number; by: number; at: string }
```

`from` = proposer, `by` = the accepter. Logged so history/debugging has a
record; ActionLog needs no case (falls through to `null`).

## UI — `TradeBanner.tsx`

The banner already branches on `amProposer` / `amAddressed`. Add
confirm-mode-aware states. Pass `tradeMode` (or the whole `config`) plus an
`onConfirm(accepterIdx)` handler down from the game screen.

Per-viewer rendering when `tradeMode === 'confirm'`:

- **Proposer**, offer has ≥1 `acceptedBy`: show the give/receive swap plus a row
  of accepter chips (player colour + name), each a tappable **Confirm** button
  that calls `onConfirm(idx)`. Confirm is disabled if that accepter can no
  longer afford `receive` (compute from `state.players[idx].resources`). Keep
  the existing rejected-by line and the cancel (×) affordance.
- **Proposer**, no acceptances yet: same as today (swap + cancel + rejected
  line), i.e. "waiting".
- **Addressee who has _not_ responded**: Accept / Reject, as today (Accept
  gated on affordability).
- **Addressee in `acceptedBy` (accepted, awaiting confirm)**: replace Accept
  with a non-interactive **"Waiting…"** state and keep **Reject** available
  (Reject = withdraw). No Accept button.
- **Rejecter**: banner hidden by `visibleOfferFor` (unchanged).

In **automatic** mode the banner behaves exactly as today (no accepter chips,
Accept executes). Gate the new UI on `tradeMode === 'confirm'`.

`visibleOfferFor` unchanged — a rejecter (incl. someone who withdrew) still
hides the banner; accepters keep seeing it (they're not in `rejectedBy`).

### Game screen wiring (`app/game/[id].tsx`)

- Add `confirmTrade` to `useGamesStore` and an `onConfirmTrade(accepterIdx)`
  handler mirroring `onAcceptTrade` (calls the store, surfaces errors via
  `notify`).
- Pass `tradeMode={gameState.config.tradeMode}` (or `config`) and `onConfirm`
  to `<TradeBanner>`.
- The proposer-side auto-cancel on `isOfferRejectedByAll` stays as-is (only
  fires when everyone rejected; acceptances prevent it).

## Store (`lib/stores/useGamesStore.ts`)

Add `confirmTrade(gameId, offerId, withIdx)` calling the edge fn with
`action: 'confirm_trade'`, mirroring `acceptTrade`. No change to
`acceptTrade` / `rejectTrade` signatures — the mode branch lives server-side.

## Edge function (`supabase/functions/game-service/index.ts`)

Mirror everything (source of truth is `lib/catan/`; edge fn is the copy):

- `GameConfig` type + `tradeMode` (loosely read as `state.config.tradeMode`).
- `TradeOffer` type gains `acceptedBy?`.
- `handleAcceptTrade`: branch on `state.config.tradeMode`. `'automatic'` → today's
  swap path. `'confirm'` → register acceptance (+ remove from rejectedBy),
  emit `trade_accept_offered`, notify proposer.
- `handleRejectTrade`: also strip `meIdx` from `acceptedBy` (withdraw support).
- New `handleConfirmTrade` + `ConfirmTradeBody` + dispatch case `confirm_trade`
  in the `switch (body.action)`.
- `acceptedByOf` helper alongside `rejectedByOf`.

## Testing

- `dev/check-catan-trade.ts`: add cases for confirm mode — accept registers
  (no swap), multiple accepters accumulate, reject withdraws an acceptance,
  confirm executes with the chosen accepter and closes, affordability re-checks
  at confirm, automatic mode still swaps on accept. Run
  `npx tsx dev/check-catan-trade.ts`.
- `npm run check` + `npm run format`.
- `npm run edge` to deploy (rules changes only reach players via the edge
  function; the client `trade.ts` change alone does nothing in real games).

## Decisions

| Question                       | Answer                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Withdraw a pending acceptance? | **Yes** — Reject doubles as withdraw (removes from `acceptedBy`, adds to `rejectedBy`). |
| Setting UI                     | **Segmented** Automatic / Confirm in Create Game → Game settings.                       |
| Multiple acceptances           | Yes — all addressees may accept; proposer picks one to confirm.                         |
| Confirm closes offer           | Yes — swap executes with the chosen accepter, other pending acceptances discarded.      |
| Backfill / migration           | None. `tradeMode` read defensively; legacy = `'automatic'`.                             |
| Stats / action log             | Untouched — the real swap still emits `trade_accepted` in both modes.                   |
