// Resource picker for the Monopoly dev card. Pick one resource → Confirm
// fires onConfirm(resource). Rendered as a modal over the game view.

import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
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

export function MonopolyPicker({
	perPlayerCap,
	onCancel,
	onConfirm,
}: {
	// Most cards a single opponent can lose, or null when uncapped.
	perPlayerCap: number | null
	onCancel: () => void
	onConfirm: (resource: Resource) => void
}) {
	return (
		<Modal visible onDismiss={onCancel} contentStyle={styles.sheet}>
			<Text style={styles.title}>Name a resource</Text>
			<Text style={styles.subtitle}>
				{perPlayerCap === null
					? 'Every opponent will give you all of their cards of that type.'
					: `Every opponent will give you up to ${perPlayerCap} of their cards of that type.`}
			</Text>
			<View style={styles.grid}>
				{RESOURCES.map((r) => (
					<Pressable
						key={r}
						style={({ pressed }) => [
							styles.card,
							{ backgroundColor: resourceColor[r] },
							pressed && styles.pressed,
						]}
						onPress={() => onConfirm(r)}
					>
						<Text style={styles.cardLabel}>
							{RESOURCE_LABELS[r]}
						</Text>
					</Pressable>
				))}
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

const styles = StyleSheet.create({
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
