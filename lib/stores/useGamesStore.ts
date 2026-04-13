import { create } from 'zustand'
import type { Database } from '../database-types'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import type { Profile } from './useProfileStore'

type GameRow = Database['public']['Tables']['games']['Row']
type GameRequestRow = Database['public']['Tables']['game_requests']['Row']

const PROFILE_COLS = 'id, username, avatar_path, created_at, updated_at, dev'

export type InvitedEntry = {
	user: string
	status: 'pending' | 'accepted' | 'rejected'
}

export type GameRequest = Omit<GameRequestRow, 'invited'> & {
	invited: InvitedEntry[]
}

export type Game = GameRow

type ActionResult = { error: string | null }

type GamesStore = {
	pendingRequests: GameRequest[]
	activeGames: Game[]
	completeGames: Game[]
	profilesById: Record<string, Profile>
	loading: boolean

	loadForUser: (userId: string) => Promise<void>
	clear: () => void

	createRequest: (meId: string, invitedIds: string[]) => Promise<ActionResult>
	respond: (
		meId: string,
		requestId: string,
		accept: boolean
	) => Promise<ActionResult>
	complete: (meId: string, gameId: string) => Promise<ActionResult>
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
	pendingRequests: [],
	activeGames: [],
	completeGames: [],
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
			.eq('status', 'active')
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
	},

	clear() {
		set({
			pendingRequests: [],
			activeGames: [],
			completeGames: [],
			profilesById: {},
			loading: false,
		})
	},

	async createRequest(meId, invitedIds) {
		const { error } = await supabase.rpc('propose_game', {
			invited_user_ids: invitedIds,
		})
		return { error: error ? "Couldn't create game" : null }
	},

	async respond(meId, requestId, accept) {
		const { error } = await supabase.rpc('respond_to_game_request', {
			request_id: requestId,
			accept,
		})
		if (error) {
			return { error: "Couldn't respond" }
		}
		await get().loadForUser(meId)
		return { error: null }
	},

	async complete(meId, gameId) {
		const { error } = await supabase.rpc('complete_game', {
			game_id: gameId,
		})
		if (error) {
			return { error: "Couldn't complete game" }
		}
		await get().loadForUser(meId)
		return { error: null }
	},
}))

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
