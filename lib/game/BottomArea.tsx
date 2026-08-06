// The bottom menu zone: whatever the local player acts with right now — the
// placement confirm, the roll/end-turn bar, the trade composer, and their own
// hand. A spectator gets none of it (which is why TopArea's status line has to
// cover every phase). Rendered inside the shell's sliding area, so this is
// content only — the background it slides against belongs to the frame (see
// `styles.bottomMenu` in `[id].tsx`).
//
// Also owns the pre-roll bonus modals its own bar opens: ritual and the
// shepherd swap. (The forger's token move is a board interaction, not a modal
// — see `ForgerMoveLayer`.)

import { DevCardHand } from '@/lib/catan/DevCardHand'
import { DevRollPicker } from '@/lib/catan/DevRollPicker'
import { DiscardPanel } from '@/lib/catan/DiscardPanel'
import { canShepherdSwap, ritualCardCost } from '@/lib/catan/bonus'
import { KnightTapBar } from '@/lib/catan/KnightTapBar'
import { ResourceHand } from '@/lib/catan/ResourceHand'
import { RitualistPicker } from '@/lib/catan/RitualistPicker'
import { ShepherdSwapPicker } from '@/lib/catan/ShepherdSwapPicker'
import { TradePanel } from '@/lib/catan/TradePanel'
import { monopolyCap, type DiceRoll, type GameState } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import type { Game, GameEvent } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useGameScreen, type PlacementStage } from './gameScreenContext'
import {
	DieFaceView,
	HonkButton,
	isWeb,
	sharedStyles,
	UndoButton,
} from './gameScreenShared'

const PANEL_IN = FadeIn.duration(160)
const PANEL_OUT = FadeOut.duration(120)

export function BottomArea() {
	const {
		game,
		gameState,
		meIdx,
		myHand,
		displayHand,
		myPlayer,
		isDev,
		devRollTotal,
		setDevRollTotal,
		profilesById,
		isSpectator,
		submitting,
		pickLast,
		placementDraft,
		placementPairs,
		placementStage,
		canUndoPlacement,
		canConfirmPlacement,
		onUndoPlacement,
		inPlacement,
		isMyPlacementTurn,
		isMyActiveTurn,
		inMainLoop,
		inPostPlacement,
		inGameOver,
		inBonusSelection,
		canUndo,
		tradePanelOpen,
		setTradePanelOpen,
		ritualOpen,
		setRitualOpen,
		shepherdOpen,
		setShepherdOpen,
		forgerMustMove,
		onConfirm,
		onRoll,
		onConfirmRoll,
		onRerollDice,
		onEndTurn,
		onHonk,
		onProposeTrade,
		onBankTrade,
		onPlayDevCard,
		onTapKnight,
		onRitualRoll,
		onShepherdSwap,
		onDiscard,
		onUndo,
	} = useGameScreen()

	if (!game) return null

	// How many cards the viewer still owes on a 7. The discard is composed out
	// of the hand itself, so it takes the hand's place in this zone rather than
	// sitting in a bar of its own.
	const owedDiscard =
		gameState?.phase.kind === 'discard' && meIdx >= 0
			? (gameState.phase.pending[meIdx] ?? null)
			: null

	return (
		<>
			{inPlacement && isMyPlacementTurn && (
				<View style={sharedStyles.actionBar}>
					<View style={styles.placementRow}>
						{/* Takes back the last piece chosen. Nothing has been
						    sent yet, so this is local, not the server's undo. */}
						{canUndoPlacement && (
							<UndoButton
								submitting={submitting}
								onPress={onUndoPlacement}
							/>
						)}
						<Button
							style={styles.placementConfirm}
							onPress={onConfirm}
							disabled={!canConfirmPlacement}
							loading={submitting}
						>
							{confirmLabel(
								placementStage,
								placementPairs,
								placementDraft.length,
								!!pickLast
							)}
						</Button>
					</View>
				</View>
			)}

			{inMainLoop &&
				!inGameOver &&
				!isSpectator &&
				gameState &&
				!tradePanelOpen && (
					<Animated.View entering={PANEL_IN} exiting={PANEL_OUT}>
						<MainLoopBar
							game={game}
							gameState={gameState}
							meIdx={meIdx}
							isMyTurn={isMyActiveTurn}
							profilesById={profilesById}
							submitting={submitting}
							onRoll={onRoll}
							onConfirmRoll={onConfirmRoll}
							onRerollDice={onRerollDice}
							onEndTurn={onEndTurn}
							onHonk={onHonk}
							onRitualPress={
								isMyActiveTurn &&
								gameState.phase.kind === 'roll' &&
								!gameState.phase.pending?.dice &&
								myPlayer?.bonus === 'ritualist' &&
								!myPlayer?.ritualWasUsedThisTurn
									? () => setRitualOpen(true)
									: undefined
							}
							onShepherdPress={
								isMyActiveTurn &&
								gameState.phase.kind === 'roll' &&
								!gameState.phase.pending?.dice &&
								myPlayer &&
								canShepherdSwap(myPlayer)
									? () => setShepherdOpen(true)
									: undefined
							}
							forgerMustMove={forgerMustMove}
							canUndo={canUndo}
							onUndo={onUndo}
							devRollTotal={isDev ? devRollTotal : undefined}
							onDevRollTotalChange={
								isDev ? setDevRollTotal : undefined
							}
						/>
					</Animated.View>
				)}

			{tradePanelOpen && myHand && gameState && (
				<Animated.View entering={PANEL_IN} exiting={PANEL_OUT}>
					<TradePanel
						meIdx={meIdx}
						myHand={myHand}
						state={gameState}
						playerOrder={game.player_order}
						profilesById={profilesById}
						submitting={submitting}
						onSend={onProposeTrade}
						onSendBank={onBankTrade}
						onCancel={() => setTradePanelOpen(false)}
					/>
				</Animated.View>
			)}

			{/* post_placement has no MainLoopBar to hang the arrow off, so the
			    fencer's tokens and the explorer's roads get their own row. */}
			{canUndo && inPostPlacement && (
				<View style={styles.undoRow}>
					<UndoButton submitting={submitting} onPress={onUndo} />
				</View>
			)}

			{!inPlacement &&
				!inGameOver &&
				!inBonusSelection &&
				!tradePanelOpen &&
				gameState &&
				meIdx >= 0 &&
				gameState.players[meIdx] && (
					<Animated.View entering={PANEL_IN} exiting={PANEL_OUT}>
						{/* A discard is chosen by tapping the hand, so the
						    composer replaces it rather than stacking above it.
						    It reads the live hand — the cards it selects are
						    real, so a reveal animation must not hide one. */}
						{owedDiscard !== null ? (
							<DiscardPanel
								hand={gameState.players[meIdx].resources}
								required={owedDiscard}
								submitting={submitting}
								isShepherd={
									gameState.players[meIdx].bonus ===
									'shepherd'
								}
								onSubmit={onDiscard}
							/>
						) : (
							/* `displayHand`, not the live hand: a card a reveal
							   animation is still working up to stays hidden
							   until it lands. See gameScreenContext.tsx. */
							<ResourceHand
								hand={
									displayHand ??
									gameState.players[meIdx].resources
								}
							/>
						)}
						{owedDiscard === null && gameState.config.devCards && (
							<DevCardHand
								entries={gameState.players[meIdx].devCards}
								round={gameState.round}
								myTurn={isMyActiveTurn}
								phaseKind={gameState.phase.kind}
								playedDevThisTurn={
									gameState.players[meIdx].playedDevThisTurn
								}
								monopolyPerPlayerCap={
									gameState.config.limitMonopoly
										? monopolyCap(gameState.players.length)
										: null
								}
								onPlay={onPlayDevCard}
							/>
						)}
						{owedDiscard === null &&
							myPlayer?.bonus === 'veteran' && (
								<KnightTapBar
									untappedKnights={
										(myPlayer.devCardsPlayed.knight ?? 0) -
										(myPlayer.tappedKnights ?? 0)
									}
									enabled={
										isMyActiveTurn &&
										gameState.phase.kind === 'main'
									}
									onTap={onTapKnight}
								/>
							)}
					</Animated.View>
				)}

			{ritualOpen && myPlayer && gameState && (
				<RitualistPicker
					hand={myPlayer.resources}
					cardCost={ritualCardCost(gameState, meIdx)}
					submitting={submitting}
					onCancel={() => setRitualOpen(false)}
					onConfirm={onRitualRoll}
				/>
			)}

			{shepherdOpen && (
				<ShepherdSwapPicker
					submitting={submitting}
					onCancel={() => setShepherdOpen(false)}
					onConfirm={onShepherdSwap}
				/>
			)}
		</>
	)
}

function MainLoopBar({
	game,
	gameState,
	meIdx,
	isMyTurn,
	profilesById,
	submitting,
	onRoll,
	onConfirmRoll,
	onRerollDice,
	onEndTurn,
	onHonk,
	onRitualPress,
	onShepherdPress,
	forgerMustMove,
	canUndo,
	onUndo,
	devRollTotal,
	onDevRollTotalChange,
}: {
	game: Game
	gameState: GameState
	meIdx: number
	isMyTurn: boolean
	profilesById: Record<string, Profile>
	submitting: boolean
	onRoll: () => void
	// `which` names the pending pair to keep where the gambler bonus is
	// choose-of-two (5-6 players); omitted for the single-pair confirm.
	onConfirmRoll: (which?: 0 | 1) => void
	onRerollDice: () => void
	onEndTurn: () => void
	onHonk: () => void
	// Set-2 pre-roll affordances. Each is `undefined` when the bar should
	// not show the corresponding button (wrong player / wrong phase / cap
	// reached).
	onRitualPress?: () => void
	onShepherdPress?: () => void
	// Forger: the token move is compulsory and gates the roll. There is no
	// button — the board pulses the valid hexes — so this only disables Roll
	// and retitles the status line.
	forgerMustMove?: boolean
	// Already narrowed to "my main-phase turn, on my own last action" by the
	// screen context — the bar only decides where the arrow sits.
	canUndo: boolean
	onUndo: () => void
	// Admin testing. `onDevRollTotalChange` is undefined for every normal
	// seat, which is what hides the force-roll picker.
	devRollTotal?: number | null
	onDevRollTotalChange?: (total: number | null) => void
}) {
	const phase = gameState.phase
	if (phase.kind !== 'roll' && phase.kind !== 'main') return null

	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	// Gambler pending-dice path: dice are shown but not yet applied. The
	// player must Confirm (apply distribution / 7-chain) or Reroll (once
	// per turn). Non-gambler rolls skip this — dice go from roll → main
	// atomically.
	const pendingDice =
		phase.kind === 'roll' ? (phase.pending?.dice ?? null) : null
	// Present only for the choose-of-two gambler: both pairs are already
	// thrown and the player keeps one, so there is no reroll step.
	const altDice =
		phase.kind === 'roll' ? (phase.pending?.altDice ?? null) : null
	const committedDice = phase.kind === 'main' ? phase.roll : null
	const dice = pendingDice ?? committedDice
	const total = dice ? dice.a + dice.b : null
	const altTotal = altDice ? altDice.a + altDice.b : null
	const rerolledThisTurn = gameState.players[meIdx]?.rerolledThisTurn ?? false

	let status: string
	if (pendingDice && altDice) {
		status = isMyTurn
			? `You rolled ${total} and ${altTotal} — keep one`
			: `${currentName} is choosing between ${total} and ${altTotal}`
	} else if (pendingDice) {
		status = isMyTurn
			? `You rolled ${total} — confirm or reroll`
			: `${currentName} rolled ${total}`
	} else if (phase.kind === 'roll') {
		status = !isMyTurn
			? `${currentName} to roll`
			: forgerMustMove
				? 'Move your forger token to an adjacent hex'
				: 'Your turn — roll the dice'
	} else {
		status = isMyTurn
			? `You rolled ${total}`
			: `${currentName} rolled ${total}`
	}

	const showBonusRow = !!onRitualPress || !!onShepherdPress
	return (
		<View style={styles.mainLoopBar}>
			<View style={sharedStyles.mainLoopRow}>
				<View style={styles.diceSlot}>
					{dice && !altDice && (
						<View style={sharedStyles.diceRow}>
							<DieFaceView value={dice.a} />
							<DieFaceView value={dice.b} />
						</View>
					)}
				</View>
				<Text style={sharedStyles.mainLoopStatus} numberOfLines={2}>
					{status}
				</Text>
				{isMyTurn && phase.kind === 'roll' && !pendingDice && (
					<View style={styles.rollActions}>
						{onDevRollTotalChange && (
							<DevRollPicker
								value={devRollTotal ?? null}
								disabled={submitting}
								onChange={onDevRollTotalChange}
							/>
						)}
						<Button
							onPress={onRoll}
							loading={submitting}
							disabled={forgerMustMove}
						>
							Roll
						</Button>
					</View>
				)}
				{isMyTurn && pendingDice && altDice && (
					<View style={styles.gamblerActions}>
						<RollChoice
							dice={pendingDice}
							disabled={submitting}
							onPress={() => onConfirmRoll(0)}
						/>
						<RollChoice
							dice={altDice}
							disabled={submitting}
							onPress={() => onConfirmRoll(1)}
						/>
					</View>
				)}
				{isMyTurn && pendingDice && !altDice && (
					<View style={styles.gamblerActions}>
						{!rerolledThisTurn && (
							<Button
								onPress={onRerollDice}
								loading={submitting}
								variant="secondary"
							>
								Reroll
							</Button>
						)}
						<Button
							onPress={() => onConfirmRoll()}
							loading={submitting}
						>
							Confirm
						</Button>
					</View>
				)}
				{canUndo && (
					<UndoButton submitting={submitting} onPress={onUndo} />
				)}
				{isMyTurn && phase.kind === 'main' && (
					<Button onPress={onEndTurn} loading={submitting}>
						End turn
					</Button>
				)}
				{!isMyTurn && (
					<HonkButton
						events={(game.events ?? []) as GameEvent[]}
						phase={phase}
						meIdx={meIdx}
						currentTurn={currentIdx}
						enabled={gameState.config.honk !== false}
						submitting={submitting}
						onHonk={onHonk}
					/>
				)}
			</View>
			{showBonusRow && (
				<View style={styles.bonusRow}>
					{onRitualPress && (
						<Button
							variant="secondary"
							onPress={onRitualPress}
							disabled={submitting}
						>
							Ritual roll
						</Button>
					)}
					{onShepherdPress && (
						<Button
							variant="secondary"
							onPress={onShepherdPress}
							disabled={submitting}
						>
							Shepherd swap
						</Button>
					)}
				</View>
			)}
		</View>
	)
}

// The placement bar's one button: an instruction until the step's choice is
// complete, then the confirm. `pairs` is 2 only for the seat that places both
// settlements back-to-back, whose whole four-piece turn is one confirm.
function confirmLabel(
	stage: PlacementStage,
	pairs: 1 | 2,
	drafted: number,
	hasPickLast: boolean
): string {
	switch (stage) {
		case 'settlement':
			return drafted === 1
				? 'Tap a spot to place your second settlement'
				: 'Tap a spot to place settlement'
		case 'road':
			return drafted === 2
				? 'Tap an edge to place your second road'
				: 'Tap an edge to place road'
		case 'ready':
			return pairs === 2
				? 'Confirm both placements'
				: 'Confirm settlement and road'
		case 'pick_last':
			return hasPickLast
				? 'Confirm starting settlement'
				: 'Tap the settlement you placed last'
		default:
			return 'Select a spot'
	}
}

// One of the choose-of-two gambler's pending rolls: the pair as dice faces
// with its total, tappable to keep it. Both are already thrown, so this is a
// pick rather than a commit — there is no separate Confirm step.
function RollChoice({
	dice,
	disabled,
	onPress,
}: {
	dice: DiceRoll
	disabled: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			style={({ pressed }) => [
				styles.rollChoice,
				pressed && !disabled && styles.rollChoicePressed,
			]}
		>
			<View style={sharedStyles.diceRow}>
				<DieFaceView value={dice.a} />
				<DieFaceView value={dice.b} />
			</View>
			<Text style={styles.rollChoiceTotal}>{dice.a + dice.b}</Text>
		</Pressable>
	)
}

const styles = StyleSheet.create({
	mainLoopBar: {
		paddingHorizontal: spacing.md,
		paddingTop: isWeb ? spacing.xs : spacing.sm,
		paddingBottom: isWeb ? spacing.xs : spacing.md,
		height: isWeb ? 60 : 76,
		justifyContent: 'center',
	},
	diceSlot: {
		width: 72,
		height: 32,
		justifyContent: 'center',
	},
	bonusRow: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing.xs,
		marginTop: spacing.xs,
	},
	gamblerActions: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	// Sized to the 52pt action row so a pair of these reads as the row's
	// buttons rather than as loose dice.
	rollChoice: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
		height: 52,
		paddingHorizontal: spacing.sm,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.border,
		backgroundColor: colors.card,
	},
	rollChoicePressed: {
		opacity: 0.7,
	},
	rollChoiceTotal: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	rollActions: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	placementRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	placementConfirm: {
		flex: 1,
	},
	undoRow: {
		flexDirection: 'row',
		justifyContent: 'flex-end',
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.xs,
	},
})
