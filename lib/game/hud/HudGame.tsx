// One game's HUD — everything that rides the slide. A full-bleed board (reusing
// BoardArea, which already renders the board, every board-blocking overlay, the
// trade banner, the bonus-selection pane, the confirm bar, and the top-right
// utility buttons) with the new floating chrome layered over it: the island +
// player chips up top, the status banner above the dock, and the dock at the
// bottom. Also mounts what belongs to no single piece — the player-detail
// overlay the chips open, the chat panel, the game-over overlay, the three event
// animations, and the toast. See `.claude/specs/game-hud.md`.

import { FortuneTellerAnimation } from '@/lib/catan/FortuneTellerAnimation'
import { ChatPanel } from '@/lib/catan/GameChat'
import { FinalScoreButton, GameOverOverlay } from '@/lib/catan/GameOverOverlay'
import { NomadAnimation } from '@/lib/catan/NomadAnimation'
import { PlayerDetailOverlay } from '@/lib/catan/PlayerDetailOverlay'
import { StealAnimation } from '@/lib/catan/StealAnimation'
import { BoardArea } from '@/lib/game/BoardArea'
import { useGameScreen } from '@/lib/game/gameScreenContext'
import { colors, spacing, z } from '@/lib/theme'
import { type GameEvent } from '@/lib/stores/useGamesStore'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Toast } from '@/lib/modules/Toast'
import { Dock } from './Dock'
import { PlayerChips } from './PlayerChips'
import { StatusBanner } from './StatusBanner'

// The fixed Games/menu bar (rendered by HudScreen, over the slide) is this tall;
// the chips sit just below it, and the chat panel starts here so the bar stays
// clear and tappable while chat is open.
const HUD_TOP_BAR_H = 44
const CHAT_TOP = HUD_TOP_BAR_H

// Fallback board-area top before the chip band's height is measured.
const TOP_BAND = 120

// `active` is false for the off-screen panes in the slide. Their board and
// chrome still render (so they slide in/out with real content), but every
// portaling `Modal` — the pickers, the event animations, the game-over overlay,
// the player-detail sheet — is suppressed, since a `Modal` shows over the whole
// screen regardless of its pane's visibility.
export function HudGame({ active = true }: { active?: boolean } = {}) {
	const {
		game,
		gameState,
		ready,
		meId,
		meIdx,
		profilesById,
		displayVP,
		publicVP,
		seatColors,
		openPlayerIdx,
		setOpenPlayerIdx,
		inGameOver,
		gameOverOpen,
		setGameOverOpen,
		stealAnim,
		dismissStealAnim,
		nomadAnim,
		dismissNomadAnim,
		ftAnim,
		dismissFtAnim,
		toast,
		hideToast,
	} = useGameScreen()
	const router = useRouter()
	const insets = useSafeAreaInsets()
	const [dockHeight, setDockHeight] = useState(0)
	// Measured so the board area (and the trade banner that flows at its top)
	// starts below the chips regardless of whether they wrap to one or two rows.
	const [topBandH, setTopBandH] = useState(0)
	// The y of the dock's top edge from the screen bottom: its floating offset
	// (side margin + bottom safe inset) plus its measured height. Everything that
	// sits above the dock — the board's bottom, the banner, the utility rail — is
	// placed against this. 0 when there's no dock (spectator).
	const dockTop = dockHeight > 0 ? insets.bottom + spacing.sm + dockHeight : 0

	if (!game) {
		return (
			<View style={styles.center}>
				{ready ? (
					<Text style={styles.hint}>Game not found.</Text>
				) : (
					<ActivityIndicator color={colors.brand} />
				)}
			</View>
		)
	}

	return (
		<View style={styles.pane}>
			{/* The board layer: BoardView, all board-blocking overlays, the
			    trade banner, the bonus pane, the confirm bar, and the top-right
			    utility buttons (legend / log / chat / watchers). Inset below the
			    top band and above the dock so the board and its own floating
			    buttons stay clear of the chrome. */}
			<View
				style={[
					styles.boardFill,
					{
						// Chips sit at HUD_TOP_BAR_H with measured height topBandH;
						// the trade banner flows at `marginTop: spacing.sm` inside
						// here, so this lands it `spacing.lg` below the chips.
						top: topBandH
							? HUD_TOP_BAR_H + topBandH + spacing.md
							: TOP_BAND,
						bottom: dockTop || insets.bottom + spacing.sm,
					},
				]}
			>
				{/* boardFill is an absolute box from the top band to the dock's
				    top, so BoardArea's absolute children (the board overlays and
				    the utility buttons) anchor to real edges, not padding. The
				    buttons anchor `spacing.md` above this box's bottom — the same
				    line as the banner. */}
				<BoardArea active={active} floatingButtonsBottom={spacing.md} />
			</View>

			{/* Player chips, just below the fixed Games/menu bar. */}
			<View
				style={styles.topStack}
				pointerEvents="box-none"
				onLayout={(e) => setTopBandH(e.nativeEvent.layout.height)}
			>
				<PlayerChips />
			</View>

			{/* Status summary, floated just above the dock (or near the bottom
			    for a spectator, who has no dock). */}
			<View
				style={[
					styles.bannerWrap,
					{ bottom: (dockTop || insets.bottom) + spacing.md },
				]}
				pointerEvents="box-none"
			>
				<StatusBanner />
			</View>

			<Dock onHeight={setDockHeight} active={active} />

			{active && gameState && (
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

			{active && inGameOver && gameState && (
				<GameOverOverlay
					visible={gameOverOpen}
					winnerIdx={game.winner}
					playerOrder={game.player_order}
					meIdx={meIdx}
					profilesById={profilesById}
					gameState={gameState}
					events={(game.events ?? []) as GameEvent[]}
					pointsByPlayer={displayVP}
					publicByPlayer={publicVP}
					canceled={game.status === 'canceled'}
					wonByForfeit={wonByForfeit(
						(game.events ?? []) as GameEvent[]
					)}
					onDismiss={() => setGameOverOpen(false)}
					onBackToGames={() => router.replace('/games')}
					onRematch={
						meIdx < 0
							? undefined
							: () =>
									router.replace({
										pathname: '/create-game',
										params: {
											invite: game.player_order
												.filter((id) => id !== meId)
												.join(','),
											config: JSON.stringify(
												gameState.config
											),
										},
									})
					}
				/>
			)}
			{active && inGameOver && !gameOverOpen && (
				<FinalScoreButton onPress={() => setGameOverOpen(true)} />
			)}

			{active && stealAnim && (
				<StealAnimation
					key={stealAnim.key}
					preHand={stealAnim.preHand}
					stolen={stealAnim.stolen}
					thiefName={stealAnim.thiefName}
					victimName={stealAnim.victimName}
					meIsThief={stealAnim.meIsThief}
					onDismiss={dismissStealAnim}
				/>
			)}
			{active && nomadAnim && (
				<NomadAnimation
					key={nomadAnim.key}
					produced={nomadAnim.produced}
					count={nomadAnim.count}
					playerName={nomadAnim.playerName}
					meIsNomad={nomadAnim.meIsNomad}
					onDismiss={dismissNomadAnim}
				/>
			)}
			{active && ftAnim && (
				<FortuneTellerAnimation
					key={ftAnim.key}
					dice={ftAnim.dice}
					total={ftAnim.total}
					gain={ftAnim.gain}
					playerName={ftAnim.playerName}
					meIsFortuneTeller={ftAnim.meIsFortuneTeller}
					onDismiss={dismissFtAnim}
				/>
			)}

			<ChatPanel
				topOffset={CHAT_TOP}
				bottomInset={insets.bottom + spacing.md}
				playerOrder={game.player_order}
				profilesById={profilesById}
				seatColors={seatColors}
				meId={meId}
			/>

			<View pointerEvents="none" style={styles.toastLayer}>
				<Toast message={toast} onHide={hideToast} />
			</View>
		</View>
	)
}

// Duplicated from ClassicScreen — a one-liner not worth a shared module.
function wonByForfeit(events: GameEvent[]): boolean {
	return events.some(
		(e) => e.kind === 'game_complete' && 'by_forfeit' in e && !!e.by_forfeit
	)
}

const styles = StyleSheet.create({
	pane: {
		flex: 1,
	},
	boardFill: {
		position: 'absolute',
		left: 0,
		right: 0,
	},
	topStack: {
		position: 'absolute',
		top: HUD_TOP_BAR_H,
		left: 0,
		right: 0,
		zIndex: z.panel,
	},
	bannerWrap: {
		position: 'absolute',
		left: 0,
		right: 0,
		alignItems: 'center',
		zIndex: z.panel,
	},
	toastLayer: {
		...StyleSheet.absoluteFill,
		zIndex: z.chat,
	},
	center: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		gap: spacing.md,
	},
	hint: {
		fontSize: 15,
		color: colors.textMuted,
		textAlign: 'center',
	},
})
