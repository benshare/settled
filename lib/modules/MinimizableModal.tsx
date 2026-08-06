// A `Modal` holding a `CollapsibleSheet`. Anchored to the top rather than
// centered so the title bar holds position as the body collapses — minimizing
// shrinks the sheet upward, revealing whatever is behind it. That's the whole
// point: use this for a prompt the player may need to consult the screen behind
// (the game board) before answering, instead of forcing them to dismiss and
// reopen.

import { ReactNode, useMemo, useState } from 'react'
import { StyleProp, StyleSheet, ViewStyle } from 'react-native'
import { LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { COLLAPSE_DURATION, CollapsibleSheet } from './CollapsibleSheet'
import { Modal } from './Modal'
import { ColorScheme, spacing } from '../theme'
import { useTheme } from '../ThemeContext'

export function MinimizableModal({
	title,
	visible = true,
	onDismiss,
	dismissOnBackdropPress = true,
	contentStyle,
	children,
}: {
	title: string
	visible?: boolean
	onDismiss?: () => void
	dismissOnBackdropPress?: boolean
	contentStyle?: StyleProp<ViewStyle>
	children: ReactNode
}) {
	const { colors } = useTheme()
	const insets = useSafeAreaInsets()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [minimized, setMinimized] = useState(false)

	return (
		<Modal
			visible={visible}
			onDismiss={onDismiss}
			dismissOnBackdropPress={dismissOnBackdropPress}
			contentStyle={[styles.sheet, contentStyle]}
			backdropStyle={[
				styles.backdrop,
				{ paddingTop: insets.top + spacing.lg },
			]}
			layout={LinearTransition.duration(COLLAPSE_DURATION)}
		>
			<CollapsibleSheet
				title={title}
				collapsed={minimized}
				onToggleCollapsed={() => setMinimized((m) => !m)}
			>
				{children}
			</CollapsibleSheet>
		</Modal>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		backdrop: {
			flex: 1,
			backgroundColor: 'rgba(0,0,0,0.55)',
			alignItems: 'center',
			justifyContent: 'flex-start',
			paddingHorizontal: spacing.lg,
			paddingBottom: spacing.lg,
		},
		sheet: {
			width: '100%',
			backgroundColor: colors.card,
			padding: spacing.lg,
			gap: spacing.md,
			overflow: 'hidden',
		},
	})
}
