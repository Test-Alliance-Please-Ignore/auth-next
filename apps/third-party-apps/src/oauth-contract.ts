import { THIRD_PARTY_APP_SUPPORTED_SCOPES, type OAuthClientSummary, type ThirdPartyAppScope } from '@repo/admin'

import type { Env } from './context'

export type OAuthClientMetadata = {
	scopes: ThirdPartyAppScope[]
}

const CLIENT_METADATA_PREFIX = 'oauth-client-meta:'
const SUPPORTED_SCOPE_SET = new Set<string>(THIRD_PARTY_APP_SUPPORTED_SCOPES)

export const THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT = {
	apiRoute: '/oauth/api/',
	authorizeEndpoint: '/authorize',
	tokenEndpoint: '/oauth/token',
	allowImplicitFlow: false,
	disallowPublicClientRegistration: true,
	scopesSupported: THIRD_PARTY_APP_SUPPORTED_SCOPES,
} as const

export function clientMetadataKey(clientId: string): string {
	return `${CLIENT_METADATA_PREFIX}${clientId}`
}

export function normalizeScopes(scopes: string[] | undefined): ThirdPartyAppScope[] {
	const unique = [...new Set(scopes ?? [])].filter(Boolean)
	if (unique.length === 0) {
		throw new Error('At least one OAuth scope is required')
	}
	const unsupported = unique.filter((scope) => !SUPPORTED_SCOPE_SET.has(scope))
	if (unsupported.length > 0) {
		throw new Error(`Unsupported OAuth scope(s): ${unsupported.join(', ')}`)
	}
	return unique as ThirdPartyAppScope[]
}

export async function getClientMetadata(env: Env, clientId: string): Promise<OAuthClientMetadata> {
	const stored = await env.OAUTH_KV.get<OAuthClientMetadata>(clientMetadataKey(clientId), 'json')
	return {
		scopes: stored?.scopes ? normalizeScopes(stored.scopes) : [],
	}
}

export async function setClientMetadata(
	env: Env,
	clientId: string,
	metadata: OAuthClientMetadata
): Promise<void> {
	await env.OAUTH_KV.put(
		clientMetadataKey(clientId),
		JSON.stringify({
			scopes: normalizeScopes(metadata.scopes),
		})
	)
}

export async function deleteClientMetadata(env: Env, clientId: string): Promise<void> {
	await env.OAUTH_KV.delete(clientMetadataKey(clientId))
}

export function requestedScopesAreAllowed(
	requestedScopes: string[],
	allowedScopes: ThirdPartyAppScope[]
): requestedScopes is ThirdPartyAppScope[] {
	const allowed = new Set(allowedScopes)
	return requestedScopes.every((scope) => allowed.has(scope as ThirdPartyAppScope))
}

export async function mapClientSummary(
	env: Env,
	client: {
		clientId: string
		clientSecret?: string
		clientName?: string
		redirectUris: string[]
		tokenEndpointAuthMethod: string
		grantTypes?: string[]
		responseTypes?: string[]
		registrationDate?: number
	},
	options?: { includeClientSecret?: boolean }
): Promise<OAuthClientSummary> {
	const createdAt = client.registrationDate ? new Date(client.registrationDate * 1000).toISOString() : undefined
	const metadata = await getClientMetadata(env, client.clientId)
	return {
		clientId: client.clientId,
		...(options?.includeClientSecret && client.clientSecret ? { clientSecret: client.clientSecret } : {}),
		clientName: client.clientName,
		redirectUris: client.redirectUris,
		scopes: metadata.scopes,
		tokenEndpointAuthMethod: client.tokenEndpointAuthMethod,
		grantTypes: client.grantTypes,
		responseTypes: client.responseTypes,
		createdAt,
		updatedAt: createdAt,
	}
}
