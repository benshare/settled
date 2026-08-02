// Modal for the fencer to choose which single card pays for a road on one of
// their own reserved edges. Only shown when they hold both Wood and Brick —
// with just one of the two there's nothing to decide and the build commits
// through the normal confirm bar.

import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import type { ResourceHand } from './types'

const OPTIONS = [
	{ pay: 'wood', label: '1 Wood' },
	{ pay: 'brick', label: '1 Brick' },
] as const

export function FenceCostPicker({
	hand,
	submitting,
	onCancel,
	onConfirm,
}: {
	hand: ResourceHand
	submitting: boolean
	onCancel: () => void
	onConfirm: (pay: 'wood' | 'brick') => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [pick, setPick] = useState<'wood' | 'brick'>(
		hand.wood > 0 ? 'wood' : 'brick'
	)

	return (
		<Modal visible onDismiss={onCancel} contentStyle={styles.sheet}>
			<Text style={styles.title}>Fencer: road cost</Text>
			<Text style={styles.subtitle}>
				A road on your own reserved edge costs a single card. Choose
				which one to spend.
			</Text>
			<View style={styles.list}>
				{OPTIONS.map((o) => {
					const affordable = hand[o.pay] > 0
					return (
						<Pressable
							key={o.pay}
							onPress={() => affordable && setPick(o.pay)}
							disabled={!affordable}
							style={({ pressed }) => [
								styles.row,
								pick === o.pay && styles.rowPicked,
								!affordable && styles.rowDisabled,
								pressed && affordable && styles.pressed,
							]}
						>
							<Text style={styles.rowText}>{o.label}</Text>
							{!affordable && (
								<Text style={styles.rowSub}>none in hand</Text>
							)}
						</Pressable>
					)
				})}
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
						onPress={() => onConfirm(pick)}
						disabled={hand[pick] <= 0}
						loading={submitting}
					>
						Build Road
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
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'center',
		},
		rowPicked: {
			borderWidth: 2,
			borderColor: colors.brand,
		},
		rowDisabled: {
			opacity: 0.45,
		},
		rowText: {
			fontSize: font.base,
			fontWeight: '600',
			color: colors.text,
		},
		rowSub: {
			fontSize: font.xs,
			color: colors.error,
			fontWeight: '600',
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
