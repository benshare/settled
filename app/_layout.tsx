import { AuthProvider, useAuth } from '@/lib/auth'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import 'react-native-reanimated'

export { ErrorBoundary } from 'expo-router'

export const unstable_settings = {
	initialRouteName: 'index',
}

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
	return (
		<AuthProvider>
			<RootNav />
		</AuthProvider>
	)
}

function RootNav() {
	const { loading } = useAuth()

	useEffect(() => {
		if (!loading) {
			SplashScreen.hideAsync()
		}
	}, [loading])

	if (loading) return null

	return (
		<>
			<StatusBar style="auto" />
			<Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
				<Stack.Screen name="index" />
				<Stack.Screen name="(auth)" />
				<Stack.Screen name="(app)" />
				<Stack.Screen name="send-request" />
			</Stack>
		</>
	)
}
