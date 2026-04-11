# Profiles: usernames and avatars

Add a `profiles` table (one row per auth user), a forced username-selection step immediately after SMS OTP verification, and an account screen where a logged-in user can edit their username and (optionally) upload a profile picture.

Patterns are drawn from `../missinglink` where noted. Settled is currently much more barebones than missinglink, so we are _not_ porting the whole design system — only the minimum UI primitives we need.

## Scope

In scope:

- New `profiles` table + RLS policies in a new `supabase/` directory managed by the supabase CLI.
- New public `avatars` storage bucket + storage policies.
- New `(auth)/set-username` screen, inserted into the flow after `verify`.
- Convert `app/(app)/index.tsx` into an **account screen** (username edit + avatar upload + sign out). There is no separate "home" screen yet — the account screen is the entire logged-in state.
- A tiny shared component library at `lib/modules/` (`Button`, `Input`, `Avatar`) plus a `lib/theme.ts` token file. No theme context — flat imports from `lib/theme.ts`.
- Zustand profile store at `lib/stores/useProfileStore.ts`.
- Generated DB types at `lib/database-types.ts` plus a `npm run types` script.

Out of scope:

- Display-name / bio / any profile field beyond `username` and `avatar_path`.
- Leaderboard, friends, or anything that reads other users' profiles.
- Dark mode / ThemeContext. Missinglink has one; settled doesn't need it yet.
- Avatar moderation, NSFW checks, EXIF stripping beyond what expo-image-picker already does.
- Image CDN / transforms. We store the original compressed JPEG and display it as-is.

## Design decisions (locked in)

1. **Profile row creation** — client-side upsert in `set-username`, not a DB trigger. Matches missinglink. The verify screen decides where to route by querying `profiles` after OTP success.
2. **Avatar bucket** — public, path stored in `profiles.avatar_path`. Display uses `supabase.storage.from('avatars').getPublicUrl(path)`. No signed URLs.
3. **UI primitives** — start `lib/modules/{Button,Input,Avatar}.tsx` with a minimal port of the missinglink components. Avatar renders an image if `avatar_path` is set, otherwise a letter fallback. All three read tokens from a flat `lib/theme.ts` (no context).
4. **Profile state** — zustand store (`useProfileStore`) fetched once from DB on login and after username/avatar updates. Matches missinglink.
5. **Image picking** — `expo-image-picker`, `allowsEditing: true`, `aspect: [1,1]`, `quality: 0.7`, mediaTypes `Images`. Upload the cropped JPEG to storage under `avatars/{user_id}/avatar.jpg` with `upsert: true`. Cache-bust displayed URL with `?v={timestamp}` after upload so the new image appears immediately.
6. **Supabase CLI** — run `supabase init` inside the repo to create `supabase/config.toml`, then add migrations under `supabase/migrations/`. Link to the existing project ref (`ymbtisbqwehsgpidntag`) before the first `db push`. User will run `supabase link` and `supabase db push` interactively; Claude will never run destructive DB operations.
7. **Types generation** — add `"types": "supabase gen types typescript --project-id ymbtisbqwehsgpidntag > lib/database-types.ts"` to `package.json`. `lib/supabase.ts` is updated to type the client with `Database` from this file.
8. **Verify routing** — after `verifyOtp` succeeds, `verify.tsx` queries `profiles` for the current user's row. If no row (or `username` is absent — the row shouldn't exist at all in our flow), `router.replace('/(auth)/set-username')`. Otherwise `router.replace('/(app)')`. The store is also loaded here so the account screen has immediate data.

## Username validation rules

Identical to missinglink:

- 3–20 chars.
- `/^[a-zA-Z0-9_]+$/` — letters, numbers, underscores.
- Case-insensitive uniqueness enforced by a unique index on `lower(username)`.
- Client rejects with a clear error message before hitting the DB. Server is the source of truth — handle Postgres error code `23505` as "username already taken".

## Database migration

One migration file: `supabase/migrations/<timestamp>_profiles.sql`.

```sql
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text not null,
  avatar_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Authenticated users can read any profile (will be needed once we add social features,
-- and it keeps the spec aligned with missinglink's pattern).
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

-- Users can insert/update/delete only their own row.
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (id = auth.uid());

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();
```

Storage migration (same file or a second one — single file is fine):

```sql
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Public read (anyone can view any avatar; bucket is public).
create policy "avatars_read_public" on storage.objects
  for select using (bucket_id = 'avatars');

-- Authenticated users can write only under their own user-id folder.
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

After writing the migration, **stop and show the user** the full SQL. Only after they approve will they run `supabase link` + `supabase db push`. Claude never runs those commands.

Once migrated, regenerate types via `npm run types` and update `lib/supabase.ts` to parameterize `createClient<Database>`.

## Code layout

New / changed files:

```
app/
  (auth)/
    _layout.tsx             (add set-username to the stack)
    set-username.tsx        (new)
    verify.tsx              (after verifyOtp: query profile, route accordingly)
  (app)/
    _layout.tsx             (unchanged except: on mount, load profile store)
    index.tsx               (rewritten as the account screen)
lib/
  theme.ts                  (new: colors, spacing, radius, font tokens)
  database-types.ts         (generated)
  supabase.ts               (add Database type param)
  stores/
    useProfileStore.ts      (new)
  modules/
    Button.tsx              (new)
    Input.tsx               (new)
    Avatar.tsx              (new)
supabase/
  config.toml               (from supabase init)
  migrations/
    <ts>_profiles.sql       (new)
package.json                (add types script, add expo-image-picker + zustand)
```

### `lib/theme.ts`

Flat token exports. No context. Example shape:

```ts
export const colors = {
	background: '#ffffff',
	card: '#f5f5f7',
	border: '#e5e5ea',
	text: '#111',
	textSecondary: '#555',
	textMuted: '#999',
	brand: '#6c5ce7',
	error: '#e74c3c',
	white: '#fff',
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 }
export const radius = { sm: 6, md: 12, lg: 20, full: 999 }
export const font = { sm: 13, base: 15, md: 17, lg: 20, xl: 28 }
```

Exact palette isn't load-bearing — pick something clean and minimal. All three primitives import directly from this file.

### `lib/modules/Button.tsx`

Port missinglink's Button, but:

- Remove `useTheme()` — import `colors, font, radius, spacing` from `lib/theme`.
- Drop the shadow helper and `brand`/`primary`/`secondary`/`ghost`/`danger` variant sprawl. Start with `primary` and `secondary` only. Add more if/when needed.
- Keep `loading` prop with `ActivityIndicator` and `disabled` state.
- Keep the 52px default height (matches missinglink's `md`).

### `lib/modules/Input.tsx`

Port missinglink's Input directly, minus `useTheme`. Keep `label`, `error`, `hint` props. Keep the uppercase label styling. Disable `outline`/ring on web (not relevant on native, so no extra work).

### `lib/modules/Avatar.tsx`

Extended vs. missinglink — needs to show a real image when available.

```
Props: { profile: Profile | null; size?: number }

If profile?.avatar_path:
  render <Image source={{ uri: getAvatarUrl(profile.avatar_path, profile.updated_at) }} />
Else:
  render circle with first letter of username (fallback matches missinglink styling).

Exposes helper `getAvatarUrl(path, cacheBust?)` that calls
supabase.storage.from('avatars').getPublicUrl(path) and appends `?v=<cacheBust>` if provided.
```

Use `updated_at` as the cache-busting token so a new upload surfaces immediately. (Alternative: the store can hold a local `avatarVersion` bumped on upload — we'll use `updated_at` since it's already on the profile row.)

### `lib/stores/useProfileStore.ts`

Zustand store modeled after missinglink's `useProfileStore`. Shape:

```ts
type Profile = {
	id: string
	username: string
	avatar_path: string | null
	created_at: string
	updated_at: string
}

type ProfileStore = {
	profile: Profile | null
	loading: boolean
	loadProfile: (userId: string) => Promise<Profile | null>
	clearProfile: () => void
	updateUsername: (username: string) => Promise<{ error: string | null }>
	updateAvatarPath: (path: string | null) => Promise<{ error: string | null }>
}
```

Notes:

- `loadProfile` does a `select * from profiles where id = userId` and sets state. Returns the row (or null if missing — used by `verify.tsx` to decide routing).
- `updateUsername` runs the update, handles `23505`, and on success updates local state without a refetch.
- `updateAvatarPath` similarly.
- `clearProfile` is called from `signOut`.
- The store does **not** subscribe to auth changes on its own — the screens call it explicitly. Simpler control flow.

### `app/(auth)/verify.tsx` change

Current flow:

```
verifyOtp → router.replace('/(app)')
```

New flow:

```
verifyOtp succeeds
→ const profile = await useProfileStore.getState().loadProfile(data.user.id)
→ if (profile) router.replace('/(app)')
  else        router.replace('/(auth)/set-username')
```

### `app/(auth)/set-username.tsx` (new)

Copy of missinglink's set-username, simplified to use settled's primitives:

- No `Screen` component — use a plain `SafeAreaView` + `KeyboardAvoidingView` similar to what `login.tsx`/`verify.tsx` already do in settled.
- Title + subtitle, Input, Button.
- `validateUsername` regex/length rules inline at the top of the file.
- On submit: `supabase.from('profiles').upsert({ id, username }, { onConflict: 'id' })`.
- On success: `loadProfile(user.id)` then `router.replace('/(app)')`.
- Error code `23505` → "Username already taken". Any other DB error → generic.
- Button disabled until `username.length >= 3`.
- No back button / no way to skip. The `(auth)/_layout.tsx` stack entry for this route should be `gestureEnabled: false` and have no back button.

### `app/(app)/index.tsx` → account screen (rewrite)

Sections:

1. **Avatar + username header**
    - Large `<Avatar profile={profile} size={96} />` centered.
    - Below it: tappable "Change photo" text button that opens the image picker.
    - Username displayed below in `font.xl`.

2. **Edit username**
    - A row ("Username", with current value) that flips into an inline edit mode with an `Input` and Cancel/Save buttons.
    - Same live uniqueness check as missinglink: debounced 400ms, `count` query filtering `.ilike('username', value).neq('id', user.id)`.
    - Save button disabled until: format valid, not taken, not same as current, not checking.
    - On save: `useProfileStore.updateUsername(value)`. On error `23505` → inline "Username already taken". Otherwise generic.

3. **Sign out** — keep the existing button, just restyled with the new `Button` (variant `secondary`).

Layout uses a plain `SafeAreaView` with a `ScrollView`. No drawer/tabs yet.

### Avatar upload flow

```
1. User taps "Change photo".
2. Call `ImagePicker.requestMediaLibraryPermissionsAsync()`. If denied, show an inline message.
3. Call `ImagePicker.launchImageLibraryAsync({
     mediaTypes: ImagePicker.MediaTypeOptions.Images,
     allowsEditing: true,
     aspect: [1, 1],
     quality: 0.7,
   })`.
4. If not cancelled: read the returned `assets[0].uri`. Convert to a blob via
   `const res = await fetch(uri); const blob = await res.blob();`
   (expo-image-picker returns a file:// URI; `fetch` handles it).
5. Upload: `supabase.storage.from('avatars').upload(
     `${user.id}/avatar.jpg`,
     blob,
     { contentType: 'image/jpeg', upsert: true }
   )`.
6. On success: call `useProfileStore.updateAvatarPath(`${user.id}/avatar.jpg`)`. The DB update bumps `updated_at`, which we use as the cache-bust token, so the `<Image />` re-renders with the new photo.
7. While the upload is in flight, show a spinner overlay on the avatar.
8. On failure, show an inline toast/error under the avatar.
```

Permissions note: on iOS, add the photo library usage description to `app.json` → `ios.infoPlist.NSPhotoLibraryUsageDescription`. Claude will add this.

## Dependencies

Add to `package.json`:

- `zustand` (latest 4.x)
- `expo-image-picker` (Expo-recommended version — use `npx expo install expo-image-picker`)

No other new deps.

## Verification checklist (phase 2 done when all green)

- [ ] `supabase init` run, `config.toml` committed.
- [ ] Migration file written, shown to user, applied via `supabase db push` (user runs).
- [ ] `npm run types` regenerated `lib/database-types.ts`. `lib/supabase.ts` uses `<Database>` generic.
- [ ] New user flow: phone → OTP → set-username (no back) → account screen with username shown.
- [ ] Returning user flow: phone → OTP → account screen (skips set-username).
- [ ] Account screen: username edit with live uniqueness, saves, updates store.
- [ ] Account screen: image picker opens, crops, uploads, avatar re-renders immediately.
- [ ] Sign out returns to login and `clearProfile()` is called.
- [ ] `npm run check` passes (tsc, eslint, expo-doctor).
- [ ] `npm run format` run.

## Open questions

None remaining — all clarifying questions resolved in chat before writing this spec.
