import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { playerColors } from './palette'
import type { GameState } from './types'

export function PlayerStrip({
	playerOrder,
	currentTurn,
	meIdx,
	profilesById,
	gameState,
}: {
	playerOrder: string[]
	currentTurn: number | null
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
}) {
	const pointsByPlayer = pointsFromVertices(gameState)

	return (
		<View style={styles.row}>
			{playerOrder.map((uid, i) => {
				const color = playerColors[i] ?? playerColors[0]
				const profile = profilesById[uid]
				const name =
					i === meIdx ? 'You' : (profile?.username ?? 'Player')
				const points = pointsByPlayer[i] ?? 0
				const cards = sumResources(gameState.players[i]?.resources)
				const isActive = currentTurn === i
				return (
					<View
						key={uid}
						style={[
							styles.box,
							isActive && {
								borderColor: color,
								backgroundColor: colors.cardAlt,
							},
						]}
					>
						<View style={styles.headerRow}>
							<View
								style={[styles.dot, { backgroundColor: color }]}
							/>
							<Text style={styles.name} numberOfLines={1}>
								{name}
							</Text>
						</View>
						<View style={styles.stats}>
							<View style={styles.stat}>
								<Ionicons
									name="trophy"
									size={12}
									color={colors.textSecondary}
								/>
								<Text style={styles.statText}>{points}</Text>
							</View>
							<View style={styles.stat}>
								<Ionicons
									name="albums"
									size={12}
									color={colors.textSecondary}
								/>
								<Text style={styles.statText}>{cards}</Text>
							</View>
						</View>
					</View>
				)
			})}
		</View>
	)
}

function pointsFromVertices(gameState: GameState): Record<number, number> {
	const out: Record<number, number> = {}
	for (const v of Object.values(gameState.vertices)) {
		if (!v?.occupied) continue
		const add = v.building === 'city' ? 2 : 1
		out[v.player] = (out[v.player] ?? 0) + add
	}
	return out
}

function sumResources(
	hand: GameState['players'][number]['resources'] | undefined
): number {
	if (!hand) return 0
	let total = 0
	for (const key in hand) total += hand[key as keyof typeof hand] ?? 0
	return total
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		gap: spacing.xs,
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
	},
	box: {
		flex: 1,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1.5,
		borderColor: colors.border,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs,
		gap: spacing.xs,
	},
	headerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	dot: {
		width: 8,
		height: 8,
		borderRadius: radius.full,
	},
	name: {
		flex: 1,
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	stats: {
		flexDirection: 'row',
		gap: spacing.sm,
	},
	stat: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 3,
	},
	statText: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
	},
})
