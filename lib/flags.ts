// Development-only feature flags. Not user settings — flip in code and let
// fast-refresh pick up the change.

// Which game-screen layout `app/game/[id].tsx` renders. 'classic' is the
// stacked-band layout that shipped; 'hud' is the full-bleed board + floating
// HUD being trialled (see `.claude/specs/game-hud.md`). Both read the same
// providers, so switching is purely presentational.
export const GAME_LAYOUT: 'classic' | 'hud' = 'hud'
