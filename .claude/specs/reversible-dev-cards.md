# Reversible dev-card plays

Playing a dev card is a barrier today: it flushes the local queue
(`local-action-queue.md`) and goes straight to the server, so it can't be
undone. Most of what a play does is solo and information-free, and the queue's
membership rule is exactly that. This moves those plays into the queue, so they
undo like a build. The undo boundary moves to the first step that reveals
something.

## Locked decisions (confirmed with user)

| Card           | Becomes                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Road Building  | Fully local: the play and both free roads (the roads already queue).                                                                                                               |
| Knight         | The play is local, including entering `move_robber` and any Largest Army change. **Confirming the robber hex is the barrier.** It flushes the knight and then sends `move_robber`. |
| Year of Plenty | Fully local: the picker's confirm queues the play with its two resources.                                                                                                          |
| Monopoly       | **Unchanged.** Nothing happens until the picker confirms (cancel is the back-out), and that confirm stays a barrier.                                                               |

- Robber, steal, shepherd, fortune-teller and magician logic stay server-only.
  A local robber move was rejected because it can auto-steal and open windows
  for other seats.
- **Road Building has no info modal when it's playable.** Tapping the tile
  queues the play and the board enters free-road placement. When it isn't
  playable (wrong turn or phase, already played a card this turn, bought this
  turn), the tile still opens the info modal with its reason, as today. The
  other cards keep their modal.

## Rules layer — `lib/catan/apply.ts` (+ edge mirror)

- New `LocalAction` arm, the same shape as today's wire body minus `game_id`:
  `{ action: 'play_dev_card'; id: 'knight' | 'road_building' | 'year_of_plenty'; payload?: { r1: Resource; r2: Resource } }`.
  `play_dev_card` joins `UNDOABLE_ACTIONS`. Monopoly is the one id that
  isn't queueable. The type excludes it and `parseLocalAction` rejects it, so a
  batch can't carry one.
- `applyPlayDevCard` is lifted from `handlePlayDevCard`'s shared half (gates,
  card removal, `devCardsPlayed` bump, `playedDevThisTurn`, resume) plus the
  three card arms. It ends in `finish(..., { recomputeRoads: false })`, so a
  knight that swings Largest Army past the threshold projects a pending win
  like any build.
- The gates live in a shared `devPlayFloor(state, meIdx, id)`. The monopoly
  arm of `handlePlayDevCard` also calls it, so the two paths can't disagree.
- **New gate: no play during a pending gambler roll** (`phase.kind === 'roll'`
  with `pending` set). Today a play there resumes to a bare `{ kind: 'roll' }`.
  That drops the pending dice and amounts to a free reroll. It's a pre-existing
  hole, closed here because the gate is being rewritten anyway. The client's
  `reasonUnplayable` shows "Confirm your roll first."

## Server — `supabase/functions/game-service/index.ts`

- Mirror the reducer, the type arm and the `parseLocalAction` case.
- In `handlePlayDevCard`, knight, road building and year of plenty become a
  wrapper around `commitLocalActions`, like the other 13 single-action handlers.
  Monopoly keeps its open-coded body behind `devPlayFloor`.

## Client

- `gameScreenContext.onPlayDevCard`: monopoly keeps flush-then-call. Every
  other card is `enqueue(...)`, with no flush, no `submitting` and no network.
- `DevCardHand`: a playable Road Building tile calls `onPlay` directly and
  skips the modal. A new `noRoadRoom` reason ("No room for a road.") comes from
  `hasLegalRoadPlacement`. Without it, a stray tap would spend the card for
  nothing. That tap would now be undoable, but it's still a confusing
  no-op. The server keeps accepting the play. The gate is a client hint only.
- Classic layout: the `road_building` and `move_robber` action bars get the
  undo arrow when `canUndo`. The new HUD's `StatusBanner` already renders it in
  every phase.
- Undo out of `move_robber` also clears any drafted robber hex.

## Deploy

Edge first (`npm run edge`), then OTA. Old client + new server: it still sends
single `play_dev_card`, which takes the same path. New client + old server: a
batch with `play_dev_card` is rejected by the old `parseLocalAction`. No
migration.

## Checks

- `dev/check-catan-apply.ts`: each queueable card applies and undoes. That
  means fold-then-truncate equals the original state. Also: a knight that wins
  through Largest Army reaches `game_over`, road building with no legal road
  resumes immediately, monopoly is rejected by the fold, and a play during a
  pending gambler roll is rejected.
- `npm run check`, `npm run format`, every `dev/check-catan-*.ts`.

## Files

| File                                       | Change                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `lib/catan/types.ts`                       | `LocalAction` arm, `UNDOABLE_ACTIONS` member                       |
| `lib/catan/apply.ts`                       | `applyPlayDevCard`, `devPlayFloor`                                 |
| `supabase/functions/game-service/index.ts` | mirror; `parseLocalAction`; `handlePlayDevCard` split              |
| `lib/game/gameScreenContext.tsx`           | enqueue non-monopoly plays; clear robber draft on undo             |
| `lib/catan/DevCardHand.tsx`                | Road Building skips the modal; `noRoadRoom` + pending-roll reasons |
| `lib/game/TopArea.tsx`                     | undo arrow on the road-building and robber bars                    |
| `dev/check-catan-apply.ts`                 | cases above                                                        |
| CLAUDE.md (`lib/catan`, `lib/game`)        | membership rule now includes these dev plays                       |
