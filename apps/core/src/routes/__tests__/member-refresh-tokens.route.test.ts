import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import memberRefreshTokenRoutes from '../member-refresh-tokens'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

const env = {
	DATABASE_URL: 'postgres://test',
	MEMBER_REFRESH_TOKEN_EXPORT_TOKEN: 'expected-token',
	EVE_TOKEN_STORE: { name: 'token-store' },
	EVE_CORPORATION_DATA: { name: 'corporation-data' },
} as any

function createApp() {
	const app = new Hono<{ Bindings: any }>()
	app.route('/api/internal/member-refresh-tokens', memberRefreshTokenRoutes)
	return app
}

function makeDatabase() {
	return {
		query: {
			managedCorporations: {
				findMany: vi.fn(),
			},
			userCharacters: {
				findMany: vi.fn(),
			},
		},
	}
}

describe('member access token export route', () => {
	let db: ReturnType<typeof makeDatabase>
	let failCorporationData = false
	const tokenStore = {
		getAccessTokensForIntegration: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		failCorporationData = false
		db = makeDatabase()
		createDbMock.mockReturnValue(db as any)
		getStubMock.mockImplementation((binding: unknown, name: string) => {
			if (binding === env.EVE_TOKEN_STORE) return tokenStore as any
			if (binding === env.EVE_CORPORATION_DATA) {
				return {
					getDirectors: vi.fn().mockImplementation(() =>
						failCorporationData
							? Promise.reject(new Error('SELECT refresh_token FROM secret_table'))
							: Promise.resolve(
									name === '100'
										? [
												{ characterId: '1010', isHealthy: true },
												{ characterId: '1011', isHealthy: true },
											]
										: []
								)
					),
					getCorporationIdsByCharacterIds: vi
						.fn()
						.mockImplementation(async (characterIds: string[]) =>
							Object.fromEntries(characterIds.map((characterId) => [characterId, name]))
						),
				} as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('rejects requests without the shared bearer token', async () => {
		const response = await createApp().request(
			'/api/internal/member-refresh-tokens',
			{ method: 'GET' },
			env
		)

		expect(response.status).toBe(401)
		expect(await response.json()).toEqual({ error: 'Unauthorized' })
		expect(createDbMock).not.toHaveBeenCalled()
	})

	it('rejects requests when the integration secret is not configured', async () => {
		const response = await createApp().request(
			'/api/internal/member-refresh-tokens',
			{ method: 'GET' },
			{ ...env, MEMBER_REFRESH_TOKEN_EXPORT_TOKEN: undefined }
		)

		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({
			error: 'Member refresh token export is not configured',
		})
	})

	it('lists active member and special-purpose corporation IDs', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
			{ corporationId: '200', name: 'Special Corp' },
		])

		const response = await createApp().request(
			'/api/internal/member-refresh-tokens/corporations',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		expect(await response.json()).toEqual({ corporationIds: ['100', '200'] })
	})

	it('randomly selects valid tokens and honors the requested per-corporation count', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
			{ corporationId: '200', name: 'Special Corp' },
		])
		const characters = Array.from({ length: 17 }, (_, index) => ({
			characterId: String(1000 + index),
			characterName: `Character ${index}`,
			userId: `user-${index}`,
			hasValidToken: true,
		}))
		db.query.userCharacters.findMany.mockResolvedValue(characters)
		tokenStore.getAccessTokensForIntegration.mockImplementation(async (characterIds: string[]) =>
			characterIds.map((characterId) => ({
				characterId,
				accessToken: `access-${characterId}`,
				expiresAt: '2026-09-01T00:00:00.000Z',
			}))
		)

		const response = await createApp().request(
			'/api/internal/member-refresh-tokens?count=3',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		expect(response.status).toBe(200)
		expect(response.headers.get('Cache-Control')).toBe('no-store')
		const body = (await response.json()) as any
		expect(body.corporations).toHaveLength(2)
		expect(body.corporations[0].tokens).toHaveLength(3)
		expect(body.corporations[0].tokens.every((token: any) => token.accessToken)).toBe(true)
		expect(body.corporations[0].tokens.every((token: any) => token.expiresAt)).toBe(true)
		expect(body.corporations[0].tokens.every((token: any) => !token.refreshToken)).toBe(true)
		expect(tokenStore.getAccessTokensForIntegration).toHaveBeenCalledTimes(2)
		expect(
			tokenStore.getAccessTokensForIntegration.mock.calls.every(
				([characterIds]) => (characterIds as string[]).length === 3
			)
		).toBe(true)
	})

	it('randomizes all candidates without director priority', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
		])
		db.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '1000', characterName: 'Member 1', userId: 'user-1', hasValidToken: true },
			{ characterId: '1001', characterName: 'Member 2', userId: 'user-2', hasValidToken: true },
			{ characterId: '1002', characterName: 'Member 3', userId: 'user-3', hasValidToken: true },
		])
		tokenStore.getAccessTokensForIntegration.mockImplementation(async (characterIds: string[]) =>
			characterIds.map((characterId) => ({
				characterId,
				accessToken: `access-${characterId}`,
				expiresAt: '2026-09-01T00:00:00.000Z',
			}))
		)

		type CryptoApi = {
			getRandomValues(array: ArrayBufferView): ArrayBufferView
		}
		const cryptoApi = (globalThis as unknown as { crypto: CryptoApi }).crypto
		const randomValues = vi.spyOn(cryptoApi, 'getRandomValues').mockImplementation((array) => {
			;(array as Uint32Array)[0] = 0
			return array
		})
		try {
			const response = await createApp().request(
				'/api/internal/member-refresh-tokens',
				{
					method: 'GET',
					headers: { Authorization: 'Bearer expected-token' },
				},
				env
			)

			const body = (await response.json()) as any
			expect(body.corporations[0].tokens.map((token: any) => token.characterId)).toEqual([
				'1001',
				'1002',
				'1000',
			])
			expect(randomValues).toHaveBeenCalledTimes(2)
		} finally {
			randomValues.mockRestore()
		}
	})

	it('continues with another candidate when access-token generation fails', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
		])
		db.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '1000', characterName: 'Member 1', userId: 'user-1', hasValidToken: true },
			{ characterId: '1001', characterName: 'Member 2', userId: 'user-2', hasValidToken: true },
			{ characterId: '1002', characterName: 'Member 3', userId: 'user-3', hasValidToken: true },
		])
		tokenStore.getAccessTokensForIntegration.mockResolvedValue([
			{ characterId: '1002', accessToken: 'access-1002', expiresAt: '2026-09-01T00:00:00.000Z' },
			{ characterId: '1000', accessToken: 'access-1000', expiresAt: '2026-09-01T00:00:00.000Z' },
		])

		const cryptoApi = (
			globalThis as unknown as {
				crypto: { getRandomValues: (array: ArrayBufferView) => ArrayBufferView }
			}
		).crypto
		const randomValues = vi.spyOn(cryptoApi, 'getRandomValues').mockImplementation((array) => {
			;(array as Uint32Array)[0] = 0
			return array
		})
		try {
			const response = await createApp().request(
				'/api/internal/member-refresh-tokens?count=2',
				{
					method: 'GET',
					headers: { Authorization: 'Bearer expected-token' },
				},
				env
			)

			const body = (await response.json()) as any
			expect(body.corporations[0].tokens.map((token: any) => token.characterId)).toEqual([
				'1002',
				'1000',
			])
			expect(tokenStore.getAccessTokensForIntegration).toHaveBeenNthCalledWith(1, ['1001', '1002'])
			expect(tokenStore.getAccessTokensForIntegration).toHaveBeenNthCalledWith(2, ['1000'])
		} finally {
			randomValues.mockRestore()
		}
	})

	it('excludes characters without a database-valid token', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
		])
		db.query.userCharacters.findMany.mockResolvedValue([
			{
				characterId: '1000',
				characterName: 'Healthy Member',
				userId: 'user-1',
				hasValidToken: true,
			},
			{
				characterId: '1001',
				characterName: 'Unknown Member',
				userId: 'user-2',
				hasValidToken: null,
			},
			{
				characterId: '1002',
				characterName: 'Invalid Member',
				userId: 'user-3',
				hasValidToken: false,
			},
		])
		tokenStore.getAccessTokensForIntegration.mockImplementation(async (characterIds: string[]) =>
			characterIds.map((characterId) => ({
				characterId,
				accessToken: `access-${characterId}`,
				expiresAt: '2026-09-01T00:00:00.000Z',
			}))
		)

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_TOKEN_STORE) return tokenStore as any
			if (binding === env.EVE_CORPORATION_DATA) {
				return {
					getDirectors: vi.fn().mockResolvedValue([{ characterId: '1000', isHealthy: false }]),
					getCorporationIdsByCharacterIds: vi
						.fn()
						.mockImplementation(async (characterIds: string[]) =>
							Object.fromEntries(characterIds.map((characterId) => [characterId, '100']))
						),
				} as any
			}
			throw new Error('Unexpected binding')
		})

		const response = await createApp().request(
			'/api/internal/member-refresh-tokens',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		const body = (await response.json()) as any
		expect(body.corporations[0].tokens).toMatchObject([{ characterId: '1000', role: 'director' }])
		expect(tokenStore.getAccessTokensForIntegration).toHaveBeenCalledWith(['1000'])
	})

	it('rejects a token count outside the supported range', async () => {
		const response = await createApp().request(
			'/api/internal/member-refresh-tokens?count=61',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'count must be an integer between 1 and 60',
		})
		expect(createDbMock).not.toHaveBeenCalled()
	})

	it('deduplicates token rows and does not expose internal errors', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
		])
		db.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '1000', characterName: 'Character', userId: 'user-1', hasValidToken: true },
		])
		tokenStore.getAccessTokensForIntegration.mockResolvedValue([
			{ characterId: '1000', accessToken: 'access-first', expiresAt: '2026-09-01T00:00:00.000Z' },
			{ characterId: '1000', accessToken: 'access-second', expiresAt: '2026-09-01T00:00:00.000Z' },
		])

		const response = await createApp().request(
			'/api/internal/member-refresh-tokens',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		const body = (await response.json()) as any
		expect(body.corporations[0].tokens).toHaveLength(1)
		expect(['access-first', 'access-second']).toContain(body.corporations[0].tokens[0].accessToken)

		failCorporationData = true
		const failedResponse = await createApp().request(
			'/api/internal/member-refresh-tokens',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)
		const failedBody = (await failedResponse.json()) as any
		expect(failedBody.errors[0].error).toBe('Unable to retrieve access tokens for this corporation')
		expect(JSON.stringify(failedBody)).not.toContain('SELECT refresh_token')
	})

	it('accepts a comma-separated corporation selection and rejects invalid IDs', async () => {
		const app = createApp()
		const response = await app.request(
			'/api/internal/member-refresh-tokens?corporationIds=100,not-an-id',
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: 'Corporation IDs must be numeric EVE IDs' })
		expect(db.query.managedCorporations.findMany).not.toHaveBeenCalled()
	})

	it('deduplicates corporation selections without imposing a corporation-count limit', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([])

		const corporationIds = Array.from({ length: 101 }, (_, index) => String(index + 1))
		const response = await createApp().request(
			`/api/internal/member-refresh-tokens?corporationIds=${corporationIds.join(',')},1,2`,
			{
				method: 'GET',
				headers: { Authorization: 'Bearer expected-token' },
			},
			env
		)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			requestedCorporationIds: corporationIds,
		})
	})
})
