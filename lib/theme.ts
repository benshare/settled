import type { Resource } from './catan/board'

// --- Themed palette ----------------------------------------------------------
// Warm, earthy, tabletop-friendly palette that meshes with the Catan board
// (parchment/tan/brick/wood). Keys mirror the legacy `colors` export so screens
// can move to the theme-aware API with minimal churn.

export type ColorScheme = {
	background: string
	surface: string
	card: string
	cardAlt: string

	border: string
	borderLight: string

	text: string
	textSecondary: string
	textMuted: string

	brand: string
	brandLight: string
	brandDim: string

	accent: string
	accentDim: string

	success: string
	warning: string
	error: string

	white: string
	black: string
}

export const lightColors: ColorScheme = {
	background: '#F7EDD6',
	surface: '#F2E5C8',
	card: '#FAF3E0',
	cardAlt: '#EBDBB8',

	border: '#D9C395',
	borderLight: '#E8D7AE',

	text: '#3D2C1A',
	textSecondary: '#7A5D3E',
	textMuted: '#A8906E',

	brand: '#B94A2A',
	brandLight: '#D06040',
	brandDim: '#F3DCCF',

	accent: '#3B7FBF',
	accentDim: '#D4E4F1',

	success: '#4A8A3E',
	warning: '#D19A2A',
	error: '#A03020',

	white: '#FFFFFF',
	black: '#000000',
}

export const darkColors: ColorScheme = {
	background: '#1A130C',
	surface: '#241B10',
	card: '#2D2215',
	cardAlt: '#3A2C1C',

	border: '#4C3C27',
	borderLight: '#6A543A',

	text: '#F5E8CE',
	textSecondary: '#C0A884',
	textMuted: '#78634A',

	brand: '#D4623C',
	brandLight: '#E88050',
	brandDim: '#4A261A',

	accent: '#5BA0D8',
	accentDim: '#1A2E42',

	success: '#6AAE5E',
	warning: '#F0C357',
	error: '#E06050',

	white: '#FFFFFF',
	black: '#000000',
}

// Legacy alias used by a handful of Catan chrome components. Points at the
// light palette so un-themed game code keeps a consistent look regardless of
// the app-wide theme setting. Prefer `useTheme().colors` in new code.
export const colors = lightColors

// --- Catan game palette ------------------------------------------------------
// These are the physical-game colors: hex tiles, number tokens, robber, player
// pieces. They are intentionally NOT theme-dependent — the board looks the
// same in light or dark mode so a physical game doesn't change character.

export const catanColors = {
	water: '#3B7FBF',
	hexStroke: '#2B2B2B',
	hexStrokeWidth: 1.5,

	resource: {
		wood: '#1F7A3A',
		wheat: '#E3B23C',
		sheep: '#9BD16B',
		brick: '#B94A2A',
		ore: '#7A7F86',
		desert: '#E2C98A',
	} as Record<Resource | 'desert', string>,

	tokenFace: '#F4EAD0',
	tokenRing: '#2B2B2B',
	tokenTextCool: '#1A1A1A',
	tokenTextHot: '#B02020',

	hotNumbers: new Set([6, 8]) as ReadonlySet<number>,

	players: ['#D32F2F', '#1565C0', '#F57C00', '#FFFFFF'] as const,

	pieceStroke: '#2B2B2B',
}

export const spacing = {
	xs: 4,
	sm: 8,
	md: 16,
	lg: 24,
	xl: 32,
	xxl: 48,
} as const

export const radius = {
	sm: 6,
	md: 12,
	lg: 20,
	full: 999,
} as const

export const font = {
	xs: 11,
	sm: 13,
	base: 15,
	md: 17,
	lg: 20,
	xl: 28,
} as const
