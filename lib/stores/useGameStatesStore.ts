// Every `game_states` row the viewer has a live interest in, keyed by game id.
//
// Two things depend on this being a store rather than per-screen state:
//
//   1. The Games list, the header tab strip and the app-icon badge all ask
//      "is this game waiting on me?", and the honest answer is
//      `pendingUserIds` (lib/catan/timeout.ts), which needs `phase`. Without
//      the rows here they could only read `games.current_turn`, which is null
//      through bonus selection and names the wrong seat during special build.
//   2. Opening a game you're seated at renders warm — the board is already
//      here, so `GameProvider` has nothing to wait for.
//
// See `.claude/specs/pending-action-signal.md`.

import type { RealtimeChannel } from '@supabase/supabase-js'
import { create } from 'zustand'
import type { GameState } from '../catan/types'
import { onAnyGameMutated } from '../gameSync'
import { uniqueTopic } from '../realtime'
import { supabase } from '../supabase'
import type { AutoLoadedStore } from './index'
import { useGamesStore } from './useGamesStore'

// The board half of a GameState. `config` and `colors` live on the games row,
// so `GameProvider` joins the two — see lib/catan/CLAUDE.md.
export type BoardState = Omit<GameState, 'config' | 'colors'>

type GameStatesStore = {
	byId: Record<string, BoardState | undefined>
	// A game is only absent from here until its first fetch resolves; an id
	// mapped to `true` with no `byId` entry is a game with no state row.
	loaded: Record<string, true>
	loadForUser: () => Promise<void>
	// Registered by GameProvider for the game on screen. Active games are
	// already held; this is what covers a spectated or finished one.
	watch: (gameId: string) => void
	unwatch: (gameId: string) => void
	clear: () => void
}

let channel: RealtimeChannel | null = null
// The id set the live channel is bound to, so a sync that changes nothing
// doesn't tear down a working subscription.
let channelKey = ''
let unsubscribeGames: (() => void) | null = null
let unsubscribeMutations: (() => void) | null = null
let lastActiveKey = ''

// Watch registrations, refcounted: the header tab strip can hand GameProvider a
// new game before the old one's effect has torn down.
const watched = new Map<string, number>()

// Last `updated_at` we hold per game. Module-level rather than store state —
// nothing renders it, and it exists only to skip full row fetches.
const stamps = new Map<string, string>()

// Per-game fetch sequence. Several reads can be in flight at once (a burst of
// partial realtime payloads issues one apiece) and nothing makes them come back
// in order, so an older snapshot must not land on top of a newer one.
const seq = new Map<string, number>()

export const useGameStatesStore = create<GameStatesStore>((set) => ({
	byId: {},
	loaded: {},

	// The registry calls this on entry to `(app)` and on every foreground. It
	// takes no user: the id set is always the games store's `activeGames`.
	// What it adds over the subscription below is freshness and a live socket —
	// the OS closes the WebSocket while backgrounded and realtime doesn't
	// replay, so a foreground that changes no ids still has to re-read and
	// re-subscribe. See lib/stores/CLAUDE.md.
	async loadForUser() {
		if (!unsubscribeGames) {
			unsubscribeGames = useGamesStore.subscribe((s) => {
				const key = activeKeyOf(s.activeGames)
				if (key === lastActiveKey) return
				lastActiveKey = key
				void sync()
			})
		}
		if (!unsubscribeMutations) {
			// A player's own move is confirmed by the edge function's response;
			// never make them wait on a channel to see it (lib/gameSync.ts).
			unsubscribeMutations = onAnyGameMutated((gameId) => {
				if (targetIds().includes(gameId)) void fetchRows([gameId])
			})
		}
		lastActiveKey = activeKeyOf(useGamesStore.getState().activeGames)
		await sync({ rebuildChannel: true })
	},

	watch(gameId) {
		watched.set(gameId, (watched.get(gameId) ?? 0) + 1)
		void sync()
	},

	unwatch(gameId) {
		const held = (watched.get(gameId) ?? 0) - 1
		if (held > 0) {
			watched.set(gameId, held)
			return
		}
		watched.delete(gameId)
		void sync()
	},

	clear() {
		if (channel) supabase.removeChannel(channel)
		channel = null
		channelKey = ''
		unsubscribeGames?.()
		unsubscribeGames = null
		unsubscribeMutations?.()
		unsubscribeMutations = null
		lastActiveKey = ''
		watched.clear()
		stamps.clear()
		seq.clear()
		set({ byId: {}, loaded: {} })
	},
}))

function activeKeyOf(games: { id: string }[] | undefined): string {
	return (games ?? [])
		.map((g) => g.id)
		.sort()
		.join(',')
}

/** Every game whose state we hold: seated-at games, plus anything watched. */
function targetIds(): string[] {
	const ids = new Set<string>(
		(useGamesStore.getState().activeGames ?? []).map((g) => g.id)
	)
	for (const id of watched.keys()) ids.add(id)
	return [...ids].sort()
}

/**
 * Bring the held rows in line with `targetIds()`: drop what left, fetch what
 * arrived or changed, and point the channel at the new set.
 *
 * The `updated_at` pass is what keeps a foreground cheap. Board rows are large
 * (hexes, vertices, edges, players, dev deck), and most foregrounds find
 * nothing new in most games, so we ask for one timestamp column first and only
 * pull whole rows for the games that actually moved.
 */
async function sync(opts?: { rebuildChannel?: boolean }): Promise<void> {
	const ids = targetIds()
	const held = new Set(ids)

	useGameStatesStore.setState((s) => {
		const dropped = Object.keys(s.loaded).filter((id) => !held.has(id))
		if (dropped.length === 0) return {}
		const byId = { ...s.byId }
		const loaded = { ...s.loaded }
		for (const id of dropped) {
			delete byId[id]
			delete loaded[id]
			stamps.delete(id)
			seq.delete(id)
		}
		return { byId, loaded }
	})

	ensureChannel(ids, opts?.rebuildChannel === true)
	if (ids.length === 0) return

	// A game we've never read has nothing to compare a timestamp against, so it
	// skips the stamp pass — it would only add a round trip in front of the
	// fetch we already know we need. `fetchRows` resolves ids with no row at
	// all, so a game whose state is missing stops being waited on either way.
	const { loaded } = useGameStatesStore.getState()
	const fresh = ids.filter((id) => !loaded[id])
	await Promise.all([
		fresh.length > 0 ? fetchRows(fresh) : undefined,
		refetchChanged(ids.filter((id) => loaded[id])),
	])
}

/** The cheap half of a resync: one timestamp column, then only what moved. */
async function refetchChanged(ids: string[]): Promise<void> {
	if (ids.length === 0) return
	const { data, error } = await supabase
		.from('game_states')
		.select('game_id, updated_at')
		.in('game_id', ids)
	if (error) {
		console.warn('[game_states] stamp read failed', error.message)
		return
	}
	const stale = (data ?? [])
		.filter((row) => stamps.get(row.game_id) !== row.updated_at)
		.map((row) => row.game_id)
	if (stale.length > 0) await fetchRows(stale)
}

async function fetchRows(ids: string[]): Promise<void> {
	const issued = ids.map((id) => {
		const n = (seq.get(id) ?? 0) + 1
		seq.set(id, n)
		return [id, n] as const
	})

	const { data, error } = await supabase
		.from('game_states')
		.select('*')
		.in('game_id', ids)
	if (error) {
		console.warn('[game_states] read failed', error.message)
		return
	}

	const rows = new Map(
		(data ?? []).map((row) => [
			row.game_id as string,
			row as Record<string, unknown>,
		])
	)

	const nextById: Record<string, BoardState | undefined> = {}
	const nextLoaded: Record<string, true> = {}
	for (const [id, n] of issued) {
		if (seq.get(id) !== n) continue
		const row = rows.get(id)
		nextById[id] = row ? rowToState(row) : undefined
		nextLoaded[id] = true
		if (row) stamps.set(id, row.updated_at as string)
		else stamps.delete(id)
	}
	if (Object.keys(nextLoaded).length === 0) return

	useGameStatesStore.setState((s) => ({
		byId: { ...s.byId, ...nextById },
		loaded: { ...s.loaded, ...nextLoaded },
	}))
}

/**
 * One channel for every held game, with a per-id binding rather than a single
 * `in.(…)` filter — the same server-side narrowing, without depending on a
 * filter operator whose support in `postgres_changes` is easy to get wrong.
 *
 * The narrowing itself is not optional: RLS also admits every friend's
 * watchable game, and a payload is the *whole row*, so an unfiltered
 * subscription would stream full boards for games the viewer isn't playing.
 */
function ensureChannel(ids: string[], force: boolean): void {
	const key = ids.join(',')
	// `force` is the foreground resync: the socket died while backgrounded, so
	// the channel has to be replaced even though it is bound to the right ids.
	if (!force && channel && key === channelKey) return
	if (channel) supabase.removeChannel(channel)
	channel = null
	channelKey = key
	if (ids.length === 0) return

	let next = supabase.channel(uniqueTopic('game_states_rtu'))
	for (const id of ids) {
		next = next.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'game_states',
				filter: `game_id=eq.${id}`,
			},
			handleStateChange
		)
	}
	// Fetching and joining race each other, and an event landing between the
	// two reaches nobody. Reading once the channel is live closes that gap, on
	// first join and on every automatic rejoin.
	next.subscribe((status) => {
		if (status === 'SUBSCRIBED') void sync()
	})
	channel = next
}

function handleStateChange(payload: {
	eventType: string
	new: Record<string, unknown>
	old: Record<string, unknown>
}): void {
	const gameId = (payload.new?.game_id ?? payload.old?.game_id) as
		string | undefined
	if (!gameId) return

	// Any payload is newer than anything already in flight, so retire those
	// responses before applying it.
	seq.set(gameId, (seq.get(gameId) ?? 0) + 1)

	if (payload.eventType === 'DELETE') {
		stamps.delete(gameId)
		useGameStatesStore.setState((s) => ({
			byId: { ...s.byId, [gameId]: undefined },
			loaded: { ...s.loaded, [gameId]: true },
		}))
		return
	}

	if (isPartialStateRow(payload.new)) {
		void fetchRows([gameId])
		return
	}

	stamps.set(gameId, payload.new.updated_at as string)
	useGameStatesStore.setState((s) => ({
		byId: { ...s.byId, [gameId]: rowToState(payload.new) },
		loaded: { ...s.loaded, [gameId]: true },
	}))
}

// A realtime UPDATE payload is partial when Postgres dropped unchanged TOASTed
// columns. These blobs are `not null` in the schema, so an absent (`undefined`)
// value can only mean the column was omitted — never a legitimate null. Any one
// missing makes rowToState unsafe: a write that only touches `phase` (propose /
// reject / cancel a trade) would otherwise strand the board with undefined
// players and crash VP computation.
function isPartialStateRow(row: Record<string, unknown>): boolean {
	return (
		row.players === undefined ||
		row.hexes === undefined ||
		row.vertices === undefined ||
		row.edges === undefined
	)
}

function rowToState(row: Record<string, unknown>): BoardState {
	return {
		variant: row.variant as GameState['variant'],
		hexes: row.hexes as GameState['hexes'],
		vertices: row.vertices as GameState['vertices'],
		edges: row.edges as GameState['edges'],
		players: row.players as GameState['players'],
		phase: row.phase as GameState['phase'],
		currentTurn: (row.current_turn as number | null) ?? null,
		robber: row.robber as GameState['robber'],
		ports: (row.ports as GameState['ports']) ?? [],
		fenceTokens:
			(row.fence_tokens as GameState['fenceTokens']) ?? undefined,
		devDeck: (row.dev_deck as GameState['devDeck']) ?? [],
		largestArmy: (row.largest_army as GameState['largestArmy']) ?? null,
		longestRoad: (row.longest_road as GameState['longestRoad']) ?? null,
		round: (row.round as GameState['round']) ?? 0,
		undo: (row.undo as GameState['undo']) ?? null,
	}
}

export const gameStatesStoreRegistration: AutoLoadedStore = {
	name: 'gameStates',
	loadForUser: () => useGameStatesStore.getState().loadForUser(),
	clear: () => useGameStatesStore.getState().clear(),
}
