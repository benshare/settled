// Per-game chat UI. Data comes from <ChatProvider> — see chatContext.tsx.
//
// Two exports, mounted at different levels of the game screen:
//
// - `ChatButton` — the floating affordance, third slot below BoardLegend and
//   ActionLog, so it lives inside the board container with them.
// - `ChatPanel` — the conversation. Mounted at the screen root (`styles.root`)
//   rather than inside the board container, so it covers the action bars too
//   but stops short of the screen header. It is an absolutely-positioned view
//   rather than a Modal precisely so it stays inside the play area — a Modal
//   would cover the whole screen.

import { Ionicons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View,
} from 'react-native'
import Animated, {
	useAnimatedKeyboard,
	useAnimatedStyle,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useGamesStore } from '../stores/useGamesStore'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing, z } from '../theme'
import { CHAT_MAX_CHARS, useChat, type ChatMessage } from './chatContext'
import { playerColors } from './palette'

// Translucent so the board stays faintly visible behind the conversation. The
// 0.9 is a product requirement, not an arbitrary style value.
const PANEL_BG = 'rgba(250, 243, 224, 0.9)'
const PANEL_CHROME_BG = 'rgba(235, 219, 184, 0.94)'

// The floating buttons' inset from the top of the board container. Slot 0's
// origin, and the line the panel's top margin is measured from.
const BUTTON_INSET = spacing.sm

// Breathing room between the panel and the play area's edges, equal on all
// sides. The top edge is measured from the floating buttons' line.
const PANEL_GAP = spacing.md

// Taps this far inside the panel's visible edge still dismiss: the panel is
// inset by `PANEL_GAP - DISMISS_SLOP` and pads the difference back with a
// transparent, tap-transparent ring, so the visible geometry is unchanged.
const DISMISS_SLOP = spacing.sm

export function ChatButton() {
	const { open, setOpen, unreadCount } = useChat()

	return (
		<Pressable
			onPress={() => setOpen(!open)}
			style={({ pressed }) => [
				styles.collapsed,
				pressed && styles.pressed,
			]}
			hitSlop={6}
			accessibilityLabel={
				unreadCount > 0
					? `Open chat, ${unreadCount} unread`
					: 'Open chat'
			}
		>
			<Ionicons name="chatbubble-outline" size={20} color={colors.text} />
			{unreadCount > 0 && (
				<View style={styles.badge}>
					<Text style={styles.badgeText}>
						{unreadCount > 9 ? '9+' : unreadCount}
					</Text>
				</View>
			)}
		</Pressable>
	)
}

export function ChatPanel({
	topOffset,
	playerOrder,
	profilesById,
	meId,
}: {
	// Game area's y within the screen root, measured by the game screen. The
	// panel's top edge lands on the same line as the floating buttons, which
	// sit at `spacing.sm` inside that container.
	topOffset: number
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meId: string | undefined
}) {
	const { open, setOpen, messages, send, sending } = useChat()
	const [draft, setDraft] = useState('')
	const [error, setError] = useState<string | null>(null)

	// Spectators send into this thread but were never in a participant list, so
	// their profiles aren't in the store's cache. Without this they'd all
	// render as 'Player'.
	const ensureProfiles = useGamesStore((s) => s.ensureProfiles)
	useEffect(() => {
		if (!messages || messages.length === 0) return
		ensureProfiles(messages.map((m) => m.sender))
	}, [messages, ensureProfiles])

	// The keyboard lifts the whole overlay — scrim included — by one translate,
	// so nothing about the panel re-lays-out as it moves. The panel's bottom is
	// pinned to the play area, which sits well above the screen bottom, so
	// padding-style avoidance would leave the composer covered; the play area
	// also already stops short of the screen bottom by the safe-area inset,
	// which the keyboard covers, so lifting by the full keyboard height would
	// leave that inset as dead space.
	//
	// Lifting alone would push the panel's top off the screen, so past the point
	// where its top would clear `insets.top + PANEL_GAP` — the same gap it keeps
	// from the top of its own zone at rest — the panel shortens instead, and its
	// top parks there.
	const insets = useSafeAreaInsets()
	const keyboard = useAnimatedKeyboard()

	// The scrim's y in window space. The panel can rise by that much (minus the
	// safe area) before its top hits the ceiling; beyond that it must shrink.
	const scrimRef = useRef<View>(null)
	const [scrimY, setScrimY] = useState(0)
	const measureScrim = useCallback(() => {
		// A layout pass while the panel is lifted would measure the translated
		// position; the resting one is the only meaningful reading.
		if (keyboard.height.value > 0) return
		scrimRef.current?.measureInWindow((_x, y) => setScrimY(y))
	}, [keyboard])
	const headroom = Math.max(0, scrimY - insets.top)

	const liftStyle = useAnimatedStyle(() => ({
		transform: [
			{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) },
		],
	}))
	// Absolutely positioned against both edges, so trimming the top margin
	// shortens the panel rather than moving it.
	const shrinkStyle = useAnimatedStyle(() => ({
		marginTop: Math.max(
			0,
			Math.max(0, keyboard.height.value - insets.bottom) - headroom
		),
	}))

	const canSend = draft.trim().length > 0 && !sending

	// An inverted list sticks to the bottom as messages arrive, which is what a
	// chat wants, and saves a manual scrollToEnd on every insert.
	const inverted = useMemo(
		() => (messages ? messages.slice().reverse() : []),
		[messages]
	)

	async function onSend() {
		const text = draft.trim()
		if (!text) return
		setDraft('')
		setError(null)
		const res = await send(text)
		if (res.error) {
			// Put the message back rather than losing what they typed.
			setDraft(text)
			setError(res.error)
		}
	}

	if (!open) return null

	return (
		// A light scrim: the panel itself is the translucent element, and a
		// heavy backdrop on top of it would defeat glimpsing the board.
		<Animated.View
			ref={scrimRef}
			onLayout={measureScrim}
			style={[styles.scrim, { top: topOffset + BUTTON_INSET }, liftStyle]}
		>
			{/* Behind the panel, so every tap outside it — including the slop
			    ring — dismisses. */}
			<Pressable
				style={StyleSheet.absoluteFill}
				onPress={() => setOpen(false)}
				accessibilityLabel="Close chat"
			/>

			{/* box-none: the slop ring isn't a tap target itself, so taps in it
			    fall through to the dismiss layer. */}
			<Animated.View
				pointerEvents="box-none"
				style={[styles.panelWrap, shrinkStyle]}
			>
				{/* An opaque View swallows taps on its own (it sits above the
				    dismiss layer), so no Pressable is needed here — and a
				    Pressable would claim the touch responder and stop the
				    message list from scrolling on native. */}
				<View style={styles.panel}>
					<View style={styles.header}>
						<Text style={styles.title}>Chat</Text>
						<Pressable
							onPress={() => setOpen(false)}
							style={({ pressed }) => [
								styles.closeBtn,
								pressed && styles.pressed,
							]}
							accessibilityLabel="Close chat"
							hitSlop={6}
						>
							<Ionicons
								name="close"
								size={20}
								color={colors.textSecondary}
							/>
						</Pressable>
					</View>

					<ChatBody
						messages={messages}
						inverted={inverted}
						playerOrder={playerOrder}
						profilesById={profilesById}
						meId={meId}
					/>

					{error && <Text style={styles.error}>{error}</Text>}

					<ChatComposer
						draft={draft}
						setDraft={setDraft}
						canSend={canSend}
						onSend={onSend}
					/>
				</View>
			</Animated.View>
		</Animated.View>
	)
}

function ChatBody({
	messages,
	inverted,
	playerOrder,
	profilesById,
	meId,
}: {
	messages: ChatMessage[] | undefined
	inverted: ChatMessage[]
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meId: string | undefined
}) {
	if (messages === undefined) {
		return (
			<View style={styles.centered}>
				<Text style={styles.empty}>Loading…</Text>
			</View>
		)
	}

	if (inverted.length === 0) {
		return (
			<View style={styles.centered}>
				<Text style={styles.empty}>No messages yet.</Text>
			</View>
		)
	}

	return (
		<FlatList
			data={inverted}
			inverted
			keyExtractor={(m) => m.id}
			style={styles.list}
			contentContainerStyle={styles.listBody}
			keyboardShouldPersistTaps="handled"
			renderItem={({ item, index }) => (
				<MessageRow
					message={item}
					// The list is reversed, so index + 1 is the chronologically
					// previous message: a run starts where the sender changes.
					startsRun={inverted[index + 1]?.sender !== item.sender}
					playerOrder={playerOrder}
					profilesById={profilesById}
					meId={meId}
				/>
			)}
		/>
	)
}

function ChatComposer({
	draft,
	setDraft,
	canSend,
	onSend,
}: {
	draft: string
	setDraft: (v: string) => void
	canSend: boolean
	onSend: () => void
}) {
	return (
		<View style={styles.inputRow}>
			<TextInput
				style={styles.input}
				value={draft}
				onChangeText={setDraft}
				placeholder="Say something…"
				placeholderTextColor={colors.textMuted}
				maxLength={CHAT_MAX_CHARS}
				multiline
				returnKeyType="send"
				onSubmitEditing={onSend}
				blurOnSubmit={false}
			/>
			<Pressable
				onPress={onSend}
				disabled={!canSend}
				style={({ pressed }) => [
					styles.sendBtn,
					!canSend && styles.sendBtnDisabled,
					pressed && canSend && styles.pressed,
				]}
				accessibilityLabel="Send message"
			>
				<Ionicons
					name="send"
					size={18}
					color={canSend ? colors.white : colors.textMuted}
				/>
			</Pressable>
		</View>
	)
}

function MessageRow({
	message,
	startsRun,
	playerOrder,
	profilesById,
	meId,
}: {
	message: ChatMessage
	// First message of a consecutive run by one sender: it carries the name
	// header and the extra separation from the run above.
	startsRun: boolean
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meId: string | undefined
}) {
	const mine = message.sender === meId
	const seat = playerOrder.indexOf(message.sender)
	const name = profilesById[message.sender]?.username ?? 'Player'

	const gap = startsRun && styles.rowGroupStart

	if (mine) {
		return (
			<View style={[styles.row, styles.rowMine, gap]}>
				<View style={[styles.bubble, styles.bubbleMine]}>
					<Text style={styles.bubbleTextMine}>{message.body}</Text>
				</View>
			</View>
		)
	}

	return (
		<View style={[styles.row, gap]}>
			{startsRun && (
				<View style={styles.senderLine}>
					<Text
						style={[
							styles.sender,
							{
								color:
									seat >= 0
										? (playerColors[seat] ??
											colors.textSecondary)
										: colors.textSecondary,
							},
						]}
					>
						{name}
					</Text>
					{/* No seat means the sender isn't at the table — they're
					    spectating. Labeled once per run, alongside the name. */}
					{seat < 0 && (
						<Text style={styles.spectatorTag}>watching</Text>
					)}
				</View>
			)}
			<View style={styles.bubble}>
				<Text style={styles.bubbleText}>{message.body}</Text>
			</View>
		</View>
	)
}

const styles = StyleSheet.create({
	// Third floating slot, stacked below BoardLegend (slot 0) and ActionLog
	// (slot 1).
	collapsed: {
		position: 'absolute',
		top: BUTTON_INSET + 2 * (32 + spacing.xs),
		right: spacing.sm,
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: z.floatingButton,
	},
	badge: {
		position: 'absolute',
		top: -4,
		right: -4,
		minWidth: 16,
		height: 16,
		borderRadius: 8,
		paddingHorizontal: 3,
		backgroundColor: colors.error,
		alignItems: 'center',
		justifyContent: 'center',
	},
	badgeText: {
		fontSize: font.xs,
		fontWeight: '700',
		color: colors.white,
	},
	// Covers the play area only — mounted at the screen root, so the header
	// stays visible and tappable above it.
	scrim: {
		position: 'absolute',
		// `top` is supplied inline — it tracks the measured board container.
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: 'rgba(0, 0, 0, 0.15)',
		zIndex: z.chat,
	},
	// Inset by the gap less the slop ring, which `panel` pads back — so the
	// panel's visible edge still sits PANEL_GAP from the play area.
	panelWrap: {
		position: 'absolute',
		top: PANEL_GAP - DISMISS_SLOP,
		left: PANEL_GAP - DISMISS_SLOP,
		right: PANEL_GAP - DISMISS_SLOP,
		bottom: PANEL_GAP - DISMISS_SLOP,
		padding: DISMISS_SLOP,
	},
	panel: {
		flex: 1,
		backgroundColor: PANEL_BG,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		backgroundColor: PANEL_CHROME_BG,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	title: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	closeBtn: {
		width: 28,
		height: 28,
		alignItems: 'center',
		justifyContent: 'center',
	},
	list: {
		flex: 1,
	},
	listBody: {
		padding: spacing.md,
		// Tight baseline: messages within one sender's run read as a block.
		// Run starts add their own separation via `rowGroupStart`.
		gap: 2,
	},
	centered: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	empty: {
		fontSize: font.sm,
		color: colors.textMuted,
	},
	row: {
		alignItems: 'flex-start',
		gap: 2,
	},
	rowMine: {
		alignItems: 'flex-end',
	},
	rowGroupStart: {
		// The run's first (oldest) message is the visual top of the run, so its
		// separation from the run above is a marginTop.
		marginTop: spacing.sm,
	},
	senderLine: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	sender: {
		fontSize: font.xs,
		fontWeight: '700',
		paddingHorizontal: spacing.xs,
	},
	spectatorTag: {
		fontSize: font.xs,
		fontWeight: '600',
		color: colors.textMuted,
		backgroundColor: PANEL_CHROME_BG,
		borderRadius: radius.sm,
		paddingHorizontal: spacing.xs,
	},
	bubble: {
		maxWidth: '85%',
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs,
	},
	bubbleMine: {
		backgroundColor: colors.accent,
		borderColor: colors.accent,
	},
	bubbleText: {
		fontSize: font.base,
		color: colors.text,
	},
	bubbleTextMine: {
		fontSize: font.base,
		color: colors.white,
	},
	error: {
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.xs,
		fontSize: font.sm,
		color: colors.error,
	},
	inputRow: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderTopWidth: 1,
		borderTopColor: colors.border,
		backgroundColor: PANEL_CHROME_BG,
	},
	input: {
		flex: 1,
		minHeight: 40,
		maxHeight: 120,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs,
		fontSize: font.base,
		color: colors.text,
		outlineWidth: 0,
	},
	sendBtn: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: colors.brand,
		alignItems: 'center',
		justifyContent: 'center',
	},
	// No `cursor` override: RN's CursorValue only admits auto|pointer, and the
	// default arrow is already what a disabled affordance should show.
	sendBtnDisabled: {
		backgroundColor: colors.cardAlt,
	},
	pressed: {
		opacity: 0.7,
	},
})
