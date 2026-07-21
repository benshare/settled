// Full-screen modal shown during the `post_placement` phase for players
// who still have a start-of-game bonus action pending. Today that's only
// `specialist` (declare a resource). New set-2/3 bonuses (explorer,
// fencer, haunt) plug into the same phase by adding entries to
// phase.pending and extending this overlay.

import { Button } from '@/lib/modules/Button'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '@/lib/modules/Modal'
import Animated, {
	FadeIn,
	FadeOut,
	LinearTransition,
	useAnimatedStyle,
	withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

export function SpecialistDeclareOverlay({
	waitingOn,
	submitting,
	onConfirm,
}: {
	waitingOn: string[]
	submitting: boolean
	onConfirm: (resource: Resource) => void
}) {
	const { colors } = useTheme()
	const insets = useSafeAreaInsets()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [pick, setPick] = useState<Resource | null>(null)
	const [minimized, setMinimized] = useState(false)

	// Single chevron that flips by mirroring on the Y axis (scaleY 1 → -1);
	// animating through 0 reads as a vertical flip rather than a swap. Driven
	// straight off `minimized` — the worklet re-runs when it changes and
	// withTiming animates to the new target.
	const chevronStyle = useAnimatedStyle(() => ({
		transform: [{ scaleY: withTiming(minimized ? -1 : 1, { duration: 220 }) }],
	}))
	function toggleMinimized() {
		setMinimized((m) => !m)
	}

	// Anchored to the top (via backdropStyle) rather than centered so the header
	// stays put as the body collapses — minimizing just shrinks the sheet upward,
	// keeping the board visible below. The sheet's resize is animated via the
	// Modal's `layout` transition; the body's grow/shrink also fades in/out.
	return (
		<Modal
			visible
			dismissOnBackdropPress={false}
			contentStyle={styles.sheet}
			backdropStyle={[
				styles.backdrop,
				{ paddingTop: insets.top + spacing.lg },
			]}
			layout={LinearTransition.duration(220)}
		>
			<View style={styles.titleRow}>
				<Text style={styles.title}>Declare your specialty</Text>
				<Pressable
					onPress={toggleMinimized}
					hitSlop={8}
					style={({ pressed }) => pressed && styles.pressed}
				>
					<Animated.View style={chevronStyle}>
						<Ionicons
							name="chevron-down"
							size={22}
							color={colors.textSecondary}
						/>
					</Animated.View>
				</Pressable>
			</View>
			{!minimized && (
				<Animated.View
					entering={FadeIn.duration(180)}
					exiting={FadeOut.duration(160)}
					style={styles.body}
				>
					<Text style={styles.subtitle}>
						Pick the resource you'll specialize in. Any port trade
						that takes this resource as input costs 1 fewer for you.
					</Text>
					<View style={styles.grid}>
						{RESOURCES.map((r) => (
							<Pressable
								key={r}
								onPress={() => setPick(r)}
								style={({ pressed }) => [
									styles.card,
									{
										backgroundColor: resourceColor[r],
									},
									pick === r && styles.cardPicked,
									pressed && styles.pressed,
								]}
							>
								<Text style={styles.cardLabel}>
									{RESOURCE_LABELS[r]}
								</Text>
							</Pressable>
						))}
					</View>
					{waitingOn.length > 0 && (
						<Text style={styles.waiting}>
							Waiting on {waitingOn.join(', ')}…
						</Text>
					)}
					<Button
						onPress={() => pick && onConfirm(pick)}
						disabled={pick === null}
						loading={submitting}
					>
						Confirm
					</Button>
				</Animated.View>
			)}
		</Modal>
	)
}

// Explorer's "place 3 free roads" affordance during post_placement. Renders
// as a small inline banner with a counter; the actual road picks happen on
// the board (BuildLayer with tool='explorer_road'). Counter goes 3 → 0,
// mirroring `phase.pending.explorer[meIdx]`.
export function ExplorerStatusBanner({
	remaining,
	waitingOn,
}: {
	remaining: number
	waitingOn: string[]
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	if (remaining <= 0 && waitingOn.length === 0) return null
	return (
		<View style={styles.banner}>
			{remaining > 0 ? (
				<Text style={styles.bannerText}>
					Explorer: place {remaining} more free road
					{remaining === 1 ? '' : 's'} on the board.
				</Text>
			) : (
				<Text style={styles.bannerText}>
					Waiting on {waitingOn.join(', ')} to place explorer roads.
				</Text>
			)}
		</View>
	)
}

// Fencer's "reserve 2 edges" affordance. Inline banner + counter; edge picks
// happen on the board (BuildLayer tool='fence_token').
export function FenceStatusBanner({
	remaining,
	waitingOn,
}: {
	remaining: number
	waitingOn: string[]
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	if (remaining <= 0 && waitingOn.length === 0) return null
	return (
		<View style={styles.banner}>
			{remaining > 0 ? (
				<Text style={styles.bannerText}>
					Fencer: tap {remaining} more edge
					{remaining === 1 ? '' : 's'} to reserve for your roads.
				</Text>
			) : (
				<Text style={styles.bannerText}>
					Waiting on {waitingOn.join(', ')} to place fence tokens.
				</Text>
			)}
		</View>
	)
}

// Haunt's "pick 2 secret spots" affordance. The player taps two buildable
// vertices on the board (BuildLayer tool='haunt_spot'); this banner tracks the
// count and commits both with Confirm. Spots stay private to the player.
export function HauntStatusBanner({
	picked,
	waitingOn,
	submitting,
	onConfirm,
}: {
	picked: number
	waitingOn: string[]
	submitting: boolean
	onConfirm: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.banner}>
			{picked < 2 ? (
				<Text style={styles.bannerText}>
					Haunt: secretly tap {2 - picked} more spot
					{picked === 1 ? '' : 's'} — ghosts appear if they're
					blocked.
				</Text>
			) : (
				<View style={styles.bannerRow}>
					<Text style={styles.bannerText}>
						Haunt: 2 spots chosen.
					</Text>
					<Pressable
						onPress={onConfirm}
						disabled={submitting}
						style={({ pressed }) => [
							styles.confirmBtn,
							pressed && styles.pressed,
						]}
					>
						<Text style={styles.confirmText}>Confirm</Text>
					</Pressable>
				</View>
			)}
			{waitingOn.length > 0 && (
				<Text style={styles.bannerSub}>
					Waiting on {waitingOn.join(', ')}.
				</Text>
			)}
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: 'rgba(0,0,0,0.55)',
			alignItems: 'center',
			justifyContent: 'flex-start',
			paddingHorizontal: spacing.lg,
			paddingBottom: spacing.lg,
		},
		sheet: {
			width: '100%',
			maxWidth: 420,
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.lg,
			gap: spacing.md,
			overflow: 'hidden',
		},
		body: {
			gap: spacing.md,
		},
		titleRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: spacing.sm,
		},
		title: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		subtitle: {
			fontSize: font.sm,
			color: colors.textSecondary,
			lineHeight: 20,
		},
		grid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.sm,
			justifyContent: 'center',
		},
		card: {
			width: 84,
			height: 96,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: '#2B2B2B',
			alignItems: 'center',
			justifyContent: 'flex-end',
			padding: spacing.sm,
		},
		cardPicked: {
			borderWidth: 3,
			borderColor: colors.brand,
		},
		cardLabel: {
			fontSize: font.sm,
			fontWeight: '700',
			color: '#1A1A1A',
		},
		waiting: {
			fontSize: font.sm,
			color: colors.textSecondary,
			fontStyle: 'italic',
		},
		banner: {
			marginHorizontal: spacing.md,
			marginBottom: spacing.xs,
			padding: spacing.sm,
			backgroundColor: colors.card,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
		},
		bannerText: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.text,
		},
		bannerRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: spacing.sm,
		},
		bannerSub: {
			fontSize: font.xs,
			color: colors.textSecondary,
			fontStyle: 'italic',
			marginTop: spacing.xs,
		},
		confirmBtn: {
			paddingVertical: spacing.xs,
			paddingHorizontal: spacing.md,
			borderRadius: radius.sm,
			backgroundColor: colors.brand,
		},
		confirmText: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.white,
		},
		pressed: {
			opacity: 0.8,
		},
	})
}
