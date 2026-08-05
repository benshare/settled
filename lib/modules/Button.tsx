import React, { useMemo } from 'react'
import {
	ActivityIndicator,
	Pressable,
	PressableProps,
	StyleProp,
	StyleSheet,
	Text,
	ViewStyle,
} from 'react-native'
import { useTheme } from '../ThemeContext'
import { ColorScheme, font, radius, spacing } from '../theme'

type ButtonVariant = 'primary' | 'secondary'
type ButtonSize = 'default' | 'small'

interface ButtonProps extends PressableProps {
	variant?: ButtonVariant
	// `small` is a thinner, lighter-weight button for dense surfaces like the
	// HUD dock; `default` is the original full-height control.
	size?: ButtonSize
	loading?: boolean
	children: React.ReactNode
	style?: StyleProp<ViewStyle>
}

export function Button({
	variant = 'primary',
	size = 'default',
	loading = false,
	disabled,
	children,
	style,
	...rest
}: ButtonProps) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const isDisabled = disabled || loading
	const isPrimary = variant === 'primary'
	const isSmall = size === 'small'

	return (
		<Pressable
			style={({ pressed }) => [
				styles.base,
				isSmall && styles.baseSmall,
				isPrimary ? styles.primary : styles.secondary,
				isDisabled && styles.disabled,
				pressed && !isDisabled && styles.pressed,
				style,
			]}
			disabled={isDisabled}
			{...rest}
		>
			{loading ? (
				<ActivityIndicator
					color={isPrimary ? colors.white : colors.text}
					size="small"
				/>
			) : (
				<Text
					style={[
						styles.label,
						isSmall && styles.labelSmall,
						{ color: isPrimary ? colors.white : colors.text },
					]}
				>
					{children}
				</Text>
			)}
		</Pressable>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		base: {
			minHeight: 52,
			paddingVertical: 14,
			paddingHorizontal: spacing.xl,
			borderRadius: radius.md,
			alignItems: 'center',
			justifyContent: 'center',
			flexDirection: 'row',
		},
		baseSmall: {
			minHeight: 38,
			paddingVertical: 8,
			paddingHorizontal: spacing.md,
		},
		primary: {
			backgroundColor: colors.brand,
		},
		secondary: {
			backgroundColor: colors.card,
			borderWidth: 1,
			borderColor: colors.border,
		},
		disabled: {
			opacity: 0.4,
		},
		pressed: {
			opacity: 0.85,
		},
		label: {
			fontSize: font.md,
			fontWeight: '600',
			letterSpacing: 0.2,
		},
		labelSmall: {
			fontSize: font.sm,
			fontWeight: '500',
		},
	})
}
