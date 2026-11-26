// Validates lib/patchNotes/patch-notes.json and checks the which-entries-to-show
// rule. Run with `npx tsx dev/check-patch-notes.ts`. Exits non-zero on failure.

import {
	compareIds,
	entriesToShow,
	groupByDay,
	PATCH_NOTES,
	validatePatchNotes,
	type PatchNoteEntry,
} from '../lib/patchNotes/notes'

function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(`assert: ${msg}`)
}

const errors = validatePatchNotes(PATCH_NOTES)
if (errors.length) {
	console.error('patch-notes.json is invalid:\n  ' + errors.join('\n  '))
	process.exit(1)
}

const ids = (es: PatchNoteEntry[]) => es.map((e) => e.id).join(' ')
const E = (id: string): PatchNoteEntry => ({ id, notes: [`note ${id}`] })
const file = [E('2026-11-26.1'), E('2026-11-26.2'), E('2026-11-28.1')]
const OLD = '2026-01-01T00:00:00Z'

assert(compareIds('2026-11-26.9', '2026-11-26.10') < 0, 'counter is numeric')
assert(compareIds('2026-11-27.1', '2026-11-26.10') > 0, 'date wins')

assert(entriesToShow([], null, OLD).length === 0, 'empty file, no record')
assert(entriesToShow([], '2026-11-26.1', OLD).length === 0, 'empty file')
assert(
	ids(entriesToShow(file, '2026-11-26.1', OLD)) ===
		'2026-11-28.1 2026-11-26.2',
	'newer entries, newest first'
)
assert(entriesToShow(file, '2026-11-28.1', OLD).length === 0, 'up to date')
assert(
	entriesToShow(file, '2026-12-01.1', OLD).length === 0,
	'stored id ahead of the bundle (rolled back) shows nothing'
)
assert(
	ids(entriesToShow(file, null, OLD)) ===
		'2026-11-28.1 2026-11-26.2 2026-11-26.1',
	'no record, existing account: everything since the baseline'
)
assert(
	ids(entriesToShow(file, 'garbage', OLD)) ===
		'2026-11-28.1 2026-11-26.2 2026-11-26.1',
	'unparseable record treated as none'
)
assert(
	entriesToShow(file, null, '2026-11-28T10:00:00Z').length === 0,
	'no record, account created on the newest entry date: nothing'
)
assert(
	ids(entriesToShow(file, null, '2026-11-27T23:59:00Z')) ===
		'2026-11-28.1 2026-11-26.2 2026-11-26.1',
	'no record, account older than newest entry: since the baseline'
)
assert(
	ids(entriesToShow(file, null, null)) ===
		'2026-11-28.1 2026-11-26.2 2026-11-26.1',
	'unknown account age: since the baseline'
)
const later = [E('2026-11-24.1'), ...file, E('2027-03-01.1'), E('2027-03-05.1')]
assert(
	ids(entriesToShow(later, null, OLD)) === '2027-03-05.1 2027-03-01.1',
	'no record long after the baseline: only the last week'
)
assert(
	ids(entriesToShow([E('2026-11-24.1')], null, OLD)) === '2026-11-24.1',
	'nothing inside the window: newest only'
)

const grouped = groupByDay(
	[...file, { id: '2026-11-28.2', notes: ['x', 'y'] }].reverse()
)
assert(
	JSON.stringify(grouped) ===
		JSON.stringify([
			{ date: '2026-11-28', notes: ['x', 'y', 'note 2026-11-28.1'] },
			{
				date: '2026-11-26',
				notes: ['note 2026-11-26.2', 'note 2026-11-26.1'],
			},
		]),
	'one group per day, newest first, entry notes in order'
)

const bad = validatePatchNotes([
	{ id: '2026-11-26.2', notes: ['a'] },
	{ id: '2026-11-26.2', notes: ['b'] },
	{ id: '2026-11-26.3', notes: [] },
	{ id: '2026-11-26.4', notes: [' '] },
	{ id: '11-26', notes: ['c'] },
	{ id: '2026-11-27.0', notes: ['d'] },
	{ id: '2026-11-27.1', notes: ['e'], date: 'x' },
])
assert(bad.length === 6, `validator catches each bad entry (got ${bad.length})`)

console.log(`patch-notes ok (${PATCH_NOTES.length} entries)`)
