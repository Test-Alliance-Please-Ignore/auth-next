import { describe, expect, it } from 'vitest'

import { estimateMagmaticGasDepletionAt } from '../../../services/magmatic-gas'

describe('estimateMagmaticGasDepletionAt', () => {
	it('derives depletion from the inventory snapshot timestamp', () => {
		expect(estimateMagmaticGasDepletionAt(400, '2026-01-01T00:00:00.000Z')).toBe(
			'2026-01-01T02:00:00.000Z'
		)
	})

	it('returns null when no positive inventory or timestamp is available', () => {
		expect(estimateMagmaticGasDepletionAt(0, '2026-01-01T00:00:00.000Z')).toBeNull()
		expect(estimateMagmaticGasDepletionAt(null, '2026-01-01T00:00:00.000Z')).toBeNull()
		expect(estimateMagmaticGasDepletionAt(400, null)).toBeNull()
	})
})
