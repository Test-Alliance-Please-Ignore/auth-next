import { eq } from '@repo/db-utils'
import type { Context, Next } from 'hono'

import { createDb } from '../db'
import { apiKeys } from '../db/schema'

import type { App } from '../context'

/**
 * In-memory cache for validated API keys
 * Reduces database lookups for frequently used keys
 */
interface ApiKeyCache {
	id: string
	name: string
	isActive: boolean
	expiresAt: number // Unix timestamp
}

const keyCache = new Map<string, ApiKeyCache>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Clean expired entries from cache
 */
function cleanExpiredCache() {
	const now = Date.now()
	for (const [key, value] of keyCache.entries()) {
		if (value.expiresAt < now) {
			keyCache.delete(key)
		}
	}
}

/**
 * Extract bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
	if (!authHeader) {
		return null
	}

	const parts = authHeader.split(' ')
	if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
		return null
	}

	return parts[1]
}

/**
 * Database-aware authentication middleware
 * Validates API keys against the database with in-memory caching
 */
export async function withDatabaseAuth(c: Context<App>, next: Next) {
	const authHeader = c.req.header('Authorization')
	const token = extractBearerToken(authHeader)

	if (!token) {
		console.warn('[auth] Missing or invalid Authorization header')
		return c.json(
			{
				error: 'Authorization header is required',
				meta: {
					requestId: c.get('requestId'),
					timestamp: new Date().toISOString(),
					version: '1',
				},
			},
			401
		)
	}

	// Check cache first
	cleanExpiredCache()
	const cached = keyCache.get(token)

	if (cached) {
		if (!cached.isActive) {
			console.warn(`[auth] API key inactive (cached): ${cached.name}`)
			return c.json(
				{
					error: 'API key is inactive',
					meta: {
						requestId: c.get('requestId'),
						timestamp: new Date().toISOString(),
						version: '1',
					},
				},
				403
			)
		}

		// Set context variables for downstream handlers
		c.set('apiKeyId', cached.id)
		c.set('apiKeyName', cached.name)
		await next()
		return
	}

	// Cache miss - query database
	try {
		const db = createDb(c.env.DATABASE_URL)

		const [apiKey] = await db.select().from(apiKeys).where(eq(apiKeys.key, token)).limit(1)

		if (!apiKey) {
			console.warn('[auth] Invalid API key')
			return c.json(
				{
					error: 'Invalid API key',
					meta: {
						requestId: c.get('requestId'),
						timestamp: new Date().toISOString(),
						version: '1',
					},
				},
				403
			)
		}

		if (!apiKey.isActive) {
			console.warn(`[auth] API key inactive: ${apiKey.name}`)

			// Cache inactive keys too (prevents repeated DB lookups for disabled keys)
			keyCache.set(token, {
				id: apiKey.id,
				name: apiKey.name,
				isActive: false,
				expiresAt: Date.now() + CACHE_TTL,
			})

			return c.json(
				{
					error: 'API key is inactive',
					meta: {
						requestId: c.get('requestId'),
						timestamp: new Date().toISOString(),
						version: '1',
					},
				},
				403
			)
		}

		// Cache valid key
		keyCache.set(token, {
			id: apiKey.id,
			name: apiKey.name,
			isActive: true,
			expiresAt: Date.now() + CACHE_TTL,
		})

		// Update last used timestamp (fire and forget)
		db.update(apiKeys)
			.set({
				lastUsedAt: new Date(),
				requestCount: apiKey.requestCount + 1,
				updatedAt: new Date(),
			})
			.where(eq(apiKeys.id, apiKey.id))
			.execute()
			.catch((error) => {
				console.error('[auth] Failed to update lastUsedAt:', error)
				// Don't fail the request if we can't update usage stats
			})

		// Set context variables for downstream handlers
		c.set('apiKeyId', apiKey.id)
		c.set('apiKeyName', apiKey.name)

		console.log(`[auth] API key validated: ${apiKey.name}`)
		await next()
	} catch (error) {
		console.error('[auth] Database error during authentication:', error)
		return c.json(
			{
				error: 'Authentication service unavailable',
				meta: {
					requestId: c.get('requestId'),
					timestamp: new Date().toISOString(),
					version: '1',
				},
			},
			500
		)
	}
}
