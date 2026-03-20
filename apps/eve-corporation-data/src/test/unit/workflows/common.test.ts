import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	clearTaxProjectionRetryIntent,
	recordTaxProjectionRetryIntent,
	replayTaxProjectionRetryIntent,
	triggerTaxProjectionRefresh,
} from '../../../workflows/steps/common'

const getCorporationTaxStubMock = vi.fn()

vi.mock('../../../workflows/utils/services', () => {
	return {
		getCorporationTaxStub: (...args: unknown[]) => getCorporationTaxStubMock(...args),
		getGlobalCorporationDataStub: vi.fn(),
	}
})

type KvStore = Map<string, string>

function createKvNamespace(store: KvStore): KVNamespace {
	return {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value)
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key)
		}),
	} as unknown as KVNamespace
}

function createEnv(store: KvStore) {
	return {
		CACHE: createKvNamespace(store),
	} as any
}

function createInput(corporationId = '98000001') {
	return {
		corporationId,
		upstreamRunId: 'wf-1',
		triggeredAt: new Date('2026-03-20T00:00:00.000Z'),
		walletJournal: {
			maxId: '100',
			maxDate: new Date('2026-03-20T00:00:00.000Z'),
			fetchedCount: 3,
		},
		walletTransactions: null,
		includeCharacterWallets: true,
	}
}

describe('workflow common tax projection retry utilities', () => {
	beforeEach(() => {
		getCorporationTaxStubMock.mockReset()
	})

	it('triggers tax projection refresh via tax stub', async () => {
		const store = new Map<string, string>()
		const env = createEnv(store)
		const input = createInput()

		getCorporationTaxStubMock.mockReturnValue({
			triggerProjectionRefreshFromWalletSync: vi.fn().mockResolvedValue({
				corporationId: input.corporationId,
				triggered: true,
				reason: 'ingested',
			}),
		})

		const result = await triggerTaxProjectionRefresh(env, 'director-1', input)
		expect(result.triggered).toBe(true)
		expect(result.reason).toBe('ingested')
	})

	it('records retry intent and increments retry count', async () => {
		const store = new Map<string, string>()
		const env = createEnv(store)
		const input = createInput()

		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom')
		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom-2')

		const key = `tax-projection-retry-intent:${input.corporationId}`
		const value = store.get(key)
		expect(value).toBeTruthy()
		const parsed = JSON.parse(value!)
		expect(parsed.retryCount).toBe(2)
		expect(parsed.lastError).toBe('boom-2')
	})

	it('replays retry intent and clears it on success', async () => {
		const store = new Map<string, string>()
		const env = createEnv(store)
		const input = createInput()

		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom')

		getCorporationTaxStubMock.mockReturnValue({
			triggerProjectionRefreshFromWalletSync: vi.fn().mockResolvedValue({
				corporationId: input.corporationId,
				triggered: false,
				reason: 'up_to_date',
			}),
		})

		const replay = await replayTaxProjectionRetryIntent(env, input.corporationId)
		expect(replay.replayed).toBe(true)
		expect(replay.succeeded).toBe(true)
		expect(replay.reason).toBe('up_to_date')
		expect(store.has(`tax-projection-retry-intent:${input.corporationId}`)).toBe(false)
	})

	it('replays retry intent and keeps it with incremented retry count on failure', async () => {
		const store = new Map<string, string>()
		const env = createEnv(store)
		const input = createInput()

		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom')

		getCorporationTaxStubMock.mockReturnValue({
			triggerProjectionRefreshFromWalletSync: vi.fn().mockRejectedValue(new Error('still bad')),
		})

		const replay = await replayTaxProjectionRetryIntent(env, input.corporationId)
		expect(replay.replayed).toBe(true)
		expect(replay.succeeded).toBe(false)
		expect(replay.reason).toBe('still bad')

		const key = `tax-projection-retry-intent:${input.corporationId}`
		const value = store.get(key)
		expect(value).toBeTruthy()
		const parsed = JSON.parse(value!)
		expect(parsed.retryCount).toBe(2)
		expect(parsed.lastError).toBe('still bad')
	})

	it('clearTaxProjectionRetryIntent removes stored intent', async () => {
		const store = new Map<string, string>()
		const env = createEnv(store)
		const input = createInput()

		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom')
		await clearTaxProjectionRetryIntent(env, input.corporationId)

		expect(store.has(`tax-projection-retry-intent:${input.corporationId}`)).toBe(false)
	})
})
