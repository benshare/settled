// The pieces both menu zones render. TopArea's status bars and BottomArea's
// MainLoopBar show the same dice faces, the same nudge button, and the same
// bar chrome — this file is what keeps either zone from having to import the
// other to get at them.

import { canHonk } from '@/lib/catan/honk'
import type { Phase } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import type { GameEvent } from '@/lib/stores/useGamesStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'

// On web we trim chrome around the board a bit so the SVG can breathe.
export const isWeb = Platform.OS === 'web'

export function DieFaceView({ value }: { value: number }) {
	return (
		<View style={styles.die}>
			<Text style={styles.dieText}>{value}</Text>
		</View>
	)
}

// Nudge for a player who's stalled past the idle threshold — on the roll
// prompt, mid-turn in main, or holding up the special build queue. Its own
// component rather than inline in the bars because it needs a ticking clock to
// notice the idle mark, and those bars early-return on `phase.kind` before any
// hook could run.
// Mounting only while someone is waiting also keeps the interval off for the
// rest of the game.
export function HonkButton({
	events,
	phase,
	meIdx,
	currentTurn,
	enabled,
	submitting,
	onHonk,
	size,
}: {
	events: GameEvent[]
	phase: Phase
	meIdx: number
	currentTurn: number
	enabled: boolean
	submitting: boolean
	onHonk: () => void
	size?: 'default' | 'small'
}) {
	const [now, setNow] = useState(() => Date.now())

	// 10s is ample resolution for a minutes-scale threshold.
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 10_000)
		return () => clearInterval(id)
	}, [])

	if (!canHonk({ events, phase, meIdx, currentTurn, now, enabled }))
		return null

	return (
		<Button
			variant="secondary"
			size={size}
			onPress={onHonk}
			loading={submitting}
		>
			Honk
		</Button>
	)
}

// Take back your own last action. Only ever rendered when the screen context
// says the server would accept it, so it has no disabled state of its own —
// when there's nothing to undo the button isn't there. Icon-only and square,
// sized to the row's buttons so the action row stays even.
export function UndoButton({
	submitting,
	onPress,
}: {
	submitting: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			onPress={onPress}
			disabled={submitting}
			accessibilityRole="button"
			accessibilityLabel="Undo last action"
			style={({ pressed }) => [
				styles.undoBtn,
				submitting && styles.undoBtnBusy,
				pressed && !submitting && sharedStyles.pressed,
			]}
		>
			<Ionicons name="arrow-undo" size={20} color={colors.text} />
		</Pressable>
	)
}

// Bar chrome shared by the two zones. Anything only one zone uses lives in
// that zone's own StyleSheet.
export const sharedStyles = StyleSheet.create({
	actionBar: {
		paddingHorizontal: spacing.md,
		paddingTop: isWeb ? spacing.xs : spacing.sm,
		paddingBottom: isWeb ? spacing.xs : spacing.md,
		height: isWeb ? 60 : 76,
		justifyContent: 'center',
	},
	mainLoopRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		height: 52,
	},
	mainLoopStatus: {
		flex: 1,
		fontSize: font.base,
		color: colors.text,
		fontWeight: '600',
	},
	diceRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	pressed: {
		opacity: 0.7,
	},
})

const styles = StyleSheet.create({
	die: {
		width: 32,
		height: 32,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.white,
		alignItems: 'center',
		justifyContent: 'center',
	},
	dieText: {
		fontSize: font.base,
		fontWeight: '700',
		color: colors.text,
	},
	// Matches the secondary Button's chrome and the 52pt row height, so the
	// arrow reads as part of the same row of actions.
	undoBtn: {
		width: 52,
		height: 52,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	undoBtnBusy: {
		opacity: 0.4,
	},
})
