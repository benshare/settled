import { useAuth } from '@/lib/auth'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { Input } from '@/lib/modules/Input'
import { useFriendsStore, type FriendEntry } from '@/lib/stores/useFriendsStore'
import { useGamesStore } from '@/lib/stores/useGamesStore'
import {
	DEFAULT_GAME_DEFAULTS,
	parseGameDefaults,
	useProfileStore,
	type GameDefaults,
} from '@/lib/stores/useProfileStore'
import { useTheme } from '@/lib/ThemeContext'
import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function CreateGameScreen() {
	const { user } = useAuth()
	const router = useRouter()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const friends = useFriendsStore((s) => s.friends)
	const createRequest = useGamesStore((s) => s.createRequest)
	const profile = useProfileStore((s) => s.profile)
	const updateGameDefaults = useProfileStore((s) => s.updateGameDefaults)

	// Snapshot of the user's saved defaults. We compare the current form
	// against this to decide whether to show the "Save options" button.
	const savedDefaults: GameDefaults = profile?.game_defaults
		? parseGameDefaults(profile.game_defaults)
		: DEFAULT_GAME_DEFAULTS

	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [bonuses, setBonuses] = useState(savedDefaults.extras.bonuses)
	const [devCards, setDevCards] = useState(savedDefaults.settings.devCards)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [extrasOpen, setExtrasOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [savingDefaults, setSavingDefaults] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// If the profile loads after mount, reset form fields to match the
	// freshly-loaded saved values. Users who touched the toggles before the
	// load completed keep their edits.
	const [touched, setTouched] = useState(false)
	const savedBonuses = savedDefaults.extras.bonuses
	const savedDevCards = savedDefaults.settings.devCards
	useEffect(() => {
		if (touched) return
		setBonuses(savedBonuses)
		setDevCards(savedDevCards)
	}, [savedBonuses, savedDevCards, touched])

	const currentDefaults: GameDefaults = {
		settings: { devCards },
		extras: { bonuses },
	}
	const dirty =
		currentDefaults.settings.devCards !== savedDefaults.settings.devCards ||
		currentDefaults.extras.bonuses !== savedDefaults.extras.bonuses

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return friends
		return friends.filter((f) =>
			f.profile.username.toLowerCase().includes(q)
		)
	}, [friends, query])

	function toggle(id: string) {
		setSelected((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	async function onCreate() {
		if (!user?.id || selected.size === 0) return
		setBusy(true)
		setError(null)
		const { error } = await createRequest(user.id, Array.from(selected), {
			bonuses,
			devCards,
		})
		setBusy(false)
		if (error) {
			setError(error)
			return
		}
		router.replace('/play')
	}

	async function onSaveDefaults() {
		setSavingDefaults(true)
		const { error } = await updateGameDefaults(currentDefaults)
		setSavingDefaults(false)
		if (error) setError(error)
	}

	return (
		<SafeAreaView style={styles.safe}>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : undefined}
			>
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
					<Text style={styles.title}>Create game</Text>
					<View style={styles.back} />
				</View>

				{friends.length === 0 ? (
					<View style={styles.emptyWrap}>
						<Text style={styles.hint}>
							Add friends before starting a game.
						</Text>
					</View>
				) : (
					<>
						<ScrollView
							contentContainerStyle={styles.container}
							keyboardShouldPersistTaps="handled"
						>
							<Input
								value={query}
								onChangeText={setQuery}
								placeholder="Search friends"
								autoCapitalize="none"
								autoCorrect={false}
							/>

							{filtered.length === 0 ? (
								<Text style={styles.hint}>
									No friends match.
								</Text>
							) : (
								<View style={styles.list}>
									{filtered.map((f) => (
										<FriendToggleRow
											key={f.otherId}
											friend={f}
											selected={selected.has(f.otherId)}
											onToggle={() => toggle(f.otherId)}
										/>
									))}
								</View>
							)}

							<View style={styles.optionsBlock}>
								<View style={styles.optionsHeaderRow}>
									<Text style={styles.optionsHeading}>
										Options
									</Text>
									{dirty && (
										<Pressable
											onPress={onSaveDefaults}
											disabled={savingDefaults}
											style={({ pressed }) => [
												styles.saveDefaultsBtn,
												pressed &&
													!savingDefaults &&
													styles.pressed,
											]}
										>
											<Ionicons
												name="bookmark-outline"
												size={14}
												color={colors.brand}
											/>
											<Text
												style={styles.saveDefaultsText}
											>
												{savingDefaults
													? 'Saving…'
													: 'Save options'}
											</Text>
										</Pressable>
									)}
								</View>

								<CollapsibleSection
									title="Game settings"
									open={settingsOpen}
									onToggle={() => setSettingsOpen((v) => !v)}
									first
								>
									<CompactToggleRow
										icon="albums"
										title="Dev cards"
										description="Buy Knights, VPs, and special cards during play."
										value={devCards}
										onToggle={() => {
											setDevCards((v) => !v)
											setTouched(true)
										}}
									/>
								</CollapsibleSection>

								<CollapsibleSection
									title="Extras"
									open={extrasOpen}
									onToggle={() => setExtrasOpen((v) => !v)}
								>
									<CompactToggleRow
										icon="sparkles"
										title="Bonuses"
										description="Players draw a bonus and a curse before placement."
										value={bonuses}
										onToggle={() => {
											setBonuses((v) => !v)
											setTouched(true)
										}}
									/>
								</CollapsibleSection>
							</View>
						</ScrollView>

						<View style={styles.footer}>
							{error && (
								<Text style={styles.errorText}>{error}</Text>
							)}
							<Button
								onPress={onCreate}
								loading={busy}
								disabled={busy || selected.size === 0}
							>
								{selected.size === 0
									? 'Create game'
									: `Create game (${selected.size})`}
							</Button>
						</View>
					</>
				)}
			</KeyboardAvoidingView>
		</SafeAreaView>
	)
}

function CollapsibleSection({
	title,
	open,
	onToggle,
	first,
	children,
}: {
	title: string
	open: boolean
	onToggle: () => void
	// Suppresses the top divider on the first section in a group.
	first?: boolean
	children: React.ReactNode
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View
			style={[
				styles.collapsibleWrap,
				first && styles.collapsibleWrapFirst,
			]}
		>
			<Pressable
				onPress={onToggle}
				style={({ pressed }) => [
					styles.collapsibleHeader,
					pressed && styles.pressed,
				]}
			>
				<Text style={styles.collapsibleTitle}>{title}</Text>
				<Ionicons
					name={open ? 'chevron-up' : 'chevron-down'}
					size={16}
					color={colors.textMuted}
				/>
			</Pressable>
			{open && <View style={styles.collapsibleBody}>{children}</View>}
		</View>
	)
}

function CompactToggleRow({
	icon,
	title,
	description,
	value,
	onToggle,
}: {
	icon: React.ComponentProps<typeof Ionicons>['name']
	title: string
	description: string
	value: boolean
	onToggle: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={onToggle}
			style={({ pressed }) => [
				styles.compactRow,
				pressed && styles.pressed,
			]}
		>
			<Ionicons name={icon} size={18} color={colors.textSecondary} />
			<View style={styles.compactTextWrap}>
				<Text style={styles.compactTitle}>{title}</Text>
				<Text style={styles.compactDescription}>{description}</Text>
			</View>
			<View
				style={[styles.pillTrack, value && styles.pillTrackOn]}
				pointerEvents="none"
			>
				<View style={[styles.pillThumb, value && styles.pillThumbOn]} />
			</View>
		</Pressable>
	)
}

function FriendToggleRow({
	friend,
	selected,
	onToggle,
}: {
	friend: FriendEntry
	selected: boolean
	onToggle: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={onToggle}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<Avatar profile={friend.profile} size={40} />
			<Text style={styles.rowUsername} numberOfLines={1}>
				{friend.profile.username}
			</Text>
			<View style={[styles.check, selected && styles.checkSelected]}>
				{selected && (
					<Ionicons name="checkmark" size={18} color={colors.white} />
				)}
			</View>
		</Pressable>
	)
}

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		flex: {
			flex: 1,
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
		container: {
			padding: spacing.lg,
			gap: spacing.md,
		},
		hint: {
			fontSize: font.base,
			color: colors.textMuted,
			textAlign: 'center',
			marginTop: spacing.lg,
		},
		emptyWrap: {
			flex: 1,
			padding: spacing.lg,
		},
		list: {
			gap: spacing.sm,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.sm,
		},
		rowUsername: {
			flex: 1,
			fontSize: font.md,
			color: colors.text,
		},
		check: {
			width: 28,
			height: 28,
			borderRadius: 999,
			borderWidth: 1.5,
			borderColor: colors.border,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.background,
		},
		checkSelected: {
			backgroundColor: colors.brand,
			borderColor: colors.brand,
		},
		optionsBlock: {
			marginTop: spacing.xl,
			gap: spacing.sm,
		},
		optionsHeaderRow: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			marginBottom: spacing.xs,
		},
		optionsHeading: {
			fontSize: font.md,
			fontWeight: '700',
			color: colors.text,
		},
		collapsibleWrap: {
			borderTopWidth: 1,
			borderTopColor: colors.borderLight,
			paddingTop: spacing.sm,
		},
		collapsibleWrapFirst: {
			borderTopWidth: 0,
			paddingTop: 0,
		},
		collapsibleHeader: {
			flexDirection: 'row',
			alignItems: 'center',
			justifyContent: 'space-between',
			paddingVertical: spacing.xs,
		},
		collapsibleTitle: {
			fontSize: font.sm,
			fontWeight: '700',
			color: colors.textMuted,
			textTransform: 'uppercase',
			letterSpacing: 0.5,
		},
		collapsibleBody: {
			paddingTop: spacing.xs,
		},
		compactRow: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: spacing.xs,
		},
		compactTextWrap: {
			flex: 1,
		},
		compactTitle: {
			fontSize: font.base,
			color: colors.text,
			fontWeight: '600',
		},
		compactDescription: {
			fontSize: font.xs,
			color: colors.textMuted,
		},
		pillTrack: {
			width: 34,
			height: 20,
			borderRadius: radius.full,
			backgroundColor: colors.cardAlt,
			borderWidth: 1,
			borderColor: colors.border,
			justifyContent: 'center',
			paddingHorizontal: 2,
		},
		pillTrackOn: {
			backgroundColor: colors.brand,
			borderColor: colors.brand,
		},
		pillThumb: {
			width: 14,
			height: 14,
			borderRadius: radius.full,
			backgroundColor: colors.white,
		},
		pillThumbOn: {
			transform: [{ translateX: 14 }],
		},
		saveDefaultsBtn: {
			flexDirection: 'row',
			alignItems: 'center',
			alignSelf: 'flex-start',
			gap: 6,
			paddingVertical: spacing.xs,
			paddingHorizontal: spacing.sm,
			borderRadius: radius.full,
			borderWidth: 1,
			borderColor: colors.brand,
		},
		saveDefaultsText: {
			fontSize: font.sm,
			color: colors.brand,
			fontWeight: '600',
		},
		footer: {
			padding: spacing.lg,
			gap: spacing.sm,
			borderTopWidth: 1,
			borderTopColor: colors.border,
			backgroundColor: colors.background,
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
			textAlign: 'center',
		},
	})
}
