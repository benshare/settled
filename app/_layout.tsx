import { AuthProvider, useAuth } from '@/lib/auth'
import { loadAllUserStores } from '@/lib/stores'
import { ThemeProvider, useTheme } from '@/lib/ThemeContext'
import Constants from 'expo-constants'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import * as Updates from 'expo-updates'
import { useEffect, useState } from 'react'
import { Image, Platform, Text, View } from 'react-native'
import 'react-native-reanimated'

const APP_VERSION = Constants.expoConfig?.version ?? '?'
// `Updates.createdAt` is the publish time of the running JS bundle — for OTA
// builds this changes each release, for dev/Expo Go it's null.
const OTA_DATE = Updates.createdAt
	? Updates.createdAt.toISOString().slice(0, 10)
	: null
const VERSION_LABEL = OTA_DATE
	? `v${APP_VERSION} · ${OTA_DATE}`
	: `v${APP_VERSION} · dev`

// Desktop browsers stretch the native layout to the full viewport, which
// looks broken for a phone-first app. On web we clamp the whole app to a
// mobile-width column and center it; on native we pass through.
const WEB_MAX_WIDTH = 560
const isWeb = Platform.OS === 'web'

export { ErrorBoundary } from 'expo-router'

export const unstable_settings = {
	initialRouteName: 'index',
}

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
	return (
		<ThemeProvider>
			<AuthProvider>
				<RootNav />
			</AuthProvider>
		</ThemeProvider>
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
				<Stack
					screenOptions={{ headerShown: false, animation: 'fade' }}
				>
					<Stack.Screen name="index" />
					<Stack.Screen name="(auth)" />
					<Stack.Screen name="(app)" />
					<Stack.Screen name="send-request" />
				</Stack>
			</View>
		</View>
	)
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
