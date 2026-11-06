import { StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { colors, font, radius, shadow, spacing } from '../theme'

// Shown to a seat that a timeout has skipped, on and off its turn, so it can
// leave the one-minute penalty without first having to make a move.
export function TimeoutBanner({
	submitting,
	onImBack,
}: {
	submitting: boolean
	onImBack: () => void
}) {
	return (
		<View style={styles.row}>
			<Text style={styles.text}>
				You timed out — you have 1 minute per move.
			</Text>
			<Button size="small" onPress={onImBack} loading={submitting}>
				I'm back
			</Button>
		</View>
	)
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		marginHorizontal: spacing.md,
		marginTop: spacing.sm,
		padding: spacing.sm,
		backgroundColor: colors.background,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		boxShadow: shadow.raised,
	},
	text: {
		flex: 1,
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
})
