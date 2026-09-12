import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClient, ConflictError } from '@/lib/api'

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('Timerboard ApiClient', () => {
	it('preserves the latest entry from a 409 response for conflict recovery', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: 'Timerboard entry was modified by another user',
							current: { id: 'entry-1', version: 4, title: 'Latest title' },
						}),
						{
							status: 409,
							headers: { 'content-type': 'application/json' },
						}
					)
			)
		)
		const client = new ApiClient('/api')

		const error = await client
			.updateTimerboardEntry('entry-1', { title: 'Stale title', expectedVersion: 3 })
			.catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(ConflictError)
		expect((error as ConflictError<{ version: number; title: string }>).current).toMatchObject({
			version: 4,
			title: 'Latest title',
		})
	})
})
