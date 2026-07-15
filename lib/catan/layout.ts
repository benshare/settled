import {
	boardFor,
	edgeEndpoints,
	type Hex,
	type HexNumber,
	type Vertex,
} from './board'
import type { Port, Variant } from './types'

// Pointy-top hex with circumradius s:
//   width = √3 · s, height = 2s
//   horizontal center spacing within a row: √3·s
//   vertical center spacing between rows:   1.5·s

export type HexLayout = { id: Hex; cx: number; cy: number }

export type BoardLayout = {
	variant: Variant
	s: number
	width: number
	height: number
	hexes: HexLayout[]
}

const SQRT3 = Math.sqrt(3)

// Board natural dimensions in units of s come from the variant's board
// (standard 5√3 × 8, expanded 6√3 × 11). Pick s so the whole board fits
// inside (targetW × targetH), then lay out each hex row centered.
export function computeBoardLayout(
	variant: Variant,
	targetW: number,
	targetH: number
): BoardLayout {
	const board = boardFor(variant)
	const rows = board.hexRows
	const maxW = Math.max(...rows.map((r) => r.length))

	const s = Math.min(
		targetW / board.naturalWidthUnits,
		targetH / board.naturalHeightUnits
	)
	const W = SQRT3 * s
	const width = maxW * W
	const height = board.naturalHeightUnits * s

	const hexes: HexLayout[] = []
	rows.forEach((ids, r) => {
		const w = ids.length
		const indent = ((maxW - w) / 2) * W
		const cy = r * 1.5 * s + s
		for (let c = 0; c < w; c++) {
			const cx = indent + c * W + W / 2
			hexes.push({ id: ids[c], cx, cy })
		}
	})

	return { variant, s, width, height, hexes }
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
	const board = boardFor(layout.variant)
	const out: Partial<Record<Vertex, { x: number; y: number }>> = {}
	for (const h of layout.hexes) {
		const corners = hexCorners(h.cx, h.cy, layout.s)
		const ids = board.adjacentVertices[h.id]
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
	const board = boardFor(layout.variant)
	const vertexPos = computeVertexPositions(layout)
	const hexById = new Map(layout.hexes.map((h) => [h.id, h]))
	const out: PortVisual[] = []
	for (const port of ports) {
		const [va, vb] = edgeEndpoints(port.edge)
		const pa = vertexPos[va]
		const pb = vertexPos[vb]
		const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
		// Every port edge has exactly one adjacent land hex.
		const landHexId = commonHex(va, vb, board.adjacentHexes)
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

function commonHex(
	va: Vertex,
	vb: Vertex,
	adjacentHexes: Record<Vertex, readonly Hex[]>
): Hex | null {
	const set = new Set(adjacentHexes[va])
	for (const h of adjacentHexes[vb]) {
		if (set.has(h)) return h
	}
	return null
}
