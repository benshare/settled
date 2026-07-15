// Per-game context. Loads the games row (from the store / realtime) and the
// game_states row (fetched on mount + realtime), and exposes both through
// useGame() so descendants don't have to re-derive the same subscriptions.

import { useAppForeground } from '@/lib/appState'
import { onGameMutated } from '@/lib/gameSync'
import { uniqueTopic } from '@/lib/realtime'
import { useGamesStore, type Game } from '@/lib/stores/useGamesStore'
import { supabase } from '@/lib/supabase'
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
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

	// Nothing that happened while the app was backgrounded reached these
	// channels — the socket was closed and realtime doesn't replay. Bumping the
	// nonce on foreground re-runs both effects, which re-fetch their row and
	// re-subscribe.
	const [resyncNonce, setResyncNonce] = useState(0)
	useAppForeground(() => setResyncNonce((n) => n + 1))

	const [gameState, setGameState] = useState<GameState | undefined>()
	const [stateLoaded, setStateLoaded] = useState(false)

	// A fetch in flight when the game changes must not land on the new game.
	const currentId = useRef(gameId)
	useEffect(() => {
		currentId.current = gameId
	}, [gameId])

	const fetchGame = useCallback(async () => {
		const { data } = await supabase
			.from('games')
			.select('*')
			.eq('id', gameId)
			.maybeSingle()
		if (currentId.current !== gameId || !data) return
		setLiveGame(data as Game)
	}, [gameId])

	const fetchState = useCallback(async () => {
		const { data } = await supabase
			.from('game_states')
			.select('*')
			.eq('game_id', gameId)
			.maybeSingle()
		if (currentId.current !== gameId) return
		setGameState(data ? rowToState(data) : undefined)
		setStateLoaded(true)
	}, [gameId])

	// A move we made ourselves is confirmed by the edge function's response, so
	// the board advances on that rather than on a channel that may have quietly
	// died. See lib/gameSync.ts.
	useEffect(() => {
		if (!gameId) return
		return onGameMutated(gameId, () => {
			fetchGame()
			fetchState()
		})
	}, [gameId, fetchGame, fetchState])

	useEffect(() => {
		if (!gameId) return
		const channel = supabase
			.channel(uniqueTopic(`game:${gameId}`))
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
			// Fetching and joining race each other, and an event landing between
			// the fetch's snapshot and the join is delivered to nobody. Reading
			// once the channel is live closes that gap — on the first join and on
			// every automatic rejoin after a dropped connection.
			.subscribe((status) => {
				if (status === 'SUBSCRIBED') fetchGame()
			})
		fetchGame()
		return () => {
			supabase.removeChannel(channel)
		}
	}, [gameId, resyncNonce, fetchGame])

	// Only a change of game empties the board. A resync re-fetches in place, so
	// foregrounding doesn't flash back to the loading state.
	useEffect(() => {
		setGameState(undefined)
		setStateLoaded(false)
	}, [gameId])

	useEffect(() => {
		if (!gameId) return
		const channel = supabase
			.channel(uniqueTopic(`game_state:${gameId}`))
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
					// Postgres logical replication omits unchanged TOASTed
					// columns from UPDATE payloads, so a write that only
					// touches `phase` (propose / reject / cancel a trade)
					// arrives with the large jsonb blobs (players, hexes,
					// vertices, edges) absent. Feeding that straight into
					// rowToState strands the board with undefined players
					// and crashes VP computation. Re-read the full row
					// instead whenever the payload is partial.
					if (isPartialStateRow(payload.new)) {
						fetchState()
						return
					}
					setGameState(rowToState(payload.new))
				}
			)
			.subscribe((status) => {
				if (status === 'SUBSCRIBED') fetchState()
			})
		fetchState()
		return () => {
			supabase.removeChannel(channel)
		}
	}, [gameId, resyncNonce, fetchState])

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

// A realtime UPDATE payload is partial when Postgres dropped unchanged TOASTed
// columns (see the game_states subscription). These blobs are `not null` in the
// schema, so an absent (`undefined`) value can only mean the column was omitted
// — never a legitimate null. Any one missing makes rowToState unsafe.
function isPartialStateRow(row: Record<string, unknown>): boolean {
	return (
		row.players === undefined ||
		row.hexes === undefined ||
		row.vertices === undefined ||
		row.edges === undefined
	)
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
	'1A': { occupied: true, player: 0, building: 'settlement', placedTurn: 0 },
	'1F': { occupied: true, player: 1, building: 'city', placedTurn: 0 },
	'2D': { occupied: true, player: 2, building: 'settlement', placedTurn: 0 },
	'3B': { occupied: true, player: 0, building: 'city', placedTurn: 0 },
	'3H': { occupied: true, player: 1, building: 'settlement', placedTurn: 0 },
	'4D': { occupied: true, player: 3, building: 'city', placedTurn: 0 },
	'4I': { occupied: true, player: 2, building: 'settlement', placedTurn: 0 },
	'5A': { occupied: true, player: 1, building: 'city', placedTurn: 0 },
	'5F': { occupied: true, player: 3, building: 'settlement', placedTurn: 0 },
	'6D': { occupied: true, player: 0, building: 'settlement', placedTurn: 0 },
}

const DUMMY_EDGES: GameState['edges'] = {
	'1A - 1B': { occupied: true, player: 0, placedTurn: 0 },
	'1E - 1F': { occupied: true, player: 1, placedTurn: 0 },
	'2D - 2E': { occupied: true, player: 2, placedTurn: 0 },
	'3A - 3B': { occupied: true, player: 0, placedTurn: 0 },
	'3B - 3C': { occupied: true, player: 0, placedTurn: 0 },
	'3H - 3I': { occupied: true, player: 1, placedTurn: 0 },
	'4C - 4D': { occupied: true, player: 3, placedTurn: 0 },
	'4D - 5C': { occupied: true, player: 3, placedTurn: 0 },
	'4I - 4J': { occupied: true, player: 2, placedTurn: 0 },
	'4B - 5A': { occupied: true, player: 1, placedTurn: 0 },
	'5A - 5B': { occupied: true, player: 1, placedTurn: 0 },
	'5F - 6E': { occupied: true, player: 3, placedTurn: 0 },
	'6C - 6D': { occupied: true, player: 0, placedTurn: 0 },
}
