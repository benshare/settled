// Which game-screen layout `app/game/[id].tsx` renders — the classic
// stacked-band screen or the full-bleed HUD. A device-local preference (not a
// synced account setting), persisted the same way as the theme so a choice
// survives relaunches, and toggled in-game from either overflow menu. Defaults
// to the HUD. Both layouts read the same providers, so switching is purely
// presentational. See `.claude/specs/game-hud.md`.

import * as SecureStore from 'expo-secure-store'
import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'
import { Platform } from 'react-native'

export type GameLayout = 'classic' | 'hud'

const DEFAULT_LAYOUT: GameLayout = 'hud'
const STORAGE_KEY = 'settled.gameLayout'

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

interface GameLayoutContextValue {
	layout: GameLayout
	setLayout: (layout: GameLayout) => void
	toggleLayout: () => void
}

const GameLayoutContext = createContext<GameLayoutContextValue>({
	layout: DEFAULT_LAYOUT,
	setLayout: () => {},
	toggleLayout: () => {},
})

export function GameLayoutProvider({ children }: { children: React.ReactNode }) {
	const [layout, setLayoutState] = useState<GameLayout>(DEFAULT_LAYOUT)

	useEffect(() => {
		readStored().then((stored) => {
			if (stored === 'classic' || stored === 'hud') setLayoutState(stored)
		})
	}, [])

	const setLayout = useCallback((next: GameLayout) => {
		setLayoutState(next)
		writeStored(next)
	}, [])

	const toggleLayout = useCallback(() => {
		setLayoutState((prev) => {
			const next: GameLayout = prev === 'hud' ? 'classic' : 'hud'
			writeStored(next)
			return next
		})
	}, [])

	const value = useMemo<GameLayoutContextValue>(
		() => ({ layout, setLayout, toggleLayout }),
		[layout, setLayout, toggleLayout]
	)

	return (
		<GameLayoutContext.Provider value={value}>
			{children}
		</GameLayoutContext.Provider>
	)
}

export function useGameLayout() {
	return useContext(GameLayoutContext)
}
