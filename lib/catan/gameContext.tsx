// Per-game context. Loads the games row (from the store / realtime) and the
// game_states row (fetched on mount + realtime), and exposes both through
// useGame() so descendants don't have to re-derive the same subscriptions.

import { useGamesStore, type Game } from '@/lib/stores/useGamesStore'
import { supabase } from '@/lib/supabase'
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react'
import { totalVP } from './dev'
import type { GameState } from './types'

export type GameContextValue = {
	game: Game | undefined
	gameState: GameState | undefined
	// True once both loads have resolved (whether or not they returned a row).
	ready: boolean
	// Per-player VP totals, indexed by player index. `publicVP` is what every
	// player can see (buildings + Largest Army + Longest Road). `selfVP` adds
	// the player's own hidden VP cards — use this for the viewer's own row
	// and for every row once the game is over (all hands revealed). Empty
	// when gameState is undefined. Centralized here so PlayerStrip /
	// PlayerDetailOverlay / GameOverOverlay can't drift on the calculation.
	publicVP: number[]
	selfVP: number[]
}

const GameContext = createContext<GameContextValue | null>(null)

export function useGame(): GameContextValue {
	const ctx = useContext(GameContext)
	if (!ctx) throw new Error('useGame must be used within <GameProvider>')
	return ctx
}

export function GameProvider({
	gameId,
	children,
}: {
	gameId: string
	children: ReactNode
}) {
	const activeGames = useGamesStore((s) => s.activeGames)
	const completeGames = useGamesStore((s) => s.completeGames)
	const storeReady = activeGames !== undefined && completeGames !== undefined

	const storeGame = useMemo(
		() =>
			(activeGames ?? []).find((g) => g.id === gameId) ??
			(completeGames ?? []).find((g) => g.id === gameId),
		[activeGames, completeGames, gameId]
	)

	const [liveGame, setLiveGame] = useState<Game | undefined>(storeGame)
	useEffect(() => {
		if (storeGame && !liveGame) setLiveGame(storeGame)
	}, [storeGame, liveGame])

	useEffect(() => {
		if (!gameId) return
		const channel = supabase
			.channel(`game:${gameId}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'games',
					filter: `id=eq.${gameId}`,
				},
				(payload) => setLiveGame(payload.new as Game)
			)
			.subscribe()
		return () => {
			supabase.removeChannel(channel)
		}
	}, [gameId])

	const [gameState, setGameState] = useState<GameState | undefined>()
	const [stateLoaded, setStateLoaded] = useState(false)
	useEffect(() => {
		if (!gameId) return
		let cancelled = false
		setStateLoaded(false)
		supabase
			.from('game_states')
			.select('*')
			.eq('game_id', gameId)
			.maybeSingle()
			.then(({ data }) => {
				if (cancelled) return
				setGameState(data ? rowToState(data) : undefined)
				setStateLoaded(true)
			})
		const channel = supabase
			.channel(`game_state:${gameId}`)
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'game_states',
					filter: `game_id=eq.${gameId}`,
				},
				(payload) => {
					if (payload.eventType === 'DELETE') {
						setGameState(undefined)
						return
					}
					setGameState(rowToState(payload.new))
				}
			)
			.subscribe()
		return () => {
			cancelled = true
			supabase.removeChannel(channel)
		}
	}, [gameId])

	const { publicVP, selfVP } = useMemo(() => {
		if (!gameState) return { publicVP: [], selfVP: [] }
		const pub = gameState.players.map((_, i) =>
			totalVP(gameState, i, false)
		)
		const self = gameState.players.map((_, i) =>
			totalVP(gameState, i, true)
		)
		return { publicVP: pub, selfVP: self }
	}, [gameState])

	const value = useMemo<GameContextValue>(
		() => ({
			game: liveGame ?? storeGame,
			gameState,
			ready: storeReady && stateLoaded,
			publicVP,
			selfVP,
		}),
		[
			liveGame,
			storeGame,
			gameState,
			storeReady,
			stateLoaded,
			publicVP,
			selfVP,
		]
	)

	return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

function rowToState(row: Record<string, unknown>): GameState {
	return {
		variant: row.variant as GameState['variant'],
		hexes: row.hexes as GameState['hexes'],
		vertices: DEV_DUMMY_PLACEMENTS
			? {
					...(row.vertices as GameState['vertices']),
					...DUMMY_VERTICES,
				}
			: (row.vertices as GameState['vertices']),
		edges: DEV_DUMMY_PLACEMENTS
			? {
					...(row.edges as GameState['edges']),
					...DUMMY_EDGES,
				}
			: (row.edges as GameState['edges']),
		players: row.players as GameState['players'],
		phase: row.phase as GameState['phase'],
		robber: row.robber as GameState['robber'],
		ports: (row.ports as GameState['ports']) ?? [],
		config: row.config as GameState['config'],
		devDeck: (row.dev_deck as GameState['devDeck']) ?? [],
		largestArmy: (row.largest_army as GameState['largestArmy']) ?? null,
		longestRoad: (row.longest_road as GameState['longestRoad']) ?? null,
		round: (row.round as GameState['round']) ?? 0,
	}
}

// Temporary: visual test data for building rendering. Remove once real
// placement flow lands.
const DEV_DUMMY_PLACEMENTS = false

const DUMMY_VERTICES: GameState['vertices'] = {
	'1A': { occupied: true, player: 0, building: 'settlement' },
	'1F': { occupied: true, player: 1, building: 'city' },
	'2D': { occupied: true, player: 2, building: 'settlement' },
	'3B': { occupied: true, player: 0, building: 'city' },
	'3H': { occupied: true, player: 1, building: 'settlement' },
	'4D': { occupied: true, player: 3, building: 'city' },
	'4I': { occupied: true, player: 2, building: 'settlement' },
	'5A': { occupied: true, player: 1, building: 'city' },
	'5F': { occupied: true, player: 3, building: 'settlement' },
	'6D': { occupied: true, player: 0, building: 'settlement' },
}

const DUMMY_EDGES: GameState['edges'] = {
	'1A - 1B': { occupied: true, player: 0 },
	'1E - 1F': { occupied: true, player: 1 },
	'2D - 2E': { occupied: true, player: 2 },
	'3A - 3B': { occupied: true, player: 0 },
	'3B - 3C': { occupied: true, player: 0 },
	'3H - 3I': { occupied: true, player: 1 },
	'4C - 4D': { occupied: true, player: 3 },
	'4D - 5C': { occupied: true, player: 3 },
	'4I - 4J': { occupied: true, player: 2 },
	'4B - 5A': { occupied: true, player: 1 },
	'5A - 5B': { occupied: true, player: 1 },
	'5F - 6E': { occupied: true, player: 3 },
	'6C - 6D': { occupied: true, player: 0 },
}
