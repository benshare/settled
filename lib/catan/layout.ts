import {
	adjacentHexes,
	adjacentVertices,
	edgeEndpoints,
	type Hex,
	type HexNumber,
	type Vertex,
} from './board'
import type { Port } from './types'

// Pointy-top hex with circumradius s:
//   width = √3 · s, height = 2s
//   horizontal center spacing within a row: √3·s
//   vertical center spacing between rows:   1.5·s

export const HEX_ROWS: Record<1 | 2 | 3 | 4 | 5, readonly Hex[]> = {
	1: ['1A', '1B', '1C'],
	2: ['2A', '2B', '2C', '2D'],
	3: ['3A', '3B', '3C', '3D', '3E'],
	4: ['4A', '4B', '4C', '4D'],
	5: ['5A', '5B', '5C'],
}

export type HexLayout = { id: Hex; cx: number; cy: number }

export type BoardLayout = {
	s: number
	width: number
	height: number
	hexes: HexLayout[]
}

const SQRT3 = Math.sqrt(3)

// Board natural dimensions in units of s: width 5√3 · s, height 8s.
// Pick s so the whole board fits inside (targetW × targetH).
export function computeBoardLayout(
	targetW: number,
	targetH: number
): BoardLayout {
	const sFromW = targetW / (5 * SQRT3)
	const sFromH = targetH / 8
	const s = Math.min(sFromW, sFromH)
	const W = SQRT3 * s
	const width = 5 * W
	const height = 8 * s

	const rows: [1 | 2 | 3 | 4 | 5, readonly Hex[]][] = [
		[1, HEX_ROWS[1]],
		[2, HEX_ROWS[2]],
		[3, HEX_ROWS[3]],
		[4, HEX_ROWS[4]],
		[5, HEX_ROWS[5]],
	]

	const hexes: HexLayout[] = []
	for (const [rowIdx, ids] of rows) {
		const w = ids.length
		const indent = ((5 - w) / 2) * W
		const cy = (rowIdx - 1) * 1.5 * s + s
		for (let c = 0; c < w; c++) {
			const cx = indent + c * W + W / 2
			hexes.push({ id: ids[c], cx, cy })
		}
	}

	return { s, width, height, hexes }
}

// Six pointy-top corners, clockwise from the top point.
export function hexCorners(
	cx: number,
	cy: number,
	s: number
): [number, number][] {
	const corners: [number, number][] = []
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 2
		corners.push([cx + s * Math.cos(angle), cy + s * Math.sin(angle)])
	}
	return corners
}

// Each vertex coincides with a hex corner. adjacentVertices[hex][i] lines up
// with hexCorners(..)[i] (both N-clockwise), so we just walk the hexes.
export function computeVertexPositions(
	layout: BoardLayout
): Record<Vertex, { x: number; y: number }> {
	const out: Partial<Record<Vertex, { x: number; y: number }>> = {}
	for (const h of layout.hexes) {
		const corners = hexCorners(h.cx, h.cy, layout.s)
		const ids = adjacentVertices[h.id]
		for (let i = 0; i < 6; i++) {
			if (!out[ids[i]]) {
				out[ids[i]] = { x: corners[i][0], y: corners[i][1] }
			}
		}
	}
	return out as Record<Vertex, { x: number; y: number }>
}

export const PIP_COUNT: Record<HexNumber, number> = {
	2: 1,
	3: 2,
	4: 3,
	5: 4,
	6: 5,
	8: 5,
	9: 4,
	10: 3,
	11: 2,
	12: 1,
}

export type PortVisual = {
	port: Port
	// Edge midpoint — the near end of the badge (land-facing).
	anchor: { x: number; y: number }
	// Center of the rendered port badge on the water side.
	badge: { x: number; y: number }
	// Endpoint vertex positions of the coastal edge, used to draw dotted
	// dock lines from each vertex toward the badge center.
	docks: [{ x: number; y: number }, { x: number; y: number }]
}

// Position each port visually: the badge sits on the water side of the
// coastal edge, offset outward from the adjacent land hex's center.
export function computePortLayout(
	layout: BoardLayout,
	ports: readonly Port[]
): PortVisual[] {
	const vertexPos = computeVertexPositions(layout)
	const hexById = new Map(layout.hexes.map((h) => [h.id, h]))
	const out: PortVisual[] = []
	for (const port of ports) {
		const [va, vb] = edgeEndpoints(port.edge)
		const pa = vertexPos[va]
		const pb = vertexPos[vb]
		const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
		// Every port edge has exactly one adjacent land hex.
		const landHexId = commonHex(va, vb)
		if (!landHexId) continue
		const h = hexById.get(landHexId)
		if (!h) continue
		const dx = mid.x - h.cx
		const dy = mid.y - h.cy
		const len = Math.hypot(dx, dy) || 1
		const offset = layout.s * 0.55
		const badge = {
			x: mid.x + (dx / len) * offset,
			y: mid.y + (dy / len) * offset,
		}
		out.push({ port, anchor: mid, badge, docks: [pa, pb] })
	}
	return out
}

function commonHex(va: Vertex, vb: Vertex): Hex | null {
	const set = new Set(adjacentHexes[va])
	for (const h of adjacentHexes[vb]) {
		if (set.has(h)) return h
	}
	return null
}
