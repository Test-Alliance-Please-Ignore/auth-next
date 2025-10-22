import { and, asc, eq } from '@repo/db-utils'
import type { EveTokenStore, EsiResponse } from '@repo/eve-token-store'

import type { EsiCharacterRoles } from '@repo/eve-corporation-data'
import type { createDb } from './db'
import { characterCorporationRoles, corporationConfig, corporationDirectors } from './db/schema'

/**
 * Director health status
 */
export interface DirectorHealth {
	directorId: string
	characterId: string
	characterName: string
	isHealthy: boolean
	lastHealthCheck: Date | null
	lastUsed: Date | null
	failureCount: number
	lastFailureReason: string | null
	priority: number
}

/**
 * Director selection result
 */
export interface SelectedDirector {
	directorId: string
	characterId: string
	characterName: string
}

/**
 * Health check failure threshold
 */
const FAILURE_THRESHOLD = 3

/**
 * Success count needed to recover from unhealthy state
 */
const RECOVERY_THRESHOLD = 3

/**
 * DirectorManager handles director selection, health tracking, and failover logic
 */
export class DirectorManager {
	constructor(
		private readonly db: ReturnType<typeof createDb>,
		private readonly corporationId: string,
		private readonly tokenStore: EveTokenStore
	) {}

	/**
	 * Add a new director for this corporation
	 */
	async addDirector(characterId: string, characterName: string, priority = 100): Promise<void> {
		await this.db.insert(corporationDirectors).values({
			corporationId: this.corporationId,
			characterId,
			characterName,
			priority,
			isHealthy: true,
			failureCount: 0,
			lastHealthCheck: null,
			lastUsed: null,
			updatedAt: new Date(),
		})
	}

	/**
	 * Remove a director from this corporation
	 */
	async removeDirector(characterId: string): Promise<void> {
		await this.db
			.delete(corporationDirectors)
			.where(
				and(
					eq(corporationDirectors.corporationId, this.corporationId),
					eq(corporationDirectors.characterId, characterId)
				)
			)
	}

	/**
	 * Update director priority
	 */
	async updateDirectorPriority(characterId: string, priority: number): Promise<void> {
		await this.db
			.update(corporationDirectors)
			.set({
				priority,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(corporationDirectors.corporationId, this.corporationId),
					eq(corporationDirectors.characterId, characterId)
				)
			)
	}

	/**
	 * Get all directors for this corporation
	 */
	async getAllDirectors(): Promise<DirectorHealth[]> {
		const directors = await this.db.query.corporationDirectors.findMany({
			where: eq(corporationDirectors.corporationId, this.corporationId),
			orderBy: [asc(corporationDirectors.priority), asc(corporationDirectors.lastUsed)],
		})

		return directors.map((d) => ({
			directorId: d.id,
			characterId: d.characterId,
			characterName: d.characterName,
			isHealthy: d.isHealthy,
			lastHealthCheck: d.lastHealthCheck,
			lastUsed: d.lastUsed,
			failureCount: d.failureCount,
			lastFailureReason: d.lastFailureReason,
			priority: d.priority,
		}))
	}

	/**
	 * Get healthy directors for this corporation (for round-robin selection)
	 */
	async getHealthyDirectors(): Promise<DirectorHealth[]> {
		const directors = await this.db.query.corporationDirectors.findMany({
			where: and(
				eq(corporationDirectors.corporationId, this.corporationId),
				eq(corporationDirectors.isHealthy, true)
			),
			// Order by: priority (asc), then lastUsed (asc, nulls first for new directors)
			orderBy: [asc(corporationDirectors.priority), asc(corporationDirectors.lastUsed)],
		})

		return directors.map((d) => ({
			directorId: d.id,
			characterId: d.characterId,
			characterName: d.characterName,
			isHealthy: d.isHealthy,
			lastHealthCheck: d.lastHealthCheck,
			lastUsed: d.lastUsed,
			failureCount: d.failureCount,
			lastFailureReason: d.lastFailureReason,
			priority: d.priority,
		}))
	}

	/**
	 * Select the next healthy director using round-robin with priority
	 * Returns null if no healthy directors available
	 */
	async selectDirector(): Promise<SelectedDirector | null> {
		const healthyDirectors = await this.getHealthyDirectors()

		if (healthyDirectors.length === 0) {
			console.error('[DirectorManager] No healthy directors available', {
				corporationId: this.corporationId,
			})
			return null
		}

		// Round-robin: Select the least-recently-used director
		// Already sorted by priority, then lastUsed (nulls first)
		const selected = healthyDirectors[0]

		console.log('[DirectorManager] Selected director', {
			corporationId: this.corporationId,
			directorId: selected.directorId,
			characterId: selected.characterId,
			characterName: selected.characterName,
			lastUsed: selected.lastUsed,
			priority: selected.priority,
		})

		return {
			directorId: selected.directorId,
			characterId: selected.characterId,
			characterName: selected.characterName,
		}
	}

	/**
	 * Record successful director usage
	 */
	async recordSuccess(directorId: string): Promise<void> {
		const now = new Date()

		// Get current failure count
		const director = await this.db.query.corporationDirectors.findFirst({
			where: eq(corporationDirectors.id, directorId),
		})

		if (!director) {
			return
		}

		// If director was unhealthy and has been successful, potentially recover
		const newFailureCount = Math.max(0, director.failureCount - 1)
		const shouldRecover = !director.isHealthy && newFailureCount === 0

		await this.db
			.update(corporationDirectors)
			.set({
				lastUsed: now,
				failureCount: newFailureCount,
				isHealthy: shouldRecover ? true : director.isHealthy,
				lastFailureReason: shouldRecover ? null : director.lastFailureReason,
				updatedAt: now,
			})
			.where(eq(corporationDirectors.id, directorId))

		if (shouldRecover) {
			console.log('[DirectorManager] Director recovered to healthy state', {
				directorId,
				characterId: director.characterId,
			})
		}
	}

	/**
	 * Record director failure and potentially mark as unhealthy
	 */
	async recordFailure(directorId: string, reason: string): Promise<void> {
		const now = new Date()

		// Get current failure count
		const director = await this.db.query.corporationDirectors.findFirst({
			where: eq(corporationDirectors.id, directorId),
		})

		if (!director) {
			return
		}

		const newFailureCount = director.failureCount + 1
		const shouldMarkUnhealthy = newFailureCount >= FAILURE_THRESHOLD

		await this.db
			.update(corporationDirectors)
			.set({
				failureCount: newFailureCount,
				lastFailureReason: reason,
				isHealthy: shouldMarkUnhealthy ? false : director.isHealthy,
				updatedAt: now,
			})
			.where(eq(corporationDirectors.id, directorId))

		if (shouldMarkUnhealthy) {
			console.error('[DirectorManager] Director marked as unhealthy', {
				directorId,
				characterId: director.characterId,
				failureCount: newFailureCount,
				reason,
			})
		}

		// Check if all directors are now unhealthy
		const healthyCount = await this.getHealthyDirectorsCount()
		if (healthyCount === 0) {
			console.error('[DirectorManager] ALL DIRECTORS UNHEALTHY - CRITICAL', {
				corporationId: this.corporationId,
			})
			// TODO: Trigger notification/alert here
		}
	}

	/**
	 * Get count of healthy directors
	 */
	async getHealthyDirectorsCount(): Promise<number> {
		const directors = await this.getHealthyDirectors()
		return directors.length
	}

	/**
	 * Verify director health by checking token and roles
	 */
	async verifyDirectorHealth(directorId: string): Promise<boolean> {
		const director = await this.db.query.corporationDirectors.findFirst({
			where: eq(corporationDirectors.id, directorId),
		})

		if (!director) {
			return false
		}

		try {
			console.log('[DirectorManager] Verifying director health', {
				directorId,
				characterId: director.characterId,
			})

			// Fetch character roles from ESI
			const response: EsiResponse<EsiCharacterRoles> = await this.tokenStore.fetchEsi(
				`/characters/${director.characterId}/roles`,
				director.characterId
			)

			const roles = response.data

			// Store roles in database
			await this.db
				.insert(characterCorporationRoles)
				.values({
					corporationId: this.corporationId,
					characterId: director.characterId,
					roles: roles.roles || [],
					rolesAtHq: roles.roles_at_hq,
					rolesAtBase: roles.roles_at_base,
					rolesAtOther: roles.roles_at_other,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterCorporationRoles.corporationId, characterCorporationRoles.characterId],
					set: {
						roles: roles.roles || [],
						rolesAtHq: roles.roles_at_hq,
						rolesAtBase: roles.roles_at_base,
						rolesAtOther: roles.roles_at_other,
						updatedAt: new Date(),
					},
				})

			// Update director health check timestamp
			await this.db
				.update(corporationDirectors)
				.set({
					lastHealthCheck: new Date(),
					isHealthy: true,
					failureCount: 0,
					lastFailureReason: null,
					updatedAt: new Date(),
				})
				.where(eq(corporationDirectors.id, directorId))

			console.log('[DirectorManager] Director health verified successfully', {
				directorId,
				characterId: director.characterId,
			})

			return true
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			console.error('[DirectorManager] Director health verification failed', {
				directorId,
				characterId: director.characterId,
				error: errorMessage,
			})

			await this.recordFailure(directorId, errorMessage)
			return false
		}
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(): Promise<{ verified: number; failed: number }> {
		const directors = await this.getAllDirectors()
		let verified = 0
		let failed = 0

		for (const director of directors) {
			const isHealthy = await this.verifyDirectorHealth(director.directorId)
			if (isHealthy) {
				verified++
			} else {
				failed++
			}
		}

		// Update corporation config verification status
		await this.db
			.update(corporationConfig)
			.set({
				isVerified: verified > 0,
				lastVerified: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(corporationConfig.corporationId, this.corporationId))

		return { verified, failed }
	}

	/**
	 * Execute an ESI request with automatic director failover
	 */
	async executeWithFailover<T>(
		operation: (characterId: string) => Promise<EsiResponse<T>>
	): Promise<EsiResponse<T>> {
		const healthyDirectors = await this.getHealthyDirectors()

		if (healthyDirectors.length === 0) {
			throw new Error('No healthy directors available for ESI request')
		}

		// Try each director in order (already sorted by priority and lastUsed)
		let lastError: Error | null = null

		for (const director of healthyDirectors) {
			try {
				console.log('[DirectorManager] Attempting ESI request with director', {
					directorId: director.directorId,
					characterId: director.characterId,
				})

				const result = await operation(director.characterId)

				// Success! Record it and return
				await this.recordSuccess(director.directorId)
				return result
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error))
				console.error('[DirectorManager] ESI request failed with director', {
					directorId: director.directorId,
					characterId: director.characterId,
					error: lastError.message,
				})

				// Record failure
				await this.recordFailure(director.directorId, lastError.message)

				// Continue to next director
			}
		}

		// All directors failed
		throw new Error(
			`All directors failed ESI request. Last error: ${lastError?.message || 'Unknown error'}`
		)
	}
}
