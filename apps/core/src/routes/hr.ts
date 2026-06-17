import { Hono } from 'hono'
import { z } from 'zod'

import { and, eq, ilike, inArray, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { captureException, logger } from '@repo/hono-helpers'
import { APPLICATION_STATUSES } from '@repo/hr'

import { managedCorporations, userCharacters, users } from '../db/schema'
import {
	hasHrAuditorPermission as hasHrAuditorPermissionForUser,
	resolveHrAccessState,
} from '../lib/hr-access'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { getIpHashMatches, getUserIpHistory } from '../lib/ip-history'
import { dispatchCorporationAlert } from '../services/corporation-alerts.service'
import { validatePagination } from '../lib/validation'
import { requireAdmin, requireAuth } from '../middleware/session'

import type { Context } from 'hono'
import type { Core } from '@repo/core'
import type { Esi, EsiTypeResolver } from '@repo/esi'
import type { ApplicationFilters, Hr, HrNote, NoteFilters } from '@repo/hr'
import type { Legacy } from '@repo/legacy'
import type { App } from '../context'

const app = new Hono<App>()

const updateApplicationSchema = z.object({
	status: z.enum(APPLICATION_STATUSES),
	reviewNotes: z.string().trim().max(5000).optional(),
})

const upsertApplicationStaffNoteSchema = z.object({
	noteText: z.string().trim().min(1).max(5000),
})

/**
 * Helper to get HR Durable Object stub
 */
function getHrStub(c: Context<App>): Hr {
	return getStub<Hr>(c.env.HR, 'default')
}

/**
 * Helper to get Core Durable Object stub
 */
function getCoreStub(c: Context<App>): Core {
	return getStub<Core>(c.env.CORE, 'default')
}

function getLegacyStub(c: Context<App>): Legacy {
	return getStub<Legacy>(c.env.LEGACY, 'default')
}

/**
 * Helper to get character name from user's characters
 */
function getCharacterName(user: Context<App>['var']['user'], characterId: string): string {
	const character = user?.characters.find((c) => c.characterId === characterId)
	return character?.characterName || 'Unknown'
}

/**
 * Batch resolve user IDs to their main character names.
 * Used to enrich HR responses with reviewer/sender names at read time.
 */
async function resolveUserCharacterNames(
	db: NonNullable<Context<App>['var']['db']>,
	userIds: string[]
): Promise<Record<string, string>> {
	if (userIds.length === 0) return {}

	const uniqueIds = [...new Set(userIds)]
	const foundUsers = await db.query.users.findMany({
		where: inArray(users.id, uniqueIds),
		columns: { id: true, mainCharacterId: true },
	})

	if (foundUsers.length === 0) return {}

	const charIds = foundUsers.map((u) => u.mainCharacterId)
	const chars = await db.query.userCharacters.findMany({
		where: inArray(userCharacters.characterId, charIds),
		columns: { characterId: true, characterName: true },
	})

	const charNameMap = new Map(chars.map((c) => [c.characterId, c.characterName]))
	const result: Record<string, string> = {}
	for (const u of foundUsers) {
		const name = charNameMap.get(u.mainCharacterId)
		if (name) result[u.id] = name
	}
	return result
}

/**
 * Resolve primary character identity for users.
 * Used to normalize HR role records that only carry user attachment IDs.
 */
async function resolveUserPrimaryCharacterIdentity(
	db: NonNullable<Context<App>['var']['db']>,
	userIds: string[]
): Promise<Record<string, { characterId: string; characterName: string }>> {
	if (userIds.length === 0) return {}

	const uniqueIds = [...new Set(userIds)]
	const foundUsers = await db.query.users.findMany({
		where: inArray(users.id, uniqueIds),
		columns: { id: true, mainCharacterId: true },
	})
	if (foundUsers.length === 0) return {}

	const primaryCharacterIds = foundUsers.map((row) => row.mainCharacterId)
	const chars = await db.query.userCharacters.findMany({
		where: inArray(userCharacters.characterId, primaryCharacterIds),
		columns: { characterId: true, characterName: true },
	})
	const charMap = new Map(chars.map((char) => [char.characterId, char]))

	const result: Record<string, { characterId: string; characterName: string }> = {}
	for (const user of foundUsers) {
		const resolvedChar = charMap.get(user.mainCharacterId)
		if (!resolvedChar) continue
		result[user.id] = {
			characterId: resolvedChar.characterId,
			characterName: resolvedChar.characterName,
		}
	}
	return result
}

/**
 * Enrich a list of applications with resolved corporation and reviewer names.
 */
async function enrichApplications<T extends { corporationId: string; reviewedBy: string | null }>(
	items: T[],
	resolver: { resolveIds: (ids: string[]) => Promise<Record<string, string>> },
	db: NonNullable<Context<App>['var']['db']>
): Promise<Array<T & { corporationName: string; reviewedByCharacterName: string | null }>> {
	const corpIds = [...new Set(items.map((a) => a.corporationId))]
	const corpNames = corpIds.length > 0 ? await resolver.resolveIds(corpIds) : {}
	const managedCorpNames =
		corpIds.length > 0
			? await db.query.managedCorporations.findMany({
					where: inArray(managedCorporations.corporationId, corpIds),
					columns: {
						corporationId: true,
						name: true,
					},
				})
			: []
	const corpNameMap = new Map<string, string>()
	for (const [corporationId, corporationName] of Object.entries(corpNames)) {
		if (corporationName) {
			corpNameMap.set(corporationId, corporationName)
		}
	}
	for (const corp of managedCorpNames) {
		if (!corpNameMap.has(corp.corporationId)) {
			corpNameMap.set(corp.corporationId, corp.name)
		}
	}

	const reviewerIds = items.map((a) => a.reviewedBy).filter((id): id is string => id !== null)
	const reviewerNames = await resolveUserCharacterNames(db, reviewerIds)

	return items.map((a) => ({
		...a,
		corporationName: corpNameMap.get(a.corporationId) ?? `Corporation ${a.corporationId}`,
		reviewedByCharacterName: a.reviewedBy ? (reviewerNames[a.reviewedBy] ?? null) : null,
	}))
}

/**
 * Enrich HR notes with author source classification.
 * - `admin`: note authored by a site admin
 * - `hr`: note authored by a non-admin HR user
 */
async function enrichHrNotesWithAuthorSource(
	db: NonNullable<Context<App>['var']['db']>,
	notes: HrNote[]
): Promise<Array<HrNote & { authorIsAdmin: boolean; source: 'admin' | 'hr' }>> {
	if (notes.length === 0) return []

	const authorIds = [...new Set(notes.map((note) => note.authorId))]
	const authorRows = await db.query.users.findMany({
		where: inArray(users.id, authorIds),
		columns: { id: true, is_admin: true },
	})
	const authorAdminMap = new Map(authorRows.map((row) => [row.id, row.is_admin]))

	return notes.map((note) => {
		const authorIsAdmin = authorAdminMap.get(note.authorId) ?? false
		return {
			...note,
			authorIsAdmin,
			source: authorIsAdmin ? 'admin' : 'hr',
		}
	})
}

type HrNoteVisibility = 'admin' | 'hr'

function getHrNoteVisibility(note: HrNote): HrNoteVisibility {
	const visibility = note.metadata?.visibility
	if (visibility === 'admin' || visibility === 'hr') return visibility
	return note.noteType === 'background_check' ? 'admin' : 'hr'
}

function canViewHrNote(note: HrNote, isSiteAdmin: boolean): boolean {
	if (isSiteAdmin) return true
	return getHrNoteVisibility(note) === 'hr'
}

/**
 * Check if the current user has any active HR role across any corporation.
 * Returns true for site admins, HR auditors, and users with any corp-scoped HR role.
 */
async function hasAnyHrAccess(c: Context<App>): Promise<boolean> {
	const user = c.get('user')!
	const access = await resolveHrAccessState({
		env: c.env,
		userId: user.id,
		isSiteAdmin: user.is_admin,
		hrStub: getHrStub(c),
	})
	return access.hasHrAccess
}

async function hasHrAuditorPermission(c: Context<App>): Promise<boolean> {
	const user = c.get('user')!
	return hasHrAuditorPermissionForUser({
		env: c.env,
		userId: user.id,
	})
}

type HrRoleManagementAccess = 'site_admin' | 'ceo' | 'hr_admin' | null

/**
 * Resolve role-management access level for the current user in a corporation.
 * Priority: site_admin > ceo > hr_admin > none
 */
async function getHrRoleManagementAccess(
	c: Context<App>,
	corporationId: string
): Promise<HrRoleManagementAccess> {
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
		return 'site_admin'
	}

	// Get user's characters to check CEO status
	const userChars = await db.query.userCharacters.findMany({
		where: eq(userCharacters.userId, user.id),
	})

	const userCharacterSet = new Set(userChars.map((c) => c.characterId))

	logger.info('[HR Auth] Checking CEO access', {
		corporationId,
		userId: user.id,
		userCharacterCount: userChars.length,
	})

	const esiStub = getStub<Esi>(c.env.ESI, 'default')
	const corporationInfo = await esiStub.fetchCorporationPublicInfo(corporationId)
	const isCeo = corporationInfo && userCharacterSet.has(corporationInfo.ceo_id)

	if (isCeo) {
		logger.info('[HR Auth] CEO access granted', {
			corporationId,
			userId: user.id,
			ceoId: corporationInfo.ceo_id,
			reason: 'corporation_ceo',
		})
		return 'ceo'
	}

	// HR admins can manage lower HR roles (reviewer/viewer)
	const hr = getHrStub(c)
	const hasHrAdmin = await hr.checkPermission(user.id, corporationId, 'hr_admin')
	if (hasHrAdmin) {
		logger.info('[HR Auth] HR admin access granted', {
			corporationId,
			userId: user.id,
			reason: 'hr_admin_role',
		})
		return 'hr_admin'
	}

	// No role-management access
	logger.warn('[HR Auth] Access denied', {
		corporationId,
		userId: user.id,
		isAdmin: user.is_admin,
		checkedCharacters: userChars.length,
	})
	return null
}

// ==================== Application Routes ====================

/**
 * POST /api/hr/applications
 * Submit a new application to a corporation
 */
app.post('/applications', requireAuth(), async (c) => {
	const user = c.get('user')!
	const db = c.get('db')
	const { characterId, corporationId, applicationText, altCharacterIds } = await c.req.json()

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	// Validate character ownership
	const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Character not found or not owned by you' }, 403)
	}

	// Validate alt character ownership
	const validAltIds: string[] = []
	if (Array.isArray(altCharacterIds)) {
		for (const altId of altCharacterIds) {
			if (typeof altId === 'string' && altId !== characterId) {
				const ownsAlt = user.characters.some((char) => char.characterId === altId)
				if (ownsAlt) {
					validAltIds.push(altId)
				}
			}
		}
	}

	const characterName = getCharacterName(user, characterId)
	const corporation = await db.query.managedCorporations.findFirst({
		where: eq(managedCorporations.corporationId, corporationId),
		columns: {
			name: true,
		},
	})

	try {
		const hr = getHrStub(c)
		const application = await hr.submitApplication(
			user.id,
			characterId,
			corporationId,
			applicationText,
			characterName,
			validAltIds
		)

		waitUntilWithTelemetry(
			c.executionCtx,
			'hr-application-submitted-alert',
			async () => {
				await dispatchCorporationAlert(c.env, db, {
					corporationId,
					alertType: 'corp_application_submitted',
					payload: {
						applicationId: application.id,
						corporationId,
						corporationName: corporation?.name ?? corporationId,
						applicantCharacterId: characterId,
						applicantCharacterName: characterName,
						altCharacterCount: validAltIds.length,
						isFirstApplication: application.isFirstApplication ?? false,
						submittedAt: application.createdAt.toISOString(),
					},
				})
			},
			{ corporationId, applicationId: application.id, characterId, userId: user.id }
		)

		return c.json(application, 201)
	} catch (error) {
		captureException(error as Error, {
			tags: { action: 'submit-application', userId: user.id, characterId, corporationId },
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to submit application' },
			400
		)
	}
})

/**
 * GET /api/hr/applications
 * List applications with optional filters
 */
app.get('/applications', requireAuth(), async (c) => {
	const user = c.get('user')!
	const searchQuery = c.req.query('search')?.trim() || undefined
	const db = c.get('db')!
	const searchCharacterIds =
		searchQuery && searchQuery.length > 0
			? (
				await db.query.userCharacters.findMany({
					where: ilike(userCharacters.characterName, `%${searchQuery}%`),
					columns: { characterId: true },
					limit: 200,
				})
			).map((character) => character.characterId)
			: []

	// Parse query params
	const filters: ApplicationFilters = {
		corporationId: c.req.query('corporationId'),
		userId: c.req.query('userId'),
		characterId: c.req.query('characterId'),
		status: c.req.query('status') as ApplicationFilters['status'],
		search: searchQuery,
		characterIds: searchCharacterIds.length > 0 ? searchCharacterIds : undefined,
		limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
		offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
	}

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const applications = await hr.listApplications(filters, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const enriched = await enrichApplications(applications, resolver, db)

		return c.json(enriched)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list applications' },
			500
		)
	}
})

/**
 * GET /api/hr/applications/paged
 * Paginated list of applications with optional filters
 */
app.get('/applications/paged', requireAuth(), async (c) => {
	const user = c.get('user')!
	const pagination = validatePagination(c.req.query('limit'), c.req.query('offset'))
	if (!pagination.success) {
		return c.json({ error: pagination.error }, pagination.status)
	}

	const searchQuery = c.req.query('search')?.trim() || undefined
	const db = c.get('db')!
	const searchCharacterIds =
		searchQuery && searchQuery.length > 0
			? (
				await db.query.userCharacters.findMany({
					where: ilike(userCharacters.characterName, `%${searchQuery}%`),
					columns: { characterId: true },
					limit: 200,
				})
			).map((character) => character.characterId)
			: []

	const filters: ApplicationFilters = {
		corporationId: c.req.query('corporationId'),
		userId: c.req.query('userId'),
		characterId: c.req.query('characterId'),
		status: c.req.query('status') as ApplicationFilters['status'],
		search: searchQuery,
		characterIds: searchCharacterIds.length > 0 ? searchCharacterIds : undefined,
		limit: pagination.data.limit,
		offset: pagination.data.offset,
	}

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const result = await hr.listApplicationsPaged(filters, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const enriched = await enrichApplications(result.items, resolver, db)

		return c.json({
			items: enriched,
			total: result.total,
			limit: result.limit,
			offset: result.offset,
			counts: result.counts,
		})
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list applications' },
			500
		)
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
		const isAuditor = await hasHrAuditorPermission(c)
		const application = await hr.getApplication(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const resolver = getStub<EsiTypeResolver>(c.env.ESI_TYPE_RESOLVER, 'global')
		const db = c.get('db')!
		const [enriched] = await enrichApplications([application], resolver, db)

		return c.json(enriched)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get application' },
			error instanceof Error && error.message.includes('permission') ? 403 : 404
		)
	}
})

/**
 * PATCH /api/hr/applications/:id
 * Update application status or review
 */
app.patch('/applications/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')
	const parseResult = updateApplicationSchema.safeParse(await c.req.json())

	if (!parseResult.success) {
		const firstIssue = parseResult.error.issues[0]
		return c.json({ error: firstIssue?.message || 'Invalid request body' }, 400)
	}

	const { status, reviewNotes } = parseResult.data

	// Get primary character for logging
	const primaryCharacter = user.characters.find((c) => c.is_primary)
	const characterId = primaryCharacter?.characterId || user.mainCharacterId
	const characterName = getCharacterName(user, characterId)

	try {
		const hr = getHrStub(c)
		await hr.updateApplicationStatus(applicationId, status, user.id, characterId, characterName, reviewNotes)

		return c.json({ success: true })
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update application'
		const isForbidden =
			message.includes('permission') ||
			message.includes('not authorized') ||
			message.includes('forbidden')

		if (!isForbidden) {
			captureException(error as Error, {
				tags: { action: 'update-application-status', userId: user.id, applicationId, status },
			})
		}
		return c.json({ error: message }, isForbidden ? 403 : 400)
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
	const characterName = getCharacterName(user, characterId)

	try {
		const hr = getHrStub(c)
		await hr.withdrawApplication(applicationId, user.id, characterId, characterName)

		return c.json({ success: true })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to withdraw application' },
			400
		)
	}
})

/**
 * POST /api/hr/applications/:id/alts
 * Add an alt character to a pending application (applicant only)
 */
app.post('/applications/:id/alts', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')

	const primaryCharacter = user.characters.find((ch) => ch.is_primary)
	const characterId = primaryCharacter?.characterId || user.mainCharacterId
	const characterName = getCharacterName(user, characterId)

	let body: { altCharacterIds: string[] }
	try {
		body = await c.req.json()
	} catch {
		return c.json({ error: 'Invalid request body' }, 400)
	}

	if (!Array.isArray(body.altCharacterIds) || body.altCharacterIds.length === 0) {
		return c.json({ error: 'altCharacterIds must be a non-empty array' }, 400)
	}

	const alts = body.altCharacterIds.map((id) => ({
		characterId: id,
		characterName: getCharacterName(user, id),
	}))

	try {
		const hr = getHrStub(c)
		await hr.addApplicationAlts(applicationId, user.id, characterId, characterName, alts)
		return c.json({ success: true })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to add alt character' },
			400
		)
	}
})

/**
 * DELETE /api/hr/applications/:id/alts/:altCharacterId
 * Remove an alt character from a pending application (applicant only)
 */
app.delete('/applications/:id/alts/:altCharacterId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')
	const altCharacterId = c.req.param('altCharacterId')

	const primaryCharacter = user.characters.find((ch) => ch.is_primary)
	const characterId = primaryCharacter?.characterId || user.mainCharacterId
	const characterName = getCharacterName(user, characterId)

	const altCharacterName = getCharacterName(user, altCharacterId)

	try {
		const hr = getHrStub(c)
		await hr.removeApplicationAlt(applicationId, user.id, characterId, characterName, altCharacterId, altCharacterName)
		return c.json({ success: true })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to remove alt character' },
			400
		)
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
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to delete application' },
			500
		)
	}
})

// ==================== Recommendation Routes ====================

/**
 * GET /api/hr/recommendations/pending
 * List pending/under_review applications for the user's corporations
 * Used by corp members to discover applications they can recommend
 */
app.get('/recommendations/pending', requireAuth(), async (c) => {
	const user = c.get('user')!
	const db = c.get('db')!

	// Resolve corporation IDs from the database (session user doesn't carry corporationId)
	const userChars = await db.query.userCharacters.findMany({
		where: and(eq(userCharacters.userId, user.id), eq(userCharacters.isDeleted, false)),
	})
	const corporationIds = [
		...new Set(userChars.map((ch) => ch.corporationId).filter(Boolean)),
	] as string[]

	if (corporationIds.length === 0) {
		return c.json([])
	}

	try {
		const hr = getHrStub(c)
		const applications = await hr.listCorpApplicationsForRecommendation(corporationIds, user.id)
		return c.json(applications)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list applications' },
			500
		)
	}
})

/**
 * GET /api/hr/recommendations/applications/:id
 * Get application detail for a corp member to write a recommendation
 * Returns limited info (no HR-internal data)
 */
app.get('/recommendations/applications/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('id')
	const db = c.get('db')!

	// Resolve corporation IDs from the database (session user doesn't carry corporationId)
	const userChars = await db.query.userCharacters.findMany({
		where: and(eq(userCharacters.userId, user.id), eq(userCharacters.isDeleted, false)),
	})
	const corporationIds = [
		...new Set(userChars.map((ch) => ch.corporationId).filter(Boolean)),
	] as string[]

	try {
		const hr = getHrStub(c)
		const application = await hr.getApplicationForRecommender(
			applicationId,
			user.id,
			corporationIds
		)
		return c.json(application)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get application' },
			error instanceof Error && error.message.includes('permission') ? 403 : 400
		)
	}
})

/**
 * POST /api/hr/applications/:applicationId/recommendations
 * Add a recommendation for an application
 */
app.post('/applications/:applicationId/recommendations', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')
	const { characterId, recommendationText, sentiment, isPublic } = await c.req.json()

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
			sentiment,
			isPublic ?? false
		)

		return c.json(recommendation, 201)
	} catch (error) {
		captureException(error as Error, {
			tags: { action: 'add-recommendation', userId: user.id, applicationId },
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to add recommendation' },
			400
		)
	}
})

/**
 * PATCH /api/hr/applications/:applicationId/recommendations/:id
 * Update a recommendation
 */
app.patch('/applications/:applicationId/recommendations/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const recommendationId = c.req.param('id')
	const { characterId, recommendationText, sentiment, isPublic } = await c.req.json()

	try {
		const hr = getHrStub(c)
		await hr.updateRecommendation(
			recommendationId,
			user.id,
			characterId || user.mainCharacterId,
			recommendationText,
			sentiment,
			isPublic ?? false,
			user.is_admin
		)

		return c.json({ success: true })
	} catch (error) {
		captureException(error as Error, {
			tags: { action: 'update-recommendation', userId: user.id, recommendationId },
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to update recommendation' },
			400
		)
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
		captureException(error as Error, {
			tags: { action: 'delete-recommendation', userId: user.id, recommendationId },
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to delete recommendation' },
			400
		)
	}
})

// ==================== Message Routes ====================

/**
 * POST /api/hr/applications/:applicationId/messages
 * Send a message (applicant → HR or HR → applicant)
 * Applicants can always message on their own applications.
 * HR staff require at least hr_reviewer role to send messages.
 */
app.post('/applications/:applicationId/messages', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')
	const { recipientId, message } = await c.req.json()

	try {
		const hr = getHrStub(c)

		// Check if sender is the applicant — if not, require hr_reviewer
		const application = await hr.getApplication(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor: false,
		})
		const isApplicant = application.userId === user.id

		if (!isApplicant && !user.is_admin) {
			const hasPermission = await hr.checkPermission(
				user.id,
				application.corporationId,
				'hr_reviewer'
			)
			if (!hasPermission) {
				return c.json({ error: 'HR reviewer or admin role required to send messages' }, 403)
			}
		}

		// Get primary character for logging
		const primaryCharacter = user.characters.find((char) => char.is_primary)
		const characterId = primaryCharacter?.characterId || user.mainCharacterId

		const result = await hr.sendMessage(
			applicationId,
			user.id,
			recipientId || null,
			message,
			characterId,
			{ isApplicant, isAdmin: user.is_admin, corporationId: application.corporationId }
		)

		// Enrich the returned message with sender character name
		const senderName = primaryCharacter?.characterName || 'Unknown'

		return c.json({ ...result, senderCharacterName: senderName }, 201)
	} catch (error) {
		captureException(error as Error, {
			tags: { action: 'send-message', userId: user.id, applicationId },
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to send message' }, 400)
	}
})

/**
 * GET /api/hr/applications/:applicationId/messages
 * List all messages for an application
 */
app.get('/applications/:applicationId/messages', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const messages = await hr.listMessages(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		// Resolve sender character names
		const db = c.get('db')!
		const senderIds = messages.map((m) => m.senderId)
		const senderNames = await resolveUserCharacterNames(db, senderIds)

		const enriched = messages.map((m) => ({
			...m,
			senderCharacterName: senderNames[m.senderId] ?? null,
		}))

		return c.json(enriched)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list messages' },
			error instanceof Error && error.message.includes('permission') ? 403 : 500
		)
	}
})

/**
 * GET /api/hr/applications/:applicationId/messages/count
 * Get message count (for badge display)
 */
app.get('/applications/:applicationId/messages/count', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const count = await hr.getMessageCount(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		return c.json({ count })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get message count' },
			error instanceof Error && error.message.includes('permission') ? 403 : 500
		)
	}
})

// ==================== Application Staff Notes Routes ====================

/**
 * GET /api/hr/applications/:applicationId/staff-notes
 * List HR staff notes scoped to a specific application.
 * Access: HR viewer/reviewer/admin for the application's corporation, or HR auditor.
 */
app.get('/applications/:applicationId/staff-notes', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const application = await hr.getApplication(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const hasHrPermission =
			user.is_admin ||
			isAuditor ||
			(await hr.checkPermission(user.id, application.corporationId, 'hr_viewer'))
		if (!hasHrPermission) {
			return c.json({ error: 'HR staff access required' }, 403)
		}

		const notes = await hr.listApplicationStaffNotes(applicationId)
		return c.json(notes)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to list application staff notes'
		const status = message.includes('permission') ? 403 : 400
		return c.json({ error: message }, status)
	}
})

/**
 * POST /api/hr/applications/:applicationId/staff-notes
 * Add an HR staff note for a specific application.
 * Access: HR reviewer/admin for the application's corporation.
 */
app.post('/applications/:applicationId/staff-notes', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')
	const parseResult = upsertApplicationStaffNoteSchema.safeParse(await c.req.json())

	if (!parseResult.success) {
		const firstIssue = parseResult.error.issues[0]
		return c.json({ error: firstIssue?.message || 'Invalid request body' }, 400)
	}

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const application = await hr.getApplication(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const managementAccess = await getHrRoleManagementAccess(c, application.corporationId)
		const hasHrStaffPermission = await hr.checkPermission(user.id, application.corporationId, 'hr_viewer')
		const hasWritePermission =
			user.is_admin ||
			managementAccess === 'ceo' ||
			hasHrStaffPermission
		if (!hasWritePermission) {
			return c.json({ error: 'HR staff, CEO, or admin access required' }, 403)
		}

		const primaryCharacter = user.characters.find((char) => char.is_primary)
		const authorCharacterId = primaryCharacter?.characterId ?? user.mainCharacterId
		const authorCharacterName = getCharacterName(user, authorCharacterId)

		const note = await hr.addApplicationStaffNote(
			applicationId,
			user.id,
			authorCharacterId,
			authorCharacterName,
			parseResult.data.noteText
		)
		return c.json(note, 201)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to add application staff note'
		const status = message.includes('permission') ? 403 : 400
		return c.json({ error: message }, status)
	}
})

/**
 * PATCH /api/hr/applications/:applicationId/staff-notes/:noteId
 * Update an application staff note.
 * Access: HR reviewer/admin for the application's corporation.
 */
app.patch('/applications/:applicationId/staff-notes/:noteId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')
	const noteId = c.req.param('noteId')
	const parseResult = upsertApplicationStaffNoteSchema.safeParse(await c.req.json())

	if (!parseResult.success) {
		const firstIssue = parseResult.error.issues[0]
		return c.json({ error: firstIssue?.message || 'Invalid request body' }, 400)
	}

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const application = await hr.getApplication(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const managementAccess = await getHrRoleManagementAccess(c, application.corporationId)
		const hasHrStaffPermission = await hr.checkPermission(user.id, application.corporationId, 'hr_viewer')
		const hasWritePermission =
			user.is_admin ||
			managementAccess === 'ceo' ||
			hasHrStaffPermission
		if (!hasWritePermission) {
			return c.json({ error: 'HR staff, CEO, or admin access required' }, 403)
		}

		const existing = await hr.listApplicationStaffNotes(applicationId)
		const note = existing.find((candidate) => candidate.id === noteId)
		if (!note) {
			return c.json({ error: 'Application staff note not found' }, 404)
		}
		if (note.authorId !== user.id) {
			return c.json({ error: 'You can only edit your own application notes' }, 403)
		}

		const primaryCharacter = user.characters.find((char) => char.is_primary)
		const actorCharacterId = primaryCharacter?.characterId ?? user.mainCharacterId
		const actorCharacterName = getCharacterName(user, actorCharacterId)

		const updated = await hr.updateApplicationStaffNote(
			noteId,
			parseResult.data.noteText,
			user.id,
			actorCharacterId,
			actorCharacterName
		)
		if (updated.applicationId !== applicationId) {
			return c.json({ error: 'Application staff note not found' }, 404)
		}
		return c.json(updated)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update application staff note'
		const status = message.includes('permission') ? 403 : 400
		return c.json({ error: message }, status)
	}
})

/**
 * DELETE /api/hr/applications/:applicationId/staff-notes/:noteId
 * Delete an application staff note.
 * Access: HR reviewer/admin for the application's corporation.
 */
app.delete('/applications/:applicationId/staff-notes/:noteId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const applicationId = c.req.param('applicationId')
	const noteId = c.req.param('noteId')

	try {
		const hr = getHrStub(c)
		const isAuditor = await hasHrAuditorPermission(c)
		const application = await hr.getApplication(applicationId, user.id, {
			isAdmin: user.is_admin,
			isAuditor,
		})

		const managementAccess = await getHrRoleManagementAccess(c, application.corporationId)
		const hasHrStaffPermission = await hr.checkPermission(user.id, application.corporationId, 'hr_viewer')
		const hasWritePermission =
			user.is_admin ||
			managementAccess === 'ceo' ||
			hasHrStaffPermission
		if (!hasWritePermission) {
			return c.json({ error: 'HR staff, CEO, or admin access required' }, 403)
		}

		const existing = await hr.listApplicationStaffNotes(applicationId)
		const note = existing.find((candidate) => candidate.id === noteId)
		if (!note) {
			return c.json({ error: 'Application staff note not found' }, 404)
		}
		if (note.authorId !== user.id) {
			return c.json({ error: 'You can only delete your own application notes' }, 403)
		}

		const primaryCharacter = user.characters.find((char) => char.is_primary)
		const actorCharacterId = primaryCharacter?.characterId ?? user.mainCharacterId
		const actorCharacterName = getCharacterName(user, actorCharacterId)

		await hr.deleteApplicationStaffNote(noteId, user.id, actorCharacterId, actorCharacterName)
		return c.json({ success: true })
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to delete application staff note'
		const status = message.includes('permission') ? 403 : 400
		return c.json({ error: message }, status)
	}
})

// ==================== Message Template Routes ====================

/**
 * GET /api/hr/corporations
 * List corporations where the current authenticated user has HR role access.
 * Returns corporation metadata with the highest effective HR role for each corporation.
 */
app.get('/corporations', requireAuth(), async (c) => {
	const user = c.get('user')!
	const db = c.get('db')

	if (!db) {
		return c.json({ error: 'Database not available' }, 500)
	}

	try {
		const allCorpsQuery = async () => {
			const corporations = await db.query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.isActive, true),
					or(
						eq(managedCorporations.isMemberCorporation, true),
						eq(managedCorporations.isAltCorp, true),
						eq(managedCorporations.isSpecialPurpose, true)
					)
				),
				columns: {
					corporationId: true,
					name: true,
					ticker: true,
					isMemberCorporation: true,
					isAltCorp: true,
					isSpecialPurpose: true,
				},
			})
			return corporations
		}

		if (user.is_admin) {
			const corporations = await allCorpsQuery()
			return c.json(
				corporations
					.map((corp) => ({
						corporationId: corp.corporationId,
						name: corp.name,
						ticker: corp.ticker,
						isMemberCorporation: corp.isMemberCorporation,
						isAltCorp: corp.isAltCorp,
						isSpecialPurpose: corp.isSpecialPurpose,
						currentRole: 'hr_admin' as const,
					}))
					.sort((a, b) => a.name.localeCompare(b.name))
			)
		}

		if (await hasHrAuditorPermission(c)) {
			const corporations = await allCorpsQuery()
			return c.json(
				corporations
					.map((corp) => ({
						corporationId: corp.corporationId,
						name: corp.name,
						ticker: corp.ticker,
						isMemberCorporation: corp.isMemberCorporation,
						isAltCorp: corp.isAltCorp,
						isSpecialPurpose: corp.isSpecialPurpose,
						currentRole: 'hr_viewer' as const,
					}))
					.sort((a, b) => a.name.localeCompare(b.name))
			)
		}

		const hr = getHrStub(c)
		const corporationIds = await hr.getUserHrCorporations(user.id)
		const uniqueCorporationIds = [...new Set(corporationIds)]

		if (uniqueCorporationIds.length === 0) {
			return c.json([])
		}

		const corporations = await db.query.managedCorporations.findMany({
			where: inArray(managedCorporations.corporationId, uniqueCorporationIds),
			columns: {
				corporationId: true,
				name: true,
				ticker: true,
				isMemberCorporation: true,
				isAltCorp: true,
				isSpecialPurpose: true,
			},
		})
		const corporationMap = new Map(corporations.map((corp) => [corp.corporationId, corp]))

		const roleHierarchy: Record<'hr_viewer' | 'hr_reviewer' | 'hr_admin', number> = {
			hr_admin: 3,
			hr_reviewer: 2,
			hr_viewer: 1,
		}
		const explicitUserRoles = await hr.getUserRoles(user.id)
		const highestExplicitRoleByCorp = new Map<
			string,
			typeof explicitUserRoles[number]['role']
		>()
		for (const role of explicitUserRoles.filter((r) => r.isActive)) {
			const corpId = role.corporationId
			if (!corpId) continue
			const existing = highestExplicitRoleByCorp.get(corpId)
			if (!existing || roleHierarchy[role.role] > roleHierarchy[existing]) {
				highestExplicitRoleByCorp.set(corpId, role.role)
			}
		}

		const results = uniqueCorporationIds.map((corporationId) => {
				const explicitRole = highestExplicitRoleByCorp.get(corporationId)
				// getUserHrCorporations() also includes inferred leadership access (CEO/Director),
				// which currently maps to admin-level HR capability.
				const currentRole = explicitRole ?? 'hr_admin'
				const corporation = corporationMap.get(corporationId)
				return {
					corporationId,
					name: corporation?.name ?? `Corporation ${corporationId}`,
					ticker: corporation?.ticker ?? '',
					isMemberCorporation: corporation?.isMemberCorporation ?? false,
					isAltCorp: corporation?.isAltCorp ?? false,
					isSpecialPurpose: corporation?.isSpecialPurpose ?? false,
					currentRole,
				}
			})

		return c.json(
			results
				.sort((a, b) => a.name.localeCompare(b.name))
		)
	} catch (error) {
		logger.error('[HR Roles] Failed to list accessible HR corporations', {
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list HR corporations' },
			500
		)
	}
})

/**
 * POST /api/hr/:corporationId/templates
 * Create a new message template for a corporation
 * REQUIRES: HR admin or reviewer role for the corporation
 */
app.post('/:corporationId/templates', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const { templateName, messageTemplate, description, status } = await c.req.json()

	try {
		// Check HR permission
		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_reviewer')

		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR reviewer or admin role required' }, 403)
		}

		const template = await hr.createTemplate(
			corporationId,
			templateName,
			messageTemplate,
			description,
			status
		)

		logger.info('[HR Templates] Template created', {
			templateId: template.id,
			corporationId,
			createdBy: user.id,
		})

		return c.json(template, 201)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to create template' },
			400
		)
	}
})

/**
 * GET /api/hr/:corporationId/templates
 * List templates for a corporation
 * Query params:
 *   - status: Optional - filter by status ('draft', 'active', 'inactive', 'deleted')
 */
app.get('/:corporationId/templates', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const status = c.req.query('status') as 'draft' | 'active' | 'inactive' | 'deleted' | undefined

	try {
		// Check HR permission (any HR role can view templates)
		const hr = getHrStub(c)
		const hasPermission = await hr.checkPermission(user.id, corporationId, 'hr_viewer')

		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
		}

		const templates = await hr.listTemplates(corporationId, status)

		return c.json(templates)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to list templates' },
			500
		)
	}
})

/**
 * GET /api/hr/templates/:templateId
 * Get a single template by ID
 */
app.get('/templates/:templateId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('templateId')

	try {
		const hr = getHrStub(c)
		const template = await hr.getTemplate(templateId)

		if (!template) {
			return c.json({ error: 'Template not found' }, 404)
		}

		// Check HR permission for the template's corporation
		const hasPermission = await hr.checkPermission(
			user.id,
			template.ownerCorporationId,
			'hr_viewer'
		)

		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR role required' }, 403)
		}

		return c.json(template)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to get template' }, 500)
	}
})

/**
 * PATCH /api/hr/templates/:templateId
 * Update a template
 */
app.patch('/templates/:templateId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('templateId')
	const updates = await c.req.json()

	try {
		const hr = getHrStub(c)
		const template = await hr.getTemplate(templateId)

		if (!template) {
			return c.json({ error: 'Template not found' }, 404)
		}

		// Check HR permission (admin required to edit)
		const hasPermission = await hr.checkPermission(user.id, template.ownerCorporationId, 'hr_admin')

		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR admin role required' }, 403)
		}

		const updated = await hr.updateTemplate(templateId, updates)

		logger.info('[HR Templates] Template updated', {
			templateId,
			updatedBy: user.id,
		})

		return c.json(updated)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to update template' },
			400
		)
	}
})

/**
 * DELETE /api/hr/templates/:templateId
 * Delete a template (soft delete)
 */
app.delete('/templates/:templateId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const templateId = c.req.param('templateId')

	try {
		const hr = getHrStub(c)
		const template = await hr.getTemplate(templateId)

		if (!template) {
			return c.json({ error: 'Template not found' }, 404)
		}

		// Check HR permission (admin required to delete)
		const hasPermission = await hr.checkPermission(user.id, template.ownerCorporationId, 'hr_admin')

		if (!hasPermission && !user.is_admin) {
			return c.json({ error: 'HR admin role required' }, 403)
		}

		await hr.deleteTemplate(templateId)

		logger.info('[HR Templates] Template deleted', {
			templateId,
			deletedBy: user.id,
		})

		return c.json({ success: true })
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to delete template' },
			500
		)
	}
})

// ==================== HR Notes Routes ====================

/**
 * POST /api/hr/notes
 * Create an HR note about a user
 * Access: Site admins, HR admins, HR reviewers
 */
app.post('/notes', requireAuth(), async (c) => {
	const user = c.get('user')!

	if (!(await hasAnyHrAccess(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}
	const { subjectUserId, subjectCharacterId, noteText, noteType, priority, metadata } =
		await c.req.json()
	const requestedVisibility = metadata?.visibility
	const normalizedVisibility: HrNoteVisibility =
		requestedVisibility === 'admin' || requestedVisibility === 'hr'
			? requestedVisibility
			: noteType === 'background_check'
				? 'admin'
				: 'hr'
	const effectiveVisibility: HrNoteVisibility = user.is_admin ? normalizedVisibility : 'hr'
	const enrichedMetadata = {
		...(metadata ?? {}),
		visibility: effectiveVisibility,
	}

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
			enrichedMetadata
		)

		logger.info('[HR Notes] Note created', {
			noteId: note.id,
			noteType,
			priority,
			authorUserId: user.id,
			subjectUserId,
		})

		return c.json(note, 201)
	} catch (error) {
		captureException(error as Error, {
			tags: { action: 'create-note', userId: user.id, subjectUserId },
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to create note' }, 400)
	}
})

/**
 * GET /api/hr/notes
 * List HR notes with optional filters
 * Access: Site admins, HR admins, HR reviewers
 */
app.get('/notes', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!(await hasAnyHrAccess(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

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
		const visibleNotes = notes.filter((note) => canViewHrNote(note, user.is_admin))
		const db = c.get('db')
		if (!db) return c.json(visibleNotes)
		const enriched = await enrichHrNotesWithAuthorSource(db, visibleNotes)
		return c.json(enriched)
	} catch (error) {
		return c.json({ error: error instanceof Error ? error.message : 'Failed to list notes' }, 500)
	}
})

/**
 * GET /api/hr/notes/user/:userId
 * Get all HR notes for a specific user
 * Access: Site admins, HR admins, HR reviewers
 */
app.get('/notes/user/:userId', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!(await hasAnyHrAccess(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const subjectUserId = c.req.param('userId')

	try {
		const hr = getHrStub(c)
		const notes = await hr.getUserNotes(subjectUserId)
		const visibleNotes = notes.filter((note) => canViewHrNote(note, user.is_admin))
		const db = c.get('db')
		if (!db) return c.json(visibleNotes)
		const enriched = await enrichHrNotesWithAuthorSource(db, visibleNotes)
		return c.json(enriched)
	} catch (error) {
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get user notes' },
			500
		)
	}
})

/**
 * PATCH /api/hr/notes/:id
 * Update an HR note
 * Access: Site admins only
 */
app.patch('/notes/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin) {
		return c.json({ error: 'Forbidden - only site admins can edit notes' }, 403)
	}

	const noteId = c.req.param('id')
	const updates = await c.req.json()

	try {
		const hr = getHrStub(c)
		await hr.updateNote(noteId, updates)

		logger.info('[HR Notes] Note updated', { noteId, userId: user.id })

		return c.json({ success: true })
	} catch (error) {
		captureException(error as Error, { tags: { action: 'update-note', userId: user.id, noteId } })
		return c.json({ error: error instanceof Error ? error.message : 'Failed to update note' }, 400)
	}
})

/**
 * DELETE /api/hr/notes/:id
 * Delete an HR note
 * Access: Site admins, HR admins only (not reviewers)
 */
app.delete('/notes/:id', requireAuth(), async (c) => {
	const user = c.get('user')!

	if (!user.is_admin) {
		return c.json({ error: 'Forbidden - only site admins can delete notes' }, 403)
	}

	const noteId = c.req.param('id')

	try {
		const hr = getHrStub(c)
		await hr.deleteNote(noteId)

		logger.info('[HR Notes] Note deleted', { noteId, userId: user.id })

		return c.json({ success: true })
	} catch (error) {
		captureException(error as Error, { tags: { action: 'delete-note', userId: user.id, noteId } })
		return c.json({ error: error instanceof Error ? error.message : 'Failed to delete note' }, 500)
	}
})

// ==================== HR Roles Routes ====================

/**
 * POST /api/hr/:corporationId/roles
 * Grant an HR role to a user for a corporation
 * REQUIRES: CEO, site admin, or HR admin access
 * CONSTRAINTS:
 *   - Only CEOs and site admins can grant hr_admin
 *   - HR admins can grant only hr_reviewer/hr_viewer
 */
app.post('/:corporationId/roles', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const { userId, characterId, role, expiresAt } = await c.req.json()

	// Authorization check
	const managementAccess = await getHrRoleManagementAccess(c, corporationId)
	if (!managementAccess) {
		return c.json({ error: 'Access denied. CEO, HR admin, or site admin access is required.' }, 403)
	}

	// Only CEOs and site admins can grant HR admin
	if (role === 'hr_admin' && managementAccess !== 'ceo' && managementAccess !== 'site_admin') {
		return c.json({ error: 'Access denied. Only corporation CEOs or site admins can grant HR admin.' }, 403)
	}

	// HR admins can only grant lower roles
	if (managementAccess === 'hr_admin' && role === 'hr_admin') {
		return c.json({ error: 'Access denied. HR admins can only grant reviewer/viewer roles.' }, 403)
	}

	// Get character name
	const coreStub = getCoreStub(c)
	const characterOwner = await coreStub.getCharacterOwner(characterId)

	if (!characterOwner) {
		return c.json({ error: 'Character not linked to any user' }, 404)
	}

	try {
		const hr = getHrStub(c)
		const hrRole = await hr.grantRole(
			corporationId,
			characterOwner.userId,
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
	const db = c.get('db')

	const managementAccess = await getHrRoleManagementAccess(c, corporationId)
	if (!managementAccess) {
		return c.json({ error: 'Access denied. CEO, HR admin, or site admin access is required.' }, 403)
	}

	try {
		if (!db) {
			return c.json({ error: 'Database not available' }, 500)
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
			roles = await hr.getCorporationRoles(corporationId, false)
			logger.info('[HR Roles] Fetched corporation roles', {
				corporationId,
				count: roles.length,
			})
		}

		const userIds = [...new Set(roles.map((role) => role.userId).filter(Boolean))]
		const identityByUserId = await resolveUserPrimaryCharacterIdentity(db, userIds)
		const enrichedRoles = roles.map((role) => {
			const identity = identityByUserId[role.userId]
			if (!identity) return role
			return {
				...role,
				characterId: identity.characterId,
				characterName: identity.characterName,
			}
		})

		return c.json(enrichedRoles)
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
	const requiredRole = c.req.query('requiredRole') as
		| 'hr_viewer'
		| 'hr_reviewer'
		| 'hr_admin'
		| undefined

	if (!corporationId) {
		return c.json({ error: 'corporationId is required' }, 400)
	}

	// SECURITY: ALWAYS use the authenticated user's ID from session, NEVER from query params
	const userId = user.id

	// Site admins always have full HR admin access
	if (user.is_admin) {
		logger.info('[HR Roles] Permission check - site admin bypass', {
			corporationId,
			userId,
			currentRole: 'hr_admin',
			hasPermission: true,
		})
		return c.json({ hasPermission: true, currentRole: 'hr_admin' })
	}

	try {
		const hr = getHrStub(c)
		const roles = await hr.getUserRoles(userId, corporationId)

		// Filter to active roles only
		const activeRoles = roles.filter((r) => r.isActive)

		if (activeRoles.length === 0) {
			// HR auditors have cross-corp read-only access equivalent to hr_viewer
			if (await hasHrAuditorPermission(c)) {
				return c.json({ hasPermission: true, currentRole: 'hr_viewer' })
			}
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
		return c.json(
			{ error: error instanceof Error ? error.message : 'Permission check failed' },
			500
		)
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
 * REQUIRES: CEO, site admin, or HR admin access
 * CONSTRAINTS:
 *   - HR admins cannot revoke other hr_admin roles
 */
app.delete('/:corporationId/roles/:roleId', requireAuth(), async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.param('corporationId')
	const roleId = c.req.param('roleId')

	// Authorization check
	const managementAccess = await getHrRoleManagementAccess(c, corporationId)
	if (!managementAccess) {
		return c.json({ error: 'Access denied. CEO, HR admin, or site admin access is required.' }, 403)
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

		if (managementAccess === 'hr_admin' && role.role === 'hr_admin') {
			return c.json({ error: 'Access denied. HR admins cannot revoke other HR admins.' }, 403)
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

// ==================== Auditor Routes ====================

/**
 * GET /api/hr/audit/users
 * Search users across all corporations — requires urn:hr:auditor permission or site admin
 */
app.get('/audit/users', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin && !(await hasHrAuditorPermission(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const search = c.req.query('search')
	const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : 25
	const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : 0

	try {
		const result = await c.env.ADMIN.searchUsers({ search, limit, offset }, user.id)
		return c.json(result)
	} catch (error) {
		logger.error('[HR Audit] Failed to search users', {
			userId: user.id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: error instanceof Error ? error.message : 'Failed to search users' }, 500)
	}
})

/**
 * GET /api/hr/audit/users/:userId
 * Get detailed user info — requires urn:hr:auditor permission or site admin
 */
app.get('/audit/users/:userId', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin && !(await hasHrAuditorPermission(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const targetUserId = c.req.param('userId')

	try {
		const details = await c.env.ADMIN.getUserDetails(targetUserId, user.id)
		if (!details) {
			return c.json({ error: 'User not found' }, 404)
		}
		return c.json(details)
	} catch (error) {
		logger.error('[HR Audit] Failed to get user details', {
			userId: user.id,
			targetUserId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json(
			{ error: error instanceof Error ? error.message : 'Failed to get user details' },
			500
		)
	}
})

/**
 * GET /api/hr/audit/users/:userId/ip-history
 * Hashed-only IP history for a user.
 */
app.get('/audit/users/:userId/ip-history', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin && !(await hasHrAuditorPermission(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	const targetUserId = c.req.param('userId')
	try {
		const entries = await getUserIpHistory(db, targetUserId)
		return c.json({ entries })
	} catch (error) {
		logger.error('[HR Audit] Failed to get user IP history', {
			userId: user.id,
			targetUserId,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to fetch IP history' }, 500)
	}
})

/**
 * GET /api/hr/audit/ip-history/:ipAddressHash/matches
 * Hashed-only user matches for a shared IP hash.
 */
app.get('/audit/ip-history/:ipAddressHash/matches', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin && !(await hasHrAuditorPermission(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const db = c.get('db')
	if (!db) return c.json({ error: 'Database unavailable' }, 500)

	const ipAddressHash = c.req.param('ipAddressHash')
	try {
		const matches = await getIpHashMatches(db, ipAddressHash)
		return c.json({ matches })
	} catch (error) {
		logger.error('[HR Audit] Failed to get IP hash matches', {
			userId: user.id,
			ipAddressHash,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to fetch IP hash matches' }, 500)
	}
})

/**
 * GET /api/hr/legacy/history
 * Read-only legacy applications history for HR staff.
 */
app.get('/legacy/history', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin && !(await hasAnyHrAccess(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const legacy = getLegacyStub(c)
	const result = await legacy.listHistory({
		page: Number(c.req.query('page') ?? '1'),
		pageSize: Number(c.req.query('pageSize') ?? '25'),
		corporationId: c.req.query('corporationId') || undefined,
		characterIds: c.req.query('characterIds') || undefined,
		characterName: c.req.query('characterName') || undefined,
		corporationName: c.req.query('corporationName') || undefined,
	})
	return c.json(result)
})

/**
 * GET /api/hr/legacy/history/:legacyApplicationId
 * Read-only legacy application detail for HR staff.
 */
app.get('/legacy/history/:legacyApplicationId', requireAuth(), async (c) => {
	const user = c.get('user')!
	if (!user.is_admin && !(await hasAnyHrAccess(c))) {
		return c.json({ error: 'Forbidden' }, 403)
	}

	const legacyApplicationId = c.req.param('legacyApplicationId')
	const legacy = getLegacyStub(c)
	const result = await legacy.getHistoryApplication(legacyApplicationId)
	if (!result) return c.json({ error: 'Legacy application not found' }, 404)

	let modernUserMatch: { userId: string; characterId: string } | null = null
	const actorMatches: Record<string, { userId: string; mainCharacterName: string | null }> = {}
	const db = c.get('db')
	if (db) {
		if (result.application.characterId) {
			const match = await db.query.userCharacters.findFirst({
				where: and(
					eq(userCharacters.characterId, result.application.characterId),
					eq(userCharacters.isDeleted, false)
				),
				columns: { userId: true, characterId: true },
			})
			if (match) {
				modernUserMatch = {
					userId: match.userId,
					characterId: match.characterId,
				}
			}
		}

		const actorLegacyIds = [
			...new Set(
				result.events
					.map((event) => event.legacyActorUserId)
					.filter((id): id is string => Boolean(id))
			),
		]
		if (actorLegacyIds.length > 0) {
			const actorUsers = await db.query.users.findMany({
				where: inArray(users.legacyAuthUserId, actorLegacyIds),
				columns: { id: true, legacyAuthUserId: true, mainCharacterId: true },
			})
			const mainCharacterIds = actorUsers.map((userRow) => userRow.mainCharacterId)
			const chars =
				mainCharacterIds.length > 0
					? await db.query.userCharacters.findMany({
							where: inArray(userCharacters.characterId, mainCharacterIds),
							columns: { characterId: true, characterName: true },
						})
					: []
			const charNameById = new Map(chars.map((char) => [char.characterId, char.characterName]))
			for (const actorUser of actorUsers) {
				if (!actorUser.legacyAuthUserId) continue
				actorMatches[actorUser.legacyAuthUserId] = {
					userId: actorUser.id,
					mainCharacterName: charNameById.get(actorUser.mainCharacterId) ?? null,
				}
			}
		}
	}

	return c.json({
		...result,
		modernUserMatch,
		actorMatches,
		actorLegacyCharacterNames: result.actorLegacyCharacterNames ?? {},
	})
})

export default app
