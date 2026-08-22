import { eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'
import { createWorkflow } from '@repo/workflow-utils'

import { users } from '../db/schema'
import { isMumbleFeatureEnabled } from './mumble-feature'

import type { Env } from '../context'
import type { createDb } from '../db'
import type { DirectorHealthRecheckWorkflowParams } from '../workflows/director-health-recheck.workflow'
import type { UserDiscordRefreshWorkflowParams } from '../workflows/user-discord-refresh.workflow'
import type { UserMumbleRefreshWorkflowParams } from '../workflows/user-mumble-refresh.workflow'

const THROTTLE_MS = 5 * 60 * 1000 // 5 minutes
const DIRECTOR_HEALTH_RECHECK_WINDOW_MS = 5 * 60 * 1000

export function createDirectorHealthRecheckWorkflowId(
	characterId: string,
	corporationId: string,
	now = Date.now()
): string {
	const windowToken = Math.floor(now / DIRECTOR_HEALTH_RECHECK_WINDOW_MS).toString(36)
	return `director-health-recheck-${characterId}-${corporationId}-${windowToken}`
}

export interface TriggerDirectorHealthRecheckOptions {
	env: Env
	characterId: string
	characterName: string
	corporationId: string
	source: string
}

/**
 * Queue the post-authentication director verification outside the request.
 * The caller resolves the character's current corporation before enqueueing, so
 * the workflow does not fan out across unrelated corporation Durable Objects.
 */
export async function triggerDirectorHealthRecheckWorkflow({
	env,
	characterId,
	characterName,
	corporationId,
	source,
}: TriggerDirectorHealthRecheckOptions): Promise<void> {
	try {
		const params: DirectorHealthRecheckWorkflowParams = {
			characterId,
			characterName,
			corporationId,
			source,
		}
		const instance = await createWorkflow(env.DIRECTOR_HEALTH_RECHECK_WORKFLOW, {
			id: createDirectorHealthRecheckWorkflowId(characterId, corporationId),
			params,
		})

		logger.info('[WorkflowTrigger] Triggered director health recheck workflow', {
			characterId,
			characterName,
			source,
			workflowInstanceId: instance.id,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		if (/already exists|already been created|duplicate/i.test(errorMessage)) {
			logger.info('[WorkflowTrigger] Deduplicated director health recheck workflow', {
				characterId,
				corporationId,
				source,
			})
			return
		}
		logger.error('[WorkflowTrigger] Failed to trigger director health recheck workflow', {
			characterId,
			characterName,
			source,
			error: errorMessage,
		})
	}
}

export interface TriggerUserRefreshOptions {
	db: ReturnType<typeof createDb>
	env: Env
	userId: string
	source: string
	bypassThrottle?: boolean
	refreshMode?: 'scheduled' | 'event' | 'manual'
	suppressDiscordRefresh?: boolean
	forceTokenValidation?: boolean
	includeWalletJournal?: boolean
}

export interface TriggerUserRefreshResult {
	status: 'triggered' | 'throttled' | 'failed'
	triggered: boolean
	workflowInstanceId?: string
	error?: string
}

export function createUserRefreshWorkflowId(
	source: string,
	userId: string,
	now = Date.now(),
	deduplicate = true
): string {
	const normalizedSource = source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	const sourceToken = (normalizedSource || 'unknown').slice(0, 16)
	const userToken = userId.replace(/-/g, '').slice(0, 12)
	const timeToken = deduplicate ? Math.floor(now / THROTTLE_MS).toString(36) : now.toString(36)
	return `user-refresh-${sourceToken}-${userToken}-${timeToken}`
}

export interface TriggerDiscordRefreshOptions {
	env: Env
	userId: string
	/** Source identifier for observability (e.g. 'group-joined', 'group-left', 'admin-manual') */
	source: string
	/** Whether Discord role removal is permitted. False for join/add events, true for leave/remove events. */
	allowRemoval?: boolean
	/** Whether this refresh should hard-strip all roles on managed guilds. */
	hardStripAllRoles?: boolean
	/** Optional jitter delay (seconds) to stagger batch runs. Passed through to the workflow's sleep step. */
	jitterDelaySeconds?: number
}

export interface TriggerDiscordRefreshResult {
	status: 'triggered' | 'failed'
	triggered: boolean
	workflowInstanceId?: string
	error?: string
}

export function createDiscordRefreshWorkflowId(source: string, userId: string): string {
	const normalizedSource = source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	const sourceToken = (normalizedSource || 'unknown').slice(0, 20)
	// Keep the complete user identifier in the instance ID so status routes can
	// verify ownership without relying on a truncated prefix.
	const userToken = userId.replace(/-/g, '')
	const timeToken = Date.now().toString(36)
	return `discord-refresh-${sourceToken}-${userToken}-${timeToken}`
}

/**
 * Trigger a Discord refresh workflow for a single user.
 * Returns immediately — does not block on workflow creation.
 * Logs errors but does not throw.
 */
export async function triggerDiscordRefreshWorkflow({
	env,
	userId,
	source,
	allowRemoval = false,
	hardStripAllRoles = false,
	jitterDelaySeconds,
}: TriggerDiscordRefreshOptions): Promise<TriggerDiscordRefreshResult> {
	try {
		const params: UserDiscordRefreshWorkflowParams = {
			userId,
			source,
			allowRemoval,
			hardStripAllRoles,
			jitterDelaySeconds,
		}
		const instance = await createWorkflow(env.USER_DISCORD_REFRESH_WORKFLOW, {
			id: createDiscordRefreshWorkflowId(source, userId),
			params,
		})

		logger.info('[WorkflowTrigger] Triggered Discord refresh workflow', {
			userId,
			source,
			allowRemoval,
			hardStripAllRoles,
			workflowInstanceId: instance.id,
		})
		return {
			status: 'triggered',
			triggered: true,
			workflowInstanceId: instance.id,
		}
	} catch (error) {
		logger.error('[WorkflowTrigger] Failed to trigger Discord refresh workflow', {
			userId,
			source,
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			status: 'failed',
			triggered: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export interface TriggerMumbleRefreshOptions {
	env: Env
	/** Users whose Mumble groups should be re-pushed (1 for events, N for bulk changes) */
	userIds: string[]
	/** Source identifier for observability (e.g. 'group-joined', 'group-left', 'group-deleted') */
	source: string
	/** Optional jitter delay (seconds) to stagger batch runs. Passed through to the workflow's sleep step. */
	jitterDelaySeconds?: number
}

export interface TriggerMumbleRefreshResult {
	status: 'triggered' | 'failed' | 'skipped'
	triggered: boolean
	workflowInstanceId?: string
	error?: string
}

export function createMumbleRefreshWorkflowId(source: string, userIds: string[]): string {
	const normalizedSource = source
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
	const sourceToken = (normalizedSource || 'unknown').slice(0, 20)
	const userToken =
		userIds.length === 1
			? (userIds[0]?.replace(/-/g, '').slice(0, 12) ?? 'unknown')
			: `batch${userIds.length}`
	const timeToken = Date.now().toString(36)
	return `mumble-refresh-${sourceToken}-${userToken}-${timeToken}`
}

/**
 * Trigger a Mumble group refresh workflow for one or more users.
 * Returns immediately — does not block on workflow creation.
 * Logs errors but does not throw.
 */
export async function triggerMumbleRefreshWorkflow({
	env,
	userIds,
	source,
	jitterDelaySeconds,
}: TriggerMumbleRefreshOptions): Promise<TriggerMumbleRefreshResult> {
	try {
		if (!(await isMumbleFeatureEnabled(env))) {
			logger.info('[WorkflowTrigger] Skipped Mumble refresh workflow because feature is disabled', {
				userIds,
				source,
			})
			return {
				status: 'skipped',
				triggered: false,
			}
		}

		const params: UserMumbleRefreshWorkflowParams = {
			userIds,
			source,
			jitterDelaySeconds,
		}
		const instance = await createWorkflow(env.USER_MUMBLE_REFRESH_WORKFLOW, {
			id: createMumbleRefreshWorkflowId(source, userIds),
			params,
		})

		logger.info('[WorkflowTrigger] Triggered Mumble refresh workflow', {
			userIds,
			source,
			workflowInstanceId: instance.id,
		})
		return {
			status: 'triggered',
			triggered: true,
			workflowInstanceId: instance.id,
		}
	} catch (error) {
		logger.error('[WorkflowTrigger] Failed to trigger Mumble refresh workflow', {
			userIds,
			source,
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			status: 'failed',
			triggered: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

/**
 * Trigger user refresh workflow with throttling.
 * Resolves after the workflow has been created (or the trigger has failed).
 * Logs errors but does not throw, so callers can safely await the short enqueue operation.
 */
export async function triggerUserRefreshWorkflow({
	db,
	env,
	userId,
	source,
	bypassThrottle = false,
	refreshMode = 'scheduled',
	suppressDiscordRefresh = false,
	forceTokenValidation = false,
	includeWalletJournal = false,
}: TriggerUserRefreshOptions): Promise<TriggerUserRefreshResult> {
	try {
		const userRecord = await db.query.users.findFirst({
			where: eq(users.id, userId),
			columns: { lastRefreshWorkflowAttempt: true },
		})

		const shouldTrigger =
			bypassThrottle ||
			!userRecord?.lastRefreshWorkflowAttempt ||
			Date.now() - userRecord.lastRefreshWorkflowAttempt.getTime() > THROTTLE_MS

		if (!shouldTrigger) {
			return { status: 'throttled', triggered: false }
		}

		const now = Date.now()
		const workflowId = createUserRefreshWorkflowId(source, userId, now, !bypassThrottle)
		let instance: { id: string }
		try {
			instance = await createWorkflow(env.USER_REFRESH_WORKFLOW, {
				id: workflowId,
				params: {
					userId,
					source,
					refreshMode,
					suppressDiscordRefresh,
					forceTokenValidation,
					includeWalletJournal,
				},
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			if (!/already exists|already been created|duplicate/i.test(errorMessage)) {
				throw error
			}

			// A normal trigger may race another request in the same throttle
			// window. The deterministic workflow ID makes that race harmless.
			await db
				.update(users)
				.set({ lastRefreshWorkflowAttempt: new Date(now) })
				.where(eq(users.id, userId))
			logger.info('[WorkflowTrigger] Deduplicated user refresh workflow', {
				userId,
				source,
				workflowInstanceId: workflowId,
			})
			return { status: 'throttled', triggered: false }
		}

		// Commit the throttle watermark only after the workflow service accepts
		// the instance. A failed enqueue must remain retryable.
		await db
			.update(users)
			.set({ lastRefreshWorkflowAttempt: new Date(now) })
			.where(eq(users.id, userId))

		logger.info('[WorkflowTrigger] Triggered user refresh workflow', {
			userId,
			source,
			bypassThrottle,
			refreshMode,
			suppressDiscordRefresh,
			forceTokenValidation,
			includeWalletJournal,
			workflowInstanceId: instance.id,
		})
		return {
			status: 'triggered',
			triggered: true,
			workflowInstanceId: instance.id,
		}
	} catch (error) {
		logger.error('[WorkflowTrigger] Failed to trigger user refresh workflow', {
			userId,
			source,
			error: error instanceof Error ? error.message : String(error),
		})
		return {
			status: 'failed',
			triggered: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
