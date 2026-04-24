// Pure helpers for ports + bank trades. No I/O — usable from UI or tests.
// The edge function re-implements the same rules inline.

import { edgeEndpoints, RESOURCES, type Resource } from './board'
import type {
	BankKind,
	GameState,
	PlayerState,
	Port,
	ResourceHand,
} from './types'
import { vertexStateOf } from './types'

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

// The list of bank-trade options the player can pick from. Always includes
// '4:1'; '3:1' appears if they own a generic port; each '2:1-*' appears if
// they own the matching specific port. Order: 2:1s (by resource order), then
// '3:1', then '4:1' — most-advantageous first.
//
// The `provinciality` curse collapses every option down to '5:1' (no port
// access, penalised default bank rate). Pass the player's curse so this
// function owns the final list the UI and server agree on.
export function availableBankOptions(
	state: GameState,
	playerIdx: number
): BankKind[] {
	if (state.players[playerIdx]?.curse === 'provinciality') return ['5:1']
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
// resource, the effective ratio is `max(2, baseRatio - 1)`. Otherwise the
// base ratio applies.
export function isValidBankTradeShape(
	give: ResourceHand,
	receive: ResourceHand,
	kind: BankKind,
	specialistResource: Resource | null = null
): boolean {
	const ratio = effectiveBankRatioFor(kind, give, specialistResource)
	const locked = lockedGiveResource(kind)
	let giveTotal = 0
	let receiveTotal = 0
	for (const r of RESOURCES) {
		if (give[r] < 0 || receive[r] < 0) return false
		if (give[r] > 0 && receive[r] > 0) return false
		if (give[r] % ratio !== 0) return false
		if (locked && give[r] > 0 && r !== locked) return false
		giveTotal += give[r]
		receiveTotal += receive[r]
	}
	return giveTotal > 0 && giveTotal === ratio * receiveTotal
}

// Effective bank ratio for a trade, accounting for the specialist discount
// when the player gives a single-resource stack of their declared specialty.
// Returns the base ratio in all other cases.
export function effectiveBankRatioFor(
	kind: BankKind,
	give: ResourceHand,
	specialistResource: Resource | null
): number {
	const base = ratioOf(kind)
	if (!specialistResource) return base
	const givers = RESOURCES.filter((r) => give[r] > 0)
	if (givers.length !== 1) return base
	if (givers[0] !== specialistResource) return base
	return Math.max(2, base - 1)
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
