# Expanded board — 5–6 player extension

## Implementation status — DONE (pending edge deploy)

Implemented on branch `expanded-board`. All of A–D landed; `npm run check` (tsc +
eslint) passes, every `dev/check-catan-*.ts` passes (board check validates both
variants), and a generation smoke test confirms the expanded board deals 30 hexes /
2 deserts / 28 tokens / 11 ports with the authentic composition.

Type strategy chosen: **opaque `string` IDs + per-variant `Board` bundle** (`boardFor`),
as recommended below.

**Not yet done — must happen on merge:** deploy the edge function with `npm run edge`.
The mirrored board data + variant logic live in
`supabase/functions/game-service/index.ts`, but the edge function is only validated/
deployed at deploy time. Expanded games will not generate correctly for real players
until it's deployed. (No DB migration needed — `variant` column already exists.)

## Goal

Support 5- and 6-player games on the authentic Catan 5–6 player extension board (30
hexes), selected **automatically** by player count. A game with 5 or 6 players uses the
expanded board; 2–4 players continue to use today's standard 19-hex board. Enforce a
hard cap of 6 players when creating a game.

Locked decisions (from requirements Q&A):

- **Board:** authentic 30-hex extension, hex rows `3-4-5-6-5-4-3`.
- **Turn flow:** simple rotation only. The extension's optional "Special Building Phase"
  is **out of scope** for this pass (can be added later).
- **Trigger:** `variant` derived from player count — `5–6 → expanded`, `2–4 → standard`.
  Create-game caps the table at 6 players (max 5 invites).

Victory stays at 10 VP. Bonuses, curses, dev cards, ports, robber, trade — all existing
subsystems apply unchanged on the bigger board (they're already parameterized on
`playerCount` and read board data by lookup).

## Authentic extension parameters

Combined board (base 19 + extension 11 = **30 hexes**):

| Resource        | Standard | Expanded |
| --------------- | -------- | -------- |
| brick (hills)   | 3        | 5        |
| wood (forest)   | 4        | 6        |
| sheep (pasture) | 4        | 6        |
| wheat (fields)  | 4        | 6        |
| ore (mountains) | 3        | 5        |
| desert          | 1        | 2        |
| **total**       | **19**   | **30**   |

- **Number tokens (28)** for the 28 resource hexes:
  `2×2, 3×3, 4×3, 5×3, 6×3, 8×3, 9×3, 10×3, 11×3, 12×2`.
- **Ports (11)** = base 9 + one 3:1 generic + one sheep 2:1:
  `5× 3:1, 1× brick, 1× wood, 2× sheep, 1× wheat, 1× ore`.

Sources: Catan 5–6 extension rulebook; Catan Wiki.

## Board geometry

The standard board is fully hand-authored in `board.ts` (`HEXES`, `VERTICES`, `EDGES`,
`adjacentVertices`, `COASTAL_EDGES`, `PORT_SLOTS`) and re-derives `adjacentHexes`,
`neighborVertices`, `adjacentEdges` from those. The expanded board needs the same data
for a `3-4-5-6-5-4-3` layout.

Rather than hand-author 30 hexes × 6 corners, add a **coordinate-based generator**
(`dev/gen-expanded-board.ts`) that:

1. Places the 30 hex centers on an axial/offset grid for rows `3-4-5-6-5-4-3`.
2. Computes each hex's 6 corner vertices (pointy-top, N-clockwise), deduping shared
   corners into a canonical `VERTICES` list ordered top-to-bottom, left-to-right.
3. Derives `EDGES` (canonical `"a - b"`, `a<b`), `adjacentVertices` per hex,
   `COASTAL_EDGES` (edges bordering exactly one land hex, in clockwise ring order),
   and 11 `PORT_SLOTS` spaced around the ring so no two ports share a vertex.
4. Emits the literal arrays/maps to paste into `board.ts` (mirrored to the edge fn).

Expanded counts (to be confirmed by the generator + check script):
30 hexes, ~93 vertices, ~124 edges. Vertex row widths for `3-4-5-6-5-4-3` are
`7, 9, 11, 13, 13, 11, 9, 7`.

The generator's output is frozen into source (not run at runtime) so the edge function
and client share identical static data. A **check script** validates both variants.

## Type & data-model strategy (recommended — flag for review)

Today `Hex`/`Vertex`/`Edge` are **string-literal unions**, and `hexes: Record<Hex,
HexData>` is a *total* record. Two boards with overlapping IDs (both have a hex `1A`) but
different totalities break the total-record shape if we simply union the literals.

**Recommendation:** introduce a per-variant board bundle and relax the ID types to opaque
`string`s (branded if we want nominal safety):

```ts
export type Hex = string
export type Vertex = string
export type Edge = string

export type Board = {
  hexes: readonly Hex[]
  vertices: readonly Vertex[]
  edges: readonly Edge[]
  adjacentVertices: Record<Hex, readonly Vertex[]>
  adjacentHexes: Record<Vertex, readonly Hex[]>
  neighborVertices: Record<Vertex, readonly Vertex[]>
  adjacentEdges: Record<Vertex, readonly Edge[]>
  coastalEdges: readonly Edge[]
  portSlots: readonly Edge[]
  resourceCounts: Record<Resource, number>
  numbers: readonly HexNumber[]
  portComposition: readonly PortKind[]
  layoutRows: readonly (readonly Hex[])[]
}

export const BOARDS: Record<Variant, Board>
export function boardFor(variant: Variant): Board
```

- `Record<Hex, HexData>` etc. become `Record<string, …>` / `Partial<Record<string, …>>`.
  Runtime correctness is guarded by the check scripts (which already validate board
  integrity), replacing the compile-time key-exhaustiveness we lose.
- Pure rule helpers that currently import module-level constants
  (`adjacentVertices`, `PORT_SLOTS`, …) take the resolved `Board` (or `GameState`, from
  which `boardFor(state.variant)` is derived) instead.

_Tradeoff:_ we lose some compile-time key checking on board records. The alternative —
keeping literal unions per variant — forces `Partial` records everywhere anyway and adds
a large, awkward union type; the `string` + `Board`-bundle approach is cleaner and lower
risk for supporting two boards. **This is the one decision worth a second look before
implementation.**

## Work breakdown

### A. Core data (`lib/catan/`)

1. **`board.ts`** — refactor to the `Board` bundle. Keep standard data (moved under
   `BOARDS.standard`). Add generated `BOARDS.expanded`. Export `boardFor`. Keep the
   derived-adjacency IIFEs as a helper that builds a `Board` from its hand-authored parts.
2. **`dev/gen-expanded-board.ts`** — the generator described above.
3. **`layout.ts`** — `HEX_ROWS`/`computeBoardLayout` become variant-aware
   (`computeBoardLayout(variant, targetW, targetH)`); expanded natural dimensions cover 7
   hex rows (height `11s`, width `6√3·s`). `computeVertexPositions` / `computePortLayout`
   already derive from `adjacentVertices` — pass them the variant's board.
4. **`generate.ts`** — `hexBag`, `generateHexes`, `generatePorts` take `variant` and read
   counts/numbers/port composition/slots from `boardFor(variant)`. `generatePorts`
   distributes the 11-port composition across the 11 slots (positions fixed, kinds
   shuffled). `initialGameState` selects the variant.
5. **`types.ts`** — `Variant = 'standard' | 'expanded'`; relax ID types per the strategy
   above; add `variantForPlayerCount(n): Variant` (`n >= 5 ? 'expanded' : 'standard'`).
6. **Rule modules** — `placement.ts`, `roll.ts`, `build.ts`, `ports.ts`, `robber.ts`,
   `longestRoad.ts`, `bonus.ts`: replace top-level board-constant imports with
   `boardFor(state.variant)` lookups. (Enumerate exact call sites during impl via grep for
   `adjacentVertices|adjacentHexes|neighborVertices|adjacentEdges|PORT_SLOTS|HEXES|VERTICES|EDGES`.)

### B. Edge function (`supabase/functions/game-service/index.ts`)

Mirror **all** of A: expanded board data, `boardFor`, variant-keyed generation, and rule
lookups. At game start (line ~2514) set
`variant: variantForPlayerCount(playerOrder.length)` instead of the hardcoded
`'standard'`, and call `generateHexes(variant)` / `generatePorts(variant)`. Deploy with
`npm run edge` (edge type errors only surface at deploy).

### C. UI / product

7. **`create-game.tsx`** — enforce ≤ 6 players (≤ 5 selected invites): disable further
   selection at the cap and show a hint. Optionally surface "board expands automatically
   at 5–6 players" copy.
8. **`BoardView.tsx`** and layout consumers (`PlacementLayer`, `BuildLayer`,
   `RobberLayer`, port/number rendering) — read the variant's board & layout. Verify the
   larger board scales to fit the screen (aspect ratio changes from 5√3×8 to 6√3×11).
9. **`PlayerStrip` / player-detail** — confirm 5–6 player rows render. Player colors
   already cover 6 (`theme.ts players[]`).

### D. Validation

10. **`dev/check-catan-board.ts`** — validate both variants: each hex has 6 unique
    vertices; every coastal edge borders exactly one land hex; port slots don't share a
    vertex; resource/number/port counts match the tables above; derived adjacency is
    symmetric. Re-run all other `dev/check-catan-*.ts` scripts (they take board data by
    lookup and should pass for both variants where relevant).
11. `npm run check` and `npm run format` at the checkpoints defined in the process.

## DB / migrations

None. `game_states.variant` already exists (`text not null`, migration
`20260418120000_catan_schema.sql`); it just receives `'expanded'` now. `GameConfig` is
unchanged (variant is derived from player count, not a config option).

## Out of scope

- Special Building Phase (the extension's turn-order rule) — deferred.
- Seafarers / any variant beyond the base 5–6 extension board.
- A manual board-size toggle — selection is purely player-count-driven.

## Risks / watch-list

- **Edge-function duplication** is the largest correctness risk: the 30-hex data and every
  lookup must be mirrored exactly. Generate once, paste into both, and validate.
- Expanded board **fitting on small screens** — the aspect ratio is taller/wider; confirm
  `computeBoardLayout` still produces a legible board on a phone.
- **Port ring ordering** for `COASTAL_EDGES` on the new board must be a true clockwise
  cycle for `PORT_SLOTS` spacing to work.
