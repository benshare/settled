import {
	HEXES,
	PORT_SLOTS,
	RESOURCES,
	STANDARD_NUMBERS,
	STANDARD_RESOURCE_COUNTS,
	type Hex,
	type Resource,
} from './board'
import type { GameState, HexData, Port, Variant } from './types'

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

// Port kinds alternate 2:1 / 3:1 around the canonical ring. With 5 × 2:1 and
// 4 × 3:1 this lands 2:1s at even indices (0, 2, 4, 6, 8) and 3:1s at odd
// indices — meaning the first and last PORT_SLOTS are both 2:1, matching the
// standard Catan pattern of "alternating, with one adjacent pair of 2:1s."
// Only the 2:1 resource assignments are shuffled; all 3:1s are identical.
export function generatePorts(variant: Variant): Port[] {
	if (variant !== 'standard') {
		throw new Error(`unknown variant: ${variant}`)
	}
	const twoOnes = shuffle(RESOURCES) as Resource[]
	let twoIdx = 0
	return PORT_SLOTS.map((edge, i) => {
		if (i % 2 === 0) return { edge, kind: twoOnes[twoIdx++] }
		return { edge, kind: '3:1' as const }
	})
}

export function initialGameState(
	variant: Variant,
	playerCount: number
): GameState {
	const hexes = generateHexes(variant)
	const desert = HEXES.find((h) => hexes[h].resource === null)
	if (!desert) throw new Error('no desert in generated board')
	return {
		variant,
		hexes,
		vertices: {},
		edges: {},
		players: Array.from({ length: playerCount }, () => ({
			resources: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 },
		})),
		phase: { kind: 'initial_placement', round: 1, step: 'settlement' },
		robber: desert,
		ports: generatePorts(variant),
	}
}
