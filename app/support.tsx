import { ColorScheme, font, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { useMemo } from 'react'
import { Linking, ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const CONTACT_EMAIL = 'bentshare@gmail.com'

export default function SupportScreen() {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	return (
		<SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
			<ScrollView
				contentContainerStyle={styles.content}
				showsVerticalScrollIndicator={false}
			>
				<Text style={styles.title}>Support</Text>
				<Text style={styles.body}>
					Need help with Settled or have a question, bug report, or
					feedback? Reach out and we&rsquo;ll get back to you.
				</Text>
				<Text
					style={styles.link}
					onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
				>
					{CONTACT_EMAIL}
				</Text>
			</ScrollView>
		</SafeAreaView>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		content: {
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.lg,
			paddingBottom: spacing.xxl,
		},
		title: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
			marginBottom: spacing.md,
		},
		body: {
			fontSize: font.base,
			lineHeight: 22,
			color: colors.textSecondary,
			marginBottom: spacing.md,
		},
		link: {
			fontSize: font.md,
			fontWeight: '600',
			color: colors.accent,
		},
	})
}
