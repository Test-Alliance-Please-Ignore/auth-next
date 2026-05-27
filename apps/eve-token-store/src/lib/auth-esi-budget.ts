export type AuthEsiPriority = 'interactive' | 'background'

export function normalizeAuthEsiRouteKey(path: string): string {
	const barePath = path.split('?')[0] ?? path
	const segments = barePath
		.split('/')
		.filter(Boolean)
		.slice(0, 3)
		.map((segment) => (/^\d+$/.test(segment) ? ':id' : segment))
	return `/${segments.join('/')}`
}

export function classifyAuthEsiPriority(path: string): AuthEsiPriority {
	const barePath = path.split('?')[0] ?? path
	if (
		barePath.includes('/corporations/') ||
		barePath.includes('/wallet') ||
		barePath.includes('/assets') ||
		barePath.includes('/orders') ||
		barePath.includes('/contracts') ||
		barePath.includes('/industry') ||
		barePath.includes('/killmails') ||
		barePath.includes('/roles')
	) {
		return 'background'
	}
	return 'interactive'
}

export function isAuthEsiBudgetExceeded(params: {
	globalCount: number
	routeCount: number
	priorityCount: number
	priority: AuthEsiPriority
	globalLimit: number
	routeLimit: number
	backgroundLimit: number
}): boolean {
	const { globalCount, routeCount, priorityCount, priority, globalLimit, routeLimit, backgroundLimit } =
		params
	if (globalCount > globalLimit) return true
	if (routeCount > routeLimit) return true
	if (priority === 'background' && priorityCount > backgroundLimit) return true
	return false
}
