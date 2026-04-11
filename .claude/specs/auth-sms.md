# SMS Auth (Phase 1)

Replicate missinglink's phone-OTP auth flow in settled. Just SMS verification — no
profile/username step.

## Scope

In:
- Supabase client wired with `expo-secure-store` session persistence
- `AuthProvider` (React Context) holding session/user, exposing `signInWithPhone`,
  `verifyOtp`, `signOut`
- Phone-entry screen, OTP-entry screen, route gate that redirects between
  `(auth)` and `(app)` groups based on session
- Sign-out wired up on a placeholder home screen so we can test the round-trip

Out:
- `profiles` table, `set-username` screen, post-verify profile lookup
- Real design system / theme — plain RN primitives only
- expo-updates check, splash hiding tied to update flow
- libphonenumber-js — simple regex normalization is fine

## File layout (target)

```
app/
├── _layout.tsx                  # Wraps tree in AuthProvider, gates loading
├── index.tsx                    # Redirect to /(auth)/login or /(app)
├── (auth)/
│   ├── _layout.tsx              # Stack, headerShown: false
│   ├── login.tsx                # Phone entry → push verify
│   └── verify.tsx               # OTP entry → replace /(app)
└── (app)/
    ├── _layout.tsx              # Stack, headerShown: false
    └── index.tsx                # Placeholder "You're in" + Sign out

lib/
├── supabase.ts                  # Client + SecureStoreAdapter
└── auth.tsx                     # AuthContext + AuthProvider + useAuth
```

To delete from the scaffold (template demo, not needed):
- `app/(tabs)/`
- `app/modal.tsx`
- `components/` (all template UI)
- `hooks/` (all template hooks)
- `constants/theme.ts`
- `scripts/reset-project.js`

## Dependencies to install

- `@supabase/supabase-js` — pin to `^2.99.1` (matches missinglink)
- `expo-secure-store` — already in Expo SDK 54, install via `npx expo install expo-secure-store`

`expo-constants` is already in package.json. No async-storage, no libphonenumber.

## Implementation details

### `lib/supabase.ts`
Direct port of `missinglink/lib/supabase.ts`. Reads `supabaseUrl` and
`supabasePublicKey` from `Constants.expoConfig?.extra`. Uses a SecureStore adapter
on the auth config with `autoRefreshToken: true`, `persistSession: true`,
`detectSessionInUrl: false`.

### `lib/auth.tsx`
Direct port of `missinglink/lib/auth.tsx`:
- Context with `session`, `user`, `isLoggedIn`, `loading`, `signInWithPhone`,
  `verifyOtp`, `signOut`
- `useEffect` calls `getSession()` then sets up `onAuthStateChange` subscription;
  cleanup unsubscribes
- `signInWithPhone(phone)` → `supabase.auth.signInWithOtp({ phone })`
- `verifyOtp(phone, token)` → `supabase.auth.verifyOtp({ phone, token, type: 'sms' })`
- `signOut()` → `supabase.auth.signOut()`
- `useAuth` hook exported

### `app/_layout.tsx`
Simpler than missinglink — no theme provider, no updates check.

```
<AuthProvider>
  <RootNav />
</AuthProvider>
```

`RootNav` reads `loading` from `useAuth`. If loading, render `null` (splash stays
up). Otherwise render a `<Stack>` with `index`, `(auth)`, `(app)`,
`headerShown: false`, `animation: 'fade'`.

Keep `SplashScreen.preventAutoHideAsync()` and `hideAsync()` once `loading` is
false so we don't get a flash of unstyled content during session restore.

### `app/index.tsx`
```
const { isLoggedIn } = useAuth()
return <Redirect href={isLoggedIn ? '/(app)' : '/(auth)/login'} />
```

### `app/(auth)/login.tsx`
Plain RN port of missinglink's login screen. State: `phone`, `loading`, `error`.

- `digits = phone.replace(/\D/g, '')`
- `canContinue = digits.length >= 10`
- `useEffect` auto-submits when `canContinue` flips true (with the same eslint
  disable for exhaustive-deps)
- `handleContinue`: normalize as `digits.length === 10 ? '+1'+digits : '+'+digits`,
  call `signInWithPhone`, on success `router.push({ pathname: '/(auth)/verify',
  params: { phone: normalized } })`
- UI: SafeAreaView + KeyboardAvoidingView, title "Welcome", subtitle, `TextInput`
  (`keyboardType="phone-pad"`, `textContentType="telephoneNumber"`, `autoFocus`),
  Continue `Pressable`, error text if any
- Use `StyleSheet.create` with the project's tab indentation

### `app/(auth)/verify.tsx`
Plain RN port of missinglink's verify screen, with the profile lookup removed.

- State: `code`, `loading`, `error`. `phone` from `useLocalSearchParams`.
- Masked phone display: same regex `(\+\d)(\d+)(\d{4})` → `+1•••••••••0000`
- `useEffect` auto-submits when `code.length === 6`
- `handleVerify`: call `verifyOtp(phone, code)`. On success, `router.replace('/(app)')`.
  No profile lookup. On error, show error.
- `handleResend`: re-call `signInWithPhone(phone)`
- UI: back button, title "Check your texts", subtitle showing masked phone,
  `TextInput` (`keyboardType="number-pad"`, `maxLength={6}`, `autoFocus`), Verify
  button, Resend pressable

### `app/(app)/_layout.tsx`
Plain `<Stack screenOptions={{ headerShown: false }} />`.

### `app/(app)/index.tsx`
Placeholder so we can prove the round-trip works:
- `useAuth` for `user` and `signOut`
- Show "Signed in as {user?.phone}"
- Sign out button calling `signOut()` — onAuthStateChange will fire, root index
  will redirect back to `/(auth)/login`

## Auth state-driven navigation

Two layers, identical to missinglink:
1. **`app/index.tsx`** — only entry point that branches on `isLoggedIn`. Used on
   cold start.
2. **Imperative `router.replace`** in verify success and after sign-out (no
   manual replace needed for sign-out: the user is on `/(app)` when signOut runs;
   `onAuthStateChange` updates the context; user navigates back via system back
   gesture or we can call `router.replace('/')` to bounce through the index
   redirect).

For sign-out, call `router.replace('/')` after `signOut()` so the index redirect
fires and lands on login. Simpler than adding a global guard.

## Open / deferred

- **Phone normalization is naive** — assumes US for 10-digit input. Fine for
  internal testing; revisit when we add a country picker.
- **No rate limiting / resend cooldown UI** — Supabase will throttle on its
  end, but we don't surface it.
- **No deep-linking from SMS** — we type the code manually. iOS auto-fill from
  the SMS code suggestion bar should still work via `textContentType="oneTimeCode"`
  (add this on the verify TextInput; missinglink's custom Input may set it
  internally — worth setting explicitly here).

## Verification

After implementation:
1. `npm run check` clean
2. `npm run format` clean
3. Manual: `npm run ios`, enter a real phone number (Twilio is configured per
   user confirmation), receive SMS, enter code, land on placeholder home, tap
   sign out, back to login.
