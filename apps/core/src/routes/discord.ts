import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'

import { requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'

import type { App } from '../context'

/**
 * Discord routes
 *
 * Handles Discord account linking for authenticated users.
 */
const discord = new Hono<App>()

/**
 * Start Discord linking flow
 * POST /api/discord/link/start
 * Requires authentication
 * Returns: { url: string }
 */
discord.post('/link/start', requireAuth(), async (c) => {
	const user = c.get('user')!

	// Check if user already has Discord linked
	if (user.discord) {
		return c.json(
			{
				error: 'Discord account already linked',
			},
			400
		)
	}

	try {
		const url = await discordService.startLinkFlow(c.env, user.id)

		return c.json({ url })
	} catch (error) {
		logger.error('Error starting Discord link flow:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to start Discord linking',
			},
			500
		)
	}
})

/**
 * Handle Discord OAuth callback
 * GET /api/discord/callback?code=XXX&state=YYY
 * Does NOT require authentication - state parameter provides security
 * The state is validated against the database and contains the user ID,
 * making this secure without requiring a session cookie in the popup window.
 * Returns: Redirects to /discord/callback with success or error parameter
 */
discord.get('/callback', async (c) => {
	const code = c.req.query('code')
	const state = c.req.query('state')

	if (!code || !state) {
		return c.redirect('/discord/callback?error=' + encodeURIComponent('Missing code or state parameter'))
	}

	try {
		logger.info('Discord callback received', { code: code.substring(0, 10) + '...', state })

		// State validation in handleCallback provides security
		// It verifies: state exists in DB, not expired, correct flow type, and extracts user ID
		const result = await discordService.handleCallback(c.env, code, state)

		logger.info('Discord callback result', { success: result.success, userId: result.userId, error: result.error })

		if (!result.success) {
			// Redirect to frontend callback page with error
			return c.redirect(`/discord/callback?error=${encodeURIComponent(result.error || 'Unknown error')}`)
		}

		// Redirect to frontend callback page (success)
		return c.redirect('/discord/callback')
	} catch (error) {
		logger.error('Error handling Discord callback:', error)
		// Redirect to frontend callback page with error
		return c.redirect(`/discord/callback?error=${encodeURIComponent(error instanceof Error ? error.message : 'Failed to handle Discord callback')}`)
	}
})

/**
 * Get current user's Discord profile
 * GET /api/discord/profile
 * Requires authentication
 * Returns: { userId: string, username: string, discriminator: string, scopes: string[] } | null
 */
discord.get('/profile', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const profile = await discordService.getProfile(c.env, user.id)

		if (!profile) {
			return c.json({ error: 'Discord profile not found' }, 404)
		}

		return c.json(profile)
	} catch (error) {
		logger.error('Error getting Discord profile:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to get Discord profile',
			},
			500
		)
	}
})

/**
 * Refresh Discord OAuth token
 * POST /api/discord/refresh
 * Requires authentication
 * Returns: { success: boolean }
 */
discord.post('/refresh', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const success = await discordService.refreshToken(c.env, user.id)

		return c.json({ success })
	} catch (error) {
		logger.error('Error refreshing Discord token:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to refresh Discord token',
			},
			500
		)
	}
})

export default discord
