import type { BonusId, CurseId } from './index'

// Bonus / curse pairings that shouldn't be dealt together — either because the
// curse makes the bonus dead weight, or because the pair is degenerate. Indexed
// by curse; every curse lists the bonuses it can't be dealt alongside. Enforced
// at deal time (see dealBonusHands) when `config.bannedCombos` is on: curses go
// out first, then each player's bonuses are drawn from what's compatible.
export const BANNED_BONUSES_BY_CURSE: Record<CurseId, readonly BonusId[]> = {
	age: [],
	decadence: [],
	ambition: [],
	elitism: [],
	asceticism: [],
	nomadism: [],
	avarice: [],
	power: [],
	compaction: [],
	provinciality: [],
	youth: [],
}

export function isBannedCombo(curse: CurseId, bonus: BonusId): boolean {
	return BANNED_BONUSES_BY_CURSE[curse]?.includes(bonus) ?? false
}
