import * as SecureStore from 'expo-secure-store'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'

const { supabaseUrl, supabasePublicKey } = Constants.expoConfig?.extra ?? {}

const SecureStoreAdapter = {
	getItem: (key: string) => SecureStore.getItemAsync(key),
	setItem: (key: string, value: string) =>
		SecureStore.setItemAsync(key, value),
	removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

export const supabase = createClient(supabaseUrl, supabasePublicKey, {
	auth: {
		storage: SecureStoreAdapter,
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: false,
	},
})
