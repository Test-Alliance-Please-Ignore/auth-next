import { describe, expect, it } from 'vitest'

import {
	shouldOpenGlobalEmergencyCircuit,
	shouldOpenRouteCircuitForResponse,
} from './auth-esi-circuit-policy'

describe('auth-esi circuit policy', () => {
	it('opens route circuit for 429 only', () => {
		expect(shouldOpenRouteCircuitForResponse(429)).toBe(true)
		expect(shouldOpenRouteCircuitForResponse(420)).toBe(false)
		expect(shouldOpenRouteCircuitForResponse(500)).toBe(false)
	})

	it('opens global emergency circuit for 420', () => {
		expect(shouldOpenGlobalEmergencyCircuit({ status: 420 })).toBe(true)
	})

	it('opens global emergency circuit for 429 with error-limit signals', () => {
		expect(
			shouldOpenGlobalEmergencyCircuit({
				status: 429,
				errorLimitRemain: 0,
			})
		).toBe(true)
		expect(
			shouldOpenGlobalEmergencyCircuit({
				status: 429,
				errorLimitResetSeconds: 10,
			})
		).toBe(true)
	})

	it('does not open global emergency circuit for plain 429 without error-limit signals', () => {
		expect(shouldOpenGlobalEmergencyCircuit({ status: 429 })).toBe(false)
	})
})
