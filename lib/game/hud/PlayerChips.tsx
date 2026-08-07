// Floating player previews under the island: a compact chip per seat (avatar +
// VP + card count), tap to expand the full detail overlay. The seat(s) that owe
// an action right now carry an accent dot, derived from `actingSeats` (see
// `status.ts`) so it lights the correct player even when that isn't the
// turn-holder (a 7's discarders, a special-build queue head).

import { colors, radius, spacing } from '@/lib/theme'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, {
	Easing,
	cancelAnimation,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withSequence,
	withTiming,
} from 'react-native-reanimated'

import { useGameScreen } from '@/lib/game/gameScreenContext'
import { Avatar } from '@/lib/modules/Avatar'
import { Ionicons } from '@expo/vector-icons'
import { useEffect } from 'react'
import { actingSeats } from './status'

const AVATAR = 22

export function PlayerChips() {
	const {
		game,
		gameState,
		displayVP,
		liveOffer,
		playerCount,
		profilesById,
		seatColors,
		setOpenPlayerIdx,
	} = useGameScreen()
	if (!game || !gameState) return null

	const acting = actingSeats(
		gameState,
		gameState.currentTurn,
		playerCount,
		liveOffer
	)
	const seats = game.player_order.map((_, i) => i)
	// <4 one row; 4–6 two centered rows.
	const rows =
		seats.length < 4
			? [seats]
			: [
					seats.slice(0, Math.ceil(seats.length / 2)),
					seats.slice(Math.ceil(seats.length / 2)),
				]

	return (
		<View style={styles.wrap} pointerEvents="box-none">
			{rows.map((row, r) => (
				<View key={r} style={styles.row}>
					{row.map((i) => (
						<Chip
							key={game.player_order[i]}
							color={seatColors[i] ?? colors.textMuted}
							profile={profilesById[game.player_order[i]]}
							vp={displayVP[i] ?? 0}
							cards={sumHand(gameState.players[i]?.resources)}
							acting={acting.has(i)}
							onPress={() => setOpenPlayerIdx(i)}
						/>
					))}
				</View>
			))}
		</View>
	)
}

function Chip({
	color,
	profile,
	vp,
	cards,
	acting,
	onPress,
}: {
	// The seat's color, resolved once in `gameContext` (`useGame().seatColors`)
	// so the chip can't disagree with the board.
	color: string
	profile: Parameters<typeof Avatar>[0]['profile']
	vp: number
	cards: number
	acting: boolean
	onPress: () => void
}) {
	return (
		// The pulse ring is a sibling in a non-clipping wrapper — a child of the
		// rounded chip would be clipped to its bounds (web/Android) and vanish.
		<View style={styles.chipOuter}>
			<Pressable
				onPress={onPress}
				style={({ pressed }) => [
					styles.chip,
					acting && styles.chipActing,
					pressed && styles.pressed,
				]}
			>
				<View style={[styles.colorDot, { backgroundColor: color }]} />
				<Avatar profile={profile} size={AVATAR} />
				<View style={styles.stat}>
					<Ionicons
						name="trophy"
						size={11}
						color={colors.textSecondary}
					/>
					<Text style={styles.statText}>{vp}</Text>
				</View>
				<View style={styles.stat}>
					<Ionicons
						name="albums"
						size={11}
						color={colors.textSecondary}
					/>
					<Text style={styles.statText}>{cards}</Text>
				</View>
			</Pressable>
			{acting && (
				<>
					{/* The persistent accent outline (an overlay, so width stays
					    constant) plus the ripple that emanates from it. */}
					<View pointerEvents="none" style={styles.pulseRing} />
					<PulseRing />
				</>
			)}
		</View>
	)
}

// One ripple: expand over EXPAND_MS, then hold invisible for GAP_MS before the
// next — so the pulse fires infrequently with a clear gap between.
const EXPAND_MS = 1500
const GAP_MS = 2500
// How far the ring spreads, in px, EQUALLY on every side — animated as an outset
// inset rather than a transform `scale`, which would stretch the spread to the
// chip's wide-pill aspect (lots of horizontal gap, little vertical).
const SPREAD_PX = 12

// A radar ring that emanates from the active seat's chip and fades. Absolutely
// positioned and outset, so it never affects layout. `reverse: false` restarts
// each ripple at the border; the restart is invisible (opacity 0 at cycle end).
function PulseRing() {
	const p = useSharedValue(0)
	useEffect(() => {
		p.value = withRepeat(
			withSequence(
				withTiming(1, {
					duration: EXPAND_MS,
					easing: Easing.out(Easing.ease),
				}),
				withTiming(1, { duration: GAP_MS })
			),
			-1,
			false
		)
		return () => cancelAnimation(p)
	}, [p])
	const ring = useAnimatedStyle(() => {
		const e = SPREAD_PX * p.value
		return {
			top: -e,
			left: -e,
			right: -e,
			bottom: -e,
			opacity: 0.55 * (1 - p.value),
		}
	})
	return (
		<Animated.View pointerEvents="none" style={[styles.pulseRing, ring]} />
	)
}

function sumHand(hand: Record<string, number> | undefined): number {
	if (!hand) return 0
	let n = 0
	for (const k in hand) n += hand[k] ?? 0
	return n
}

const styles = StyleSheet.create({
	wrap: {
		alignItems: 'center',
		gap: spacing.sm,
	},
	row: {
		flexDirection: 'row',
		gap: spacing.sm,
		justifyContent: 'center',
	},
	chipOuter: {
		position: 'relative',
	},
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 5,
		paddingLeft: 5,
		paddingRight: spacing.sm,
		paddingVertical: 3,
		borderRadius: radius.full,
		backgroundColor: colors.card,
		// Others get a plain 1px hairline in the usual border colour; the active
		// seat below gets the prominent accent outline.
		borderWidth: 1,
		borderColor: colors.border,
		boxShadow: '0px 2px 6px rgba(0,0,0,0.12)',
	},
	// The seat that owes an action: a darker cream fill (the others' border
	// colour). The accent outline is the pulsing ring (see PulseRing), so the
	// base 1px border is unchanged and the chip width stays constant.
	chipActing: {
		backgroundColor: colors.borderLight,
	},
	// Starts flush with the chip (inset 0) and scales outward, so the ripple
	// emanates from the border.
	pulseRing: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		borderRadius: radius.full,
		borderWidth: 2,
		borderColor: colors.brand,
	},
	pressed: {
		opacity: 0.7,
	},
	colorDot: {
		width: 7,
		height: 7,
		borderRadius: radius.full,
	},
	stat: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
	},
	statText: {
		fontSize: 12,
		fontWeight: '600',
		color: colors.textSecondary,
	},
})
