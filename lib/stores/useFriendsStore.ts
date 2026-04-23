import { create } from 'zustand'
import type { Database } from '../database-types'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import type { Profile } from './useProfileStore'

type FriendRequest = Database['public']['Tables']['friend_requests']['Row']

const PROFILE_COLS =
	'id, username, avatar_path, created_at, updated_at, dev, game_defaults'

// In production builds, exclude profiles flagged `dev = true` from user-facing
// lists. See lib/stores/CLAUDE.md for the full convention.
const HIDE_DEV_PROFILES = !__DEV__

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
	acceptRequest: (meId: string, requestId: string) => Promise<ActionResult>
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
	},

	clear() {
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
		await get().loadForUser(meId)
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

	async acceptRequest(meId, requestId) {
		const { error } = await supabase.rpc('accept_friend_request', {
			request_id: requestId,
		})
		if (error) {
			return { error: "Couldn't accept request" }
		}
		await get().loadForUser(meId)
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

export const friendsStoreRegistration: AutoLoadedStore = {
	name: 'friends',
	loadForUser: (userId) => useFriendsStore.getState().loadForUser(userId),
	clear: () => useFriendsStore.getState().clear(),
}
