// Pure rules for player colors: the six ids, the defensive reader for a
// profile's stored ranking, and the resolver that turns a table's rankings
// into one distinct color per seat. No I/O; callable from UI helpers and
// tests. Mirrored in the edge function, which runs the resolve at game start.
//
// The hex values live in `theme.ts` (keyed by these ids) so this file stays
// free of any dependency on the theme — `palette.ts` is where the two meet.

// Order matters twice over: it is the arrangement the settings screen opens
// on, and — as `games.colors` — the seat-index convention every game created
// before color preferences existed was backfilled with.
export const COLOR_IDS = [
	'red',
	'blue',
	'orange',
	'white',
	'green',
	'brown',
] as const

export type ColorId = (typeof COLOR_IDS)[number]

export const DEFAULT_COLOR_ORDER: readonly ColorId[] = COLOR_IDS

export const COLOR_LABELS: Record<ColorId, string> = {
	red: 'Red',
	blue: 'Blue',
	orange: 'Orange',
	white: 'White',
	green: 'Green',
	brown: 'Brown',
}

export function isColorId(value: unknown): value is ColorId {
	return (COLOR_IDS as readonly unknown[]).includes(value)
}

// `profiles.color_prefs` is unvalidated JSON, so this keeps the known ids in
// order and drops everything else. It deliberately does NOT pad to a full six:
// an empty result means "no preference", which `resolveColorPreferences`
// answers with a random color rather than with the default order.
export function parseColorPrefs(raw: unknown): ColorId[] {
	if (!Array.isArray(raw)) return []
	const out: ColorId[] = []
	for (const entry of raw) {
		if (isColorId(entry) && !out.includes(entry)) out.push(entry)
	}
	return out
}

// One distinct color per seat, same length and order as `prefs`.
//
// Naive by design: walk the rankings a depth at a time, hand each free color
// to its sole claimant (or to a random one of several), and let anyone whose
// choice at that depth is already gone fall through to the next depth. Seats
// still empty-handed at the end — no ranking, or one that ran out — draw from
// what's left at random.
//
// `rng` is injectable so `dev/check-catan-colors.ts` can assert exact
// outcomes; production passes `Math.random`.
export function resolveColorPreferences(
	prefs: readonly (readonly ColorId[])[],
	rng: () => number = Math.random
): ColorId[] {
	const assigned: (ColorId | null)[] = prefs.map(() => null)
	const taken = new Set<ColorId>()

	for (let depth = 0; depth < COLOR_IDS.length; depth++) {
		// A seat names at most one color per depth, so no seat can appear in
		// two claim lists here and none can win twice in a single pass.
		const claims = new Map<ColorId, number[]>()
		for (let seat = 0; seat < prefs.length; seat++) {
			if (assigned[seat] !== null) continue
			const want = prefs[seat][depth]
			if (want === undefined || taken.has(want)) continue
			const seats = claims.get(want)
			if (seats) seats.push(seat)
			else claims.set(want, [seat])
		}

		for (const [color, seats] of claims) {
			const winner =
				seats.length === 1
					? seats[0]
					: seats[Math.floor(rng() * seats.length)]
			assigned[winner] = color
			taken.add(color)
		}
	}

	const spare = shuffle(
		COLOR_IDS.filter((c) => !taken.has(c)),
		rng
	)
	for (let seat = 0; seat < assigned.length; seat++) {
		if (assigned[seat] === null)
			assigned[seat] = spare.pop() ?? COLOR_IDS[0]
	}

	return assigned as ColorId[]
}

// The colors of a game whose row predates `games.colors`, or whose value did
// not survive a round trip. The old convention was seat index into the palette
// order, which `COLOR_IDS` preserves.
export function parseGameColors(raw: unknown, playerCount: number): ColorId[] {
	const fallback = DEFAULT_COLOR_ORDER.slice(0, playerCount)
	if (!Array.isArray(raw) || raw.length < playerCount) return [...fallback]
	const parsed = raw.slice(0, playerCount)
	if (!parsed.every(isColorId)) return [...fallback]
	if (new Set(parsed).size !== parsed.length) return [...fallback]
	return parsed
}

function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
	const a = [...xs]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}
