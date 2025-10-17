import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getRequestLogData, logger, withNotFound, withOnError } from '@repo/hono-helpers'

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

// ========== Authentication Middleware ==========

// Middleware to verify session via social-auth worker
const withAuth = async (c: any, next: any) => {
	const sessionId = getCookie(c, 'session_id')

	if (!sessionId) {
		return c.json({ error: 'Not authenticated' }, 401)
	}

	try {
		// Call social-auth worker to verify session
		const response = await c.env.SOCIAL_AUTH.fetch(
			new Request('http://social-auth/api/session/verify', {
				method: 'POST',
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			})
		)

		if (!response.ok) {
			return c.json({ error: 'Invalid session' }, 401)
		}

		const data = (await response.json()) as {
			success: boolean
			session: { socialUserId: string; isAdmin?: boolean }
		}

		if (!data.success || !data.session) {
			return c.json({ error: 'Invalid session' }, 401)
		}

		// Store user ID in context for use in routes
		c.set('sessionUserId', data.session.socialUserId)

		await next()
	} catch (error) {
		logger.error('Session verification error', { error: String(error) })
		return c.json({ error: 'Failed to verify session' }, 500)
	}
}

// Admin auth middleware
const withAdminAuth = async (c: any, next: any) => {
	const sessionId = getCookie(c, 'session_id')

	if (!sessionId) {
		return c.json({ error: 'Not authenticated' }, 401)
	}

	try {
		const response = await c.env.SOCIAL_AUTH.fetch(
			new Request('http://social-auth/api/session/verify', {
				method: 'POST',
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			})
		)

		if (!response.ok) {
			return c.json({ error: 'Not authorized' }, 403)
		}

		const data = (await response.json()) as {
			success: boolean
			session: { socialUserId: string; isAdmin: boolean }
		}

		if (!data.success || !data.session) {
			return c.json({ error: 'Not authorized' }, 403)
		}

		if (!data.session.isAdmin) {
			return c.json({ error: 'Admin access required' }, 403)
		}

		// Store user ID in context
		c.set('sessionUserId', data.session.socialUserId)

		await next()
	} catch (error) {
		logger.error('Admin auth check failed', { error: String(error) })
		return c.json({ error: 'Failed to verify permissions' }, 500)
	}
}

// Helper to get TagStore instance
const getTagStore = (c: any) => {
	const id = c.env.TAG_STORE.idFromName('global')
	return c.env.TAG_STORE.get(id)
}

// ========== Public API Endpoints ==========

app
	// Get all tags for a user (deduplicated)
	.get('/api/tags/:userId', withAuth, async (c) => {
		const userId = c.req.param('userId')
		const requestingUserId = c.get('sessionUserId')!

		// Users can only view their own tags unless admin
		if (userId !== requestingUserId) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		try {
			const tagStore = getTagStore(c)
			const tags = await tagStore.getUserTags(userId)

			return c.json({
				success: true,
				tags,
			})
		} catch (error) {
			logger.error('Get user tags error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get tags with display formatting for UI
	.get('/api/tags/:userId/display', withAuth, async (c) => {
		const userId = c.req.param('userId')
		const requestingUserId = c.get('sessionUserId')!

		// Users can only view their own tags unless admin
		if (userId !== requestingUserId) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		try {
			const tagStore = getTagStore(c)
			const tags = await tagStore.getUserTags(userId)

			// Format for UI display
			const displayTags = tags.map((tag) => ({
				urn: tag.tagUrn,
				displayName: tag.displayName,
				type: tag.tagType,
				color: tag.color,
				metadata: tag.metadata,
				sourceCharacters: tag.sourceCharacters,
			}))

			return c.json({
				success: true,
				tags: displayTags,
			})
		} catch (error) {
			logger.error('Get user tags display error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get tags with detailed assignment info
	.get('/api/tags/:userId/detailed', withAuth, async (c) => {
		const userId = c.req.param('userId')
		const requestingUserId = c.get('sessionUserId')!

		// Users can only view their own tags unless admin
		if (userId !== requestingUserId) {
			return c.json({ error: 'Permission denied' }, 403)
		}

		try {
			const tagStore = getTagStore(c)
			const tags = await tagStore.getUserTags(userId)
			const assignments = await tagStore.getUserTagAssignments(userId)

			return c.json({
				success: true,
				tags,
				assignments,
			})
		} catch (error) {
			logger.error('Get user tags detailed error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

// ========== System Endpoints (Service-to-Service) ==========

app
	// Handle character onboarding
	.post('/api/tags/onboard', async (c) => {
		try {
			const body = (await c.req.json()) as {
				socialUserId: string
				characterId: number
				corporationId: number
				corporationName: string
				allianceId?: number | null
				allianceName?: string | null
			}

			if (!body.socialUserId || !body.characterId || !body.corporationId) {
				return c.json({ error: 'Missing required fields' }, 400)
			}

			const tagStore = getTagStore(c)

			// Create/update corporation tag
			const corpUrn = `urn:eve:corporation:${body.corporationId}`
			await tagStore.upsertTag(corpUrn, 'corporation', body.corporationName, body.corporationId, {
				corporationId: body.corporationId,
			})

			// Assign corporation tag to user
			await tagStore.assignTagToUser(body.socialUserId, corpUrn, body.characterId)

			// Create/update alliance tag if applicable
			if (body.allianceId && body.allianceName) {
				const allianceUrn = `urn:eve:alliance:${body.allianceId}`
				await tagStore.upsertTag(
					allianceUrn,
					'alliance',
					body.allianceName,
					body.allianceId,
					{
						allianceId: body.allianceId,
					}
				)

				// Assign alliance tag to user
				await tagStore.assignTagToUser(body.socialUserId, allianceUrn, body.characterId)
			}

			// Schedule first evaluation in 1 hour
			await tagStore.scheduleUserEvaluation(body.socialUserId)

			logger
				.withTags({ type: 'character_onboarded' })
				.info('Character onboarded, tags assigned', {
					socialUserId: body.socialUserId.substring(0, 8) + '...',
					characterId: body.characterId,
					corporationId: body.corporationId,
					allianceId: body.allianceId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Character onboard error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Handle character unlinking
	.post('/api/tags/character-unlinked/:characterId', async (c) => {
		try {
			const characterId = parseInt(c.req.param('characterId'), 10)
			const body = (await c.req.json()) as {
				socialUserId: string
			}

			if (isNaN(characterId) || !body.socialUserId) {
				return c.json({ error: 'Invalid parameters' }, 400)
			}

			const tagStore = getTagStore(c)

			// Remove all tags sourced from this character
			await tagStore.removeAllTagsForCharacter(characterId)

			// Re-evaluate user to ensure correct tags remain
			await tagStore.evaluateUserTags(body.socialUserId)

			logger
				.withTags({ type: 'character_unlinked' })
				.info('Character unlinked, tags removed', {
					socialUserId: body.socialUserId.substring(0, 8) + '...',
					characterId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Character unlink error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Force immediate evaluation
	.post('/api/tags/evaluate/:userId', async (c) => {
		try {
			const userId = c.req.param('userId')

			const tagStore = getTagStore(c)
			await tagStore.evaluateUserTags(userId)

			logger
				.withTags({ type: 'user_evaluated' })
				.info('User tags forcibly evaluated', {
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Force evaluation error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

// ========== Admin Endpoints ==========

app
	// List all tags
	.get('/api/tags', withAdminAuth, async (c) => {
		try {
			const tagStore = getTagStore(c)
			const tags = await tagStore.listAllTags()

			return c.json({
				success: true,
				tags,
			})
		} catch (error) {
			logger.error('List all tags error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Get specific tag details
	.get('/api/tags/tag/:urn', withAdminAuth, async (c) => {
		try {
			const urn = decodeURIComponent(c.req.param('urn'))

			const tagStore = getTagStore(c)
			const tag = await tagStore.getTag(urn)

			if (!tag) {
				return c.json({ error: 'Tag not found' }, 404)
			}

			return c.json({
				success: true,
				tag,
			})
		} catch (error) {
			logger.error('Get tag error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// List users with a specific tag
	.get('/api/tags/tag/:urn/users', withAdminAuth, async (c) => {
		try {
			const urn = decodeURIComponent(c.req.param('urn'))

			const tagStore = getTagStore(c)
			const userIds = await tagStore.getUsersWithTag(urn)

			return c.json({
				success: true,
				userIds,
				count: userIds.length,
			})
		} catch (error) {
			logger.error('Get tag users error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// Trigger full sync (careful - could be expensive!)
	.post('/api/tags/sync-all', withAdminAuth, async (c) => {
		try {
			// This is a placeholder - in production you'd want to implement this carefully
			// with proper batching and rate limiting
			logger
				.withTags({ type: 'full_sync_requested' })
				.warn('Full sync requested - not yet implemented', {
					requestedBy: c.get('sessionUserId')!.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: false,
				error: 'Full sync not yet implemented - use scheduled evaluations',
			})
		} catch (error) {
			logger.error('Sync all error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

// Wrap with Sentry for error tracking
import { withSentry } from '@repo/hono-helpers'
export default withSentry(app)

// Export Durable Object
export { TagStore } from './tag-store'
