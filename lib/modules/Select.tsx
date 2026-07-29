// A single-choice select: a row showing the current value, which opens a sheet
// of options. The general primitive for a choice too long for a segmented
// control (three or four options is that control's ceiling before the pills
// stop being readable).
//
// Sized to line up with the create-game screen's toggle rows, so a column of
// mixed controls stays even.

import { ReactNode, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../ThemeContext'
import { ColorScheme, font, radius, spacing } from '../theme'
import { Modal } from './Modal'

export type SelectOption<T extends string> = { key: T; label: string }

export function Select<T extends string>({
	label,
	description,
	icon,
	value,
	options,
	onSelect,
	// Shown as the value when nothing is selected.
	placeholder = 'None',
}: {
	label: string
	description?: string
	icon?: ReactNode
	// `null` renders `placeholder`; it is a legitimate value, not an empty
	// state — a select whose "off" is a real choice (no timeout, no filter)
	// shouldn't need a second control to express it.
	value: T | null
	options: SelectOption<T>[]
	onSelect: (value: T | null) => void
	placeholder?: string
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [open, setOpen] = useState(false)

	const current = options.find((o) => o.key === value)

	function choose(next: T | null) {
		setOpen(false)
		onSelect(next)
	}

	return (
		<>
			<Pressable
				onPress={() => setOpen(true)}
				style={({ pressed }) => [styles.row, pressed && styles.pressed]}
			>
				{icon}
				<View style={styles.textWrap}>
					<Text style={styles.title}>{label}</Text>
					{description && (
						<Text style={styles.description}>{description}</Text>
					)}
				</View>
				<Text style={styles.value} numberOfLines={1}>
					{current?.label ?? placeholder}
				</Text>
				<Ionicons
					name="chevron-forward"
					size={16}
					color={colors.textMuted}
				/>
			</Pressable>

			<Modal
				visible={open}
				onDismiss={() => setOpen(false)}
				contentStyle={styles.sheet}
			>
				<Text style={styles.sheetTitle}>{label}</Text>
				<ScrollView
					style={styles.list}
					contentContainerStyle={styles.listContent}
				>
					<OptionRow
						label={placeholder}
						selected={value === null}
						onPress={() => choose(null)}
					/>
					{options.map((o) => (
						<OptionRow
							key={o.key}
							label={o.label}
							selected={o.key === value}
							onPress={() => choose(o.key)}
						/>
					))}
				</ScrollView>
			</Modal>
		</>
	)
}

function OptionRow({
	label,
	selected,
	onPress,
}: {
	label: string
	selected: boolean
	onPress: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.optionRow,
				pressed && styles.pressed,
			]}
		>
			<Text
				style={[
					styles.optionLabel,
					selected && styles.optionLabelSelected,
				]}
			>
				{label}
			</Text>
			{selected && (
				<Ionicons name="checkmark" size={18} color={colors.brand} />
			)}
		</Pressable>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.xs,
		},
		pressed: {
			opacity: 0.7,
		},
		textWrap: {
			flex: 1,
		},
		title: {
			fontSize: font.base,
			color: colors.text,
			fontWeight: '600',
		},
		description: {
			fontSize: font.xs,
			color: colors.textMuted,
		},
		value: {
			fontSize: font.sm,
			color: colors.textSecondary,
			fontWeight: '600',
			maxWidth: 120,
		},
		sheet: {
			width: '100%',
			maxWidth: 420,
			maxHeight: '70%',
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.lg,
			gap: spacing.sm,
		},
		sheetTitle: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
		},
		list: {
			flexGrow: 0,
		},
		listContent: {
			gap: 2,
		},
		optionRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			paddingVertical: spacing.sm,
		},
		optionLabel: {
			fontSize: font.base,
			color: colors.text,
		},
		optionLabelSelected: {
			color: colors.brand,
			fontWeight: '600',
		},
	})
}
