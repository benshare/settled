# Catan — game state + schema split

Replace the placeholder dice game (see `games-gameplay.md`) with the data model for a modified Settlers of Catan. This spec covers (1) a `lib/catan` library defining the fixed board structure, (2) the `GameState` type, (3) splitting `games` into `games` (metadata) + `game_states` (state), and (4) the migration. No gameplay logic yet — that comes after.

Games in the DB will be wiped rather than backfilled. The old `games` table is dropped and re-created with the reduced metadata shape; a new `game_states` table holds the variable state, split into typed columns.

## Scope

In scope:

- `lib/catan/board.ts` — static/constant board structure: Hex / Vertex / Edge IDs + adjacency maps + resource/number/building constants.
- `lib/catan/types.ts` — per-game `GameState` type.
- `lib/catan/generate.ts` — variant-keyed generators for layout and number placement (`'standard'` only for v1).
- Migration that drops `games` and re-creates it plus a new `game_states` table.
- Minimum edits to `game-service`, `useGamesStore`, and `app/game/[id].tsx` so the tree still builds after the schema change. Gameplay logic itself is a follow-up.

Out of scope (this spec):

- Gameplay actions: generating the initial board on accept, initial-placement flow, roll → resource distribution, trading, dev cards, robber, ports. Each is its own follow-up.
- Rendering the hex board. The detail screen will show a minimal placeholder after this pass.

## Locked decisions

1. **No rule modifications yet.** Type targets standard Catan first; "modified" mechanics are follow-ups.
2. **Board variant is parameterized.** Hex layout and number placement are each produced by a `Variant`-keyed generator. V1 has exactly one variant, `'standard'`:
    - standard layout = the 19-tile 3-4-5-4-3 arrangement with the fixed resource counts (4 wood, 4 wheat, 4 sheep, 3 brick, 3 ore, 1 desert) in a random permutation.
    - standard numbers = the 18 tokens {2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12} placed randomly across the 18 non-desert hexes.
3. **Ports deferred.** Not in state or type yet.
4. **Robber / 7-roll deferred.** No robber field yet.
5. **Dev cards deferred.** No `dev` field on `PlayerState`, no deck.
6. **Trading deferred.** Player-to-player only when it lands. Type doesn't need a representation yet.
7. **Victory target = 10 VP.** VP is derived from state on the frontend; `winner` (player index) is what's persisted.
8. **Initial placement uses the same `GameState` shape.** Differentiated at the metadata level by `games.status = 'placement'`; in-state `phase` refines the step (round 1 vs. 2, settlement vs. road).
9. **String-literal unions, not TS `enum`s.** For Hex, Vertex, Edge, Resource, and VertexBuilding.
10. **ID naming — row-then-letter, top to bottom, left to right within each row.**
    - Hexes (5 rows of 3-4-5-4-3): `1A-1C`, `2A-2D`, `3A-3E`, `4A-4D`, `5A-5C` (19 total).
    - Vertices (6 rows of 7-9-11-11-9-7): `1A-1G`, `2A-2I`, `3A-3K`, `4A-4K`, `5A-5I`, `6A-6G` (54 total).
    - Edges: string form `"X - Y"` where X, Y are the two vertex endpoints sorted lexicographically. 72 total, hand-listed and frozen. Unit test verifies they match the derivation from `neighborVertices`.
11. **Adjacency maps are constants in the library.** `adjacentVertices: Record<Hex, Vertex[]>`, `adjacentHexes: Record<Vertex, Hex[]>`, `neighborVertices: Record<Vertex, Vertex[]>`, `adjacentEdges: Record<Vertex, Edge[]>`.
12. **Buildings split by surface.** `VertexBuilding = 'settlement' | 'city'`. Edges don't need a kind — an occupied edge is implicitly a road.
13. **Discriminated unions for optional entity state.**
    - `HexData = { resource: null } | { resource: Resource; number: HexNumber }`
    - `VertexState = { occupied: false } | { occupied: true; player: number; building: VertexBuilding }`
    - `EdgeState = { occupied: false } | { occupied: true; player: number }`
14. **`game_states` columns.** `variant text`, `hexes jsonb`, `vertices jsonb`, `edges jsonb`, `players jsonb`, `phase jsonb`. One row per game; single UPDATE keeps multi-field moves atomic. The middle ground between "one blob" (too coarse) and "per-entity rows" (realtime noise, joins).
15. **Events stay on `games`.** History reads don't need to pull the state blob.
16. **`scores int[]` dropped.** VP is derived from state.
17. **Status values: `'placement' | 'active' | 'complete'`.** No `'setup'` — board generation happens synchronously in the accept handler, then the row is inserted directly in `'placement'`.
18. **Derived convenience maps are not persisted.** `Record<number, Hex[]>` (number → hexes), `Record<number, Placement[]>` (player → placements), etc. are computed on the client from stored fields.

## `lib/catan/board.ts` — outline

```ts
// Hexes — 19, row-by-row top to bottom, left to right within each row.
export const HEXES = [
    '1A', '1B', '1C',
    '2A', '2B', '2C', '2D',
    '3A', '3B', '3C', '3D', '3E',
    '4A', '4B', '4C', '4D',
    '5A', '5B', '5C',
] as const
export type Hex = (typeof HEXES)[number]

// Vertices — 54, six rows of widths 7, 9, 11, 11, 9, 7.
export const VERTICES = [
    '1A', '1B', '1C', '1D', '1E', '1F', '1G',
    '2A', '2B', '2C', '2D', '2E', '2F', '2G', '2H', '2I',
    '3A', '3B', '3C', '3D', '3E', '3F', '3G', '3H', '3I', '3J', '3K',
    '4A', '4B', '4C', '4D', '4E', '4F', '4G', '4H', '4I', '4J', '4K',
    '5A', '5B', '5C', '5D', '5E', '5F', '5G', '5H', '5I',
    '6A', '6B', '6C', '6D', '6E', '6F', '6G',
] as const
export type Vertex = (typeof VERTICES)[number]

// Resources
export const RESOURCES = ['wood', 'wheat', 'sheep', 'brick', 'ore'] as const
export type Resource = (typeof RESOURCES)[number]

// Resource counts on the standard board (18 non-desert + 1 desert = 19).
export const STANDARD_RESOURCE_COUNTS: Record<Resource, number> = {
    wood: 4, wheat: 4, sheep: 4, brick: 3, ore: 3,
}

// Number tokens. Array, not set — duplicates matter for randomization.
export const STANDARD_NUMBERS = [
    2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12,
] as const
export type HexNumber = (typeof STANDARD_NUMBERS)[number]

// Buildings — vertex only. Edges imply road when occupied.
export const VERTEX_BUILDINGS = ['settlement', 'city'] as const
export type VertexBuilding = (typeof VERTEX_BUILDINGS)[number]

// Adjacency tables — all hand-authored, locked by type.
export const adjacentVertices: Record<Hex, readonly Vertex[]> = { /* ... */ }
export const adjacentHexes: Record<Vertex, readonly Hex[]> = { /* ... */ }
export const neighborVertices: Record<Vertex, readonly Vertex[]> = { /* ... */ }

// Edges — derived from neighborVertices at module load. Each edge is
// `"${min} - ${max}"` with vertex names sorted lexically. Frozen as a
// readonly tuple so `type Edge = (typeof EDGES)[number]` yields the union.
export const EDGES = deriveEdges(neighborVertices)
export type Edge = (typeof EDGES)[number]

export const adjacentEdges: Record<Vertex, readonly Edge[]> = /* derived */

// Utility
export function edgeEndpoints(e: Edge): [Vertex, Vertex] { /* split " - " */ }
```

A unit test verifies `EDGES.length === 72` and that every edge's endpoints are mutual neighbors in `neighborVertices`.

## `lib/catan/types.ts` — outline

```ts
import type {
	Edge,
	Hex,
	HexNumber,
	Resource,
	Vertex,
	VertexBuilding,
} from './board'

export type Variant = 'standard'

export type HexData =
	| { resource: null } // desert
	| { resource: Resource; number: HexNumber }

export type VertexState =
	| { occupied: false }
	| { occupied: true; player: number; building: VertexBuilding }

export type EdgeState = { occupied: false } | { occupied: true; player: number }

export type ResourceHand = Record<Resource, number>

export type PlayerState = {
	resources: ResourceHand
}

export type Phase =
	| { kind: 'initial_placement'; round: 1 | 2; step: 'settlement' | 'road' }
	| { kind: 'roll' }
	| { kind: 'main' }
	| { kind: 'game_over' }

export type GameState = {
	variant: Variant
	hexes: Record<Hex, HexData>
	vertices: Record<Vertex, VertexState>
	edges: Record<Edge, EdgeState>
	players: PlayerState[]
	phase: Phase
}
```

Player index in `vertices[...].player` / `edges[...].player` / `games.winner` is position in `games.player_order`.

## `lib/catan/generate.ts` — outline

```ts
import { HEXES, STANDARD_NUMBERS, STANDARD_RESOURCE_COUNTS, ... } from './board'
import type { GameState, HexData, Variant } from './types'

// Build the Record<Hex, HexData> for a fresh game. Randomizes resource
// placement and then number-token placement, both gated on Variant.
export function generateBoard(variant: Variant): Record<Hex, HexData> { ... }

export function initialGameState(
    variant: Variant,
    playerCount: number
): GameState {
    return {
        variant,
        hexes: generateBoard(variant),
        vertices: blankVertices(),
        edges: blankEdges(),
        players: Array.from({ length: playerCount }, () => ({
            resources: { wood: 0, wheat: 0, sheep: 0, brick: 0, ore: 0 },
        })),
        phase: { kind: 'initial_placement', round: 1, step: 'settlement' },
    }
}
```

Called from the edge function's `respond` action when the last invitee accepts.

## Database migration

Single file `<ts>_catan_schema.sql`:

```sql
-- Wipe existing games wholesale — no backfill.
drop table if exists public.game_states cascade;
drop table if exists public.games cascade;

create table public.games (
    id uuid primary key default gen_random_uuid(),
    participants uuid[] not null,
    player_order uuid[] not null default '{}',
    current_turn int null,
    status text not null default 'placement',
    winner int null,
    events jsonb[] not null default '{}',
    created_at timestamptz not null default now(),
    check (status in ('placement', 'active', 'complete')),
    check (array_length(participants, 1) >= 1)
);

create index games_participants_gin_idx
    on public.games using gin (participants);
create index games_status_idx
    on public.games (status);

alter table public.games enable row level security;

create policy "games_select_participant" on public.games
    for select to authenticated
    using (auth.uid() = any (participants));

create table public.game_states (
    game_id uuid primary key references public.games(id) on delete cascade,
    variant text not null,
    hexes jsonb not null,
    vertices jsonb not null,
    edges jsonb not null,
    players jsonb not null,
    phase jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.game_states enable row level security;

create policy "game_states_select_participant" on public.game_states
    for select to authenticated
    using (
        exists (
            select 1 from public.games g
            where g.id = game_states.game_id
                and auth.uid() = any (g.participants)
        )
    );

alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.game_states;
```

After running, the user runs `npm run migrate` then `npm run types` to regenerate `database-types.ts`.

## Downstream fixups (stay compileable after the schema changes)

The existing dice-game code references columns that no longer exist (`scores`) and status values that no longer exist (`'setup'`, `'active'` is still valid). We touch only what's needed to keep the tree building; actual Catan logic is a follow-up spec.

### `supabase/functions/game-service/index.ts`

- Remove the `roll` action entirely (no dice rolls anymore).
- In `respond` — on fully accepted — insert both the `games` row (status `'placement'`, shuffled `player_order`, `current_turn = 0`) AND the `game_states` row (variant `'standard'`, generated board, blank vertices/edges, zeroed players, initial-placement phase) in one logical unit. No setup finalizer, no delay.
- Drop `finalizeSetup` and the `EdgeRuntime.waitUntil` machinery.
- Remove the `GameEvent` type's `roll` and `setup_complete` variants — only `game_complete` remains for now. Event kinds will be re-expanded in the gameplay follow-up.

### `lib/stores/useGamesStore.ts`

- `Game` type auto-updates from regenerated `database-types`.
- Drop the `rollDice` action from the store type and implementation.
- `loadForUser` query changes from `.in('status', ['setup', 'active'])` to `.in('status', ['placement', 'active'])` for the active-games bucket.
- `GameEvent` type: drop `roll` and `setup_complete` variants.

### `app/game/[id].tsx`

- Remove the `'setup'` branch, the Roll button, the scores display, and the event-feed items for roll/setup.
- Keep the player circle (avatars in a ring) without score badges.
- Render a placeholder body in `'placement'` / `'active'` / `'complete'` for now — a single "Game in progress" text is fine. Actual board renderer is a follow-up.

## Verification checklist (phase 2 done when all green)

- [ ] `lib/catan/board.ts` exports HEXES, VERTICES, RESOURCES, STANDARD_NUMBERS, STANDARD_RESOURCE_COUNTS, VERTEX_BUILDINGS, adjacency maps, EDGES, adjacentEdges, and helpers.
- [ ] `lib/catan/types.ts` exports GameState, HexData, VertexState, EdgeState, PlayerState, Phase, Variant.
- [ ] `lib/catan/generate.ts` exports generateBoard, initialGameState.
- [ ] Unit test asserts `EDGES.length === 72` and each edge's endpoints are mutual neighbors.
- [ ] Migration creates both tables with RLS + indexes + realtime publication. `npm run migrate` succeeds; `npm run types` regenerates.
- [ ] Edge function `respond` creates both `games` and `game_states` rows on full acceptance. `roll` removed.
- [ ] Store compiles; old `rollDice` and `scores` references gone.
- [ ] `app/game/[id].tsx` compiles and renders a minimal body; no broken references to `scores` or `'setup'`.
- [ ] `npm run check` passes; `npm run format` run.

## Follow-ups (not this spec)

- Initial-placement turn flow (snake order, settlement-then-road per round).
- Roll action with resource distribution from hex adjacency.
- Build actions (road / settlement / city) with cost and adjacency validation.
- Trading (player-to-player).
- Ports, robber, development cards — each its own pass.
- Board renderer UI.
