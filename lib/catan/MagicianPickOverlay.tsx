// Magician post-roll window. After the magician's own roll resolves they may
// discard N+1 cards to also collect production as if a number N away from the
// actual result had rolled — or keep the roll as it came. Only the magician
// gains from it.
//
// The roll's own cards are not in hand yet (`pendingGain` on the phase): they
// land when this window is answered, either way. That is what makes the arc
// honest — every card in it is production the player does not have yet — and
// what makes the discard a real choice, since it can only be paid out of the
// hand they rolled with. See `.claude/specs/magician-window-ui.md`.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
	type LayoutChangeEvent,
} from 'react-native'
import { MinimizableModal } from '../modules/MinimizableModal'
import { Button } from '../modules/Button'
import { ColorScheme, font, radius, spacing } from '../theme'
import { useTheme } from '../ThemeContext'
import { RESOURCES, type Resource } from './board'
import { resourceColor } from './palette'
import { magicDiscardCount, magicTargetRange } from './bonus'
import { DiscardComposer } from './DiscardPanel'
import { handSize } from './robber'
import { emptyHand } from './trade'
import type { GameSize, ResourceHand } from './types'

// Fan geometry for the roll arc — the hand's `CardFan` proportions, shrunk and
// splayed a little wider, since these cards carry a number and a payout rather
// than one word.
const ARC = { w: 62, h: 104, overlap: 10, step: 4, lift: 3 } as const

export function MagicianPickOverlay({
	hand,
	actualTotal,
	// What the rolled number pays this player — withheld from `hand` until
	// this window closes, so the arc's center card is a promise like the rest.
	rolledGain,
	// Per candidate number, what it would pay this player. Computed against the
	// live board (robber included), so it matches what the cast will grant.
	gainsByTotal,
	// Table size sets the price of a cast — N + 1 cards, or N at a 5-6
	// player table.
	size,
	submitting,
	onSkip,
	onCast,
}: {
	hand: ResourceHand
	actualTotal: number
	rolledGain: ResourceHand
	gainsByTotal: Record<number, ResourceHand>
	size: GameSize
	submitting: boolean
	onSkip: () => void
	onCast: (target: number, discard: ResourceHand) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [target, setTarget] = useState<number | null>(null)
	const [discard, setDiscard] = useState<ResourceHand>(emptyHand)

	const totals = useMemo(() => {
		const { lo, hi } = magicTargetRange(actualTotal, handSize(hand), size)
		const out: number[] = []
		for (let t = lo; t <= hi; t++) out.push(t)
		return out
	}, [actualTotal, hand, size])

	const cost =
		target === null ? 0 : magicDiscardCount(actualTotal, target, size)
	const discardSize = handSize(discard)
	const ready = target !== null && discardSize === cost && !submitting

	// Picking a different number reprices the discard, so the pile starts over
	// rather than silently carrying cards into a cost it no longer matches.
	function pickTarget(t: number) {
		setTarget(t === actualTotal ? null : t)
		setDiscard(emptyHand())
	}

	function add(r: Resource) {
		if (discardSize >= cost || discard[r] >= hand[r]) return
		setDiscard({ ...discard, [r]: discard[r] + 1 })
	}
	function take(r: Resource) {
		if (discard[r] <= 0) return
		setDiscard({ ...discard, [r]: discard[r] - 1 })
	}

	return (
		<MinimizableModal
			title="Activate magician?"
			onDismiss={onSkip}
			contentStyle={styles.sheet}
		>
			<Text style={styles.subtitle}>
				Discard 1 card plus 1 per step from {actualTotal} to also
				collect that number — only you gain. Your roll&apos;s own cards
				land either way.
			</Text>

			<RollArc
				totals={totals}
				actualTotal={actualTotal}
				target={target}
				gainFor={(t) =>
					t === actualTotal ? rolledGain : (gainsByTotal[t] ?? null)
				}
				costFor={(t) => magicDiscardCount(actualTotal, t, size)}
				onPick={pickTarget}
				styles={styles}
			/>

			{totals.length === 1 ? (
				<Text style={styles.hint}>
					Not enough cards in hand to conjure another number.
				</Text>
			) : target === null ? (
				<Text style={styles.hint}>
					Tap a number above to conjure its production too.
				</Text>
			) : (
				<View style={styles.headerRow}>
					<Text style={styles.section}>Discard for {target}</Text>
					<Text style={styles.counter}>
						{discardSize} / {cost}
					</Text>
				</View>
			)}

			<DiscardComposer
				hand={hand}
				selection={discard}
				required={cost}
				handFanSize="compact"
				pileEmptyLabel={
					target === null
						? undefined
						: 'Tap cards below to pay for it'
				}
				onAdd={add}
				onTake={take}
			/>

			<View style={styles.actions}>
				<View style={styles.action}>
					<Button
						variant="secondary"
						onPress={onSkip}
						disabled={submitting}
					>
						Keep roll
					</Button>
				</View>
				<View style={styles.action}>
					<Button
						onPress={() =>
							target !== null && onCast(target, discard)
						}
						disabled={!ready}
						loading={submitting}
					>
						Confirm
					</Button>
				</View>
			</View>
		</MinimizableModal>
	)
}

// The arc: one card per number in reach, in order, fanned around the number
// that actually came up. Eleven cards never fit a phone, so it scrolls — and
// opens scrolled to the rolled card, which is the arc's apex and the thing the
// player is comparing everything against.
function RollArc({
	totals,
	actualTotal,
	target,
	gainFor,
	costFor,
	onPick,
	styles,
}: {
	totals: number[]
	actualTotal: number
	target: number | null
	gainFor: (total: number) => ResourceHand | null
	costFor: (total: number) => number
	onPick: (total: number) => void
	styles: ReturnType<typeof makeStyles>
}) {
	const scrollRef = useRef<ScrollView>(null)
	const [viewport, setViewport] = useState(0)
	const center = totals.indexOf(actualTotal)
	const step = ARC.w - ARC.overlap
	const contentWidth = totals.length * step + ARC.overlap
	const centerX = spacing.sm + center * step + ARC.w / 2

	useEffect(() => {
		if (viewport <= 0) return
		scrollRef.current?.scrollTo({
			x: Math.max(
				0,
				Math.min(centerX - viewport / 2, contentWidth - viewport)
			),
			animated: false,
		})
	}, [viewport, centerX, contentWidth])

	return (
		<ScrollView
			ref={scrollRef}
			horizontal
			showsHorizontalScrollIndicator={false}
			onLayout={(e: LayoutChangeEvent) =>
				setViewport(e.nativeEvent.layout.width)
			}
			contentContainerStyle={[
				styles.arc,
				contentWidth < viewport && styles.arcCentered,
			]}
		>
			{totals.map((t, i) => {
				const offset = i - center
				return (
					<View
						key={t}
						style={{
							width: ARC.w,
							height: ARC.h,
							marginLeft: i === 0 ? 0 : -ARC.overlap,
							transform: [
								{ translateY: Math.abs(offset) * ARC.lift },
								{ rotate: `${offset * ARC.step}deg` },
							],
							// The rolled card and the picked one read as one
							// piece each, over their neighbours on both sides.
							zIndex:
								t === target
									? totals.length + 1
									: t === actualTotal
										? totals.length
										: i,
						}}
					>
						<RollCard
							total={t}
							gain={gainFor(t)}
							cost={costFor(t)}
							rolled={t === actualTotal}
							picked={t === target}
							onPress={() => onPick(t)}
							styles={styles}
						/>
					</View>
				)
			})}
		</ScrollView>
	)
}

function RollCard({
	total,
	gain,
	cost,
	rolled,
	picked,
	onPress,
	styles,
}: {
	total: number
	gain: ResourceHand | null
	cost: number
	rolled: boolean
	picked: boolean
	onPress: () => void
	styles: ReturnType<typeof makeStyles>
}) {
	const pips = RESOURCES.filter((r) => (gain?.[r] ?? 0) > 0)
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [
				styles.rollCard,
				rolled && styles.rollCardRolled,
				picked && styles.rollCardPicked,
				pressed && styles.pressed,
			]}
		>
			<Text style={styles.rollNumber}>{total}</Text>
			<View style={styles.pips}>
				{pips.length === 0 ? (
					<Text style={styles.pipsEmpty}>—</Text>
				) : (
					pips.map((r) => (
						<View
							key={r}
							style={[
								styles.pip,
								{ backgroundColor: resourceColor[r] },
							]}
						>
							<Text style={styles.pipCount}>{gain?.[r]}</Text>
						</View>
					))
				)}
			</View>
			<Text style={[styles.rollCost, rolled && styles.rollCostRolled]}>
				{rolled ? 'Rolled' : `−${cost}`}
			</Text>
		</Pressable>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		sheet: {
			maxWidth: 460,
		},
		subtitle: {
			fontSize: font.sm,
			color: colors.textSecondary,
			lineHeight: 20,
		},
		arc: {
			flexDirection: 'row',
			alignItems: 'flex-start',
			paddingHorizontal: spacing.sm,
			// Room for the outermost cards' lift and rotation, which reach
			// past the card box on both edges.
			paddingTop: spacing.xs,
			paddingBottom: spacing.md,
		},
		arcCentered: {
			flexGrow: 1,
			justifyContent: 'center',
		},
		rollCard: {
			flex: 1,
			paddingVertical: spacing.xs,
			paddingHorizontal: 4,
			borderRadius: radius.sm,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.background,
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		rollCardRolled: {
			borderWidth: 2,
			borderColor: colors.text,
			backgroundColor: colors.card,
		},
		rollCardPicked: {
			borderWidth: 2,
			borderColor: colors.brand,
			backgroundColor: colors.card,
		},
		rollNumber: {
			fontSize: font.md,
			fontWeight: '800',
			color: colors.text,
		},
		pips: {
			flex: 1,
			flexDirection: 'row',
			flexWrap: 'wrap',
			alignItems: 'center',
			justifyContent: 'center',
			gap: 2,
		},
		pip: {
			width: 15,
			height: 20,
			borderRadius: 3,
			borderWidth: 1,
			borderColor: '#2B2B2B',
			alignItems: 'center',
			justifyContent: 'center',
		},
		pipCount: {
			fontSize: 10,
			fontWeight: '800',
			color: '#1A1A1A',
		},
		pipsEmpty: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		rollCost: {
			fontSize: font.xs,
			fontWeight: '700',
			color: colors.textSecondary,
		},
		rollCostRolled: {
			color: colors.text,
		},
		headerRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		section: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.textSecondary,
			textTransform: 'uppercase',
			letterSpacing: 0.3,
		},
		counter: {
			fontSize: font.base,
			fontWeight: '700',
			color: colors.text,
		},
		hint: {
			fontSize: font.sm,
			color: colors.textSecondary,
			fontStyle: 'italic',
		},
		actions: {
			flexDirection: 'row',
			gap: spacing.sm,
		},
		action: {
			flex: 1,
		},
		pressed: {
			opacity: 0.85,
		},
	})
}
