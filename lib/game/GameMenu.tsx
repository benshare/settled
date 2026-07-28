// The game screen's overflow menu: the two ways a game can end without anyone
// reaching the VP threshold.
//
//   Forfeit    — a standing, withdrawable declaration. When every seat but one
//                holds one, the game ends and the survivor wins.
//   End game   — the same shape, but it needs the WHOLE table. When it lands,
//                the game is canceled: no winner, and it counts for nothing.
//
// Neither has any mechanical effect while it stands — a forfeited player keeps
// their seat, their turn and their resources. See
// `.claude/specs/forfeit-and-end-game.md`.
//
// It lives in `Nav` (opposite the back chevron) rather than in a zone because,
// like the title, it is about *which game you're on* rather than about what the
// board is waiting for. For a spectator or a finished game it renders a spacer
// of the same width instead, so the title stays centred either way.

import { ConfirmModal } from '@/lib/modules/ConfirmModal'
import { Modal } from '@/lib/modules/Modal'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useGameScreen } from './gameScreenContext'
import { isWeb } from './gameScreenShared'

// Matches the "your turn" dot on the Games list and the header tab strip.
const PENDING_DOT_SIZE = 8

type Pending = 'forfeit' | 'end' | null

export function GameMenu() {
	const {
		canEndGame,
		forfeitedIds,
		endVoteIds,
		myForfeit,
		myEndVote,
		submitting,
		onSetForfeit,
		onSetEndVote,
	} = useGameScreen()

	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState<Pending>(null)

	// A spectator has no seat to forfeit, and a finished game has nothing left
	// to declare. Both fall back to the spacer that keeps the title centred.
	if (!canEndGame) return <View style={styles.slot} />

	// Without this the sheet is the only place a standing declaration exists,
	// and nobody would think to open it.
	const anyPending = forfeitedIds.length > 0 || endVoteIds.length > 0

	// Only one sheet is ever mounted at a time: `Modal` is RN's, and on iOS a
	// second one presented while the first is up can silently fail to appear.
	// So asking swaps the menu for the confirm, and cancelling swaps back —
	// which also lands the user where they were rather than on the board.
	function ask(which: Exclude<Pending, null>) {
		setOpen(false)
		setPending(which)
	}

	function cancel() {
		setPending(null)
		setOpen(true)
	}

	async function confirm() {
		const which = pending
		setPending(null)
		if (which === 'forfeit') await onSetForfeit(true)
		else if (which === 'end') await onSetEndVote(true)
	}

	return (
		<>
			<Pressable
				onPress={() => setOpen(true)}
				hitSlop={8}
				style={({ pressed }) => [
					styles.slot,
					pressed && styles.pressed,
				]}
			>
				<Ionicons
					name="ellipsis-horizontal"
					size={22}
					color={colors.text}
				/>
				{anyPending && <View style={styles.pendingDot} />}
			</Pressable>

			<Modal
				visible={open}
				onDismiss={() => setOpen(false)}
				contentStyle={styles.sheet}
			>
				<Section
					title="Forfeit"
					status={<ForfeitStatus />}
					blurb="The last player left standing wins."
					active={myForfeit}
					activeLabel="Withdraw forfeit"
					idleLabel="Forfeit game"
					submitting={submitting}
					// Withdrawing is the undo — it doesn't need an "are you
					// sure" in front of it.
					onIdlePress={() => ask('forfeit')}
					onActivePress={() => onSetForfeit(false)}
				/>

				<View style={styles.divider} />

				<Section
					title="End game"
					status={<EndVoteStatus />}
					blurb="Everyone has to agree. A canceled game counts for nothing."
					active={myEndVote}
					activeLabel="Withdraw vote"
					idleLabel="End game"
					submitting={submitting}
					onIdlePress={() => ask('end')}
					onActivePress={() => onSetEndVote(false)}
				/>
			</Modal>

			<ConfirmModal
				visible={pending !== null}
				title={
					pending === 'forfeit'
						? 'Forfeit this game?'
						: 'Vote to end this game?'
				}
				message={
					pending === 'forfeit'
						? 'Everyone will see it. If every other player has also forfeited, the game ends right now and the remaining player wins.'
						: 'Everyone will see it. Once every player has voted, the game is canceled with no winner and counts for nothing.'
				}
				confirmLabel={pending === 'forfeit' ? 'Forfeit' : 'End game'}
				destructive
				submitting={submitting}
				onConfirm={confirm}
				onCancel={cancel}
			/>
		</>
	)
}

function Section({
	title,
	status,
	blurb,
	active,
	activeLabel,
	idleLabel,
	submitting,
	onIdlePress,
	onActivePress,
}: {
	title: string
	status: ReactNode
	blurb: string
	active: boolean
	activeLabel: string
	idleLabel: string
	submitting: boolean
	onIdlePress: () => void
	onActivePress: () => void
}) {
	return (
		<View style={styles.section}>
			<Text style={styles.sectionTitle}>{title}</Text>
			{status}
			<Text style={styles.blurb}>{blurb}</Text>
			<Pressable
				onPress={active ? onActivePress : onIdlePress}
				disabled={submitting}
				style={({ pressed }) => [
					styles.action,
					active && styles.actionActive,
					submitting && styles.actionDisabled,
					pressed && !submitting && styles.pressed,
				]}
			>
				<Text
					style={[
						styles.actionText,
						active && styles.actionTextActive,
					]}
				>
					{active ? activeLabel : idleLabel}
				</Text>
			</Pressable>
		</View>
	)
}

// Names the forfeiters — with two or three seats, a count would say less than
// the names do.
function ForfeitStatus() {
	const { forfeitedIds, meId, profilesById } = useGameScreen()
	if (forfeitedIds.length === 0) return null
	const names = forfeitedIds.map((id) =>
		id === meId ? 'You' : (profilesById[id]?.username ?? '…')
	)
	return (
		<Text style={styles.status}>
			{names.join(', ')}{' '}
			{names.length === 1 && names[0] !== 'You' ? 'has' : 'have'}{' '}
			forfeited.
		</Text>
	)
}

// A count, not names: the threshold is the whole table, so what matters is how
// far off it is.
function EndVoteStatus() {
	const { endVoteIds, playerCount } = useGameScreen()
	if (endVoteIds.length === 0) return null
	return (
		<Text style={styles.status}>
			{endVoteIds.length} of {playerCount} players want to end.
		</Text>
	)
}

const styles = StyleSheet.create({
	// Sized to match Nav's back chevron, so the title stays centred whether the
	// menu renders or not.
	slot: {
		width: isWeb ? 32 : 40,
		height: isWeb ? 32 : 40,
		alignItems: 'center',
		justifyContent: 'center',
	},
	pressed: {
		opacity: 0.6,
	},
	pendingDot: {
		position: 'absolute',
		top: 6,
		right: 4,
		width: PENDING_DOT_SIZE,
		height: PENDING_DOT_SIZE,
		borderRadius: PENDING_DOT_SIZE / 2,
		backgroundColor: colors.brand,
	},
	sheet: {
		width: '100%',
		maxWidth: 420,
		backgroundColor: colors.background,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	section: {
		padding: spacing.md,
		gap: spacing.xs,
	},
	sectionTitle: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	status: {
		fontSize: font.sm,
		color: colors.text,
	},
	blurb: {
		fontSize: font.sm,
		color: colors.textMuted,
		lineHeight: 18,
	},
	divider: {
		height: 1,
		backgroundColor: colors.border,
	},
	action: {
		marginTop: spacing.xs,
		minHeight: 44,
		alignItems: 'center',
		justifyContent: 'center',
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.error,
	},
	// A withdraw is not the destructive act — the submit was.
	actionActive: {
		borderColor: colors.border,
	},
	actionDisabled: {
		opacity: 0.5,
	},
	actionText: {
		fontSize: font.base,
		fontWeight: '600',
		color: colors.error,
	},
	actionTextActive: {
		color: colors.text,
	},
})
