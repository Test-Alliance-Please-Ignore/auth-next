export type AuthEsiPriority = 'interactive' | 'background'
export type AuthEsiBudgetLimitSource = 'static' | 'dynamic'

export interface AuthEsiDynamicBudgetSnapshot {
	remain: number
	resetSeconds: number
	observedAtMs: number
}

export interface AuthEsiBudgetLimits {
	routeLimit: number
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

export function isAuthEsiBudgetExceeded(params: { routeCount: number; routeLimit: number }): boolean {
	return params.routeCount > params.routeLimit
}

export function computeEffectiveAuthEsiBudgetLimits(params: {
	baseRouteLimit: number
	nowMs: number
	dynamicBudget?: AuthEsiDynamicBudgetSnapshot | null
	reserveErrors?: number
}): AuthEsiBudgetLimits {
	const { baseRouteLimit, nowMs, dynamicBudget } = params
	const reserveErrors = Math.max(0, params.reserveErrors ?? 5)
	if (!dynamicBudget) {
		return {
			routeLimit: baseRouteLimit,
			source: 'static',
		}
	}

	const resetMs = dynamicBudget.resetSeconds * 1000
	const expiresAtMs = dynamicBudget.observedAtMs + resetMs
	if (!Number.isFinite(resetMs) || resetMs <= 0 || nowMs >= expiresAtMs) {
		return {
			routeLimit: baseRouteLimit,
			source: 'static',
		}
	}

	const dynamicRouteLimit = Math.max(1, Math.min(baseRouteLimit, dynamicBudget.remain - reserveErrors))
	return {
		routeLimit: dynamicRouteLimit,
		source: 'dynamic',
	}
}
