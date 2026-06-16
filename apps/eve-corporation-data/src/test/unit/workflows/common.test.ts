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

function createTaxStub(store: KvStore) {
	return {
		getTaxProjectionRetryIntent: vi.fn(async (corporationId: string) => {
			return store.get(`tax-projection-retry-intent:${corporationId}`) ?? null
		}),
		putTaxProjectionRetryIntent: vi.fn(async (corporationId: string, value: string) => {
			store.set(`tax-projection-retry-intent:${corporationId}`, value)
		}),
		deleteTaxProjectionRetryIntent: vi.fn(async (corporationId: string) => {
			store.delete(`tax-projection-retry-intent:${corporationId}`)
		}),
		triggerProjectionRefreshFromWalletSync: vi.fn(),
	}
}

function createEnv(store: KvStore) {
	const env = {
		CORPORATION_TAX: createTaxStub(store),
	} as any
	getCorporationTaxStubMock.mockReturnValue(env.CORPORATION_TAX)
	return env
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
			...createTaxStub(store),
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
		const triggerProjectionRefreshFromWalletSync = vi.fn().mockResolvedValue({
			corporationId: input.corporationId,
			triggered: false,
			reason: 'up_to_date',
		})

		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom')

		getCorporationTaxStubMock.mockReturnValue({
			...createTaxStub(store),
			triggerProjectionRefreshFromWalletSync,
		})

		const replay = await replayTaxProjectionRetryIntent(env, input.corporationId)
		expect(replay.replayed).toBe(true)
		expect(replay.succeeded).toBe(true)
		expect(replay.reason).toBe('up_to_date')
		expect(triggerProjectionRefreshFromWalletSync).toHaveBeenCalledTimes(1)
		const replayedInput = triggerProjectionRefreshFromWalletSync.mock.calls[0]?.[1]
		expect(replayedInput.triggeredAt).toBeInstanceOf(Date)
		expect(replayedInput.walletJournal?.maxDate).toBeInstanceOf(Date)
		expect(store.has(`tax-projection-retry-intent:${input.corporationId}`)).toBe(false)
	})

	it('replays retry intent and keeps it with incremented retry count on failure', async () => {
		const store = new Map<string, string>()
		const env = createEnv(store)
		const input = createInput()

		await recordTaxProjectionRetryIntent(env, input.corporationId, 'director-1', input, 'boom')

		getCorporationTaxStubMock.mockReturnValue({
			...createTaxStub(store),
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
