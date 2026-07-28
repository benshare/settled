import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { Button } from '../modules/Button'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, shadow, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { playerColors, resourceColor } from './palette'
import {
	acceptedByOf,
	canAfford,
	isOfferAddressedTo,
	isOfferRejectedByAll,
	rejectedByOf,
} from './trade'
import type { PlayerState, ResourceHand, TradeOffer } from './types'

const BANNER_IN = FadeInUp.duration(220)
const BANNER_OUT = FadeOutUp.duration(180)

// Single-offer banner shown to every player while a trade offer is open.
// The proposer sees "cancel" on their banner. Addressed players see "accept"
// (disabled when they can't afford) and "reject". A rejecter is filtered out
// upstream — they don't see the banner anymore. The proposer sees a
// rejected-by line; once every addressee has rejected, the banner swaps to a
// terminal "rejected by everyone" state and the screen schedules an auto-cancel.
//
// Confirm mode (config.tradeMode === 'confirm') rides the same banner: an
// addressee's Accept only registers into `offer.acceptedBy` (the server does
// not swap), so the proposer sees a row of accepter chips they tap to Confirm
// the swap with one of them. Every confirm-mode branch keys off
// `offer.acceptedBy` — which stays empty in automatic mode (Accept executes
// immediately there) — so the banner needs no explicit mode flag.
export function TradeBanner({
	offer,
	meIdx,
	myHand,
	players,
	playerOrder,
	profilesById,
	submitting,
	onAccept,
	onConfirm,
	onCancel,
	onReject,
}: {
	offer: TradeOffer
	meIdx: number
	myHand: ResourceHand | null
	// Player resources, for gating each accepter's Confirm on affordability.
	players: PlayerState[]
	playerOrder: string[]
	profilesById: Record<string, Profile>
	submitting: boolean
	onAccept: () => void
	// Confirm mode: proposer executes the swap with `accepterIdx`.
	onConfirm: (accepterIdx: number) => void
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
	const accepted = acceptedByOf(offer)
	const allRejected = isOfferRejectedByAll(offer, playerCount)
	// I've accepted and am awaiting the proposer's confirmation (confirm mode).
	const amWaiting = amAddressed && accepted.includes(meIdx)

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

	// Confirm mode: the proposer gets a tappable chip per accepter. Each is
	// disabled if that accepter can no longer afford the receive side (hands
	// can shift between accept and confirm — the server re-checks too).
	const showAccepters = amProposer && !allRejected && accepted.length > 0

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
						<HandChips hand={offer.give} label="Selling" />
						<Ionicons
							name="swap-horizontal"
							size={16}
							color={colors.textSecondary}
							style={styles.swapIcon}
						/>
						<HandChips hand={offer.receive} label="Buying" />
					</View>
				)}
				{showAccepters && (
					<View style={styles.acceptersWrap}>
						<Text style={styles.acceptersLabel} numberOfLines={1}>
							Confirm trade with
						</Text>
						<View style={styles.acceptersRow}>
							{accepted.map((idx) => {
								const name =
									profilesById[playerOrder[idx]]?.username ??
									`P${idx + 1}`
								const color =
									playerColors[idx] ?? playerColors[0]
								const affordable = canAfford(
									players[idx]?.resources ?? EMPTY_RESOURCES,
									offer.receive
								)
								return (
									<Pressable
										key={idx}
										onPress={() => onConfirm(idx)}
										disabled={submitting || !affordable}
										style={({ pressed }) => [
											styles.confirmChip,
											{ borderColor: color },
											(submitting || !affordable) &&
												styles.confirmChipDisabled,
											pressed && styles.pressed,
										]}
									>
										<Ionicons
											name="checkmark"
											size={13}
											color={colors.text}
										/>
										<Text
											style={styles.confirmChipText}
											numberOfLines={1}
										>
											{name}
										</Text>
									</Pressable>
								)
							})}
						</View>
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
						{amWaiting ? 'Withdraw' : 'Reject'}
					</Button>
					{amWaiting ? (
						<Text style={styles.waiting} numberOfLines={1}>
							Waiting…
						</Text>
					) : (
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
			)}
		</Animated.View>
	)
}

const EMPTY_RESOURCES: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 0,
	wheat: 0,
	ore: 0,
}

function HandChips({ hand, label }: { hand: ResourceHand; label: string }) {
	const shown = RESOURCES.filter((r) => hand[r] > 0)
	if (shown.length === 0) return null
	return (
		<View style={styles.chipStack}>
			<Text style={styles.chipLabel} numberOfLines={1}>
				{label}
			</Text>
			<View style={styles.chipGroup}>
				{shown.map((r) => (
					<View
						key={r}
						style={[
							styles.chip,
							{ backgroundColor: resourceColor[r] },
						]}
					>
						<Text style={styles.chipText}>
							{hand[r]} {SHORT[r]}
						</Text>
					</View>
				))}
			</View>
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
		boxShadow: shadow.raised,
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
		alignItems: 'flex-end',
		gap: spacing.xs,
		flexWrap: 'wrap',
	},
	// Nudged up so the arrow reads as centered against the chip row rather
	// than sitting on its baseline.
	swapIcon: {
		marginBottom: 1,
	},
	chipStack: {
		gap: 1,
	},
	chipLabel: {
		fontSize: 9,
		fontWeight: '700',
		color: colors.textSecondary,
		textTransform: 'uppercase',
		letterSpacing: 0.3,
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
	acceptersWrap: {
		marginTop: 4,
		gap: 4,
	},
	acceptersLabel: {
		fontSize: font.xs,
		fontWeight: '700',
		color: colors.textSecondary,
		textTransform: 'uppercase',
		letterSpacing: 0.3,
	},
	acceptersRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	confirmChip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 3,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		borderRadius: radius.full,
		borderWidth: 2,
		backgroundColor: colors.white,
	},
	confirmChipDisabled: {
		opacity: 0.4,
	},
	confirmChipText: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	waiting: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
		paddingHorizontal: spacing.sm,
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
