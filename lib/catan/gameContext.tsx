// Per-game context. Loads the games row (from the store / realtime) and the
// game_states row (fetched on mount + realtime), and exposes both through
// useGame() so descendants don't have to re-derive the same subscriptions.

import { useAppForeground } from '@/lib/appState'
import { useAuth } from '@/lib/auth'
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
	// True when the viewer is watching a game they aren't seated at. False
	// until `game` resolves, so a spectator never briefly renders as a player.
	// Every consumer reads it from here rather than re-deriving, so the board
	// and the chat can't disagree about who is watching.
	isSpectator: boolean
	// User ids of the spectators currently on this game's screen, from an
	// ephemeral presence channel. Players see it too — that's the point.
	watcherIds: string[]
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
	const { user } = useAuth()
	const activeGames = useGamesStore((s) => s.activeGames)
	const spectatableGames = useGamesStore((s) => s.spectatableGames)
	const completeGames = useGamesStore((s) => s.completeGames)
	const storeReady = activeGames !== undefined && completeGames !== undefined

	const storeGame = useMemo(
		() =>
			(activeGames ?? []).find((g) => g.id === gameId) ??
			(spectatableGames ?? []).find((g) => g.id === gameId) ??
			(completeGames ?? []).find((g) => g.id === gameId),
		[activeGames, spectatableGames, completeGames, gameId]
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

	// Several refetches can be in flight at once — a burst of partial realtime
	// payloads (see below) issues one apiece, and nothing makes the responses
	// come back in order. Without a sequence guard the *oldest* snapshot can
	// land last and overwrite newer state: propose → accept → propose within
	// one turn would strand a bystander on the first, already-closed offer,
	// whose Accept button then 404s forever. Drop any response that isn't the
	// newest one issued.
	const gameSeq = useRef(0)
	const stateSeq = useRef(0)

	const fetchGame = useCallback(async () => {
		gameSeq.current += 1
		const seq = gameSeq.current
		const { data } = await supabase
			.from('games')
			.select('*')
			.eq('id', gameId)
			.maybeSingle()
		if (currentId.current !== gameId || seq !== gameSeq.current || !data)
			return
		setLiveGame(data as Game)
	}, [gameId])

	const fetchState = useCallback(async () => {
		stateSeq.current += 1
		const seq = stateSeq.current
		const { data } = await supabase
			.from('game_states')
			.select('*')
			.eq('game_id', gameId)
			.maybeSingle()
		if (currentId.current !== gameId || seq !== stateSeq.current) return
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
				(payload) => {
					gameSeq.current += 1
					setLiveGame(payload.new as Game)
				}
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
					// A payload is newer than anything already in flight, so
					// retire those responses before applying it.
					stateSeq.current += 1
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

	const game = liveGame ?? storeGame
	const meId = user?.id
	const isSpectator = !!game && !!meId && !game.participants.includes(meId)

	// --- Watcher presence --------------------------------------------------
	// Ephemeral, so there's no table and nothing to clean up: a watcher who
	// closes the app simply stops being present. Everyone joins the channel
	// (players need to read the count) but only spectators `track()`, so the
	// roster is watchers rather than attendance. Best-effort by construction —
	// a dropped socket under-counts until the next foreground, which is why
	// this is presence and not a heartbeat table.
	const [watcherIds, setWatcherIds] = useState<string[]>([])
	useEffect(() => {
		if (!gameId || !meId) return
		setWatcherIds([])
		const channel = supabase.channel(uniqueTopic(`watchers:${gameId}`), {
			config: { presence: { key: meId } },
		})
		const sync = () => {
			setWatcherIds(Object.keys(channel.presenceState()))
		}
		channel
			.on('presence', { event: 'sync' }, sync)
			.on('presence', { event: 'join' }, sync)
			.on('presence', { event: 'leave' }, sync)
			.subscribe((status) => {
				// Re-tracked on every join, including the automatic rejoin
				// after a dropped connection.
				if (status === 'SUBSCRIBED' && isSpectator) {
					channel.track({ at: new Date().toISOString() })
				}
			})
		return () => {
			supabase.removeChannel(channel)
		}
	}, [gameId, meId, isSpectator, resyncNonce])

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
			game,
			gameState,
			ready: storeReady && stateLoaded,
			publicVP,
			selfVP,
			isSpectator,
			watcherIds,
		}),
		[
			game,
			gameState,
			storeReady,
			stateLoaded,
			publicVP,
			selfVP,
			isSpectator,
			watcherIds,
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
		fenceTokens:
			(row.fence_tokens as GameState['fenceTokens']) ?? undefined,
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
