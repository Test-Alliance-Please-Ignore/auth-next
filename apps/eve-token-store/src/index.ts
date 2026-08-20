import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { logger, withNotFound, withOnError, withWorkersLogger } from '@repo/hono-helpers'

import { EveTokenStoreDO } from './durable-object'
import {
	hasMaintenanceSecret,
	isLegacyCachePurgeConfirmed,
	LEGACY_CACHE_PURGE_CONFIRMATION,
} from './lib/legacy-storage-maintenance'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from './context'

// TEMPORARY ONE-TIME MAINTENANCE ROUTE.
// Remove this route and its secret after the legacy cache purge is verified.
const LEGACY_CACHE_MAINTENANCE_PATH = '/evesso/_maintenance/storage'
const MAINTENANCE_SECRET_HEADER = 'X-Eve-Token-Store-Maintenance-Secret'

const app = new Hono<App>()
	.use('*', (c, next) =>
		withWorkersLogger(c.env.NAME, {
			environment: c.env.ENVIRONMENT,
			release: c.env.SENTRY_RELEASE,
		})(c, next)
	)

	.onError(withOnError())
	.notFound(withNotFound())

	.get('/', async (c) => {
		return c.text('EVE Token Store - OAuth Service for EVE Online SSO')
	})

	/**
	 * Start login flow (publicData scope only)
	 * Redirects user to EVE SSO for authentication
	 */
	.get('/evesso/login', async (c) => {
		try {
			// Get the Durable Object stub
			const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

			// Optional state parameter from query
			const state = c.req.query('state')

			// Start login flow
			const result = await stub.startLoginFlow(state)

			// Redirect to EVE SSO
			return c.redirect(result.url)
		} catch (error) {
			logger.error(error)
			return c.json(
				{
					error: 'Failed to start login flow',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			)
		}
	})

	/**
	 * Start character attachment flow (all scopes)
	 * Redirects user to EVE SSO for authentication with full permissions
	 */
	.get('/evesso/character', async (c) => {
		try {
			// Get the Durable Object stub
			const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

			// Optional state parameter from query
			const state = c.req.query('state')

			// Start character flow
			const result = await stub.startCharacterFlow(state)

			// Redirect to EVE SSO
			return c.redirect(result.url)
		} catch (error) {
			logger.error(error)
			return c.json(
				{
					error: 'Failed to start character flow',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			)
		}
	})

	/**
	 * OAuth callback endpoint
	 * Receives authorization code from EVE SSO and exchanges it for tokens
	 */
	.get('/evesso/callback', async (c) => {
		try {
			// Get authorization code from query parameters
			const code = c.req.query('code')
			const state = c.req.query('state')
			const error = c.req.query('error')
			const errorDescription = c.req.query('error_description')

			// Check for OAuth errors
			if (error) {
				logger.withTags({ error, errorDescription }).error('OAuth error')
				return c.json(
					{
						error: 'OAuth failed',
						message: errorDescription || error,
					},
					400
				)
			}

			// Validate code parameter
			if (!code) {
				return c.json(
					{
						error: 'Missing authorization code',
						message: 'The authorization code is required',
					},
					400
				)
			}

			// Get the Durable Object stub
			const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

			// Handle callback
			const result = await stub.handleCallback(code, state)

			if (!result.success) {
				return c.json(
					{
						error: 'Failed to handle callback',
						message: result.error,
					},
					500
				)
			}

			// Return success response with character information
			return c.json({
				success: true,
				characterOwnerHash: result.characterInfo?.characterOwnerHash,
				character: result.characterInfo,
				message: 'Successfully authenticated with EVE Online',
			})
		} catch (error) {
			logger.error(error)
			return c.json(
				{
					error: 'Failed to process callback',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			)
		}
	})

	/**
	 * TEMPORARY ONE-TIME MAINTENANCE ROUTE.
	 *
	 * GET inventories aggregate storage metadata. POST drops only the explicitly
	 * allowlisted legacy cache tables after requiring a second confirmation.
	 * This route is intentionally outside the normal application API surface.
	 */
	.get(LEGACY_CACHE_MAINTENANCE_PATH, async (c) => {
		if (
			!hasMaintenanceSecret(
				c.env.EVE_TOKEN_STORE_MAINTENANCE_SECRET,
				c.req.header(MAINTENANCE_SECRET_HEADER)
			)
		) {
			return c.json({ error: 'Not found' }, 404)
		}

		try {
			const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
			const inventory = await stub.inspectLegacyStorage()
			c.header('Cache-Control', 'no-store')
			return c.json(inventory)
		} catch (error) {
			logger
				.withTags({ operation: 'inspectLegacyStorage' })
				.error('Legacy storage inspection failed', error)
			return c.json({ error: 'Storage inspection failed' }, 500)
		}
	})
	.post(LEGACY_CACHE_MAINTENANCE_PATH, async (c) => {
		if (
			!hasMaintenanceSecret(
				c.env.EVE_TOKEN_STORE_MAINTENANCE_SECRET,
				c.req.header(MAINTENANCE_SECRET_HEADER)
			)
		) {
			return c.json({ error: 'Not found' }, 404)
		}

		const body = await c.req.json<{ action?: string; confirmation?: string }>().catch(() => null)
		if (body?.action !== 'purge-legacy-cache' || !isLegacyCachePurgeConfirmed(body.confirmation)) {
			return c.json(
				{
					error: 'Invalid maintenance request',
					requiredAction: 'purge-legacy-cache',
					requiredConfirmation: LEGACY_CACHE_PURGE_CONFIRMATION,
				},
				400
			)
		}

		try {
			const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
			const result = await stub.purgeLegacyCache(body.confirmation ?? '')
			c.header('Cache-Control', 'no-store')
			return c.json(result)
		} catch (error) {
			logger.withTags({ operation: 'purgeLegacyCache' }).error('Legacy storage purge failed', error)
			return c.json({ error: 'Storage purge failed' }, 500)
		}
	})

export default app

// Export the Durable Object class
export { EveTokenStoreDO as EveTokenStore }
