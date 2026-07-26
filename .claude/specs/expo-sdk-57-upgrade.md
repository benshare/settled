# Expo SDK 54 → 57 upgrade

## Goal

Move the app from Expo SDK 54 (`expo ~54.0.36`, React Native 0.81.5, React 19.1)
to SDK 57 (`expo 57.0.8`, React Native 0.86, React 19.2), fixing every breaking
change introduced across SDK 55, 56, and 57, and leaving `npm run check` clean.

## Starting state

- Single-app repo (no monorepo), package manager **pnpm 11.5.1**, Node v22.22.3.
- **CNG** — no `ios/` or `android/` directories; `.gitignore` excludes `/ios`
  and `/android`. Native projects are generated at build time, so no
  `prebuild`, `pod install`, or Gradle cache steps are needed.
- New Architecture and React Compiler are already enabled.
- No `metro.config.js`, no `patches/`, no `expo.install.exclude`, no
  `postcss.config.*`, no `sdkVersion` in `app.json`.
- 134 TS/TSX source files under `app/`, `lib/`, `dev/`.

## Scope of changes

### 1. Dependency bumps

Driven by `npx expo install expo@latest` then `npx expo install --fix`, which
resolves every `expo-*` and React Native ecosystem package to its SDK 57
version. Expected headline moves:

| Package                        | 54       | 57 (expected) |
| ------------------------------ | -------- | ------------- |
| `expo`                         | ~54.0.36 | 57.0.8        |
| `react-native`                 | 0.81.5   | 0.86.x        |
| `react` / `react-dom`          | 19.1.0   | 19.2.x        |
| `react-native-reanimated`      | ~4.1.1   | ~4.5.x        |
| `react-native-worklets`        | 0.5.1    | ~0.10.x       |
| `react-native-gesture-handler` | ~2.28.0  | ~2.32.x       |
| `babel-preset-expo`            | ~54.0.12 | ~57.x         |

`@supabase/supabase-js` and `zustand` are not Expo-managed; leave them unless
something breaks.

### 2. Dependencies to remove

Confirmed unused across the entire repo (no import, no config-plugin reference,
no mention outside `package.json` / lockfile):

- `@react-navigation/bottom-tabs`
- `@react-navigation/elements`
- `@react-navigation/native`
- `expo-symbols`
- `expo-haptics`

**Three further removals were reverted.** `expo-application`, `expo-clipboard`,
and `expo-sharing` are unused in source, but `.claude/specs/mobile-deploy.md`
records them as deliberately "pre-installed for OTA forward-compat" — native
modules have to be compiled into the binary, so dropping them would mean any
later clipboard/share/app-info feature needs a full rebuild and App Store
review instead of an OTA. They are restored. **Do not remove them on the
grounds that nothing imports them** — that is the whole point of their being
there.

The `@react-navigation/*` three matter beyond tidiness: **SDK 56 severs
`expo-router`'s dependency on react-navigation**, so leaving them pinned would
let them drift out of sync with the router. Nothing in `app/` or `lib/` imports
`@react-navigation/*`, so the SDK 56 codemod
(`npx expo-codemod sdk-56-expo-router-react-navigation-replace`) is **not**
needed.

Also remove the implicit packages Expo now provides itself:

- `babel-preset-expo` from `devDependencies` — removed, confirmed fine.
- `expo-constants` — **removal reverted.** Typecheck passed without it (it
  resolves transitively), but `expo-doctor` flagged it as a required _native_
  peer dependency of `expo-router`: "Your app may crash outside of Expo Go
  without this dependency. Native module peer dependencies must be installed
  directly." It is back as a direct dependency at `~57.0.7`. Do not remove it in
  a future cleanup — typecheck alone will not catch this.

### 3. Dependencies to keep despite deprecation

**`@expo/vector-icons`** — deprecated in SDK 56 in favour of the scoped
`@react-native-vector-icons/*` packages, and `expo` no longer depends on it.
Decision: **keep it**, promoted to an explicit direct dependency, and leave all
26 importing files unchanged. It still functions in SDK 57. Migrating is a
separate task, not part of this upgrade.

Affected files (unchanged, listed for the record): `app/send-request.tsx`,
`app/(app)/{games,stats,friends,_layout,create-game}.tsx`,
`app/game/[id].tsx`, `app/game/request/[id].tsx`, and 18 files under
`lib/catan/` + `lib/modules/`.

**`typescript`** — stays at `~5.9.2`. SDK 56 templates ship TypeScript 6.0.3,
but TS 6 carries its own breaking changes and would require bumping
`@typescript-eslint/*` off 8.x. Add an `expo.install.exclude` entry so
`expo install --fix` does not pull TS 6:

```json
"expo": { "install": { "exclude": ["typescript"] } }
```

This is the first `expo.install.exclude` in the project; it is a deliberate pin,
not a stale workaround.

### 4. `app.json` changes

- **Remove `newArchEnabled: true`** — the config key was removed in SDK 55;
  New Architecture is the only architecture and Legacy was dropped after SDK 54.
- **Remove `android.edgeToEdgeEnabled: true`** — removed in SDK 55; edge-to-edge
  is mandatory for Android 16+.
- Leave `android.predictiveBackGestureEnabled`, the `expo-splash-screen` plugin
  block, `experiments.typedRoutes`, `experiments.reactCompiler`, `updates`, and
  `runtimeVersion` as-is.
- No `notification` field is present, so the SDK 55 "notification field throws
  during prebuild" change does not apply.

### 5. CI fix — `eas update --environment`

`.github/workflows/ota-update.yml` runs:

```
eas update --branch production --message "…" --non-interactive
```

SDK 55 made **`--environment` required** on `eas update`. This workflow will
start failing on every push to `main` after the upgrade. Add
`--environment production` to match the local `ota` script in `package.json`,
which already passes it.

Also bump `node-version` if EAS/Expo raises the floor — SDK 56 requires Node
`^20.19.4`, `^22.13.0`, `^24.3.0` or `^25.0.0`; the workflow's `22` satisfies
this, so no change expected.

### 6. `babel.config.js`

Currently:

```js
presets: ['babel-preset-expo'],
plugins: ['react-native-worklets/plugin'],
```

**Resolved: `babel.config.js` deleted.** `babel-preset-expo@57` applies the
worklets plugin automatically whenever `react-native-worklets` resolves —
`node_modules/babel-preset-expo/build/configs/expo.js:109-113`:

```js
// Automatically add worklets or reanimated plugin when package is installed.
if (options.worklets !== false && options.reanimated !== false) {
	const workletsPluginPath = resolveModule(
		api,
		'react-native-worklets/plugin'
	)
	if (workletsPluginPath) plugins.push([require(workletsPluginPath)])
}
```

So the explicit `plugins: ['react-native-worklets/plugin']` was not just
redundant, it would have applied the worklet transform twice. With that entry
gone the file held only `presets: ['babel-preset-expo']`, which Expo's Metro
transformer defaults to when no `babel.config.js` exists — so the whole file
was removed. Verified by a clean `expo export` (Reanimated drives the entire
Catan board).

### 7. Breaking changes checked and found not to apply

Verified by grep across the repo — no action needed, recorded so the next
upgrade does not re-investigate:

- `expo-av` → `expo-audio`/`expo-video` split: no `expo-av` usage.
- `expo-blur` `experimentalBlurMethod` rename / `BlurTargetView`: not used.
- `expo-clipboard` listener `content` property removal: not used.
- `expo-cellular` constant removals: not used.
- `expo-navigation-bar` method deprecations: not used.
- `expo-file-system` `copy()`/`move()` becoming async: not used.
- `removeSubscription()` → `subscription.remove()`: no occurrences.
- `expo-router/server` `ExpoRequest`/`ExpoResponse` removal: no server routes.
- Headless `Tabs` `reset` → `resetOnFocus`: `app/(app)/_layout.tsx` uses the
  standard `<Tabs>` from `expo-router`, not the headless API.
- `@expo/dom-webview` default: no DOM components.
- `EXPO_USE_FAST_RESOLVER` / metro config removals: no `metro.config.js`.
- `autoprefixer` / postcss: not present.
- Hermes V1 + Reanimated memory regression: we are **not** opting into Hermes V1
  (`expo-build-properties` is not installed), so this does not apply.

### 8. Behavioural change to watch — `expo/fetch` as global `fetch`

SDK 56 makes `expo/fetch` the default implementation of `globalThis.fetch`.
`@supabase/supabase-js` uses `fetch` for PostgREST/auth/edge-function calls, so
this swaps the transport underneath every Supabase request in `lib/supabase.ts`,
`lib/auth.tsx`, `lib/gameSync.ts`, and `lib/stats.ts`.

This is expected to be fine, but it is the single highest-risk item in the
upgrade. If Supabase requests misbehave (streaming, headers, aborts, or
multipart image upload from `expo-image-picker`), the escape hatch is
`EXPO_PUBLIC_USE_RN_FETCH=1` in `.env`, which restores the React Native fetch.
Realtime uses WebSockets and is unaffected.

### 9. Source changes required by React Native 0.86

The whole 134-file codebase produced exactly four type errors. All four are RN
0.86 type/API changes, not app bugs:

- **`app/(app)/account.tsx`** — `StyleSheet.absoluteFillObject` no longer
  exists. It is gone from both the types and the runtime in 0.86. The
  replacement is `StyleSheet.absoluteFill`, which in 0.86 **is** the plain
  frozen object that `absoluteFillObject` used to be
  (`react-native/Libraries/StyleSheet/StyleSheetExports.js:21`), so spreading it
  is an exact swap. (This was historically a real distinction — `absoluteFill`
  used to be a registered style ID that could not be spread — hence worth
  recording.)
- **`lib/ThemeContext.tsx`** — `useColorScheme()` now returns
  `'light' | 'dark' | 'unspecified'` and is no longer nullable, so
  `systemScheme ?? 'light'` stopped compiling. Replaced with an explicit
  `systemScheme === 'dark' ? 'dark' : 'light'`, which preserves the old
  behaviour exactly (everything that isn't dark falls back to light).
- **`app/(app)/_layout.tsx` + `lib/modules/TabBarIcon.tsx`** — the `color`
  passed to `tabBarIcon` widened from `string` to `ColorValue`. Widened the
  `color` prop on `FriendsTabIcon`, `GamesTabIcon`, and the shared `TabBarIcon`
  to `ColorValue` to match; `@expo/vector-icons` already accepted it.

### 10. Changes for the next native build

The SDK 57 JS bundle cannot run on the existing SDK 54 binaries, so this
release must ship as a native build, not an OTA.

- **`app.json` `version`: `1.0.0` → `1.1.0`.** Because `runtimeVersion.policy`
  is `appVersion`, this is what creates the runtime boundary: the new build
  publishes under runtime `1.1.0`, while installs still on the SDK 54 binary
  stay on runtime `1.0.0` and simply stop receiving updates rather than being
  served an incompatible bundle. Verified via `expo config --type public`.
- **`expo-sharing` added to the `plugins` array.** It now ships a config plugin
  and `expo install` cannot write it automatically, because the project uses a
  dynamic `app.config.js`. The plugins list itself lives in `app.json` (the
  dynamic config only spreads `config` and injects Supabase `extra` values), so
  the entry goes there.
- Build numbers need no change — `eas.json` uses `appVersionSource: "remote"`
  with `autoIncrement: true` on the production profile, so EAS assigns the iOS
  build number server-side.
- **Do not run `npm run ota` / let the OTA workflow publish this to the SDK 54
  runtime.** Ship `npm run build:native` first.

## Out of scope

- Migrating `@expo/vector-icons` → `@react-native-vector-icons/*`.
- Bumping TypeScript to 6.
- Opting into Hermes V1.
- Any feature, UI, or gameplay change.
- Merging to `main` or deleting the worktree.

## Verification

1. `pnpm install` resolves cleanly with no peer-dependency errors.
2. `npx expo-doctor` passes (it runs as part of `npm run check`).
3. `npm run check` — `tsc --noEmit`, `eslint . --fix`, `expo-doctor` all clean.
4. `npm run format`.
5. `npx expo export -p ios --clear` completes — this is the strongest offline
   signal that the bundle graph, Babel/worklets config, and React Compiler
   still work together.
6. Report to the user what still needs a device: a fresh `eas build` development
   client (the SDK jump invalidates the existing one — the old dev client
   **cannot** run SDK 57 JS), then a manual pass over auth, notifications,
   image picker, realtime game sync, and the Catan board's Reanimated/SVG
   rendering.

## Notes

- The existing production dev-client and any installed builds are on SDK 54.
  After this lands, an OTA update must **not** be shipped to the SDK 54
  production channel — `runtimeVersion.policy` is `appVersion`, so bump the app
  version and ship a new native build rather than an OTA.
- Keep `CLAUDE.md` files in touched directories in sync as the work lands.
