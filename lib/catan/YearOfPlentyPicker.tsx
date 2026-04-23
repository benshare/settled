// Resource picker for the Year of Plenty dev card. The player picks two
// resources (duplicates allowed — tapping the same card twice counts as
// two). Confirm fires onConfirm(r1, r2). Rendered as a modal over the game
// view.

import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

export function YearOfPlentyPicker({
	onCancel,
	onConfirm,
}: {
	onCancel: () => void
	onConfirm: (r1: Resource, r2: Resource) => void
}) {
	const [picks, setPicks] = useState<Resource[]>([])

	function onTap(r: Resource) {
		if (picks.length >= 2) return
		setPicks((prev) => [...prev, r])
	}

	function onClear() {
		setPicks([])
	}

	function onSubmit() {
		if (picks.length !== 2) return
		onConfirm(picks[0], picks[1])
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
					<Text style={styles.title}>Pick 2 resources</Text>
					<Text style={styles.subtitle}>
						Take any 2 resource cards from the bank. Duplicates are
						fine — tap a resource twice to take 2 of it.
					</Text>
					<View style={styles.grid}>
						{RESOURCES.map((r) => {
							const count = picks.filter((p) => p === r).length
							return (
								<Pressable
									key={r}
									style={({ pressed }) => [
										styles.card,
										{ backgroundColor: resourceColor[r] },
										pressed && styles.pressed,
									]}
									onPress={() => onTap(r)}
									disabled={picks.length >= 2}
								>
									<Text style={styles.cardLabel}>
										{RESOURCE_LABELS[r]}
									</Text>
									{count > 0 && (
										<View style={styles.countBadge}>
											<Text style={styles.countText}>
												+{count}
											</Text>
										</View>
									)}
								</Pressable>
							)
						})}
					</View>
					<Text style={styles.progress}>
						{picks.length} / 2 selected
					</Text>
					<View style={styles.actions}>
						<Pressable
							style={({ pressed }) => [
								styles.secondaryBtn,
								pressed && styles.pressed,
							]}
							onPress={onClear}
							disabled={picks.length === 0}
						>
							<Text style={styles.secondaryText}>Clear</Text>
						</Pressable>
						<Pressable
							style={({ pressed }) => [
								styles.primaryBtn,
								picks.length !== 2 && styles.primaryBtnDisabled,
								pressed && picks.length === 2 && styles.pressed,
							]}
							onPress={onSubmit}
							disabled={picks.length !== 2}
						>
							<Text style={styles.primaryText}>Confirm</Text>
						</Pressable>
					</View>
					<Pressable
						style={({ pressed }) => [
							styles.cancelBtn,
							pressed && styles.pressed,
						]}
						onPress={onCancel}
					>
						<Text style={styles.cancelText}>Cancel</Text>
					</Pressable>
				</Pressable>
			</Pressable>
		</Modal>
	)
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.45)',
		alignItems: 'center',
		justifyContent: 'center',
		padding: spacing.lg,
	},
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
	},
	grid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.sm,
		justifyContent: 'center',
	},
	card: {
		width: 84,
		height: 96,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: '#2B2B2B',
		alignItems: 'center',
		justifyContent: 'flex-end',
		padding: spacing.sm,
	},
	cardLabel: {
		fontSize: font.sm,
		fontWeight: '700',
		color: '#1A1A1A',
	},
	countBadge: {
		position: 'absolute',
		top: -6,
		right: -6,
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: radius.full,
		backgroundColor: colors.brand,
	},
	countText: {
		color: colors.white,
		fontWeight: '700',
		fontSize: font.xs,
	},
	progress: {
		textAlign: 'center',
		fontSize: font.sm,
		color: colors.textMuted,
	},
	actions: {
		flexDirection: 'row',
		gap: spacing.sm,
	},
	primaryBtn: {
		flex: 1,
		backgroundColor: colors.brand,
		borderRadius: radius.sm,
		paddingVertical: spacing.sm,
		alignItems: 'center',
	},
	primaryBtnDisabled: {
		opacity: 0.4,
	},
	primaryText: {
		color: colors.white,
		fontWeight: '700',
		fontSize: font.md,
	},
	secondaryBtn: {
		flex: 1,
		borderRadius: radius.sm,
		paddingVertical: spacing.sm,
		alignItems: 'center',
		borderWidth: 1,
		borderColor: colors.border,
	},
	secondaryText: {
		color: colors.text,
		fontWeight: '600',
		fontSize: font.md,
	},
	pressed: {
		opacity: 0.8,
	},
	cancelBtn: {
		alignItems: 'center',
		paddingVertical: spacing.sm,
	},
	cancelText: {
		fontSize: font.base,
		color: colors.textSecondary,
		fontWeight: '600',
	},
})
