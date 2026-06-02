export function getStandingColorClass(standing?: number): string {
	if (standing == null || standing === 0) return 'text-muted-foreground'
	if (standing >= 5) return 'text-[#2b6cb0]'
	if (standing > 0) return 'text-[#4a9ede]'
	if (standing <= -5) return 'text-[#9b2c2c]'
	return 'text-[#c05621]'
}

export function formatStandingLabel(standing?: number): string {
	if (standing == null) return '0.0'
	const prefix = standing > 0 ? '+' : ''
	return `${prefix}${standing.toFixed(1)}`
}
