// Modal for a scout to choose which cards to spend on a dev card, when more
// than one payment route is affordable. Each row is a cost profile (the
// standard 1 sheep + 1 wheat + 1 ore, or a single-resource swap). Shown only
// when the scout has a real choice; a lone affordable route is submitted
// automatically without opening this.

import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import { Button } from '../modules/Button'
import { affordableScoutSwaps, scoutDevCardCost, type ScoutSwap } from './bonus'
import type { Resource } from './board'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import type { ResourceHand } from './types'

const COST_ORDER: Resource[] = ['sheep', 'wheat', 'ore']
const LABELS: Record<Resource, string> = {
	brick: 'Brick',
	wood: 'Wood',
	sheep: 'Sheep',
	wheat: 'Wheat',
	ore: 'Ore',
}

function describeCost(cost: ResourceHand): string {
	return COST_ORDER.filter((r) => cost[r] > 0)
		.map((r) => `${cost[r]} ${LABELS[r]}`)
		.join(' + ')
}

export function ScoutCostPicker({
	hand,
	submitting,
	onCancel,
	onConfirm,
}: {
	hand: ResourceHand
	submitting: boolean
	onCancel: () => void
	onConfirm: (swap: ScoutSwap | null) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const options = useMemo(() => affordableScoutSwaps(hand), [hand])
	const [pick, setPick] = useState(0)

	return (
		<Modal visible onDismiss={onCancel} contentStyle={styles.sheet}>
			<Text style={styles.title}>Scout: pay with</Text>
			<Text style={styles.subtitle}>
				Choose which cards to spend on this dev card.
			</Text>
			<View style={styles.list}>
				{options.map((swap, idx) => (
					<Pressable
						key={idx}
						onPress={() => setPick(idx)}
						style={({ pressed }) => [
							styles.row,
							pick === idx && styles.rowPicked,
							pressed && styles.pressed,
						]}
					>
						<Text style={styles.rowText}>
							{describeCost(scoutDevCardCost(swap ?? undefined))}
						</Text>
					</Pressable>
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
						onPress={() => onConfirm(options[pick] ?? null)}
						loading={submitting}
					>
						Buy dev card
					</Button>
				</View>
			</View>
		</Modal>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		sheet: {
			width: '100%',
			maxWidth: 420,
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
		list: {
			gap: spacing.xs,
		},
		row: {
			padding: spacing.sm,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.background,
		},
		rowPicked: {
			borderWidth: 2,
			borderColor: colors.brand,
		},
		rowText: {
			fontSize: font.base,
			fontWeight: '600',
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
