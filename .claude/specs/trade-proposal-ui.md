# Trade proposal UI — two-panel give/receive redesign

Redesigns the player-to-player trade composer in `lib/catan/TradePanel.tsx`. Today
the proposer composes a trade with two stacked `ResourceStepperRow`s ("You give" /
"You receive") of five fixed colored cells with −/+ steppers. The redesign replaces
this with two side-by-side panels that render the trade as tangible fanned hands of
cards, so the swap reads physically and the player's actual hand stays visible.

This is a **UI-only** change. No changes to `trade.ts` rules, `types.ts`, the edge
function, stores, or the trade lifecycle. `onSend(give, receive, to)` is unchanged.

## Goal (from the request)

- Two panels split left / right. **Left = "You give", Right = "You receive".**
- Each panel shows a **trading hand**: a fan of the cards currently being traded,
  using the same dedup + on-card count number as the player's real `ResourceHand`,
  with a card type omitted entirely when its count is 0.
- **Tapping a card in a trading hand decrements that resource by one** (one card
  back out of the trade).
- Below each trading hand is a **source hand** used to add cards into the trading
  hand above it:
    - **Left source = the player's real hand minus the cards currently being
      given.** Tapping a source card moves one of that resource into "You give".
    - **Right source = a "shadow hand": all five resource card types, no count
      numbers, ghost styling.** Tapping a shadow card adds one of that resource to
      "You receive".
- Net effect: the trade is tangible (cards visibly move between source and trading
  hands) and the player can always see their full current hand (give-hand +
  left-source always sum to the real hand).

## Scope

In scope:

- `lib/catan/ResourceHand.tsx` — generalize the existing fanned-hand renderer into a
  reusable card/fan primitive that supports: (a) the existing read-only full-size
  display (unchanged behavior at call sites), (b) an interactive variant where
  tapping a card fires a callback, (c) a "shadow"/ghost variant with no count, (d) a
  size scale so it fits inside a half-width column. The current `ResourceHand`
  export keeps its signature and look.
- `lib/catan/TradePanel.tsx` — rewrite the `PlayerTrade` sub-component into the
  two-panel layout. `ResourceStepperRow` is removed from the player-trade path
  (still used by bank — see open question 1). The header ("Trade" + "Trade with
  bank"), the "To" addressee chip row, and the Cancel / Send buttons stay, laid
  out below the two panels at full width.
- `app/game/[id].tsx` — only if the container needs to change (see open question 2);
  otherwise untouched. `onProposeTrade` / props are unchanged.

- `BankCompose` (in `TradePanel.tsx`) — also rewritten to the two-panel model
  (resolved Q1). `BankSelect` / `BankOptionCard` (the ratio/port picker step)
  stays as-is; only the compose step becomes two panels.

Out of scope:

- Trade rules, validity, affordability, addressing, lifecycle, persistence, edge
  function, stores. Pure presentation swap. `isValidBankTradeShape`,
  `effectiveBankRatioFor`, etc. unchanged.
- `TradeBanner.tsx` (the open-offer banner shown to addressees) — unchanged.
- `BankSelect` ratio picker — unchanged.

## Behavior detail

State stays exactly as today inside `PlayerTrade`: `give: ResourceHand`,
`receive: ResourceHand`, `addressed: number[]`. Only the rendering + interaction
of `give`/`receive` changes.

Left ("You give") panel:

- **Trading hand (top):** fan of `r` where `give[r] > 0`, count = `give[r]`, dedup
    - on-card number identical to `ResourceHand`. Omit types with `give[r] === 0`.
      Tap a card → `give[r] -= 1` (floor 0).
- **Source hand (bottom):** fan of `r` where `myHand[r] - give[r] > 0`, count =
  `myHand[r] - give[r]`. Omit types fully moved into the trade. Tap a card →
  `give[r] += 1`, capped at `myHand[r]`. A tap is a no-op (card disabled/dimmed)
  when adding it would violate the non-overlap rule, i.e. `receive[r] > 0`
  (preserves today's `otherSide[r] > 0` block — you can't give and receive the
  same resource).

Right ("You receive") panel:

- **Trading hand (top):** fan of `r` where `receive[r] > 0`, count = `receive[r]`.
  Tap a card → `receive[r] -= 1` (floor 0).
- **Source hand (bottom):** shadow hand — always all five `RESOURCES`, ghost
  styling, **no count number**. Tap a shadow card → `receive[r] += 1` (no cap;
  matches today — receive is unbounded). A shadow card is disabled/dimmed when
  `give[r] > 0` (non-overlap).

Empty states: a trading hand with nothing in it renders an empty placeholder of
the same height (so the left/right panels stay aligned and the layout doesn't jump
as cards are added/removed). Left source empty (rare — gave away entire hand)
shows the same empty placeholder.

Validation / gating unchanged: `canPropose = isValidTradeShape(give, receive) &&
canAfford(myHand, give) && addressed.length > 0`; Send disabled until met.

## Component shape (planned)

`ResourceHand.tsx` exports:

- `ResourceHand({ hand })` — unchanged public component (now a thin wrapper over
  the primitive with read-only, full-size, real-color config).
- `CardFan` (new) — the reusable primitive:
  `{ entries: { resource: Resource; count: number }[]; variant: 'solid' |
'shadow'; showCount: boolean; size?: 'full' | 'compact'; onCardPress?:
(r: Resource) => void; disabledResources?: Resource[]; emptyLabel?: string }`.
  Keeps the existing fan math (overlap, per-card rotation, arc lift, z-stack),
  scaled by `size`. `shadow` variant = faded/ghost card (see open question 3),
  no number. `compact` size shrinks `CARD_W`/`CARD_H`/`OVERLAP` proportionally so
  two fans fit in a half-width column.

`TradePanel.tsx` `PlayerTrade` renders:

```
<header: "Trade"            "Trade with bank">
<row: two columns>
  <col left:  label "You give">      <col right: label "You receive">
    <CardFan give, solid, count,        <CardFan receive, solid, count,
      onCardPress=decGive>                onCardPress=decReceive>
    <divider/label "Your hand">        <divider/label "Add">
    <CardFan myHand−give, solid,        <CardFan all RESOURCES, shadow,
      count, onCardPress=incGive,         no count, onCardPress=incReceive,
      disabled where receive[r]>0>        disabled where give[r]>0>
<label "To"> <addressee chips>
<Cancel>  <Send>
```

Sub-component ordering in-file stays base→leaves (`TradePanel` →
`PlayerTrade`/`BankSelect`/`BankCompose` → rows/chips/buttons), per repo
conventions.

## Resolved decisions

1. **Bank flow → adapt it too.** `BankCompose` becomes two panels. The card
   metaphor maps onto bank rules as follows (rules themselves unchanged):
    - **Left source (your hand − give):** tapping a source card adds **one group**
      — `effectiveBankRatioFor(choice, hypothetical, specialist)` units of that
      resource — exactly the current `addGive` increment. Disabled (dimmed, shown
      with its remaining count) when `myHand[r] - give[r] < effective`, when
      `receive[r] > 0`, or — for a 2:1 locked port — when `r !== locked`. All five
      types still render so a locked port reads as "you hold these but can only
      trade the locked one."
    - **Left trading hand (give):** tapping a give card **clears that
      resource's whole pile** (`give[r] = 0`). Each fanned card is one
      dedup'd pile, so "tap it to take it back out" reads naturally, and 0 is a
      multiple of any ratio — this stays valid no matter how the specialist
      single-stack discount shifted while the pile was built up (per-group
      decrement is ambiguous under that discount, so we deliberately don't do
      it). Counts shown. Reset still clears everything.
    - **Right shadow source:** all five resources, desaturated-solid ghost cards,
      no number. Tap → `receive[r] += 1`, gated by `slotsRemaining > 0 &&
give[r] === 0` (current `addReceive`); disabled cards dimmed further.
    - **Right trading hand (receive):** tapping a receive card → `receive[r] -= 1`,
      floor 0. Counts shown.
    - The footer summary (`Pick N of a resource to start.` / `X → Y of Z
available`), the per-tap ratio hint, **Reset**, **Back**, and Cancel/Send
      all stay, placed below the two panels.
2. **Container → grow panel, shrink board.** No change to `app/game/[id].tsx`
   structure: `boardContainer` is `flex: 1`, so growing the panel below it
   shrinks the board via the existing `BOARD_RESIZE` layout animation. The
   composer body is wrapped in a `ScrollView` (capped, `nestedScrollEnabled`) so
   on short devices the panel never crowds the board to nothing — it scrolls
   internally instead. Compact card sizing keeps it from needing to in the common
   case.
3. **Shadow hand → desaturated solid.** Shadow cards are solid, gray-tinted
   (each resource hue blended heavily toward a neutral gray), with the resource
   label and no count. Precomputed static map (RN has no runtime color mixing);
   one constant per resource alongside `resourceColor`.

## Player-mode interaction (unchanged semantics, restated for clarity)

In player mode increments/decrements are **±1** (one card), not group-based:
left source tap `give[r] += 1` (cap `myHand[r]`, blocked when `receive[r] > 0`),
left trading tap `give[r] -= 1`, right shadow tap `receive[r] += 1` (blocked when
`give[r] > 0`), right trading tap `receive[r] -= 1`. The smart parent
(`PlayerTrade` vs `BankCompose`) owns the delta; `CardFan` only reports which
card was pressed.

## Checklist

- [ ] `CardFan` primitive; `ResourceHand` unchanged at its call site.
- [ ] `PlayerTrade` two-panel layout; give/receive state untouched.
- [ ] Tap trading-hand card decrements; tap source/shadow card increments.
- [ ] Non-overlap + hand cap preserved (disabled/dimmed cards, not errors).
- [ ] Empty placeholders keep left/right aligned; no layout jump.
- [ ] Send gating unchanged; `onSend` contract unchanged.
- [ ] Fits a half-width column on a phone (card scaling).
- [ ] `npm run check` + `npm run format` clean.
- [ ] Bank flow per resolved open question 1.
