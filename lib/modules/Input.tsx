import React, { forwardRef, useMemo } from 'react'
import {
	StyleProp,
	StyleSheet,
	Text,
	TextInput,
	TextInputProps,
	View,
	ViewStyle,
} from 'react-native'
import { useTheme } from '../ThemeContext'
import { ColorScheme, font, radius, spacing } from '../theme'

interface InputProps extends TextInputProps {
	label?: string
	hint?: string
	error?: string
	containerStyle?: StyleProp<ViewStyle>
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
	{ label, hint, error, containerStyle, style, ...rest },
	ref
) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	return (
		<View style={[styles.container, containerStyle]}>
			{label && <Text style={styles.label}>{label}</Text>}
			<TextInput
				ref={ref}
				style={[styles.input, error ? styles.inputError : null, style]}
				placeholderTextColor={colors.textMuted}
				selectionColor={colors.brand}
				{...rest}
			/>
			{(hint || error) && (
				<Text style={[styles.hint, error ? styles.hintError : null]}>
					{error ?? hint}
				</Text>
			)}
		</View>
	)
})

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		container: {
			gap: spacing.xs,
		},
		label: {
			fontSize: font.sm,
			fontWeight: '600',
			letterSpacing: 0.5,
			textTransform: 'uppercase',
			color: colors.textSecondary,
		},
		input: {
			minHeight: 52,
			borderWidth: 1,
			borderColor: colors.border,
			borderRadius: radius.md,
			paddingHorizontal: spacing.md,
			paddingVertical: 14,
			fontSize: font.md,
			color: colors.text,
			backgroundColor: colors.card,
		},
		inputError: {
			borderColor: colors.error,
		},
		hint: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		hintError: {
			color: colors.error,
		},
	})
}
