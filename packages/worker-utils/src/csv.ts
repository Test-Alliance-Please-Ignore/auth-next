export function escapeCsvValue(value: string | number | boolean | null | undefined): string {
	if (value === null || value === undefined) {
		return ''
	}

	const raw = String(value)
	if (!/[,"\n\r]/.test(raw)) {
		return raw
	}

	return `"${raw.replace(/"/g, '""')}"`
}

export function buildCsvLine(values: Array<string | number | boolean | null | undefined>): string {
	return values.map(escapeCsvValue).join(',')
}
