// Per-game chat UI. Data comes from <ChatProvider> — see chatContext.tsx.
//
// Two exports, mounted at different levels of the game screen:
//
// - `ChatButton` — the floating affordance, third slot below BoardLegend and
//   ActionLog, so it lives inside the board container with them.
// - `ChatPanel` — the conversation. Mounted at the play-area root (`bodyRoot`)
//   rather than inside the board container, so it covers the action bars too
//   but stops short of the screen header. It is an absolutely-positioned view
//   rather than a Modal precisely so it stays inside the play area — a Modal
//   would cover the whole screen.

import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
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
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
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
	// Board container's y within bodyRoot, measured by the game screen. The
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

	// Lift the whole overlay by the keyboard's height rather than shrinking it —
	// the panel's bottom edge is pinned to the play area, which sits well above
	// the screen bottom, so padding-style avoidance leaves the composer covered.
	// The play area already stops short of the screen bottom by the safe-area
	// inset, which the keyboard covers — lifting by the full height would leave
	// that inset as extra dead space above the keyboard.
	const insets = useSafeAreaInsets()
	const keyboard = useAnimatedKeyboard()
	const lift = useAnimatedStyle(() => ({
		transform: [
			{ translateY: -Math.max(0, keyboard.height.value - insets.bottom) },
		],
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
			style={[styles.scrim, { top: topOffset + BUTTON_INSET }, lift]}
		>
			<Pressable style={styles.fill} onPress={() => setOpen(false)}>
				{/* Swallows taps so they never reach the scrim. */}
				<Pressable style={styles.panel} onPress={() => {}}>
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
				</Pressable>
			</Pressable>
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

	// The list is inverted, which flips each cell vertically — so margin*Bottom*
	// is what renders as space *above* the row.
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
		zIndex: 4,
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
	// Covers the play area only — mounted in bodyRoot, so the screen header
	// stays visible and tappable above it.
	scrim: {
		position: 'absolute',
		// `top` is supplied inline — it tracks the measured board container.
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: 'rgba(0, 0, 0, 0.15)',
		padding: PANEL_GAP,
		zIndex: 10,
	},
	fill: {
		flex: 1,
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
		marginBottom: spacing.sm,
	},
	sender: {
		fontSize: font.xs,
		fontWeight: '700',
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
