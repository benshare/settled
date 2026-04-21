import { AuthProvider, useAuth } from '@/lib/auth'
import { loadAllUserStores } from '@/lib/stores'
import { ThemeProvider, useTheme } from '@/lib/ThemeContext'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { View } from 'react-native'
import 'react-native-reanimated'

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
		<View style={{ flex: 1, backgroundColor: colors.background }}>
			<StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
			<Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
				<Stack.Screen name="index" />
				<Stack.Screen name="(auth)" />
				<Stack.Screen name="(app)" />
				<Stack.Screen name="send-request" />
			</Stack>
		</View>
	)
}
