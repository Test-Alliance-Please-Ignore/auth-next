import { formatDateTime } from '@/i18n'
import { formatISK as formatISKBase, formatISKShort } from '@/lib/format-utils'

import type { AppTranslator } from '@/i18n'
import type { RequestStatus, SRPRequestResponse } from './types'

export { formatISKShort }

export function formatISK(value: string | number): string {
	return formatISKBase(value, { showDecimals: false })
}

export { formatRelativeTime } from '@/lib/date-utils'

export function formatFullDate(dateStr: string): string {
	return formatDateTime(dateStr, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
	})
}

/**
 * Get display text for request status
 */
export function getRequestStatusText(status: RequestStatus, t: AppTranslator): string {
	switch (status) {
		case 'pending':
			return t('srp.status.pending')
		case 'needs_context':
			return t('srp.status.needs_context')
		case 'approved':
			return t('srp.status.approved')
		case 'payment_pending':
			return t('srp.status.payment_pending')
		case 'rejected':
			return t('srp.status.rejected')
		case 'paid':
			return t('srp.status.paid')
		case 'withdrawn':
			return t('srp.status.withdrawn')
		default:
			return status
	}
}

/**
 * Get badge variant for request status
 */
export function getRequestStatusVariant(
	status: RequestStatus
): 'warning' | 'secondary' | 'default' | 'success' | 'destructive' | 'ghost' {
	switch (status) {
		case 'pending':
			return 'warning'
		case 'needs_context':
			return 'secondary'
		case 'approved':
			return 'default'
		case 'payment_pending':
			return 'secondary'
		case 'rejected':
			return 'destructive'
		case 'paid':
			return 'success'
		case 'withdrawn':
			return 'ghost'
		default:
			return 'ghost'
	}
}

/**
 * Generate zKillboard URL for killmail
 */
export function getKillmailUrl(killmailId: string): string {
	return `https://zkillboard.com/kill/${killmailId}/`
}

/**
 * Calculate difference between two ISK amounts
 */
export function calculateDifference(
	requested: string | undefined,
	approved: string | undefined
): number {
	if (!requested || !approved) return 0
	const req = parseFloat(requested)
	const app = parseFloat(approved)
	if (isNaN(req) || isNaN(app)) return 0
	return app - req
}

/**
 * Get pagination range for display (with ellipsis)
 */
export function getPaginationRange(
	current: number,
	total: number,
	delta: number = 2
): Array<number | string> {
	const range: number[] = []
	const rangeWithDots: Array<number | string> = []

	for (let i = 1; i <= total; i++) {
		if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
			range.push(i)
		}
	}

	let prev: number | undefined
	for (const i of range) {
		if (prev && i - prev > 1) {
			rangeWithDots.push('...')
		}
		rangeWithDots.push(i)
		prev = i
	}

	return rangeWithDots
}

export function getRequestCharacterRole(request: SRPRequestResponse): 'main' | 'alt' | undefined {
	const role = (request as SRPRequestResponse & { characterRole?: unknown }).characterRole
	if (role === 'main' || role === 'alt') {
		return role
	}
	return undefined
}

export function isDateRangeWithinOneYear(dateFrom?: string, dateTo?: string): boolean {
	if (!dateFrom || !dateTo) return false
	const from = new Date(dateFrom.includes('T') ? dateFrom : `${dateFrom}T00:00:00.000Z`)
	const to = new Date(dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59.999Z`)
	if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false
	if (to < from) return false
	const maxTo = new Date(from.getTime())
	maxTo.setUTCFullYear(maxTo.getUTCFullYear() + 1)
	return to <= maxTo
}
