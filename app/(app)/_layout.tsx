import { useAdminStore } from '@/lib/admin'
import { useAuth } from '@/lib/auth'
import { TabBarIcon } from '@/lib/modules/TabBarIcon'
import { ensurePermissionAndRegister } from '@/lib/notifications'
import { useFriendsStore } from '@/lib/stores/useFriendsStore'
import { needsMyResponse, useGamesStore } from '@/lib/stores/useGamesStore'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useEffect } from 'react'
import { type ColorValue } from 'react-native'

export const unstable_settings = {
	initialRouteName: 'games',
}

export default function AppLayout() {
	const { colors } = useTheme()
	const { user } = useAuth()
	const actingAs = useAdminStore((s) => s.actingAs)
	const adminRestored = useAdminStore((s) => s.restored)

	// Registration belongs here — it is about being signed in and inside the
	// app. Routing tapped notifications is not, and lives at the root.
	//
	// Skipped while impersonating: the upsert is keyed on the token, so
	// registering would move this device's row onto the borrowed account and
	// silently redirect that person's pushes here. Held until `restored`, or a
	// launch already impersonating would race the check and register anyway.
	useEffect(() => {
		if (!user?.id || !adminRestored || actingAs) return
		ensurePermissionAndRegister(user.id)
	}, [user?.id, adminRestored, actingAs])

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
	const showDot = useGamesStore((s) =>
		(s.pendingRequests ?? []).some((r) => needsMyResponse(r, meId))
	)
	return (
		<TabBarIcon
			name="game-controller-outline"
			color={color}
			size={size}
			showDot={showDot}
		/>
	)
}
