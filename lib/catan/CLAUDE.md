# Catan

Everything Catan-specific lives here. Split by what it describes:

- `board.ts` — static structure: hex/vertex/edge IDs, adjacency maps, resource and number constants. Pure data + tiny helpers, no game state.
- `types.ts` — `GameState`, `Phase`, sparse-storage helpers (`vertexStateOf`, `edgeStateOf`). All persisted shapes.
- `generate.ts` — fresh-game initialization: variant-keyed hex generation, `initialGameState`.
- `placement.ts` — pure rules for the initial-placement phase (validity, target-settlement derivation, snake-order turn advance, starting-resource grant). No I/O; callable from UI helpers and tests.
- `gameContext.tsx` — React context that loads the per-game `games` row + `game_states` row and subscribes to realtime. Use `useGame()` in any subtree under `<GameProvider>`.

## Constants are duplicated in the edge function

`supabase/functions/game-service/index.ts` re-declares `HEXES`, `VERTICES`, `EDGES`, `adjacentVertices`, and the derived adjacency IIFEs from `board.ts`, plus the placement rules from `placement.ts`. The Deno bundler can't reliably import up-tree from `supabase/functions/`, so we accept a single redundancy: change both when rules or board data change. The source of truth is `lib/catan/`; the edge function is the copy.

When in doubt, run `npx tsx dev/check-catan-board.ts` (board) and `npx tsx dev/check-catan-placement.ts` (placement) after edits. The edge function is only validated at deploy time (`npm run edge`).

## Sparse storage

`GameState.vertices` and `GameState.edges` are `Partial<Record<…, …>>`. Missing keys default to `{ occupied: false }` via `vertexStateOf` / `edgeStateOf`. Code that writes state should continue to set only occupied entries — never pre-fill 54 + 72 empty entries.
