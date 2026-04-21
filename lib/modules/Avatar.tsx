import { Image } from 'expo-image'
import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { Profile } from '../stores/useProfileStore'
import { supabase } from '../supabase'
import { useTheme } from '../ThemeContext'
import { ColorScheme } from '../theme'

interface AvatarProps {
	profile: Profile | null | undefined
	size?: number
}

export function getAvatarUrl(path: string, cacheBust?: string): string {
	const { data } = supabase.storage.from('avatars').getPublicUrl(path)
	return cacheBust
		? `${data.publicUrl}?v=${encodeURIComponent(cacheBust)}`
		: data.publicUrl
}

export function Avatar({ profile, size = 72 }: AvatarProps) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	const initial = profile?.username?.[0]?.toUpperCase() ?? '?'
	const fontSize = Math.round(size * 0.42)

	const containerStyle = {
		width: size,
		height: size,
		borderRadius: size / 2,
	}

	if (profile?.avatar_path) {
		const uri = getAvatarUrl(profile.avatar_path, profile.updated_at)
		return (
			<Image
				source={{ uri }}
				style={[styles.image, containerStyle]}
				contentFit="cover"
				transition={150}
			/>
		)
	}

	return (
		<View style={[styles.fallback, containerStyle]}>
			<Text style={[styles.initial, { fontSize, lineHeight: fontSize }]}>
				{initial}
			</Text>
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		image: {
			backgroundColor: colors.card,
		},
		fallback: {
			backgroundColor: colors.brandDim,
			borderWidth: 2,
			borderColor: colors.brand,
			alignItems: 'center',
			justifyContent: 'center',
		},
		initial: {
			fontWeight: '800',
			color: colors.brand,
			includeFontPadding: false,
			textAlignVertical: 'center',
		},
	})
}
