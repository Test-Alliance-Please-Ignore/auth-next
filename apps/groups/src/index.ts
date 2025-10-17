import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { useWorkersLogger } from 'workers-tagged-logger'

import { getStub } from '@repo/do-utils'
// Wrap with Sentry for error tracking
import {
	getRequestLogData,
	logger,
	withNotFound,
	withOnError,
	withSentry,
} from '@repo/hono-helpers'

import dashboardTemplate from './templates/dashboard.html?raw'
import groupDetailTemplate from './templates/group-detail.html?raw'
import groupManageTemplate from './templates/group-manage.html?raw'

import type { SessionStore } from '@repo/session-store'
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

// Middleware to verify session via SessionStore DO
const withAuth = async (c: any, next: any) => {
	const sessionId = getCookie(c, 'session_id')

	if (!sessionId) {
		return c.json({ error: 'Not authenticated' }, 401)
	}

	try {
		// Get SessionStore DO stub
		const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

		const sessionInfo = await sessionStoreStub.getSession(sessionId)

		// Store user ID in context for use in routes
		c.set('sessionUserId', sessionInfo.socialUserId)

		await next()
	} catch (error) {
		logger.error('Session verification error', { error: String(error) })
		return c.json({ error: 'Failed to verify session' }, 500)
	}
}

// Helper to get GroupStore instance
const getGroupStore = (c: any) => {
	const id = c.env.GROUP_STORE.idFromName('global')
	return c.env.GROUP_STORE.get(id)
}

// Helper to get owner's primary character name
const getOwnerCharacterName = async (c: any, ownerId: string): Promise<string | undefined> => {
	try {
		const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

		// Get all character links for this social user
		const characters = await sessionStoreStub.getCharacterLinksBySocialUser(ownerId)

		// Find the primary character
		const primaryCharacter = characters.find((char) => char.isPrimary)

		return primaryCharacter?.characterName
	} catch (error) {
		logger.error('Failed to fetch owner character name', {
			error: String(error),
			ownerId: ownerId.substring(0, 8) + '...',
		})
		return undefined
	}
}

// Helper to enrich groups with owner names
const enrichGroupsWithOwnerNames = async (c: any, groups: any[]): Promise<any[]> => {
	const ownerIds = [...new Set(groups.map((g) => g.ownerId))]
	const ownerNames = new Map<string, string>()

	await Promise.all(
		ownerIds.map(async (ownerId) => {
			const name = await getOwnerCharacterName(c, ownerId)
			if (name) {
				ownerNames.set(ownerId, name)
			}
		})
	)

	return groups.map((group) => ({
		...group,
		ownerName: ownerNames.get(group.ownerId),
	}))
}

// Helper to enrich members with character names
const enrichMembersWithCharacterNames = async (c: any, members: any[]): Promise<any[]> => {
	const userIds = [...new Set(members.map((m) => m.socialUserId))]
	const characterNames = new Map<string, string>()

	await Promise.all(
		userIds.map(async (userId) => {
			const name = await getOwnerCharacterName(c, userId)
			if (name) {
				characterNames.set(userId, name)
			}
		})
	)

	return members.map((member) => ({
		...member,
		characterName: characterNames.get(member.socialUserId),
	}))
}

// Helper to enrich join requests with character names
const enrichRequestsWithCharacterNames = async (c: any, requests: any[]): Promise<any[]> => {
	const userIds = [...new Set(requests.map((r) => r.socialUserId))]
	const characterNames = new Map<string, string>()

	await Promise.all(
		userIds.map(async (userId) => {
			const name = await getOwnerCharacterName(c, userId)
			if (name) {
				characterNames.set(userId, name)
			}
		})
	)

	return requests.map((request) => ({
		...request,
		characterName: characterNames.get(request.socialUserId),
	}))
}

// ========== HTML Routes ==========

app
	.get('/groups', (c) => {
		return c.html(dashboardTemplate)
	})

	.get('/groups/:slug/manage', (c) => {
		const slug = c.req.param('slug')
		const template = groupManageTemplate.replace('{{GROUP_NAME}}', slug)
		return c.html(template)
	})

	.get('/groups/:slug', (c) => {
		const slug = c.req.param('slug')
		// Replace placeholder with actual group name (will be loaded by JS)
		const template = groupDetailTemplate.replace('{{GROUP_NAME}}', slug)
		return c.html(template)
	})

	.get('/api/auth/check', async (c) => {
		const sessionId = getCookie(c, 'session_id')

		if (!sessionId) {
			return c.json({ authenticated: false })
		}

		try {
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			const sessionInfo = await sessionStoreStub.getSession(sessionId)

			// Get social user to check admin status
			const socialUser = await sessionStoreStub.getSocialUser(sessionInfo.socialUserId)

			return c.json({
				authenticated: true,
				userId: sessionInfo.socialUserId,
				isAdmin: socialUser?.isAdmin ?? false,
			})
		} catch (error) {
			logger.error('Auth check error', { error: String(error) })
			return c.json({ authenticated: false })
		}
	})

// ========== Group CRUD Endpoints ==========

app
	.post('/api/groups', withAuth, async (c) => {
		const userId = c.get('sessionUserId')!

		try {
			const body = (await c.req.json()) as {
				name: string
				description?: string
				groupType?: 'standard' | 'managed' | 'derived'
				visibility?: 'public' | 'private' | 'hidden'
				joinability?: 'open' | 'approval_required' | 'invite_only' | 'closed'
				autoApproveRules?: Record<string, unknown>
				categoryId?: string
			}

			if (!body.name) {
				return c.json({ error: 'Missing required field: name' }, 400)
			}

			// Check if user is admin for managed/derived groups
			const groupType = body.groupType || 'standard'
			if (groupType === 'managed' || groupType === 'derived') {
				try {
					const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

					const sessionInfo = await sessionStoreStub.getSession(getCookie(c, 'session_id')!)

					// Get social user to check admin status
					const socialUser = await sessionStoreStub.getSocialUser(sessionInfo.socialUserId)

					if (!socialUser?.isAdmin) {
						return c.json(
							{ error: 'Only administrators can create managed or derived groups' },
							403
						)
					}
				} catch (error) {
					logger.error('Failed to check admin status', { error: String(error) })
					return c.json({ error: 'Failed to verify permissions' }, 500)
				}
			}

			const groupStore = getGroupStore(c)

			const group = await groupStore.createGroup(
				body.name,
				body.description || null,
				groupType,
				body.visibility || 'public',
				body.joinability || 'open',
				userId,
				body.autoApproveRules,
				body.categoryId || null
			)

			logger
				.withTags({
					type: 'api_group_created',
				})
				.info('Group created via API', {
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				group,
			})
		} catch (error) {
			logger.error('Create group error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/groups', async (c) => {
		try {
			const visibility = c.req.query('visibility')?.split(',') as
				| Array<'public' | 'private' | 'hidden'>
				| undefined
			const groupType = c.req.query('groupType')?.split(',') as
				| Array<'standard' | 'managed' | 'derived'>
				| undefined
			const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
			const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined

			const groupStore = getGroupStore(c)

			const result = await groupStore.listGroups(
				{
					visibility,
					groupType,
				},
				limit,
				offset
			)

			// Enrich with owner names
			const enrichedGroups = await enrichGroupsWithOwnerNames(c, result.groups)

			return c.json({
				success: true,
				total: result.total,
				groups: enrichedGroups,
			})
		} catch (error) {
			logger.error('List groups error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/groups/:slug', async (c) => {
		const slug = c.req.param('slug')

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Enrich with owner name
			const enrichedGroups = await enrichGroupsWithOwnerNames(c, [group])

			return c.json({
				success: true,
				group: enrichedGroups[0],
			})
		} catch (error) {
			logger.error('Get group error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.patch('/api/groups/:slug', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const body = (await c.req.json()) as {
				name?: string
				description?: string
				visibility?: 'public' | 'private' | 'hidden'
				joinability?: 'open' | 'approval_required' | 'invite_only' | 'closed'
				autoApproveRules?: Record<string, unknown>
				categoryId?: string | null
			}

			const updated = await groupStore.updateGroup(group.groupId, body)

			logger
				.withTags({
					type: 'api_group_updated',
				})
				.info('Group updated via API', {
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				group: updated,
			})
		} catch (error) {
			logger.error('Update group error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.delete('/api/groups/:slug', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Only owner can delete
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'owner')
			if (!hasPermission) {
				return c.json({ error: 'Only the owner can delete this group' }, 403)
			}

			await groupStore.deleteGroup(group.groupId)

			logger
				.withTags({
					type: 'api_group_deleted',
				})
				.info('Group deleted via API', {
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Delete group error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// ========== Membership Endpoints ==========

	.post('/api/groups/:slug/join', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			const body = (await c.req.json()) as { message?: string }

			// Check joinability
			if (group.joinability === 'closed') {
				return c.json({ error: 'This group is not accepting new members' }, 403)
			}

			if (group.joinability === 'invite_only') {
				return c.json({ error: 'This group is invite-only' }, 403)
			}

			if (group.joinability === 'open') {
				// Add user directly
				await groupStore.addMember(group.groupId, userId, 'member', 'manual')

				return c.json({
					success: true,
					message: 'Successfully joined group',
				})
			}

			if (group.joinability === 'approval_required') {
				// Create join request
				const request = await groupStore.createJoinRequest(
					group.groupId,
					userId,
					body.message || null
				)

				return c.json({
					success: true,
					message: 'Join request submitted',
					request,
				})
			}

			return c.json({ error: 'Invalid joinability setting' }, 500)
		} catch (error) {
			logger.error('Join group error', { error: String(error) })
			const message = error instanceof Error ? error.message : String(error)
			const status = message.includes('already') ? 409 : 500
			return c.json({ error: message }, status)
		}
	})

	.delete('/api/groups/:slug/leave', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			const canLeave = await groupStore.canUserLeaveGroup(group.groupId, userId)

			if (!canLeave) {
				return c.json({ error: 'You cannot leave this group' }, 403)
			}

			await groupStore.removeMember(group.groupId, userId)

			logger
				.withTags({
					type: 'api_member_left',
				})
				.info('User left group via API', {
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Leave group error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/groups/:slug/members', async (c) => {
		const slug = c.req.param('slug')

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			const limit = c.req.query('limit') ? Number(c.req.query('limit')) : undefined
			const offset = c.req.query('offset') ? Number(c.req.query('offset')) : undefined

			const result = await groupStore.listGroupMembers(group.groupId, limit, offset)

			// Enrich members with character names
			const enrichedMembers = await enrichMembersWithCharacterNames(c, result.members)

			return c.json({
				success: true,
				total: result.total,
				members: enrichedMembers,
			})
		} catch (error) {
			logger.error('List members error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.delete('/api/groups/:slug/members/:memberId', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const memberId = c.req.param('memberId')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			await groupStore.removeMember(group.groupId, memberId)

			logger
				.withTags({
					type: 'api_member_kicked',
				})
				.info('Member kicked from group via API', {
					groupId: group.groupId,
					kickedUserId: memberId.substring(0, 8) + '...',
					byUserId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Kick member error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.patch('/api/groups/:slug/members/:memberId/role', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const memberId = c.req.param('memberId')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const body = (await c.req.json()) as { role: 'owner' | 'admin' | 'moderator' | 'member' }

			if (!body.role) {
				return c.json({ error: 'Missing required field: role' }, 400)
			}

			await groupStore.updateMemberRole(group.groupId, memberId, body.role)

			logger
				.withTags({
					type: 'api_member_role_updated',
				})
				.info('Member role updated via API', {
					groupId: group.groupId,
					memberId: memberId.substring(0, 8) + '...',
					newRole: body.role,
					byUserId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Update member role error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/users/me/groups', withAuth, async (c) => {
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const groups = await groupStore.getUserGroups(userId)

			// Enhance groups with membership info
			const enhancedGroups = await Promise.all(
				groups.map(async (group: any) => {
					const membership = await groupStore.getMembership(group.groupId, userId)
					return {
						...group,
						membership: membership
							? {
									role: membership.role,
									canLeave: membership.canLeave,
									joinedAt: membership.joinedAt,
								}
							: null,
					}
				})
			)

			// Enrich with owner names
			const enrichedWithOwners = await enrichGroupsWithOwnerNames(c, enhancedGroups)

			return c.json({
				success: true,
				groups: enrichedWithOwners,
			})
		} catch (error) {
			logger.error('Get user groups error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// ========== Join Request Endpoints ==========

	.get('/api/groups/:slug/requests', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined

			const requests = await groupStore.listJoinRequests(group.groupId, status)

			// Enrich requests with character names
			const enrichedRequests = await enrichRequestsWithCharacterNames(c, requests)

			return c.json({
				success: true,
				requests: enrichedRequests,
			})
		} catch (error) {
			logger.error('List join requests error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/groups/:slug/requests/:requestId/approve', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const requestId = c.req.param('requestId')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			await groupStore.approveJoinRequest(requestId, userId)

			logger
				.withTags({
					type: 'api_request_approved',
				})
				.info('Join request approved via API', {
					requestId,
					groupId: group.groupId,
					reviewerId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Approve join request error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/groups/:slug/requests/:requestId/reject', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const requestId = c.req.param('requestId')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			await groupStore.rejectJoinRequest(requestId, userId)

			logger
				.withTags({
					type: 'api_request_rejected',
				})
				.info('Join request rejected via API', {
					requestId,
					groupId: group.groupId,
					reviewerId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Reject join request error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// ========== Invitation Endpoints ==========

	.post('/api/groups/:slug/invites', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const body = (await c.req.json()) as { invitedUserId: string; expiresInDays?: number }

			if (!body.invitedUserId) {
				return c.json({ error: 'Missing required field: invitedUserId' }, 400)
			}

			const invite = await groupStore.createInvite(
				group.groupId,
				body.invitedUserId,
				userId,
				body.expiresInDays
			)

			logger
				.withTags({
					type: 'api_invite_created',
				})
				.info('Invite created via API', {
					inviteId: invite.inviteId,
					groupId: group.groupId,
					invitedUserId: body.invitedUserId.substring(0, 8) + '...',
					invitedBy: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				invite,
			})
		} catch (error) {
			logger.error('Create invite error', { error: String(error) })
			const message = error instanceof Error ? error.message : String(error)
			const status = message.includes('already') ? 409 : 500
			return c.json({ error: message }, status)
		}
	})

	.get('/api/users/me/invites', withAuth, async (c) => {
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const invites = await groupStore.listUserInvites(userId)

			// Enrich invites with group names
			const enrichedInvites = await Promise.all(
				invites.map(async (invite: { groupId: string }) => {
					const group = await groupStore.getGroupById(invite.groupId)
					return {
						...invite,
						groupName: group?.name || 'Unknown Group',
					}
				})
			)

			return c.json({
				success: true,
				invites: enrichedInvites,
			})
		} catch (error) {
			logger.error('List user invites error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/invites/:inviteId/accept', withAuth, async (c) => {
		const inviteId = c.req.param('inviteId')

		try {
			const groupStore = getGroupStore(c)
			await groupStore.acceptInvite(inviteId)

			logger
				.withTags({
					type: 'api_invite_accepted',
				})
				.info('Invite accepted via API', {
					inviteId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Accept invite error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/invites/:inviteId/decline', withAuth, async (c) => {
		const inviteId = c.req.param('inviteId')

		try {
			const groupStore = getGroupStore(c)
			await groupStore.declineInvite(inviteId)

			logger
				.withTags({
					type: 'api_invite_declined',
				})
				.info('Invite declined via API', {
					inviteId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Decline invite error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/groups/:slug/invites', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const invites = await groupStore.listGroupInvites(group.groupId)

			// Enrich invites with character names
			const userIds = [
				...new Set(
					invites
						.map((inv: any) => [inv.invitedUserId, inv.invitedBy])
						.flat()
						.filter(Boolean) as string[]
				),
			]
			const characterNames = new Map<string, string>()

			await Promise.all(
				userIds.map(async (uid) => {
					const name = await getOwnerCharacterName(c, uid)
					if (name) {
						characterNames.set(uid, name)
					}
				})
			)

			const enrichedInvites = invites.map((invite: any) => ({
				...invite,
				invitedUserName: invite.invitedUserId ? characterNames.get(invite.invitedUserId) : null,
				invitedByName: characterNames.get(invite.invitedBy),
			}))

			return c.json({
				success: true,
				invites: enrichedInvites,
			})
		} catch (error) {
			logger.error('List group invites error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.delete('/api/invites/:inviteId', withAuth, async (c) => {
		const inviteId = c.req.param('inviteId')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)

			// Get the invite to check permissions
			const invites = await groupStore.listGroupInvites('')
			const invite = invites.find((inv: any) => inv.inviteId === inviteId)

			if (!invite) {
				return c.json({ error: 'Invite not found' }, 404)
			}

			// Check if user is admin or owner of the group
			const hasPermission = await groupStore.hasGroupPermission(invite.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			await groupStore.revokeInvite(inviteId)

			logger
				.withTags({
					type: 'api_invite_revoked',
				})
				.info('Invite revoked via API', {
					inviteId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Revoke invite error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/groups/:slug/invites/bulk', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const body = (await c.req.json()) as { userIds: string[]; expiresInDays?: number }

			if (!body.userIds || !Array.isArray(body.userIds) || body.userIds.length === 0) {
				return c.json({ error: 'Missing required field: userIds (must be non-empty array)' }, 400)
			}

			const invites = await groupStore.bulkCreateInvites(
				group.groupId,
				body.userIds,
				userId,
				body.expiresInDays
			)

			logger
				.withTags({
					type: 'api_bulk_invites_created',
				})
				.info('Bulk invites created via API', {
					groupId: group.groupId,
					count: invites.length,
					invitedBy: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				invites,
				created: invites.length,
				requested: body.userIds.length,
			})
		} catch (error) {
			logger.error('Bulk create invites error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/groups/:slug/invite-codes', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Check if user is admin or owner
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'admin')
			if (!hasPermission) {
				return c.json({ error: 'Permission denied' }, 403)
			}

			const body = (await c.req.json()) as { maxUses?: number; expiresInDays?: number }

			const inviteCode = await groupStore.createInviteCode(
				group.groupId,
				userId,
				body.maxUses || null,
				body.expiresInDays
			)

			logger
				.withTags({
					type: 'api_invite_code_created',
				})
				.info('Invite code created via API', {
					inviteId: inviteCode.inviteId,
					groupId: group.groupId,
					code: inviteCode.inviteCode?.substring(0, 4) + '...',
					invitedBy: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				invite: inviteCode,
			})
		} catch (error) {
			logger.error('Create invite code error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/invite-codes/:code/redeem', withAuth, async (c) => {
		const code = c.req.param('code')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			await groupStore.redeemInviteCode(code, userId)

			logger
				.withTags({
					type: 'api_invite_code_redeemed',
				})
				.info('Invite code redeemed via API', {
					code: code.substring(0, 4) + '...',
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				message: 'Successfully joined group',
			})
		} catch (error) {
			logger.error('Redeem invite code error', { error: String(error) })
			const message = error instanceof Error ? error.message : String(error)
			const status = message.includes('already')
				? 409
				: message.includes('Invalid') || message.includes('expired') || message.includes('limit')
					? 400
					: 500
			return c.json({ error: message }, status)
		}
	})

	.get('/api/groups/characters/search', withAuth, async (c) => {
		const query = c.req.query('q')

		if (!query || query.trim().length < 2) {
			return c.json({ error: 'Search query must be at least 2 characters' }, 400)
		}

		try {
			const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

			// Search character links by name (case-insensitive)
			const characters = await sessionStoreStub.searchCharactersByName(query.trim())

			return c.json({
				success: true,
				users: characters.map((char: any) => ({
					socialUserId: char.socialUserId,
					characterId: char.characterId,
					characterName: char.characterName,
				})),
			})
		} catch (error) {
			logger.error('User search error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// ========== Custom Roles Endpoints ==========

	.post('/api/groups/:slug/roles', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Only owner can create custom roles
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'owner')
			if (!hasPermission) {
				return c.json({ error: 'Only the owner can create custom roles' }, 403)
			}

			const body = (await c.req.json()) as {
				roleName: string
				permissions: string[]
				priority: number
			}

			if (!body.roleName || !body.permissions || body.priority === undefined) {
				return c.json({ error: 'Missing required fields' }, 400)
			}

			const role = await groupStore.createGroupRole(
				group.groupId,
				body.roleName,
				body.permissions,
				body.priority
			)

			logger
				.withTags({
					type: 'api_role_created',
				})
				.info('Custom role created via API', {
					roleId: role.roleId,
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				role,
			})
		} catch (error) {
			logger.error('Create custom role error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/groups/:slug/roles', async (c) => {
		const slug = c.req.param('slug')

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			const roles = await groupStore.listGroupRoles(group.groupId)

			return c.json({
				success: true,
				roles,
			})
		} catch (error) {
			logger.error('List group roles error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	// ========== Derived Groups Endpoints ==========

	.post('/api/groups/:slug/rules', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Only owner can create rules
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'owner')
			if (!hasPermission) {
				return c.json({ error: 'Only the owner can create derivation rules' }, 403)
			}

			const body = (await c.req.json()) as {
				ruleType: 'parent_child' | 'role_based' | 'union' | 'conditional'
				sourceGroupIds?: string[]
				conditionRules?: Record<string, unknown>
				priority: number
			}

			if (!body.ruleType || body.priority === undefined) {
				return c.json({ error: 'Missing required fields' }, 400)
			}

			const rule = await groupStore.createDerivedGroupRule(
				group.groupId,
				body.ruleType,
				body.sourceGroupIds || null,
				body.conditionRules || null,
				body.priority
			)

			logger
				.withTags({
					type: 'api_derived_rule_created',
				})
				.info('Derived group rule created via API', {
					ruleId: rule.ruleId,
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				rule,
			})
		} catch (error) {
			logger.error('Create derived rule error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/groups/:slug/rules', async (c) => {
		const slug = c.req.param('slug')

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			const rules = await groupStore.listDerivedGroupRules(group.groupId)

			return c.json({
				success: true,
				rules,
			})
		} catch (error) {
			logger.error('List derived rules error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.post('/api/groups/:slug/sync', withAuth, async (c) => {
		const slug = c.req.param('slug')
		const userId = c.get('sessionUserId')!

		try {
			const groupStore = getGroupStore(c)
			const group = await groupStore.getGroupBySlug(slug)

			if (!group) {
				return c.json({ error: 'Group not found' }, 404)
			}

			// Only owner can manually sync
			const hasPermission = await groupStore.hasGroupPermission(group.groupId, userId, 'owner')
			if (!hasPermission) {
				return c.json({ error: 'Only the owner can manually sync derived groups' }, 403)
			}

			if (group.groupType !== 'derived') {
				return c.json({ error: 'Can only sync derived groups' }, 400)
			}

			await groupStore.syncDerivedGroupMemberships(group.groupId)

			logger
				.withTags({
					type: 'api_derived_group_synced',
				})
				.info('Derived group synced via API', {
					groupId: group.groupId,
					userId: userId.substring(0, 8) + '...',
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Sync derived group error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

// ========== Category Management Endpoints ==========

// Helper middleware to check if user is admin
const withAdminAuth = async (c: any, next: any) => {
	const sessionId = getCookie(c, 'session_id')

	if (!sessionId) {
		return c.json({ error: 'Not authenticated' }, 401)
	}

	try {
		const sessionStoreStub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')

		const sessionInfo = await sessionStoreStub.getSession(sessionId)

		// Get social user to check admin status
		const socialUser = await sessionStoreStub.getSocialUser(sessionInfo.socialUserId)

		if (!socialUser?.isAdmin) {
			return c.json({ error: 'Admin access required' }, 403)
		}

		// Store user ID in context
		c.set('sessionUserId', sessionInfo.socialUserId)

		await next()
	} catch (error) {
		logger.error('Admin auth check failed', { error: String(error) })
		return c.json({ error: 'Failed to verify permissions' }, 500)
	}
}

app
	.post('/api/categories', withAdminAuth, async (c) => {
		try {
			const body = (await c.req.json()) as {
				name: string
				description?: string
				displayOrder: number
			}

			if (!body.name || body.displayOrder === undefined) {
				return c.json({ error: 'Missing required fields' }, 400)
			}

			const groupStore = getGroupStore(c)
			const category = await groupStore.createCategory(
				body.name,
				body.description || null,
				body.displayOrder
			)

			logger
				.withTags({
					type: 'api_category_created',
				})
				.info('Category created via API', {
					categoryId: category.categoryId,
					name: category.name,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				category,
			})
		} catch (error) {
			logger.error('Create category error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.get('/api/categories', async (c) => {
		try {
			const groupStore = getGroupStore(c)
			const categories = await groupStore.listCategories()

			return c.json({
				success: true,
				categories,
			})
		} catch (error) {
			logger.error('List categories error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.patch('/api/categories/:categoryId', withAdminAuth, async (c) => {
		const categoryId = c.req.param('categoryId')

		try {
			const body = (await c.req.json()) as {
				name?: string
				description?: string | null
				displayOrder?: number
			}

			const groupStore = getGroupStore(c)
			const category = await groupStore.updateCategory(categoryId, body)

			logger
				.withTags({
					type: 'api_category_updated',
				})
				.info('Category updated via API', {
					categoryId,
					updates: Object.keys(body),
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
				category,
			})
		} catch (error) {
			logger.error('Update category error', { error: String(error) })
			return c.json({ error: String(error) }, 500)
		}
	})

	.delete('/api/categories/:categoryId', withAdminAuth, async (c) => {
		const categoryId = c.req.param('categoryId')

		try {
			const groupStore = getGroupStore(c)
			await groupStore.deleteCategory(categoryId)

			logger
				.withTags({
					type: 'api_category_deleted',
				})
				.info('Category deleted via API', {
					categoryId,
					request: getRequestLogData(c, Date.now()),
				})

			return c.json({
				success: true,
			})
		} catch (error) {
			logger.error('Delete category error', { error: String(error) })
			const message = error instanceof Error ? error.message : String(error)
			const status = message.includes('being used') ? 400 : 500
			return c.json({ error: message }, status)
		}
	})

export default withSentry(app)

// Export Durable Object
export { GroupStore } from './group-store'
