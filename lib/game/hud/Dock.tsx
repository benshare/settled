// The HUD's bottom action dock. Compact, translucent, floating over the board.
//
// Layout (v1): a row splits into the hand on the left (resources + dev cards +
// the veteran knight bar) and a right column on the right. The right column
// stacks the build panel on its own row over a second row that splits trade
// (left) and the turn's primary action (Roll / End turn / Done, with Honk,
// right). Through the whole main loop (roll / main / special build) build,
// trade, and the turn control keep their place regardless of whose turn it is —
// each disables itself off-turn instead of popping in and out; Honk likewise
// holds its slot for another player's turn, disabled until a nudge is due. The
// trade and discard composers replace the whole row, since each is built by
// tapping the hand itself. A spectator gets no dock at all (their readout is
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
import {
	useGameScreen,
	type PlacementStage,
} from '@/lib/game/gameScreenContext'
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
						{/* Build spans its own row; below it, trade sits on the
							    left and the turn's primary control on the right. */}
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
			// Trade is rendered on its own row (DockTradeButton), so the bar
			// shows the build panel alone, flush to the column so its width
			// matches the trade + primary-action row below.
			tradeEnabled={false}
			tradeActive={false}
			showTrade={false}
			flush
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

	// Everything past here is the main game loop (roll / main / special build).
	// Any other phase is a board sub-phase with no dock control.
	if (
		phase.kind !== 'roll' &&
		phase.kind !== 'main' &&
		phase.kind !== 'special_build'
	)
		return null

	// Honk holds its place for the whole of someone else's turn (disabled until
	// the idle threshold), and hides itself on your own turn — see HonkButton.
	const honk = (
		<HonkButton
			events={(game.events ?? []) as GameEvent[]}
			phase={phase}
			meIdx={meIdx}
			currentTurn={game.current_turn ?? 0}
			enabled={gameState.config.honk !== false}
			submitting={submitting}
			onHonk={onHonk}
			size="small"
			alwaysShow
		/>
	)

	// Gambler pending dice (your turn only): the choose-of-two / confirm-reroll
	// takes over the whole control.
	if (phase.kind === 'roll' && isMyActiveTurn && phase.pending?.dice) {
		const pendingDice = phase.pending.dice
		const altDice = phase.pending.altDice ?? null
		const rerolled = gameState.players[meIdx]?.rerolledThisTurn ?? false
		return (
			<View style={styles.actionCol}>
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

	return (
		<View style={styles.actionCol}>
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
			{/* Undo (your move only), Honk (others' turns only — mutually
			    exclusive), and the phase's primary control, which stays put and
			    disables itself off-turn. */}
			<View style={styles.primaryRow}>
				{canUndo && (
					<UndoButton submitting={submitting} onPress={onUndo} />
				)}
				{honk}
				{phase.kind === 'roll' ? (
					<Button
						size="small"
						onPress={onRoll}
						loading={submitting && isMyActiveTurn}
						disabled={!isMyActiveTurn || forgerMustMove}
					>
						Roll
					</Button>
				) : phase.kind === 'main' ? (
					<Button
						size="small"
						onPress={onEndTurn}
						loading={submitting && isMyActiveTurn}
						disabled={!isMyActiveTurn}
					>
						End turn
					</Button>
				) : (
					<Button
						size="small"
						onPress={onEndSpecialBuild}
						loading={submitting && isMySpecialBuild}
						disabled={!isMySpecialBuild}
					>
						Done building
					</Button>
				)}
			</View>
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
	// Trade on the left, the turn's primary control on the right. Bottom-aligned
	// so the tall trade panel and the short primary button share a baseline.
	actionRow: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		justifyContent: 'space-between',
		gap: spacing.xs,
	},
	actionCol: {
		gap: spacing.xs,
		alignItems: 'flex-end',
	},
	// The bottom line of the action column: undo / honk sit level with the
	// turn's primary button.
	primaryRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.xs,
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
