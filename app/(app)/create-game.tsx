import { useAuth } from '@/lib/auth'
import {
	MAX_PLAYERS,
	sameStringSet,
	type BuildPhaseFrequency,
	type NumberLayout,
	type TradeMode,
} from '@/lib/catan/types'
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
	const [bonusSets, setBonusSets] = useState<string[]>(
		savedDefaults.extras.bonusSets
	)
	const [devCards, setDevCards] = useState(savedDefaults.settings.devCards)
	const [numberLayout, setNumberLayout] = useState<NumberLayout>(
		savedDefaults.settings.numberLayout
	)
	const [honk, setHonk] = useState(savedDefaults.settings.honk)
	const [tradeMode, setTradeMode] = useState<TradeMode>(
		savedDefaults.settings.tradeMode
	)
	const [extraBuildEnabled, setExtraBuildEnabled] = useState(
		savedDefaults.settings.extraBuild.enabled
	)
	const [buildPhases, setBuildPhases] = useState<BuildPhaseFrequency>(
		savedDefaults.settings.extraBuild.buildPhases
	)
	const [moreThanSeven, setMoreThanSeven] = useState(
		savedDefaults.settings.extraBuild.moreThanSeven
	)
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
	const savedBonusSets = savedDefaults.extras.bonusSets
	const savedDevCards = savedDefaults.settings.devCards
	const savedNumberLayout = savedDefaults.settings.numberLayout
	const savedHonk = savedDefaults.settings.honk
	const savedTradeMode = savedDefaults.settings.tradeMode
	const savedExtraBuild = savedDefaults.settings.extraBuild
	useEffect(() => {
		if (touched) return
		setBonuses(savedBonuses)
		setBonusSets(savedBonusSets)
		setDevCards(savedDevCards)
		setNumberLayout(savedNumberLayout)
		setHonk(savedHonk)
		setTradeMode(savedTradeMode)
		setExtraBuildEnabled(savedExtraBuild.enabled)
		setBuildPhases(savedExtraBuild.buildPhases)
		setMoreThanSeven(savedExtraBuild.moreThanSeven)
	}, [
		savedBonuses,
		savedBonusSets,
		savedDevCards,
		savedNumberLayout,
		savedHonk,
		savedTradeMode,
		savedExtraBuild,
		touched,
	])

	const currentDefaults: GameDefaults = {
		settings: {
			devCards,
			numberLayout,
			honk,
			tradeMode,
			extraBuild: {
				enabled: extraBuildEnabled,
				buildPhases,
				moreThanSeven,
			},
		},
		extras: { bonuses, bonusSets },
	}
	const dirty =
		currentDefaults.settings.devCards !== savedDefaults.settings.devCards ||
		currentDefaults.settings.numberLayout !==
			savedDefaults.settings.numberLayout ||
		currentDefaults.settings.honk !== savedDefaults.settings.honk ||
		currentDefaults.settings.tradeMode !==
			savedDefaults.settings.tradeMode ||
		currentDefaults.settings.extraBuild.enabled !==
			savedExtraBuild.enabled ||
		currentDefaults.settings.extraBuild.buildPhases !==
			savedExtraBuild.buildPhases ||
		currentDefaults.settings.extraBuild.moreThanSeven !==
			savedExtraBuild.moreThanSeven ||
		currentDefaults.extras.bonuses !== savedDefaults.extras.bonuses ||
		!sameStringSet(
			currentDefaults.extras.bonusSets,
			savedDefaults.extras.bonusSets
		)

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return friends
		return friends.filter((f) =>
			f.profile.username.toLowerCase().includes(q)
		)
	}, [friends, query])

	// Proposer + invites can't exceed MAX_PLAYERS (6). 5-6 player games use the
	// expanded board automatically.
	const maxInvites = MAX_PLAYERS - 1
	const atInviteCap = selected.size >= maxInvites
	// Proposer + invitees. Extra build phases only apply to >4 player games, so
	// the control only appears once the table would seat 5+.
	const playerCount = selected.size + 1
	const showExtraBuild = playerCount > 4

	function toggle(id: string) {
		setSelected((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else if (next.size < maxInvites) next.add(id)
			return next
		})
	}

	async function onCreate() {
		if (!user?.id || selected.size === 0) return
		setBusy(true)
		setError(null)
		const { error } = await createRequest(user.id, Array.from(selected), {
			bonuses,
			bonusSets,
			devCards,
			numberLayout,
			honk,
			tradeMode,
			extraBuild: {
				enabled: extraBuildEnabled,
				buildPhases,
				moreThanSeven,
			},
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
											disabled={
												atInviteCap &&
												!selected.has(f.otherId)
											}
											onToggle={() => toggle(f.otherId)}
										/>
									))}
								</View>
							)}
							{atInviteCap && (
								<Text style={styles.hint}>
									Up to {MAX_PLAYERS} players per game. 5–6
									players use the larger board.
								</Text>
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
									<CompactToggleRow
										icon="shuffle"
										title="Random numbers"
										description="Scatter number tokens instead of the classic spiral placement."
										value={numberLayout === 'random'}
										onToggle={() => {
											setNumberLayout((v) =>
												v === 'random'
													? 'spiral'
													: 'random'
											)
											setTouched(true)
										}}
									/>
									<CompactToggleRow
										icon="megaphone"
										title="Honking"
										description="Let players nudge whoever's holding up the game."
										value={honk}
										onToggle={() => {
											setHonk((v) => !v)
											setTouched(true)
										}}
									/>
									<SegmentedRow
										label="Trades"
										description="Confirm: you approve each acceptance before the swap. Automatic: the first accepter trades instantly."
										options={TRADE_MODE_OPTIONS}
										value={tradeMode}
										onSelect={(v) => {
											setTradeMode(v as TradeMode)
											setTouched(true)
										}}
									/>
									{showExtraBuild && (
										<>
											<CompactToggleRow
												icon="construct"
												title="Extra build phases"
												description="Let players build between turns (5–6 player games)."
												value={extraBuildEnabled}
												onToggle={() => {
													setExtraBuildEnabled(
														(v) => !v
													)
													setTouched(true)
												}}
											/>
											{extraBuildEnabled && (
												<View style={styles.subOptions}>
													<SegmentedRow
														label="Build phases"
														options={
															BUILD_PHASE_OPTIONS
														}
														value={buildPhases}
														onSelect={(v) => {
															setBuildPhases(
																v as BuildPhaseFrequency
															)
															setTouched(true)
														}}
													/>
													<SegmentedRow
														label="Allow building"
														options={
															ALLOW_BUILD_OPTIONS
														}
														value={
															moreThanSeven
																? 'over'
																: 'always'
														}
														onSelect={(v) => {
															setMoreThanSeven(
																v === 'over'
															)
															setTouched(true)
														}}
													/>
												</View>
											)}
										</>
									)}
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
									{bonuses && (
										<View style={styles.subOptions}>
											{(['1', '2', '3'] as const).map(
												(setId) => {
													// Sets 1, 2, and 3 are all live.
													const locked = false
													return (
														<CheckboxRow
															key={setId}
															label={`Set ${setId}`}
															checked={bonusSets.includes(
																setId
															)}
															disabled={locked}
															onToggle={() => {
																setBonusSets(
																	(prev) => {
																		if (
																			prev.includes(
																				setId
																			)
																		) {
																			// Keep at least one set enabled.
																			if (
																				prev.length <=
																				1
																			)
																				return prev
																			return prev.filter(
																				(
																					s
																				) =>
																					s !==
																					setId
																			)
																		}
																		return [
																			...prev,
																			setId,
																		]
																	}
																)
																setTouched(true)
															}}
														/>
													)
												}
											)}
										</View>
									)}
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

function CheckboxRow({
	label,
	checked,
	disabled,
	onToggle,
}: {
	label: string
	checked: boolean
	disabled?: boolean
	onToggle: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={disabled ? undefined : onToggle}
			disabled={disabled}
			style={({ pressed }) => [
				styles.checkboxRow,
				pressed && !disabled && styles.pressed,
			]}
		>
			<View
				style={[
					styles.checkbox,
					checked && !disabled && styles.checkboxChecked,
					disabled && styles.checkboxDisabled,
				]}
			>
				{checked && !disabled && (
					<Ionicons name="checkmark" size={14} color={colors.white} />
				)}
			</View>
			<Text
				style={[
					styles.checkboxLabel,
					disabled && styles.checkboxLabelDisabled,
				]}
			>
				{label}
			</Text>
			{disabled && <Text style={styles.checkboxHint}>coming soon</Text>}
		</Pressable>
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

const BUILD_PHASE_OPTIONS = [
	{ key: 'every', label: 'Every roll' },
	{ key: 'across', label: 'Across' },
]
const TRADE_MODE_OPTIONS = [
	{ key: 'automatic', label: 'Automatic' },
	{ key: 'confirm', label: 'Confirm' },
]
const ALLOW_BUILD_OPTIONS = [
	{ key: 'always', label: 'Always' },
	{ key: 'over', label: 'Over 7 cards' },
]

// A labelled two/three-option segmented control. Used for the extra-build
// sub-options (build cadence + who may build). `value` is the active key.
function SegmentedRow({
	label,
	description,
	options,
	value,
	onSelect,
}: {
	label: string
	// Optional helper line, shown under the label (used by top-level settings
	// rows; the extra-build sub-options omit it).
	description?: string
	options: { key: string; label: string }[]
	value: string
	onSelect: (value: string) => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.segmentedRow}>
			<Text style={styles.segmentedLabel}>{label}</Text>
			{description && (
				<Text style={styles.segmentedDescription}>{description}</Text>
			)}
			<View style={styles.segmentControl}>
				{options.map((opt) => {
					const active = value === opt.key
					return (
						<Pressable
							key={opt.key}
							onPress={() => onSelect(opt.key)}
							style={({ pressed }) => [
								styles.segmentPill,
								active && styles.segmentPillActive,
								pressed && !active && styles.pressed,
							]}
						>
							<Text
								style={[
									styles.segmentLabel,
									active && styles.segmentLabelActive,
								]}
							>
								{opt.label}
							</Text>
						</Pressable>
					)
				})}
			</View>
		</View>
	)
}

function FriendToggleRow({
	friend,
	selected,
	disabled,
	onToggle,
}: {
	friend: FriendEntry
	selected: boolean
	disabled?: boolean
	onToggle: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<Pressable
			onPress={onToggle}
			disabled={disabled}
			style={({ pressed }) => [
				styles.row,
				pressed && styles.pressed,
				disabled && styles.rowDisabled,
			]}
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
		rowDisabled: {
			opacity: 0.4,
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
		segmentedRow: {
			paddingVertical: spacing.xs,
		},
		segmentedLabel: {
			fontSize: font.xs,
			fontWeight: '600',
			color: colors.textSecondary,
		},
		segmentedDescription: {
			fontSize: font.xs,
			color: colors.textMuted,
			marginTop: 2,
		},
		segmentControl: {
			flexDirection: 'row',
			marginTop: spacing.xs,
			borderRadius: radius.full,
			padding: 3,
			gap: 2,
			backgroundColor: colors.cardAlt,
			borderWidth: 1,
			borderColor: colors.border,
		},
		segmentPill: {
			flex: 1,
			paddingVertical: 6,
			borderRadius: radius.full,
			alignItems: 'center',
		},
		segmentPillActive: {
			backgroundColor: colors.brand,
		},
		segmentLabel: {
			fontSize: font.xs,
			fontWeight: '600',
			color: colors.textSecondary,
		},
		segmentLabelActive: {
			color: colors.white,
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
		subOptions: {
			paddingLeft: spacing.md + 18,
			paddingBottom: spacing.xs,
			gap: 2,
		},
		checkboxRow: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
			paddingVertical: 6,
		},
		checkbox: {
			width: 18,
			height: 18,
			borderRadius: 4,
			borderWidth: 1.5,
			borderColor: colors.border,
			alignItems: 'center',
			justifyContent: 'center',
			backgroundColor: colors.background,
		},
		checkboxChecked: {
			backgroundColor: colors.brand,
			borderColor: colors.brand,
		},
		checkboxDisabled: {
			borderColor: colors.borderLight,
			backgroundColor: colors.cardAlt,
		},
		checkboxLabel: {
			fontSize: font.base,
			color: colors.text,
		},
		checkboxLabelDisabled: {
			color: colors.textMuted,
		},
		checkboxHint: {
			fontSize: font.xs,
			color: colors.textMuted,
			fontStyle: 'italic',
			marginLeft: 'auto',
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
