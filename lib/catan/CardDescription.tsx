// A bonus / curse card's rules text: the short description, plus — when the
// card has any — its clarifications as bullets behind a Details toggle. A card
// with no clarifications renders the description alone, with no toggle.

import { ColorScheme, font, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import {
	Pressable,
	StyleSheet,
	Text,
	View,
	type StyleProp,
	type TextStyle,
} from 'react-native'

export function CardDescription({
	description,
	clarifications,
	textStyle,
	centered = false,
}: {
	description: string
	clarifications: readonly string[]
	// The host card's description style; bullets reuse it so they read as the
	// same text, one level down.
	textStyle: StyleProp<TextStyle>
	centered?: boolean
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [expanded, setExpanded] = useState(false)

	return (
		<>
			<Text style={textStyle}>{description}</Text>
			{expanded &&
				clarifications.map((line) => (
					<View key={line} style={styles.bullet}>
						<Text style={[textStyle, styles.bulletText]}>•</Text>
						<Text
							style={[
								textStyle,
								styles.bulletText,
								styles.bulletBody,
							]}
						>
							{line}
						</Text>
					</View>
				))}
			{clarifications.length > 0 && (
				<Pressable
					onPress={() => setExpanded((e) => !e)}
					hitSlop={8}
					style={({ pressed }) => [
						styles.toggle,
						centered && styles.toggleCentered,
						pressed && styles.pressed,
					]}
					accessibilityRole="button"
					accessibilityState={{ expanded }}
				>
					<Text style={styles.toggleText}>
						{expanded ? 'Hide details' : 'Details'}
					</Text>
					<Ionicons
						name={expanded ? 'chevron-up' : 'chevron-down'}
						size={12}
						color={colors.textMuted}
					/>
				</Pressable>
			)}
		</>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		bullet: {
			flexDirection: 'row',
			gap: spacing.xs,
		},
		bulletText: {
			textAlign: 'left',
		},
		bulletBody: {
			flex: 1,
		},
		toggle: {
			flexDirection: 'row',
			alignItems: 'center',
			alignSelf: 'flex-start',
			gap: 2,
		},
		toggleCentered: {
			alignSelf: 'center',
		},
		toggleText: {
			fontSize: font.xs,
			fontWeight: '600',
			color: colors.textMuted,
		},
		pressed: {
			opacity: 0.6,
		},
	})
}
