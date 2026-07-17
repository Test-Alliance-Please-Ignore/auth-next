export type FreightLeaderboardPeriod = 'month' | 'previous-month' | 'all'

export interface FreightLeaderboardWindow {
	since?: Date
	before?: Date
}

function startOfUtcMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function addUtcMonths(date: Date, months: number): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

export function resolveFreightLeaderboardWindow(
	period: string | undefined,
	now = new Date()
): FreightLeaderboardWindow {
	const normalizedPeriod = period === '30d' ? 'month' : period
	const currentMonthStart = startOfUtcMonth(now)

	switch (normalizedPeriod) {
		case 'previous-month': {
			const previousMonthStart = addUtcMonths(currentMonthStart, -1)
			return {
				since: previousMonthStart,
				before: currentMonthStart,
			}
		}
		case 'month':
			return { since: currentMonthStart }
		case 'all':
		case undefined:
			return {}
		default:
			return {}
	}
}
