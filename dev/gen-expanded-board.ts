// Generates the static geometry for the 5-6 player EXPANDED board (30 hexes,
// rows 3-4-5-6-5-4-3) and prints copy-pasteable TypeScript literals for
// lib/catan/board.ts (and its mirror in the edge function).
//
// Run: npx tsx dev/gen-expanded-board.ts
//
// The output must satisfy the same invariants the standard board does:
//   - adjacentVertices[hex] is 6 vertices in N-clockwise order, so it lines up
//     with layout.ts `hexCorners` (which returns N-clockwise corners). This is
//     what lets computeVertexPositions place vertices for any board.
//   - VERTICES / EDGES ordered top-to-bottom, left-to-right for stable IDs.
//   - COASTAL_EDGES walked as a true clockwise ring so PORT_SLOTS spacing works.
//
// Regenerate and paste into board.ts if the expanded layout ever changes.

const SQRT3 = Math.sqrt(3)
const ROW_WIDTHS = [3, 4, 5, 6, 5, 4, 3]
const MAX_W = Math.max(...ROW_WIDTHS)

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
function col(i: number): string {
	if (i < 26) return LETTERS[i]
	return LETTERS[Math.floor(i / 26) - 1] + LETTERS[i % 26]
}

type Pt = { x: number; y: number }
const key = (p: Pt) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`

// --- Hex centers -----------------------------------------------------------

type HexCell = { id: string; cx: number; cy: number; row: number; col: number }
const hexes: HexCell[] = []
for (let r = 0; r < ROW_WIDTHS.length; r++) {
	const w = ROW_WIDTHS[r]
	const indent = ((MAX_W - w) / 2) * SQRT3
	const cy = r * 1.5 + 1
	for (let c = 0; c < w; c++) {
		const cx = indent + c * SQRT3 + SQRT3 / 2
		hexes.push({ id: `${r + 1}${col(c)}`, cx, cy, row: r, col: c })
	}
}

// --- Corners (N-clockwise, matching layout.ts hexCorners) ------------------

function corners(cx: number, cy: number): Pt[] {
	const out: Pt[] = []
	for (let i = 0; i < 6; i++) {
		const a = (Math.PI / 3) * i - Math.PI / 2
		out.push({ x: cx + Math.cos(a), y: cy + Math.sin(a) })
	}
	return out
}

// Dedupe corners into canonical vertices, id'd top-to-bottom / left-to-right.
const ptByKey = new Map<string, Pt>()
for (const h of hexes) {
	for (const p of corners(h.cx, h.cy))
		if (!ptByKey.has(key(p))) ptByKey.set(key(p), p)
}
const minY = Math.min(...[...ptByKey.values()].map((p) => p.y))
// Vertex y-levels are 1.5k and 1.5k+0.5; band = floor((y+0.25)/1.5).
const band = (p: Pt) => Math.floor((p.y - minY + 0.25) / 1.5)

const byBand = new Map<number, Pt[]>()
for (const p of ptByKey.values()) {
	const b = band(p)
	if (!byBand.has(b)) byBand.set(b, [])
	byBand.get(b)!.push(p)
}
const vertexId = new Map<string, string>()
const VERTICES: string[] = []
for (const b of [...byBand.keys()].sort((a, z) => a - z)) {
	const row = byBand.get(b)!.sort((a, z) => a.x - z.x || a.y - z.y)
	row.forEach((p, i) => {
		const id = `${b + 1}${col(i)}`
		vertexId.set(key(p), id)
		VERTICES.push(id)
	})
}

// --- adjacentVertices, EDGES ----------------------------------------------

const adjacentVertices: Record<string, string[]> = {}
const edgeSet = new Set<string>()
const canonEdge = (a: string, b: string) =>
	a < b ? `${a} - ${b}` : `${b} - ${a}`

for (const h of hexes) {
	const cs = corners(h.cx, h.cy)
	const ids = cs.map((p) => vertexId.get(key(p))!)
	adjacentVertices[h.id] = ids
	for (let i = 0; i < 6; i++) edgeSet.add(canonEdge(ids[i], ids[(i + 1) % 6]))
}
const EDGES = [...edgeSet].sort()

// --- Coastal ring (edges bordering exactly one hex), walked clockwise ------

const edgeHexCount = new Map<string, number>()
for (const h of hexes) {
	const ids = adjacentVertices[h.id]
	for (let i = 0; i < 6; i++) {
		const e = canonEdge(ids[i], ids[(i + 1) % 6])
		edgeHexCount.set(e, (edgeHexCount.get(e) ?? 0) + 1)
	}
}
const coastal = EDGES.filter((e) => edgeHexCount.get(e) === 1)

// Each boundary vertex touches exactly 2 coastal edges → walk the cycle.
const coastalByVertex = new Map<string, string[]>()
for (const e of coastal) {
	const [a, b] = e.split(' - ')
	;(coastalByVertex.get(a) ?? coastalByVertex.set(a, []).get(a)!).push(e)
	;(coastalByVertex.get(b) ?? coastalByVertex.set(b, []).get(b)!).push(e)
}
for (const [v, es] of coastalByVertex)
	if (es.length !== 2)
		throw new Error(`boundary vertex ${v} has ${es.length} coastal edges`)

const vpos = (id: string) => {
	for (const [k, vid] of vertexId) if (vid === id) return ptByKey.get(k)!
	throw new Error(`no pos for ${id}`)
}
// Start at the topmost coastal vertex; walk toward the neighbor that keeps the
// board interior on our right (clockwise), matching board.ts COASTAL_EDGES.
const startV = [...coastalByVertex.keys()].sort((a, b) => {
	const pa = vpos(a)
	const pb = vpos(b)
	return pa.y - pb.y || pa.x - pb.x
})[0]
const cx0 = hexes.reduce((s, h) => s + h.cx, 0) / hexes.length
const cy0 = hexes.reduce((s, h) => s + h.cy, 0) / hexes.length

const COASTAL_EDGES: string[] = []
let prevV = startV
// Pick initial direction: the neighbor making a clockwise turn around centroid.
{
	const [e1] = coastalByVertex.get(startV)!
	const other = (e: string, v: string) => e.split(' - ').find((x) => x !== v)!
	const cand = coastalByVertex.get(startV)!.map((e) => other(e, startV))
	const ang = (id: string) => Math.atan2(vpos(id).y - cy0, vpos(id).x - cx0)
	// clockwise from top means decreasing angle in screen coords (y down)
	cand.sort((a, b) => ang(a) - ang(b))
	void e1
	prevV = startV
	let curr = cand[0]
	COASTAL_EDGES.push(canonEdge(prevV, curr))
	while (curr !== startV) {
		const [ea, eb] = coastalByVertex.get(curr)!
		const nextE = other(ea, curr) === prevV ? eb : ea
		const nextV = other(nextE, curr)
		COASTAL_EDGES.push(canonEdge(curr, nextV))
		prevV = curr
		curr = nextV
	}
	// The loop's final iteration already pushed the closing edge back to startV.
}

// --- 11 port slots, evenly spaced, no two sharing a coastal vertex ---------

const L = COASTAL_EDGES.length
const N_PORTS = 11
const PORT_SLOTS: string[] = []
{
	const used = new Set<string>()
	let idx = 0
	for (let k = 0; k < N_PORTS; k++) {
		let tries = 0
		let e = COASTAL_EDGES[idx % L]
		while (tries < L) {
			const [a, b] = e.split(' - ')
			if (!used.has(a) && !used.has(b)) break
			idx++
			e = COASTAL_EDGES[idx % L]
			tries++
		}
		const [a, b] = e.split(' - ')
		used.add(a)
		used.add(b)
		PORT_SLOTS.push(e)
		idx += Math.max(2, Math.round(L / N_PORTS))
	}
}
if (PORT_SLOTS.length !== N_PORTS)
	throw new Error(`got ${PORT_SLOTS.length} ports`)

// --- Print -----------------------------------------------------------------

const fmtArr = (xs: string[], perLine = 6) => {
	const q = xs.map((x) => `'${x}'`)
	const lines: string[] = []
	for (let i = 0; i < q.length; i += perLine)
		lines.push('\t' + q.slice(i, i + perLine).join(', '))
	return `[\n${lines.join(',\n')},\n]`
}
const fmtAdj = () => {
	const lines = hexes.map(
		(h) =>
			`\t'${h.id}': [${adjacentVertices[h.id].map((v) => `'${v}'`).join(', ')}],`
	)
	return `{\n${lines.join('\n')}\n}`
}
const rows = () => {
	const byRow: Record<number, string[]> = {}
	for (const h of hexes) (byRow[h.row] ??= []).push(h.id)
	return Object.keys(byRow)
		.map((r) => `\t[${byRow[+r].map((x) => `'${x}'`).join(', ')}],`)
		.join('\n')
}

console.log(
	`// ${hexes.length} hexes, ${VERTICES.length} vertices, ${EDGES.length} edges, ${coastal.length} coastal, ${PORT_SLOTS.length} ports`
)
console.log(`\nEXP_HEXES = ${fmtArr(hexes.map((h) => h.id))}`)
console.log(`\nEXP_HEX_ROWS = [\n${rows()}\n]`)
console.log(`\nEXP_VERTICES = ${fmtArr(VERTICES)}`)
console.log(`\nEXP_EDGES = ${fmtArr(EDGES, 4)}`)
console.log(`\nEXP_adjacentVertices = ${fmtAdj()}`)
console.log(`\nEXP_COASTAL_EDGES = ${fmtArr(COASTAL_EDGES, 4)}`)
console.log(`\nEXP_PORT_SLOTS = ${fmtArr(PORT_SLOTS, 4)}`)
