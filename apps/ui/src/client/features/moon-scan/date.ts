import { formatDate } from '@/i18n'

export function formatMoonScanDate(value: string): string {
	return formatDate(value, { dateStyle: 'short' })
}

export function formatMoonScanDateTime(value: string): string {
	return formatDate(value, { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
}
