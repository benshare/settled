// Base overlay primitive. Wraps React Native's `<Modal>` with the correct
// dismissal behavior baked in: tapping the dimmed backdrop closes it (unless
// `dismissOnBackdropPress={false}`), taps on the content never fall through,
// and Android hardware-back / web Escape route to `onDismiss`. Content-agnostic
// — callers style their own sheet via `children` / `contentStyle`; the only
// styling this owns is a default corner radius + soft shadow, both overridable.

import { ComponentProps, ReactNode } from 'react'
import {
	Modal as RNModal,
	Pressable,
	StyleProp,
	StyleSheet,
	ViewStyle,
} from 'react-native'
import Animated from 'react-native-reanimated'
import { radius, spacing } from '../theme'

// Animated so callers can pass a `layout` transition (e.g. a sheet that resizes
// as its content grows/shrinks). Stays a Pressable so it still swallows taps.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export function Modal({
	visible,
	onDismiss,
	dismissOnBackdropPress = true,
	children,
	contentStyle,
	backdropStyle,
	layout,
}: {
	visible: boolean
	onDismiss?: () => void
	dismissOnBackdropPress?: boolean
	children: ReactNode
	contentStyle?: StyleProp<ViewStyle>
	backdropStyle?: StyleProp<ViewStyle>
	layout?: ComponentProps<typeof Animated.View>['layout']
}) {
	return (
		<RNModal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onDismiss}
		>
			<Pressable
				style={[styles.backdrop, backdropStyle]}
				onPress={dismissOnBackdropPress ? onDismiss : undefined}
			>
				{/* Inner Pressable swallows taps so presses on the content never
				    bubble to the backdrop and dismiss it. */}
				<AnimatedPressable
					style={[styles.content, contentStyle]}
					layout={layout}
				>
					{children}
				</AnimatedPressable>
			</Pressable>
		</RNModal>
	)
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.55)',
		alignItems: 'center',
		justifyContent: 'center',
		padding: spacing.lg,
	},
	content: {
		borderRadius: radius.md,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
	},
})
