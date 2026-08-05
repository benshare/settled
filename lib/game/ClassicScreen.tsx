// The classic (shipped) game-screen layout: the stacked-band arrangement of
// Nav + three sliding zones (TopArea / BoardArea / BottomArea) over a fixed
// water frame. Extracted verbatim from `app/game/[id].tsx` so the screen route
// can switch between this and the HUD layout (see `lib/flags.ts` and
// `.claude/specs/game-hud.md`); the providers stay in the route.
//
// The split between frame and zone is the whole layout rule here: each zone's
// background (the top/bottom bars' fill, the board's water and its edge
// shadows) belongs to the frame and holds still, while only the contents
// travel. Translating the frames too drags the backgrounds off with them and
// the screen reads as scrolling sideways.

import { FortuneTellerAnimation } from '@/lib/catan/FortuneTellerAnimation'
import { ChatPanel } from '@/lib/catan/GameChat'
import { FinalScoreButton, GameOverOverlay } from '@/lib/catan/GameOverOverlay'
import { NomadAnimation } from '@/lib/catan/NomadAnimation'
import { waterColor } from '@/lib/catan/palette'
import { StealAnimation } from '@/lib/catan/StealAnimation'
import { BoardArea } from '@/lib/game/BoardArea'
import { BottomArea } from '@/lib/game/BottomArea'
import { useGameScreen } from '@/lib/game/gameScreenContext'
import { Nav } from '@/lib/game/Nav'
import { TopArea } from '@/lib/game/TopArea'
import { SlidingArea } from '@/lib/modules/SlidingArea'
import { Toast } from '@/lib/modules/Toast'
import { type GameEvent } from '@/lib/stores/useGamesStore'
import { colors, spacing, z } from '@/lib/theme'
import { useRouter } from 'expo-router'
import { type ReactNode } from 'react'
import {
	ActivityIndicator,
	StyleSheet,
	Text,
	View,
	type StyleProp,
	type ViewStyle,
} from 'react-native'
import Animated, { LinearTransition } from 'react-native-reanimated'

const BOARD_RESIZE = LinearTransition.duration(220)

export function ClassicScreen() {
	return (
		<View style={styles.root}>
			<Nav />
			<Game />
		</View>
	)
}

function Game() {
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
		boardTop,
		setBoardTop,
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
		<>
			<ZoneSlide style={styles.topMenu}>
				<TopArea />
			</ZoneSlide>

			{/* The water background is the fixed frame; the board and its
			    floating buttons slide inside it. */}
			<Animated.View
				style={styles.gameArea}
				layout={BOARD_RESIZE}
				// The chat panel is mounted at the screen root (so it can cover
				// the action bars) but has to line up with the floating buttons
				// inside this container. Its offset from the root shifts with
				// the PlayerStrip and placement header, so it's measured.
				onLayout={(e) => setBoardTop(e.nativeEvent.layout.y)}
			>
				<ZoneSlide style={styles.gameAreaSlide} paneStyle={styles.fill}>
					<BoardArea />
				</ZoneSlide>
				{/* Part of the fixed frame, not the board — the water's edge
				    shadow stays put while the board slides under it. */}
				<View pointerEvents="none" style={styles.boardInsetTop} />
				<View pointerEvents="none" style={styles.boardInsetBottom} />
			</Animated.View>

			<ZoneSlide style={styles.bottomMenu}>
				<BottomArea />
			</ZoneSlide>

			{inGameOver && gameState && (
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
					wonByForfeit={wonByForfeit((game.events ?? []) as GameEvent[])}
					onDismiss={() => setGameOverOpen(false)}
					onBackToGames={() => router.replace('/games')}
					// Straight into the create-game form, prefilled with this
					// table and its settings. `replace` so Back from there
					// lands on the games list rather than the finished game.
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
			{inGameOver && !gameOverOpen && (
				<FinalScoreButton onPress={() => setGameOverOpen(true)} />
			)}

			{stealAnim && (
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

			{nomadAnim && (
				<NomadAnimation
					key={nomadAnim.key}
					produced={nomadAnim.produced}
					count={nomadAnim.count}
					playerName={nomadAnim.playerName}
					meIsNomad={nomadAnim.meIsNomad}
					onDismiss={dismissNomadAnim}
				/>
			)}

			{ftAnim && (
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

			{/* Mounted here rather than in the board container so it covers the
			    action bars too, while leaving the nav clear. */}
			<ChatPanel
				topOffset={boardTop}
				playerOrder={game.player_order}
				profilesById={profilesById}
				seatColors={seatColors}
				meId={meId}
			/>

			{/* Raised from the nav's overflow menu, so it has to float over
			    every zone — hence the root, and the chat's z token. */}
			<View pointerEvents="none" style={styles.toastLayer}>
				<Toast message={toast} onHide={hideToast} />
			</View>
		</>
	)
}

// Whether the winner won because every other seat forfeited. It's a flag on the
// terminal `game_complete` event rather than a games column: only the recap
// cares, and the event log is already loaded here.
function wonByForfeit(events: GameEvent[]): boolean {
	// The legacy `winner_index` shape of the event predates the flag entirely.
	return events.some(
		(e) => e.kind === 'game_complete' && 'by_forfeit' in e && !!e.by_forfeit
	)
}

// One movable zone. Every switchable game gets a pane, so the slide's direction
// comes from the tab delta — but only one pane ever holds content: a single
// `GameProvider` swaps its state under one tree, so there is no second game's
// data to render and a retained copy would immediately re-render as the new
// game (see lib/catan/gameContext.tsx). The empty panes are what give the
// primitive something to slide against; with one game there is only one pane
// and the area is a no-op.
//
// The content pane carries a fixed key rather than its positional one, so
// moving it from tab i to tab j *moves* the zone instead of unmounting it and
// mounting a fresh copy at the new index — which would throw away the zone's
// own state (an expanded ActionLog row, a scroll offset) on every switch and
// leave the slide with nothing but a remount to animate.
//
// Each zone spans the full screen width, so the screen's own edges do the
// clipping and the area must NOT clip — the build bar's tooltips and cancel
// badges deliberately render outside their bar.
function ZoneSlide({
	style,
	paneStyle,
	children,
}: {
	style?: StyleProp<ViewStyle>
	paneStyle?: StyleProp<ViewStyle>
	children: ReactNode
}) {
	const { gameTabIndex, gameTabCount } = useGameScreen()
	return (
		<SlidingArea
			index={gameTabIndex}
			style={[styles.zone, style]}
			paneStyle={paneStyle}
		>
			{Array.from({ length: gameTabCount }, (_, i) =>
				i === gameTabIndex ? (
					<View key="zone" style={paneStyle}>
						{children}
					</View>
				) : (
					<View key={`empty-${i}`} />
				)
			)}
		</SlidingArea>
	)
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
	},
	// Above the board container (`z.playArea`) and everything floating in it,
	// same as the chat scrim — a confirmation nothing can paint over.
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
	// Every zone spans the full width and never clips (see ZoneSlide).
	zone: {
		overflow: 'visible',
	},
	fill: {
		flex: 1,
	},
	// The two menu frames. Each holds the background its contents slide
	// against.
	topMenu: {
		backgroundColor: colors.background,
	},
	bottomMenu: {
		backgroundColor: colors.background,
	},
	// The board's fixed frame: water background plus the edge shadows. Only its
	// contents move between games.
	gameArea: {
		flex: 1,
		backgroundColor: waterColor,
		// Above the top and bottom menus, which are siblings, so the panels
		// floating inside it can overhang them rather than slide under.
		zIndex: z.playArea,
	},
	// Fills the frame so the board's floating panels keep positioning against
	// the water's edges rather than against their own content.
	gameAreaSlide: {
		flex: 1,
	},
	boardInsetTop: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		height: 12,
		boxShadow: 'inset 0 6px 6px -2px rgba(0,0,0,0.28)',
	},
	boardInsetBottom: {
		position: 'absolute',
		bottom: 0,
		left: 0,
		right: 0,
		height: 12,
		boxShadow: 'inset 0 -6px 6px -2px rgba(0,0,0,0.28)',
	},
})
