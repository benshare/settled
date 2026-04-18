import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import type { Database } from './database-types'

const { supabaseUrl, supabasePublicKey } = Constants.expoConfig?.extra ?? {}

// expo-secure-store is native-only; on web fall back to localStorage.
const SecureStoreAdapter = {
	getItem: (key: string) => SecureStore.getItemAsync(key),
	setItem: (key: string, value: string) =>
		SecureStore.setItemAsync(key, value),
	removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

const LocalStorageAdapter = {
	getItem: (key: string) =>
		Promise.resolve(
			typeof window !== 'undefined'
				? window.localStorage.getItem(key)
				: null
		),
	setItem: (key: string, value: string) => {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(key, value)
		}
		return Promise.resolve()
	},
	removeItem: (key: string) => {
		if (typeof window !== 'undefined') {
			window.localStorage.removeItem(key)
		}
		return Promise.resolve()
	},
}

// Direct DOM check — independent of react-native's Platform module so we
// can't be tripped up by SSR/bundler quirks.
const isBrowser =
	typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const isNative = Platform.OS === 'ios' || Platform.OS === 'android'

const storage = {
	getItem: (key: string) =>
		isBrowser
			? LocalStorageAdapter.getItem(key)
			: isNative
				? SecureStoreAdapter.getItem(key)
				: Promise.resolve(null),
	setItem: (key: string, value: string) =>
		isBrowser
			? LocalStorageAdapter.setItem(key, value)
			: isNative
				? SecureStoreAdapter.setItem(key, value)
				: Promise.resolve(),
	removeItem: (key: string) =>
		isBrowser
			? LocalStorageAdapter.removeItem(key)
			: isNative
				? SecureStoreAdapter.removeItem(key)
				: Promise.resolve(),
}

export const supabase = createClient<Database>(supabaseUrl, supabasePublicKey, {
	auth: {
		storage,
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: false,
	},
})
