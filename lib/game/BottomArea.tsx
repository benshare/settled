// The bottom menu zone: whatever the local player acts with right now — the
// placement confirm, the roll/end-turn bar, the trade composer, and their own
// hand. A spectator gets none of it (which is why TopArea's status line has to
// cover every phase). Rendered inside the shell's sliding area, so this is
// content only — the background it slides against belongs to the frame (see
// `styles.bottomMenu` in `[id].tsx`).
//
// Also owns the pre-roll bonus modals its own bar opens: ritual, shepherd
// swap, and the forger token move.

import { DevCardHand } from '@/lib/catan/DevCardHand'
import { DevRollPicker } from '@/lib/catan/DevRollPicker'
import { ForgerMovePicker } from '@/lib/catan/ForgerMovePicker'
import {
	canShepherdSwap,
	forgerActive,
	ritualCardCost,
} from '@/lib/catan/bonus'
import { KnightTapBar } from '@/lib/catan/KnightTapBar'
import type { PlacementSelection } from '@/lib/catan/PlacementLayer'
import { ResourceHand } from '@/lib/catan/ResourceHand'
import { RitualistPicker } from '@/lib/catan/RitualistPicker'
import { ShepherdSwapPicker } from '@/lib/catan/ShepherdSwapPicker'
import { TradePanel } from '@/lib/catan/TradePanel'
import { monopolyCap, type GameState } from '@/lib/catan/types'
import { Button } from '@/lib/modules/Button'
import type { Game, GameEvent } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { colors, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useGameScreen } from './gameScreenContext'
import {
	DieFaceView,
	HonkButton,
	isWeb,
	sharedStyles,
} from './gameScreenShared'

const PANEL_IN = FadeIn.duration(160)
const PANEL_OUT = FadeOut.duration(120)

export function BottomArea() {
	const {
		game,
		gameState,
		meIdx,
		myHand,
		myPlayer,
		isDev,
		devRollTotal,
		setDevRollTotal,
		profilesById,
		isSpectator,
		submitting,
		selection,
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
		forgerMoveOpen,
		setForgerMoveOpen,
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
		onMoveForgerToken,
		onUndo,
	} = useGameScreen()

	if (!game) return null

	return (
		<>
			{inPlacement && isMyPlacementTurn && (
				<View style={sharedStyles.actionBar}>
					<Button
						onPress={onConfirm}
						disabled={!selection}
						loading={submitting}
					>
						{confirmLabel(gameState, selection)}
					</Button>
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
							onForgerMovePress={
								isMyActiveTurn &&
								gameState.phase.kind === 'roll' &&
								!gameState.phase.pending?.dice &&
								myPlayer &&
								forgerActive(myPlayer) &&
								!myPlayer.forgerMovedThisTurn
									? () => setForgerMoveOpen(true)
									: undefined
							}
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
						<ResourceHand
							hand={gameState.players[meIdx].resources}
						/>
						{gameState.config.devCards && (
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
						{myPlayer?.bonus === 'veteran' && (
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

			{forgerMoveOpen && myPlayer?.forgerToken && gameState && (
				<ForgerMovePicker
					state={gameState}
					currentHex={myPlayer.forgerToken}
					submitting={submitting}
					onCancel={() => setForgerMoveOpen(false)}
					onConfirm={onMoveForgerToken}
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
	onForgerMovePress,
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
	onConfirmRoll: () => void
	onRerollDice: () => void
	onEndTurn: () => void
	onHonk: () => void
	// Set-2 pre-roll affordances. Each is `undefined` when the bar should
	// not show the corresponding button (wrong player / wrong phase / cap
	// reached).
	onRitualPress?: () => void
	onShepherdPress?: () => void
	onForgerMovePress?: () => void
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
	const committedDice = phase.kind === 'main' ? phase.roll : null
	const dice = pendingDice ?? committedDice
	const total = dice ? dice.a + dice.b : null
	const rerolledThisTurn = gameState.players[meIdx]?.rerolledThisTurn ?? false

	let status: string
	if (pendingDice) {
		status = isMyTurn
			? `You rolled ${total} — confirm or reroll`
			: `${currentName} rolled ${total}`
	} else if (phase.kind === 'roll') {
		status = isMyTurn
			? 'Your turn — roll the dice'
			: `${currentName} to roll`
	} else {
		status = isMyTurn
			? `You rolled ${total}`
			: `${currentName} rolled ${total}`
	}

	const showBonusRow =
		!!onRitualPress || !!onShepherdPress || !!onForgerMovePress
	return (
		<View style={styles.mainLoopBar}>
			<View style={sharedStyles.mainLoopRow}>
				<View style={styles.diceSlot}>
					{dice && (
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
						<Button onPress={onRoll} loading={submitting}>
							Roll
						</Button>
					</View>
				)}
				{isMyTurn && pendingDice && (
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
						<Button onPress={onConfirmRoll} loading={submitting}>
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
					{onForgerMovePress && (
						<Button
							variant="secondary"
							onPress={onForgerMovePress}
							disabled={submitting}
						>
							Move forger token
						</Button>
					)}
				</View>
			)}
		</View>
	)
}

// Take back your own last action. Only ever rendered when the screen context
// says the server would accept it, so it has no disabled state of its own —
// when there's nothing to undo the button isn't there. Icon-only and square,
// sized to the row's buttons so the action row stays even.
function UndoButton({
	submitting,
	onPress,
}: {
	submitting: boolean
	onPress: () => void
}) {
	return (
		<Pressable
			onPress={onPress}
			disabled={submitting}
			accessibilityRole="button"
			accessibilityLabel="Undo last action"
			style={({ pressed }) => [
				styles.undoBtn,
				submitting && styles.undoBtnBusy,
				pressed && !submitting && sharedStyles.pressed,
			]}
		>
			<Ionicons name="arrow-undo" size={20} color={colors.text} />
		</Pressable>
	)
}

function confirmLabel(
	gameState: GameState | undefined,
	selection: PlacementSelection | null
): string {
	const step =
		gameState?.phase.kind === 'initial_placement'
			? gameState.phase.step
			: null
	if (!selection) {
		if (step === 'settlement') return 'Tap a spot to place settlement'
		if (step === 'road') return 'Tap an edge to place road'
		if (step === 'pick_last') return 'Tap the settlement you placed last'
		return 'Select a spot'
	}
	if (step === 'pick_last') return 'Confirm starting settlement'
	return selection.kind === 'settlement'
		? 'Confirm settlement'
		: 'Confirm road'
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
	rollActions: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
	},
	// Matches the secondary Button's chrome and the 52pt row height, so the
	// arrow reads as part of the same row of actions.
	undoBtn: {
		width: 52,
		height: 52,
		borderRadius: radius.md,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
	},
	undoBtnBusy: {
		opacity: 0.4,
	},
	undoRow: {
		flexDirection: 'row',
		justifyContent: 'flex-end',
		paddingHorizontal: spacing.md,
		paddingBottom: spacing.xs,
	},
})
