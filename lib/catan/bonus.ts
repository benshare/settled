// Pure rules for the bonuses (sets 1 and 2). No I/O — callable from client
// UI and tests. The edge function re-implements the same logic against its
// duplicated constants. Data (title / description / icon) lives in
// `bonuses/bonuses.ts`; this file is the behaviour side.
//
// Parallel to `curses.ts`. Each bonus is inspected through small predicates
// so the existing rule helpers stay small and the per-bonus rules stay
// readable.

import {
	HEXES,
	RESOURCES,
	adjacentEdges,
	adjacentHexes,
	adjacentVertices,
	edgeEndpoints,
	type Edge,
	type Hex,
	type HexNumber,
	type Resource,
	type Vertex,
} from './board'
import type { BonusId, CurseId } from './bonuses'
import type { BuildKind } from './build'
import {
	vertexStateOf,
	type BankKind,
	type DiceRoll,
	type GameState,
	type PlayerState,
	type ResourceHand,
} from './types'

export function bonusOf(
	state: GameState,
	playerIdx: number
): BonusId | undefined {
	return state.players[playerIdx]?.bonus
}

export function hasBonus(
	state: GameState,
	playerIdx: number,
	id: BonusId
): boolean {
	return bonusOf(state, playerIdx) === id
}

// --- Victory threshold ------------------------------------------------------
//
// thrill_seeker reduces the baseline by 1; ambition raises it by 1. By
// construction a single player carries at most one bonus + one curse, so
// both never apply at once — but if they ever did, ambition would win.
export function winVPThresholdFor(
	bonus: BonusId | undefined,
	curse: CurseId | undefined
): number {
	if (curse === 'ambition') return 11
	if (bonus === 'thrill_seeker') return 9
	return 10
}

// --- Underdog ---------------------------------------------------------------
//
// 1-pip number tokens (2, 12) and 2-pip tokens (3, 11) produce double for
// the cursed player. City multiplier still applies on top (a city on a
// 2-pip hex yields 4).
const UNDERDOG_NUMBERS = new Set<HexNumber>([2, 3, 11, 12])

export function underdogMultiplierFor(
	bonus: BonusId | undefined,
	hexNumber: HexNumber
): 1 | 2 {
	if (bonus === 'underdog' && UNDERDOG_NUMBERS.has(hexNumber)) return 2
	return 1
}

// --- Bricklayer -------------------------------------------------------------
//
// 4 Brick as a wild-alternative cost for roads, settlements, cities, and
// dev-card purchases. Build handlers accept a `use_bricklayer` flag; when
// set, gate on bonus === 'bricklayer' and charge this cost instead.
export const BRICKLAYER_COST: ResourceHand = {
	brick: 4,
	wood: 0,
	sheep: 0,
	wheat: 0,
	ore: 0,
}

export function bricklayerAltCost(
	bonus: BonusId | undefined
): ResourceHand | null {
	return bonus === 'bricklayer' ? BRICKLAYER_COST : null
}

export type BuildPurchaseKind = BuildKind | 'dev_card'

// --- Specialist -------------------------------------------------------------
//
// Declared resource lowers the effective bank ratio by 1 when that resource
// is on the give side. Minimum ratio stays at 2:1.
export function specialistGiveResource(p: PlayerState): Resource | null {
	if (p.bonus !== 'specialist') return null
	return p.specialistResource ?? null
}

export function effectiveBankRatio(
	kind: BankKind,
	specialistResource: Resource | null,
	giveResource: Resource
): number {
	const base =
		kind === '5:1' ? 5 : kind === '4:1' ? 4 : kind === '3:1' ? 3 : 2
	if (specialistResource && giveResource === specialistResource) {
		return Math.max(2, base - 1)
	}
	return base
}

// --- Hoarder ----------------------------------------------------------------
//
// 7-roll discards bypassed entirely. Integrated in robber.ts's
// requiredDiscards — this is a predicate used there.
export function exemptFromDiscard(p: PlayerState): boolean {
	return p.bonus === 'hoarder'
}

// --- Nomad ------------------------------------------------------------------
//
// Every 7-roll grants each nomad player 1 resource via a server-side d5.
// The roll is made inline in the edge function's handleRoll; this helper
// just picks the resource from a die face. Resources are: brick, wood,
// sheep, wheat, ore (canonical order).
export const NOMAD_RESOURCES: readonly Resource[] = [
	'brick',
	'wood',
	'sheep',
	'wheat',
	'ore',
]

export function nomadResourceForRoll(die: 1 | 2 | 3 | 4 | 5): Resource {
	return NOMAD_RESOURCES[die - 1]
}

// --- Carpenter --------------------------------------------------------------

export const CARPENTER_COST: ResourceHand = {
	brick: 0,
	wood: 4,
	sheep: 0,
	wheat: 0,
	ore: 0,
}

export function canBuyCarpenterVP(p: PlayerState): boolean {
	if (p.bonus !== 'carpenter') return false
	if (p.boughtCarpenterVPThisTurn) return false
	return p.resources.wood >= 4
}

export function carpenterVPOf(p: PlayerState): number {
	return p.carpenterVP ?? 0
}

// --- Veteran ----------------------------------------------------------------

export function tappedKnightsOf(p: PlayerState): number {
	return p.tappedKnights ?? 0
}

export function availableKnightsToTap(p: PlayerState): number {
	const played = p.devCardsPlayed.knight ?? 0
	return Math.max(0, played - tappedKnightsOf(p))
}

export function canTapKnight(p: PlayerState): boolean {
	return p.bonus === 'veteran' && availableKnightsToTap(p) > 0
}

// --- Gambler ----------------------------------------------------------------

export function canReroll(p: PlayerState): boolean {
	return p.bonus === 'gambler' && !p.rerolledThisTurn
}

// --- Aristocrat -------------------------------------------------------------
//
// Round-1 settlement placement grants starting resources for aristocrat
// players (standard rule grants only on round 2).
export function grantsStartingResourcesOnRound(
	bonus: BonusId | undefined,
	round: 1 | 2
): boolean {
	if (round === 2) return true
	return bonus === 'aristocrat'
}

// === Set 2 ==================================================================

// --- Populist ---------------------------------------------------------------
//
// Each settlement (NOT city/super_city — only plain settlements) whose total
// adjacent producing-hex pips sum to < 5 is worth +1 VP. Pip values follow
// classic Catan: 2/12 = 1, 3/11 = 2, 4/10 = 3, 5/9 = 4, 6/8 = 5. Desert hexes
// contribute 0.
export function pipCountFor(hexNumber: HexNumber): number {
	switch (hexNumber) {
		case 2:
		case 12:
			return 1
		case 3:
		case 11:
			return 2
		case 4:
		case 10:
			return 3
		case 5:
		case 9:
			return 4
		case 6:
		case 8:
			return 5
	}
}

// Pip total of a vertex's producing adjacent hexes. Robber presence is
// ignored — populist eligibility is a static board property, not a roll
// modifier.
export function pipsAtVertex(state: GameState, vertex: Vertex): number {
	let pips = 0
	for (const h of adjacentHexes[vertex]) {
		const hd = state.hexes[h]
		if (hd.resource === null) continue
		pips += pipCountFor(hd.number)
	}
	return pips
}

// VP awarded by the populist bonus to this player. Counts settlements only;
// upgrading to a city forfeits the populist VP for that vertex.
export function populistBonusVPFor(
	state: GameState,
	playerIdx: number
): number {
	if (state.players[playerIdx]?.bonus !== 'populist') return 0
	let n = 0
	for (const [vid, vs] of Object.entries(state.vertices)) {
		if (!vs?.occupied) continue
		if (vs.player !== playerIdx) continue
		if (vs.building !== 'settlement') continue
		if (pipsAtVertex(state, vid as Vertex) < 5) n += 1
	}
	return n
}

// --- Shepherd ---------------------------------------------------------------
//
// Sheep don't count toward the 7-roll discard hand-size threshold. The
// `shepherd_swap` action is a once-per-turn opt-in to swap 2 sheep for 2
// resources of choice.
export function shepherdEffectiveHandSize(p: PlayerState): number {
	let n = 0
	for (const r of RESOURCES) {
		if (p.bonus === 'shepherd' && r === 'sheep') continue
		n += p.resources[r]
	}
	return n
}

export function canShepherdSwap(p: PlayerState): boolean {
	if (p.bonus !== 'shepherd') return false
	if (p.shepherdUsedThisTurn) return false
	return p.resources.sheep >= 4
}

// --- Ritualist --------------------------------------------------------------
//
// Discard 2 cards (no city) or 3 cards (≥ 1 city OR super_city) to choose
// the dice value (2..6, 8..12 — never 7). No other player receives resources
// from this roll. Once per turn.
export function ritualCardCost(state: GameState, playerIdx: number): 2 | 3 {
	let cities = 0
	for (const v of Object.values(state.vertices)) {
		if (!v?.occupied || v.player !== playerIdx) continue
		if (v.building === 'city' || v.building === 'super_city') cities += 1
	}
	return cities >= 1 ? 3 : 2
}

export function isValidRitualTotal(total: number): boolean {
	if (!Number.isInteger(total)) return false
	if (total < 2 || total > 12) return false
	return total !== 7
}

export function canRitualRoll(state: GameState, playerIdx: number): boolean {
	const p = state.players[playerIdx]
	if (!p) return false
	if (p.bonus !== 'ritualist') return false
	if (p.ritualWasUsedThisTurn) return false
	const cost = ritualCardCost(state, playerIdx)
	let total = 0
	for (const r of RESOURCES) total += p.resources[r]
	return total >= cost
}

// Pick a deterministic dice split that sums to `total`. Used to backfill
// `phase.roll` when the ritualist chooses their roll. We pick the smallest
// `a` in 1..6 such that `total - a` is in 1..6.
export function dicePairForTotal(total: number): DiceRoll {
	for (let a = 1; a <= 6; a++) {
		const b = total - a
		if (b >= 1 && b <= 6) {
			return { a: a as DiceRoll['a'], b: b as DiceRoll['b'] }
		}
	}
	throw new Error(`no dice pair sums to ${total}`)
}

// --- Fortune Teller ---------------------------------------------------------
//
// After the active player's original roll resolves (including the 7-chain
// and curio/forger picks), if the original roll was doubles or 7, fire a
// bonus roll. Bonus rolls give resources only to the fortune_teller; chain
// on doubles/7; never trigger the robber chain or curio/forger.

// `total === 7` fires off the chain-trigger check too — not via dice equality
// but via the dice's sum. The active player gets the bonus chain after the
// 7-chain (or distribution) completes for the original roll.
export function fortuneTellerTriggersOn(
	bonus: BonusId | undefined,
	dice: DiceRoll
): boolean {
	if (bonus !== 'fortune_teller') return false
	if (dice.a === dice.b) return true
	if (dice.a + dice.b === 7) return true
	return false
}

// --- Metropolitan -----------------------------------------------------------

export const METROPOLITAN_SUPER_CITY_CAP = 1

export function superCityCount(state: GameState, playerIdx: number): number {
	let n = 0
	for (const v of Object.values(state.vertices)) {
		if (
			v?.occupied &&
			v.player === playerIdx &&
			v.building === 'super_city'
		)
			n += 1
	}
	return n
}

export function canBuildMoreSuperCities(
	state: GameState,
	playerIdx: number
): boolean {
	if (state.players[playerIdx]?.bonus !== 'metropolitan') return false
	return superCityCount(state, playerIdx) < METROPOLITAN_SUPER_CITY_CAP
}

// One-directional wheat → ore swap: the metropolitan player may pay up to
// `WHEAT_IN_CITY_COST` (=2) extra ore in place of the normal wheat cost.
// Returned `delta` is the count of wheat replaced by ore (0..2). The
// effective cost is `(2 − delta)` wheat + `(3 + delta)` ore.
const WHEAT_IN_CITY_COST = 2

export function metropolitanWheatSwapDelta(
	bonus: BonusId | undefined,
	requestedDelta: number
): number {
	if (bonus !== 'metropolitan') return 0
	if (!Number.isInteger(requestedDelta)) return 0
	if (requestedDelta < 0) return 0
	if (requestedDelta > WHEAT_IN_CITY_COST) return WHEAT_IN_CITY_COST
	return requestedDelta
}

// Final cost after applying the metropolitan wheat→ore swap. Other resources
// are unchanged from the standard cost. Used by both `build_city` and
// `build_super_city` cost paths.
export function metropolitanCityCost(
	bonus: BonusId | undefined,
	swapDelta: number
): ResourceHand {
	const delta = metropolitanWheatSwapDelta(bonus, swapDelta)
	return {
		brick: 0,
		wood: 0,
		sheep: 0,
		wheat: WHEAT_IN_CITY_COST - delta,
		ore: 3 + delta,
	}
}

// --- Curio Collector --------------------------------------------------------
//
// Whenever you gain ≥ 1 card from a 2 or 12 ORIGINAL roll, take 3 additional
// resource cards of your choice. Bonus rolls (fortune_teller) don't trigger.
export function curioCollectorTriggers(
	bonus: BonusId | undefined,
	total: number,
	gainedCount: number
): boolean {
	if (bonus !== 'curio_collector') return false
	if (total !== 2 && total !== 12) return false
	return gainedCount >= 1
}

export const CURIO_PICK_SIZE = 3

// --- Forger -----------------------------------------------------------------

export function forgerActive(p: PlayerState): boolean {
	return p.bonus === 'forger' && p.forgerToken !== undefined
}

// Hexes adjacent to `hex` (i.e. share at least one vertex). Used to gate
// the forger's pre-roll token move. The token's current hex is excluded.
export function hexesAdjacentTo(hex: Hex): Hex[] {
	const seen = new Set<Hex>()
	for (const v of adjacentVertices[hex]) {
		for (const h of adjacentHexes[v]) {
			if (h === hex) continue
			seen.add(h)
		}
	}
	return Array.from(seen)
}

export function canMoveForgerToken(p: PlayerState, target: Hex): boolean {
	if (p.bonus !== 'forger') return false
	if (p.forgerMovedThisTurn) return false
	if (!p.forgerToken) return false
	if (target === p.forgerToken) return false
	return hexesAdjacentTo(p.forgerToken).includes(target)
}

// All hexes by id — re-exported here because consumers of bonus.ts may
// otherwise have to dual-import board for forger UI helpers.
export const ALL_HEXES = HEXES

// --- Scout ------------------------------------------------------------------
//
// Buying a dev card may swap one of the standard cost resources for a
// duplicate of one of the others. `from` must be one of the three cost
// resources (sheep / wheat / ore); `to` must be one of the other two.
const SCOUT_COST_RESOURCES: readonly Resource[] = ['sheep', 'wheat', 'ore']

export function isValidScoutSwap(swap: {
	from: Resource
	to: Resource
}): boolean {
	if (!SCOUT_COST_RESOURCES.includes(swap.from)) return false
	if (!SCOUT_COST_RESOURCES.includes(swap.to)) return false
	if (swap.from === swap.to) return false
	return true
}

// Adjusted dev card cost when scout swaps `from` for `to`. Same shape
// as the standard cost (1 sheep + 1 wheat + 1 ore) with one removal +
// one duplicate.
export function scoutDevCardCost(swap?: {
	from: Resource
	to: Resource
}): ResourceHand {
	const out: ResourceHand = {
		brick: 0,
		wood: 0,
		sheep: 1,
		wheat: 1,
		ore: 1,
	}
	if (swap && isValidScoutSwap(swap)) {
		out[swap.from] -= 1
		out[swap.to] += 1
	}
	return out
}

// Sentinel for the maximum number of cards a scout can peek at when buying.
// Caller clamps to deck size.
export const SCOUT_PEEK_SIZE = 3

// --- Accountant -------------------------------------------------------------
//
// Liquidate one of your own pieces back into its full resource cost. Cannot
// liquidate something placed/bought this turn. Cannot liquidate a road that,
// removed, would split the player's road-network into multiple components
// such that two of their buildings are no longer road-connected.

export const ROAD_REFUND: ResourceHand = {
	brick: 1,
	wood: 1,
	sheep: 0,
	wheat: 0,
	ore: 0,
}
export const SETTLEMENT_REFUND: ResourceHand = {
	brick: 1,
	wood: 1,
	sheep: 1,
	wheat: 1,
	ore: 0,
}
export const CITY_REFUND: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 0,
	wheat: 2,
	ore: 3,
}
export const SUPER_CITY_REFUND: ResourceHand = CITY_REFUND
export const DEV_CARD_REFUND: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 1,
	wheat: 1,
	ore: 1,
}

// True if removing `edge` from the player's road network would split it
// into multiple components that disconnect at least two of the player's
// buildings (settlements / cities / super_cities). Used by the accountant
// liquidation gate.
//
// Algorithm: BFS over the player's roads minus the candidate edge. Vertices
// can be visited only via the player's roads; opponent buildings still block
// at interior vertices (matches the build.ts road-chain rule). All of the
// player's buildings must end up in the same BFS-reachable set seeded by any
// one of them.
export function roadRemovalSplitsBuildings(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const myBuildings: Vertex[] = []
	for (const [vid, vs] of Object.entries(state.vertices)) {
		if (vs?.occupied && vs.player === playerIdx)
			myBuildings.push(vid as Vertex)
	}
	if (myBuildings.length <= 1) return false

	const seed = myBuildings[0]
	const visited = new Set<Vertex>([seed])
	const stack: Vertex[] = [seed]
	while (stack.length > 0) {
		const v = stack.pop()!
		for (const e of adjacentEdges[v]) {
			if (e === edge) continue
			const es = state.edges[e]
			if (!es?.occupied || es.player !== playerIdx) continue
			const [a, b] = edgeEndpoints(e)
			const other = a === v ? b : a
			if (visited.has(other)) continue
			// Opponent building blocks chaining through `other`.
			const ovs = vertexStateOf(state, other)
			if (ovs.occupied && ovs.player !== playerIdx) continue
			visited.add(other)
			stack.push(other)
		}
	}
	return myBuildings.some((b) => !visited.has(b))
}

export const ACCOUNTANT_DEV_CARD_REFUND = DEV_CARD_REFUND
