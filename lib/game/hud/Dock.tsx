// The HUD's bottom action dock. Compact, translucent, floating over the board.
//
// Layout (v1): the build/trade bar spans the top when building is actionable;
// below it a row splits into the hand on the left (resources + dev cards + the
// veteran knight bar) and the turn's primary action on the right (Roll / End
// turn / Confirm / Done / Honk). The trade and discard composers replace the
// whole row, since each is built by tapping the hand itself. A spectator gets no
// dock at all (their readout is the island + banner). See
// `.claude/specs/game-hud.md` §10.

import {
	canShepherdSwap,
	investorTokenCount,
	ritualCardCost,
} from '@/lib/catan/bonus'
import { AccountantPicker } from '@/lib/catan/AccountantPicker'
import { DevCardHand } from '@/lib/catan/DevCardHand'
import { DevRollPicker } from '@/lib/catan/DevRollPicker'
import { DiscardPanel } from '@/lib/catan/DiscardPanel'
import { BuildTradeBar } from '@/lib/catan/BuildTradeBar'
import { InvestPicker } from '@/lib/catan/InvestPicker'
import { KnightTapBar } from '@/lib/catan/KnightTapBar'
import { ResourceHand } from '@/lib/catan/ResourceHand'
import { RitualistPicker } from '@/lib/catan/RitualistPicker'
import { ScoutCostPicker } from '@/lib/catan/ScoutCostPicker'
import { seatColor } from '@/lib/catan/palette'
import { ShepherdSwapPicker } from '@/lib/catan/ShepherdSwapPicker'
import { TradePanel } from '@/lib/catan/TradePanel'
import { monopolyCap, type DiceRoll } from '@/lib/catan/types'
import {
	DieFaceView,
	HonkButton,
	sharedStyles,
	UndoButton,
} from '@/lib/game/gameScreenShared'
import { useGameScreen, type PlacementStage } from '@/lib/game/gameScreenContext'
import { Button } from '@/lib/modules/Button'
import { colors, font, radius, spacing } from '@/lib/theme'
import type { GameEvent } from '@/lib/stores/useGamesStore'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// The dock floats as an inset card: the bottom gap sits above the safe area (so
// it never collides with the home indicator), and the sides are inset twice as
// far to pull the card in from the screen edges.
const DOCK_MARGIN = spacing.sm
const DOCK_MARGIN_X = DOCK_MARGIN * 2

export function Dock({
	onHeight,
	active = true,
}: {
	// Reports the dock's measured height so the caller can float the status
	// banner just above it. Never fires for a spectator (the dock renders null).
	onHeight?: (h: number) => void
	// False for an off-screen HUD pane: the dock still renders (it slides), but
	// its `Modal` pickers are suppressed so a background game's can't portal over
	// the active one.
	active?: boolean
}) {
	const ctx = useGameScreen()
	const {
		game,
		gameState,
		meIdx,
		myHand,
		displayHand,
		myPlayer,
		profilesById,
		isSpectator,
		submitting,
		inGameOver,
		inBonusSelection,
		inPlacement,
		isMyActiveTurn,
		isMySpecialBuild,
		tradePanelOpen,
		onProposeTrade,
		onBankTrade,
		setTradePanelOpen,
		onPlayDevCard,
		onTapKnight,
		onDiscard,
		ritualOpen,
		setRitualOpen,
		shepherdOpen,
		setShepherdOpen,
		accountantOpen,
		setAccountantOpen,
		investOpen,
		setInvestOpen,
		scoutCostOpen,
		setScoutCostOpen,
		onLiquidate,
		onInvest,
		submitBuyDevCard,
		onRitualRoll,
		onShepherdSwap,
	} = ctx

	const insets = useSafeAreaInsets()

	if (!game || !gameState || isSpectator || inGameOver || inBonusSelection)
		return null
	if (meIdx < 0 || !gameState.players[meIdx]) return null

	const owedDiscard =
		gameState.phase.kind === 'discard'
			? (gameState.phase.pending[meIdx] ?? null)
			: null

	// Build actions are actionable only on your own main turn or your
	// special-build slot; the bar hides otherwise (during your roll, others'
	// turns, sub-phases) rather than showing a wall of disabled buttons.
	const showBuildBar = ctx.canBuildThisTurn || isMySpecialBuild

	return (
		<View
			style={[styles.dock, { bottom: insets.bottom + DOCK_MARGIN }]}
			onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
		>
			{tradePanelOpen && myHand ? (
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
			) : owedDiscard !== null ? (
				<DiscardPanel
					hand={gameState.players[meIdx].resources}
					required={owedDiscard}
					submitting={submitting}
					isShepherd={gameState.players[meIdx].bonus === 'shepherd'}
					onSubmit={onDiscard}
				/>
			) : (
				<View style={styles.row}>
					<View style={styles.handSide}>
							{/* `displayHand`, not the live hand: a card a reveal
							    animation is still working up to stays hidden
							    until it lands. */}
							<ResourceHand
								size="compact"
								hand={
									displayHand ??
									gameState.players[meIdx].resources
								}
							/>
							{!inPlacement && gameState.config.devCards && (
								<DevCardHand
									entries={gameState.players[meIdx].devCards}
									round={gameState.round}
									myTurn={isMyActiveTurn}
									phaseKind={gameState.phase.kind}
									playedDevThisTurn={
										gameState.players[meIdx]
											.playedDevThisTurn
									}
									monopolyPerPlayerCap={
										gameState.config.limitMonopoly
											? monopolyCap(
													gameState.players.length
												)
											: null
									}
									onPlay={onPlayDevCard}
								/>
							)}
							{!inPlacement &&
								myPlayer?.bonus === 'veteran' && (
									<KnightTapBar
										untappedKnights={
											(myPlayer.devCardsPlayed.knight ??
												0) -
											(myPlayer.tappedKnights ?? 0)
										}
										enabled={
											isMyActiveTurn &&
											gameState.phase.kind === 'main'
										}
										onTap={onTapKnight}
									/>
								)}
						</View>
						<View style={styles.rightCol}>
							{/* Actions on top, the turn's primary control at the
							    bottom. */}
							{showBuildBar ? <BuildBar /> : <View />}
							<PrimaryAction />
						</View>
					</View>
			)}

			{/* Modals opened from the dock's affordances. All Modal-based, so
			    where they sit in the tree has no layout consequence; gated on
			    `active` so an off-screen pane's can't portal over the active. */}
			{active && ritualOpen && myPlayer && (
				<RitualistPicker
					hand={myPlayer.resources}
					cardCost={ritualCardCost(gameState, meIdx)}
					submitting={submitting}
					onCancel={() => setRitualOpen(false)}
					onConfirm={onRitualRoll}
				/>
			)}
			{active && shepherdOpen && (
				<ShepherdSwapPicker
					submitting={submitting}
					onCancel={() => setShepherdOpen(false)}
					onConfirm={onShepherdSwap}
				/>
			)}
			{active && accountantOpen && (
				<AccountantPicker
					state={gameState}
					playerIdx={meIdx}
					submitting={submitting}
					onCancel={() => setAccountantOpen(false)}
					onConfirm={onLiquidate}
				/>
			)}
			{active && investOpen && myPlayer && (
				<InvestPicker
					hand={myPlayer.resources}
					tokenCount={investorTokenCount(myPlayer)}
					submitting={submitting}
					onCancel={() => setInvestOpen(false)}
					onConfirm={onInvest}
				/>
			)}
			{active && scoutCostOpen && myPlayer && (
				<ScoutCostPicker
					hand={myPlayer.resources}
					submitting={submitting}
					onCancel={() => setScoutCostOpen(false)}
					onConfirm={(swap) => submitBuyDevCard(swap)}
				/>
			)}
		</View>
	)
}

// The build/trade bar, wired from context (mirrors TopArea's usage). Full width
// at the top of the dock — its horizontal icon row needs the room.
function BuildBar() {
	const {
		buildTool,
		buildEnabled,
		buildCurseHints,
		meIdx,
		myPlayer,
		gameState,
		canBuildThisTurn,
		tradeButtonEnabled,
		tradeButtonActive,
		superCityEnabled,
		accountantEnabled,
		investorEnabled,
		onBuildToolSelect,
		onTradePress,
		onBuyDevCard,
		onBuyCarpenterVP,
		setAccountantOpen,
		setInvestOpen,
	} = useGameScreen()
	if (!gameState) return null
	return (
		<BuildTradeBar
			active={buildTool}
			enabled={buildEnabled}
			curseHints={buildCurseHints}
			color={seatColor(gameState, meIdx)}
			tradeEnabled={tradeButtonEnabled}
			tradeActive={tradeButtonActive}
			devCardsEnabled={!!gameState.config.devCards}
			carpenterEnabled={
				myPlayer?.bonus === 'carpenter'
					? canBuildThisTurn &&
						!myPlayer.boughtCarpenterVPThisTurn &&
						myPlayer.resources.wood >= 4
					: undefined
			}
			superCityEnabled={
				myPlayer?.bonus === 'metropolitan' ? superCityEnabled : undefined
			}
			superCityActive={buildTool === 'super_city'}
			accountantEnabled={
				myPlayer?.bonus === 'accountant' ? accountantEnabled : undefined
			}
			investorEnabled={
				myPlayer?.bonus === 'investor' ? investorEnabled : undefined
			}
			onSelect={onBuildToolSelect}
			onTradePress={onTradePress}
			onBuyDevCard={onBuyDevCard}
			onBuyCarpenterVP={onBuyCarpenterVP}
			onSelectSuperCity={() => onBuildToolSelect('super_city')}
			onAccountant={() => setAccountantOpen(true)}
			onInvest={() => setInvestOpen(true)}
		/>
	)
}

// The turn's primary control, on the right of the hand row. One case per phase;
// the island already narrates the roll, so this is buttons only.
function PrimaryAction() {
	const ctx = useGameScreen()
	const {
		game,
		gameState,
		meIdx,
		myPlayer,
		submitting,
		isDev,
		devRollTotal,
		setDevRollTotal,
		inPlacement,
		isMyPlacementTurn,
		isMyActiveTurn,
		isMySpecialBuild,
		canConfirmPlacement,
		canUndoPlacement,
		onUndoPlacement,
		onConfirm,
		placementStage,
		placementPairs,
		placementDraft,
		pickLast,
		canUndo,
		onUndo,
		onRoll,
		onConfirmRoll,
		onRerollDice,
		onEndTurn,
		onEndSpecialBuild,
		onHonk,
		forgerMustMove,
		setRitualOpen,
		setShepherdOpen,
	} = ctx
	if (!game || !gameState) return null
	const phase = gameState.phase

	// Placement — the confirm + a local undo of the last drafted piece.
	if (inPlacement && isMyPlacementTurn) {
		return (
			<View style={styles.actionCol}>
				{canUndoPlacement && (
					<UndoButton
						submitting={submitting}
						onPress={onUndoPlacement}
					/>
				)}
				<Button
					size="small"
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
		)
	}

	// Roll phase — roll / gambler confirm-reroll / choose-of-two, plus the
	// pre-roll bonus buttons.
	if (phase.kind === 'roll' && isMyActiveTurn) {
		const pendingDice = phase.pending?.dice ?? null
		const altDice = phase.pending?.altDice ?? null
		const rerolled = gameState.players[meIdx]?.rerolledThisTurn ?? false
		const canRitual =
			!pendingDice &&
			myPlayer?.bonus === 'ritualist' &&
			!myPlayer?.ritualWasUsedThisTurn
		const canShepherd =
			!pendingDice && !!myPlayer && canShepherdSwap(myPlayer)
		return (
			<View style={styles.actionCol}>
				{pendingDice && altDice ? (
					<View style={styles.actionCol}>
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
				) : pendingDice ? (
					<>
						{!rerolled && (
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
					</>
				) : (
					<>
						{isDev && (
							<DevRollPicker
								value={devRollTotal ?? null}
								disabled={submitting}
								onChange={setDevRollTotal}
							/>
						)}
						<Button
							size="small"
							onPress={onRoll}
							loading={submitting}
							disabled={forgerMustMove}
						>
							Roll
						</Button>
						{canRitual && (
							<Button
								size="small"
								variant="secondary"
								onPress={() => setRitualOpen(true)}
								disabled={submitting}
							>
								Ritual
							</Button>
						)}
						{canShepherd && (
							<Button
								size="small"
								variant="secondary"
								onPress={() => setShepherdOpen(true)}
								disabled={submitting}
							>
								Shepherd
							</Button>
						)}
					</>
				)}
			</View>
		)
	}

	// Main turn — end it, with the undo arrow when the server allows one.
	if (phase.kind === 'main' && isMyActiveTurn) {
		return (
			<View style={styles.actionCol}>
				{canUndo && (
					<UndoButton submitting={submitting} onPress={onUndo} />
				)}
				<Button size="small" onPress={onEndTurn} loading={submitting}>
					End turn
				</Button>
			</View>
		)
	}

	// A special-build slot — the acting builder finishes it.
	if (phase.kind === 'special_build' && isMySpecialBuild) {
		return (
			<View style={styles.actionCol}>
				{canUndo && (
					<UndoButton submitting={submitting} onPress={onUndo} />
				)}
				<Button
					size="small"
					onPress={onEndSpecialBuild}
					loading={submitting}
				>
					Done building
				</Button>
			</View>
		)
	}

	// Not your move — the nudge, when the target has stalled.
	if (
		phase.kind === 'roll' ||
		phase.kind === 'main' ||
		phase.kind === 'special_build'
	) {
		// Wrapped so the button is natural-width and right-aligned rather than
		// stretched across the column.
		return (
			<View style={styles.actionCol}>
				<HonkButton
					events={(game.events ?? []) as GameEvent[]}
					phase={phase}
					meIdx={meIdx}
					currentTurn={game.current_turn ?? 0}
					enabled={gameState.config.honk !== false}
					submitting={submitting}
					onHonk={onHonk}
					size="small"
				/>
			</View>
		)
	}

	return null
}

// One of the gambler's two thrown pairs, tappable to keep it.
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
				pressed && !disabled && styles.pressed,
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

function confirmLabel(
	stage: PlacementStage,
	pairs: 1 | 2,
	drafted: number,
	hasPickLast: boolean
): string {
	switch (stage) {
		case 'settlement':
			return drafted === 1 ? 'Second settlement' : 'Place settlement'
		case 'road':
			return drafted === 2 ? 'Second road' : 'Place road'
		case 'ready':
			return pairs === 2 ? 'Confirm both' : 'Confirm'
		case 'pick_last':
			return hasPickLast ? 'Confirm' : 'Tap last settlement'
		default:
			return 'Select'
	}
}

const styles = StyleSheet.create({
	dock: {
		position: 'absolute',
		// Inset on the sides; the bottom offset (base margin + the bottom
		// safe-area inset) is applied inline so the card floats clear of the home
		// indicator.
		left: DOCK_MARGIN_X,
		right: DOCK_MARGIN_X,
		backgroundColor: 'rgba(247,237,214,0.96)',
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.lg,
		paddingHorizontal: spacing.xs,
		paddingVertical: spacing.xs,
		boxShadow: '0px 2px 10px rgba(0,0,0,0.18)',
	},
	// Two equal halves at equal height — so the dock's height is driven by the
	// hand and stays constant whether or not the build bar is showing.
	row: {
		flexDirection: 'row',
		alignItems: 'stretch',
		gap: spacing.sm,
		paddingHorizontal: spacing.xs,
	},
	// Left: the hand, centered.
	handSide: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.xs,
	},
	// Right: build actions on top, the turn's primary control at the bottom.
	// Children stretch to the column width (the build bar uses it; the primary
	// action right-aligns its own buttons internally).
	rightCol: {
		flex: 1,
		justifyContent: 'space-between',
		alignItems: 'stretch',
		gap: spacing.xs,
	},
	actionCol: {
		gap: spacing.xs,
		alignItems: 'flex-end',
	},
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
	rollChoiceTotal: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
	},
	pressed: {
		opacity: 0.7,
	},
})
