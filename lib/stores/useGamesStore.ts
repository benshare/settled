import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { Resource } from '../catan/board'
import type { BonusId } from '../catan/bonuses'
import type { DevCardId } from '../catan/devCards'
import type { DiceRoll, GameConfig, ResourceHand } from '../catan/types'
import type { Database } from '../database-types'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import type { Profile } from './useProfileStore'

type GameRow = Database['public']['Tables']['games']['Row']
type GameRequestRow = Database['public']['Tables']['game_requests']['Row']

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults'

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
	| {
			kind: 'rolled'
			player: number
			dice: [number, number]
			total: number
			at: string
	  }
	| { kind: 'turn_ended'; player: number; at: string }
	| { kind: 'road_built'; player: number; edge: string; at: string }
	| { kind: 'settlement_built'; player: number; vertex: string; at: string }
	| { kind: 'city_built'; player: number; vertex: string; at: string }
	| { kind: 'discarded'; player: number; count: number; at: string }
	| { kind: 'robber_moved'; player: number; hex: string; at: string }
	| { kind: 'stolen'; thief: number; victim: number; at: string }
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
			kind: 'bank_trade'
			player: number
			give: ResourceHand
			receive: ResourceHand
			ratio: 2 | 3 | 4
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

type ActionResult = { error: string | null }
type RespondResult = { error: string | null; gameId?: string }
type RollResult = ActionResult & { dice?: DiceRoll; total?: number }

type GamesStore = {
	pendingRequests: GameRequest[] | undefined
	activeGames: Game[] | undefined
	completeGames: Game[] | undefined
	profilesById: Record<string, Profile>
	loading: boolean

	loadForUser: (userId: string) => Promise<void>
	clear: () => void

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

	pickBonus: (gameId: string, bonus: BonusId) => Promise<ActionResult>

	placeSettlement: (gameId: string, vertex: string) => Promise<ActionResult>
	placeRoad: (gameId: string, edge: string) => Promise<ActionResult>

	roll: (gameId: string) => Promise<RollResult>
	endTurn: (gameId: string) => Promise<ActionResult>

	buildRoad: (gameId: string, edge: string) => Promise<ActionResult>
	buildSettlement: (gameId: string, vertex: string) => Promise<ActionResult>
	buildCity: (gameId: string, vertex: string) => Promise<ActionResult>

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
	bankTrade: (
		gameId: string,
		give: ResourceHand,
		receive: ResourceHand
	) => Promise<ActionResult & { ratio?: 2 | 3 | 4 }>

	buyDevCard: (gameId: string) => Promise<ActionResult>
	playDevCard: (
		gameId: string,
		id: DevCardId,
		payload?: { r1?: Resource; r2?: Resource; resource?: Resource }
	) => Promise<ActionResult>
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
	completeGames: undefined,
	profilesById: {},
	loading: false,

	async loadForUser(userId) {
		set({ loading: true })

		const requestsPromise = supabase
			.from('game_requests')
			.select('*')
			.order('created_at', { ascending: false })

		const activePromise = supabase
			.from('games')
			.select('*')
			.in('status', ['placement', 'active'])
			.order('created_at', { ascending: false })

		const completePromise = supabase
			.from('games')
			.select('*')
			.eq('status', 'complete')
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

		const activeGames: Game[] = activeRes.data ?? []
		const completeGames: Game[] = completeRes.data ?? []

		const ids = new Set<string>()
		for (const r of pendingRequests) {
			ids.add(r.proposer)
			for (const inv of r.invited) ids.add(inv.user)
		}
		for (const g of activeGames) for (const p of g.participants) ids.add(p)
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

		set({
			pendingRequests,
			activeGames,
			completeGames,
			profilesById,
			loading: false,
		})

		// Subscribe to game_requests and games changes for live updates.
		if (requestsChannel) supabase.removeChannel(requestsChannel)
		requestsChannel = supabase
			.channel('game_requests_rtu')
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'game_requests' },
				(payload) => handleRequestChange(payload, get, set)
			)
			.subscribe()

		if (gamesChannel) supabase.removeChannel(gamesChannel)
		gamesChannel = supabase
			.channel('games_rtu')
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
			completeGames: undefined,
			profilesById: {},
			loading: false,
		})
	},

	async createRequest(meId, invitedIds, config) {
		const { error } = await supabase.rpc('propose_game', {
			invited_user_ids: invitedIds,
			config,
		})
		return { error: error ? "Couldn't create game" : null }
	},

	async pickBonus(gameId, bonus) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'pick_bonus', game_id: gameId, bonus },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't pick bonus" }
		return { error: null }
	},

	async respond(meId, requestId, accept) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'respond', request_id: requestId, accept },
			}
		)
		if (error || !data?.ok) {
			return { error: "Couldn't respond" }
		}
		await get().loadForUser(meId)
		return { error: null, gameId: data.game_id }
	},

	async placeSettlement(gameId, vertex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'place_settlement', game_id: gameId, vertex },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't place settlement" }
		return { error: null }
	},

	async placeRoad(gameId, edge) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'place_road', game_id: gameId, edge },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't place road" }
		return { error: null }
	},

	async roll(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'roll', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't roll" }
		return { error: null, dice: data.dice, total: data.total }
	},

	async endTurn(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'end_turn', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't end turn" }
		return { error: null }
	},

	async buildRoad(gameId, edge) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'build_road', game_id: gameId, edge },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't build road" }
		return { error: null }
	},

	async buildSettlement(gameId, vertex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'build_settlement', game_id: gameId, vertex },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't build settlement" }
		return { error: null }
	},

	async buildCity(gameId, vertex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'build_city', game_id: gameId, vertex },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't build city" }
		return { error: null }
	},

	async discard(gameId, discard) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'discard', game_id: gameId, discard },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't discard" }
		return { error: null }
	},

	async moveRobber(gameId, hex) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'move_robber', game_id: gameId, hex },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't move robber" }
		return { error: null }
	},

	async steal(gameId, victim) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'steal', game_id: gameId, victim },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't steal" }
		return { error: null }
	},

	async proposeTrade(gameId, give, receive, to) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'propose_trade',
					game_id: gameId,
					give,
					receive,
					to,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't propose trade" }
		return { error: null, offerId: data.offer_id }
	},

	async acceptTrade(gameId, offerId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'accept_trade',
					game_id: gameId,
					offer_id: offerId,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't accept trade" }
		return { error: null }
	},

	async cancelTrade(gameId, offerId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'cancel_trade',
					game_id: gameId,
					offer_id: offerId,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't cancel trade" }
		return { error: null }
	},

	async bankTrade(gameId, give, receive) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'bank_trade',
					game_id: gameId,
					give,
					receive,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't trade with bank" }
		return { error: null, ratio: data.ratio }
	},

	async buyDevCard(gameId) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: { action: 'buy_dev_card', game_id: gameId },
			}
		)
		if (error || !data?.ok) return { error: "Couldn't buy dev card" }
		return { error: null }
	},

	async playDevCard(gameId, id, payload) {
		const { data, error } = await supabase.functions.invoke(
			'game-service',
			{
				body: {
					action: 'play_dev_card',
					game_id: gameId,
					id,
					payload: payload ?? null,
				},
			}
		)
		if (error || !data?.ok) return { error: "Couldn't play dev card" }
		return { error: null }
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
	const complete = get().completeGames
	if (!active || !complete) return

	if (payload.eventType === 'DELETE') {
		const oldId = (payload.old as { id?: string }).id
		if (!oldId) return
		set({
			activeGames: active.filter((g) => g.id !== oldId),
			completeGames: complete.filter((g) => g.id !== oldId),
		})
		return
	}

	const game = payload.new as Game

	if (payload.eventType === 'INSERT') {
		if (game.status === 'complete') {
			set({ completeGames: [game, ...complete] })
		} else {
			set({ activeGames: [game, ...active] })
		}
		return
	}

	// UPDATE — game may have moved from active to complete.
	if (payload.eventType === 'UPDATE') {
		if (game.status === 'complete') {
			set({
				activeGames: active.filter((g) => g.id !== game.id),
				completeGames: [
					game,
					...complete.filter((g) => g.id !== game.id),
				],
			})
		} else {
			set({
				activeGames: active.map((g) => (g.id === game.id ? game : g)),
			})
		}
	}
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
		// Fetch profiles for any user IDs we don't already have.
		const known = get().profilesById
		const missing: string[] = []
		if (!known[decoded.proposer]) missing.push(decoded.proposer)
		for (const inv of decoded.invited) {
			if (!known[inv.user]) missing.push(inv.user)
		}
		if (missing.length > 0) {
			const { data: profiles } = await supabase
				.from('profiles')
				.select(PROFILE_COLS)
				.in('id', missing)
			if (profiles) {
				const next = { ...get().profilesById }
				for (const p of profiles) next[p.id] = p
				set({ profilesById: next })
			}
		}
		set({ pendingRequests: [decoded, ...(get().pendingRequests ?? [])] })
	}
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
