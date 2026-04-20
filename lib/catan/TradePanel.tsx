import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { Button } from '../modules/Button'
import { playerColors, resourceColor } from './palette'
import { canAfford, emptyHand, isValidTradeShape } from './trade'
import type { ResourceHand } from './types'

// Form that replaces the main action bar when the proposer is composing a
// trade. Lets the proposer pick what they give, what they request, and who
// they send it to. Send fires the edge function; Cancel closes without sending.
export function TradePanel({
	meIdx,
	myHand,
	playerOrder,
	profilesById,
	submitting,
	onSend,
	onCancel,
}: {
	meIdx: number
	myHand: ResourceHand
	playerOrder: string[]
	profilesById: Record<string, Profile>
	submitting: boolean
	onSend: (give: ResourceHand, receive: ResourceHand, to: number[]) => void
	onCancel: () => void
}) {
	const [give, setGive] = useState<ResourceHand>(emptyHand)
	const [receive, setReceive] = useState<ResourceHand>(emptyHand)
	// Default: address all other players. null means "all (empty list)".
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

	// Capped by my hand for give; capped by "what would make the shape valid"
	// for receive (we still let them go up, but Send is gated on validity).
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

	// Normalize addressed for send: if all others are selected, send [] (all).
	function send() {
		const to = allSelected ? [] : [...addressed]
		onSend(give, receive, to)
	}

	return (
		<View style={styles.wrap}>
			<Text style={styles.sectionLabel}>You give</Text>
			<ResourceRow
				hand={give}
				cap={myHand}
				onBump={bumpGive}
				otherSide={receive}
			/>
			<Text style={styles.sectionLabel}>You receive</Text>
			<ResourceRow
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
					style={styles.cancelBtn}
				>
					Cancel
				</Button>
				<Button
					onPress={send}
					disabled={!canPropose}
					loading={submitting}
					style={styles.sendBtn}
				>
					Send
				</Button>
			</View>
		</View>
	)
}

function ResourceRow({
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
				// A capped row (the "give" row) with zero available for this
				// resource is fully disabled — not even the +/- are meaningful.
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
	sectionLabel: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		textTransform: 'uppercase',
		letterSpacing: 0.3,
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
	pressed: {
		opacity: 0.7,
	},
})
