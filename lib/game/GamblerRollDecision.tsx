// The gambler's keep-or-reroll decision, rendered in each layout's status
// surface (the HUD's `StatusBanner`, the classic `TopArea`) rather than in the
// bottom controls, so the roller sees what the roll pays next to the choice it
// informs. Only the roller ever sees it — everyone else keeps the ordinary
// "…is confirming the roll" status line.
//
// The preview is `distributeResources` for the roller's seat — the same rule
// the server pays out (robber, underdog, plutocrat, ghosts). Gambler is the
// roller's one bonus, so no other roller-side production bonus can apply; gains
// that don't depend on the dice (investor tokens, a shepherd pair) are left out
// because they can't move the decision.

import { distributeResources } from '@/lib/catan/roll'
import { RESOURCES } from '@/lib/catan/board'
import { CardFan } from '@/lib/catan/ResourceHand'
import type { DiceRoll, GameState } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useGameScreen } from './gameScreenContext'
import { DieFaceView } from './gameScreenShared'

type Decision = {
	dice: DiceRoll
	// Set only for the choose-of-two gambler (5-6 players): both pairs are
	// already thrown and the player keeps one — no reroll step.
	altDice: DiceRoll | null
	canReroll: boolean
}

// Non-null exactly while the viewer is the gambler holding pending dice.
export function gamblerDecisionFor(
	gameState: GameState,
	meIdx: number,
	isMyActiveTurn: boolean
): Decision | null {
	const phase = gameState.phase
	if (phase.kind !== 'roll' || !isMyActiveTurn || !phase.pending?.dice)
		return null
	const altDice = phase.pending.altDice ?? null
	return {
		dice: phase.pending.dice,
		altDice,
		canReroll:
			!altDice && !(gameState.players[meIdx]?.rerolledThisTurn ?? false),
	}
}

export function GamblerRollDecision() {
	const {
		gameState,
		meIdx,
		isMyActiveTurn,
		submitting,
		onConfirmRoll,
		onRerollDice,
	} = useGameScreen()
	if (!gameState) return null
	const decision = gamblerDecisionFor(gameState, meIdx, isMyActiveTurn)
	if (!decision) return null
	const { dice, altDice, canReroll } = decision

	if (altDice) {
		return (
			<View style={styles.row}>
				{[dice, altDice].map((d, i) => (
					<Pressable
						key={i}
						onPress={() => onConfirmRoll(i as 0 | 1)}
						disabled={submitting}
						accessibilityLabel={`Keep ${d.a + d.b}`}
						style={({ pressed }) => [
							styles.choice,
							pressed && !submitting && styles.pressed,
						]}
					>
						<View style={styles.choiceDice}>
							<DieFaceView value={d.a} tone="red" size={20} />
							<DieFaceView value={d.b} tone="yellow" size={20} />
						</View>
						<RollGain
							gameState={gameState}
							meIdx={meIdx}
							dice={d}
						/>
					</Pressable>
				))}
			</View>
		)
	}

	return (
		<View style={styles.row}>
			<RollGain gameState={gameState} meIdx={meIdx} dice={dice} />
			<View style={styles.buttons}>
				{canReroll && (
					<Button
						size="small"
						variant="secondary"
						onPress={onRerollDice}
						loading={submitting}
					>
						Reroll
					</Button>
				)}
				<Button
					size="small"
					onPress={() => onConfirmRoll()}
					loading={submitting}
				>
					Confirm
				</Button>
			</View>
		</View>
	)
}

// What `dice` would pay this seat, as a mini card fan.
function RollGain({
	gameState,
	meIdx,
	dice,
}: {
	gameState: GameState
	meIdx: number
	dice: DiceRoll
}) {
	const total = dice.a + dice.b
	if (total === 7) return <Text style={styles.note}>Robber</Text>
	const hand = distributeResources(gameState, total)[meIdx]
	const entries = hand
		? RESOURCES.filter((r) => hand[r] > 0).map((r) => ({
				resource: r,
				count: hand[r],
			}))
		: []
	if (entries.length === 0) return <Text style={styles.note}>No cards</Text>
	return <CardFan entries={entries} size="mini" />
}

const styles = StyleSheet.create({
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		flexWrap: 'wrap',
		gap: spacing.sm,
	},
	buttons: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	choice: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		minHeight: 48,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	choiceDice: {
		flexDirection: 'row',
		gap: 2,
	},
	note: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.textSecondary,
	},
	pressed: {
		opacity: 0.7,
	},
})
