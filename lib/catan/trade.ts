// Pure helpers for player-to-player trade offers. No I/O — usable from UI
// (button gating + panel validation) or tests. The edge function re-implements
// the same rules inline.

import { RESOURCES } from './board'
import type { PlayerState, ResourceHand, TradeOffer } from './types'

export function emptyHand(): ResourceHand {
	return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
}

export function handIsEmpty(h: ResourceHand): boolean {
	for (const r of RESOURCES) if (h[r] !== 0) return false
	return true
}

export function canAfford(hand: ResourceHand, cost: ResourceHand): boolean {
	for (const r of RESOURCES) if (hand[r] < cost[r]) return false
	return true
}

// A well-formed trade has something on both sides and doesn't overlap
// (trading wheat-for-wheat is not meaningful). Also rejects negative amounts.
export function isValidTradeShape(
	give: ResourceHand,
	receive: ResourceHand
): boolean {
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	return giveTotal > 0 && receiveTotal > 0
}

// Produces the next players[] with a swap applied between proposer and
// accepter. Callers are expected to have verified affordability on both sides.
export function applyTradeToPlayers(
	players: PlayerState[],
	fromIdx: number,
	toIdx: number,
	give: ResourceHand,
	receive: ResourceHand
): PlayerState[] {
	return players.map((p, i) => {
		if (i !== fromIdx && i !== toIdx) return p
		const deltaIn = i === fromIdx ? receive : give
		const deltaOut = i === fromIdx ? give : receive
		const next: ResourceHand = { ...p.resources }
		for (const r of RESOURCES) {
			next[r] = next[r] + deltaIn[r] - deltaOut[r]
		}
		return { ...p, resources: next }
	})
}

// True if the offer's addressee list permits `me` to accept. Empty list = all.
export function isOfferAddressedTo(offer: TradeOffer, meIdx: number): boolean {
	if (meIdx === offer.from) return false
	if (offer.to.length === 0) return true
	return offer.to.includes(meIdx)
}

// 8-char base36 id. Sufficient uniqueness for at-most-one-open-trade-at-a-time.
export function newTradeId(): string {
	return Math.random().toString(36).slice(2, 10)
}
