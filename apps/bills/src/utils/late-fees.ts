import type { LateFeeCompounding, LateFeeType } from '@repo/bills'

/**
 * Late Fee Calculation
 *
 * Calculates late fees based on type and compounding mode.
 * Supports both static (flat) amounts and percentage-based fees.
 */

export interface CalculateLateFeeParams {
	amount: string
	dueDate: Date
	currentDate: Date
	lateFeeType: LateFeeType
	lateFeeAmount: string
	lateFeeCompounding: LateFeeCompounding
}

/**
 * Calculate late fee for a bill
 *
 * @param params - Late fee calculation parameters
 * @returns Calculated late fee as a string
 */
export function calculateLateFee(params: CalculateLateFeeParams): string {
	const { amount, dueDate, currentDate, lateFeeType, lateFeeAmount, lateFeeCompounding } = params

	// No late fee if not overdue or type is none
	if (currentDate <= dueDate || lateFeeType === 'none') {
		return '0'
	}

	// Calculate days overdue
	const msOverdue = currentDate.getTime() - dueDate.getTime()
	const daysOverdue = Math.floor(msOverdue / (1000 * 60 * 60 * 24))

	if (daysOverdue <= 0) {
		return '0'
	}

	const baseAmount = parseFloat(amount)
	const feeAmount = parseFloat(lateFeeAmount)

	if (isNaN(baseAmount) || isNaN(feeAmount)) {
		return '0'
	}

	let lateFee = 0

	// Calculate based on type and compounding
	if (lateFeeType === 'static') {
		// Static amount per period
		if (lateFeeCompounding === 'none') {
			// One-time flat fee
			lateFee = feeAmount
		} else if (lateFeeCompounding === 'daily') {
			// Fee per day overdue
			lateFee = feeAmount * daysOverdue
		} else if (lateFeeCompounding === 'weekly') {
			// Fee per week overdue
			const weeksOverdue = Math.floor(daysOverdue / 7)
			lateFee = feeAmount * weeksOverdue
		} else if (lateFeeCompounding === 'monthly') {
			// Fee per month overdue (approximate as 30 days)
			const monthsOverdue = Math.floor(daysOverdue / 30)
			lateFee = feeAmount * monthsOverdue
		}
	} else if (lateFeeType === 'percentage') {
		// Percentage of bill amount
		const percentageMultiplier = feeAmount / 100

		if (lateFeeCompounding === 'none') {
			// One-time percentage fee
			lateFee = baseAmount * percentageMultiplier
		} else if (lateFeeCompounding === 'daily') {
			// Percentage per day overdue
			lateFee = baseAmount * percentageMultiplier * daysOverdue
		} else if (lateFeeCompounding === 'weekly') {
			// Percentage per week overdue
			const weeksOverdue = Math.floor(daysOverdue / 7)
			lateFee = baseAmount * percentageMultiplier * weeksOverdue
		} else if (lateFeeCompounding === 'monthly') {
			// Percentage per month overdue
			const monthsOverdue = Math.floor(daysOverdue / 30)
			lateFee = baseAmount * percentageMultiplier * monthsOverdue
		}
	}

	// Round to 2 decimal places and return as string
	return Math.round(lateFee * 100) / 100 + ''
}

/**
 * Get a human-readable description of the late fee configuration
 *
 * @param lateFeeType - Type of late fee
 * @param lateFeeAmount - Amount or percentage
 * @param lateFeeCompounding - Compounding frequency
 * @returns Human-readable description
 */
export function describeLateFee(
	lateFeeType: LateFeeType,
	lateFeeAmount: string,
	lateFeeCompounding: LateFeeCompounding
): string {
	if (lateFeeType === 'none') {
		return 'No late fee'
	}

	const amount = lateFeeAmount
	const isPercentage = lateFeeType === 'percentage'

	if (lateFeeCompounding === 'none') {
		return `One-time ${isPercentage ? amount + '%' : amount + ' ISK'} late fee`
	}

	const unit = isPercentage ? amount + '%' : amount + ' ISK'
	return `${unit} late fee per ${lateFeeCompounding.replace('ly', '')}`
}
