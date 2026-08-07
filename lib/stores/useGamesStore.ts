import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { Hex, Resource } from '../catan/board'
import type { MerchantAddon } from '../catan/bonus'
import type { BankRate } from '../catan/ports'
import type { BonusId, CurseId } from '../catan/bonuses'
import type { DevCardId } from '../catan/devCards'
import type { DiceRoll, GameConfig, ResourceHand } from '../catan/types'
import type { Database } from '../database-types'
import { emitGameMutated } from '../gameSync'
import { uniqueTopic } from '../realtime'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import { useProfileStore, type Profile } from './useProfileStore'

type GameRow = Database['public']['Tables']['games']['Row']
type GameRequestRow = Database['public']['Tables']['game_requests']['Row']

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults, notification_prefs, spectating, color_prefs'

let requestsChannel: RealtimeChannel | null = null
let gamesChannel: RealtimeChannel | null = null

export type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

export type GameRequest = Omit<GameRequestRow, 'invited'> & {
	invited: InvitedEntry[]
}

export type Game = GameRow

export type GameEvent =
	| { kind: 'game_complete'; winner_index: number; at: string }
	| {
			kind: 'settlement_placed'
			player: number
			vertex: string
			round: 1 | 2
			at: string
	  }
	| {
			kind: 'road_placed'
			player: number
			edge: string
			round: 1 | 2
			at: string
	  }
	| { kind: 'placement_complete'; at: string }
	// `gains` is the production this roll paid out, keyed by seat — the only
	// record of it anywhere, since distribution is otherwise invisible to the
	// log. Absent on 7s (nothing produced) and on events from before it was
	// written, so treat a missing value as "unknown", not "nobody collected".
	| {
			kind: 'rolled'
			player: number
			dice: [number, number]
			total: number
			gains?: Record<number, ResourceHand>
			at: string
	  }
	| { kind: 'turn_ended'; player: number; at: string }
	// `player` is the honked (stalled) seat, `from` the sender's. `from` backs
	// the one-honk-per-sender-per-turn rule; the log line only renders `player`.
	| { kind: 'honked'; player: number; from: number; at: string }
	| { kind: 'road_built'; player: number; edge: string; at: string }
	| { kind: 'settlement_built'; player: number; vertex: string; at: string }
	| { kind: 'city_built'; player: number; vertex: string; at: string }
	| { kind: 'discarded'; player: number; count: number; at: string }
	| { kind: 'robber_moved'; player: number; hex: string; at: string }
	// `resource` is optional: steals logged before it was recorded read as
	// un-expandable rather than claiming nothing was taken. ActionLog shows it
	// only to the thief and the victim.
	| {
			kind: 'stolen'
			thief: number
			victim: number
			resource?: Resource
			at: string
	  }
	| {
			kind: 'trade_proposed'
			offer_id: string
			from: number
			to: number[]
			give: ResourceHand
			receive: ResourceHand
			at: string
	  }
	| {
			kind: 'trade_accepted'
			offer_id: string
			from: number
			to: number
			give: ResourceHand
			receive: ResourceHand
			at: string
	  }
	| { kind: 'trade_canceled'; offer_id: string; from: number; at: string }
	| {
			kind: 'trade_rejected'
			offer_id: string
			from: number
			by: number
			at: string
	  }
	// Confirm mode: an addressee accepted, awaiting the proposer's confirm. The
	// executed swap still logs `trade_accepted` (on confirm). Ephemeral — omitted
	// from the action log and ignored by stats.
	| {
			kind: 'trade_accept_offered'
			offer_id: string
			from: number
			by: number
			at: string
	  }
	// A bank trade may mix rates (a 2:1 port and the 4:1 bank in one go), so
	// `rates` is the partition that paid for it and `ratio` survives only for
	// the common single-rate case. `merchant` is on pre-combination events
	// only: the bonus's 1:1 extras are now ordinary groups in `rates`.
	| {
			kind: 'bank_trade'
			player: number
			give: ResourceHand
			receive: ResourceHand
			ratio?: number
			rates?: BankRate[]
			merchant?: MerchantAddon | null
			at: string
	  }
	// Dev-card events. `dev_bought` intentionally carries no card id so the
	// deck/draw stays private. `dev_played` reveals the id (and any payload
	// fields that would be publicly announced at the table) when a non-VP
	// card is actually played.
	| { kind: 'dev_bought'; player: number; at: string }
	| {
			kind: 'dev_played'
			player: number
			id: Exclude<DevCardId, 'victory_point'>
			take?: [Resource, Resource]
			resource?: Resource
			total?: number
			at: string
	  }
	| { kind: 'largest_army_changed'; player: number; at: string }
	// Longest Road flips after road builds, Road Building card finalizations,
	// and settlement builds (opponent can split a chain). `player: null`
	// announces that the current holder lost the bonus with no successor —
	// common when a settlement severs a chain below the 5-segment threshold.
	| { kind: 'longest_road_changed'; player: number | null; at: string }
	// Nomad bonus: a 7 was rolled and this nomad has buildings on the desert.
	// `count` is total production (settlement=1, city=2, super_city=3 summed
	// across desert hexes). Surfaced in UI as a roulette-reveal animation.
	| {
			kind: 'nomad_produce'
			player: number
			resource: Resource
			count: number
			at: string
	  }
	// Fortune teller bonus: the FT player rolled doubles or a 7, triggering one
	// or more bonus dice rolls that pay only them. One event per bonus roll (the
	// chain continues on doubles/7). `gain` is that roll's production and may be
	// empty when the bonus roll is a 7 or hits none of their hexes. Surfaced in
	// UI as a dice-reveal animation (empty gains show in the log only).
	| {
			kind: 'fortune_teller_roll'
			player: number
			dice: [number, number]
			total: number
			gain: ResourceHand
			at: string
	  }
	// --- Bonus-card events -------------------------------------------------
	// Everything below is written by a bonus (sets 1-3) rather than a base
	// rule. `ActionLog` groups them under the "Bonuses" filter.
	//
	// One per seat, written together the moment the last player locks in their
	// pick — bonuses and curses are public from then on.
	| {
			kind: 'bonus_chosen'
			player: number
			bonus: BonusId
			curse?: CurseId
			// The cards this seat was dealt — the only record of what they
			// turned down, and what pick rate on the Stats tab is measured
			// against. `offered` is absent on games that started before it was
			// logged; `offeredCurses` before curses could be chosen.
			offered?: BonusId[]
			offeredCurses?: CurseId[]
			at: string
	  }
	| { kind: 'specialist_set'; player: number; resource: Resource; at: string }
	// Hoarder: over the limit on a 7 but keeping everything. `count` is the
	// hand they held onto.
	| { kind: 'hoarder_kept'; player: number; count: number; at: string }
	| { kind: 'carpenter_vp'; player: number; at: string }
	| {
			kind: 'knight_tapped'
			player: number
			resources: [Resource, Resource]
			at: string
	  }
	// Gambler at a 5-6 player table: both rolls were thrown up front and the
	// player kept one. The kept roll is logged separately as a normal `rolled`.
	| {
			kind: 'roll_choice'
			player: number
			kept_dice: [number, number]
			discarded_dice: [number, number]
			at: string
	  }
	// Gambler: the first roll was thrown away for a second one. The kept roll
	// is logged separately as a normal `rolled`.
	| {
			kind: 'reroll'
			player: number
			old_dice: [number, number]
			new_dice: [number, number]
			at: string
	  }
	| { kind: 'explorer_road'; player: number; edge: string; at: string }
	| {
			kind: 'shepherd_swap'
			player: number
			take: [Resource, Resource]
			at: string
	  }
	// Same `gains` as `rolled`, but a ritual pays only the ritualist.
	| {
			kind: 'ritual_roll'
			player: number
			dice: [number, number]
			total: number
			discard: ResourceHand
			gains?: Record<number, ResourceHand>
			at: string
	  }
	| { kind: 'curio_collected'; player: number; take: Resource[]; at: string }
	// `_move` is the forger's compulsory start-of-turn token move, the only
	// thing that relocates the token today. `_set` is legacy: 7-rolls used to
	// snap every token to the robber, activating it the first time. No longer
	// written — kept so old logs still render.
	| { kind: 'forger_token_set'; player: number; hex: Hex; at: string }
	| { kind: 'forger_token_move'; player: number; hex: Hex; at: string }
	// `target` is the copied player's seat index.
	| {
			kind: 'forger_copy'
			player: number
			target: number
			gain: ResourceHand
			at: string
	  }
	// `swap` is the substituted cost the scout paid with, when they used one.
	| {
			kind: 'scout_buy'
			player: number
			swap: { from: Resource; to: Resource } | null
			at: string
	  }
	| {
			kind: 'liquidate'
			player: number
			detail:
				| { kind: 'road'; edge: string; refund: ResourceHand }
				| { kind: 'settlement'; vertex: string; refund: ResourceHand }
				| { kind: 'city'; vertex: string; refund: ResourceHand }
				| { kind: 'super_city'; vertex: string; refund: ResourceHand }
				| { kind: 'dev_card'; id: DevCardId; refund: ResourceHand }
			at: string
	  }
	| {
			kind: 'build_super_city'
			player: number
			vertex: string
			cost: ResourceHand
			at: string
	  }
	| { kind: 'fence_token'; player: number; edge: string; at: string }
	| { kind: 'invest'; player: number; resource: Resource; at: string }
	| {
			kind: 'investor_payout'
			player: number
			gain: ResourceHand
			at: string
	  }
	| {
			kind: 'magic_cast'
			player: number
			target: number
			discard: ResourceHand
			gain: ResourceHand
			at: string
	  }
	| { kind: 'magic_skipped'; player: number; at: string }
	// Haunt: the spots themselves stay private, so only the fact is logged.
	| { kind: 'haunt_spots_set'; player: number; at: string }
	| { kind: 'ghost_spawned'; player: number; vertex: string; at: string }
	// --- Forfeiting and ending ---------------------------------------------
	// Two withdrawable, per-player declarations that a game can end without
	// anyone reaching the VP threshold. Neither has any mechanical effect —
	// a player holding a standing forfeit keeps their seat and their turn.
	// See `.claude/specs/forfeit-and-end-game.md`.
	| { kind: 'forfeit_submitted'; player: number; at: string }
	| { kind: 'forfeit_withdrawn'; player: number; at: string }
	| { kind: 'end_game_proposed'; player: number; at: string }
	| { kind: 'end_game_withdrawn'; player: number; at: string }
	// Terminal event, written when every seat voted to end. Deliberately not a
	// `game_complete`: there is no winner and no scoreboard to announce.
	| { kind: 'game_canceled'; at: string }
	// Terminal event. Written once per game when a player reaches 10 VP, or
	// when every seat but one has forfeited (`by_forfeit`, in which case the
	// survivor wins regardless of VP). `vpCards` reveals each player's
	// previously-hidden VP card count so clients can render a final scoreboard
	// without a separate read.
	| {
			kind: 'game_complete'
			winner: number
			vpCards: Record<number, number>
			by_forfeit?: boolean
			at: string
	  }

type ActionResult = { error: string | null }
type RespondResult = { error: string | null; gameId?: string }
type RollResult = ActionResult & { dice?: DiceRoll; total?: number }

type ServiceData = Record<string, unknown>

/**
 * The single entry point for every game-service call.
 *
 * Carries the edge function's own error string back to the caller — supabase-js
 * buries the body of a non-2xx response inside the thrown error, so it has to be
 * read back out — and pings `gameSync` on success so the acting player's board
 * advances without waiting on realtime.
 */
async function callGameService(
	body: ServiceData,
	fallback: string
): Promise<ActionResult & { data: ServiceData }> {
	const { data, error } = await supabase.functions.invoke('game-service', {
		body,
	})

	if (error) {
		const message = await edgeErrorMessage(error)
		return { error: message || fallback, data: {} }
	}

	const res = (data ?? {}) as ServiceData
	if (!res.ok) {
		return {
			error: (res.error as string | undefined) || fallback,
			data: res,
		}
	}

	const gameId = body.game_id
	if (typeof gameId === 'string') emitGameMutated(gameId)
	return { error: null, data: res }
}

// A FunctionsHttpError carries the raw Response on `context`; its own `message`
// is the same boilerplate for every failure ("non-2xx status code"), so the
// body's `error` is the only thing that says what actually went wrong. Network
// failures have no body — there `message` is all we have, and it's the truth.
async function edgeErrorMessage(error: unknown): Promise<string | null> {
	const context = (error as { context?: unknown }).context
	if (context && typeof (context as Response).json === 'function') {
		try {
			const body = await (context as Response).json()
			const message = (body as { error?: unknown })?.error
			if (typeof message === 'string' && message) return message
		} catch {
			// Not a JSON body — fall through to the error's own message.
		}
	}
	return (error as Error).message || null
}

type GamesStore = {
	pendingRequests: GameRequest[] | undefined
	activeGames: Game[] | undefined
	// In-progress games the viewer is NOT in but may watch: the spectator RLS
	// policy lets them read any spectators-enabled game that includes a friend.
	// They arrive on the same query as `activeGames` and are split out by
	// participation — see loadForUser.
	spectatableGames: Game[] | undefined
	completeGames: Game[] | undefined
	profilesById: Record<string, Profile>
	// The user the lists were loaded for. Kept so the realtime handler can
	// route an incoming row into the right list without a hook's help.
	meId: string | undefined
	loading: boolean

	loadForUser: (userId: string) => Promise<void>
	clear: () => void
	// Fetch and cache any profiles we don't already hold. Spectators and their
	// chat messages surface ids that were never in a participant list.
	ensureProfiles: (ids: string[]) => Promise<void>

	createRequest: (
		meId: string,
		invitedIds: string[],
		config: GameConfig
	) => Promise<ActionResult>
	respond: (
		meId: string,
		requestId: string,
		accept: boolean
	) => Promise<RespondResult>
	cancelRequest: (meId: string, requestId: string) => Promise<ActionResult>

	pickBonus: (
		gameId: string,
		bonus: BonusId,
		curse: CurseId
	) => Promise<ActionResult>
	setSpecialistResource: (
		gameId: string,
		resource: Resource
	) => Promise<ActionResult>
	buyCarpenterVP: (gameId: string) => Promise<ActionResult>
	tapKnight: (
		gameId: string,
		r1: Resource,
		r2: Resource
	) => Promise<ActionResult>

	// A whole placement turn at once: one settlement+road pair, or two for the
	// seat that places both of its settlements back-to-back.
	placeStart: (
		gameId: string,
		placements: { vertex: string; edge: string }[]
	) => Promise<ActionResult>
	// Only the seat that places both starting settlements back-to-back is ever
	// asked this; `vertex` is the one it nominates as placed last.
	chooseLastSettlement: (
		gameId: string,
		vertex: string
	) => Promise<ActionResult>

	// `forcedTotal` is the admin-testing override; the edge function honours it
	// only for a seat whose player row carries `dev: true`.
	roll: (gameId: string, forcedTotal?: number) => Promise<RollResult>
	// `which` picks between the gambler's two pending rolls where the bonus is
	// choose-of-two (5-6 players); omitted elsewhere.
	confirmRoll: (gameId: string, which?: 0 | 1) => Promise<RollResult>
	rerollDice: (gameId: string) => Promise<RollResult>
	endTurn: (gameId: string) => Promise<ActionResult>
	honk: (gameId: string) => Promise<ActionResult>
	sendMessage: (gameId: string, body: string) => Promise<ActionResult>
	// Finish your slot in a special build phase (5-6 player games). Pops you
	// off the build queue; advances to the next builder or the next roll.
	endSpecialBuild: (gameId: string) => Promise<ActionResult>

	// Take back your own last action, if it was solo and information-free
	// (`UNDOABLE_ACTIONS`). The edge function restores the pre-action snapshot
	// it stashed on `game_states.undo`; availability is read off that column,
	// never derived here. See `.claude/specs/undo.md`.
	undo: (gameId: string) => Promise<ActionResult>

	// Submit (`on`) or withdraw (`!on`) a standing forfeit / end-game vote.
	// Both are idempotent, and neither has any mechanical effect on the game —
	// only the thresholds read them (all seats but one forfeited → that seat
	// wins; every seat voting to end → the game is canceled with no winner).
	// See `.claude/specs/forfeit-and-end-game.md`.
	setForfeit: (gameId: string, on: boolean) => Promise<ActionResult>
	setEndVote: (gameId: string, on: boolean) => Promise<ActionResult>

	// `useBricklayer`: pay 4 Brick instead of the standard cost. Ignored by
	// the edge if the caller doesn't have the bricklayer bonus.
	// `smithSwap`: units of the cost's brick/ore component to pay in the other
	// resource (smith bonus). `fencePay`: when building on the fencer's own
	// reserved edge, pay 1 of this resource instead of 1 wood + 1 brick.
	buildRoad: (
		gameId: string,
		edge: string,
		opts?: {
			useBricklayer?: boolean
			smithSwap?: number
			fencePay?: 'wood' | 'brick'
		}
	) => Promise<ActionResult>
	buildSettlement: (
		gameId: string,
		vertex: string,
		opts?: { useBricklayer?: boolean; smithSwap?: number }
	) => Promise<ActionResult>
	buildCity: (
		gameId: string,
		vertex: string,
		opts?: {
			useBricklayer?: boolean
			swapDelta?: number
			smithSwap?: number
		}
	) => Promise<ActionResult>

	discard: (gameId: string, discard: ResourceHand) => Promise<ActionResult>
	moveRobber: (gameId: string, hex: string) => Promise<ActionResult>
	steal: (gameId: string, victim: number) => Promise<ActionResult>

	proposeTrade: (
		gameId: string,
		give: ResourceHand,
		receive: ResourceHand,
		to: number[]
	) => Promise<ActionResult & { offerId?: string }>
	acceptTrade: (gameId: string, offerId: string) => Promise<ActionResult>
	cancelTrade: (gameId: string, offerId: string) => Promise<ActionResult>
	rejectTrade: (gameId: string, offerId: string) => Promise<ActionResult>
	// Confirm mode only: the proposer executes the swap with one accepter
	// (`withIdx` = the accepted player's index).
	confirmTrade: (
		gameId: string,
		offerId: string,
		withIdx: number
	) => Promise<ActionResult>
	// The edge infers the rates: any combination of the caller's ports, the
	// bank, and their specialist / merchant bonuses that pays for the given
	// give/receive pair. `rates` comes back as the partition it charged.
	bankTrade: (
		gameId: string,
		give: ResourceHand,
		receive: ResourceHand
	) => Promise<ActionResult & { rates?: BankRate[] }>

	buyDevCard: (
		gameId: string,
		useBricklayer?: boolean,
		scoutSwap?: { from: Resource; to: Resource },
		smithSwap?: number
	) => Promise<ActionResult>
	playDevCard: (
		gameId: string,
		id: DevCardId,
		payload?: { r1?: Resource; r2?: Resource; resource?: Resource }
	) => Promise<ActionResult>

	// --- Set-2 bonus actions -------------------------------------------------

	// Metropolitan: build a city or super_city. `swapDelta` is the number of
	// wheat (0..2) to replace with extra ore in the cost; ignored for non-
	// metropolitan players. `useBricklayer` is mutually exclusive with the
	// swap (bricklayer doesn't apply to a metropolitan-discounted cost).
	buildSuperCity: (
		gameId: string,
		vertex: string,
		swapDelta?: number
	) => Promise<ActionResult>

	// Accountant: trade a piece back into resources.
	liquidate: (
		gameId: string,
		target:
			| { kind: 'road'; edge: string }
			| { kind: 'settlement'; vertex: string }
			| { kind: 'city'; vertex: string }
			| { kind: 'super_city'; vertex: string }
			| { kind: 'dev_card'; index: number }
	) => Promise<ActionResult>

	// Explorer: place one of the 3 free post-placement roads.
	placeExplorerRoad: (gameId: string, edge: string) => Promise<ActionResult>

	// Ritualist: choose a dice total (2..6, 8..12) by discarding cards.
	ritualRoll: (
		gameId: string,
		discard: ResourceHand,
		total: number
	) => Promise<ActionResult>

	// Shepherd: trade 2 sheep for 2 chosen resources at start of turn.
	shepherdSwap: (
		gameId: string,
		take: [Resource, Resource]
	) => Promise<ActionResult>

	// Curio collector: claim 3 chosen resources after a 2 or 12.
	claimCurio: (
		gameId: string,
		take: [Resource, Resource, Resource]
	) => Promise<ActionResult>

	// Forger: move the token to a vertex-adjacent hex, before rolling.
	moveForgerToken: (gameId: string, hex: Hex) => Promise<ActionResult>

	// Forger: pick which other player to copy from after the token's hex
	// produces.
	pickForgerTarget: (gameId: string, target: number) => Promise<ActionResult>

	// Scout: confirm which of the 3 peeked dev cards to keep.
	confirmScoutCard: (gameId: string, index: number) => Promise<ActionResult>

	// --- Set-3 bonus actions -------------------------------------------------

	// Fencer: place one of the 2 post-placement reserved-edge tokens.
	placeFenceToken: (gameId: string, edge: string) => Promise<ActionResult>

	// Haunt: secretly commit the two ghost-spawn locations at post-placement.
	setHauntSpots: (
		gameId: string,
		spots: [string, string]
	) => Promise<ActionResult>

	// Investor: set aside 3 of a resource for an investment token.
	invest: (gameId: string, resource: Resource) => Promise<ActionResult>

	// Magician: after your own roll, discard N+1 cards to also produce as if
	// `target` had rolled; or skip the window.
	castMagic: (
		gameId: string,
		target: number,
		discard: ResourceHand
	) => Promise<ActionResult>
	skipMagic: (gameId: string) => Promise<ActionResult>
}

function decodeInvited(raw: unknown): InvitedEntry[] {
	if (!Array.isArray(raw)) return []
	const out: InvitedEntry[] = []
	for (const el of raw) {
		if (
			el &&
			typeof el === 'object' &&
			typeof (el as { user?: unknown }).user === 'string' &&
			typeof (el as { status?: unknown }).status === 'string'
		) {
			const status = (el as { status: string }).status
			if (
				status === 'pending' ||
				status === 'accepted' ||
				status === 'rejected'
			) {
				out.push({
					user: (el as { user: string }).user,
					status,
				})
			}
		}
	}
	return out
}

export const useGamesStore = create<GamesStore>((set, get) => ({
	pendingRequests: undefined,
	activeGames: undefined,
	spectatableGames: undefined,
	completeGames: undefined,
	profilesById: {},
	meId: undefined,
	loading: false,

	async loadForUser(userId) {
		set({ loading: true, meId: userId })

		const requestsPromise = supabase
			.from('game_requests')
			.select('*')
			.order('created_at', { ascending: false })

		const activePromise = supabase
			.from('games')
			.select('*')
			.in('status', ['placement', 'active'])
			.order('created_at', { ascending: false })

		// Both ways a game can end share the History list — see `isFinished`.
		// Scoped to games I actually played in. Without this, the spectator
		// policy would drop every finished game I merely watched into History.
		const completePromise = supabase
			.from('games')
			.select('*')
			.in('status', ['complete', 'canceled'])
			.contains('participants', [userId])
			.order('created_at', { ascending: false })

		const [requestsRes, activeRes, completeRes] = await Promise.all([
			requestsPromise,
			activePromise,
			completePromise,
		])

		const pendingRequests: GameRequest[] = []
		if (requestsRes.data) {
			for (const row of requestsRes.data) {
				pendingRequests.push({
					...row,
					invited: decodeInvited(row.invited),
				})
			}
		}

		// The in-progress query now returns two different things: games I'm
		// seated at, and games I'm merely allowed to watch. One query, split
		// by participation.
		const inProgress: Game[] = activeRes.data ?? []
		const activeGames = inProgress.filter((g) =>
			g.participants.includes(userId)
		)
		let spectatableGames = inProgress.filter(
			(g) => !g.participants.includes(userId)
		)
		const completeGames: Game[] = completeRes.data ?? []

		const ids = new Set<string>()
		for (const r of pendingRequests) {
			ids.add(r.proposer)
			for (const inv of r.invited) ids.add(inv.user)
		}
		for (const g of activeGames) for (const p of g.participants) ids.add(p)
		for (const g of spectatableGames)
			for (const p of g.participants) ids.add(p)
		for (const g of completeGames)
			for (const p of g.participants) ids.add(p)
		ids.add(userId)

		const profilesById: Record<string, Profile> = {}
		if (ids.size > 0) {
			const { data: profiles } = await supabase
				.from('profiles')
				.select(PROFILE_COLS)
				.in('id', Array.from(ids))
			if (profiles) {
				for (const p of profiles) profilesById[p.id] = p
			}
		}

		// The Watch list surfaces a friend's co-players, who the viewer may
		// never have met — a first-contact surface, so it filters dev users in
		// production. Games I'm seated at are never filtered.
		if (!__DEV__) {
			spectatableGames = spectatableGames.filter((g) =>
				g.participants.every((p) => profilesById[p]?.dev !== true)
			)
		}

		set({
			pendingRequests,
			activeGames,
			spectatableGames,
			completeGames,
			profilesById,
			loading: false,
		})

		// Drop any actively-spectated game that's no longer watchable — one that
		// ended (or whose host unfriended the viewer) while the app was closed,
		// which never reached `handleGameChange`. Best-effort: no-ops until the
		// profile has loaded, and the next foreground resync catches up.
		useProfileStore
			.getState()
			.pruneSpectating(spectatableGames.map((g) => g.id))

		// Subscribe to game_requests and games changes for live updates.
		if (requestsChannel) supabase.removeChannel(requestsChannel)
		requestsChannel = supabase
			.channel(uniqueTopic('game_requests_rtu'))
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'game_requests' },
				(payload) => handleRequestChange(payload, get, set)
			)
			.subscribe()

		if (gamesChannel) supabase.removeChannel(gamesChannel)
		gamesChannel = supabase
			.channel(uniqueTopic('games_rtu'))
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'games' },
				(payload) => handleGameChange(payload, get, set)
			)
			.subscribe()
	},

	clear() {
		if (requestsChannel) {
			supabase.removeChannel(requestsChannel)
			requestsChannel = null
		}
		if (gamesChannel) {
			supabase.removeChannel(gamesChannel)
			gamesChannel = null
		}
		set({
			pendingRequests: undefined,
			activeGames: undefined,
			spectatableGames: undefined,
			completeGames: undefined,
			profilesById: {},
			meId: undefined,
			loading: false,
		})
	},

	async ensureProfiles(ids) {
		const known = get().profilesById
		const missing = Array.from(new Set(ids)).filter((id) => !known[id])
		if (missing.length === 0) return
		const { data: profiles } = await supabase
			.from('profiles')
			.select(PROFILE_COLS)
			.in('id', missing)
		if (!profiles || profiles.length === 0) return
		const next = { ...get().profilesById }
		for (const p of profiles) next[p.id] = p
		set({ profilesById: next })
	},

	async createRequest(_meId, invitedIds, config) {
		return callGameService(
			{
				action: 'propose_game',
				invited_user_ids: invitedIds,
				config,
			},
			"Couldn't create game"
		)
	},

	async pickBonus(gameId, bonus, curse) {
		return callGameService(
			{ action: 'pick_bonus', game_id: gameId, bonus, curse },
			"Couldn't pick bonus"
		)
	},

	async setSpecialistResource(gameId, resource) {
		return callGameService(
			{
				action: 'set_specialist_resource',
				game_id: gameId,
				resource,
			},
			"Couldn't set specialty"
		)
	},

	async buyCarpenterVP(gameId) {
		return callGameService(
			{ action: 'buy_carpenter_vp', game_id: gameId },
			"Couldn't buy VP"
		)
	},

	async tapKnight(gameId, r1, r2) {
		return callGameService(
			{ action: 'tap_knight', game_id: gameId, r1, r2 },
			"Couldn't tap knight"
		)
	},

	async respond(meId, requestId, accept) {
		const { error, data } = await callGameService(
			{ action: 'respond', request_id: requestId, accept },
			"Couldn't respond"
		)
		if (error) return { error }
		await get().loadForUser(meId)
		return { error: null, gameId: data.game_id as string | undefined }
	},

	async cancelRequest(meId, requestId) {
		const { error } = await callGameService(
			{ action: 'cancel_request', request_id: requestId },
			"Couldn't cancel game"
		)
		if (error) return { error }
		await get().loadForUser(meId)
		return { error: null }
	},

	async placeStart(gameId, placements) {
		return callGameService(
			{ action: 'place_start', game_id: gameId, placements },
			"Couldn't place"
		)
	},

	async chooseLastSettlement(gameId, vertex) {
		return callGameService(
			{ action: 'choose_last_settlement', game_id: gameId, vertex },
			"Couldn't choose settlement"
		)
	},

	async roll(gameId, forcedTotal) {
		const { error, data } = await callGameService(
			{ action: 'roll', game_id: gameId, total: forcedTotal },
			"Couldn't roll"
		)
		if (error) return { error }
		return {
			error: null,
			dice: data.dice as DiceRoll,
			total: data.total as number,
		}
	},

	async confirmRoll(gameId, which) {
		const { error, data } = await callGameService(
			{ action: 'confirm_roll', game_id: gameId, which },
			"Couldn't confirm roll"
		)
		if (error) return { error }
		return {
			error: null,
			dice: data.dice as DiceRoll,
			total: data.total as number,
		}
	},

	async rerollDice(gameId) {
		const { error, data } = await callGameService(
			{ action: 'reroll_dice', game_id: gameId },
			"Couldn't reroll"
		)
		if (error) return { error }
		return {
			error: null,
			dice: data.dice as DiceRoll,
			total: data.total as number,
		}
	},

	async endTurn(gameId) {
		return callGameService(
			{ action: 'end_turn', game_id: gameId },
			"Couldn't end turn"
		)
	},

	async honk(gameId) {
		return callGameService(
			{ action: 'honk', game_id: gameId },
			"Couldn't honk"
		)
	},

	async sendMessage(gameId, body) {
		return callGameService(
			{ action: 'send_message', game_id: gameId, body },
			"Couldn't send message"
		)
	},

	async endSpecialBuild(gameId) {
		return callGameService(
			{ action: 'end_special_build', game_id: gameId },
			"Couldn't finish building"
		)
	},

	async undo(gameId) {
		return callGameService(
			{ action: 'undo', game_id: gameId },
			"Couldn't undo"
		)
	},

	async setForfeit(gameId, on) {
		return callGameService(
			{ action: 'set_forfeit', game_id: gameId, on },
			on ? "Couldn't forfeit" : "Couldn't withdraw your forfeit"
		)
	},

	async setEndVote(gameId, on) {
		return callGameService(
			{ action: 'set_end_vote', game_id: gameId, on },
			on ? "Couldn't vote to end the game" : "Couldn't withdraw your vote"
		)
	},

	async buildRoad(gameId, edge, opts) {
		return callGameService(
			{
				action: 'build_road',
				game_id: gameId,
				edge,
				use_bricklayer: !!opts?.useBricklayer,
				smith_swap: opts?.smithSwap ?? 0,
				fence_pay: opts?.fencePay ?? null,
			},
			"Couldn't build road"
		)
	},

	async buildSettlement(gameId, vertex, opts) {
		return callGameService(
			{
				action: 'build_settlement',
				game_id: gameId,
				vertex,
				use_bricklayer: !!opts?.useBricklayer,
				smith_swap: opts?.smithSwap ?? 0,
			},
			"Couldn't build settlement"
		)
	},

	async buildCity(gameId, vertex, opts) {
		return callGameService(
			{
				action: 'build_city',
				game_id: gameId,
				vertex,
				use_bricklayer: !!opts?.useBricklayer,
				swap_wheat_to_ore: opts?.swapDelta ?? 0,
				smith_swap: opts?.smithSwap ?? 0,
			},
			"Couldn't build city"
		)
	},

	async discard(gameId, discard) {
		return callGameService(
			{ action: 'discard', game_id: gameId, discard },
			"Couldn't discard"
		)
	},

	async moveRobber(gameId, hex) {
		return callGameService(
			{ action: 'move_robber', game_id: gameId, hex },
			"Couldn't move robber"
		)
	},

	async steal(gameId, victim) {
		return callGameService(
			{ action: 'steal', game_id: gameId, victim },
			"Couldn't steal"
		)
	},

	async proposeTrade(gameId, give, receive, to) {
		const { error, data } = await callGameService(
			{
				action: 'propose_trade',
				game_id: gameId,
				give,
				receive,
				to,
			},
			"Couldn't propose trade"
		)
		if (error) return { error }
		return { error: null, offerId: data.offer_id as string | undefined }
	},

	async acceptTrade(gameId, offerId) {
		return callGameService(
			{ action: 'accept_trade', game_id: gameId, offer_id: offerId },
			"Couldn't accept trade"
		)
	},

	async cancelTrade(gameId, offerId) {
		return callGameService(
			{ action: 'cancel_trade', game_id: gameId, offer_id: offerId },
			"Couldn't cancel trade"
		)
	},

	async rejectTrade(gameId, offerId) {
		return callGameService(
			{ action: 'reject_trade', game_id: gameId, offer_id: offerId },
			"Couldn't reject trade"
		)
	},

	async confirmTrade(gameId, offerId, withIdx) {
		return callGameService(
			{
				action: 'confirm_trade',
				game_id: gameId,
				offer_id: offerId,
				with: withIdx,
			},
			"Couldn't confirm trade"
		)
	},

	async bankTrade(gameId, give, receive) {
		const { error, data } = await callGameService(
			{
				action: 'bank_trade',
				game_id: gameId,
				give,
				receive,
			},
			"Couldn't trade with bank"
		)
		if (error) return { error }
		return { error: null, rates: data.rates as BankRate[] | undefined }
	},

	async buyDevCard(gameId, useBricklayer, scoutSwap, smithSwap) {
		return callGameService(
			{
				action: 'buy_dev_card',
				game_id: gameId,
				use_bricklayer: !!useBricklayer,
				scout_swap: scoutSwap ?? null,
				smith_swap: smithSwap ?? 0,
			},
			"Couldn't buy dev card"
		)
	},

	async playDevCard(gameId, id, payload) {
		return callGameService(
			{
				action: 'play_dev_card',
				game_id: gameId,
				id,
				payload: payload ?? null,
			},
			"Couldn't play dev card"
		)
	},

	async buildSuperCity(gameId, vertex, swapDelta) {
		return callGameService(
			{
				action: 'build_super_city',
				game_id: gameId,
				vertex,
				swap_wheat_to_ore: swapDelta ?? 0,
			},
			"Couldn't upgrade to super city"
		)
	},

	async liquidate(gameId, target) {
		return callGameService(
			{ action: 'liquidate', game_id: gameId, target },
			"Couldn't liquidate"
		)
	},

	async placeExplorerRoad(gameId, edge) {
		return callGameService(
			{ action: 'place_explorer_road', game_id: gameId, edge },
			"Couldn't place explorer road"
		)
	},

	async ritualRoll(gameId, discard, total) {
		return callGameService(
			{ action: 'ritual_roll', game_id: gameId, discard, total },
			"Couldn't ritual roll"
		)
	},

	async shepherdSwap(gameId, take) {
		return callGameService(
			{ action: 'shepherd_swap', game_id: gameId, take },
			"Couldn't swap sheep"
		)
	},

	async claimCurio(gameId, take) {
		return callGameService(
			{ action: 'claim_curio', game_id: gameId, take },
			"Couldn't claim curio"
		)
	},

	async moveForgerToken(gameId, hex) {
		return callGameService(
			{ action: 'move_forger_token', game_id: gameId, hex },
			"Couldn't move forger token"
		)
	},

	async pickForgerTarget(gameId, target) {
		return callGameService(
			{ action: 'pick_forger_target', game_id: gameId, target },
			"Couldn't pick forger target"
		)
	},

	async confirmScoutCard(gameId, index) {
		return callGameService(
			{ action: 'confirm_scout_card', game_id: gameId, index },
			"Couldn't confirm scout card"
		)
	},

	async placeFenceToken(gameId, edge) {
		return callGameService(
			{ action: 'place_fence_token', game_id: gameId, edge },
			"Couldn't place fence token"
		)
	},

	async setHauntSpots(gameId, spots) {
		return callGameService(
			{ action: 'set_haunt_spots', game_id: gameId, spots },
			"Couldn't set haunt spots"
		)
	},

	async invest(gameId, resource) {
		return callGameService(
			{ action: 'invest', game_id: gameId, resource },
			"Couldn't invest"
		)
	},

	async castMagic(gameId, target, discard) {
		return callGameService(
			{ action: 'cast_magic', game_id: gameId, target, discard },
			"Couldn't cast magic"
		)
	},

	async skipMagic(gameId) {
		return callGameService(
			{ action: 'skip_magic', game_id: gameId },
			"Couldn't skip magic"
		)
	},
}))

function handleGameChange(
	payload: {
		eventType: string
		new: Record<string, unknown>
		old: Record<string, unknown>
	},
	get: () => GamesStore,
	set: (partial: Partial<GamesStore>) => void
) {
	const active = get().activeGames
	const spectatable = get().spectatableGames
	const complete = get().completeGames
	const meId = get().meId
	if (!active || !spectatable || !complete || !meId) return

	if (payload.eventType === 'DELETE') {
		const oldId = (payload.old as { id?: string }).id
		if (!oldId) return
		// A deleted game is no longer watchable, so it can't stay a tab.
		useProfileStore.getState().stopSpectating(oldId)
		set({
			activeGames: active.filter((g) => g.id !== oldId),
			spectatableGames: spectatable.filter((g) => g.id !== oldId),
			completeGames: complete.filter((g) => g.id !== oldId),
		})
		return
	}

	const incoming = payload.new as Game
	// An omitted column is an unchanged one, so merging the payload onto the row
	// we already hold is exact — and it keeps `events` out of the flash of
	// emptiness that replays a game's animations. See `isPartialGameRow`. With
	// no row to merge onto there is nothing to complete it with; drop it and let
	// the next full payload (or the foreground resync) bring the game in.
	const game = isPartialGameRow(payload.new)
		? mergePartialGame(incoming, active, spectatable, complete)
		: incoming
	if (!game) return
	// A game reaches this handler either because I'm seated at it or because
	// the spectator policy let it through; which list it belongs in follows
	// from participation, exactly as in loadForUser.
	const mine = game.participants.includes(meId)

	if (payload.eventType === 'INSERT') {
		if (isFinished(game.status)) {
			// A finished game I only watched never enters History.
			if (mine) set({ completeGames: [game, ...complete] })
		} else if (mine) {
			set({ activeGames: [game, ...active] })
		} else {
			set({ spectatableGames: [game, ...spectatable] })
		}
		return
	}

	// UPDATE — game may have moved from in-progress to finished.
	if (payload.eventType === 'UPDATE') {
		if (isFinished(game.status)) {
			// A game that ends stops being watchable; drop it from the viewer's
			// actively-spectating set so it doesn't linger as a stale tab. The
			// viewer already on the screen still sees the recap (the RLS policy
			// is status-agnostic), the tab just goes away.
			if (!mine) useProfileStore.getState().stopSpectating(game.id)
			set({
				activeGames: active.filter((g) => g.id !== game.id),
				// A game that ends stops being watchable; the spectator keeps
				// read access (the RLS policy is status-agnostic) so a viewer
				// already on the screen still sees the recap.
				spectatableGames: spectatable.filter((g) => g.id !== game.id),
				completeGames: mine
					? [game, ...complete.filter((g) => g.id !== game.id)]
					: complete,
			})
		} else if (mine) {
			set({
				activeGames: active.map((g) => (g.id === game.id ? game : g)),
			})
		} else {
			set({
				spectatableGames: spectatable.map((g) =>
					g.id === game.id ? game : g
				),
			})
		}
	}
}

// The row a partial payload describes, completed from the copy we already hold.
// `undefined` when we hold none — there is nothing to complete it with.
function mergePartialGame(
	incoming: Game,
	...lists: Game[][]
): Game | undefined {
	for (const list of lists) {
		const held = list.find((g) => g.id === incoming.id)
		if (held) return { ...held, ...incoming }
	}
	return undefined
}

async function handleRequestChange(
	payload: {
		eventType: string
		new: Record<string, unknown>
		old: Record<string, unknown>
	},
	get: () => GamesStore,
	set: (partial: Partial<GamesStore>) => void
) {
	const current = get().pendingRequests
	if (!current) return

	if (payload.eventType === 'DELETE') {
		const oldId = (payload.old as { id?: string }).id
		if (!oldId) return
		set({ pendingRequests: current.filter((r) => r.id !== oldId) })
		return
	}

	const raw = payload.new as GameRequestRow
	const decoded: GameRequest = {
		...raw,
		invited: decodeInvited(raw.invited),
	}

	if (payload.eventType === 'UPDATE') {
		set({
			pendingRequests: current.map((r) =>
				r.id === decoded.id ? decoded : r
			),
		})
		return
	}

	if (payload.eventType === 'INSERT') {
		await get().ensureProfiles([
			decoded.proposer,
			...decoded.invited.map((inv) => inv.user),
		])
		set({ pendingRequests: [decoded, ...(get().pendingRequests ?? [])] })
	}
}

/**
 * Whether a realtime UPDATE payload for a `games` row is missing columns.
 *
 * Postgres logical replication omits unchanged TOASTed columns from UPDATE
 * payloads, and `events` is the one column here that outgrows the TOAST
 * threshold — a few dozen turns in, every write that doesn't touch it arrives
 * without it. That is not rare: the post-action deadline stamp and the timeout
 * sweep's warning bump both write the `games` row and leave `events` alone, so
 * a partial payload follows practically every action in a game with a clock.
 *
 * `events` is `not null` in the schema, so an absent (`undefined`) value can
 * only mean the column was omitted, never a legitimate null. Applying such a
 * row wholesale empties `game.events` for a beat — long enough for the game
 * screen's animation cursors to re-seed at zero and then replay every steal,
 * nomad production and fortune-teller roll in the game when the full row lands.
 */
export function isPartialGameRow(row: Record<string, unknown>): boolean {
	return row.events === undefined
}

/**
 * Whether a game is over, whichever way it ended. A `canceled` game is one the
 * whole table voted to end: it has no winner, it contributes nothing to stats,
 * and it accepts no further action — but it shares History and the end-of-game
 * overlay with a completed one, so almost every status test wants this rather
 * than an equality check.
 */
export function isFinished(status: string): boolean {
	return status === 'complete' || status === 'canceled'
}

/**
 * Whether an in-progress game is waiting on `meId` — the "your turn" signal
 * behind the Games list dot, the game header's tab badge, and the app-icon
 * badge count.
 *
 * `games.current_turn` is the only turn field readable across games without
 * fetching each one's `game_states` row, which makes this approximate in two
 * known ways: during a special build phase `current_turn` has already advanced
 * to the next roller while the acting builder is the head of the phase queue,
 * and it is held `null` for the whole (simultaneous) bonus-selection phase, so
 * nobody reads as waiting there. Mirrored in `_notify`'s badge query.
 */
export function isMyTurn(game: Game, meId: string | undefined): boolean {
	if (!meId || game.current_turn === null) return false
	return game.player_order[game.current_turn] === meId
}

/**
 * Whether a game request is waiting on `meId` to accept or reject — the split
 * behind the Games tab (unheaded top section vs. `Pending`) and the tab-bar
 * dot. Everything else is waiting on somebody else: an invite I sent, one I
 * already answered, or one already killed by another invitee's reject.
 */
export function needsMyResponse(
	request: GameRequest,
	meId: string | undefined
): boolean {
	if (!meId) return false
	const mine = request.invited.find((i) => i.user === meId)
	if (!mine || mine.status !== 'pending') return false
	return !request.invited.some((i) => i.status === 'rejected')
}

export function describePendingRequest(
	request: GameRequest,
	meId: string | undefined,
	profilesById: Record<string, Profile>
): {
	label: string
	proposerProfile: Profile | undefined
	mineIsProposer: boolean
} {
	const mineIsProposer = !!meId && request.proposer === meId
	const proposerProfile = profilesById[request.proposer]

	if (mineIsProposer) {
		const names = request.invited
			.map((i) => profilesById[i.user]?.username ?? '…')
			.join(', ')
		return {
			label: names.length > 0 ? `Invite to ${names}` : 'Invite sent',
			proposerProfile,
			mineIsProposer,
		}
	}

	const label = proposerProfile
		? `${proposerProfile.username} invited you`
		: 'Game invite'
	return { label, proposerProfile, mineIsProposer }
}

export const gamesStoreRegistration: AutoLoadedStore = {
	name: 'games',
	loadForUser: (userId) => useGamesStore.getState().loadForUser(userId),
	clear: () => useGamesStore.getState().clear(),
}
