import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors, font, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import { Button } from '../modules/Button'
import { handSize } from './robber'
import { CardFan, type CardFanEntry } from './ResourceHand'
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

	const pile: CardFanEntry[] = RESOURCES.filter((r) => sel[r] > 0).map(
		(r) => ({
			resource: r,
			count: sel[r],
		})
	)
	const remaining: CardFanEntry[] = RESOURCES.filter(
		(r) => hand[r] - sel[r] > 0
	).map((r) => ({ resource: r, count: hand[r] - sel[r] }))

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

			<CardFan
				entries={pile}
				size="compact"
				onCardPress={take}
				emptyLabel="Tap cards below to discard them"
			/>
			<View style={styles.divider} />
			{/* At the cap every hand card is inert, so the fan reads as locked
			    rather than silently ignoring taps. */}
			<CardFan
				entries={remaining}
				onCardPress={add}
				disabledResources={atCap ? RESOURCES : undefined}
				emptyLabel="Your hand is empty"
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
	divider: {
		height: StyleSheet.hairlineWidth,
		backgroundColor: colors.border,
	},
})
