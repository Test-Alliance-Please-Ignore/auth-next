import { formatISK, formatISKShort } from '@/lib/format-utils'

import type { RequestStatus } from './types'

export { formatISK, formatISKShort }

/**
 * Format date as relative time (2h ago, 3 days ago)
 */
export function formatRelativeTime(dateStr: string): string {
	const date = new Date(dateStr)
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	const diffHours = Math.floor(diffMs / 3600000)
	const diffDays = Math.floor(diffMs / 86400000)

	if (diffMins < 1) return 'just now'
	if (diffMins < 60) return `${diffMins}m ago`
	if (diffHours < 24) return `${diffHours}h ago`
	if (diffDays < 7) return `${diffDays}d ago`

	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
	}).format(date)
}

/**
 * Format date as full date with time
 */
export function formatFullDate(dateStr: string): string {
	return new Intl.DateTimeFormat('en-US', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: 'short',
	}).format(new Date(dateStr))
}

/**
 * Get display text for request status
 */
export function getRequestStatusText(status: RequestStatus): string {
	switch (status) {
		case 'pending':
			return 'Pending Review'
		case 'needs_context':
			return 'Needs Context'
		case 'approved':
			return 'Approved'
		case 'rejected':
			return 'Rejected'
		case 'paid':
			return 'Paid'
		default:
			return status
	}
}

/**
 * Get badge variant for request status
 */
export function getRequestStatusVariant(
	status: RequestStatus
): 'warning' | 'default' | 'success' | 'destructive' | 'ghost' {
	switch (status) {
		case 'pending':
			return 'ghost'
		case 'needs_context':
			return 'warning'
		case 'approved':
			return 'default'
		case 'rejected':
			return 'destructive'
		case 'paid':
			return 'success'
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
