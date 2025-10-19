import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
import { withNotFound, withOnError } from '@repo/hono-helpers'

import { EveTokenStoreDO } from './durable-object'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { App } from './context'

const app = new Hono<App>()
	.use(
		'*',
		// middleware
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
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
			console.error('Error starting login flow:', error)
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
			console.error('Error starting character flow:', error)
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
				console.error('OAuth error:', error, errorDescription)
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
				characterOwnerHash: result.characterOwnerHash,
				character: result.characterInfo,
				message: 'Successfully authenticated with EVE Online',
			})
		} catch (error) {
			console.error('Error handling callback:', error)
			return c.json(
				{
					error: 'Failed to process callback',
					message: error instanceof Error ? error.message : 'Unknown error',
				},
				500
			)
		}
	})

export default app

// Export the Durable Object class
export { EveTokenStoreDO as EveTokenStore }
