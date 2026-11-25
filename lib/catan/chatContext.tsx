// Per-game chat. Loads the message thread, subscribes to realtime, and tracks
// the read cursor that backs both the unread badge and the "don't push someone
// who is already reading" suppression.
//
// A context rather than prop-drilling because two separate consumers need the
// same subscribed data: the floating button (unread count) and the panel
// (messages). Read lib/stores/CLAUDE.md before touching the realtime plumbing —
// the rules there are load-bearing.

import { useAppForeground } from '@/lib/appState'
import { uniqueTopic } from '@/lib/realtime'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
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

export const CHAT_MAX_CHARS = 500

// Mirrored in supabase/functions/game-service/index.ts. The heartbeat runs at
// half this interval so one missed beat doesn't read as "away" and start
// pushing notifications at someone who is looking at the thread.
const CHAT_PRESENCE_MS = 30_000
const CHAT_HEARTBEAT_MS = CHAT_PRESENCE_MS / 2

// How long a keystroke keeps someone showing as typing. Unrelated to
// CHAT_PRESENCE_MS above — that one is about suppressing a push, this one is
// about an animation. A draft abandoned mid-sentence would otherwise pin the
// indicator on for as long as the panel stayed open.
const TYPING_IDLE_MS = 4_000

// The panel shows the tail of the conversation. Older history is not reachable
// in v1 — see the spec's Out of scope.
const MESSAGE_LIMIT = 100

export type ChatMessage = {
	id: string
	game_id: string
	sender: string
	body: string
	created_at: string
}

// A row as the panel renders it. `outgoing` marks one of the viewer's own
// sends the server hasn't confirmed yet; its `id` is a local one until then.
export type ThreadMessage = ChatMessage & {
	outgoing?: { status: 'sending' | 'failed'; error: string | null }
}

// An optimistic send, held until its row turns up in `messages`.
type Outgoing = {
	localId: string
	body: string
	created_at: string
	status: 'sending' | 'failed'
	error: string | null
	// The inserted row's id, once the send has answered.
	serverId?: string
	// Ids already in the thread when this was sent, so a match by body can't
	// claim an older identical message ("gg"). Null when the thread hadn't
	// loaded yet — that send can only be matched by `serverId`.
	priorIds: Set<string> | null
}

export type ChatContextValue = {
	// undefined = still loading, per the store convention. Server rows only —
	// what the unread count reads.
	messages: ChatMessage[] | undefined
	// `messages` plus the viewer's unconfirmed sends, appended in send order.
	thread: ThreadMessage[] | undefined
	unreadCount: number
	open: boolean
	setOpen: (open: boolean) => void
	// Optimistic: the message joins `thread` at once and reconciles with its
	// row when the row arrives (realtime or refetch, whichever is first).
	send: (body: string) => void
	// For a failed send: try again, or drop it from the thread.
	retry: (localId: string) => void
	discard: (localId: string) => void
	// Everyone except the viewer currently composing a message in this game.
	typingIds: string[]
	// Called by the composer on every keystroke, with whether the draft still
	// has anything in it.
	noteTyping: (drafting: boolean) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function useChat(): ChatContextValue {
	const ctx = useContext(ChatContext)
	if (!ctx) throw new Error('useChat must be used within <ChatProvider>')
	return ctx
}

export function ChatProvider({
	gameId,
	meId,
	requestOpen = false,
	children,
}: {
	gameId: string
	meId: string | undefined
	requestOpen?: boolean
	children: ReactNode
}) {
	const sendMessage = useGamesStore((s) => s.sendMessage)

	const [messages, setMessages] = useState<ChatMessage[] | undefined>()
	const [open, setOpen] = useState(requestOpen)
	const [outbox, setOutbox] = useState<Outgoing[]>([])
	const [lastReadAt, setLastReadAt] = useState<string | null>(null)
	const [typingIds, setTypingIds] = useState<string[]>([])
	const [typing, setTyping] = useState(false)

	// A chat notification tapped while this screen is already open reuses the
	// screen, so the request arrives as a prop change rather than a mount.
	useEffect(() => {
		if (requestOpen) setOpen(true)
	}, [requestOpen])

	// Nothing emitted while the app was backgrounded reached this channel, so a
	// foreground has to re-fetch and re-subscribe. Matches GameProvider.
	const [resyncNonce, setResyncNonce] = useState(0)
	useAppForeground(() => setResyncNonce((n) => n + 1))

	// A fetch in flight when the game changes must not land on the new game.
	const currentId = useRef(gameId)
	useEffect(() => {
		currentId.current = gameId
	}, [gameId])

	// Responses aren't ordered. Drop any that isn't the newest issued, or an
	// older snapshot can overwrite a newer one.
	const seq = useRef(0)

	const fetchMessages = useCallback(async () => {
		seq.current += 1
		const mine = seq.current
		const { data } = await supabase
			.from('game_messages')
			.select('id, game_id, sender, body, created_at')
			.eq('game_id', gameId)
			.order('created_at', { ascending: false })
			.limit(MESSAGE_LIMIT)
		if (currentId.current !== gameId || mine !== seq.current || !data)
			return
		// Fetched newest-first for the LIMIT; displayed oldest-first.
		setMessages((data as ChatMessage[]).slice().reverse())
	}, [gameId])

	// Only a change of game empties the thread. A resync re-fetches in place so
	// foregrounding doesn't flash the panel back into its loading state.
	useEffect(() => {
		setMessages(undefined)
		setOutbox([])
		setLastReadAt(null)
		setTypingIds([])
		setTyping(false)
	}, [gameId])

	useEffect(() => {
		if (!gameId) return
		const channel = supabase
			.channel(uniqueTopic(`game_chat:${gameId}`))
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'game_messages',
					filter: `game_id=eq.${gameId}`,
				},
				(payload) => {
					const row = payload.new as ChatMessage
					setMessages((prev) => {
						if (!prev) return prev
						// The same row can arrive from both the channel and a
						// refetch.
						if (prev.some((m) => m.id === row.id)) return prev
						return [...prev, row]
					})
				}
			)
			// The fetch and the join race each other; a message landing between
			// the fetch's snapshot and the join reaches nobody. Reading once the
			// channel is live closes that gap.
			.subscribe((status) => {
				if (status === 'SUBSCRIBED') fetchMessages()
			})
		fetchMessages()
		return () => {
			supabase.removeChannel(channel)
		}
	}, [gameId, resyncNonce, fetchMessages])

	// Load the stored cursor once so the badge is right on a cold start.
	useEffect(() => {
		if (!gameId || !meId) return
		let cancelled = false
		supabase
			.from('game_chat_reads')
			.select('last_read_at')
			.eq('game_id', gameId)
			.eq('user_id', meId)
			.maybeSingle()
			.then(({ data }) => {
				if (cancelled || !data) return
				setLastReadAt(data.last_read_at as string)
			})
		return () => {
			cancelled = true
		}
	}, [gameId, meId, resyncNonce])

	const markRead = useCallback(async () => {
		if (!gameId || !meId) return
		const now = new Date().toISOString()
		setLastReadAt(now)
		// Best-effort: a dropped heartbeat costs at most one redundant push.
		await supabase
			.from('game_chat_reads')
			.upsert(
				{ game_id: gameId, user_id: meId, last_read_at: now },
				{ onConflict: 'game_id,user_id' }
			)
	}, [gameId, meId])

	// While the panel is open the cursor doubles as a presence heartbeat, which
	// is what stops the server pushing a notification at someone who is already
	// looking at the message.
	useEffect(() => {
		if (!open) return
		markRead()
		const id = setInterval(markRead, CHAT_HEARTBEAT_MS)
		return () => {
			clearInterval(id)
			// Closing sets a final cursor so the badge starts from now.
			markRead()
		}
	}, [open, markRead])

	// --- Typing presence ---------------------------------------------------
	// Ephemeral, so there's nothing to store and nothing to clean up: a typer
	// who closes the app simply stops being present. Presence rather than a
	// broadcast heartbeat precisely because of that — with broadcast, every
	// client would have to expire every other client on a timer, and a crash
	// would leave the indicator stuck until it fired.
	//
	// Membership *is* the signal, so the viewer tracks and untracks rather than
	// tracking a `{ typing }` flag: a flag would mean a presence event on every
	// panel open and close for a state nobody reads.
	//
	// The channel is only joined while the panel is open. The indicator has no
	// closed-panel surface, so a viewer with chat shut has nothing to do with
	// the roster — and closing therefore stops them being tracked for free.
	const typingChannel = useRef<RealtimeChannel | null>(null)
	// Read from the SUBSCRIBED callback, which fires outside this render.
	const typingRef = useRef(false)

	useEffect(() => {
		if (!gameId || !meId || !open) return
		setTypingIds([])
		const channel = supabase.channel(uniqueTopic(`chat_typing:${gameId}`), {
			config: { presence: { key: meId } },
		})
		const sync = () => {
			setTypingIds(
				Object.keys(channel.presenceState()).filter((id) => id !== meId)
			)
		}
		channel
			.on('presence', { event: 'sync' }, sync)
			.on('presence', { event: 'join' }, sync)
			.on('presence', { event: 'leave' }, sync)
			.subscribe((status) => {
				// `track` before the join lands is dropped, so the state is
				// asserted from here — on the first join and on every automatic
				// rejoin after a drop, which is what makes a reconnect
				// mid-sentence keep showing the viewer as typing.
				if (status === 'SUBSCRIBED' && typingRef.current) {
					channel.track({})
				}
			})
		typingChannel.current = channel
		return () => {
			typingChannel.current = null
			supabase.removeChannel(channel)
		}
	}, [gameId, meId, open, resyncNonce])

	// Split from the subscribe effect so a keystroke doesn't tear down and
	// rebuild the channel. Only transitions reach the wire — `typing` is a
	// boolean, so a fast typist emits one `track` per burst, not one per key.
	useEffect(() => {
		typingRef.current = typing
		const channel = typingChannel.current
		if (!channel) return
		if (typing) channel.track({})
		else channel.untrack()
	}, [typing])

	// A close can't be allowed to leave a tracked presence behind.
	useEffect(() => {
		if (!open) setTyping(false)
	}, [open])

	const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const noteTyping = useCallback((drafting: boolean) => {
		if (idleTimer.current) clearTimeout(idleTimer.current)
		// An emptied composer stops typing at once rather than after the idle
		// window — there is nothing left to be composing.
		if (!drafting) {
			setTyping(false)
			return
		}
		setTyping(true)
		idleTimer.current = setTimeout(() => setTyping(false), TYPING_IDLE_MS)
	}, [])

	useEffect(
		() => () => {
			if (idleTimer.current) clearTimeout(idleTimer.current)
		},
		[]
	)

	const unreadCount = useMemo(() => {
		if (!messages || !meId) return 0
		const cutoff = lastReadAt ? Date.parse(lastReadAt) : 0
		return messages.filter(
			(m) => m.sender !== meId && Date.parse(m.created_at) > cutoff
		).length
	}, [messages, meId, lastReadAt])

	// --- Optimistic sends -------------------------------------------------
	// Read at send time, outside render.
	const messagesRef = useRef(messages)
	useEffect(() => {
		messagesRef.current = messages
	}, [messages])
	const localSeq = useRef(0)

	const deliver = useCallback(
		async (localId: string, body: string) => {
			const forGame = gameId
			const { error, id } = await sendMessage(gameId, body)
			if (currentId.current !== forGame) return
			setOutbox((prev) =>
				prev.map((o) =>
					o.localId !== localId
						? o
						: error
							? { ...o, status: 'failed', error }
							: { ...o, serverId: id }
				)
			)
			// Realtime usually delivers the row first; this covers a dropped
			// channel so a confirmed send can't sit "sending" forever.
			if (!error) fetchMessages()
		},
		[gameId, sendMessage, fetchMessages]
	)

	const send = useCallback(
		(body: string) => {
			const text = body.trim()
			if (!text) return
			localSeq.current += 1
			const localId = `local:${localSeq.current}`
			const loaded = messagesRef.current
			setOutbox((prev) => [
				...prev,
				{
					localId,
					body: text,
					created_at: new Date().toISOString(),
					status: 'sending',
					error: null,
					priorIds: loaded ? new Set(loaded.map((m) => m.id)) : null,
				},
			])
			deliver(localId, text)
		},
		[deliver]
	)

	const retry = useCallback(
		(localId: string) => {
			const target = outbox.find((o) => o.localId === localId)
			if (!target || target.status !== 'failed') return
			setOutbox((prev) =>
				prev.map((o) =>
					o.localId === localId
						? {
								...o,
								status: 'sending',
								error: null,
								// A retry is a new send as far as the thread
								// is concerned: it moves to now.
								created_at: new Date().toISOString(),
							}
						: o
				)
			)
			deliver(localId, target.body)
		},
		[outbox, deliver]
	)

	const discard = useCallback((localId: string) => {
		setOutbox((prev) => prev.filter((o) => o.localId !== localId))
	}, [])

	// Pair each outgoing send with its row. A confirmed send matches by id; one
	// still in flight matches the first new own row with the same body — the
	// realtime INSERT routinely beats the HTTP response, and waiting for the id
	// would show the message twice in between. A failed send can match too: a
	// timeout whose insert actually landed resolves itself.
	const { thread, landed } = useMemo(() => {
		const landed = new Set<string>()
		if (!messages) return { thread: undefined, landed }
		const claimed = new Set<string>()
		const byId = new Set(messages.map((m) => m.id))
		for (const o of outbox) {
			if (o.serverId && byId.has(o.serverId)) {
				claimed.add(o.serverId)
				landed.add(o.localId)
			}
		}
		for (const o of outbox) {
			if (landed.has(o.localId) || o.serverId || !o.priorIds) continue
			const hit = messages.find(
				(m) =>
					m.sender === meId &&
					m.body === o.body &&
					!o.priorIds!.has(m.id) &&
					!claimed.has(m.id)
			)
			if (hit) {
				claimed.add(hit.id)
				landed.add(o.localId)
			}
		}
		const pending: ThreadMessage[] = outbox
			.filter((o) => !landed.has(o.localId))
			.map((o) => ({
				id: o.localId,
				game_id: gameId,
				sender: meId ?? '',
				body: o.body,
				created_at: o.created_at,
				outgoing: { status: o.status, error: o.error },
			}))
		return {
			thread: pending.length ? [...messages, ...pending] : messages,
			landed,
		}
	}, [messages, outbox, meId, gameId])

	// A landed send has its row now; stop carrying it.
	useEffect(() => {
		if (landed.size === 0) return
		setOutbox((prev) => prev.filter((o) => !landed.has(o.localId)))
	}, [landed])

	const value = useMemo<ChatContextValue>(
		() => ({
			messages,
			thread,
			unreadCount,
			open,
			setOpen,
			send,
			retry,
			discard,
			typingIds,
			noteTyping,
		}),
		[
			messages,
			thread,
			unreadCount,
			open,
			send,
			retry,
			discard,
			typingIds,
			noteTyping,
		]
	)

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
