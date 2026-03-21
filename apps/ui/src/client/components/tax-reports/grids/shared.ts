import type { TaxBillStatusReportRow } from '@repo/corporation-tax'

export function toJsonPreview(value: unknown): string {
	if (value === null || value === undefined) {
		return '-'
	}
	try {
		const raw = JSON.stringify(value)
		return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw
	} catch (_error) {
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
		console.debug('[TaxSortDebug] Invalid decimal parse; coercing to 0n', {
			input: value,
			trimmed,
			wholePartRaw,
			fractionalPartRaw,
			isWholeNumeric,
			isFractionalNumeric,
		})
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

export function sortByCentiColumnValue(
	rowA: { getValue: (columnId: string) => unknown },
	rowB: { getValue: (columnId: string) => unknown },
	columnId: string
): number {
	const rawLeft = rowA.getValue(columnId) as string | number | null | undefined
	const rawRight = rowB.getValue(columnId) as string | number | null | undefined
	const left = parseDecimalToCentiBigInt(rawLeft)
	const right = parseDecimalToCentiBigInt(rawRight)
	const result = compareBigIntValues(left, right)
	console.debug('[TaxSortDebug] Compare', {
		columnId,
		rawLeft,
		rawRight,
		left: left.toString(),
		right: right.toString(),
		result,
	})
	return result
}
