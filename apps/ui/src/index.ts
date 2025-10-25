/**
 * UI Worker - Serves React SPA via Cloudflare Workers Static Assets
 *
 * Implements intelligent cache control to ensure users always get the latest version:
 * - HTML files: Never cached (no-cache) - ensures new deployments are visible immediately
 * - Hashed assets: Cached forever (immutable) - safe because content hash changes with updates
 * - Other assets: Cached with revalidation - balance between performance and freshness
 */

import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'

const app = new Hono<App>()
	.use('*', (c, next) =>
		useWorkersLogger(c.env.NAME, {
			environment: c.env.ENVIRONMENT,
			release: c.env.SENTRY_RELEASE,
		})(c, next)
	)
	.onError(withOnError())
	.notFound(withNotFound())

	.get('*', async (c) => {
		const url = new URL(c.req.url)

		// Fetch the asset from the ASSETS binding
		const response = await c.env.ASSETS.fetch(c.req.raw)

		// Clone the response so we can modify headers
		const newResponse = new Response(response.body, response)

		// HTML files and root path: Never cache (always revalidate with server)
		// This ensures users always get the latest index.html with updated asset references
		if (url.pathname.endsWith('.html') || url.pathname === '/') {
			newResponse.headers.set('Cache-Control', 'no-cache, must-revalidate, max-age=0')
			newResponse.headers.set('Pragma', 'no-cache')
			newResponse.headers.set('Expires', '0')
		}
		// Hashed assets (JS/CSS/fonts with content hash in filename): Cache forever
		// Safe to cache indefinitely because the hash changes when content changes
		// Regex matches files like: index-Ci9blN3p.js, main-abc123def.css
		else if (/\.[a-z0-9]{8,}\.(js|css|woff2?|ttf|eot)$/i.test(url.pathname)) {
			newResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
		}
		// Other static assets (images, SVGs, fonts without hash): Cache with revalidation
		// 24 hour cache with must-revalidate for assets that might change
		else if (/\.(png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp)$/i.test(url.pathname)) {
			newResponse.headers.set('Cache-Control', 'public, max-age=86400, must-revalidate')
		}

		return newResponse
	})

export default app
