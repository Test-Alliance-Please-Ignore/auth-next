import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'
import { TimeCache } from '@repo/hono-helpers'
import {
	ApproveRequestSchema,
	CreateCommentSchema,
	CreateSRPRequestSchema,
	EditCommentSchema,
	MarkPaidSchema,
	MarkPartiallyPaidSchema,
	PartiallyApproveRequestSchema,
	RejectRequestSchema,
	UpdateSRPConfigSchema,
} from '@repo/srp'

import { requireAuth } from '../middleware/session'

import type { Groups } from '@repo/groups'
import type { Srp } from '@repo/srp'
import type { App } from '../context'

/**
 * Permission check cache - 15 second TTL
 */
const permissionCache = new TimeCache<boolean>(15000)

/**
 * Helper function to get Cloudflare request ID for DO instance isolation
 * Falls back to random UUID if cf-ray header is not present
 */
function getRequestId(c: any): string {
	return c.req.header('cf-ray') || crypto.randomUUID()
}

/**
 * Helper function to check if a user has a specific permission
 * Results are cached for 15 seconds to reduce load on Groups DO
 *
 * IMPORTANT: Creates fresh stubs internally to avoid stub invalidation issues.
 * Each RPC operation gets its own isolated stub.
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
		// Create fresh stub for this permission check
		using groupsStub = getStub<Groups>(env.GROUPS, 'default')
		const permissions = await groupsStub.getUserPermissions(userId)
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
srp.use('*', requireAuth())

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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const losses = await srpStub.getRecentLosses(characterIds, user.id, daysBack)

	return c.json(losses)
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

	const { characterId, killmailId, killmailHash, requestedAmount } = validation.data

	// Verify user owns this character
	const ownsCharacter = user.characters.some((char) => char.characterId === characterId)
	if (!ownsCharacter) {
		return c.json({ error: 'Not authorized to create request for this character' }, 403)
	}

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.createRequest(
		user.id,
		characterId,
		killmailId,
		killmailHash,
		requestedAmount
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requests = await srpStub.getUserRequests(user.id, limit, offset)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Get a single SRP request
 * GET /api/srp/requests/:id
 */
srp.get('/requests/:id', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	// Verify user owns this request or is admin
	if (request.userId !== user.id && !user.is_admin) {
		return c.json({ error: 'Not authorized to view this request' }, 403)
	}

	return c.json(request)
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.rejectRequest(requestId, user.id, rejectionReason, reviewNotes)

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
	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.getRequest(requestId, user.id)

	if (!request) {
		return c.json({ error: 'Request not found' }, 404)
	}

	if (request.userId !== user.id && !user.is_admin) {
		return c.json({ error: 'Not authorized to view this request' }, 403)
	}

	// Only admins/reviewers can see internal comments
	const canSeeInternal = await hasPermission(c.env, user.id, 'urn:srp:reviewer', user.is_admin)
	const comments = await srpStub.getComments(requestId, user.id, canSeeInternal && includeInternal)

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
	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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
		const canCreateInternal = await hasPermission(
			c.env,
			user.id,
			'urn:srp:reviewer',
			user.is_admin
		)

		if (!canCreateInternal) {
			return c.json({ error: 'Not authorized to create internal comments' }, 403)
		}
	}

	const comment = await srpStub.addComment(requestId, user.id, content, visibility)

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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const requests = await srpStub.getPendingPayments(corporationId, limit, offset)

	return c.json({
		requests,
		total: requests.length,
		limit,
		offset,
	})
})

/**
 * Mark a request as paid
 * POST /api/srp/requests/:id/mark-paid
 */
srp.post('/requests/:id/mark-paid', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = MarkPaidSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid payment data', details: validation.error }, 400)
	}

	// Check payer permissions (admins do NOT bypass)
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:payer', false)

	if (!allowed) {
		return c.json({ error: 'Requires payer permissions' }, 403)
	}

	const { paidAmount, paymentToken } = validation.data

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.markPaid(requestId, user.id, paidAmount, paymentToken)

	return c.json(request)
})

/**
 * Mark a request as partially paid
 * POST /api/srp/requests/:id/mark-partially-paid
 */
srp.post('/requests/:id/mark-partially-paid', async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('id')
	const body = await c.req.json()

	// Validate request body
	const validation = MarkPartiallyPaidSchema.safeParse(body)
	if (!validation.success) {
		return c.json({ error: 'Invalid payment data', details: validation.error }, 400)
	}

	// Check payer permissions (admins do NOT bypass)
	const allowed = await hasPermission(c.env, user.id, 'urn:srp:payer', false)

	if (!allowed) {
		return c.json({ error: 'Requires payer permissions' }, 403)
	}

	const { paidAmount, paymentToken, notes } = validation.data

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const request = await srpStub.markPartiallyPaid(
		requestId,
		user.id,
		paidAmount,
		paymentToken,
		notes
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
	const user = c.get('user')!

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
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

	using srpStub = getStub<Srp>(c.env.SRP, getRequestId(c))
	const stats = await srpStub.getStats(startDate, endDate, corporationId)

	return c.json(stats)
})

export default srp
