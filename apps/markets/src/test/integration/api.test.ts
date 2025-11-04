import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'
import type { Markets } from '@repo/markets'

import worker from '../../index'

describe('Markets Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('Markets')
	})

	it('can call Durable Object via example endpoint', async () => {
		const request = new Request('http://example.com/example?id=test-1')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data).toHaveProperty('id', 'test-1')
		expect(data).toHaveProperty('result')
	})
})

describe('Markets Durable Object', () => {
	it('can get alarm status', async () => {
		const stub = getStub<Markets>(env.MARKETS, `test-alarm-${Date.now()}-${Math.random()}`)

		const status = await stub.getAlarmStatus()

		expect(status).toHaveProperty('isActive')
		expect(status).toHaveProperty('locationId')
		expect(status).toHaveProperty('locationType')
		expect(status.isActive).toBe(false)
	})

	it('can start and stop hourly snapshots', async () => {
		const stub = getStub<Markets>(env.MARKETS, `test-region-${Date.now()}-${Math.random()}`)
		const testRegionId = '10000002' // The Forge

		// Start snapshots
		await stub.startHourlySnapshots(testRegionId)

		// Check alarm is active
		const statusActive = await stub.getAlarmStatus()
		expect(statusActive.isActive).toBe(true)
		expect(statusActive.locationId).toBe(testRegionId)

		// Stop snapshots
		await stub.stopHourlySnapshots(testRegionId)

		// Check alarm is inactive
		const statusInactive = await stub.getAlarmStatus()
		expect(statusInactive.isActive).toBe(false)
	})
})
