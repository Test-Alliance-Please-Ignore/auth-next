export function computeQueueSeverity(input: {
	crossModernUserQueueMatches: number
	multipleLegacyMatchesForModernUser: boolean
}): 'none' | 'high' | 'critical' {
	if (input.crossModernUserQueueMatches > 0) return 'critical'
	if (input.multipleLegacyMatchesForModernUser) return 'high'
	return 'none'
}
