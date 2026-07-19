# Number layout flag — spiral vs. random

## Implementation status — DONE (pending edge deploy)

Implemented on branch `spiral-number-layout`. `npx tsc --noEmit` + `eslint --fix` pass;
every `dev/check-catan-*.ts` passes (board check validates both spiral sequences' multisets
and runs 200 spiral generations/variant). Spread verified: standard spiral averages 0.70
adjacent-red pairs (vs 2.94 random), expanded spiral averages **0.00** (tuned sequence, 0
over 40k generations) vs 4.89 random.

**Not yet done — must happen on merge:** deploy the edge function with `npm run edge`. The
mirrored generation lives in `supabase/functions/game-service/index.ts`; real games won't
honor the flag until deployed. No DB migration (config is JSONB; missing `numberLayout`
parses to `'spiral'`).

## Goal

Add a game-creation option controlling **how number tokens are placed on hexes**:

- **`spiral`** (default) — the classic Catan method: number tokens are laid in a fixed
  high/low sequence along a spiral path over the board, so 6s and 8s spread out by
  construction. Resources and desert(s) stay randomly placed; only the number placement
  changes.
- **`random`** — today's behavior: number tokens are fully shuffled onto the resource
  hexes with no spacing guarantees.

The flag applies to **both** board variants (standard 19-hex and expanded 30-hex).

## Locked decisions (from requirements Q&A)

1. **Spiral = authentic token sequence.** Resources + desert remain random; the number
   tokens follow a fixed high/low order (like real Catan's A–R sequence) laid along a
   spiral path, skipping desert hexes. This is the mechanism that spreads high numbers —
   not a constraint-based re-shuffle.
2. **Randomize start + direction each game.** Pick a random starting corner (angular
   offset) and spiral direction (CW/CCW) per game, so number positions vary game-to-game
   while preserving the spread property.
3. **Spiral defined for both boards.** The expanded 30-hex board is this app's own custom
   shape (not the official 5–6 extension layout), so no canonical spiral exists for it —
   we define one. The token sequences and the spiral-ordering algorithm both work for the
   standard and expanded boards.
4. **Default = spiral.** New games and the shipped defaults use `spiral`.

## Adjacent-red handling — DECIDED: pure positional

`spiral` lays the sequence along the spiral **once** and accepts whatever falls out,
including the rare adjacent-red (6/8) pair from an off-center desert — exactly like Catan's
variable setup. **No retry loop, no constrained fallback.** The authentic sequence already
spreads reds well; the occasional touching pair is acceptable and authentic.

## Naming

- Config field: `numberLayout: 'spiral' | 'random'` on `GameConfig`.
- `NUMBER_LAYOUTS = ['spiral', 'random'] as const`; `type NumberLayout`.
- Default: `'spiral'`.

## The spiral algorithm

Implemented as a pure function usable by both runtimes (lib + edge mirror). No I/O, no
render-layer dependency — it derives hex geometry from the board's `hexRows` at unit
scale (scale-invariant; only ordering matters).

### 1. Token sequences (fixed, per variant)

The multiset must exactly equal the variant's `numbers` bag. Ordered high/low so that
consecutive sequence entries alternate between high-pip and low-pip, keeping reds apart
along the spiral.

- **Standard (18 tokens), authentic Catan A–R:**
  `5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 5, 6, 3, 11, 4`
  (A=5 … R=4). Verified multiset = `STANDARD_NUMBERS`.
- **Expanded (28 tokens):** no official 5-6 spiral exists for the custom board, so the
  sequence was **tuned** by an offline dev search (random-restart hill-climb over swaps,
  scoring avg adjacent-red pairs across randomized corner/direction/desert) to a sequence
  that yields **0 adjacent reds** over 40k generations. Multiset =
  `2×2, 3×3, 4×3, 5×3, 6×3, 8×3, 9×3, 10×3, 11×3, 12×2`. Final:
  `6,11,8,9,6,5,3,6,11,2,10,5,12,4,10,9,11,5,3,4,2,3,9,8,12,8,4,10`.

Store both as `SPIRAL_NUMBER_SEQUENCE` on the `Board` bundle (new field), alongside the
existing shuffled `numbers` bag.

### 2. Spiral hex order (generic, any board shape)

1. Derive integer axial/cube coords per hex from `hexRows` (pointy-top, centered rows —
   the same geometry `layout.ts` already encodes: within-row spacing `√3·s`, row spacing
   `1.5·s`, row indent `((maxW − w)/2)·√3·s`). Adjacent rows differ in width by 1 → the
   half-hex offset that makes this a proper hex grid.
2. `center` = the hex nearest the centroid of all hex coords.
3. `ring(h)` = cube-distance(h, center). Rings are exact concentric shells.
4. `angle(h)` = `atan2(cy − centerY, cx − centerX)` from unit-scale pixel centers.
5. **Spiral order** = sort by `ring` **descending** (outer ring first, like Catan), tie-
   break by `angle`. Randomize per game:
    - starting corner → add a random angular offset `θ₀` before sorting by angle;
    - direction → sort angle ascending (CW) or descending (CCW).

### 3. Assign tokens

Walk the spiral order; for each hex, skip if desert (no token), else assign the next entry
from `SPIRAL_NUMBER_SEQUENCE`. (Standard: 1 desert skipped → 18 tokens for 18 hexes.
Expanded: 2 deserts skipped → 28 tokens for 28 hexes.)

### 4. (No retry)

Lay the spiral once and accept the result — see "Adjacent-red handling" above.

## Wiring (files to change)

Everything the existing config flags (`bonuses`, `devCards`) touch, plus the two
`generateHexes` copies:

### Types / config

- `lib/catan/types.ts` — add `numberLayout` to `GameConfig`; extend `DEFAULT_CONFIG`,
  `parseGameConfig` (default `'spiral'` on missing/invalid), and `summarizeGameConfig`
  (call out when non-default, e.g. "Random numbers"). Add `NUMBER_LAYOUTS`/`NumberLayout`.
- `lib/stores/useProfileStore.ts` — add `numberLayout` under `GameDefaults.settings`;
  extend `DEFAULT_GAME_DEFAULTS` and `parseGameDefaults`.

### Board data

- `lib/catan/board.ts` — add `spiralNumberSequence` to the `Board` type + both bundles;
  define `STANDARD_SPIRAL_SEQUENCE` / `EXPANDED_SPIRAL_SEQUENCE`.

### Generation (BOTH copies)

- `lib/catan/generate.ts` — `generateHexes(variant, layout: NumberLayout)`; implement the
  spiral path helper + assignment. `random` keeps the current shuffle. Thread `layout`
  from `initialGameState` (read `config.numberLayout`).
- `supabase/functions/game-service/index.ts` — mirror the spiral helper, the sequence
  constants, the `Board.spiralNumberSequence` field, and change `generateHexes` +
  `handleRespond` to read `config.numberLayout` (currently ignores it at line ~2931).
  **Requires `npm run edge` on merge** — real games are generated here.

### UI

- `app/(app)/create-game.tsx` — add a control under **Game settings** (next to Dev
  cards). Since it's a 2-way choice (not boolean), use a small segmented control
  ("Spiral" / "Random") rather than a toggle, OR a `CompactToggleRow`-style row labeled
  "Random numbers" that flips spiral↔random. **Decide during implementation**; match the
  existing settings-row visual language. Wire into the `savedDefaults`/`dirty`/`touched`
  machinery and the `createRequest` config payload.

### Validation

- `dev/check-catan-board.ts` — assert each variant's `spiralNumberSequence` multiset
  equals its `numbers` bag; assert the spiral order is a permutation of all hexes; sample
  N spiral generations and assert every non-desert hex gets exactly one token and the
  produced number multiset matches the bag (no adjacent-red assertion — pure positional).

## Non-goals

- No change to resource or desert placement (always random).
- No change to port generation.
- No new DB migration — `config` is already JSONB; missing `numberLayout` parses to the
  default.
- No red-number-adjacency logic in `random` mode (that mode stays fully unconstrained).

## Deploy checklist

- `npm run check` + relevant `dev/check-catan-*.ts` pass.
- `npm run edge` to deploy the mirrored generation (games won't honor the flag until
  deployed).
