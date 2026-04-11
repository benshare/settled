import { colors, font } from '@/lib/theme'
import { StyleSheet, Text } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function PlayScreen() {
	return (
		<SafeAreaView style={styles.safe}>
			<Text style={styles.text}>Play</Text>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	safe: {
		flex: 1,
		backgroundColor: colors.background,
		alignItems: 'center',
		justifyContent: 'center',
	},
	text: {
		fontSize: font.xl,
		fontWeight: '700',
		color: colors.text,
	},
})
