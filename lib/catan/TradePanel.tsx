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
import { playerColors, resourceColor } from './palette'
import {
	availableBankOptions,
	effectiveBankRatioFor,
	isValidBankTradeShape,
	lockedGiveResource,
	ratioOf,
} from './ports'
import { CardFan, type CardFanEntry } from './ResourceHand'
import { canAfford, emptyHand, isValidTradeShape } from './trade'
import type { BankKind, GameState, ResourceHand } from './types'

type Mode =
	| { kind: 'player' }
	| { kind: 'bank_select' } // picking which ratio / port to use
	| { kind: 'bank_compose'; choice: BankKind }

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

// Form that replaces the main action bar when the proposer is composing a
// trade. Player-trade mode is the default; a Bank button switches into a
// two-step bank-trade flow. Both the player and bank composers render the
// trade as two side-by-side hands (give / receive) — see TradeSidePanel.
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
	const [mode, setMode] = useState<Mode>({ kind: 'player' })

	const bankOptions = useMemo(
		() => availableBankOptions(state, meIdx),
		[state, meIdx]
	)

	function startBank() {
		// If the only option is 4:1 (no ports), skip the selector.
		if (bankOptions.length === 1) {
			setMode({ kind: 'bank_compose', choice: bankOptions[0] })
		} else {
			setMode({ kind: 'bank_select' })
		}
	}

	if (mode.kind === 'player') {
		return (
			<PlayerTrade
				meIdx={meIdx}
				myHand={myHand}
				playerOrder={playerOrder}
				profilesById={profilesById}
				submitting={submitting}
				onBank={startBank}
				onSend={onSend}
				onCancel={onCancel}
			/>
		)
	}
	if (mode.kind === 'bank_select') {
		return (
			<BankSelect
				options={bankOptions}
				onPick={(choice) => setMode({ kind: 'bank_compose', choice })}
				onBack={() => setMode({ kind: 'player' })}
			/>
		)
	}
	return (
		<BankCompose
			choice={mode.choice}
			myHand={myHand}
			specialistResource={
				state.players[meIdx]?.specialistResource ?? null
			}
			submitting={submitting}
			onBack={() =>
				setMode(
					bankOptions.length === 1
						? { kind: 'player' }
						: { kind: 'bank_select' }
				)
			}
			onCancel={onCancel}
			onSend={onSendBank}
		/>
	)
}

function PlayerTrade({
	meIdx,
	myHand,
	playerOrder,
	profilesById,
	submitting,
	onBank,
	onSend,
	onCancel,
}: {
	meIdx: number
	myHand: ResourceHand
	playerOrder: string[]
	profilesById: Record<string, Profile>
	submitting: boolean
	onBank: () => void
	onSend: (give: ResourceHand, receive: ResourceHand, to: number[]) => void
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

	const shapeValid = isValidTradeShape(give, receive)
	const canPropose =
		shapeValid && canAfford(myHand, give) && addressed.length > 0

	function send() {
		const to = allSelected ? [] : [...addressed]
		onSend(give, receive, to)
	}

	const giveSourceDisabled = RESOURCES.filter((r) => receive[r] > 0)
	const receiveSourceDisabled = RESOURCES.filter((r) => give[r] > 0)

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.heading}>Trade</Text>
				<Pressable
					onPress={onBank}
					style={({ pressed }) => [
						styles.bankBtn,
						pressed && styles.pressed,
					]}
				>
					<Ionicons
						name="business-outline"
						size={14}
						color={colors.text}
					/>
					<Text style={styles.bankBtnLabel}>Trade with bank</Text>
				</Pressable>
			</View>

			<ScrollView
				style={{ maxHeight: Math.round(height * 0.55) }}
				contentContainerStyle={styles.scrollBody}
				nestedScrollEnabled
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.panelsRow}>
					<TradeSidePanel
						title="You give"
						tradingEntries={handEntries(give)}
						onTradingPress={(r) => bumpGive(r, -1)}
						sourceTitle="From your hand"
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
						sourceTitle="Add a resource"
						sourceEntries={SHADOW_ENTRIES}
						sourceVariant="shadow"
						sourceShowCount={false}
						sourceDisabled={receiveSourceDisabled}
						onSourcePress={(r) => bumpReceive(r, 1)}
					/>
				</View>

				<Text style={styles.sectionLabel}>To</Text>
				<View style={styles.chipRow}>
					{otherIndices.map((i) => {
						const profile = profilesById[playerOrder[i]]
						const name = profile?.username ?? `P${i + 1}`
						const color = playerColors[i] ?? playerColors[0]
						return (
							<PlayerChip
								key={i}
								label={name}
								color={color}
								active={addressed.includes(i)}
								onPress={() => toggle(i)}
							/>
						)
					})}
				</View>
			</ScrollView>

			<View style={styles.buttons}>
				<Button
					variant="secondary"
					onPress={onCancel}
					style={[styles.cancelBtn, styles.smallBtn]}
				>
					Cancel
				</Button>
				<Button
					onPress={send}
					disabled={!canPropose}
					loading={submitting}
					style={[styles.sendBtn, styles.smallBtn]}
				>
					Send
				</Button>
			</View>
		</View>
	)
}

function BankSelect({
	options,
	onPick,
	onBack,
}: {
	options: BankKind[]
	onPick: (choice: BankKind) => void
	onBack: () => void
}) {
	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.heading}>Trade with bank</Text>
				<Pressable
					onPress={onBack}
					style={({ pressed }) => [
						styles.linkBtn,
						pressed && styles.pressed,
					]}
				>
					<Ionicons
						name="chevron-back"
						size={14}
						color={colors.text}
					/>
					<Text style={styles.linkBtnLabel}>Back</Text>
				</Pressable>
			</View>
			<Text style={styles.sectionLabel}>Choose ratio</Text>
			<View style={styles.optionCol}>
				{options.map((opt) => (
					<BankOptionCard
						key={opt}
						kind={opt}
						onPress={() => onPick(opt)}
					/>
				))}
			</View>
		</View>
	)
}

function BankOptionCard({
	kind,
	onPress,
}: {
	kind: BankKind
	onPress: () => void
}) {
	const locked = lockedGiveResource(kind)
	const ratio = ratioOf(kind)
	const title = locked
		? `2:1 ${RESOURCE_LABELS[locked]} port`
		: kind === '3:1'
			? '3:1 generic port'
			: kind === '5:1'
				? '5:1 bank (Curse of Provinciality)'
				: '4:1 bank'
	const subtitle = locked
		? `Trade 2 ${RESOURCE_LABELS[locked].toLowerCase()} for 1 of anything else.`
		: kind === '3:1'
			? 'Trade 3 of any one resource for 1 of anything else.'
			: kind === '5:1'
				? 'Under your curse, trade 5 of any one resource for 1 of anything else.'
				: 'Default rate: trade 4 of any one resource for 1 of anything else.'
	const accent = locked ? resourceColor[locked] : '#CCCCCC'
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.optionCard,
				pressed && styles.pressed,
			]}
		>
			<View
				style={[
					styles.optionRatio,
					{ backgroundColor: accent },
					!locked && { borderWidth: 1, borderColor: colors.border },
				]}
			>
				<Text style={styles.optionRatioText}>{ratio}:1</Text>
			</View>
			<View style={styles.optionBody}>
				<Text style={styles.optionTitle}>{title}</Text>
				<Text style={styles.optionSubtitle}>{subtitle}</Text>
			</View>
		</Pressable>
	)
}

function BankCompose({
	choice,
	myHand,
	specialistResource,
	submitting,
	onBack,
	onCancel,
	onSend,
}: {
	choice: BankKind
	myHand: ResourceHand
	specialistResource: Resource | null
	submitting: boolean
	onBack: () => void
	onCancel: () => void
	onSend: (give: ResourceHand, receive: ResourceHand) => void
}) {
	const { height } = useWindowDimensions()
	const [give, setGive] = useState<ResourceHand>(emptyHand)
	const [receive, setReceive] = useState<ResourceHand>(emptyHand)

	const baseRatio = ratioOf(choice)
	const locked = lockedGiveResource(choice)

	// Recomputes every render so single-resource specialist discount tracks
	// the current `give`. If the player pivots to a multi-resource give, the
	// ratio snaps back to the base.
	const ratio = effectiveBankRatioFor(choice, give, specialistResource)

	const giveTotal = RESOURCES.reduce((a, r) => a + give[r], 0)
	const receiveTotal = RESOURCES.reduce((a, r) => a + receive[r], 0)
	const groups = ratio > 0 ? giveTotal / ratio : 0
	const slotsRemaining = Math.max(0, groups - receiveTotal)

	// A give is added one whole group at a time. The increment is the
	// effective ratio for the hypothetical post-add hand (so the specialist
	// discount applies only while the give stays a single stack of the
	// declared resource).
	function addGive(r: Resource) {
		setGive((prev) => {
			if (locked && r !== locked) return prev
			const hypothetical: ResourceHand = {
				...prev,
				[r]: prev[r] + baseRatio,
			}
			const effective = effectiveBankRatioFor(
				choice,
				hypothetical,
				specialistResource
			)
			const remaining = myHand[r] - prev[r]
			if (remaining < effective) return prev
			if (receive[r] > 0) return prev
			return { ...prev, [r]: prev[r] + effective }
		})
	}
	// Tapping a give card takes that whole pile back out. Clearing (vs.
	// removing one group) keeps `give[r] % ratio === 0` valid regardless of
	// how the specialist discount shifted while it was being built up.
	function clearGive(r: Resource) {
		setGive((prev) => (prev[r] === 0 ? prev : { ...prev, [r]: 0 }))
	}
	function addReceive(r: Resource) {
		setReceive((prev) => {
			if (slotsRemaining <= 0) return prev
			if (give[r] > 0) return prev
			return { ...prev, [r]: prev[r] + 1 }
		})
	}
	function decReceive(r: Resource) {
		setReceive((prev) => {
			if (prev[r] <= 0) return prev
			return { ...prev, [r]: prev[r] - 1 }
		})
	}
	function reset() {
		setGive(emptyHand())
		setReceive(emptyHand())
	}

	const valid =
		isValidBankTradeShape(give, receive, choice, specialistResource) &&
		canAfford(myHand, give)

	function giveTappable(r: Resource): boolean {
		if (locked && r !== locked) return false
		if (receive[r] > 0) return false
		const hypothetical: ResourceHand = {
			...give,
			[r]: give[r] + baseRatio,
		}
		const effective = effectiveBankRatioFor(
			choice,
			hypothetical,
			specialistResource
		)
		return myHand[r] - give[r] >= effective
	}

	const giveSourceDisabled = RESOURCES.filter((r) => !giveTappable(r))
	const receiveSourceDisabled = RESOURCES.filter(
		(r) => !(slotsRemaining > 0 && give[r] === 0)
	)

	const heading = locked
		? `2:1 ${RESOURCE_LABELS[locked]} port`
		: choice === '3:1'
			? '3:1 generic port'
			: choice === '5:1'
				? '5:1 bank (Curse of Provinciality)'
				: '4:1 bank'

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.heading}>{heading}</Text>
				<Pressable
					onPress={onBack}
					style={({ pressed }) => [
						styles.linkBtn,
						pressed && styles.pressed,
					]}
				>
					<Ionicons
						name="chevron-back"
						size={14}
						color={colors.text}
					/>
					<Text style={styles.linkBtnLabel}>Back</Text>
				</Pressable>
			</View>

			<Text style={styles.ratioHint}>
				Tap a card to give {baseRatio} at a time
				{specialistResource && baseRatio > 2
					? ` (${baseRatio - 1} for ${specialistResource})`
					: ''}
				.
			</Text>

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
						onTradingPress={clearGive}
						sourceTitle="From your hand"
						sourceEntries={remainingEntries(myHand, give)}
						sourceVariant="solid"
						sourceShowCount
						sourceDisabled={giveSourceDisabled}
						onSourcePress={addGive}
					/>
					<TradeSidePanel
						title="You receive"
						tradingEntries={handEntries(receive)}
						onTradingPress={decReceive}
						sourceTitle="Add a resource"
						sourceEntries={SHADOW_ENTRIES}
						sourceVariant="shadow"
						sourceShowCount={false}
						sourceDisabled={receiveSourceDisabled}
						onSourcePress={addReceive}
					/>
				</View>
			</ScrollView>

			<View style={styles.bankFooterRow}>
				<Text style={styles.bankSummary}>
					{giveTotal === 0
						? `Pick ${ratio} of a resource to start.`
						: `${giveTotal} → ${receiveTotal} of ${groups} available`}
				</Text>
				<Pressable
					onPress={reset}
					disabled={giveTotal === 0 && receiveTotal === 0}
					style={({ pressed }) => [
						styles.linkBtn,
						giveTotal === 0 &&
							receiveTotal === 0 &&
							styles.linkBtnDisabled,
						pressed && styles.pressed,
					]}
				>
					<Ionicons name="refresh" size={14} color={colors.text} />
					<Text style={styles.linkBtnLabel}>Reset</Text>
				</Pressable>
			</View>

			<View style={styles.buttons}>
				<Button
					variant="secondary"
					onPress={onCancel}
					style={[styles.cancelBtn, styles.smallBtn]}
				>
					Cancel
				</Button>
				<Button
					onPress={() => onSend(give, receive)}
					disabled={!valid}
					loading={submitting}
					style={[styles.sendBtn, styles.smallBtn]}
				>
					Send
				</Button>
			</View>
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

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
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
	bankBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		borderRadius: radius.full,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	bankBtnLabel: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	linkBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
		paddingHorizontal: spacing.xs,
		paddingVertical: 4,
	},
	linkBtnDisabled: {
		opacity: 0.35,
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
	ratioHint: {
		fontSize: font.sm,
		fontWeight: '500',
		color: colors.textMuted,
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
	optionCol: {
		gap: spacing.xs,
	},
	optionCard: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		padding: spacing.sm,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	optionRatio: {
		width: 42,
		height: 42,
		borderRadius: radius.sm,
		alignItems: 'center',
		justifyContent: 'center',
	},
	optionRatioText: {
		fontSize: font.sm,
		fontWeight: '700',
		color: '#1A1A1A',
	},
	optionBody: {
		flex: 1,
		gap: 2,
	},
	optionTitle: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	optionSubtitle: {
		fontSize: font.sm,
		color: colors.textSecondary,
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
	bankFooterRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginTop: spacing.xs,
	},
	bankSummary: {
		fontSize: font.sm,
		color: colors.textSecondary,
	},
	buttons: {
		flexDirection: 'row',
		gap: spacing.sm,
		marginTop: spacing.xs,
	},
	cancelBtn: {
		flex: 1,
	},
	sendBtn: {
		flex: 2,
	},
	smallBtn: {
		minHeight: 34,
		paddingVertical: 6,
		paddingHorizontal: spacing.md,
	},
	pressed: {
		opacity: 0.7,
	},
})
