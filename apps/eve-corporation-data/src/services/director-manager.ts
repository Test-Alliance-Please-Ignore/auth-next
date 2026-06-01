import { and, asc, eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'
import { parseEsiErrorMetadata, retryWithBackoff } from '@repo/workflow-utils'

import { characterCorporationRoles, corporationConfig, corporationDirectors } from '../db/schema'

import type { CorporationRole, EsiCharacterRoles } from '@repo/eve-corporation-data'
import type { EsiCharacterAffiliation, EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { createDb } from '../db'

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
	nextRetryAt?: Date | null
	permanentFailureAt?: Date | null
	priority: number
	updatedAt?: Date
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
const _RECOVERY_THRESHOLD = 3
const PERMANENT_FAILURE_PREFIX = '[PERMANENT]'
const INVALID_STALE_PERMANENT_MS = 7 * 24 * 60 * 60 * 1000
const TRANSIENT_DIRECTOR_COOLDOWN_MS = 10 * 60 * 1000

const FULL_SYNC_REQUIRED_ROLE_SETS: CorporationRole[][] = [
	['Director'],
	['Accountant', 'Junior_Accountant'],
	['Station_Manager'],
	['Accountant', 'Junior_Accountant', 'Trader'],
	['Factory_Manager'],
]

/**
 * DirectorManager handles director selection, health tracking, and failover logic
 */
export class DirectorManager {
	constructor(
		private readonly db: ReturnType<typeof createDb>,
		private readonly corporationId: string,
		private readonly tokenStore: EveTokenStore,
		private readonly onAffiliationMismatch?: (
			characterId: string,
			expectedCorporationId: string,
			actualCorporationId: string | null
		) => Promise<void>,
		private readonly onDirectorPruned?: (
			characterId: string,
			corporationId: string,
			reason: string
		) => Promise<void>
	) {}

	/**
	 * Add a new director for this corporation
	 */
	async addDirector(characterId: string, characterName: string, priority = 100): Promise<void> {
		await this.db
			.insert(corporationDirectors)
			.values({
				corporationId: this.corporationId,
				characterId,
				characterName,
				priority,
				// Never assume health at insert-time; require explicit verification.
				isHealthy: false,
				failureCount: 0,
				lastHealthCheck: null,
				lastUsed: null,
				lastFailureReason: 'Pending health verification',
				updatedAt: new Date(),
			})
			.onConflictDoNothing({
				target: [corporationDirectors.corporationId, corporationDirectors.characterId],
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
			characterId: String(d.characterId),
			characterName: d.characterName,
			isHealthy: d.isHealthy,
			lastHealthCheck: d.lastHealthCheck,
			lastUsed: d.lastUsed,
			failureCount: d.failureCount,
			lastFailureReason: d.lastFailureReason,
			nextRetryAt: d.nextRetryAt,
			permanentFailureAt: d.permanentFailureAt,
			priority: d.priority,
			updatedAt: d.updatedAt,
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

		const result = directors.map((d) => ({
			directorId: d.id,
			characterId: String(d.characterId),
			characterName: d.characterName,
			isHealthy: d.isHealthy,
			lastHealthCheck: d.lastHealthCheck,
			lastUsed: d.lastUsed,
			failureCount: d.failureCount,
			lastFailureReason: d.lastFailureReason,
			nextRetryAt: d.nextRetryAt,
			permanentFailureAt: d.permanentFailureAt,
			priority: d.priority,
			updatedAt: d.updatedAt,
		}))
		return result
	}

	async getUnhealthyDirectors(): Promise<DirectorHealth[]> {
		const directors = await this.db.query.corporationDirectors.findMany({
			where: and(
				eq(corporationDirectors.corporationId, this.corporationId),
				eq(corporationDirectors.isHealthy, false)
			),
		})
		return directors.map((d) => ({
			directorId: d.id,
			characterId: String(d.characterId),
			characterName: d.characterName,
			isHealthy: d.isHealthy,
			lastHealthCheck: d.lastHealthCheck,
			lastUsed: d.lastUsed,
			failureCount: d.failureCount,
			lastFailureReason: d.lastFailureReason,
			nextRetryAt: d.nextRetryAt,
			permanentFailureAt: d.permanentFailureAt,
			priority: d.priority,
			updatedAt: d.updatedAt,
		}))
	}
	/**
	 * Select the next healthy director using round-robin with priority
	 * Returns null if no healthy directors available
	 */
	async selectDirector(options?: { requiredRoleSets?: CorporationRole[][] }): Promise<SelectedDirector | null> {
		try {
			const now = Date.now()
			const healthyDirectors = (await this.getHealthyDirectors()).filter(
				(director) => !director.nextRetryAt || director.nextRetryAt.getTime() <= now
			)

			if (healthyDirectors.length === 0) {
				console.error('[DirectorManager] No healthy directors available', {
					corporationId: this.corporationId,
				})
				return null
			}

			// Round-robin candidate order is already sorted by priority, then lastUsed (nulls first).
			// Validate token presence/freshness before returning a director so authenticated workflow
			// steps do not run with a director that cannot produce credentials.
			for (const candidate of healthyDirectors) {
				try {
					const tokenInfo = await this.tokenStore.getTokenInfo(candidate.characterId)
					if (!tokenInfo) {
						await this.safeRecordFailure(candidate.directorId, 'No token available for director')
						continue
					}

					if (tokenInfo.isExpired) {
						if (!tokenInfo.hasRefreshToken) {
							await this.safeRecordFailure(
								candidate.directorId,
								'Director token expired and requires reauthentication (no refresh token)',
								{ forceUnhealthy: true }
							)
							continue
						}
						const refreshSucceeded = await this.tokenStore.refreshToken(candidate.characterId)
						if (!refreshSucceeded) {
							await this.safeRecordFailure(
								candidate.directorId,
								'Director token expired and refresh failed'
							)
							continue
						}
					}

					const affiliationCheck = await this.checkAffiliation(candidate.characterId)
					if (!affiliationCheck.matches) {
						await this.handleAffiliationMismatch({
							directorId: candidate.directorId,
							characterId: candidate.characterId,
							actualCorporationId: affiliationCheck.corporationId,
							context: 'select-director',
						})
						continue
					}

					if (options?.requiredRoleSets && options.requiredRoleSets.length > 0) {
						const rolesResponse: EsiResponse<EsiCharacterRoles> = await retryWithBackoff(
							() =>
								this.tokenStore.fetchEsi(
									`/characters/${candidate.characterId}/roles`,
									candidate.characterId
								),
							{
								onRetry: (attempt, error, delayMs) => {
									logger.warn('[DirectorManager] Retrying director role lookup after ESI throttling', {
										corporationId: this.corporationId,
										directorId: candidate.directorId,
										characterId: candidate.characterId,
										attempt,
										delayMs,
										error: error.message,
									})
								},
							}
						)
						const roleSet = this.buildEffectiveRoleSet(rolesResponse.data)
						const missingRoleSets = this.getMissingRoleSets(roleSet, options.requiredRoleSets)
						if (missingRoleSets.length > 0) {
							await this.safeRecordFailure(
								candidate.directorId,
								`Director missing required roles for selection: ${missingRoleSets.map((set) => `[${set.join('|')}]`).join(', ')}`,
								{ forceUnhealthy: true }
							)
							continue
						}
					}

					await this.safeMarkSelected(candidate.directorId)

					return {
						directorId: candidate.directorId,
						characterId: String(candidate.characterId),
						characterName: candidate.characterName,
					}
				} catch (error) {
					await this.safeRecordFailure(
						candidate.directorId,
						this.buildDirectorAuthFailureReason('select-director', error)
					)
				}
			}

			console.error('[DirectorManager] No directors with valid tokens available', {
				corporationId: this.corporationId,
				candidatesChecked: healthyDirectors.length,
			})
			return null
		} catch (error) {
			console.error(
				'[DirectorManager] Director selection failed; falling back to unauthenticated sync',
				{
					corporationId: this.corporationId,
					error: error instanceof Error ? error.message : String(error),
				}
			)
			return null
		}
	}

	private async markSelected(directorId: string): Promise<void> {
		await this.db
			.update(corporationDirectors)
			.set({
				lastUsed: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(corporationDirectors.id, directorId))
	}

	private async safeMarkSelected(directorId: string): Promise<void> {
		try {
			await this.markSelected(directorId)
		} catch (error) {
			console.error('[DirectorManager] Failed to update director lastUsed on selection', {
				corporationId: this.corporationId,
				directorId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private async checkAffiliation(
		characterId: string
	): Promise<{ matches: boolean; corporationId: string | null }> {
		const numericCharacterId = Number.parseInt(characterId, 10)
		if (!Number.isFinite(numericCharacterId)) {
			return { matches: false, corporationId: null }
		}

		const affiliationResponse: EsiResponse<EsiCharacterAffiliation[]> = await retryWithBackoff(
			() => this.tokenStore.fetchCharacterAffiliations([characterId]),
			{
				onRetry: (attempt, error, delayMs) => {
					logger.warn('[DirectorManager] Retrying character affiliation lookup after ESI throttling', {
						corporationId: this.corporationId,
						characterId,
						attempt,
						delayMs,
						error: error.message,
					})
				},
			}
		)
		const affiliations = affiliationResponse.data
		const affiliation = affiliations.find((entry) => entry.character_id === numericCharacterId)
		if (!affiliation) {
			return { matches: false, corporationId: null }
		}

		const corporationId = String(affiliation.corporation_id)
		return {
			matches: corporationId === this.corporationId,
			corporationId,
		}
	}

	private async handleAffiliationMismatch(params: {
		directorId: string
		characterId: string
		actualCorporationId: string | null
		context: 'select-director' | 'verify-director-health'
	}): Promise<void> {
		const reason = `Director affiliation mismatch: expected corporation ${this.corporationId}, got ${params.actualCorporationId ?? 'unknown'}`

		if (this.onAffiliationMismatch) {
			try {
				await this.onAffiliationMismatch(
					params.characterId,
					this.corporationId,
					params.actualCorporationId
				)
			} catch (error) {
				console.error('[DirectorManager] Affiliation mismatch callback failed', {
					corporationId: this.corporationId,
					characterId: params.characterId,
					context: params.context,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		await this.safeRecordFailure(params.directorId, reason, { forceUnhealthy: true })

		try {
			await this.removeDirector(params.characterId)
			console.warn('[DirectorManager] Auto-pruned director due to affiliation mismatch', {
				corporationId: this.corporationId,
				directorId: params.directorId,
				characterId: params.characterId,
				actualCorporationId: params.actualCorporationId,
				context: params.context,
			})
		} catch (error) {
			console.error('[DirectorManager] Failed to auto-prune mismatched director', {
				corporationId: this.corporationId,
				directorId: params.directorId,
				characterId: params.characterId,
				context: params.context,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		if (this.onDirectorPruned) {
			try {
				await this.onDirectorPruned(params.characterId, this.corporationId, reason)
			} catch (error) {
				console.error('[DirectorManager] Director pruned callback failed', {
					corporationId: this.corporationId,
					characterId: params.characterId,
					context: params.context,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
	}

	private buildEffectiveRoleSet(roles: EsiCharacterRoles): Set<string> {
		return new Set([
			...(roles.roles || []),
			...(roles.roles_at_hq || []),
			...(roles.roles_at_base || []),
			...(roles.roles_at_other || []),
		])
	}

	private hasHierarchyOverride(roleSet: Set<string>): boolean {
		return roleSet.has('CEO') || roleSet.has('Director')
	}

	private satisfiesAnyRequiredRoles(roleSet: Set<string>, anyOf: CorporationRole[]): boolean {
		if (this.hasHierarchyOverride(roleSet)) {
			return true
		}
		return anyOf.some((role) => roleSet.has(role))
	}

	private getMissingRoleSets(
		roleSet: Set<string>,
		requiredRoleSets: CorporationRole[][]
	): CorporationRole[][] {
		return requiredRoleSets.filter((anyOf) => !this.satisfiesAnyRequiredRoles(roleSet, anyOf))
	}

	private async safeRecordFailure(
		directorId: string,
		reason: string,
		options?: { forceUnhealthy?: boolean }
	): Promise<void> {
		try {
			await this.recordFailure(directorId, reason, options)
		} catch (error) {
			console.error('[DirectorManager] Failed to record director failure', {
				corporationId: this.corporationId,
				directorId,
				reason,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private buildDirectorAuthFailureReason(
		stepName: string,
		error: unknown,
		requiredRoles?: CorporationRole[]
	): string {
		const rawMessage = error instanceof Error ? error.message : String(error)
		const metadata = error instanceof Error ? parseEsiErrorMetadata(error.message) : null
		const status = typeof metadata?.status === 'number' ? metadata.status : null
		const path = typeof metadata?.path === 'string' ? metadata.path : null
		const lower = rawMessage.toLowerCase()
		const roleHint = lower.includes('required role') ? 'required_roles_missing' : null
		const classifyDetailCode = (): string => {
			if (status === 401 && lower.includes('no token')) {
				return 'no_token_provided'
			}
			if (status === 401 && lower.includes('expired')) {
				return 'token_expired'
			}
			if (status === 403 && lower.includes('required role')) {
				return 'required_roles_missing'
			}
			if (status === 403) {
				return 'forbidden'
			}
			if (status === 401) {
				return 'unauthorized'
			}
			return 'auth_failure'
		}
		const classifyReasonCode = (): string => {
			if (roleHint === 'required_roles_missing') {
				return 'required_roles_missing'
			}
			if (status === 401) {
				return 'unauthorized'
			}
			if (status === 403) {
				return 'forbidden'
			}
			return 'auth_failure'
		}
		const detailCode = classifyDetailCode()
		const reasonCode = classifyReasonCode()
		const parts = [
			`step=${stepName}`,
			status !== null ? `status=${status}` : null,
			path ? `path=${path}` : null,
			`reasonCode=${reasonCode}`,
			detailCode ? `detailCode=${detailCode}` : null,
			roleHint ? `hint=${roleHint}` : null,
			requiredRoles && requiredRoles.length > 0 ? `requiredRoles=${requiredRoles.join('|')}` : null,
			roleHint && requiredRoles && requiredRoles.length > 0 ? `missingRoles=unknown_from_esi` : null,
		].filter((part): part is string => Boolean(part))
		return `Director auth failure (${parts.join(', ')})`
	}

	private isTransientEsiFailure(reason: string): boolean {
		const lower = reason.toLowerCase()
		const metadata = parseEsiErrorMetadata(reason)
		const status = typeof metadata?.status === 'number' ? metadata.status : null

		// ESI/global transient conditions should not degrade director health.
		if (status === 429) return true
		if (status !== null && status >= 500) return true
		if (lower.includes('rate limit')) return true
		if (lower.includes('timeout')) return true
		if (lower.includes('temporarily unavailable')) return true

		return false
	}

	private isPermanentFailureReason(reason: string | null | undefined): boolean {
		if (!reason) return false
		return reason.startsWith(PERMANENT_FAILURE_PREFIX)
	}

	private isPermanentlyFailed(director: {
		permanentFailureAt?: Date | null
		lastFailureReason: string | null
	}): boolean {
		return Boolean(director.permanentFailureAt) || this.isPermanentFailureReason(director.lastFailureReason)
	}

	private asPermanentFailureReason(reason: string): string {
		if (this.isPermanentFailureReason(reason)) {
			return reason
		}
		return `${PERMANENT_FAILURE_PREFIX} ${reason}`
	}

	private shouldTreatAsPermanentFailure(reason: string): boolean {
		const lower = reason.toLowerCase()
		const metadata = parseEsiErrorMetadata(reason)
		const status = typeof metadata?.status === 'number' ? metadata.status : null

		// Explicit invalid refresh/auth states
		if (lower.includes('invalid_grant')) return true
		if (lower.includes('invalid refresh token')) return true
		if (lower.includes('token expired and requires reauthentication')) return true
		if (lower.includes('no token available for director')) return true

		// Explicit authz/authn invalid states
		if (status === 401 || status === 403) {
			if (lower.includes('required role')) return true
			if (lower.includes('forbidden')) return true
			if (lower.includes('unauthorized')) return true
		}

		// Affiliation mismatch is terminal until explicit operator action
		if (lower.includes('affiliation mismatch')) return true

		return false
	}

	private shouldForcePermanentDueToStaleness(director: {
		isHealthy: boolean
		lastFailureReason: string | null
		lastHealthCheck: Date | null
		nextRetryAt?: Date | null
		permanentFailureAt?: Date | null
		updatedAt?: Date
	}): boolean {
		if (director.isHealthy) return false
		if (this.isPermanentlyFailed(director)) return false
		if (director.lastFailureReason && this.isTransientEsiFailure(director.lastFailureReason)) return false
		if (director.nextRetryAt && director.nextRetryAt.getTime() > Date.now()) return false

		const anchor = director.lastHealthCheck ?? director.updatedAt
		if (!anchor) return false
		const ageMs = Date.now() - anchor.getTime()
		return ageMs >= INVALID_STALE_PERMANENT_MS
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
				nextRetryAt: shouldRecover ? null : director.nextRetryAt,
				permanentFailureAt: shouldRecover ? null : director.permanentFailureAt,
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
	async recordFailure(
		directorId: string,
		reason: string,
		options?: { forceUnhealthy?: boolean }
	): Promise<void> {
		const now = new Date()

		// Get current failure count
		const director = await this.db.query.corporationDirectors.findFirst({
			where: eq(corporationDirectors.id, directorId),
		})

		if (!director) {
			return
		}

		// Do not punish directors for transient upstream failures.
		if (!options?.forceUnhealthy && this.isTransientEsiFailure(reason)) {
			const nextRetryAt = new Date(Date.now() + TRANSIENT_DIRECTOR_COOLDOWN_MS)
			await this.db
				.update(corporationDirectors)
				.set({
					lastFailureReason: reason,
					nextRetryAt,
					isHealthy: director.isHealthy,
					updatedAt: now,
				})
				.where(eq(corporationDirectors.id, directorId))

			logger.warn('[DirectorManager] Transient ESI failure; preserving director health', {
				corporationId: this.corporationId,
				directorId,
				characterId: director.characterId,
				reason,
				nextRetryAt: nextRetryAt.toISOString(),
			})
			return
		}

		const normalizedReason =
			this.shouldTreatAsPermanentFailure(reason) || options?.forceUnhealthy
				? this.asPermanentFailureReason(reason)
				: reason
		let newFailureCount = director.failureCount + 1
		const shouldMarkUnhealthy = options?.forceUnhealthy
			? true
			: newFailureCount >= FAILURE_THRESHOLD
		if (options?.forceUnhealthy) {
			newFailureCount = Math.max(newFailureCount, FAILURE_THRESHOLD)
		}

		await this.db
			.update(corporationDirectors)
			.set({
				failureCount: newFailureCount,
				lastFailureReason: normalizedReason,
				isHealthy: shouldMarkUnhealthy ? false : director.isHealthy,
				nextRetryAt: null,
				permanentFailureAt:
					this.shouldTreatAsPermanentFailure(reason) || options?.forceUnhealthy
						? new Date()
						: director.permanentFailureAt,
				updatedAt: now,
			})
			.where(eq(corporationDirectors.id, directorId))

		if (shouldMarkUnhealthy) {
			console.error('[DirectorManager] Director marked as unhealthy', {
				directorId,
				characterId: director.characterId,
				failureCount: newFailureCount,
				reason: normalizedReason,
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
	async verifyDirectorHealth(
		directorId: string,
		options?: { requiredRoleSets?: CorporationRole[][] }
	): Promise<boolean> {
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

			const affiliationCheck = await this.checkAffiliation(String(director.characterId))
			if (!affiliationCheck.matches) {
				await this.handleAffiliationMismatch({
					directorId,
					characterId: String(director.characterId),
					actualCorporationId: affiliationCheck.corporationId,
					context: 'verify-director-health',
				})
				return false
			}

			// Fetch character roles from ESI
			const response: EsiResponse<EsiCharacterRoles> = await retryWithBackoff(
				() =>
					this.tokenStore.fetchEsi(`/characters/${director.characterId}/roles`, director.characterId),
				{
					onRetry: (attempt, error, delayMs) => {
						logger.warn('[DirectorManager] Retrying director health role check after ESI throttling', {
							corporationId: this.corporationId,
							directorId,
							characterId: director.characterId,
							attempt,
							delayMs,
							error: error.message,
						})
					},
				}
			)

			const roles = response.data
			const roleSet = this.buildEffectiveRoleSet(roles)
			const requiredRoleSets = options?.requiredRoleSets ?? FULL_SYNC_REQUIRED_ROLE_SETS
			const missingRoleSets = this.getMissingRoleSets(roleSet, requiredRoleSets)

			// Store roles in database
			await this.db
				.insert(characterCorporationRoles)
				.values({
					corporationId: this.corporationId,
					characterId: String(director.characterId),
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
					nextRetryAt: null,
					permanentFailureAt: null,
					updatedAt: new Date(),
				})
				.where(eq(corporationDirectors.id, directorId))

			if (missingRoleSets.length > 0) {
				const reason = `Director missing required roles: ${missingRoleSets
					.map((set) => `[${set.join('|')}]`)
					.join(', ')}`
				await this.recordFailure(directorId, reason, { forceUnhealthy: true })
				console.warn('[DirectorManager] Director missing required roles', {
					directorId,
					characterId: director.characterId,
					missingRoleSets,
				})
				return false
			}

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

		for (const director of directors) {
			if (this.shouldForcePermanentDueToStaleness(director)) {
				await this.db
					.update(corporationDirectors)
					.set({
						lastFailureReason: this.asPermanentFailureReason(
							`Token/director invalid state exceeded 7-day backstop (lastHealthyOrUpdatedAt=${(director.lastHealthCheck ?? director.updatedAt ?? new Date(0)).toISOString()})`
						),
						permanentFailureAt: new Date(),
						isHealthy: false,
						updatedAt: new Date(),
					})
					.where(eq(corporationDirectors.id, director.directorId))
			}
		}

		const now = Date.now()
		const nonPermanentDirectors = directors.filter((director) => {
			if (this.isPermanentlyFailed(director)) return false
			if (director.nextRetryAt && director.nextRetryAt.getTime() > now) return false
			return true
		})

		// Run all verifications in parallel
		const results = await Promise.allSettled(
			nonPermanentDirectors.map((director) => this.verifyDirectorHealth(director.directorId))
		)

		// Count verified vs failed
		let verified = 0
		let failed = 0

		for (const result of results) {
			if (result.status === 'fulfilled' && result.value === true) {
				verified++
			} else {
				failed++
			}
		}
		failed += directors.length - nonPermanentDirectors.length

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
