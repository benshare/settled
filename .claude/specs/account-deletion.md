# Account deletion

A user can permanently delete their account from the Account tab. Required for
App Store compliance (an app with account creation must offer in-app account
deletion) and for the "delete my data" half of a privacy policy.

The interesting part is not the auth-user delete — it's what happens to the
shared rows the account is entangled with: pending invitations, in-progress
games, and every screen in the app that renders a co-player's username.

## Scope

In scope:

- A destructive **Delete account** action at the bottom of the Account tab,
  behind `ConfirmModal`.
- A new `delete_account` action in `game-service` that, for the calling user:
  cancels every unfinished game they sit at, deletes every game request they're
  a party to, removes their avatar object, and hard-deletes the auth user
  (cascading the `profiles` row and everything keyed to it).
- A **deleted-user placeholder profile** synthesized in `useGamesStore` so the
  ~40 existing `profilesById[id]?.username ?? 'Player'` sites render
  `[deleted user]` without being touched.
- A `not valid` username-format check constraint on `profiles`, so the
  placeholder's username is unforgeable by a real account.
- Doc updates: `lib/stores/CLAUDE.md`, `lib/modules/CLAUDE.md`,
  `supabase/functions/CLAUDE.md`, and this spec.

Out of scope:

- Any grace period / undelete window. Deletion is immediate and terminal.
- Data export ("download my data").
- Deleting the deleted user's uuid out of `games.participants` /
  `games.player_order` / `games.events`. Those are a bare uuid with no PII
  attached once the profile is gone, and rewriting them would corrupt the seat
  indices every finished game's history is scored against.
- Editing `app/privacy.tsx`. Its copy is the user's to write.
- A server-side sweep for orphan rows. The FK cascade covers everything that
  points at `profiles`; the two places that hold a uuid without an FK
  (`game_requests.invited`, `games.participants`) are handled explicitly by the
  action or deliberately left alone per above.

## Design decisions (locked in)

1. **Unfinished games are canceled, never completed.** Every game the user sits
   at with `status in ('placement','active')` goes to `status = 'canceled'`
   with a `game_canceled` event appended and a `game_canceled` push to the
   remaining participants. No winner, no `game_results` rows, so the game
   contributes nothing to anybody's stats — the same ending as a whole-table
   end-vote or an everyone-timed-out sweep.

    Why not forfeit-and-award-the-win: a forfeit has no mechanical effect on turn
    order (see the forfeiting section of `lib/catan/CLAUDE.md`), so a 3+ player
    table would stall forever on a seat nobody can play, and the move-timeout
    sweep would auto-play a deleted account's turns indefinitely. Canceling is
    the only ending that leaves no dangling obligation. Applying it uniformly —
    rather than special-casing 2-player tables into a win — keeps one rule.

2. **The action lives in `game-service`, not a new function.** It's account-
   shaped work in a games-shaped function, but `commitActionWrite` is the only
   place a game is allowed to end (`supabase/functions/CLAUDE.md`), and a
   second function would have to duplicate its canceled branch — the exact
   drift that invariant exists to prevent. It also gets `sendNotifications`
   (and therefore the recipients' app-icon badge correction) for free.

3. **The `profiles` row is hard-deleted, and the client synthesizes a
   placeholder.** A tombstone row would need no client change at all, but
   keeping a row for a user who asked to be deleted is the weaker compliance
   story. Instead, whenever a profiles fetch comes back without a row for an id
   it explicitly asked for, the store puts a synthetic `Profile` in
   `profilesById`:

    ```ts
    { id, username: '[deleted user]', avatar_path: null, deleted: true, … }
    ```

    Three things fall out of doing it at the store layer:

    - Every existing `profilesById[uid]?.username ?? 'Player'` site is already
      correct. No 40-site rewrite, and no site has to distinguish "still
      loading" from "deleted" — a missing key still means loading, because the
      placeholder is only written after a query has come back.
    - `ensureProfiles` stops re-querying a deleted id on every render (today a
      permanently-missing id stays missing, so the filter never shrinks).
    - `Avatar` gets one check (`profile.deleted`) instead of rendering `[` as
      the initial.

4. **`[deleted user]` is unforgeable.** The username format rule (3–20 chars,
   `[A-Za-z0-9_]`) is enforced only in the client today, so a hand-rolled
   request could set a real profile's username to the sentinel and impersonate
   a deleted user. The migration adds the format as a check constraint, `not
valid` so it binds every future write without asserting anything about rows
   that already exist (dev seed users may predate the rule; a `validate
constraint` pass can happen separately if the user wants one).

5. **Game requests are deleted, not marked rejected.** A request the deleted
   user proposed dies with them (the `proposer` FK cascades anyway); a request
   they were _invited_ to can never reach all-accepted, so it's dead too and the
   row goes. Deleting is what `cancel_request` already does, and like it, no
   push goes out — the invite simply disappears from the other parties' Play
   tab via the existing `game_requests` realtime channel.

    The invited case is the one thing no FK covers (`invited` is jsonb), so the
    action reads the requests and filters them itself.

6. **The auth user is hard-deleted, not soft-deleted.** `deleteUser(id)` with
   no `shouldSoftDelete` frees the phone number, so the same person can sign up
   again later and get a fresh account rather than a permanently unusable
   number.

7. **The `profiles` cascade is the deletion mechanism for everything else.**
   `friends`, `friend_requests`, `game_messages`, `game_chat_reads`,
   `game_results`, `push_tokens` and `game_requests.proposer` all reference
   `profiles(id)` (or `auth.users`) `on delete cascade`. Deleting the auth user
   is therefore the whole data deletion; the action's explicit work is only the
   things a cascade _can't_ express (ending games, jsonb-referenced requests,
   the storage object).

    Two consequences worth stating. The user's `game_results` rows go, so the
    global `card_stats` counts and other players' opponent lists shrink by their
    contribution — that's the point of deletion, not a bug. And because
    `games.participants` has no FK, a game whose _every_ seat has since deleted
    their account leaves a `games` row (plus its `game_states` / `game_messages`
    children) that no `select` policy can ever return, since every policy is
    `auth.uid() = any (participants)`. Unreachable and unreferenced rather than
    exposed; a sweep for them is out of scope.

8. **Deletion is blocked while impersonating.** `lib/admin.ts`'s "act as" holds
   a borrowed session, and this action is irreversible against whoever that
   session belongs to. The row is hidden when `useAdminStore.actingAs` is set.

9. **The client reuses the sign-out teardown.** On a successful call the screen
   runs the existing `handleSignOut` sequence (deregister push token → badge 0 →
   `clearProfile` → `clearAllUserStores` → `signOut` → `router.replace('/')`).
   Its `push_tokens` delete no-ops — the row went with the profile — and
   `supabase.auth.signOut()` still clears the local session when the server
   answers that the user is gone (an `AuthApiError` doesn't stop the local
   removal). Deregistering _before_ the delete instead would leave the device
   silently unregistered if the delete then failed.

10. **`callGameService` moves to `lib/gameService.ts`.** `deleteAccount` belongs
    on `useProfileStore` (it owns the profile row), but `useGamesStore` already
    imports `useProfileStore`, so importing the other way would cycle. The call
    helper and its edge-error reader are game-store-agnostic anyway; extracting
    them gives both stores one entry point and keeps the "single entry point for
    every game-service call" comment true.

## Database migration

`supabase/migrations/<ts>_username_format.sql` — one constraint, no schema
change. Everything else deletion needs already cascades.

```sql
-- The username rules (3-20 chars, letters/digits/underscore) have only ever
-- been enforced client-side. Account deletion introduces a display sentinel —
-- '[deleted user]', synthesized client-side for a profile row that no longer
-- exists — and a sentinel a real account could adopt is an impersonation
-- vector. NOT VALID binds every future insert/update without asserting
-- anything about rows written before the rule existed.
alter table public.profiles
    add constraint profiles_username_format
    check (username ~ '^[A-Za-z0-9_]{3,20}$')
    not valid;
```

Run `npm run migrate`, then `npm run types` (the constraint doesn't change the
generated types, but the script is the convention).

## Server: `delete_account`

New action in `supabase/functions/game-service/index.ts`. No body fields — the
subject is always the caller.

```ts
type DeleteAccountBody = { action: 'delete_account' }
```

`handleDeleteAccount(admin, me)`, in order:

1. **Cancel unfinished games.** Select `games` with
   `.in('status', ['placement','active']).contains('participants', [me])`. For
   each, `loadGame` and then:

    ```ts
    await commitActionWrite(
    	admin,
    	game,
    	{ phase: { kind: 'game_over' } },
    	[{ kind: 'game_canceled', at }],
    	null,
    	state,
    	{ canceled: true, gameFields: { deadline_at: null } }
    )
    ```

    Same shape as `applyTwoPlayerTimeout`'s everyone-idle branch. Targets
    accumulate across games (`game_canceled` to every seat but the caller's) and
    go out in one `sendNotifications` call — awaited rather than `waitUntil`'d,
    because backgrounding it would race the auth delete below.

    A failure here aborts with a 500 and the account survives. Partially
    canceling and then failing is possible; the retry is idempotent (a canceled
    game is no longer selected).

2. **Delete game requests.** Select `id, proposer, invited` from
   `game_requests`, keep rows where `proposer === me` or `invited` contains an
   entry with `user === me`, and delete them by id. Service role, so no RLS
   filter narrows the read; the table holds one row per live invitation, so the
   full read is cheap.

3. **Remove the avatar object.** `storage.from('avatars').remove([`${me}/avatar.jpg`])`.
   Best-effort — log and continue. The bucket path is fixed by the upload code
   in `account.tsx`.

4. **Delete the auth user.** `admin.auth.admin.deleteUser(me)`. On error, 500
   with the message — the games are already canceled, and the user is told the
   deletion failed so they can retry.

5. `json({ ok: true })`.

Wire it into `dispatch`. It carries no `game_id`, so the `serve`-level undo
baseline and `refreshDeadline` skip it automatically.

## Client

### `lib/gameService.ts` (new)

`callGameService` and `edgeErrorMessage` moved verbatim out of
`useGamesStore.ts`, which now imports them. No behavior change.

### `lib/stores/useProfileStore.ts`

- `export const DELETED_USERNAME = '[deleted user]'`
- `export type Profile = Row & { deleted?: true }` — the marker is never present
  on a row that came from the database.
- `export function deletedProfile(id: string): Profile` — the synthetic row:
  sentinel username, `avatar_path: null`, `dev: false`, `deleted: true`, and
  column defaults for the rest.
- `deleteAccount(): Promise<{ error: string | null }>` — calls the action
  through `callGameService`, no local state change (the screen tears everything
  down).

### `lib/stores/useGamesStore.ts`

Two places build `profilesById` from a set of ids; both fill the gaps with
`deletedProfile(id)` after the query returns:

- `loadForUser` — every id in the `ids` set with no fetched row.
- `ensureProfiles` — every id in `missing` with no fetched row (which also stops
  the repeat query for a permanently absent id, so the early
  `if (!profiles || profiles.length === 0) return` goes).

Dev filtering is unaffected: `profilesById[p]?.dev !== true` reads `false` off
the placeholder, so a canceled game with a deleted player stays visible in the
Watch list exactly as it would have.

### `lib/modules/Avatar.tsx`

`profile.deleted` renders a neutral `?` glyph instead of the first letter of the
sentinel.

### `app/(app)/account.tsx`

Below the existing Sign out button, a **Delete account** section — a
destructive-styled `Button` (or a bare red text button, matching whichever the
design system already offers for destructive actions) that opens `ConfirmModal`:

```
Delete account?

Your profile, games in progress, and pending invites will be
permanently deleted. This can't be undone.

[ Cancel ]                              [ Delete account ]
```

`destructive`, `submitting` while the call is in flight, and `error` for the
propagated failure message. On success, run the existing sign-out teardown.
Hidden entirely when `useAdminStore.actingAs` is set.

## What a remaining player sees

- **Mid-game:** the game flips to `canceled` over the existing `games` realtime
  channel and the game screen shows its game-over recap; the action log renders
  the `game_canceled` event. The deleted seat reads `[deleted user]` once their
  client refetches profiles (the profile delete has no realtime channel of its
  own, so an already-loaded username can persist until the next foreground
  resync — cosmetic and self-correcting).
- **Play tab:** the invitation disappears; the canceled game moves from Active
  to History.
- **Friends tab:** the friendship and any pending request vanish (cascade). Same
  refetch caveat.
- **Stats:** the canceled game contributes nothing. Previously-finished games
  keep their result rows and still count, with the deleted player rendered as
  `[deleted user]` in opponent lists.

## Verification

Done:

- [x] Migration applied with `npm run migrate`; `npm run types` re-run (no type
      change — a check constraint doesn't surface in the generated types).
- [x] `npm run edge` deployed (gated on `check:edge`).
- [x] `npm run check` (tsc + `deno check` + eslint) and `npm run format` pass.
      `expo-doctor`'s dependency-version advisory is pre-existing.
- [x] Server path exercised end-to-end against two throwaway accounts: a
      placement-phase game with both of them, one accepted request, one pending
      request, a friendship. Asserted afterwards — game `canceled` with no
      winner, `deadline_at` cleared, `game_canceled` event appended, state phase
      `game_over`, zero `game_results` rows, both requests gone, profile row
      gone, auth user gone, friendship cascaded, the other account untouched,
      the deleted uuid still seated in `participants` / `player_order`, and the
      format constraint rejecting `[deleted user]` as a username.

Left for you (needs a device and two real accounts):

- [ ] The button and modal on a device; the second account seeing the canceled
      game with the deleted seat as `[deleted user]` plus a neutral avatar, in
      the game screen, History, and Stats opponents.
- [ ] The deleted phone number signing up again and getting a fresh account.
- [ ] Delete row absent while "act as" is active.
