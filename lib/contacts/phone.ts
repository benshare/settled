// Address-book numbers → E.164, without libphonenumber. Good enough for
// matching against SMS-verified numbers: a number we normalize wrongly simply
// fails to match, which is the same outcome as not uploading it.

// Two-digit ITU country calling codes. Calling codes are prefix-free, so a
// leading 1 or 7 is the whole code, one of these is a two-digit code, and
// anything else is three digits.
const TWO_DIGIT_CODES = new Set(
	(
		'20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 ' +
		'56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'
	).split(' ')
)

/** The calling code of an E.164 number (with or without `+`); `'1'` if unknown. */
export function callingCodeOf(phone: string | null | undefined): string {
	const digits = (phone ?? '').replace(/\D/g, '')
	if (digits.length < 8) return '1'
	if (digits[0] === '1' || digits[0] === '7') return digits[0]
	const two = digits.slice(0, 2)
	return TWO_DIGIT_CODES.has(two) ? two : digits.slice(0, 3)
}

/**
 * Best-effort E.164 for one address-book entry, or null if it can't be one.
 * Numbers without an international prefix are read as local to
 * `defaultCode` (the user's own country).
 */
export function toE164(raw: string, defaultCode: string): string | null {
	const trimmed = raw.trim()
	const digits = trimmed.replace(/\D/g, '')
	if (!digits) return null

	let full: string
	if (trimmed.startsWith('+')) full = digits
	else if (defaultCode === '1' && digits.startsWith('011'))
		full = digits.slice(3)
	else if (digits.startsWith('00')) full = digits.slice(2)
	else if (defaultCode === '1') {
		if (digits.length === 10) full = '1' + digits
		else if (digits.length === 11 && digits[0] === '1') full = digits
		else return null
	} else {
		// Drop a single national trunk prefix (UK/DE/FR/AU-style `0…`).
		full = defaultCode + digits.replace(/^0/, '')
	}

	return full.length >= 8 && full.length <= 15 ? '+' + full : null
}
