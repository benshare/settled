// Pure rules for the base-set curses. No I/O — callable from client UI and
// tests. The edge function re-implements the same logic against its
// duplicated constants. Data (title / description / icon) lives in
// `bonuses/curses.ts`; this file is the behaviour side.
//
// Each curse is inspected through small predicates so the existing validity
// helpers (isValidBuildRoadEdge, isValidBuildSettlementVertex, …,
// requiredDiscards, recomputeLongestRoad, recomputeLargestArmy, findWinner)
// stay small and the per-curse rules stay readable.

import {
	HEXES,
	RESOURCES,
	adjacentHexes,
	adjacentVertices,
	type Hex,
	type Resource,
	type Vertex,
} from './board'
import type { CurseId, IoniconName } from './bonuses'
import { curseById } from './bonuses'
import type { BuildKind } from './build'
import type { GameState, PlayerState } from './types'
import { vertexStateOf } from './types'

export function curseOf(
	state: GameState,
	playerIdx: number
): CurseId | undefined {
	return state.players[playerIdx]?.curse
}

export function hasCurse(
	state: GameState,
	playerIdx: number,
	id: CurseId
): boolean {
	return curseOf(state, playerIdx) === id
}

// --- Building caps ----------------------------------------------------------
//
// Supply-based defaults mirror the classic Catan limits (15 roads, 5
// settlements, 4 cities per player). Curse-affected values override.

export function maxRoadsFor(curse: CurseId | undefined): number {
	return curse === 'compaction' ? 7 : 15
}

export function maxCitiesFor(curse: CurseId | undefined): number {
	return curse === 'decadence' ? 2 : 4
}

// Elitism: 3 settlements on the board while the player has 0 cities, 2 once
// they've built their first city. Live check — if a city ever disappears the
// cap relaxes automatically (future-proof against hypothetical demotions).
export function maxSettlementsFor(
	curse: CurseId | undefined,
	currentCities: number
): number {
	if (curse === 'elitism') return currentCities >= 1 ? 2 : 3
	return 5
}

export function winVPThresholdFor(curse: CurseId | undefined): number {
	return curse === 'ambition' ? 11 : 10
}

export function winRoadsRequiredFor(curse: CurseId | undefined): number {
	return curse === 'nomadism' ? 11 : 0
}

// --- Piece counts (live) ----------------------------------------------------

export function roadCountFor(state: GameState, playerIdx: number): number {
	let n = 0
	for (const e of Object.values(state.edges)) {
		if (e?.occupied && e.player === playerIdx) n++
	}
	return n
}

export function settlementCountFor(
	state: GameState,
	playerIdx: number
): number {
	let n = 0
	for (const v of Object.values(state.vertices)) {
		if (
			v?.occupied &&
			v.player === playerIdx &&
			v.building === 'settlement'
		) {
			n++
		}
	}
	return n
}

export function cityCountFor(state: GameState, playerIdx: number): number {
	let n = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx && v.building === 'city') n++
	}
	return n
}

// --- Asceticism (effective counts) ------------------------------------------

export function effectiveLongestRoadLength(
	state: GameState,
	playerIdx: number,
	rawLength: number
): number {
	if (curseOf(state, playerIdx) === 'asceticism')
		return Math.max(0, rawLength - 2)
	return rawLength
}

export function effectiveKnightsPlayed(
	curse: CurseId | undefined,
	rawCount: number
): number {
	if (curse === 'asceticism') return Math.max(0, rawCount - 1)
	return rawCount
}

// --- Age --------------------------------------------------------------------

export const AGE_CARD_LIMIT = 6

// Is the player allowed to pay `costSize` more cards this turn under the
// `age` curse? Non-cursed: always. Cursed: existing spend + new cost ≤ 6.
export function canSpendUnderAge(p: PlayerState, costSize: number): boolean {
	if (p.curse !== 'age') return true
	const spent = p.cardsSpentThisTurn ?? 0
	return spent + costSize <= AGE_CARD_LIMIT
}

// Cost size for each build kind, used by age enforcement in handlers and
// curseBuildReason. Values are baked into Catan rules.
export const BUILD_COST_SIZES: Record<BuildKind | 'dev_card', number> = {
	road: 2,
	settlement: 4,
	city: 5,
	dev_card: 3,
}

// --- Power ------------------------------------------------------------------

export const POWER_HEX_LIMIT = 3
export const POWER_MAX_HEXES = 2

// Sum of pips contributed to a single hex by a player's own buildings on that
// hex's vertices. Settlement = 1, city = 2. Robber presence is ignored; this
// is a building-distribution metric, not a production metric.
export function hexPowerForPlayer(
	state: GameState,
	playerIdx: number,
	hex: Hex
): number {
	let power = 0
	for (const v of adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied || vs.player !== playerIdx) continue
		power += vs.building === 'city' ? 2 : 1
	}
	return power
}

export function countHexesAtMaxPower(
	state: GameState,
	playerIdx: number
): number {
	let n = 0
	for (const h of HEXES) {
		if (hexPowerForPlayer(state, playerIdx, h) === POWER_HEX_LIMIT) n++
	}
	return n
}

// Would placing a new building that adds +1 pip to each adjacent hex keep
// the cursed player inside the Power caps? Both a fresh settlement (0 → 1)
// and a city upgrade (1 → 2) contribute +1 per adjacent hex, so the same
// check applies to either.
export function canPlaceUnderPower(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (curseOf(state, playerIdx) !== 'power') return true
	const hexes = adjacentHexes[vertex]
	let hexesAtMax = countHexesAtMaxPower(state, playerIdx)
	for (const h of hexes) {
		const before = hexPowerForPlayer(state, playerIdx, h)
		const after = before + 1
		if (after > POWER_HEX_LIMIT) return false
		if (after === POWER_HEX_LIMIT && before < POWER_HEX_LIMIT) {
			hexesAtMax += 1
			if (hexesAtMax > POWER_MAX_HEXES) return false
		}
	}
	return true
}

// --- Youth ------------------------------------------------------------------

// Distinct producing resources touched by the player's settlements or cities.
// Desert hexes are excluded (null resource).
export function touchedResources(
	state: GameState,
	playerIdx: number
): Set<Resource> {
	const out = new Set<Resource>()
	for (const [vid, vs] of Object.entries(state.vertices)) {
		if (!vs?.occupied || vs.player !== playerIdx) continue
		for (const h of adjacentHexes[vid as Vertex]) {
			const hd = state.hexes[h]
			if (hd.resource !== null) out.add(hd.resource)
		}
	}
	return out
}

// Would a settlement at `vertex` push the cursed player's touched-resource
// set to all 5? Non-cursed: always allowed.
export function settlementKeepsYouthOK(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (curseOf(state, playerIdx) !== 'youth') return true
	const touched = touchedResources(state, playerIdx)
	if (touched.size === RESOURCES.length) return false
	const next = new Set(touched)
	for (const h of adjacentHexes[vertex]) {
		const hd = state.hexes[h]
		if (hd.resource !== null) next.add(hd.resource)
	}
	return next.size < RESOURCES.length
}

// --- UI hints ---------------------------------------------------------------

export type CurseHint = {
	id: CurseId
	title: string
	icon: IoniconName
	reason: string
}

// Why the player's curse blocks the given build kind right now, or null if
// it doesn't. Used by the build-bar + placement UIs to surface a "disabled
// because of your curse" signal (icon badge + tooltip). `'dev_card'` is
// treated as a card-spending build (age caps it).
export function curseBuildReason(
	state: GameState,
	playerIdx: number,
	kind: BuildKind | 'dev_card'
): CurseHint | null {
	const curse = curseOf(state, playerIdx)
	if (!curse) return null
	const data = curseById(curse)
	if (!data) return null
	const base = { id: curse, title: data.title, icon: data.icon }

	if (curse === 'compaction' && kind === 'road') {
		if (roadCountFor(state, playerIdx) >= maxRoadsFor(curse)) {
			return {
				...base,
				reason: `${data.title}: you already have ${maxRoadsFor(curse)} roads.`,
			}
		}
	}
	if (curse === 'decadence' && kind === 'city') {
		if (cityCountFor(state, playerIdx) >= maxCitiesFor(curse)) {
			return {
				...base,
				reason: `${data.title}: you already have ${maxCitiesFor(curse)} cities.`,
			}
		}
	}
	if (curse === 'elitism' && kind === 'settlement') {
		const cities = cityCountFor(state, playerIdx)
		const cap = maxSettlementsFor(curse, cities)
		if (settlementCountFor(state, playerIdx) >= cap) {
			return {
				...base,
				reason: `${data.title}: you already have ${cap} settlements on the board.`,
			}
		}
	}
	if (curse === 'age') {
		const p = state.players[playerIdx]
		if (p && !canSpendUnderAge(p, BUILD_COST_SIZES[kind])) {
			const spent = p.cardsSpentThisTurn ?? 0
			const remaining = Math.max(0, AGE_CARD_LIMIT - spent)
			return {
				...base,
				reason: `${data.title}: only ${remaining} of your ${AGE_CARD_LIMIT} cards left to spend this turn.`,
			}
		}
	}
	// Power + youth apply per-location, so the build-bar hint fires only when
	// the player is already at the board-wide "nothing new will work" state:
	// power has saturated its two max-power hexes, or youth has buildings on
	// all 4 remaining resource types (any settlement would touch the 5th and
	// fail). These are conservative signals — location-specific blocks still
	// surface via the disabled highlight dots on the board.
	if (
		curse === 'power' &&
		(kind === 'settlement' || kind === 'city') &&
		countHexesAtMaxPower(state, playerIdx) >= POWER_MAX_HEXES
	) {
		return {
			...base,
			reason: `${data.title}: you already have ${POWER_MAX_HEXES} hexes at ${POWER_HEX_LIMIT} power.`,
		}
	}
	if (
		curse === 'youth' &&
		kind === 'settlement' &&
		touchedResources(state, playerIdx).size >= 4
	) {
		return {
			...base,
			reason: `${data.title}: building on any new resource type would complete all five.`,
		}
	}
	return null
}
