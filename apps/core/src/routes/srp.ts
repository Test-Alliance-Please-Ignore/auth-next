import { Hono } from 'hono'
import { z } from 'zod'

import { and, eq, inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'
import {
	CreateCommentSchema,
	CreateSRPPolicySchema,
	CreateSRPRequestSchema,
	EditCommentSchema,
	REQUEST_STATUSES,
	SRPReviewSubmissionSchema,
	UpdateReviewStateSchema,
	UpdateSRPConfigSchema,
} from '@repo/srp'

import { createDb } from '../db'
import { userCharacters } from '../db/schema'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { requireAllianceMember } from '../middleware/session'

import type { EveCharacterData } from '@repo/eve-character-data'
import type { SRPCommentResponse, SRPRequestResponse, Srp } from '@repo/srp'
import type { App } from '../context'

const ApproveRequestSchema = z.object({
	approvedAmount: z.string(),
	reviewNotes: z.string().max(2000).optional(),
})

const PartiallyApproveRequestSchema = z.object({
	approvedAmount: z.string(),
	rejectionReason: z.string().min(10).max(2000),
	reviewNotes: z.string().max(2000).optional(),
})

const RejectRequestSchema = z.object({
	rejectionReason: z.string().min(10).max(2000),
	reviewNotes: z.string().max(2000).optional(),
})

const RequestStatusQuerySchema = z.enum(REQUEST_STATUSES)
const RequestSearchFieldQuerySchema = z.enum(['character', 'ship', 'system'])

/**
 * Permission check cache - 15 second TTL
 * Caches the boolean result of permission checks
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Helper function to get Cloudflare request ID for DO instance isolation
 * Falls back to random UUID if cf-ray header is not present
 */
function getRequestId(c: any): string {
	return c.req.header('cf-ray') || crypto.randomUUID()
}

/** Get the primary character name for the session user */
function getPrimaryCharacterName(user: any): string {
	return user.characters.find((c: any) => c.is_primary)?.characterName ?? 'Unknown'
}

const SRP_ROLE_URNS = ['urn:srp:reviewer', 'urn:srp:payer', 'urn:srp:manager']

/** Hydrate authorCharacterName, authorCharacterId, and authorRole on comments */
async function hydrateCommentAuthors(
	comments: SRPCommentResponse[],
	databaseUrl: string,
	env: { GROUPS: DurableObjectNamespace },
	requestUserId: string
): Promise<SRPCommentResponse[]> {
	if (comments.length === 0) return comments
	const userIds = [...new Set(comments.map((c) => c.authorUserId))]
	const db = createDb(databaseUrl)
	const rows = await db
		.select({
			userId: userCharacters.userId,
			characterName: userCharacters.characterName,
			characterId: userCharacters.characterId,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))
	const charMap = Object.fromEntries(
		rows.map((r) => [r.userId, { name: r.characterName, characterId: r.characterId }])
	)

	// Determine SRP staff role for each non-requestor author
	const nonRequestorIds = userIds.filter((id) => id !== requestUserId)
	const staffSet = new Set<string>()
	await Promise.all(
		nonRequestorIds.map(async (userId) => {
			const perms = await getCachedUserPermissions(env, userId)
			if (perms.some((p) => SRP_ROLE_URNS.includes(p.urn))) {
				staffSet.add(userId)
			}
		})
	)

	return comments.map((c) => ({
		...c,
		authorCharacterName: charMap[c.authorUserId]?.name ?? c.authorCharacterName,
		authorCharacterId: charMap[c.authorUserId]?.characterId,
		authorRole:
			c.authorUserId === requestUserId
				? 'requestor'
				: staffSet.has(c.authorUserId)
					? 'staff'
					: undefined,
	}))
}

type RequestWithCharacterRole = SRPRequestResponse & { characterRole?: 'main' | 'alt' }

async function hydrateRequestCharacterRoles(
	requests: RequestWithCharacterRole[],
	databaseUrl: string
): Promise<RequestWithCharacterRole[]> {
	if (requests.length === 0) return requests

	const userIds = [...new Set(requests.map((request) => request.userId))]
	const db = createDb(databaseUrl)
	const rows = await db
		.select({
			userId: userCharacters.userId,
			characterId: userCharacters.characterId,
		})
		.from(userCharacters)
		.where(and(eq(userCharacters.is_primary, true), inArray(userCharacters.userId, userIds)))

	const mainCharacterByUserId = new Map(rows.map((row) => [row.userId, row.characterId]))

	return requests.map((request) => {
		const mainCharacterId = mainCharacterByUserId.get(request.userId)
		if (!mainCharacterId) return request
		return {
			...request,
			characterRole: request.characterId === mainCharacterId ? 'main' : 'alt',
		}
	})
}

/**
 * Helper function to check if a user has a specific permission
 * Results are cached for 15 seconds to reduce load on Groups DO
 */
async function hasPermission(
	env: { GROUPS: DurableObjectNamespace },
	userId: string,
	permissionUrn: string,
	isAdmin: boolean
): Promise<boolean> {
	// Admins bypass permission checks
	if (isAdmin) return true

	// Check cache or fetch user permissions
	const cacheKey = `${userId}:${permissionUrn}`
	return permissionCache.getOrSet(cacheKey, async () => {
		const permissions = await getCachedUserPermissions(env, userId)
		return permissions.some((p) => p.urn === permissionUrn)
	})
}

/**
 * SRP (Ship Replacement Program) routes
 *
 * Provides API endpoints for managing SRP requests, reviews, payments, and configuration.
 * All requests are authenticated before being forwarded to the SRP Durable Object.
 */
const srp = new Hono<App>()

// Apply authentication middleware to all routes
srp.use('*', requireAllianceMember())

// =============================================================================
// LOSSES
// =============================================================================

/**
 * Get recent losses for all user's characters with SRP status
 * GET /api/srp/losses?daysBack=30
 */
srp.get('/losses', async (c) => {
	const user = c.get('user')!
	const daysBack = c.req.query('daysBack') ? Number.parseInt(c.req.query('daysBack')!, 10) : 30

	// Get all character IDs for the user
	const characterIds = user.characters.map((char) => char.characterId)

	if (characterIds.length === 0) {
		return c.json([])
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const losses = await srpStub.getRecentLosses(characterIds, user.id, daysBack)

	return c.json(losses)
})

/**
 * Trigger killmail refresh for all of the user's characters
 * POST /api/srp/losses/refresh
 * Returns per-character results so the UI can show partial failures.
 */
srp.post('/losses/refresh', async (c) => {
	const user = c.get('user')!

	const settled = await Promise.allSettled(
		user.characters.map(async (char) => {
			if (!char.hasValidToken) {
				return { characterId: char.characterId, characterName: char.characterName, success: false, reason: 'invalid_token' as const }
			}
			try {
				const stub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, char.characterId)
				const instance = await stub.getInstance(char.characterId)
				using charInstance = instance
				await charInstance.fetchKillmails()
				return { characterId: char.characterId, characterName: char.characterName, success: true }
			} catch (err) {
				return {
					characterId: char.characterId,
					characterName: char.characterName,
					success: false,
					reason: 'fetch_failed' as const,
					error: err instanceof Error ? err.message : String(err),
				}
			}
		})
	)

	const results = settled.map((s) =>
		s.status === 'fulfilled'
			? s.value
			: { characterId: '', characterName: 'Unknown', success: false, reason: 'fetch_failed' as const, error: String(s.reason) }
	)

	return c.json({ results })
})

// =============================================================================
// KILLMAIL PREVIEW
// =============================================================================

/**
 * GET /api/srp/losses/preview?killmailId=...&killmailHash=...&characterId=...
 * Returns valuation + raw victim items for the fitting panel without creating a request.
 */
srp.get('/losses/preview', async (c) => {
	const user = c.get('user')!
	const killmailId = c.req.query('killmailId')
	const killmailHash = c.req.query('killmailHash')
	const characterId = c.req.query('characterId')

	if (!killmailId || !killmailHash || !characterId) {
		return c.json({ error: 'killmailId, killmailHash, and characterId are required' }, 400)
	}

	const ownsCharacter = user.characters.some((ch) => ch.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Not authorized' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const preview = await srpStub.previewValuation(characterId, killmailId, killmailHash)

	if (!preview) return c.json(null)
	return c.json(preview)
})

// =============================================================================
// REQUESTS
// =============================================================================

/**
 * Create a new SRP request
 * POST /api/srp/requests
 */
srp.post('/requests', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	// Validate request body
	const validation = CreateSRPRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	const { characterId, killmailId, killmailHash, contextText } = validation.data

	// Verify user owns this character
	const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Not authorized to create request for this character' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.createRequest(
		user.id,
		characterId,
		killmailId,
		killmailHash,
		contextText
	)

	return c.json(request, 201)
})

/**
 * Get user's SRP requests
 * GET /api/srp/requests?limit=50&offset=0
 */
srp.get('/requests', async (c) => {
	const user = c.get('user')!
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requestsRaw = await srpStub.getUserRequests(user.id, limit, offset)
	const requests = await hydrateRequestCharacterRoles(
		requestsRaw as RequestWithCharacterRole[],
		c.env.DATABASE_URL
	)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Get requests by status (reviewer queue)
 * GET /api/srp/requests/by-status?status=pending&limit=50&offset=0
 */
srp.get('/requests/by-status', async (c) => {
	const user = c.get('user')!
	const statusParsed = RequestStatusQuerySchema.safeParse(c.req.query('status'))
	if (!statusParsed.success) {
		return c.json({ error: 'Invalid status' }, 400)
	}

	const status = statusParsed.data
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0
	const characterName = c.req.query('characterName')?.trim() || undefined
	const shipTypeName = c.req.query('shipTypeName')?.trim() || undefined
	const solarSystemName = c.req.query('solarSystemName')?.trim() || undefined
	const dateFrom = c.req.query('dateFrom')?.trim() || undefined
	const dateTo = c.req.query('dateTo')?.trim() || undefined

	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires reviewer permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const result = await srpStub.getRequestsByStatus(status, {
		limit,
		offset,
		characterName,
		shipTypeName,
		solarSystemName,
		dateFrom,
		dateTo,
	})
	const requests = await hydrateRequestCharacterRoles(
		result.requests as RequestWithCharacterRole[],
		c.env.DATABASE_URL
	)
	return c.json({
		requests,
		total: result.total,
		limit,
		offset,
	})
})

/**
 * Get search values for review queue filters
 * GET /api/srp/requests/search-values?status=pending&field=character&query=ab
 */
srp.get('/requests/search-values', async (c) => {
	const user = c.get('user')!
	const statusParsed = RequestStatusQuerySchema.safeParse(c.req.query('status'))
	if (!statusParsed.success) {
		return c.json({ error: 'Invalid status' }, 400)
	}
	const fieldParsed = RequestSearchFieldQuerySchema.safeParse(c.req.query('field'))
	if (!fieldParsed.success) {
		return c.json({ error: 'Invalid field' }, 400)
	}

	const query = c.req.query('query')?.trim() ?? ''
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires reviewer permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const values = await srpStub.getSearchValues(statusParsed.data, fieldParsed.data, query)
	return c.json(values)
})

/**
 * Get a single SRP request
 * GET /api/srp/requests/:id
 */
srp.get('/requests/:id', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	// Verify user owns this request or is admin
	if (request.userId !== user.id && !user.is_admin) {
		return c.json({ error: 'Not authorized to view this request' }, 403)
	}

	if (request.comments && request.comments.length > 0) {
		request.comments = await hydrateCommentAuthors(
			request.comments,
			c.env.DATABASE_URL,
			c.env,
			request.userId
		)
	}

	const [requestWithCharacterRole] = await hydrateRequestCharacterRoles(
		[request as RequestWithCharacterRole],
		c.env.DATABASE_URL
	)

	return c.json(requestWithCharacterRole)
})

// =============================================================================
// REVIEW WORKFLOWS
// =============================================================================

/**
 * Get pending SRP requests for review
 * GET /api/srp/pending?corporationId=xxx&limit=50&offset=0
 *
 * Requires admin or reviewer permissions
 */
srp.get('/pending', async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	// Check reviewer permissions
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)

	if (!allowed) {
		return c.json({ error: 'Requires reviewer permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requests = await srpStub.getPendingRequests(corporationId || '', limit, offset)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Approve an SRP request
 * POST /api/srp/requests/:id/approve
 */
srp.post('/requests/:id/approve', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = ApproveRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	// Check reviewer permissions
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)

	if (!allowed) {
		return c.json({ error: 'Requires reviewer permissions' }, 403)
	}

	const { approvedAmount, reviewNotes } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.approveRequest(requestId, user.id, approvedAmount, reviewNotes)

	return c.json(request)
})

/**
 * Partially approve an SRP request
 * POST /api/srp/requests/:id/partially-approve
 */
srp.post('/requests/:id/partially-approve', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = PartiallyApproveRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	// Check reviewer permissions
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)

	if (!allowed) {
		return c.json({ error: 'Requires reviewer permissions' }, 403)
	}

	const { approvedAmount, rejectionReason, reviewNotes } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.partiallyApproveRequest(
		requestId,
		user.id,
		approvedAmount,
		rejectionReason,
		reviewNotes
	)

	return c.json(request)
})

/**
 * Reject an SRP request
 * POST /api/srp/requests/:id/reject
 */
srp.post('/requests/:id/reject', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = RejectRequestSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid request data', details: validation.error }, 400)
	}

	// Check reviewer permissions
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)

	if (!allowed) {
		return c.json({ error: 'Requires reviewer permissions' }, 403)
	}

	const { rejectionReason, reviewNotes } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.rejectRequest(requestId, user.id, rejectionReason, reviewNotes)

	return c.json(request)
})

/**
 * Submit a full review for a request
 * POST /api/srp/requests/:id/review
 */
srp.post('/requests/:id/review', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	const validation = SRPReviewSubmissionSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid review data', details: validation.error }, 400)
	}

	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires reviewer permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	try {
		const request = await srpStub.submitReview(
			requestId,
			user.id,
			getPrimaryCharacterName(user),
			validation.data
		)
		return c.json(request)
	} catch (err: any) {
		if (err?.status === 422) return c.json({ error: err.message }, 422)
		throw err
	}
})

/**
 * Change the state of a request
 * PATCH /api/srp/requests/:id/state
 */
srp.patch('/requests/:id/state', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	const validation = UpdateReviewStateSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid state data', details: validation.error }, 400)
	}

	const { newState, notes } = validation.data

	// paid transition requires payer or manager; others require reviewer
	const requiredPerm = newState === 'paid' ? 'urn:srp:payer' : 'urn:srp:reviewer'
	const allowed = await hasPermission(c.env, user.id, requiredPerm, user.is_admin)
	if (!allowed) return c.json({ error: `Requires ${requiredPerm} permissions` }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.updateReviewState(
		requestId,
		user.id,
		getPrimaryCharacterName(user),
		newState,
		notes
	)
	return c.json(request)
})

// =============================================================================
// COMMENTS
// =============================================================================

/**
 * Get comments for an SRP request
 * GET /api/srp/requests/:id/comments?includeInternal=false
 */
srp.get('/requests/:id/comments', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const includeInternal = c.req.query('includeInternal') === 'true'

	// Verify access to request
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	if (request.userId !== user.id && !user.is_admin) {
		return c.json({ error: 'Not authorized to view this request' }, 403)
	}

	// Only admins/reviewers can see internal comments
	const canSeeInternal = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)
	const rawComments = await srpStub.getComments(requestId, user.id, canSeeInternal && includeInternal)
	const comments = await hydrateCommentAuthors(rawComments, c.env.DATABASE_URL, c.env, request.userId)

	return c.json(comments)
})

/**
 * Add a comment to an SRP request
 * POST /api/srp/requests/:id/comments
 */
srp.post('/requests/:id/comments', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = CreateCommentSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid comment data', details: validation.error }, 400)
	}

	// Verify access to request
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	if (request.userId !== user.id && !user.is_admin) {
		return c.json({ error: 'Not authorized to comment on this request' }, 403)
	}

	const { content, visibility } = validation.data

	// Only admins/reviewers can create internal comments
	if (visibility === 'internal') {
		const canCreateInternal = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)

		if (!canCreateInternal) {
			return c.json({ error: 'Not authorized to create internal comments' }, 403)
		}
	}

	const characterName = getPrimaryCharacterName(user)
	const comment = await srpStub.addComment(requestId, user.id, characterName, content, visibility)

	return c.json(comment, 201)
})

/**
 * Edit a comment
 * PATCH /api/srp/comments/:id
 */
srp.patch('/comments/:id', async (c) => {
	const user = c.get('user')!
	const commentId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = EditCommentSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid comment data', details: validation.error }, 400)
	}

	const { content } = validation.data

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const comment = await srpStub.editComment(commentId, user.id, content)

	return c.json(comment)
})

/**
 * Delete a comment
 * DELETE /api/srp/comments/:id
 */
srp.delete('/comments/:id', async (c) => {
	const user = c.get('user')!
	const commentId = c.req.param('id')

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	await srpStub.deleteComment(commentId, user.id)

	return c.json({ success: true })
})

// =============================================================================
// PAYMENTS
// =============================================================================

/**
 * Get pending payments
 * GET /api/srp/payments/pending?corporationId=xxx&limit=50&offset=0
 *
 * Requires payer permissions (admins do NOT bypass)
 */
srp.get('/payments/pending', async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')
	const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : 50
	const offset = c.req.query('offset') ? Number.parseInt(c.req.query('offset')!, 10) : 0

	// Check payer permissions (admins do NOT bypass)
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:payer', false)

	if (!allowed) {
		return c.json({ error: 'Requires payer permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requests = await srpStub.getPendingPayments(corporationId, limit, offset)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Get pending payout total for all unpaid approved requests
 * GET /api/srp/payments/pending-total?corporationId=xxx
 *
 * Requires payer permissions (admins do NOT bypass)
 */
srp.get('/payments/pending-total', async (c) => {
	const user = c.get('user')!
	const corporationId = c.req.query('corporationId')

	// Check payer permissions (admins do NOT bypass)
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:payer', false)
	if (!allowed) return c.json({ error: 'Requires payer permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const pendingPayoutTotal = await srpStub.getPendingPayoutTotal(corporationId)

	return c.json({ pendingPayoutTotal })
})

/**
 * Mark a request as paid
 * POST /api/srp/requests/:id/mark-paid
 */
srp.post('/requests/:id/mark-paid', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Check payer permissions (admins do NOT bypass)
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:payer', false)
	if (!allowed) return c.json({ error: 'Requires payer permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.markPaid(
		requestId,
		user.id,
		getPrimaryCharacterName(user)
	)

	return c.json(request)
})

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Get SRP configuration
 * GET /api/srp/config
 */
srp.get('/config', async (c) => {
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const config = await srpStub.getConfig()

	if (!config) {
		return c.json({ error: 'No configuration found' }, 404)
	}

	return c.json(config)
})

/**
 * Update SRP configuration
 * PATCH /api/srp/config
 */
srp.patch('/config', async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()

	// Validate request body
	const validation = UpdateSRPConfigSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid configuration data', details: validation.error }, 400)
	}

	// Only admins can update config
	if (!user.is_admin) {
		return c.json({ error: 'Requires admin permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const config = await srpStub.updateConfig(user.id, validation.data)

	return c.json(config)
})

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get SRP statistics
 * GET /api/srp/stats?startDate=2024-01-01&endDate=2024-12-31&corporationId=xxx
 */
srp.get('/stats', async (c) => {
	const user = c.get('user')!
	const startDate = c.req.query('startDate')
	const endDate = c.req.query('endDate')
	const corporationId = c.req.query('corporationId')

	// TODO: Check permissions via Groups DO
	if (!user.is_admin) {
		return c.json({ error: 'Requires admin permissions' }, 403)
	}

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const stats = await srpStub.getStats(startDate, endDate, corporationId)

	return c.json(stats)
})

// =============================================================================
// POLICIES
// =============================================================================

/**
 * List active policies (all reviewer+ roles)
 * GET /api/srp/policies
 */
srp.get('/policies', async (c) => {
	const user = c.get('user')!
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires reviewer permissions' }, 403)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	return c.json(await srpStub.listPolicies())
})

/**
 * Create a policy (manager only)
 * POST /api/srp/policies
 */
srp.post('/policies', async (c) => {
	const user = c.get('user')!
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:manager', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires manager permissions' }, 403)

	const body = await c.req.json()
	const validation = CreateSRPPolicySchema.safeParse(body)
	if (!validation.success)
		return c.json({ error: 'Invalid policy data', details: validation.error }, 400)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	return c.json(await srpStub.createPolicy(user.id, validation.data), 201)
})

/**
 * Update a policy (manager only)
 * PATCH /api/srp/policies/:id
 */
srp.patch('/policies/:id', async (c) => {
	const user = c.get('user')!
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:manager', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires manager permissions' }, 403)

	const id = c.req.param('id')
	const body = await c.req.json()
	const validation = CreateSRPPolicySchema.partial().safeParse(body)
	if (!validation.success)
		return c.json({ error: 'Invalid policy data', details: validation.error }, 400)

	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	return c.json(await srpStub.updatePolicy(id, user.id, validation.data))
})

/**
 * Delete (soft-delete) a policy (manager only)
 * DELETE /api/srp/policies/:id
 */
srp.delete('/policies/:id', async (c) => {
	const user = c.get('user')!
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:manager', user.is_admin)
	if (!allowed) return c.json({ error: 'Requires manager permissions' }, 403)

	const id = c.req.param('id')
	const srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	await srpStub.deletePolicy(id, user.id)
	return c.json({ ok: true })
})

export default srp
