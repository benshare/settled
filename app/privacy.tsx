import { ColorScheme, font, radius, spacing } from '@/lib/theme'
import { useTheme } from '@/lib/ThemeContext'
import { ReactNode, useMemo } from 'react'
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const CONTACT_EMAIL = 'bentshare@gmail.com'
const LAST_UPDATED = 'July 20, 2026'

export default function PrivacyScreen() {
	const { colors } = useTheme()
	const styles = useMemo(() => makeStyles(colors), [colors])

	return (
		<SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
			<ScrollView
				contentContainerStyle={styles.content}
				showsVerticalScrollIndicator={false}
			>
				<Text style={styles.title}>Privacy Policy</Text>
				<Text style={styles.updated}>Last updated: {LAST_UPDATED}</Text>

				<Text style={styles.intro}>
					Settled (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;the
					app&rdquo;) is a companion app for playing tabletop games
					with friends. This policy explains what information we
					collect, how we use it, and the choices you have. By using
					Settled you agree to the practices described here.
				</Text>

				<Section title="Information we collect" styles={styles}>
					<Paragraph styles={styles}>
						We collect only what we need to run the app:
					</Paragraph>
					<Bullet styles={styles}>
						<Bold styles={styles}>Phone number.</Bold> We use your
						phone number to sign you in via a one-time SMS code and
						to let friends find you. We do not use it for marketing.
					</Bullet>
					<Bullet styles={styles}>
						<Bold styles={styles}>Profile details.</Bold> A username
						you choose and, optionally, a profile photo you upload.
					</Bullet>
					<Bullet styles={styles}>
						<Bold styles={styles}>Social connections.</Bold> Friend
						relationships and friend requests you send or receive
						within the app.
					</Bullet>
					<Bullet styles={styles}>
						<Bold styles={styles}>Game data.</Bold> Games you create
						or join and the associated history, so we can show your
						past games and sync play in real time.
					</Bullet>
					<Bullet styles={styles}>
						<Bold styles={styles}>Push notification tokens.</Bold>{' '}
						If you enable notifications, a device token used to
						deliver alerts about games and friend activity.
					</Bullet>
					<Bullet styles={styles}>
						<Bold styles={styles}>Basic technical data.</Bold>{' '}
						Standard information such as device type and app version
						needed to operate and troubleshoot the service.
					</Bullet>
				</Section>

				<Section title="How we use your information" styles={styles}>
					<Bullet styles={styles}>
						To authenticate you and keep your account secure.
					</Bullet>
					<Bullet styles={styles}>
						To provide core features: profiles, friends, and playing
						and syncing games.
					</Bullet>
					<Bullet styles={styles}>
						To send notifications you have opted into.
					</Bullet>
					<Bullet styles={styles}>
						To maintain, debug, and improve the app.
					</Bullet>
					<Paragraph styles={styles}>
						We do not sell your personal information, and we do not
						use it for advertising.
					</Paragraph>
				</Section>

				<Section title="How your information is shared" styles={styles}>
					<Paragraph styles={styles}>
						Your username and profile photo are visible to other
						players you connect or play with. Beyond that, we share
						information only with service providers that help us run
						the app:
					</Paragraph>
					<Bullet styles={styles}>
						<Bold styles={styles}>Supabase</Bold> for
						authentication, database storage, and real-time sync.
					</Bullet>
					<Bullet styles={styles}>
						<Bold styles={styles}>Expo</Bold> for delivering push
						notifications.
					</Bullet>
					<Paragraph styles={styles}>
						These providers process data on our behalf under their
						own security and privacy commitments. We may also
						disclose information if required by law or to protect
						the rights and safety of our users.
					</Paragraph>
				</Section>

				<Section title="Data retention" styles={styles}>
					<Paragraph styles={styles}>
						We keep your information for as long as your account is
						active. When you delete your account, we delete your
						personal data, except where we are required to retain it
						for legal or security reasons.
					</Paragraph>
				</Section>

				<Section title="Your choices" styles={styles}>
					<Bullet styles={styles}>
						You can update your username and profile photo at any
						time in the app.
					</Bullet>
					<Bullet styles={styles}>
						You can turn push notifications on or off in your device
						or app settings.
					</Bullet>
					<Bullet styles={styles}>
						You can request deletion of your account and associated
						data by contacting us.
					</Bullet>
				</Section>

				<Section title="Children's privacy" styles={styles}>
					<Paragraph styles={styles}>
						Settled is not directed to children under 13, and we do
						not knowingly collect personal information from them. If
						you believe a child has provided us information, please
						contact us and we will delete it.
					</Paragraph>
				</Section>

				<Section title="Changes to this policy" styles={styles}>
					<Paragraph styles={styles}>
						We may update this policy from time to time. When we do,
						we will revise the &ldquo;Last updated&rdquo; date
						above. Continued use of the app after changes take
						effect constitutes acceptance of the updated policy.
					</Paragraph>
				</Section>

				<Section title="Contact us" styles={styles}>
					<Paragraph styles={styles}>
						If you have questions about this policy or your data,
						reach us at{' '}
						<Text
							style={styles.link}
							onPress={() =>
								Linking.openURL(`mailto:${CONTACT_EMAIL}`)
							}
						>
							{CONTACT_EMAIL}
						</Text>
						.
					</Paragraph>
				</Section>
			</ScrollView>
		</SafeAreaView>
	)
}

function Section({
	title,
	children,
	styles,
}: {
	title: string
	children: ReactNode
	styles: Styles
}) {
	return (
		<View style={styles.section}>
			<Text style={styles.heading}>{title}</Text>
			{children}
		</View>
	)
}

function Paragraph({
	children,
	styles,
}: {
	children: ReactNode
	styles: Styles
}) {
	return <Text style={styles.body}>{children}</Text>
}

function Bullet({ children, styles }: { children: ReactNode; styles: Styles }) {
	return (
		<View style={styles.bulletRow}>
			<Text style={styles.bulletDot}>{'•'}</Text>
			<Text style={styles.bulletText}>{children}</Text>
		</View>
	)
}

function Bold({ children, styles }: { children: ReactNode; styles: Styles }) {
	return <Text style={styles.bold}>{children}</Text>
}

type Styles = ReturnType<typeof makeStyles>

function makeStyles(colors: ColorScheme) {
	return StyleSheet.create({
		safe: {
			flex: 1,
			backgroundColor: colors.background,
		},
		content: {
			paddingHorizontal: spacing.lg,
			paddingTop: spacing.lg,
			paddingBottom: spacing.xxl,
		},
		title: {
			fontSize: font.xl,
			fontWeight: '700',
			color: colors.text,
		},
		updated: {
			fontSize: font.sm,
			color: colors.textMuted,
			marginTop: spacing.xs,
			marginBottom: spacing.lg,
		},
		intro: {
			fontSize: font.base,
			lineHeight: 22,
			color: colors.textSecondary,
			marginBottom: spacing.lg,
		},
		section: {
			marginBottom: spacing.lg,
		},
		heading: {
			fontSize: font.md,
			fontWeight: '700',
			color: colors.text,
			marginBottom: spacing.sm,
		},
		body: {
			fontSize: font.base,
			lineHeight: 22,
			color: colors.textSecondary,
			marginBottom: spacing.sm,
		},
		bulletRow: {
			flexDirection: 'row',
			marginBottom: spacing.sm,
		},
		bulletDot: {
			fontSize: font.base,
			lineHeight: 22,
			color: colors.textMuted,
			width: spacing.md,
		},
		bulletText: {
			flex: 1,
			fontSize: font.base,
			lineHeight: 22,
			color: colors.textSecondary,
		},
		bold: {
			fontWeight: '600',
			color: colors.text,
		},
		link: {
			color: colors.accent,
			borderRadius: radius.sm,
		},
	})
}
