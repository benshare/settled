// An investor's set-aside investment tokens, drawn as one small
// resource-colored circle each — the same dot vocabulary the board legend uses
// for build costs. Tokens are public, so this serves both the investor's own
// bottom bar and any player's detail card. Renders nothing at zero tokens, so
// callers only need the bonus check.

import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'
import type { PlayerState } from './types'

export function InvestmentTokens({
	investments,
}: {
	investments: PlayerState['investments']
}) {
	const dots: { key: string; resource: Resource }[] = RESOURCES.flatMap((r) =>
		Array.from({ length: investments?.[r] ?? 0 }, (_, i) => ({
			key: `${r}-${i}`,
			resource: r,
		}))
	)
	if (dots.length === 0) return null
	return (
		<View style={styles.row}>
			<Ionicons
				name="trending-up-outline"
				size={14}
				color={colors.textSecondary}
			/>
			{dots.map(({ key, resource }) => (
				<View
					key={key}
					style={[
						styles.dot,
						{ backgroundColor: resourceColor[resource] },
					]}
				/>
			))}
		</View>
	)
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		flexWrap: 'wrap',
		gap: 4,
	},
	dot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		borderWidth: 1,
		borderColor: colors.border,
	},
})
