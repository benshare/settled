import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { type InvitedEntry, useGamesStore } from '@/lib/stores/useGamesStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function PendingGameScreen() {
	const { id } = useLocalSearchParams<{ id: string }>()
	const { user } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const request = useGamesStore((s) =>
		(s.pendingRequests ?? []).find((r) => r.id === id)
	)
	const profilesById = useGamesStore((s) => s.profilesById)
	const respond = useGamesStore((s) => s.respond)

	const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function onRespond(accept: boolean) {
		if (!user?.id || !request) return
		setBusy(accept ? 'accept' : 'reject')
		setError(null)
		const { error, gameId } = await respond(user.id, request.id, accept)
		setBusy(null)
		if (error) {
			setError(error)
			return
		}
		if (gameId) {
			router.replace(`/game/${gameId}`)
		} else {
			router.back()
		}
	}

	return (
		<SafeAreaView style={styles.safe}>
			<View style={styles.header}>
				<Pressable
					onPress={() => router.back()}
					hitSlop={8}
					style={({ pressed }) => [
						styles.back,
						pressed && styles.pressed,
					]}
				>
					<Ionicons
						name="chevron-back"
						size={26}
						color={colors.text}
					/>
				</Pressable>
				<Text style={styles.title}>Game invite</Text>
				<View style={styles.back} />
			</View>

			{!request ? (
				<View style={styles.body}>
					<Text style={styles.hint}>
						This invite is no longer available.
					</Text>
				</View>
			) : (
				<Body
					request={request}
					profilesById={profilesById}
					meId={user?.id}
					busy={busy}
					error={error}
					onAccept={() => onRespond(true)}
					onReject={() => onRespond(false)}
				/>
			)}
		</SafeAreaView>
	)
}

function Body({
	request,
	profilesById,
	meId,
	busy,
	error,
	onAccept,
	onReject,
}: {
	request: {
		id: string
		proposer: string
		invited: InvitedEntry[]
	}
	profilesById: Record<string, Profile>
	meId: string | undefined
	busy: 'accept' | 'reject' | null
	error: string | null
	onAccept: () => void
	onReject: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const mine = request.invited.find((i) => i.user === meId)
	const iAmProposer = meId === request.proposer
	const someoneRejected = request.invited.some((i) => i.status === 'rejected')
	const canRespond =
		mine !== undefined && mine.status === 'pending' && !someoneRejected

	let statusLine: string | null = null
	if (!canRespond) {
		if (someoneRejected) statusLine = 'Someone declined. Game cancelled.'
		else if (iAmProposer) statusLine = 'Waiting for responses.'
		else if (mine?.status === 'accepted')
			statusLine = 'You accepted. Waiting for others.'
		else if (mine?.status === 'rejected') statusLine = 'You declined.'
	}

	return (
		<ScrollView contentContainerStyle={styles.body}>
			<View style={styles.card}>
				<PersonRow
					profile={profilesById[request.proposer]}
					label="Proposer"
					youMark={iAmProposer}
				/>
				{request.invited.map((inv) => (
					<PersonRow
						key={inv.user}
						profile={profilesById[inv.user]}
						label={inviteLabel(inv.status)}
						youMark={inv.user === meId}
					/>
				))}
			</View>

			{canRespond ? (
				<View style={styles.actions}>
					{error && <Text style={styles.errorText}>{error}</Text>}
					<Button
						onPress={onAccept}
						loading={busy === 'accept'}
						disabled={busy !== null}
					>
						Accept
					</Button>
					<Button
						variant="secondary"
						onPress={onReject}
						loading={busy === 'reject'}
						disabled={busy !== null}
					>
						Reject
					</Button>
				</View>
			) : (
				statusLine && <Text style={styles.hint}>{statusLine}</Text>
			)}
		</ScrollView>
	)
}

function inviteLabel(status: InvitedEntry['status']): string {
	if (status === 'accepted') return 'Accepted'
	if (status === 'rejected') return 'Rejected'
	return 'Pending'
}

function PersonRow({
	profile,
	label,
	youMark,
}: {
	profile: Profile | undefined
	label: string
	youMark?: boolean
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.personRow}>
			{profile ? (
				<Avatar profile={profile} size={40} />
			) : (
				<View style={styles.avatarPlaceholder} />
			)}
			<Text style={styles.personName} numberOfLines={1}>
				{profile?.username ?? '…'}
				{youMark ? ' (you)' : ''}
			</Text>
			<Text style={styles.personLabel}>{label}</Text>
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			paddingHorizontal: spacing.md,
			paddingTop: spacing.sm,
			paddingBottom: spacing.sm,
		},
		back: {
			width: 40,
			height: 40,
			alignItems: 'center',
			justifyContent: 'center',
		},
		pressed: {
			opacity: 0.7,
		},
		title: {
			fontSize: font.md,
			fontWeight: '700',
			color: colors.text,
		},
		body: {
			padding: spacing.lg,
			gap: spacing.lg,
		},
		card: {
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.md,
			gap: spacing.md,
		},
		personRow: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
		},
		avatarPlaceholder: {
			width: 40,
			height: 40,
		},
		personName: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		personLabel: {
			fontSize: font.sm,
			color: colors.textSecondary,
		},
		actions: {
			gap: spacing.sm,
		},
		hint: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
			textAlign: 'center',
		},
	})
}
