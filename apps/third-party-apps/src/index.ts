import { WorkerEntrypoint } from 'cloudflare:workers'

import { OAuthProvider } from '@cloudflare/workers-oauth-provider'
import { getStub } from '@repo/do-utils'
import type {
	CoreWorker,
	OAuthAuthorizationAction,
	OAuthAuthorizationPreview,
	OAuthAuthorizationResult,
	OAuthClientCreateInput,
	OAuthClientListOptions,
	OAuthClientListResult,
	OAuthClientSecretResult,
	OAuthClientSummary,
	OAuthSessionUser,
	OAuthClientUpdateInput,
	ThirdPartyAppsAdminWorker,
	ThirdPartyAppScope,
} from '@repo/admin'
import { THIRD_PARTY_APP_SUPPORTED_SCOPES } from '@repo/admin'

import {
	extractCharacterIdFromEsiPath,
	hasScope,
	isAllowedWritePath,
	isReadMethod,
	normalizeEsiProxyPath,
	requiredScopeForEsiRequest,
} from './proxy-policy'
import { proxyEsiRequest } from './esi-proxy'
import type { Groups } from '@repo/groups'
import type { EveTokenStoreClient, Env } from './context'

type OAuthGrantProps = {
	sub: string
	scope: ThirdPartyAppScope[]
	clientId: string
}

type OAuthClientMetadata = {
	scopes: ThirdPartyAppScope[]
}

const CLIENT_METADATA_PREFIX = 'oauth-client-meta:'
const SUPPORTED_SCOPE_SET = new Set<string>(THIRD_PARTY_APP_SUPPORTED_SCOPES)

function clientMetadataKey(clientId: string): string {
	return `${CLIENT_METADATA_PREFIX}${clientId}`
}

function normalizeScopes(scopes: string[] | undefined): ThirdPartyAppScope[] {
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

async function getClientMetadata(env: Env, clientId: string): Promise<OAuthClientMetadata> {
	const stored = await env.OAUTH_KV.get<OAuthClientMetadata>(clientMetadataKey(clientId), 'json')
	return {
		scopes: stored?.scopes ? normalizeScopes(stored.scopes) : [],
	}
}

async function setClientMetadata(
	env: Env,
	clientId: string,
	metadata: OAuthClientMetadata
): Promise<void> {
	await env.OAUTH_KV.put(clientMetadataKey(clientId), JSON.stringify({
		scopes: normalizeScopes(metadata.scopes),
	}))
}

async function deleteClientMetadata(env: Env, clientId: string): Promise<void> {
	await env.OAUTH_KV.delete(clientMetadataKey(clientId))
}

function requestedScopesAreAllowed(
	requestedScopes: string[],
	allowedScopes: ThirdPartyAppScope[]
): requestedScopes is ThirdPartyAppScope[] {
	const allowed = new Set(allowedScopes)
	return requestedScopes.every((scope) => allowed.has(scope as ThirdPartyAppScope))
}

function isLocalDev(env: Env): boolean {
	return env.ENVIRONMENT === 'development'
}

function isAllowedLocalHttpUrl(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname.endsWith('.localhost'))
	)
}

function validateAuthorizeRequestUrl(
	env: Env,
	requestUrl: string,
	expectedOrigin: string
): URL | null {
	try {
		const parsed = new URL(requestUrl)
		if (parsed.pathname !== '/authorize') return null
		if (isLocalDev(env) && isAllowedLocalHttpUrl(parsed)) return parsed
		if (parsed.protocol === 'https:' && parsed.origin === expectedOrigin) return parsed
		return null
	} catch {
		return null
	}
}

function buildProps(
	user: OAuthSessionUser,
	scope: ThirdPartyAppScope[],
	clientId: string
): OAuthGrantProps {
	return {
		sub: user.id,
		scope,
		clientId,
	}
}

async function mapClientSummary(
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

function buildDeniedRedirect(redirectUri: string, state?: string | null): string {
	const redirect = new URL(redirectUri)
	redirect.searchParams.set('error', 'access_denied')
	if (state) redirect.searchParams.set('state', state)
	return redirect.toString()
}

async function parseAuthRequest(env: Env, requestUrl: string, expectedOrigin: string) {
	const validatedUrl = validateAuthorizeRequestUrl(env, requestUrl, expectedOrigin)
	if (!validatedUrl) {
		return null
	}

	const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(validatedUrl))
	if (!authRequest.clientId || !authRequest.scope || authRequest.scope.length === 0) {
		return null
	}

	const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId)
	if (!client) {
		return null
	}

	const metadata = await getClientMetadata(env, authRequest.clientId)
	if (!requestedScopesAreAllowed(authRequest.scope, metadata.scopes)) {
		return null
	}

	return { authRequest, client, metadata }
}

async function tokenScopesAreStillAllowed(
	env: Env,
	props: OAuthGrantProps
): Promise<boolean> {
	const client = await env.OAUTH_PROVIDER.lookupClient(props.clientId)
	if (!client) {
		return false
	}
	const metadata = await getClientMetadata(env, props.clientId)
	return requestedScopesAreAllowed(props.scope, metadata.scopes)
}

async function buildOAuthApiMeResponse(
	env: Env,
	props: OAuthGrantProps
): Promise<Record<string, unknown>> {
	const response: Record<string, unknown> = {
		sub: props.sub,
		clientId: props.clientId,
		scope: props.scope,
	}

	const includeProfile = hasScope(props.scope, 'profile')
	const includeGroups = hasScope(props.scope, 'groups')
	const includePermissions = hasScope(props.scope, 'permissions')
	if (!includeProfile && !includeGroups && !includePermissions) {
		return response
	}

	const core = env.CORE as CoreWorker
	const details = await core.getUserDetails(props.sub)
	if (!details) {
		return response
	}

	if (includeProfile) {
		response.mainCharacterId = details.mainCharacterId
		response.isAdmin = details.is_admin
		response.characters = details.characters.map((character) => ({
			characterId: character.characterId,
			characterName: character.characterName,
			isPrimary: character.is_primary,
			hasValidToken: character.hasValidToken,
		}))
	}

	if (includeGroups) {
		response.groupMemberships = details.groupMemberships.map((membership) => ({
			groupId: membership.groupId,
			groupName: membership.groupName,
			membershipLevel: membership.membershipLevel,
			joinedAt: membership.joinedAt.toISOString(),
		}))
	}

	if (includePermissions) {
		const groups = getStub<Groups>(env.GROUPS, 'default')
		const permissions = await groups.getUserPermissions(props.sub)
		response.permissionUrns = permissions.map((permission) => permission.urn)
	}

	return response
}

class OAuthApiHandler extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		const props = (this.ctx.props ?? {}) as Partial<OAuthGrantProps>

		if (url.pathname === '/oauth/api/me') {
			if (!props.sub || !props.clientId || !props.scope) {
				return Response.json({ error: 'unauthorized', message: 'Missing token grant context' }, { status: 401 })
			}
			const grantProps = props as OAuthGrantProps
			if (!(await tokenScopesAreStillAllowed(this.env, grantProps))) {
				return Response.json({ error: 'forbidden', message: 'Token scope is no longer allowed for this client' }, { status: 403 })
			}
			return Response.json(await buildOAuthApiMeResponse(this.env, grantProps))
		}

		if (url.pathname.startsWith('/oauth/api/esi-proxy/')) {
			const esiProxyPath = url.pathname.slice('/oauth/api/esi-proxy'.length)
			if (!esiProxyPath || esiProxyPath === '/') {
				return Response.json({ error: 'invalid_request', message: 'Missing ESI path' }, { status: 400 })
			}
			if (!props.sub || !props.clientId || !props.scope) {
				return Response.json({ error: 'unauthorized', message: 'Missing token grant context' }, { status: 401 })
			}
			const grantProps = props as OAuthGrantProps
			if (!(await tokenScopesAreStillAllowed(this.env, grantProps))) {
				return Response.json({ error: 'forbidden', message: 'Token scope is no longer allowed for this client' }, { status: 403 })
			}
			const method = request.method.toUpperCase()
			const pathWithVersionPrefix = normalizeEsiProxyPath(esiProxyPath)
			const requiredScope = requiredScopeForEsiRequest(method, pathWithVersionPrefix)
			if (!requiredScope) {
				return Response.json(
					{
						error: 'forbidden',
						message: 'No third-party scope allows this ESI path',
					},
					{ status: 403 }
				)
			}
			if (!hasScope(props.scope, requiredScope)) {
				return Response.json(
					{
						error: 'forbidden',
						message: `Missing required scope: ${requiredScope}`,
					},
					{ status: 403 }
				)
			}

			const core = this.env.CORE as CoreWorker
			const linkedCharacterIds = new Set(await core.getUserCharacterIds(grantProps.sub))
			if (linkedCharacterIds.size === 0) {
				return Response.json({ error: 'forbidden', message: 'No linked characters available' }, { status: 403 })
			}

			let explicitCharacterId = url.searchParams.get('character_id') ?? request.headers.get('x-eve-character-id')
			if (!explicitCharacterId) {
				const details = await core.getUserDetails(grantProps.sub)
				explicitCharacterId = details?.mainCharacterId ?? null
			}
			if (!explicitCharacterId || !linkedCharacterIds.has(explicitCharacterId)) {
				return Response.json(
					{
						error: 'forbidden',
						message: 'Requested character is not linked to this account',
					},
					{ status: 403 }
				)
			}

			const pathCharacterId = extractCharacterIdFromEsiPath(pathWithVersionPrefix)
			if (pathCharacterId && pathCharacterId !== explicitCharacterId) {
				return Response.json(
					{
						error: 'forbidden',
						message:
							'Character-scoped ESI path does not match the selected linked character context',
					},
					{ status: 403 }
				)
			}
			if (!isReadMethod(method) && !isAllowedWritePath(method, pathWithVersionPrefix)) {
				return Response.json(
					{
						error: 'forbidden',
						message: 'Write endpoint is not in the allowlist',
					},
					{ status: 403 }
				)
			}

			const tokenStore = getStub<EveTokenStoreClient>(this.env.EVE_TOKEN_STORE, 'default')
			const accessToken = await tokenStore.getAccessToken(explicitCharacterId)
			if (!accessToken) {
				return Response.json(
					{
						error: 'unauthorized',
						message: 'No valid ESI token for selected character',
					},
					{ status: 401 }
				)
			}

			const query = new URLSearchParams(url.searchParams)
			query.delete('character_id')
			const upstreamRequestPath = `${pathWithVersionPrefix}${query.toString() ? `?${query.toString()}` : ''}`

			return proxyEsiRequest({
				env: this.env,
				request,
				path: upstreamRequestPath,
				clientId: grantProps.clientId,
				characterId: explicitCharacterId,
				accessToken,
				cacheScope: { scope: 'character', scopeId: explicitCharacterId },
			})
		}

		return new Response('Not found', { status: 404 })
	}
}

class ThirdPartyAppsWorkerEntrypoint extends WorkerEntrypoint<Env> implements ThirdPartyAppsAdminWorker {
	async listClients(options?: OAuthClientListOptions): Promise<OAuthClientListResult> {
		const result = await this.env.OAUTH_PROVIDER.listClients({
			limit: options?.limit,
			cursor: options?.cursor,
		})
		return {
			items: await Promise.all(result.items.map((client) => mapClientSummary(this.env, client))),
			cursor: result.cursor,
		}
	}

	async createClient(input: OAuthClientCreateInput): Promise<OAuthClientSummary> {
		const scopes = normalizeScopes(input.scopes)
		const { scopes: _scopes, ...clientInput } = input
		const created = await this.env.OAUTH_PROVIDER.createClient(clientInput)
		await setClientMetadata(this.env, created.clientId, { scopes })
		return mapClientSummary(this.env, created, { includeClientSecret: true })
	}

	async updateClient(
		clientId: string,
		input: OAuthClientUpdateInput
	): Promise<OAuthClientSummary | null> {
		const { scopes, ...clientInput } = input
		const normalizedScopes = scopes ? normalizeScopes(scopes) : null
		const updated = await this.env.OAUTH_PROVIDER.updateClient(clientId, clientInput)
		if (!updated) return null
		if (normalizedScopes) {
			await setClientMetadata(this.env, clientId, { scopes: normalizedScopes })
		}
		return mapClientSummary(this.env, updated)
	}

	async deleteClient(clientId: string): Promise<void> {
		await this.env.OAUTH_PROVIDER.deleteClient(clientId)
		await deleteClientMetadata(this.env, clientId)
	}

	async regenerateClientSecret(clientId: string): Promise<OAuthClientSecretResult | null> {
		const nextSecret = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().slice(0, 8)
		const updated = await this.env.OAUTH_PROVIDER.updateClient(clientId, {
			clientSecret: nextSecret,
			tokenEndpointAuthMethod: 'client_secret_basic',
		})
		if (!updated) return null
		return {
			clientId: updated.clientId,
			clientSecret: nextSecret,
		}
	}

	async previewAuthorization(
		requestUrl: string,
		expectedOrigin: string
	): Promise<OAuthAuthorizationPreview | null> {
		const parsed = await parseAuthRequest(this.env, requestUrl, expectedOrigin)
		if (!parsed) return null

		return {
			clientId: parsed.authRequest.clientId,
			clientName: parsed.client.clientName ?? null,
			scope: parsed.authRequest.scope,
			state: parsed.authRequest.state ?? null,
		}
	}

	async resolveAuthorization(
		requestUrl: string,
		expectedOrigin: string,
		user: OAuthSessionUser,
		action: OAuthAuthorizationAction
	): Promise<OAuthAuthorizationResult | null> {
		const parsed = await parseAuthRequest(this.env, requestUrl, expectedOrigin)
		if (!parsed || !parsed.authRequest.redirectUri) return null

		if (action === 'deny') {
			return {
				redirectTo: buildDeniedRedirect(parsed.authRequest.redirectUri, parsed.authRequest.state),
			}
		}

		const scopes = parsed.authRequest.scope as ThirdPartyAppScope[]
		const props = buildProps(user, scopes, parsed.authRequest.clientId)
		const { redirectTo } = await this.env.OAUTH_PROVIDER.completeAuthorization({
			request: parsed.authRequest,
			userId: user.id,
			metadata: { label: parsed.authRequest.clientId },
			scope: scopes,
			props,
		})

		return { redirectTo }
	}

	override async fetch(): Promise<Response> {
		return new Response('Third-Party Apps RPC only, not accessible via HTTP', {
			status: 404,
			headers: { 'Content-Type': 'text/plain' },
		})
	}
}

const oauthProvider = new OAuthProvider({
	apiRoute: '/oauth/api/',
	apiHandler: OAuthApiHandler,
	defaultHandler: {
		fetch: async () => new Response('Not found', { status: 404 }),
	},
	authorizeEndpoint: '/authorize',
	tokenEndpoint: '/oauth/token',
	scopesSupported: [...THIRD_PARTY_APP_SUPPORTED_SCOPES],
	allowImplicitFlow: false,
	disallowPublicClientRegistration: true,
})

export { ThirdPartyAppsWorkerEntrypoint }
export { ThirdPartyAppQuota } from './quota'

export default oauthProvider
