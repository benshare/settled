// The top menu zone: who's playing, what the table is waiting on, and the
// build/trade bar. Rendered inside the shell's sliding area, so this is content
// only — the background it slides against belongs to the frame (see
// `styles.topMenu` in `[id].tsx`).
//
// Also owns the modals opened from this zone (the build bar's accountant /
// invest / scout-cost pickers, and a player's detail sheet from the strip).

import { AccountantPicker } from '@/lib/catan/AccountantPicker'
import { investorTokenCount } from '@/lib/catan/bonus'
import { BuildTradeBar } from '@/lib/catan/BuildTradeBar'
import { DiscardBar } from '@/lib/catan/DiscardBar'
import { InvestPicker } from '@/lib/catan/InvestPicker'
import { PlayerDetailOverlay } from '@/lib/catan/PlayerDetailOverlay'
import { PlayerStrip } from '@/lib/catan/PlayerStrip'
import {
	ExplorerStatusBanner,
	FenceStatusBanner,
	HauntStatusBanner,
	SpecialistDeclareOverlay,
} from '@/lib/catan/PostPlacementOverlay'
import { ScoutCostPicker } from '@/lib/catan/ScoutCostPicker'
import { formatRemaining } from '@/lib/catan/timeout'
import type { GameState } from '@/lib/catan/types'
import { useCountdown } from '@/lib/catan/useCountdown'
import type { Game } from '@/lib/stores/useGamesStore'
import { type GameEvent } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { Button } from '@/lib/modules/Button'
import { colors, font, spacing } from '@/lib/theme'
import { StyleSheet, Text, View } from 'react-native'
import { useGameScreen, type PlacementStage } from './gameScreenContext'
import {
	HonkButton,
	DieFaceView,
	sharedStyles,
	UndoButton,
} from './gameScreenShared'

export function TopArea() {
	const {
		game,
		gameState,
		meIdx,
		myPlayer,
		displayVP,
		publicVP,
		forfeitedIds,
		profilesById,
		isSpectator,
		submitting,
		inPlacement,
		inPostPlacement,
		inBonusSelection,
		inRoadBuilding,
		inRobberFlow,
		inGameOver,
		isMyPlacementTurn,
		placementStage,
		placementPairs,
		buildTool,
		buildEnabled,
		buildCurseHints,
		canBuildThisTurn,
		tradeButtonEnabled,
		tradeButtonActive,
		superCityEnabled,
		accountantEnabled,
		investorEnabled,
		hauntPicks,
		openPlayerIdx,
		setOpenPlayerIdx,
		accountantOpen,
		setAccountantOpen,
		investOpen,
		setInvestOpen,
		scoutCostOpen,
		setScoutCostOpen,
		onBuildToolSelect,
		onTradePress,
		onBuyDevCard,
		onBuyCarpenterVP,
		onDiscard,
		canUndo,
		onEndSpecialBuild,
		onHonk,
		onUndo,
		onSetSpecialistResource,
		onSetHauntSpots,
		onLiquidate,
		onInvest,
		submitBuyDevCard,
	} = useGameScreen()

	// A spectator has no PlayerStrip chip to read — their one status line is
	// the only place the clock can show. Called before the early return, since
	// it's a hook.
	const spectatorRemaining = useCountdown(game?.deadline_at)

	if (!game) return null

	return (
		<>
			{gameState && (
				<PlayerStrip
					playerOrder={game.player_order}
					currentTurn={game.current_turn}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					pointsByPlayer={displayVP}
					publicByPlayer={publicVP}
					forfeitedIds={forfeitedIds}
					deadlineAt={game.deadline_at}
					onPressPlayer={setOpenPlayerIdx}
				/>
			)}

			{/* A spectator has no bottom bar to read the table's state from,
		    so the one line they do get has to cover every phase. */}
			{isSpectator && gameState && !inGameOver && (
				<View style={styles.statusWrap}>
					<Text style={styles.statusLine}>
						{spectatorStatus(game, gameState, profilesById)}
						{spectatorRemaining !== null &&
							` · ${formatRemaining(spectatorRemaining)} left`}
					</Text>
				</View>
			)}

			{inPlacement && gameState && !isSpectator && (
				<PlacementHeader
					game={game}
					gameState={gameState}
					meIdx={meIdx}
					isMyTurn={isMyPlacementTurn}
					stage={placementStage}
					pairs={placementPairs}
					profilesById={profilesById}
				/>
			)}

			{inPostPlacement &&
				gameState?.phase.kind === 'post_placement' &&
				(() => {
					const specialistPending = gameState.phase.pending.specialist
					// My own pick is a modal; only surface a top-line status
					// while I'm waiting on other players to declare theirs.
					if (specialistPending.includes(meIdx)) return null
					const waiting = specialistPending
						.filter((i) => i !== meIdx)
						.map(
							(i) =>
								profilesById[game.player_order[i]]?.username ??
								'Player'
						)
					if (waiting.length === 0) return null
					return (
						<View style={styles.statusWrap}>
							<Text style={styles.statusLine}>
								Waiting for {waiting.join(', ')} to declare
								their specialty…
							</Text>
						</View>
					)
				})()}

			{gameState?.phase.kind === 'magician_pick' &&
				gameState.phase.roller !== meIdx && (
					<View style={styles.statusWrap}>
						<Text style={styles.statusLine}>
							Waiting on{' '}
							{profilesById[
								game.player_order[gameState.phase.roller]
							]?.username ?? 'Player'}{' '}
							to work their magic…
						</Text>
					</View>
				)}

			{gameState?.phase.kind === 'scout_pick' &&
				gameState.phase.owner !== meIdx && (
					<View style={styles.statusWrap}>
						<Text style={styles.statusLine}>
							Waiting on{' '}
							{profilesById[
								game.player_order[gameState.phase.owner]
							]?.username ?? 'Player'}{' '}
							to choose 1 of 2 peeked dev cards…
						</Text>
					</View>
				)}

			{gameState?.phase.kind === 'curio_pick' &&
				!gameState.phase.pending.includes(meIdx) && (
					<View style={styles.statusWrap}>
						<Text style={styles.statusLine}>
							Waiting on{' '}
							{gameState.phase.pending
								.map(
									(i) =>
										profilesById[game.player_order[i]]
											?.username ?? 'Player'
								)
								.join(', ')}{' '}
							to claim 3 resources…
						</Text>
					</View>
				)}

			{!inPlacement &&
				!inGameOver &&
				!inBonusSelection &&
				!isSpectator &&
				gameState && (
					<>
						{!inRoadBuilding && (
							<BuildTradeBar
								active={buildTool}
								enabled={buildEnabled}
								curseHints={buildCurseHints}
								meIdx={meIdx}
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
									myPlayer?.bonus === 'metropolitan'
										? superCityEnabled
										: undefined
								}
								superCityActive={buildTool === 'super_city'}
								accountantEnabled={
									myPlayer?.bonus === 'accountant'
										? accountantEnabled
										: undefined
								}
								investorEnabled={
									myPlayer?.bonus === 'investor'
										? investorEnabled
										: undefined
								}
								onSelect={onBuildToolSelect}
								onTradePress={onTradePress}
								onBuyDevCard={onBuyDevCard}
								onBuyCarpenterVP={onBuyCarpenterVP}
								onSelectSuperCity={() =>
									onBuildToolSelect('super_city')
								}
								onAccountant={() => setAccountantOpen(true)}
								onInvest={() => setInvestOpen(true)}
							/>
						)}
						{inRoadBuilding && (
							<RoadBuildingStatus
								game={game}
								gameState={gameState}
								meIdx={meIdx}
								profilesById={profilesById}
							/>
						)}
						{inRobberFlow && (
							<RobberStatus
								game={game}
								gameState={gameState}
								meIdx={meIdx}
								profilesById={profilesById}
							/>
						)}
						{gameState.phase.kind === 'discard' &&
							meIdx >= 0 &&
							gameState.phase.pending[meIdx] !== undefined && (
								<DiscardBar
									hand={gameState.players[meIdx].resources}
									required={gameState.phase.pending[meIdx]!}
									submitting={submitting}
									isShepherd={
										gameState.players[meIdx]?.bonus ===
										'shepherd'
									}
									onSubmit={onDiscard}
								/>
							)}
						{gameState.phase.kind === 'special_build' && (
							<SpecialBuildBar
								game={game}
								gameState={gameState}
								meIdx={meIdx}
								profilesById={profilesById}
								submitting={submitting}
								canUndo={canUndo}
								onDone={onEndSpecialBuild}
								onHonk={onHonk}
								onUndo={onUndo}
							/>
						)}
					</>
				)}

			{inPostPlacement &&
				gameState?.phase.kind === 'post_placement' &&
				(() => {
					const phase = gameState.phase
					const specialistPending = phase.pending.specialist
					const explorer = phase.pending.explorer ?? {}
					const waitingSpecialist = specialistPending
						.filter((i) => i !== meIdx)
						.map(
							(i) =>
								profilesById[game.player_order[i]]?.username ??
								'Player'
						)
					if (specialistPending.includes(meIdx)) {
						return (
							<SpecialistDeclareOverlay
								waitingOn={waitingSpecialist}
								submitting={submitting}
								onConfirm={onSetSpecialistResource}
							/>
						)
					}
					// Specialist still pending for someone else: the top status
					// line handles the "waiting" message; don't fall through to
					// the explorer/fencer/haunt banners until it resolves.
					if (waitingSpecialist.length > 0) return null
					// Specialist done — explorer placements happen inline on
					// the board; surface a status banner so the player sees
					// the count.
					const fencer = phase.pending.fencer ?? {}
					const haunt = phase.pending.haunt ?? []
					const nameOf = (i: number) =>
						profilesById[game.player_order[i]]?.username ?? 'Player'
					const explorerRemaining = explorer[meIdx] ?? 0
					const fencerRemaining = fencer[meIdx] ?? 0
					const amHauntPending = haunt.includes(meIdx)
					const othersWaiting = Array.from(
						new Set<number>([
							...Object.entries(explorer)
								.filter(
									([i, n]) =>
										Number(i) !== meIdx && (n ?? 0) > 0
								)
								.map(([i]) => Number(i)),
							...Object.entries(fencer)
								.filter(
									([i, n]) =>
										Number(i) !== meIdx && (n ?? 0) > 0
								)
								.map(([i]) => Number(i)),
							...haunt.filter((i) => i !== meIdx),
						])
					).map(nameOf)

					if (explorerRemaining > 0) {
						return (
							<ExplorerStatusBanner
								remaining={explorerRemaining}
								waitingOn={othersWaiting}
							/>
						)
					}
					if (fencerRemaining > 0) {
						return (
							<FenceStatusBanner
								remaining={fencerRemaining}
								waitingOn={othersWaiting}
							/>
						)
					}
					if (amHauntPending) {
						return (
							<HauntStatusBanner
								picked={hauntPicks.length}
								waitingOn={othersWaiting}
								submitting={submitting}
								onConfirm={() => {
									if (hauntPicks.length === 2) {
										onSetHauntSpots([
											hauntPicks[0],
											hauntPicks[1],
										])
									}
								}}
							/>
						)
					}
					if (othersWaiting.length > 0) {
						return (
							<ExplorerStatusBanner
								remaining={0}
								waitingOn={othersWaiting}
							/>
						)
					}
					return null
				})()}

			{accountantOpen && gameState && (
				<AccountantPicker
					state={gameState}
					playerIdx={meIdx}
					submitting={submitting}
					onCancel={() => setAccountantOpen(false)}
					onConfirm={onLiquidate}
				/>
			)}

			{investOpen && myPlayer && (
				<InvestPicker
					hand={myPlayer.resources}
					tokenCount={investorTokenCount(myPlayer)}
					submitting={submitting}
					onCancel={() => setInvestOpen(false)}
					onConfirm={onInvest}
				/>
			)}

			{scoutCostOpen && myPlayer && (
				<ScoutCostPicker
					hand={myPlayer.resources}
					submitting={submitting}
					onCancel={() => setScoutCostOpen(false)}
					onConfirm={(swap) => submitBuyDevCard(swap)}
				/>
			)}

			{gameState && (
				<PlayerDetailOverlay
					playerIdx={openPlayerIdx}
					playerOrder={game.player_order}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					pointsByPlayer={displayVP}
					publicByPlayer={publicVP}
					onClose={() => setOpenPlayerIdx(null)}
				/>
			)}
		</>
	)
}

// `stage` is the local drafting stage for the turn-holder; everyone else sees
// only what the server says, which for a drafted turn is the whole turn — the
// pieces are chosen on the actor's device, so nobody else can see how far in
// they are.
function PlacementHeader({
	game,
	gameState,
	meIdx,
	isMyTurn,
	stage,
	pairs,
	profilesById,
}: {
	game: Game
	gameState: GameState
	meIdx: number
	isMyTurn: boolean
	stage: PlacementStage
	pairs: 1 | 2
	profilesById: Record<string, Profile>
}) {
	if (gameState.phase.kind !== 'initial_placement') return null
	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	const step = gameState.phase.step
	const waitingFor =
		step === 'pick_last'
			? 'choose their starting settlement'
			: step === 'road'
				? 'place a road'
				: pairs === 2
					? 'place both their settlements and roads'
					: 'place a settlement and road'
	const message = !isMyTurn
		? `Waiting for ${currentName} to ${waitingFor}`
		: stage === 'pick_last'
			? 'Your turn — choose the settlement you placed last'
			: stage === 'ready'
				? 'Your turn — confirm your placements'
				: `Your turn — place ${prefix(stage ?? '')} ${stage}`

	return (
		<View style={styles.statusWrap}>
			<Text style={styles.statusLine}>{message}</Text>
		</View>
	)
}

function RobberStatus({
	game,
	gameState,
	meIdx,
	profilesById,
}: {
	game: Game
	gameState: GameState
	meIdx: number
	profilesById: Record<string, Profile>
}) {
	const phase = gameState.phase
	if (
		phase.kind !== 'discard' &&
		phase.kind !== 'move_robber' &&
		phase.kind !== 'steal'
	)
		return null

	const currentIdx = game.current_turn ?? 0
	const currentId = game.player_order[currentIdx]
	const currentName =
		meIdx === currentIdx
			? 'You'
			: (profilesById[currentId]?.username ?? 'Player')

	let status: string
	if (phase.kind === 'discard') {
		const pendingIdxs = Object.keys(phase.pending)
			.map((k) => Number(k))
			.sort((a, b) => a - b)
		const iOwe = meIdx >= 0 && phase.pending[meIdx] !== undefined
		if (iOwe) {
			status = `You rolled 7 — discard ${phase.pending[meIdx]!}`
		} else {
			const names = pendingIdxs.map((i) =>
				i === meIdx
					? 'You'
					: (profilesById[game.player_order[i]]?.username ?? 'Player')
			)
			status = `Waiting for ${names.join(', ')} to discard`
		}
	} else if (phase.kind === 'move_robber') {
		status =
			meIdx === currentIdx
				? phase.from7
					? 'You rolled 7 — move the robber'
					: 'You played a knight — move the robber'
				: `${currentName} is moving the robber`
	} else {
		status =
			meIdx === currentIdx
				? 'Pick a player to steal from'
				: `${currentName} is stealing`
	}

	// Dice are only relevant when the sub-phase was triggered by a 7-roll.
	// A knight can be played from main (where `resume` carries that turn's
	// roll), so gate on `from7` rather than the resume shape.
	const dice =
		phase.from7 && phase.resume.kind === 'main' ? phase.resume.roll : null
	return (
		<View style={sharedStyles.actionBar}>
			<View style={sharedStyles.mainLoopRow}>
				{dice && (
					<View style={sharedStyles.diceRow}>
						<DieFaceView value={dice.a} />
						<DieFaceView value={dice.b} />
					</View>
				)}
				<Text style={sharedStyles.mainLoopStatus}>{status}</Text>
			</View>
		</View>
	)
}

function RoadBuildingStatus({
	game,
	gameState,
	meIdx,
	profilesById,
}: {
	game: Game
	gameState: GameState
	meIdx: number
	profilesById: Record<string, Profile>
}) {
	const phase = gameState.phase
	if (phase.kind !== 'road_building') return null
	const currentIdx = game.current_turn ?? 0
	const isMyTurn = meIdx === currentIdx
	const currentName = isMyTurn
		? 'You'
		: (profilesById[game.player_order[currentIdx]]?.username ?? 'Player')
	const placedSoFar = 2 - phase.remaining + 1
	const status = isMyTurn
		? `Place free road ${placedSoFar}/2`
		: `${currentName} is placing 2 roads`
	return (
		<View style={sharedStyles.actionBar}>
			<View style={sharedStyles.mainLoopRow}>
				<Text style={sharedStyles.mainLoopStatus}>{status}</Text>
			</View>
		</View>
	)
}

function SpecialBuildBar({
	game,
	gameState,
	meIdx,
	profilesById,
	submitting,
	canUndo,
	onDone,
	onHonk,
	onUndo,
}: {
	game: Game
	gameState: GameState
	meIdx: number
	profilesById: Record<string, Profile>
	submitting: boolean
	// Already narrowed to "my special-build slot, on my own last action" by the
	// screen context — the bar only decides where the arrow sits.
	canUndo: boolean
	onDone: () => void
	onHonk: () => void
	onUndo: () => void
}) {
	const phase = gameState.phase
	if (phase.kind !== 'special_build') return null
	const actorIdx = phase.queue[0]
	const isMe = actorIdx === meIdx
	const actorName = isMe
		? 'You'
		: (profilesById[game.player_order[actorIdx]]?.username ?? 'Player')
	return (
		<View style={sharedStyles.actionBar}>
			<View style={sharedStyles.mainLoopRow}>
				<Text style={sharedStyles.mainLoopStatus} numberOfLines={2}>
					{isMe
						? 'Special build — build or buy a dev card'
						: `Special build — ${actorName} is building`}
				</Text>
				{canUndo && (
					<UndoButton submitting={submitting} onPress={onUndo} />
				)}
				{isMe ? (
					<Button onPress={onDone} loading={submitting}>
						Done building
					</Button>
				) : (
					<HonkButton
						events={(game.events ?? []) as GameEvent[]}
						phase={phase}
						meIdx={meIdx}
						currentTurn={game.current_turn ?? 0}
						enabled={gameState.config.honk !== false}
						submitting={submitting}
						onHonk={onHonk}
					/>
				)}
			</View>
		</View>
	)
}

// The whole of a spectator's turn-state readout. Players learn what the table
// is waiting on from the bottom bars, which a spectator doesn't get — so this
// one line has to cover every phase, including the sub-phases that would
// otherwise read as the game having simply stopped.
function spectatorStatus(
	game: Game,
	gameState: GameState,
	profilesById: Record<string, Profile>
): string {
	const nameOf = (idx: number) =>
		profilesById[game.player_order[idx]]?.username ?? 'Player'
	const listOf = (idxs: number[]) => idxs.map(nameOf).join(', ')
	const current = nameOf(game.current_turn ?? 0)
	const phase = gameState.phase

	switch (phase.kind) {
		case 'select_bonus':
			return 'Players are choosing bonuses'
		case 'initial_placement':
			// A whole turn is one step now, so 'settlement' covers the road
			// too; 'road' is only a turn left mid-way (older client, or the
			// timeout sweep stepping through it).
			return phase.step === 'pick_last'
				? `${current} is choosing their starting settlement`
				: phase.step === 'road'
					? `${current} is placing a road`
					: `${current} is placing a settlement and road`
		case 'post_placement':
			return 'Players are setting up their bonuses'
		case 'roll':
			return `${current}'s turn to roll`
		case 'main':
			return `${current}'s turn`
		case 'discard': {
			const owing = Object.keys(phase.pending).map(Number)
			return owing.length > 0
				? `Waiting on ${listOf(owing)} to discard`
				: `${current}'s turn`
		}
		case 'move_robber':
			return `${current} is moving the robber`
		case 'steal':
			return `${current} is stealing a card`
		case 'road_building':
			return `${current} is placing free roads`
		case 'scout_pick':
			return `${nameOf(phase.owner)} is peeking at dev cards`
		case 'curio_pick':
			return `Waiting on ${listOf(phase.pending)} to claim 3 resources`
		case 'forger_pick':
			return phase.queue.length > 0
				? `${nameOf(phase.queue[0].idx)} is forging a copy`
				: `${current}'s turn`
		case 'magician_pick':
			return `${nameOf(phase.roller)} is working their magic`
		case 'special_build':
			return phase.queue.length > 0
				? `${nameOf(phase.queue[0])} is taking an extra build`
				: `${current}'s turn`
		case 'game_over':
			return 'Game over'
	}
}

function prefix(word: string): string {
	return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

const styles = StyleSheet.create({
	statusWrap: {
		paddingHorizontal: spacing.md,
		paddingTop: spacing.xs,
		paddingBottom: spacing.sm,
		gap: spacing.xs,
		alignItems: 'center',
	},
	statusLine: {
		fontSize: font.base,
		color: colors.text,
		fontWeight: '600',
	},
})
