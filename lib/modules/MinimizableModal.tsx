// A `Modal` holding a `MinimizableSheet`, for a prompt the player may need to
// consult the screen behind (the game board) before answering, instead of
// forcing them to dismiss and reopen.
//
// Minimizing has to give the whole screen back, and an RN `<Modal>` swallows
// every touch in its window however transparent it is — so the modal can't
// just shrink, it has to close. The sheet morphs into a bubble at the slot of
// an in-tree `MinimizedBubble` (rendered where this component is mounted, at
// its parent's top right) while the backdrop fades out; once it lands, the
// modal closes in the same commit that reveals the in-tree copy, so the two
// overlap rather than flicker. Restoring runs that backwards: the modal
// reopens holding the sheet at the bubble, and only morphs out once it's
// actually on screen (`onShow`).

import { ReactNode, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import {
	interpolateColor,
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
	BubblePoint,
	MinimizableSheet,
	MinimizedBubble,
} from './MinimizableSheet'
import { Modal } from './Modal'
import { spacing, z } from '../theme'

const DIM = 'rgba(0,0,0,0.275)'
const CLEAR = 'rgba(0,0,0,0)'
const APPEAR_DURATION = 200

export function MinimizableModal({
	title,
	minimized,
	onToggleMinimized,
	visible = true,
	onDismiss,
	dismissOnBackdropPress = true,
	maxWidth,
	children,
}: {
	title: string
	minimized: boolean
	onToggleMinimized: () => void
	visible?: boolean
	onDismiss?: () => void
	dismissOnBackdropPress?: boolean
	maxWidth?: number
	children: ReactNode
}) {
	const insets = useSafeAreaInsets()
	const bubbleRef = useRef<View>(null)
	const rootRef = useRef<View>(null)
	const [bubble, setBubble] = useState<BubblePoint>()
	// The morph finished minimized: the modal is closed and the in-tree
	// bubble is the live one. Starts that way for a prompt remounted while
	// minimized (a HUD pane coming back on screen), which must not open a
	// touch-swallowing modal just to sit at the bubble.
	const [docked, setDocked] = useState(minimized)
	// Reopened from the bubble; the sheet holds there until the modal shows.
	const [restoring, setRestoring] = useState(false)

	const progress = useSharedValue(minimized ? 0 : 1)
	const appear = useSharedValue(0)
	useEffect(() => {
		appear.value = withTiming(1, { duration: APPEAR_DURATION })
	}, [appear])

	const backdropStyle = useAnimatedStyle(() => ({
		backgroundColor: interpolateColor(
			progress.value * appear.value,
			[0, 1],
			[CLEAR, DIM]
		),
	}))
	const contentStyle = useAnimatedStyle(() => ({ opacity: appear.value }))

	// The board can move under the bubble (the classic layout resizes it), so
	// the target is re-read right before each morph rather than trusted from
	// the last layout.
	const measureBubble = (then: () => void) => {
		const slot = bubbleRef.current
		const root = rootRef.current
		if (!slot || !root) return then()
		slot.measureInWindow((bx, by) => {
			root.measureInWindow((rx, ry) => {
				setBubble({ x: bx - rx, y: by - ry })
				then()
			})
		})
	}

	const restore = () => {
		setRestoring(true)
		setDocked(false)
		onToggleMinimized()
	}

	const bubbleLive = docked || restoring

	return (
		<>
			<View
				ref={bubbleRef}
				style={[styles.bubbleSlot, !bubbleLive && styles.hidden]}
				pointerEvents={bubbleLive ? 'auto' : 'none'}
				onLayout={() => measureBubble(() => {})}
			>
				<MinimizedBubble
					onPress={restore}
					accessibilityLabel={`Restore ${title}`}
				/>
			</View>
			<Modal
				visible={visible && !docked}
				onDismiss={onDismiss}
				dismissOnBackdropPress={dismissOnBackdropPress}
				backdropStyle={backdropStyle}
				contentStyle={contentStyle}
				animationType="none"
				onShow={() => setRestoring(false)}
				fullScreenContent
			>
				<View
					ref={rootRef}
					style={StyleSheet.absoluteFill}
					pointerEvents="box-none"
					onLayout={() => measureBubble(() => {})}
				>
					<MinimizableSheet
						title={title}
						minimized={minimized || restoring}
						onToggleMinimized={() =>
							measureBubble(onToggleMinimized)
						}
						top={insets.top + spacing.lg}
						maxWidth={maxWidth}
						bubble={bubble}
						progress={progress}
						onMorphEnd={(m) => m && minimized && setDocked(true)}
					>
						{children}
					</MinimizableSheet>
				</View>
			</Modal>
		</>
	)
}

const styles = StyleSheet.create({
	bubbleSlot: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		zIndex: z.floatingButton,
	},
	hidden: {
		opacity: 0,
	},
})
