// The scout's dev-card buy, composed by tapping the hand: the cards to pay
// with go on the pile, and Buy enables once the pile is exactly one of the
// scout's payment profiles (`scoutSwapForSelection`). Replaces the hand like
// the discard composer, which it reuses. A hand card is tappable only while
// adding it still leads to an affordable profile, so the pile can't drift into
// a combination that will never be buyable.

import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Button } from '../modules/Button'
import { colors, font, spacing } from '../theme'
import { RESOURCES, type Resource } from './board'
import {
	affordableScoutSwaps,
	scoutDevCardCost,
	scoutSwapForSelection,
	type ScoutSwap,
} from './bonus'
import { DiscardComposer } from './DiscardPanel'
import type { ResourceHand } from './types'

const EMPTY: ResourceHand = { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }
const DEV_CARD_SIZE = 3

export function ScoutBuyPanel({
	hand,
	submitting,
	onSubmit,
	onCancel,
}: {
	hand: ResourceHand
	submitting: boolean
	onSubmit: (swap: ScoutSwap | null) => void
	onCancel: () => void
}) {
	const [sel, setSel] = useState<ResourceHand>(EMPTY)
	const costs = affordableScoutSwaps(hand).map((s) =>
		scoutDevCardCost(s ?? undefined)
	)
	const canAdd = (r: Resource) =>
		costs.some(
			(c) => c[r] >= sel[r] + 1 && RESOURCES.every((x) => c[x] >= sel[x])
		)
	const locked = RESOURCES.filter((r) => !canAdd(r))
	const swap = scoutSwapForSelection(sel)
	const ready = swap !== undefined && !submitting

	function add(r: Resource) {
		if (!canAdd(r) || sel[r] >= hand[r]) return
		setSel({ ...sel, [r]: sel[r] + 1 })
	}
	function take(r: Resource) {
		if (sel[r] <= 0) return
		setSel({ ...sel, [r]: sel[r] - 1 })
	}

	return (
		<View style={styles.wrap}>
			<View style={styles.headerRow}>
				<Text style={styles.title}>Buy dev card</Text>
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
				Scout: pay 1 Ore plus any two of Wheat and Sheep.
			</Text>

			<DiscardComposer
				hand={hand}
				selection={sel}
				required={DEV_CARD_SIZE}
				pileEmptyLabel="Tap cards below to pay with them"
				lockedResources={locked}
				onAdd={add}
				onTake={take}
			/>

			<Button
				onPress={() => swap !== undefined && onSubmit(swap)}
				disabled={!ready}
				loading={submitting}
			>
				Buy dev card
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
})
