export type AuthEsiPriority = 'interactive' | 'background'
export type AuthEsiBudgetLimitSource = 'static' | 'dynamic'

export interface AuthEsiDynamicBudgetSnapshot {
	remain: number
	resetSeconds: number
	observedAtMs: number
}

export interface AuthEsiBudgetLimits {
	globalLimit: number
	routeLimit: number
	backgroundLimit: number
	source: AuthEsiBudgetLimitSource
}

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

export function computeEffectiveAuthEsiBudgetLimits(params: {
	baseGlobalLimit: number
	baseRouteLimit: number
	baseBackgroundLimit: number
	nowMs: number
	dynamicBudget?: AuthEsiDynamicBudgetSnapshot | null
	reserveErrors?: number
}): AuthEsiBudgetLimits {
	const { baseGlobalLimit, baseRouteLimit, baseBackgroundLimit, nowMs, dynamicBudget } = params
	const reserveErrors = Math.max(0, params.reserveErrors ?? 5)
	if (!dynamicBudget) {
		return {
			globalLimit: baseGlobalLimit,
			routeLimit: baseRouteLimit,
			backgroundLimit: baseBackgroundLimit,
			source: 'static',
		}
	}

	const resetMs = dynamicBudget.resetSeconds * 1000
	const expiresAtMs = dynamicBudget.observedAtMs + resetMs
	if (!Number.isFinite(resetMs) || resetMs <= 0 || nowMs >= expiresAtMs) {
		return {
			globalLimit: baseGlobalLimit,
			routeLimit: baseRouteLimit,
			backgroundLimit: baseBackgroundLimit,
			source: 'static',
		}
	}

	const dynamicGlobalLimit = Math.max(1, dynamicBudget.remain - reserveErrors)
	const scale = Math.min(1, dynamicGlobalLimit / Math.max(1, baseGlobalLimit))
	return {
		globalLimit: Math.min(baseGlobalLimit, dynamicGlobalLimit),
		routeLimit: Math.max(1, Math.min(baseRouteLimit, Math.floor(baseRouteLimit * scale))),
		backgroundLimit: Math.max(
			1,
			Math.min(baseBackgroundLimit, Math.floor(baseBackgroundLimit * scale))
		),
		source: 'dynamic',
	}
}
