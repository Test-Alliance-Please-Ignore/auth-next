export function chunkRows<T>(rows: T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size))
	return chunks
}

export function toDateOrNull(value: Date | string | null): Date | null {
	if (!value) return null
	if (value instanceof Date) return value
	const parsed = new Date(value)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function isLikelyIp(ip: string): boolean {
	const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
	const ipv6 = /^[0-9a-fA-F:]+$/
	return ipv4.test(ip) || ipv6.test(ip)
}

export function mapLegacyEventCode(code: number): string {
	switch (code) {
		case 0:
			return 'status_change'
		case 1:
			return 'staff_note'
		case 2:
			return 'rejection_reason'
		case 3:
			return 'accepted'
		case 4:
			return 'message'
		default:
			return 'unknown'
	}
}
