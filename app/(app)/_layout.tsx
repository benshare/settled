import { TabBarIcon } from '@/lib/modules/TabBarIcon'
import { useAuth } from '@/lib/auth'
import { loadAllUserStores } from '@/lib/stores'
import { useFriendsStore } from '@/lib/stores/useFriendsStore'
import { colors } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import { useEffect } from 'react'

export const unstable_settings = {
	initialRouteName: 'play',
}

export default function AppLayout() {
	const { user } = useAuth()

	useEffect(() => {
		if (user?.id) {
			loadAllUserStores(user.id)
		}
	}, [user?.id])

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
						<Ionicons
							name="game-controller-outline"
							color={color}
							size={size}
						/>
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
