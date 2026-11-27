# Banned usernames

Reserve a case-insensitive blocklist of words that can't be used as a username,
so nobody can register as a pronoun (`they`), a resource (`wheat`), `robber`,
`player`, or a game keyword (`knight`, `settlement`). Existing players who
already hold one of these names **keep it** — only a new or changed username is
checked.

## Scope

- Enforce on **set** (`app/(auth)/set-username.tsx`) and **change**
  (`app/(app)/account.tsx`, which calls `useProfileStore.updateUsername`).
- Mirror the rule **server-side** so the table write can't be bypassed (the
  screens write straight to `public.profiles` via PostgREST — there is no
  username edge function today; see Server enforcement).
- **Grandfather** existing users: a banned name already in the table stays
  valid, and updating any *other* profile field (avatar, game defaults, …) must
  never fail because the row's username is on the list.

## Matching rule

- **Exact, full-string, case-insensitive.** `WHEAT`, `Wheat`, `wheat` are all
  rejected; `wheatfield`, `oreo`, `player1`, `the_robber` are **not** (the word
  is reserved, not blocked as a substring — substring matching would reject huge
  swaths of innocent names).
- Comparison is `username.trim().toLowerCase()` against the list. No stripping of
  digits/underscores or leet-speak normalization (out of scope).
- Words shorter than 3 characters (`he`, `it`, `we`, `us`, `me`, `my`, `i`) can
  never be registered anyway — the existing format rule is `^[A-Za-z0-9_]{3,20}$`
  (3–20 chars). They're harmless to list but add nothing; the list below keeps
  only words that are actually reachable.

## The list

Canonical source: a new `lib/username.ts` (client) mirrored into the server
trigger's SQL. Single flat lowercase set.

**Pronouns** (≥3 chars): `him`, `his`, `her`, `hers`, `she`, `they`, `them`,
`their`, `theirs`, `its`, `our`, `ours`, `you`, `your`, `yours`.

**Player:** `player`, `players`.

**Resources + common synonyms:** `brick`, `wood`, `sheep`, `wheat`, `ore`,
`lumber`, `grain`, `wool`, `clay`.

**Robber:** `robber`.

**Game keywords:** `knight`, `settlement`, `settlements`, `city`, `cities`,
`road`, `roads`, `settler`, `settlers`, `catan`, `settled`, `monopoly`,
`victorypoint`, `longestroad`, `largestarmy`, `roadbuilding`, `yearofplenty`,
`devcard`, `desert`.

(Multi-word game terms — "longest road", "largest army", "year of plenty",
"road building" — are collapsed to their no-space form, the only form a username
could take.)

**Bonus / curse card names:** NOT reserved (decided). The 38 bonus/curse ids
(`gambler`, `magician`, `nomad`, `avarice`, …) are mostly ordinary English words
and out of scope; only `knight` (also a dev card) is covered, via Game keywords.

## Client

`lib/username.ts` is the canonical home for the list and the check:

```ts
export const BANNED_USERNAMES: ReadonlySet<string> // lowercase
export function isUsernameBanned(value: string): boolean
// null = ok; else the inline error string. `currentUsername` grandfathers a
// user keeping their existing (possibly reserved) name.
export function bannedUsernameError(
	value: string,
	currentUsername?: string | null,
): string | null
```

- Each screen keeps its **own** length/format `validateUsername` (the copy
  differs by design — verbose onboarding vs terse edit) and adds one
  `bannedUsernameError` call after the format check. Not force-consolidating the
  length/format messages keeps the change surgical and preserves each screen's
  wording. Error surfaced inline on the `Input` exactly as the format error is.
- The banned check is skipped when the value equals the user's **current**
  username (mirrors the grandfather rule and the existing "skip uniqueness check
  when unchanged" behavior). Save is also gated on a dirty check, so a
  grandfathered user can't re-submit their own name anyway — the `currentUsername`
  guard is belt-and-suspenders so the error never flashes in edit mode.
- `useProfileStore.updateUsername` gains the same guard as a client backstop
  (it's a named entry point and the single write path for *changes*): it returns
  `{ error }` without hitting the DB when the new name differs from the current
  and is banned.
- Error copy: `"That username isn't available"` (neutral — doesn't advertise the
  reason or the full list). Decided.

## Server enforcement

No edge function touches username writes, and a plain `CHECK` constraint is
**wrong here**: Postgres re-checks `CHECK` on every `UPDATE` of the row, so a
grandfathered `player` updating their avatar would fail. Grandfathering requires
comparing old vs new, which a constraint can't do.

→ A **`BEFORE INSERT OR UPDATE` trigger** on `public.profiles`:

- On `INSERT`: reject if `lower(new.username)` is banned.
- On `UPDATE`: reject only if the username **changed**
  (`lower(new.username) <> lower(old.username)`) and the new value is banned.
  An unchanged username (any other column changing) passes untouched → existing
  banned holders are grandfathered automatically.
- Raises with a clear `errcode` so the client can map it, though the client
  blocks first; this is the bypass backstop.

Migration `supabase/migrations/20261127120000_banned_usernames.sql` holds the
banned list (SQL array literal) + trigger function `profiles_reject_banned_username`
+ the trigger. The list is **duplicated** from `lib/username.ts` — same
client/server duplication the project already accepts for the edge-function
rules mirror. `dev/check-banned-usernames.ts` (added, decided) parses the array
out of the migration and asserts it equals `BANNED_USERNAMES`. Run manually with
`npx tsx dev/check-banned-usernames.ts` — same convention as the `dev/check-catan-*.ts`
and `dev/check-patch-notes.ts` scripts, which are run by hand, not folded into
`npm run check`.

Deploy with `npm run migrate`. No column changes, so `npm run types` is a no-op
here and is skipped.

## Grandfathering — no migration

**No data migration runs.** Nobody is renamed. Existing banned-name holders are
untouched; the trigger's old-vs-new check is the entire grandfather mechanism.

## Patch note

Player-facing entry in `lib/patchNotes/patch-notes.json`, e.g. *"Some reserved
words (resources, game terms) can no longer be used as usernames."*

## Decisions (resolved)

1. **Match rule** — exact, full-string, case-insensitive (not substring).
2. **Bonus/curse card names** — not reserved (out of scope).
3. **Error wording** — neutral `"That username isn't available"`.
4. **Sync check** — add `dev/check-banned-usernames.ts`, run manually (repo
   convention for `dev/check-*.ts`).
