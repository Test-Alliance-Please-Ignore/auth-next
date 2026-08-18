import { describe, expect, it } from 'vitest'

import { shouldBypassSessionMiddleware } from '../middleware/session'

describe('session middleware public-route bypasses', () => {
	it('bypasses session work for image requests', () => {
		expect(shouldBypassSessionMiddleware('/images/characters/123/portrait')).toBe(true)
		expect(shouldBypassSessionMiddleware('/images')).toBe(true)
	})

	it('does not bypass session work for protected routes', () => {
		expect(shouldBypassSessionMiddleware('/api/users/me')).toBe(false)
		expect(shouldBypassSessionMiddleware('/image/characters/123/portrait')).toBe(false)
	})
})
