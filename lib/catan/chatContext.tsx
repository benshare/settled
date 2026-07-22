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

export type ChatContextValue = {
	// undefined = still loading, per the store convention.
	messages: ChatMessage[] | undefined
	unreadCount: number
	open: boolean
	setOpen: (open: boolean) => void
	send: (body: string) => Promise<{ error: string | null }>
	sending: boolean
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
	const [sending, setSending] = useState(false)
	const [lastReadAt, setLastReadAt] = useState<string | null>(null)

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
		setLastReadAt(null)
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

	const unreadCount = useMemo(() => {
		if (!messages || !meId) return 0
		const cutoff = lastReadAt ? Date.parse(lastReadAt) : 0
		return messages.filter(
			(m) => m.sender !== meId && Date.parse(m.created_at) > cutoff
		).length
	}, [messages, meId, lastReadAt])

	const send = useCallback(
		async (body: string) => {
			const text = body.trim()
			if (!text) return { error: null }
			setSending(true)
			const { error } = await sendMessage(gameId, text)
			setSending(false)
			if (!error) fetchMessages()
			return { error }
		},
		[gameId, sendMessage, fetchMessages]
	)

	const value = useMemo<ChatContextValue>(
		() => ({ messages, unreadCount, open, setOpen, send, sending }),
		[messages, unreadCount, open, send, sending]
	)

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
