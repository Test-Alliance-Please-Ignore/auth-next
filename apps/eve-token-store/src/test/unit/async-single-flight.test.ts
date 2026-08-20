import { describe, expect, it, vi } from 'vitest'

import { runSingleFlight } from '../../lib/async-single-flight'

describe('runSingleFlight', () => {
	it('shares concurrent work for the same key and clears it after completion', async () => {
		const inFlight = new Map<string, Promise<string>>()
		let resolveOperation!: (value: string) => void
		const operation = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveOperation = resolve
				})
		)

		const first = runSingleFlight(inFlight, 'character-1', operation)
		const second = runSingleFlight(inFlight, 'character-1', operation)

		expect(second).toBe(first)
		expect(operation).toHaveBeenCalledOnce()

		resolveOperation('refreshed')
		expect(await first).toBe('refreshed')
		expect(inFlight.size).toBe(0)

		const third = runSingleFlight(inFlight, 'character-1', async () => 'refreshed-again')
		expect(await third).toBe('refreshed-again')
	})

	it('does not leave rejected cleanup promises behind', async () => {
		const inFlight = new Map<string, Promise<string>>()
		const pending = runSingleFlight(inFlight, 'character-1', async () => {
			throw new Error('refresh failed')
		})

		await expect(pending).rejects.toThrow('refresh failed')
		await Promise.resolve()
		expect(inFlight.size).toBe(0)
	})
})
