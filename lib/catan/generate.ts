import {
	HEXES,
	PORT_SLOTS,
	RESOURCES,
	STANDARD_NUMBERS,
	STANDARD_RESOURCE_COUNTS,
	type Hex,
	type Resource,
} from './board'
import { BONUS_POOL, CURSE_POOL, type BonusId, type CurseId } from './bonuses'
import { buildInitialDevDeck } from './dev'
import {
	type GameConfig,
	type GameState,
	type HexData,
	type Phase,
	type Port,
	type SelectBonusHand,
	type Variant,
} from './types'

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

// Deal every player's select_bonus hand at once. Two bonuses + one curse per
// player, all drawn WITHOUT replacement across the whole table, so no bonus and
// no curse is ever offered to two players or twice to the same player. Bonuses
// come from the subset of BONUS_POOL whose `set` is in `bonusSets`, falling
// back to the full pool when the filter produces nothing. A pool smaller than
// the cards needed is reshuffled for further passes (the only case repeats can
// occur), so a tiny `bonusSets` config still deals a full table.
export function dealBonusHands(
	playerCount: number,
	bonusSets: readonly string[]
): Record<number, SelectBonusHand> {
	const filtered = BONUS_POOL.filter((b) => bonusSets.includes(b.set))
	const bonusPool = filtered.length > 0 ? filtered : BONUS_POOL
	const bonusBag = drawWithoutReplacement(bonusPool, playerCount * 2)
	const curseBag = drawWithoutReplacement(CURSE_POOL, playerCount)
	const hands: Record<number, SelectBonusHand> = {}
	for (let i = 0; i < playerCount; i++) {
		hands[i] = {
			offered: [
				bonusBag[i * 2].id as BonusId,
				bonusBag[i * 2 + 1].id as BonusId,
			],
			curse: curseBag[i].id as CurseId,
			chosen: null,
		}
	}
	return hands
}

// Draw `count` items from `pool` without replacement. When `count` exceeds the
// pool size the pool is reshuffled for further passes (so repeats are only
// possible across a pass boundary), so callers never deal short.
function drawWithoutReplacement<T>(pool: readonly T[], count: number): T[] {
	const out: T[] = []
	while (out.length < count) out.push(...shuffle(pool))
	return out.slice(0, count)
}

export function initialGameState(
	variant: Variant,
	playerCount: number,
	config: GameConfig
): GameState {
	const hexes = generateHexes(variant)
	const desert = HEXES.find((h) => hexes[h].resource === null)
	if (!desert) throw new Error('no desert in generated board')
	let phase: Phase
	if (config.bonuses) {
		phase = {
			kind: 'select_bonus',
			hands: dealBonusHands(playerCount, config.bonusSets),
		}
	} else {
		phase = { kind: 'initial_placement', round: 1, step: 'settlement' }
	}
	return {
		variant,
		hexes,
		vertices: {},
		edges: {},
		players: Array.from({ length: playerCount }, () => ({
			resources: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 },
			devCards: [],
			devCardsPlayed: {},
			playedDevThisTurn: false,
		})),
		phase,
		robber: desert,
		ports: generatePorts(variant),
		config,
		devDeck: config.devCards ? buildInitialDevDeck(Math.random) : [],
		largestArmy: null,
		longestRoad: null,
		round: 0,
	}
}
