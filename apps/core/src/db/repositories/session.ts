import { eq, lt, and, sql } from '@repo/db-utils'
import type { CoreDb } from '../client'
import { sessions, users, oidcStates } from '../schema'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

export type Session = InferSelectModel<typeof sessions>
export type NewSession = InferInsertModel<typeof sessions>
export type OidcState = InferSelectModel<typeof oidcStates>
export type NewOidcState = InferInsertModel<typeof oidcStates>

export class SessionRepository {
	constructor(private db: CoreDb) {}

	/**
	 * Create a new session
	 */
	async createSession(data: NewSession): Promise<Session> {
		const [session] = await this.db
			.insert(sessions)
			.values(data)
			.returning()

		return session
	}

	/**
	 * Get session by ID with user data
	 */
	async getSession(sessionId: string) {
		const result = await this.db
			.select({
				session: sessions,
				user: users
			})
			.from(sessions)
			.leftJoin(users, eq(sessions.userId, users.id))
			.where(eq(sessions.id, sessionId))
			.limit(1)

		if (result.length === 0) {
			return null
		}

		return {
			...result[0].session,
			user: result[0].user
		}
	}

	/**
	 * Update session tokens
	 */
	async updateSessionTokens(
		sessionId: string,
		accessToken: string,
		refreshToken?: string
	): Promise<void> {
		const updateData: Partial<Session> = {
			accessToken,
			updatedAt: new Date()
		}

		if (refreshToken) {
			updateData.refreshToken = refreshToken
		}

		await this.db
			.update(sessions)
			.set(updateData)
			.where(eq(sessions.id, sessionId))
	}

	/**
	 * Extend session expiration
	 */
	async extendSession(sessionId: string, expiresAt: Date): Promise<void> {
		await this.db
			.update(sessions)
			.set({
				expiresAt,
				updatedAt: new Date()
			})
			.where(eq(sessions.id, sessionId))
	}

	/**
	 * Delete a session
	 */
	async deleteSession(sessionId: string): Promise<void> {
		await this.db
			.delete(sessions)
			.where(eq(sessions.id, sessionId))
	}

	/**
	 * Delete expired sessions
	 */
	async deleteExpiredSessions(): Promise<number> {
		const result = await this.db
			.delete(sessions)
			.where(lt(sessions.expiresAt, new Date()))
			.returning({ id: sessions.id })

		return result.length
	}

	/**
	 * Get sessions by user ID
	 */
	async getUserSessions(userId: string): Promise<Session[]> {
		return this.db
			.select()
			.from(sessions)
			.where(eq(sessions.userId, userId))
			.orderBy(sessions.createdAt)
	}

	/**
	 * Delete all sessions for a user
	 */
	async deleteUserSessions(userId: string): Promise<void> {
		await this.db
			.delete(sessions)
			.where(eq(sessions.userId, userId))
	}

	// ============================================================================
	// OIDC State Management
	// ============================================================================

	/**
	 * Create OIDC state for CSRF protection
	 */
	async createOidcState(state: string, sessionId: string | null, expiresAt: Date): Promise<void> {
		await this.db
			.insert(oidcStates)
			.values({
				state,
				sessionId,
				expiresAt
			})
	}

	/**
	 * Validate and consume OIDC state (one-time use)
	 */
	async validateOidcState(state: string): Promise<{ sessionId: string | null } | null> {
		// Get the state
		const [stateRecord] = await this.db
			.select()
			.from(oidcStates)
			.where(eq(oidcStates.state, state))
			.limit(1)

		if (!stateRecord) {
			return null
		}

		// Check if expired
		if (stateRecord.expiresAt < new Date()) {
			// Delete expired state
			await this.db
				.delete(oidcStates)
				.where(eq(oidcStates.state, state))
			return null
		}

		// Delete the state (one-time use)
		await this.db
			.delete(oidcStates)
			.where(eq(oidcStates.state, state))

		return {
			sessionId: stateRecord.sessionId
		}
	}

	/**
	 * Clean up expired OIDC states
	 */
	async cleanupExpiredOidcStates(): Promise<number> {
		const result = await this.db
			.delete(oidcStates)
			.where(lt(oidcStates.expiresAt, new Date()))
			.returning({ state: oidcStates.state })

		return result.length
	}
}