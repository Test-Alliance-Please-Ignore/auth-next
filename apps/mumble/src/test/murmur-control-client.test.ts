import { afterEach, describe, expect, it, vi } from 'vitest'

import { MurmurControlApiError, MurmurControlClient } from '../murmur-control/client'

const ACCOUNT_SNAPSHOT = {
	subjectId: 'user-1',
	loginName: 'pilot_one',
	displayName: 'Pilot One',
	enabled: true,
	groups: ['alpha'],
	comment: null,
	hasPassword: true,
	lastCertificateHash: null,
	lastAuthenticatedAt: null,
	lastClientRelease: null,
	lastClientVersion: null,
}

describe('MurmurControlClient', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('shapes batchSync requests correctly', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ serverId: 'srv', updated: [ACCOUNT_SNAPSHOT] }), {
				status: 200,
			})
		)
		const client = new MurmurControlClient({
			baseUrl: 'https://murmur.test/',
			token: 'secret-token',
			fetcher: { fetch: fetchMock },
		})

		const account = {
			subjectId: 'user-1',
			loginName: 'pilot_one',
			displayName: 'Pilot One',
			enabled: true,
			groups: ['alpha'],
		}
		const result = await client.batchSync('srv', [account])

		expect(fetchMock).toHaveBeenCalledWith(
			'https://murmur.test/v1/servers/srv/local-accounts:batchSync',
			expect.objectContaining({
				method: 'PUT',
				headers: expect.objectContaining({
					Authorization: 'Bearer secret-token',
					'Content-Type': 'application/json',
				}),
				body: JSON.stringify({ accounts: [account] }),
			})
		)
		expect(result.updated[0]?.subjectId).toBe('user-1')
	})

	it('shapes group assignment requests with reason', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ serverId: 'srv', disconnectedSessions: 0, updated: [ACCOUNT_SNAPSHOT] }),
					{ status: 200 }
				)
			)
		const client = new MurmurControlClient({
			baseUrl: 'https://murmur.test/',
			token: 'secret-token',
			fetcher: { fetch: fetchMock },
		})

		await client.assignGroups('srv', [{ subjectId: 'user-1', groups: ['alpha'] }], 'sync')

		expect(fetchMock).toHaveBeenCalledWith(
			'https://murmur.test/v1/servers/srv/local-accounts:groups',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					assignments: [{ subjectId: 'user-1', groups: ['alpha'] }],
					reason: 'sync',
				}),
			})
		)
	})

	it('returns null for a missing local account', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: 'Local account not found', details: null }), {
				status: 404,
			})
		)
		const client = new MurmurControlClient({
			baseUrl: 'https://murmur.test/',
			token: 'secret-token',
			fetcher: { fetch: fetchMock },
		})

		const result = await client.getLocalAccount('srv', 'missing-user')
		expect(result).toBeNull()
	})

	it('maps statuses to typed error codes', async () => {
		const cases: Array<[number, string]> = [
			[400, 'validation'],
			[401, 'unauthorized'],
			[500, 'unavailable'],
			[501, 'unavailable'],
		]

		for (const [status, code] of cases) {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify({ error: 'boom', details: null }), { status })
				)
			const client = new MurmurControlClient({
				baseUrl: 'https://murmur.test/',
				token: 'secret-token',
				fetcher: { fetch: fetchMock },
			})

			const error = await client
				.getUserState('srv')
				.then(
					() => null,
					(e: unknown) => e
				)
			expect(error).toBeInstanceOf(MurmurControlApiError)
			expect((error as MurmurControlApiError).code).toBe(code)
			expect((error as MurmurControlApiError).message).toBe('boom')
		}
	})

	it('builds user-state filter query params', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ serverId: 'srv', users: [] }), { status: 200 })
			)
		const client = new MurmurControlClient({
			baseUrl: 'https://murmur.test/',
			token: 'secret-token',
			fetcher: { fetch: fetchMock },
		})

		await client.getUserState('srv', { loginName: 'pilot_one' })

		expect(fetchMock).toHaveBeenCalledWith(
			'https://murmur.test/v1/servers/srv/state/users?loginName=pilot_one',
			expect.anything()
		)
	})

	it('omits the authorization header when no token is configured', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ serverId: 'srv', users: [] }), { status: 200 })
		)
		const client = new MurmurControlClient({
			baseUrl: 'https://murmur.test/',
			fetcher: { fetch: fetchMock },
		})

		await client.getUserState('srv')

		const init = fetchMock.mock.calls[0]?.[1]
		expect(fetchMock).toHaveBeenCalledWith('https://murmur.test/v1/servers/srv/state/users', init)
		expect(init?.headers).toBeDefined()
		expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined()
	})

	it('falls back to global fetch when no mTLS binding is configured', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ serverId: 'srv', users: [] }), { status: 200 })
		)
		vi.stubGlobal('fetch', fetchMock)

		const client = new MurmurControlClient({
			baseUrl: 'https://murmur.test/',
			token: 'secret-token',
		})

		await client.getUserState('srv')

		expect(fetchMock).toHaveBeenCalledWith(
			'https://murmur.test/v1/servers/srv/state/users',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer secret-token',
				}),
			})
		)
	})
})
