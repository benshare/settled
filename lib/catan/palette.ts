// Legacy entry point for the physical-game palette. The source of truth is
// `catanColors` in `lib/theme.ts`; this file re-exports the individual names
// so existing game code keeps working unchanged.

import { catanColors } from '../theme'
import { COLOR_IDS } from './colors'
import type { GameState } from './types'

export const waterColor = catanColors.water
export const hexStroke = catanColors.hexStroke
export const hexStrokeWidth = catanColors.hexStrokeWidth

export const resourceColor = catanColors.resource
export const resourceShadowColor = catanColors.resourceShadow

export const tokenFace = catanColors.tokenFace
export const tokenRing = catanColors.tokenRing
export const tokenTextCool = catanColors.tokenTextCool
export const tokenTextHot = catanColors.tokenTextHot

export const HOT_NUMBERS = catanColors.hotNumbers

// Keyed by ColorId. Which seat holds which color is `GameState.colors` — go
// through `seatColor` rather than indexing this by seat.
export const playerColors = catanColors.players

export const pieceStroke = catanColors.pieceStroke

// The one seat → hex lookup. `state.colors` is resolved from every player's
// ranking at game start and read back through `parseGameColors`, so it always
// has an entry per seat; the fallback only catches a seat index that is out of
// range (a spectator's -1, say).
export function seatColor(state: GameState, seat: number): string {
	const id = state.colors[seat]
	return id ? playerColors[id] : playerColors[COLOR_IDS[0]]
}

// Every seat's hex in seat order — for the presentational components that are
// handed colors rather than the whole state.
export function seatColors(state: GameState): string[] {
	return state.colors.map((id) => playerColors[id])
}
