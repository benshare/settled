// The pieces both menu zones render. TopArea's status bars and BottomArea's
// MainLoopBar show the same dice faces, the same nudge button, and the same
// bar chrome — this file is what keeps either zone from having to import the
// other to get at them.

import { canHonk } from '@/lib/catan/honk'
import type { Phase } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import type { GameEvent } from '@/lib/stores/useGamesStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'

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
}: {
	events: GameEvent[]
	phase: Phase
	meIdx: number
	currentTurn: number
	enabled: boolean
	submitting: boolean
	onHonk: () => void
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
		<Button variant="secondary" onPress={onHonk} loading={submitting}>
			Honk
		</Button>
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
})
