import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

type CommandName =
	| 'discover'
	| 'auth'
	| 'token'
	| 'refresh'
	| 'me'
	| 'call'
	| 'scenario-profile'
	| 'scenario-esi-basic'
	| 'scenario-esi-forbidden-corporation-structures'
	| 'scenario-esi-forbidden-write-location'
type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'

interface ParsedArgs {
	_: string[]
	[key: string]: string | string[] | boolean | undefined
}

interface DiscoveryDocument {
	issuer?: string
	authorization_endpoint?: string
	token_endpoint?: string
}

interface HarnessConfig {
	command: CommandName
	issuer: string
	clientId: string
	clientSecret?: string
	clientAuthMethod: TokenEndpointAuthMethod
	redirectUri: string
	scopes: string[]
	state: string
	codeChallengeMethod: 'S256' | 'plain'
	timeoutMs: number
	code?: string
	codeVerifier?: string
	refreshToken?: string
	accessToken?: string
	path?: string
	method?: string
	body?: string
	json: boolean
	debug: boolean
}

interface CallbackResult {
	callbackUrl: string
	code?: string
	error?: string
	errorDescription?: string
	state?: string
}

interface TokenResponse {
	access_token?: string
	token_type?: string
	expires_in?: number
	refresh_token?: string
	scope?: string
	[key: string]: unknown
}

interface AuthorizedRequestResult {
	path: string
	method: string
	status: number
	payload: unknown
}

interface AuthorizationSessionResult {
	issuer: string
	discoveryUrl: string
	authorizationUrl: string
	redirectUri: string
	state: string
	callback: CallbackResult
	pkce: {
		codeVerifier: string
		codeChallenge: string
		codeChallengeMethod: 'S256' | 'plain'
	}
	tokenResponse: TokenResponse
}

interface OAuthProfileResponse {
	sub?: string
	clientId?: string
	scope?: string[]
	mainCharacterId?: string
	isAdmin?: boolean
	email?: string
	emailVerified?: boolean
	groupMemberships?: Array<{
		groupId: string
		groupName: string
		membershipLevel: string
		joinedAt: string
	}>
	characters?: Array<{
		characterId: string
		characterName: string
		isPrimary: boolean
		hasValidToken: boolean
	}>
}

interface EsiScenarioCharacterResult {
	characterId: string
	characterName: string
	wallet: number
	location: Record<string, unknown>
	online: Record<string, unknown>
}

function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = { _: [] }

	for (let index = 0; index < argv.length; index += 1) {
		const entry = argv[index]
		if (!entry.startsWith('--')) {
			result._.push(entry)
			continue
		}

		const raw = entry.slice(2)
		const separatorIndex = raw.indexOf('=')
		const key = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw
		const inlineValue = separatorIndex >= 0 ? raw.slice(separatorIndex + 1) : undefined

		let value: string | boolean = true
		if (inlineValue !== undefined) {
			value = inlineValue
		} else {
			const next = argv[index + 1]
			if (next !== undefined && !next.startsWith('--')) {
				value = next
				index += 1
			}
		}

		const existing = result[key]
		if (existing === undefined) {
			result[key] = value
			continue
		}
		if (Array.isArray(existing)) {
			existing.push(String(value))
			continue
		}
		result[key] = [String(existing), String(value)]
	}

	return result
}

function getStringArg(args: ParsedArgs, name: string): string | undefined {
	const value = args[name]
	if (typeof value === 'string') return value
	if (Array.isArray(value)) return value[0]
	return undefined
}

function getBooleanArg(args: ParsedArgs, name: string): boolean {
	return args[name] === true
}

function getManyArgs(args: ParsedArgs, name: string): string[] {
	const value = args[name]
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((entry) => entry.trim())
			.filter(Boolean)
	}
	if (Array.isArray(value)) {
		return value
			.flatMap((entry) =>
				entry
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean)
			)
			.filter(Boolean)
	}
	return []
}

function parseIntegerArg(value: string | undefined, fallback: number): number {
	if (!value) return fallback
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '[::1]' ||
		hostname.endsWith('.localhost')
	)
}

function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
	const codeVerifier = randomBytes(32).toString('base64url')
	const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
	return { codeVerifier, codeChallenge }
}

function buildDiscoveryUrl(issuer: string): string {
	const base = new URL(issuer)
	return new URL('/.well-known/oauth-authorization-server', base).toString()
}

async function fetchJson<T>(
	url: string,
	init?: RequestInit,
	debug = false,
	label?: string
): Promise<T> {
	const response = await fetch(url, init)
	const contentType = response.headers.get('content-type') ?? ''
	const isJson = contentType.includes('application/json') || contentType.includes('+json')
	const body = isJson ? ((await response.json()) as T) : ((await response.text()) as unknown as T)

	if (debug) {
		logDebugPayload(label ?? `fetch ${url}`, {
			url,
			status: response.status,
			contentType: contentType || null,
			payload: body,
		})
	}

	if (!response.ok) {
		const message =
			typeof body === 'string'
				? body
				: body && typeof body === 'object' && 'error' in body
					? String((body as { error?: unknown }).error ?? 'Request failed')
					: `Request failed with status ${response.status}`
		throw new Error(message)
	}

	return body
}

function logDebugPayload(label: string, value: unknown): void {
	console.error(`[oauth-harness][debug] ${label}`)
	console.error(formatJson(value).trimEnd())
}

function buildAuthorizeUrl(params: {
	authorizationEndpoint: string
	clientId: string
	redirectUri: string
	scope: string[]
	state: string
	codeChallenge: string
	codeChallengeMethod: 'S256' | 'plain'
}): string {
	const url = new URL(params.authorizationEndpoint)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('client_id', params.clientId)
	url.searchParams.set('redirect_uri', params.redirectUri)
	url.searchParams.set('scope', params.scope.join(' '))
	url.searchParams.set('state', params.state)
	url.searchParams.set('code_challenge', params.codeChallenge)
	url.searchParams.set('code_challenge_method', params.codeChallengeMethod)
	return url.toString()
}

function buildTokenRequestBody(params: {
	grantType: 'authorization_code' | 'refresh_token'
	clientId: string
	clientSecret?: string
	clientAuthMethod: TokenEndpointAuthMethod
	redirectUri?: string
	code?: string
	codeVerifier?: string
	refreshToken?: string
}): URLSearchParams {
	const body = new URLSearchParams()
	body.set('grant_type', params.grantType)
	body.set('client_id', params.clientId)

	if (params.clientAuthMethod === 'client_secret_post' && params.clientSecret) {
		body.set('client_secret', params.clientSecret)
	}

	if (params.grantType === 'authorization_code') {
		if (!params.code || !params.redirectUri || !params.codeVerifier) {
			throw new Error('Authorization code exchange requires code, redirectUri, and codeVerifier')
		}
		body.set('code', params.code)
		body.set('redirect_uri', params.redirectUri)
		body.set('code_verifier', params.codeVerifier)
	}

	if (params.grantType === 'refresh_token') {
		if (!params.refreshToken) {
			throw new Error('Refresh token exchange requires refreshToken')
		}
		body.set('refresh_token', params.refreshToken)
	}

	return body
}

async function exchangeToken(params: {
	tokenEndpoint: string
	grantType: 'authorization_code' | 'refresh_token'
	clientId: string
	clientSecret?: string
	clientAuthMethod: TokenEndpointAuthMethod
	redirectUri?: string
	code?: string
	codeVerifier?: string
	refreshToken?: string
	debug?: boolean
}): Promise<TokenResponse> {
	const body = buildTokenRequestBody(params)
	const headers: Record<string, string> = {
		'Content-Type': 'application/x-www-form-urlencoded',
	}

	if (params.clientAuthMethod === 'client_secret_basic' && params.clientSecret) {
		headers.Authorization = `Basic ${Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')}`
	}

	return fetchJson<TokenResponse>(
		params.tokenEndpoint,
		{
			method: 'POST',
			headers,
			body,
		},
		params.debug ?? false,
		'token response'
	)
}

async function performAuthorizationCodeFlow(config: HarnessConfig): Promise<AuthorizationSessionResult> {
	const discoveryUrl = buildDiscoveryUrl(config.issuer)
	const discovery = await fetchJson<DiscoveryDocument>(discoveryUrl, undefined, config.debug, 'discovery response')
	if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
		throw new Error('Discovery document is missing authorization or token endpoints')
	}

	const { codeVerifier, codeChallenge } = createPkcePair()
	const authorizationUrl = buildAuthorizeUrl({
		authorizationEndpoint: discovery.authorization_endpoint,
		clientId: config.clientId,
		redirectUri: config.redirectUri,
		scope: config.scopes,
		state: config.state,
		codeChallenge,
		codeChallengeMethod: config.codeChallengeMethod,
	})

	console.error(`[oauth-harness] discovery: ${discoveryUrl}`)
	console.error(`[oauth-harness] authorization: ${authorizationUrl}`)

	const callback = await waitForAuthorizationCallback({
		redirectUri: config.redirectUri,
		state: config.state,
		timeoutMs: config.timeoutMs,
	})

	if (callback.error) {
		throw new Error(
			`Authorization failed: ${callback.error}${callback.errorDescription ? ` - ${callback.errorDescription}` : ''}`
		)
	}

	const tokenResponse = await exchangeToken({
		tokenEndpoint: discovery.token_endpoint,
		grantType: 'authorization_code',
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		clientAuthMethod: config.clientAuthMethod,
		redirectUri: config.redirectUri,
		code: callback.code,
		codeVerifier,
		debug: config.debug,
	})

	return {
		issuer: config.issuer,
		discoveryUrl,
		authorizationUrl,
		redirectUri: config.redirectUri,
		state: config.state,
		callback,
		pkce: {
			codeVerifier,
			codeChallenge,
			codeChallengeMethod: config.codeChallengeMethod,
		},
		tokenResponse,
	}
}

async function fetchAuthorizedRequest(
	issuer: string,
	accessToken: string,
	path: string,
	method = 'GET',
	body?: string,
	debug = false
): Promise<AuthorizedRequestResult> {
	const response = await fetch(new URL(path, issuer), {
		method,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body,
	})

	const contentType = response.headers.get('content-type') ?? ''
	const payload = contentType.includes('application/json') || contentType.includes('+json')
		? await response.json()
		: await response.text()

	if (debug) {
		logDebugPayload(`authorized response ${method} ${path}`, {
			path,
			method,
			status: response.status,
			contentType: contentType || null,
			payload,
		})
	}

	return {
		path,
		method,
		status: response.status,
		payload,
	}
}

function appendQueryParam(path: string, key: string, value: string): string {
	const url = new URL(path, 'http://placeholder.local')
	url.searchParams.set(key, value)
	return `${url.pathname}${url.search}`
}

function formatJson(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`
}

function writeUsage(): void {
	console.error(`Usage:
  pnpm -F third-party-apps oauth:harness discover [--issuer URL]
  pnpm -F third-party-apps oauth:harness auth --client-id ID [--client-secret SECRET] [--client-auth-method METHOD] [--issuer URL] [--redirect-uri URL] [--scope SCOPE]...
  pnpm -F third-party-apps oauth:harness token --client-id ID --code CODE --code-verifier VERIFIER [--client-secret SECRET] [--client-auth-method METHOD] [--issuer URL] [--redirect-uri URL]
  pnpm -F third-party-apps oauth:harness refresh --client-id ID --refresh-token TOKEN [--client-secret SECRET] [--client-auth-method METHOD] [--issuer URL]
  pnpm -F third-party-apps oauth:harness me --access-token TOKEN [--issuer URL]
  pnpm -F third-party-apps oauth:harness call --access-token TOKEN --path /oauth/api/me [--method GET] [--body JSON] [--issuer URL]
  pnpm -F third-party-apps oauth:harness scenario-profile --client-id ID [--client-secret SECRET] [--issuer URL]
  pnpm -F third-party-apps oauth:harness scenario-esi-basic --client-id ID [--client-secret SECRET] [--issuer URL]
  pnpm -F third-party-apps oauth:harness scenario-esi-forbidden-corporation-structures --client-id ID [--client-secret SECRET] [--issuer URL]
  pnpm -F third-party-apps oauth:harness scenario-esi-forbidden-write-location --client-id ID [--client-secret SECRET] [--issuer URL]

Common flags:
  --issuer              Provider base URL (default: http://127.0.0.1:8787)
  --redirect-uri        Local loopback callback URL (default: http://127.0.0.1:9786/callback)
  --scope               Repeatable scope flag, or comma-separated scopes
  --client-auth-method  client_secret_basic | client_secret_post | none
  --json                Print machine-readable JSON on success
  --debug               Log discovery, token, and API payloads to stderr
  --timeout-ms          Callback wait timeout (default: 300000)
`)
}

async function waitForAuthorizationCallback(params: {
	redirectUri: string
	state: string
	timeoutMs: number
}): Promise<CallbackResult> {
	const redirectUrl = new URL(params.redirectUri)
	if (redirectUrl.protocol !== 'http:') {
		throw new Error('The harness only supports http:// redirect URIs for local callback capture')
	}
	if (!isLoopbackHostname(redirectUrl.hostname)) {
		throw new Error('The harness requires a loopback redirect URI hostname')
	}

	const port = Number(redirectUrl.port || '80')
	const pathname = redirectUrl.pathname || '/'
	const listenHost = redirectUrl.hostname.replace(/^\[(.*)\]$/, '$1')

	return await new Promise<CallbackResult>((resolve, reject) => {
		let settled = false
		const server = createServer((request, response) => {
			void handleCallbackRequest({
				request,
				response,
				pathname,
				state: params.state,
				redirectUri: params.redirectUri,
				settle: (result) => {
					if (settled) return
					settled = true
					resolve(result)
					server.close()
				},
			})
		})

		server.on('error', (error) => {
			if (settled) return
			settled = true
			reject(error)
		})

		server.listen(port, listenHost, () => {
			console.error(`[oauth-harness] listening on ${params.redirectUri}`)
		})

		void sleep(params.timeoutMs).then(() => {
			if (settled) return
			settled = true
			server.close()
			reject(new Error(`Timed out waiting for callback after ${params.timeoutMs}ms`))
		})
	})
}

async function handleCallbackRequest(params: {
	request: IncomingMessage
	response: ServerResponse
	pathname: string
	state: string
	redirectUri: string
	settle: (result: CallbackResult) => void
}): Promise<void> {
	const method = params.request.method?.toUpperCase() ?? 'GET'
	if (method !== 'GET') {
		params.response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
		params.response.end('Method Not Allowed')
		return
	}

	const requestUrl = new URL(params.request.url ?? '/', params.redirectUri)
	if (requestUrl.pathname !== params.pathname) {
		params.response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
		params.response.end('Not Found')
		return
	}

	const code = requestUrl.searchParams.get('code') ?? undefined
	const error = requestUrl.searchParams.get('error') ?? undefined
	const errorDescription = requestUrl.searchParams.get('error_description') ?? undefined
	const state = requestUrl.searchParams.get('state') ?? undefined

	params.response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
	params.response.end(
		`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>OAuth callback received</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111827; }
    code { background: #f3f4f6; padding: 0.2rem 0.35rem; border-radius: 0.25rem; }
  </style>
</head>
<body>
  <h1>OAuth callback received</h1>
  <p>You may close this window and return to the terminal.</p>
  <p>The harness has captured the callback for <code>${escapeHtml(params.redirectUri)}</code>.</p>
</body>
</html>`
	)

	if (error) {
		params.settle({
			callbackUrl: requestUrl.toString(),
			error,
			errorDescription,
			state,
		})
		return
	}

	if (!code) {
		params.settle({
			callbackUrl: requestUrl.toString(),
			error: 'missing_code',
			errorDescription: 'The callback did not include an authorization code',
			state,
		})
		return
	}

	if (state !== params.state) {
		params.settle({
			callbackUrl: requestUrl.toString(),
			error: 'invalid_state',
			errorDescription: 'The callback state did not match the outbound authorization request',
			state,
		})
		return
	}

	params.settle({
		callbackUrl: requestUrl.toString(),
		code,
		state,
	})
}

function escapeHtml(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function printResult(value: unknown, json: boolean): void {
	if (json) {
		process.stdout.write(formatJson(value))
		return
	}
	console.dir(value, { depth: null, colors: process.stdout.isTTY })
}

async function runDiscover(config: HarnessConfig): Promise<void> {
	const discoveryUrl = buildDiscoveryUrl(config.issuer)
	const discovery = await fetchJson<DiscoveryDocument>(discoveryUrl, undefined, config.debug, 'discovery response')
	printResult(
		{
			discoveryUrl,
			discovery,
		},
		config.json
	)
}

async function runAuthorizationCodeFlow(config: HarnessConfig): Promise<void> {
	const session = await performAuthorizationCodeFlow({
		...config,
		scopes: config.scopes.length > 0 ? config.scopes : ['profile'],
	})

	printResult(
		{
			...session,
		},
		config.json
	)
}

async function runTokenExchange(config: HarnessConfig): Promise<void> {
	const discoveryUrl = buildDiscoveryUrl(config.issuer)
	const discovery = await fetchJson<DiscoveryDocument>(discoveryUrl, undefined, config.debug, 'discovery response')
	if (!discovery.token_endpoint) {
		throw new Error('Discovery document is missing a token endpoint')
	}
	if (!config.code || !config.codeVerifier) {
		throw new Error('token requires --code and --code-verifier')
	}

	const tokenResponse = await exchangeToken({
		tokenEndpoint: discovery.token_endpoint,
		grantType: 'authorization_code',
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		clientAuthMethod: config.clientAuthMethod,
		redirectUri: config.redirectUri,
		code: config.code,
		codeVerifier: config.codeVerifier,
		debug: config.debug,
	})

	printResult(tokenResponse, config.json)
}

async function runRefresh(config: HarnessConfig): Promise<void> {
	const discoveryUrl = buildDiscoveryUrl(config.issuer)
	const discovery = await fetchJson<DiscoveryDocument>(discoveryUrl, undefined, config.debug, 'discovery response')
	if (!discovery.token_endpoint) {
		throw new Error('Discovery document is missing a token endpoint')
	}
	if (!config.refreshToken) {
		throw new Error('refresh requires --refresh-token')
	}

	const tokenResponse = await exchangeToken({
		tokenEndpoint: discovery.token_endpoint,
		grantType: 'refresh_token',
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		clientAuthMethod: config.clientAuthMethod,
		refreshToken: config.refreshToken,
		debug: config.debug,
	})

	printResult(tokenResponse, config.json)
}

async function runAuthorizedRequest(config: HarnessConfig, pathOverride?: string): Promise<void> {
	const discoveryUrl = buildDiscoveryUrl(config.issuer)
	const discovery = await fetchJson<DiscoveryDocument>(discoveryUrl, undefined, config.debug, 'discovery response')
	if (!discovery.authorization_endpoint) {
		throw new Error('Discovery document is missing an authorization endpoint')
	}

	let tokenResponse: TokenResponse | undefined
	let accessToken = config.accessToken
	if (!accessToken) {
		if (!discovery.token_endpoint) {
			throw new Error('Discovery document is missing a token endpoint')
		}
		if (!config.clientId || !config.code || !config.codeVerifier) {
			throw new Error('call/me requires --access-token or --code with --code-verifier')
		}
		tokenResponse = await exchangeToken({
			tokenEndpoint: discovery.token_endpoint,
			grantType: 'authorization_code',
			clientId: config.clientId,
			clientSecret: config.clientSecret,
			clientAuthMethod: config.clientAuthMethod,
			redirectUri: config.redirectUri,
			code: config.code,
			codeVerifier: config.codeVerifier,
			debug: config.debug,
		})
		accessToken = tokenResponse.access_token
	}
	if (!accessToken) {
		throw new Error('Token response did not include an access token')
	}

	const path = pathOverride ?? config.path ?? '/oauth/api/me'
	const method = (config.method ?? 'GET').toUpperCase()
	const result = await fetchAuthorizedRequest(
		config.issuer,
		accessToken,
		path,
		method,
		config.body,
		config.debug
	)

	printResult(
		{
			...result,
			...(tokenResponse ? { tokenResponse } : {}),
		},
		config.json
	)
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message)
	}
}

function assertAuthorized200(result: AuthorizedRequestResult, context: string): void {
	assert(result.status === 200, `${context} failed with HTTP ${result.status}`)
	assert(result.payload !== null, `${context} returned a null payload`)
}

function assertAuthorizedObjectPayload(result: AuthorizedRequestResult, context: string): Record<string, unknown> {
	assertAuthorized200(result, context)
	assert(typeof result.payload === 'object' && !Array.isArray(result.payload), `${context} returned a non-object payload`)
	return result.payload as Record<string, unknown>
}

function assertAuthorizedNumberPayload(result: AuthorizedRequestResult, context: string): number {
	assertAuthorized200(result, context)
	assert(typeof result.payload === 'number', `${context} returned a non-numeric payload`)
	return result.payload
}

async function runProfileScenario(config: HarnessConfig): Promise<void> {
	const desiredScopes = [...new Set([...(config.scopes.length > 0 ? config.scopes : []), 'profile', 'groups'])]
	const session = await performAuthorizationCodeFlow({
		...config,
		scopes: desiredScopes,
	})
	const accessToken = session.tokenResponse.access_token
	assert(accessToken, 'Profile scenario did not receive an access token')

	const me = await fetchAuthorizedRequest(config.issuer, accessToken, '/oauth/api/me', 'GET', undefined, config.debug)
	const payload = assertAuthorizedObjectPayload(me, '/oauth/api/me') as OAuthProfileResponse
	assert(Array.isArray(payload.scope), 'Profile response is missing the scope list')
	assert(payload.scope.includes('profile'), 'Profile response did not include the profile scope')
	assert(payload.scope.includes('groups'), 'Profile response did not include the groups scope')
	assert(typeof payload.sub === 'string' && payload.sub.length > 0, 'Profile response is missing sub')
	assert(
		typeof payload.clientId === 'string' && payload.clientId.length > 0,
		'Profile response is missing clientId'
	)
	assert(
		typeof payload.email === 'string' && payload.email === `${payload.sub}@authnext.invalid`,
		'Profile response is missing the synthesized email address'
	)
	assert(payload.emailVerified === true, 'Profile response is missing the verified email flag')
	assert(
		typeof payload.mainCharacterId === 'string' && payload.mainCharacterId.length > 0,
		'Profile response is missing mainCharacterId'
	)
	assert(
		Array.isArray(payload.characters) && payload.characters.length > 0,
		'Profile response is missing character rows'
	)
	assert(Array.isArray(payload.groupMemberships), 'Profile response is missing group memberships')

	printResult(
		{
			scenario: 'profile',
			issuer: config.issuer,
			callback: session.callback,
			me: payload,
		},
		config.json
	)
}

async function runBasicEsiScenario(config: HarnessConfig): Promise<void> {
	const desiredScopes = config.scopes.length > 0
		? config.scopes
		: [
				'profile',
				'esi:esi-wallet.read_character_wallet.v1',
				'esi:esi-location.read_location.v1',
				'esi:esi-location.read_online.v1',
			]

	const session = await performAuthorizationCodeFlow({
		...config,
		scopes: desiredScopes,
	})
	const accessToken = session.tokenResponse.access_token
	assert(accessToken, 'ESI scenario did not receive an access token')

	const me = await fetchAuthorizedRequest(
		config.issuer,
		accessToken,
		'/oauth/api/me',
		'GET',
		undefined,
		config.debug
	)
	const mePayload = assertAuthorizedObjectPayload(me, '/oauth/api/me') as OAuthProfileResponse
	assert(
		typeof mePayload.mainCharacterId === 'string' && mePayload.mainCharacterId.length > 0,
		'Profile response is missing mainCharacterId for ESI testing'
	)
	assert(
		Array.isArray(mePayload.characters) && mePayload.characters.length > 0,
		'Profile response is missing character rows for ESI testing'
	)

	const validCharacters = (mePayload.characters ?? []).filter((character) => character.hasValidToken)
	assert(validCharacters.length >= 2, 'Need at least two linked characters with valid tokens for ESI testing')

	const primaryCharacter = validCharacters.find(
		(character) => character.characterId === mePayload.mainCharacterId
	) ?? validCharacters[0]
	const secondaryCharacter = validCharacters.find(
		(character) => character.characterId !== primaryCharacter.characterId
	)
	assert(secondaryCharacter, 'Need a second distinct linked character for ESI testing')

	const selectedCharacters = [primaryCharacter, secondaryCharacter]
	const perCharacterResults: EsiScenarioCharacterResult[] = []

	for (const character of selectedCharacters) {
		const characterPath = (suffix: string) =>
			appendQueryParam(
				`/oauth/api/esi-proxy/latest/characters/${character.characterId}${suffix}`,
				'character_id',
				character.characterId
			)

		const wallet = await fetchAuthorizedRequest(
			config.issuer,
			accessToken,
			characterPath('/wallet/'),
			'GET',
			undefined,
			config.debug
		)
		const location = await fetchAuthorizedRequest(
			config.issuer,
			accessToken,
			characterPath('/location/'),
			'GET',
			undefined,
			config.debug
		)
		const online = await fetchAuthorizedRequest(
			config.issuer,
			accessToken,
			characterPath('/online/'),
			'GET',
			undefined,
			config.debug
		)

		const walletPayload = assertAuthorizedNumberPayload(
			wallet,
			`/oauth/api/esi-proxy wallet (${character.characterId})`
		)
		const locationPayload = assertAuthorizedObjectPayload(
			location,
			`/oauth/api/esi-proxy location (${character.characterId})`
		)
		assert(
			'solar_system_id' in locationPayload || 'structure_id' in locationPayload,
			'Location response is missing location identifiers'
		)

		const onlinePayload = assertAuthorizedObjectPayload(
			online,
			`/oauth/api/esi-proxy online (${character.characterId})`
		)
		assert('online' in onlinePayload, 'Online response is missing an online flag')

		perCharacterResults.push({
			characterId: character.characterId,
			characterName: character.characterName,
			wallet: walletPayload,
			location: locationPayload,
			online: onlinePayload,
		})
	}

	printResult(
		{
			scenario: 'esi-basic',
			issuer: config.issuer,
			callback: session.callback,
			me: mePayload,
			selectedCharacters: perCharacterResults,
		},
		config.json
	)
}

async function bootstrapProfileSession(config: HarnessConfig): Promise<{
	session: AuthorizationSessionResult
	me: OAuthProfileResponse
	accessToken: string
	mainCharacterId: string
}> {
	const session = await performAuthorizationCodeFlow({
		...config,
		scopes: ['profile'],
	})
	const accessToken = session.tokenResponse.access_token
	assert(accessToken, 'Profile bootstrap did not receive an access token')

	const me = await fetchAuthorizedRequest(config.issuer, accessToken, '/oauth/api/me', 'GET', undefined, config.debug)
	const mePayload = assertAuthorizedObjectPayload(me, '/oauth/api/me') as OAuthProfileResponse
	assert(
		typeof mePayload.mainCharacterId === 'string' && mePayload.mainCharacterId.length > 0,
		'Profile response is missing mainCharacterId'
	)

	return {
		session,
		me: mePayload,
		accessToken,
		mainCharacterId: mePayload.mainCharacterId,
	}
}

async function runForbiddenCorporationStructuresScenario(config: HarnessConfig): Promise<void> {
	const { session, me, accessToken, mainCharacterId } = await bootstrapProfileSession(config)
	const corporationId = '1'
	const denied = await fetchAuthorizedRequest(
		config.issuer,
		accessToken,
		`/oauth/api/esi-proxy/latest/corporations/${corporationId}/structures/?character_id=${mainCharacterId}`,
		'GET',
		undefined,
		config.debug
	)
	assert(denied.status === 403, `Corporation structures scenario expected HTTP 403 but got ${denied.status}`)
	assert(typeof denied.payload === 'object' && denied.payload !== null, 'Corporation structures denial returned a non-object payload')
	const payload = denied.payload as Record<string, unknown>
	assert(payload.error === 'forbidden', 'Corporation structures denial did not return a forbidden error')
	assert(
		typeof payload.message === 'string' && payload.message.includes('Missing required scope'),
		'Corporation structures denial did not mention the missing scope'
	)

	printResult(
		{
			scenario: 'esi-forbidden-corporation-structures',
			issuer: config.issuer,
			callback: session.callback,
			me,
			attemptedRequest: {
				path: `/oauth/api/esi-proxy/latest/corporations/${corporationId}/structures/?character_id=${mainCharacterId}`,
				method: 'GET',
			},
			deniedResponse: denied,
		},
		config.json
	)
}

async function runForbiddenWriteLocationScenario(config: HarnessConfig): Promise<void> {
	const { session, me, accessToken, mainCharacterId } = await bootstrapProfileSession(config)
	const denied = await fetchAuthorizedRequest(
		config.issuer,
		accessToken,
		`/oauth/api/esi-proxy/latest/characters/${mainCharacterId}/location/?character_id=${mainCharacterId}`,
		'POST',
		undefined,
		config.debug
	)
	assert(denied.status === 403, `Write-location scenario expected HTTP 403 but got ${denied.status}`)
	assert(typeof denied.payload === 'object' && denied.payload !== null, 'Write-location denial returned a non-object payload')
	const payload = denied.payload as Record<string, unknown>
	assert(payload.error === 'forbidden', 'Write-location denial did not return a forbidden error')
	assert(
		typeof payload.message === 'string' && payload.message.includes('No third-party scope allows this ESI path'),
		'Write-location denial did not mention the allowlist restriction'
	)

	printResult(
		{
			scenario: 'esi-forbidden-write-location',
			issuer: config.issuer,
			callback: session.callback,
			me,
			attemptedRequest: {
				path: `/oauth/api/esi-proxy/latest/characters/${mainCharacterId}/location/?character_id=${mainCharacterId}`,
				method: 'POST',
			},
			deniedResponse: denied,
		},
		config.json
	)
}

function buildConfig(args: ParsedArgs): HarnessConfig {
	const commandName = (args._[0] ?? 'auth') as CommandName
	const issuer = getStringArg(args, 'issuer') ?? process.env.OAUTH_ISSUER ?? 'http://127.0.0.1:8787'
	const clientId = getStringArg(args, 'client-id') ?? process.env.OAUTH_CLIENT_ID ?? ''
	const clientSecret = getStringArg(args, 'client-secret') ?? process.env.OAUTH_CLIENT_SECRET
	const clientAuthMethodArg = getStringArg(args, 'client-auth-method') ?? process.env.OAUTH_CLIENT_AUTH_METHOD
	const clientAuthMethod =
		(clientAuthMethodArg as TokenEndpointAuthMethod | undefined) ??
		(clientSecret ? 'client_secret_basic' : 'none')
	const redirectUri =
		getStringArg(args, 'redirect-uri') ??
		process.env.OAUTH_REDIRECT_URI ??
		'http://127.0.0.1:9786/callback'
	const scopes = getManyArgs(args, 'scope')
	const state = getStringArg(args, 'state') ?? randomBytes(16).toString('base64url')
	const codeChallengeMethod = (getStringArg(args, 'code-challenge-method') ?? 'S256') as
		| 'S256'
		| 'plain'
	const timeoutMs = parseIntegerArg(getStringArg(args, 'timeout-ms'), 5 * 60 * 1000)

	return {
		command: commandName,
		issuer,
		clientId,
		clientSecret,
		clientAuthMethod,
		redirectUri,
		scopes,
		state,
		codeChallengeMethod,
		timeoutMs,
		code: getStringArg(args, 'code'),
		codeVerifier: getStringArg(args, 'code-verifier'),
		refreshToken: getStringArg(args, 'refresh-token'),
		accessToken: getStringArg(args, 'access-token'),
		path: getStringArg(args, 'path'),
		method: getStringArg(args, 'method'),
		body: getStringArg(args, 'body'),
		json: getBooleanArg(args, 'json') || process.env.OAUTH_HARNESS_JSON === '1',
		debug: getBooleanArg(args, 'debug') || process.env.OAUTH_HARNESS_DEBUG === '1',
	}
}

function validateConfig(config: HarnessConfig): void {
	if (!['client_secret_basic', 'client_secret_post', 'none'].includes(config.clientAuthMethod)) {
		throw new Error(`Unsupported client auth method: ${config.clientAuthMethod}`)
	}

	if (config.codeChallengeMethod !== 'S256' && config.codeChallengeMethod !== 'plain') {
		throw new Error(`Unsupported code challenge method: ${config.codeChallengeMethod}`)
	}

	switch (config.command) {
		case 'discover':
			return
		case 'auth':
		case 'token':
		case 'refresh':
			if (!config.clientId) {
				throw new Error('Missing --client-id or OAUTH_CLIENT_ID')
			}
			if (config.clientAuthMethod !== 'none' && !config.clientSecret) {
				throw new Error('Missing --client-secret or OAUTH_CLIENT_SECRET for confidential client auth')
			}
			return
		case 'me':
		case 'call':
			if (!config.accessToken && !config.clientId) {
				throw new Error('Missing --access-token or --client-id')
			}
			return
		case 'scenario-profile':
			if (!config.clientId) {
				throw new Error('Missing --client-id or OAUTH_CLIENT_ID')
			}
			if (config.clientAuthMethod !== 'none' && !config.clientSecret) {
				throw new Error('Missing --client-secret or OAUTH_CLIENT_SECRET for confidential client auth')
			}
			return
		case 'scenario-esi-basic':
			if (!config.clientId) {
				throw new Error('Missing --client-id or OAUTH_CLIENT_ID')
			}
			if (config.clientAuthMethod !== 'none' && !config.clientSecret) {
				throw new Error('Missing --client-secret or OAUTH_CLIENT_SECRET for confidential client auth')
			}
			return
		case 'scenario-esi-forbidden-corporation-structures':
		case 'scenario-esi-forbidden-write-location':
			if (!config.clientId) {
				throw new Error('Missing --client-id or OAUTH_CLIENT_ID')
			}
			if (config.clientAuthMethod !== 'none' && !config.clientSecret) {
				throw new Error('Missing --client-secret or OAUTH_CLIENT_SECRET for confidential client auth')
			}
			return
		default:
			throw new Error(`Unsupported command: ${config.command satisfies never}`)
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))

	if (args._.length === 0 || args.help === true || args.h === true) {
		writeUsage()
		process.exit(args._.length === 0 ? 1 : 0)
	}

	const config = buildConfig(args)
	validateConfig(config)

	switch (config.command) {
		case 'discover':
			await runDiscover(config)
			return
		case 'auth':
			await runAuthorizationCodeFlow(config)
			return
		case 'token':
			await runTokenExchange(config)
			return
		case 'refresh':
			await runRefresh(config)
			return
		case 'me':
			await runAuthorizedRequest(config, '/oauth/api/me')
			return
		case 'call':
			await runAuthorizedRequest(config, config.path)
			return
		case 'scenario-profile':
			await runProfileScenario(config)
			return
		case 'scenario-esi-basic':
			await runBasicEsiScenario(config)
			return
		case 'scenario-esi-forbidden-corporation-structures':
			await runForbiddenCorporationStructuresScenario(config)
			return
		case 'scenario-esi-forbidden-write-location':
			await runForbiddenWriteLocationScenario(config)
			return
		default:
			throw new Error(`Unsupported command: ${config.command satisfies never}`)
	}
}

void main().catch((error) => {
	console.error(
		error instanceof Error ? error.stack ?? error.message : `Unexpected error: ${String(error)}`
	)
	process.exit(1)
})
