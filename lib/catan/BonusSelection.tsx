// Bonus-selection pane. Rendered as a floating overlay on top of the board
// while gameState.phase.kind === 'select_bonus', so the board seed stays
// visible while the player chooses. Collapsible via `CollapsibleSheet`, the
// same top-anchored behavior the board-dependent pickers get from
// `MinimizableModal` — in-tree rather than in a `Modal` so the pane stays
// inside the board area.
//
// After submit, the local player shows a waiting state until every other
// player has also chosen. When the last player commits, the edge function
// flips the phase to initial_placement; realtime drops this screen out of
// view without any client-side cleanup needed.

import { Button } from '@/lib/modules/Button'
import { CollapsibleSheet } from '@/lib/modules/CollapsibleSheet'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import {
	bonusById,
	bonusDescriptionFor,
	curseById,
	curseDescriptionFor,
	type BonusId,
	type CurseId,
} from './bonuses'
import {
	gameSizeFor,
	handChosenCurse,
	handCurses,
	type SelectBonusHand,
} from './types'

export type BonusSelectionProps = {
	hand: SelectBonusHand | undefined
	waitingOn: string[] // usernames of players still picking
	submitting: boolean
	collapsed: boolean
	onToggleCollapsed: () => void
	onPick: (bonus: BonusId, curse: CurseId) => void
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	phaseHands: Record<number, SelectBonusHand>
	// Each seat's color, in seat order. Resolved once in `gameContext`
	// (`useGame().seatColors`) so this can't disagree with the board.
	seatColors: readonly string[]
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
	seatColors,
}: BonusSelectionProps) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const size = gameSizeFor(playerOrder.length)

	// Track the player's in-flight picks separately from `hand.chosen` /
	// `hand.chosenCurse` so the UI can show a selected state before the
	// realtime update lands.
	const [pick, setPick] = useState<number | null>(null)
	const [cursePick, setCursePick] = useState<number | null>(null)

	const committed = hand ? hand.chosen !== null : false
	const curses = hand ? handCurses(hand) : []
	// A single card of either kind is decided at deal time — nothing to pick,
	// so it's preselected and inert.
	const bonusFixed = hand ? hand.offered.length === 1 : false
	const curseFixed = curses.length === 1
	const bonusIdx = bonusFixed ? 0 : pick
	const curseIdx = curseFixed ? 0 : cursePick

	async function onConfirm() {
		if (!hand || bonusIdx === null || curseIdx === null) return
		onPick(hand.offered[bonusIdx], curses[curseIdx])
	}

	const headerLabel = hand
		? committed
			? 'Cards locked in'
			: curseFixed
				? 'Pick your bonus'
				: 'Pick your cards'
		: 'Bonus selection'

	return (
		<CollapsibleSheet
			fill
			title={headerLabel}
			collapsed={collapsed}
			onToggleCollapsed={onToggleCollapsed}
		>
			<ScrollView
				style={styles.scroll}
				contentContainerStyle={styles.body}
				showsVerticalScrollIndicator={false}
			>
				{hand ? (
					<>
						<Text style={styles.subheading}>
							{selectionCopy(hand.offered.length, curses.length)}
						</Text>
						<CardRow
							kind="bonus"
							cards={hand.offered.map((id) => ({
								id,
								title: bonusById(id)!.title,
								icon: bonusById(id)!.icon,
								description: bonusDescriptionFor(id, size),
							}))}
							pickedIdx={
								committed
									? hand.offered.indexOf(hand.chosen!)
									: bonusIdx
							}
							committed={committed}
							fixed={bonusFixed}
							disabled={submitting}
							onPick={setPick}
							styles={styles}
							colors={colors}
						/>

						<CardRow
							kind="curse"
							cards={curses.map((id) => ({
								id,
								title: curseById(id)!.title,
								icon: curseById(id)!.icon,
								description: curseDescriptionFor(id, size),
							}))}
							pickedIdx={
								committed
									? curses.indexOf(handChosenCurse(hand)!)
									: curseIdx
							}
							committed={committed}
							fixed={curseFixed}
							disabled={submitting}
							onPick={setCursePick}
							styles={styles}
							colors={colors}
						/>

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
										bonusIdx === null ||
										curseIdx === null ||
										submitting
									}
									loading={submitting}
								>
									{bonusIdx === null
										? 'Pick a bonus'
										: curseIdx === null
											? 'Pick a curse'
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
					seatColors={seatColors}
					styles={styles}
					colors={colors}
				/>
			</ScrollView>
		</CollapsibleSheet>
	)
}

type PickerCard = {
	id: string
	title: string
	icon: React.ComponentProps<typeof Ionicons>['name']
	description: string
}

// One kind's dealt cards. Two or fewer share the width; three would leave the
// text unreadable at that size, so the row scrolls sideways instead. A `fixed`
// row (one card, dealt rather than chosen) renders the same card inert.
function CardRow({
	kind,
	cards,
	pickedIdx,
	committed,
	fixed,
	disabled,
	onPick,
	styles,
	colors,
}: {
	kind: 'bonus' | 'curse'
	cards: PickerCard[]
	pickedIdx: number | null
	committed: boolean
	fixed: boolean
	disabled: boolean
	onPick: (idx: number) => void
	styles: ReturnType<typeof makeStyles>
	colors: ColorScheme
}) {
	const scrolls = cards.length > 2
	const accent = kind === 'bonus' ? colors.brand : colors.error

	const items = cards.map((card, i) => {
		// A fixed card was dealt, not chosen — it reads as picked from the
		// start, and can never be the discarded one.
		const isPicked = fixed || pickedIdx === i
		const isDiscarded = committed && !isPicked
		return (
			<Pressable
				key={`${card.id}-${i}`}
				onPress={() => onPick(i)}
				disabled={fixed || committed || disabled}
				style={({ pressed }) => [
					styles.card,
					scrolls ? styles.cardFixedWidth : styles.cardFlex,
					isPicked &&
						(kind === 'curse'
							? styles.curseCardPicked
							: styles.cardPicked),
					isDiscarded && styles.cardFaded,
					pressed && !fixed && !committed && styles.pressed,
				]}
			>
				<View style={styles.cardIcon}>
					<Ionicons
						name={card.icon}
						size={28}
						color={isDiscarded ? colors.textMuted : accent}
					/>
				</View>
				<Text style={styles.cardTitle}>{card.title}</Text>
				<Text style={styles.cardDescription}>{card.description}</Text>
			</Pressable>
		)
	})

	if (!scrolls) return <View style={styles.cardRow}>{items}</View>
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			contentContainerStyle={styles.cardScroll}
		>
			{items}
		</ScrollView>
	)
}

// What the player is being asked to do, which depends on how many of each card
// they were dealt. A count of 1 is dealt, not chosen.
function selectionCopy(bonusCount: number, curseCount: number): string {
	if (curseCount === 1) {
		return 'Keep one bonus card — the rest are discarded. Your curse card stays either way.'
	}
	if (bonusCount === 1) {
		return 'Keep one curse card — the rest are discarded. Your bonus card is already yours.'
	}
	return 'Keep one bonus card and one curse card. The rest are discarded.'
}

function PlayOrderFooter({
	playerOrder,
	meIdx,
	profilesById,
	phaseHands,
	seatColors,
	styles,
	colors,
}: {
	playerOrder: string[]
	meIdx: number
	profilesById: Record<string, Profile>
	phaseHands: Record<number, SelectBonusHand>
	// Each seat's color, in seat order. Resolved once in `gameContext`
	// (`useGame().seatColors`) so this can't disagree with the board.
	seatColors: readonly string[]
	styles: ReturnType<typeof makeStyles>
	colors: ColorScheme
}) {
	return (
		<View style={styles.footer}>
			<Text style={styles.footerLabel}>Order of play</Text>
			<View style={styles.footerChips}>
				{playerOrder.map((uid, i) => {
					const profile = profilesById[uid]
					const name =
						i === meIdx ? 'You' : (profile?.username ?? 'Player')
					const color = seatColors[i] ?? colors.textMuted
					const playerHand = phaseHands[i]
					const picked = playerHand?.chosen != null
					return (
						<View key={uid} style={styles.chip}>
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
						</View>
					)
				})}
			</View>
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
		cardRow: {
			flexDirection: 'row',
			gap: spacing.sm,
		},
		cardScroll: {
			flexDirection: 'row',
			gap: spacing.sm,
			paddingRight: spacing.sm,
		},
		cardFlex: {
			flex: 1,
		},
		cardFixedWidth: {
			width: 150,
		},
		card: {
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
		curseCardPicked: {
			borderColor: colors.error,
			backgroundColor: colors.cardAlt,
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
	})
}
