import { describe, expect, it, vi } from 'vitest'

import { listOAuthClients, updateOAuthClient } from './admin-clients.service'

function createKvMock() {
	const values = new Map<string, unknown>()
	return {
		get: vi.fn(async (key: string) => values.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			values.set(key, JSON.parse(value))
		}),
		delete: vi.fn(async (key: string) => {
			values.delete(key)
		}),
		list: vi.fn(async () => ({
			keys: [{ name: 'client:client-1' }, { name: 'client:client-2' }],
			list_complete: true,
			cursor: undefined,
		})),
		values,
	}
}

describe('admin clients service', () => {
	it('preserves the KV list order when summarizing clients', async () => {
		const kv = createKvMock()
		kv.get.mockImplementation(async (key: string) => {
			if (key === 'client:client-1') {
				return await new Promise((resolve) => {
					setTimeout(
						() =>
							resolve({
								clientId: 'client-1',
								clientName: 'Client One',
								redirectUris: ['https://example.app/callback'],
								tokenEndpointAuthMethod: 'client_secret_basic',
								grantTypes: ['authorization_code'],
								responseTypes: ['code'],
								registrationDate: 1710000000,
							}),
						20
					)
				})
			}
			if (key === 'client:client-2') {
				return await new Promise((resolve) => {
					setTimeout(
						() =>
							resolve({
								clientId: 'client-2',
								clientName: 'Client Two',
								redirectUris: ['https://example.app/callback'],
								tokenEndpointAuthMethod: 'client_secret_basic',
								grantTypes: ['authorization_code'],
								responseTypes: ['code'],
								registrationDate: 1710000001,
							}),
						5
					)
				})
			}
			if (key === 'oauth-client-meta:client-1' || key === 'oauth-client-meta:client-2') {
				return { scopes: ['profile'] }
			}
			return null
		})

		const env = {
			OAUTH_KV: kv,
		} as any

		const result = await listOAuthClients(env)

		expect(result.items.map((client) => client.clientId)).toEqual(['client-1', 'client-2'])
	})

	it('generates a new secret when a public client is updated to a confidential auth method', async () => {
		const kv = createKvMock()
		kv.get.mockImplementation(async (key: string) => {
			if (key === 'client:client-1') {
				return {
					clientId: 'client-1',
					clientName: 'Client One',
					redirectUris: ['https://example.app/callback'],
					tokenEndpointAuthMethod: 'none',
					grantTypes: ['authorization_code'],
					responseTypes: ['code'],
					registrationDate: 1710000000,
				}
			}
			if (key === 'oauth-client-meta:client-1') {
				return { scopes: ['profile'] }
			}
			return null
		})

		const env = {
			OAUTH_KV: kv,
		} as any

		const result = await updateOAuthClient(env, 'client-1', {
			tokenEndpointAuthMethod: 'client_secret_basic',
		})

		expect(result).not.toBeNull()
		expect(result?.clientSecret).toBeTypeOf('string')
		expect(result?.clientSecret).toHaveLength(32)

		const storedRecord = kv.values.get('client:client-1') as { clientSecret?: string; tokenEndpointAuthMethod?: string }
		expect(storedRecord.tokenEndpointAuthMethod).toBe('client_secret_basic')
		expect(storedRecord.clientSecret).toBeTypeOf('string')
		expect(storedRecord.clientSecret).toHaveLength(64)
	})
})
