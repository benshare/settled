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
