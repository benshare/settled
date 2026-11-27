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

// `muted` is a solid-fill, white-label button like `primary`, but in the faded
// brown `brandMuted` — a lower-emphasis primary action (e.g. End turn vs Roll).
type ButtonVariant = 'primary' | 'secondary' | 'muted'
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
	// Secondary is the only outlined, dark-label variant; primary and muted are
	// both solid fills with a white label.
	const isSolid = variant !== 'secondary'
	const isSmall = size === 'small'

	return (
		<Pressable
			style={({ pressed }) => [
				styles.base,
				isSmall && styles.baseSmall,
				styles[variant],
				isDisabled && styles.disabled,
				pressed && !isDisabled && styles.pressed,
				style,
			]}
			disabled={isDisabled}
			{...rest}
		>
			{loading ? (
				<ActivityIndicator
					color={isSolid ? colors.white : colors.text}
					size="small"
				/>
			) : (
				<Text
					style={[
						styles.label,
						isSmall && styles.labelSmall,
						{ color: isSolid ? colors.white : colors.text },
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
		muted: {
			backgroundColor: colors.brandMuted,
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
