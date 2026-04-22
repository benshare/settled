import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { Button } from '../modules/Button'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { playerColors, resourceColor } from './palette'
import {
	availableBankOptions,
	isValidBankTradeShape,
	lockedGiveResource,
	ratioOf,
} from './ports'
import { canAfford, emptyHand, isValidTradeShape } from './trade'
import type { BankKind, GameState, ResourceHand } from './types'

type Mode =
	| { kind: 'player' }
	| { kind: 'bank_select' } // picking which ratio / port to use
	| { kind: 'bank_compose'; choice: BankKind }

// Form that replaces the main action bar when the proposer is composing a
// trade. Player-trade mode is the default; a Bank button switches into a
// two-step bank-trade flow.
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
			<Text style={styles.sectionLabel}>You give</Text>
			<ResourceStepperRow
				hand={give}
				cap={myHand}
				onBump={bumpGive}
				otherSide={receive}
			/>
			<Text style={styles.sectionLabel}>You receive</Text>
			<ResourceStepperRow
				hand={receive}
				cap={null}
				onBump={bumpReceive}
				otherSide={give}
			/>
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
			: '4:1 bank'
	const subtitle = locked
		? `Trade 2 ${RESOURCE_LABELS[locked].toLowerCase()} for 1 of anything else.`
		: kind === '3:1'
			? 'Trade 3 of any one resource for 1 of anything else.'
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
	submitting,
	onBack,
	onCancel,
	onSend,
}: {
	choice: BankKind
	myHand: ResourceHand
	submitting: boolean
	onBack: () => void
	onCancel: () => void
	onSend: (give: ResourceHand, receive: ResourceHand) => void
}) {
	const [give, setGive] = useState<ResourceHand>(emptyHand)
	const [receive, setReceive] = useState<ResourceHand>(emptyHand)

	const ratio = ratioOf(choice)
	const locked = lockedGiveResource(choice)

	const giveTotal = RESOURCES.reduce((a, r) => a + give[r], 0)
	const receiveTotal = RESOURCES.reduce((a, r) => a + receive[r], 0)
	const groups = giveTotal / ratio
	const slotsRemaining = Math.max(0, groups - receiveTotal)

	function addGive(r: Resource) {
		setGive((prev) => {
			if (locked && r !== locked) return prev
			const remaining = myHand[r] - prev[r]
			if (remaining < ratio) return prev
			if (receive[r] > 0) return prev
			return { ...prev, [r]: prev[r] + ratio }
		})
	}
	function addReceive(r: Resource) {
		setReceive((prev) => {
			if (slotsRemaining <= 0) return prev
			if (give[r] > 0) return prev
			return { ...prev, [r]: prev[r] + 1 }
		})
	}
	function reset() {
		setGive(emptyHand())
		setReceive(emptyHand())
	}

	const valid =
		isValidBankTradeShape(give, receive, choice) && canAfford(myHand, give)

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.heading}>
					{locked
						? `2:1 ${RESOURCE_LABELS[locked]} port`
						: choice === '3:1'
							? '3:1 generic port'
							: '4:1 bank'}
				</Text>
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

			<Text style={styles.sectionLabel}>
				You give{' '}
				<Text style={styles.ratioHint}>(tap = {ratio} at a time)</Text>
			</Text>
			<ResourceTapRow
				hand={give}
				onTap={addGive}
				isTappable={(r) => {
					if (locked && r !== locked) return false
					if (receive[r] > 0) return false
					return myHand[r] - give[r] >= ratio
				}}
			/>

			<Text style={styles.sectionLabel}>You receive</Text>
			<ResourceTapRow
				hand={receive}
				onTap={addReceive}
				isTappable={(r) => slotsRemaining > 0 && give[r] === 0}
			/>

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

function ResourceStepperRow({
	hand,
	cap,
	onBump,
	otherSide,
}: {
	hand: ResourceHand
	cap: ResourceHand | null
	otherSide: ResourceHand
	onBump: (r: Resource, delta: 1 | -1) => void
}) {
	return (
		<View style={styles.resourceRow}>
			{RESOURCES.map((r) => {
				const atCap = cap ? hand[r] >= cap[r] : false
				const blockedByOverlap = otherSide[r] > 0
				const canPlus = !atCap && !blockedByOverlap
				const canMinus = hand[r] > 0
				const cellDisabled = cap !== null && cap[r] === 0
				return (
					<View
						key={r}
						style={[
							styles.resourceCell,
							{ backgroundColor: resourceColor[r] },
							cellDisabled && styles.resourceCellDisabled,
						]}
					>
						<Text style={styles.resourceLabel}>
							{RESOURCE_LABELS[r]}
						</Text>
						<View style={styles.stepper}>
							<StepperBtn
								sign="-"
								disabled={!canMinus || cellDisabled}
								onPress={() => onBump(r, -1)}
							/>
							<Text style={styles.count}>{hand[r]}</Text>
							<StepperBtn
								sign="+"
								disabled={!canPlus || cellDisabled}
								onPress={() => onBump(r, 1)}
							/>
						</View>
					</View>
				)
			})}
		</View>
	)
}

function ResourceTapRow({
	hand,
	isTappable,
	onTap,
}: {
	hand: ResourceHand
	isTappable: (r: Resource) => boolean
	onTap: (r: Resource) => void
}) {
	return (
		<View style={styles.resourceRow}>
			{RESOURCES.map((r) => {
				const tappable = isTappable(r)
				return (
					<Pressable
						key={r}
						disabled={!tappable}
						onPress={() => onTap(r)}
						style={({ pressed }) => [
							styles.tapCell,
							{ backgroundColor: resourceColor[r] },
							!tappable && styles.resourceCellDisabled,
							pressed && tappable && styles.pressed,
						]}
					>
						<Text style={styles.resourceLabel}>
							{RESOURCE_LABELS[r]}
						</Text>
						<Text style={styles.tapCount}>{hand[r]}</Text>
					</Pressable>
				)
			})}
		</View>
	)
}

function StepperBtn({
	sign,
	disabled,
	onPress,
}: {
	sign: '+' | '-'
	disabled: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [
				styles.stepperBtn,
				disabled && styles.stepperBtnDisabled,
				pressed && !disabled && styles.pressed,
			]}
			hitSlop={6}
		>
			<Ionicons
				name={sign === '+' ? 'add' : 'remove'}
				size={14}
				color={colors.text}
			/>
		</Pressable>
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
		textTransform: 'none',
		letterSpacing: 0,
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
	resourceRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	resourceCell: {
		flex: 1,
		borderRadius: radius.sm,
		paddingVertical: spacing.xs,
		alignItems: 'center',
		gap: 2,
	},
	tapCell: {
		flex: 1,
		borderRadius: radius.sm,
		paddingVertical: spacing.xs + 2,
		alignItems: 'center',
		gap: 2,
	},
	tapCount: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.white,
	},
	resourceCellDisabled: {
		opacity: 0.35,
	},
	resourceLabel: {
		fontSize: 11,
		fontWeight: '700',
		color: '#1A1A1A',
	},
	stepper: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
	},
	stepperBtn: {
		width: 22,
		height: 22,
		borderRadius: radius.sm,
		backgroundColor: colors.white,
		alignItems: 'center',
		justifyContent: 'center',
	},
	stepperBtnDisabled: {
		opacity: 0.35,
	},
	count: {
		minWidth: 18,
		textAlign: 'center',
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.white,
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
