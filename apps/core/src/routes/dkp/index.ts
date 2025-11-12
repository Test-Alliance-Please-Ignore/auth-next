/**
 * DKP routes - Dino Kontribution Points tracking
 *
 * Endpoints for managing DKP awards, viewing balances, leaderboards, and transaction history.
 * Character DKP automatically contributes to corporation totals (shared pool model).
 */

import { Hono } from 'hono'
import { z } from 'zod'

import { logger } from '@repo/hono-helpers'

import { requireAdmin, requireAuth } from '../../middleware/session'
import { DkpService } from '../../services/dkp.service'

import type { App } from '../../context'

const app = new Hono<App>()

// Validation schemas
const bulkAwardSchema = z.object({
	awards: z
		.array(
			z.object({
				characterId: z.string().regex(/^\d+$/),
				corporationId: z.string().regex(/^\d+$/).optional(),
				amount: z.number().int().min(1).max(1000000),
				reason: z.string().min(10).max(500).optional(),
			})
		)
		.min(1)
		.max(500),
	globalReason: z.string().min(10).max(500),
	sourceType: z.enum(['fleet', 'manual'] as const).optional(),
	sourceId: z.string().optional(),
	earnedAt: z.string().datetime().optional(),
})

const awardDkpSchema = z.object({
	characterId: z.string().regex(/^\d+$/, 'Invalid character ID'),
	corporationId: z.string().regex(/^\d+$/, 'Invalid corporation ID').optional(),
	amount: z.number().int().min(1).max(1000000),
	sourceType: z.enum(['fleet', 'market', 'mining', 'manual', 'adjustment'] as const),
	sourceId: z.string().optional(),
	sourceMetadata: z.record(z.string(), z.unknown()).optional(),
	awardReason: z.string().min(10).max(500).optional(),
	earnedAt: z.string().datetime().optional(),
})

/**
 * NOTE: There is no public HTTP /award endpoint.
 * Other workers should use the RPC method via service binding:
 *   const result = await env.CORE.awardDkp({ ... })
 *
 * This prevents unauthorized public access while allowing internal workers
 * to award DKP through the type-safe RPC interface.
 */

/**
 * POST /award-manual
 * Manually award DKP (admin only)
 * Auth: Admin required
 */
app.post('/award-manual', requireAdmin(), async (c) => {
	try {
		const user = c.get('user')!
		const body = await c.req.json()

		// Manual awards require reason
		const validated = awardDkpSchema
			.extend({
				awardReason: z.string().min(10).max(500),
			})
			.parse(body)

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)

		const result = await dkpService.awardDkp({
			...validated,
			sourceType: 'manual',
			awardedBy: user.id,
			earnedAt: validated.earnedAt ? new Date(validated.earnedAt) : undefined,
		})

		logger.info('DKP awarded manually', {
			adminId: user.id,
			characterId: validated.characterId,
			amount: validated.amount,
			reason: validated.awardReason,
		})

		return c.json(result)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Validation failed', issues: error.issues }, 400)
		}
		logger.error('Error awarding DKP manually:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			errorType: error?.constructor?.name,
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to award DKP' }, 500)
	}
})

/**
 * POST /award-bulk
 * Award DKP to multiple characters at once (admin only)
 * Auth: Admin required
 */
app.post('/award-bulk', requireAdmin(), async (c) => {
	try {
		const user = c.get('user')!
		const body = await c.req.json()
		const validated = bulkAwardSchema.parse(body)

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)

		const result = await dkpService.awardDkpBulk({
			awards: validated.awards,
			globalReason: validated.globalReason,
			sourceType: validated.sourceType || 'manual',
			sourceId: validated.sourceId,
			awardedBy: user.id,
			earnedAt: validated.earnedAt ? new Date(validated.earnedAt) : undefined,
		})

		logger.info('DKP bulk award', {
			adminId: user.id,
			totalAwarded: result.totalAwarded,
			errorCount: result.errors.length,
		})

		return c.json(result)
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Validation failed', issues: error.issues }, 400)
		}
		logger.error('Error bulk awarding DKP:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			errorType: error?.constructor?.name,
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to bulk award DKP' },
			500
		)
	}
})

/**
 * GET /balance/:characterId
 * Get character DKP balance
 * Auth: User can view their own characters, admins can view all
 */
app.get('/balance/:characterId', requireAuth(), async (c) => {
	try {
		const user = c.get('user')!
		const characterId = c.req.param('characterId')
		const period = (c.req.query('period') as '7d' | '30d' | '90d' | 'all') || 'all'

		// Check authorization: user must own the character or be admin
		const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
		if (!ownsCharacter && !user.is_admin) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const balance = await dkpService.getCharacterBalance(characterId, period)

		return c.json(balance)
	} catch (error) {
		logger.error('Error getting character balance:', error)
		return c.json({ error: error instanceof Error ? error.message : 'Failed to get balance' }, 500)
	}
})

/**
 * GET /balance/corporation/:corporationId
 * Get corporation DKP balance (sum of all members)
 * Auth: Public (no auth required)
 */
app.get('/balance/corporation/:corporationId', async (c) => {
	try {
		const corporationId = c.req.param('corporationId')
		const period = (c.req.query('period') as '7d' | '30d' | '90d' | 'all') || 'all'

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const balance = await dkpService.getCorporationBalance(corporationId, period)

		return c.json(balance)
	} catch (error) {
		logger.error('Error getting corporation balance:', error)
		return c.json({ error: error instanceof Error ? error.message : 'Failed to get balance' }, 500)
	}
})

/**
 * GET /balance/user/:userId
 * Get user DKP balance (sum across all characters)
 * Auth: User can view their own balance, admins can view all
 */
app.get('/balance/user/:userId', requireAuth(), async (c) => {
	try {
		const user = c.get('user')!
		const userId = c.req.param('userId')
		const period = (c.req.query('period') as '7d' | '30d' | '90d' | 'all') || 'all'

		// Check authorization: user must be viewing their own balance or be admin
		if (userId !== user.id && !user.is_admin) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const balance = await dkpService.getUserBalance(userId, period)

		return c.json(balance)
	} catch (error) {
		logger.error('Error getting user balance:', error)
		return c.json({ error: error instanceof Error ? error.message : 'Failed to get balance' }, 500)
	}
})

/**
 * GET /leaderboard/users
 * Get user leaderboard
 * Query params: period (7d|30d|90d|all), limit, offset
 * Auth: Public (no auth required)
 */
app.get('/leaderboard/users', async (c) => {
	try {
		const period = (c.req.query('period') as '7d' | '30d' | '90d' | 'all') || 'all'
		const limit = parseInt(c.req.query('limit') || '50', 10)
		const offset = parseInt(c.req.query('offset') || '0', 10)

		// Validate limits
		if (limit < 1 || limit > 500) {
			return c.json({ error: 'Limit must be between 1 and 500' }, 400)
		}
		if (offset < 0) {
			return c.json({ error: 'Offset must be non-negative' }, 400)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const leaderboard = await dkpService.getUserLeaderboard({
			period,
			limit,
			offset,
		})

		return c.json(leaderboard)
	} catch (error) {
		logger.error('Error getting user leaderboard:', error)
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get leaderboard' },
			500
		)
	}
})

/**
 * GET /leaderboard/characters
 * Get character leaderboard
 * Query params: period (7d|30d|90d|all), corporationId, limit, offset
 * Auth: Public (no auth required)
 */
app.get('/leaderboard/characters', async (c) => {
	try {
		const period = (c.req.query('period') as '7d' | '30d' | '90d' | 'all') || 'all'
		const corporationId = c.req.query('corporationId')
		const limit = parseInt(c.req.query('limit') || '50', 10)
		const offset = parseInt(c.req.query('offset') || '0', 10)

		// Validate limits
		if (limit < 1 || limit > 500) {
			return c.json({ error: 'Limit must be between 1 and 500' }, 400)
		}
		if (offset < 0) {
			return c.json({ error: 'Offset must be non-negative' }, 400)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const leaderboard = await dkpService.getCharacterLeaderboard({
			period,
			corporationId,
			limit,
			offset,
		})

		return c.json(leaderboard)
	} catch (error) {
		logger.error('Error getting character leaderboard:', error)
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get leaderboard' },
			500
		)
	}
})

/**
 * GET /leaderboard/corporations
 * Get corporation leaderboard
 * Query params: period (7d|30d|90d|all), limit, offset
 * Auth: Public (no auth required)
 */
app.get('/leaderboard/corporations', async (c) => {
	try {
		const period = (c.req.query('period') as '7d' | '30d' | '90d' | 'all') || 'all'
		const limit = parseInt(c.req.query('limit') || '50', 10)
		const offset = parseInt(c.req.query('offset') || '0', 10)

		// Validate limits
		if (limit < 1 || limit > 100) {
			return c.json({ error: 'Limit must be between 1 and 100' }, 400)
		}
		if (offset < 0) {
			return c.json({ error: 'Offset must be non-negative' }, 400)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const leaderboard = await dkpService.getCorporationLeaderboard({
			period,
			limit,
			offset,
		})

		return c.json(leaderboard)
	} catch (error) {
		logger.error('Error getting corporation leaderboard:', error)
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get leaderboard' },
			500
		)
	}
})

/**
 * GET /transactions
 * Get transaction history
 * Query params: userId, characterId, corporationId, sourceType, limit, offset, startDate, endDate
 * Auth: User can view their own transactions, admins can view all
 */
app.get('/transactions', requireAuth(), async (c) => {
	try {
		const user = c.get('user')!
		const userId = c.req.query('userId')
		const characterId = c.req.query('characterId')
		const corporationId = c.req.query('corporationId')
		const sourceType = c.req.query('sourceType')
		const limit = parseInt(c.req.query('limit') || '50', 10)
		const offset = parseInt(c.req.query('offset') || '0', 10)
		const startDate = c.req.query('startDate')
		const endDate = c.req.query('endDate')

		// Authorization check - non-admins can only query their own transactions
		if (!user.is_admin) {
			// Non-admins cannot filter by corporationId
			if (corporationId) {
				return c.json({ error: 'Forbidden: Corporation filtering requires admin access' }, 403)
			}

			// If userId is provided, must be their own
			if (userId && userId !== user.id) {
				return c.json({ error: 'Forbidden: You can only view your own transactions' }, 403)
			}

			// If characterId is provided, verify ownership
			if (characterId) {
				const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
				if (!ownsCharacter) {
					return c.json({ error: 'Forbidden: You do not own this character' }, 403)
				}
			}
		}

		// Validate limits
		if (limit < 1 || limit > 500) {
			return c.json({ error: 'Limit must be between 1 and 500' }, 400)
		}
		if (offset < 0) {
			return c.json({ error: 'Offset must be non-negative' }, 400)
		}

		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)

		// If userId is provided, query by user (simpler than character-level query)
		if (userId) {
			const history = await dkpService.getTransactionHistory({
				userId,
				sourceType,
				limit,
				offset,
				startDate: startDate ? new Date(startDate) : undefined,
				endDate: endDate ? new Date(endDate) : undefined,
			})
			return c.json(history)
		}

		// If no characterId provided and user is not admin, query all their characters
		if (!characterId && !user.is_admin) {
			const userCharacterIds = user.characters.map((c) => c.characterId)

			if (userCharacterIds.length === 0) {
				return c.json({
					transactions: [],
					pagination: {
						limit,
						offset,
						total: 0,
					},
				})
			}

			// Get transactions for all user's characters
			const history = await dkpService.getTransactionHistory({
				characterIds: userCharacterIds,
				sourceType,
				limit,
				offset,
				startDate: startDate ? new Date(startDate) : undefined,
				endDate: endDate ? new Date(endDate) : undefined,
			})

			return c.json(history)
		}

		// Query with provided filters (admin or single character)
		const history = await dkpService.getTransactionHistory({
			characterId,
			corporationId,
			sourceType,
			limit,
			offset,
			startDate: startDate ? new Date(startDate) : undefined,
			endDate: endDate ? new Date(endDate) : undefined,
		})

		return c.json(history)
	} catch (error) {
		logger.error('Error getting transaction history:', error)
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get transaction history' },
			500
		)
	}
})

/**
 * GET /admin/statistics
 * Get DKP statistics for admin dashboard
 * Auth: Admin required
 */
app.get('/admin/statistics', requireAdmin(), async (c) => {
	try {
		const db = c.get('db')
		if (!db) {
			return c.json({ error: 'Database not initialized' }, 500)
		}

		const dkpService = new DkpService(db, c.env.EVE_CORPORATION_DATA, c.env.EVE_CHARACTER_DATA)
		const statistics = await dkpService.getStatistics()

		return c.json(statistics)
	} catch (error) {
		logger.error('Error getting DKP statistics:', {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			errorType: error?.constructor?.name,
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get statistics' },
			500
		)
	}
})

/**
 * GET /admin/decay-config
 * Get current decay configuration
 * Auth: Admin required
 */
app.get('/admin/decay-config', requireAdmin(), async (c) => {
	try {
		// TODO: Implement when decay configuration is needed
		return c.json({
			active: null,
			history: [],
			message: 'Decay configuration not yet implemented',
		})
	} catch (error) {
		logger.error('Error getting decay config:', error)
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get decay config' },
			500
		)
	}
})

/**
 * POST /admin/decay-config
 * Create or update decay configuration
 * Auth: Admin required
 */
app.post('/admin/decay-config', requireAdmin(), async (c) => {
	try {
		// TODO: Implement when decay configuration is needed
		return c.json(
			{
				message: 'Decay configuration not yet implemented',
			},
			501
		)
	} catch (error) {
		logger.error('Error creating decay config:', error)
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to create decay config' },
			500
		)
	}
})

export default app
