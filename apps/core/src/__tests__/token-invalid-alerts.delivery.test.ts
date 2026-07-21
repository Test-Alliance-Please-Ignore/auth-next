import { describe, expect, it } from 'vitest'

import { shouldRetryTokenInvalidationAlertDelivery } from '../lib/token-invalid-alerts'

describe('token invalidation alert delivery retry policy', () => {
	it('treats missing DM permissions as fatal', () => {
		expect(
			shouldRetryTokenInvalidationAlertDelivery({
				error: 'Missing permissions to send DM to this user',
				retryable: false,
			})
		).toBe(false)
	})

	it('treats other failures as retryable by default', () => {
		expect(
			shouldRetryTokenInvalidationAlertDelivery({
				error: 'Discord API error: 500',
			})
		).toBe(true)
	})
})
