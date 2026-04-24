// Pure rules for development cards: buy/play validity, deck construction,
// Largest Army, and victory-point totals. No I/O; callable from UI helpers
// and tests. The edge function re-implements the same logic against its
// duplicated constants.

import { bonusOf, carpenterVPOf, winVPThresholdFor } from './bonus'
import { canAffordPurchase, validBuildRoadEdges } from './build'
import {
	curseOf,
	effectiveKnightsPlayed,
	roadCountFor,
	winRoadsRequiredFor,
} from './curses'
import { DEV_CARD_POOL, DEV_DECK_COMPOSITION, type DevCardId } from './devCards'
import type { GameState, PlayerState, ResourceHand } from './types'

export const DEV_CARD_COST: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 1,
	wheat: 1,
	ore: 1,
}

// Fisher–Yates shuffle of the classic 25-card Catan dev deck. `rng` returns
// a value in [0, 1); passing a seeded RNG makes the result deterministic
// (tests use this; the edge function passes Math.random).
export function buildInitialDevDeck(rng: () => number): DevCardId[] {
	const deck: DevCardId[] = []
	for (const card of DEV_CARD_POOL) {
		const n = DEV_DECK_COMPOSITION[card.id]
		for (let i = 0; i < n; i++) deck.push(card.id)
	}
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[deck[i], deck[j]] = [deck[j], deck[i]]
	}
	return deck
}

export function canBuyDevCard(
	state: GameState,
	meIdx: number,
	currentTurn: number
): boolean {
	if (!state.config.devCards) return false
	if (state.phase.kind !== 'main') return false
	if (currentTurn !== meIdx) return false
	if (state.devDeck.length === 0) return false
	return canAffordPurchase(state.players[meIdx], 'dev_card')
}

// Dev-card entries in `player.devCards` that are legal to play right now.
// Excludes VP (passive, never played), entries bought this turn, and all
// entries if the player already played one this turn. The caller still
// checks phase/turn — this is just a hand-side predicate.
export function playableCards(player: PlayerState, round: number): DevCardId[] {
	if (player.playedDevThisTurn) return []
	const ids: DevCardId[] = []
	for (const entry of player.devCards) {
		if (entry.id === 'victory_point') continue
		if (entry.purchasedTurn >= round) continue
		ids.push(entry.id)
	}
	return ids
}

export function knightsPlayed(p: PlayerState): number {
	return p.devCardsPlayed.knight ?? 0
}

// Strict-majority Largest Army holder: owner with the most played knights
// (≥ 3). Returns the existing holder if no one newly qualifies or the lead
// is tied. Pass the post-play state for knight plays.
//
// The `asceticism` curse reduces the cursed player's effective knight count
// by 1, so they need one extra knight in hand compared to the baseline.
export function recomputeLargestArmy(state: GameState): number | null {
	let bestIdx: number | null = null
	let bestCount = 2 // must be strictly > 2 to qualify (≥ 3 effective knights)
	state.players.forEach((p, i) => {
		const k = effectiveKnightsPlayed(p.curse, knightsPlayed(p))
		if (k > bestCount) {
			bestCount = k
			bestIdx = i
		} else if (k === bestCount) {
			// Tie at the lead — if the current holder is in the tie, they keep it.
			if (state.largestArmy === i) bestIdx = i
		}
	})
	return bestIdx !== null ? bestIdx : state.largestArmy
}

// Full VP total including hidden VP cards. Set `includeHiddenVP` to false
// for public/spectator views so VP cards aren't leaked.
export function totalVP(
	state: GameState,
	playerIdx: number,
	includeHiddenVP: boolean = true
): number {
	const p = state.players[playerIdx]
	let vp = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx) {
			vp += v.building === 'city' ? 2 : 1
		}
	}
	if (state.largestArmy === playerIdx) vp += 2
	if (state.longestRoad === playerIdx) vp += 2
	vp += carpenterVPOf(p)
	if (includeHiddenVP) {
		for (const e of p.devCards) {
			if (e.id === 'victory_point') vp += 1
		}
	}
	return vp
}

export function hasLegalRoadPlacement(
	state: GameState,
	meIdx: number
): boolean {
	return validBuildRoadEdges(state, meIdx).length > 0
}

// Baseline victory point count. Bonus/curse-aware variants (thrill_seeker,
// ambition, nomadism) live in `winVPThresholdFor` / `winRoadsRequiredFor`.
export const VICTORY_VP = 10

// First player (by index) who currently meets their victory conditions, or
// null. "Meets" = totalVP ≥ bonus/curse-specific threshold (10 default,
// 11 under ambition, 9 under thrill_seeker) AND, if cursed with nomadism,
// ≥ 11 roads on the board.
export function findWinner(state: GameState): number | null {
	for (let i = 0; i < state.players.length; i++) {
		const bonus = bonusOf(state, i)
		const curse = curseOf(state, i)
		if (totalVP(state, i) < winVPThresholdFor(bonus, curse)) continue
		const roadsNeeded = winRoadsRequiredFor(curse)
		if (roadsNeeded > 0 && roadCountFor(state, i) < roadsNeeded) continue
		return i
	}
	return null
}
