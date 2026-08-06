// The HUD shell. Water background + one full-screen SlidingArea + the fixed
// Games/menu bar over it.
//
// Unlike the classic screen, the slide holds a REAL, independent render of every
// switchable game — each pane gets its own GameProvider / ChatProvider /
// GameScreenProvider — so a switch genuinely slides the outgoing game out while
// the incoming slides in (the panes are keep-alive, so neither flashes a load).
// That's the deliberate trade the design accepts: N live games mounted at once.
//
// Only the active pane's `Modal`-based overlays render (`active` prop), because a
// `Modal` portals over the whole screen regardless of its pane's visibility.
//
// The Games/menu bar reads the route-level providers (the current game) that
// wrap this component in `app/game/[id].tsx`; the current game therefore mounts
// a second, top-bar-only provider stack — cheap, and it keeps the bar out of the
// per-pane wiring.

import { ChatProvider, useChat } from '@/lib/catan/chatContext'
import { GameProvider } from '@/lib/catan/gameContext'
import { waterColor } from '@/lib/catan/palette'
import { useSwitchableGames } from '@/lib/catan/switchableGames'
import { useAuth } from '@/lib/auth'
import { GameScreenProvider } from '@/lib/game/gameScreenContext'
import { SlidingArea } from '@/lib/modules/SlidingArea'
import { z } from '@/lib/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming,
} from 'react-native-reanimated'
import { HudGame } from './HudGame'
import { HudTopBar } from './HudTopBar'

// The top bar fades out under an open chat panel and back in when it closes.
const CHAT_FADE_MS = 180

export function HudScreen() {
	const { id: currentId, chat } = useLocalSearchParams<{
		id: string
		chat?: string
	}>()
	const { user } = useAuth()
	const router = useRouter()
	// Newest-created first, so the left-most pane matches the top of the Games
	// list (which is `created_at desc`). `useSwitchableGames` sorts oldest-first
	// (its index stability matters for the classic screen), so reverse here.
	const games = [...useSwitchableGames()].reverse()

	// The current game may not be a switchable one (a finished game opened from
	// History) — then it's the lone pane.
	const idx = games.findIndex((g) => g.id === currentId)
	const paneIds = idx >= 0 ? games.map((g) => g.id) : [currentId]
	const activeIndex = idx >= 0 ? idx : 0

	// The chat panel covers the board it's mounted over, so the bar has nothing
	// left to sit against — it fades rather than hanging over the conversation.
	const [chatOpen, setChatOpen] = useState(false)
	const barOpacity = useSharedValue(1)
	useEffect(() => {
		barOpacity.value = withTiming(chatOpen ? 0 : 1, {
			duration: CHAT_FADE_MS,
		})
	}, [chatOpen, barOpacity])
	const barStyle = useAnimatedStyle(() => ({ opacity: barOpacity.value }))

	return (
		<GestureHandlerRootView style={styles.root}>
			<SlidingArea
				index={activeIndex}
				duration={500}
				scrollable
				onIndexChange={(i) => {
					const next = paneIds[i]
					if (next && next !== currentId)
						router.setParams({ id: next })
				}}
				style={styles.slide}
				paneStyle={styles.pane}
			>
				{paneIds.map((gid) => (
					<View key={gid} style={styles.pane}>
						<GameProvider gameId={gid}>
							<ChatProvider
								gameId={gid}
								meId={user?.id}
								requestOpen={chat === '1' && gid === currentId}
							>
								{/* Only the game you're looking at gets to fade
								    the bar; a background pane's open panel is
								    invisible anyway. */}
								{gid === currentId && (
									<ChatOpenReporter onChange={setChatOpen} />
								)}
								<GameScreenProvider gameId={gid}>
									<HudGame active={gid === currentId} />
								</GameScreenProvider>
							</ChatProvider>
						</GameProvider>
					</View>
				))}
			</SlidingArea>

			{/* Fixed over the slide — Back, the games pager, and the menu are
			    about *which* game you're on, so they don't remount on a switch. */}
			<Animated.View
				style={[styles.topBar, barStyle]}
				// `none` while faded, so the strip it occupies falls through to
				// the chat scrim's dismiss layer instead of eating taps.
				pointerEvents={chatOpen ? 'none' : 'box-none'}
			>
				<HudTopBar pageCount={paneIds.length} pageIndex={activeIndex} />
			</Animated.View>
		</GestureHandlerRootView>
	)
}

// The chat panel is opened from inside a pane, under that pane's own
// ChatProvider — but the bar that has to get out of its way is out here, so the
// active pane's open state is reported up. Mounted only for the active pane, so
// a switch tears this down (cleanup clears the flag) before the next one mounts
// and reports its own state.
function ChatOpenReporter({ onChange }: { onChange: (open: boolean) => void }) {
	const { open } = useChat()
	useEffect(() => {
		onChange(open)
	}, [open, onChange])
	useEffect(() => () => onChange(false), [onChange])
	return null
}

const styles = StyleSheet.create({
	root: {
		flex: 1,
		backgroundColor: waterColor,
	},
	slide: {
		flex: 1,
	},
	pane: {
		flex: 1,
	},
	topBar: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		zIndex: z.chat,
	},
})
