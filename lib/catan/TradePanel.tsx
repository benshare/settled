import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { Button } from '../modules/Button'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { seatColor } from './palette'
import {
	availableBankOptions,
	bankPartitionFor,
	bankSurchargeFor,
	lockedGiveResource,
	ratioOf,
} from './ports'
import { CardFan, type CardFanEntry } from './ResourceHand'
import { canAfford, emptyHand, isValidTradeShape } from './trade'
import type { BankKind, GameState, ResourceHand } from './types'

const SHADOW_ENTRIES: CardFanEntry[] = RESOURCES.map((r) => ({
	resource: r,
	count: 0,
}))

function handEntries(h: ResourceHand): CardFanEntry[] {
	return RESOURCES.filter((r) => h[r] > 0).map((r) => ({
		resource: r,
		count: h[r],
	}))
}

function remainingEntries(
	myHand: ResourceHand,
	give: ResourceHand
): CardFanEntry[] {
	return RESOURCES.filter((r) => myHand[r] - give[r] > 0).map((r) => ({
		resource: r,
		count: myHand[r] - give[r],
	}))
}

// The form that replaces the viewer's hand while they're composing a trade.
// There is one proposal, not one per destination: the same give/receive pair
// is what gets offered to the players they've toggled on and what the bank is
// asked to take. The player never picks a port or a ratio — the bank button
// enables exactly when `bankPartitionFor` can pay for the proposal out of the
// rates they have access to, in any combination.
export function TradePanel({
	meIdx,
	myHand,
	state,
	playerOrder,
	profilesById,
	submitting,
	onSend,
	onSendBank,
	onCancel,
}: {
	meIdx: number
	myHand: ResourceHand
	state: GameState
	playerOrder: string[]
	profilesById: Record<string, Profile>
	submitting: boolean
	onSend: (give: ResourceHand, receive: ResourceHand, to: number[]) => void
	onSendBank: (give: ResourceHand, receive: ResourceHand) => void
	onCancel: () => void
}) {
	const { height } = useWindowDimensions()
	const [give, setGive] = useState<ResourceHand>(emptyHand)
	const [receive, setReceive] = useState<ResourceHand>(emptyHand)
	const [addressed, setAddressed] = useState<number[]>(() =>
		playerOrder.map((_, i) => i).filter((i) => i !== meIdx)
	)

	const otherIndices = playerOrder.map((_, i) => i).filter((i) => i !== meIdx)
	const allSelected = addressed.length === otherIndices.length

	// Empty under the expanded-table Curse of Provinciality, which closes the
	// bank outright — the one case the button explains itself rather than just
	// sitting inert.
	const bankOptions = useMemo(
		() => availableBankOptions(state, meIdx),
		[state, meIdx]
	)
	const bankClosed = bankOptions.length === 0

	function toggle(idx: number) {
		setAddressed((prev) =>
			prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
		)
	}

	function bumpGive(r: Resource, delta: 1 | -1) {
		setGive((prev) => {
			const next = { ...prev, [r]: prev[r] + delta }
			if (next[r] < 0) next[r] = 0
			if (next[r] > myHand[r]) next[r] = myHand[r]
			return next
		})
	}
	function bumpReceive(r: Resource, delta: 1 | -1) {
		setReceive((prev) => {
			const next = { ...prev, [r]: prev[r] + delta }
			if (next[r] < 0) next[r] = 0
			return next
		})
	}

	const shapeValid =
		isValidTradeShape(give, receive) && canAfford(myHand, give)
	const canPropose = shapeValid && addressed.length > 0
	// The composer imposes no bank constraint of its own — a player trade has
	// no ratio, so nothing is disabled to keep the proposal bank-legal. The
	// button simply lights up when the proposal happens to be payable.
	const canBank =
		shapeValid && bankPartitionFor(state, meIdx, give, receive) !== null

	function send() {
		onSend(give, receive, allSelected ? [] : [...addressed])
	}

	const giveSourceDisabled = RESOURCES.filter((r) => receive[r] > 0)
	const receiveSourceDisabled = RESOURCES.filter((r) => give[r] > 0)

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.heading}>Trade</Text>
				<Pressable
					onPress={onCancel}
					style={({ pressed }) => [
						styles.linkBtn,
						pressed && styles.pressed,
					]}
				>
					<Ionicons name="close" size={14} color={colors.text} />
					<Text style={styles.linkBtnLabel}>Cancel</Text>
				</Pressable>
			</View>

			<ScrollView
				style={{ maxHeight: Math.round(height * 0.5) }}
				contentContainerStyle={styles.scrollBody}
				nestedScrollEnabled
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.panelsRow}>
					<TradeSidePanel
						title="You give"
						tradingEntries={handEntries(give)}
						onTradingPress={(r) => bumpGive(r, -1)}
						sourceTitle="Your hand"
						sourceEntries={remainingEntries(myHand, give)}
						sourceVariant="solid"
						sourceShowCount
						sourceDisabled={giveSourceDisabled}
						onSourcePress={(r) => bumpGive(r, 1)}
					/>
					<TradeSidePanel
						title="You receive"
						tradingEntries={handEntries(receive)}
						onTradingPress={(r) => bumpReceive(r, -1)}
						sourceTitle="Add"
						sourceEntries={SHADOW_ENTRIES}
						sourceVariant="shadow"
						sourceShowCount={false}
						sourceDisabled={receiveSourceDisabled}
						onSourcePress={(r) => bumpReceive(r, 1)}
					/>
				</View>
			</ScrollView>

			<View style={styles.chipRow}>
				{otherIndices.map((i) => {
					const profile = profilesById[playerOrder[i]]
					return (
						<PlayerChip
							key={i}
							label={profile?.username ?? `P${i + 1}`}
							color={seatColor(state, i)}
							active={addressed.includes(i)}
							onPress={() => toggle(i)}
						/>
					)
				})}
			</View>

			<View style={styles.buttons}>
				<Button
					onPress={send}
					disabled={!canPropose}
					loading={submitting}
					style={[styles.actionBtn, styles.smallBtn]}
				>
					Propose trade
				</Button>
				<Button
					variant="secondary"
					onPress={() => onSendBank(give, receive)}
					disabled={!canBank}
					loading={submitting}
					style={[styles.actionBtn, styles.smallBtn]}
				>
					{bankClosed ? 'Bank closed' : 'Trade with bank'}
				</Button>
			</View>

			{!bankClosed && (
				<Text style={styles.rateHint}>
					{rateHint(state, meIdx, bankOptions)}
				</Text>
			)}
		</View>
	)
}

// One half of the composer: the trade-side hand on top (tap a card to pull
// one back out), the source hand below it (tap a card to add). Presentational
// only — the smart parent decides what a tap does and which cards are locked.
function TradeSidePanel({
	title,
	tradingEntries,
	onTradingPress,
	sourceTitle,
	sourceEntries,
	sourceVariant,
	sourceShowCount,
	sourceDisabled,
	onSourcePress,
}: {
	title: string
	tradingEntries: CardFanEntry[]
	onTradingPress: (r: Resource) => void
	sourceTitle: string
	sourceEntries: CardFanEntry[]
	sourceVariant: 'solid' | 'shadow'
	sourceShowCount: boolean
	sourceDisabled: readonly Resource[]
	onSourcePress: (r: Resource) => void
}) {
	return (
		<View style={styles.side}>
			<Text style={styles.sectionLabel}>{title}</Text>
			<CardFan
				entries={tradingEntries}
				size="compact"
				onCardPress={onTradingPress}
			/>
			<View style={styles.sideDivider} />
			<Text style={styles.sourceLabel}>{sourceTitle}</Text>
			<CardFan
				entries={sourceEntries}
				size="compact"
				variant={sourceVariant}
				showCount={sourceShowCount}
				disabledResources={sourceDisabled}
				onCardPress={onSourcePress}
			/>
		</View>
	)
}

function PlayerChip({
	label,
	color,
	active,
	onPress,
}: {
	label: string
	color?: string
	active: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.chip,
				active && styles.chipActive,
				active && color ? { borderColor: color } : null,
				pressed && styles.pressed,
			]}
		>
			<Text
				style={[
					styles.chipLabel,
					active && { color: colors.text, fontWeight: '700' },
				]}
			>
				{label}
			</Text>
		</Pressable>
	)
}

// Since the player composes freely and the bank either takes the result or
// doesn't, this line is the only place the rates themselves are named. Ratios
// are shown surcharged (Curse of Provinciality) so it never quotes a rate the
// player can't actually get.
function rateHint(
	state: GameState,
	meIdx: number,
	options: BankKind[]
): string {
	const surcharge = bankSurchargeFor(state, meIdx)
	const parts = options.map((opt) => {
		const locked = lockedGiveResource(opt)
		const ratio = ratioOf(opt) + surcharge
		if (locked) return `${ratio}:1 ${locked}`
		return opt === '3:1' ? `${ratio}:1 any` : `${ratio}:1 bank`
	})
	const specialty = state.players[meIdx]?.specialistResource
	if (specialty) parts.push(`${specialty} pays 1 fewer`)
	return `Rates: ${parts.join(' · ')}`
}

const styles = StyleSheet.create({
	wrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.md,
		gap: spacing.xs,
	},
	headerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: spacing.sm,
	},
	heading: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	linkBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
		paddingHorizontal: spacing.xs,
		paddingVertical: 4,
	},
	linkBtnLabel: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	sectionLabel: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		textTransform: 'uppercase',
		letterSpacing: 0.3,
	},
	scrollBody: {
		gap: spacing.xs,
	},
	panelsRow: {
		flexDirection: 'row',
		gap: spacing.sm,
	},
	side: {
		flex: 1,
		gap: 2,
	},
	sideDivider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.border,
		marginVertical: 2,
	},
	sourceLabel: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textMuted,
	},
	chipRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	chip: {
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		borderRadius: radius.full,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	chipActive: {
		backgroundColor: colors.white,
		borderWidth: 2,
	},
	chipLabel: {
		fontSize: font.sm,
		color: colors.textSecondary,
	},
	buttons: {
		flexDirection: 'row',
		gap: spacing.sm,
	},
	actionBtn: {
		flex: 1,
	},
	smallBtn: {
		minHeight: 34,
		paddingVertical: 6,
		paddingHorizontal: spacing.md,
	},
	rateHint: {
		fontSize: font.xs,
		color: colors.textMuted,
	},
	pressed: {
		opacity: 0.7,
	},
})
