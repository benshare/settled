// Pure helpers for the main-phase build actions (road, settlement, city).
// Costs, affordability, and validity of build targets for a given player.
// No I/O — usable from client UI (button gating + highlight pulses) or tests.
// The edge function re-implements the same logic against its duplicated
// adjacency constants.

import {
	RESOURCES,
	VERTICES,
	adjacentEdges,
	edgeEndpoints,
	neighborVertices,
	type Edge,
	type Vertex,
} from './board'
import {
	BRICKLAYER_COST,
	canBuildMoreSuperCities,
	metropolitanCityCost,
} from './bonus'
import type { BonusId } from './bonuses'
import {
	curseOf,
	maxRoadsFor,
	maxCitiesFor,
	maxSettlementsFor,
	roadCountFor,
	cityCountFor,
	settlementCountFor,
	canPlaceUnderPower,
	settlementKeepsYouthOK,
} from './curses'
import {
	edgeStateOf,
	vertexStateOf,
	type GameState,
	type PlayerState,
	type ResourceHand,
} from './types'

export type BuildKind = 'road' | 'settlement' | 'city'
// Includes the "dev_card" pseudo-kind for affordability checks since
// bricklayer applies uniformly to roads / settlements / cities / dev cards.
export type PurchaseKind = BuildKind | 'dev_card'

export const BUILD_COSTS: Record<BuildKind, ResourceHand> = {
	road: { brick: 1, wood: 1, sheep: 0, wheat: 0, ore: 0 },
	settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1, ore: 0 },
	city: { brick: 0, wood: 0, sheep: 0, wheat: 2, ore: 3 },
}

export function costSize(cost: ResourceHand): number {
	let n = 0
	for (const r of RESOURCES) n += cost[r]
	return n
}

export function canAfford(hand: ResourceHand, cost: ResourceHand): boolean {
	for (const r of RESOURCES) {
		if (hand[r] < cost[r]) return false
	}
	return true
}

export function deductHand(
	hand: ResourceHand,
	cost: ResourceHand
): ResourceHand {
	const out = { ...hand }
	for (const r of RESOURCES) out[r] = hand[r] - cost[r]
	return out
}

// The standard resource cost for a given purchase. `dev_card` pulls from
// dev.DEV_CARD_COST indirectly — we re-declare the shape here so the
// bricklayer helpers stay self-contained (no build ↔ dev circular dep).
const DEV_CARD_STANDARD_COST: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 1,
	wheat: 1,
	ore: 1,
}

export function standardCostOf(kind: PurchaseKind): ResourceHand {
	if (kind === 'dev_card') return DEV_CARD_STANDARD_COST
	return BUILD_COSTS[kind]
}

// Is the bricklayer alt cost (4 brick) available to this player for this
// purchase? Only when bonus is bricklayer and the hand has ≥ 4 brick.
export function canUseBricklayer(
	bonus: BonusId | undefined,
	hand: ResourceHand
): boolean {
	return bonus === 'bricklayer' && hand.brick >= BRICKLAYER_COST.brick
}

// Resolve which cost a player pays for a purchase. Prefers standard cost
// when affordable; falls back to bricklayer. Returns null if neither
// works. `useBricklayer` forces the alt cost (for an explicit player
// override); the caller is responsible for gating on bonus.
export function effectiveCostFor(
	p: PlayerState,
	kind: PurchaseKind,
	useBricklayer: boolean = false
): ResourceHand | null {
	const standard = standardCostOf(kind)
	if (useBricklayer) {
		return canUseBricklayer(p.bonus, p.resources) ? BRICKLAYER_COST : null
	}
	if (canAfford(p.resources, standard)) return standard
	if (canUseBricklayer(p.bonus, p.resources)) return BRICKLAYER_COST
	return null
}

// Can the player afford the purchase by any legal payment route?
export function canAffordPurchase(p: PlayerState, kind: PurchaseKind): boolean {
	return effectiveCostFor(p, kind) !== null
}

// Should the client request the bricklayer alt cost when submitting a
// build? True iff the standard cost is unaffordable but the alt is.
// Default = prefer-standard. UI that wants to force the alt can pass
// `true` directly to the store action.
export function shouldUseBricklayer(
	p: PlayerState,
	kind: PurchaseKind
): boolean {
	if (canAfford(p.resources, standardCostOf(kind))) return false
	return canUseBricklayer(p.bonus, p.resources)
}

// --- Roads ------------------------------------------------------------------

// An edge E connects to the player through endpoint V iff:
//   - V holds one of the player's own buildings (settlement/city); or
//   - V is empty AND one of V's other adjacent edges is one of the player's
//     own roads. An opponent building on V blocks the chain through V
//     (standard "no road through opponent settlement" rule).
function roadConnectsVia(
	state: GameState,
	playerIdx: number,
	edge: Edge,
	vertex: Vertex
): boolean {
	const vs = vertexStateOf(state, vertex)
	if (vs.occupied) return vs.player === playerIdx
	for (const e of adjacentEdges[vertex]) {
		if (e === edge) continue
		const es = edgeStateOf(state, e)
		if (es.occupied && es.player === playerIdx) return true
	}
	return false
}

export function isValidBuildRoadEdge(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	if (edgeStateOf(state, edge).occupied) return false
	if (!canBuildMoreRoads(state, playerIdx)) return false
	const [a, b] = edgeEndpoints(edge)
	return (
		roadConnectsVia(state, playerIdx, edge, a) ||
		roadConnectsVia(state, playerIdx, edge, b)
	)
}

// Supply + curse cap check. Returns false when the player already has as
// many roads on the board as their cap allows. Classic Catan is 15; the
// `compaction` curse lowers that to 7.
export function canBuildMoreRoads(
	state: GameState,
	playerIdx: number
): boolean {
	return (
		roadCountFor(state, playerIdx) < maxRoadsFor(curseOf(state, playerIdx))
	)
}

export function canBuildMoreSettlements(
	state: GameState,
	playerIdx: number
): boolean {
	const curse = curseOf(state, playerIdx)
	const cap = maxSettlementsFor(curse, cityCountFor(state, playerIdx))
	return settlementCountFor(state, playerIdx) < cap
}

export function canBuildMoreCities(
	state: GameState,
	playerIdx: number
): boolean {
	return (
		cityCountFor(state, playerIdx) < maxCitiesFor(curseOf(state, playerIdx))
	)
}

export function validBuildRoadEdges(
	state: GameState,
	playerIdx: number
): Edge[] {
	const out: Edge[] = []
	const seen = new Set<Edge>()
	// Iterate candidate edges via the player's owned roads + buildings so we
	// don't scan all 72 edges when most aren't touched by the player at all.
	for (const v of VERTICES) {
		const vs = vertexStateOf(state, v)
		const ownsVertex = vs.occupied && vs.player === playerIdx
		const hasAdjOwnRoad = adjacentEdges[v].some((e) => {
			const es = edgeStateOf(state, e)
			return es.occupied && es.player === playerIdx
		})
		if (!ownsVertex && !hasAdjOwnRoad) continue
		// If the vertex is an opponent's building, it blocks chaining through it.
		if (vs.occupied && vs.player !== playerIdx) continue
		for (const e of adjacentEdges[v]) {
			if (seen.has(e)) continue
			seen.add(e)
			if (isValidBuildRoadEdge(state, playerIdx, e)) out.push(e)
		}
	}
	return out
}

// --- Settlements ------------------------------------------------------------

export function isValidBuildSettlementVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (!canBuildMoreSettlements(state, playerIdx)) return false
	if (vertexStateOf(state, vertex).occupied) return false
	for (const n of neighborVertices[vertex]) {
		if (vertexStateOf(state, n).occupied) return false
	}
	if (!canPlaceUnderPower(state, playerIdx, vertex)) return false
	if (!settlementKeepsYouthOK(state, playerIdx, vertex)) return false
	return adjacentEdges[vertex].some((e) => {
		const es = edgeStateOf(state, e)
		return es.occupied && es.player === playerIdx
	})
}

export function validBuildSettlementVertices(
	state: GameState,
	playerIdx: number
): Vertex[] {
	return VERTICES.filter((v) =>
		isValidBuildSettlementVertex(state, playerIdx, v)
	)
}

// --- Cities -----------------------------------------------------------------

export function isValidBuildCityVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (!canBuildMoreCities(state, playerIdx)) return false
	const vs = vertexStateOf(state, vertex)
	if (
		!vs.occupied ||
		vs.player !== playerIdx ||
		vs.building !== 'settlement'
	) {
		return false
	}
	// Upgrading a settlement to a city adds +1 pip to each adjacent hex, so
	// the same power check used for fresh settlements applies.
	return canPlaceUnderPower(state, playerIdx, vertex)
}

export function validBuildCityVertices(
	state: GameState,
	playerIdx: number
): Vertex[] {
	return VERTICES.filter((v) => isValidBuildCityVertex(state, playerIdx, v))
}

// --- Super cities (metropolitan bonus only) --------------------------------

export function isValidBuildSuperCityVertex(
	state: GameState,
	playerIdx: number,
	vertex: Vertex
): boolean {
	if (!canBuildMoreSuperCities(state, playerIdx)) return false
	const vs = vertexStateOf(state, vertex)
	if (!vs.occupied || vs.player !== playerIdx || vs.building !== 'city') {
		return false
	}
	// Upgrading a city to super_city adds +1 pip per adjacent hex (city = 2,
	// super_city = 3) — same delta as settlement → city, so the existing
	// power-curse helper applies unchanged.
	return canPlaceUnderPower(state, playerIdx, vertex)
}

export function validBuildSuperCityVertices(
	state: GameState,
	playerIdx: number
): Vertex[] {
	return VERTICES.filter((v) =>
		isValidBuildSuperCityVertex(state, playerIdx, v)
	)
}

// Effective wheat / ore cost for a city or super_city after applying the
// metropolitan wheat → ore swap. `swapDelta` is the number of wheat the
// player wants to replace with ore (clamped to 0..2 by the helper). Other
// resources are unchanged. Used by both `build_city` and `build_super_city`.
export function metropolitanCostOf(
	p: PlayerState,
	swapDelta: number
): ResourceHand {
	return metropolitanCityCost(p.bonus, swapDelta)
}

export function canAffordMetropolitanCost(
	p: PlayerState,
	swapDelta: number
): boolean {
	return canAfford(p.resources, metropolitanCostOf(p, swapDelta))
}
