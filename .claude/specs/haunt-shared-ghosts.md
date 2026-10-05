# Haunt shared ghosts (+ game menu tweaks)

Supersedes locked decision #2 of `catan-bonuses-set-3.md` ("a direct build on
the spot yields no ghost"). That rule contradicted the in-game description and
silently cost haunt players their spot (game `5f0e8aa2`).

## Rule

A haunt spot triggers the moment **the spot itself or any neighbor** gets a
building — by anyone, including the haunt player. The ghost spawns on the spot
and coexists with whatever building is (or later gets) built there. Ghosts are
fully non-interfering: they never block the distance rule, road chaining, or
building on their own corner.

Consequences:

- Own spot built on → the haunt player gets both the settlement and the ghost
  there (double production from that corner). Intended.
- A ghost corner can be built on by anyone; the ghost stays.
- No more chain spawns: ghosts don't make neighbors unbuildable, so a ghost
  never triggers another spot. `resolveHauntGhosts` becomes a single pass.

## Data model

Ghosts move off `state.vertices` into `PlayerState.ghosts?: Vertex[]`
(public; `hauntSpots` stays soft-hidden). The `'ghost'` `VertexBuilding` kind
is removed, along with every `isGhost` special case (distance rule, road
chaining, longest road, liquidation, VP) — those fall out for free because a
ghost no longer occupies its vertex.

Shared helper (client `lib/catan/bonus.ts`, mirrored in the edge function):
`producersAt(state, v): { player, base }[]` — the real building at `v` (base
1/2/3) plus one entry per ghost at `v` (base 1). Every "who has a building on
this corner" consumer goes through it:

- `distributeResources`, `gainsFromHex` (production; underdog applies per
  entry, plutocrat on the summed gain as today)
- `stealCandidates`
- `playerPortKinds`
- power-curse pip totals
- `touchedResources` (youth) — ghosts count, as today
- forger candidates / any other per-hex adjacency scan found during
  implementation

Unchanged, now without ghost branches: `totalVP` (both), `settlementCountFor`,
`cityCountFor`, populist, ritualist, liquidation, `GameOverOverlay`
`breakdownFor` (fixes a bug: it currently scores ghosts as settlements).

## Trigger

`resolveHauntGhosts(state)` after every settlement build (server
`applyBuildSettlement`, client `apply.ts` mirror): for each haunt player's
remaining spot, if the spot or a neighbor is occupied → append to `ghosts`,
drop from `hauntSpots`, emit `ghost_spawned`. Settlement builds are the only
path that adds vertex occupancy after spots are chosen.

## Migration

One-off SQL migration: for every `game_states` row, move each
`vertices[v]` with `building = 'ghost'` into `players[player].ghosts` and
delete the vertex entry. Seven live games have ghosts today. Deploy order:
migration → edge function → OTA, close together. (Old clients would just stop
drawing ghosts until updated; the server is authoritative.)

## UI

`BoardView` draws ghosts from `players[*].ghosts`. A ghost alone sits centered
on its corner as today; when the corner also has a building, the two pieces
render side by side (offset left/right of the corner).

## Docs

- `catan-bonuses-set-3.md`: amend decision #2 + the haunt notes to point here.
- `lib/catan/CLAUDE.md`: haunt line.
- Bonus description (`bonuses.ts`): "…do not prevent other players from
  building within one hex **or on the same spot**."

## Game menu tweaks

- HUD `⋯` menu (`HudTopBar`) and classic `GameMenu`: "Copy debug info" →
  "Copy game ID", copies the bare game id.
- New menu item "Game settings" → modal listing every setting the game was
  created with (`parseGameConfig(game.config)`), one label/value row per
  setting, labels matching `create-game.tsx`. Read-only. Shows every
  setting including defaults; hides ones that don't apply (bonus sub-options
  when bonuses are off, extra build at ≤4 players).
- Both menus get both changes.
