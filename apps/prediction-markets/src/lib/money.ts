/**
 * Money helpers. Monetary values move as decimal strings at the DB/RPC boundary
 * (Postgres `numeric`) and are computed as native BigInt in between.
 */

/** Parse a `numeric` string to BigInt, tolerating a fractional-zero suffix. */
export function parseAmount(value: string | null | undefined): bigint {
	if (value === null || value === undefined || value === '') {
		return 0n
	}
	const [intPart] = value.split('.')
	return BigInt(intPart)
}

export function formatAmount(value: bigint): string {
	return value.toString()
}

/** Negate a decimal-string amount (e.g. for a debit ledger row). */
export function negateAmount(value: string): string {
	return (-parseAmount(value)).toString()
}

/** True when the string is a strictly-positive integer. */
export function isPositiveIntegerString(value: string): boolean {
	return /^\d+$/.test(value) && BigInt(value) > 0n
}

/** True when the string is a non-negative integer. */
export function isNonNegativeIntegerString(value: string): boolean {
	return /^\d+$/.test(value)
}
