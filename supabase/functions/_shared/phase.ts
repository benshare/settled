// Who a game is waiting on, shared by `game-service` (move timeouts) and
// `_notify` (the app-icon badge). One copy per runtime: this is the server
// mirror of `pendingSeats` in `lib/catan/timeout.ts`, which stays the source of
// truth (the Expo and Deno sides can't share a module — see
// `supabase/functions/CLAUDE.md`).
//
// `PendingPhase` is deliberately narrower than `game-service`'s full `Phase`:
// only the fields this derivation reads. `Phase` stays assignable to it, and a
// new phase kind added there stops being assignable — so it still fails to
// compile rather than silently never timing out or never badging.

export type PendingPhase =
	| { kind: 'select_bonus'; hands: Record<number, { chosen: unknown }> }
	| { kind: 'initial_placement' }
	| {
			kind: 'post_placement'
			pending: {
				specialist: number[]
				explorer?: Partial<Record<number, number>>
				haunt?: number[]
			}
	  }
	| { kind: 'roll' }
	| { kind: 'main' }
	| { kind: 'discard'; pending: Partial<Record<number, number>> }
	| { kind: 'move_robber' }
	| { kind: 'steal' }
	| { kind: 'road_building' }
	| { kind: 'scout_pick'; owner: number }
	| { kind: 'curio_pick'; pending: number[] }
	| { kind: 'forger_pick'; queue: { idx: number }[] }
	| { kind: 'magician_pick'; roller: number }
	| { kind: 'special_build'; queue: number[] }
	| { kind: 'game_over' }

/**
 * Every seat the game is waiting on right now.
 *
 * Deliberately NOT `current_turn`: that names the wrong seat during
 * `special_build` (it has already advanced to the next roller) and is null for
 * the whole simultaneous bonus-selection phase. The parallel phases return
 * several seats at once.
 */
export function pendingSeats(
	phase: PendingPhase,
	currentTurn: number | null
): number[] {
	const turn = currentTurn === null ? [] : [currentTurn]
	switch (phase.kind) {
		case 'select_bonus':
			return Object.entries(phase.hands)
				.filter(([, hand]) => hand.chosen === null)
				.map(([idx]) => Number(idx))
		case 'post_placement': {
			const p = phase.pending
			const seats = new Set<number>(p.specialist)
			for (const idx of p.haunt ?? []) seats.add(idx)
			for (const [idx, owed] of Object.entries(p.explorer ?? {})) {
				if ((owed ?? 0) > 0) seats.add(Number(idx))
			}
			return [...seats].sort((a, b) => a - b)
		}
		case 'discard':
			return Object.keys(phase.pending).map(Number)
		case 'scout_pick':
			return [phase.owner]
		case 'curio_pick':
			return [...phase.pending]
		case 'forger_pick':
			return phase.queue.length > 0 ? [phase.queue[0].idx] : []
		case 'magician_pick':
			return [phase.roller]
		case 'special_build':
			return phase.queue.length > 0 ? [phase.queue[0]] : []
		case 'game_over':
			return []
		case 'initial_placement':
		case 'roll':
		case 'main':
		case 'move_robber':
		case 'steal':
		case 'road_building':
			return turn
	}
}

/**
 * `pendingSeats` in user ids — the "waiting on you" signal. Mirror of
 * `pendingUserIds` in `lib/catan/timeout.ts`; see it for why an absent phase
 * falls back to `current_turn` rather than to nobody.
 */
export function pendingUserIds(
	playerOrder: string[],
	phase: PendingPhase | undefined,
	currentTurn: number | null
): string[] {
	const seats = phase
		? pendingSeats(phase, currentTurn)
		: currentTurn === null
			? []
			: [currentTurn]
	return seats
		.map((idx) => playerOrder[idx])
		.filter((id): id is string => id !== undefined)
}
