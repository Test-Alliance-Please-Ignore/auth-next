export type BroadcastSrpMode = 'blanket' | 'military' | 'coalition' | 'disabled'

export function parseBroadcastSrpMode(value: unknown): BroadcastSrpMode {
	if (typeof value !== 'string') return 'blanket'
	const normalized = value.trim().toLowerCase()
	if (normalized === 'military') return 'military'
	if (normalized === 'coalition') return 'coalition'
	if (normalized === 'disabled') return 'disabled'
	if (normalized === 'blanket') return 'blanket'
	return 'blanket'
}

export function getBroadcastSrpModeLabel(mode: BroadcastSrpMode): string {
	if (mode === 'military') return 'Military'
	if (mode === 'coalition') return 'Coalition'
	if (mode === 'blanket') return 'Blanket'
	return 'No'
}

export function renderBroadcastSrpSection(
	mode: BroadcastSrpMode,
	token?: string
): string {
	const modeLabel = getBroadcastSrpModeLabel(mode)
	if (mode === 'disabled') {
		return `SRP: **${modeLabel}**`
	}
	const safeToken = typeof token === 'string' ? token : ''
	return `SRP: **${modeLabel}**\nSRP Token: **${safeToken}**`
}
