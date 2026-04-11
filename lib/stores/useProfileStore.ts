import { create } from 'zustand'
import type { Database } from '../database-types'
import { supabase } from '../supabase'

export type Profile = Database['public']['Tables']['profiles']['Row']

type UpdateResult = { error: string | null }

type ProfileStore = {
	profile: Profile | null
	loading: boolean
	loadProfile: (userId: string) => Promise<Profile | null>
	clearProfile: () => void
	updateUsername: (username: string) => Promise<UpdateResult>
	updateAvatarPath: (path: string | null) => Promise<UpdateResult>
}

export const useProfileStore = create<ProfileStore>((set, get) => ({
	profile: null,
	loading: false,

	async loadProfile(userId) {
		set({ loading: true })
		const { data, error } = await supabase
			.from('profiles')
			.select('id, username, avatar_path, created_at, updated_at')
			.eq('id', userId)
			.maybeSingle()
		set({ loading: false })

		if (error || !data) {
			set({ profile: null })
			return null
		}

		const profile = data as Profile
		set({ profile })
		return profile
	},

	clearProfile() {
		set({ profile: null })
	},

	async updateUsername(username) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const { data, error } = await supabase
			.from('profiles')
			.update({ username })
			.eq('id', current.id)
			.select('id, username, avatar_path, created_at, updated_at')
			.single()

		if (error) {
			if (error.code === '23505') {
				return { error: 'Username already taken' }
			}
			return { error: 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},

	async updateAvatarPath(path) {
		const current = get().profile
		if (!current) return { error: 'No profile loaded' }

		const { data, error } = await supabase
			.from('profiles')
			.update({ avatar_path: path })
			.eq('id', current.id)
			.select('id, username, avatar_path, created_at, updated_at')
			.single()

		if (error) {
			return { error: 'Something went wrong' }
		}

		set({ profile: data as Profile })
		return { error: null }
	},
}))
