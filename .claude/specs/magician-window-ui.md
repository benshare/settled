# Magician: the post-roll window, redesigned

## What changes

Two things, one behavioral and one visual.

1. **The roll's own cards wait for the answer.** The magician's production from
   the number they actually rolled is withheld while their window is open and
   lands only when they resolve it. Until then it isn't in hand, so it can't be
   spent on the discard — the phantom number is paid for with the cards they
   held before rolling.
2. **The window asks one question instead of two.** It used to be a grid of
   eleven numbers with a price tag, then a stepper bar. It is now an arc of
   roll cards opening on the number that actually came up, each showing what
   that number pays _this player_, over the hand itself with the 7-discard
   tap-to-pick gesture.

## Deferred gain

`magician_pick` carries `pendingGain: ResourceHand` — the roller's own gain
from the actual roll, computed at distribution time and subtracted from nobody
else. `cast_magic` pays it out alongside the phantom gain and minus the
discard; `skip_magic` pays it out on its own. Both are the only exits, so the
cards cannot be stranded — and the window's own timeout auto-action is
`skip_magic`.

The gain is withheld at the one place a magician's roll distributes
(`applyRollOutcome`'s non-7 path); the 7-chain never distributes, so
`wrapMagicianWindow` opens with an empty pending gain. Everything downstream of
distribution reads `gains`, not hands (curio's threshold, the forger's
candidates, the `rolled` event's per-seat breakdown), so withholding is
invisible to them.

Consequences worth knowing:

- **`canAfford` in `handleCastMagic` is now the real constraint.** A magician
  who rolls into an empty hand cannot cast, however rich the roll was.
- A legacy `magician_pick` row (written before this field existed) reads as
  nothing pending and resolves exactly as it used to.
- Undo is unaffected: it restores the pre-action snapshot, which puts the
  withheld cards back in the phase rather than in the hand.

## Reach

A target is only offered when its price is payable, so the arc runs
`[max(2, roll − reach), min(12, roll + reach)]` where `reach = handSize −
discardPlus` — the two ends truncate independently. `magicTargetRange` in
`bonus.ts` is that rule; it is a UI convenience rather than a new server check,
since the server already refuses an unaffordable discard.

With `reach ≤ 0` there is nothing to offer, and **the window does not open at
all** — `magicianCanCast` now takes the hand into account (`canCastAnyMagicTarget`:
the cheapest phantom is a neighbour, so `discardPlus + 1` cards, and every roll
from 2 to 12 has a neighbour in range). Same reasoning as the cooldown that
gate already carried: never raise a sheet whose only move is to dismiss it. The
roll then resolves normally, production included, since the deferral rides the
same flag.

The overlay keeps a one-line "not enough cards" state anyway, for a
`magician_pick` written before the gate existed.

## Layout

`MinimizableModal`, titled **Activate magician?** — still minimizable, because
the choice is "what does that number pay me", which is a question about the
board.

- **The arc.** One small card per number in reach, in numeric order, riding a
  circle whose top is the middle of the visible strip. **The arc belongs to the
  window, not to the cards**: the angle is read off the live scroll offset, so
  scrolling carries each card around the circle — upright at the center,
  tilting and dropping away toward both edges — rather than sliding a rigid fan
  sideways. Cards **never overlap**, since these are options being compared and
  each has to be readable in full; the gap is sized against the corner a tilted
  card swings toward its neighbour (~6px of clearance at the worst scroll
  position), so widening the arc means widening the gap with it. Each card is
  the number over the cards that number would pay this player, and under that
  its price. The rolled number's card is labeled as the roll rather than
  priced; tapping it clears a selection (the same outcome as **Keep roll**).
  The strip opens scrolled to the roll, since eleven cards never fit a phone —
  and stays hidden for that frame, because the opening scroll is imperative.
- **The hand.** The 7-discard composer verbatim (`DiscardComposer`, factored
  out of `DiscardPanel` for this): the pile above, the hand below, cards move
  between them on tap. It is inert until a number is picked, because until then
  the price is zero.
- **The footer.** **Keep roll** (skip) and **Confirm** (cast). Confirm lights
  only when a target is selected and the pile is exactly its price.

## Files

- `lib/catan/types.ts` — `pendingGain` on the phase.
- `lib/catan/bonus.ts` — `magicTargetRange`, `canCastAnyMagicTarget`, and the
  hand check folded into `magicianCanCast`.
- `lib/catan/MagicianPickOverlay.tsx` — the redesign, plus the roll-card arc.
- `lib/catan/DiscardPanel.tsx` — `DiscardComposer` extracted and reused.
- `lib/game/BoardArea.tsx` — per-number gains (`distributeResources` over the
  reach) and the pending gain, passed in.
- `supabase/functions/game-service/index.ts` — withhold at distribution, pay
  out in `handleCastMagic` / `handleSkipMagic`.
- `dev/check-catan-bonuses.ts` — `magicTargetRange` tests.
