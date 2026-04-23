import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import { bonusById, curseById } from './bonuses'
import { totalVP } from './dev'
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
	const showBonusIcons = gameState.config.bonuses
	const showDevCards = gameState.config.devCards

	return (
		<View style={styles.row}>
			{playerOrder.map((uid, i) => {
				const color = playerColors[i] ?? playerColors[0]
				const profile = profilesById[uid]
				const name =
					i === meIdx ? 'You' : (profile?.username ?? 'Player')
				// Hidden VP cards are included only for the viewer. Everyone
				// else sees public points (buildings + Largest Army).
				const points = totalVP(gameState, i, i === meIdx)
				const cards = sumResources(gameState.players[i]?.resources)
				const isActive = currentTurn === i
				const player = gameState.players[i]
				const bonus = player?.bonus
					? bonusById(player.bonus)
					: undefined
				const curse = player?.curse
					? curseById(player.curse)
					: undefined
				const devCount = player?.devCards?.length ?? 0
				return (
					<Pressable
						key={uid}
						onPress={
							onPressPlayer ? () => onPressPlayer(i) : undefined
						}
						disabled={!onPressPlayer}
						style={({ pressed }) => [
							styles.box,
							isActive && {
								borderColor: color,
								backgroundColor: colors.cardAlt,
							},
							pressed && onPressPlayer && styles.pressed,
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
							{showDevCards && devCount > 0 && (
								<View style={styles.stat}>
									<Ionicons
										name="shield"
										size={12}
										color={colors.textSecondary}
									/>
									<Text style={styles.statText}>
										{devCount}
									</Text>
								</View>
							)}
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
	pressed: {
		opacity: 0.7,
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
