// Pure rules for the base-set bonuses. No I/O — callable from client UI and
// tests. The edge function re-implements the same logic against its
// duplicated constants. Data (title / description / icon) lives in
// `bonuses/bonuses.ts`; this file is the behaviour side.
//
// Parallel to `curses.ts`. Each bonus is inspected through small predicates
// so the existing rule helpers stay small and the per-bonus rules stay
// readable.

import type { HexNumber, Resource } from './board'
import type { BonusId, CurseId } from './bonuses'
import type { BuildKind } from './build'
import type { BankKind, GameState, PlayerState, ResourceHand } from './types'

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
