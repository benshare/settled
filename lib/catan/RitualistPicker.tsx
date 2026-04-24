// Modal for the ritualist to choose a dice total (2..6, 8..12 — never 7)
// and discard the required cards. Cost is 2 cards if the ritualist has no
// cities/super_cities, else 3.

import { useMemo, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'
import { handSize } from './robber'
import type { ResourceHand } from './types'

const TOTALS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12] as const

export function RitualistPicker({
	hand,
	cardCost,
	submitting,
	onCancel,
	onConfirm,
}: {
	hand: ResourceHand
	cardCost: 2 | 3
	submitting: boolean
	onCancel: () => void
	onConfirm: (discard: ResourceHand, total: number) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [total, setTotal] = useState<number | null>(null)
	const [discard, setDiscard] = useState<ResourceHand>(empty())
	const discardSize = handSize(discard)
	const ready = total !== null && discardSize === cardCost && !submitting

	function setRes(r: Resource, delta: number) {
		const next = discard[r] + delta
		if (next < 0 || next > hand[r]) return
		if (delta > 0 && discardSize >= cardCost) return
		setDiscard({ ...discard, [r]: next })
	}

	return (
		<Modal
			transparent
			animationType="fade"
			visible
			onRequestClose={onCancel}
		>
			<Pressable style={styles.backdrop} onPress={onCancel}>
				<Pressable style={styles.sheet}>
					<Text style={styles.title}>Ritual roll</Text>
					<Text style={styles.subtitle}>
						Discard {cardCost} cards and choose your dice value. No
						other player receives resources from this roll.
					</Text>
					<Text style={styles.section}>1 · Pick a total</Text>
					<View style={styles.totalGrid}>
						{TOTALS.map((t) => (
							<Pressable
								key={t}
								onPress={() => setTotal(t)}
								style={({ pressed }) => [
									styles.totalChip,
									total === t && styles.totalChipPicked,
									pressed && styles.pressed,
								]}
							>
								<Text style={styles.totalChipText}>{t}</Text>
							</Pressable>
						))}
					</View>
					<Text style={styles.section}>
						2 · Discard {cardCost} cards ({discardSize} / {cardCost}
						)
					</Text>
					<View style={styles.row}>
						{RESOURCES.filter((r) => hand[r] > 0).map((r) => (
							<ResourceStepper
								key={r}
								resource={r}
								available={hand[r]}
								value={discard[r]}
								canInc={
									discardSize < cardCost &&
									discard[r] < hand[r]
								}
								onDec={() => setRes(r, -1)}
								onInc={() => setRes(r, +1)}
								styles={styles}
							/>
						))}
					</View>
					<View style={styles.actions}>
						<Pressable
							style={({ pressed }) => [
								styles.cancelBtn,
								pressed && styles.pressed,
							]}
							onPress={onCancel}
						>
							<Text style={styles.cancelText}>Cancel</Text>
						</Pressable>
						<View style={{ flex: 1 }}>
							<Button
								onPress={() =>
									total !== null && onConfirm(discard, total)
								}
								disabled={!ready}
								loading={submitting}
							>
								Roll {total ?? ''}
							</Button>
						</View>
					</View>
				</Pressable>
			</Pressable>
		</Modal>
	)
}

function empty(): ResourceHand {
	return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
}

function ResourceStepper({
	resource,
	available,
	value,
	canInc,
	onDec,
	onInc,
	styles,
}: {
	resource: Resource
	available: number
	value: number
	canInc: boolean
	onDec: () => void
	onInc: () => void
	styles: ReturnType<typeof makeStyles>
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
				<StepButton
					label="-"
					onPress={onDec}
					disabled={value <= 0}
					styles={styles}
				/>
				<Text style={styles.stepperValue}>{value}</Text>
				<StepButton
					label="+"
					onPress={onInc}
					disabled={!canInc}
					styles={styles}
				/>
			</View>
		</View>
	)
}

function StepButton({
	label,
	onPress,
	disabled,
	styles,
}: {
	label: string
	onPress: () => void
	disabled: boolean
	styles: ReturnType<typeof makeStyles>
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

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: 'rgba(0,0,0,0.55)',
			alignItems: 'center',
			justifyContent: 'center',
			padding: spacing.lg,
		},
		sheet: {
			width: '100%',
			maxWidth: 460,
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.lg,
			gap: spacing.md,
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
		section: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.textSecondary,
			textTransform: 'uppercase',
			letterSpacing: 0.3,
		},
		totalGrid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.xs,
		},
		totalChip: {
			minWidth: 36,
			paddingHorizontal: 8,
			paddingVertical: 6,
			borderRadius: radius.sm,
			backgroundColor: colors.background,
			borderWidth: 1,
			borderColor: colors.border,
			alignItems: 'center',
		},
		totalChipPicked: {
			borderWidth: 2,
			borderColor: colors.brand,
		},
		totalChipText: {
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
		actions: {
			flexDirection: 'row',
			gap: spacing.sm,
			alignItems: 'center',
		},
		cancelBtn: {
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
		},
		cancelText: {
			fontSize: font.base,
			color: colors.textSecondary,
			fontWeight: '600',
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
