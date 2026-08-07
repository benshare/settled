// The HUD's two status surfaces, derived here so the island and the banner can
// never disagree. Both are UNIFORM across viewers — same content for everyone,
// differing only in "you" vs. the player's name (see `.claude/specs/game-hud.md`
// §5–6). The one exception is the initial-placement line, which names the piece
// the actor owes and so can only be as precise as the viewer's own draft
// (`placementLine`).
//
//   islandStatus — the current turn + this turn's roll (a stable indicator).
//   bannerStatus — this turn's most recent action, or what the table is waiting on
//                  (a status summary, never the instruction — the dock carries
//                  the actual affordance).
//   actingSeats  — who owes an action right now, for the player chips' dots.
//                  `pendingSeats` (the move-timeout derivation) plus the open
//                  trade's responders, the one wait outside the phase machine.

import { describeEvent, type LogContext } from '@/lib/catan/ActionLog'
import { mustMoveForgerToken } from '@/lib/catan/bonus'
import { pendingSeats } from '@/lib/catan/timeout'
import type { DiceRoll, GameState, TradeOffer } from '@/lib/catan/types'
import type { PlacementStage } from '@/lib/game/gameScreenContext'
import type { Game, GameEvent } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'

type Ctx = {
	game: Game
	gameState: GameState
	meIdx: number
	profilesById: Record<string, Profile>
	// The one non-uniform input: a placement turn is drafted locally, so only
	// the acting client knows which piece is owed (see `placementLine`).
	placementStage: PlacementStage
}

// Roll-family events never populate the banner: an ordinary roll is what the
// island already shows, so the banner falls through to the action before it.
const ROLL_KINDS: ReadonlySet<GameEvent['kind']> = new Set([
	'rolled',
	'reroll',
	'roll_choice',
	'ritual_roll',
	'fortune_teller_roll',
])

// The phases where the table is waiting on a decision the island doesn't
// already narrate. `main` is an ordinary turn (the island names the seat), so it
// falls through to the recent-action line; `roll` and `initial_placement` have
// their own lines (see `rollLine` / `placementLine`) so the banner refreshes the
// moment a turn ends.
const WAIT_KINDS: ReadonlySet<GameState['phase']['kind']> = new Set([
	'select_bonus',
	'post_placement',
	'discard',
	'move_robber',
	'steal',
	'road_building',
	'scout_pick',
	'curio_pick',
	'forger_pick',
	'magician_pick',
	'special_build',
])

function nameOf(idx: number, ctx: Ctx): string {
	if (idx === ctx.meIdx) return 'You'
	return ctx.profilesById[ctx.game.player_order[idx]]?.username ?? 'Player'
}

// "You are" / "Bea is" — so a single-actor wait line reads for both viewers.
function isPhrase(idx: number, ctx: Ctx): string {
	return idx === ctx.meIdx ? 'You are' : `${nameOf(idx, ctx)} is`
}

function listOf(idxs: number[], ctx: Ctx): string {
	if (idxs.length === 0) return 'nobody'
	return idxs
		.map((i) => (i === ctx.meIdx ? 'you' : nameOf(i, ctx)))
		.join(', ')
}

// This turn's roll, wherever it currently lives — committed on `main`, pending
// for a gambler on `roll`, or stashed on the 7-chain sub-phases' resume pointer.
export function currentRoll(gameState: GameState): DiceRoll | null {
	const p = gameState.phase
	if (p.kind === 'main') return p.roll
	if (p.kind === 'roll') return p.pending?.dice ?? null
	if (
		(p.kind === 'discard' ||
			p.kind === 'move_robber' ||
			p.kind === 'steal') &&
		p.from7 &&
		p.resume.kind === 'main'
	)
		return p.resume.roll
	return null
}

export function islandStatus(ctx: Ctx): {
	label: string
	dice: DiceRoll | null
} {
	const { gameState } = ctx
	const phase = gameState.phase
	if (phase.kind === 'special_build' && phase.queue.length > 0) {
		return {
			label: `${isPhrase(phase.queue[0], ctx)} building`,
			dice: null,
		}
	}
	const turn = gameState.currentTurn
	if (turn === null) return { label: 'Choosing bonuses', dice: null }
	const label =
		turn === ctx.meIdx ? 'Your turn' : `${nameOf(turn, ctx)}'s turn`
	return { label, dice: currentRoll(gameState) }
}

export function bannerStatus(ctx: Ctx): string | null {
	const phase = ctx.gameState.phase
	if (WAIT_KINDS.has(phase.kind)) return waitLine(ctx)
	if (phase.kind === 'roll') return rollLine(ctx)
	if (phase.kind === 'initial_placement') return placementLine(ctx)
	return recentActionLine(ctx)
}

// Placement turns commit a settlement and its road together, so the recent
// action is almost always "…placed a road" — stale narration of the turn the
// table has already moved past. Name the piece the seat owes instead.
//
// This is the one line that isn't uniform across viewers, and it can't be: the
// settlement/road stage is drafted client-side (see `placementStage`), so only
// the acting client knows which half of the turn is open. A watching viewer
// never drafts, so their stage sits at 'settlement' — the phase's own altitude,
// and the line they got before this existed.
function placementLine(ctx: Ctx): string | null {
	const phase = ctx.gameState.phase
	if (phase.kind !== 'initial_placement') return null
	const turn = ctx.gameState.currentTurn ?? 0
	if (phase.step === 'pick_last')
		return `${isPhrase(turn, ctx)} choosing a starting settlement`
	const whose = turn === ctx.meIdx ? 'Your' : `${nameOf(turn, ctx)}'s`
	if (ctx.placementStage === 'ready')
		return `${whose} placements are ready to confirm`
	const piece = ctx.placementStage === 'road' ? 'road' : 'settlement'
	return `${whose} turn to place ${piece}`
}

// The `roll` phase is an ordinary turn, so it isn't in `WAIT_KINDS` — but with
// no line here the banner falls through to the *previous* turn's last action
// and reads as stale the moment a turn ends. Name what the table is waiting to
// roll (or the forger's compulsory pre-roll token move) instead. The actor gets
// the instruction; everyone else gets the status.
function rollLine(ctx: Ctx): string | null {
	const { gameState, meIdx } = ctx
	const phase = gameState.phase
	if (phase.kind !== 'roll') return null
	const turn = gameState.currentTurn ?? 0
	// A gambler who has already rolled is keeping or rerolling; the island shows
	// the pending dice, so name the decision rather than "to roll".
	if (phase.pending?.dice) return `${isPhrase(turn, ctx)} confirming the roll`
	const p = gameState.players[turn]
	if (p && mustMoveForgerToken(p)) {
		return turn === meIdx
			? 'Move your forger token to an adjacent hex'
			: `${nameOf(turn, ctx)} is moving their forger token`
	}
	return turn === meIdx ? 'Roll the dice' : `${nameOf(turn, ctx)} to roll`
}

function waitLine(ctx: Ctx): string | null {
	const { gameState } = ctx
	const phase = gameState.phase
	const seats = pendingSeats(phase, gameState.currentTurn)
	switch (phase.kind) {
		case 'select_bonus':
			return seats.length > 0
				? `Waiting for ${listOf(seats, ctx)} to choose bonuses`
				: null
		case 'post_placement':
			return seats.length > 0
				? `Setting up bonuses — waiting on ${listOf(seats, ctx)}`
				: null
		case 'discard':
			return `Waiting for ${listOf(seats, ctx)} to discard`
		case 'curio_pick':
			return `Waiting for ${listOf(seats, ctx)} to claim resources`
		case 'move_robber':
			return `${isPhrase(gameState.currentTurn ?? 0, ctx)} moving the robber`
		case 'steal':
			return `${isPhrase(gameState.currentTurn ?? 0, ctx)} stealing a card`
		case 'road_building':
			return `${isPhrase(gameState.currentTurn ?? 0, ctx)} placing free roads`
		case 'scout_pick':
			return `${isPhrase(phase.owner, ctx)} peeking at dev cards`
		case 'magician_pick':
			return `${isPhrase(phase.roller, ctx)} working their magic`
		case 'forger_pick':
			return phase.queue.length > 0
				? `${isPhrase(phase.queue[0].idx, ctx)} forging a copy`
				: null
		case 'special_build':
			return phase.queue.length > 0
				? `${isPhrase(phase.queue[0], ctx)} taking an extra build`
				: null
		default:
			return null
	}
}

// The boundaries that open a turn: the previous turn ending, or setup finishing
// for the very first one. Scanning past them is what made the banner stale —
// see `recentActionLine`.
const TURN_BOUNDARIES: ReadonlySet<GameEvent['kind']> = new Set([
	'turn_ended',
	'placement_complete',
])

// The latest committed, non-roll action **of the current turn** — `describeEvent`
// gives us the same phrasing the log uses (and its own "You" substitution) for
// free. Bounded by the turn that's open: without that, a seat who has only just
// rolled reads as the previous player's last build (and the first turn of the
// game reads as "Setup complete"). Nothing done yet this turn is nothing to say,
// so the banner drops the line and the island carries the turn on its own.
function recentActionLine(ctx: Ctx): string | null {
	const events = (ctx.game.events ?? []) as GameEvent[]
	const logCtx: LogContext = {
		playerOrder: ctx.game.player_order,
		profilesById: ctx.profilesById,
		meIdx: ctx.meIdx,
	}
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i]
		if (TURN_BOUNDARIES.has(e.kind)) return null
		if (ROLL_KINDS.has(e.kind)) continue
		const line = describeEvent(e, logCtx)
		if (line) return line.text
	}
	return null
}

// Who owes an action right now — the chips' dot set. `pendingSeats` covers every
// phase; an open trade offer is the one wait it can't see.
export function actingSeats(
	gameState: GameState,
	currentTurn: number | null,
	playerCount: number,
	offer: TradeOffer | null
): Set<number> {
	const seats = new Set(pendingSeats(gameState.phase, currentTurn))
	if (offer) {
		const rejected = offer.rejectedBy ?? []
		const accepted = offer.acceptedBy ?? []
		const responders =
			offer.to.length > 0
				? offer.to
				: Array.from({ length: playerCount }, (_, i) => i).filter(
						(i) => i !== offer.from
					)
		for (const i of responders) {
			if (!rejected.includes(i) && !accepted.includes(i)) seats.add(i)
		}
		// Confirm mode: once someone has accepted, the ball is in the
		// proposer's court to confirm the swap.
		if (accepted.length > 0) seats.add(offer.from)
	}
	return seats
}
