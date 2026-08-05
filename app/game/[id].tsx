// The game screen route. It mounts the three shared providers and then hands
// off to one of two layouts — the classic stacked-band screen or the full-bleed
// HUD — chosen by the `GAME_LAYOUT` dev flag. Both consume the same
// `useGameScreen()` context, so the choice is purely presentational. See
// `lib/game/ClassicScreen.tsx`, `lib/game/hud/HudScreen.tsx`, and
// `.claude/specs/game-hud.md`.

import { useAuth } from '@/lib/auth'
import { ChatProvider } from '@/lib/catan/chatContext'
import { GameProvider } from '@/lib/catan/gameContext'
import { waterColor } from '@/lib/catan/palette'
import { GAME_LAYOUT } from '@/lib/flags'
import { ClassicScreen } from '@/lib/game/ClassicScreen'
import { GameScreenProvider } from '@/lib/game/gameScreenContext'
import { HudScreen } from '@/lib/game/hud/HudScreen'
import { colors } from '@/lib/theme'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const HUD = GAME_LAYOUT === 'hud'

export default function GameDetailScreen() {
	const { id, chat } = useLocalSearchParams<{ id: string; chat?: string }>()
	const router = useRouter()
	const { user } = useAuth()

	// The flag is a one-shot request, not screen state: drop it once the panel
	// has been told to open, or dismissing chat and tapping a second
	// notification for this same game would leave the param unchanged (and so
	// nothing to react to).
	useEffect(() => {
		if (chat === '1') router.setParams({ chat: undefined })
	}, [chat, router])

	return (
		// The HUD insets only the TOP (so the top bar clears the notch while the
		// water still fills behind it); the bottom is deliberately not inset, so
		// the slide runs to the screen's bottom edge and the dock extends into
		// the home-indicator area. The classic screen keeps the all-edge inset.
		<SafeAreaView
			style={HUD ? styles.safeHud : styles.safe}
			edges={HUD ? ['top'] : undefined}
		>
			<GameProvider gameId={id}>
				{/* `chat=1` arrives from a chat notification tap, so the
				    conversation is open on landing. Consumed immediately (see
				    above) so a second tap re-opens it. */}
				<ChatProvider
					gameId={id}
					meId={user?.id}
					requestOpen={chat === '1'}
				>
					<GameScreenProvider gameId={id}>
						{HUD ? <HudScreen /> : <ClassicScreen />}
					</GameScreenProvider>
				</ChatProvider>
			</GameProvider>
		</SafeAreaView>
	)
}

const styles = StyleSheet.create({
	safe: {
		flex: 1,
		backgroundColor: colors.background,
	},
	safeHud: {
		flex: 1,
		backgroundColor: waterColor,
	},
})
