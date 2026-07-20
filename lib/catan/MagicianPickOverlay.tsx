// Magician post-roll window. After the magician's own roll resolves they may
// discard N+1 cards to also collect production as if a number N away from the
// actual result had rolled — or skip. Only the magician gains from it.

import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'
import { handSize } from './robber'
import type { ResourceHand } from './types'

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function MagicianPickOverlay({
	hand,
	actualTotal,
	submitting,
	onSkip,
	onCast,
}: {
	hand: ResourceHand
	actualTotal: number
	submitting: boolean
	onSkip: () => void
	onCast: (target: number, discard: ResourceHand) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [target, setTarget] = useState<number | null>(null)
	const [discard, setDiscard] = useState<ResourceHand>(empty())
	const cost = target === null ? 0 : Math.abs(target - actualTotal) + 1
	const discardSize = handSize(discard)
	const ready = target !== null && discardSize === cost && !submitting

	function pickTarget(t: number) {
		setTarget(t)
		setDiscard(empty())
	}

	function setRes(r: Resource, delta: number) {
		const next = discard[r] + delta
		if (next < 0 || next > hand[r]) return
		if (delta > 0 && discardSize >= cost) return
		setDiscard({ ...discard, [r]: next })
	}

	return (
		<Modal visible onDismiss={onSkip} contentStyle={styles.sheet}>
			<Text style={styles.title}>Magician</Text>
			<Text style={styles.subtitle}>
				You rolled {actualTotal}. Discard cards to also collect
				resources as if another number had been rolled — 1 card plus 1
				per step away. Only you gain.
			</Text>
			<Text style={styles.section}>1 · Pick a number</Text>
			<View style={styles.totalGrid}>
				{TOTALS.filter((t) => t !== actualTotal).map((t) => {
					const c = Math.abs(t - actualTotal) + 1
					return (
						<Pressable
							key={t}
							onPress={() => pickTarget(t)}
							style={({ pressed }) => [
								styles.totalChip,
								target === t && styles.totalChipPicked,
								pressed && styles.pressed,
							]}
						>
							<Text style={styles.totalChipText}>{t}</Text>
							<Text style={styles.totalChipCost}>−{c}</Text>
						</Pressable>
					)
				})}
			</View>
			{target !== null && (
				<>
					<Text style={styles.section}>
						2 · Discard {cost} cards ({discardSize} / {cost})
					</Text>
					<View style={styles.row}>
						{RESOURCES.filter((r) => hand[r] > 0).map((r) => (
							<ResourceStepper
								key={r}
								resource={r}
								available={hand[r]}
								value={discard[r]}
								canInc={
									discardSize < cost && discard[r] < hand[r]
								}
								onDec={() => setRes(r, -1)}
								onInc={() => setRes(r, +1)}
								styles={styles}
							/>
						))}
					</View>
				</>
			)}
			<View style={styles.actions}>
				<Pressable
					style={({ pressed }) => [
						styles.cancelBtn,
						pressed && styles.pressed,
					]}
					onPress={onSkip}
				>
					<Text style={styles.cancelText}>Skip</Text>
				</Pressable>
				<View style={{ flex: 1 }}>
					<Button
						onPress={() =>
							target !== null && onCast(target, discard)
						}
						disabled={!ready}
						loading={submitting}
					>
						Cast {target ?? ''}
					</Button>
				</View>
			</View>
		</Modal>
	)
}

export function MagicianWaitOverlay({ rollerName }: { rollerName: string }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Modal
			visible
			dismissOnBackdropPress={false}
			contentStyle={styles.sheet}
		>
			<Text style={styles.title}>Magician</Text>
			<Text style={styles.subtitle}>
				Waiting on {rollerName} to work their magic…
			</Text>
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
			minWidth: 40,
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
		totalChipCost: {
			fontSize: font.xs,
			color: colors.textSecondary,
			fontWeight: '600',
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
