import type { Context } from 'hono'
import { Hono } from 'hono'
import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { userCharacters } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/session'

import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveCharacterData } from '@repo/eve-character-data'
import type { Hr, ApplicationFilters, NoteFilters, RoleFilters } from '@repo/hr'
import type { App } from '../context'

const app = new Hono<App>()

/**
 * Helper to get HR Durable Object stub
 */
function getHrStub(c: Context<App>): Hr {
	return getStub<Hr>(c.env.HR, 'default')
}

/**
 * Helper to get character name from user's characters
 */
function getCharacterName(user: Context<App>['var']['user'], characterId: string): string {
	const character = user?.characters.find((c) => c.characterId === characterId)
	return character?.characterName || 'Unknown'
}

/**
 * Check if the current user has CEO or site admin access to manage HR roles
 * Throws an error with 403 status if user is neither admin nor CEO
 */
async function checkCeoOrAdminAccess(c: Context<App>, corporationId: string): Promise<void> {
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		throw new Error('Database not available')
	}

	// Site admins have access to all corporations
	if (user.is_admin) {
		logger.info('[HR Auth] Admin access granted', {
			corporationId,
			userId: user.id,
			reason: 'site_admin',
		})
		return // Access granted via admin
	}

	// Get user's characters to check CEO status
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, user.id),
	})

	logger.info('[HR Auth] Checking CEO access', {
		corporationId,
		userId: user.id,
		userCharacterCount: userChars.length,
	})

	// Check each character to see if any is the CEO of this corporation
	for (const character of userChars) {
		try {
			// Check if character is in this corporation
			const charStub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, character.characterId)
			const charData = await charStub.getCharacterInfo(character.characterId)

			// Skip if character is not in the target corporation
			if (!charData || String(charData.corporationId) !== corporationId) {
				continue
			}

			// Get corporation data to check CEO
			const corpStub = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, corporationId)
			const corpInfo = await corpStub.getCorporationInfo(corporationId)

			// Check if character is CEO
			const isCeo = corpInfo && String(corpInfo.ceoId) === character.characterId
			if (isCeo) {
				logger.info('[HR Auth] CEO access granted', {
					characterId: character.characterId,
					characterName: character.characterName,
					corporationId,
					reason: 'corporation_ceo',
				})
				return // Access granted via CEO
			}
		} catch (error) {
			logger.warn('[HR Auth] Error checking character access:', {
				characterId: character.characterId,
				corporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	// No character found with CEO access
	logger.warn('[HR Auth] Access denied', {
		corporationId,
		userId: user.id,
		isAdmin: user.is_admin,
		checkedCharacters: userChars.length,
	})

	throw new Error('Access denied. Only corporation CEOs or site admins can manage HR roles.')
}

// ==================== Application Routes ====================

/**
 * POST /api/hr/applications
 * Submit a new application to a corporation
 */
app.post('/applications', requireAuth(), async (c) => {
	const user = c.get('user')!
	const { characterId, corporationId, applicationText } = await c.req.json()

	// Validate character ownership
	const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Character not found or not owned by you' }, 403)
	}

	const characterName = getCharacterName(user, characterId)

	try {
		const hr = getHrStub(c)
		const application = await hr.submitApplication(
			user.id,
			characterId,
			corporationId,
			applicationText,
			characterName
		)

		return c.json(application, 201)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to submit application' }, 400)
	}
})

/**
 * GET /api/hr/applications
 * List applications with optional filters
 */
app.get('/applications', requireAuth(), async (c) => {
	const user = c.get('user')!

	// Parse query params
	const filters: ApplicationFilters = {
		corporationId: c.req.query('corporationId'),
		userId: c.req.query('userId'),
		status: c.req.query('status') as ApplicationFilters['status'],
		limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
		offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
	}

	try {
		const hr = getHrStub(c)
		const applications = await hr.listApplications(filters, user.id, user.is_admin)

		return c.json(applications)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to list applications' }, 500)
	}
})

/**
 * GET /api/hr/applications/:id
 * Get a single application with recommendations
 */
app.get('/applications/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')

	try {
		const hr = getHrStub(c)
		const application = await hr.getApplication(applicationId, user.id, user.is_admin)

		return c.json(application)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to get application' }, error instanceof Error && error.message.includes('permission') ? 403 : 404)
	}
})

/**
 * PATCH /api/hr/applications/:id
 * Update application status or review
 */
app.patch('/applications/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')
	const { status, reviewNotes } = await c.req.json()

	// Get primary character for logging
	const primaryCharacter = user.characters.find((c) => c.is_primary)
	const characterId = primaryCharacter?.characterId || user.mainCharacterId

	try {
		const hr = getHrStub(c)
		await hr.updateApplicationStatus(applicationId, status, user.id, characterId, reviewNotes)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to update application' }, 400)
	}
})

/**
 * POST /api/hr/applications/:id/withdraw
 * Withdraw an application
 */
app.post('/applications/:id/withdraw', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')

	// Get primary character for logging
	const primaryCharacter = user.characters.find((c) => c.is_primary)
	const characterId = primaryCharacter?.characterId || user.mainCharacterId

	try {
		const hr = getHrStub(c)
		await hr.withdrawApplication(applicationId, user.id, characterId)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to withdraw application' }, 400)
	}
})

/**
 * DELETE /api/hr/applications/:id
 * Permanently delete an application (admin only)
 */
app.delete('/applications/:id', requireAdmin(), async (c) => {
	const applicationId = c.req.param('id')

	try {
		const hr = getHrStub(c)
		await hr.deleteApplication(applicationId)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to delete application' }, 500)
	}
})

// ==================== Recommendation Routes ====================

/**
 * POST /api/hr/applications/:applicationId/recommendations
 * Add a recommendation for an application
 */
app.post('/applications/:applicationId/recommendations', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')
	const { characterId, recommendationText, sentiment } = await c.req.json()

	// Validate character ownership
	const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Character not found or not owned by you' }, 403)
	}

	const characterName = getCharacterName(user, characterId)

	try {
		const hr = getHrStub(c)
		const recommendation = await hr.addRecommendation(
			applicationId,
			user.id,
			characterId,
			characterName,
			recommendationText,
			sentiment
		)

		return c.json(recommendation, 201)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to add recommendation' }, 400)
	}
})

/**
 * PATCH /api/hr/applications/:applicationId/recommendations/:id
 * Update a recommendation
 */
app.patch('/applications/:applicationId/recommendations/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const recommendationId = c.req.param('id')
	const { characterId, recommendationText, sentiment } = await c.req.json()

	try {
		const hr = getHrStub(c)
		await hr.updateRecommendation(
			recommendationId,
			user.id,
			characterId || user.mainCharacterId,
			recommendationText,
			sentiment,
			user.is_admin
		)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to update recommendation' }, 400)
	}
})

/**
 * DELETE /api/hr/applications/:applicationId/recommendations/:id
 * Delete a recommendation
 */
app.delete('/applications/:applicationId/recommendations/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const recommendationId = c.req.param('id')

	// Get primary character for logging
	const primaryCharacter = user.characters.find((c) => c.is_primary)
	const characterId = primaryCharacter?.characterId || user.mainCharacterId

	try {
		const hr = getHrStub(c)
		await hr.deleteRecommendation(recommendationId, user.id, characterId, user.is_admin)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to delete recommendation' }, 400)
	}
})

// ==================== HR Notes Routes (Admin Only) ====================

/**
 * POST /api/hr/notes
 * Create an HR note about a user (admin only)
 */
app.post('/notes', requireAdmin(), async (c) => {
	const user = c.get('user')!
	const { subjectUserId, subjectCharacterId, noteText, noteType, priority, metadata } = await c.req.json()

	// Get admin's primary character
	const primaryCharacter = user.characters.find((c) => c.is_primary)
	const authorCharacterId = primaryCharacter?.characterId || user.mainCharacterId
	const authorCharacterName = primaryCharacter?.characterName || 'Unknown'

	try {
		const hr = getHrStub(c)
		const note = await hr.createNote(
			subjectUserId,
			subjectCharacterId || null,
			user.id,
			authorCharacterId,
			authorCharacterName,
			noteText,
			noteType,
			priority,
			metadata
		)

		return c.json(note, 201)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to create note' }, 400)
	}
})

/**
 * GET /api/hr/notes
 * List HR notes with optional filters (admin only)
 */
app.get('/notes', requireAdmin(), async (c) => {
	// Parse query params
	const filters: NoteFilters = {
		subjectUserId: c.req.query('subjectUserId'),
		noteType: c.req.query('noteType') as NoteFilters['noteType'],
		priority: c.req.query('priority') as NoteFilters['priority'],
		limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
		offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
	}

	try {
		const hr = getHrStub(c)
		const notes = await hr.listNotes(filters)

		return c.json(notes)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to list notes' }, 500)
	}
})

/**
 * GET /api/hr/notes/user/:userId
 * Get all HR notes for a specific user (admin only)
 */
app.get('/notes/user/:userId', requireAdmin(), async (c) => {
	const subjectUserId = c.req.param('userId')

	try {
		const hr = getHrStub(c)
		const notes = await hr.getUserNotes(subjectUserId)

		return c.json(notes)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to get user notes' }, 500)
	}
})

/**
 * PATCH /api/hr/notes/:id
 * Update an HR note (admin only)
 */
app.patch('/notes/:id', requireAdmin(), async (c) => {
	const noteId = c.req.param('id')
	const updates = await c.req.json()

	try {
		const hr = getHrStub(c)
		await hr.updateNote(noteId, updates)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to update note' }, 400)
	}
})

/**
 * DELETE /api/hr/notes/:id
 * Delete an HR note (admin only)
 */
app.delete('/notes/:id', requireAdmin(), async (c) => {
	const noteId = c.req.param('id')

	try {
		const hr = getHrStub(c)
		await hr.deleteNote(noteId)

		return c.json({ success: true })
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to delete note' }, 500)
	}
})

// ==================== HR Roles Routes ====================

/**
 * POST /api/hr/:corporationId/roles
 * Grant an HR role to a user for a corporation
 * REQUIRES: CEO access to the corporation OR site admin
 */
app.post('/:corporationId/roles', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const { userId, characterId, role, expiresAt } = await c.req.json()

	// Authorization check - user must be CEO or site admin
	try {
		await checkCeoOrAdminAccess(c, corporationId)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Access denied' }, 403)
	}

	// Get character name
	const characterName = c.req.query('characterName') || 'Unknown'

	try {
		const hr = getHrStub(c)
		const hrRole = await hr.grantRole(
			corporationId,
			userId,
			characterId,
			characterName,
			role,
			user.id,
			expiresAt ? new Date(expiresAt) : undefined
		)

		logger.info('[HR Roles] Role granted', {
			corporationId,
			targetUserId: userId,
			role,
			grantedBy: user.id,
		})

		return c.json(hrRole, 201)
	} catch (error) {
		logger.error('[HR Roles] Failed to grant role', {
			corporationId,
			userId,
			role,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to grant role' }, 400)
	}
})

/**
 * GET /api/hr/:corporationId/roles
 * List HR roles for a corporation
 * Query params:
 *   - userId: Optional - if provided, returns roles for specific user only
 *   - activeOnly: Optional - if false, includes inactive roles (default: true)
 */
app.get('/:corporationId/roles', requireAuth(), async (c) => {
	const corporationId = c.req.param('corporationId')
	const userId = c.req.query('userId')
	const activeOnly = c.req.query('activeOnly') !== 'false'

	try {
		// Try cache first (only for corporation-wide queries, not user-specific)
		if (!userId) {
			const cacheKey = new Request(
				`https://hr.internal/roles/${corporationId}?activeOnly=${activeOnly}`,
				{ method: 'GET' }
			)
			const cache = caches.default
			const cachedResponse = await cache.match(cacheKey)

			if (cachedResponse) {
				logger.info('[HR Roles] Cache hit', { corporationId, activeOnly })
				return c.json(await cachedResponse.json())
			}
		}

		const hr = getHrStub(c)
		let roles

		if (userId) {
			// Get roles for specific user
			roles = await hr.getUserRoles(userId, corporationId)
			logger.info('[HR Roles] Fetched user roles', {
				corporationId,
				userId,
				count: roles.length,
			})
		} else {
			// Get all roles for corporation
			roles = await hr.getCorporationRoles(corporationId, activeOnly)
			logger.info('[HR Roles] Fetched corporation roles', {
				corporationId,
				activeOnly,
				count: roles.length,
			})
		}

		// Cache the response (only for corporation-wide queries)
		if (!userId) {
			const cacheKey = new Request(
				`https://hr.internal/roles/${corporationId}?activeOnly=${activeOnly}`,
				{ method: 'GET' }
			)
			const response = new Response(JSON.stringify(roles), {
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=300', // 5 minutes
				},
			})
			c.executionCtx.waitUntil(caches.default.put(cacheKey, response.clone()))
		}

		return c.json(roles)
	} catch (error) {
		logger.error('[HR Roles] Error fetching roles', {
			corporationId,
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to list roles' }, 500)
	}
})

/**
 * GET /api/hr/roles/check
 * Check if the CURRENT AUTHENTICATED USER has HR permissions for a corporation
 * Query params:
 *   - corporationId: Required - the corporation to check
 *   - requiredRole: Optional - minimum role required (hr_viewer, hr_reviewer, hr_admin)
 * Returns:
 *   - hasPermission: boolean - true if user has any HR role (or meets requiredRole)
 *   - currentRole: string | null - the user's highest HR role for this corporation
 *
 * SECURITY: Always checks the authenticated user from session. Does NOT accept userId parameter.
 */
app.get('/roles/check', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')
	const requiredRole = c.req.query('requiredRole') as 'hr_viewer' | 'hr_reviewer' | 'hr_admin' | undefined

	if (!corporationId) {
		return c.json({ error: 'corporationId is required' }, 400)
	}

	// SECURITY: ALWAYS use the authenticated user's ID from session, NEVER from query params
	const userId = user.id

	try {
		const hr = getHrStub(c)
		const roles = await hr.getUserRoles(userId, corporationId)

		// Filter to active roles only
		const activeRoles = roles.filter((r) => r.isActive)

		if (activeRoles.length === 0) {
			return c.json({ hasPermission: false, currentRole: null })
		}

		// Role hierarchy: hr_admin > hr_reviewer > hr_viewer
		const roleHierarchy: Record<string, number> = {
			hr_admin: 3,
			hr_reviewer: 2,
			hr_viewer: 1,
		}

		// Find highest role
		const highestRole = activeRoles.reduce((highest, role) => {
			const currentLevel = roleHierarchy[role.role] || 0
			const highestLevel = roleHierarchy[highest?.role || ''] || 0
			return currentLevel > highestLevel ? role : highest
		}, activeRoles[0])

		// Check if user meets required role (if specified)
		if (requiredRole) {
			const userLevel = roleHierarchy[highestRole.role] || 0
			const requiredLevel = roleHierarchy[requiredRole] || 0
			const hasPermission = userLevel >= requiredLevel

			logger.info('[HR Roles] Permission check', {
				corporationId,
				userId,
				currentRole: highestRole.role,
				requiredRole,
				hasPermission,
			})

			return c.json({ hasPermission, currentRole: highestRole.role })
		}

		// No specific role required - any active role grants permission
		logger.info('[HR Roles] Permission check', {
			corporationId,
			userId,
			currentRole: highestRole.role,
			hasPermission: true,
		})

		return c.json({ hasPermission: true, currentRole: highestRole.role })
	} catch (error) {
		logger.error('[HR Roles] Permission check failed', {
			corporationId,
			userId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: error instanceof Error ? error.message : 'Permission check failed' }, 500)
	}
})

/**
 * PATCH /api/hr/roles/:id
 * Update or deactivate a role
 * (Currently handled via revoke endpoint)
 */
app.patch('/roles/:id', requireAuth(), async (c) => {
	return c.json({ error: 'Use DELETE to revoke a role' }, 400)
})

/**
 * DELETE /api/hr/:corporationId/roles/:roleId
 * Revoke an HR role
 * REQUIRES: CEO access to the corporation OR site admin
 */
app.delete('/:corporationId/roles/:roleId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const roleId = c.req.param('roleId')

	// Authorization check - user must be CEO or site admin
	try {
		await checkCeoOrAdminAccess(c, corporationId)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Access denied' }, 403)
	}

	try {
		const hr = getHrStub(c)

		// Optional: Verify the role belongs to this corporation (safety check)
		const role = await hr.getRole(roleId)
		if (!role) {
			return c.json({ error: 'HR role not found' }, 404)
		}
		if (role.corporationId !== corporationId) {
			logger.warn('[HR Roles] Corporation ID mismatch', {
				roleId,
				expectedCorporationId: corporationId,
				actualCorporationId: role.corporationId,
			})
			return c.json({ error: 'Role does not belong to this corporation' }, 400)
		}

		// Proceed with revoking the role
		await hr.revokeRole(roleId)

		logger.info('[HR Roles] Role revoked', {
			roleId,
			corporationId,
			revokedBy: user.id,
		})

		return c.json({ success: true })
	} catch (error) {
		logger.error('[HR Roles] Failed to revoke role', {
			roleId,
			corporationId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to revoke role' }, 500)
	}
})

export default app
