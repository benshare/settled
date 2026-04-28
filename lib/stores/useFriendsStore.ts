import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { Database } from '../database-types'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import type { Profile } from './useProfileStore'

type FriendRequest = Database['public']['Tables']['friend_requests']['Row']
type FriendRow = Database['public']['Tables']['friends']['Row']

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults'

// In production builds, exclude profiles flagged `dev = true` from user-facing
// lists. See lib/stores/CLAUDE.md for the full convention.
const HIDE_DEV_PROFILES = !__DEV__

let requestsChannel: RealtimeChannel | null = null
let friendsChannel: RealtimeChannel | null = null

export type FriendEntry = {
	otherId: string
	profile: Profile
	time_added: string
}

export type IncomingRequest = {
	request: FriendRequest
	profile: Profile
}

export type OutgoingRequest = {
	request: FriendRequest
	profile: Profile
}

export type SearchRelationship = 'none' | 'pending' | 'declined' | 'friends'

export type SearchResult = {
	profile: Profile
	relationship: SearchRelationship
}

type ActionResult = { error: string | null }

type FriendsStore = {
	friends: FriendEntry[]
	pendingIncoming: IncomingRequest[]
	pendingOutgoing: OutgoingRequest[]
	loading: boolean

	loadForUser: (userId: string) => Promise<void>
	clear: () => void

	sendRequest: (meId: string, targetId: string) => Promise<ActionResult>
	cancelRequest: (requestId: string) => Promise<ActionResult>
	acceptRequest: (requestId: string) => Promise<ActionResult>
	rejectRequest: (requestId: string) => Promise<ActionResult>

	search: (meId: string, query: string) => Promise<SearchResult[]>
}

export const useFriendsStore = create<FriendsStore>((set, get) => ({
	friends: [],
	pendingIncoming: [],
	pendingOutgoing: [],
	loading: false,

	async loadForUser(userId) {
		set({ loading: true })

		const friendsPromise = supabase
			.from('friends')
			.select(
				`user_id_a, user_id_b, time_added,
				a:profiles!friends_user_id_a_profiles_fkey(${PROFILE_COLS}),
				b:profiles!friends_user_id_b_profiles_fkey(${PROFILE_COLS})`
			)
			.or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)

		const incomingPromise = supabase
			.from('friend_requests')
			.select(
				`*, sender:profiles!friend_requests_sender_profiles_fkey(${PROFILE_COLS})`
			)
			.eq('receiver_id', userId)
			.eq('status', 'pending')

		const outgoingPromise = supabase
			.from('friend_requests')
			.select(
				`*, receiver:profiles!friend_requests_receiver_profiles_fkey(${PROFILE_COLS})`
			)
			.eq('sender_id', userId)
			.eq('status', 'pending')

		const [friendsRes, incomingRes, outgoingRes] = await Promise.all([
			friendsPromise,
			incomingPromise,
			outgoingPromise,
		])

		const friends: FriendEntry[] = []
		if (friendsRes.data) {
			for (const row of friendsRes.data) {
				const other =
					row.user_id_a === userId
						? (row.b as Profile | null)
						: (row.a as Profile | null)
				if (!other) continue
				if (HIDE_DEV_PROFILES && other.dev) continue
				friends.push({
					otherId: other.id,
					profile: other,
					time_added: row.time_added,
				})
			}
		}

		const pendingIncoming: IncomingRequest[] = []
		if (incomingRes.data) {
			for (const row of incomingRes.data) {
				const {
					sender,
					...request
				}: FriendRequest & { sender: Profile | null } = row as never
				if (!sender) continue
				if (HIDE_DEV_PROFILES && sender.dev) continue
				pendingIncoming.push({ request, profile: sender })
			}
		}

		const pendingOutgoing: OutgoingRequest[] = []
		if (outgoingRes.data) {
			for (const row of outgoingRes.data) {
				const {
					receiver,
					...request
				}: FriendRequest & { receiver: Profile | null } = row as never
				if (!receiver) continue
				if (HIDE_DEV_PROFILES && receiver.dev) continue
				pendingOutgoing.push({ request, profile: receiver })
			}
		}

		set({
			friends,
			pendingIncoming,
			pendingOutgoing,
			loading: false,
		})

		if (requestsChannel) supabase.removeChannel(requestsChannel)
		requestsChannel = supabase
			.channel('friend_requests_rtu')
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'friend_requests' },
				(payload) => handleRequestChange(payload, userId, get, set)
			)
			.subscribe()

		if (friendsChannel) supabase.removeChannel(friendsChannel)
		friendsChannel = supabase
			.channel('friends_rtu')
			.on(
				'postgres_changes',
				{ event: '*', schema: 'public', table: 'friends' },
				(payload) => handleFriendChange(payload, userId, get, set)
			)
			.subscribe()
	},

	clear() {
		if (requestsChannel) {
			supabase.removeChannel(requestsChannel)
			requestsChannel = null
		}
		if (friendsChannel) {
			supabase.removeChannel(friendsChannel)
			friendsChannel = null
		}
		set({
			friends: [],
			pendingIncoming: [],
			pendingOutgoing: [],
			loading: false,
		})
	},

	async sendRequest(meId, targetId) {
		const { error } = await supabase
			.from('friend_requests')
			.insert({ sender_id: meId, receiver_id: targetId })
		if (error) {
			return { error: "Couldn't send request" }
		}
		return { error: null }
	},

	async cancelRequest(requestId) {
		const { error } = await supabase
			.from('friend_requests')
			.delete()
			.eq('id', requestId)
		if (error) {
			return { error: "Couldn't cancel request" }
		}
		set({
			pendingOutgoing: get().pendingOutgoing.filter(
				(r) => r.request.id !== requestId
			),
		})
		return { error: null }
	},

	async acceptRequest(requestId) {
		const { error } = await supabase.rpc('accept_friend_request', {
			request_id: requestId,
		})
		if (error) {
			return { error: "Couldn't accept request" }
		}
		set({
			pendingIncoming: get().pendingIncoming.filter(
				(r) => r.request.id !== requestId
			),
		})
		return { error: null }
	},

	async rejectRequest(requestId) {
		const { error } = await supabase
			.from('friend_requests')
			.update({ status: 'rejected' })
			.eq('id', requestId)
		if (error) {
			return { error: "Couldn't reject request" }
		}
		set({
			pendingIncoming: get().pendingIncoming.filter(
				(r) => r.request.id !== requestId
			),
		})
		return { error: null }
	},

	async search(meId, query) {
		const trimmed = query.trim()
		if (trimmed.length < 2) return []

		let profilesQuery = supabase
			.from('profiles')
			.select(PROFILE_COLS)
			.ilike('username', `%${trimmed}%`)
			.neq('id', meId)
		if (HIDE_DEV_PROFILES) {
			profilesQuery = profilesQuery.eq('dev', false)
		}
		const { data: profiles } = await profilesQuery
			.order('username', { ascending: true })
			.limit(20)

		if (!profiles || profiles.length === 0) return []
		const ids = profiles.map((p) => p.id)
		const idList = ids.join(',')

		const friendsPromise = supabase
			.from('friends')
			.select('user_id_a, user_id_b')
			.or(
				`and(user_id_a.eq.${meId},user_id_b.in.(${idList})),` +
					`and(user_id_b.eq.${meId},user_id_a.in.(${idList}))`
			)

		const requestsPromise = supabase
			.from('friend_requests')
			.select('sender_id, receiver_id, status')
			.or(
				`and(sender_id.eq.${meId},receiver_id.in.(${idList})),` +
					`and(receiver_id.eq.${meId},sender_id.in.(${idList}))`
			)

		const [friendsRes, requestsRes] = await Promise.all([
			friendsPromise,
			requestsPromise,
		])

		const friendIds = new Set<string>()
		for (const f of friendsRes.data ?? []) {
			friendIds.add(f.user_id_a === meId ? f.user_id_b : f.user_id_a)
		}

		const pendingIds = new Set<string>()
		const declinedIds = new Set<string>()
		for (const r of requestsRes.data ?? []) {
			const otherId = r.sender_id === meId ? r.receiver_id : r.sender_id
			if (r.status === 'rejected' && r.receiver_id === meId) {
				declinedIds.add(otherId)
			} else {
				pendingIds.add(otherId)
			}
		}

		return profiles.map<SearchResult>((profile) => ({
			profile,
			relationship: friendIds.has(profile.id)
				? 'friends'
				: declinedIds.has(profile.id)
					? 'declined'
					: pendingIds.has(profile.id)
						? 'pending'
						: 'none',
		}))
	},
}))

async function handleRequestChange(
	payload: {
		eventType: string
		new: Record<string, unknown>
		old: Record<string, unknown>
	},
	meId: string,
	get: () => FriendsStore,
	set: (partial: Partial<FriendsStore>) => void
) {
	if (payload.eventType === 'DELETE') {
		const oldId = (payload.old as { id?: string }).id
		if (!oldId) return
		set({
			pendingIncoming: get().pendingIncoming.filter(
				(r) => r.request.id !== oldId
			),
			pendingOutgoing: get().pendingOutgoing.filter(
				(r) => r.request.id !== oldId
			),
		})
		return
	}

	const row = payload.new as FriendRequest

	if (payload.eventType === 'UPDATE') {
		if (row.status !== 'pending') {
			set({
				pendingIncoming: get().pendingIncoming.filter(
					(r) => r.request.id !== row.id
				),
				pendingOutgoing: get().pendingOutgoing.filter(
					(r) => r.request.id !== row.id
				),
			})
		}
		return
	}

	if (payload.eventType === 'INSERT') {
		if (row.status !== 'pending') return

		const otherId = row.sender_id === meId ? row.receiver_id : row.sender_id
		const { data: profile } = await supabase
			.from('profiles')
			.select(PROFILE_COLS)
			.eq('id', otherId)
			.maybeSingle()
		if (!profile) return
		if (HIDE_DEV_PROFILES && profile.dev) return

		if (row.receiver_id === meId) {
			const existing = get().pendingIncoming
			if (existing.some((r) => r.request.id === row.id)) return
			set({
				pendingIncoming: [{ request: row, profile }, ...existing],
			})
		} else if (row.sender_id === meId) {
			const existing = get().pendingOutgoing
			if (existing.some((r) => r.request.id === row.id)) return
			set({
				pendingOutgoing: [{ request: row, profile }, ...existing],
			})
		}
	}
}

async function handleFriendChange(
	payload: {
		eventType: string
		new: Record<string, unknown>
		old: Record<string, unknown>
	},
	meId: string,
	get: () => FriendsStore,
	set: (partial: Partial<FriendsStore>) => void
) {
	if (payload.eventType === 'DELETE') {
		const old = payload.old as Partial<FriendRow>
		if (!old.user_id_a || !old.user_id_b) return
		const otherId = old.user_id_a === meId ? old.user_id_b : old.user_id_a
		set({
			friends: get().friends.filter((f) => f.otherId !== otherId),
		})
		return
	}

	if (payload.eventType !== 'INSERT') return

	const row = payload.new as FriendRow
	if (row.user_id_a !== meId && row.user_id_b !== meId) return
	const otherId = row.user_id_a === meId ? row.user_id_b : row.user_id_a

	if (get().friends.some((f) => f.otherId === otherId)) return

	const { data: profile } = await supabase
		.from('profiles')
		.select(PROFILE_COLS)
		.eq('id', otherId)
		.maybeSingle()
	if (!profile) return
	if (HIDE_DEV_PROFILES && profile.dev) return

	set({
		friends: [
			{ otherId, profile, time_added: row.time_added },
			...get().friends,
		],
	})
}

export const friendsStoreRegistration: AutoLoadedStore = {
	name: 'friends',
	loadForUser: (userId) => useFriendsStore.getState().loadForUser(userId),
	clear: () => useFriendsStore.getState().clear(),
}
