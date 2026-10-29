// Base overlay primitive. Wraps React Native's `<Modal>` with the correct
// dismissal behavior baked in: tapping the dimmed backdrop closes it (unless
// `dismissOnBackdropPress={false}`), taps on the content never fall through,
// and Android hardware-back / web Escape route to `onDismiss`. Content-agnostic
// — callers style their own sheet via `children` / `contentStyle`; the only
// styling this owns is a default corner radius + soft shadow, both overridable.

import { ComponentProps, ReactNode } from 'react'
import { Modal as RNModal, Pressable, StyleSheet } from 'react-native'
import Animated from 'react-native-reanimated'
import { radius, shadow, spacing } from '../theme'

export function Modal({
	visible,
	onDismiss,
	dismissOnBackdropPress = true,
	children,
	contentStyle,
	backdropStyle,
	animationType = 'fade',
	onShow,
	fullScreenContent = false,
}: {
	visible: boolean
	onDismiss?: () => void
	dismissOnBackdropPress?: boolean
	children: ReactNode
	contentStyle?: AnimatedStyle
	// May be animated — the backdrop is an `Animated.View`.
	backdropStyle?: AnimatedStyle
	animationType?: ComponentProps<typeof RNModal>['animationType']
	onShow?: () => void
	// The content wrapper fills the backdrop and passes touches through its
	// empty area, for a child that positions itself (`MinimizableModal`).
	fullScreenContent?: boolean
}) {
	return (
		<RNModal
			visible={visible}
			transparent
			animationType={animationType}
			onRequestClose={onDismiss}
			onShow={onShow}
		>
			<Animated.View style={[styles.backdrop, backdropStyle]}>
				{/* The dismiss target sits *behind* the content rather than
				    wrapping it. A Pressable ancestor claims the touch responder
				    on press-in, which starves any ScrollView inside the sheet of
				    its drag gesture — as a sibling it can't, and taps on the
				    content simply never reach it. */}
				{dismissOnBackdropPress && onDismiss && (
					<Pressable
						style={StyleSheet.absoluteFill}
						onPress={onDismiss}
					/>
				)}
				<Animated.View
					style={[
						fullScreenContent
							? StyleSheet.absoluteFill
							: styles.content,
						contentStyle,
					]}
					pointerEvents={fullScreenContent ? 'box-none' : 'auto'}
				>
					{children}
				</Animated.View>
			</Animated.View>
		</RNModal>
	)
}

type AnimatedStyle = ComponentProps<typeof Animated.View>['style']

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
		boxShadow: shadow.card,
	},
})
