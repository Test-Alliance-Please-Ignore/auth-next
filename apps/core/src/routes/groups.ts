import { Hono } from 'hono'

import { getStub } from '@repo/do-utils'

import { requireAdmin, requireAuth } from '../middleware/session'

import type { Groups } from '@repo/groups'
import type { App } from '../context'

/**
 * Groups management routes
 *
 * These routes call the Groups Durable Object via RPC.
 * Session middleware loads user into context.
 */
const groups = new Hono<App>()

// ===== Categories =====

/**
 * GET /categories
 *
 * List all categories (respects visibility for non-admins)
 */
groups.get('/categories', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	const categories = await groupsDO.listCategories(user.id, user.is_admin)

	// Cache categories for 5 minutes at edge (with 10 minute stale-while-revalidate)
	c.header('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')

	return c.json(categories)
})

/**
 * GET /categories/:id
 *
 * Get single category with its groups
 */
groups.get('/categories/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const categoryId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const category = await groupsDO.getCategory(categoryId, user.id, user.is_admin)
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
groups.post('/categories', requireAuth(), requireAdmin(), async (c) => {
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
})

/**
 * PATCH /categories/:id
 *
 * Update a category (admin only)
 */
groups.patch('/categories/:id', requireAuth(), requireAdmin(), async (c) => {
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
})

/**
 * DELETE /categories/:id
 *
 * Delete a category (admin only)
 */
groups.delete('/categories/:id', requireAuth(), requireAdmin(), async (c) => {
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
})

// ===== Groups =====

/**
 * GET /
 *
 * List groups with optional filters
 * Query params: categoryId, visibility, joinMode, search, myGroups
 */
groups.get('/', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	// Parse query parameters
	const filters = {
		categoryId: c.req.query('categoryId'),
		visibility: c.req.query('visibility') as 'public' | 'hidden' | 'system' | undefined,
		joinMode: c.req.query('joinMode') as 'open' | 'approval' | 'invitation_only' | undefined,
		search: c.req.query('search'),
		myGroups: c.req.query('myGroups') === 'true',
	}

	const groupsList = await groupsDO.listGroups(filters, user.id, user.is_admin)

	// Cache unfiltered/non-search groups list for 60 seconds at edge
	if (!filters.search && !filters.myGroups) {
		c.header('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
	} else {
		// User-specific or search results - no cache
		c.header('Cache-Control', 'private, no-cache')
	}

	return c.json(groupsList)
})

/**
 * POST /
 *
 * Create a new group
 */
groups.post('/', requireAuth(), async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const group = await groupsDO.createGroup(body, user.id, user.is_admin)
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
groups.get('/my-groups', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	const memberships = await groupsDO.getUserMemberships(user.id)
	return c.json(memberships)
})

/**
 * GET /invitations
 *
 * Get current user's pending invitations
 */
groups.get('/invitations', requireAuth(), async (c) => {
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
groups.get('/:groupId/invitations', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('groupId')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const invitations = await groupsDO.getGroupInvitations(groupId, user.id, user.is_admin)
		return c.json(invitations)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 403)
		}
		throw error
	}
})

/**
 * POST /:groupId/invitations
 *
 * Create a direct invitation by character name (admin only)
 */
groups.post('/:groupId/invitations', requireAuth(), async (c) => {
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
})

/**
 * POST /invitations/:id/accept
 *
 * Accept a group invitation
 */
groups.post('/invitations/:id/accept', requireAuth(), async (c) => {
	const user = c.get('user')!
	const invitationId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.acceptInvitation(invitationId, user.id)
		return c.json({ success: true }, 200)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /invitations/:id/decline
 *
 * Decline a group invitation
 */
groups.post('/invitations/:id/decline', requireAuth(), async (c) => {
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
})

/**
 * POST /:groupId/invite-codes
 *
 * Create an invite code for a group (owner only)
 */
groups.post('/:groupId/invite-codes', requireAuth(), async (c) => {
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
})

/**
 * GET /:groupId/invite-codes
 *
 * List invite codes for a group (owner/admin only)
 */
groups.get('/:groupId/invite-codes', requireAuth(), async (c) => {
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
})

/**
 * DELETE /invite-codes/:codeId
 *
 * Revoke an invite code (owner only)
 */
groups.delete('/invite-codes/:codeId', requireAuth(), async (c) => {
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
})

/**
 * POST /invite-codes/redeem
 *
 * Redeem an invite code to join a group
 */
groups.post('/invite-codes/redeem', requireAuth(), async (c) => {
	const user = c.get('user')!
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	if (!body.code) {
		return c.json({ error: 'Invite code is required' }, 400)
	}

	try {
		const result = await groupsDO.redeemInviteCode(body.code, user.id)
		return c.json(result, 200)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /join-requests/:requestId/approve
 *
 * Approve a join request (owner/admin only)
 */
groups.post('/join-requests/:requestId/approve', requireAuth(), async (c) => {
	const user = c.get('user')!
	const requestId = c.req.param('requestId')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.approveJoinRequest(requestId, user.id)
		return c.json({ success: true }, 200)
	} catch (error) {
		if (error instanceof Error) {
			return c.json({ error: error.message }, 400)
		}
		throw error
	}
})

/**
 * POST /join-requests/:requestId/reject
 *
 * Reject a join request (owner/admin only)
 */
groups.post('/join-requests/:requestId/reject', requireAuth(), async (c) => {
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
})

// ===== Parameterized Routes =====

/**
 * GET /:id
 *
 * Get single group with details
 */
groups.get('/:id', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const group = await groupsDO.getGroup(groupId, user.id, user.is_admin)
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
groups.patch('/:id', requireAuth(), requireAdmin(), async (c) => {
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
})

/**
 * DELETE /:id
 *
 * Delete a group (admin only)
 */
groups.delete('/:id', requireAuth(), requireAdmin(), async (c) => {
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
})

// ===== Group Members =====

/**
 * GET /:groupId/members
 *
 * List all members of a group
 * Authorization is handled by the Groups DO based on group visibility and user role
 */
groups.get('/:groupId/members', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('groupId')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		const members = await groupsDO.getGroupMembers(groupId, user.id, user.is_admin)
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
 * Remove a member from a group (admin only)
 */
groups.delete('/:groupId/members/:userId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('groupId')
	const memberUserId = c.req.param('userId')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.removeMember(groupId, user.id, memberUserId)
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
})

// ===== Group Admins =====

/**
 * POST /:groupId/admins
 *
 * Add a group admin (admin only)
 */
groups.post('/:groupId/admins', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('groupId')
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	if (!body.userId) {
		return c.json({ error: 'userId is required' }, 400)
	}

	try {
		await groupsDO.addAdmin(groupId, user.id, body.userId)
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
})

/**
 * DELETE /:groupId/admins/:userId
 *
 * Remove a group admin (admin only)
 */
groups.delete('/:groupId/admins/:userId', requireAuth(), requireAdmin(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('groupId')
	const targetUserId = c.req.param('userId')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.removeAdmin(groupId, user.id, targetUserId)
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
})

/**
 * POST /:id/join
 *
 * Join an open group
 */
groups.post('/:id/join', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.joinGroup(groupId, user.id)
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
groups.post('/:id/leave', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	try {
		await groupsDO.leaveGroup(groupId, user.id)
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
groups.post('/:id/transfer', requireAuth(), async (c) => {
	const user = c.get('user')!
	const groupId = c.req.param('id')
	const body = await c.req.json()
	const groupsDO = getStub<Groups>(c.env.GROUPS, 'default')

	if (!body.newOwnerId) {
		return c.json({ error: 'newOwnerId is required' }, 400)
	}

	try {
		await groupsDO.transferOwnership(groupId, user.id, body.newOwnerId, user.is_admin)
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
groups.post('/:id/join-requests', requireAuth(), async (c) => {
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
groups.get('/:id/join-requests', requireAuth(), async (c) => {
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
groups.get('/:groupId/discord-servers', requireAuth(), requireAdmin(), async (c) => {
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
})

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
groups.post('/:groupId/discord-servers', requireAuth(), requireAdmin(), async (c) => {
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
})

/**
 * PUT /:groupId/discord-servers/:attachmentId
 *
 * Update a Discord server attachment's settings (admin only)
 */
groups.put('/:groupId/discord-servers/:attachmentId', requireAuth(), requireAdmin(), async (c) => {
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
})

/**
 * DELETE /:groupId/discord-servers/:attachmentId
 *
 * Detach a Discord server from a group (admin only)
 */
groups.delete('/:groupId/discord-servers/:attachmentId', requireAuth(), requireAdmin(), async (c) => {
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
})

/**
 * POST /:groupId/discord-servers/:attachmentId/roles
 *
 * Assign a Discord role to a group Discord server attachment (admin only)
 */
groups.post(
	'/:groupId/discord-servers/:attachmentId/roles',
	requireAuth(),
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
 * DELETE /:groupId/discord-servers/:attachmentId/roles/:roleAssignmentId
 *
 * Unassign a Discord role from a group Discord server attachment (admin only)
 */
groups.delete(
	'/:groupId/discord-servers/:attachmentId/roles/:roleAssignmentId',
	requireAuth(),
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
