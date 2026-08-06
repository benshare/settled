// Native fingerprint tuning, read by @expo/fingerprint — and therefore by
// `eas build` (when it records a build's fingerprint), `eas fingerprint:compare`
// (what `scripts/ota.mjs` guards with), and expo-updates alike.
//
// `expo.extra` is excluded because it is not a native input. It rides in the
// update manifest, so an OTA update carries its own copy and can never disagree
// with the installed binary. Including it made the fingerprint a function of
// *where* it was computed rather than of what the project contains: EAS records
// a build's fingerprint client-side with the local `.env` loaded, while a
// comparison run against the `production` environment resolves the same config
// without ADMIN or DEV_LOGIN_KEY (see `app.config.js`). Identical source tree,
// two different hashes, and every OTA publish blocked.
//
// Excluding it also keeps those local-only values out of the fingerprint EAS
// stores against each build — `extra` is dropped before the config is hashed,
// so a dev secret in `.env` can no longer end up recorded in build metadata.
// `sourceSkips` replaces the default rather than extending it, so
// PackageJsonAndroidAndIosScriptsIfNotContainRun — @expo/fingerprint's
// DEFAULT_SOURCE_SKIPS — has to be repeated here. Dropping it would put the
// `android`/`ios` package.json scripts back into the hash and reintroduce
// exactly the kind of phantom drift this file exists to remove.
module.exports = {
	sourceSkips: [
		'PackageJsonAndroidAndIosScriptsIfNotContainRun',
		'ExpoConfigExtraSection',
	],
}
