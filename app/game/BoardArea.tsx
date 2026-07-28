// The board and everything that floats over it. Rendered inside the shell's
// sliding area, so this is content only — the water background and its edge
// shadows are the fixed frame and stay put (see `styles.gameArea` in
// `[id].tsx`). The pane it sits in is `flex: 1`, which is what lets the
// floating panels position against the water's edges rather than their own
// content.
//
// Also owns the overlays whose choice is about the board: the phase pickers
// that block it (scout / curio / forger / magician), the metropolitan cost
// picker a board tap opens, and the inline confirm bar.

import { ActionLog } from '@/lib/catan/ActionLog'
import { BoardLegend } from '@/lib/catan/BoardLegend'
import { BoardView } from '@/lib/catan/BoardView'
import { BonusSelection } from '@/lib/catan/BonusSelection'
import type { Vertex } from '@/lib/catan/board'
import { CurioPickOverlay } from '@/lib/catan/CurioPickOverlay'
import { ForgerPickOverlay } from '@/lib/catan/ForgerPickOverlay'
import { ChatButton } from '@/lib/catan/GameChat'
import { MagicianPickOverlay } from '@/lib/catan/MagicianPickOverlay'
import { MetropolitanCostPicker } from '@/lib/catan/MetropolitanCostPicker'
import { ScoutPickOverlay } from '@/lib/catan/ScoutPickOverlay'
import { TradeBanner } from '@/lib/catan/TradeBanner'
import type { PlayerState } from '@/lib/catan/types'
import { StopWatchingButton, WatcherButton } from '@/lib/catan/Watchers'
import { type GameEvent } from '@/lib/stores/useGamesStore'
import { colors, font, radius, spacing, z } from '@/lib/theme'
import {
	ActivityIndicator,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { useGameScreen } from './gameScreenContext'
import { sharedStyles } from './gameScreenShared'

export function BoardArea() {
	const {
		game,
		gameState,
		meIdx,
		myHand,
		myPlayer,
		profilesById,
		isSpectator,
		submitting,
		selection,
		setSelection,
		inPlacement,
		isMyPlacementTurn,
		isCurrentPlayer,
		isMyActiveTurn,
		isMySpecialBuild,
		inRoadBuilding,
		inBonusSelection,
		postPlacementTool,
		hauntPicks,
		buildTool,
		tradePanelOpen,
		liveOffer,
		pendingConfirm,
		setPendingConfirm,
		runPendingConfirm,
		bonusSelectionData,
		bonusPaneCollapsed,
		setBonusPaneCollapsed,
		metroPending,
		setMetroPending,
		onBuildSpotSelect,
		onMoveRobberRequest,
		onStealRequest,
		onAcceptTrade,
		onConfirmTrade,
		onCancelTrade,
		onRejectTrade,
		onPickBonus,
		onConfirmScoutCard,
		onClaimCurio,
		onPickForgerTarget,
		onCastMagic,
		onSkipMagic,
		onConfirmMetropolitanCost,
	} = useGameScreen()

	if (!game) return null

	return (
		<>
			{gameState &&
				gameState.phase.kind === 'scout_pick' &&
				gameState.phase.owner === meIdx && (
					<ScoutPickOverlay
						cards={gameState.phase.cards}
						submitting={submitting}
						onConfirm={onConfirmScoutCard}
					/>
				)}

			{gameState &&
				gameState.phase.kind === 'curio_pick' &&
				gameState.phase.pending.includes(meIdx) && (
					<CurioPickOverlay
						submitting={submitting}
						onConfirm={onClaimCurio}
					/>
				)}

			{gameState &&
				gameState.phase.kind === 'forger_pick' &&
				gameState.phase.queue.length > 0 &&
				gameState.phase.queue[0].idx === meIdx && (
					<ForgerPickOverlay
						hex={gameState.phase.queue[0].hex}
						gainsByCandidate={
							gameState.phase.queue[0].gainsByCandidate
						}
						playerNames={Object.fromEntries(
							game.player_order.map((uid, i) => [
								i,
								i === meIdx
									? 'You'
									: (profilesById[uid]?.username ??
										`Player ${i + 1}`),
							])
						)}
						submitting={submitting}
						onConfirm={onPickForgerTarget}
					/>
				)}

			{gameState &&
				gameState.phase.kind === 'magician_pick' &&
				gameState.phase.roller === meIdx &&
				myPlayer && (
					<MagicianPickOverlay
						hand={myPlayer.resources}
						actualTotal={
							gameState.phase.roll.a + gameState.phase.roll.b
						}
						submitting={submitting}
						onSkip={onSkipMagic}
						onCast={onCastMagic}
					/>
				)}

			{metroPending && myHand && (
				<MetropolitanCostPicker
					hand={myHand}
					titleKind={metroPending.kind}
					submitting={submitting}
					onCancel={() => setMetroPending(null)}
					onConfirm={onConfirmMetropolitanCost}
				/>
			)}

			{liveOffer && !isSpectator && (
				<TradeBanner
					offer={liveOffer}
					meIdx={meIdx}
					myHand={myHand}
					players={gameState?.players ?? []}
					playerOrder={game.player_order}
					profilesById={profilesById}
					submitting={submitting}
					onAccept={onAcceptTrade}
					onConfirm={onConfirmTrade}
					onCancel={onCancelTrade}
					onReject={onRejectTrade}
				/>
			)}
			{gameState ? (
				<BoardView
					state={gameState}
					robberDormant={robberIsDormant(
						gameState.players,
						(game.events ?? []) as GameEvent[]
					)}
					interaction={
						inPlacement && isMyPlacementTurn
							? {
									meIdx,
									selection,
									onSelect: setSelection,
								}
							: undefined
					}
					build={
						buildTool &&
						(isMyActiveTurn || isMySpecialBuild) &&
						!tradePanelOpen
							? {
									meIdx,
									tool: buildTool,
									onSelect: onBuildSpotSelect,
									pending: pendingConfirm?.preview,
								}
							: inRoadBuilding && isCurrentPlayer
								? {
										meIdx,
										tool: 'road',
										onSelect: onBuildSpotSelect,
										pending: pendingConfirm?.preview,
									}
								: postPlacementTool
									? {
											meIdx,
											tool: postPlacementTool,
											onSelect: onBuildSpotSelect,
											selected:
												postPlacementTool ===
												'haunt_spot'
													? (hauntPicks as Vertex[])
													: undefined,
										}
									: undefined
					}
					robber={
						isMyActiveTurn &&
						(gameState.phase.kind === 'move_robber' ||
							gameState.phase.kind === 'steal')
							? {
									meIdx,
									onMoveRobber: onMoveRobberRequest,
									onSteal: onStealRequest,
								}
							: undefined
					}
				/>
			) : (
				<View style={styles.loadingFill}>
					<ActivityIndicator color={colors.brand} />
				</View>
			)}
			{gameState && (!inBonusSelection || isSpectator) && (
				<BoardLegend devCardsEnabled={!!gameState.config.devCards} />
			)}
			{gameState && (!inBonusSelection || isSpectator) && (
				<ActionLog
					events={(game.events ?? []) as GameEvent[]}
					playerOrder={game.player_order}
					profilesById={profilesById}
					meIdx={meIdx}
				/>
			)}
			{gameState && (!inBonusSelection || isSpectator) && <ChatButton />}
			{gameState && (!inBonusSelection || isSpectator) && (
				<WatcherButton />
			)}
			{gameState && (!inBonusSelection || isSpectator) && (
				<StopWatchingButton />
			)}
			{pendingConfirm && (
				<ConfirmBar
					title={pendingConfirm.title}
					submitting={submitting}
					onConfirm={runPendingConfirm}
					onCancel={() => setPendingConfirm(null)}
				/>
			)}
			{bonusSelectionData && !isSpectator && (
				<View style={styles.bonusPaneFloat}>
					<BonusSelection
						hand={bonusSelectionData.myHand}
						waitingOn={bonusSelectionData.waitingOn}
						submitting={submitting}
						collapsed={bonusPaneCollapsed}
						onToggleCollapsed={() =>
							setBonusPaneCollapsed((prev) => !prev)
						}
						onPick={onPickBonus}
						playerOrder={game.player_order}
						meIdx={meIdx}
						profilesById={profilesById}
						phaseHands={bonusSelectionData.phaseHands}
					/>
				</View>
			)}
		</>
	)
}

function ConfirmBar({
	title,
	submitting,
	onConfirm,
	onCancel,
}: {
	title: string
	submitting: boolean
	onConfirm: () => void
	onCancel: () => void
}) {
	return (
		<View style={styles.confirmFloat}>
			<Text style={styles.confirmTitle}>{title}</Text>
			<View style={styles.confirmRow}>
				<Pressable
					onPress={onCancel}
					disabled={submitting}
					style={({ pressed }) => [
						styles.confirmBtn,
						styles.confirmCancel,
						pressed && !submitting && sharedStyles.pressed,
					]}
				>
					<Text style={styles.confirmCancelText}>Cancel</Text>
				</Pressable>
				<Pressable
					onPress={onConfirm}
					disabled={submitting}
					style={({ pressed }) => [
						styles.confirmBtn,
						styles.confirmOk,
						pressed && !submitting && sharedStyles.pressed,
					]}
				>
					<Text style={styles.confirmOkText}>
						{submitting ? '…' : 'Confirm'}
					</Text>
				</Pressable>
			</View>
		</View>
	)
}

// While a nomad is in the game the robber sits idle on the desert — the nomad's
// resource hex — until it first matters: the first 7 rolled or the first knight
// played. We surface that idle period by rendering the robber faded so a robber
// parked on the desert doesn't misread as blocking the nomad. Purely cosmetic:
// nomad desert production ignores the robber, so the first 7 pays out either
// way. Derived from the events log so it clears the instant a 7/knight lands.
function robberIsDormant(players: PlayerState[], events: GameEvent[]): boolean {
	if (!players.some((p) => p.bonus === 'nomad')) return false
	return !events.some(
		(e) =>
			(e.kind === 'rolled' && e.total === 7) ||
			(e.kind === 'dev_played' && e.id === 'knight')
	)
}

const styles = StyleSheet.create({
	loadingFill: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
	},
	bonusPaneFloat: {
		position: 'absolute',
		top: spacing.sm,
		left: spacing.sm,
		right: spacing.sm,
		bottom: spacing.sm,
		zIndex: z.panel,
	},
	confirmFloat: {
		position: 'absolute',
		top: spacing.sm,
		right: spacing.sm,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: radius.md,
		paddingHorizontal: spacing.sm,
		paddingVertical: spacing.xs,
		gap: spacing.xs,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		maxWidth: 220,
		// Shares the buttons' corner, so it has to win against them.
		zIndex: z.panel,
	},
	confirmTitle: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.text,
	},
	confirmRow: {
		flexDirection: 'row',
		gap: spacing.xs,
	},
	confirmBtn: {
		paddingHorizontal: spacing.sm,
		paddingVertical: 4,
		borderRadius: radius.sm,
		borderWidth: 1,
	},
	confirmCancel: {
		borderColor: colors.border,
		backgroundColor: colors.white,
	},
	confirmCancelText: {
		fontSize: font.sm,
		color: colors.text,
	},
	confirmOk: {
		borderColor: colors.brand,
		backgroundColor: colors.brand,
	},
	confirmOkText: {
		fontSize: font.sm,
		fontWeight: '600',
		color: colors.white,
	},
})
