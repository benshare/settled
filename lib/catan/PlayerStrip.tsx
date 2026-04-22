import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { bonusById, curseById } from './bonuses'
import { playerColors } from './palette'
import type { GameState } from './types'

export function PlayerStrip({
	playerOrder,
	currentTurn,
	meIdx,
	profilesById,
	gameState,
	onPressPlayer,
}: {
	playerOrder: string[]
	currentTurn: number | null
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	onPressPlayer?: (playerIdx: number) => void
}) {
	const pointsByPlayer = pointsFromVertices(gameState)
	const showBonusIcons = gameState.config.bonuses

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
				const player = gameState.players[i]
				const bonus = player?.bonus ? bonusById(player.bonus) : undefined
				const curse = player?.curse ? curseById(player.curse) : undefined
				return (
					<Pressable
						key={uid}
						onPress={
							onPressPlayer
								? () => onPressPlayer(i)
								: undefined
						}
						disabled={!onPressPlayer}
						style={({ pressed }) => [
							styles.box,
							isActive && styles.boxActive,
							pressed && onPressPlayer && styles.pressed,
						]}
					>
						<View
							style={[
								styles.colorBar,
								{ backgroundColor: color },
							]}
						/>
						<Text style={styles.name} numberOfLines={1}>
							{name}
						</Text>
						<View style={styles.stats}>
							<View style={styles.stat}>
								<Ionicons
									name="trophy-outline"
									size={12}
									color={colors.textSecondary}
								/>
								<Text style={styles.statText}>{points}</Text>
							</View>
							<View style={styles.stat}>
								<Ionicons
									name="albums-outline"
									size={12}
									color={colors.textSecondary}
								/>
								<Text style={styles.statText}>{cards}</Text>
							</View>
							{showBonusIcons && bonus && (
								<View style={styles.stat}>
									<Ionicons
										name={bonus.icon}
										size={12}
										color={colors.brand}
									/>
								</View>
							)}
							{showBonusIcons && curse && (
								<View style={styles.stat}>
									<Ionicons
										name={curse.icon}
										size={12}
										color={colors.error}
									/>
								</View>
							)}
						</View>
					</Pressable>
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
	},
	box: {
		flex: 1,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingHorizontal: spacing.xs,
		paddingTop: spacing.xs,
		paddingBottom: spacing.xs,
		gap: 2,
		overflow: 'hidden',
	},
	boxActive: {
		borderColor: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
	colorBar: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		height: 3,
	},
	name: {
		marginTop: 3,
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
		gap: 2,
	},
	statText: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
	},
})
