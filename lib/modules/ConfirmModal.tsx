// Styled replacement for the native `confirm` dialog. Use this for any
// action that needs an "are you sure" before it fires.

import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../ThemeContext'
import { ColorScheme, font, radius, spacing } from '../theme'
import { Button } from './Button'
import { Modal } from './Modal'

export function ConfirmModal({
	visible,
	title,
	message,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	destructive = false,
	submitting = false,
	error,
	onConfirm,
	onCancel,
}: {
	visible: boolean
	title: string
	message?: string
	confirmLabel?: string
	cancelLabel?: string
	destructive?: boolean
	submitting?: boolean
	error?: string | null
	onConfirm: () => void
	onCancel: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	return (
		<Modal
			visible={visible}
			onDismiss={onCancel}
			contentStyle={styles.sheet}
		>
			<Text style={styles.title}>{title}</Text>
			{message && <Text style={styles.message}>{message}</Text>}
			{error && <Text style={styles.errorText}>{error}</Text>}
			<View style={styles.actions}>
				<Pressable
					style={({ pressed }) => [
						styles.cancelBtn,
						pressed && styles.pressed,
					]}
					onPress={onCancel}
					disabled={submitting}
				>
					<Text style={styles.cancelText}>{cancelLabel}</Text>
				</Pressable>
				<View style={styles.confirmSlot}>
					<Button
						onPress={onConfirm}
						loading={submitting}
						style={destructive && styles.destructive}
					>
						{confirmLabel}
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
		message: {
			fontSize: font.sm,
			color: colors.textSecondary,
			lineHeight: 20,
		},
		errorText: {
			fontSize: font.sm,
			color: colors.error,
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
		confirmSlot: {
			flex: 1,
		},
		destructive: {
			backgroundColor: colors.error,
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
