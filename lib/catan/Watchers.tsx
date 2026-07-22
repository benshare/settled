// Spectator presence UI. The roster comes from <GameProvider>'s ephemeral
// presence channel — see gameContext.tsx and .claude/specs/spectating.md.
//
// `WatcherButton` is the fourth floating affordance in the board container's
// button column, below BoardLegend / ActionLog / ChatButton. It hides itself
// entirely when nobody is watching, so a game with no audience looks exactly
// as it did before this feature.

import { Ionicons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Avatar } from '../modules/Avatar'
import { Modal } from '../modules/Modal'
import { useGamesStore } from '../stores/useGamesStore'
import { colors, font, spacing, z } from '../theme'
import { useGame } from './gameContext'

// Matches BUTTON_INSET / the 32 + spacing.xs slot pitch in GameChat.tsx.
const BUTTON_INSET = spacing.sm
const SLOT = 32 + spacing.xs

export function WatcherButton() {
	const { watcherIds } = useGame()
	const [open, setOpen] = useState(false)
	const profilesById = useGamesStore((s) => s.profilesById)
	const ensureProfiles = useGamesStore((s) => s.ensureProfiles)

	// A watcher can be a friend-of-a-player the viewer has never met, so their
	// profile was never in any participant list this client fetched.
	useEffect(() => {
		if (watcherIds.length > 0) ensureProfiles(watcherIds)
	}, [watcherIds, ensureProfiles])

	// Nothing to say when nobody is watching, and a permanently-zero badge
	// would just be clutter on the majority of games.
	if (watcherIds.length === 0) return null

	return (
		<>
			<Pressable
				onPress={() => setOpen(true)}
				style={({ pressed }) => [
					styles.button,
					pressed && styles.pressed,
				]}
				hitSlop={6}
				accessibilityLabel={`${watcherIds.length} watching`}
			>
				<Ionicons name="eye-outline" size={20} color={colors.text} />
				<View style={styles.badge}>
					<Text style={styles.badgeText}>
						{watcherIds.length > 9 ? '9+' : watcherIds.length}
					</Text>
				</View>
			</Pressable>

			<Modal visible={open} onDismiss={() => setOpen(false)}>
				<Text style={styles.title}>
					{watcherIds.length === 1
						? '1 person watching'
						: `${watcherIds.length} people watching`}
				</Text>
				<View style={styles.list}>
					{watcherIds.map((id) => {
						const profile = profilesById[id]
						return (
							<View key={id} style={styles.row}>
								{profile ? (
									<Avatar profile={profile} size={32} />
								) : (
									<View style={styles.avatarPlaceholder} />
								)}
								<Text style={styles.name} numberOfLines={1}>
									{profile?.username ?? '…'}
								</Text>
							</View>
						)
					})}
				</View>
			</Modal>
		</>
	)
}

const styles = StyleSheet.create({
	button: {
		position: 'absolute',
		top: BUTTON_INSET + 3 * SLOT,
		right: spacing.sm,
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.card,
		borderWidth: 1,
		borderColor: colors.border,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.12,
		shadowRadius: 6,
		elevation: 3,
		zIndex: z.floatingButton,
	},
	pressed: {
		opacity: 0.7,
	},
	badge: {
		position: 'absolute',
		top: -4,
		right: -4,
		minWidth: 16,
		height: 16,
		borderRadius: 8,
		paddingHorizontal: 3,
		backgroundColor: colors.brand,
		alignItems: 'center',
		justifyContent: 'center',
	},
	badgeText: {
		fontSize: font.xs,
		fontWeight: '700',
		color: colors.white,
	},
	title: {
		fontSize: font.md,
		fontWeight: '700',
		color: colors.text,
		marginBottom: spacing.md,
	},
	list: {
		gap: spacing.sm,
	},
	row: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing.sm,
	},
	avatarPlaceholder: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: colors.border,
	},
	name: {
		flex: 1,
		fontSize: font.base,
		color: colors.text,
	},
})
