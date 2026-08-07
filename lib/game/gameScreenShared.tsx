// The pieces both menu zones render. TopArea's status bars and BottomArea's
// MainLoopBar show the same dice faces, the same nudge button, and the same
// bar chrome — this file is what keeps either zone from having to import the
// other to get at them.

import { canHonk, honkTargetFor } from '@/lib/catan/honk'
import { colors, font, radius, spacing } from '@/lib/theme'
import { useEffect, useState } from 'react'
import {
	Platform,
	Pressable,
	StyleSheet,
	Text,
	View,
	type StyleProp,
	type ViewStyle,
} from 'react-native'

import type { Phase } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import type { GameEvent } from '@/lib/stores/useGamesStore'
import { Ionicons } from '@expo/vector-icons'

// On web we trim chrome around the board a bit so the SVG can breathe.
export const isWeb = Platform.OS === 'web'

// The two physical dice: the first is red, the second yellow. Callers pass the
// tone rather than an index so a surface showing a single die (a picker, a
// preview) can still pick one.
export type DieTone = 'red' | 'yellow'

const DIE_TONES: Record<DieTone, { face: string; edge: string; pip: string }> =
	{
		red: { face: '#C1272D', edge: '#8E1A1F', pip: '#FFF6EF' },
		// Classic Catan prints white pips on the yellow die too, but white-on-yellow
		// is unreadable at these sizes — the pips go dark brown instead.
		yellow: { face: '#F0C020', edge: '#B98A0E', pip: '#3A2A0C' },
	}

// Cell indices in a 3×3 grid, in the standard face arrangement.
const DIE_PIPS: Record<number, number[]> = {
	1: [4],
	2: [0, 8],
	3: [0, 4, 8],
	4: [0, 2, 6, 8],
	5: [0, 2, 4, 6, 8],
	6: [0, 2, 3, 5, 6, 8],
}

export function DieFaceView({
	value,
	tone = 'red',
	size = 32,
}: {
	value: number
	tone?: DieTone
	size?: number
}) {
	const { face, edge, pip } = DIE_TONES[tone]
	const cells = DIE_PIPS[value]
	// The 1pt border and the inset both eat into the box, so the grid divides
	// what's left of it — otherwise the third cell in each row wraps.
	const inset = size * 0.1
	const cell = (size - 2 - inset * 2) / 3
	const dot = cell * 0.66
	const body = {
		width: size,
		height: size,
		borderRadius: size * 0.26,
		padding: inset,
		backgroundColor: face,
		borderColor: edge,
	}

	// A value off the 1–6 faces (nothing produces one today) still has to render
	// something legible rather than a blank die.
	if (!cells) {
		return (
			<View style={[styles.die, body, styles.dieCenter]}>
				<Text style={[styles.dieText, { color: pip }]}>{value}</Text>
			</View>
		)
	}

	return (
		<View style={[styles.die, body]}>
			{Array.from({ length: 9 }, (_, i) => (
				<View
					key={i}
					style={[styles.pipCell, { width: cell, height: cell }]}
				>
					{cells.includes(i) && (
						<View
							style={{
								width: dot,
								height: dot,
								borderRadius: dot / 2,
								backgroundColor: pip,
							}}
						/>
					)}
				</View>
			))}
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
	size = 'small',
	style,
	alwaysShow = false,
}: {
	events: GameEvent[]
	phase: Phase
	meIdx: number
	currentTurn: number
	enabled: boolean
	submitting: boolean
	onHonk: () => void
	size?: 'default' | 'small'
	// Applied over the Button's own chrome (it wins the style array), so a dense
	// surface can slim it past `size="small"` — see the HUD's StatusBanner.
	style?: StyleProp<ViewStyle>
	// When true, the button holds its place for the whole of someone else's
	// turn, disabled until the idle threshold makes a honk due — rather than
	// popping in only once it does. Still hidden when honking has no target this
	// turn (your own turn, a sub-phase) or the game has honking off.
	alwaysShow?: boolean
}) {
	const [now, setNow] = useState(() => Date.now())

	// 10s is ample resolution for a minutes-scale threshold.
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 10_000)
		return () => clearInterval(id)
	}, [])

	const active = canHonk({ events, phase, meIdx, currentTurn, now, enabled })
	// Is there someone to honk at all this turn (regardless of the idle clock)?
	const target = honkTargetFor(phase, currentTurn)
	const relevant = enabled && target !== null && target !== meIdx

	if (alwaysShow ? !relevant : !active) return null

	return (
		<Button
			variant="secondary"
			size={size}
			onPress={onHonk}
			loading={active && submitting}
			disabled={!active}
			style={style}
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
		flexDirection: 'row',
		flexWrap: 'wrap',
		borderWidth: 1,
		boxShadow: '0px 1px 2px rgba(0,0,0,0.25)',
	},
	dieCenter: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	pipCell: {
		alignItems: 'center',
		justifyContent: 'center',
	},
	dieText: {
		fontSize: font.base,
		fontWeight: '700',
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
