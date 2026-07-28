# Bonus / curse variants by player count

Adds a third axis to the bonus & curse subsystem: **game size**. A card can
read differently, behave differently, and be withheld entirely at 2 players,
3-4 players, or 5+ players.

Depends on the three live bonus sets (`catan-bonuses-set-1/2/3.md`) and
`catan-curses.md`.

## Sizes

| Size       | Players | Notes                                                             |
| ---------- | ------- | ----------------------------------------------------------------- |
| `small`    | 2       | Standard board                                                    |
| `standard` | 3-4     | Standard board — the baseline every card is written against today |
| `expanded` | 5-6     | Expanded 30-hex board (`variantForPlayerCount`)                   |

`GameSize` is **derived, never persisted** — `gameSizeFor(playerCount)` in
`lib/catan/types.ts`, next to the existing `variantForPlayerCount` /
`monopolyCap` helpers. Board variant and game size stay separate concepts
(same 5+ cutoff today, but a card may want to vary at 2 players where the
board does not).

Player count comes from `state.players.length` in rules code, `playerOrder`
/ `gameState` in game UI, and a user-chosen selector on the catalog screen
(which has no game).

## Scope of this pass

**Scaffolding only.** The mechanism plus every wiring point, with no card's
text or behaviour changed yet — both tables ship empty. Cards get retuned one
at a time in follow-up work; each one touches exactly two places: its entry in
`sizes.ts` and the `switch` in its rule helper.

## Locked decisions (from clarification)

1. **One central table**, `lib/catan/bonuses/sizes.ts` — not inline fields on
   the pool entries. `BONUS_POOL` / `CURSE_POOL` are untouched; their
   `description` stays the `standard` (3-4 player) text and the fallback for
   any size with no entry.
2. **Descriptions and params live together** in that table, so a card's
   per-size number and the sentence describing it can't drift. Params are
   **typed per card** (`BonusSizeParams` / `CurseSizeParams` maps): a param
   declared on the wrong card fails to compile.
3. **The catalog screen gets a size selector** (2 / 3-4 / 5+, defaulting to
   3-4), and a card unavailable at the selected size renders **dimmed with a
   note** rather than being hidden.
4. **Availability is per size** — a card may be marked unavailable at a size
   and `dealBonusHands` (plus its edge mirror) filters it out.

## 1. The one location — `lib/catan/bonuses/sizes.ts`

```ts
// Per-card param shapes. A card that varies only in wording needs no entry.
type BonusSizeParams = Record<never, never> // e.g. { thrill_seeker: { vpDelta: number } }

type SizeVariantOf<K> = {
	description?: string
	available?: boolean
} & (K extends keyof BonusSizeParams ? Partial<BonusSizeParams[K]> : object)

export const BONUS_SIZE_VARIANTS: {
	[K in BonusId]?: Partial<Record<GameSize, SizeVariantOf<K>>>
} = {}
```

Same shape for `CURSE_SIZE_VARIANTS` / `CurseSizeParams`. Params are flat on
the variant (`{ description, vpDelta }`), not nested under a `params` key.

Resolvers, re-exported from `bonuses/index.ts`:

- `bonusVariantFor(id, size)` / `curseVariantFor(id, size)` — generic in the
  card id, so `bonusVariantFor('thrill_seeker', size)?.vpDelta` is typed and
  the same read on another card is a compile error. This is what rule helpers
  call for their numbers.
- `bonusDescriptionFor(id, size)` / `curseDescriptionFor(id, size)` — variant
  text, else the pool's standard text.
- `isBonusAvailableAt(id, size)` / `isCurseAvailableAt(id, size)` — `false`
  only when a variant says so.

## 2. The implementation switch

Rule helpers in `lib/catan/bonus.ts` / `curses.ts` that vary by size take a
`size: GameSize` parameter and switch on it (or read a param off
`bonusVariantFor`). Helpers already receiving `GameState` may derive it via
`gameSizeFor(state.players.length)`; the ones taking only a card id
(`winVPThresholdFor`, `underdogMultiplierFor`, `bricklayerAltCost`, …) gain an
explicit parameter.

**No helper signature changes in this pass** — signatures change per card as
that card is retuned, so each card's diff stays self-contained and reviewable.

## 3. Dealing

`dealBonusHands(playerCount, bonusSets, bannedCombos)` derives the size from
`playerCount` and drops unavailable cards before the existing set filter. The
fallback chain, widest-net-last so a filter can never fail to deal:

1. available ∩ requested sets
2. available (ignore the set filter) — if (1) is empty
3. the full pool — if (2) has fewer than 2 cards

Curses filter on availability the same way.

## 4. UI surfaces

- `BonusSelection.tsx` — size from `playerOrder.length` (already a prop).
- `PlayerDetailOverlay.tsx` — size from `gameState.players.length`.
- `app/(app)/stats.tsx` Catalog tab — new local segmented pill row (2 / 3-4 /
  5+), styled like the existing `TabBar` in that file; unavailable cards at
  50% opacity with a "Not dealt in N-player games" line.
- `PlayerStrip.tsx` — title/icon only, no change.

Availability is a **deal-time** filter only: a size's description still
resolves for a card someone already holds, so an existing game can never
render a blank card.

## 5. Edge function mirror

`supabase/functions/game-service/index.ts` mirrors `gameSizeFor`, both
variant tables, and `isBonusAvailableAt` / `isCurseAvailableAt` for its
`dealBonusHands`. It holds no descriptions (only `BONUS_IDS` /
`BONUS_SET_OF`), so the description resolvers are **not** mirrored — the
tables there carry availability only.

## 6. Check scripts

`dev/check-catan-bonuses.ts` and `check-catan-curses.ts` assert:

- `gameSizeFor` boundaries — 2 → small, 3/4 → standard, 5/6 → expanded
- every key in both tables is a real card id, every size key is a real
  `GameSize`, and no variant is an empty object
- descriptions fall back to the pool text for a size with no entry
- `isBonusAvailableAt` defaults to true, and `dealBonusHands` never deals a
  card unavailable at that size (exercised against a stub table)
