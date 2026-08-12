# Fencer rework: fences as a build action

Replaces the fencer's start-of-game token placement with a **fence** build
action available during play. Supersedes the fencer parts of
`.claude/specs/catan-bonuses-set-3.md` (items 5–6 of its locked decisions and
the `place_fence_token` action).

## Card text

> You may build fences, which require 1 wood and are placed like roads. Other
> players cannot build on fences. Fences can be upgraded into roads for 1 brick.

No size variants — the card behaves identically at every player count.

## What a fence is

A fence lives in `GameState.fenceTokens` (edge → owning player index), exactly
the storage the reserved-edge tokens used. It is **not** an entry in
`GameState.edges`, so it is invisible to everything that reads occupied edges:
Longest Road, road counts for scoring, `EdgePiece` rendering, road-chaining for
opponents.

What a fence does:

- **Blocks every other player** from building a road on that edge, forever
  (`isFenceReservedAgainst`, unchanged).
- **Chains for further fences** — a fence extends the fencer's fence network
  for the purpose of placing more fences.
- **Can be overbuilt by its owner with a road for 1 brick** (the "upgrade").
  The fence is consumed.

What a fence deliberately does **not** do:

- Count toward Longest Road.
- Satisfy the adjacent-own-road requirement for building a **settlement**.
- Extend the network for placing a **road**.
- Block anything at a vertex (distance rule, opponent chaining through a
  vertex) — a fence is an edge claim only.

## Eligibility

### Placing a fence (new)

Identical to `isValidBuildRoadEdge`, with one substitution: when walking the
endpoints for connectivity, **the player's own fences count as roads**.

- Edge must be unoccupied (`edges`) and unfenced by anybody (`fenceTokens`).
- Connects through an endpoint V iff V holds one of the player's own
  buildings, or V is empty and one of V's other adjacent edges holds the
  player's own road **or own fence**.
- An opponent's building at V blocks chaining through V; a ghost (haunt) stays
  transparent, same as for roads.
- Subject to the supply cap (below).
- Only a player whose `bonus === 'fencer'` may place one.

### Placing a road (unchanged, except supply)

Road eligibility ignores fences entirely — a fence never extends the network
for a road. Consequence: a fence built out ahead of the road network cannot be
upgraded until roads actually reach it. That is intended and matches the
pre-rework behaviour (a reserved edge still needed normal connectivity).

The one thing that changes is the supply check — see below.

### Placing a settlement (unchanged)

Fences are not roads for the settlement adjacency rule. `fenceTokens` is not
consulted.

## Supply

**Roads and fences share the 15-piece road supply.** `canBuildMoreRoads`
becomes a check on `roadCountFor + fenceCountFor < maxRoadsFor(curse)`, and the
same combined count gates fence placement.

Upgrading a fence to a road is **supply-neutral** (one fence out, one road in),
so `isValidBuildRoadEdge` must allow a road on the player's own fence even when
the combined count is already at the cap. The cap check is therefore skipped
when the target edge carries the builder's own fence.

`compaction` (cap 7) is already a banned combo with `fencer` (`combos.ts`), so
the cap in practice is always 15.

## Cost

| Action                      | Cost                        |
| --------------------------- | --------------------------- |
| Fence                       | 1 wood                      |
| Road on own fence (upgrade) | 1 brick                     |
| Road elsewhere              | 1 wood + 1 brick (standard) |

The upgrade price is **not a player choice** — the old Wood-or-Brick pick is
gone. The server derives it from the edge: if `fenceTokens[edge] === meIdx`,
the road costs 1 brick.

Interactions:

- **Bricklayer / smith** are different bonuses and a player holds one bonus, so
  neither can apply to a fence or an upgrade. No cost-substitution plumbing.
- **Age curse** (`canSpendUnderAge`) applies to both, with `costSize` 1.
- **Free roads** (Road Building dev card; explorer's post-placement roads) may
  be placed on the fencer's own fence. The fence is consumed and **there is no
  rebate** — the road was already free. Explorer roads are post-placement, so
  in practice only Road Building can hit this.

## Removed

The whole start-of-game half of the bonus goes away:

- `place_fence_token` action, `handlePlaceFenceToken`, the store action
  `placeFenceToken`, and its `UNDOABLE_ACTIONS` entry.
- `post_placement` `pending.fencer`, `FENCE_TOKEN_COUNT`, the fencer branch in
  `postPlacementNeeded` / the drain check, and the timeout sweep's
  `place_fence_token` auto-pick.
- `BoardTool` / `BuildSelection` variant `'fence_token'` and `fenceableEdges`
  in `BuildLayer.tsx`.
- `FenceStatusBanner` (`PostPlacementOverlay.tsx`) and its `TopArea` branch.
- `FenceCostPicker.tsx`, `fenceRoadCost`, `fencePayChoice`,
  `canAffordFenceRoad`, `ownFenceRoadEdges`, the `fence_pay` request field, the
  `fencePay` store option, and `fencePending` / `onConfirmFenceCost` in
  `gameScreenContext`.
- The `fence_token` game event; replaced by `fence_built`.

`FenceTokenPiece.tsx` **stays** — the dashed-segment-with-node rendering is
still exactly what a fence should look like. Its doc comment is updated.

Existing games' `fenceTokens` rows are left alone: a legacy reserved edge reads
as a fence and upgrades for 1 brick. No migration; a game stuck mid
`post_placement` on a fencer is accepted collateral.

## Rules layer (`lib/catan/`)

`bonus.ts` — the Fencer section keeps `fenceOwner` and
`isFenceReservedAgainst`, drops `FENCE_TOKEN_COUNT` and `fenceRoadCost`, and
gains:

```ts
export const FENCE_COST: ResourceHand // 1 wood
export const FENCE_UPGRADE_COST: ResourceHand // 1 brick
export function fenceCountFor(state, playerIdx): number
export function isOwnFence(state, edge, playerIdx): boolean
```

`curses.ts` — `roadCountFor` is unchanged (occupied edges only); the combined
count is assembled in `build.ts` so `curses.ts` keeps no bonus import.

`build.ts`:

- `canBuildMoreRoads(state, idx)` counts roads + fences against
  `maxRoadsFor`.
- `isValidBuildRoadEdge` skips the cap check when the edge is the builder's own
  fence.
- New `isValidBuildFenceEdge(state, idx, edge)` and
  `validBuildFenceEdges(state, idx)`, sharing a `connectsVia` helper
  parameterised on whether fences chain.
- `canBuildFence(state, idx)` — bonus + cap + hand (1 wood) + a legal edge.
- `payableBuildRoadEdges` — replaces the fencer branch: when the standard road
  cost is unaffordable but the player holds ≥1 brick and owns a fence that is a
  legal road target, return just those fence edges. (This is the "fencer with a
  placed fence and a brick" case from the brief.) When the standard cost _is_
  affordable the full valid set is returned, upgrade edges included.
- `canTakeSpecialBuildAction` gains a `canBuildFence` clause.

`types.ts` — `UNDOABLE_ACTIONS` swaps `place_fence_token` for `build_fence`
(solo and information-free). `fenceTokens`' doc comment is rewritten.

`timeout.ts` — the `pending.fencer` branch is removed from `pendingSeats`.

## Edge function

`supabase/functions/game-service/index.ts` mirrors all of the above:

- New `handleBuildFence` + `BuildFenceBody` (`{ action: 'build_fence',
game_id, edge }`), registered in the action union, the dispatcher, the
  undoable set, and the auth/phase gates that `build_road` uses (main phase for
  the turn holder, or `special_build` for `queue[0]`).
- Validates: fencer bonus, phase, edge exists, unoccupied, unfenced, connected
  under the fence rule, under the shared cap, 1 wood in hand, age curse.
  Writes `fence_tokens` + `players`, appends a `fence_built` event.
- `handleBuildRoad` loses the `fence_pay` branch; the own-fence case now
  resolves to `FENCE_UPGRADE_COST` unconditionally. Fence consumption on
  overbuild stays as-is.
- `isValidBuildRoadEdge` / `canBuildMoreRoads` / `payableBuildRoadEdges` copies
  updated to match.
- `postPlacementNeeded` / the pending-drain helpers drop `fencer`; the timeout
  sweep drops its `place_fence_token` branch.

Rules changes only reach players after `npm run edge`.

## UI

**Build bar** (`BuildTradeBar.tsx`) — a new bonus-gated button in the same
family as Super / Liquid / Invest: `fenceEnabled?: boolean` (undefined = not a
fencer, button hidden), `fenceActive?: boolean`, `onSelectFence?: () => void`.
Styled with its own accent colour, `lock-closed-outline` (the fencer card's own
icon) over a `Fence` label, and a cancel badge when active — identical shape to
`SuperCityButton`, which is the closest analogue (a bonus-only _board tool_
rather than a modal opener).

**Board** (`BuildLayer.tsx`) — `BoardTool` gains `'fence'` and `BuildSelection`
gains `{ kind: 'fence'; edge: Edge }`. The `'fence'` branch pulses
`validBuildFenceEdges` and renders the tapped edge as a `FenceTokenPiece`
preview while the confirm bar is up (mirroring how the road tool previews with
`EdgePiece`). Allowed in `main` and `special_build`.

**Screen state** (`gameScreenContext.tsx`) — `buildEnabled.fence`, a `fence`
case in the board-tap handler and `commitBuild`, and an `onBuildFence` store
call. The `fencePending` / `FenceCostPicker` path is deleted; a fencer's road
onto their own fence now commits straight through the ordinary confirm bar.

The confirm bar has no cost line, so the upgrade price rides the title:
tapping your own fence with the road tool reads "Upgrade fence to road (1
Brick)" instead of "Confirm road placement".

**Store** (`useGamesStore.ts`) — `buildFence(gameId, edge)`; `buildRoad` loses
its `fencePay` option; `GameEvent` swaps `fence_token` for
`{ kind: 'fence_built'; player: number; edge: string; at: string }`.

**Log** (`ActionLog.tsx`) — `fence_built` → "{who} built a fence"; the filter
chip list is updated in step.

## Checks

`dev/check-catan-build.ts` and `dev/check-catan-bonuses.ts` cover the new rules:

- A fence chains off own roads, own buildings, and own fences; not off an
  opponent's road; not through an opponent's building; through a ghost.
- A fence cannot go on an occupied or already-fenced edge, and a non-fencer
  gets an empty `validBuildFenceEdges`.
- A road does **not** chain off a fence; a settlement does **not** count a
  fence as its adjacent road.
- The shared cap: 15 roads blocks a fence; 14 roads + 1 fence blocks a fresh
  road but allows the upgrade on that fence.
- `payableBuildRoadEdges`: fencer with 1 brick + 0 wood and one legal own fence
  returns exactly that edge; with 0 brick returns empty.
- `isOwnFence` identifies the owner's fence and nobody else's.

`dev/check-catan-timeout.ts` loses its fencer post-placement case.

## Docs

`lib/catan/CLAUDE.md`: the fencer entry in "Set-3 non-phase mechanics" is
rewritten (fences are a build action, share the road supply, invisible to
Longest Road and to settlement/road eligibility); `post_placement`'s list of
participating bonuses drops the fencer; `build.ts`'s "road affordability is not
a single boolean" note is restated for the brick-upgrade case.
