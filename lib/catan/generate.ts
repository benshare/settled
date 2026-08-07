import { DEFAULT_COLOR_ORDER } from './colors'
import {
	boardFor,
	RESOURCES,
	type Board,
	type Hex,
	type HexNumber,
	type PortKind,
	type Resource,
} from './board'
import {
	BONUS_POOL,
	CURSE_POOL,
	isBannedCombo,
	isBonusAvailableAt,
	isCurseAvailableAt,
	type BonusId,
	type CurseId,
} from './bonuses'
import { buildInitialDevDeck } from './dev'
import {
	clampCardCount,
	DEFAULT_CONFIG,
	gameSizeFor,
	handChosenCurse,
	needsBonusSelection,
	type GameConfig,
	type GameState,
	type HexData,
	type NumberLayout,
	type Phase,
	type PlayerState,
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
	// The expanded board carries two sheep 2:1 ports; reject any deal that
	// lands them next to each other among the 2:1 ports (3:1s ignored) around
	// the cyclic coastal ring, so wool access stays spread out.
	let kinds = shuffle(board.portKinds)
	while (sheepPortsAdjacent(kinds)) {
		kinds = shuffle(board.portKinds)
	}
	return board.portSlots.map((edge, i) => ({ edge, kind: kinds[i] }))
}

// True when two sheep 2:1 ports sit adjacent among the 2:1 ports (ignoring
// 3:1s) around the cyclic ring of port slots.
function sheepPortsAdjacent(kinds: readonly PortKind[]): boolean {
	const twoOnes = kinds.filter((k) => k !== '3:1')
	const sheepIdx = twoOnes.flatMap((k, i) => (k === 'sheep' ? [i] : []))
	if (sheepIdx.length < 2) return false
	const [a, b] = sheepIdx
	const gap = b - a
	return gap === 1 || gap === twoOnes.length - 1
}

// Deal every player's select_bonus hand at once. `bonusCount` bonuses +
// `curseCount` curses per player (1..3 each), all drawn WITHOUT replacement
// across the whole table, so a card repeats only once the pool is exhausted —
// which at the default counts means never (a 6-player table wants 12 bonuses
// and 6 curses). Bonuses come from the subset of BONUS_POOL whose `set` is in
// `bonusSets`.
//
// Curses go out first so that, when `bannedCombos` is on, each player's bonuses
// can be drawn from what's compatible with EVERY curse they hold (see
// BANNED_BONUSES_BY_CURSE) — whichever pair the player keeps is then legal by
// construction, with nothing to block at pick time.
//
// Cards withheld at this table size (`sizes.ts`, `available: false`) are
// dropped before the set filter. Both filters widen their net rather than
// failing to deal: an empty set intersection falls back to everything
// available, and a pool too small to deal from falls back to the full pool.
export function dealBonusHands(
	playerCount: number,
	bonusSets: readonly string[],
	bannedCombos = true,
	bonusCount = DEFAULT_CONFIG.bonusCount,
	curseCount = DEFAULT_CONFIG.curseCount
): Record<number, SelectBonusHand> {
	const bonusN = clampCardCount(bonusCount, DEFAULT_CONFIG.bonusCount)
	const curseN = clampCardCount(curseCount, DEFAULT_CONFIG.curseCount)
	const size = gameSizeFor(playerCount)
	const available = BONUS_POOL.filter((b) => isBonusAvailableAt(b.id, size))
	const inSets = available.filter((b) => bonusSets.includes(b.set))
	const bonusPool = pickPool(
		bonusN,
		inSets.map((b) => b.id),
		available.map((b) => b.id),
		BONUS_POOL.map((b) => b.id)
	)
	const cursePool = pickPool(
		curseN,
		CURSE_POOL.filter((c) => isCurseAvailableAt(c.id, size)).map(
			(c) => c.id
		),
		CURSE_POOL.map((c) => c.id)
	)
	const drawBonus = dealer(bonusPool)
	const drawCurse = dealer(cursePool)
	const hands: Record<number, SelectBonusHand> = {}
	for (let i = 0; i < playerCount; i++) {
		const curses: CurseId[] = []
		for (let n = 0; n < curseN; n++) {
			curses.push(drawCurse((c) => !curses.includes(c)))
		}
		const offered: BonusId[] = []
		for (let n = 0; n < bonusN; n++) {
			offered.push(
				drawBonus(
					(b) =>
						!offered.includes(b) &&
						(!bannedCombos ||
							curses.every((c) => !isBannedCombo(c, b)))
				)
			)
		}
		hands[i] = { offered, curses, chosen: null, chosenCurse: null }
	}
	return hands
}

// First candidate pool with enough cards to fill one hand, in order of
// preference. Every fallback ends at an unfiltered pool, so a filter can narrow
// the deal but never break it.
function pickPool<T>(need: number, ...candidates: T[][]): T[] {
	return (
		candidates.find((c) => c.length >= need) ??
		candidates[candidates.length - 1]
	)
}

// Deals from a shuffled pass over `pool`, reshuffling only once the pass is
// exhausted — so a card repeats only after every other card has been dealt.
// `accept` filters to the cards the caller can take (a card they aren't already
// holding, a bonus compatible with their curses), which keeps a hand's cards
// distinct even when the pool is smaller than the table needs (e.g. set 3 alone
// is 7 cards, and a 4-player table wants 8). When no card in the whole pool is
// acceptable the filter is ignored rather than failing to deal.
function dealer<T>(pool: readonly T[]): (accept?: (x: T) => boolean) => T {
	if (pool.length < 1) throw new Error('pool too small to deal')
	let bag: T[] = []
	return (accept?: (x: T) => boolean) => {
		if (bag.length === 0) bag = shuffle(pool)
		let idx = accept ? bag.findIndex(accept) : 0
		if (idx < 0 && accept) {
			bag = shuffle(pool)
			idx = bag.findIndex(accept)
		}
		if (idx < 0) idx = 0
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
	const hands = config.bonuses
		? dealBonusHands(
				playerCount,
				config.bonusSets,
				config.bannedCombos,
				config.bonusCount,
				config.curseCount
			)
		: null
	let players: PlayerState[] = Array.from({ length: playerCount }, () => ({
		resources: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 },
		devCards: [],
		devCardsPlayed: {},
		playedDevThisTurn: false,
	}))
	let phase: Phase
	if (hands && needsBonusSelection(config)) {
		phase = { kind: 'select_bonus', hands }
	} else {
		// Nothing to choose between — the dealt cards go straight onto the
		// players and the game opens on placement.
		if (hands) {
			players = players.map((p, i) => ({
				...p,
				bonus: hands[i].offered[0],
				curse: handChosenCurse(hands[i]) ?? undefined,
			}))
		}
		phase = { kind: 'initial_placement', round: 1, step: 'settlement' }
	}
	return {
		variant,
		hexes,
		vertices: {},
		edges: {},
		players,
		phase,
		// Nobody holds the turn while bonus selection runs; otherwise the game
		// opens on seat 0. Mirrors the insert in `handleRespond`.
		currentTurn: phase.kind === 'select_bonus' ? null : 0,
		robber: desert,
		ports: generatePorts(variant),
		config,
		// Only the check scripts reach this function — a real game's colors
		// are resolved from every player's ranking in `handleRespond`, so
		// there is nothing to resolve here. Default order keeps the seats
		// distinguishable.
		colors: DEFAULT_COLOR_ORDER.slice(0, playerCount),
		devDeck: config.devCards ? buildInitialDevDeck(Math.random) : [],
		largestArmy: null,
		longestRoad: null,
		round: 0,
	}
}
