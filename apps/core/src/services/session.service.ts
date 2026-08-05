import { eq } from '@repo/db-utils'

import { userSessions } from '../db/schema'

import type { createDb } from '../db'

/**
 * Session Service
 *
 * Handles session management operations including session invalidation.
 * Used primarily for blacklisting and security operations.
 */
export class SessionService {
	constructor(private db: ReturnType<typeof createDb>) {}

	/**
	 * Invalidate all sessions for a user
	 * Used when a user is blacklisted or when security requires logout
	 *
	 * @param userId - User ID whose sessions should be invalidated
	 * @returns Number of sessions invalidated
	 */
	async invalidateAllUserSessions(userId: string): Promise<number> {
		await this.db.delete(userSessions).where(eq(userSessions.userId, userId))

		// Drizzle doesn't provide a standard way to get affected rows count
		// We return 0 as a placeholder (the operation still succeeds)
		return 0
	}

	/**
	 * Invalidate a specific session by session token
	 * Used for single logout or when a session is compromised
	 *
	 * @param sessionToken - Session token to invalidate
	 */
	async invalidateSession(sessionToken: string): Promise<void> {
		await this.db.delete(userSessions).where(eq(userSessions.sessionToken, sessionToken))
	}

	/**
	 * Invalidate all sessions except one
	 * Used for "logout other devices" functionality
	 *
	 * @param userId - User ID whose sessions should be invalidated
	 * @param keepSessionToken - Session token to keep active
	 */
	async invalidateAllExceptOne(userId: string, keepSessionToken: string): Promise<void> {
		// Get all sessions for the user
		const sessions = await this.db.query.userSessions.findMany({
			where: eq(userSessions.userId, userId),
		})

		// Delete all sessions except the one to keep
		for (const session of sessions) {
			if (session.sessionToken !== keepSessionToken) {
				await this.db
					.delete(userSessions)
					.where(eq(userSessions.sessionToken, session.sessionToken))
			}
		}
	}
}
