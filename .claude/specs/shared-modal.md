# Shared base `Modal` component

## Problem

Modals across the app are bespoke re-implementations of React Native's `<Modal>`. Roughly half wire up click-outside-to-dismiss (outer `Pressable` backdrop + inner swallow `Pressable`); the rest use a plain `<View>` backdrop and silently *don't* dismiss on an outside tap. This inconsistency is the reported bug ("many modals are not dismissed when clicking outside"). It's been patched ad hoc in several files.

## Goal

Introduce one base-level, content-agnostic `Modal` component that bakes in the correct dismissal behavior, and route **every** existing `<Modal>` usage through it so the behavior is uniform and there's a single place to change it.

## The component

`lib/modules/Modal.tsx`, exporting `Modal`.

### Responsibilities (what it owns)

- Renders RN `<Modal transparent animationType="fade">`.
- `onRequestClose` → `onDismiss` (Android hardware-back + web Escape).
- A dimmed, centered backdrop `Pressable` that calls `onDismiss` on press when dismissal is enabled.
- An inner wrapper that swallows taps so presses on the content never bubble to the backdrop.
- The content wrapper carries **only** a default `borderRadius` + a small shadow (`shadow-sm` equivalent), both overridable. No background color, padding, width, or max-width opinion — callers style their own sheet via `children` / `contentStyle`.

### Props

```ts
{
  visible: boolean
  onDismiss: () => void
  dismissOnBackdropPress?: boolean   // default true
  children: ReactNode
  contentStyle?: StyleProp<ViewStyle> // merged over the default radius+shadow
}
```

- When `dismissOnBackdropPress` is `false`: the backdrop is a plain non-interactive layer (no press handler), but `onRequestClose` still routes to `onDismiss` (so hardware-back/Escape can still close where the caller wants that; callers that must fully trap can pass a no-op — matches current behavior per file).
- The inner swallow wrapper is always present regardless of the dismiss flag, so content taps never fall through.

### Styling details

- Backdrop: `flex: 1`, `rgba(0,0,0,0.55)`, centered (`alignItems`/`justifyContent: center`), `padding: spacing.lg`. Matches the existing `ConfirmModal` backdrop.
- Content default: `borderRadius: radius.md` + shadow (`shadowColor '#000'`, `shadowOffset {0,2}`, `shadowOpacity 0.12`, `shadowRadius 6`, `elevation 3` — the shadow idiom already used across `lib/catan`). Overridable via `contentStyle`.
- The component does **not** memoize against theme colors (backdrop color is static); no `useTheme` needed.

## Migration

Replace the bespoke `<Modal>` + backdrop/swallow scaffolding in each file with `<Modal ...>`, keeping each file's existing **sheet** styling (bg, padding, width, etc.) on the content it passes as children (via `contentStyle` or its own inner view — whichever is the smaller diff). Do not change any modal's content, layout, or logic — only the outer shell.

### Dismiss-on-outside-tap = keep enabled (default `dismissOnBackdropPress` / omit)

Currently use a `Pressable` backdrop + `onCancel`/`onClose`:

- `lib/modules/ConfirmModal.tsx` → `onCancel`
- `lib/catan/ForgerMovePicker.tsx`, `MetropolitanCostPicker.tsx`, `ShepherdSwapPicker.tsx`, `RitualistPicker.tsx`, `AccountantPicker.tsx`, `YearOfPlentyPicker.tsx`, `InvestPicker.tsx`, `MonopolyPicker.tsx` → `onCancel`
- `lib/catan/PlayerDetailOverlay.tsx` → `onClose`
- `lib/catan/DevCardHand.tsx` → `setOpenGroup(null)`
- `lib/catan/MagicianPickOverlay.tsx` — **first** modal → `onSkip`

### Forced-choice / terminal overlays — currently NON-dismissible (`View` backdrop)

Route through `Modal` with `dismissOnBackdropPress={false}` to preserve current behavior (no accidental outside-tap dismiss) while unifying the shell:

- `lib/catan/CurioPickOverlay.tsx` (both modals)
- `lib/catan/ScoutPickOverlay.tsx` (both modals)
- `lib/catan/ForgerPickOverlay.tsx`
- `lib/catan/MagicianPickOverlay.tsx` — **second** modal
- `lib/catan/PostPlacementOverlay.tsx` (both modals)
- `lib/catan/GameOverOverlay.tsx` (keeps `onRequestClose → onDismiss`; still no outside-tap)

### Animation overlays — auto-dismiss on a timer, no user dismissal

Route through `Modal` with `dismissOnBackdropPress={false}`. These use an `Animated.View` for the backdrop fade; keep that by passing the animated backdrop as/inside the content and disabling the component's own backdrop press — OR leave the component's static backdrop and mount the animated content as children. Chosen approach per file: keep each animation's existing `Animated.View` visuals intact; only swap the raw `<Modal>` wrapper. If a clean fit isn't possible without altering the animation, **leave the file as-is** and note it (these are not the source of the bug).

- `lib/catan/StealAnimation.tsx`
- `lib/catan/NomadAnimation.tsx`
- `lib/catan/FortuneTellerAnimation.tsx`

### Out of scope

- `lib/catan/GameChat.tsx` `ChatPanel` — deliberately NOT an RN `<Modal>` (stays inside the play area; documented in `lib/catan/CLAUDE.md`). Untouched.
- Floating, non-panel UI (`BoardLegend`, `ActionLog`, `BuildTradeBar`, `TradeBanner`, `Tooltip`, `TabBarIcon`, floating layers in `app/game/[id].tsx`).

## Verification

- `pnpm check` (tsc + eslint) passes.
- `pnpm format`.
- No remaining bespoke `<Modal>` in the migrated files (grep `from 'react-native'` no longer pulls `Modal` where migrated; `<Modal` occurrences are the shared component).
- Spot-behavior: dismissible modals still close on backdrop tap; forced-choice/animation ones still don't.

## Docs

Update `lib/modules/CLAUDE.md` (create if absent) noting `Modal` as the base overlay primitive and the `dismissOnBackdropPress` contract. Note `ConfirmModal` now builds on it.
