// Pure helpers for the robber + 7-roll flow. No I/O — usable from client UI
// or tests. The edge function re-implements the same logic against its
// duplicated constants.

import { HEXES, RESOURCES, adjacentVertices, type Hex } from './board'
import {
	vertexStateOf,
	type GameState,
	type PlayerState,
	type ResourceHand,
} from './types'

export function handSize(hand: ResourceHand): number {
	let n = 0
	for (const r of RESOURCES) n += hand[r]
	return n
}

// Standard Catan 7-rule: any hand > 7 must discard floor(hand/2). Players
// under the `avarice` curse discard their entire hand instead; players
// with the `hoarder` bonus discard nothing regardless of hand size.
//
// Shepherd's "sheep don't count toward your hand limit" exempts sheep from
// both the > 7 threshold check AND the discard amount. The discard amount
// for a shepherd over the threshold is `floor(effective / 2)` where
// `effective = total − sheep`.
export function requiredDiscards(
	players: PlayerState[]
): Partial<Record<number, number>> {
	const out: Partial<Record<number, number>> = {}
	players.forEach((p, i) => {
		if (p.bonus === 'hoarder') return
		const total = handSize(p.resources)
		const effective =
			p.bonus === 'shepherd' ? total - p.resources.sheep : total
		if (effective > 7) {
			out[i] =
				p.curse === 'avarice' ? effective : Math.floor(effective / 2)
		}
	})
	return out
}

export function isValidDiscardSelection(
	hand: ResourceHand,
	selection: ResourceHand,
	required: number
): boolean {
	if (handSize(selection) !== required) return false
	for (const r of RESOURCES) {
		if (selection[r] < 0) return false
		if (selection[r] > hand[r]) return false
	}
	return true
}

export function validRobberHexes(state: GameState): Hex[] {
	return HEXES.filter((h) => h !== state.robber)
}

// Distinct opponent player indices whose settlement/city touches `hex` and
// who have at least one card to steal. The rolling player can never steal
// from themselves.
export function stealCandidates(
	state: GameState,
	hex: Hex,
	meIdx: number
): number[] {
	const set = new Set<number>()
	for (const v of adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied) continue
		if (vs.player === meIdx) continue
		if (handSize(state.players[vs.player].resources) <= 0) continue
		set.add(vs.player)
	}
	return Array.from(set)
}
