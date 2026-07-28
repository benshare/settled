import { useAuth } from '@/lib/auth'
import { TabBarIcon } from '@/lib/modules/TabBarIcon'
import {
	ensurePermissionAndRegister,
	resolveNotificationLink,
} from '@/lib/notifications'
import { useFriendsStore } from '@/lib/stores/useFriendsStore'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { Tabs, useRouter } from 'expo-router'
import { useEffect } from 'react'
import { type ColorValue, Platform } from 'react-native'

export const unstable_settings = {
	initialRouteName: 'games',
}

export default function AppLayout() {
	const { colors } = useTheme()
	const { user } = useAuth()
	const router = useRouter()

	useEffect(() => {
		if (!user?.id) return
		ensurePermissionAndRegister(user.id)
	}, [user?.id])

	useEffect(() => {
		if (Platform.OS === 'web') return
		const sub = Notifications.addNotificationResponseReceivedListener(
			(resp) => {
				const link = resolveNotificationLink(
					resp.notification.request.content.data
				)
				// `navigate`, not `push`: when the game screen is already on
				// top, this updates its params in place instead of stacking a
				// second copy of the same game behind the back chevron.
				if (link) router.navigate(link)
			}
		)
		// Cold-start case: the app was launched by tapping a notification.
		Notifications.getLastNotificationResponseAsync().then((resp) => {
			if (!resp) return
			const link = resolveNotificationLink(
				resp.notification.request.content.data
			)
			if (link) router.replace(link)
		})
		return () => sub.remove()
	}, [router])

	return (
		<Tabs
			screenOptions={{
				headerShown: false,
				tabBarActiveTintColor: colors.brand,
				tabBarInactiveTintColor: colors.textMuted,
				tabBarStyle: {
					backgroundColor: colors.background,
					borderTopColor: colors.border,
				},
			}}
		>
			<Tabs.Screen
				name="games"
				options={{
					title: 'Games',
					tabBarIcon: ({ color, size }) => (
						<GamesTabIcon color={color} size={size} />
					),
				}}
			/>
			<Tabs.Screen
				name="stats"
				options={{
					title: 'Stats',
					tabBarIcon: ({ color, size }) => (
						<Ionicons
							name="stats-chart-outline"
							color={color}
							size={size}
						/>
					),
				}}
			/>
			<Tabs.Screen
				name="friends"
				options={{
					title: 'Friends',
					tabBarIcon: ({ color, size }) => (
						<FriendsTabIcon color={color} size={size} />
					),
				}}
			/>
			<Tabs.Screen
				name="account"
				options={{
					title: 'Account',
					tabBarIcon: ({ color, size }) => (
						<Ionicons
							name="person-outline"
							color={color}
							size={size}
						/>
					),
				}}
			/>
			<Tabs.Screen name="create-game" options={{ href: null }} />
		</Tabs>
	)
}

function FriendsTabIcon({ color, size }: { color: ColorValue; size: number }) {
	const incomingCount = useFriendsStore((s) => s.pendingIncoming.length)
	return (
		<TabBarIcon
			name="people-outline"
			color={color}
			size={size}
			showDot={incomingCount > 0}
		/>
	)
}

function GamesTabIcon({ color, size }: { color: ColorValue; size: number }) {
	const { user } = useAuth()
	const meId = user?.id
	const showDot = useGamesStore((s) => {
		if (!meId) return false
		return (s.pendingRequests ?? []).some((r) => {
			const mine = r.invited.find((i) => i.user === meId)
			if (!mine || mine.status !== 'pending') return false
			return !r.invited.some((i) => i.status === 'rejected')
		})
	})
	return (
		<TabBarIcon
			name="game-controller-outline"
			color={color}
			size={size}
			showDot={showDot}
		/>
	)
}
