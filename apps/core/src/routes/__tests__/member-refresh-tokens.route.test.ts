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

describe('member refresh token export route', () => {
	let db: ReturnType<typeof makeDatabase>
	let failCorporationData = false
	const tokenStore = {
		getRefreshTokensForIntegration: vi.fn(),
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

	it('selects directors first and caps each corporation at fifteen tokens', async () => {
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
		tokenStore.getRefreshTokensForIntegration.mockImplementation(async (characterIds: string[]) =>
			characterIds.map((characterId) => ({ characterId, refreshToken: `refresh-${characterId}` }))
		)

		const response = await createApp().request(
			'/api/internal/member-refresh-tokens',
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
		expect(body.corporations[0].tokens).toHaveLength(15)
		expect(body.corporations[0].tokens.slice(0, 2).map((token: any) => token.role)).toEqual([
			'director',
			'director',
		])
		expect(body.corporations[0].tokens.every((token: any) => token.refreshToken)).toBe(true)
		expect(tokenStore.getRefreshTokensForIntegration).toHaveBeenCalledTimes(2)
		const firstLookup = tokenStore.getRefreshTokensForIntegration.mock.calls[0][0] as string[]
		expect(firstLookup.slice(0, 2)).toEqual(['1010', '1011'])
		expect(new Set(firstLookup)).toEqual(
			new Set(characters.map((character) => character.characterId))
		)
	})

	it('randomizes ordinary member ordering while retaining director priority', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
		])
		db.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '1000', characterName: 'Member 1', userId: 'user-1', hasValidToken: true },
			{ characterId: '1001', characterName: 'Member 2', userId: 'user-2', hasValidToken: true },
			{ characterId: '1002', characterName: 'Member 3', userId: 'user-3', hasValidToken: true },
		])
		tokenStore.getRefreshTokensForIntegration.mockImplementation(async (characterIds: string[]) =>
			characterIds.map((characterId) => ({ characterId, refreshToken: `refresh-${characterId}` }))
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

	it('excludes unknown-token characters and unhealthy directors', async () => {
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
		tokenStore.getRefreshTokensForIntegration.mockImplementation(async (characterIds: string[]) =>
			characterIds.map((characterId) => ({ characterId, refreshToken: `refresh-${characterId}` }))
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
		expect(body.corporations[0].tokens).toMatchObject([{ characterId: '1000', role: 'member' }])
		expect(tokenStore.getRefreshTokensForIntegration).toHaveBeenCalledWith(['1000'])
	})

	it('deduplicates token rows and does not expose internal errors', async () => {
		db.query.managedCorporations.findMany.mockResolvedValue([
			{ corporationId: '100', name: 'Member Corp' },
		])
		db.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: '1000', characterName: 'Character', userId: 'user-1', hasValidToken: true },
		])
		tokenStore.getRefreshTokensForIntegration.mockResolvedValue([
			{ characterId: '1000', refreshToken: 'refresh-first' },
			{ characterId: '1000', refreshToken: 'refresh-second' },
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
		expect(['refresh-first', 'refresh-second']).toContain(
			body.corporations[0].tokens[0].refreshToken
		)

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
		expect(failedBody.errors[0].error).toBe(
			'Unable to retrieve refresh tokens for this corporation'
		)
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
