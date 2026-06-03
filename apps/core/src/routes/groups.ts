import { Hono } from 'hono'
import { z } from 'zod'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { and } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import { waitUntilWithTelemetry } from '../lib/background-task'
import { clearUserCache, getCachedUserMemberships } from '../lib/groups-cache'
import { triggerDiscordRefreshWorkflow } from '../lib/workflow-triggers'
import { requireAdmin, requireAuth } from '../middleware/session'

import type { Discord } from '@repo/discord'
import type { Groups } from '@repo/groups'
import type { App } from '../context'

/**
 * Groups management routes
 *
 * These routes call the Groups Durable Object via RPC.
 * Session middleware loads user into context.
 */
const groups = new Hono<App>()
groups.use('*', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }))

const groupsListQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).optional().default(100),
	offset: z.coerce.number().int().min(0).optional().default(0),
})
// ===== Categories =====

/**
 * GET /categories
 *
 * List all categories (respects visibility for non-admins)
 */
groups.get('/categories', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	const categories = await groupsDO.listCategories(user.id)

	// Cache categories for 5 minutes at edge (with 10 minute stale-while-revalidate)
	c.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')

	return c.json(categories)
})

/**
 * GET /categories/:id
 *
 * Get single category with its groups
 */
groups.get('/categories/:id', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const categoryId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const category = await groupsDO.getCategory(categoryId, user.id)
		return c.json(category)
	} catch (error) {
		if (error instanceof Error && error.message.includes('not found')) {
			return c.json({ error: 'Category not found' }, 404)
		}
		throw error
	}
})

/**
 * POST /categories
 *
 * Create a new category (admin only)
 */
groups.post(
	'/categories',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const category = await groupsDO.createCategory(body, user.id)
			return c.json(category, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * PATCH /categories/:id
 *
 * Update a category (admin only)
 */
groups.patch(
	'/categories/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const categoryId = c.req.param('id')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const category = await groupsDO.updateCategory(categoryId, body, user.id)
			return c.json(category)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Category not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /categories/:id
 *
 * Delete a category (admin only)
 */
groups.delete(
	'/categories/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const categoryId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.deleteCategory(categoryId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Category not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Groups =====

/**
 * GET /
 *
 * List groups with optional filters
 * Query params: categoryId, visibility, joinMode, search, myGroups, limit, offset
 */
groups.get('/', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')
	const queryValidation = groupsListQuerySchema.safeParse({
		limit: c.req.query('limit'),
		offset: c.req.query('offset'),
	})

	if (!queryValidation.success) {
		const firstError = queryValidation.error.issues[0]
		return c.json({ error: firstError?.message || 'Invalid pagination parameters' }, 400)
	}

	// Parse query parameters
	const filters = {
		categoryId: c.req.query('categoryId'),
		visibility: c.req.query('visibility') as 'public' | 'hidden' | 'system' | undefined,
		joinMode: c.req.query('joinMode') as 'open' | 'approval' | 'invitation_only' | undefined,
		search: c.req.query('search'),
		myGroups: c.req.query('myGroups') === 'true',
		limit: queryValidation.data.limit,
		offset: queryValidation.data.offset,
	}

	const groupsList = await groupsDO.listGroups(filters, user.id)

	// Hide sensitive information from non-members in list view
	// Members and admins can see everything
	const filteredGroupsList = user.is_admin
		? groupsList
		: groupsList.map((group) => {
				if (group.isMember) {
					// Member can see everything
					return group
				}
				// Non-member: hide sensitive fields
				return {
					...group,
					memberCount: undefined,
					adminUserIds: undefined,
					ownerName: undefined,
				}
			})

	// Cache unfiltered/non-search groups list for 60 seconds at edge
	if (!filters.search && !filters.myGroups) {
		c.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
	} else {
		// User-specific or search results - no cache
		c.header('Cache-Control', 'private, no-cache')
	}

	return c.json(filteredGroupsList)
})

/**
 * POST /
 *
 * Create a new group (admin only)
 */
groups.post('/', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const group = await groupsDO.createGroup(body, user.id)
		return c.json(group, 201)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

// ===== Specific Routes (must come before /:id) =====

/**
 * GET /my-groups
 *
 * Get current user's group memberships
 */
groups.get('/my-groups', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	const memberships = await getCachedUserMemberships(c.env, user.id)
	return c.json(memberships)
})

/**
 * GET /invitations
 *
 * Get current user's pending invitations
 */
groups.get('/invitations', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	const invitations = await groupsDO.listPendingInvitations(user.id)
	return c.json(invitations)
})

/**
 * GET /:groupId/invitations
 *
 * List pending invitations for a group (owner/admin only)
 */
groups.get(
	'/:groupId/invitations',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const invitations = await groupsDO.getGroupInvitations(groupId, user.id)
			return c.json(invitations)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 403)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/invitations
 *
 * Create a direct invitation by character name (admin only)
 */
groups.post(
	'/:groupId/invitations',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		if (!body.characterName) {
			return c.json({ error: 'characterName is required' }, 400)
		}

		try {
			const invitation = await groupsDO.createInvitation(
				{
					groupId,
					characterName: body.characterName,
				},
				user.id
			)
			return c.json(invitation, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /invitations/:id/accept
 *
 * Accept a group invitation
 */
groups.post(
	'/invitations/:id/accept',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const invitationId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.acceptInvitation(invitationId, user.id)
			clearUserCache(user.id)

			// Sync Discord roles — accepting an invitation grants group membership which may grant new roles via Discord attachments
			waitUntilWithTelemetry(
				c.executionCtx,
				'groups.discord-refresh.accept-invitation',
				() =>
					triggerDiscordRefreshWorkflow({
						env: c.env,
						userId: user.id,
						source: 'group-invitation-accepted',
					}),
				{
					userId: user.id,
					groupId: invitationId,
					source: 'group-invitation-accepted',
				}
			)

			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /invitations/:id/decline
 *
 * Decline a group invitation
 */
groups.post(
	'/invitations/:id/decline',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const invitationId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.declineInvitation(invitationId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /invitations/:id
 *
 * Cancel an invitation (same permissions as creating invitations)
 * Works on both active and expired pending invitations
 */
groups.delete(
	'/invitations/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const invitationId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.cancelInvitation(invitationId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/invite-codes
 *
 * Create an invite code for a group (owner or global admin)
 */
groups.post(
	'/:groupId/invite-codes',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const result = await groupsDO.createInviteCode(
				{
					groupId,
					maxUses: body.maxUses ?? null,
					expiresInDays: body.expiresInDays ?? 7,
				},
				user.id
			)
			return c.json(result, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * GET /:groupId/invite-codes
 *
 * List invite codes for a group (owner/admin/global admin)
 */
groups.get(
	'/:groupId/invite-codes',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const codes = await groupsDO.listInviteCodes(groupId, user.id)
			return c.json(codes)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 403)
			}
			throw error
		}
	}
)

/**
 * DELETE /invite-codes/:codeId
 *
 * Revoke an invite code (owner or global admin)
 */
groups.delete(
	'/invite-codes/:codeId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const codeId = c.req.param('codeId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.revokeInviteCode(codeId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /invite-codes/redeem
 *
 * Redeem an invite code to join a group
 */
groups.post(
	'/invite-codes/redeem',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		if (!body.code) {
			return c.json({ error: 'Invite code is required' }, 400)
		}

		try {
			const result = await groupsDO.redeemInviteCode(body.code, user.id)

			if (result.success) {
				// Sync Discord roles — redeeming an invite code grants group membership
				waitUntilWithTelemetry(
					c.executionCtx,
					'groups.discord-refresh.redeem-invite-code',
					() =>
						triggerDiscordRefreshWorkflow({
							env: c.env,
							userId: user.id,
							source: 'group-invite-code-redeemed',
						}),
					{
						userId: user.id,
						source: 'group-invite-code-redeemed',
					}
				)
			}

			return c.json(result, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /join-requests/:requestId/approve
 *
 * Approve a join request (owner/admin only)
 */
groups.post(
	'/join-requests/:requestId/approve',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const requestId = c.req.param('requestId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const { userId: approvedUserId } = await groupsDO.approveJoinRequest(requestId, user.id)
			clearUserCache(approvedUserId)

			// Sync Discord roles — approval grants group membership which may grant new roles via Discord attachments
			waitUntilWithTelemetry(
				c.executionCtx,
				'groups.discord-refresh.approve-join-request',
				() =>
					triggerDiscordRefreshWorkflow({
						env: c.env,
						userId: approvedUserId,
						source: 'group-join-request-approved',
					}),
				{
					userId: approvedUserId,
					requestId,
					source: 'group-join-request-approved',
				}
			)

			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /join-requests/:requestId/reject
 *
 * Reject a join request (owner/admin only)
 */
groups.post(
	'/join-requests/:requestId/reject',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const requestId = c.req.param('requestId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.rejectJoinRequest(requestId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Permission Categories =====

/**
 * GET /permissions/categories
 *
 * List all permission categories
 */
groups.get(
	'/permissions/categories',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		console.log('[API] GET /permissions/categories - Start')

		try {
			const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')
			console.log('[API] GET /permissions/categories - Got DO stub')

			const categories = await groupsDO.listPermissionCategories()
			console.log('[API] GET /permissions/categories - Got categories, count:', categories?.length)

			return c.json(categories)
		} catch (error) {
			console.error('[API] GET /permissions/categories - Error:', error)
			if (error instanceof Error) {
				console.error('[API] GET /permissions/categories - Error message:', error.message)
				console.error('[API] GET /permissions/categories - Error stack:', error.stack)
				return c.json({ error: error.message }, 500)
			}
			throw error
		}
	}
)

/**
 * POST /permissions/categories
 *
 * Create a new permission category
 */
groups.post(
	'/permissions/categories',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const category = await groupsDO.createPermissionCategory(
				{
					name: body.name,
					description: body.description,
				},
				user.id
			)
			return c.json(category, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * PATCH /permissions/categories/:id
 *
 * Update a permission category
 */
groups.patch(
	'/permissions/categories/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const categoryId = c.req.param('id')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const category = await groupsDO.updatePermissionCategory(
				categoryId,
				{
					name: body.name,
					description: body.description,
				},
				user.id
			)
			return c.json(category)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Category not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /permissions/categories/:id
 *
 * Delete a permission category
 */
groups.delete(
	'/permissions/categories/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const categoryId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.deletePermissionCategory(categoryId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Category not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Global Permissions =====

/**
 * GET /permissions
 *
 * List all global permissions, optionally filtered by category
 */
groups.get(
	'/permissions',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		console.log('[API] GET /permissions - Start')
		const categoryId = c.req.query('categoryId')
		console.log('[API] GET /permissions - categoryId:', categoryId)

		try {
			const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')
			console.log('[API] GET /permissions - Got DO stub')

			const permissions = await groupsDO.listPermissions(categoryId)
			console.log('[API] GET /permissions - Got permissions, count:', permissions?.length)

			return c.json(permissions)
		} catch (error) {
			console.error('[API] GET /permissions - Error:', error)
			if (error instanceof Error) {
				console.error('[API] GET /permissions - Error message:', error.message)
				console.error('[API] GET /permissions - Error stack:', error.stack)
				return c.json({ error: error.message }, 500)
			}
			throw error
		}
	}
)

/**
 * GET /permissions/:id
 *
 * Get a single permission by ID
 */
groups.get(
	'/permissions/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const permissionId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const permission = await groupsDO.getPermission(permissionId)
			return c.json(permission)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Permission not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /permissions
 *
 * Create a new global permission
 */
groups.post(
	'/permissions',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const permission = await groupsDO.createPermission(
				{
					urn: body.urn,
					name: body.name,
					description: body.description,
					categoryId: body.categoryId,
				},
				user.id
			)
			return c.json(permission, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * PATCH /permissions/:id
 *
 * Update a global permission
 */
groups.patch(
	'/permissions/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const permissionId = c.req.param('id')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const permission = await groupsDO.updatePermission(
				permissionId,
				{
					name: body.name,
					description: body.description,
					categoryId: body.categoryId,
				},
				user.id
			)
			return c.json(permission)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Permission not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /permissions/:id
 *
 * Delete a global permission
 */
groups.delete(
	'/permissions/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const permissionId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.deletePermission(permissionId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Permission not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Group Permissions =====

/**
 * GET /:groupId/permissions
 *
 * List all permissions for a group (admin only)
 */
groups.get(
	'/:groupId/permissions',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const permissions = await groupsDO.listGroupPermissions(groupId, user.id)
			return c.json(permissions)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/permissions/attach
 *
 * Attach a global permission to a group
 */
groups.post(
	'/:groupId/permissions/attach',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const groupPermission = await groupsDO.attachPermissionToGroup(
				{
					groupId,
					permissionId: body.permissionId,
					targetType: body.targetType,
				},
				user.id
			)
			return c.json(groupPermission, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/permissions/custom
 *
 * Create a custom group-scoped permission
 */
groups.post(
	'/:groupId/permissions/custom',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const groupPermission = await groupsDO.createGroupScopedPermission(
				{
					groupId,
					urn: body.urn,
					name: body.name,
					description: body.description,
					targetType: body.targetType,
				},
				user.id
			)
			return c.json(groupPermission, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * PATCH /:groupId/permissions/:groupPermissionId
 *
 * Update a group permission (change target type)
 */
groups.patch(
	'/:groupId/permissions/:groupPermissionId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupPermissionId = c.req.param('groupPermissionId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const groupPermission = await groupsDO.updateGroupPermission(
				groupPermissionId,
				{
					targetType: body.targetType,
				},
				user.id
			)
			return c.json(groupPermission)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group permission not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /:groupId/permissions/:groupPermissionId
 *
 * Remove a permission from a group
 */
groups.delete(
	'/:groupId/permissions/:groupPermissionId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupPermissionId = c.req.param('groupPermissionId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.removePermissionFromGroup(groupPermissionId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group permission not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * GET /:groupId/permissions/members
 *
 * Get permissions for all members of a group (admin only)
 */
groups.get(
	'/:groupId/permissions/members',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const groupId = c.req.param('groupId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const memberPermissions = await groupsDO.getGroupMemberPermissions(groupId)
			return c.json(memberPermissions)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * GET /users/:userId/permissions
 *
 * Get all permissions for a specific user across all groups (admin only)
 */
groups.get(
	'/users/:userId/permissions',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const userId = c.req.param('userId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		const permissions = await groupsDO.getUserPermissions(userId)
		return c.json(permissions)
	}
)

/**
 * POST /permissions/members/multi-group
 *
 * Get permissions for members across multiple groups (admin only)
 */
groups.post(
	'/permissions/members/multi-group',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const memberPermissions = await groupsDO.getMultiGroupMemberPermissions(body.groupIds)
			return c.json(memberPermissions)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Parameterized Routes =====

/**
 * GET /:id
 *
 * Get single group with details
 */
groups.get('/:id', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const group = await groupsDO.getGroup(groupId, user.id)

		if (!group) {
			return c.json({ error: 'Group not found' }, 404)
		}

		// Hide sensitive information from non-members
		// Members and admins can see everything
		if (!user.is_admin && !group.isMember) {
			// Remove sensitive fields for non-members
			const publicGroup = {
				...group,
				memberCount: undefined,
				adminUserIds: undefined,
				ownerName: undefined,
				isOwner: group.isOwner || false,
				isAdmin: group.isAdmin || false,
			}
			return c.json(publicGroup)
		}

		return c.json(group)
	} catch (error) {
		if (error instanceof Error && error.message.includes('not found')) {
			return c.json({ error: 'Group not found' }, 404)
		}
		throw error
	}
})

/**
 * PATCH /:id
 *
 * Update a group (admin only for now)
 */
groups.patch(
	'/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('id')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const group = await groupsDO.updateGroup(groupId, body, user.id)
			return c.json(group)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /:id
 *
 * Delete a group (admin only)
 */
groups.delete(
	'/:id',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('id')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.deleteGroup(groupId, user.id)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Group Members =====

/**
 * GET /:groupId/members
 *
 * List all members of a group
 * Authorization is handled by the Groups DO based on group visibility and user role
 */
groups.get('/:groupId/members', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('groupId')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const members = await groupsDO.getGroupMembers(groupId, user.id)
		return c.json(members)
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes('not found')) {
				return c.json({ error: 'Group not found' }, 404)
			}
			if (error.message.includes('Not authorized')) {
				return c.json({ error: 'Not authorized to view group members' }, 403)
			}
		}
		throw error
	}
})

/**
 * DELETE /:groupId/members/:userId
 *
 * Remove a member from a group (group owner or admin only)
 */
groups.delete(
	'/:groupId/members/:userId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const memberUserId = c.req.param('userId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.removeMember(groupId, user.id, memberUserId)

			// Sync Discord roles with removal allowed — removing a member may revoke roles granted by the group's Discord attachment
			waitUntilWithTelemetry(
				c.executionCtx,
				'groups.discord-refresh.remove-member',
				() =>
					triggerDiscordRefreshWorkflow({
						env: c.env,
						userId: memberUserId,
						source: 'group-member-removed',
						allowRemoval: true,
					}),
				{
					userId: memberUserId,
					groupId,
					source: 'group-member-removed',
					allowRemoval: true,
				}
			)

			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group or member not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

// ===== Group Admins =====

/**
 * POST /:groupId/admins
 *
 * Add a group admin (admin only)
 */
groups.post(
	'/:groupId/admins',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		if (!body.userId) {
			return c.json({ error: 'userId is required' }, 400)
		}

		try {
			await groupsDO.addAdmin(groupId, user.id, body.userId, user.is_admin)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group or user not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /:groupId/admins/:userId
 *
 * Remove a group admin (admin only)
 */
groups.delete(
	'/:groupId/admins/:userId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	async (c) => {
		const user = c.get('user')!
		const groupId = c.req.param('groupId')
		const targetUserId = c.req.param('userId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.removeAdmin(groupId, user.id, targetUserId, user.is_admin)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Group or admin not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:id/join
 *
 * Join an open group
 */
groups.post('/:id/join', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.joinGroup(groupId, user.id)
		// Invalidate user cache after joining group
		clearUserCache(user.id)

		// Sync Discord roles — joining a group may grant new roles via Discord attachments
		waitUntilWithTelemetry(
			c.executionCtx,
			'groups.discord-refresh.join-group',
			() =>
				triggerDiscordRefreshWorkflow({ env: c.env, userId: user.id, source: 'group-joined' }),
			{
				userId: user.id,
				groupId,
				source: 'group-joined',
			}
		)

		return c.json({ success: true }, 200)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /:id/leave
 *
 * Leave a group
 */
groups.post('/:id/leave', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.leaveGroup(groupId, user.id)
		// Invalidate user cache after leaving group
		clearUserCache(user.id)

		// Sync Discord roles with removal allowed — leaving a group may revoke roles granted by its Discord attachment
		waitUntilWithTelemetry(
			c.executionCtx,
			'groups.discord-refresh.leave-group',
			() =>
				triggerDiscordRefreshWorkflow({
					env: c.env,
					userId: user.id,
					source: 'group-left',
					allowRemoval: true,
				}),
			{
				userId: user.id,
				groupId,
				source: 'group-left',
				allowRemoval: true,
			}
		)

		return c.json({ success: true }, 200)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /:id/transfer
 *
 * Transfer group ownership (owner or admin)
 */
groups.post('/:id/transfer', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	if (!body.newOwnerId) {
		return c.json({ error: 'newOwnerId is required' }, 400)
	}

	try {
		await groupsDO.transferOwnership(groupId, user.id, body.newOwnerId)
		return c.json({ success: true }, 200)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

// ===== Join Requests =====

/**
 * POST /:id/join-requests
 *
 * Create a join request for an approval-mode group
 */
groups.post('/:id/join-requests', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const request = await groupsDO.createJoinRequest(
			{
				groupId,
				reason: body.reason,
			},
			user.id
		)
		return c.json(request, 201)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * GET /:id/join-requests
 *
 * List pending join requests for a group (owner/admin only)
 */
groups.get('/:id/join-requests', requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const requests = await groupsDO.listJoinRequests(groupId, user.id)
		return c.json(requests)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 403)
		}
		throw error
	}
})

// ===== Discord Server Management =====

/**
 * GET /:groupId/discord-servers
 *
 * List all Discord servers for a group (admin only)
 */
groups.get(
	'/:groupId/discord-servers',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const groupId = c.req.param('groupId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const servers = await groupsDO.getDiscordServers(groupId)
			return c.json(servers)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/discord-servers
 *
 * Attach a Discord server to a group (admin only)
 *
 * Body: {
 *   discordServerId: string (UUID from registry)
 *   autoInvite?: boolean
 *   autoAssignRoles?: boolean
 * }
 */
groups.post(
	'/:groupId/discord-servers',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const groupId = c.req.param('groupId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		if (!body.discordServerId) {
			return c.json({ error: 'discordServerId is required' }, 400)
		}

		try {
			const server = await groupsDO.attachDiscordServer(
				groupId,
				body.discordServerId,
				body.autoInvite ?? false,
				body.autoAssignRoles ?? false
			)
			return c.json(server, 201)
		} catch (error) {
			if (error instanceof Error) {
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * PUT /:groupId/discord-servers/:attachmentId
 *
 * Update a Discord server attachment's settings (admin only)
 */
groups.put(
	'/:groupId/discord-servers/:attachmentId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			const server = await groupsDO.updateDiscordServerAttachment(attachmentId, {
				autoInvite: body.autoInvite,
				autoAssignRoles: body.autoAssignRoles,
			})
			return c.json(server)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Discord server attachment not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /:groupId/discord-servers/:attachmentId
 *
 * Detach a Discord server from a group (admin only)
 */
groups.delete(
	'/:groupId/discord-servers/:attachmentId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.detachDiscordServer(attachmentId)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Discord server attachment not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/discord-servers/:attachmentId/roles
 *
 * Assign a Discord role to a group Discord server attachment (admin only)
 */
groups.post(
	'/:groupId/discord-servers/:attachmentId/roles',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const attachmentId = c.req.param('attachmentId')
		const body = await c.req.json()
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		if (!body.discordRoleId) {
			return c.json({ error: 'discordRoleId is required' }, 400)
		}

		try {
			const result = await groupsDO.assignRoleToDiscordServer(attachmentId, body.discordRoleId)
			return c.json(result, 201)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: error.message }, 404)
				}
				if (error.message.includes('already assigned')) {
					return c.json({ error: error.message }, 409)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * POST /:groupId/discord-servers/:attachmentId/refresh-roles
 *
 * Refresh Discord role assignments for all group members on this server (admin only)
 */
groups.post(
	'/:groupId/discord-servers/:attachmentId/refresh-roles',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const groupId = c.req.param('groupId')
		const attachmentId = c.req.param('attachmentId')

		try {
			// Get Discord server configuration (guild ID + role IDs)
			const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')
			const config = await groupsDO.getDiscordServerAttachmentConfig(attachmentId)

			// Verify attachment belongs to this group
			if (config.groupId !== groupId) {
				return c.json({ error: 'Discord server attachment not found for this group' }, 404)
			}

			// Get all group member user IDs
			const memberUserIds = await groupsDO.getGroupMemberUserIds(groupId)

			if (memberUserIds.length === 0) {
				return c.json({
					success: 0,
					failed: 0,
					skipped: 0,
					totalMembers: 0,
					message: 'No members in this group',
				})
			}

			// Query Core database to get Discord user IDs for these members
			const db = createDb(c.env.DATABASE_URL)
			const { users } = await import('../db/schema.js')
			const { inArray, isNotNull } = await import('@repo/db-utils')

			const usersWithDiscord = await db.query.users.findMany({
				where: and(inArray(users.id, memberUserIds), isNotNull(users.discordUserId)),
				columns: {
					id: true,
					discordUserId: true,
				},
			})

			const skippedCount = memberUserIds.length - usersWithDiscord.length

			if (usersWithDiscord.length === 0) {
				return c.json({
					success: 0,
					failed: 0,
					skipped: skippedCount,
					totalMembers: memberUserIds.length,
					message: 'No members have Discord linked',
				})
			}

			// Only refresh if there are roles configured
			if (config.roleIds.length === 0) {
				return c.json({
					success: 0,
					failed: 0,
					skipped: memberUserIds.length,
					totalMembers: memberUserIds.length,
					message: 'No roles configured for this server',
				})
			}

			// Call Discord DO to invite and refresh roles for each member
			const discordDO = getStub<Discord>(c.env.DISCORD, 'default')

			let successCount = 0
			let failedCount = 0

			// Process members sequentially to avoid rate limiting
			for (const user of usersWithDiscord) {
				try {
					// First, invite user to the server (or verify they're already a member)
					const joinResults = await discordDO.joinUserToServers(user.id, [config.guildId])
					const joinResult = joinResults[0]

					if (!joinResult?.success) {
						console.error(
							`Failed to invite user ${user.id} to guild ${config.guildId}:`,
							joinResult?.errorMessage
						)
						failedCount++
						continue
					}

					// Then update roles — admin-initiated refresh allows removal of roles no longer granted
					const results = await discordDO.updateUserRoles(user.id, [
						{
							guildId: config.guildId,
							roleIds: config.roleIds,
						},
					], true)

					if (results[0]?.success) {
						successCount++
					} else {
						failedCount++
					}
				} catch (error) {
					console.error(`Failed to refresh roles for user ${user.id}:`, error)
					failedCount++
				}
			}

			return c.json({
				success: successCount,
				failed: failedCount,
				skipped: skippedCount,
				totalMembers: memberUserIds.length,
			})
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: error.message }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

/**
 * DELETE /:groupId/discord-servers/:attachmentId/roles/:roleAssignmentId
 *
 * Unassign a Discord role from a group Discord server attachment (admin only)
 */
groups.delete(
	'/:groupId/discord-servers/:attachmentId/roles/:roleAssignmentId',
	requireAuth({ any: [ROLE_CORE_ALLIANCE_MEMBER] }),
	requireAdmin(),
	async (c) => {
		const roleAssignmentId = c.req.param('roleAssignmentId')
		const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

		try {
			await groupsDO.unassignRoleFromDiscordServer(roleAssignmentId)
			return c.json({ success: true }, 200)
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return c.json({ error: 'Role assignment not found' }, 404)
				}
				return c.json({ error: error.message }, 400)
			}
			throw error
		}
	}
)

export default groups
