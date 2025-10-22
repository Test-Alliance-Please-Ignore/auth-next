import { getStub } from '@repo/do-utils'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import { createExecutionContext, env as testEnv, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import type { Env } from '../../context'
import workerExports from '../../index'

// Cast test env to our Env type
const env = testEnv as unknown as Env

describe('EveCorporationData Worker', () => {
	it('responds to root endpoint', async () => {
		const request = new Request('http://example.com/')
		const ctx = createExecutionContext()
		const response = await workerExports.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const text = await response.text()
		expect(text).toContain('EveCorporationData')
	})

	it('can call Durable Object via example endpoint', async () => {
		const request = new Request('http://example.com/example?id=corp-98000001')
		const ctx = createExecutionContext()
		const response = await workerExports.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		const data = await response.json()
		expect(data).toHaveProperty('id', 'corp-98000001')
		expect(data).toHaveProperty('config')
	})
})

describe('EveCorporationData Durable Object', () => {
	it('can set and get configuration', async () => {
		const testCorp = Math.floor(Math.random() * 1000000) + 98000000
		const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, `corp-${testCorp}`)

		// Should return null before configuration
		const configBefore = await stub.getConfiguration()
		expect(configBefore).toBeNull()

		// Set configuration
		await stub.setCharacter(testCorp, 2119123456, 'Test Character')

		// Should return configuration after setting
		const configAfter = await stub.getConfiguration()
		expect(configAfter).not.toBeNull()
		expect(configAfter?.corporationId).toBe(testCorp)
		expect(configAfter?.characterId).toBe(2119123456)
		expect(configAfter?.characterName).toBe('Test Character')
		expect(configAfter?.isVerified).toBe(false)
	})

	it('can get corporation info when configured', async () => {
		const testCorp = Math.floor(Math.random() * 1000000) + 98000000
		const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, `corp-${testCorp}`)

		// Should return null before any data fetched
		const infoBefore = await stub.getCorporationInfo()
		expect(infoBefore).toBeNull()
	})

	it('throws error when fetching data without configuration', async () => {
		const testCorp = Math.floor(Math.random() * 1000000) + 98000000
		const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, `corp-${testCorp}`)

		// Should throw error when trying to fetch without configuration
		await expect(stub.fetchCoreData()).rejects.toThrow('Corporation not configured')
	})

	it('can get empty arrays for uninitialized data', async () => {
		const testCorp = Math.floor(Math.random() * 1000000) + 98000000
		const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, `corp-${testCorp}`)

		// Should return empty arrays for uninitialized data
		const members = await stub.getMembers()
		expect(members).toEqual([])

		const wallets = await stub.getWallets()
		expect(wallets).toEqual([])

		const orders = await stub.getOrders()
		expect(orders).toEqual([])
	})

	it('handles multiple corporations independently', async () => {
		const testCorp1 = Math.floor(Math.random() * 1000000) + 98000000
		const testCorp2 = Math.floor(Math.random() * 1000000) + 98000000

		const stub1 = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, `corp-${testCorp1}`)
		const stub2 = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, `corp-${testCorp2}`)

		// Configure both corporations with different characters
		await stub1.setCharacter(testCorp1, 1111111111, 'Character 1')
		await stub2.setCharacter(testCorp2, 2222222222, 'Character 2')

		// Verify configurations are independent
		const config1 = await stub1.getConfiguration()
		const config2 = await stub2.getConfiguration()

		expect(config1?.corporationId).toBe(testCorp1)
		expect(config1?.characterId).toBe(1111111111)

		expect(config2?.corporationId).toBe(testCorp2)
		expect(config2?.characterId).toBe(2222222222)
	})
})
