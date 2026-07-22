import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, spacing } from '@/lib/theme'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function StatsScreen() {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.container}>
				<Text style={styles.title}>Stats</Text>
				<Text style={styles.emptyText}>Coming soon.</Text>
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
		container: {
			padding: spacing.lg,
			gap: spacing.lg,
		},
		title: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		emptyText: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
	})
}
