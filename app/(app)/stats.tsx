import { useAuth } from '@/lib/auth'
import { bonusById } from '@/lib/catan/bonuses'
import { Avatar } from '@/lib/modules/Avatar'
import { computeStats, type BonusRate } from '@/lib/stats'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { useStatsStore } from '@/lib/stores/useStatsStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useMemo } from 'react'
import {
	ActivityIndicator,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function StatsScreen() {
	const { user } = useAuth()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const results = useStatsStore((s) => s.results)
	const error = useStatsStore((s) => s.error)
	const completeGames = useGamesStore((s) => s.completeGames)
	const profilesById = useGamesStore((s) => s.profilesById)

	const loaded = results !== undefined && completeGames !== undefined
	const stats = useMemo(
		() => computeStats(results ?? [], completeGames ?? [], user?.id ?? ''),
		[results, completeGames, user?.id]
	)

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.container}>
				<Text style={styles.title}>Stats</Text>

				{!loaded && <ActivityIndicator color={colors.textMuted} />}

				{loaded && error && <Text style={styles.error}>{error}</Text>}

				{loaded && !error && stats.gamesPlayed === 0 && (
					<Text style={styles.emptyText}>
						Play a game to see your stats.
					</Text>
				)}

				{loaded && !error && stats.gamesPlayed > 0 && (
					<>
						<View style={styles.section}>
							<Text style={styles.sectionHeading}>Games</Text>
							<View style={styles.grid}>
								<StatTile
									label="Win rate"
									value={percent(stats.winRate)}
									sub={`${stats.wins} of ${stats.gamesPlayed} games`}
								/>
								<StatTile
									label="Avg points"
									value={oneDecimal(stats.avgPoints)}
								/>
								<StatTile
									label="Avg place"
									value={oneDecimal(stats.avgPlacement)}
									sub={`of ${oneDecimal(stats.avgPlayers)}`}
								/>
								<StatTile
									label="Avg rounds"
									value={oneDecimal(stats.avgRounds)}
								/>
								<StatTile
									label="Avg players"
									value={oneDecimal(stats.avgPlayers)}
								/>
							</View>
						</View>

						<View style={styles.section}>
							<Text style={styles.sectionHeading}>Friends</Text>
							<View style={styles.grid}>
								<StatTile
									label="People played with"
									value={String(stats.distinctOpponents)}
								/>
							</View>
							{stats.topOpponents.map((o) => (
								<OpponentRow
									key={o.userId}
									profile={profilesById[o.userId]}
									games={o.games}
								/>
							))}
						</View>

						{stats.bonusGames > 0 && (
							<View style={styles.section}>
								<Text style={styles.sectionHeading}>
									Bonuses
								</Text>
								<View style={styles.grid}>
									<StatTile
										label="Bonuses played"
										value={String(stats.bonusesPlayed)}
										sub={`of ${stats.bonusPoolSize}`}
									/>
									<StatTile
										label="Curses played"
										value={String(stats.cursesPlayed)}
										sub={`of ${stats.cursePoolSize}`}
									/>
								</View>
								{stats.topPickRate && (
									<BonusRateRow
										label="Most picked"
										rate={stats.topPickRate}
										unit="offers"
									/>
								)}
								{stats.topWinRate && (
									<BonusRateRow
										label="Best win rate"
										rate={stats.topWinRate}
										unit="games"
									/>
								)}
							</View>
						)}
					</>
				)}
			</ScrollView>
		</SafeAreaView>
	)
}

function StatTile({
	label,
	value,
	sub,
}: {
	label: string
	value: string
	sub?: string
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.tile}>
			<Text style={styles.tileValue}>{value}</Text>
			<Text style={styles.tileLabel}>{label}</Text>
			{sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
		</View>
	)
}

function OpponentRow({
	profile,
	games,
}: {
	profile: Profile | undefined
	games: number
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.row}>
			<Avatar profile={profile} size={40} />
			<Text style={styles.rowText} numberOfLines={1}>
				{profile?.username ?? '…'}
			</Text>
			<Text style={styles.rowValue}>
				{games} {games === 1 ? 'game' : 'games'}
			</Text>
		</View>
	)
}

function BonusRateRow({
	label,
	rate,
	unit,
}: {
	label: string
	rate: BonusRate
	unit: string
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const bonus = bonusById(rate.bonus)
	return (
		<View style={styles.row}>
			<Ionicons
				name={bonus?.icon ?? 'sparkles-outline'}
				size={24}
				color={colors.text}
				style={styles.rowIcon}
			/>
			<View style={styles.rowStack}>
				<Text style={styles.rowPrimary} numberOfLines={1}>
					{bonus?.title ?? rate.bonus}
				</Text>
				<Text style={styles.rowSecondary}>{label}</Text>
			</View>
			<View style={styles.rowStackEnd}>
				<Text style={styles.rowValue}>{percent(rate.rate)}</Text>
				<Text style={styles.rowSecondary}>
					{rate.hits} of {rate.total} {unit}
				</Text>
			</View>
		</View>
	)
}

function percent(rate: number): string {
	return `${Math.round(rate * 100)}%`
}

function oneDecimal(value: number): string {
	return value.toFixed(1)
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
		section: {
			gap: spacing.sm,
		},
		sectionHeading: {
			fontSize: font.sm,
			fontWeight: '600',
			letterSpacing: 0.5,
			textTransform: 'uppercase',
			color: colors.textSecondary,
		},
		grid: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.sm,
		},
		tile: {
			// Two per row; the basis leaves room for the grid gap.
			flexBasis: '48%',
			flexGrow: 1,
			gap: 2,
			padding: spacing.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
		},
		tileValue: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		tileLabel: {
			fontSize: font.base,
			color: colors.textSecondary,
		},
		tileSub: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.sm,
			paddingHorizontal: spacing.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
		},
		rowIcon: {
			width: 40,
			textAlign: 'center',
		},
		rowStack: {
			flex: 1,
			gap: 2,
		},
		rowStackEnd: {
			alignItems: 'flex-end',
			gap: 2,
		},
		rowText: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		rowPrimary: {
			fontSize: font.md,
			color: colors.text,
		},
		rowValue: {
			fontSize: font.md,
			fontWeight: '600',
			color: colors.text,
		},
		rowSecondary: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		emptyText: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
		error: {
			fontSize: font.base,
			color: colors.error,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
	})
}
