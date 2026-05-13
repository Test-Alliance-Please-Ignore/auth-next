export function computeQueueSeverity(input: {
	crossModernUserQueueMatches: number
	multipleLegacyMatchesForModernUser: boolean
	hasDiscordIdMatch?: boolean
}): 'none' | 'high' | 'critical' {
	if (input.crossModernUserQueueMatches > 0) return 'critical'
	if (input.hasDiscordIdMatch) return 'high'
	if (input.multipleLegacyMatchesForModernUser) return 'high'
	return 'none'
}
