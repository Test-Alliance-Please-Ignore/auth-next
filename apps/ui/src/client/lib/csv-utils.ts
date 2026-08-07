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

export function buildCsv(
	headers: string[],
	rows: Array<Array<string | number | boolean | null | undefined>>
): string {
	return [buildCsvLine(headers), ...rows.map((row) => buildCsvLine(row))].join('\n')
}

export function downloadTextFile(fileName: string, contentType: string, content: string): void {
	const blob = new Blob([content], { type: contentType })
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.click()
	URL.revokeObjectURL(url)
}
