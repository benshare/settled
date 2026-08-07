import { useAuth } from '@/lib/auth'
import {
	TIMEOUT_OPTIONS,
	timeoutLabel,
	type TimeoutOption,
} from '@/lib/catan/timeout'
import {
	MAX_PLAYERS,
	monopolyCap,
	parseGameConfig,
	sameStringSet,
	type BuildPhaseFrequency,
	type GameConfig,
	type NumberLayout,
	type TradeMode,
} from '@/lib/catan/types'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { Input } from '@/lib/modules/Input'
import { Select } from '@/lib/modules/Select'
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
import { useLocalSearchParams, useRouter } from 'expo-router'
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

	// Rematch: the finished game's table + settings arrive as route params from
	// the game-over modal. Parsed once, on mount — a later render must never
	// re-seed the form over the user's edits.
	const { invite, config: configParam } = useLocalSearchParams<{
		invite?: string
		config?: string
	}>()
	const [rematchConfig] = useState<GameConfig | null>(() =>
		configParam ? parseRematchConfig(configParam) : null
	)
	const rematchInvites = useMemo(
		() => (invite ? invite.split(',').filter(Boolean) : []),
		[invite]
	)
	const isRematch = rematchInvites.length > 0
	// A rematch seeds the form from the game it repeats; everything else from
	// the profile's saved defaults.
	const initial: GameDefaults = rematchConfig
		? gameDefaultsFrom(rematchConfig)
		: savedDefaults

	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [bonuses, setBonuses] = useState(initial.extras.bonuses)
	const [bonusSets, setBonusSets] = useState<string[]>(
		initial.extras.bonusSets
	)
	const [bannedCombos, setBannedCombos] = useState(
		initial.extras.bannedCombos
	)
	const [bonusCount, setBonusCount] = useState(initial.extras.bonusCount)
	const [curseCount, setCurseCount] = useState(initial.extras.curseCount)
	const [devCards, setDevCards] = useState(initial.settings.devCards)
	const [numberLayout, setNumberLayout] = useState<NumberLayout>(
		initial.settings.numberLayout
	)
	const [honk, setHonk] = useState(initial.settings.honk)
	const [friendlyRobber, setFriendlyRobber] = useState(
		initial.settings.friendlyRobber
	)
	const [limitMonopoly, setLimitMonopoly] = useState(
		initial.settings.limitMonopoly
	)
	const [tradeMode, setTradeMode] = useState<TradeMode>(
		initial.settings.tradeMode
	)
	const [spectators, setSpectators] = useState(initial.settings.spectators)
	const [moveTimeout, setMoveTimeout] = useState<TimeoutOption | null>(
		initial.settings.timeout
	)
	const [extraBuildEnabled, setExtraBuildEnabled] = useState(
		initial.settings.extraBuild.enabled
	)
	const [buildPhases, setBuildPhases] = useState<BuildPhaseFrequency>(
		initial.settings.extraBuild.buildPhases
	)
	const [moreThanSeven, setMoreThanSeven] = useState(
		initial.settings.extraBuild.moreThanSeven
	)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [extrasOpen, setExtrasOpen] = useState(false)
	const [busy, setBusy] = useState(false)
	const [savingDefaults, setSavingDefaults] = useState(false)
	const [error, setError] = useState<string | null>(null)

	// If the profile loads after mount, reset form fields to match the
	// freshly-loaded saved values. Users who touched the toggles before the
	// load completed keep their edits — as does a rematch, whose settings come
	// from the repeated game rather than from the defaults.
	const [touched, setTouched] = useState(rematchConfig !== null)
	const savedBonuses = savedDefaults.extras.bonuses
	const savedBonusSets = savedDefaults.extras.bonusSets
	const savedBannedCombos = savedDefaults.extras.bannedCombos
	const savedBonusCount = savedDefaults.extras.bonusCount
	const savedCurseCount = savedDefaults.extras.curseCount
	const savedDevCards = savedDefaults.settings.devCards
	const savedNumberLayout = savedDefaults.settings.numberLayout
	const savedHonk = savedDefaults.settings.honk
	const savedFriendlyRobber = savedDefaults.settings.friendlyRobber
	const savedLimitMonopoly = savedDefaults.settings.limitMonopoly
	const savedTradeMode = savedDefaults.settings.tradeMode
	const savedSpectators = savedDefaults.settings.spectators
	const savedExtraBuild = savedDefaults.settings.extraBuild
	const savedTimeout = savedDefaults.settings.timeout
	useEffect(() => {
		if (touched) return
		setBonuses(savedBonuses)
		setBonusSets(savedBonusSets)
		setBannedCombos(savedBannedCombos)
		setBonusCount(savedBonusCount)
		setCurseCount(savedCurseCount)
		setDevCards(savedDevCards)
		setNumberLayout(savedNumberLayout)
		setHonk(savedHonk)
		setFriendlyRobber(savedFriendlyRobber)
		setLimitMonopoly(savedLimitMonopoly)
		setTradeMode(savedTradeMode)
		setSpectators(savedSpectators)
		setMoveTimeout(savedTimeout)
		setExtraBuildEnabled(savedExtraBuild.enabled)
		setBuildPhases(savedExtraBuild.buildPhases)
		setMoreThanSeven(savedExtraBuild.moreThanSeven)
	}, [
		savedBonuses,
		savedBonusSets,
		savedBannedCombos,
		savedBonusCount,
		savedCurseCount,
		savedDevCards,
		savedNumberLayout,
		savedHonk,
		savedFriendlyRobber,
		savedLimitMonopoly,
		savedTradeMode,
		savedSpectators,
		savedTimeout,
		savedExtraBuild,
		touched,
	])

	const currentDefaults: GameDefaults = {
		settings: {
			devCards,
			numberLayout,
			honk,
			friendlyRobber,
			limitMonopoly,
			tradeMode,
			spectators,
			extraBuild: {
				enabled: extraBuildEnabled,
				buildPhases,
				moreThanSeven,
			},
			timeout: moveTimeout,
		},
		extras: { bonuses, bonusSets, bannedCombos, bonusCount, curseCount },
	}
	const dirty =
		currentDefaults.settings.devCards !== savedDefaults.settings.devCards ||
		currentDefaults.settings.numberLayout !==
			savedDefaults.settings.numberLayout ||
		currentDefaults.settings.honk !== savedDefaults.settings.honk ||
		currentDefaults.settings.friendlyRobber !==
			savedDefaults.settings.friendlyRobber ||
		currentDefaults.settings.limitMonopoly !==
			savedDefaults.settings.limitMonopoly ||
		currentDefaults.settings.tradeMode !==
			savedDefaults.settings.tradeMode ||
		currentDefaults.settings.spectators !==
			savedDefaults.settings.spectators ||
		currentDefaults.settings.timeout !== savedDefaults.settings.timeout ||
		currentDefaults.settings.extraBuild.enabled !==
			savedExtraBuild.enabled ||
		currentDefaults.settings.extraBuild.buildPhases !==
			savedExtraBuild.buildPhases ||
		currentDefaults.settings.extraBuild.moreThanSeven !==
			savedExtraBuild.moreThanSeven ||
		currentDefaults.extras.bonuses !== savedDefaults.extras.bonuses ||
		currentDefaults.extras.bannedCombos !==
			savedDefaults.extras.bannedCombos ||
		currentDefaults.extras.bonusCount !== savedDefaults.extras.bonusCount ||
		currentDefaults.extras.curseCount !== savedDefaults.extras.curseCount ||
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

	// Preselect a rematch's table. Done in an effect rather than as initial
	// state because the friends list can land after mount; anyone the viewer is
	// no longer friends with is dropped, since the picker can't show them and a
	// hidden selection would make the invite count lie.
	const [playersTouched, setPlayersTouched] = useState(false)
	useEffect(() => {
		if (playersTouched || rematchInvites.length === 0) return
		setSelected(
			new Set(
				rematchInvites.filter((id) =>
					friends.some((f) => f.otherId === id)
				)
			)
		)
	}, [rematchInvites, friends, playersTouched])

	function toggle(id: string) {
		setPlayersTouched(true)
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
			bannedCombos,
			bonusCount,
			curseCount,
			devCards,
			numberLayout,
			honk,
			friendlyRobber,
			limitMonopoly,
			tradeMode,
			spectators,
			extraBuild: {
				enabled: extraBuildEnabled,
				buildPhases,
				moreThanSeven,
			},
			timeout: moveTimeout,
		})
		setBusy(false)
		if (error) {
			setError(error)
			return
		}
		router.replace('/games')
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
					<Text style={styles.title}>
						{isRematch ? 'Rematch' : 'Create game'}
					</Text>
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
									<CompactToggleRow
										icon="shield-checkmark"
										title="Friendly robber"
										description="No robber on a 7 until everyone's had their first turn."
										value={friendlyRobber}
										onToggle={() => {
											setFriendlyRobber((v) => !v)
											setTouched(true)
										}}
									/>
									<CompactToggleRow
										icon="eye"
										title="Allow spectators"
										description="Let friends of any player watch this game."
										value={spectators}
										onToggle={() => {
											setSpectators((v) => !v)
											setTouched(true)
										}}
									/>
									{devCards && (
										<CompactToggleRow
											icon="flash"
											title="Limit monopoly"
											description={`Monopoly takes at most ${monopolyCap(playerCount)} cards from any one player.`}
											value={limitMonopoly}
											onToggle={() => {
												setLimitMonopoly((v) => !v)
												setTouched(true)
											}}
										/>
									)}
									<Select
										label="Move timeout"
										description="Skip a player who doesn't take their turn in time."
										icon={
											<Ionicons
												name="timer"
												size={18}
												color={colors.textSecondary}
											/>
										}
										value={moveTimeout}
										options={TIMEOUT_OPTIONS.map((key) => ({
											key,
											label: timeoutLabel(key),
										}))}
										onSelect={(v) => {
											setMoveTimeout(v)
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
										<>
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
																disabled={
																	locked
																}
																onToggle={() => {
																	setBonusSets(
																		(
																			prev
																		) => {
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
																	setTouched(
																		true
																	)
																}}
															/>
														)
													}
												)}
											</View>
											<View style={styles.subOptions}>
												<SegmentedRow
													label="Bonus cards"
													options={CARD_COUNT_OPTIONS}
													value={String(bonusCount)}
													onSelect={(v) => {
														setBonusCount(Number(v))
														setTouched(true)
													}}
												/>
												<SegmentedRow
													label="Curse cards"
													options={CARD_COUNT_OPTIONS}
													value={String(curseCount)}
													onSelect={(v) => {
														setCurseCount(Number(v))
														setTouched(true)
													}}
												/>
												<Text style={styles.subNote}>
													{cardCountNote(
														bonusCount,
														curseCount
													)}
												</Text>
											</View>
											<CompactToggleRow
												icon="close-circle"
												title="Ban bad combos"
												description="Never offer a bonus that clashes with a player's curse."
												value={bannedCombos}
												onToggle={() => {
													setBannedCombos((v) => !v)
													setTouched(true)
												}}
											/>
										</>
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

// The rematch config rides the route as JSON. `parseGameConfig` already fills
// in anything missing, so only the parse itself can fail here.
function parseRematchConfig(raw: string): GameConfig | null {
	try {
		return parseGameConfig(JSON.parse(raw))
	} catch {
		return null
	}
}

// A game's config is flat; the form is grouped the way the profile's saved
// defaults are, so reshape before seeding state from a rematch.
function gameDefaultsFrom(config: GameConfig): GameDefaults {
	return {
		settings: {
			devCards: config.devCards,
			numberLayout: config.numberLayout,
			honk: config.honk,
			friendlyRobber: config.friendlyRobber,
			limitMonopoly: config.limitMonopoly,
			tradeMode: config.tradeMode,
			spectators: config.spectators,
			extraBuild: config.extraBuild,
			timeout: config.timeout,
		},
		extras: {
			bonuses: config.bonuses,
			bonusSets: config.bonusSets,
			bannedCombos: config.bannedCombos,
			bonusCount: config.bonusCount,
			curseCount: config.curseCount,
		},
	}
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
// Cards dealt per player in the bonus-selection phase. One means the card is
// simply assigned; both at one skips the phase entirely.
const CARD_COUNT_OPTIONS = [
	{ key: '1', label: '1' },
	{ key: '2', label: '2' },
	{ key: '3', label: '3' },
]

// Spells out what the two counts mean together, since "1" reads as a choice
// until you notice there's nothing to choose from.
function cardCountNote(bonusCount: number, curseCount: number): string {
	const bonus =
		bonusCount === 1
			? 'Your bonus is dealt to you'
			: `Keep 1 of ${bonusCount} bonuses`
	const curse =
		curseCount === 1
			? 'your curse is dealt to you'
			: `keep 1 of ${curseCount} curses`
	if (bonusCount === 1 && curseCount === 1) {
		return 'Both cards are dealt to you — no selection round.'
	}
	return `${bonus}, ${curse}.`
}

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
		subNote: {
			fontSize: font.xs,
			color: colors.textMuted,
			marginTop: spacing.xs,
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
