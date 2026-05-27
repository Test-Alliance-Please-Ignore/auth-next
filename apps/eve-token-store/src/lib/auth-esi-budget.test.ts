import { describe, expect, it } from 'vitest'

import {
	classifyAuthEsiPriority,
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
})
