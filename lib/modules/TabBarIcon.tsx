import { Ionicons } from '@expo/vector-icons'
import React from 'react'
import { View } from 'react-native'
import { useTheme } from '../ThemeContext'

interface TabBarIconProps {
	name: React.ComponentProps<typeof Ionicons>['name']
	color: string
	size: number
	showDot?: boolean
}

export function TabBarIcon({ name, color, size, showDot }: TabBarIconProps) {
	const { colors } = useTheme()
	return (
		<View>
			<Ionicons name={name} color={color} size={size} />
			{showDot && (
				<View
					style={{
						position: 'absolute',
						top: -1,
						right: -3,
						width: 9,
						height: 9,
						borderRadius: 999,
						backgroundColor: colors.error,
						borderWidth: 1.5,
						borderColor: colors.background,
					}}
				/>
			)}
		</View>
	)
}
