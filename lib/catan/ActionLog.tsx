// Floating top-right log button, mounted below the BoardLegend info floater.
// Collapsed = a list icon; expanded = a scrollable, newest-first history of
// game actions derived from `games.events`. Read-only — it just formats the
// event log that the edge function already writes.

import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import type { GameEvent } from '../stores/useGamesStore'
import type { Profile } from '../stores/useProfileStore'
import { colors, font, radius, spacing } from '../theme'
import type { Resource } from './board'
import { devCardById } from './devCards'
import { playerColors } from './palette'

const RESOURCE_LABELS: Record<Resource, string> = {
	wood: 'wood',
	wheat: 'wheat',
	sheep: 'sheep',
	brick: 'brick',
	ore: 'ore',
}

type LogContext = {
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meIdx: number
}

// A single rendered log line: the message plus the player index it belongs to
// (for the colored dot). `player: null` renders a neutral marker.
type LogLine = { text: string; player: number | null }

export function ActionLog({
	events,
	playerOrder,
	profilesById,
	meIdx,
}: {
	events: GameEvent[]
	playerOrder: string[]
	profilesById: Record<string, Profile>
	meIdx: number
}) {
	const [open, setOpen] = useState(false)

	if (!open) {
		return (
			<Pressable
				onPress={() => setOpen(true)}
				style={({ pressed }) => [
					styles.collapsed,
					pressed && styles.pressed,
				]}
				hitSlop={6}
				accessibilityLabel="Open action log"
			>
				<Ionicons name="list" size={22} color={colors.text} />
			</Pressable>
		)
	}

	const ctx: LogContext = { playerOrder, profilesById, meIdx }
	// Newest-first: the freshest action sits at the top so recent activity is
	// visible without scrolling.
	const lines: { key: string; line: LogLine }[] = []
	for (let i = events.length - 1; i >= 0; i--) {
		const line = describeEvent(events[i], ctx)
		if (line) lines.push({ key: `${events[i].at}-${i}`, line })
	}

	return (
		<Animated.View
			entering={FadeIn.duration(150)}
			exiting={FadeOut.duration(120)}
			style={styles.panel}
		>
			<View style={styles.header}>
				<Text style={styles.title}>Log</Text>
				<Pressable
					onPress={() => setOpen(false)}
					style={({ pressed }) => [
						styles.closeBtn,
						pressed && styles.pressed,
					]}
					accessibilityLabel="Close action log"
					hitSlop={6}
				>
					<Ionicons
						name="close"
						size={18}
						color={colors.textSecondary}
					/>
				</Pressable>
			</View>
			{lines.length === 0 ? (
				<Text style={styles.empty}>No actions yet.</Text>
			) : (
				<ScrollView
					style={styles.scroll}
					contentContainerStyle={styles.scrollBody}
					showsVerticalScrollIndicator={false}
				>
					{lines.map(({ key, line }) => (
						<View key={key} style={styles.row}>
							<View
								style={[
									styles.dot,
									{
										backgroundColor:
											line.player === null
												? colors.textMuted
												: (playerColors[line.player] ??
													playerColors[0]),
									},
								]}
							/>
							<Text style={styles.rowText}>{line.text}</Text>
						</View>
					))}
				</ScrollView>
			)}
		</Animated.View>
	)
}

function describeEvent(e: GameEvent, ctx: LogContext): LogLine | null {
	const who = (idx: number) => nameFor(idx, ctx)

	switch (e.kind) {
		case 'settlement_placed':
			return {
				text: `${who(e.player)} placed a settlement`,
				player: e.player,
			}
		case 'road_placed':
			return { text: `${who(e.player)} placed a road`, player: e.player }
		case 'placement_complete':
			return { text: 'Setup complete', player: null }
		case 'rolled':
			return {
				text: `${who(e.player)} rolled ${e.total}`,
				player: e.player,
			}
		case 'road_built':
			return { text: `${who(e.player)} built a road`, player: e.player }
		case 'settlement_built':
			return {
				text: `${who(e.player)} built a settlement`,
				player: e.player,
			}
		case 'city_built':
			return { text: `${who(e.player)} built a city`, player: e.player }
		case 'discarded':
			return {
				text: `${who(e.player)} discarded ${e.count} ${
					e.count === 1 ? 'card' : 'cards'
				}`,
				player: e.player,
			}
		case 'robber_moved':
			return {
				text: `${who(e.player)} moved the robber`,
				player: e.player,
			}
		case 'stolen':
			return {
				text: `${who(e.thief)} stole from ${who(e.victim)}`,
				player: e.thief,
			}
		case 'trade_accepted':
			return {
				text: `${who(e.from)} traded with ${who(e.to)}`,
				player: e.from,
			}
		case 'bank_trade':
			return {
				text: `${who(e.player)} traded with the bank`,
				player: e.player,
			}
		case 'dev_bought':
			return {
				text: `${who(e.player)} bought a development card`,
				player: e.player,
			}
		case 'dev_played':
			return {
				text: `${who(e.player)} played ${devCardById(e.id)?.title ?? 'a card'}`,
				player: e.player,
			}
		case 'largest_army_changed':
			return {
				text: `${who(e.player)} took Largest Army`,
				player: e.player,
			}
		case 'longest_road_changed':
			return e.player === null
				? { text: 'Longest Road is now unclaimed', player: null }
				: {
						text: `${who(e.player)} took Longest Road`,
						player: e.player,
					}
		case 'nomad_produce':
			return {
				text: `${who(e.player)} gained ${e.count} ${RESOURCE_LABELS[e.resource]} (nomad)`,
				player: e.player,
			}
		case 'game_complete': {
			// Two historical shapes carry the winner under different keys.
			const winner = 'winner' in e ? e.winner : e.winner_index
			return { text: `${who(winner)} won the game`, player: winner }
		}
		// Ephemeral negotiation + per-turn bookkeeping is intentionally omitted
		// to keep the log focused on committed, state-changing actions.
		case 'turn_ended':
		case 'trade_proposed':
		case 'trade_canceled':
		case 'trade_rejected':
			return null
		default:
			return null
	}
}

function nameFor(idx: number, ctx: LogContext): string {
	if (idx === ctx.meIdx) return 'You'
	const uid = ctx.playerOrder[idx]
	return ctx.profilesById[uid]?.username ?? 'Player'
}

const styles = StyleSheet.create({
	collapsed: {
		position: 'absolute',
		top: spacing.sm + 32 + spacing.xs,
		right: spacing.sm,
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: 4,
	},
	panel: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		width: 244,
		maxHeight: 320,
		backgroundColor: colors.card,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		paddingVertical: spacing.xs,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: 5,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: spacing.sm,
		paddingBottom: spacing.xs,
		borderBottomWidth: 1,
		borderBottomColor: colors.borderLight,
	},
	title: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.text,
	},
	closeBtn: {
		width: 28,
		height: 28,
		alignItems: 'center',
		justifyContent: 'center',
	},
	scroll: {
		flexGrow: 0,
	},
	scrollBody: {
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.xs,
		gap: spacing.xs,
	},
	empty: {
		paddingHorizontal: spacing.sm,
		paddingTop: spacing.sm,
		paddingBottom: spacing.xs,
		fontSize: font.sm,
		color: colors.textMuted,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	dot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		borderWidth: 1,
		borderColor: colors.border,
	},
	rowText: {
		flex: 1,
		fontSize: font.sm,
		color: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
})
