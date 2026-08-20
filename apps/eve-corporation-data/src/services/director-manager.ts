import { and, asc, eq, sql } from '@repo/db-utils'
import { withRpcResult } from '@repo/do-utils'
import { logger, toErrorLogDetails } from '@repo/hono-helpers'
import {
	classifyEsiCredentialFailure,
	parseEsiErrorMetadata,
	retryWithBackoff,
} from '@repo/workflow-utils'

import { characterCorporationRoles, corporationConfig, corporationDirectors } from '../db/schema'

import type {
	CharacterAffiliation,
	CharacterRoles,
	EsiRequestOptions,
	EsiResponse,
} from '@repo/esi'
import type { CorporationRole } from '@repo/eve-corporation-data'
import type { EveTokenStore, TokenValidationResult } from '@repo/eve-token-store'
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
const DIRECTOR_DEPENDENCY_FAILURE_PREFIX = 'Director dependency failure'
const INVALID_STALE_PERMANENT_MS = 7 * 24 * 60 * 60 * 1000
const TRANSIENT_DIRECTOR_COOLDOWN_MS = 10 * 60 * 1000
// A director check fans out through token-store, ESI, and the database. Keep
// those paths sequential within one corporation to avoid connection bursts.
const DIRECTOR_HEALTH_CHECK_CONCURRENCY = 1
const DIRECTOR_HEALTH_REQUEST_TIMEOUT_MS = 8_000
const DIRECTOR_HEALTH_REQUEST_MAX_RETRIES = 0

type DirectorRoleReader = (
	characterId: string,
	options: EsiRequestOptions
) => Promise<CharacterRoles>

type CharacterAffiliationReader = (
	characterIds: string[],
	options: EsiRequestOptions
) => Promise<CharacterAffiliation[]>

const FULL_SYNC_REQUIRED_ROLE_SETS: CorporationRole[][] = [
	['Director'],
	['Accountant', 'Junior_Accountant'],
	['Station_Manager'],
	['Accountant', 'Junior_Accountant', 'Trader'],
	['Factory_Manager'],
]

function describeTokenValidationFailure(validation: TokenValidationResult): string {
	if (validation.status === 'missing_scopes' && validation.missingScopes.length > 0) {
		return `Director permission failure: Director token is missing required ESI scopes: ${validation.missingScopes.join(', ')}`
	}

	if (validation.error) {
		return `Director token validation failed: ${validation.error}`
	}

	return `Director token validation failed: ${validation.status}`
}

function getErrorContext(error: unknown): Record<string, unknown> {
	const details = toErrorLogDetails(error)
	const root = error && typeof error === 'object' ? (error as Record<string, unknown>) : {}
	const cause = root.cause && typeof root.cause === 'object' ? root.cause : null
	const causeRecord = cause as Record<string, unknown> | null
	const query =
		typeof root.query === 'string' ? root.query.replace(/\s+/g, ' ').slice(0, 2_000) : undefined
	const values = {
		error: details.message,
		errorName: details.name,
		errorStack: details.stack,
		errorCause: details.cause,
		errorCode: root.code ?? causeRecord?.code,
		errorDetail: root.detail ?? causeRecord?.detail,
		errorHint: root.hint ?? causeRecord?.hint,
		errorSeverity: root.severity ?? causeRecord?.severity,
		errorPosition: root.position ?? causeRecord?.position,
		errorQuery: query,
		errorParamsCount: Array.isArray(root.params) ? root.params.length : undefined,
		causeName: causeRecord?.name,
		causeMessage: causeRecord?.message,
		causeStack: causeRecord?.stack,
		causeCode: causeRecord?.code,
		causeDetail: causeRecord?.detail,
		causeHint: causeRecord?.hint,
		causeSeverity: causeRecord?.severity,
	}

	return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

async function settleInBatches<T, R>(
	items: T[],
	operation: (item: T) => Promise<R>,
	concurrency: number,
	deadlineMs?: number
): Promise<{ results: Array<PromiseSettledResult<R>>; skippedCount: number }> {
	const results: Array<PromiseSettledResult<R>> = []
	let skippedCount = 0

	for (let index = 0; index < items.length; index += concurrency) {
		if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
			skippedCount = items.length - index
			break
		}
		const batch = items.slice(index, index + concurrency)
		results.push(...(await Promise.allSettled(batch.map(operation))))
	}

	return { results, skippedCount }
}

function compareDirectorVerificationStaleness(a: DirectorHealth, b: DirectorHealth): number {
	// A director that has never completed a health check must be considered
	// staler than one with any recorded check, regardless of configured priority.
	const aHasHealthCheck = a.lastHealthCheck !== null
	const bHasHealthCheck = b.lastHealthCheck !== null
	if (aHasHealthCheck !== bHasHealthCheck) return aHasHealthCheck ? 1 : -1

	const aHealthCheck = a.lastHealthCheck?.getTime() ?? Number.NEGATIVE_INFINITY
	const bHealthCheck = b.lastHealthCheck?.getTime() ?? Number.NEGATIVE_INFINITY
	const aUpdatedAt = a.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY
	const bUpdatedAt = b.updatedAt?.getTime() ?? Number.NEGATIVE_INFINITY
	const aLastAttempt = Math.max(aHealthCheck, aUpdatedAt)
	const bLastAttempt = Math.max(bHealthCheck, bUpdatedAt)
	if (aLastAttempt !== bLastAttempt) return aLastAttempt - bLastAttempt

	return a.priority - b.priority || a.directorId.localeCompare(b.directorId)
}

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
		) => Promise<void>,
		private readonly onHealthSnapshotChanged?: (params: {
			corporationId: string
			healthyDirectorCount: number
			isVerified: boolean
		}) => Promise<void>,
		private readonly fetchCharacterRoles: DirectorRoleReader = async () => {
			throw new Error('DirectorManager requires a typed ESI character roles reader')
		},
		private readonly fetchCharacterAffiliations: CharacterAffiliationReader = async () => {
			throw new Error('DirectorManager requires a typed ESI character affiliation reader')
		}
	) {}

	private deferHealthSnapshot = false

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
		await this.syncHealthSnapshot()
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
	async selectDirector(options?: {
		requiredRoleSets?: CorporationRole[][]
	}): Promise<SelectedDirector | null> {
		try {
			const now = Date.now()
			const healthyDirectors = (await this.getHealthyDirectors()).filter(
				(director) => !director.nextRetryAt || director.nextRetryAt.getTime() <= now
			)

			if (healthyDirectors.length === 0) {
				logger.error('[DirectorManager] No healthy directors available', {
					corporationId: this.corporationId,
				})
				return null
			}

			// Round-robin candidate order is already sorted by priority, then lastUsed (nulls first).
			// Validate token presence/freshness before returning a director so authenticated workflow
			// steps do not run with a director that cannot produce credentials.
			for (const candidate of healthyDirectors) {
				try {
					const tokenInfo = await withRpcResult(
						this.tokenStore.getTokenInfo(candidate.characterId),
						(info) => (info ? { ...info } : null)
					)
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
						const refreshResult = await withRpcResult(
							this.tokenStore.refreshTokenWithResult(candidate.characterId),
							(result) => ({ ...result })
						)
						if (!refreshResult.success) {
							const reason =
								refreshResult.status === 'transient_error'
									? `Director token refresh transient failure: ${refreshResult.error ?? 'unknown'}`
									: (refreshResult.error ?? 'Director token expired and refresh failed')
							await this.safeRecordFailure(
								candidate.directorId,
								reason,
								refreshResult.status === 'transient_error' ? undefined : { forceUnhealthy: true }
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
						const requiredRoleSets = options.requiredRoleSets
						const missingRoleSets = await retryWithBackoff(
							() =>
								this.fetchCharacterRoles(candidate.characterId, {
									cacheMode: 'no-store',
									maxRetries: DIRECTOR_HEALTH_REQUEST_MAX_RETRIES,
									timeoutMs: DIRECTOR_HEALTH_REQUEST_TIMEOUT_MS,
								}),
							{
								maxRetries: DIRECTOR_HEALTH_REQUEST_MAX_RETRIES,
								onRetry: (attempt, error, delayMs) => {
									logger.warn(
										'[DirectorManager] Retrying director role lookup after ESI throttling',
										{
											corporationId: this.corporationId,
											directorId: candidate.directorId,
											characterId: candidate.characterId,
											attempt,
											delayMs,
											error: error.message,
										}
									)
								},
							}
						)
						const roleSet = this.buildEffectiveRoleSet(missingRoleSets)
						const missingRequiredRoleSets = this.getMissingRoleSets(roleSet, requiredRoleSets)
						if (missingRequiredRoleSets.length > 0) {
							await this.safeRecordFailure(
								candidate.directorId,
								`Director permission failure: Director missing required roles for selection: ${missingRequiredRoleSets.map((set) => `[${set.join('|')}]`).join(', ')}`,
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
					const reason = classifyEsiCredentialFailure(error)
						? this.buildDirectorCredentialFailureReason('select-director', error)
						: this.isDirectorLookupNotFoundFailure(error)
							? this.buildDirectorLookupFailureReason('select-director', error)
							: this.buildDirectorDependencyFailureReason('select-director', error)
					await this.safeRecordFailure(candidate.directorId, reason)
				}
			}

			logger.error('[DirectorManager] No directors with valid tokens available', {
				corporationId: this.corporationId,
				candidatesChecked: healthyDirectors.length,
			})
			return null
		} catch (error) {
			logger.error(
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
			logger.error('[DirectorManager] Failed to update director lastUsed on selection', {
				corporationId: this.corporationId,
				directorId,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private async checkAffiliation(
		characterId: string
	): Promise<{ matches: boolean; corporationId: string | null }> {
		if (!characterId) {
			return { matches: false, corporationId: null }
		}

		let affiliations: CharacterAffiliation[]
		try {
			affiliations = await retryWithBackoff<CharacterAffiliation[]>(
				() =>
					this.fetchCharacterAffiliations([characterId], {
						cacheMode: 'no-store',
						maxRetries: DIRECTOR_HEALTH_REQUEST_MAX_RETRIES,
						timeoutMs: DIRECTOR_HEALTH_REQUEST_TIMEOUT_MS,
					}),
				{
					maxRetries: DIRECTOR_HEALTH_REQUEST_MAX_RETRIES,
					onRetry: (attempt, error, delayMs) => {
						logger.warn(
							'[DirectorManager] Retrying character affiliation lookup after ESI throttling',
							{
								corporationId: this.corporationId,
								characterId,
								attempt,
								delayMs,
								error: error.message,
							}
						)
					},
				}
			)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const metadata = error instanceof Error ? parseEsiErrorMetadata(error.message) : null
			if (metadata?.status === 404) {
				throw new Error(`Director affiliation lookup returned 404 for character ${characterId}`)
			}
			throw new Error(`Director affiliation lookup failed for character ${characterId}: ${message}`)
		}

		if (!Array.isArray(affiliations) || affiliations.length === 0) {
			throw new Error(
				`Director affiliation lookup returned no affiliations for character ${characterId}`
			)
		}
		const affiliation = affiliations.find((entry) => String(entry.character_id) === characterId)
		if (!affiliation) {
			throw new Error(`Director affiliation lookup did not include character ${characterId}`)
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
		context: 'select-director' | 'verify-director-health' | 'verify-all-permanent-affiliation'
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
				logger.error('[DirectorManager] Affiliation mismatch callback failed', {
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
			logger.warn('[DirectorManager] Auto-pruned director due to affiliation mismatch', {
				corporationId: this.corporationId,
				directorId: params.directorId,
				characterId: params.characterId,
				actualCorporationId: params.actualCorporationId,
				context: params.context,
			})
		} catch (error) {
			logger.error('[DirectorManager] Failed to auto-prune mismatched director', {
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
				logger.error('[DirectorManager] Director pruned callback failed', {
					corporationId: this.corporationId,
					characterId: params.characterId,
					context: params.context,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
	}

	private buildEffectiveRoleSet(roles: CharacterRoles): Set<string> {
		return new Set([
			...(roles.roles || []),
			...(roles.roles_at_hq || []),
			...(roles.roles_at_base || []),
			...(roles.roles_at_other || []),
		])
	}

	private satisfiesAnyRequiredRoles(roleSet: Set<string>, anyOf: CorporationRole[]): boolean {
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
			if (options) {
				await this.recordFailure(directorId, reason, options)
			} else {
				await this.recordFailure(directorId, reason)
			}
		} catch (error) {
			logger.error('[DirectorManager] Failed to record director failure', {
				corporationId: this.corporationId,
				directorId,
				reason,
				...getErrorContext(error),
			})
		}
	}

	private async syncHealthSnapshot(): Promise<void> {
		if (!this.onHealthSnapshotChanged || this.deferHealthSnapshot) {
			return
		}

		let healthyDirectorCount: number
		try {
			healthyDirectorCount = await this.getHealthyDirectorsCount()
		} catch (error) {
			logger.error('[DirectorManager] Failed to count healthy directors for auth snapshot', {
				corporationId: this.corporationId,
				...getErrorContext(error),
			})
			return
		}

		try {
			await this.onHealthSnapshotChanged({
				corporationId: this.corporationId,
				healthyDirectorCount,
				isVerified: healthyDirectorCount > 0,
			})
		} catch (error) {
			logger.error('[DirectorManager] Failed to propagate corp auth health snapshot', {
				corporationId: this.corporationId,
				healthyDirectorCount,
				...getErrorContext(error),
			})
		}
	}

	private async verifyPermanentDirectorAffiliation(directorId: string): Promise<void> {
		const director = await this.db.query.corporationDirectors.findFirst({
			where: eq(corporationDirectors.id, directorId),
		})

		if (!director) {
			return
		}

		try {
			const affiliationCheck = await this.checkAffiliation(String(director.characterId))
			if (!affiliationCheck.matches) {
				await this.handleAffiliationMismatch({
					directorId,
					characterId: String(director.characterId),
					actualCorporationId: affiliationCheck.corporationId,
					context: 'verify-all-permanent-affiliation',
				})
				return
			}
		} catch {
			return
		}
	}

	private buildDirectorCredentialFailureReason(
		stepName: string,
		error: unknown,
		requiredRoles?: CorporationRole[]
	): string {
		const rawMessage = error instanceof Error ? error.message : String(error)
		const metadata = error instanceof Error ? parseEsiErrorMetadata(error.message) : null
		const credentialFailureKind = classifyEsiCredentialFailure(error)
		const metadataStatus = typeof metadata?.status === 'number' ? metadata.status : null
		const status = metadataStatus ?? (credentialFailureKind === 'permission' ? 403 : 401)
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
			if (status === 404) {
				return 'lookup_not_found'
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
			if (status === 404) {
				return 'lookup_not_found'
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
			roleHint && requiredRoles && requiredRoles.length > 0
				? `missingRoles=unknown_from_esi`
				: null,
		].filter((part): part is string => Boolean(part))
		const failureLabel =
			credentialFailureKind === 'permission'
				? 'Director permission failure'
				: 'Director authentication failure'
		return `${failureLabel} (${parts.join(', ')})`
	}

	private isDirectorLookupNotFoundFailure(error: unknown): boolean {
		if (!(error instanceof Error)) return false
		const metadata = parseEsiErrorMetadata(error.message)
		if (metadata?.status !== 404) return false
		return /ESI request failed:|Director affiliation lookup/i.test(error.message)
	}

	private buildDirectorLookupFailureReason(stepName: string, error: unknown): string {
		const rawMessage = error instanceof Error ? error.message : String(error)
		return `Director lookup failure (step=${stepName}, reasonCode=lookup_not_found): ${rawMessage}`
	}

	private buildDirectorDependencyFailureReason(stepName: string, error: unknown): string {
		const rawMessage = error instanceof Error ? error.message : String(error)
		return `${DIRECTOR_DEPENDENCY_FAILURE_PREFIX} (${stepName}): ${rawMessage}`
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
		if (lower.includes('token refresh transient failure')) return true
		if (lower.includes(DIRECTOR_DEPENDENCY_FAILURE_PREFIX.toLowerCase())) return true

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
		return (
			Boolean(director.permanentFailureAt) ||
			this.isPermanentFailureReason(director.lastFailureReason)
		)
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
		if (director.lastFailureReason && this.isTransientEsiFailure(director.lastFailureReason))
			return false
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
			await this.syncHealthSnapshot()
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
			logger.error('[DirectorManager] Director marked as unhealthy', {
				directorId,
				characterId: director.characterId,
				failureCount: newFailureCount,
				reason: normalizedReason,
			})
			try {
				await this.db
					.delete(characterCorporationRoles)
					.where(
						and(
							eq(characterCorporationRoles.corporationId, this.corporationId),
							eq(characterCorporationRoles.characterId, director.characterId)
						)
					)
			} catch (error) {
				logger.warn(
					'[DirectorManager] Failed to clear stale director role cache after unhealthy transition',
					{
						corporationId: this.corporationId,
						directorId,
						characterId: director.characterId,
						error: error instanceof Error ? error.message : String(error),
					}
				)
			}
			await this.syncHealthSnapshot()
		}

		// Check if all directors are now unhealthy
		const healthyCount = await this.getHealthyDirectorsCount()
		if (healthyCount === 0) {
			logger.error('[DirectorManager] ALL DIRECTORS UNHEALTHY - CRITICAL', {
				corporationId: this.corporationId,
			})
			// TODO: Trigger notification/alert here
		}
	}

	/**
	 * Get count of healthy directors
	 */
	async getHealthyDirectorsCount(): Promise<number> {
		const [result] = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(corporationDirectors)
			.where(
				and(
					eq(corporationDirectors.corporationId, this.corporationId),
					eq(corporationDirectors.isHealthy, true)
				)
			)

		return result?.count ?? 0
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

		let verificationPhase = 'token-validation'
		try {
			const tokenValidation = await withRpcResult(
				this.tokenStore.validateToken(String(director.characterId)),
				(result) => ({
					...result,
					missingScopes: result.missingScopes ? [...result.missingScopes] : result.missingScopes,
				})
			)
			if (!tokenValidation.isValid) {
				if (tokenValidation.status === 'transient_error') {
					await this.recordFailure(
						directorId,
						`Director token refresh transient failure: ${tokenValidation.error ?? 'unknown'}`
					)
					logger.warn('[DirectorManager] Director token validation failed', {
						corporationId: this.corporationId,
						directorId,
						characterId: director.characterId,
						status: tokenValidation.status,
						missingScopes: tokenValidation.missingScopes,
					})
					return false
				}
				const reason = describeTokenValidationFailure(tokenValidation)
				await this.recordFailure(directorId, reason, { forceUnhealthy: true })
				logger.warn('[DirectorManager] Director token validation failed', {
					corporationId: this.corporationId,
					directorId,
					characterId: director.characterId,
					status: tokenValidation.status,
					missingScopes: tokenValidation.missingScopes,
				})
				return false
			}

			verificationPhase = 'affiliation-check'
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
			verificationPhase = 'roles-fetch'
			const roles = await retryWithBackoff(
				() =>
					this.fetchCharacterRoles(String(director.characterId), {
						cacheMode: 'no-store',
						maxRetries: DIRECTOR_HEALTH_REQUEST_MAX_RETRIES,
						timeoutMs: DIRECTOR_HEALTH_REQUEST_TIMEOUT_MS,
					}),
				{
					maxRetries: DIRECTOR_HEALTH_REQUEST_MAX_RETRIES,
					onRetry: (attempt, error, delayMs) => {
						logger.warn(
							'[DirectorManager] Retrying director health role check after ESI throttling',
							{
								corporationId: this.corporationId,
								directorId,
								characterId: director.characterId,
								attempt,
								delayMs,
								error: error.message,
							}
						)
					},
				}
			)
			const roleSet = this.buildEffectiveRoleSet(roles)
			const requiredRoleSets = options?.requiredRoleSets ?? FULL_SYNC_REQUIRED_ROLE_SETS

			verificationPhase = 'roles-persistence'
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

			verificationPhase = 'health-state-persistence'
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

			verificationPhase = 'health-snapshot'
			await this.syncHealthSnapshot()

			const missingRoleSets = this.getMissingRoleSets(roleSet, requiredRoleSets)
			if (missingRoleSets.length > 0) {
				const reason = `Director permission failure: Director missing required roles: ${missingRoleSets
					.map((set) => `[${set.join('|')}]`)
					.join(', ')}`
				await this.recordFailure(directorId, reason, { forceUnhealthy: true })
				logger.warn('[DirectorManager] Director missing required roles', {
					directorId,
					characterId: director.characterId,
					missingRoleSets,
				})
				return false
			}

			return true
		} catch (error) {
			logger.error('[DirectorManager] Director health verification failed', {
				corporationId: this.corporationId,
				directorId,
				characterId: director.characterId,
				phase: verificationPhase,
				...getErrorContext(error),
			})

			const failureReason = classifyEsiCredentialFailure(error)
				? this.buildDirectorCredentialFailureReason('verify-director-health', error)
				: this.isDirectorLookupNotFoundFailure(error)
					? this.buildDirectorLookupFailureReason('verify-director-health', error)
					: this.buildDirectorDependencyFailureReason('verify-director-health', error)
			await this.safeRecordFailure(directorId, failureReason)
			return false
		}
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(options?: {
		includePermanent?: boolean
		bypassPermanentFailures?: boolean
		maxDurationMs?: number
	}): Promise<{ verified: number; failed: number }> {
		const directors = await this.getAllDirectors()
		const now = Date.now()
		const includePermanent = options?.includePermanent ?? false
		const bypassPermanentFailures = options?.bypassPermanentFailures ?? false

		const activeDirectors = directors.filter((director) => {
			if (!includePermanent && this.isPermanentlyFailed(director)) return false
			if (director.nextRetryAt && director.nextRetryAt.getTime() > now) return false
			return true
		})

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

		const nonPermanentDirectors = [...activeDirectors].sort(compareDirectorVerificationStaleness)
		const permanentDirectorsToAffiliationCheck =
			!includePermanent && bypassPermanentFailures
				? directors
						.filter(
							(director) =>
								this.isPermanentlyFailed(director) &&
								!(director.nextRetryAt && director.nextRetryAt.getTime() > now)
						)
						.sort(compareDirectorVerificationStaleness)
				: []

		const deadlineMs =
			options?.maxDurationMs !== undefined
				? Date.now() + Math.max(0, options.maxDurationMs)
				: undefined
		let results: Array<PromiseSettledResult<boolean>>
		let skippedCount = 0
		this.deferHealthSnapshot = true
		try {
			const verification = await settleInBatches(
				nonPermanentDirectors,
				async (director) => await this.verifyDirectorHealth(director.directorId),
				DIRECTOR_HEALTH_CHECK_CONCURRENCY,
				deadlineMs
			)
			results = verification.results
			skippedCount += verification.skippedCount

			if (permanentDirectorsToAffiliationCheck.length > 0) {
				const affiliationVerification = await settleInBatches(
					permanentDirectorsToAffiliationCheck,
					async (director) => {
						await this.verifyPermanentDirectorAffiliation(director.directorId)
						return true
					},
					DIRECTOR_HEALTH_CHECK_CONCURRENCY,
					deadlineMs
				)
				skippedCount += affiliationVerification.skippedCount
			}
		} finally {
			this.deferHealthSnapshot = false
		}
		if (skippedCount > 0) {
			logger.warn('[DirectorManager] Director health verification budget exhausted', {
				corporationId: this.corporationId,
				skippedCount,
				maxDurationMs: options?.maxDurationMs,
			})
		}
		await this.syncHealthSnapshot()

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
		failed = directors.length - verified

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
				const result = await operation(director.characterId)

				// Success! Record it and return
				await this.recordSuccess(director.directorId)
				return result
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error))
				logger.error('[DirectorManager] ESI request failed with director', {
					directorId: director.directorId,
					characterId: director.characterId,
					error: lastError.message,
				})

				// Preserve director health for dependency failures; only ESI auth failures
				// should be eligible for permanent director failover.
				const failureReason = classifyEsiCredentialFailure(lastError)
					? this.buildDirectorCredentialFailureReason('execute-with-failover', lastError)
					: this.isDirectorLookupNotFoundFailure(lastError)
						? this.buildDirectorLookupFailureReason('execute-with-failover', lastError)
						: this.buildDirectorDependencyFailureReason('execute-with-failover', lastError)
				await this.recordFailure(director.directorId, failureReason)

				// Continue to next director
			}
		}

		// All directors failed
		throw new Error(
			`All directors failed ESI request. Last error: ${lastError?.message || 'Unknown error'}`
		)
	}
}
