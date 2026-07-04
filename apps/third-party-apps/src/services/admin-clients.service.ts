import type {
	OAuthClientCreateInput,
	OAuthClientListOptions,
	OAuthClientListResult,
	OAuthClientSecretResult,
	OAuthClientSummary,
	OAuthClientUpdateInput,
} from '@repo/admin'

import { deleteClientMetadata, mapClientSummary, normalizeScopes, setClientMetadata } from '../oauth-contract'
import type { Env } from '../context'

type StoredClientRecord = {
	clientId: string
	clientSecret?: string
	clientName?: string
	redirectUris: string[]
	tokenEndpointAuthMethod: string
	grantTypes?: string[]
	responseTypes?: string[]
	registrationDate?: number
}

const CLIENT_KEY_PREFIX = 'client:'

function generateRandomString(length: number): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
	let result = ''
	const values = new Uint8Array(length)
	crypto.getRandomValues(values)
	for (let index = 0; index < length; index++) {
		result += characters.charAt(values[index] % characters.length)
	}
	return result
}

async function hashSecret(secret: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(secret)
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function generateClientSecret(): Promise<{ rawSecret: string; hashedSecret: string }> {
	const rawSecret = generateRandomString(32)
	return {
		rawSecret,
		hashedSecret: await hashSecret(rawSecret),
	}
}

async function getClient(env: Env, clientId: string): Promise<StoredClientRecord | null> {
	return await env.OAUTH_KV.get<StoredClientRecord>(`${CLIENT_KEY_PREFIX}${clientId}`, 'json')
}

async function putClient(env: Env, client: StoredClientRecord): Promise<void> {
	await env.OAUTH_KV.put(`${CLIENT_KEY_PREFIX}${client.clientId}`, JSON.stringify(client))
}

export async function listOAuthClients(
	env: Env,
	options?: OAuthClientListOptions
): Promise<OAuthClientListResult> {
	const listOptions: { prefix: string; limit?: number; cursor?: string } = {
		prefix: CLIENT_KEY_PREFIX,
	}
	if (options?.limit !== undefined) {
		listOptions.limit = options.limit
	}
	if (options?.cursor !== undefined) {
		listOptions.cursor = options.cursor
	}

	const response = await env.OAUTH_KV.list(listOptions)
	const clients = await Promise.all(
		response.keys.map(async (key) => {
			const clientId = key.name.slice(CLIENT_KEY_PREFIX.length)
			const client = await getClient(env, clientId)
			return client ? await mapClientSummary(env, client) : null
		})
	)

	return {
		items: clients.filter((client): client is OAuthClientSummary => client !== null),
		cursor: response.list_complete ? undefined : response.cursor,
	}
}

export async function createOAuthClient(
	env: Env,
	input: OAuthClientCreateInput
): Promise<OAuthClientSummary> {
	const clientId = generateRandomString(16)
	const tokenEndpointAuthMethod = input.tokenEndpointAuthMethod || 'client_secret_basic'
	const isPublicClient = tokenEndpointAuthMethod === 'none'
	const secret = isPublicClient ? null : await generateClientSecret()
	const storedClient: StoredClientRecord = {
		clientId,
		clientName: input.clientName,
		redirectUris: input.redirectUris,
		tokenEndpointAuthMethod,
		grantTypes: input.grantTypes ?? ['authorization_code', 'refresh_token'],
		responseTypes: input.responseTypes ?? ['code'],
		registrationDate: Math.floor(Date.now() / 1e3),
	}
	if (secret) {
		storedClient.clientSecret = secret.hashedSecret
	}
	await putClient(env, storedClient)
	await setClientMetadata(env, clientId, { scopes: normalizeScopes(input.scopes) })

	const summary = await mapClientSummary(env, storedClient)
	return secret ? { ...summary, clientSecret: secret.rawSecret } : summary
}

export async function updateOAuthClient(
	env: Env,
	clientId: string,
	input: OAuthClientUpdateInput
): Promise<OAuthClientSummary | null> {
	const existing = await getClient(env, clientId)
	if (!existing) {
		return null
	}

	const nextAuthMethod = input.tokenEndpointAuthMethod || existing.tokenEndpointAuthMethod || 'client_secret_basic'
	const isPublicClient = nextAuthMethod === 'none'
	let nextSecret = existing.clientSecret
	let rawClientSecret: string | undefined

	if (isPublicClient) {
		nextSecret = undefined
	} else if (!nextSecret) {
		const secret = await generateClientSecret()
		rawClientSecret = secret.rawSecret
		nextSecret = secret.hashedSecret
	}

	const updatedClient: StoredClientRecord = {
		...existing,
		...input,
		clientId: existing.clientId,
		tokenEndpointAuthMethod: nextAuthMethod,
	}
	if (nextSecret) {
		updatedClient.clientSecret = nextSecret
	} else {
		delete updatedClient.clientSecret
	}
	await putClient(env, updatedClient)

	if (input.scopes) {
		await setClientMetadata(env, clientId, { scopes: normalizeScopes(input.scopes) })
	}

	const summary = await mapClientSummary(env, updatedClient)
	return rawClientSecret ? { ...summary, clientSecret: rawClientSecret } : summary
}

export async function deleteOAuthClient(env: Env, clientId: string): Promise<void> {
	await env.OAUTH_KV.delete(`${CLIENT_KEY_PREFIX}${clientId}`)
	await deleteClientMetadata(env, clientId)
}

export async function regenerateOAuthClientSecret(
	env: Env,
	clientId: string
): Promise<OAuthClientSecretResult | null> {
	const existing = await getClient(env, clientId)
	if (!existing) {
		return null
	}

	const nextSecret = await generateClientSecret()
	const updatedClient: StoredClientRecord = {
		...existing,
		tokenEndpointAuthMethod: 'client_secret_basic',
		clientSecret: nextSecret.hashedSecret,
	}
	await putClient(env, updatedClient)
	return {
		clientId,
		clientSecret: nextSecret.rawSecret,
	}
}
