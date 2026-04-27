const SRP_REASON_PREFIX = 'SRP - KM#'

export function parseAmountToBigInt(rawAmount: string | undefined | null): bigint | null {
	if (typeof rawAmount !== 'string') return null
	const normalized = rawAmount.trim()
	if (!normalized) return null
	if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null
	const integerPart = normalized.split('.')[0]
	if (!/^-?\d+$/.test(integerPart)) return null
	try {
		return BigInt(integerPart)
	} catch {
		return null
	}
}

export function buildKillmailReasonNeedle(killmailId: string): string {
	return `${SRP_REASON_PREFIX}${killmailId}`
}
