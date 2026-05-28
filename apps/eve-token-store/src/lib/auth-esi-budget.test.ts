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
		expect(isAuthEsiBudgetExceeded({ routeCount: 61, routeLimit: 60 })).toBe(true)
		expect(isAuthEsiBudgetExceeded({ routeCount: 10, routeLimit: 60 })).toBe(false)
	})

	it('derives dynamic limits from header budget snapshot', () => {
		const nowMs = Date.now()
		const limits = computeEffectiveAuthEsiBudgetLimits({
			baseRouteLimit: 60,
			nowMs,
			dynamicBudget: {
				remain: 40,
				resetSeconds: 20,
				observedAtMs: nowMs,
			},
		})
		expect(limits.source).toBe('dynamic')
		expect(limits.routeLimit).toBe(35)
	})

	it('falls back to static limits when dynamic budget is stale', () => {
		const nowMs = Date.now()
		const limits = computeEffectiveAuthEsiBudgetLimits({
			baseRouteLimit: 60,
			nowMs,
			dynamicBudget: {
				remain: 10,
				resetSeconds: 5,
				observedAtMs: nowMs - 10_000,
			},
		})
		expect(limits.source).toBe('static')
		expect(limits.routeLimit).toBe(60)
	})

	it('clamps dynamic route limit to minimum 1 and maximum base limit', () => {
		const nowMs = Date.now()
		const low = computeEffectiveAuthEsiBudgetLimits({
			baseRouteLimit: 60,
			nowMs,
			dynamicBudget: {
				remain: 0,
				resetSeconds: 30,
				observedAtMs: nowMs,
			},
		})
		expect(low.source).toBe('dynamic')
		expect(low.routeLimit).toBe(1)

		const high = computeEffectiveAuthEsiBudgetLimits({
			baseRouteLimit: 60,
			nowMs,
			dynamicBudget: {
				remain: 999,
				resetSeconds: 30,
				observedAtMs: nowMs,
			},
		})
		expect(high.source).toBe('dynamic')
		expect(high.routeLimit).toBe(60)
	})
})
