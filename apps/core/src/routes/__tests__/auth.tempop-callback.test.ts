import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDb } from '../../db'
import { getStub } from '@repo/do-utils'
import authRoutes from '../auth'
import { provisionTempopGuest } from '../../services/mumble.service'
import { storeCredentialHandoff } from '../../services/mumble-tempop.service'

import type { TempopOAuthMetadata } from '../../db/schema'

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../services/mumble.service', () => ({
	provisionTempopGuest: vi.fn(),
}))

vi.mock('../../services/mumble-tempop.service', () => ({
	storeCredentialHandoff: vi.fn(),
}))

const createDbMock = vi.mocked(createDb)
const getStubMock = vi.mocked(getStub)
const provisionTempopGuestMock = vi.mocked(provisionTempopGuest)
const storeCredentialHandoffMock = vi.mocked(storeCredentialHandoff)

function createApp() {
	const app = new Hono<{
		Bindings: any
		Variables: any
	}>()
	app.route('/api/auth', authRoutes)
	return app
}

describe('GET /api/auth/callback temp-op flow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns JSON with a temp-op redirect URL instead of a redirect response', async () => {
		const deleteWhereMock = vi.fn().mockResolvedValue(undefined)
		const deleteMock = vi.fn(() => ({ where: deleteWhereMock }))
		createDbMock.mockReturnValue({
			query: {
				oauthStates: {
					findFirst: vi.fn().mockResolvedValue({
						state: 'state-1',
						flowType: 'mumble-tempop',
						userId: null,
						redirectUrl: null,
						metadata: {
							key: 'temp-key',
							tempopId: 'tempop-1',
						} satisfies TempopOAuthMetadata,
						expiresAt: new Date('2099-01-01T00:00:00.000Z'),
					}),
				},
				mumbleTempops: {
					findFirst: vi.fn().mockResolvedValue({
						id: 'tempop-1',
						status: 'active',
						expiresAt: new Date('2099-01-01T00:00:00.000Z'),
					}),
				},
			},
			delete: deleteMock,
		} as any)

		const verifyPublicDataCallback = vi.fn().mockResolvedValue({
			characterId: 'char-1',
			characterName: 'Temp Pilot',
		})
		const hrStub = {
			isCharacterBlacklisted: vi.fn().mockResolvedValue(false),
			getBlacklistsForCharacter: vi.fn().mockResolvedValue([]),
			isCharacterNameBlacklisted: vi.fn().mockResolvedValue(false),
			getBlacklistsForCharacterName: vi.fn().mockResolvedValue([]),
		}

		// The route uses service bindings, not direct objects. Match by the binding
		// values we provide in the request env.
		const env = {
			DATABASE_URL: 'postgres://test',
			EVE_TOKEN_STORE: {},
			HR: {},
		} as any

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_TOKEN_STORE) return { verifyPublicDataCallback } as any
			if (binding === env.HR) return hrStub as any
			throw new Error('unexpected stub binding')
		})

		provisionTempopGuestMock.mockResolvedValue({
			loginName: 'Temp_Pilot',
			password: 'one-time-password',
			connection: {
				host: 'voice.test',
				port: 64738,
			},
		})
		storeCredentialHandoffMock.mockResolvedValue('handoff-1')

		const app = createApp()
		const res = await app.request('/api/auth/callback?code=code-1&state=state-1', {}, env)

		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('application/json')
		expect(res.headers.get('location')).toBeNull()

		await expect(res.json()).resolves.toEqual({
			success: true,
			redirectUrl: '/tempop/temp-key?provisioned=1&h=handoff-1',
		})
		expect(provisionTempopGuestMock).toHaveBeenCalledWith(env, {
			tempopId: 'tempop-1',
			characterId: 'char-1',
		})
		expect(storeCredentialHandoffMock).toHaveBeenCalledWith(env, 'tempop-1', {
			loginName: 'Temp_Pilot',
			password: 'one-time-password',
			host: 'voice.test',
			port: 64738,
		})
		expect(deleteWhereMock).toHaveBeenCalled()
	})
})
