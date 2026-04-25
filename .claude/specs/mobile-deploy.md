# Mobile deploy — Settled iOS

Tracking doc for App Store deploy. Phase A (EAS wiring) is done; items below are deferred until ready to submit.

## Deferred items

### Must-do before first App Store submission

- **Privacy policy URL** — Apple requires a hosted URL in the App Store Connect listing. No page exists yet. Host somewhere (marketing site, Notion public page, GitHub Pages) covering: Supabase auth, profile photo storage, any future analytics/push.
- **App Store Connect record** — create app in App Store Connect (name `Settled`, bundle id `com.benjaminshare.settled`, SKU, primary language).
- **App Store listing assets** — screenshots (6.9" required, 6.5" recommended), description, keywords, support URL, category, age rating, data-use disclosures.
- **Custom icon + splash** — `assets/images/icon.png` and `splash-icon.png` may still be starter defaults. 1024×1024 iOS icon required; no transparency.
- **TestFlight pass** — internal-test build before production submit.

### Deferred features (native deps already installed, can ship via OTA)

- **Push notifications** — `expo-notifications` installed and plugin listed (entitlements will be in first native build). Runtime wiring (permission prompt, token registration, Supabase-side delivery) deferred.
- **Analytics** — Sentry (crash reporting) and PostHog (product analytics) deferred. Both can be added later; Sentry wants a native build to bundle the SDK, so install it _before_ first production build if we want it in v1.0.0.

### Standard commands

- `npm run build:native` — production iOS build with auto-submit to App Store Connect
- `eas update --channel production` — OTA update to production channel (no rebuild)
- `eas credentials` — manage signing certs / provisioning profiles
- `eas submit --platform ios` — submit an existing build

## Phase A summary (completed)

- EAS project created: `@benshare/settled` (id `ba0c1196-575e-4e19-a4a9-6601e698f983`)
- `eas.json` with dev/preview/production profiles; production has `autoIncrement`, `channel: production`, `ios.simulator: false`; `appVersionSource: remote`
- `expo-updates` installed, `updates.url` + `runtimeVersion` configured
- Pre-installed for OTA forward-compat: `expo-notifications`, `expo-device`, `expo-application`, `expo-clipboard`, `expo-sharing`
- `app.json`: display name `Settled`, `ios.buildNumber: 1.0.0`, `ITSAppUsesNonExemptEncryption: false`
- `build:native` script added to `package.json`
