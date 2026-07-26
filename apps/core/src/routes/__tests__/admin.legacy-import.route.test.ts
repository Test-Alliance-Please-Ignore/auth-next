import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import adminRoutes from '../admin'

import type { SessionUser } from '../../context'

const { createDbMock, recordUserIpAddressMock } = vi.hoisted(() => ({
	createDbMock: vi.fn(),
	recordUserIpAddressMock: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: (...args: unknown[]) => createDbMock(...args),
}))

vi.mock('../../lib/ip-tracking', () => ({
	recordUserIpAddress: (...args: unknown[]) => recordUserIpAddressMock(...args),
}))

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: '00000000-0000-0000-0000-000000000001',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [{ characterId: '7001', characterName: 'Main Pilot', is_primary: true } as any],
		is_admin: true,
		roles: [ROLE_CORE_ALLIANCE_MEMBER],
		discordUserId: null,
		...overrides,
	}
}

function createApp(user?: SessionUser) {
	const app = new Hono<{
		Bindings: any
		Variables: { user?: SessionUser; db?: ReturnType<typeof createDbMock> }
	}>()
	if (user) {
		app.use('*', async (c, next) => {
			c.set('user', user)
			c.set('db', createDbMock())
			await next()
		})
	}
	app.route('/api/admin', adminRoutes)
	return app
}

describe('admin legacy import routes', () => {
	const hrStub = {
		createNote: vi.fn(),
	}
	const insertValuesMock = vi.fn()
	const updateWhereMock = vi.fn()
	const userCharactersFindManyMock = vi.fn()

	const env = {
		DATABASE_URL: 'postgresql://test',
		HR: { name: 'HR' },
		IP_ADDRESS_HASH_SECRET: 'secret',
	} as any

	beforeEach(() => {
		vi.clearAllMocks()
		insertValuesMock.mockResolvedValue(undefined)
		updateWhereMock.mockResolvedValue(undefined)
		userCharactersFindManyMock.mockResolvedValue([])
		createDbMock.mockReturnValue({
			query: {
				userCharacters: {
					findMany: userCharactersFindManyMock,
				},
			},
			insert: vi.fn(() => ({ values: insertValuesMock })),
			update: vi.fn(() => ({ set: () => ({ where: updateWhereMock }) })),
		})
		hrStub.createNote.mockResolvedValue({ id: 'note-1' })
		recordUserIpAddressMock.mockResolvedValue(undefined)
		vi.mocked(getStub).mockReturnValue(hrStub as any)
	})

	it('imports character links with dedupe/conflict counts', async () => {
		const app = createApp(makeUser())
		userCharactersFindManyMock.mockResolvedValue([
			{ characterId: '2002', userId: '11111111-1111-4111-8111-111111111111' },
			{ characterId: '2003', userId: '99999999-9999-4999-8999-999999999999' },
		])

		const response = await app.request(
			'/api/admin/legacy/import-character-links',
			{
				method: 'POST',
				body: JSON.stringify({
					modernUserId: '11111111-1111-4111-8111-111111111111',
					legacyAuthUserId: 'legacy-1',
					characters: [
						{ characterId: '2001', characterName: 'One', source: 'esi_owner' },
						{ characterId: '2002', characterName: 'Two', source: 'xml_account' },
						{ characterId: '2003', characterName: 'Three', source: 'xml_account' },
					],
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		const json = await response.json()
		expect(json).toMatchObject({
			inserted: 1,
			alreadyLinkedToUser: 1,
			linkedToOtherUser: 1,
			totalRequested: 3,
		})
		expect(insertValuesMock).toHaveBeenCalledTimes(1)
	})

	it('imports legacy notes into HR notes', async () => {
		const app = createApp(makeUser())
		hrStub.createNote.mockResolvedValueOnce({ id: 'note-1' }).mockRejectedValueOnce(new Error('fail'))

		const response = await app.request(
			'/api/admin/legacy/import-notes',
			{
				method: 'POST',
				body: JSON.stringify({
					modernUserId: '11111111-1111-4111-8111-111111111111',
					legacyAuthUserId: 'legacy-1',
					notes: [
						{ legacyNoteId: 'n-1', note: 'first' },
						{ legacyNoteId: 'n-2', note: 'second' },
					],
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		const json = await response.json()
		expect(json).toMatchObject({ created: 1, failed: 1, totalRequested: 2 })
		expect(hrStub.createNote).toHaveBeenCalledTimes(2)
	})

	it('imports unique IP associations via canonical tracker', async () => {
		const app = createApp(makeUser())
		const response = await app.request(
			'/api/admin/legacy/import-ip-associations',
			{
				method: 'POST',
				body: JSON.stringify({
					modernUserId: '11111111-1111-4111-8111-111111111111',
					legacyAuthUserId: 'legacy-1',
					ipAddresses: [{ ipAddress: '1.1.1.1' }, { ipAddress: '1.1.1.1' }, { ipAddress: '2.2.2.2' }],
				}),
			},
			env
		)

		expect(response.status).toBe(200)
		expect(recordUserIpAddressMock).toHaveBeenCalledTimes(2)
		const json = await response.json()
		expect(json).toMatchObject({ imported: 2, failed: 0, totalRequested: 2 })
	})
})
