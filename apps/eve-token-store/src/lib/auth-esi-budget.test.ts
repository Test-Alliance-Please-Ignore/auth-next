import { describe, expect, it } from 'vitest'

import {
	classifyAuthEsiPriority,
	computeEffectiveAuthEsiBudgetLimits,
	isAuthEsiBudgetExceeded,
	normalizeAuthEsiRouteKey,
} from './auth-esi-budget'

describe('auth-esi budget helpers', () => {
	it('normalizes numeric segments in route key', () => {
		expect(normalizeAuthEsiRouteKey('/corporations/987654321/wallets?page=2')).toBe(
			'/corporations/:id/wallets'
		)
	})

	it('classifies high-volume corp paths as background', () => {
		expect(classifyAuthEsiPriority('/corporations/123/roles')).toBe('background')
		expect(classifyAuthEsiPriority('/characters/123/skills')).toBe('interactive')
	})

	it('detects budget exceedance across global/route/priority constraints', () => {
		expect(
			isAuthEsiBudgetExceeded({
				globalCount: 181,
				routeCount: 1,
				priorityCount: 1,
				priority: 'interactive',
				globalLimit: 180,
				routeLimit: 60,
				backgroundLimit: 130,
			})
		).toBe(true)
		expect(
			isAuthEsiBudgetExceeded({
				globalCount: 100,
				routeCount: 61,
				priorityCount: 1,
				priority: 'interactive',
				globalLimit: 180,
				routeLimit: 60,
				backgroundLimit: 130,
			})
		).toBe(true)
		expect(
			isAuthEsiBudgetExceeded({
				globalCount: 100,
				routeCount: 10,
				priorityCount: 131,
				priority: 'background',
				globalLimit: 180,
				routeLimit: 60,
				backgroundLimit: 130,
			})
		).toBe(true)
		expect(
			isAuthEsiBudgetExceeded({
				globalCount: 100,
				routeCount: 10,
				priorityCount: 200,
				priority: 'interactive',
				globalLimit: 180,
				routeLimit: 60,
				backgroundLimit: 130,
			})
		).toBe(false)
	})

	it('derives dynamic limits from header budget snapshot', () => {
		const nowMs = Date.now()
		const limits = computeEffectiveAuthEsiBudgetLimits({
			baseGlobalLimit: 180,
			baseRouteLimit: 60,
			baseBackgroundLimit: 130,
			nowMs,
			dynamicBudget: {
				remain: 40,
				resetSeconds: 20,
				observedAtMs: nowMs,
			},
		})
		expect(limits.source).toBe('dynamic')
		expect(limits.globalLimit).toBe(35)
		expect(limits.routeLimit).toBe(11)
		expect(limits.backgroundLimit).toBe(25)
	})

	it('falls back to static limits when dynamic budget is stale', () => {
		const nowMs = Date.now()
		const limits = computeEffectiveAuthEsiBudgetLimits({
			baseGlobalLimit: 180,
			baseRouteLimit: 60,
			baseBackgroundLimit: 130,
			nowMs,
			dynamicBudget: {
				remain: 10,
				resetSeconds: 5,
				observedAtMs: nowMs - 10_000,
			},
		})
		expect(limits.source).toBe('static')
		expect(limits.globalLimit).toBe(180)
		expect(limits.routeLimit).toBe(60)
		expect(limits.backgroundLimit).toBe(130)
	})
})
