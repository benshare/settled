import { AuthProvider, useAuth } from '@/lib/auth'
import { loadAllUserStores } from '@/lib/stores'
import { ThemeProvider, useTheme } from '@/lib/ThemeContext'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import 'react-native-reanimated'

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

	useEffect(() => {
		if (user?.id) {
			loadAllUserStores(user.id)
		}
	}, [user?.id])

	useEffect(() => {
		if (!loading) {
			SplashScreen.hideAsync()
		}
	}, [loading])

	if (loading) return null

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
