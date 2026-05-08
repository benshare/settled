// Roulette-style reveal of which resource the desert produced for a nomad
// player on a 7-roll. Shown to all players whenever a `nomad_produce` event
// lands — without it, the resource would just appear in the nomad's hand
// with no explanation.
//
// Five face-down cards (one per resource) are laid out; an indicator hops
// through them with decelerating intervals and lands on the produced one,
// which then flips to reveal the resource.

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

const CARD_W = 56
const CARD_H = 84
const ROULETTE_LOOPS = 2
const TICK_MIN_MS = 55
const TICK_MAX_MS = 220
const TICK_TO_FLIP_PAUSE_MS = 220
const FLIP_HALF_MS = 180
const HOLD_MS = 1100
const FADE_OUT_MS = 220

export type NomadAnimationProps = {
	produced: Resource
	count: number
	playerName: string
	meIsNomad: boolean
	onDismiss: () => void
}

export function NomadAnimation({
	produced,
	count,
	playerName,
	meIsNomad,
	onDismiss,
}: NomadAnimationProps) {
	const cards: Resource[] = [...RESOURCES]
	const producedIndex = cards.indexOf(produced)

	const [highlightIndex, setHighlightIndex] = useState(0)
	const [showFace, setShowFace] = useState(false)
	const flipScaleX = useSharedValue(1)
	const fadeOpacity = useSharedValue(1)
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

	useEffect(() => {
		const totalTicks = ROULETTE_LOOPS * cards.length + producedIndex
		const intervals: number[] = []
		for (let i = 0; i < totalTicks; i += 1) {
			const t = totalTicks <= 1 ? 1 : i / (totalTicks - 1)
			const eased = Math.pow(t, 1.6)
			intervals.push(TICK_MIN_MS + (TICK_MAX_MS - TICK_MIN_MS) * eased)
		}

		function pushTimer(id: ReturnType<typeof setTimeout>) {
			timersRef.current.push(id)
		}

		let i = 0
		function tick() {
			i += 1
			setHighlightIndex(i % cards.length)
			if (i < totalTicks) {
				pushTimer(setTimeout(tick, intervals[i]))
			} else {
				pushTimer(setTimeout(startFlip, TICK_TO_FLIP_PAUSE_MS))
			}
		}
		pushTimer(setTimeout(tick, intervals[0]))

		function startFlip() {
			flipScaleX.value = withTiming(
				0,
				{ duration: FLIP_HALF_MS },
				(finished) => {
					if (!finished) return
					runOnJS(setShowFace)(true)
					flipScaleX.value = withTiming(1, { duration: FLIP_HALF_MS })
				}
			)
			pushTimer(setTimeout(startFadeOut, FLIP_HALF_MS * 2 + HOLD_MS))
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
		// new produce event.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	const fadeStyle = useAnimatedStyle(() => ({
		opacity: fadeOpacity.value,
	}))
	const flipStyle = useAnimatedStyle(() => ({
		transform: [{ scaleX: flipScaleX.value }],
	}))

	const subject = meIsNomad ? 'Your desert' : `${playerName}'s desert`
	const title = showFace
		? `${subject} produced ${count} ${RESOURCE_LABELS[produced]}`
		: `${subject} is producing…`
	return (
		<Modal visible transparent animationType="fade">
			<Animated.View style={[styles.backdrop, fadeStyle]}>
				<View style={styles.sheet}>
					<Text style={styles.title}>{title}</Text>
					<View style={styles.row}>
						{cards.map((res, idx) => (
							<View
								key={res}
								style={[
									styles.cardSlot,
									idx === highlightIndex &&
										styles.cardSlotHighlight,
								]}
							>
								{idx === producedIndex ? (
									<Animated.View
										style={[styles.card, flipStyle]}
									>
										{showFace ? (
											<FrontFace resource={res} />
										) : (
											<BackFace />
										)}
									</Animated.View>
								) : (
									<View style={styles.card}>
										<BackFace />
									</View>
								)}
							</View>
						))}
					</View>
				</View>
			</Animated.View>
		</Modal>
	)
}

function BackFace() {
	return (
		<View style={[styles.face, styles.backFace]}>
			<Text style={styles.backMark}>?</Text>
		</View>
	)
}

function FrontFace({ resource }: { resource: Resource }) {
	return (
		<View
			style={[styles.face, { backgroundColor: resourceColor[resource] }]}
		>
			<Text style={styles.frontLabel}>{RESOURCE_LABELS[resource]}</Text>
		</View>
	)
}

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

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
		gap: spacing.md,
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
	row: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		justifyContent: 'center',
		gap: spacing.xs,
		paddingVertical: spacing.sm,
	},
	cardSlot: {
		padding: 3,
		borderRadius: radius.md,
		borderWidth: 2,
		borderColor: 'transparent',
	},
	cardSlotHighlight: {
		borderColor: colors.brand,
		shadowColor: colors.brand,
		shadowOffset: { width: 0, height: 0 },
		shadowOpacity: 0.7,
		shadowRadius: 6,
		elevation: 6,
	},
	card: {
		width: CARD_W,
		height: CARD_H,
	},
	face: {
		width: '100%',
		height: '100%',
		borderRadius: 8,
		alignItems: 'center',
		justifyContent: 'center',
		borderWidth: 1,
		borderColor: '#2B2B2B',
	},
	backFace: {
		backgroundColor: '#2A2D33',
	},
	backMark: {
		fontSize: 28,
		fontWeight: '800',
		color: '#5A6068',
	},
	frontLabel: {
		fontSize: 13,
		fontWeight: '700',
		color: '#1A1A1A',
	},
})
