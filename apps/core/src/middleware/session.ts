import { getCookie } from 'hono/cookie'

import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { AuthService } from '../services/auth.service'
import * as discordService from '../services/discord.service'
import { UserService } from '../services/user.service'

import type { MiddlewareHandler } from 'hono'
import type { EveTokenStore } from '@repo/eve-token-store'
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

		try {
			// Create database client
			const db = createDb(c.env.DATABASE_URL)

			// Create EVE Token Store stub
			const eveTokenStoreStub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

			// Create services
			const authService = new AuthService(db, eveTokenStoreStub, c.env.SESSION_SECRET)
			const userService = new UserService(db)

			// Validate session
			const session = await authService.validateSession(sessionToken)

			if (!session) {
				// Invalid or expired session
				return next()
			}

			// Get user ID from session
			const userId = await authService.getUserIdFromSession(sessionToken)

			if (!userId) {
				// Session exists but user not found
				return next()
			}

			// Load user profile
			const userProfile = await userService.getUserProfile(userId)

			// Find primary character
			const primaryChar = userProfile.characters.find((c) => c.is_primary)

			// Load Discord profile if linked
			let discordProfile
			if (userProfile.discordUserId) {
				try {
					const profile = await discordService.getProfile(c.env, userId)
					if (profile) {
						discordProfile = {
							userId: profile.userId,
							username: profile.username,
							discriminator: profile.discriminator,
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
				})),
				is_admin: userProfile.is_admin,
				discord: discordProfile,
			}

			// Attach to context
			c.set('user', sessionUser)
			c.set('db', db)
			c.set('eveTokenStore', eveTokenStoreStub)
		} catch (error) {
			logger.error('Error in session middleware:', error)
			// Continue without user if error occurs
		}

		return next()
	}
}

/**
 * Require authentication middleware
 *
 * Returns 401 if no user is authenticated.
 * Use this after sessionMiddleware for protected routes.
 */
export const requireAuth = (): MiddlewareHandler<App> => {
	return async (c, next) => {
		const user = c.get('user')

		if (!user) {
			return c.json({ error: 'Unauthorized' }, 401)
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
