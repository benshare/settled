# Unseen results + spectator pins

Two small additions to what the Games tab lists, both stored per user
server-side so they follow the user across devices.

## 1. Unseen finished games

A game that ends stays under **Active**, with a `Complete` (or `Canceled`) tag,
until the player has seen its result. Then it drops to History.

### Storage — `unseen_game_results(user_id, game_id)`

Migration `20261125120000_unseen_game_results.sql`. A row means _unseen_.

- **Written by a trigger, not by game-service.** `games_mark_results_unseen`
  fires `after update of status` on the flip into `complete`/`canceled` and
  inserts one row per participant. Every ending path (VP win, forfeit, timeout
  sweep, whole-table cancel) goes through that flip, so none of them needs to
  know about this, and no edge deploy is involved. Participants are joined
  through `profiles` because a deleted account's id survives in
  `participants` and would break the FK.
- **Storing unseen, not seen**, keeps the table at a few rows per user and
  makes the backfill free: games already finished when the migration runs get
  no row, so they read as seen. Nobody gets a flood of old `Complete` tags.
- RLS: self-scoped select and delete. No insert policy — only the trigger
  (security definer) creates rows.

### Client

- `useGamesStore.unseenGameIds` is loaded alongside the lists. It is not on a
  channel of its own: a `games` UPDATE that moves one of my games from
  in-progress to finished is unseen by construction (that flip is what fires
  the trigger), so `handleGameChange` adds the id itself.
- **Seen means the game-over view was on screen.** `useMarkResultSeen`
  (`lib/game/gameScreenShared.tsx`) runs where both layouts mount
  `GameOverOverlay` — the HUD only for the active pane — for a seated viewer.
  It deletes the row even when the store doesn't hold the id yet: the player
  whose move ended the game sees the result before the store's channel
  delivers the ending. `seenThisSession` then stops that late UPDATE from
  re-tagging the game.
- The Games screen splits `completeGames` by `unseenGameIds`: unseen rows lead
  the Active section (tagged, no turn dot), the rest are History.

## 2. Spectator pins

While spectating, the overflow menu (both layouts — `GameMenu` and the HUD
menu, via `usePinToggle`) offers **Pin to Games** / **Unpin from Games**.
Pinned games get their own **Pinned** section on the Games tab, above Watch,
and are lifted out of Watch rather than listed twice.

### Storage — `game_pins(user_id, game_id)`

Migration `20261125130000_game_pins.sql`. Self-scoped select/insert/delete; the
insert check also requires the game to be readable (the `games` subquery runs
under the spectator policies), so a user can only pin a game they could open.

### Behavior

- **A pin outlives the game ending.** That is what distinguishes it from Watch
  (in-progress only) and from the header tab (`profiles.spectating`, pruned on
  end). The spectator select policies are status-agnostic, so the finished
  game stays readable and its row shows a `Complete` tag until unpinned.
- Loaded as `game_pins` with the `games` row embedded; a pin whose game the
  viewer can no longer read (unfriended) comes back without one and is
  dropped from the list (the row itself is left).
- `pinnedGames` rows are refreshed by `handleGameChange` regardless of which
  list the game is in. Pin/unpin are optimistic with rollback; other devices
  pick a change up on their next foreground resync (no channel).
- Not dev-filtered: a pin is a game the viewer explicitly chose, not a
  first-contact listing.
