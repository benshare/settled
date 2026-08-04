// Runtime checks for lib/catan/colors.ts. Run with
// `npx tsx dev/check-catan-colors.ts`. Exits 0 on success; throws with a
// specific message on the first failure.

import {
	COLOR_IDS,
	DEFAULT_COLOR_ORDER,
	parseColorPrefs,
	parseGameColors,
	resolveColorPreferences,
	type ColorId,
} from '../lib/catan/colors'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

// A deterministic rng over a fixed sequence, cycling so a caller can't run it
// dry. `seeded([0])` always picks the first of any tied set, `seeded([0.999])`
// always the last.
function seeded(values: number[]): () => number {
	let i = 0
	return () => values[i++ % values.length]
}

// --- parseColorPrefs ---------------------------------------------------------

assert(parseColorPrefs(undefined).length === 0, 'undefined prefs → []')
assert(parseColorPrefs(null).length === 0, 'null prefs → []')
assert(parseColorPrefs('red').length === 0, 'non-array prefs → []')
assert(parseColorPrefs([]).length === 0, 'empty prefs → []')
assert(
	parseColorPrefs(['purple', 'red', 7, null]).join() === 'red',
	'unknown entries are dropped, known ones kept in order'
)
assert(
	parseColorPrefs(['red', 'red', 'blue']).join() === 'red,blue',
	'duplicates are dropped'
)
assert(
	parseColorPrefs(['blue', 'red']).join() === 'blue,red',
	'order is preserved as given'
)
// The load-bearing one: a short list must NOT be padded, or "no preference"
// silently becomes "the default order" and every unset player gets red/blue/…
assert(
	parseColorPrefs(['green']).length === 1,
	'a partial ranking stays partial — parseColorPrefs never pads'
)

// --- resolveColorPreferences: shape -----------------------------------------

for (let n = 1; n <= 6; n++) {
	const prefs: ColorId[][] = Array.from({ length: n }, () => [])
	const out = resolveColorPreferences(prefs)
	assert(out.length === n, `${n} seats → ${n} colors`)
	assert(new Set(out).size === n, `${n} seats → all distinct`)
	assert(
		out.every((c) => (COLOR_IDS as readonly string[]).includes(c)),
		`${n} seats → all valid ids`
	)
}

// --- resolveColorPreferences: uncontested choices are honored ----------------

{
	const out = resolveColorPreferences([
		['green'],
		['brown'],
		['white'],
		['orange'],
	])
	assert(
		out.join() === 'green,brown,white,orange',
		`uncontested first choices are all honored (got ${out.join()})`
	)
}

// A full ranking with no conflicts at any depth resolves to everyone's first.
{
	const rankings: ColorId[][] = [
		['brown', 'green', 'white', 'orange', 'blue', 'red'],
		['green', 'brown', 'white', 'orange', 'blue', 'red'],
		['white', 'green', 'brown', 'orange', 'blue', 'red'],
	]
	const out = resolveColorPreferences(rankings)
	assert(
		out.join() === 'brown,green,white',
		`distinct first choices all win (got ${out.join()})`
	)
}

// --- resolveColorPreferences: conflicts ------------------------------------

// Two seats want blue. Exactly one gets it; the loser falls through to its
// next FREE choice — not merely its next choice.
{
	// Seat 0: blue, then red. Seat 1: blue, then red (taken by seat 2), then
	// green. Seat 2: red.
	const rankings: ColorId[][] = [
		['blue', 'orange'],
		['blue', 'red', 'green'],
		['red'],
	]
	const first = resolveColorPreferences(rankings, seeded([0]))
	const last = resolveColorPreferences(rankings, seeded([0.999]))

	assert(first[2] === 'red', 'seat 2 takes its uncontested red either way')
	assert(last[2] === 'red', 'seat 2 takes its uncontested red either way')

	assert(first[0] === 'blue', 'first-claimant rng gives blue to seat 0')
	assert(
		first[1] === 'green',
		`seat 1 skips red (taken) and lands on green (got ${first[1]})`
	)

	assert(last[1] === 'blue', 'last-claimant rng gives blue to seat 1')
	assert(
		last[0] === 'orange',
		`seat 0 falls through to orange (got ${last[0]})`
	)
}

// Six seats with the identical full ranking still get a full permutation.
{
	const same = [...DEFAULT_COLOR_ORDER] as ColorId[]
	const out = resolveColorPreferences(
		Array.from({ length: 6 }, () => same),
		seeded([0.5, 0.1, 0.9, 0.3, 0.7])
	)
	assert(out.length === 6, 'six identical rankings → six colors')
	assert(
		new Set(out).size === 6,
		`six identical rankings → a full permutation (got ${out.join()})`
	)
}

// --- resolveColorPreferences: no preference is genuinely random -------------

// The guard against empty quietly collapsing back to the default order: over
// many runs a seat with no ranking must see more than one color.
{
	const seen = new Set<ColorId>()
	for (let i = 0; i < 200; i++) {
		seen.add(resolveColorPreferences([[], [], []])[0])
	}
	assert(
		seen.size > 1,
		`an empty ranking draws at random, not from the default order (only saw ${[...seen].join()})`
	)
}

// A partial ranking is honored as far as it goes, and random past that.
{
	const seen = new Set<ColorId>()
	for (let i = 0; i < 200; i++) {
		const out = resolveColorPreferences([['white'], []])
		assert(out[0] === 'white', 'the stated preference is always honored')
		seen.add(out[1])
	}
	assert(seen.size > 1, 'the unranked seat past the preference varies')
	assert(!seen.has('white'), 'the unranked seat never collides')
}

// A ranking that runs out because everything in it was taken still resolves.
{
	const out = resolveColorPreferences([['red'], ['red'], ['red']])
	assert(new Set(out).size === 3, 'three seats wanting one color all resolve')
	assert(out.filter((c) => c === 'red').length === 1, 'only one gets red')
}

// --- determinism -------------------------------------------------------------

{
	const rankings: ColorId[][] = [['blue'], ['blue'], ['blue'], []]
	const a = resolveColorPreferences(rankings, seeded([0.2, 0.6, 0.4]))
	const b = resolveColorPreferences(rankings, seeded([0.2, 0.6, 0.4]))
	assert(a.join() === b.join(), 'the same seed gives the same assignment')
}

// --- parseGameColors ---------------------------------------------------------

assert(
	parseGameColors(['green', 'red'], 2).join() === 'green,red',
	'a well-formed stored assignment is returned as-is'
)
assert(
	parseGameColors(['green', 'red', 'blue'], 2).join() === 'green,red',
	'a longer stored array is truncated to the seat count'
)
// Every fallback below is the pre-preferences convention: seat index into the
// palette order.
assert(
	parseGameColors([], 3).join() === 'red,blue,orange',
	'an empty column falls back to the old seat-index convention'
)
assert(
	parseGameColors(null, 2).join() === 'red,blue',
	'a null column falls back'
)
assert(
	parseGameColors(['green'], 3).join() === 'red,blue,orange',
	'a too-short column falls back rather than leaving a seat colorless'
)
assert(
	parseGameColors(['green', 'mauve'], 2).join() === 'red,blue',
	'an unknown id falls back'
)
assert(
	parseGameColors(['green', 'green'], 2).join() === 'red,blue',
	'a duplicated color falls back — two seats must never share'
)

console.log('check-catan-colors: all checks passed')
