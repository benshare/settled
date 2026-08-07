// Per-game context. Loads the games row (from the store / realtime), reads the
// board from `useGameStatesStore`, and exposes the join through useGame() so
// descendants don't have to re-derive the same subscriptions.

import { useAppForeground } from '@/lib/appState'
import { useAuth } from '@/lib/auth'
import { onGameMutated } from '@/lib/gameSync'
import { uniqueTopic } from '@/lib/realtime'
import { useGameStatesStore } from '@/lib/stores/useGameStatesStore'
import {
	isPartialGameRow,
	useGamesStore,
	type Game,
} from '@/lib/stores/useGamesStore'
import { useProfileStore } from '@/lib/stores/useProfileStore'
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
import { parseGameColors } from './colors'
import { seatColors } from './palette'
import { parseGameConfig, type GameState } from './types'

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
	// Each seat's color as a hex string, in seat order. Centralized here for
	// the same reason the VP totals are: the presentational components that
	// take colors as props (ActionLog, GameChat, the bars) have no GameState
	// to resolve them from, and must not disagree with the board.
	seatColors: string[]
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
	// The header's tab strip switches games without remounting the provider, so
	// the previously fetched row has to be dropped or it outlives its game
	// until the new fetch lands. `storeGame` is already keyed to `gameId`, so
	// the `??` fallback below covers the gap.
	useEffect(() => {
		setLiveGame(undefined)
	}, [gameId])
	useEffect(() => {
		if (storeGame && !liveGame) setLiveGame(storeGame)
	}, [storeGame, liveGame])

	// Nothing that happened while the app was backgrounded reached these
	// channels — the socket was closed and realtime doesn't replay. Bumping the
	// nonce on foreground re-runs both effects, which re-fetch their row and
	// re-subscribe.
	const [resyncNonce, setResyncNonce] = useState(0)
	useAppForeground(() => setResyncNonce((n) => n + 1))

	// The board comes from the store, which already holds every game the viewer
	// is seated at — that's what makes opening one of those warm rather than a
	// load. `watch` covers the rest (a spectated or finished game) and doubles
	// as the freshness check for a cached row that went stale in the
	// background.
	const watch = useGameStatesStore((s) => s.watch)
	const unwatch = useGameStatesStore((s) => s.unwatch)
	useEffect(() => {
		watch(gameId)
		return () => unwatch(gameId)
	}, [gameId, watch, unwatch])
	const boardState = useGameStatesStore((s) => s.byId[gameId])
	const stateLoaded = useGameStatesStore((s) => s.loaded[gameId] === true)

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

	// A move we made ourselves is confirmed by the edge function's response, so
	// the board advances on that rather than on a channel that may have quietly
	// died. See lib/gameSync.ts. The board half is the store's job.
	useEffect(() => {
		if (!gameId) return
		return onGameMutated(gameId, fetchGame)
	}, [gameId, fetchGame])

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
					// Postgres drops unchanged TOASTed columns from UPDATE
					// payloads, so a write that doesn't touch `events` — the
					// deadline stamp after every action, the timeout sweep's
					// warning bump — arrives without it. Applying that row
					// empties the log for a beat, which is all it takes for the
					// screen's animation cursors to re-seed at zero and then
					// replay the whole game. An omitted column is an unchanged
					// one, so merge rather than re-read: the row we hold is the
					// only copy of what was left out. The seq is deliberately
					// not bumped — this isn't a complete row, so a fetch already
					// in flight should still be allowed to land.
					if (isPartialGameRow(payload.new)) {
						setLiveGame(
							(prev) =>
								prev && { ...prev, ...(payload.new as Game) }
						)
						return
					}
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

	const game = liveGame ?? storeGame
	const meId = user?.id
	const isSpectator = !!game && !!meId && !game.participants.includes(meId)

	// Opening a game as a spectator is the whole gesture that starts watching:
	// it records the game in `profiles.spectating`, which is what gives it a
	// header tab. Idempotent — `startSpectating` no-ops if it's already there.
	const startSpectating = useProfileStore((s) => s.startSpectating)
	useEffect(() => {
		if (isSpectator) startSpectating(gameId)
	}, [isSpectator, gameId, startSpectating])

	// The two rows are fetched independently and land in either order, so the
	// board is only a usable GameState once both are in. Everything downstream
	// reads `state.config` and `state.colors`, so publishing the board without
	// them would hand consumers a half-built object during the gap.
	const gameState = useMemo<GameState | undefined>(
		() =>
			boardState && game
				? {
						...boardState,
						config: parseGameConfig(game.config),
						colors: parseGameColors(
							game.colors,
							game.player_order.length
						),
					}
				: undefined,
		[boardState, game]
	)

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

	const seatHexes = useMemo(
		() => (gameState ? seatColors(gameState) : []),
		[gameState]
	)

	const value = useMemo<GameContextValue>(
		() => ({
			game,
			gameState,
			ready: storeReady && stateLoaded,
			publicVP,
			selfVP,
			seatColors: seatHexes,
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
			seatHexes,
			isSpectator,
			watcherIds,
		]
	)

	return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}
