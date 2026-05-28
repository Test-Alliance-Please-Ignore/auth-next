import { describe, expect, it } from 'vitest'

import { shouldOpenRouteCircuitForResponse } from './auth-esi-circuit-policy'

describe('auth-esi circuit policy', () => {
	it('opens route circuit for 429 only', () => {
		expect(shouldOpenRouteCircuitForResponse(429)).toBe(true)
		expect(shouldOpenRouteCircuitForResponse(420)).toBe(false)
		expect(shouldOpenRouteCircuitForResponse(500)).toBe(false)
	})
})
