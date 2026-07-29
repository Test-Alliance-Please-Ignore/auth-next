import { Hono } from 'hono'

import { logger } from '@repo/hono-helpers'

import { getDiscordStatus } from '../lib/discord-helpers'
import { normalizeWorkflowStatus } from '../lib/workflow-status'
import { triggerDiscordRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAuth } from '../middleware/session'
import * as discordService from '../services/discord.service'

import type { App } from '../context'

/**
 * Discord routes
 *
 * Handles Discord account linking for authenticated users.
 */
const discord = new Hono<App>()

type PublicDiscordRefreshReason = 'authorization' | 'configuration' | 'temporary' | 'unknown'

function classifyDiscordRefreshReason(output: object): PublicDiscordRefreshReason {
	const messages: string[] = []
	if ('error' in output && output.error && typeof output.error === 'object' && 'message' in output.error) {
		messages.push(String(output.error.message))
	}
	if ('results' in output && Array.isArray(output.results)) {
		for (const result of output.results) {
			if (result && typeof result === 'object' && 'errorMessage' in result) {
				messages.push(String(result.errorMessage))
			}
		}
	}

	const message = messages.join(' ').toLowerCase()
	if (/(unauthor|forbidden|revok|token|oauth|access denied)/.test(message)) return 'authorization'
	if (/(permission|role|not configured|configuration|managed guild)/.test(message)) return 'configuration'
	if (/(timeout|rate limit|temporar|unavailable|network|fetch|gateway|service)/.test(message)) {
		return 'temporary'
	}
	return 'unknown'
}

/**
 * Start Discord linking flow (PKCE)
 * POST /api/discord/link/start
 * Requires authentication
 * Returns: { state: string } - state parameter for CSRF protection
 */
discord.post('/link/start', requireAuth(), async (c) => {
	const user = c.get('user')!

	// Check if user already has Discord linked and authorization is still valid
	const discordStatus = await getDiscordStatus(c)
	if (discordStatus && !discordStatus.authRevoked) {
		return c.json(
			{
				error: 'Discord account already linked',
			},
			400
		)
	}

	try {
		const state = await discordService.startLinkFlow(c.env, user.id)

		return c.json({ state })
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
 * Handle Discord OAuth tokens from client (PKCE flow)
 * POST /api/discord/callback/tokens
 * Requires authentication
 * Body: { accessToken, refreshToken, expiresIn, scope, state }
 * The client exchanges the code for tokens directly with Discord,
 * then sends the tokens here for validation and storage.
 */
discord.post('/callback/tokens', requireAuth(), async (c) => {
	const user = c.get('user')!

	try {
		const body = await c.req.json<{
			accessToken: string
			refreshToken: string
			expiresIn: number
			scope: string
			state: string
		}>()

		const { accessToken, refreshToken, expiresIn, scope, state } = body

		if (!accessToken || !state) {
			return c.json({ error: 'Missing required parameters' }, 400)
		}

		logger.info('Received tokens from client', { userId: user.id, state, scope })

		// Handle the tokens (validate state and store)
		const result = await discordService.handleTokens(
			c.env,
			user.id,
			accessToken,
			refreshToken,
			expiresIn,
			scope,
			state
		)

		logger.info('Token handling result', { success: result.success, error: result.error })

		if (!result.success) {
			const status = result.error === 'Account suspended' ? 403 : 400
			return c.json({ error: result.error || 'Failed to link Discord' }, status)
		}

		return c.json({ success: true })
	} catch (error) {
		logger.error('Error handling Discord tokens:', error)
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to handle Discord tokens',
			},
			500
		)
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

/**
 * Join user to corporation Discord servers
 * POST /api/discord/join-servers
 * Requires authentication
 *
 * Automatically joins the authenticated user to Discord servers for all
 * managed corporations they are a member of (if auto-invite is enabled).
 *
 * Returns: {
 *   results: Array<{
 *     guildId: string,
 *     guildName: string,
 *     corporationName: string,
 *     success: boolean,
 *     errorMessage?: string,
 *     alreadyMember?: boolean
 *   }>,
 *   totalInvited: number,
 *   totalFailed: number
 * }
 */
discord.post('/join-servers', requireAuth(), async (c) => {
	const user = c.get('user')!

	const result = await triggerDiscordRefreshWorkflow({
		env: c.env,
		userId: user.id,
		source: 'user-manual',
	})
	if (result.status === 'failed' || !result.workflowInstanceId) {
		logger.error('Error starting Discord access refresh:', { userId: user.id, error: result.error })
		return c.json({ error: 'Unable to start Discord access refresh' }, 500)
	}

	return c.json({ status: 'queued', workflowInstanceId: result.workflowInstanceId }, 202)
})

discord.get('/join-servers/:workflowInstanceId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const workflowInstanceId = c.req.param('workflowInstanceId')
	const userToken = user.id.replace(/-/g, '')
	const expectedWorkflowPrefix = `discord-refresh-user-manual-${userToken}-`
	if (!workflowInstanceId.startsWith(expectedWorkflowPrefix)) {
		return c.json({ error: 'Workflow not found' }, 404)
	}

	try {
		const workflow = await c.env.USER_DISCORD_REFRESH_WORKFLOW.get(workflowInstanceId)
		const status = await workflow.status()
		const output = status.output ?? null
		if (output && typeof output === 'object' && 'userId' in output && output.userId !== user.id) {
			return c.json({ error: 'Workflow not found' }, 404)
		}
		const outputStatus =
			output && typeof output === 'object' && 'status' in output
				? String((output as { status?: string }).status ?? '')
				: undefined
		const publicOutput =
			output && typeof output === 'object'
				? {
						status: outputStatus === 'failed' ? 'failed' : 'completed',
						totalInvited:
							'totalInvited' in output && typeof output.totalInvited === 'number'
								? output.totalInvited
								: 0,
						totalUpdated:
							'totalUpdated' in output && typeof output.totalUpdated === 'number'
								? output.totalUpdated
								: 0,
						totalFailed:
							'totalFailed' in output && typeof output.totalFailed === 'number'
									? output.totalFailed
									: 0,
						reason: classifyDiscordRefreshReason(output),
					}
				: null
		return c.json({
			workflowInstanceId,
			status: normalizeWorkflowStatus(status.status, outputStatus),
			output: publicOutput,
		})
	} catch (error) {
		logger.error('Error reading Discord access refresh status:', {
			userId: user.id,
			workflowInstanceId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Unable to confirm Discord access refresh status' }, 502)
	}
})

export default discord
