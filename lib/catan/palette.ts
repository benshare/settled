// Legacy entry point for the physical-game palette. The source of truth is
// `catanColors` in `lib/theme.ts`; this file re-exports the individual names
// so existing game code keeps working unchanged.

import { catanColors } from '../theme'

export const waterColor = catanColors.water
export const hexStroke = catanColors.hexStroke
export const hexStrokeWidth = catanColors.hexStrokeWidth

export const resourceColor = catanColors.resource

export const tokenFace = catanColors.tokenFace
export const tokenRing = catanColors.tokenRing
export const tokenTextCool = catanColors.tokenTextCool
export const tokenTextHot = catanColors.tokenTextHot

export const HOT_NUMBERS = catanColors.hotNumbers

export const playerColors = catanColors.players

export const pieceStroke = catanColors.pieceStroke
