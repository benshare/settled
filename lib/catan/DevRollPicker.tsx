// Admin testing affordance: a chip beside the Roll button that pins the next
// roll to a chosen total. Only rendered for a seat whose `game_states.players`
// row was hand-flagged `dev: true` — the edge function applies the same gate,
// so this is a convenience, not the authorization.
//
// The choice is sticky across turns (testing a 7-chain usually means rolling
// several of them), which is why the chip shows the pinned total rather than a
// neutral icon once one is set.

import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Modal } from '../modules/Modal'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'

const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export function DevRollPicker({
	value,
	disabled,
	onChange,
}: {
	value: number | null
	disabled?: boolean
	onChange: (total: number | null) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [open, setOpen] = useState(false)

	function pick(total: number | null) {
		onChange(total)
		setOpen(false)
	}

	return (
		<>
			<Pressable
				onPress={() => setOpen(true)}
				disabled={disabled}
				style={({ pressed }) => [
					styles.chip,
					value !== null && styles.chipSet,
					disabled && styles.chipDisabled,
					pressed && !disabled && styles.pressed,
				]}
			>
				{value === null ? (
					<MaterialCommunityIcons
						name="dice-multiple-outline"
						size={20}
						color={colors.textSecondary}
					/>
				) : (
					<Text style={styles.chipText}>{value}</Text>
				)}
			</Pressable>

			<Modal
				visible={open}
				onDismiss={() => setOpen(false)}
				contentStyle={styles.sheet}
			>
				<Text style={styles.title}>Dev: force roll</Text>
				<Text style={styles.subtitle}>
					Your next roll uses this total. Stays set until you clear
					it.
				</Text>
				<View style={styles.grid}>
					{TOTALS.map((t) => (
						<Pressable
							key={t}
							onPress={() => pick(t)}
							style={({ pressed }) => [
								styles.totalChip,
								value === t && styles.totalChipPicked,
								pressed && styles.pressed,
							]}
						>
							<Text style={styles.totalChipText}>{t}</Text>
						</Pressable>
					))}
				</View>
				<Pressable
					onPress={() => pick(null)}
					style={({ pressed }) => [
						styles.randomBtn,
						value === null && styles.totalChipPicked,
						pressed && styles.pressed,
					]}
				>
					<Text style={styles.totalChipText}>Random</Text>
				</Pressable>
			</Modal>
		</>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		chip: {
			width: 44,
			height: 52,
			borderRadius: radius.md,
			backgroundColor: colors.card,
			borderWidth: 1,
			borderColor: colors.border,
			alignItems: 'center',
			justifyContent: 'center',
		},
		chipSet: {
			borderWidth: 2,
			borderColor: colors.brand,
		},
		chipDisabled: {
			opacity: 0.4,
		},
		chipText: {
			fontSize: font.md,
			fontWeight: '700',
			color: colors.text,
		},
		sheet: {
			width: '100%',
			maxWidth: 380,
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
		grid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.xs,
		},
		totalChip: {
			minWidth: 40,
			paddingHorizontal: 8,
			paddingVertical: 8,
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
		randomBtn: {
			paddingVertical: spacing.sm,
			borderRadius: radius.sm,
			backgroundColor: colors.background,
			borderWidth: 1,
			borderColor: colors.border,
			alignItems: 'center',
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
