import { IS_ADMIN, useAdminStore } from '@/lib/admin'
import { useAppForeground } from '@/lib/appState'
import { AuthProvider, useAuth } from '@/lib/auth'
import { GameLayoutProvider } from '@/lib/GameLayoutContext'
import { useAppBadge, useNotificationRouting } from '@/lib/notifications'
import { loadAllUserStores } from '@/lib/stores'
import { ThemeProvider, useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, spacing } from '@/lib/theme'
import { VERSION_LABEL } from '@/lib/version'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as Updates from 'expo-updates'
import { useEffect, useMemo, useState } from 'react'
import {
	Image,
	Platform,
	Pressable,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import 'react-native-reanimated'

// Desktop browsers stretch the native layout to the full viewport, which
// looks broken for a phone-first app. On web we clamp the whole app to a
// mobile-width column and center it; on native we pass through.
const WEB_MAX_WIDTH = 560
const isWeb = Platform.OS === 'web'

const SUB_SCREEN = { animation: 'slide_from_right' } as const

export { ErrorBoundary } from 'expo-router'

export const unstable_settings = {
	initialRouteName: 'index',
}

SplashScreen.preventAutoHideAsync()

// The gesture root wraps everything, above RootNav's loading-screen early
// return, so every branch of the tree is covered. Components that need
// gestures (the board, the color ranking list) rely on this one rather than
// mounting their own.
export default function RootLayout() {
	return (
		<GestureHandlerRootView style={{ flex: 1 }}>
			<ThemeProvider>
				<GameLayoutProvider>
					<AuthProvider>
						<RootNav />
					</AuthProvider>
				</GameLayoutProvider>
			</ThemeProvider>
		</GestureHandlerRootView>
	)
}

function RootNav() {
	const { loading, user } = useAuth()
	const { colors, resolved } = useTheme()
	const [updateChecked, setUpdateChecked] = useState(false)

	useEffect(() => {
		if (user?.id) {
			loadAllUserStores(user.id)
		}
	}, [user?.id])

	// Any realtime event emitted while we were backgrounded is gone — re-read
	// every store (which also re-creates their channels) on the way back in.
	useAppForeground(() => {
		if (user?.id) loadAllUserStores(user.id)
	})

	// Root, not `(app)`: the tab group unmounts when a push tap replaces it with
	// a game screen, and that's the session where the badge needs clearing most.
	useAppBadge()

	// Root for the same reason, and because it has to outlive the tab group to
	// keep handling taps after the first one. Called above the LoadingScreen
	// return, so it holds each tap until the navigator can take it rather than
	// needing a mounted tree of its own.
	useNotificationRouting()

	useEffect(() => {
		async function applyUpdate() {
			try {
				if (Updates.isEnabled) {
					const update = await Updates.checkForUpdateAsync()
					if (update.isAvailable) {
						await Updates.fetchUpdateAsync()
						await Updates.reloadAsync()
						return
					}
				}
			} catch {
				// proceed normally if update check fails
			}
			setUpdateChecked(true)
		}
		applyUpdate()
	}, [])

	useEffect(() => {
		// Hand off from the native splash to the JS loading screen so the version
		// label is visible while auth/updates resolve.
		SplashScreen.hideAsync().catch(() => {})
	}, [])

	// A reload while impersonating keeps the borrowed session, so the banner —
	// the only way back — has to be re-derived from storage rather than from
	// whatever this process happened to do.
	useEffect(() => {
		useAdminStore.getState().restore()
	}, [])

	if (loading || !updateChecked) return <LoadingScreen />

	return (
		<View
			style={{
				flex: 1,
				backgroundColor: isWeb ? colors.surface : colors.background,
				alignItems: 'center',
			}}
		>
			<StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
			<View
				style={{
					flex: 1,
					width: '100%',
					maxWidth: isWeb ? WEB_MAX_WIDTH : undefined,
					backgroundColor: colors.background,
					borderLeftWidth: isWeb ? 1 : 0,
					borderRightWidth: isWeb ? 1 : 0,
					borderColor: colors.border,
				}}
			>
				<ImpersonationBanner />
				<Stack
					screenOptions={{ headerShown: false, animation: 'fade' }}
				>
					<Stack.Screen name="index" />
					<Stack.Screen name="(auth)" />
					<Stack.Screen name="(app)" />
					<Stack.Screen name="send-request" />
					{/* Sub-screens pushed from a tab, and the only ones with a
					    back chevron — they slide so the gesture reads as a
					    push over the tab that opened them, not a swap. */}
					<Stack.Screen name="create-game" options={SUB_SCREEN} />
					<Stack.Screen name="player-colors" options={SUB_SCREEN} />
					<Stack.Screen name="privacy" />
					<Stack.Screen name="support" />
				</Stack>
			</View>
		</View>
	)
}

// The way out of an impersonated session, and the reminder that you're in one.
// It sits above the Stack rather than floating over it so it can't be mistaken
// for part of the screen underneath — every screen shifts down while it's up.
// Renders nothing outside admin builds, where `actingAs` is always null.
function ImpersonationBanner() {
	const actingAs = useAdminStore((s) => s.actingAs)
	const busy = useAdminStore((s) => s.busy)
	const stopActing = useAdminStore((s) => s.stopActing)
	const insets = useSafeAreaInsets()
	const { colors } = useTheme()
	const styles = useMemo(() => makeBannerStyles(colors), [colors])

	if (!IS_ADMIN || !actingAs) return null

	return (
		<View style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}>
			<Text style={styles.label} numberOfLines={1}>
				Acting as {actingAs.username}
			</Text>
			<Pressable onPress={stopActing} disabled={busy} hitSlop={8}>
				<Text style={styles.stop}>{busy ? 'Stopping…' : 'Stop'}</Text>
			</Pressable>
		</View>
	)
}

function makeBannerStyles(colors: ColorScheme) {
	return StyleSheet.create({
		banner: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			gap: spacing.sm,
			paddingHorizontal: spacing.md,
			paddingBottom: spacing.xs,
			backgroundColor: colors.error,
		},
		label: {
			flex: 1,
			fontSize: font.sm,
			fontWeight: '600',
			color: colors.white,
		},
		stop: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.white,
			textDecorationLine: 'underline',
		},
	})
}

// Mirrors the native splash (see app.json `expo-splash-screen` config) so the
// transition is seamless, then layers the version label at the bottom.
function LoadingScreen() {
	const { resolved } = useTheme()
	const isDark = resolved === 'dark'
	return (
		<View
			style={{
				flex: 1,
				backgroundColor: isDark ? '#000000' : '#ffffff',
				alignItems: 'center',
				justifyContent: 'center',
			}}
		>
			<Image
				source={require('../assets/images/splash-icon.png')}
				style={{ width: 200, height: 200 }}
				resizeMode="contain"
			/>
			<Text
				style={{
					position: 'absolute',
					bottom: 32,
					fontSize: 12,
					color: isDark ? '#666666' : '#999999',
				}}
			>
				{VERSION_LABEL}
			</Text>
		</View>
	)
}
