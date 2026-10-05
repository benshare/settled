import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, font, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { Button } from '../modules/Button'
import { AVARICE_MIN_DISCARD } from './curses'
import { handSize } from './robber'
import { CardFan, type CardFanEntry, type CardFanSize } from './ResourceHand'
import type { ResourceHand } from './types'

const EMPTY: ResourceHand = {
	brick: 0,
	wood: 0,
	sheep: 0,
	wheat: 0,
	ore: 0,
}

// The bottom-zone composer shown in place of the viewer's hand while they owe
// a discard. Cards are chosen by tapping the hand itself — the same gesture as
// the trade composer — rather than through steppers in a separate bar: the
// hand below is the fan the player already reads their cards from, and the
// pile above it is what they're about to throw away. Confirm is enabled only
// when the pile's total equals `required`.
export function DiscardPanel({
	hand,
	required,
	submitting,
	isShepherd,
	onSubmit,
}: {
	hand: ResourceHand
	required: number
	submitting: boolean
	// Shepherd's "sheep don't count toward your hand limit" — show a hint
	// so the player understands why their effective hand is smaller.
	isShepherd?: boolean
	onSubmit: (selection: ResourceHand) => void
}) {
	const [sel, setSel] = useState<ResourceHand>(EMPTY)
	const total = handSize(sel)
	const ready = total === required && !submitting
	const atCap = total >= required

	function add(r: Resource) {
		if (atCap || sel[r] >= hand[r]) return
		setSel({ ...sel, [r]: sel[r] + 1 })
	}
	function take(r: Resource) {
		if (sel[r] <= 0) return
		setSel({ ...sel, [r]: sel[r] - 1 })
	}

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.title}>Discard</Text>
				<Text style={styles.counter}>
					{total} / {required}
				</Text>
			</View>
			{isShepherd && (
				<Text style={styles.hint}>
					Shepherd: sheep don't count toward your hand limit.
				</Text>
			)}

			<DiscardComposer
				hand={hand}
				selection={sel}
				required={required}
				onAdd={add}
				onTake={take}
			/>

			<Button
				onPress={() => onSubmit(sel)}
				disabled={!ready}
				loading={submitting}
			>
				Confirm discard
			</Button>
		</View>
	)
}

// The avarice curse's voluntary discard: the same composer as a 7, but the
// player opened it themselves, so it can be cancelled and takes any count
// from the minimum up to the whole hand.
export function VoluntaryDiscardPanel({
	hand,
	submitting,
	onSubmit,
	onCancel,
}: {
	hand: ResourceHand
	submitting: boolean
	onSubmit: (selection: ResourceHand) => void
	onCancel: () => void
}) {
	const [sel, setSel] = useState<ResourceHand>(EMPTY)
	const total = handSize(sel)
	const ready = total >= AVARICE_MIN_DISCARD && !submitting

	function add(r: Resource) {
		if (sel[r] >= hand[r]) return
		setSel({ ...sel, [r]: sel[r] + 1 })
	}
	function take(r: Resource) {
		if (sel[r] <= 0) return
		setSel({ ...sel, [r]: sel[r] - 1 })
	}

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.title}>Discard</Text>
				<Pressable
					onPress={onCancel}
					style={({ pressed }) => [
						styles.linkBtn,
						pressed && styles.pressed,
					]}
				>
					<Ionicons name="close" size={14} color={colors.text} />
					<Text style={styles.linkBtnLabel}>Cancel</Text>
				</Pressable>
			</View>
			<Text style={styles.hint}>
				Curse of Avarice: discard {AVARICE_MIN_DISCARD} or more cards at
				any time.
			</Text>

			<DiscardComposer
				hand={hand}
				selection={sel}
				required={handSize(hand)}
				onAdd={add}
				onTake={take}
			/>

			<Button
				onPress={() => onSubmit(sel)}
				disabled={!ready}
				loading={submitting}
			>
				{total < AVARICE_MIN_DISCARD
					? `Pick at least ${AVARICE_MIN_DISCARD}`
					: `Discard ${total}`}
			</Button>
		</View>
	)
}

// The gesture itself, without the framing: the pile of cards being given up
// above, the hand they came from below, a tap moving one either way. Shared so
// anything that asks for a discard asks for it the same way the 7 does — the
// magician's window is the other caller.
export function DiscardComposer({
	hand,
	selection,
	required,
	handFanSize = 'full',
	pileEmptyLabel = 'Tap cards below to discard them',
	onAdd,
	onTake,
}: {
	hand: ResourceHand
	selection: ResourceHand
	required: number
	handFanSize?: CardFanSize
	pileEmptyLabel?: string
	onAdd: (r: Resource) => void
	onTake: (r: Resource) => void
}) {
	const atCap = handSize(selection) >= required
	const pile: CardFanEntry[] = RESOURCES.filter((r) => selection[r] > 0).map(
		(r) => ({ resource: r, count: selection[r] })
	)
	const remaining: CardFanEntry[] = RESOURCES.filter(
		(r) => hand[r] - selection[r] > 0
	).map((r) => ({ resource: r, count: hand[r] - selection[r] }))

	return (
		<>
			<CardFan
				entries={pile}
				size="compact"
				onCardPress={onTake}
				emptyLabel={pileEmptyLabel}
			/>
			<View style={styles.divider} />
			{/* At the cap every hand card is inert, so the fan reads as locked
			    rather than silently ignoring taps. */}
			<CardFan
				entries={remaining}
				size={handFanSize}
				onCardPress={onAdd}
				disabledResources={atCap ? RESOURCES : undefined}
				emptyLabel="Your hand is empty"
			/>
		</>
	)
}

const styles = StyleSheet.create({
	wrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.md,
		gap: spacing.xs,
	},
	headerRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	title: {
		fontSize: font.sm,
		fontWeight: '700',
		color: colors.textSecondary,
		letterSpacing: 0.3,
		textTransform: 'uppercase',
	},
	counter: {
		fontSize: font.base,
		fontWeight: '700',
		color: colors.text,
	},
	hint: {
		fontSize: font.xs,
		color: colors.textSecondary,
		fontStyle: 'italic',
	},
	linkBtn: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 2,
		paddingHorizontal: spacing.xs,
		paddingVertical: 4,
	},
	linkBtnLabel: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
	divider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.border,
	},
})
