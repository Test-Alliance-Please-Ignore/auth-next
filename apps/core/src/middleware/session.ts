import { getCookie } from 'hono/cookie'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { getCachedUserRoles } from '../lib/groups-cache'
import { AuthService } from '../services/auth.service'
import * as discordService from '../services/discord.service'
import { SessionService } from '../services/session.service'
import { UserService } from '../services/user.service'

import type { MiddlewareHandler } from 'hono'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Hr } from '@repo/hr'
import type { App, SessionUser } from '../context'

/**
 * Session middleware
 *
 * Extracts session token from Authorization header or cookie,
 * validates the session, and loads user data into context.
 */
export const sessionMiddleware = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		// Get session token from Authorization header or cookie
		const authHeader = c.req.header('Authorization')
		const cookieToken = getCookie(c, 'session')

		let sessionToken: string | undefined

		if (authHeader && authHeader.startsWith('Bearer ')) {
			sessionToken = authHeader.substring(7)
		} else if (cookieToken) {
			sessionToken = cookieToken
		}

		// If no token, continue without user
		if (!sessionToken) {
			return next()
		}

		// Create EVE Token Store stub (moved before try block for proper lifecycle)
		const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

		try {
			// Create database client
			const db = createDb(c.env.DATABASE_URL)

			// Create services
			const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
			const userService = new UserService(db)

			// Validate session
			const session = await authService.validateSession(sessionToken)

			if (!session) {
				// Invalid or expired session
				await next()
				return
			}

			// Get user ID from session
			const userId = await authService.getUserIdFromSession(sessionToken)

			if (!userId) {
				// Session exists but user not found
				await next()
				return
			}

			// Load user profile
			const userProfile = await userService.getUserProfile(userId)

			// SECURITY: Check if user is blacklisted
			const hrStub = getStub<Hr>(c.env.HR, 'default')
			const isBlacklisted = await hrStub.isUserBlacklisted(userId)

			if (isBlacklisted) {
				// User is blacklisted - invalidate session and reject
				const sessionService = new SessionService(db)
				await sessionService.invalidateSession(sessionToken)
				return c.json({ error: 'Account suspended' }, 403)
			}

			// Fetch user's roles from Groups Durable Object (cached)
			let userRoles: string[] = []
			try {
				const roleAttachments = await getCachedUserRoles(c.env, userId)
				// Extract role names (URNs) from attachments
				userRoles = roleAttachments.map((attachment) => attachment.role.name)
			} catch (error) {
				logger.error('Error fetching user roles:', error)
				// Continue without roles if error occurs
				userRoles = []
			}

			// Load Discord profile if linked
			let discordProfile
			if (userProfile.discordUserId) {
				try {
					const status = await discordService.getUserStatus(c.env, userId)
					if (status) {
						discordProfile = {
							userId: status.userId,
							username: status.username,
							discriminator: status.discriminator,
							authRevoked: status.authRevoked,
							authRevokedAt: status.authRevokedAt,
							lastSuccessfulAuth: status.lastSuccessfulAuth,
						}
					}
				} catch (error) {
					logger.error('Error loading Discord profile:', error)
					// Continue without Discord profile if error occurs
				}
			}

			// Build session user object
			const sessionUser: SessionUser = {
				id: userProfile.id,
				mainCharacterId: userProfile.mainCharacterId,
				sessionId: session.id,
				characters: userProfile.characters.map((char) => ({
					id: char.id,
					characterOwnerHash: char.characterOwnerHash,
					characterId: char.characterId,
					characterName: char.characterName,
					is_primary: char.is_primary,
					hasValidToken: char.hasValidToken,
				})),
				is_admin: userProfile.is_admin,
				roles: userRoles,
				discord: discordProfile,
			}

			// Attach to context
			c.set('user', sessionUser)
			c.set('db', db)
			c.set('eveTokenStore', eveTokenStoreStub)

			await next()
		} catch (error) {
			logger.error('Error in session middleware:', error)
			// Continue without user if error occurs
			await next()
		}
	}
}

/**
 * Role requirement options for requireAuth middleware
 */
export type RoleRequirement =
	| string // Single role (user must have this role)
	| string[] // Multiple roles with OR logic (user must have at least one)
	| { all: string[] } // Multiple roles with AND logic (user must have all)
	| { any: string[] } // Multiple roles with OR logic (explicit)

/**
 * Require authentication middleware with optional role-based access control
 *
 * Returns 401 if no user is authenticated.
 * Returns 403 if user is authenticated but lacks required roles.
 * Use this after sessionMiddleware for protected routes.
 *
 * @param requiredRoles Optional role requirements
 * @example
 * // Just authentication
 * .use(requireAuth())
 *
 * // User needs this specific role
 * .use(requireAuth('urn:service:core:role:admin'))
 *
 * // User needs ANY of these roles (OR logic)
 * .use(requireAuth(['urn:service:core:role:admin', 'urn:service:core:role:industry-admin']))
 *
 * // User needs ALL of these roles (AND logic)
 * .use(requireAuth({ all: ['urn:service:core:role:admin', 'urn:service:core:role:auditor'] }))
 *
 * // User needs ANY of these roles (OR logic, explicit)
 * .use(requireAuth({ any: ['urn:service:core:role:admin', 'urn:service:core:role:industry-admin'] }))
 */
export const requireAuth = (requiredRoles?: RoleRequirement): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')

		// Check authentication
		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		// If no role requirements, just check authentication
		if (!requiredRoles) {
			return next()
		}

		// Check role-based authorization
		const userRoles = user.roles || []

		let hasRequiredRoles = false
		let errorMessage = 'Forbidden: Missing required role(s)'

		if (typeof requiredRoles === 'string') {
			// Single role requirement
			hasRequiredRoles = userRoles.includes(requiredRoles)
			if (!hasRequiredRoles) {
				errorMessage = `Forbidden: Missing required role: ${requiredRoles}`
			}
		} else if (Array.isArray(requiredRoles)) {
			// Array of roles with OR logic (user needs at least one)
			hasRequiredRoles = requiredRoles.some((role) => userRoles.includes(role))
			if (!hasRequiredRoles) {
				errorMessage = `Forbidden: Missing one of required roles: ${requiredRoles.join(', ')}`
			}
		} else if ('all' in requiredRoles) {
			// User needs ALL of the specified roles (AND logic)
			hasRequiredRoles = requiredRoles.all.every((role) => userRoles.includes(role))
			if (!hasRequiredRoles) {
				const missingRoles = requiredRoles.all.filter((role) => !userRoles.includes(role))
				errorMessage = `Forbidden: Missing required roles: ${missingRoles.join(', ')}`
			}
		} else if ('any' in requiredRoles) {
			// User needs ANY of the specified roles (OR logic, explicit)
			hasRequiredRoles = requiredRoles.any.some((role) => userRoles.includes(role))
			if (!hasRequiredRoles) {
				errorMessage = `Forbidden: Missing one of required roles: ${requiredRoles.any.join(', ')}`
			}
		}

		if (!hasRequiredRoles) {
			return c.json({ error: errorMessage }, 403)
		}

		return next()
	}
}

/**
 * Require admin middleware
 *
 * Returns 403 if user is not an admin.
 * Use this after sessionMiddleware and requireAuth for admin-only access.
 */
export const requireAdmin = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')

		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}

		if (!user.is_admin) {
			return c.json({ error: 'Forbidden' }, 403)
		}

		return next()
	}
}

export const requireAllianceMember = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')

		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
		}
		if (!user.roles.includes(ROLE_CORE_ALLIANCE_MEMBER)) {
			return c.json({ error: 'Forbidden' }, 403)
		}
		return next()
	}
}
