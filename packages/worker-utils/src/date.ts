export function parseDateOrNull(value: unknown): Date | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value
	}
	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value)
		return Number.isNaN(parsed.getTime()) ? null : parsed
	}
	return null
}
