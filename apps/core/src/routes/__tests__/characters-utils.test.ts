import { describe, expect, it } from 'vitest'

import { shouldTreatSensitiveDataAsLive } from '../characters-utils'

describe('shouldTreatSensitiveDataAsLive', () => {
	it('treats valid and unknown token states as live', () => {
		expect(shouldTreatSensitiveDataAsLive(true)).toBe(true)
		expect(shouldTreatSensitiveDataAsLive(null)).toBe(true)
		expect(shouldTreatSensitiveDataAsLive(undefined)).toBe(true)
	})

	it('treats explicitly invalid token state as stale', () => {
		expect(shouldTreatSensitiveDataAsLive(false)).toBe(false)
	})
})
