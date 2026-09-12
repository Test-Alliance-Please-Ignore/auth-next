import { DurableObject } from 'cloudflare:workers'

import { ExpiryAlarmQueue } from '@repo/expiry-alarms'
import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	buildImmunitasAccessAlertMessage,
	IMMUNITAS_ALERT_COOLDOWN_MS,
	IMMUNITAS_ALERT_INITIAL_DELAY_MS,
	IMMUNITAS_ALERT_RETRY_MS,
	IMMUNITAS_ALERT_TTL_MS,
	shouldRetryImmunitasAccessAlertDelivery,
} from './lib/immunitas-alerts'
import { createDb } from './db'
import { users } from './db/schema'

import type { Discord } from '@repo/discord'
import type { Env } from './context'

export interface ImmunitasAlerts {
	queueImmunitasAccessAlert(input: ImmunitasAccessAlertInput): Promise<{
		added: number
		skipped: number
		pendingCount: number
	}>
	processPendingImmunitasAccessAlerts(): Promise<{
		processed: number
		sent: number
		failed: number
	}>
}

export interface ImmunitasAccessAlertInput {
	targetUserId: string
	targetCharacterLabel: string
	requestorUserId: string
	requestorCharacterLabel: string | null
	accessType: 'profile-data' | 'fulcrum-report'
	source?: string
}

type RequestorGroup = {
	requestorUserId: string
	requestorLabels: string[]
}

type AlertPayload = {
	targetUserId: string
	accessType: 'profile-data' | 'fulcrum-report'
	pendingTargetCharacterLabels: string[]
	pendingRequestorGroups: RequestorGroup[]
	nextEligibleAt: number
	lastNotifiedAt: number | null
	lastError?: string
	source?: string
	expiresAt: number
}

const PREFIX = 'immunitas-alert:'
const PAYLOAD_PREFIX = `${PREFIX}payload:`

export class ImmunitasAlertsDO extends DurableObject<Env> implements ImmunitasAlerts {
	private readonly queue: ExpiryAlarmQueue<AlertPayload>

	constructor(
		private readonly state: DurableObjectState,
		public readonly env: Env
	) {
		super(state, env)
		this.queue = new ExpiryAlarmQueue(state.storage, {
			prefix: PREFIX,
			pastDue: 'process',
			batchSize: 20,
			retry: { maxAttempts: 1, baseDelayMs: IMMUNITAS_ALERT_RETRY_MS, maxDelayMs: IMMUNITAS_ALERT_RETRY_MS },
			handler: (context) => this.deliver(context.payload),
		})
		void state.blockConcurrencyWhile(() => this.queue.initialize())
	}

	async queueImmunitasAccessAlert(input: ImmunitasAccessAlertInput) {
		const label = input.targetCharacterLabel.trim()
		if (!label) return { added: 0, skipped: 0, pendingCount: 0 }

		const id = `${input.targetUserId}:${input.accessType}`
		const now = Date.now()
		const existing = await this.state.storage.get<AlertPayload>(`${PAYLOAD_PREFIX}${id}`)
		const labels = new Set(existing?.pendingTargetCharacterLabels ?? [])
		const groups = new Map(
			(existing?.pendingRequestorGroups ?? []).map((group) => [group.requestorUserId, {
				requestorUserId: group.requestorUserId,
				requestorLabels: new Set(group.requestorLabels),
			}])
		)
		const beforeLabels = labels.size
		labels.add(label)
		const requestorLabel = input.requestorCharacterLabel?.trim() || input.requestorUserId.trim() || 'Unknown requester'
		const group = groups.get(input.requestorUserId) ?? {
			requestorUserId: input.requestorUserId,
			requestorLabels: new Set<string>(),
			}
		const beforeRequestorLabels = group.requestorLabels.size
		group.requestorLabels.add(requestorLabel)
		groups.set(input.requestorUserId, group)
		const pending = [...groups.values()].map((value) => ({
			...value,
			requestorLabels: [...value.requestorLabels],
		}))
		const hasPending = (existing?.pendingTargetCharacterLabels.length ?? 0) > 0
		const dueAt = hasPending
			? existing!.nextEligibleAt
			: existing?.nextEligibleAt && existing.nextEligibleAt > now
				? existing.nextEligibleAt
				: now + IMMUNITAS_ALERT_INITIAL_DELAY_MS
		const payload: AlertPayload = {
			targetUserId: input.targetUserId,
			accessType: input.accessType,
			pendingTargetCharacterLabels: [...labels],
			pendingRequestorGroups: pending,
			nextEligibleAt: dueAt,
			lastNotifiedAt: existing?.lastNotifiedAt ?? null,
			lastError: existing?.lastError,
			source: input.source ?? existing?.source,
			expiresAt: now + IMMUNITAS_ALERT_TTL_MS,
		}
		await this.state.storage.put(`${PAYLOAD_PREFIX}${id}`, payload)
		await this.queue.upsert(id, dueAt, payload)
		logger.info('[ImmunitasAlertsDO] Queued access alert', { id, added: labels.size - beforeLabels + group.requestorLabels.size - beforeRequestorLabels })
		return {
			added: labels.size - beforeLabels + group.requestorLabels.size - beforeRequestorLabels,
			skipped: Math.max(0, 2 - (labels.size - beforeLabels + group.requestorLabels.size - beforeRequestorLabels)),
			pendingCount: 1,
		}
	}

	async processPendingImmunitasAccessAlerts() {
		const result = await this.queue.alarm()
		return { processed: result.claimed, sent: result.completed, failed: result.failed }
	}

	async alarm(): Promise<void> {
		await this.queue.alarm()
	}

	private async deliver(payload: AlertPayload) {
		const id = `${payload.targetUserId}:${payload.accessType}`
		const now = Date.now()
		if (payload.expiresAt <= now || payload.pendingTargetCharacterLabels.length === 0) {
			await this.state.storage.delete(`${PAYLOAD_PREFIX}${id}`)
			return { action: 'complete' as const }
		}
		const db = createDb(this.env.DATABASE_URL)
		const user = await db.query.users.findFirst({
			where: eq(users.id, payload.targetUserId),
			columns: { discordUserId: true },
		})
		if (!user?.discordUserId) {
			await this.state.storage.delete(`${PAYLOAD_PREFIX}${id}`)
			return { action: 'complete' as const }
		}
		const discord = getStub<Discord>(this.env.DISCORD, 'default')
		const result = await discord.sendDirectMessage(
			payload.targetUserId,
			buildImmunitasAccessAlertMessage({
				accessType: payload.accessType,
				targetCharacterLabels: payload.pendingTargetCharacterLabels,
				requestorGroups: payload.pendingRequestorGroups,
			})
		)
		if (!result.success) {
			if (!shouldRetryImmunitasAccessAlertDelivery(result)) {
				await this.state.storage.delete(`${PAYLOAD_PREFIX}${id}`)
				return { action: 'complete' as const }
			}
			const retryAt = now + (result.retryAfter && result.retryAfter > 0 ? result.retryAfter * 1000 : IMMUNITAS_ALERT_RETRY_MS)
			const retryPayload = { ...payload, nextEligibleAt: retryAt, expiresAt: now + IMMUNITAS_ALERT_TTL_MS, lastError: result.error }
			await this.state.storage.put(`${PAYLOAD_PREFIX}${id}`, retryPayload)
			return { action: 'retry' as const, delayMs: retryAt - now, payload: retryPayload }
		}
		const cooldownPayload: AlertPayload = {
			...payload,
			pendingTargetCharacterLabels: [],
			pendingRequestorGroups: [],
			lastNotifiedAt: now,
			nextEligibleAt: now + IMMUNITAS_ALERT_COOLDOWN_MS,
			expiresAt: now + IMMUNITAS_ALERT_TTL_MS,
			lastError: undefined,
		}
		await this.state.storage.put(`${PAYLOAD_PREFIX}${id}`, cooldownPayload)
		return { action: 'reschedule' as const, dueAt: cooldownPayload.nextEligibleAt, payload: cooldownPayload }
	}
}
