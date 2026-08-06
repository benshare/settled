// Guarded OTA publish.
//
// The runtimeVersion policy is `appVersion`, so an OTA update lands on any
// installed build sharing the app version — maximally permissive, but with no
// built-in protection against shipping a JS bundle whose native expectations
// differ from the installed binary (which would crash). This script restores
// that protection: before publishing, it compares the local project's native
// fingerprint against the fingerprint EAS recorded for the latest shipped
// production iOS build. If they differ, a real native change may have happened
// and the publish is blocked — bump `version` in app.json and cut a new build
// instead. Drift confined to `expo.extra` is recognised and allowed through
// (see MANIFEST_ONLY_CONFIG_KEYS). Fingerprint is conservative and flags other
// harmless drift too (a dependency version-pin, a JS-only config edit); when
// you've inspected the listed sources and confirmed the native side is
// unchanged, re-run with `--force` to publish anyway.
//
// Usage: pnpm ota [--force] [-- <extra eas update args>]

import { execFileSync } from 'node:child_process'

const eas = (args, { capture = false } = {}) =>
	execFileSync('eas', args, {
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
	})

// EAS prefixes --json output with human-readable lines (e.g. loaded env vars);
// slice from the first brace so JSON.parse only sees the payload.
const parseJson = (out) => JSON.parse(out.slice(out.indexOf('{')))

const force = process.argv.includes('--force')
const passthrough = process.argv.slice(2).filter((a) => a !== '--force')

const die = (msg) => {
	console.error(`\n${msg}\n`)
	process.exit(1)
}

// Resolved-config keys that can differ without threatening native
// compatibility. `extra` is delivered in the update manifest, so an OTA update
// carries its own copy and can never disagree with the installed binary. It is
// also the only part of the config `app.config.js` fills from the local `.env`,
// which makes it drift purely from *where* a fingerprint was computed: EAS
// records a build's fingerprint client-side with `.env` loaded, while the
// comparison below runs against the `production` environment, where ADMIN and
// DEV_LOGIN_KEY deliberately don't exist. Without this the guard would block
// every single publish, which trains you to pass --force and defeats the point.
const MANIFEST_ONLY_CONFIG_KEYS = ['extra']

// 1. The latest finished production iOS build = what TestFlight/App Store users
//    are actually running, and the binary an OTA update would land on.
let build
try {
	const builds = parseArray(
		eas(
			[
				'build:list',
				'--platform',
				'ios',
				'--limit',
				'10',
				'--non-interactive',
				'--json',
			],
			{ capture: true }
		)
	)
	build = builds.find(
		(b) => b.status === 'FINISHED' && b.channel === 'production'
	)
} catch (err) {
	die(`Could not list builds to guard the publish: ${err.message}`)
}

if (!build) {
	if (!force)
		die(
			'No finished production iOS build found to compare against, so native ' +
				'compatibility cannot be verified. If this is intentional (e.g. the ' +
				'first publish), re-run with --force.'
		)
	console.warn(
		'\n⚠ No build to compare against — publishing anyway (--force).\n'
	)
} else {
	// 2. Compare the local project fingerprint against that build, in the same
	//    `production` environment the publish itself uses (env vars feed the
	//    resolved config, and thus the fingerprint).
	let cmp
	try {
		cmp = parseJson(
			eas(
				[
					'fingerprint:compare',
					'--build-id',
					build.id,
					'--environment',
					'production',
					'--json',
				],
				{ capture: true }
			)
		)
	} catch (err) {
		die(`Fingerprint comparison failed: ${err.message}`)
	}

	const shipped = cmp.fingerprint1?.hash // the build
	const local = cmp.fingerprint2?.hash // this working tree

	if (shipped !== local) {
		const { significant, benign } = diffSources(
			cmp.fingerprint1?.sources ?? [],
			cmp.fingerprint2?.sources ?? []
		)

		if (benign.length)
			console.log(
				`Ignoring drift confined to manifest-delivered config: ${benign.join(', ')}\n`
			)

		if (significant.length === 0) {
			console.log(
				`✓ Every native fingerprint source matches shipped build ${build.appVersion} — safe to publish OTA.\n`
			)
		} else {
			console.error('\nFingerprint sources that changed since the build:')
			for (const s of significant) console.error(`  • ${s}`)
			console.error(
				`\nNative fingerprint differs from the shipped production build:\n` +
					`  shipped build ${build.appVersion} (${build.id.slice(0, 8)}): ${shipped}\n` +
					`  local project:                            ${local}\n`
			)
			if (!force)
				die(
					'Blocking OTA publish — an installed binary may be incompatible ' +
						'with this JS bundle.\n' +
						'  • If a native module/config actually changed: bump `version` ' +
						'in app.json and cut a new build (pnpm build:native).\n' +
						'  • If the sources above are JS-only / no-op (e.g. a ' +
						'version-pin): re-run with --force.'
				)
			console.warn(
				'\n⚠ Fingerprint drift overridden — publishing anyway (--force).\n'
			)
		}
	} else {
		console.log(
			`✓ Native fingerprint matches shipped build ${build.appVersion} — safe to publish OTA.\n`
		)
	}
}

// 3. Publish.
eas([
	'update',
	'--branch',
	'production',
	'--auto',
	'--environment',
	'production',
	...passthrough,
])

// --- helpers ---

function parseArray(out) {
	return JSON.parse(out.slice(out.indexOf('[')))
}

// Split the fingerprint sources whose hash changed into drift that could
// reflect a native change and drift that provably can't.
function diffSources(shippedSources, localSources) {
	const a = index(shippedSources)
	const b = index(localSources)
	const significant = []
	const benign = []
	for (const [k, source] of b) {
		if (!a.has(k)) {
			significant.push(`${k} (added)`)
			continue
		}
		const before = a.get(k)
		if ((before.hash ?? '(dir)') === (source.hash ?? '(dir)')) continue
		if (
			k === 'contents:expoConfig' &&
			onlyManifestKeysDiffer(before, source)
		)
			benign.push(k)
		else significant.push(k)
	}
	for (const [k] of a) if (!b.has(k)) significant.push(`${k} (removed)`)
	return { significant, benign }
}

// filePath is null for synthesized sources (resolved config, package.json
// sections); `id`/`reasons` is what distinguishes those, so fold them into the
// key and the human label.
function index(sources) {
	const label = (s) =>
		s.id ?? s.filePath ?? s.overrideHashKey ?? (s.reasons ?? []).join(',')
	return new Map(sources.map((s) => [`${s.type}:${label(s)}`, s]))
}

// True when two resolved configs are identical once the manifest-delivered keys
// are dropped. Fails closed: contents that aren't parseable JSON count as a
// real difference rather than being waved through.
function onlyManifestKeysDiffer(before, after) {
	const strip = (s) => {
		if (typeof s.contents !== 'string') return null
		let config
		try {
			config = JSON.parse(s.contents)
		} catch {
			return null
		}
		for (const key of MANIFEST_ONLY_CONFIG_KEYS) delete config[key]
		return JSON.stringify(config)
	}
	const x = strip(before)
	const y = strip(after)
	return x !== null && x === y
}
