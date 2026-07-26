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

export class RecentLossRefreshCoordinatorDO extends DurableObject<Env> implements RecentLossRefreshCoordinator {
	private static readonly COOLDOWN_MS = 15 * 60 * 1000
	private static readonly STATUS_RETENTION_MS = 10 * 60 * 1000
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

	private async readStatus(userId: string): Promise<RecentLossRefreshStatusRecord | null> {
		const status = await this.ctx.storage.get<RecentLossRefreshStatusRecord>(this.buildStatusKey(userId))
		if (!status || typeof status !== 'object') return null
		if (status.userId !== userId) return null
		if (
			(status.status === 'completed' || status.status === 'failed') &&
			status.completedAt &&
			Date.now() - Date.parse(status.completedAt) > RecentLossRefreshCoordinatorDO.STATUS_RETENTION_MS
		) {
			await this.ctx.storage.delete(this.buildStatusKey(userId))
			return null
		}
		return status
	}

	private async readCooldownUntil(userId: string): Promise<string | null> {
		const record = await this.ctx.storage.get<{ lastTriggeredAtMs?: number }>(this.buildCooldownKey(userId))
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

		let nextExpiryMs: number | null = null
		const now = Date.now()

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
			typeof cooldownEntry?.lastTriggeredAtMs === 'number' && Number.isFinite(cooldownEntry.lastTriggeredAtMs)
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

		if (!bypassCooldown && existingTriggeredAtMs !== null && now - existingTriggeredAtMs < cooldownMs) {
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
		const [status, cooldownUntil] = await Promise.all([this.readStatus(userId), this.readCooldownUntil(userId)])
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
	}

	async alarm(): Promise<void> {
		const now = Date.now()
		const entries = await this.ctx.storage.list<{ lastTriggeredAtMs?: number }>({
			prefix: RecentLossRefreshCoordinatorDO.COOLDOWN_KEY_PREFIX,
		})

		const expiredKeys: string[] = []
		let nextExpiryMs: number | null = null

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

			if (nextExpiryMs === null || expiryMs < nextExpiryMs) {
				nextExpiryMs = expiryMs
			}
		}

		if (expiredKeys.length > 0) {
			await this.ctx.storage.delete(expiredKeys)
		}

		if (nextExpiryMs === null) {
			await this.ctx.storage.deleteAlarm()
			return
		}

		await this.ctx.storage.setAlarm(nextExpiryMs)
	}
}
