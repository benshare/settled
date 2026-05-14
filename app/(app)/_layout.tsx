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

export const unstable_settings = {
	initialRouteName: 'play',
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
		const sub = Notifications.addNotificationResponseReceivedListener(
			(resp) => {
				const link = resolveNotificationLink(
					resp.notification.request.content.data
				)
				if (link) router.push(link)
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
				name="play"
				options={{
					title: 'Play',
					tabBarIcon: ({ color, size }) => (
						<PlayTabIcon color={color} size={size} />
					),
				}}
			/>
			<Tabs.Screen
				name="history"
				options={{
					title: 'History',
					tabBarIcon: ({ color, size }) => (
						<Ionicons
							name="time-outline"
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

function FriendsTabIcon({ color, size }: { color: string; size: number }) {
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

function PlayTabIcon({ color, size }: { color: string; size: number }) {
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
