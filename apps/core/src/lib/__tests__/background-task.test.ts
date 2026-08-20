import { describe, expect, it, vi } from 'vitest'

import { waitUntilWithTelemetry } from '../background-task'

describe('waitUntilWithTelemetry', () => {
	it('registers the background promise before starting the task', async () => {
		const events: string[] = []
		let registeredPromise: Promise<unknown> | undefined
		const executionCtx = {
			waitUntil: vi.fn((promise: Promise<unknown>) => {
				events.push('registered')
				registeredPromise = promise
			}),
		}

		waitUntilWithTelemetry(executionCtx, 'test.task', async () => {
			events.push('started')
		})

		expect(events).toEqual(['registered'])
		if (!registeredPromise) {
			throw new Error('waitUntil did not receive a promise')
		}
		await registeredPromise
		expect(events).toEqual(['registered', 'started'])
	})
})
