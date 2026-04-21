import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { Input } from '@/lib/modules/Input'
import { clearAllUserStores } from '@/lib/stores'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { supabase } from '@/lib/supabase'
import { ThemeMode, useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	ActivityIndicator,
	Animated,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

function validateUsername(value: string): string | null {
	if (value.length < 3) return 'At least 3 characters'
	if (value.length > 20) return '20 characters max'
	if (!USERNAME_REGEX.test(value)) return 'Letters, numbers, underscores only'
	return null
}

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
	{ key: 'light', label: 'Light' },
	{ key: 'dark', label: 'Dark' },
	{ key: 'system', label: 'System' },
]

export default function AccountScreen() {
	const { user, signOut } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const profile = useProfileStore((s) => s.profile)
	const loadProfile = useProfileStore((s) => s.loadProfile)
	const updateUsername = useProfileStore((s) => s.updateUsername)
	const updateAvatarPath = useProfileStore((s) => s.updateAvatarPath)
	const clearProfile = useProfileStore((s) => s.clearProfile)

	const [editing, setEditing] = useState(false)
	const [draft, setDraft] = useState('')
	const [formatError, setFormatError] = useState<string | null>(null)
	const [checking, setChecking] = useState(false)
	const [taken, setTaken] = useState(false)
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [uploading, setUploading] = useState(false)
	const [uploadError, setUploadError] = useState<string | null>(null)

	const checkSeq = useRef(0)

	useEffect(() => {
		if (user && !profile) {
			loadProfile(user.id)
		}
	}, [user, profile, loadProfile])

	useEffect(() => {
		if (!editing) return
		setFormatError(null)
		setTaken(false)
		setSaveError(null)

		const err = validateUsername(draft)
		if (err) {
			setFormatError(err)
			return
		}
		if (draft === profile?.username) return

		const seq = ++checkSeq.current
		setChecking(true)
		const handle = setTimeout(async () => {
			const { count, error } = await supabase
				.from('profiles')
				.select('id', { count: 'exact', head: true })
				.ilike('username', draft)
				.neq('id', user!.id)
			if (seq !== checkSeq.current) return
			setChecking(false)
			if (!error) setTaken((count ?? 0) > 0)
		}, 400)

		return () => clearTimeout(handle)
	}, [draft, editing, profile?.username, user])

	function startEditing() {
		setDraft(profile?.username ?? '')
		setFormatError(null)
		setTaken(false)
		setSaveError(null)
		setEditing(true)
	}

	function cancelEditing() {
		setEditing(false)
		setDraft('')
	}

	async function handleSave() {
		if (!profile) return
		const err = validateUsername(draft)
		if (err) {
			setFormatError(err)
			return
		}
		setSaving(true)
		setSaveError(null)
		const { error } = await updateUsername(draft)
		setSaving(false)
		if (error) {
			setSaveError(error)
			return
		}
		setEditing(false)
	}

	async function handleChangePhoto() {
		if (!user) return
		setUploadError(null)

		const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
		if (!perm.granted) {
			setUploadError('Photo library permission is required.')
			return
		}

		const result = await ImagePicker.launchImageLibraryAsync({
			mediaTypes: ['images'],
			allowsEditing: true,
			aspect: [1, 1],
			quality: 0.7,
			base64: true,
		})
		if (result.canceled || !result.assets[0]?.base64) return

		setUploading(true)
		try {
			const binary = atob(result.assets[0].base64)
			const bytes = new Uint8Array(binary.length)
			for (let i = 0; i < binary.length; i++) {
				bytes[i] = binary.charCodeAt(i)
			}
			const path = `${user.id}/avatar.jpg`
			const { error: uploadErr } = await supabase.storage
				.from('avatars')
				.upload(path, bytes, {
					contentType: 'image/jpeg',
					upsert: true,
				})
			if (uploadErr) {
				setUploadError('Upload failed. Try again.')
				return
			}
			const { error: dbErr } = await updateAvatarPath(path)
			if (dbErr) {
				setUploadError(dbErr)
				return
			}
		} finally {
			setUploading(false)
		}
	}

	async function handleSignOut() {
		clearProfile()
		clearAllUserStores()
		await signOut()
		router.replace('/')
	}

	const saveDisabled =
		saving ||
		checking ||
		!!formatError ||
		taken ||
		draft === profile?.username ||
		draft.length < 3

	const usernameError =
		formatError ?? (taken ? 'Username already taken' : saveError)

	return (
		<SafeAreaView style={styles.safe}>
			<ScrollView contentContainerStyle={styles.container}>
				<View style={styles.avatarSection}>
					<View>
						<Avatar profile={profile} size={112} />
						{uploading && (
							<View style={styles.avatarOverlay}>
								<ActivityIndicator color={colors.white} />
							</View>
						)}
					</View>
					<Pressable onPress={handleChangePhoto} disabled={uploading}>
						<Text style={styles.changePhoto}>
							{uploading ? 'Uploading…' : 'Change photo'}
						</Text>
					</Pressable>
					{uploadError && (
						<Text style={styles.errorText}>{uploadError}</Text>
					)}
					<Text style={styles.displayUsername}>
						{profile?.username ?? ''}
					</Text>
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionLabel}>Username</Text>
					{editing ? (
						<View style={styles.editBlock}>
							<Input
								value={draft}
								onChangeText={setDraft}
								autoCapitalize="none"
								autoCorrect={false}
								maxLength={20}
								autoFocus
								error={usernameError ?? undefined}
								hint={
									!usernameError && checking
										? 'Checking…'
										: undefined
								}
							/>
							<View style={styles.editActions}>
								<Button
									variant="secondary"
									onPress={cancelEditing}
									style={styles.editButton}
								>
									Cancel
								</Button>
								<Button
									loading={saving}
									disabled={saveDisabled}
									onPress={handleSave}
									style={styles.editButton}
								>
									Save
								</Button>
							</View>
						</View>
					) : (
						<Pressable
							onPress={startEditing}
							style={({ pressed }) => [
								styles.row,
								pressed && styles.rowPressed,
							]}
						>
							<Text style={styles.rowValue}>
								{profile?.username ?? 'Set username'}
							</Text>
							<Text style={styles.rowAction}>Edit</Text>
						</Pressable>
					)}
				</View>

				<View style={styles.section}>
					<Text style={styles.sectionLabel}>Appearance</Text>
					<ThemeSegmentControl />
				</View>

				<View style={styles.signOutWrap}>
					<Button variant="secondary" onPress={handleSignOut}>
						Sign out
					</Button>
				</View>
			</ScrollView>
		</SafeAreaView>
	)
}

function ThemeSegmentControl() {
	const { colors, mode, setMode } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const [containerWidth, setContainerWidth] = useState(0)
	const activeIndex = THEME_OPTIONS.findIndex((o) => o.key === mode)
	const [slideAnim] = useState(() => new Animated.Value(activeIndex))

	useEffect(() => {
		Animated.spring(slideAnim, {
			toValue: activeIndex,
			useNativeDriver: true,
			damping: 20,
			stiffness: 200,
		}).start()
	}, [activeIndex, slideAnim])

	const pillWidth = containerWidth > 0 ? (containerWidth - 12) / 3 : 0
	const translateX = slideAnim.interpolate({
		inputRange: [0, 1, 2],
		outputRange: [4, 4 + pillWidth + 2, 4 + (pillWidth + 2) * 2],
	})

	return (
		<View
			style={styles.segmentControl}
			onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
		>
			{containerWidth > 0 && (
				<Animated.View
					style={[
						styles.slidingPill,
						{
							width: pillWidth,
							transform: [{ translateX }],
						},
					]}
				/>
			)}
			{THEME_OPTIONS.map((opt) => {
				const isActive = mode === opt.key
				return (
					<Pressable
						key={opt.key}
						style={styles.segmentPill}
						onPress={() => setMode(opt.key)}
					>
						<Text
							style={[
								styles.segmentLabel,
								{
									color: isActive
										? colors.white
										: colors.textSecondary,
								},
							]}
						>
							{opt.label}
						</Text>
					</Pressable>
				)
			})}
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
			gap: spacing.xl,
		},
		avatarSection: {
			alignItems: 'center',
			gap: spacing.sm,
			marginTop: spacing.lg,
		},
		avatarOverlay: {
			...StyleSheet.absoluteFillObject,
			borderRadius: 999,
			backgroundColor: 'rgba(0,0,0,0.45)',
			alignItems: 'center',
			justifyContent: 'center',
		},
		changePhoto: {
			fontSize: font.base,
			fontWeight: '600',
			color: colors.brand,
			paddingVertical: spacing.xs,
		},
		displayUsername: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
			marginTop: spacing.sm,
		},
		section: {
			gap: spacing.sm,
		},
		sectionLabel: {
			fontSize: font.sm,
			fontWeight: '600',
			letterSpacing: 0.5,
			textTransform: 'uppercase',
			color: colors.textSecondary,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			minHeight: 52,
			paddingHorizontal: spacing.md,
			borderRadius: radius.md,
			borderWidth: 1,
			borderColor: colors.border,
			backgroundColor: colors.card,
		},
		rowPressed: {
			opacity: 0.7,
		},
		rowValue: {
			fontSize: font.md,
			color: colors.text,
		},
		rowAction: {
			fontSize: font.base,
			color: colors.brand,
			fontWeight: '600',
		},
		editBlock: {
			gap: spacing.sm,
		},
		editActions: {
			flexDirection: 'row',
			gap: spacing.sm,
		},
		editButton: {
			flex: 1,
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
		},
		signOutWrap: {
			marginTop: spacing.xl,
		},
		segmentControl: {
			flexDirection: 'row',
			borderRadius: radius.full,
			padding: 4,
			gap: 2,
			backgroundColor: colors.cardAlt,
		},
		slidingPill: {
			position: 'absolute',
			top: 4,
			bottom: 4,
			borderRadius: radius.full,
			backgroundColor: colors.brand,
		},
		segmentPill: {
			flex: 1,
			paddingVertical: spacing.sm,
			borderRadius: radius.full,
			alignItems: 'center',
		},
		segmentLabel: {
			fontSize: font.sm,
			fontWeight: '600',
		},
	})
}
