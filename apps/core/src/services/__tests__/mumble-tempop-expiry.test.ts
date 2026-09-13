import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDb } from '../../db'
import { getStub } from '@repo/do-utils'
import {
	consumeCredentialHandoff,
	createTempop,
	deleteTempop,
	expireTempop,
	listTempopExpiryItems,
	storeCredentialHandoff,
} from '../mumble-tempop.service'

import type { Env } from '../../context'

vi.mock('../../db', () => ({ createDb: vi.fn() }))
vi.mock('@repo/do-utils', () => ({ getStub: vi.fn() }))
vi.mock('@repo/hono-helpers', () => ({
	logger: { error: vi.fn(), info: vi.fn() },
}))
vi.mock('../mumble.service', () => ({
	TEMPOP_GROUP_NAME: 'TempOp',
	deleteMumbleAccounts: vi.fn(),
}))

const createDbMock = vi.mocked(createDb)
const getStubMock = vi.mocked(getStub)

function makeEnv(): Env {
	return {
		DATABASE_URL: 'postgres://test',
		MUMBLE_TEMPOP_EXPIRY: {},
	} as Env
}

function makeDb(overrides: Record<string, unknown> = {}) {
	return {
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		query: {
			mumbleTempops: {
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
			mumbleTempopGuests: { findMany: vi.fn() },
			mumbleTempopCredentialHandoffs: {
				findFirst: vi.fn(),
				findMany: vi.fn(),
			},
		},
		...overrides,
	} as any
}

describe('Mumble temp-op expiry integration', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('schedules a newly created temp-op using its database ID and expiry timestamp', async () => {
		const scheduleTempop = vi.fn().mockResolvedValue(undefined)
		getStubMock.mockReturnValue({ scheduleTempop } as any)
		const db = makeDb()
		db.insert.mockReturnValue({
			values: vi.fn().mockReturnValue({
				returning: vi.fn().mockResolvedValue([{ id: 'tempop-1', shortCode: 'ABC123' }]),
			}),
		})
		createDbMock.mockReturnValue(db)

		const created = await createTempop(makeEnv(), {
			creatorUserId: 'user-1',
			ttlSeconds: 3600,
		})

		expect(created.id).toBe('tempop-1')
		expect(scheduleTempop).toHaveBeenCalledWith('tempop-1', created.expiresAt.getTime())
	})

	it('cancels a temp-op alarm after manual deletion', async () => {
		const cancelTempop = vi.fn().mockResolvedValue(undefined)
		getStubMock.mockReturnValue({ cancelTempop } as any)
		const db = makeDb()
		db.query.mumbleTempopGuests.findMany.mockResolvedValue([])
		db.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
		createDbMock.mockReturnValue(db)

		await deleteTempop(makeEnv(), 'tempop-1', 'admin-1')

		expect(cancelTempop).toHaveBeenCalledWith('tempop-1')
	})

	it('schedules handoffs without persisting their plaintext token', async () => {
		const scheduleCredentialHandoff = vi.fn().mockResolvedValue(undefined)
		getStubMock.mockReturnValue({ scheduleCredentialHandoff } as any)
		const db = makeDb()
		const values = vi.fn().mockResolvedValue(undefined)
		db.insert.mockReturnValue({ values })
		createDbMock.mockReturnValue(db)

		const token = await storeCredentialHandoff(makeEnv(), 'tempop-1', {
			loginName: 'guest',
			password: 'secret',
			host: 'voice.test',
			port: 64738,
		})

		const inserted = values.mock.calls[0][0]
		expect(inserted.tokenHash).not.toBe(token)
		expect(inserted.credentials.password).toBe('secret')
		expect(scheduleCredentialHandoff).toHaveBeenCalledWith(
		inserted.tokenHash,
		inserted.expiresAt.getTime()
		)
	})

	it('cancels a handoff alarm after single-use consumption', async () => {
		const cancelCredentialHandoff = vi.fn().mockResolvedValue(undefined)
		getStubMock.mockReturnValue({ cancelCredentialHandoff } as any)
		const db = makeDb()
		db.query.mumbleTempopCredentialHandoffs.findFirst.mockResolvedValue({
			tokenHash: 'hash-1',
			expiresAt: new Date(Date.now() + 60_000),
			credentials: { loginName: 'guest', password: 'secret', host: 'voice.test', port: 64738 },
		})
		db.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		createDbMock.mockReturnValue(db)

		const result = await consumeCredentialHandoff(makeEnv(), 'token-1')

		expect(result?.loginName).toBe('guest')
		expect(cancelCredentialHandoff).toHaveBeenCalledOnce()
	})

	it('expires only active due temp-ops and reschedules stale queue entries', async () => {
		const db = makeDb()
		db.query.mumbleTempops.findFirst
			.mockResolvedValueOnce({ id: 'future', expiresAt: new Date(Date.now() + 60_000) })
			.mockResolvedValueOnce({ id: 'due', expiresAt: new Date(Date.now() - 1) })
		db.query.mumbleTempopGuests.findMany.mockResolvedValue([])
		db.update.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) })
		createDbMock.mockReturnValue(db)

		await expect(expireTempop(makeEnv(), 'future')).resolves.toMatchObject({
			rescheduleAt: expect.any(Number),
			disconnected: 0,
		})
		await expect(expireTempop(makeEnv(), 'due')).resolves.toEqual({
			rescheduleAt: null,
			disconnected: 0,
		})
	})

	it('rebuilds the alarm list from active temp-ops and handoffs', async () => {
		const db = makeDb()
		db.query.mumbleTempops.findMany.mockResolvedValue([
			{ id: 'tempop-1', expiresAt: new Date(10_000) },
		])
		db.query.mumbleTempopCredentialHandoffs.findMany.mockResolvedValue([
			{ tokenHash: 'hash-1', expiresAt: new Date(20_000) },
		])
		createDbMock.mockReturnValue(db)

		await expect(listTempopExpiryItems(makeEnv())).resolves.toEqual([
			{
				id: 'tempop:tempop-1',
				dueAt: 10_000,
				payload: { kind: 'tempop', tempopId: 'tempop-1' },
			},
			{
				id: 'credential-handoff:hash-1',
				dueAt: 20_000,
				payload: { kind: 'credential-handoff', tokenHash: 'hash-1' },
			},
		])
	})
})
