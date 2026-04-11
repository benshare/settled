import React from 'react'
import {
	ActivityIndicator,
	Pressable,
	PressableProps,
	StyleProp,
	StyleSheet,
	Text,
	ViewStyle,
} from 'react-native'
import { colors, font, radius, spacing } from '../theme'

type ButtonVariant = 'primary' | 'secondary'

interface ButtonProps extends PressableProps {
	variant?: ButtonVariant
	loading?: boolean
	children: React.ReactNode
	style?: StyleProp<ViewStyle>
}

export function Button({
	variant = 'primary',
	loading = false,
	disabled,
	children,
	style,
	...rest
}: ButtonProps) {
	const isDisabled = disabled || loading
	const isPrimary = variant === 'primary'

	return (
		<Pressable
			style={({ pressed }) => [
				styles.base,
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
						{ color: isPrimary ? colors.white : colors.text },
					]}
				>
					{children}
				</Text>
			)}
		</Pressable>
	)
}

const styles = StyleSheet.create({
	base: {
		minHeight: 52,
		paddingVertical: 14,
		paddingHorizontal: spacing.xl,
		borderRadius: radius.md,
		alignItems: 'center',
		justifyContent: 'center',
		flexDirection: 'row',
	},
	primary: {
		backgroundColor: colors.text,
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
})
