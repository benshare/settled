import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'

const isWeb = Platform.OS === 'web'
import { bonusById, curseById } from './bonuses'
import { knightsPlayed } from './dev'
import { longestRoadFor } from './longestRoad'
import { playerColors, resourceColor } from './palette'
import type { GameState } from './types'

export function PlayerStrip({
	playerOrder,
	currentTurn,
	meIdx,
	profilesById,
	gameState,
	pointsByPlayer,
	publicByPlayer,
	forfeitedIds,
	onPressPlayer,
}: {
	playerOrder: string[]
	currentTurn: number | null
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	// Already-resolved display VP per player (public for others, self for
	// the viewer, or fully revealed once the game is over). Sourced from
	// GameContext so every surface stays in sync.
	pointsByPlayer: number[]
	// Strictly-public VP per player (no hidden VP cards). When this is
	// lower than `pointsByPlayer[i]` we render `public (revealed)` to make
	// the gap between "what others see" and "what they actually have"
	// legible — only happens on rows we're allowed to look behind, i.e.
	// the viewer's own row in an active game and every row at game over.
	publicByPlayer: number[]
	// User ids holding a standing (withdrawable) forfeit. It has no mechanical
	// effect — the seat still plays — so it's shown as a flag beside the name
	// rather than by dimming the card. See the game menu in `lib/game/`.
	forfeitedIds?: string[]
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
				const points = pointsByPlayer[i] ?? 0
				const publicPoints = publicByPlayer[i] ?? points
				const hasHidden = points > publicPoints
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
				const knights = player ? knightsPlayed(player) : 0
				const hasLargestArmy = gameState.largestArmy === i
				const longestRoadLen = longestRoadFor(gameState, i)
				const hasLongestRoad = gameState.longestRoad === i
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
							{forfeitedIds?.includes(uid) && (
								<Ionicons
									name="flag"
									size={11}
									color={colors.textMuted}
								/>
							)}
						</View>
						<View style={styles.statsGrid}>
							<View style={styles.gridStat}>
								<Ionicons
									name="trophy"
									size={12}
									color={colors.textSecondary}
								/>
								<Text style={styles.statText}>
									{hasHidden
										? `${publicPoints} (${points})`
										: points}
								</Text>
							</View>
							<View style={styles.gridStat}>
								<Ionicons
									name="albums"
									size={12}
									color={colors.textSecondary}
								/>
								<Text style={styles.statText}>{cards}</Text>
							</View>
							{showDevCards && devCount > 0 && (
								<View style={styles.gridStat}>
									<MaterialCommunityIcons
										name="script-text"
										size={12}
										color={colors.textSecondary}
									/>
									<Text style={styles.statText}>
										{devCount}
									</Text>
								</View>
							)}
							{showDevCards && knights > 0 && (
								<View style={styles.gridStat}>
									<MaterialCommunityIcons
										name="sword"
										size={12}
										color={
											hasLargestArmy
												? colors.brand
												: colors.textSecondary
										}
									/>
									<Text
										style={[
											styles.statText,
											hasLargestArmy && {
												color: colors.brand,
											},
										]}
									>
										{knights}
									</Text>
								</View>
							)}
							{longestRoadLen > 0 && (
								<View style={styles.gridStat}>
									<MaterialCommunityIcons
										name="road-variant"
										size={12}
										color={
											hasLongestRoad
												? colors.brand
												: colors.textSecondary
										}
									/>
									<Text
										style={[
											styles.statText,
											hasLongestRoad && {
												color: colors.brand,
											},
										]}
									>
										{longestRoadLen}
									</Text>
								</View>
							)}
						</View>
						{showBonusIcons && (bonus || curse) && (
							<View style={styles.badgeRow}>
								{bonus && (
									<View style={styles.stat}>
										<Ionicons
											name={bonus.icon}
											size={12}
											color={colors.success}
										/>
										{player?.specialistResource && (
											<View
												style={[
													styles.specialistDot,
													{
														backgroundColor:
															resourceColor[
																player
																	.specialistResource
															],
													},
												]}
											/>
										)}
									</View>
								)}
								{curse && (
									<View style={styles.stat}>
										<Ionicons
											name={curse.icon}
											size={12}
											color={colors.error}
										/>
									</View>
								)}
							</View>
						)}
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
		paddingTop: isWeb ? 2 : spacing.xs,
		paddingBottom: isWeb ? spacing.xs : spacing.sm,
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
	statsGrid: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		rowGap: spacing.xs,
	},
	gridStat: {
		flexBasis: '50%',
		flexDirection: 'row',
		alignItems: 'center',
		gap: 3,
	},
	badgeRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		columnGap: spacing.sm,
		rowGap: spacing.xs,
	},
	stat: {
		flexDirection: 'row',
		alignItems: 'center',
		flexShrink: 0,
		gap: 3,
	},
	statText: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
	},
	specialistDot: {
		width: 8,
		height: 8,
		borderRadius: radius.full,
		borderWidth: 1,
		borderColor: '#2B2B2B',
	},
})
