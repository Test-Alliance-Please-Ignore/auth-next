import { DurableObject } from 'cloudflare:workers'

import { createWorkflow } from '@repo/workflow-utils'

import type {
	RecentLossRefreshCharacterInput,
	RecentLossRefreshCoordinator,
	RecentLossRefreshStartResult,
	RecentLossRefreshStatusRecord,
	RecentLossRefreshStatusResponse,
} from '@repo/srp'
import type { Env } from './context'

export class RecentLossRefreshCoordinatorDO
	extends DurableObject<Env>
	implements RecentLossRefreshCoordinator
{
	private static readonly COOLDOWN_MS = 15 * 60 * 1000
	private static readonly STATUS_RETENTION_MS = 60 * 60 * 1000
	private static readonly STATUS_ALARM_RECHECK_MS = 5 * 60 * 1000
	// A character refresh can spend several minutes in retry backoff. Only use this
	// fallback when the workflow instance cannot be inspected, so a slow refresh is
	// not mistaken for a dead one.
	private static readonly ACTIVE_STATUS_STALE_MS = 60 * 60 * 1000
	private static readonly COOLDOWN_KEY_PREFIX = 'recent-loss-refresh:'
	private static readonly STATUS_KEY_PREFIX = 'recent-loss-refresh-status:'

	private buildCooldownKey(userId: string): string {
		return `${RecentLossRefreshCoordinatorDO.COOLDOWN_KEY_PREFIX}${userId}`
	}

	private buildStatusKey(userId: string): string {
		return `${RecentLossRefreshCoordinatorDO.STATUS_KEY_PREFIX}${userId}`
	}

	private getCooldownUntilMs(lastTriggeredAtMs: number): number {
		return lastTriggeredAtMs + RecentLossRefreshCoordinatorDO.COOLDOWN_MS
	}

	private getStatusActivityMs(status: RecentLossRefreshStatusRecord): number {
		const timestamps = [status.queuedAt, status.startedAt, status.updatedAt]
			.map((timestamp) => (timestamp ? Date.parse(timestamp) : Number.NaN))
			.filter((timestamp) => Number.isFinite(timestamp))
		return timestamps.length > 0 ? Math.max(...timestamps) : 0
	}

	private getStatusCleanupAtMs(status: RecentLossRefreshStatusRecord, now: number): number | null {
		if (status.status === 'completed' || status.status === 'failed') {
			const completedAtMs = status.completedAt ? Date.parse(status.completedAt) : Number.NaN
			return Number.isFinite(completedAtMs)
				? completedAtMs + RecentLossRefreshCoordinatorDO.STATUS_RETENTION_MS
				: now
		}

		if (status.status !== 'queued' && status.status !== 'running') return null
		const lastActivityMs = this.getStatusActivityMs(status)
		if (lastActivityMs === 0) return now + RecentLossRefreshCoordinatorDO.STATUS_ALARM_RECHECK_MS

		const staleAtMs = lastActivityMs + RecentLossRefreshCoordinatorDO.ACTIVE_STATUS_STALE_MS
		return staleAtMs > now
			? staleAtMs
			: now + RecentLossRefreshCoordinatorDO.STATUS_ALARM_RECHECK_MS
	}

	private async markWorkflowFailed(
		userId: string,
		status: RecentLossRefreshStatusRecord,
		message: string
	): Promise<RecentLossRefreshStatusRecord> {
		const now = new Date().toISOString()
		const failedStatus: RecentLossRefreshStatusRecord = {
			...status,
			status: 'failed',
			updatedAt: now,
			completedAt: now,
			currentCharacterId: undefined,
			currentCharacterName: undefined,
			lastError: message,
		}
		await this.ctx.storage.put(this.buildStatusKey(userId), failedStatus)
		return failedStatus
	}

	private async clearStaleWorkflowStatus(
		userId: string,
		status: RecentLossRefreshStatusRecord,
		message: string
	): Promise<RecentLossRefreshStatusRecord> {
		const failedStatus = {
			...status,
			status: 'failed' as const,
			updatedAt: new Date().toISOString(),
			completedAt: new Date().toISOString(),
			currentCharacterId: undefined,
			currentCharacterName: undefined,
			lastError: message,
		}
		await this.ctx.storage.delete(this.buildStatusKey(userId))
		await this.rescheduleCleanup()
		return failedStatus
	}

	private async reconcileActiveStatus(
		userId: string,
		status: RecentLossRefreshStatusRecord
	): Promise<RecentLossRefreshStatusRecord> {
		if (status.status !== 'queued' && status.status !== 'running') return status

		try {
			const workflowInstance = await this.env.SRP_RECENT_LOSS_REFRESH_WORKFLOW.get(
				status.workflowInstanceId
			)
			const workflowStatus = await workflowInstance.status()

			switch (workflowStatus.status) {
				case 'complete': {
					const completedAt = new Date().toISOString()
					const completedStatus: RecentLossRefreshStatusRecord = {
						...status,
						status: 'completed',
						updatedAt: completedAt,
						completedAt,
						currentCharacterId: undefined,
						currentCharacterName: undefined,
					}
					await this.ctx.storage.put(this.buildStatusKey(userId), completedStatus)
					return completedStatus
				}
				case 'errored':
				case 'terminated':
				case 'unknown':
					return this.markWorkflowFailed(
						userId,
						status,
						`Recent loss refresh workflow ended with status "${workflowStatus.status}".`
					)
				default:
					return status
			}
		} catch {
			const lastActivityMs = this.getStatusActivityMs(status)
			if (
				lastActivityMs === 0 ||
				Date.now() - lastActivityMs <= RecentLossRefreshCoordinatorDO.ACTIVE_STATUS_STALE_MS
			) {
				return status
			}

			return this.clearStaleWorkflowStatus(
				userId,
				status,
				'Recent loss refresh could not be confirmed as active and was cleared after the fallback timeout.'
			)
		}
	}

	private async readStatus(userId: string): Promise<RecentLossRefreshStatusRecord | null> {
		const status = await this.ctx.storage.get<RecentLossRefreshStatusRecord>(
			this.buildStatusKey(userId)
		)
		if (!status || typeof status !== 'object') return null
		if (status.userId !== userId) return null
		const reconciledStatus = await this.reconcileActiveStatus(userId, status)
		if (
			(reconciledStatus.status === 'completed' || reconciledStatus.status === 'failed') &&
			reconciledStatus.completedAt
		) {
			const completedAtMs = Date.parse(reconciledStatus.completedAt)
			if (
				Number.isFinite(completedAtMs) &&
				Date.now() - completedAtMs > RecentLossRefreshCoordinatorDO.STATUS_RETENTION_MS
			) {
				await this.ctx.storage.delete(this.buildStatusKey(userId))
				return null
			}
		}
		if (reconciledStatus.status === 'completed' || reconciledStatus.status === 'failed') {
			await this.rescheduleCleanup()
		}
		return reconciledStatus
	}

	private async readCooldownUntil(userId: string): Promise<string | null> {
		const record = await this.ctx.storage.get<{ lastTriggeredAtMs?: number }>(
			this.buildCooldownKey(userId)
		)
		const lastTriggeredAtMs =
			typeof record?.lastTriggeredAtMs === 'number' && Number.isFinite(record.lastTriggeredAtMs)
				? record.lastTriggeredAtMs
				: null
		if (lastTriggeredAtMs === null) return null
		const cooldownUntilMs = this.getCooldownUntilMs(lastTriggeredAtMs)
		if (cooldownUntilMs <= Date.now()) return null
		return new Date(cooldownUntilMs).toISOString()
	}

	private async rescheduleCleanup(): Promise<void> {
		const entries = await this.ctx.storage.list<{ lastTriggeredAtMs?: number }>({
			prefix: RecentLossRefreshCoordinatorDO.COOLDOWN_KEY_PREFIX,
		})
		const statusEntries = await this.ctx.storage.list<RecentLossRefreshStatusRecord>({
			prefix: RecentLossRefreshCoordinatorDO.STATUS_KEY_PREFIX,
		})

		let nextExpiryMs: number | null = null
		const now = Date.now()
		const expiredStatusKeys: string[] = []

		for (const record of entries.values()) {
			const lastTriggeredAtMs =
				typeof record?.lastTriggeredAtMs === 'number' && Number.isFinite(record.lastTriggeredAtMs)
					? record.lastTriggeredAtMs
					: null
			if (lastTriggeredAtMs === null) continue
			const expiryMs = this.getCooldownUntilMs(lastTriggeredAtMs)
			if (expiryMs <= now) continue
			if (nextExpiryMs === null || expiryMs < nextExpiryMs) {
				nextExpiryMs = expiryMs
			}
		}

		for (const [key, status] of statusEntries) {
			if (!status || typeof status !== 'object' || typeof status.userId !== 'string') {
				expiredStatusKeys.push(key)
				continue
			}

			const cleanupAtMs = this.getStatusCleanupAtMs(status, now)
			if (cleanupAtMs === null) continue
			if (cleanupAtMs <= now) {
				expiredStatusKeys.push(key)
				continue
			}
			if (nextExpiryMs === null || cleanupAtMs < nextExpiryMs) {
				nextExpiryMs = cleanupAtMs
			}
		}

		if (expiredStatusKeys.length > 0) {
			await this.ctx.storage.delete(expiredStatusKeys)
		}

		if (nextExpiryMs === null) {
			await this.ctx.storage.deleteAlarm()
			return
		}

		await this.ctx.storage.setAlarm(nextExpiryMs)
	}

	async startRecentLossRefresh(
		userId: string,
		characters: RecentLossRefreshCharacterInput[],
		maxLossAgeDays: number,
		bypassCooldown = false
	): Promise<RecentLossRefreshStartResult> {
		const now = Date.now()
		const cooldownMs = RecentLossRefreshCoordinatorDO.COOLDOWN_MS
		const cooldownUntil = now + cooldownMs
		const cooldownEntry = await this.ctx.storage.get<{ lastTriggeredAtMs?: number }>(
			this.buildCooldownKey(userId)
		)
		const existingTriggeredAtMs =
			typeof cooldownEntry?.lastTriggeredAtMs === 'number' &&
			Number.isFinite(cooldownEntry.lastTriggeredAtMs)
				? cooldownEntry.lastTriggeredAtMs
				: null
		const activeStatus = await this.readStatus(userId)
		const isActiveWorkflow =
			activeStatus !== null &&
			(activeStatus.status === 'queued' || activeStatus.status === 'running')

		if (isActiveWorkflow) {
			const activeCooldownUntil =
				existingTriggeredAtMs !== null ? existingTriggeredAtMs + cooldownMs : cooldownUntil
			return {
				allowed: false,
				retryAfterMs: Math.max(0, activeCooldownUntil - now),
				cooldownUntil: new Date(activeCooldownUntil).toISOString(),
			}
		}

		if (
			!bypassCooldown &&
			existingTriggeredAtMs !== null &&
			now - existingTriggeredAtMs < cooldownMs
		) {
			const retryAfterMs = Math.max(0, cooldownMs - (now - existingTriggeredAtMs))
			return {
				allowed: false,
				retryAfterMs,
				cooldownUntil: new Date(existingTriggeredAtMs + cooldownMs).toISOString(),
			}
		}

		const workflowInstanceId = `srp-recent-loss-refresh-${userId.replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36)}`
		const queuedStatus: RecentLossRefreshStatusRecord = {
			userId,
			workflowInstanceId,
			status: 'queued',
			totalCharacters: characters.length,
			processedCharacters: 0,
			successfulCharacters: 0,
			failedCharacters: 0,
			queuedAt: new Date(now).toISOString(),
			updatedAt: new Date(now).toISOString(),
			failures: [],
			maxLossAgeDays,
		}

		await this.ctx.storage.put(this.buildCooldownKey(userId), {
			lastTriggeredAtMs: now,
		})
		await this.ctx.storage.put(this.buildStatusKey(userId), queuedStatus)
		await this.rescheduleCleanup()

		try {
			await createWorkflow(this.env.SRP_RECENT_LOSS_REFRESH_WORKFLOW, {
				id: workflowInstanceId,
				params: {
					userId,
					workflowInstanceId,
					characters,
					maxLossAgeDays,
				},
			})
		} catch (error) {
			await this.ctx.storage.delete(this.buildCooldownKey(userId))
			await this.ctx.storage.delete(this.buildStatusKey(userId))
			await this.rescheduleCleanup()
			throw error
		}

		return {
			allowed: true,
			retryAfterMs: 0,
			cooldownUntil: new Date(cooldownUntil).toISOString(),
			workflowInstanceId,
			status: 'queued',
			totalCharacters: characters.length,
		}
	}

	async getRecentLossRefreshStatus(userId: string): Promise<RecentLossRefreshStatusResponse> {
		const [status, cooldownUntil] = await Promise.all([
			this.readStatus(userId),
			this.readCooldownUntil(userId),
		])
		return { status, cooldownUntil }
	}

	async updateRecentLossRefreshStatus(
		userId: string,
		status: RecentLossRefreshStatusRecord
	): Promise<void> {
		if (status.userId !== userId) {
			throw new Error('Recent loss refresh status user mismatch')
		}
		await this.ctx.storage.put(this.buildStatusKey(userId), status)
		await this.rescheduleCleanup()
	}

	async alarm(): Promise<void> {
		const now = Date.now()
		const entries = await this.ctx.storage.list<{ lastTriggeredAtMs?: number }>({
			prefix: RecentLossRefreshCoordinatorDO.COOLDOWN_KEY_PREFIX,
		})

		const expiredKeys: string[] = []

		for (const [key, record] of entries) {
			const lastTriggeredAtMs =
				typeof record?.lastTriggeredAtMs === 'number' && Number.isFinite(record.lastTriggeredAtMs)
					? record.lastTriggeredAtMs
					: null
			if (lastTriggeredAtMs === null) {
				expiredKeys.push(key)
				continue
			}

			const expiryMs = this.getCooldownUntilMs(lastTriggeredAtMs)
			if (expiryMs <= now) {
				expiredKeys.push(key)
				continue
			}
		}

		if (expiredKeys.length > 0) {
			await this.ctx.storage.delete(expiredKeys)
		}

		const statusEntries = await this.ctx.storage.list<RecentLossRefreshStatusRecord>({
			prefix: RecentLossRefreshCoordinatorDO.STATUS_KEY_PREFIX,
		})
		for (const status of statusEntries.values()) {
			if (!status || typeof status !== 'object' || typeof status.userId !== 'string') continue
			await this.readStatus(status.userId)
		}

		await this.rescheduleCleanup()
	}
}
