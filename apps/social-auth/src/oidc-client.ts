import { logger } from '@repo/hono-helpers'

interface OIDCConfiguration {
	issuer: string
	authorization_endpoint: string
	token_endpoint: string
	userinfo_endpoint: string
	jwks_uri: string
}

interface TokenResponse {
	access_token: string
	token_type: string
	expires_in?: number
	refresh_token?: string
	id_token?: string
}

interface UserInfo {
	sub: string
	preferred_username?: string
	name?: string
	email?: string
	auth_username?: string
	superuser?: boolean
	staff?: boolean
	active?: boolean
	primary_character?: string
	primary_character_id?: string | number
	groups?: string[]
}

export class OIDCClient {
	private issuer: string
	private clientId: string
	private clientSecret: string
	private callbackUrl: string
	private configCache: OIDCConfiguration | null = null
	private configCacheExpiry = 0

	constructor(issuer: string, clientId: string, clientSecret: string, callbackUrl: string) {
		this.issuer = issuer.endsWith('/') ? issuer.slice(0, -1) : issuer
		this.clientId = clientId
		this.clientSecret = clientSecret
		this.callbackUrl = callbackUrl
	}

	/**
	 * Fetch OIDC configuration from .well-known endpoint
	 */
	private async getConfiguration(): Promise<OIDCConfiguration> {
		// Use cached config if available and not expired (cache for 1 hour)
		if (this.configCache && Date.now() < this.configCacheExpiry) {
			return this.configCache
		}

		const discoveryUrl = `${this.issuer}/.well-known/openid-configuration`

		logger
			.withTags({
				type: 'oidc_discovery',
			})
			.info('Fetching OIDC configuration', { discoveryUrl })

		const response = await fetch(discoveryUrl)

		if (!response.ok) {
			const error = await response.text()
			logger
				.withTags({
					type: 'oidc_discovery_error',
				})
				.error('Failed to fetch OIDC configuration', {
					status: response.status,
					error,
				})
			throw new Error(`Failed to fetch OIDC configuration: ${response.status}`)
		}

		const config = (await response.json()) as OIDCConfiguration

		// Cache the configuration
		this.configCache = config
		this.configCacheExpiry = Date.now() + 60 * 60 * 1000 // 1 hour

		return config
	}

	/**
	 * Generate authorization URL for OIDC flow
	 */
	async generateAuthorizationUrl(state: string, scopes = ['openid', 'profile', 'email']): Promise<string> {
		const config = await this.getConfiguration()

		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: this.callbackUrl,
			response_type: 'code',
			scope: scopes.join(' '),
			state,
		})

		return `${config.authorization_endpoint}?${params.toString()}`
	}

	/**
	 * Exchange authorization code for tokens
	 */
	async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
		const config = await this.getConfiguration()

		logger
			.withTags({
				type: 'oidc_token_exchange',
			})
			.info('Exchanging authorization code for tokens')

		const response = await fetch(config.token_endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: this.callbackUrl,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			logger
				.withTags({
					type: 'oidc_token_error',
				})
				.error('Failed to exchange code for tokens', {
					status: response.status,
					error,
				})
			throw new Error(`Failed to exchange code for tokens: ${response.status}`)
		}

		return (await response.json()) as TokenResponse
	}

	/**
	 * Fetch user info from OIDC provider
	 */
	async getUserInfo(accessToken: string): Promise<UserInfo> {
		const config = await this.getConfiguration()

		logger
			.withTags({
				type: 'oidc_userinfo',
			})
			.info('Fetching user info from OIDC provider')

		const response = await fetch(config.userinfo_endpoint, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const error = await response.text()
			logger
				.withTags({
					type: 'oidc_userinfo_error',
				})
				.error('Failed to fetch user info', {
					status: response.status,
					error,
				})
			throw new Error(`Failed to fetch user info: ${response.status}`)
		}

		return (await response.json()) as UserInfo
	}
}
