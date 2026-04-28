import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { Button } from '../modules/Button'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { playerColors, resourceColor } from './palette'
import {
	canAfford,
	isOfferAddressedTo,
	isOfferRejectedByAll,
	rejectedByOf,
} from './trade'
import type { ResourceHand, TradeOffer } from './types'

const BANNER_IN = FadeInUp.duration(220)
const BANNER_OUT = FadeOutUp.duration(180)

// Single-offer banner shown to every player while a trade offer is open.
// The proposer sees "cancel" on their banner. Addressed players see "accept"
// (disabled when they can't afford) and "reject". A rejecter is filtered out
// upstream — they don't see the banner anymore. The proposer sees a
// rejected-by line; once every addressee has rejected, the banner swaps to a
// terminal "rejected by everyone" state and the screen schedules an auto-cancel.
export function TradeBanner({
	offer,
	meIdx,
	myHand,
	playerOrder,
	profilesById,
	submitting,
	onAccept,
	onCancel,
	onReject,
}: {
	offer: TradeOffer
	meIdx: number
	myHand: ResourceHand | null
	playerOrder: string[]
	profilesById: Record<string, Profile>
	submitting: boolean
	onAccept: () => void
	onCancel: () => void
	onReject: () => void
}) {
	const playerCount = playerOrder.length
	const fromColor = playerColors[offer.from] ?? playerColors[0]
	const fromProfile = profilesById[playerOrder[offer.from]]
	const fromName =
		meIdx === offer.from ? 'You' : (fromProfile?.username ?? 'Player')

	const amAddressed = meIdx !== offer.from && isOfferAddressedTo(offer, meIdx)
	const amProposer = meIdx === offer.from
	const rejected = rejectedByOf(offer)
	const allRejected = isOfferRejectedByAll(offer, playerCount)

	const canAccept =
		amAddressed && !!myHand && canAfford(myHand, offer.receive)

	const rejectedNames =
		amProposer && rejected.length > 0
			? rejected
					.map(
						(idx) =>
							profilesById[playerOrder[idx]]?.username ?? 'Player'
					)
					.join(', ')
			: ''

	return (
		<Animated.View
			entering={BANNER_IN}
			exiting={BANNER_OUT}
			style={[styles.row, { borderLeftColor: fromColor }]}
		>
			<View style={styles.body}>
				<Text style={styles.proposer} numberOfLines={1}>
					{fromName}
				</Text>
				{allRejected ? (
					<Text style={styles.terminal} numberOfLines={1}>
						Rejected by everyone
					</Text>
				) : (
					<View style={styles.swapRow}>
						<HandChips hand={offer.give} />
						<Ionicons
							name="swap-horizontal"
							size={16}
							color={colors.textSecondary}
						/>
						<HandChips hand={offer.receive} />
					</View>
				)}
				{amProposer && !allRejected && rejectedNames.length > 0 && (
					<Text style={styles.rejectedLine} numberOfLines={1}>
						Rejected by {rejectedNames}
					</Text>
				)}
			</View>
			{amProposer && (
				<Pressable
					onPress={onCancel}
					disabled={submitting}
					style={({ pressed }) => [
						styles.cancelIcon,
						pressed && styles.pressed,
					]}
					hitSlop={8}
				>
					<Ionicons name="close" size={16} color={colors.text} />
				</Pressable>
			)}
			{amAddressed && (
				<View style={styles.actions}>
					<Button
						variant="secondary"
						onPress={onReject}
						disabled={submitting}
						style={styles.rejectBtn}
					>
						Reject
					</Button>
					<Button
						onPress={onAccept}
						disabled={!canAccept}
						loading={submitting}
						style={styles.acceptBtn}
					>
						Accept
					</Button>
				</View>
			)}
		</Animated.View>
	)
}

function HandChips({ hand }: { hand: ResourceHand }) {
	const shown = RESOURCES.filter((r) => hand[r] > 0)
	if (shown.length === 0) return null
	return (
		<View style={styles.chipGroup}>
			{shown.map((r) => (
				<View
					key={r}
					style={[styles.chip, { backgroundColor: resourceColor[r] }]}
				>
					<Text style={styles.chipText}>
						{hand[r]} {SHORT[r]}
					</Text>
				</View>
			))}
		</View>
	)
}

// Returns the offer the local player should see, or null if it should be
// hidden (because they already rejected it). Game-screen wiring uses this to
// dismiss the banner immediately for a rejecter while leaving server state
// intact for the proposer to keep tallying.
export function visibleOfferFor(
	offer: TradeOffer | null,
	meIdx: number
): TradeOffer | null {
	if (!offer) return null
	const rejected = rejectedByOf(offer)
	if (rejected.includes(meIdx)) return null
	return offer
}

const SHORT: Record<Resource, string> = {
	wood: 'Wd',
	wheat: 'Wh',
	sheep: 'Sh',
	brick: 'Br',
	ore: 'Or',
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		marginHorizontal: spacing.md,
		marginTop: spacing.sm,
		padding: spacing.sm,
		backgroundColor: colors.background,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		borderLeftWidth: 4,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 3 },
		shadowOpacity: 0.12,
		shadowRadius: 8,
		elevation: 4,
	},
	body: {
		flex: 1,
		gap: 2,
	},
	proposer: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	swapRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		flexWrap: 'wrap',
	},
	chipGroup: {
		flexDirection: 'row',
		gap: 4,
	},
	chip: {
		borderRadius: radius.sm,
		paddingHorizontal: 6,
		paddingVertical: 2,
	},
	chipText: {
		fontSize: 11,
		fontWeight: '700',
		color: '#1A1A1A',
	},
	rejectedLine: {
		fontSize: font.xs,
		color: colors.textSecondary,
		marginTop: 2,
	},
	terminal: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
	},
	cancelIcon: {
		width: 28,
		height: 28,
		borderRadius: radius.full,
		alignItems: 'center',
		justifyContent: 'center',
		backgroundColor: colors.white,
		borderWidth: 1,
		borderColor: colors.border,
	},
	actions: {
		flexDirection: 'row',
		gap: spacing.xs,
		alignItems: 'center',
	},
	rejectBtn: {
		paddingHorizontal: spacing.sm,
		minHeight: 36,
	},
	acceptBtn: {
		paddingHorizontal: spacing.md,
		minHeight: 36,
	},
	pressed: {
		opacity: 0.7,
	},
})
