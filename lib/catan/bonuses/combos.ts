import type { BonusId, CurseId } from './index'

// Bonus / curse pairings that shouldn't be dealt together — either because the
// curse makes the bonus dead weight, or because the pair is degenerate. Indexed
// by curse; every curse lists the bonuses it can't be dealt alongside. Enforced
// at deal time (see dealBonusHands) when `config.bannedCombos` is on: curses go
// out first, then each player's bonuses are drawn from what's compatible.
export const BANNED_BONUSES_BY_CURSE: Record<CurseId, readonly BonusId[]> = {
	age: ['accountant', 'investor'],
	decadence: ['metropolitan'],
	ambition: ['thrill_seeker'],
	elitism: ['metropolitan', 'haunt'],
	asceticism: [],
	nomadism: [],
	avarice: ['hoarder'],
	power: ['metropolitan', 'plutocrat'],
	compaction: ['explorer', 'fencer'],
	provinciality: ['specialist', 'merchant'],
	youth: [],
}

export function isBannedCombo(curse: CurseId, bonus: BonusId): boolean {
	return BANNED_BONUSES_BY_CURSE[curse]?.includes(bonus) ?? false
}

// Pairings that are allowed but interact in a way neither card's text says.
// Shown as a small note in the selection pane once both are picked, rather
// than written into either card's copy.
const COMBO_NOTES: Partial<Record<CurseId, Partial<Record<BonusId, string>>>> =
	{
		nomadism: {
			explorer:
				"The Explorer's three free roads don't count toward the Curse of Nomadism.",
		},
	}

export function comboNoteFor(bonus: BonusId, curse: CurseId): string | null {
	return COMBO_NOTES[curse]?.[bonus] ?? null
}
