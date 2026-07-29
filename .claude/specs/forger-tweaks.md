# Forger tweaks

Four changes to the set-2 `forger` bonus. Worktree: `.claude/worktrees/forger-tweaks`, branch `forger-tweaks`.

## Today

- The token is `undefined` until the first 7 of the game; every 7-induced robber move snaps every forger's token onto the new robber hex (`handleMoveRobber`, gated on `phase.from7`).
- Before rolling, the forger **may** move the token one hex (optional, once per turn) through `ForgerMovePicker`, a `Modal` listing the six candidate hexes.
- The copy is sourced from `distributeResourcesByHex`, which **skips the robber's hex** — so a token under the robber copies nothing.

## Target

### 1. No 7-snap; the token starts on the desert

- Delete the snap block in the edge function's `handleMoveRobber`. `phase.from7` stays (fortune teller still needs it).
- `PlayerState.forgerToken` is seeded to `state.robber` (the desert — see `generate.ts`, robber starts there on both variants) in `handlePickBonus`, in the `allChosen` branch that snapshots `bonus`/`curse` onto the players. Only seeded for seats whose chosen bonus is `forger`.
- **Legacy games** (a forger in flight whose token is still `undefined`, or a game whose bonus lock-in predates this change) resolve the token through one helper rather than special-casing: `forgerTokenHex(p, robberHex) = p.forgerToken ?? robberHex`. Such a token materialises on the robber's current hex the first time anything reads it. Used by the board render, the move layer, `canMoveForgerToken`, and the server's move handler.
- `forger_token_set` is no longer emitted. `ActionLog`'s case for it stays so old logs still render.

### 2. The move is mandatory, and it blocks the roll

- New pure helper `mustMoveForgerToken(p) = p.bonus === 'forger' && !p.forgerMovedThisTurn`.
- Server: `handleRoll` rejects with `'move your forger token first'` when the acting seat must move. `forgerMovedThisTurn` is already reset on `end_turn`, so the obligation returns every turn.
- The token can never be stuck: every hex on both boards has ≥2 vertex-adjacent hexes, so `hexesAdjacentTo` is never empty. Moving onto the desert or onto the robber's hex stays legal (a wasted turn, not an illegal one).
- Ritualist / shepherd pre-roll actions are unaffected — one bonus per player, so no seat is both.

### 3. Board-based move UI, no modal

- **Delete** `lib/catan/ForgerMovePicker.tsx` and the `forgerMoveOpen` state / `onForgerMovePress` button plumbing.
- **New** `lib/catan/ForgerMoveLayer.tsx`, modelled directly on `RobberLayer`'s `move_robber` branch: for each hex adjacent to the token's current hex, a `PulsingDot` in the viewer's player colour plus a transparent tap circle. Reuse the desert backdrop trick (a blank token-shaped disc under the pulse, since the desert has no `NumberToken` for the halo to sit on).
- `BoardView` gains an optional `forgerMove?: { meIdx: number; from: Hex; onMove: (hex: Hex) => void }` bundle alongside `interaction` / `build` / `robber`, rendered after `RobberLayer`. The two are mutually exclusive by phase (`roll` vs `move_robber`), so no z-order question.
- `BoardArea` supplies it when `isMyActiveTurn && phase.kind === 'roll' && !phase.pending?.dice && myPlayer.bonus === 'forger' && !myPlayer.forgerMovedThisTurn`.
- A tap routes through the existing `confirmAction` → floating `ConfirmBar` ("Move forger token here?"), the same path `onMoveRobberRequest` / `onStealRequest` use. No preview piece — the pulse already marks the target.
- `MainLoopBar` takes a `forgerMustMove` prop: the Roll button renders **disabled** (not hidden, so the bar doesn't reflow) and the status line reads `Move your forger token` instead of `Your turn — roll the dice`. Other players' status is unchanged (`X to roll`).
- `ForgerPickOverlay` (which player to copy from) is untouched — it stays a `MinimizableModal`.

### 4. The forger bypasses the robber

- `roll.ts`: extract `gainsFromHex(state, hex, total)` — per-player gains from a single hex, **ignoring the robber**. `distributeResourcesByHex` is refactored to `robber-hex skip + gainsFromHex` so the two can't drift.
- The edge function's forger queue block sources candidates from `gainsFromHex(state, tokenHex, total)` rather than `perHex[tokenHex]`. Everything downstream (auto-copy of a lone candidate, `ForgerPickEntry.gainsByCandidate`, `forger_copy`) is unchanged, so the forger copies what a candidate **would** have received from a blocked hex.
- The forger's own production is not affected — the robber still blocks it. Only the copy bypasses.
- Underdog/city multipliers still apply inside `gainsFromHex`; plutocrat still doesn't (it's applied to summed roll gains, not per-hex — see `lib/catan/CLAUDE.md`).

## Files

| File                                       | Change                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `lib/catan/bonus.ts`                       | `forgerTokenHex`, `mustMoveForgerToken`; `canMoveForgerToken` takes `robberHex` and resolves through the fallback |
| `lib/catan/roll.ts`                        | `gainsFromHex`; `distributeResourcesByHex` refactored onto it                                                     |
| `lib/catan/types.ts`                       | comments on `forgerToken` / `forgerMovedThisTurn` / `from7`                                                       |
| `lib/catan/ForgerMoveLayer.tsx`            | **new**                                                                                                           |
| `lib/catan/ForgerMovePicker.tsx`           | **deleted**                                                                                                       |
| `lib/catan/BoardView.tsx`                  | `forgerMove` bundle; token render reads `forgerTokenHex`                                                          |
| `lib/catan/bonuses/bonuses.ts`             | rewritten description                                                                                             |
| `lib/game/BoardArea.tsx`                   | pass `forgerMove`                                                                                                 |
| `lib/game/BottomArea.tsx`                  | drop picker + button; `forgerMustMove` → disabled Roll + status                                                   |
| `lib/game/gameScreenContext.tsx`           | drop `forgerMoveOpen`; add `forgerMustMove` / `forgerTokenFrom` / `onMoveForgerTokenRequest`                      |
| `supabase/functions/game-service/index.ts` | seed on pick; drop snap; roll gate; `gainsFromHex`; fallback in move handler                                      |
| `dev/check-catan-bonuses.ts`               | `testForger` rewritten                                                                                            |
| `lib/catan/CLAUDE.md`                      | forger paragraphs                                                                                                 |

## New card text

> You have a forger token, starting on the desert. At the start of each of your turns you must move it to an adjacent hex. Whenever the token's hex produces, you copy the resources another player receives from it — even if the robber is blocking that hex.

## Checks

`npx tsx dev/check-catan-bonuses.ts` + `check-catan-roll.ts`, then `npm run check` / `npm run format`. `npm run edge` to deploy — none of the rules changes reach players without it.
