# Trade refactor — one composer, bank inferred

## Goal

Replace the three-screen trade flow (player compose → bank ratio select → bank
compose) with a **single composer**. The player builds one give/receive
proposal out of their own hand; both destinations read the same proposal.

- **Propose trade** sends it to the players they've toggled on.
- **Trade with bank** is enabled automatically whenever that same proposal is
  satisfiable by _any combination_ of the rates the player has access to
  (4:1 bank, 3:1 generic port, 2:1 specific ports, plus the specialist and
  merchant bonuses).

The player never picks a ratio. The bank button lighting up _is_ the answer to
"can I do this with the bank".

## 1. The composer

Lives where it already does: `lib/catan/TradePanel.tsx`, rendered in the bottom
zone by `BottomArea.tsx` in place of the viewer's hand. Two columns over a
button block:

```
┌──────────────────┬──────────────────┐
│ YOU GIVE         │ YOU RECEIVE      │
│   [wheat 2]      │   [ore 1]        │
│ ─────────────    │ ─────────────    │
│ YOUR HAND        │ ADD              │
│ [w3][b1][s2][o1] │ [·][·][·][·][·]  │
└──────────────────┴──────────────────┘
 [alice] [bob] [ cy ]
 [ Propose trade ]      [ Trade with bank ]
```

- **Left column** — a compact "You give" fan on top (tap a card to take one
  back out), a divider, then the remainder of your hand below (tap to add one).
  This is the `DiscardPanel` gesture, and it's what the current player-trade
  composer already does; it stays.
- **Right column** — "You receive" fan on top (tap to remove one), shadow cards
  below (tap to add one).
- Give and receive may not overlap: a resource on one side disables its card on
  the other. Unchanged.
- The header row keeps the "Trade" title and gains a **Cancel** link on the
  right (the old bank button's slot). The build bar's Trade button still
  toggles the panel too.

**The composer imposes no bank constraint.** The receive side is free-form,
because a player trade has no ratio. Nothing is disabled to keep the proposal
bank-legal; the bank button simply enables or doesn't.

### Buttons

| Button          | Enabled when                                                                            |
| --------------- | --------------------------------------------------------------------------------------- |
| Propose trade   | shape valid (both sides non-empty, non-overlapping) + affordable + ≥1 recipient toggled |
| Trade with bank | shape valid + affordable + `bankPartitionFor(...)` returns a partition                  |

Recipient chips (username pills, filled = included) sit **above** Propose
trade, as today's `PlayerChip`s but relocated. All are on by default; `to: []`
is still sent when every player is selected.

`Trade with bank` shows `Bank closed (curse)` and stays disabled when
`availableBankOptions` is empty (expanded-table Curse of Provinciality).

### Rate hint

A single muted line under the button block naming what the player can use, so
they know how to compose: e.g. `Rates: 2:1 wheat · 3:1 any · 4:1 bank`. Derived
from `availableBankOptions` + surcharge, with the specialist noted when set
(`· specialist: wheat`). Omitted entirely when the bank is closed.

### Deleted

`BankSelect`, `BankOptionCard`, `BankCompose`, the `Mode` state machine, and
the merchant chip row all go away. `TradeSidePanel` and `PlayerChip` survive.

## 2. Bank rules — combination validity

New pure layer in `lib/catan/ports.ts`, built on top of the existing per-kind
primitives (which stay, since the dev check scripts and the specialist/smith
logic already live there).

### Per-resource rate sets

```ts
export function bankRatesFor(
	state,
	playerIdx,
	give
): Partial<Record<Resource, number[]>>
```

For each resource the player is giving, the ratios they may pay at:

- `bankAccessFor === 'none'` → no rates at all (bank closed).
- `'flat_5'` → `{5}` for every resource, ports ignored.
- otherwise, with `s = bankSurchargeFor(state, playerIdx)`:
    - `4 + s` always,
    - `3 + s` if the player holds a generic port,
    - `2 + s` if they hold that resource's specific port — **or**, for a smith,
      the brick/ore counterpart port (`smithPortResourceOk` already encodes the
      substitution).
- **Specialist**: unchanged from today — the discount applies _only_ when the
  whole give is a single stack of the declared specialty. In that case every
  ratio for that resource becomes `max(1, ratio - 1)`. A mixed give loses it,
  exactly as `effectiveBankRatioFor` behaves now.

### Reachability

A give hand is spent by cutting each resource's pile into groups, each group a
whole number of cards at one of that resource's allowed ratios. Every given
card must belong to a group. The number of groups is the number of cards
received.

```ts
export type BankRate = { resource: Resource; ratio: number; groups: number }

export function bankPartitionFor(
	state,
	playerIdx,
	give,
	receive
): BankRate[] | null
```

Returns a witness partition when the trade is legal, `null` otherwise. Legal
means: both sides non-empty, non-overlapping, non-negative integers, and there
is a partition of `give` whose total group count equals `handSize(receive)`.
Affordability stays a separate `canAfford` check at the call sites, the way
`isValidBankTradeShape` already leaves it — the composer builds the give out of
the hand, so only the server ever has a reason to doubt it.

Implementation is a small DP per resource — `reachable[c]` = the set of group
counts that can consume exactly `c` cards, seeded `reachable[0] = {0}` and
extended by each allowed ratio — then a convolution across the (at most five)
resources to get the achievable receive totals. Hands are tiny; this is
milliseconds. The witness is recovered by walking the DP back, **preferring the
smallest ratio at each step**, so the reported rates are the most favourable
ones and the result is deterministic.

> Why a DP rather than arithmetic: a rate set like `{2, 4}` (specific port, no
> generic) can't make an odd pile, and `{3, 4}` can't make 5. A range check
> would wave both through.

### Merchant

The merchant's "pay N additional of the in-resource for N additional cards"
folds into the same model instead of riding a separate payload: when the player
is a merchant **and** the give is a single resource stack, that resource gains
a **1:1 rate that may only be used after at least one full-price group exists**.
So the reachable set for a merchant is
`{ g + (c - m) : 1 ≤ m ≤ c, g ∈ reachable(m), g ≥ 1 }`.

The "at least one real group" condition is what stops a merchant trading 1
card for 1 card. It is the same condition today's `isValidMerchantAddon`
enforces by requiring the addon to ride an existing give.

Consequence: the merchant's extras are just more cards in the give and more
cards in the receive. There is no merchant UI and no `merchant` field on the
outbound action.

## 3. Wire + event changes

### Action body

`bank_trade` sends only `game_id` / `give` / `receive`. `merchant` is dropped
from `useGamesStore.bankTrade` and from `onBankTrade` in `gameScreenContext`.

**The edge keeps accepting a legacy `merchant` payload** so a client that
hasn't taken the OTA update yet still trades correctly: when present and the
player is a merchant, it is folded into the effective give/receive
(`give[resource] += count`, `receive += take`) _before_ validation, and then
validated by the same new rule. ~6 lines, and the alternative is silently
dropping a merchant's extra cards.

### `bank_trade` event

```ts
{
  kind: 'bank_trade'
  player: number
  give: ResourceHand
  receive: ResourceHand
  ratio?: number            // present only when the partition is uniform
  rates?: BankRate[]        // the witness partition
  merchant?: MerchantAddon | null   // legacy events only; no longer written
  at: string
}
```

`ratio` becomes optional and is written only when every group in the partition
used the same ratio — which is the overwhelmingly common case, and keeps
existing log rows rendering unchanged. `rates` is always written.

`ActionLog`'s `bank_trade` case:

- `Rate` row shows `${ratio}:1` when `ratio` is present,
- otherwise a per-resource breakdown: `2 wheat at 2:1 · 4 wood at 4:1`,
- the legacy `merchant` detail row stays for events written before this change
  — dropping it would blank out information those rows already carry.

**A merchant trade logs as a plain bank trade.** The `(merchant)` summary label
goes away: once the extras are just more cards at a better rate, there is no
separate act to announce. The `rates` breakdown still shows the `1:1` groups,
so the log is honest about the rate without naming the bonus.

The store's `GameEvent` union is updated to match — a new field written by the
edge but missing from that union is invisible in the log.

## 4. Files

| File                                       | Change                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `lib/catan/ports.ts`                       | add `bankRatesFor`, `bankPartitionFor`, `BankRate`; existing per-kind helpers untouched |
| `lib/catan/TradePanel.tsx`                 | rewrite: one composer, two action buttons, rate hint; bank screens deleted              |
| `lib/game/gameScreenContext.tsx`           | `onBankTrade(give, receive)` — merchant arg dropped                                     |
| `lib/stores/useGamesStore.ts`              | `bankTrade` signature; `bank_trade` event shape                                         |
| `lib/catan/ActionLog.tsx`                  | `bank_trade` detail rows                                                                |
| `supabase/functions/game-service/index.ts` | mirror `bankRatesFor` / `bankPartitionFor`; `handleBankTrade` rewritten; legacy fold-in |
| `dev/check-catan-ports.ts`                 | cases for combination validity (below)                                                  |
| `lib/catan/CLAUDE.md`                      | `ports.ts` + `TradePanel` descriptions, bank-combination rule                           |
| `lib/game/CLAUDE.md`                       | `BottomArea` trade-composer description                                                 |

`inferBankKind` in the edge function is deleted — `bankPartitionFor` replaces
it. `isValidBankTradeShape` / `effectiveBankRatioFor` stay in both copies:
they're what the new layer is built from and what the check scripts exercise.

## 5. Check cases (`dev/check-catan-ports.ts`)

- 4 wood → 1 card with no ports. Valid at 4:1.
- 2 wheat + 4 wood → 2 cards holding a 2:1 wheat port. **The headline case** —
  invalid today, valid now.
- 2 wheat + 4 wood → 3 cards. Invalid (only 2 groups exist).
- 6 wood → 2 cards with a 3:1 generic port. Valid.
- 5 wood → 1 card with a 3:1 port. Invalid (no partition of 5 from {3,4}).
- 3 wood + 3 brick → 2 cards with a 3:1 port. Valid.
- Specialist wheat, 3 wheat → 1 card at 4:1−1. Valid.
- Specialist wheat, 3 wheat + 4 wood → 2 cards. **Invalid** — a mixed give
  loses the specialist discount, so 3 wheat can't be cut by {4}.
- Smith with a 2:1 brick port giving 2 ore → 1 card. Valid.
- Merchant with 4:1 giving 6 wood → 3 cards. Valid (one group + 2 at 1:1).
- Merchant giving 2 wood → 2 cards. Invalid (no full-price group).
- Provinciality `surcharge`: 5 wood → 1 card. Valid (4+1).
- Provinciality `none`: any give. Invalid.
- Give and receive overlapping on one resource. Invalid.
- Give exceeding the hand. Invalid.

## 6. Out of scope

- Player-trade acceptance, `tradeMode`, and `TradeBanner` are untouched.
- Bank trades stay a main-turn action; no change to the special-build gate.
- The build bar's Trade button behaviour (toggle / cancel a live offer) is
  unchanged.
