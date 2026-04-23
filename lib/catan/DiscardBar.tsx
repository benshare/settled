import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { Button } from '../modules/Button'
import { resourceColor } from './palette'
import { handSize } from './robber'
import type { ResourceHand } from './types'

const EMPTY: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 0,
	wheat: 0,
	ore: 0,
}

// Inline bar shown above the board when the viewer owes a discard. Live
// per-resource steppers clamped to [0, hand[r]]. Confirm is enabled only
// when the selection's total equals `required`.
export function DiscardBar({
	hand,
	required,
	submitting,
	onSubmit,
}: {
	hand: ResourceHand
	required: number
	submitting: boolean
	onSubmit: (selection: ResourceHand) => void
}) {
	const [sel, setSel] = useState<ResourceHand>(EMPTY)
	const total = handSize(sel)
	const ready = total === required && !submitting
	const atCap = total >= required

	function set(r: Resource, delta: number) {
		const next = sel[r] + delta
		if (next < 0 || next > hand[r]) return
		if (delta > 0 && atCap) return
		setSel({ ...sel, [r]: next })
	}

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.title}>Discard</Text>
				<Text style={styles.counter}>
					{total} / {required}
				</Text>
			</View>
			<View style={styles.row}>
				{RESOURCES.filter((r) => hand[r] > 0).map((r) => (
					<ResourceStepper
						key={r}
						resource={r}
						available={hand[r]}
						value={sel[r]}
						canInc={!atCap && sel[r] < hand[r]}
						onDec={() => set(r, -1)}
						onInc={() => set(r, +1)}
					/>
				))}
			</View>
			<Button
				onPress={() => onSubmit(sel)}
				disabled={!ready}
				loading={submitting}
			>
				Confirm discard
			</Button>
		</View>
	)
}

function ResourceStepper({
	resource,
	available,
	value,
	canInc,
	onDec,
	onInc,
}: {
	resource: Resource
	available: number
	value: number
	canInc: boolean
	onDec: () => void
	onInc: () => void
}) {
	return (
		<View style={styles.stepper}>
			<View
				style={[
					styles.swatch,
					{ backgroundColor: resourceColor[resource] },
				]}
			>
				<Text style={styles.swatchText}>{available}</Text>
			</View>
			<View style={styles.stepperControls}>
				<StepButton label="-" onPress={onDec} disabled={value <= 0} />
				<Text style={styles.stepperValue}>{value}</Text>
				<StepButton label="+" onPress={onInc} disabled={!canInc} />
			</View>
		</View>
	)
}

function StepButton({
	label,
	onPress,
	disabled,
}: {
	label: string
	onPress: () => void
	disabled: boolean
}) {
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={({ pressed }) => [
				styles.stepBtn,
				disabled && styles.stepBtnDisabled,
				pressed && !disabled && styles.pressed,
			]}
		>
			<Text style={styles.stepBtnText}>{label}</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	wrap: {
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		padding: spacing.sm,
		marginHorizontal: spacing.md,
		gap: spacing.sm,
	},
	headerRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	title: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		letterSpacing: 0.3,
		textTransform: 'uppercase',
	},
	counter: {
		fontSize: font.base,
		fontWeight: '700',
		color: colors.text,
	},
	row: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.sm,
	},
	stepper: {
		alignItems: 'center',
		gap: spacing.xs,
	},
	swatch: {
		width: 40,
		height: 40,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: '#2B2B2B',
		alignItems: 'center',
		justifyContent: 'center',
	},
	swatchText: {
		fontSize: font.base,
		fontWeight: '800',
		color: colors.white,
	},
	stepperControls: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	stepBtn: {
		width: 28,
		height: 28,
		borderRadius: radius.sm,
		backgroundColor: colors.white,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	stepBtnDisabled: {
		opacity: 0.4,
	},
	stepBtnText: {
		fontSize: font.base,
		fontWeight: '700',
		color: colors.text,
	},
	stepperValue: {
		minWidth: 18,
		textAlign: 'center',
		fontSize: font.base,
		fontWeight: '700',
		color: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
})
