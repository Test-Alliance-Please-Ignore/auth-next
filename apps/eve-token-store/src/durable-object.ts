import { DurableObject } from 'cloudflare:workers'

import { and, eq } from '@repo/db-utils'

import { createDb } from './db'
import { eveCharacters, eveTokens } from './db/schema'

import type {
	AuthorizationUrlResponse,
	CallbackResult,
	EveTokenResponse,
	EveTokenStore,
	EveVerifyResponse,
	TokenInfo,
} from '@repo/eve-token-store'
import type { Env } from './context'

/**
 * EVE SSO OAuth Endpoints
 */
const EVE_SSO_AUTHORIZE_URL = 'https://login.eveonline.com/v2/oauth/authorize'
const EVE_SSO_TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token'
const EVE_SSO_VERIFY_URL = 'https://login.eveonline.com/oauth/verify'

/**
 * EVE SSO Scopes
 */
const EVE_SCOPES_LOGIN = ['publicData']
const EVE_SCOPES_ALL = [
	'publicData',
	'esi-calendar.respond_calendar_events.v1',
	'esi-calendar.read_calendar_events.v1',
	'esi-location.read_location.v1',
	'esi-location.read_ship_type.v1',
	'esi-mail.organize_mail.v1',
	'esi-mail.read_mail.v1',
	'esi-mail.send_mail.v1',
	'esi-skills.read_skills.v1',
	'esi-skills.read_skillqueue.v1',
	'esi-wallet.read_character_wallet.v1',
	'esi-wallet.read_corporation_wallet.v1',
	'esi-search.search_structures.v1',
	'esi-clones.read_clones.v1',
	'esi-characters.read_contacts.v1',
	'esi-universe.read_structures.v1',
	'esi-killmails.read_killmails.v1',
	'esi-corporations.read_corporation_membership.v1',
	'esi-assets.read_assets.v1',
	'esi-planets.manage_planets.v1',
	'esi-fleets.read_fleet.v1',
	'esi-fleets.write_fleet.v1',
	'esi-ui.open_window.v1',
	'esi-ui.write_waypoint.v1',
	'esi-characters.write_contacts.v1',
	'esi-fittings.read_fittings.v1',
	'esi-fittings.write_fittings.v1',
	'esi-markets.structure_markets.v1',
	'esi-corporations.read_structures.v1',
	'esi-characters.read_loyalty.v1',
	'esi-characters.read_chat_channels.v1',
	'esi-characters.read_medals.v1',
	'esi-characters.read_standings.v1',
	'esi-characters.read_agents_research.v1',
	'esi-industry.read_character_jobs.v1',
	'esi-markets.read_character_orders.v1',
	'esi-characters.read_blueprints.v1',
	'esi-characters.read_corporation_roles.v1',
	'esi-location.read_online.v1',
	'esi-contracts.read_character_contracts.v1',
	'esi-clones.read_implants.v1',
	'esi-characters.read_fatigue.v1',
	'esi-killmails.read_corporation_killmails.v1',
	'esi-corporations.track_members.v1',
	'esi-wallet.read_corporation_wallets.v1',
	'esi-characters.read_notifications.v1',
	'esi-corporations.read_divisions.v1',
	'esi-corporations.read_contacts.v1',
	'esi-assets.read_corporation_assets.v1',
	'esi-corporations.read_titles.v1',
	'esi-corporations.read_blueprints.v1',
	'esi-contracts.read_corporation_contracts.v1',
	'esi-corporations.read_standings.v1',
	'esi-corporations.read_starbases.v1',
	'esi-industry.read_corporation_jobs.v1',
	'esi-markets.read_corporation_orders.v1',
	'esi-corporations.read_container_logs.v1',
	'esi-industry.read_character_mining.v1',
	'esi-industry.read_corporation_mining.v1',
	'esi-planets.read_customs_offices.v1',
	'esi-corporations.read_facilities.v1',
	'esi-corporations.read_medals.v1',
	'esi-characters.read_titles.v1',
	'esi-alliances.read_contacts.v1',
	'esi-characters.read_fw_stats.v1',
	'esi-corporations.read_fw_stats.v1',
	'esi-corporations.read_projects.v1',
]

/**
 * EveTokenStore Durable Object
 *
 * This Durable Object handles:
 * - EVE Online SSO OAuth flow
 * - Token storage and encryption
 * - Automatic token refresh via alarms
 * - RPC methods for remote calls
 */
export class EveTokenStoreDO extends DurableObject<Env> implements EveTokenStore {
	private db: ReturnType<typeof createDb>

	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)

		// Schedule alarm for token refresh (check every 5 minutes)
		void this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Start OAuth flow for login (publicData scope only)
	 */
	async startLoginFlow(state?: string): Promise<AuthorizationUrlResponse> {
		return this.generateAuthUrl(EVE_SCOPES_LOGIN, state)
	}

	/**
	 * Start OAuth flow for character attachment (all scopes)
	 */
	async startCharacterFlow(state?: string): Promise<AuthorizationUrlResponse> {
		return this.generateAuthUrl(EVE_SCOPES_ALL, state)
	}

	/**
	 * Handle OAuth callback - exchange code for tokens and store them
	 */
	async handleCallback(code: string, state?: string): Promise<CallbackResult> {
		try {
			// Exchange authorization code for tokens
			const tokenResponse = await this.exchangeCodeForToken(code)

			// Verify the token and get character information
			const verifyResponse = await this.verifyToken(tokenResponse.access_token)

			// Parse scopes
			const scopes = verifyResponse.Scopes ? verifyResponse.Scopes.split(' ') : []

			// Calculate token expiration
			const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000)

			// Store character and token in database
			await this.storeToken(
				verifyResponse.CharacterID,
				verifyResponse.CharacterName,
				verifyResponse.CharacterOwnerHash,
				scopes,
				tokenResponse.access_token,
				tokenResponse.refresh_token || null,
				expiresAt
			)

			return {
				success: true,
				characterOwnerHash: verifyResponse.CharacterOwnerHash,
				characterInfo: {
					characterId: verifyResponse.CharacterID,
					characterName: verifyResponse.CharacterName,
					scopes,
				},
			}
		} catch (error) {
			console.error('Error handling OAuth callback:', error)
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			}
		}
	}

	/**
	 * Manually refresh a token
	 */
	async refreshToken(characterOwnerHash: string): Promise<boolean> {
		try {
			// Get character from database
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterOwnerHash, characterOwnerHash),
				with: {
					tokens: true,
				},
			})

			if (!character) {
				console.error('Character not found:', characterOwnerHash)
				return false
			}

			// Get token record
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (!tokenRecord || !tokenRecord.refreshToken) {
				console.error('Token or refresh token not found')
				return false
			}

			// Decrypt refresh token
			const refreshToken = await this.decrypt(tokenRecord.refreshToken)

			// Refresh the token
			const newTokenResponse = await this.refreshAccessToken(refreshToken)

			// Calculate new expiration
			const expiresAt = new Date(Date.now() + newTokenResponse.expires_in * 1000)

			// Encrypt new tokens
			const encryptedAccessToken = await this.encrypt(newTokenResponse.access_token)
			const encryptedRefreshToken = newTokenResponse.refresh_token
				? await this.encrypt(newTokenResponse.refresh_token)
				: tokenRecord.refreshToken

			// Update token in database
			await this.db
				.update(eveTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, tokenRecord.id))

			return true
		} catch (error) {
			console.error('Error refreshing token:', error)
			return false
		}
	}

	/**
	 * Get token information (without actual token values)
	 */
	async getTokenInfo(characterOwnerHash: string): Promise<TokenInfo | null> {
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterOwnerHash, characterOwnerHash),
		})

		if (!character) {
			return null
		}

		const tokenRecord = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (!tokenRecord) {
			return null
		}

		const scopes = JSON.parse(character.scopes) as string[]
		const isExpired = tokenRecord.expiresAt < new Date()

		return {
			characterId: character.characterId,
			characterName: character.characterName,
			characterOwnerHash: character.characterOwnerHash,
			expiresAt: tokenRecord.expiresAt,
			scopes,
			isExpired,
		}
	}

	/**
	 * Get access token for use (decrypted)
	 */
	async getAccessToken(characterOwnerHash: string): Promise<string | null> {
		const character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterOwnerHash, characterOwnerHash),
		})

		if (!character) {
			return null
		}

		const tokenRecord = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (!tokenRecord) {
			return null
		}

		// Check if token is expired
		if (tokenRecord.expiresAt < new Date()) {
			// Try to refresh
			const refreshed = await this.refreshToken(characterOwnerHash)
			if (!refreshed) {
				return null
			}

			// Fetch updated token
			const updatedToken = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (!updatedToken) {
				return null
			}

			return this.decrypt(updatedToken.accessToken)
		}

		return this.decrypt(tokenRecord.accessToken)
	}

	/**
	 * Revoke and delete a token
	 */
	async revokeToken(characterOwnerHash: string): Promise<boolean> {
		try {
			const character = await this.db.query.eveCharacters.findFirst({
				where: eq(eveCharacters.characterOwnerHash, characterOwnerHash),
			})

			if (!character) {
				return false
			}

			// Delete the character (cascade will delete tokens)
			await this.db.delete(eveCharacters).where(eq(eveCharacters.id, character.id))

			return true
		} catch (error) {
			console.error('Error revoking token:', error)
			return false
		}
	}

	/**
	 * List all tokens stored in the system
	 */
	async listTokens(): Promise<TokenInfo[]> {
		const characters = await this.db.query.eveCharacters.findMany()

		const tokens: TokenInfo[] = []

		for (const character of characters) {
			const tokenRecord = await this.db.query.eveTokens.findFirst({
				where: eq(eveTokens.characterId, character.id),
			})

			if (tokenRecord) {
				const scopes = JSON.parse(character.scopes) as string[]
				const isExpired = tokenRecord.expiresAt < new Date()

				tokens.push({
					characterId: character.characterId,
					characterName: character.characterName,
					characterOwnerHash: character.characterOwnerHash,
					expiresAt: tokenRecord.expiresAt,
					scopes,
					isExpired,
				})
			}
		}

		return tokens
	}

	/**
	 * Alarm handler - automatically refresh tokens that are expiring soon
	 */
	async alarm(): Promise<void> {
		console.log('EveTokenStoreDO alarm triggered at:', new Date().toISOString())

		try {
			// Find tokens expiring within 5 minutes
			const expiringTokens = await this.db.query.eveTokens.findMany({
				where:
					and(),
					// Token expires in the future (not already expired)
					// but within the next 5 minutes
			})

			console.log(`Found ${expiringTokens.length} tokens to refresh`)

			// Refresh each token
			for (const token of expiringTokens) {
				const character = await this.db.query.eveCharacters.findFirst({
					where: eq(eveCharacters.id, token.characterId),
				})

				if (character) {
					console.log(`Refreshing token for character: ${character.characterName}`)
					await this.refreshToken(character.characterOwnerHash)
				}
			}
		} catch (error) {
			console.error('Error in alarm handler:', error)
		}

		// Schedule next alarm (5 minutes)
		await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000)
	}

	/**
	 * Generate authorization URL for EVE SSO
	 */
	private generateAuthUrl(scopes: string[], state?: string): AuthorizationUrlResponse {
		const generatedState = state || crypto.randomUUID()

		const params = new URLSearchParams({
			response_type: 'code',
			redirect_uri: this.env.EVE_SSO_CALLBACK_URL,
			client_id: this.env.EVE_SSO_CLIENT_ID,
			scope: scopes.join(' '),
			state: generatedState,
		})

		return {
			url: `${EVE_SSO_AUTHORIZE_URL}?${params.toString()}`,
			state: generatedState,
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<EveTokenResponse> {
		const credentials = btoa(`${this.env.EVE_SSO_CLIENT_ID}:${this.env.EVE_SSO_CLIENT_SECRET}`)

		const response = await fetch(EVE_SSO_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Host: 'login.eveonline.com',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token exchange failed: ${error}`)
		}

		return response.json<EveTokenResponse>()
	}

	/**
	 * Refresh access token using refresh token
	 */
	private async refreshAccessToken(refreshToken: string): Promise<EveTokenResponse> {
		const credentials = btoa(`${this.env.EVE_SSO_CLIENT_ID}:${this.env.EVE_SSO_CLIENT_SECRET}`)

		const response = await fetch(EVE_SSO_TOKEN_URL, {
			method: 'POST',
			headers: {
				Authorization: `Basic ${credentials}`,
				'Content-Type': 'application/x-www-form-urlencoded',
				Host: 'login.eveonline.com',
			},
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
			}),
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token refresh failed: ${error}`)
		}

		return response.json<EveTokenResponse>()
	}

	/**
	 * Verify access token with EVE SSO
	 */
	private async verifyToken(accessToken: string): Promise<EveVerifyResponse> {
		const response = await fetch(EVE_SSO_VERIFY_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		})

		if (!response.ok) {
			const error = await response.text()
			throw new Error(`Token verification failed: ${error}`)
		}

		return response.json<EveVerifyResponse>()
	}

	/**
	 * Store token in database (upsert)
	 */
	private async storeToken(
		characterId: number,
		characterName: string,
		characterOwnerHash: string,
		scopes: string[],
		accessToken: string,
		refreshToken: string | null,
		expiresAt: Date
	): Promise<void> {
		// Encrypt tokens
		const encryptedAccessToken = await this.encrypt(accessToken)
		const encryptedRefreshToken = refreshToken ? await this.encrypt(refreshToken) : null

		// Check if character exists
		let character = await this.db.query.eveCharacters.findFirst({
			where: eq(eveCharacters.characterOwnerHash, characterOwnerHash),
		})

		if (character) {
			// Update existing character
			await this.db
				.update(eveCharacters)
				.set({
					characterName,
					scopes: JSON.stringify(scopes),
					updatedAt: new Date(),
				})
				.where(eq(eveCharacters.id, character.id))
		} else {
			// Insert new character
			const [newCharacter] = await this.db
				.insert(eveCharacters)
				.values({
					characterId,
					characterName,
					characterOwnerHash,
					scopes: JSON.stringify(scopes),
				})
				.returning()

			character = newCharacter
		}

		if (!character) {
			throw new Error('Failed to create or update character')
		}

		// Check if token exists
		const existingToken = await this.db.query.eveTokens.findFirst({
			where: eq(eveTokens.characterId, character.id),
		})

		if (existingToken) {
			// Update existing token
			await this.db
				.update(eveTokens)
				.set({
					accessToken: encryptedAccessToken,
					refreshToken: encryptedRefreshToken,
					expiresAt,
					updatedAt: new Date(),
				})
				.where(eq(eveTokens.id, existingToken.id))
		} else {
			// Insert new token
			await this.db.insert(eveTokens).values({
				characterId: character.id,
				accessToken: encryptedAccessToken,
				refreshToken: encryptedRefreshToken,
				expiresAt,
			})
		}
	}

	/**
	 * Encrypt data using AES-GCM
	 */
	private async encrypt(data: string): Promise<string> {
		const key = await this.getEncryptionKey()
		const iv = crypto.getRandomValues(new Uint8Array(12))
		const encodedData = new TextEncoder().encode(data)

		const encryptedData = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			encodedData
		)

		// Combine IV and encrypted data
		const combined = new Uint8Array(iv.length + encryptedData.byteLength)
		combined.set(iv)
		combined.set(new Uint8Array(encryptedData), iv.length)

		// Return as base64
		return btoa(String.fromCharCode(...combined))
	}

	/**
	 * Decrypt data using AES-GCM
	 */
	private async decrypt(encryptedData: string): Promise<string> {
		const key = await this.getEncryptionKey()

		// Decode from base64
		const combined = Uint8Array.from(atob(encryptedData), (c) => c.charCodeAt(0))

		// Extract IV and data
		const iv = combined.slice(0, 12)
		const data = combined.slice(12)

		const decryptedData = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv,
			},
			key,
			data
		)

		return new TextDecoder().decode(decryptedData)
	}

	/**
	 * Get or create encryption key from environment
	 */
	private async getEncryptionKey(): Promise<CryptoKey> {
		// Convert hex string to bytes
		const keyData = new Uint8Array(
			this.env.ENCRYPTION_KEY.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
		)

		return crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, [
			'encrypt',
			'decrypt',
		])
	}
}
