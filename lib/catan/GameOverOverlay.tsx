// Final scoreboard shown when a game ends (`games.status === 'complete'`).
// Rendered as a modal on top of the game screen. Reveals every player's
// hidden VP cards since the game is over. Offers two exits: "Back to games"
// (routes to the list) and "View board" (dismisses so the user can inspect
// the final position; the caller provides a floating reopen button).
//
// Three tabs: the final Scores, the shared Roll distribution, and the game
// Highlights (fun superlatives). The roll/highlight stats are derived from the
// event log by `gameStats.ts`.

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { type ComponentProps, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { GameEvent } from '../stores/useGamesStore'
import type { Profile } from '../stores/useProfileStore'
import { Modal } from '../modules/Modal'
import { Button } from '../modules/Button'
import { colors, font, radius, spacing, z } from '../theme'
import { populistBonusVPFor } from './bonus'
import { knightsPlayed } from './dev'
import { gameHighlights, rollDistribution, type Highlight } from './gameStats'
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
	// The full game event log (`games.events`). Backs the roll + highlight tabs.
	events: GameEvent[]
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

type TabKey = 'scores' | 'rolls' | 'highlights'

// Tallest a roll-distribution column can grow to (the bar for the most-rolled
// number); every other bar is scaled against it.
const ROLL_CHART_HEIGHT = 160

const TABS: { key: TabKey; label: string }[] = [
	{ key: 'scores', label: 'Scores' },
	{ key: 'rolls', label: 'Rolls' },
	{ key: 'highlights', label: 'Highlights' },
]

export function GameOverOverlay({
	visible,
	winnerIdx,
	playerOrder,
	meIdx,
	profilesById,
	gameState,
	events,
	pointsByPlayer,
	publicByPlayer,
	onDismiss,
	onBackToGames,
}: GameOverOverlayProps) {
	const [tab, setTab] = useState<TabKey>('scores')
	// Winner + scoreboard only render when we actually have a completed game.
	// `visible` can be false even for a complete game (user dismissed to peek
	// at the board); that's handled by the Modal itself.
	if (winnerIdx === null) return null

	const nameFor = (i: number) =>
		i === meIdx
			? 'You'
			: (profilesById[playerOrder[i]]?.username ?? 'Player')

	return (
		<Modal
			visible={visible}
			dismissOnBackdropPress={false}
			onDismiss={onDismiss}
			contentStyle={styles.sheet}
		>
			<Header
				winnerIdx={winnerIdx}
				playerOrder={playerOrder}
				meIdx={meIdx}
				profilesById={profilesById}
			/>
			<TabBar tab={tab} onTab={setTab} />
			{tab === 'scores' && (
				<Scoreboard
					gameState={gameState}
					playerOrder={playerOrder}
					meIdx={meIdx}
					profilesById={profilesById}
					pointsByPlayer={pointsByPlayer}
					publicByPlayer={publicByPlayer}
				/>
			)}
			{tab === 'rolls' && <RollDistribution events={events} />}
			{tab === 'highlights' && (
				<Highlights
					events={events}
					playerCount={playerOrder.length}
					nameFor={nameFor}
				/>
			)}
			<View style={styles.buttons}>
				<Button variant="secondary" onPress={onDismiss}>
					View board
				</Button>
				<Button onPress={onBackToGames}>Back to games</Button>
			</View>
		</Modal>
	)
}

function TabBar({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
	return (
		<View style={styles.tabBar}>
			{TABS.map((t) => {
				const active = t.key === tab
				return (
					<Pressable
						key={t.key}
						onPress={() => onTab(t.key)}
						style={[styles.tab, active && styles.tabActive]}
					>
						<Text
							style={[
								styles.tabLabel,
								active && styles.tabLabelActive,
							]}
						>
							{t.label}
						</Text>
					</Pressable>
				)
			})}
		</View>
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

// The shared 2–12 dice histogram. Counts only real `rolled` events (the dice
// everyone shares); bonus rolls are excluded — see `rollDistribution`.
function RollDistribution({ events }: { events: GameEvent[] }) {
	const dist = rollDistribution(events)
	const totals = Array.from({ length: 11 }, (_, k) => k + 2) // 2..12
	const total = totals.reduce((s, n) => s + dist[n], 0)
	const max = Math.max(1, ...totals.map((n) => dist[n]))

	return (
		<ScrollView
			style={styles.scroll}
			contentContainerStyle={styles.scrollInner}
		>
			{total === 0 ? (
				<Text style={styles.emptyText}>No rolls yet.</Text>
			) : (
				<>
					<Text style={styles.rollCaption}>
						{total} roll{total === 1 ? '' : 's'} this game
					</Text>
					<View style={styles.rollChart}>
						{totals.map((n) => {
							const count = dist[n]
							return (
								<View key={n} style={styles.rollCol}>
									<Text style={styles.rollCount}>
										{count}
									</Text>
									<View
										style={[
											styles.rollBar,
											{
												height:
													(count / max) *
													ROLL_CHART_HEIGHT,
											},
										]}
									/>
									<Text style={styles.rollNum}>{n}</Text>
								</View>
							)
						})}
					</View>
				</>
			)}
		</ScrollView>
	)
}

// Fun end-of-game superlatives. Each highlight names the tied leader(s), or a
// muted "Nobody" when there's no standout — see `gameHighlights`.
function Highlights({
	events,
	playerCount,
	nameFor,
}: {
	events: GameEvent[]
	playerCount: number
	nameFor: (i: number) => string
}) {
	const highlights = gameHighlights(events, playerCount)
	return (
		<ScrollView
			style={styles.scroll}
			contentContainerStyle={styles.scrollInner}
		>
			{highlights.map((h) => (
				<HighlightCard key={h.key} highlight={h} nameFor={nameFor} />
			))}
		</ScrollView>
	)
}

function HighlightCard({
	highlight,
	nameFor,
}: {
	highlight: Highlight
	nameFor: (i: number) => string
}) {
	const { title, subtitle, icon, winners, value, unit, valueLabel } =
		highlight
	const hasWinner = winners.length > 0
	return (
		<View style={styles.highlightRow}>
			<View style={styles.highlightIcon}>
				<MaterialCommunityIcons
					name={
						icon as ComponentProps<
							typeof MaterialCommunityIcons
						>['name']
					}
					size={20}
					color={colors.brand}
				/>
			</View>
			<View style={styles.highlightBody}>
				<Text style={styles.highlightTitle}>{title}</Text>
				<Text style={styles.highlightSubtitle}>{subtitle}</Text>
				{hasWinner ? (
					<View style={styles.highlightWinners}>
						{winners.map((i) => (
							<View key={i} style={styles.highlightWinner}>
								<View
									style={[
										styles.dot,
										{
											backgroundColor:
												playerColors[i] ??
												playerColors[0],
										},
									]}
								/>
								<Text style={styles.highlightWinnerName}>
									{nameFor(i)}
								</Text>
							</View>
						))}
					</View>
				) : (
					<Text style={styles.highlightNobody}>Nobody</Text>
				)}
			</View>
			{hasWinner && (
				<Text style={styles.highlightValue}>
					{valueLabel ?? `${value} ${unit}`}
				</Text>
			)}
		</View>
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
	tabBar: {
		flexDirection: 'row',
		borderTopWidth: 1,
		borderTopColor: colors.border,
		borderBottomWidth: 1,
		borderBottomColor: colors.border,
	},
	tab: {
		flex: 1,
		paddingVertical: spacing.sm,
		alignItems: 'center',
		borderBottomWidth: 2,
		borderBottomColor: 'transparent',
	},
	tabActive: {
		borderBottomColor: colors.brand,
	},
	tabLabel: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
	},
	tabLabelActive: {
		color: colors.brand,
	},
	scroll: {
		flexShrink: 1,
	},
	scrollInner: {
		padding: spacing.md,
		gap: spacing.sm,
	},
	emptyText: {
		fontSize: font.md,
		color: colors.textSecondary,
		textAlign: 'center',
		paddingVertical: spacing.lg,
	},
	rollCaption: {
		fontSize: font.sm,
		color: colors.textSecondary,
		marginBottom: spacing.xs,
	},
	rollChart: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		gap: spacing.xs,
	},
	rollCol: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'flex-end',
		gap: spacing.xs,
	},
	rollBar: {
		alignSelf: 'stretch',
		minHeight: 2,
		borderRadius: radius.sm,
		backgroundColor: colors.border,
	},
	rollNum: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	rollCount: {
		fontSize: font.xs,
		fontWeight: '700',
		color: colors.textSecondary,
	},
	highlightRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		padding: spacing.sm,
	},
	highlightIcon: {
		width: 36,
		height: 36,
		borderRadius: radius.full,
		backgroundColor: colors.cardAlt,
		alignItems: 'center',
		justifyContent: 'center',
	},
	highlightBody: {
		flex: 1,
		gap: 2,
	},
	highlightTitle: {
		fontSize: font.md,
		fontWeight: '800',
		color: colors.text,
	},
	highlightSubtitle: {
		fontSize: font.xs,
		color: colors.textSecondary,
	},
	highlightWinners: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.sm,
		marginTop: 2,
	},
	highlightWinner: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 4,
	},
	highlightWinnerName: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	highlightNobody: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
		fontStyle: 'italic',
		marginTop: 2,
	},
	highlightValue: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.brand,
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
		// Sits over the board container, which is lifted above its siblings.
		zIndex: z.panel,
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
