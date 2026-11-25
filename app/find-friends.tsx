// Find friends from the device's contacts. Two ways in: pushed once as
// onboarding by `useContactsOnboarding` (`?onboarding=1`), and from the
// Friends tab. On the root stack, not the tab group, for the same reason as
// `player-colors`: a hidden tab route answers back by jumping to Games.
// See `.claude/specs/contacts-onboarding.md`.

import { useAppForeground } from '@/lib/appState'
import { useAuth } from '@/lib/auth'
import {
	getContactsPermission,
	readContactPhones,
	requestContactsPermission,
} from '@/lib/contacts'
import { Avatar } from '@/lib/modules/Avatar'
import { Button } from '@/lib/modules/Button'
import { ContactMatch, useFriendsStore } from '@/lib/stores/useFriendsStore'
import { useProfileStore } from '@/lib/stores/useProfileStore'
import { ColorScheme, font, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	ActivityIndicator,
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

type Step =
	| { kind: 'checking' }
	| { kind: 'intro' }
	| { kind: 'blocked' }
	| { kind: 'loading' }
	| { kind: 'results'; matches: ContactMatch[]; names: string[] }
	| { kind: 'error'; message: string }

type SendState = 'sending' | 'sent' | 'error'

export default function FindFriendsScreen() {
	const router = useRouter()
	const { user } = useAuth()
	const ownPhone = user?.phone
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const params = useLocalSearchParams<{ onboarding?: string }>()
	const onboarding = params.onboarding === '1'
	const matchContacts = useFriendsStore((s) => s.matchContacts)
	const [step, setStep] = useState<Step>({ kind: 'checking' })

	// Stamped on show, not on answer: however this screen is left, it must
	// never come back on its own.
	useEffect(() => {
		if (onboarding) useProfileStore.getState().markContactsOnboarded()
	}, [onboarding])

	const leave = useCallback(() => {
		if (router.canGoBack()) router.back()
		else router.replace('/(app)/games')
	}, [router])

	const find = useCallback(async () => {
		setStep({ kind: 'loading' })
		try {
			const { phones, names } = await readContactPhones(ownPhone)
			const { matches, error } = await matchContacts(phones)
			if (error) setStep({ kind: 'error', message: error })
			else setStep({ kind: 'results', matches, names })
		} catch {
			setStep({
				kind: 'error',
				message: "Couldn't read your contacts",
			})
		}
	}, [ownPhone, matchContacts])

	// Already granted (a re-run from Friends) skips straight to the search.
	const check = useCallback(async () => {
		const permission = await getContactsPermission().catch(
			() => 'unavailable' as const
		)
		if (permission === 'granted') find()
		else if (permission === 'blocked') setStep({ kind: 'blocked' })
		else setStep({ kind: 'intro' })
	}, [find])

	useEffect(() => {
		check()
	}, [check])

	// Back from Settings with access turned on.
	useAppForeground(() => {
		if (step.kind === 'blocked') check()
	})

	async function onAllow() {
		const permission = await requestContactsPermission().catch(
			() => 'denied' as const
		)
		if (permission === 'granted') find()
		else if (onboarding) leave()
		else if (permission === 'blocked') setStep({ kind: 'blocked' })
	}

	return (
		<SafeAreaView style={styles.safe}>
			<View style={styles.header}>
				{onboarding ? (
					<View style={styles.back} />
				) : (
					<Pressable
						onPress={leave}
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
				)}
				<Text style={styles.title}>Find friends</Text>
				<View style={styles.back} />
			</View>

			{step.kind === 'checking' || step.kind === 'loading' ? (
				<View style={styles.center}>
					<ActivityIndicator color={colors.textMuted} />
					{step.kind === 'loading' && (
						<Text style={styles.body}>
							Looking for friends in your contacts…
						</Text>
					)}
				</View>
			) : step.kind === 'intro' || step.kind === 'blocked' ? (
				<Explainer
					blocked={step.kind === 'blocked'}
					onAllow={onAllow}
					onSkip={leave}
				/>
			) : step.kind === 'error' ? (
				<View style={styles.center}>
					<Text style={styles.body}>{step.message}</Text>
					<View style={styles.actions}>
						<Button onPress={find}>Try again</Button>
						<Button variant="secondary" onPress={leave}>
							{onboarding ? 'Skip' : 'Back'}
						</Button>
					</View>
				</View>
			) : (
				<Results
					matches={step.matches}
					names={step.names}
					onDone={leave}
				/>
			)}
		</SafeAreaView>
	)
}

function Explainer({
	blocked,
	onAllow,
	onSkip,
}: {
	blocked: boolean
	onAllow: () => void
	onSkip: () => void
}) {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	return (
		<View style={styles.explainer}>
			<View style={styles.intro}>
				<Ionicons
					name="people-circle-outline"
					size={72}
					color={colors.brand}
				/>
				<Text style={styles.heading}>Play with people you know</Text>
				<Text style={styles.body}>
					{blocked
						? 'Contacts access is turned off for Settled. Turn it on in Settings to see which of your contacts are already playing.'
						: 'Share your contacts to see which of them are already on Settled, so you can add them as friends in one tap.'}
				</Text>
				<Text style={styles.fine}>
					Numbers are only used to look for matches. They&apos;re
					never stored, and nobody is notified unless you send them a
					request.
				</Text>
			</View>
			<View style={styles.actions}>
				<Button
					onPress={blocked ? () => Linking.openSettings() : onAllow}
				>
					{blocked ? 'Open Settings' : 'Find friends'}
				</Button>
				<Button variant="secondary" onPress={onSkip}>
					Not now
				</Button>
			</View>
		</View>
	)
}

function Results({
	matches,
	names,
	onDone,
}: {
	matches: ContactMatch[]
	names: string[]
	onDone: () => void
}) {
	const { user } = useAuth()
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])
	const sendRequest = useFriendsStore((s) => s.sendRequest)
	const [sent, setSent] = useState<Record<string, SendState>>({})

	async function add(id: string) {
		if (!user?.id) return
		setSent((prev) => ({ ...prev, [id]: 'sending' }))
		const { error } = await sendRequest(user.id, id)
		setSent((prev) => ({ ...prev, [id]: error ? 'error' : 'sent' }))
	}

	const unsent = matches.filter(
		(m) => sent[m.id] !== 'sent' && sent[m.id] !== 'sending'
	)

	if (matches.length === 0) {
		return (
			<View style={styles.explainer}>
				<View style={styles.intro}>
					<Text style={styles.heading}>No matches yet</Text>
					<Text style={styles.body}>
						None of your contacts are on Settled yet. You can always
						add friends by username from the Friends tab.
					</Text>
				</View>
				<View style={styles.actions}>
					<Button onPress={onDone}>Continue</Button>
				</View>
			</View>
		)
	}

	return (
		<>
			<ScrollView contentContainerStyle={styles.list}>
				<Text style={styles.body}>
					{matches.length === 1
						? '1 of your contacts is on Settled.'
						: `${matches.length} of your contacts are on Settled.`}
				</Text>
				{matches.map((m) => {
					const state = sent[m.id]
					const contactName = names[m.contact_index]
					return (
						<View key={m.id}>
							<View style={styles.row}>
								<Avatar profile={m} size={40} />
								<View style={styles.rowText}>
									<Text
										style={styles.rowUsername}
										numberOfLines={1}
									>
										{m.username}
									</Text>
									{!!contactName && (
										<Text
											style={styles.rowContact}
											numberOfLines={1}
										>
											{contactName}
										</Text>
									)}
								</View>
								{state === 'sent' ? (
									<Button
										variant="secondary"
										disabled
										style={styles.rowAction}
									>
										Sent
									</Button>
								) : (
									<Button
										onPress={() => add(m.id)}
										loading={state === 'sending'}
										style={styles.rowAction}
									>
										Add
									</Button>
								)}
							</View>
							{state === 'error' && (
								<Text style={styles.errorText}>
									Couldn&apos;t send request
								</Text>
							)}
						</View>
					)
				})}
			</ScrollView>
			<View style={[styles.actions, styles.footer]}>
				{unsent.length > 1 && (
					<Button onPress={() => unsent.forEach((m) => add(m.id))}>
						{`Add all (${unsent.length})`}
					</Button>
				)}
				<Button
					variant={unsent.length > 1 ? 'secondary' : 'primary'}
					onPress={onDone}
				>
					Done
				</Button>
			</View>
		</>
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
		center: {
			flex: 1,
			alignItems: 'center',
			justifyContent: 'center',
			gap: spacing.md,
			padding: spacing.lg,
		},
		explainer: {
			flex: 1,
			justifyContent: 'space-between',
			padding: spacing.lg,
		},
		intro: {
			alignItems: 'center',
			gap: spacing.md,
			marginTop: spacing.xl,
		},
		heading: {
			fontSize: font.lg,
			fontWeight: '700',
			color: colors.text,
			textAlign: 'center',
		},
		body: {
			fontSize: font.base,
			color: colors.textSecondary,
			textAlign: 'center',
		},
		fine: {
			fontSize: font.sm,
			color: colors.textMuted,
			textAlign: 'center',
		},
		actions: {
			gap: spacing.sm,
			alignSelf: 'stretch',
		},
		footer: {
			padding: spacing.lg,
			paddingTop: spacing.sm,
		},
		list: {
			padding: spacing.lg,
			gap: spacing.md,
		},
		row: {
			flexDirection: 'row',
			alignItems: 'center',
			gap: spacing.sm,
		},
		rowText: {
			flex: 1,
		},
		rowUsername: {
			fontSize: font.md,
			color: colors.text,
		},
		rowContact: {
			fontSize: font.sm,
			color: colors.textMuted,
		},
		rowAction: {
			paddingHorizontal: spacing.md,
			minHeight: 40,
			paddingVertical: 0,
		},
		errorText: {
			color: colors.error,
			fontSize: font.sm,
			marginTop: spacing.xs,
		},
	})
}
