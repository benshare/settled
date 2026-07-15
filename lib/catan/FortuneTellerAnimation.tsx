// Dice-reveal of a fortune-teller bonus roll. Shown to all players whenever a
// `fortune_teller_roll` event with a non-empty gain lands — without it, the
// bonus resources would just appear in the FT player's hand with no
// explanation, which is especially opaque on a 7 (the bonus fires only after
// the robber chain resolves).
//
// Two dice tumble through faces with decelerating intervals and settle on the
// rolled pair; the resources they produced then fade in below.

import { useEffect, useRef, useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import Animated, {
	runOnJS,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'
import type { ResourceHand } from './types'

const DIE = 48
const TUMBLE_TICKS = 14
const TICK_MIN_MS = 55
const TICK_MAX_MS = 200
const REVEAL_DELAY_MS = 220
const HOLD_MS = 1300
const FADE_OUT_MS = 220

export type FortuneTellerAnimationProps = {
	dice: [number, number]
	total: number
	gain: ResourceHand
	playerName: string
	meIsFortuneTeller: boolean
	onDismiss: () => void
}

export function FortuneTellerAnimation({
	dice,
	total,
	gain,
	playerName,
	meIsFortuneTeller,
	onDismiss,
}: FortuneTellerAnimationProps) {
	const [faces, setFaces] = useState<[number, number]>([1, 1])
	const [settled, setSettled] = useState(false)
	const revealScale = useSharedValue(0.6)
	const revealOpacity = useSharedValue(0)
	const fadeOpacity = useSharedValue(1)
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

	useEffect(() => {
		function pushTimer(id: ReturnType<typeof setTimeout>) {
			timersRef.current.push(id)
		}

		const intervals: number[] = []
		for (let i = 0; i < TUMBLE_TICKS; i += 1) {
			const t = TUMBLE_TICKS <= 1 ? 1 : i / (TUMBLE_TICKS - 1)
			const eased = Math.pow(t, 1.6)
			intervals.push(TICK_MIN_MS + (TICK_MAX_MS - TICK_MIN_MS) * eased)
		}

		let i = 0
		function tick() {
			i += 1
			if (i < TUMBLE_TICKS) {
				setFaces([1 + ((i * 3) % 6), 1 + ((i * 5 + 2) % 6)])
				pushTimer(setTimeout(tick, intervals[i]))
			} else {
				setFaces(dice)
				setSettled(true)
				pushTimer(setTimeout(startReveal, REVEAL_DELAY_MS))
			}
		}
		pushTimer(setTimeout(tick, intervals[0]))

		function startReveal() {
			revealOpacity.value = withTiming(1, { duration: 200 })
			revealScale.value = withTiming(1, { duration: 200 })
			pushTimer(setTimeout(startFadeOut, HOLD_MS))
		}

		function startFadeOut() {
			fadeOpacity.value = withTiming(
				0,
				{ duration: FADE_OUT_MS },
				(finished) => {
					if (finished) runOnJS(onDismiss)()
				}
			)
		}

		return () => {
			for (const id of timersRef.current) clearTimeout(id)
			timersRef.current = []
		}
		// Animation is scoped to initial mount; parent remounts via key for a
		// new fortune_teller_roll event.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeOpacity.value }))
	const revealStyle = useAnimatedStyle(() => ({
		opacity: revealOpacity.value,
		transform: [{ scale: revealScale.value }],
	}))

	const subject = meIsFortuneTeller
		? 'Your fortune teller'
		: `${playerName}'s fortune teller`
	const gained = RESOURCES.filter((r) => gain[r] > 0)

	return (
		<Modal visible transparent animationType="fade">
			<Animated.View style={[styles.backdrop, fadeStyle]}>
				<View style={styles.sheet}>
					<Text style={styles.title}>{subject}</Text>
					<View style={styles.diceRow}>
						<Die value={faces[0]} />
						<Die value={faces[1]} />
					</View>
					<Text style={styles.total}>
						{settled ? `Rolled ${total}` : 'Rolling…'}
					</Text>
					<Animated.View style={[styles.gainRow, revealStyle]}>
						{gained.map((r) => (
							<View key={r} style={styles.chip}>
								<View
									style={[
										styles.chipSwatch,
										{ backgroundColor: resourceColor[r] },
									]}
								/>
								<Text style={styles.chipLabel}>
									{RESOURCE_LABELS[r]} ×{gain[r]}
								</Text>
							</View>
						))}
					</Animated.View>
				</View>
			</Animated.View>
		</Modal>
	)
}

function Die({ value }: { value: number }) {
	const pips = PIP_LAYOUT[value] ?? []
	return (
		<View style={styles.die}>
			{pips.map(([x, y], idx) => (
				<View
					key={idx}
					style={[styles.pip, { left: `${x}%`, top: `${y}%` }]}
				/>
			))}
		</View>
	)
}

// Pip positions per face as [left%, top%] of the die (pips are centered on the
// point via a negative margin in the `pip` style).
const PIP_LAYOUT: Record<number, [number, number][]> = {
	1: [[50, 50]],
	2: [
		[28, 28],
		[72, 72],
	],
	3: [
		[28, 28],
		[50, 50],
		[72, 72],
	],
	4: [
		[28, 28],
		[72, 28],
		[28, 72],
		[72, 72],
	],
	5: [
		[28, 28],
		[72, 28],
		[50, 50],
		[28, 72],
		[72, 72],
	],
	6: [
		[28, 25],
		[72, 25],
		[28, 50],
		[72, 50],
		[28, 75],
		[72, 75],
	],
}

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

const PIP = 8

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: 'rgba(0, 0, 0, 0.55)',
	},
	sheet: {
		paddingVertical: spacing.lg,
		paddingHorizontal: spacing.md,
		gap: spacing.sm,
		borderRadius: radius.lg,
		backgroundColor: colors.background,
		alignItems: 'center',
		maxWidth: '92%',
	},
	title: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
		textAlign: 'center',
	},
	diceRow: {
		flexDirection: 'row',
		gap: spacing.md,
		paddingVertical: spacing.sm,
	},
	die: {
		width: DIE,
		height: DIE,
		borderRadius: 10,
		backgroundColor: '#F4F1EA',
		borderWidth: 1,
		borderColor: '#2B2B2B',
	},
	pip: {
		position: 'absolute',
		width: PIP,
		height: PIP,
		marginLeft: -PIP / 2,
		marginTop: -PIP / 2,
		borderRadius: PIP / 2,
		backgroundColor: '#1A1A1A',
	},
	total: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textMuted,
	},
	gainRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		justifyContent: 'center',
		gap: spacing.xs,
		minHeight: 28,
	},
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		paddingVertical: 4,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
	},
	chipSwatch: {
		width: 14,
		height: 14,
		borderRadius: 4,
		borderWidth: 1,
		borderColor: '#2B2B2B',
	},
	chipLabel: {
		fontSize: 13,
		fontWeight: '700',
		color: colors.text,
	},
})
