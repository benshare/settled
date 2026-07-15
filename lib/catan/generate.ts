import {
	boardFor,
	RESOURCES,
	type Board,
	type Hex,
	type HexNumber,
	type Resource,
} from './board'
import { BONUS_POOL, CURSE_POOL, type BonusId, type CurseId } from './bonuses'
import { buildInitialDevDeck } from './dev'
import {
	type GameConfig,
	type GameState,
	type HexData,
	type NumberLayout,
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

// Resource tiles + deserts, sized to the variant's board (19 standard / 30
// expanded). Desert count is whatever's left after the resource counts.
function hexBag(variant: Variant): (Resource | null)[] {
	const board = boardFor(variant)
	const bag: (Resource | null)[] = []
	for (const r of RESOURCES) {
		for (let i = 0; i < board.resourceCounts[r]; i++) bag.push(r)
	}
	const desertCount = board.hexes.length - bag.length
	for (let i = 0; i < desertCount; i++) bag.push(null)
	return bag
}

export function generateHexes(
	variant: Variant,
	layout: NumberLayout = 'spiral'
): Record<Hex, HexData> {
	const board = boardFor(variant)
	const resources = shuffle(hexBag(variant))
	// Number tokens per hex: shuffled bag for 'random', spiral sequence for
	// 'spiral'. Either way, resources/deserts are placed by the same shuffle.
	const numberFor =
		layout === 'random'
			? assignRandomNumbers(board, resources)
			: assignSpiralNumbers(board, resources)

	const out = {} as Record<Hex, HexData>
	for (let i = 0; i < board.hexes.length; i++) {
		const hex = board.hexes[i]
		const resource = resources[i]
		if (resource === null) {
			out[hex] = { resource: null }
			continue
		}
		out[hex] = { resource, number: numberFor.get(hex) as HexNumber }
	}
	return out
}

// Random layout: shuffle the token bag onto the resource hexes in board order.
function assignRandomNumbers(
	board: Board,
	resources: readonly (Resource | null)[]
): Map<Hex, HexNumber> {
	const numbers = shuffle(board.numbers)
	const out = new Map<Hex, HexNumber>()
	let numIdx = 0
	for (let i = 0; i < board.hexes.length; i++) {
		if (resources[i] !== null) out.set(board.hexes[i], numbers[numIdx++])
	}
	return out
}

// Spiral layout: walk the board's hexes in spiral order (outer ring inward,
// from a random corner + direction) and lay the fixed token sequence, skipping
// deserts. Resources are still placed randomly by board index.
function assignSpiralNumbers(
	board: Board,
	resources: readonly (Resource | null)[]
): Map<Hex, HexNumber> {
	const isDesert = new Map<Hex, boolean>()
	board.hexes.forEach((h, i) => isDesert.set(h, resources[i] === null))
	const order = spiralHexOrder(board)
	const seq = board.spiralNumberSequence
	const out = new Map<Hex, HexNumber>()
	let seqIdx = 0
	for (const hex of order) {
		if (isDesert.get(hex)) continue
		out.set(hex, seq[seqIdx++])
	}
	return out
}

// Unit-scale geometry for one hex, derived from the board's row layout (the
// same pointy-top, centered-rows geometry layout.ts renders): axial (q, r) for
// exact ring distance, pixel (cx, cy) for angular ordering.
type HexGeom = { hex: Hex; q: number; r: number; cx: number; cy: number }

const SQRT3 = Math.sqrt(3)

// Group the row-major hex list into rows by ID prefix (hex IDs are
// `<rowNumber><letter>`). Kept ID-derived rather than reading board.hexRows so
// this helper stays byte-identical to the edge-function mirror.
function boardRows(board: Board): Hex[][] {
	const rows: Hex[][] = []
	let lastRow = -1
	for (const hex of board.hexes) {
		const r = parseInt(hex, 10)
		if (r !== lastRow) {
			rows.push([])
			lastRow = r
		}
		rows[rows.length - 1].push(hex)
	}
	return rows
}

function hexGeometry(board: Board): HexGeom[] {
	const rows = boardRows(board)
	const maxW = Math.max(...rows.map((r) => r.length))
	const out: HexGeom[] = []
	rows.forEach((ids, r) => {
		const indent = (maxW - ids.length) / 2
		ids.forEach((hex, c) => {
			out.push({
				hex,
				q: indent + c - r / 2,
				r,
				cx: (indent + c + 0.5) * SQRT3,
				cy: r * 1.5 + 1,
			})
		})
	})
	return out
}

// Cube distance between two axial coords (rings from the board center).
function ringDistance(a: HexGeom, b: HexGeom): number {
	const ax = a.q
	const az = a.r
	const bx = b.q
	const bz = b.r
	return (
		(Math.abs(ax - bx) +
			Math.abs(az - bz) +
			Math.abs(-ax - az - (-bx - bz))) /
		2
	)
}

// All hexes ordered outer ring → center, walking each ring by angle. The start
// corner (angular offset) and direction (CW/CCW) are randomized per game.
function spiralHexOrder(board: Board): Hex[] {
	const geom = hexGeometry(board)
	const cxMean = geom.reduce((s, g) => s + g.cx, 0) / geom.length
	const cyMean = geom.reduce((s, g) => s + g.cy, 0) / geom.length
	const center = geom.reduce((best, g) => {
		const d = (g.cx - cxMean) ** 2 + (g.cy - cyMean) ** 2
		const bd = (best.cx - cxMean) ** 2 + (best.cy - cyMean) ** 2
		return d < bd ? g : best
	})
	const theta0 = Math.random() * 2 * Math.PI
	const dir = Math.random() < 0.5 ? 1 : -1
	const TWO_PI = 2 * Math.PI
	const angle = (g: HexGeom) => {
		const a = dir * Math.atan2(g.cy - cyMean, g.cx - cxMean) + theta0
		return ((a % TWO_PI) + TWO_PI) % TWO_PI
	}
	return [...geom]
		.sort((a, b) => {
			const rd = ringDistance(b, center) - ringDistance(a, center)
			if (rd !== 0) return rd
			return angle(a) - angle(b)
		})
		.map((g) => g.hex)
}

// Port kinds alternate 2:1 / 3:1 around the canonical ring. With 5 × 2:1 and
// 4 × 3:1 this lands 2:1s at even indices (0, 2, 4, 6, 8) and 3:1s at odd
// indices — meaning the first and last PORT_SLOTS are both 2:1, matching the
// standard Catan pattern of "alternating, with one adjacent pair of 2:1s."
// Only the 2:1 resource assignments are shuffled; all 3:1s are identical.
export function generatePorts(variant: Variant): Port[] {
	const board = boardFor(variant)
	if (variant === 'standard') {
		const twoOnes = shuffle(RESOURCES) as Resource[]
		let twoIdx = 0
		return board.portSlots.map((edge, i) => {
			if (i % 2 === 0) return { edge, kind: twoOnes[twoIdx++] }
			return { edge, kind: '3:1' as const }
		})
	}
	// Expanded (and any future variant): shuffle the fixed port-kind
	// composition onto the fixed slots. Positions stay put; kinds are dealt.
	const kinds = shuffle(board.portKinds)
	return board.portSlots.map((edge, i) => ({ edge, kind: kinds[i] }))
}

// Deal every player's select_bonus hand at once. Two bonuses + one curse per
// player, all drawn WITHOUT replacement across the whole table, so no bonus and
// no curse is ever offered to two players or twice to the same player. Bonuses
// come from the subset of BONUS_POOL whose `set` is in `bonusSets`, falling
// back to the full pool when the filter produces nothing.
export function dealBonusHands(
	playerCount: number,
	bonusSets: readonly string[]
): Record<number, SelectBonusHand> {
	const filtered = BONUS_POOL.filter((b) => bonusSets.includes(b.set))
	const bonusPool = filtered.length > 0 ? filtered : BONUS_POOL
	const drawBonus = dealer(bonusPool.map((b) => b.id as BonusId))
	const drawCurse = dealer(CURSE_POOL.map((c) => c.id as CurseId))
	const hands: Record<number, SelectBonusHand> = {}
	for (let i = 0; i < playerCount; i++) {
		const first = drawBonus()
		hands[i] = {
			offered: [first, drawBonus(first)],
			curse: drawCurse(),
			chosen: null,
		}
	}
	return hands
}

// Deals from a shuffled pass over `pool`, reshuffling only once the pass is
// exhausted — so a card repeats only after every other card has been dealt.
// `exclude` skips a card the caller is already holding, which keeps a player's
// two offered bonuses distinct even when the pool is smaller than the table
// needs (e.g. set 3 alone is 7 cards, and a 4-player table wants 8).
function dealer<T>(pool: readonly T[]): (exclude?: T) => T {
	if (pool.length < 2) throw new Error('pool too small to deal')
	let bag: T[] = []
	return (exclude?: T) => {
		if (bag.length === 0) bag = shuffle(pool)
		let idx = bag.findIndex((x) => x !== exclude)
		if (idx < 0) {
			bag = shuffle(pool)
			idx = bag.findIndex((x) => x !== exclude)
		}
		return bag.splice(idx, 1)[0]
	}
}

export function initialGameState(
	variant: Variant,
	playerCount: number,
	config: GameConfig
): GameState {
	const hexes = generateHexes(variant, config.numberLayout)
	// Expanded has two deserts; the robber starts on the first.
	const desert = boardFor(variant).hexes.find(
		(h) => hexes[h].resource === null
	)
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
