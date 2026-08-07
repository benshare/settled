// The HUD's bottom action dock. Compact, translucent, floating over the board.
//
// Through the whole main loop (roll / main / special build) build, trade, and
// the turn control keep their place regardless of whose turn it is — each
// disables itself off-turn instead of popping in and out. The nudge is not
// here: honking is about the table stalling, not about your turn, so it hangs
// off the status banner (see `StatusBanner.tsx`). The trade and discard
// composers replace the whole row, since each is built by tapping the hand
// itself. A spectator gets no dock at all (their readout is
// the island + banner). See `.claude/specs/game-hud.md` §10.

import {
	canShepherdSwap,
	investorTokenCount,
	ritualCardCost,
} from '@/lib/catan/bonus'
import { AccountantPicker } from '@/lib/catan/AccountantPicker'
import { DevCardHand } from '@/lib/catan/DevCardHand'
import { DevRollPicker } from '@/lib/catan/DevRollPicker'
import { DiscardPanel } from '@/lib/catan/DiscardPanel'
import { BuildTradeBar, TradeButton } from '@/lib/catan/BuildTradeBar'
import { InvestmentTokens } from '@/lib/catan/InvestmentTokens'
import { InvestPicker } from '@/lib/catan/InvestPicker'
import { KnightTapBar } from '@/lib/catan/KnightTapBar'
import { ResourceHand } from '@/lib/catan/ResourceHand'
import { RitualistPicker } from '@/lib/catan/RitualistPicker'
import { ScoutCostPicker } from '@/lib/catan/ScoutCostPicker'
import { seatColor } from '@/lib/catan/palette'
import {
	ShepherdSwapPicker,
	shepherdPendingLabel,
} from '@/lib/catan/ShepherdSwapPicker'
import { TradePanel } from '@/lib/catan/TradePanel'
import { monopolyCap, type DiceRoll } from '@/lib/catan/types'
import {
	DieFaceView,
	sharedStyles,
	UndoButton,
} from '@/lib/game/gameScreenShared'
import {
	useGameScreen,
	type PlacementStage,
} from '@/lib/game/gameScreenContext'
import { Button } from '@/lib/modules/Button'
import { colors, font, radius, spacing } from '@/lib/theme'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// The dock floats as an inset card, its bottom gap kept above the safe area so
// it clears the home indicator.
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

	// Build + trade + the turn control hold their place for the whole main loop
	// (roll / main / special build), regardless of whose turn it is — each
	// affordance disables itself off-turn rather than popping in and out. Only
	// the distinct modes (placement, discard, the board sub-phases) replace or
	// drop the row.
	const phaseKind = gameState.phase.kind
	const inMainLoop =
		phaseKind === 'roll' ||
		phaseKind === 'main' ||
		phaseKind === 'special_build'

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
						{!inPlacement && myPlayer?.bonus === 'investor' && (
							<InvestmentTokens
								investments={myPlayer.investments}
							/>
						)}
						{!inPlacement && myPlayer?.bonus === 'veteran' && (
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
					</View>
					<View style={styles.rightCol}>
						{inMainLoop ? <BuildBar /> : <View />}
						<View style={styles.actionRow}>
							{inMainLoop ? <DockTradeButton /> : <View />}
							<PrimaryAction />
						</View>
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
		superCityEnabled,
		fenceEnabled,
		accountantEnabled,
		investorEnabled,
		onBuildToolSelect,
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
			// Trade is rendered on its own row (DockTradeButton), so the bar is
			// the naked build icon row — the dock is already the card, and the
			// row spans the column above trade + the primary action.
			tradeEnabled={false}
			tradeActive={false}
			showTrade={false}
			bare
			devCardsEnabled={!!gameState.config.devCards}
			carpenterEnabled={
				myPlayer?.bonus === 'carpenter'
					? canBuildThisTurn &&
						!myPlayer.boughtCarpenterVPThisTurn &&
						myPlayer.resources.wood >= 4
					: undefined
			}
			superCityEnabled={
				myPlayer?.bonus === 'metropolitan'
					? superCityEnabled
					: undefined
			}
			superCityActive={buildTool === 'super_city'}
			fenceEnabled={
				myPlayer?.bonus === 'fencer' ? fenceEnabled : undefined
			}
			fenceActive={buildTool === 'fence'}
			accountantEnabled={
				myPlayer?.bonus === 'accountant' ? accountantEnabled : undefined
			}
			investorEnabled={
				myPlayer?.bonus === 'investor' ? investorEnabled : undefined
			}
			onSelect={onBuildToolSelect}
			onBuyDevCard={onBuyDevCard}
			onBuyCarpenterVP={onBuyCarpenterVP}
			onSelectSuperCity={() => onBuildToolSelect('super_city')}
			onSelectFence={() => onBuildToolSelect('fence')}
			onAccountant={() => setAccountantOpen(true)}
			onInvest={() => setInvestOpen(true)}
		/>
	)
}

// The trade affordance, wired from context. Rendered on its own row in the
// dock (not inside the build bar) so it shares a line with the primary action.
function DockTradeButton() {
	const {
		gameState,
		meIdx,
		tradeButtonEnabled,
		tradeButtonActive,
		onTradePress,
	} = useGameScreen()
	if (!gameState) return null
	return (
		<TradeButton
			compact
			style={styles.actionSlot}
			tradeEnabled={tradeButtonEnabled}
			tradeActive={tradeButtonActive}
			color={seatColor(gameState, meIdx)}
			onTradePress={onTradePress}
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
		onRoll,
		onConfirmRoll,
		onRerollDice,
		onEndTurn,
		onEndSpecialBuild,
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

	// Everything past here is the main game loop (roll / main / special build).
	// Any other phase is a board sub-phase with no dock control.
	if (
		phase.kind !== 'roll' &&
		phase.kind !== 'main' &&
		phase.kind !== 'special_build'
	)
		return null

	// Gambler pending dice (your turn only): the choose-of-two / confirm-reroll
	// takes over the whole control.
	if (phase.kind === 'roll' && isMyActiveTurn && phase.pending?.dice) {
		const pendingDice = phase.pending.dice
		const altDice = phase.pending.altDice ?? null
		const rerolled = gameState.players[meIdx]?.rerolledThisTurn ?? false
		return (
			<View style={[styles.actionCol, styles.actionSlot]}>
				{altDice ? (
					<>
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
					</>
				) : (
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
				)}
			</View>
		)
	}

	// Pre-roll bonus buttons — only on your own roll.
	const canRitual =
		phase.kind === 'roll' &&
		isMyActiveTurn &&
		myPlayer?.bonus === 'ritualist' &&
		!myPlayer?.ritualWasUsedThisTurn
	const canShepherd =
		phase.kind === 'roll' &&
		isMyActiveTurn &&
		!!myPlayer &&
		canShepherdSwap(myPlayer)
	// Already declared this turn: the cards are owed until the roll resolves,
	// so say so where the button was rather than letting the sheep vanish.
	const shepherdPending =
		phase.kind === 'roll' && isMyActiveTurn
			? myPlayer?.shepherdPending
			: undefined

	return (
		<View style={[styles.actionCol, styles.actionSlot]}>
			{phase.kind === 'roll' && isMyActiveTurn && isDev && (
				<DevRollPicker
					value={devRollTotal ?? null}
					disabled={submitting}
					onChange={setDevRollTotal}
				/>
			)}
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
			{shepherdPending && (
				<Text style={styles.shepherdPending} numberOfLines={2}>
					{shepherdPendingLabel(shepherdPending)}
				</Text>
			)}
			{/* The phase's primary control, which stays put and disables itself
			    off-turn. Neither the honk nudge nor the undo arrow is here —
			    both belong to the line the status banner is showing rather than
			    to your own turn (see `StatusBanner.tsx`). */}
			{phase.kind === 'roll' ? (
				<Button
					size="small"
					style={styles.phaseButton}
					onPress={onRoll}
					loading={submitting && isMyActiveTurn}
					disabled={!isMyActiveTurn || forgerMustMove}
				>
					Roll
				</Button>
			) : phase.kind === 'main' ? (
				<Button
					size="small"
					style={styles.phaseButton}
					onPress={onEndTurn}
					loading={submitting && isMyActiveTurn}
					disabled={!isMyActiveTurn}
				>
					End turn
				</Button>
			) : (
				<Button
					size="small"
					style={styles.phaseButton}
					onPress={onEndSpecialBuild}
					loading={submitting && isMySpecialBuild}
					disabled={!isMySpecialBuild}
				>
					Done building
				</Button>
			)}
		</View>
	)
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
				<DieFaceView value={dice.a} tone="red" />
				<DieFaceView value={dice.b} tone="yellow" />
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
		// Inset on the sides; the bottom offset is applied inline because it needs
		// the runtime safe-area inset.
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
	// The uneven split: the hand reads fine compressed (it's a fan of cards),
	// the buttons don't. Height is driven by the hand and stays constant
	// whether or not the build bar is showing.
	row: {
		flexDirection: 'row',
		alignItems: 'stretch',
		gap: spacing.sm,
		paddingHorizontal: spacing.xs,
	},
	// Left: the hand, centered. `minWidth: 0` so the ratio holds on web, where
	// a flex child won't shrink below its content without it.
	handSide: {
		flex: 4,
		minWidth: 0,
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.xs,
	},
	// Children stretch to the column width (the build bar uses it; the primary
	// action right-aligns its own buttons internally).
	rightCol: {
		flex: 6,
		minWidth: 0,
		justifyContent: 'space-between',
		alignItems: 'stretch',
		gap: spacing.sm,
	},
	// Bottom-aligned so the tall trade panel and the short primary button share a
	// baseline.
	actionRow: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		justifyContent: 'space-between',
		gap: spacing.sm,
	},
	actionCol: {
		gap: spacing.xs,
		alignItems: 'flex-end',
	},
	shepherdPending: {
		fontSize: font.xs,
		color: colors.textSecondary,
		fontWeight: '600',
		textAlign: 'right',
	},
	// Trade and the main-loop action column split the row evenly, so the phase
	// button below stays the same width whether it says "Roll" or "Done
	// building". Placement's column is left off it — it has no trade beside it
	// and its confirm labels need the whole row.
	actionSlot: {
		flex: 1,
		minWidth: 0,
	},
	// Fills its (constant-width) column; the secondary bonus buttons above it
	// stay content-sized and right-aligned. Tighter side padding than the
	// default small button so the longest label still gets one line.
	phaseButton: {
		alignSelf: 'stretch',
		paddingHorizontal: spacing.sm,
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
