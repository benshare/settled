// Modal for the shepherd's once-per-turn 4-sheep → +2 resources of choice
// swap. Picker UX mirrors Year of Plenty. The pick is a declaration only —
// the cards land after the roll (see `applyShepherdPayout`).

import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'Wood',
	wheat: 'Wheat',
	sheep: 'Sheep',
	brick: 'Brick',
	ore: 'Ore',
}

// The bars' one-liner for a declaration awaiting its roll. Lives here beside
// the picker's labels rather than in a sixth copy of RESOURCE_LABELS.
export function shepherdPendingLabel(pending: [Resource, Resource]): string {
	const owed =
		pending[0] === pending[1]
			? `2 ${RESOURCE_LABELS[pending[0]]}`
			: `1 ${RESOURCE_LABELS[pending[0]]}, 1 ${RESOURCE_LABELS[pending[1]]}`
	return `Shepherd: ${owed} after your roll`
}

export function ShepherdSwapPicker({
	submitting,
	onCancel,
	onConfirm,
}: {
	submitting: boolean
	onCancel: () => void
	onConfirm: (take: [Resource, Resource]) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
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
		onConfirm([picks[0], picks[1]])
	}

	return (
		<Modal visible onDismiss={onCancel} contentStyle={styles.sheet}>
			<Text style={styles.title}>Shepherd: 2 sheep → 2 resources</Text>
			<Text style={styles.subtitle}>
				Pick 2 resources to take. Duplicates are fine — tap twice to
				take 2 of the same. You'll receive them after you roll, so a 7
				can't take them.
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
			<Text style={styles.progress}>{picks.length} / 2 selected</Text>
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
						(picks.length !== 2 || submitting) &&
							styles.primaryBtnDisabled,
						pressed && picks.length === 2 && styles.pressed,
					]}
					onPress={onSubmit}
					disabled={picks.length !== 2 || submitting}
				>
					<Text style={styles.primaryText}>
						{submitting ? '…' : 'Confirm'}
					</Text>
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
}
