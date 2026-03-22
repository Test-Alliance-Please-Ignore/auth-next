export function parseDecimalToCenti(
	value: string | number | bigint | null | undefined
): bigint {
	if (value === null || value === undefined) {
		return 0n
	}
	if (typeof value === 'bigint') {
		return value * 100n
	}

	const normalized = typeof value === 'number' ? String(value) : value
	const trimmed = normalized.trim()
	if (!trimmed) {
		return 0n
	}

	const negative = trimmed.startsWith('-')
	const unsigned = trimmed.replace(/^[+-]/, '')
	const [wholePartRaw, fractionalRaw = ''] = unsigned.split('.')
	const wholePart = wholePartRaw.replace(/[^0-9]/g, '')
	const fractional = fractionalRaw
		.replace(/[^0-9]/g, '')
		.padEnd(2, '0')
		.slice(0, 2)
	const whole = wholePart ? BigInt(wholePart) : 0n
	const fraction = fractional ? BigInt(fractional) : 0n
	const centi = whole * 100n + fraction
	return negative ? -centi : centi
}

export function safeParseDecimalToCenti(
	value: string | number | bigint | null | undefined
): bigint | null {
	try {
		return parseDecimalToCenti(value)
	} catch {
		return null
	}
}

export function formatCenti(value: bigint, options?: { fixedScale?: boolean }): string {
	const negative = value < 0n
	const absolute = negative ? -value : value
	const whole = absolute / 100n
	const fraction = absolute % 100n
	const prefix = negative ? '-' : ''

	if (!options?.fixedScale && fraction === 0n) {
		return `${prefix}${whole.toString()}`
	}

	return `${prefix}${whole.toString()}.${fraction.toString().padStart(2, '0')}`
}

export function matchesMinAmountThreshold(
	amount: string,
	minAmount: string | undefined
): boolean {
	const amountCenti = safeParseDecimalToCenti(amount)
	if (amountCenti === null) {
		return true
	}

	const minAmountCenti = minAmount !== undefined ? safeParseDecimalToCenti(minAmount) : null
	if (minAmountCenti !== null && amountCenti < minAmountCenti) {
		return false
	}

	return true
}
