import { and, eq } from '@repo/db-utils'

import { userSessions } from '../db/schema'

import type { EveTokenStore } from '@repo/eve-token-store'
import type { createDb } from '../db'
import type { CreateSessionOptions, RequestMetadata, UserSessionDTO } from '../types/user'

/**
 * Authentication Service
 *
 * Handles session creation, validation, and management.
 * Uses the EVE Token Store Durable Object for character authentication.
 */
export class AuthService {
	constructor(
		private db: ReturnType<typeof createDb>,
		private eveTokenStoreStub: EveTokenStore,
		private sessionSecret: string
	) {}

	/**
	 * Create a new session for a user
	 */
	async createSession(options: CreateSessionOptions): Promise<UserSessionDTO> {
		const {
			userId,
			characterId,
			metadata,
			durationSeconds = 5 * 24 * 60 * 60, // 5 days default
		} = options

		// Generate session token (UUID v4)
		const sessionToken = crypto.randomUUID()

		// Calculate expiration
		const expiresAt = new Date(Date.now() + durationSeconds * 1000)

		// Insert session into database
		const [session] = await this.db
			.insert(userSessions)
			.values({
				userId,
				sessionToken,
				expiresAt,
				metadata: {
					...metadata,
					characterId,
				},
			})
			.returning()

		if (!session) {
			throw new Error('Failed to create session')
		}

		return {
			id: session.id,
			sessionToken: session.sessionToken,
			expiresAt: session.expiresAt,
			metadata: session.metadata as UserSessionDTO['metadata'],
			lastActivityAt: session.lastActivityAt,
			createdAt: session.createdAt,
		}
	}

	/**
	 * Validate a session token and return session data
	 */
	async validateSession(sessionToken: string): Promise<UserSessionDTO | null> {
		const session = await this.db.query.userSessions.findFirst({
			where: eq(userSessions.sessionToken, sessionToken),
		})

		if (!session) {
			return null
		}

		// Check if session is expired
		if (session.expiresAt < new Date()) {
			// Delete expired session
			await this.db.delete(userSessions).where(eq(userSessions.id, session.id))
			return null
		}

		// Update last activity timestamp
		await this.db
			.update(userSessions)
			.set({ lastActivityAt: new Date() })
			.where(eq(userSessions.id, session.id))

		return {
			id: session.id,
			sessionToken: session.sessionToken,
			expiresAt: session.expiresAt,
			metadata: session.metadata as UserSessionDTO['metadata'],
			lastActivityAt: new Date(),
			createdAt: session.createdAt,
		}
	}

	/**
	 * Revoke a session (logout)
	 */
	async revokeSession(sessionToken: string): Promise<boolean> {
		const result = await this.db
			.delete(userSessions)
			.where(eq(userSessions.sessionToken, sessionToken))
			.returning()

		return result.length > 0
	}

	/**
	 * Revoke all sessions for a user
	 */
	async revokeAllUserSessions(userId: string): Promise<number> {
		const result = await this.db
			.delete(userSessions)
			.where(eq(userSessions.userId, userId))
			.returning()

		return result.length
	}

	/**
	 * Get user ID from session token
	 */
	async getUserIdFromSession(sessionToken: string): Promise<string | null> {
		const session = await this.validateSession(sessionToken)
		if (!session) {
			return null
		}

		const sessionData = await this.db.query.userSessions.findFirst({
			where: eq(userSessions.sessionToken, sessionToken),
		})

		return sessionData?.userId || null
	}

	/**
	 * Clean up expired sessions (can be called periodically)
	 */
	async cleanupExpiredSessions(): Promise<number> {
		const result = await this.db
			.delete(userSessions)
			.where(and(eq(userSessions.expiresAt, new Date())))
			.returning()

		return result.length
	}

	/**
	 * Get EVE Token Store stub for direct RPC calls
	 */
	getEveTokenStore(): EveTokenStore {
		return this.eveTokenStoreStub
	}
}
