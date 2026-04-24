// Veteran-only tile + picker for tapping a played knight. Untapped knights
// are the ones a veteran player has played but not yet used for the +2
// resource effect. Each tap spends one untapped knight, grants 2 resources,
// and leaves the knight in the Largest Army count.

import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, radius, spacing } from '../theme'
import type { Resource } from './board'
import { YearOfPlentyPicker } from './YearOfPlentyPicker'

export function KnightTapBar({
	untappedKnights,
	enabled,
	onTap,
}: {
	untappedKnights: number
	// False when it's not the viewer's main-phase turn. The tile still
	// renders (so the viewer sees their untapped knights) but is disabled.
	enabled: boolean
	onTap: (r1: Resource, r2: Resource) => void
}) {
	const [pickerOpen, setPickerOpen] = useState(false)
	if (untappedKnights <= 0) return null
	return (
		<View style={styles.row}>
			<Pressable
				disabled={!enabled}
				onPress={() => setPickerOpen(true)}
				style={({ pressed }) => [
					styles.tile,
					!enabled && styles.tileDim,
					pressed && enabled && styles.pressed,
				]}
			>
				<MaterialCommunityIcons
					name="sword"
					size={18}
					color={enabled ? colors.text : colors.textMuted}
				/>
				<Text style={styles.label}>Tap knight → 2 resources</Text>
				<View style={styles.badge}>
					<Text style={styles.badgeText}>{untappedKnights}</Text>
				</View>
			</Pressable>
			{pickerOpen && (
				<YearOfPlentyPicker
					onCancel={() => setPickerOpen(false)}
					onConfirm={(r1, r2) => {
						setPickerOpen(false)
						onTap(r1, r2)
					}}
				/>
			)}
		</View>
	)
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		gap: spacing.xs,
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.xs,
	},
	tile: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		paddingHorizontal: spacing.sm,
		paddingVertical: 6,
		borderRadius: radius.sm,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	tileDim: {
		opacity: 0.55,
	},
	label: {
		fontSize: font.sm,
		color: colors.text,
		fontWeight: '600',
	},
	badge: {
		marginLeft: 2,
		paddingHorizontal: 6,
		paddingVertical: 1,
		borderRadius: radius.full,
		backgroundColor: colors.brand,
	},
	badgeText: {
		fontSize: font.xs,
		fontWeight: '700',
		color: colors.white,
	},
	pressed: {
		opacity: 0.75,
	},
})
