import { Session, User } from '@supabase/supabase-js'
import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

type AuthContextType = {
	session: Session | null
	user: User | null
	isLoggedIn: boolean
	loading: boolean
	signInWithPhone: (phone: string) => Promise<{ error: string | null }>
	verifyOtp: (
		phone: string,
		token: string
	) => Promise<{ error: string | null; session: Session | null }>
	signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
	session: null,
	user: null,
	isLoggedIn: false,
	loading: true,
	signInWithPhone: async () => ({ error: null }),
	verifyOtp: async () => ({ error: null, session: null }),
	signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [session, setSession] = useState<Session | null>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		supabase.auth.getSession().then(({ data: { session } }) => {
			setSession(session)
			setLoading(false)
		})

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange((_event, session) => {
			setSession(session)
		})

		return () => subscription.unsubscribe()
	}, [])

	async function signInWithPhone(phone: string) {
		const { error } = await supabase.auth.signInWithOtp({ phone })
		return { error: error?.message ?? null }
	}

	async function verifyOtp(phone: string, token: string) {
		const { data, error } = await supabase.auth.verifyOtp({
			phone,
			token,
			type: 'sms',
		})
		return { error: error?.message ?? null, session: data.session }
	}

	async function signOut() {
		await supabase.auth.signOut()
	}

	const isLoggedIn = !!session
	const user = session?.user ?? null

	return (
		<AuthContext.Provider
			value={{
				session,
				user,
				isLoggedIn,
				loading,
				signInWithPhone,
				verifyOtp,
				signOut,
			}}
		>
			{children}
		</AuthContext.Provider>
	)
}

export const useAuth = () => useContext(AuthContext)
