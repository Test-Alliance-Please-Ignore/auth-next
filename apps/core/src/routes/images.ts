import { Hono } from 'hono'

import type { App } from '../context'

const THIRTY_DAYS = 2592000

// Valid portrait sizes from EVE image server
const VALID_SIZES = [64, 128, 256, 512] as const
type PortraitSize = (typeof VALID_SIZES)[number]

const app = new Hono<App>()
	// Character portraits: /images/characters/:characterId/portrait
	.get('/characters/:characterId/portrait', async (c) => {
		const characterId = c.req.param('characterId')
		const sizeParam = c.req.query('size') || '128'
		const size = parseInt(sizeParam, 10) as PortraitSize

		// Validate character ID (must be numeric)
		if (!/^\d+$/.test(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}

		// Validate size
		if (!VALID_SIZES.includes(size)) {
			return c.json({ error: `Invalid size. Valid sizes: ${VALID_SIZES.join(', ')}` }, 400)
		}

		// Create a normalized cache key (strips headers, normalizes URL)
		const cacheKey = new Request(
			`https://cache.internal/characters/${characterId}/portrait/${size}`,
			{ method: 'GET' }
		)

		// Check Cloudflare Cache API first
		const cache = await caches.open('eve-images')
		const cachedResponse = await cache.match(cacheKey)
		if (cachedResponse) {
			return cachedResponse
		}

		// Fetch from EVE image server
		const imageUrl = `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`
		const response = await fetch(imageUrl)

		if (!response.ok) {
			return c.json({ error: 'Failed to fetch portrait' }, 502)
		}

		// Build response with aggressive caching headers
		const imageResponse = new Response(response.body, {
			status: 200,
			headers: {
				'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
				'Cache-Control': `public, max-age=${THIRTY_DAYS}`,
				'Cloudflare-CDN-Cache-Control': `max-age=${THIRTY_DAYS}`,
			},
		})

		// Store in Cloudflare Cache API (non-blocking)
		c.executionCtx.waitUntil(cache.put(cacheKey, imageResponse.clone()))

		return imageResponse
	})

export default app
