import type { ScheduleFrequency } from '@repo/bills'

/**
 * Schedule Time Calculation
 *
 * Calculates next generation times for recurring bill schedules.
 */

export interface CalculateNextGenerationTimeParams {
	frequency: ScheduleFrequency
	lastGenerationTime?: Date
	startDate?: Date
}

/**
 * Calculate the next generation time for a schedule
 *
 * @param params - Calculation parameters
 * @returns The next generation time
 */
export function calculateNextGenerationTime(params: CalculateNextGenerationTimeParams): Date {
	const { frequency, lastGenerationTime, startDate } = params

	// Use last generation time if available, otherwise use start date or now
	const baseTime = lastGenerationTime || startDate || new Date()
	const nextTime = new Date(baseTime.getTime())

	// Add time based on frequency
	if (frequency === 'daily') {
		nextTime.setDate(nextTime.getDate() + 1)
	} else if (frequency === 'weekly') {
		nextTime.setDate(nextTime.getDate() + 7)
	} else if (frequency === 'monthly') {
		// Add one month (handles different month lengths correctly)
		nextTime.setMonth(nextTime.getMonth() + 1)
	}

	return nextTime
}

/**
 * Check if a schedule is due for execution
 *
 * @param nextGenerationTime - The scheduled next generation time
 * @param currentTime - Current time (defaults to now)
 * @returns True if the schedule should be executed
 */
export function isScheduleDue(nextGenerationTime: Date, currentTime: Date = new Date()): boolean {
	return currentTime >= nextGenerationTime
}

/**
 * Calculate the initial next generation time for a new schedule
 *
 * @param frequency - Schedule frequency
 * @param startDate - Optional start date (defaults to now)
 * @returns The first generation time
 */
export function calculateInitialGenerationTime(
	frequency: ScheduleFrequency,
	startDate?: Date
): Date {
	const baseDate = startDate || new Date()

	// If start date is in the past, use current time
	const now = new Date()
	if (baseDate < now) {
		return calculateNextGenerationTime({ frequency, startDate: now })
	}

	return baseDate
}

/**
 * Get a human-readable description of the schedule frequency
 *
 * @param frequency - Schedule frequency
 * @returns Human-readable description
 */
export function describeFrequency(frequency: ScheduleFrequency): string {
	const descriptions: Record<ScheduleFrequency, string> = {
		daily: 'Every day',
		weekly: 'Every week',
		monthly: 'Every month',
	}

	return descriptions[frequency]
}
