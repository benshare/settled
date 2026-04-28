// Final scoreboard shown when a game ends (`games.status === 'complete'`).
// Rendered as a modal on top of the game screen. Reveals every player's
// hidden VP cards since the game is over. Offers two exits: "Back to games"
// (routes to the list) and "View board" (dismisses so the user can inspect
// the final position; the caller provides a floating reopen button).

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import {
	Modal,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { Button } from '../modules/Button'
import { colors, font, radius, spacing } from '../theme'
import { populistBonusVPFor } from './bonus'
import { knightsPlayed } from './dev'
import { longestRoadFor } from './longestRoad'
import { playerColors } from './palette'
import type { GameState } from './types'

export type GameOverOverlayProps = {
	visible: boolean
	winnerIdx: number | null
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	gameState: GameState
	// Final VP per player, fully revealed (includes VP cards). From
	// GameContext.selfVP since the game is over.
	pointsByPlayer: number[]
	// Strictly-public VP per player (excludes hidden VP cards). When this
	// is lower than `pointsByPlayer[i]`, the row total renders as
	// `public (revealed)` so the gap is legible — same convention as
	// PlayerStrip.
	publicByPlayer: number[]
	onDismiss: () => void
	onBackToGames: () => void
}

export function GameOverOverlay({
	visible,
	winnerIdx,
	playerOrder,
	meIdx,
	profilesById,
	gameState,
	pointsByPlayer,
	publicByPlayer,
	onDismiss,
	onBackToGames,
}: GameOverOverlayProps) {
	// Winner + scoreboard only render when we actually have a completed game.
	// `visible` can be false even for a complete game (user dismissed to peek
	// at the board); that's handled by the Modal itself.
	if (winnerIdx === null) return null
	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onDismiss}
		>
			<View style={styles.backdrop}>
				<View style={styles.sheet}>
					<Header
						winnerIdx={winnerIdx}
						playerOrder={playerOrder}
						meIdx={meIdx}
						profilesById={profilesById}
					/>
					<Scoreboard
						gameState={gameState}
						playerOrder={playerOrder}
						meIdx={meIdx}
						profilesById={profilesById}
						pointsByPlayer={pointsByPlayer}
						publicByPlayer={publicByPlayer}
					/>
					<View style={styles.buttons}>
						<Button variant="secondary" onPress={onDismiss}>
							View board
						</Button>
						<Button onPress={onBackToGames}>Back to games</Button>
					</View>
				</View>
			</View>
		</Modal>
	)
}

function Header({
	winnerIdx,
	playerOrder,
	meIdx,
	profilesById,
}: {
	winnerIdx: number
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
}) {
	const uid = playerOrder[winnerIdx]
	const profile = profilesById[uid]
	const color = playerColors[winnerIdx] ?? playerColors[0]
	const name = winnerIdx === meIdx ? 'You' : (profile?.username ?? 'Player')
	return (
		<View style={styles.header}>
			<View style={[styles.winnerDot, { backgroundColor: color }]} />
			<Text style={styles.title}>Game over</Text>
			<Text style={styles.subtitle}>
				{winnerIdx === meIdx ? 'You win!' : `${name} wins!`}
			</Text>
		</View>
	)
}

function Scoreboard({
	gameState,
	playerOrder,
	meIdx,
	profilesById,
	pointsByPlayer,
	publicByPlayer,
}: {
	gameState: GameState
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	pointsByPlayer: number[]
	publicByPlayer: number[]
}) {
	const rows = playerOrder.map((uid, i) => {
		const profile = profilesById[uid]
		const name = i === meIdx ? 'You' : (profile?.username ?? 'Player')
		const total = pointsByPlayer[i] ?? 0
		const publicTotal = publicByPlayer[i] ?? total
		return {
			i,
			name,
			color: playerColors[i] ?? playerColors[0],
			breakdown: breakdownFor(gameState, i),
			total,
			publicTotal,
		}
	})
	// Highest score first.
	rows.sort((a, b) => b.total - a.total)

	return (
		<ScrollView
			style={styles.scroll}
			contentContainerStyle={styles.scrollInner}
		>
			{rows.map((row) => (
				<View key={row.i} style={styles.row}>
					<View style={styles.rowHeader}>
						<View
							style={[styles.dot, { backgroundColor: row.color }]}
						/>
						<Text style={styles.rowName}>{row.name}</Text>
						<Text style={styles.rowTotal}>
							{row.total > row.publicTotal
								? `${row.publicTotal} (${row.total})`
								: row.total}
						</Text>
					</View>
					<View style={styles.breakdown}>
						{row.breakdown.map((chip) => (
							<View key={chip.label} style={styles.chip}>
								{chip.icon === 'trophy' && (
									<Ionicons
										name="trophy"
										size={12}
										color={colors.textSecondary}
									/>
								)}
								{chip.icon === 'sword' && (
									<MaterialCommunityIcons
										name="sword"
										size={12}
										color={colors.brand}
									/>
								)}
								{chip.icon === 'road' && (
									<MaterialCommunityIcons
										name="road-variant"
										size={12}
										color={colors.brand}
									/>
								)}
								{chip.icon === 'star' && (
									<Ionicons
										name="star"
										size={12}
										color={colors.brand}
									/>
								)}
								<Text style={styles.chipLabel}>
									{chip.label}
								</Text>
								<Text style={styles.chipValue}>
									+{chip.value}
								</Text>
							</View>
						))}
					</View>
				</View>
			))}
		</ScrollView>
	)
}

type ScoreChip = {
	label: string
	value: number
	icon: 'trophy' | 'sword' | 'road' | 'star'
}

// Mirrors totalVP() but labels each contribution so the scoreboard can show
// the source of every point. Keep this aligned with dev.totalVP() — if one
// changes, both should.
function breakdownFor(state: GameState, playerIdx: number): ScoreChip[] {
	const chips: ScoreChip[] = []
	let settlements = 0
	let cities = 0
	let superCities = 0
	for (const v of Object.values(state.vertices)) {
		if (v?.occupied && v.player === playerIdx) {
			if (v.building === 'super_city') superCities++
			else if (v.building === 'city') cities++
			else settlements++
		}
	}
	if (settlements > 0)
		chips.push({ label: 'Settlements', value: settlements, icon: 'trophy' })
	if (cities > 0)
		chips.push({ label: 'Cities', value: cities * 2, icon: 'trophy' })
	if (superCities > 0)
		chips.push({
			label: 'Super Cities',
			value: superCities * 3,
			icon: 'trophy',
		})
	if (state.largestArmy === playerIdx) {
		chips.push({
			label: `Largest Army (${knightsPlayed(state.players[playerIdx])})`,
			value: 2,
			icon: 'sword',
		})
	}
	if (state.longestRoad === playerIdx) {
		chips.push({
			label: `Longest Road (${longestRoadFor(state, playerIdx)})`,
			value: 2,
			icon: 'road',
		})
	}
	const carpenterVP = state.players[playerIdx].carpenterVP ?? 0
	if (carpenterVP > 0) {
		chips.push({ label: 'Carpenter VP', value: carpenterVP, icon: 'star' })
	}
	const populistVP = populistBonusVPFor(state, playerIdx)
	if (populistVP > 0) {
		chips.push({ label: 'Populist VP', value: populistVP, icon: 'star' })
	}
	let vpCards = 0
	for (const e of state.players[playerIdx].devCards) {
		if (e.id === 'victory_point') vpCards++
	}
	if (vpCards > 0)
		chips.push({ label: 'VP cards', value: vpCards, icon: 'star' })
	return chips
}

// Floating button rendered in the HUD once the overlay has been dismissed —
// tap to re-open the final scoreboard. Parent is responsible for conditional
// rendering (show only when complete + dismissed).
export function FinalScoreButton({ onPress }: { onPress: () => void }) {
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.finalScoreBtn,
				pressed && styles.pressed,
			]}
		>
			<Ionicons name="trophy" size={16} color={colors.white} />
			<Text style={styles.finalScoreLabel}>Final score</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	backdrop: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.45)',
		justifyContent: 'center',
		alignItems: 'center',
		paddingHorizontal: spacing.lg,
	},
	sheet: {
		width: '100%',
		maxWidth: 480,
		backgroundColor: colors.background,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.border,
		overflow: 'hidden',
		maxHeight: '85%',
	},
	header: {
		padding: spacing.lg,
		alignItems: 'center',
		gap: spacing.xs,
	},
	winnerDot: {
		width: 14,
		height: 14,
		borderRadius: radius.full,
	},
	title: {
		fontSize: font.lg,
		fontWeight: '800',
		color: colors.text,
		textTransform: 'uppercase',
		letterSpacing: 1,
	},
	subtitle: {
		fontSize: font.xl,
		fontWeight: '700',
		color: colors.brand,
	},
	scroll: {
		borderTopWidth: 1,
		borderTopColor: colors.border,
	},
	scrollInner: {
		padding: spacing.md,
		gap: spacing.sm,
	},
	row: {
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		padding: spacing.sm,
		gap: spacing.xs,
	},
	rowHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	dot: {
		width: 10,
		height: 10,
		borderRadius: radius.full,
	},
	rowName: {
		flex: 1,
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	rowTotal: {
		fontSize: font.lg,
		fontWeight: '800',
		color: colors.text,
	},
	breakdown: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
	},
	chip: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		borderRadius: radius.full,
		backgroundColor: colors.cardAlt,
		borderWidth: 1,
		borderColor: colors.border,
	},
	chipLabel: {
		fontSize: font.xs,
		color: colors.textSecondary,
	},
	chipValue: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	buttons: {
		flexDirection: 'row',
		gap: spacing.sm,
		padding: spacing.md,
		borderTopWidth: 1,
		borderTopColor: colors.border,
	},
	finalScoreBtn: {
		position: 'absolute',
		right: spacing.md,
		bottom: spacing.md,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
		backgroundColor: colors.brand,
		paddingHorizontal: spacing.md,
		paddingVertical: spacing.sm,
		borderRadius: radius.full,
	},
	finalScoreLabel: {
		color: colors.white,
		fontSize: font.sm,
		fontWeight: '700',
	},
	pressed: {
		opacity: 0.7,
	},
})
