export function parseSecurityStatus(secStatus: string | null): number | null {
	if (secStatus == null) return null
	const normalized = secStatus.replace(/[−–—]/g, '-').trim()
	if (normalized.length === 0) return null
	const value = Number.parseFloat(normalized)
	return Number.isFinite(value) ? value : null
}

export function securityStatusTextClass(secStatus: number | null): string {
	if (secStatus === null) return 'text-muted-foreground'
	if (secStatus >= 0.5) return 'text-green-400'
	if (secStatus > 0) return 'text-orange-400'
	if (secStatus > -0.5) return 'text-red-400'
	if (secStatus > -0.75) return 'text-rose-500'
	if (secStatus > -0.95) return 'text-[#8a1538]'
	return 'text-purple-400'
}
