import { formatTaxDateTime } from '@/lib/tax-date'

import type { TaxBillStatus } from '@repo/corporation-tax'

export function getLastTimelineDate(events: Array<{ createdAt: string | Date }>): string {
	if (events.length === 0) {
		return '-'
	}

	const latest = events.reduce((acc, current) => {
		return new Date(current.createdAt) > new Date(acc.createdAt) ? current : acc
	}, events[0]!)
	return formatTaxDateTime(latest.createdAt)
}

export function billStatusBadgeVariant(
	status: TaxBillStatus | 'unbilled' | 'underpaid' | 'overpaid'
): 'default' | 'success' | 'warning' | 'destructive' | 'outline' {
	if (status === 'overdue') {
		return 'destructive'
	}
	if (status === 'paid') {
		return 'success'
	}
	if (status === 'underpaid') {
		return 'warning'
	}
	if (status === 'overpaid') {
		return 'warning'
	}
	if (status === 'issued') {
		return 'default'
	}
	return 'outline'
}
