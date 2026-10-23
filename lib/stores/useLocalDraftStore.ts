// The moves a player has taken on this device but not yet sent: the local
// action queue and the initial-placement draft, per game. Held here rather than
// in the game screen so they survive a header tab switch and leaving the
// screen, and written through to device storage so they survive the app being
// killed. Never sent anywhere — opponents still see nothing until the flush.
// See .claude/specs/queue-flush-and-persist.md.

import { create } from 'zustand'
import type { PlacementDraftEntry } from '../catan/placement'
import type { LocalAction } from '../catan/types'
import { authStorage } from '../supabase'
import type { AutoLoadedStore } from './index'

// A batch handed to the server. Not undoable: once sent it may have landed.
// `acked` means the server said so; it stays here until the row carries its
// id, so the board never drops the moves between the response and realtime.
export type InFlightBatch = {
	id: string
	actions: LocalAction[]
	acked: boolean
}

export type GameDraft = {
	// Unsent and undoable, oldest first.
	queue: LocalAction[]
	// Sent, oldest first. Folded ahead of `queue` until the row reflects them.
	inFlight: InFlightBatch[]
	// The server row's `queueAnchorOf` as last seen while the queue was live.
	// A draft reopened against a row that has moved on is stale.
	queueAnchor: string | null
	placement: PlacementDraftEntry[]
	pickLast: string | null
	// The `placementKey` the placement draft was made under.
	placementAnchor: string | null
}

export const EMPTY_DRAFT: GameDraft = {
	queue: [],
	inFlight: [],
	queueAnchor: null,
	placement: [],
	pickLast: null,
	placementAnchor: null,
}

type LocalDraftStore = {
	userId: string | null
	// `undefined` until read back from storage for that game.
	byGame: Record<string, GameDraft | undefined>
	hydrate: (gameId: string) => Promise<void>
	update: (gameId: string, fn: (draft: GameDraft) => GameDraft) => void
	loadForUser: (userId: string) => Promise<void>
	clear: () => void
}

// Per-key write chain, so an older write can't land after a newer one.
const writes = new Map<string, Promise<void>>()

export const useLocalDraftStore = create<LocalDraftStore>((set, get) => ({
	userId: null,
	byGame: {},

	// A no-op until the user is known: a game screen opened from a cold-start
	// deep link mounts before the store registry has run, and reading then
	// would settle the game as empty for the session. The caller re-runs it
	// once `userId` lands.
	async hydrate(gameId) {
		const { userId, byGame } = get()
		if (!userId || byGame[gameId] !== undefined) return
		let draft = EMPTY_DRAFT
		try {
			const raw = await authStorage.getItem(storageKey(userId, gameId))
			if (raw) draft = { ...EMPTY_DRAFT, ...JSON.parse(raw) }
		} catch (err) {
			// Unreadable is the same as nothing saved.
			console.warn('[drafts] read failed', err)
		}
		// Anything taken while the read was in flight is newer than the disk.
		if (get().byGame[gameId] !== undefined) return
		set((s) => ({ byGame: { ...s.byGame, [gameId]: draft } }))
	},

	update(gameId, fn) {
		const prev = get().byGame[gameId] ?? EMPTY_DRAFT
		const next = fn(prev)
		if (next === prev) return
		set((s) => ({ byGame: { ...s.byGame, [gameId]: next } }))
		const { userId } = get()
		if (userId) persist(storageKey(userId, gameId), next)
	},

	async loadForUser(userId) {
		const prev = get().userId
		if (prev === userId) return
		// Only a different account's drafts are discarded; anything taken
		// before the first load is this user's.
		set((s) => ({ userId, byGame: prev === null ? s.byGame : {} }))
	},

	clear() {
		set({ userId: null, byGame: {} })
	},
}))

function storageKey(userId: string, gameId: string): string {
	return `settled.draft.${userId}.${gameId}`
}

function isEmpty(draft: GameDraft): boolean {
	return (
		draft.queue.length === 0 &&
		draft.inFlight.length === 0 &&
		draft.placement.length === 0
	)
}

function persist(key: string, draft: GameDraft): void {
	const prev = writes.get(key) ?? Promise.resolve()
	const next = prev
		.then(() =>
			isEmpty(draft)
				? authStorage.removeItem(key)
				: authStorage.setItem(key, JSON.stringify(draft))
		)
		.catch((err) => console.warn('[drafts] write failed', err))
	writes.set(key, next)
}

export const localDraftStoreRegistration: AutoLoadedStore = {
	name: 'localDrafts',
	loadForUser: (userId) => useLocalDraftStore.getState().loadForUser(userId),
	clear: () => useLocalDraftStore.getState().clear(),
}
