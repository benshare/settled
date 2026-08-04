// Pure helpers for ports + bank trades. No I/O — usable from UI or tests.
// The edge function re-implements the same rules inline.

import { edgeEndpoints, RESOURCES, type Resource } from './board'
import { smithPortResourceOk } from './bonus'
import { curseVariantFor, type BankAccess } from './bonuses'
import type {
	BankKind,
	GameState,
	PlayerState,
	Port,
	ResourceHand,
} from './types'
import { gameSizeFor, vertexStateOf } from './types'

// Which port kinds does this player currently have access to via a settlement
// or city sitting on one of the port's two endpoint vertices?
export function playerPortKinds(
	state: GameState,
	playerIdx: number
): Set<Port['kind']> {
	const out = new Set<Port['kind']>()
	const ports = state.ports ?? []
	for (const p of ports) {
		const [a, b] = edgeEndpoints(p.edge)
		for (const v of [a, b] as const) {
			const vs = vertexStateOf(state, v)
			if (vs.occupied && vs.player === playerIdx) {
				out.add(p.kind)
				break
			}
		}
	}
	return out
}

// What the bank offers this player, after the `provinciality` curse. Table
// size decides which version of the curse applies (see `bonuses/sizes.ts`);
// 'open' is everyone else.
export function bankAccessFor(
	state: GameState,
	playerIdx: number
): BankAccess | 'open' {
	if (state.players[playerIdx]?.curse !== 'provinciality') return 'open'
	const size = gameSizeFor(state.players.length)
	return curseVariantFor('provinciality', size)?.bankAccess ?? 'flat_5'
}

// Extra input the player pays on every ratio — 1 under the small-table
// version of provinciality, 0 for everyone else. Callers thread this into
// `effectiveBankRatioFor` / `isValidBankTradeShape` so the surcharge is
// applied in exactly one place.
export function bankSurchargeFor(state: GameState, playerIdx: number): number {
	return bankAccessFor(state, playerIdx) === 'surcharge' ? 1 : 0
}

// The list of bank-trade options the player can pick from. Always includes
// '4:1'; '3:1' appears if they own a generic port; each '2:1-*' appears if
// they own the matching specific port. Order: 2:1s (by resource order), then
// '3:1', then '4:1' — most-advantageous first.
//
// The `provinciality` curse rewrites the list: 'flat_5' collapses it to '5:1'
// (no port access, penalised bank rate), 'none' empties it entirely, and
// 'surcharge' leaves it alone — there the curse is priced into the ratio
// (`bankSurchargeFor`) rather than the options. This function owns the final
// list the UI and server agree on, so an empty list means no bank trade is
// possible at all.
export function availableBankOptions(
	state: GameState,
	playerIdx: number
): BankKind[] {
	const access = bankAccessFor(state, playerIdx)
	if (access === 'none') return []
	if (access === 'flat_5') return ['5:1']
	const kinds = playerPortKinds(state, playerIdx)
	const out: BankKind[] = []
	for (const r of RESOURCES) {
		if (kinds.has(r)) out.push(`2:1-${r}` as BankKind)
	}
	if (kinds.has('3:1')) out.push('3:1')
	out.push('4:1')
	return out
}

export function ratioOf(kind: BankKind): 2 | 3 | 4 | 5 {
	if (kind === '5:1') return 5
	if (kind === '4:1') return 4
	if (kind === '3:1') return 3
	return 2
}

// When the selected kind is '2:1-<resource>', the only give-side resource
// the player may use is that resource.
export function lockedGiveResource(kind: BankKind): Resource | null {
	if (kind.startsWith('2:1-')) return kind.slice(4) as Resource
	return null
}

// A bank trade is multi-group: each give resource amount must be a positive
// multiple of `ratio`, give/receive are non-overlapping, and the number of
// groups given equals the number of units received (sum(give) === ratio × sum(receive)).
// For 2:1 specific ports, only the matching resource may appear on `give`.
//
// Specialist discount: when `specialistResource` is set (the player's
// declared specialty) AND the give is a single-resource stack of that same
// resource, the effective ratio is `max(1, baseRatio - 1)` — "pay one fewer",
// so a 2:1 specialty port becomes 1:1. Otherwise the base ratio applies.
// `isSmith` relaxes a 2:1 specific port's locked resource: a smith may satisfy
// a brick lock with ore and vice versa (brick↔ore substitution for ports).
export function isValidBankTradeShape(
	give: ResourceHand,
	receive: ResourceHand,
	kind: BankKind,
	specialistResource: Resource | null = null,
	isSmith: boolean = false,
	surcharge: number = 0
): boolean {
	const ratio = effectiveBankRatioFor(
		kind,
		give,
		specialistResource,
		surcharge
	)
	const locked = lockedGiveResource(kind)
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		if (give[r] % ratio !== 0) return false
		if (give[r] > 0 && !smithPortResourceOk(locked, r, isSmith))
			return false
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	return giveTotal > 0 && giveTotal === ratio * receiveTotal
}

// Effective bank ratio for a trade, accounting for the provinciality
// surcharge (paid on every ratio) and then the specialist discount (when the
// player gives a single-resource stack of their declared specialty). The two
// are applied in that order, so a surcharged specialist pays the base rate.
export function effectiveBankRatioFor(
	kind: BankKind,
	give: ResourceHand,
	specialistResource: Resource | null,
	surcharge: number = 0
): number {
	const base = ratioOf(kind) + surcharge
	if (!specialistResource) return base
	const givers = RESOURCES.filter((r) => give[r] > 0)
	if (givers.length !== 1) return base
	if (givers[0] !== specialistResource) return base
	return Math.max(1, base - 1)
}

// --- Combination bank trades ------------------------------------------------
//
// A bank trade is no longer priced at one chosen ratio. The player composes a
// give/receive proposal out of their hand and the bank accepts it if the give
// can be cut into groups — each group a whole number of cards of one resource
// at one of the rates that resource is available at — with exactly as many
// groups as there are cards on the receive side. So a 2:1 wheat port and the
// 4:1 bank combine: 2 wheat + 4 wood buys 2 cards.
//
// `bankPartitionFor` is both the validity test and the record of what was
// charged: a non-null return IS the witness partition.

export type BankRate = { resource: Resource; ratio: number; groups: number }

// The rates each given resource may be paid at. Only resources actually on the
// give side get an entry; an empty map means the bank is closed to this player
// (or they're giving nothing).
export function bankRatesFor(
	state: GameState,
	playerIdx: number,
	give: ResourceHand
): Partial<Record<Resource, number[]>> {
	const access = bankAccessFor(state, playerIdx)
	if (access === 'none') return {}

	const givers = RESOURCES.filter((r) => give[r] > 0)
	if (givers.length === 0) return {}

	const out: Partial<Record<Resource, number[]>> = {}
	if (access === 'flat_5') {
		for (const r of givers) out[r] = [5]
		return out
	}

	const surcharge = access === 'surcharge' ? 1 : 0
	const kinds = playerPortKinds(state, playerIdx)
	const p = state.players[playerIdx]
	const isSmith = p?.bonus === 'smith'
	// Unchanged from the single-ratio rule: the specialist discount applies
	// only when the whole give is one stack of their declared resource. A
	// mixed give loses it.
	const specialty =
		givers.length === 1 && p?.specialistResource === givers[0]
			? givers[0]
			: null

	for (const r of givers) {
		const ratios: number[] = [4 + surcharge]
		if (kinds.has('3:1')) ratios.push(3 + surcharge)
		// A smith may satisfy a brick lock with ore and vice versa, so their
		// counterpart port counts as this resource's specific port too.
		const hasSpecific = RESOURCES.some(
			(locked) =>
				kinds.has(locked) && smithPortResourceOk(locked, r, isSmith)
		)
		if (hasSpecific) ratios.push(2 + surcharge)
		if (r === specialty) {
			for (let i = 0; i < ratios.length; i += 1) {
				ratios[i] = Math.max(1, ratios[i] - 1)
			}
		}
		// Cheapest first: the witness walk prefers the head, so the reported
		// rates are the most favourable ones the proposal could have used.
		out[r] = [...new Set(ratios)].sort((a, b) => a - b)
	}
	return out
}

// Which group counts can consume exactly `count` cards, paying only the given
// ratios. Index i holds the reachable counts for i cards.
//
// A DP rather than a range check because a rate set has holes: {2, 4} can't
// make an odd pile at all, and {3, 4} can't make 5.
function reachableGroupCounts(count: number, ratios: number[]): Set<number>[] {
	const table: Set<number>[] = Array.from(
		{ length: count + 1 },
		() => new Set<number>()
	)
	table[0].add(0)
	for (let c = 1; c <= count; c += 1) {
		for (const ratio of ratios) {
			if (ratio > c) continue
			for (const g of table[c - ratio]) table[c].add(g + 1)
		}
	}
	return table
}

// Rebuild one resource's groups for a known group count, taking the cheapest
// usable rate at each step so the reported partition is deterministic.
function witnessGroups(
	count: number,
	groups: number,
	ratios: number[],
	table: Set<number>[]
): number[] {
	const parts: number[] = []
	let c = count
	let g = groups
	while (c > 0) {
		const ratio = ratios.find((r) => r <= c && table[c - r].has(g - 1))
		if (ratio === undefined) return []
		parts.push(ratio)
		c -= ratio
		g -= 1
	}
	return parts
}

// The merchant pays 1:1 for extra cards of the resource they're already
// trading, but only alongside a real group — otherwise the rate would be a
// free card for a card. Applies to a single-resource give only, which is the
// same shape the old `merchant` add-on required.
function merchantAppliesTo(
	state: GameState,
	playerIdx: number,
	give: ResourceHand
): Resource | null {
	if (state.players[playerIdx]?.bonus !== 'merchant') return null
	const givers = RESOURCES.filter((r) => give[r] > 0)
	return givers.length === 1 ? givers[0] : null
}

// The partition backing this give/receive, or null if the bank won't take it.
// Callers use the null check as the validity test and the returned rates as
// the record of what was charged.
export function bankPartitionFor(
	state: GameState,
	playerIdx: number,
	give: ResourceHand,
	receive: ResourceHand
): BankRate[] | null {
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return null
		if (!Number.isInteger(give[r]) || !Number.isInteger(receive[r]))
			return null
		if (give[r] > 0 && receive[r] > 0) return null
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	if (giveTotal === 0 || receiveTotal === 0) return null

	const rates = bankRatesFor(state, playerIdx, give)
	const merchantResource = merchantAppliesTo(state, playerIdx, give)

	// Per resource: the reachable group counts, and the DP table the witness
	// walk needs. The merchant's 1:1 cards are added on top of a full-price
	// partition, so they're layered over the table rather than folded into it.
	type Slot = {
		resource: Resource
		count: number
		ratios: number[]
		table: Set<number>[]
		reachable: Map<number, number>
	}
	const slots: Slot[] = []
	for (const r of RESOURCES) {
		if (give[r] === 0) continue
		const ratios = rates[r]
		if (!ratios || ratios.length === 0) return null
		const table = reachableGroupCounts(give[r], ratios)
		// group count → how many of the given cards were spent at full price
		const reachable = new Map<number, number>()
		for (const g of table[give[r]]) reachable.set(g, give[r])
		if (r === merchantResource) {
			for (let spent = 1; spent < give[r]; spent += 1) {
				const extra = give[r] - spent
				for (const g of table[spent]) {
					if (g < 1) continue
					if (!reachable.has(g + extra))
						reachable.set(g + extra, spent)
				}
			}
		}
		if (reachable.size === 0) return null
		slots.push({ resource: r, count: give[r], ratios, table, reachable })
	}

	// Combine across resources: running receive total → one representative
	// per-slot group count that reaches it. Only the total constrains what the
	// remaining slots can add, so keeping a single representative is lossless;
	// sorted keys make which one deterministic.
	let combos = new Map<number, number[]>([[0, []]])
	for (const slot of slots) {
		const groupCounts = [...slot.reachable.keys()].sort((a, b) => a - b)
		const next = new Map<number, number[]>()
		for (const [total, picks] of combos) {
			for (const g of groupCounts) {
				const sum = total + g
				if (sum > receiveTotal || next.has(sum)) continue
				next.set(sum, [...picks, g])
			}
		}
		combos = next
	}

	const picks = combos.get(receiveTotal)
	if (!picks) return null

	const out: BankRate[] = []
	for (let i = 0; i < slots.length; i += 1) {
		const slot = slots[i]
		const groups = picks[i]
		const spent = slot.reachable.get(groups)
		if (spent === undefined) return null
		const extra = slot.count - spent
		const parts = witnessGroups(
			spent,
			groups - extra,
			slot.ratios,
			slot.table
		)
		if (parts.length === 0 && spent > 0) return null
		const byRatio = new Map<number, number>()
		for (const ratio of parts)
			byRatio.set(ratio, (byRatio.get(ratio) ?? 0) + 1)
		if (extra > 0) byRatio.set(1, (byRatio.get(1) ?? 0) + extra)
		for (const ratio of [...byRatio.keys()].sort((a, b) => a - b)) {
			out.push({
				resource: slot.resource,
				ratio,
				groups: byRatio.get(ratio)!,
			})
		}
	}
	return out
}

// True when every group in the partition was charged the same rate — the
// common case, and what lets the log keep saying "4:1".
export function uniformRatioOf(rates: BankRate[]): number | null {
	if (rates.length === 0) return null
	const first = rates[0].ratio
	return rates.every((r) => r.ratio === first) ? first : null
}

export function applyBankTradeToPlayer(
	players: PlayerState[],
	idx: number,
	give: ResourceHand,
	receive: ResourceHand
): PlayerState[] {
	return players.map((p, i) => {
		if (i !== idx) return p
		const next: ResourceHand = { ...p.resources }
		for (const r of RESOURCES) {
			next[r] = next[r] - give[r] + receive[r]
		}
		return { ...p, resources: next }
	})
}
