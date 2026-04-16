import { Hono } from 'hono'
import type { Context } from 'hono'

import type { App } from '../context'

const THIRTY_DAYS = 2592000
const EVE_IMAGE_BASE = 'https://images.evetech.net'

const PORTRAIT_SIZES = [32, 64, 128, 256, 512] as const
const LOGO_SIZES = [32, 64, 128, 256] as const
const TYPE_ICON_SIZES = [32, 64] as const
const TYPE_RENDER_SIZES = [32, 64, 128, 256, 512] as const
const VALID_TYPE_VARIANTS = ['icon', 'render', 'bp', 'bpc'] as const

type TypeVariant = (typeof VALID_TYPE_VARIANTS)[number]

const VARIANT_SIZES: Record<TypeVariant, readonly number[]> = {
	icon: TYPE_ICON_SIZES,
	render: TYPE_RENDER_SIZES,
	bp: TYPE_ICON_SIZES,
	bpc: TYPE_ICON_SIZES,
}

async function proxyImage(
	c: Context<App>,
	upstreamUrl: string,
	cacheKeyPath: string
): Promise<Response> {
	const cacheKey = new Request(`https://cache.internal/${cacheKeyPath}`, { method: 'GET' })
	const cache = await caches.open('eve-images')

	const cachedResponse = await cache.match(cacheKey)
	if (cachedResponse) {
		return cachedResponse
	}

	const response = await fetch(upstreamUrl)
	if (!response.ok) {
		return c.json({ error: 'Failed to fetch image' }, 502)
	}

	const imageResponse = new Response(response.body, {
		status: 200,
		headers: {
			'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
			'Cache-Control': `public, max-age=${THIRTY_DAYS}`,
			'Cloudflare-CDN-Cache-Control': `max-age=${THIRTY_DAYS}`,
		},
	})

	c.executionCtx.waitUntil(cache.put(cacheKey, imageResponse.clone()))
	return imageResponse
}

const app = new Hono<App>()
	// Character portraits: /images/characters/:characterId/portrait
	.get('/characters/:characterId/portrait', async (c) => {
		const characterId = c.req.param('characterId')
		const size = parseInt(c.req.query('size') || '128', 10)

		if (!/^\d+$/.test(characterId)) {
			return c.json({ error: 'Invalid character ID' }, 400)
		}
		if (!(PORTRAIT_SIZES as readonly number[]).includes(size)) {
			return c.json({ error: `Invalid size. Valid sizes: ${PORTRAIT_SIZES.join(', ')}` }, 400)
		}

		return proxyImage(
			c,
			`${EVE_IMAGE_BASE}/characters/${characterId}/portrait?size=${size}`,
			`characters/${characterId}/portrait/${size}`
		)
	})

	// Corporation logos: /images/corporations/:corporationId/logo
	.get('/corporations/:corporationId/logo', async (c) => {
		const corporationId = c.req.param('corporationId')
		const size = parseInt(c.req.query('size') || '64', 10)

		if (!/^\d+$/.test(corporationId)) {
			return c.json({ error: 'Invalid corporation ID' }, 400)
		}
		if (!(LOGO_SIZES as readonly number[]).includes(size)) {
			return c.json({ error: `Invalid size. Valid sizes: ${LOGO_SIZES.join(', ')}` }, 400)
		}

		return proxyImage(
			c,
			`${EVE_IMAGE_BASE}/corporations/${corporationId}/logo?size=${size}`,
			`corporations/${corporationId}/logo/${size}`
		)
	})

	// Alliance logos: /images/alliances/:allianceId/logo
	.get('/alliances/:allianceId/logo', async (c) => {
		const allianceId = c.req.param('allianceId')
		const size = parseInt(c.req.query('size') || '64', 10)

		if (!/^\d+$/.test(allianceId)) {
			return c.json({ error: 'Invalid alliance ID' }, 400)
		}
		if (!(LOGO_SIZES as readonly number[]).includes(size)) {
			return c.json({ error: `Invalid size. Valid sizes: ${LOGO_SIZES.join(', ')}` }, 400)
		}

		return proxyImage(
			c,
			`${EVE_IMAGE_BASE}/alliances/${allianceId}/logo?size=${size}`,
			`alliances/${allianceId}/logo/${size}`
		)
	})

	// Type images: /images/types/:typeId/:variant (icon, render, bp, bpc)
	.get('/types/:typeId/:variant', async (c) => {
		const typeId = c.req.param('typeId')
		const variant = c.req.param('variant') as TypeVariant
		const size = parseInt(c.req.query('size') || '32', 10)

		if (!/^\d+$/.test(typeId)) {
			return c.json({ error: 'Invalid type ID' }, 400)
		}
		if (!(VALID_TYPE_VARIANTS as readonly string[]).includes(variant)) {
			return c.json(
				{ error: `Invalid variant. Valid variants: ${VALID_TYPE_VARIANTS.join(', ')}` },
				400
			)
		}

		const validSizes = VARIANT_SIZES[variant]
		if (!(validSizes as readonly number[]).includes(size)) {
			return c.json({ error: `Invalid size. Valid sizes: ${validSizes.join(', ')}` }, 400)
		}

		return proxyImage(
			c,
			`${EVE_IMAGE_BASE}/types/${typeId}/${variant}?size=${size}`,
			`types/${typeId}/${variant}/${size}`
		)
	})

export default app
