// Reserved usernames nobody may register: pronouns, resources (+ common
// synonyms), `robber`, `player`, and game keywords. Matching is exact,
// full-string, case-insensitive — a reserved word is blocked only when it IS
// the whole username, never as a substring (`wheat` is blocked; `wheatfield`,
// `player1`, `the_robber` are not).
//
// Existing players who already hold one of these keep it — the grandfather rule
// lives in `bannedUsernameError`'s `currentUsername` guard (client) and in the
// old-vs-new comparison of the `profiles_reject_banned_username` trigger
// (server). **This list is mirrored in that trigger's migration
// (20261127120000_banned_usernames.sql); change both.** `dev/check-banned-usernames.ts`
// asserts they stay in sync. Full design: `.claude/specs/banned-usernames.md`.
//
// Words shorter than 3 chars (he/it/we/us/me/my/i) are omitted — the
// `^[A-Za-z0-9_]{3,20}$` format rule already makes them unregisterable.

const RESERVED = [
	// Pronouns
	'him',
	'his',
	'her',
	'hers',
	'she',
	'they',
	'them',
	'their',
	'theirs',
	'its',
	'our',
	'ours',
	'you',
	'your',
	'yours',
	// Player
	'player',
	'players',
	// Resources + common synonyms
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
	'lumber',
	'grain',
	'wool',
	'clay',
	// Robber
	'robber',
	// Game keywords (multi-word terms collapsed to their no-space form, the only
	// shape a username could take)
	'knight',
	'settlement',
	'settlements',
	'city',
	'cities',
	'road',
	'roads',
	'settler',
	'settlers',
	'catan',
	'settled',
	'monopoly',
	'victorypoint',
	'longestroad',
	'largestarmy',
	'roadbuilding',
	'yearofplenty',
	'devcard',
	'desert',
] as const

export const BANNED_USERNAMES: ReadonlySet<string> = new Set(RESERVED)

export function isUsernameBanned(value: string): boolean {
	return BANNED_USERNAMES.has(value.trim().toLowerCase())
}

// Inline error string for a reserved username, or null when it's allowed. A user
// keeping their existing name is never blocked, even if that name is reserved —
// pass their current username to grandfather it.
export function bannedUsernameError(
	value: string,
	currentUsername?: string | null
): string | null {
	const unchanged =
		currentUsername != null &&
		value.trim().toLowerCase() === currentUsername.trim().toLowerCase()
	if (!unchanged && isUsernameBanned(value)) {
		return "That username isn't available"
	}
	return null
}
