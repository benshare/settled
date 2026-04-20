import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { playerColors, resourceColor } from './palette'
import { canAfford, isOfferAddressedTo } from './trade'
import type { ResourceHand, TradeOffer } from './types'

// Single-offer banner shown to every player while a trade offer is open.
// The proposer sees "cancel" on their banner (the X-badge on the BuildTradeBar
// Trade button is the primary cancel path, but the banner button works too).
// Addressed players see "accept" (disabled when they can't afford).
export function TradeBanner({
	offer,
	meIdx,
	myHand,
	playerOrder,
	profilesById,
	submitting,
	onAccept,
	onCancel,
}: {
	offer: TradeOffer
	meIdx: number
	myHand: ResourceHand | null
	playerOrder: string[]
	profilesById: Record<string, Profile>
	submitting: boolean
	onAccept: () => void
	onCancel: () => void
}) {
	const fromColor = playerColors[offer.from] ?? playerColors[0]
	const fromProfile = profilesById[playerOrder[offer.from]]
	const fromName =
		meIdx === offer.from ? 'You' : (fromProfile?.username ?? 'Player')

	const amAddressed = meIdx !== offer.from && isOfferAddressedTo(offer, meIdx)
	const amProposer = meIdx === offer.from

	const canAccept =
		amAddressed && !!myHand && canAfford(myHand, offer.receive)

	return (
		<View style={[styles.row, { borderLeftColor: fromColor }]}>
			<View style={styles.body}>
				<Text style={styles.proposer} numberOfLines={1}>
					{fromName}
				</Text>
				<View style={styles.swapRow}>
					<HandChips hand={offer.give} />
					<Ionicons
						name="swap-horizontal"
						size={16}
						color={colors.textSecondary}
					/>
					<HandChips hand={offer.receive} />
				</View>
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
				<Button
					onPress={onAccept}
					disabled={!canAccept}
					loading={submitting}
					style={styles.acceptBtn}
				>
					Accept
				</Button>
			)}
		</View>
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
	acceptBtn: {
		paddingHorizontal: spacing.md,
		minHeight: 36,
	},
	pressed: {
		opacity: 0.7,
	},
})
