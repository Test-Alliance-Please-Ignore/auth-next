/**
 * Utility functions for bills management
 */

import type { Bill, BillStatus, LateFeeCompounding, LateFeeType } from '@repo/bills'

/**
 * Format ISK amounts for display
 * Converts large numbers to human-readable format (5.5B ISK, 125M ISK, 1.25T ISK)
 */
export function formatISK(amount: string | number): string {
	const num = typeof amount === 'string' ? parseFloat(amount) : amount

	if (Number.isNaN(num)) return '0 ISK'

	if (num >= 1_000_000_000_000) {
		return `${(num / 1_000_000_000_000).toFixed(2)}T ISK`
	}
	if (num >= 1_000_000_000) {
		return `${(num / 1_000_000_000).toFixed(2)}B ISK`
	}
	if (num >= 1_000_000) {
		return `${(num / 1_000_000).toFixed(0)}M ISK`
	}
	if (num >= 1_000) {
		return `${(num / 1_000).toFixed(0)}K ISK`
	}
	return `${num.toLocaleString()} ISK`
}

/**
 * Calculate late fee for a bill
 * Returns the current late fee amount based on bill configuration and days overdue
 */
export function calculateLateFee(bill: Bill): number {
	if (!bill.lateFeeType || !bill.lateFeeAmount) return 0
	if (bill.status !== 'overdue') return 0

	const dueDate = new Date(bill.dueDate)
	const now = new Date()
	const daysPastDue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24))

	if (daysPastDue <= 0) return 0

	const baseAmount = parseFloat(bill.amount)
	const lateFeeAmount = parseFloat(bill.lateFeeAmount)

	if (bill.lateFeeType === 'static') {
		// Static late fee
		if (!bill.lateFeeCompounding || bill.lateFeeCompounding === 'none') {
			return lateFeeAmount
		}

		// Calculate compounding periods
		let periods = 0
		switch (bill.lateFeeCompounding) {
			case 'daily':
				periods = daysPastDue
				break
			case 'weekly':
				periods = Math.floor(daysPastDue / 7)
				break
			case 'monthly':
				periods = Math.floor(daysPastDue / 30)
				break
		}

		return lateFeeAmount * periods
	} else {
		// Percentage late fee
		const percentageRate = lateFeeAmount / 100

		if (!bill.lateFeeCompounding || bill.lateFeeCompounding === 'none') {
			return baseAmount * percentageRate
		}

		// Calculate compounding periods
		let periods = 0
		switch (bill.lateFeeCompounding) {
			case 'daily':
				periods = daysPastDue
				break
			case 'weekly':
				periods = Math.floor(daysPastDue / 7)
				break
			case 'monthly':
				periods = Math.floor(daysPastDue / 30)
				break
		}

		// Compound interest formula: A = P(1 + r)^n - P
		return baseAmount * Math.pow(1 + percentageRate, periods) - baseAmount
	}
}

/**
 * Get display color for bill status
 */
export function getBillStatusColor(
	status: BillStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
	switch (status) {
		case 'draft':
			return 'secondary'
		case 'issued':
			return 'default'
		case 'paid':
			return 'outline' // Using outline for success-like appearance
		case 'cancelled':
			return 'destructive'
		case 'overdue':
			return 'destructive'
		default:
			return 'default'
	}
}

/**
 * Get human-readable status text
 */
export function formatBillStatus(status: BillStatus): string {
	switch (status) {
		case 'draft':
			return 'Draft'
		case 'issued':
			return 'Issued'
		case 'paid':
			return 'Paid'
		case 'cancelled':
			return 'Cancelled'
		case 'overdue':
			return 'Overdue'
		default:
			return status
	}
}

/**
 * Format due date with overdue indicator
 */
export function formatDueDate(dueDate: Date | string): string {
	const date = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
	const now = new Date()
	const diffMs = date.getTime() - now.getTime()
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

	const formatted = date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	})

	if (diffDays < 0) {
		return `${formatted} (${Math.abs(diffDays)} days overdue)`
	} else if (diffDays === 0) {
		return `${formatted} (Due today)`
	} else if (diffDays === 1) {
		return `${formatted} (Due tomorrow)`
	} else if (diffDays <= 7) {
		return `${formatted} (Due in ${diffDays} days)`
	}

	return formatted
}

/**
 * Calculate days past due
 */
export function getDaysPastDue(dueDate: Date | string): number {
	const date = typeof dueDate === 'string' ? new Date(dueDate) : dueDate
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
	return Math.max(0, diffDays)
}

/**
 * Format late fee type for display
 */
export function formatLateFeeType(lateFeeType: LateFeeType | undefined): string {
	if (!lateFeeType) return 'None'
	return lateFeeType === 'static' ? 'Static Amount' : 'Percentage'
}

/**
 * Format late fee compounding for display
 */
export function formatLateFeeCompounding(compounding: LateFeeCompounding | undefined): string {
	if (!compounding) return 'None'
	switch (compounding) {
		case 'none':
			return 'None'
		case 'daily':
			return 'Daily'
		case 'weekly':
			return 'Weekly'
		case 'monthly':
			return 'Monthly'
		default:
			return compounding
	}
}

/**
 * Get total amount due (base amount + late fees)
 */
export function getTotalAmountDue(bill: Bill): number {
	const baseAmount = parseFloat(bill.amount)
	const lateFee = calculateLateFee(bill)
	return baseAmount + lateFee
}

/**
 * Format entity type for display
 */
export function formatEntityType(type: 'character' | 'corporation' | 'group'): string {
	switch (type) {
		case 'character':
			return 'Character'
		case 'corporation':
			return 'Corporation'
		case 'group':
			return 'Group'
		default:
			return type
	}
}

/**
 * Format schedule frequency for display
 */
export function formatScheduleFrequency(frequency: 'daily' | 'weekly' | 'monthly'): string {
	switch (frequency) {
		case 'daily':
			return 'Daily'
		case 'weekly':
			return 'Weekly'
		case 'monthly':
			return 'Monthly'
		default:
			return frequency
	}
}
