# Dev scripts

Admin-level helpers for local development. Each script uses the service-role key (`SUPABASE_PRIVATE_KEY` from `.env`) and bypasses RLS, so never run any of these against anything other than a dev project.

All scripts are plain `.mjs` + `node --env-file=.env`. No extra runtime deps.

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

Unit-style checks for `lib/stats.ts` — the Stats tab's aggregations (averages over empty input, per-game rounds, opponent counting and the top-5 cap, bonus pick/win rates and their tie-breaks). Run after editing the stats derivations.

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
