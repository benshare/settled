import type { Resource } from './board'

export const waterColor = '#3B7FBF'
export const hexStroke = '#2B2B2B'
export const hexStrokeWidth = 1.5

export const resourceColor: Record<Resource | 'desert', string> = {
	wood: '#1F7A3A',
	wheat: '#E3B23C',
	sheep: '#9BD16B',
	brick: '#B94A2A',
	ore: '#7A7F86',
	desert: '#E2C98A',
}

export const tokenFace = '#F4EAD0'
export const tokenRing = '#2B2B2B'
export const tokenTextCool = '#1A1A1A'
export const tokenTextHot = '#B02020'

export const HOT_NUMBERS: ReadonlySet<number> = new Set([6, 8])

export const playerColors = [
	'#D32F2F',
	'#1565C0',
	'#F57C00',
	'#FFFFFF',
] as const

export const pieceStroke = '#2B2B2B'
