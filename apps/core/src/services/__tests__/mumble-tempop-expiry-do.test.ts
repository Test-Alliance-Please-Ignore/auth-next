import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MumbleTempopExpiryDO } from '../../mumble-tempop-expiry-do'
import {
	deleteCredentialHandoff,
	expireTempop,
	listTempopExpiryItems,
} from '../mumble-tempop.service'

vi.mock('../mumble-tempop.service', () => ({
	deleteCredentialHandoff: vi.fn(),
	expireTempop: vi.fn(),
	listTempopExpiryItems: vi.fn(),
}))

const deleteCredentialHandoffMock = vi.mocked(deleteCredentialHandoff)
const expireTempopMock = vi.mocked(expireTempop)
const listTempopExpiryItemsMock = vi.mocked(listTempopExpiryItems)
const env = { DATABASE_URL: 'postgres://test' }

describe('MumbleTempopExpiryDO dispatch', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('maps schedule and cancellation APIs to stable opaque queue keys', async () => {
		const queue = {
			upsert: vi.fn().mockResolvedValue(undefined),
			cancel: vi.fn().mockResolvedValue(true),
		}
		const instance = { queue } as any

		await MumbleTempopExpiryDO.prototype.scheduleTempop.call(instance, 'tempop-1', 10_000)
		await MumbleTempopExpiryDO.prototype.cancelTempop.call(instance, 'tempop-1')
		await MumbleTempopExpiryDO.prototype.scheduleCredentialHandoff.call(instance, 'hash-1', 20_000)
		await MumbleTempopExpiryDO.prototype.cancelCredentialHandoff.call(instance, 'hash-1')

		expect(queue.upsert).toHaveBeenNthCalledWith(1, 'tempop:tempop-1', 10_000, {
			kind: 'tempop',
			tempopId: 'tempop-1',
		})
		expect(queue.cancel).toHaveBeenNthCalledWith(1, 'tempop:tempop-1')
		expect(queue.upsert).toHaveBeenNthCalledWith(2, 'credential-handoff:hash-1', 20_000, {
			kind: 'credential-handoff',
			tokenHash: 'hash-1',
		})
		expect(queue.cancel).toHaveBeenNthCalledWith(2, 'credential-handoff:hash-1')
	})

	it('delegates reconciliation to the authoritative database projection', async () => {
		const items = [{ id: 'tempop:tempop-1', dueAt: 10_000, payload: { kind: 'tempop', tempopId: 'tempop-1' as const } }]
		listTempopExpiryItemsMock.mockResolvedValue(items)
		const replace = vi.fn().mockResolvedValue(undefined)

		await expect(
			MumbleTempopExpiryDO.prototype.reconcile.call({ env, queue: { replace } } as any)
		).resolves.toEqual({ scheduled: 1 })
		expect(replace).toHaveBeenCalledWith(items)
	})

	it('expires a temp-op and removes the queue item when it is due', async () => {
		expireTempopMock.mockResolvedValue({ rescheduleAt: null, disconnected: 2 })

		const result = await (MumbleTempopExpiryDO.prototype as any).handleItem.call(
			{ env },
			{ kind: 'tempop', tempopId: 'tempop-1' }
		)

		expect(expireTempopMock).toHaveBeenCalledWith(env, 'tempop-1')
		expect(result).toEqual({ action: 'complete' })
	})

	it('reschedules a stale temp-op item when its source expiry moved forward', async () => {
		expireTempopMock.mockResolvedValue({ rescheduleAt: 50_000, disconnected: 0 })

		const result = await (MumbleTempopExpiryDO.prototype as any).handleItem.call(
			{ env },
			{ kind: 'tempop', tempopId: 'tempop-1' }
		)

		expect(result).toEqual({ action: 'reschedule', dueAt: 50_000 })
	})

	it('deletes expired handoff rows without exposing their credentials', async () => {
		const result = await (MumbleTempopExpiryDO.prototype as any).handleItem.call(
			{ env },
			{ kind: 'credential-handoff', tokenHash: 'hash-1' }
		)

		expect(deleteCredentialHandoffMock).toHaveBeenCalledWith(env, 'hash-1')
		expect(result).toEqual({ action: 'complete' })
	})
})
