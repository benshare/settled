// Pure helpers for the roll + main-phase loop. No I/O — usable from client UI
// (display) or tests. The edge function re-implements the same logic against
// its duplicated adjacency constants.

import { HEXES, adjacentVertices } from './board'
import { underdogMultiplierFor } from './bonus'
import {
	vertexStateOf,
	type DiceRoll,
	type DieFace,
	type GameState,
	type ResourceHand,
} from './types'

export type { DiceRoll, DieFace } from './types'

export function rollDice(): DiceRoll {
	const d = () => (1 + Math.floor(Math.random() * 6)) as DieFace
	return { a: d(), b: d() }
}

export function totalDice(r: DiceRoll): number {
	return r.a + r.b
}

// For every hex whose number token equals `total`, every settlement/city
// adjacent to it pays 1 (settlement) or 2 (city) of that hex's resource to
// the building's owner. Returns a sparse per-player gain map. On a 7 the
// result is empty — robber handling flows through its own phase chain.
// A hex that the robber sits on is skipped — it produces nothing.
//
// The `underdog` bonus doubles the gain for that player on 1- and 2-pip
// hexes (number tokens 2, 3, 11, 12). The city multiplier stacks on top:
// a city on a 2-pip hex pays 4 to an underdog player.
export function distributeResources(
	state: GameState,
	total: number
): Record<number, ResourceHand> {
	const result: Record<number, ResourceHand> = {}
	if (total === 7) return result
	for (const hex of HEXES) {
		if (hex === state.robber) continue
		const hd = state.hexes[hex]
		if (hd.resource === null) continue
		if (hd.number !== total) continue
		for (const v of adjacentVertices[hex]) {
			const vs = vertexStateOf(state, v)
			if (!vs.occupied) continue
			const base = vs.building === 'city' ? 2 : 1
			const mult = underdogMultiplierFor(
				state.players[vs.player]?.bonus,
				hd.number
			)
			const gain = base * mult
			const hand =
				result[vs.player] ??
				(result[vs.player] = {
					brick: 0,
					wood: 0,
					sheep: 0,
					wheat: 0,
					ore: 0,
				})
			hand[hd.resource] += gain
		}
	}
	return result
}

// Straight rotation in the main phase.
export function nextMainTurn(currentTurn: number, playerCount: number): number {
	return (currentTurn + 1) % playerCount
}
