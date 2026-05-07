// Bonus-selection pane. Rendered as a floating overlay on top of the board
// while gameState.phase.kind === 'select_bonus' so the player can preview
// the board (port placements, terrain, neighbours' positions… well, none of
// those are placed yet, but the seed is visible) while they choose.
//
// The pane toggles between an expanded body (cards + confirm + play-order
// footer) and a collapsed header bar via the chevron. The footer shows each
// player in turn order; tapping a chip reveals the bonuses + curse that
// player was dealt — useful for inferring opponents' likely picks before
// committing.
//
// After submit, the local player shows a waiting state until every other
// player has also chosen. When the last player commits, the edge function
// flips the phase to initial_placement; realtime drops this screen out of
// view without any client-side cleanup needed.

import { Button } from '@/lib/modules/Button'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import type { Profile } from '../stores/useProfileStore'
import { bonusById, curseById, type BonusId } from './bonuses'
import { playerColors } from './palette'
import type { SelectBonusHand } from './types'

const ANIM_DURATION = 240

export type BonusSelectionProps = {
	hand: SelectBonusHand | undefined
	waitingOn: string[] // usernames of players still picking
	submitting: boolean
	collapsed: boolean
	onToggleCollapsed: () => void
	onPick: (bonus: BonusId) => void
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	phaseHands: Record<number, SelectBonusHand>
}

export function BonusSelection({
	hand,
	waitingOn,
	submitting,
	collapsed,
	onToggleCollapsed,
	onPick,
	playerOrder,
	meIdx,
	profilesById,
	phaseHands,
}: BonusSelectionProps) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	// Track the player's in-flight pick separately from `hand.chosen` so the
	// UI can show a selected state before the realtime update lands.
	const [pick, setPick] = useState<0 | 1 | null>(null)
	const [revealedIdx, setRevealedIdx] = useState<number | null>(null)

	const committed = hand ? hand.chosen !== null : false

	const outerHeightSV = useSharedValue(0)
	const headerHeightSV = useSharedValue(0)
	const progress = useSharedValue(collapsed ? 0 : 1)

	useEffect(() => {
		progress.value = withTiming(collapsed ? 0 : 1, {
			duration: ANIM_DURATION,
		})
	}, [collapsed, progress])

	const wrapAnimStyle = useAnimatedStyle(() => {
		if (outerHeightSV.value === 0 || headerHeightSV.value === 0) return {}
		const min = headerHeightSV.value
		const max = outerHeightSV.value
		return { height: min + (max - min) * progress.value }
	})

	const bodyAnimStyle = useAnimatedStyle(() => ({
		opacity: progress.value,
	}))

	const chevronAnimStyle = useAnimatedStyle(() => ({
		transform: [{ rotate: `${progress.value * 180}deg` }],
	}))

	async function onConfirm() {
		if (pick === null || !hand) return
		onPick(hand.offered[pick])
	}

	const headerLabel = hand
		? committed
			? 'Bonus locked in'
			: 'Pick your bonus'
		: 'Bonus selection'

	return (
		<View
			style={styles.outer}
			onLayout={(e) => {
				outerHeightSV.value = e.nativeEvent.layout.height
			}}
		>
			<Animated.View style={[styles.wrap, wrapAnimStyle]}>
				<Pressable
					onPress={onToggleCollapsed}
					onLayout={(e) => {
						headerHeightSV.value = e.nativeEvent.layout.height
					}}
					style={({ pressed }) => [
						styles.header,
						pressed && styles.pressed,
					]}
				>
					<Animated.View style={chevronAnimStyle}>
						<Ionicons
							name="chevron-up"
							size={18}
							color={colors.textSecondary}
						/>
					</Animated.View>
					<Text style={styles.headerTitle}>{headerLabel}</Text>
				</Pressable>

				<Animated.View
					style={[styles.bodyWrap, bodyAnimStyle]}
					pointerEvents={collapsed ? 'none' : 'auto'}
				>
					<ScrollView
						style={styles.scroll}
						contentContainerStyle={styles.body}
						showsVerticalScrollIndicator={false}
					>
						{hand ? (
							<>
								<Text style={styles.subheading}>
									Keep one bonus card. The other will be
									discarded. Your curse card stays either way.
								</Text>
								<View style={styles.bonusRow}>
									{hand.offered.map((bonusId, i) => {
										const b = bonusById(bonusId)!
										const isPicked = committed
											? hand.offered[i] === hand.chosen
											: pick === i
										const isDiscarded =
											committed && !isPicked
										return (
											<Pressable
												key={i}
												onPress={() =>
													!committed &&
													setPick(i as 0 | 1)
												}
												disabled={
													committed || submitting
												}
												style={({ pressed }) => [
													styles.card,
													isPicked &&
														styles.cardPicked,
													isDiscarded &&
														styles.cardFaded,
													pressed &&
														!committed &&
														styles.pressed,
												]}
											>
												<View style={styles.cardIcon}>
													<Ionicons
														name={b.icon}
														size={28}
														color={
															isDiscarded
																? colors.textMuted
																: colors.brand
														}
													/>
												</View>
												<Text style={styles.cardTitle}>
													{b.title}
												</Text>
												<Text
													style={
														styles.cardDescription
													}
												>
													{b.description}
												</Text>
											</Pressable>
										)
									})}
								</View>

								<View style={[styles.card, styles.curseCard]}>
									<View style={styles.cardIcon}>
										<Ionicons
											name={curseById(hand.curse)!.icon}
											size={28}
											color={colors.error}
										/>
									</View>
									<Text style={styles.cardTitle}>
										{curseById(hand.curse)!.title}
									</Text>
									<Text style={styles.cardDescription}>
										{curseById(hand.curse)!.description}
									</Text>
								</View>

								{committed ? (
									<View style={styles.waitingRow}>
										<Text style={styles.waitingText}>
											{waitingOn.length === 0
												? 'Everyone is ready — starting placement…'
												: `Waiting for ${formatList(waitingOn)} to pick`}
										</Text>
									</View>
								) : (
									<View style={styles.actionRow}>
										<Button
											onPress={onConfirm}
											disabled={
												pick === null || submitting
											}
											loading={submitting}
										>
											{pick === null
												? 'Pick a bonus'
												: 'Confirm'}
										</Button>
									</View>
								)}
							</>
						) : (
							<Text style={styles.subheading}>
								Players are choosing their bonus cards.
							</Text>
						)}

						<PlayOrderFooter
							playerOrder={playerOrder}
							meIdx={meIdx}
							profilesById={profilesById}
							phaseHands={phaseHands}
							revealedIdx={revealedIdx}
							onToggleReveal={(i) =>
								setRevealedIdx((prev) =>
									prev === i ? null : i
								)
							}
							styles={styles}
							colors={colors}
						/>
					</ScrollView>
				</Animated.View>
			</Animated.View>
		</View>
	)
}

function PlayOrderFooter({
	playerOrder,
	meIdx,
	profilesById,
	phaseHands,
	revealedIdx,
	onToggleReveal,
	styles,
	colors,
}: {
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	phaseHands: Record<number, SelectBonusHand>
	revealedIdx: number | null
	onToggleReveal: (idx: number) => void
	styles: ReturnType<typeof makeStyles>
	colors: ColorScheme
}) {
	const revealedHand =
		revealedIdx !== null ? phaseHands[revealedIdx] : undefined
	return (
		<View style={styles.footer}>
			<Text style={styles.footerLabel}>Order of play</Text>
			<View style={styles.footerChips}>
				{playerOrder.map((uid, i) => {
					const profile = profilesById[uid]
					const name =
						i === meIdx ? 'You' : (profile?.username ?? 'Player')
					const color = playerColors[i] ?? playerColors[0]
					const playerHand = phaseHands[i]
					const picked = playerHand?.chosen != null
					const active = revealedIdx === i
					return (
						<Pressable
							key={uid}
							onPress={() => onToggleReveal(i)}
							style={({ pressed }) => [
								styles.chip,
								active && styles.chipActive,
								pressed && styles.pressed,
							]}
						>
							<View
								style={[
									styles.chipDot,
									{ backgroundColor: color },
								]}
							/>
							<Text style={styles.chipName} numberOfLines={1}>
								{i + 1}. {name}
							</Text>
							<Ionicons
								name={
									picked
										? 'checkmark-circle'
										: 'ellipsis-horizontal-circle-outline'
								}
								size={14}
								color={
									picked ? colors.success : colors.textMuted
								}
							/>
						</Pressable>
					)
				})}
			</View>

			{revealedHand && revealedIdx !== null && (
				<View style={styles.revealCard}>
					<Text style={styles.revealHeader}>
						{revealedIdx === meIdx
							? 'Your cards'
							: `${profilesById[playerOrder[revealedIdx]]?.username ?? 'Player'} was dealt`}
					</Text>
					<View style={styles.revealList}>
						{revealedHand.offered.map((bonusId, j) => {
							const b = bonusById(bonusId)!
							const isChosen = revealedHand.chosen === bonusId
							return (
								<View key={`b-${j}`} style={styles.revealRow}>
									<Ionicons
										name={b.icon}
										size={16}
										color={colors.brand}
									/>
									<View style={styles.revealText}>
										<Text style={styles.revealTitle}>
											{b.title}
											{isChosen ? ' (kept)' : ''}
										</Text>
										<Text style={styles.revealDescription}>
											{b.description}
										</Text>
									</View>
								</View>
							)
						})}
						{(() => {
							const c = curseById(revealedHand.curse)!
							return (
								<View style={styles.revealRow}>
									<Ionicons
										name={c.icon}
										size={16}
										color={colors.error}
									/>
									<View style={styles.revealText}>
										<Text style={styles.revealTitle}>
											{c.title}
										</Text>
										<Text style={styles.revealDescription}>
											{c.description}
										</Text>
									</View>
								</View>
							)
						})()}
					</View>
				</View>
			)}
		</View>
	)
}

function formatList(names: string[]): string {
	if (names.length === 0) return ''
	if (names.length === 1) return names[0]
	if (names.length === 2) return `${names[0]} and ${names[1]}`
	return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		outer: {
			flex: 1,
			justifyContent: 'flex-end',
		},
		wrap: {
			backgroundColor: colors.card,
			borderWidth: 1,
			borderColor: colors.border,
			borderRadius: radius.md,
			overflow: 'hidden',
			shadowColor: '#000',
			shadowOffset: { width: 0, height: 4 },
			shadowOpacity: 0.18,
			shadowRadius: 12,
			elevation: 8,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingVertical: spacing.sm,
			backgroundColor: colors.cardAlt,
			borderBottomWidth: 1,
			borderBottomColor: colors.border,
		},
		headerTitle: {
			flex: 1,
			fontSize: font.md,
			fontWeight: '700',
			color: colors.text,
		},
		bodyWrap: {
			flex: 1,
		},
		scroll: {
			flex: 1,
		},
		body: {
			padding: spacing.md,
			gap: spacing.sm,
		},
		subheading: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		bonusRow: {
			flexDirection: 'row',
			gap: spacing.sm,
		},
		card: {
			flex: 1,
			padding: spacing.sm,
			borderRadius: radius.md,
			borderWidth: 2,
			borderColor: colors.border,
			backgroundColor: colors.card,
			gap: spacing.xs,
			minHeight: 140,
		},
		cardPicked: {
			borderColor: colors.brand,
			backgroundColor: colors.brandDim,
		},
		cardFaded: {
			opacity: 0.45,
		},
		pressed: {
			opacity: 0.85,
		},
		cardIcon: {
			width: 40,
			height: 40,
			borderRadius: radius.full,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.background,
			borderWidth: 1,
			borderColor: colors.border,
		},
		cardTitle: {
			fontSize: font.base,
			fontWeight: '700',
			color: colors.text,
		},
		cardDescription: {
			fontSize: font.sm,
			color: colors.textSecondary,
		},
		curseCard: {
			flexGrow: 0,
			borderColor: colors.error,
			backgroundColor: colors.card,
		},
		actionRow: {
			marginTop: spacing.xs,
		},
		waitingRow: {
			alignItems: 'center',
			paddingVertical: spacing.sm,
		},
		waitingText: {
			fontSize: font.sm,
			color: colors.textMuted,
			textAlign: 'center',
		},
		footer: {
			marginTop: spacing.sm,
			paddingTop: spacing.sm,
			borderTopWidth: 1,
			borderTopColor: colors.border,
			gap: spacing.xs,
		},
		footerLabel: {
			fontSize: font.xs,
			fontWeight: '700',
			color: colors.textMuted,
			textTransform: 'uppercase',
			letterSpacing: 0.5,
		},
		footerChips: {
			flexDirection: 'row',
			flexWrap: 'wrap',
			gap: spacing.xs,
		},
		chip: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: 6,
			paddingHorizontal: spacing.sm,
			paddingVertical: 4,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.background,
		},
		chipActive: {
			borderColor: colors.brand,
			backgroundColor: colors.brandDim,
		},
		chipDot: {
			width: 8,
			height: 8,
			borderRadius: radius.full,
		},
		chipName: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.text,
		},
		revealCard: {
			marginTop: spacing.xs,
			padding: spacing.sm,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.background,
			gap: spacing.xs,
		},
		revealHeader: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.text,
		},
		revealList: {
			gap: spacing.xs,
		},
		revealRow: {
			flexDirection: 'row',
			alignItems: 'flex-start',
			gap: spacing.xs,
		},
		revealText: {
			flex: 1,
		},
		revealTitle: {
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.text,
		},
		revealDescription: {
			fontSize: font.xs,
			color: colors.textSecondary,
		},
	})
}
