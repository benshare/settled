import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import {
	IncomingRequest,
	OutgoingRequest,
	useFriendsStore,
} from '@/lib/stores/useFriendsStore'
import type { Profile } from '@/lib/stores/useProfileStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function FriendsScreen() {
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const friends = useFriendsStore((s) => s.friends)
	const pendingIncoming = useFriendsStore((s) => s.pendingIncoming)
	const pendingOutgoing = useFriendsStore((s) => s.pendingOutgoing)
	const loading = useFriendsStore((s) => s.loading)

	const showBanner = pendingIncoming.length + pendingOutgoing.length > 0

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.header}>
					<Text style={styles.title}>Friends</Text>
					<Pressable
						onPress={() => router.push('/send-request')}
						style={({ pressed }) => [
							styles.addButton,
							pressed && styles.pressed,
						]}
						hitSlop={8}
					>
						<Ionicons
							name="person-add-outline"
							size={22}
							color={colors.text}
						/>
					</Pressable>
				</View>

				{showBanner && (
					<ManageRequestsBanner
						incoming={pendingIncoming}
						outgoing={pendingOutgoing}
					/>
				)}

				{loading && friends.length === 0 ? (
					<ActivityIndicator color={colors.textMuted} />
				) : friends.length === 0 ? (
					<Text style={styles.emptyText}>
						No friends yet. Tap + to add one.
					</Text>
				) : (
					<View style={styles.list}>
						{friends.map((f) => (
							<FriendRow key={f.otherId} profile={f.profile} />
						))}
					</View>
				)}
			</ScrollView>
		</SafeAreaView>
	)
}

function ManageRequestsBanner({
	incoming,
	outgoing,
}: {
	incoming: IncomingRequest[]
	outgoing: OutgoingRequest[]
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.banner}>
			{incoming.length > 0 && (
				<View style={styles.bannerSection}>
					<Text style={styles.bannerHeading}>Requests</Text>
					{incoming.map((r) => (
						<IncomingRow key={r.request.id} incoming={r} />
					))}
				</View>
			)}
			{outgoing.length > 0 && (
				<View style={styles.bannerSection}>
					<Text style={styles.bannerHeading}>Sent</Text>
					{outgoing.map((r) => (
						<OutgoingRow key={r.request.id} outgoing={r} />
					))}
				</View>
			)}
		</View>
	)
}

function IncomingRow({ incoming }: { incoming: IncomingRequest }) {
	const { user } = useAuth()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const acceptRequest = useFriendsStore((s) => s.acceptRequest)
	const rejectRequest = useFriendsStore((s) => s.rejectRequest)
	const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function onAccept() {
		if (!user?.id) return
		setBusy('accept')
		setError(null)
		const { error } = await acceptRequest(user.id, incoming.request.id)
		setBusy(null)
		if (error) setError(error)
	}

	async function onReject() {
		setBusy('reject')
		setError(null)
		const { error } = await rejectRequest(incoming.request.id)
		setBusy(null)
		if (error) setError(error)
	}

	return (
		<View>
			<View style={styles.row}>
				<Avatar profile={incoming.profile} size={40} />
				<Text style={styles.rowUsername} numberOfLines={1}>
					{incoming.profile.username}
				</Text>
				<Button
					onPress={onAccept}
					loading={busy === 'accept'}
					disabled={busy !== null}
					style={styles.rowAction}
				>
					Accept
				</Button>
				<Button
					variant="secondary"
					onPress={onReject}
					loading={busy === 'reject'}
					disabled={busy !== null}
					style={styles.rowAction}
				>
					Reject
				</Button>
			</View>
			{error && <Text style={styles.errorText}>{error}</Text>}
		</View>
	)
}

function OutgoingRow({ outgoing }: { outgoing: OutgoingRequest }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const cancelRequest = useFriendsStore((s) => s.cancelRequest)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function onCancel() {
		setBusy(true)
		setError(null)
		const { error } = await cancelRequest(outgoing.request.id)
		setBusy(false)
		if (error) setError(error)
	}

	return (
		<View>
			<View style={styles.row}>
				<Avatar profile={outgoing.profile} size={40} />
				<Text style={styles.rowUsername} numberOfLines={1}>
					{outgoing.profile.username}
				</Text>
				<Button
					variant="secondary"
					onPress={onCancel}
					loading={busy}
					disabled={busy}
					style={styles.rowAction}
				>
					Cancel
				</Button>
			</View>
			{error && <Text style={styles.errorText}>{error}</Text>}
		</View>
	)
}

function FriendRow({ profile }: { profile: Profile }) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.row}>
			<Avatar profile={profile} size={40} />
			<Text style={styles.rowUsername} numberOfLines={1}>
				{profile.username}
			</Text>
		</View>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		container: {
			padding: spacing.lg,
			gap: spacing.lg,
		},
		header: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
		},
		title: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		addButton: {
			width: 40,
			height: 40,
			borderRadius: 999,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.card,
			borderWidth: 1,
			borderColor: colors.border,
		},
		pressed: {
			opacity: 0.7,
		},
		banner: {
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
			borderRadius: radius.md,
			padding: spacing.md,
			gap: spacing.md,
		},
		bannerSection: {
			gap: spacing.sm,
		},
		bannerHeading: {
			fontSize: font.sm,
			fontWeight: '600',
			letterSpacing: 0.5,
			textTransform: 'uppercase',
			color: colors.textSecondary,
		},
		list: {
			gap: spacing.sm,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
		},
		rowUsername: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		rowAction: {
			paddingHorizontal: spacing.md,
			minHeight: 40,
			paddingVertical: 0,
		},
		emptyText: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.xl,
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
			marginTop: spacing.xs,
		},
	})
}
