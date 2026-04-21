import * as SecureStore from 'expo-secure-store'
import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'
import { Platform, useColorScheme } from 'react-native'
import { ColorScheme, darkColors, lightColors } from './theme'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'settled.theme'

function readStored(): Promise<string | null> {
	if (Platform.OS === 'web') {
		if (typeof window === 'undefined') return Promise.resolve(null)
		return Promise.resolve(window.localStorage.getItem(STORAGE_KEY))
	}
	return SecureStore.getItemAsync(STORAGE_KEY)
}

function writeStored(value: string): Promise<void> {
	if (Platform.OS === 'web') {
		if (typeof window !== 'undefined') {
			window.localStorage.setItem(STORAGE_KEY, value)
		}
		return Promise.resolve()
	}
	return SecureStore.setItemAsync(STORAGE_KEY, value)
}

interface ThemeContextValue {
	colors: ColorScheme
	mode: ThemeMode
	resolved: 'light' | 'dark'
	setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue>({
	colors: lightColors,
	mode: 'system',
	resolved: 'light',
	setMode: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const systemScheme = useColorScheme()
	const [mode, setModeState] = useState<ThemeMode>('system')

	useEffect(() => {
		readStored().then((stored) => {
			if (
				stored === 'light' ||
				stored === 'dark' ||
				stored === 'system'
			) {
				setModeState(stored)
			}
		})
	}, [])

	const setMode = useCallback((next: ThemeMode) => {
		setModeState(next)
		writeStored(next)
	}, [])

	const resolved: 'light' | 'dark' =
		mode === 'system' ? (systemScheme ?? 'light') : mode
	const colors = resolved === 'dark' ? darkColors : lightColors

	const value = useMemo<ThemeContextValue>(
		() => ({ colors, mode, resolved, setMode }),
		[colors, mode, resolved, setMode]
	)

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	)
}

export function useTheme() {
	return useContext(ThemeContext)
}
