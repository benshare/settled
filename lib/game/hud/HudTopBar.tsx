// The HUD's top row, rendered fixed over the slide by HudScreen: a Back button
// (left), a games pager (center — dots showing how many games there are and
// which one you're on, hidden for a single game), and the overflow menu (right).
//
// The `⋯` menu is one-tap (propose/withdraw end game, resign/withdraw, copy
// debug) — no confirms or blurbs — deliberately separate from the classic
// `GameMenu`. It reads the route-level providers (the current game) that wrap
// HudScreen.

import { useGameScreen } from '@/lib/game/gameScreenContext'
import { Modal } from '@/lib/modules/Modal'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function HudTopBar({
	pageCount,
	pageIndex,
}: {
	pageCount: number
	pageIndex: number
}) {
	const insets = useSafeAreaInsets()
	const dropTop = insets.top + 44

	return (
		<View style={styles.row} pointerEvents="box-none">
			{/* Equal-flex sides pin Back left and the menu right, so the pager
			    sits dead-center on the page. */}
			<View style={styles.sideStart} pointerEvents="box-none">
				<BackButton />
			</View>
			{pageCount > 1 && <Pager count={pageCount} index={pageIndex} />}
			<View style={styles.sideEnd} pointerEvents="box-none">
				<HudMenu dropTop={dropTop} />
			</View>
		</View>
	)
}

function BackButton() {
	const router = useRouter()
	return (
		<Pressable
			onPress={() => router.replace('/games')}
			hitSlop={8}
			style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
			accessibilityLabel="Back to games"
		>
			<Ionicons name="chevron-back" size={16} color={colors.text} />
			<Text style={styles.backText}>Back</Text>
		</Pressable>
	)
}

// Which game you're on, out of how many — one dot per switchable game, the
// active one filled. Left-to-right matches the slide (newest game leftmost).
function Pager({ count, index }: { count: number; index: number }) {
	return (
		<View style={styles.dots} pointerEvents="none">
			{Array.from({ length: count }, (_, i) => (
				<View
					key={i}
					style={[styles.dot, i === index && styles.dotActive]}
				/>
			))}
		</View>
	)
}

function HudMenu({ dropTop }: { dropTop: number }) {
	const {
		game,
		meId,
		canEndGame,
		forfeitedIds,
		endVoteIds,
		myForfeit,
		myEndVote,
		onSetForfeit,
		onSetEndVote,
		showToast,
	} = useGameScreen()
	const [open, setOpen] = useState(false)

	const anyPending = forfeitedIds.length > 0 || endVoteIds.length > 0

	const copyDebug = async () => {
		setOpen(false)
		await Clipboard.setStringAsync(
			JSON.stringify(
				{ gameId: game?.id ?? null, playerId: meId ?? null },
				null,
				2
			)
		)
		showToast('Copied')
	}

	return (
		<>
			<Pressable
				onPress={() => setOpen(true)}
				hitSlop={8}
				style={({ pressed }) => [
					styles.menuBtn,
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
				backdropStyle={[
					styles.dropBackdrop,
					{ paddingTop: dropTop, alignItems: 'flex-end' },
				]}
				contentStyle={styles.sheet}
			>
				{canEndGame && (
					<MenuRow
						icon="flag-outline"
						label={
							myEndVote ? 'Withdraw end game' : 'Propose end game'
						}
						onPress={() => {
							setOpen(false)
							onSetEndVote(!myEndVote)
						}}
					/>
				)}
				{canEndGame && (
					<MenuRow
						icon="exit-outline"
						label={myForfeit ? 'Withdraw resignation' : 'Resign'}
						danger={!myForfeit}
						onPress={() => {
							setOpen(false)
							onSetForfeit(!myForfeit)
						}}
					/>
				)}
				<MenuRow
					icon="bug-outline"
					label="Copy debug info"
					onPress={copyDebug}
				/>
			</Modal>
		</>
	)
}

function MenuRow({
	icon,
	label,
	danger,
	onPress,
}: {
	icon: React.ComponentProps<typeof Ionicons>['name']
	label: string
	danger?: boolean
	onPress: () => void
}): ReactNode {
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
		>
			<Ionicons
				name={icon}
				size={18}
				color={danger ? colors.error : colors.textSecondary}
			/>
			<Text style={[styles.menuLabel, danger && { color: colors.error }]}>
				{label}
			</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingHorizontal: spacing.md,
	},
	sideStart: {
		flex: 1,
		flexDirection: 'row',
		justifyContent: 'flex-start',
	},
	sideEnd: {
		flex: 1,
		flexDirection: 'row',
		justifyContent: 'flex-end',
	},
	backBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
		paddingLeft: 6,
		paddingRight: spacing.sm,
		paddingVertical: 6,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
	},
	backText: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	dots: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	dot: {
		width: 7,
		height: 7,
		borderRadius: radius.full,
		backgroundColor: 'rgba(250,243,224,0.5)',
	},
	dotActive: {
		backgroundColor: colors.card,
	},
	menuBtn: {
		width: 34,
		height: 34,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	pendingDot: {
		position: 'absolute',
		top: 5,
		right: 5,
		width: 8,
		height: 8,
		borderRadius: 4,
		backgroundColor: colors.brand,
	},
	pressed: {
		opacity: 0.6,
	},
	dropBackdrop: {
		backgroundColor: 'transparent',
		justifyContent: 'flex-start',
		paddingHorizontal: spacing.md,
	},
	sheet: {
		minWidth: 220,
		maxWidth: 300,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
	},
	menuRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		paddingVertical: spacing.md,
		paddingHorizontal: spacing.md,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderLight,
	},
	menuLabel: {
		fontSize: font.base,
		fontWeight: '600',
		color: colors.text,
	},
})
