// Pure rules for the bonuses (sets 1 and 2). No I/O — callable from client
// UI and tests. The edge function re-implements the same logic against its
// duplicated constants. Data (title / description / icon) lives in
// `bonuses/bonuses.ts`; this file is the behaviour side.
//
// Parallel to `curses.ts`. Each bonus is inspected through small predicates
// so the existing rule helpers stay small and the per-bonus rules stay
// readable.

import {
	boardFor,
	RESOURCES,
	edgeEndpoints,
	type Edge,
	type Hex,
	type HexNumber,
	type Resource,
	type Vertex,
} from './board'
import type { BonusId, CurseId, GamblerMode } from './bonuses'
import { bonusVariantFor } from './bonuses'
import type { BuildKind } from './build'
import {
	gameSizeFor,
	type BankKind,
	type DiceRoll,
	type GameSize,
	type GameState,
	type PlayerState,
	type ResourceHand,
	type Variant,
	type VertexState,
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
// is on the give side ("pay one fewer"), down to a floor of 1 — so a 2:1
// specialty port becomes a 1:1 trade.
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
		return Math.max(1, base - 1)
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

export function gamblerModeFor(size: GameSize): GamblerMode {
	return bonusVariantFor('gambler', size)?.mode ?? 'reroll'
}

// Reroll is the 3-4 / heads-up version of the bonus. At a 5-6 player table
// the gambler gets both rolls up front instead (`canChooseRoll`), so the
// reroll affordance is gone there.
export function canReroll(p: PlayerState, size: GameSize): boolean {
	if (gamblerModeFor(size) !== 'reroll') return false
	return p.bonus === 'gambler' && !p.rerolledThisTurn
}

export function canChooseRoll(p: PlayerState, size: GameSize): boolean {
	return p.bonus === 'gambler' && gamblerModeFor(size) === 'choose_two'
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
	for (const h of boardFor(state.variant).adjacentHexes[vertex]) {
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
// Flat where the table size says so (see `sizes.ts`), otherwise the
// city-dependent baseline: 2 before your first city, 3 after.
export function ritualCardCost(state: GameState, playerIdx: number): number {
	const flat = bonusVariantFor(
		'ritualist',
		gameSizeFor(state.players.length)
	)?.cardCost
	if (flat !== undefined) return flat
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
// What the fortune teller collects from each bonus roll is multiplied by
// this. The chain itself runs server-side (the edge function's
// `runFortuneTellerChain`), so this is the pure mirror of a rule applied
// there — keep the two in step.
export function fortuneTellerGainMultiplier(size: GameSize): number {
	return bonusVariantFor('fortune_teller', size)?.gainMultiplier ?? 1
}

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

// Where a forger's token sits. Seeded onto the player at bonus lock-in (the
// robber's starting hex — the desert), so the fallback only ever fires for a
// game whose forger was dealt before the token was seeded; there the token
// materialises on the robber's current hex the first time anything reads it.
export function forgerTokenHex(p: PlayerState, robberHex: Hex): Hex {
	return p.forgerToken ?? robberHex
}

// The move is compulsory: a forger cannot roll until the token has left the
// hex it's standing on. Every hex on both boards has at least two
// vertex-adjacent neighbours, so this can never deadlock.
export function mustMoveForgerToken(p: PlayerState): boolean {
	return p.bonus === 'forger' && !p.forgerMovedThisTurn
}

// Hexes adjacent to `hex` (i.e. share at least one vertex). Used to gate
// the forger's pre-roll token move. The token's current hex is excluded.
export function hexesAdjacentTo(hex: Hex, variant: Variant): Hex[] {
	const board = boardFor(variant)
	const seen = new Set<Hex>()
	for (const v of board.adjacentVertices[hex]) {
		for (const h of board.adjacentHexes[v]) {
			if (h === hex) continue
			seen.add(h)
		}
	}
	return Array.from(seen)
}

export function canMoveForgerToken(
	p: PlayerState,
	target: Hex,
	variant: Variant,
	robberHex: Hex
): boolean {
	if (p.bonus !== 'forger') return false
	if (p.forgerMovedThisTurn) return false
	const from = forgerTokenHex(p, robberHex)
	if (target === from) return false
	return hexesAdjacentTo(from, variant).includes(target)
}

// --- Scout ------------------------------------------------------------------
//
// Buying a dev card may swap one of the standard cost resources for a
// duplicate of one of the others. `from` must be one of the three cost
// resources (sheep / wheat / ore); `to` must be one of the other two.
const SCOUT_COST_RESOURCES: readonly Resource[] = ['sheep', 'wheat', 'ore']

export type ScoutSwap = { from: Resource; to: Resource }

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

// Every dev-card payment profile a scout can choose: the standard cost
// (`null` = no swap) followed by each valid single-resource swap. Stable
// order — standard first, then swaps in `from × to` order.
export function scoutSwapOptions(): (ScoutSwap | null)[] {
	const out: (ScoutSwap | null)[] = [null]
	for (const from of SCOUT_COST_RESOURCES) {
		for (const to of SCOUT_COST_RESOURCES) {
			if (from !== to) out.push({ from, to })
		}
	}
	return out
}

// The payment profiles a scout can actually afford out of `hand`, in the
// stable order above (standard first). Empty when no route is affordable.
export function affordableScoutSwaps(hand: ResourceHand): (ScoutSwap | null)[] {
	return scoutSwapOptions().filter((swap) => {
		const cost = scoutDevCardCost(swap ?? undefined)
		return SCOUT_COST_RESOURCES.every((r) => hand[r] >= cost[r])
	})
}

// True if a scout can buy a dev card by any swap route (or the standard cost).
export function canScoutAffordDevCard(hand: ResourceHand): boolean {
	return affordableScoutSwaps(hand).length > 0
}

// Sentinel for the maximum number of cards a scout can peek at when buying.
// Caller clamps to deck size.
export const SCOUT_PEEK_SIZE = 2

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

// True if the accountant may NOT liquidate `edge`: the player owns another
// road, or a building, at BOTH of its endpoints, so the road sits in the
// interior of their network. A road that dead-ends on at least one side —
// nothing else of theirs on that endpoint — is liquidatable. Only the player's
// own pieces count; an opponent's road or building at an endpoint is a
// dead-end for this network.
export function roadLiquidationBlocked(
	state: GameState,
	playerIdx: number,
	edge: Edge
): boolean {
	const board = boardFor(state.variant)
	const [a, b] = edgeEndpoints(edge)
	const endpointHeld = (v: Vertex): boolean => {
		const vs = state.vertices[v]
		if (vs?.occupied && vs.player === playerIdx) return true
		return board.adjacentEdges[v].some((e) => {
			if (e === edge) return false
			const es = state.edges[e]
			return !!es?.occupied && es.player === playerIdx
		})
	}
	return endpointHeld(a) && endpointHeld(b)
}

export const ACCOUNTANT_DEV_CARD_REFUND = DEV_CARD_REFUND

// === Set 3 ==================================================================

// --- Plutocrat --------------------------------------------------------------
//
// Every time the player gains ≥ 2 of a single resource from a roll, they gain
// 50% more of that resource (floor). Applied per-resource to the player's
// SUMMED roll gain (so 2→3, 3→4, 4→6, 5→7). Only the real roll distribution
// feeds this — the per-hex breakdown used by the forger stays on base gains.
export function plutocratGain(hand: ResourceHand): ResourceHand {
	const out = { ...hand }
	for (const r of RESOURCES) {
		if (out[r] >= 2) out[r] += Math.floor(out[r] / 2)
	}
	return out
}

// --- Merchant ---------------------------------------------------------------
//
// Any bank/port trade may carry a 1:1 side-conversion: pay `count` extra of
// the trade's single input resource to receive `count` resources of choice.
// The base trade must give exactly one resource type so "the input resource"
// is unambiguous.
export type MerchantAddon = {
	resource: Resource
	count: number
	take: ResourceHand
}

// The single resource on the give side, or null if the give is empty or mixes
// resource types.
export function singleGiveResource(give: ResourceHand): Resource | null {
	let found: Resource | null = null
	for (const r of RESOURCES) {
		if (give[r] > 0) {
			if (found) return null
			found = r
		}
	}
	return found
}

export function isValidMerchantAddon(
	give: ResourceHand,
	addon: MerchantAddon
): boolean {
	if (!Number.isInteger(addon.count) || addon.count < 1) return false
	const giveRes = singleGiveResource(give)
	if (giveRes === null || addon.resource !== giveRes) return false
	let takeTotal = 0
	for (const r of RESOURCES) {
		if (addon.take[r] < 0) return false
		takeTotal += addon.take[r]
	}
	return takeTotal === addon.count
}

// --- Fencer -----------------------------------------------------------------
//
// Reserve two edges at post_placement. No other player may build a road on a
// reserved edge; the fencer builds there for 1 card (Wood or Brick). The
// build-side validity (own token + connectivity) lives in build.ts to avoid a
// bonus ↔ build import cycle.
export const FENCE_TOKEN_COUNT = 2

export function fenceOwner(state: GameState, edge: Edge): number | null {
	const owner = state.fenceTokens?.[edge]
	return owner === undefined ? null : owner
}

// Is `edge` off-limits to `playerIdx` because someone ELSE has fenced it?
export function isFenceReservedAgainst(
	state: GameState,
	edge: Edge,
	playerIdx: number
): boolean {
	const owner = fenceOwner(state, edge)
	return owner !== null && owner !== playerIdx
}

export function fenceRoadCost(pay: 'wood' | 'brick'): ResourceHand {
	return {
		brick: pay === 'brick' ? 1 : 0,
		wood: pay === 'wood' ? 1 : 0,
		sheep: 0,
		wheat: 0,
		ore: 0,
	}
}

// --- Smith ------------------------------------------------------------------
//
// Brick ↔ Ore are interchangeable for builds, dev cards, and ports. Every
// standard build/dev cost has at most one of {brick, ore} non-zero, so a
// smith "swap" just shifts N units of that component onto the other resource.
type SmithResource = 'brick' | 'ore'

function smithComponent(cost: ResourceHand): SmithResource | null {
	if (cost.brick > 0) return 'brick'
	if (cost.ore > 0) return 'ore'
	return null
}

export function isValidSmithSwap(
	standardCost: ResourceHand,
	swap: number
): boolean {
	if (!Number.isInteger(swap) || swap < 0) return false
	const comp = smithComponent(standardCost)
	if (comp === null) return swap === 0
	return swap <= standardCost[comp]
}

// Effective cost after a smith moves `swap` units of the cost's brick/ore
// component onto the other resource. Non-smith or out-of-range → standard.
export function smithCostOf(
	bonus: BonusId | undefined,
	standardCost: ResourceHand,
	swap: number
): ResourceHand {
	if (bonus !== 'smith') return standardCost
	const comp = smithComponent(standardCost)
	if (comp === null) return standardCost
	const k = Math.max(0, Math.min(swap ?? 0, standardCost[comp]))
	const other: SmithResource = comp === 'brick' ? 'ore' : 'brick'
	const out = { ...standardCost }
	out[comp] = standardCost[comp] - k
	out[other] = standardCost[other] + k
	return out
}

// For a 2:1 specific port, a smith may satisfy a brick lock with ore (and
// vice versa). Generic 3:1/4:1 ports have no lock, so this is a no-op there.
export function smithPortResourceOk(
	locked: Resource | null,
	giveResource: Resource,
	isSmith: boolean
): boolean {
	if (locked === null || giveResource === locked) return true
	if (!isSmith) return false
	if (locked === 'brick' && giveResource === 'ore') return true
	if (locked === 'ore' && giveResource === 'brick') return true
	return false
}

// --- Investor ---------------------------------------------------------------
//
// Once total VP ≥ 3, set aside 3 of a resource for an investment token (max 6
// tokens / 18 cards). Each token pays 1 of its resource once the investor's
// roll resolves — after any owed discard, so the payout can't push them over
// the 7-card limit. Set-aside cards live in `player.investments`, immune to
// steal and excluded from the 7-discard hand size.
export const INVESTOR_ACTIVATE_VP = 3
export const INVESTOR_MAX_TOKENS = 6
export const INVEST_TRIO = 3

export function investorTokenCount(p: PlayerState): number {
	const inv = p.investments
	if (!inv) return 0
	let n = 0
	for (const r of RESOURCES) n += inv[r] ?? 0
	return n
}

// `totalVP` is passed in (not imported) to avoid a bonus ↔ dev import cycle.
// The VP gate, which a 5-6 player table drops to 0 (active immediately).
export function investorActivateVPFor(size: GameSize): number {
	return bonusVariantFor('investor', size)?.activateVP ?? INVESTOR_ACTIVATE_VP
}

export function canInvest(
	p: PlayerState,
	resource: Resource,
	totalVP: number,
	size: GameSize
): boolean {
	if (p.bonus !== 'investor') return false
	if (totalVP < investorActivateVPFor(size)) return false
	if (p.resources[resource] < INVEST_TRIO) return false
	return investorTokenCount(p) < INVESTOR_MAX_TOKENS
}

// Resources granted at the start of the investor's turn: 1 per token.
export function investorPayout(p: PlayerState): ResourceHand {
	const out: ResourceHand = { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
	const inv = p.investments
	if (!inv) return out
	for (const r of RESOURCES) out[r] = inv[r] ?? 0
	return out
}

// --- Magician ---------------------------------------------------------------
//
// After the magician's own roll resolves, discard N+1 cards to additionally
// receive production as if a number N away from the actual result had rolled.
// Direction is the magician's choice; the phantom number must land in 2..12.
// Baseline cost is the distance plus one card.
export const MAGIC_DISCARD_PLUS = 1

// May this player open a magician window on this roll? Everywhere but the
// two-player table that is just "are they the magician"; there they must also
// have skipped a turn since their last cast.
export function magicianCanCast(state: GameState, playerIdx: number): boolean {
	const p = state.players[playerIdx]
	if (p?.bonus !== 'magician') return false
	const size = gameSizeFor(state.players.length)
	if (!bonusVariantFor('magician', size)?.cooldown) return true
	if (p.lastMagicRound === undefined) return true
	return state.round > p.lastMagicRound + state.players.length
}

export function isValidMagicTarget(
	actualTotal: number,
	target: number
): boolean {
	if (!Number.isInteger(target)) return false
	if (target < 2 || target > 12) return false
	return target !== actualTotal
}

export function magicDiscardCount(
	actualTotal: number,
	target: number,
	size: GameSize
): number {
	const plus =
		bonusVariantFor('magician', size)?.discardPlus ?? MAGIC_DISCARD_PLUS
	return Math.abs(target - actualTotal) + plus
}

// --- Haunt ------------------------------------------------------------------
//
// Secretly pick two buildable vertices at post_placement. When a spot becomes
// unbuildable because a NEIGHBOR is built (the spot itself still empty), a
// 0-VP, non-interfering ghost settlement spawns there. A direct build on the
// spot yields no ghost.
export const HAUNT_SPOT_COUNT = 2

export function isGhost(vs: VertexState): boolean {
	return vs.occupied && vs.building === 'ghost'
}

// Spawn ghosts for every haunt player whose secret spots have become blocked,
// to a fixed point (a spawned ghost can block another spot). Pure: returns the
// updated state plus the list of spawns for event logging. Callers run this
// after any settlement build.
export function resolveHauntGhosts(state: GameState): {
	state: GameState
	spawned: { player: number; vertex: Vertex }[]
} {
	const board = boardFor(state.variant)
	let vertices = state.vertices
	let players = state.players
	const spawned: { player: number; vertex: Vertex }[] = []

	let changed = true
	while (changed) {
		changed = false
		for (let idx = 0; idx < players.length; idx++) {
			const p = players[idx]
			if (p.bonus !== 'haunt') continue
			const spots = p.hauntSpots
			if (!spots || spots.length === 0) continue
			const remaining: Vertex[] = []
			for (const spot of spots) {
				const vs = vertices[spot]
				if (vs?.occupied) continue // built on directly → drop, no ghost
				const blocked = board.neighborVertices[spot].some(
					(n) => !!vertices[n]?.occupied
				)
				if (!blocked) {
					remaining.push(spot)
					continue
				}
				vertices = {
					...vertices,
					[spot]: {
						occupied: true,
						player: idx,
						building: 'ghost',
						placedTurn: state.round,
					},
				}
				spawned.push({ player: idx, vertex: spot })
				changed = true
			}
			if (remaining.length !== spots.length) {
				players = players.map((pp, i) =>
					i === idx ? { ...pp, hauntSpots: remaining } : pp
				)
				changed = true
			}
		}
	}

	if (vertices === state.vertices && players === state.players) {
		return { state, spawned }
	}
	return { state: { ...state, vertices, players }, spawned }
}
