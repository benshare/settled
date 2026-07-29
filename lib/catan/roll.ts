// Pure helpers for the roll + main-phase loop. No I/O — usable from client UI
// (display) or tests. The edge function re-implements the same logic against
// its duplicated adjacency constants.

import { boardFor, type Hex } from './board'
import { plutocratGain, underdogMultiplierFor } from './bonus'
import {
	vertexStateOf,
	type DiceRoll,
	type DieFace,
	type ExtraBuildConfig,
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
	const board = boardFor(state.variant)
	for (const hex of board.hexes) {
		if (hex === state.robber) continue
		const hd = state.hexes[hex]
		if (hd.resource === null) continue
		if (hd.number !== total) continue
		for (const v of board.adjacentVertices[hex]) {
			const vs = vertexStateOf(state, v)
			if (!vs.occupied) continue
			const base =
				vs.building === 'super_city'
					? 3
					: vs.building === 'city'
						? 2
						: 1
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
	// Plutocrat: for each plutocrat player, bump every resource they gained
	// ≥ 2 of by 50% (floor). Applied to the summed per-roll gain, so it stacks
	// after all their buildings are tallied.
	for (const idxStr of Object.keys(result)) {
		const idx = Number(idxStr)
		if (state.players[idx]?.bonus === 'plutocrat') {
			result[idx] = plutocratGain(result[idx])
		}
	}
	return result
}

// Straight rotation in the main phase.
export function nextMainTurn(currentTurn: number, playerCount: number): number {
	return (currentTurn + 1) % playerCount
}

// Seat "across the table" from `idx` in an n-seat circle. Even n → the exact
// opposite (n/2 ahead); odd n → ⌊n/2⌋ ahead (the slot just past directly
// across), so the mapping stays a clean per-round permutation for both.
export function acrossSeat(idx: number, n: number): number {
	return (idx + Math.floor(n / 2)) % n
}

// The special-build order after the player at `enderIdx` finishes their turn,
// front (acts first) to back. Empty when the SBP doesn't apply (2-4 players or
// disabled). See lib/catan/CLAUDE.md and GameConfig.extraBuild. Auto-skip of
// players who cannot act is applied by the caller, not here.
export function specialBuildQueue(
	eb: ExtraBuildConfig,
	enderIdx: number,
	n: number
): number[] {
	if (n <= 4 || !eb.enabled) return []
	if (eb.buildPhases === 'across') return [acrossSeat(enderIdx, n)]
	// 'every': all other players, clockwise from the next seat (the next roller
	// is included — they special-build, then take their normal turn).
	return Array.from({ length: n - 1 }, (_, k) => (enderIdx + 1 + k) % n)
}

// What each player would gain from a SINGLE hex on `total`, **ignoring the
// robber**. The forger copies through a blocked hex, so its candidate lookup
// can't go through `distributeResourcesByHex` — that one skips the robber's
// hex, which is exactly the case the forger is meant to bypass. Everything
// else matches `distributeResources` (super_city 3 / city 2 / settlement 1,
// underdog doubles on 1- and 2-pip hexes). Plutocrat is deliberately absent:
// it bumps the summed per-roll gain, not a per-hex slice.
export function gainsFromHex(
	state: GameState,
	hex: Hex,
	total: number
): Record<number, ResourceHand> {
	const perPlayer: Record<number, ResourceHand> = {}
	if (total === 7) return perPlayer
	const hd = state.hexes[hex]
	if (!hd || hd.resource === null) return perPlayer
	if (hd.number !== total) return perPlayer
	for (const v of boardFor(state.variant).adjacentVertices[hex]) {
		const vs = vertexStateOf(state, v)
		if (!vs.occupied) continue
		const base =
			vs.building === 'super_city' ? 3 : vs.building === 'city' ? 2 : 1
		const mult = underdogMultiplierFor(
			state.players[vs.player]?.bonus,
			hd.number
		)
		const hand =
			perPlayer[vs.player] ??
			(perPlayer[vs.player] = {
				brick: 0,
				wood: 0,
				sheep: 0,
				wheat: 0,
				ore: 0,
			})
		hand[hd.resource] += base * mult
	}
	return perPlayer
}

// Per-hex per-player gain from a roll — `gainsFromHex` over every hex, minus
// the one the robber sits on. Factored so the caller can attribute gains to
// specific hexes; the summed version is `distributeResources`.
export function distributeResourcesByHex(
	state: GameState,
	total: number
): Partial<Record<Hex, Record<number, ResourceHand>>> {
	const out: Partial<Record<Hex, Record<number, ResourceHand>>> = {}
	if (total === 7) return out
	for (const hex of boardFor(state.variant).hexes) {
		if (hex === state.robber) continue
		const perPlayer = gainsFromHex(state, hex, total)
		if (Object.keys(perPlayer).length > 0) out[hex] = perPlayer
	}
	return out
}

// True iff both dice show the same face.
export function isDoubles(d: DiceRoll): boolean {
	return d.a === d.b
}
