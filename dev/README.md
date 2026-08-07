# Dev scripts

Admin-level helpers for local development. Each script uses the service-role key (`SUPABASE_PRIVATE_KEY` from `.env`) and bypasses RLS, so never run any of these against anything other than a dev project.

All scripts are plain `.mjs` + `node --env-file=.env`. No extra runtime deps.

## Admin mode ("act as" any player)

Not a script — a build-time switch. With both of these in `.env`:

```sh
ADMIN=true
DEV_LOGIN_KEY=<a long random string>
```

every row in the Add-friend search grows an **Act as** button, and a red banner across the top of the app is the way back out. The switch is `IS_ADMIN` in `lib/admin.ts`; the session comes from the `dev-login` edge function, which needs the same key as a secret:

```sh
npx supabase secrets set DEV_LOGIN_KEY=<the same value>
npm run edge
```

Neither variable is defined in any EAS environment, and `.env` is not read by `eas build` or by `eas update --environment production`, so a shipped bundle has `IS_ADMIN === false` and no key to call the endpoint with. Keep it that way: adding `DEV_LOGIN_KEY` to an EAS environment would put an impersonate-anyone credential in a public bundle.

Impersonating an account for the first time sets a password on it, which revokes its existing sessions — i.e. signs that person out on their own devices. Later switches to the same account are silent.

## Scripts

### `seed-test-users.mjs`

Creates N test users (auth row + profile). Phone-confirmed so they don't need SMS. Usernames are `testuser1`…`testuserN`, phones are `+15550000001`…. Idempotent-ish: errors on users that already exist but keeps going.

```sh
# Create 5 test users (default)
node --env-file=.env dev/seed-test-users.mjs

# Create 10
node --env-file=.env dev/seed-test-users.mjs 10

# Also send a pending friend request from each test user to a given target username
node --env-file=.env dev/seed-test-users.mjs 5 --request-to=myrealusername
```

### `seed-reviewer-login.mjs`

Re-pairs the account behind the App Store reviewer bypass (typing `1234567890` on the login screen) with the password the `reviewer-login` edge function signs in with. Sets a fresh random password on the account and pushes the same value to the function's `REVIEWER_PASSWORD` secret, so the two can't drift.

Only run this if the bypass has started failing — an admin password change revokes every session on that account, i.e. it signs the owner out on their own devices.

```sh
node --env-file=.env dev/seed-reviewer-login.mjs
```

### `clear-test-users.mjs`

Deletes every auth user whose profile username starts with `testuser`. Because `profiles.id` cascades from `auth.users` and `friends` / `friend_requests` cascade from `profiles`, one delete wipes everything.

```sh
node --env-file=.env dev/clear-test-users.mjs
```

### `check-catan-board.ts`

Sanity-checks the hand-authored adjacency tables in `lib/catan/board.ts` — hex/vertex/edge counts, mutual adjacency, derived-edges-match-authored. Run after editing the board constants.

```sh
npx tsx dev/check-catan-board.ts
```

### `check-catan-placement.ts`

Unit-style checks for `lib/catan/placement.ts` — distance rule, target-settlement derivation, valid road edges, snake-order turn advance, starting-resource grant. Run after editing placement logic.

```sh
npx tsx dev/check-catan-placement.ts
```

### `check-stats.ts`

Unit-style checks for `lib/stats.ts` — the Stats tab's aggregations (averages over empty input, per-game rounds, opponent counting and the top-5 cap, bonus pick/win rates and their tie-breaks), plus the arithmetic over the global `card_stats` rows the catalog shows. Run after editing the stats derivations.

```sh
npx tsx dev/check-stats.ts
```

### `backfill-game-results.ts`

Fills `game_results` for games that finished before the edge function started writing summaries. Reads each completed game's `game_states` row and scores it with the real `totalVP`, so backfilled rows match what a game completing today would record. Idempotent — games that already have rows are skipped. `offered_bonuses` stays null; the declined bonus pair was never stored for those games.

Unlike the other check scripts this one talks to the database, so it needs the env file. Dry-run it first.

```sh
npx tsx --env-file=.env dev/backfill-game-results.ts --dry-run
npx tsx --env-file=.env dev/backfill-game-results.ts
```
