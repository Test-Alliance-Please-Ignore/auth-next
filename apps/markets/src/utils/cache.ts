import type { Context, Next } from 'hono'

import type { App } from '../context'

/**
 * Generate cache key for Cloudflare Cache API
 */
export function generateCacheKey(
	version: string,
	endpoint: string,
	params: Record<string, string | string[]>
): string {
	// Sort keys for consistent cache keys
	const sortedKeys = Object.keys(params).sort()

	// Build param string
	const paramStr = sortedKeys
		.map((key) => {
			const value = params[key]
			if (Array.isArray(value)) {
				// Hash arrays (for typeIds) to keep key short
				const hash = hashString(value.join(','))
				return `${key}=${hash}`
			}
			return `${key}=${value}`
		})
		.join('&')

	return `${version}:${endpoint}:${paramStr}`
}

/**
 * Simple hash function for cache key generation
 */
function hashString(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(36)
}

/**
 * Get TTL (in seconds) for different endpoint patterns
 */
export function getCacheTTL(path: string): number {
	if (path.includes('/prices')) {
		return 300 // 5 minutes
	}

	if (path.includes('/orders')) {
		return 3600 // 1 hour (historical data)
	}

	if (path.includes('/snapshots') && !path.includes('/refresh')) {
		return 900 // 15 minutes
	}

	if (path.includes('/refresh')) {
		return 60 // 1 minute
	}

	if (path.includes('/types/')) {
		return 1800 // 30 minutes
	}

	return 300 // Default: 5 minutes
}

/**
 * Cache middleware using Cloudflare Cache API
 * Only caches GET and POST requests with 200 responses
 */
export function withCache() {
	return async (c: Context<App>, next: Next) => {
		const method = c.req.method
		const path = c.req.path

		// Only cache GET and POST requests
		if (method !== 'GET' && method !== 'POST') {
			await next()
			return
		}

		// Build cache key
		const params: Record<string, string | string[]> = {}

		// Add query parameters
		for (const [key, value] of Object.entries(c.req.query())) {
			params[key] = value
		}

		// For POST requests, include body in cache key
		if (method === 'POST') {
			try {
				const body = await c.req.json()
				if (body.typeIds && Array.isArray(body.typeIds)) {
					params.typeIds = body.typeIds
				}
				if (body.snapshotId) {
					params.snapshotId = body.snapshotId
				}
			} catch {
				// If we can't parse body, don't cache
				await next()
				return
			}
		}

		const cacheKey = generateCacheKey('v1', path, params)
		const cacheUrl = new URL(`https://cache.markets/${cacheKey}`)

		// Check cache
		const cache = caches.default
		const cachedResponse = await cache.match(cacheUrl)

		if (cachedResponse) {
			console.log(`[cache] HIT: ${path}`)
			// Add header to indicate cache hit
			const response = new Response(cachedResponse.body, cachedResponse)
			response.headers.set('X-Cache', 'HIT')
			return response
		}

		console.log(`[cache] MISS: ${path}`)

		// Process request
		await next()

		// Only cache successful responses
		if (c.res.status === 200) {
			const ttl = getCacheTTL(path)

			// Clone response for caching
			const responseToCache = c.res.clone()

			// Add cache control headers
			c.header('Cache-Control', `public, max-age=${ttl}`)
			c.header('X-Cache', 'MISS')

			// Store in cache (fire and forget)
			cache.put(cacheUrl, responseToCache).catch((error) => {
				console.error('[cache] Failed to store in cache:', error)
			})
		}
	}
}
