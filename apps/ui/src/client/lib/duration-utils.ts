import { parseDateOrNull } from '@repo/worker-utils'

import { i18n } from '@/i18n'

export interface FormatDurationOptions {
	maxUnits?: number
	style?: 'long' | 'short' | 'compact'
}

export interface FormatDurationUntilOptions extends FormatDurationOptions {
	expiredLabel?: string
	referenceTimeMs?: number
}

type DurationUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'
type DurationFormatStyle = 'long' | 'short' | 'compact'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

function formatUnit(value: number, unit: DurationUnit, style: DurationFormatStyle): string {
	if (style === 'short' || style === 'compact') {
		return i18n.t(`duration.compact.${unit}`, { count: value })
	}

	return i18n.t(`duration.units.${unit}`, { count: value })
}

function decomposeDuration(ms: number): Partial<Record<DurationUnit, number>> {
	let remaining = Math.max(0, Math.floor(ms))
	const years = Math.floor(remaining / YEAR_MS)
	remaining -= years * YEAR_MS
	const months = Math.floor(remaining / MONTH_MS)
	remaining -= months * MONTH_MS
	const weeks = Math.floor(remaining / WEEK_MS)
	remaining -= weeks * WEEK_MS
	const days = Math.floor(remaining / DAY_MS)
	remaining -= days * DAY_MS
	const hours = Math.floor(remaining / HOUR_MS)
	remaining -= hours * HOUR_MS
	const minutes = Math.floor(remaining / MINUTE_MS)
	remaining -= minutes * MINUTE_MS
	const seconds = Math.floor(remaining / SECOND_MS)

	return {
		year: years,
		month: months,
		week: weeks,
		day: days,
		hour: hours,
		minute: minutes,
		second: seconds,
	}
}

function formatDurationParts(
	parts: Partial<Record<DurationUnit, number>>,
	options: FormatDurationOptions = {}
): string {
	const maxUnits = Math.max(1, options.maxUnits ?? 3)
	const style = options.style ?? 'long'
	const units: Array<[DurationUnit, number | undefined]> = [
		['year', parts.year],
		['month', parts.month],
		['week', parts.week],
		['day', parts.day],
		['hour', parts.hour],
		['minute', parts.minute],
		['second', parts.second],
	]

	const rendered = units
		.filter(([, value]) => typeof value === 'number' && value > 0)
		.slice(0, maxUnits)
		.map(([unit, value]) => formatUnit(value!, unit, style))

	if (rendered.length === 0) {
		return formatUnit(0, 'second', style)
	}

	return rendered.join(' ')
}

export function formatDurationMs(ms: number, options?: FormatDurationOptions): string {
	if (!Number.isFinite(ms) || ms <= 0) {
		return formatUnit(0, 'second', options?.style ?? 'long')
	}

	return formatDurationParts(decomposeDuration(ms), options)
}

export function formatDurationBetween(
	startDate: string | Date | number,
	endDate?: string | Date | number | null,
	options?: FormatDurationOptions
): string {
	const start = parseDateOrNull(startDate)
	if (!start) {
		return formatUnit(0, 'second', options?.style ?? 'long')
	}

	const end = endDate === null || endDate === undefined ? new Date() : parseDateOrNull(endDate)
	if (!end) {
		return formatUnit(0, 'second', options?.style ?? 'long')
	}

	return formatDurationMs(Math.max(0, end.getTime() - start.getTime()), options)
}

export function formatDurationUntil(
	endDate: string | Date | number | null | undefined,
	options?: FormatDurationUntilOptions
): string {
	const end = endDate === null || endDate === undefined ? null : parseDateOrNull(endDate)
	if (!end) {
		return formatUnit(0, 'second', options?.style ?? 'long')
	}

	const referenceTimeMs = options?.referenceTimeMs ?? Date.now()
	const remainingMs = end.getTime() - referenceTimeMs
	if (remainingMs <= 0) {
		return options?.expiredLabel ?? i18n.t('duration.expired')
	}

	return formatDurationMs(remainingMs, options)
}
