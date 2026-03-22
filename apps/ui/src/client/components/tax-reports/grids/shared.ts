import type { TaxBillStatusReportRow } from '@repo/corporation-tax'

export function toJsonPreview(value: unknown): string {
	if (value === null || value === undefined) {
		return '-'
	}
	try {
		const raw = JSON.stringify(value)
		return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw
	} catch {
		return String(value)
	}
}

export function billStatusBadgeVariant(
	status: TaxBillStatusReportRow['billStatus'] | 'underpaid' | 'overpaid'
): 'default' | 'success' | 'warning' | 'destructive' | 'outline' {
	if (status === 'overdue') return 'destructive'
	if (status === 'paid') return 'success'
	if (status === 'underpaid' || status === 'overpaid') return 'warning'
	if (status === 'issued') return 'default'
	return 'outline'
}

export function parseDecimalToCentiBigInt(value: string | number | null | undefined): bigint {
	if (value === null || value === undefined) {
		return 0n
	}
	const raw = typeof value === 'number' ? (Number.isFinite(value) ? value.toString() : '0') : value
	const trimmed = raw.trim()
	if (!trimmed) {
		return 0n
	}
	const sign = trimmed.startsWith('-') ? -1n : 1n
	const unsigned = trimmed.replace(/^[+-]/, '')
	const [wholePartRaw, fractionalPartRaw = ''] = unsigned.split('.')
	const isWholeNumeric = /^\d+$/.test(wholePartRaw || '0')
	const isFractionalNumeric = /^\d*$/.test(fractionalPartRaw)
	if (!isWholeNumeric || !isFractionalNumeric) {
		return 0n
	}
	const wholePart = wholePartRaw === '' ? '0' : wholePartRaw
	const fractionalNormalized = (fractionalPartRaw + '00').slice(0, 2)
	const whole = BigInt(wholePart)
	const fractional = BigInt(fractionalNormalized)
	return sign * (whole * 100n + fractional)
}

export function compareBigIntValues(left: bigint, right: bigint): number {
	if (left === right) return 0
	return left > right ? 1 : -1
}
