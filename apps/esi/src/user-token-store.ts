import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import type { Env } from './context'

export interface TokenData extends Record<string, number | string> {
	character_id: number
	character_name: string
	access_token: string
	refresh_token: string
	expires_at: number
	scopes: string
	proxy_token: string
	created_at: number
	updated_at: number
}

export interface TokenStoreRequest {
	action:
		| 'storeTokens'
		| 'getAccessToken'
		| 'revokeToken'
		| 'getTokenInfo'
		| 'findByProxyToken'
		| 'listAllTokens'
		| 'getProxyToken'
		| 'deleteByProxyToken'
		| 'getStats'
	characterId?: number
	characterName?: string
	accessToken?: string
	refreshToken?: string
	expiresIn?: number
	scopes?: string
	proxyToken?: string
	limit?: number
	offset?: number
}

export interface TokenStoreResponse {
	success: boolean
	error?: string
	data?: {
		proxyToken?: string
		accessToken?: string
		characterId?: number
		characterName?: string
		scopes?: string
		expiresAt?: number
		createdAt?: number
		updatedAt?: number
		total?: number
		limit?: number
		offset?: number
		results?: Array<{
			characterId: number
			characterName: string
			scopes: string
			expiresAt: number
			createdAt: number
			updatedAt: number
		}>
		stats?: {
			totalCount: number
			expiredCount: number
			activeCount: number
		}
	}
}

export class UserTokenStore extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env)
	}

	async fetch(request: Request): Promise<Response> {
		try {
			const body = (await request.json()) as TokenStoreRequest

			switch (body.action) {
				case 'storeTokens':
					return await this.storeTokens(
						body.characterId!,
						body.characterName!,
						body.accessToken!,
						body.refreshToken!,
						body.expiresIn!,
						body.scopes!
					)

				case 'getAccessToken':
					return await this.getAccessToken(body.characterId!)

				case 'findByProxyToken':
					return await this.findByProxyToken(body.proxyToken!)

				case 'revokeToken':
					return await this.revokeToken(body.characterId!)

				case 'getTokenInfo':
					return await this.getTokenInfo(body.characterId!)

				case 'listAllTokens':
					return await this.listAllTokens(body.limit, body.offset)

				case 'getProxyToken':
					return await this.getProxyToken(body.characterId!)

				case 'deleteByProxyToken':
					return await this.deleteByProxyToken(body.proxyToken!)

				case 'getStats':
					return await this.getStats()

				default:
					return Response.json({ success: false, error: 'Unknown action' }, { status: 400 })
			}
		} catch (error) {
			logger.error('UserTokenStore fetch error', { error: String(error) })
			return Response.json({ success: false, error: String(error) }, { status: 500 })
		}
	}

	private async ensureSchema() {
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS tokens (
				character_id INTEGER PRIMARY KEY,
				character_name TEXT NOT NULL,
				access_token TEXT NOT NULL,
				refresh_token TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				scopes TEXT NOT NULL,
				proxy_token TEXT UNIQUE NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_proxy_token ON tokens(proxy_token)
		`)
	}

	private generateProxyToken(): string {
		// Generate a random 32-byte token
		const array = new Uint8Array(32)
		crypto.getRandomValues(array)
		return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}

	private async storeTokens(
		characterId: number,
		characterName: string,
		accessToken: string,
		refreshToken: string,
		expiresIn: number,
		scopes: string
	): Promise<Response> {
		await this.ensureSchema()

		const now = Date.now()
		const expiresAt = now + expiresIn * 1000

		// Check if tokens already exist for this character
		const existing = await this.ctx.storage.sql
			.exec<{
				proxy_token: string
			}>('SELECT proxy_token FROM tokens WHERE character_id = ?', characterId)
			.toArray()

		let proxyToken: string

		if (existing.length > 0) {
			// Update existing tokens
			proxyToken = existing[0].proxy_token
			await this.ctx.storage.sql.exec(
				`UPDATE tokens
				SET access_token = ?, refresh_token = ?, expires_at = ?,
					scopes = ?, character_name = ?, updated_at = ?
				WHERE character_id = ?`,
				accessToken,
				refreshToken,
				expiresAt,
				scopes,
				characterName,
				now,
				characterId
			)
		} else {
			// Insert new tokens
			proxyToken = this.generateProxyToken()
			await this.ctx.storage.sql.exec(
				`INSERT INTO tokens (
					character_id, character_name, access_token, refresh_token,
					expires_at, scopes, proxy_token, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				characterId,
				characterName,
				accessToken,
				refreshToken,
				expiresAt,
				scopes,
				proxyToken,
				now,
				now
			)
		}

		logger
			.withTags({
				type: 'token_stored',
				character_id: characterId,
			})
			.info('Stored tokens for character', {
				characterId,
				characterName,
				expiresAt: new Date(expiresAt).toISOString(),
			})

		return Response.json({
			success: true,
			data: {
				proxyToken,
				characterId,
				characterName,
				scopes,
				expiresAt,
			},
		})
	}

	private async getAccessToken(characterId: number): Promise<Response> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(`SELECT * FROM tokens WHERE character_id = ?`, characterId)
			.toArray()

		if (rows.length === 0) {
			return Response.json({ success: false, error: 'Token not found' }, { status: 404 })
		}

		const token = rows[0]

		// Check if token is expired (with 5 minute buffer)
		if (token.expires_at - Date.now() < 5 * 60 * 1000) {
			// Token is expired or about to expire, refresh it
			const refreshed = await this.refreshAccessToken(token)
			if (refreshed.success && refreshed.data) {
				return Response.json({
					success: true,
					data: {
						accessToken: refreshed.data.accessToken,
						characterId: token.character_id,
						characterName: token.character_name,
						scopes: token.scopes,
						expiresAt: refreshed.data.expiresAt,
					},
				})
			}
			// If refresh failed, return the existing token anyway
		}

		return Response.json({
			success: true,
			data: {
				accessToken: token.access_token,
				characterId: token.character_id,
				characterName: token.character_name,
				scopes: token.scopes,
				expiresAt: token.expires_at,
			},
		})
	}

	private async findByProxyToken(proxyToken: string): Promise<Response> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(`SELECT * FROM tokens WHERE proxy_token = ?`, proxyToken)
			.toArray()

		if (rows.length === 0) {
			return Response.json({ success: false, error: 'Token not found' }, { status: 404 })
		}

		const token = rows[0]

		// Check if token is expired (with 5 minute buffer)
		if (token.expires_at - Date.now() < 5 * 60 * 1000) {
			// Token is expired or about to expire, refresh it
			const refreshed = await this.refreshAccessToken(token)
			if (refreshed.success && refreshed.data) {
				return Response.json({
					success: true,
					data: {
						accessToken: refreshed.data.accessToken,
						characterId: token.character_id,
						characterName: token.character_name,
						scopes: token.scopes,
						expiresAt: refreshed.data.expiresAt,
					},
				})
			}
		}

		return Response.json({
			success: true,
			data: {
				accessToken: token.access_token,
				characterId: token.character_id,
				characterName: token.character_name,
				scopes: token.scopes,
				expiresAt: token.expires_at,
			},
		})
	}

	private async refreshAccessToken(
		token: TokenData
	): Promise<{ success: boolean; data?: { accessToken: string; expiresAt: number } }> {
		logger
			.withTags({
				type: 'token_refresh_attempt',
				character_id: token.character_id,
			})
			.info('Attempting to refresh token', {
				characterId: token.character_id,
			})

		try {
			const auth = btoa(`${this.env.ESI_SSO_CLIENT_ID}:${this.env.ESI_SSO_CLIENT_SECRET}`)

			const response = await fetch('https://login.eveonline.com/v2/oauth/token', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					Authorization: `Basic ${auth}`,
				},
				body: new URLSearchParams({
					grant_type: 'refresh_token',
					refresh_token: token.refresh_token,
				}),
			})

			if (!response.ok) {
				const error = await response.text()
				logger
					.withTags({
						type: 'token_refresh_error',
						character_id: token.character_id,
					})
					.error('Failed to refresh token', {
						characterId: token.character_id,
						status: response.status,
						error,
					})
				return { success: false }
			}

			const data = (await response.json()) as {
				access_token: string
				refresh_token: string
				expires_in: number
			}

			const now = Date.now()
			const expiresAt = now + data.expires_in * 1000

			// Update the token in storage
			await this.ctx.storage.sql.exec(
				`UPDATE tokens
				SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = ?
				WHERE character_id = ?`,
				data.access_token,
				data.refresh_token,
				expiresAt,
				now,
				token.character_id
			)

			logger
				.withTags({
					type: 'token_refreshed',
					character_id: token.character_id,
				})
				.info('Token refreshed successfully', {
					characterId: token.character_id,
					expiresAt: new Date(expiresAt).toISOString(),
				})

			return {
				success: true,
				data: {
					accessToken: data.access_token,
					expiresAt,
				},
			}
		} catch (error) {
			logger
				.withTags({
					type: 'token_refresh_exception',
					character_id: token.character_id,
				})
				.error('Exception during token refresh', {
					error: String(error),
					characterId: token.character_id,
				})
			return { success: false }
		}
	}

	private async revokeToken(characterId: number): Promise<Response> {
		await this.ensureSchema()

		await this.ctx.storage.sql.exec(`DELETE FROM tokens WHERE character_id = ?`, characterId)

		logger
			.withTags({
				type: 'token_revoked',
				character_id: characterId,
			})
			.info('Token revoked', { characterId })

		return Response.json({ success: true })
	}

	private async getTokenInfo(characterId: number): Promise<Response> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(
				`SELECT character_id, character_name, scopes, expires_at, created_at, updated_at
				FROM tokens WHERE character_id = ?`,
				characterId
			)
			.toArray()

		if (rows.length === 0) {
			return Response.json({ success: false, error: 'Token not found' }, { status: 404 })
		}

		const token = rows[0]

		return Response.json({
			success: true,
			data: {
				characterId: token.character_id,
				characterName: token.character_name,
				scopes: token.scopes,
				expiresAt: token.expires_at,
			},
		})
	}

	private async listAllTokens(limit?: number, offset?: number): Promise<Response> {
		await this.ensureSchema()

		const parsedLimit = Math.min(limit || 50, 100)
		const parsedOffset = offset || 0

		// Get total count
		const countRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM tokens')
			.toArray()
		const total = countRows[0]?.count || 0

		// Get paginated results (exclude sensitive tokens)
		const rows = await this.ctx.storage.sql
			.exec<TokenData>(
				`SELECT character_id, character_name, scopes, expires_at, created_at, updated_at
				FROM tokens
				ORDER BY created_at DESC
				LIMIT ? OFFSET ?`,
				parsedLimit,
				parsedOffset
			)
			.toArray()

		return Response.json({
			success: true,
			data: {
				total,
				limit: parsedLimit,
				offset: parsedOffset,
				results: rows.map((token) => ({
					characterId: token.character_id,
					characterName: token.character_name,
					scopes: token.scopes,
					expiresAt: token.expires_at,
					createdAt: token.created_at,
					updatedAt: token.updated_at,
				})),
			},
		})
	}

	private async getProxyToken(characterId: number): Promise<Response> {
		await this.ensureSchema()

		const rows = await this.ctx.storage.sql
			.exec<TokenData>(
				`SELECT character_id, character_name, scopes, expires_at, proxy_token, created_at, updated_at
				FROM tokens WHERE character_id = ?`,
				characterId
			)
			.toArray()

		if (rows.length === 0) {
			return Response.json({ success: false, error: 'Token not found' }, { status: 404 })
		}

		const token = rows[0]

		return Response.json({
			success: true,
			data: {
				characterId: token.character_id,
				characterName: token.character_name,
				proxyToken: token.proxy_token,
				scopes: token.scopes,
				expiresAt: token.expires_at,
				createdAt: token.created_at,
				updatedAt: token.updated_at,
			},
		})
	}

	private async deleteByProxyToken(proxyToken: string): Promise<Response> {
		await this.ensureSchema()

		// First check if the token exists
		const rows = await this.ctx.storage.sql
			.exec<TokenData>(`SELECT character_id FROM tokens WHERE proxy_token = ?`, proxyToken)
			.toArray()

		if (rows.length === 0) {
			return Response.json({ success: false, error: 'Token not found' }, { status: 404 })
		}

		const characterId = rows[0].character_id

		// Delete the entire token set
		await this.ctx.storage.sql.exec(`DELETE FROM tokens WHERE proxy_token = ?`, proxyToken)

		logger
			.withTags({
				type: 'token_deleted_by_proxy',
				character_id: characterId,
			})
			.info('Token deleted by proxy token', { characterId, proxyToken: proxyToken.substring(0, 8) })

		return Response.json({ success: true })
	}

	private async getStats(): Promise<Response> {
		await this.ensureSchema()

		const now = Date.now()

		// Get total count
		const totalRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM tokens')
			.toArray()
		const totalCount = totalRows[0]?.count || 0

		// Get expired count
		const expiredRows = await this.ctx.storage.sql
			.exec<{ count: number }>('SELECT COUNT(*) as count FROM tokens WHERE expires_at < ?', now)
			.toArray()
		const expiredCount = expiredRows[0]?.count || 0

		const activeCount = totalCount - expiredCount

		return Response.json({
			success: true,
			data: {
				stats: {
					totalCount,
					expiredCount,
					activeCount,
				},
			},
		})
	}
}
