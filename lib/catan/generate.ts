import {
	HEXES,
	RESOURCES,
	STANDARD_NUMBERS,
	STANDARD_RESOURCE_COUNTS,
	type Hex,
	type Resource,
} from './board'
import type { GameState, HexData, Variant } from './types'

function shuffle<T>(xs: readonly T[]): T[] {
	const a = [...xs]
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

// 18 resource tiles + 1 desert = 19 total, matching HEXES.length.
function hexBag(variant: Variant): (Resource | null)[] {
	if (variant !== 'standard') {
		throw new Error(`unknown variant: ${variant}`)
	}
	const bag: (Resource | null)[] = [null]
	for (const r of RESOURCES) {
		for (let i = 0; i < STANDARD_RESOURCE_COUNTS[r]; i++) bag.push(r)
	}
	return bag
}

export function generateHexes(variant: Variant): Record<Hex, HexData> {
	const resources = shuffle(hexBag(variant))
	const numbers = shuffle(STANDARD_NUMBERS)

	const out = {} as Record<Hex, HexData>
	let numIdx = 0
	for (let i = 0; i < HEXES.length; i++) {
		const hex = HEXES[i]
		const resource = resources[i]
		if (resource === null) {
			out[hex] = { resource: null }
			continue
		}
		out[hex] = { resource, number: numbers[numIdx++] }
	}
	return out
}

export function initialGameState(
	variant: Variant,
	playerCount: number
): GameState {
	return {
		variant,
		hexes: generateHexes(variant),
		vertices: {},
		edges: {},
		players: Array.from({ length: playerCount }, () => ({
			resources: { wood: 0, wheat: 0, sheep: 0, brick: 0, ore: 0 },
		})),
		phase: { kind: 'initial_placement', round: 1, step: 'settlement' },
	}
}
