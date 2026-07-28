# The game routes

`[id].tsx` (the game screen shell) and `request/[id].tsx` (the pending-invite
view). Only routes live here — the shell's zones, its context, and its shared
bits are in `lib/game/`, because Expo Router warns about any file under `app/`
without a default export. **See `lib/game/CLAUDE.md`** for how the screen is put
together.
