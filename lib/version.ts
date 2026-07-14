import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

export const APP_VERSION = Constants.expoConfig?.version ?? '?'

// `Updates.createdAt` is the publish time of the running JS bundle — for OTA
// builds this changes each release, for dev/Expo Go it's null.
const OTA_DATE = Updates.createdAt
	? Updates.createdAt.toISOString().slice(0, 10)
	: null

export const VERSION_LABEL = OTA_DATE
	? `v${APP_VERSION} · ${OTA_DATE}`
	: `v${APP_VERSION} · dev`
