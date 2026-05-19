export function formatMoonScanDate(value: string): string {
	return new Date(value).toLocaleDateString()
}

export function formatMoonScanDateTime(value: string): string {
	return new Date(value).toISOString().slice(0, 16).replace('T', ' ')
}
