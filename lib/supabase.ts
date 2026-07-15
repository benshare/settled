import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { AppState, Platform } from 'react-native'
import type { Database } from './database-types'

const { supabaseUrl, supabasePublicKey } = Constants.expoConfig?.extra ?? {}

// These are baked into `extra` when app.config.js is evaluated, so a miss here
// means the config was built with no env. A missing SUPABASE_PROJECT_ID leaves
// the literal "https://undefined.supabase.co" (truthy), so check for that too.
// Fail loudly: `eas update` does not load .env, so publishing OTA without
// `--environment production` produces a bundle that crashes at launch, which
// expo-updates then blacklists per-device and reverts to the embedded build.
if (!supabaseUrl || !supabasePublicKey || supabaseUrl.includes('undefined')) {
	throw new Error(
		'[supabase] Missing SUPABASE_PROJECT_ID / SUPABASE_PUBLIC_KEY. Locally: copy .env.example to .env. On EAS: publish with `--environment production` (see the "ota" script) and check `eas env:list --environment production`.'
	)
}

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

// The refresh timer can't run while the app is suspended, and a token that
// expires in the background leaves realtime unable to rejoin its channels on
// reconnect. Drive it off AppState instead (per the Supabase RN docs). Separate
// from `lib/appState.ts` on purpose: this one reacts to every state change,
// including `inactive`, and must not depend on React.
if (isNative) {
	AppState.addEventListener('change', (state) => {
		if (state === 'active') supabase.auth.startAutoRefresh()
		else supabase.auth.stopAutoRefresh()
	})
}
