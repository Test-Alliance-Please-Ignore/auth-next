import { and, desc, eq, isNull, lte, or } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { taxAlerts, taxNotificationDestinations } from '../db/schema'

import type {
	ListTaxAlertsFilters,
	ListTaxNotificationDestinationsFilters,
	TaxAlert,
	TaxNotificationDestination,
	TriggerTaxAlertInput,
	UpsertTaxNotificationDestinationInput,
} from '@repo/corporation-tax'
import type { Discord } from '@repo/discord'
import type { CorporationTaxDb } from '../db'

const DISCORD_RETRY_MS = 5 * 60 * 1000
const MAX_INTERNAL_RETRIES = 3

export class TaxAlertService {
	constructor(
		private db: CorporationTaxDb,
		private discordNamespace: DurableObjectNamespace
	) {}

	async triggerAlert(actorUserId: string, input: TriggerTaxAlertInput): Promise<TaxAlert> {
		const now = new Date()
		const existing = await this.db.query.taxAlerts.findFirst({
			where: eq(taxAlerts.dedupeKey, input.dedupeKey),
		})

		let row: typeof taxAlerts.$inferSelect
		if (existing) {
			const status = existing.status === 'resolved' ? 'open' : existing.status
			const [updated] = await this.db
				.update(taxAlerts)
				.set({
					corporationId: input.corporationId ?? null,
					alertType: input.alertType,
					severity: input.severity,
					status,
					payload: input.payload ?? null,
					lastTriggeredAt: now,
					updatedAt: now,
					...(status === 'open'
						? {
								acknowledgedAt: null,
								acknowledgedByUserId: null,
								resolvedAt: null,
								resolvedByUserId: null,
							}
						: {}),
				})
				.where(eq(taxAlerts.id, existing.id))
				.returning()

			if (!updated) {
				throw new Error('Failed to update alert')
			}
			row = updated
		} else {
			const [created] = await this.db
				.insert(taxAlerts)
				.values({
					corporationId: input.corporationId ?? null,
					alertType: input.alertType,
					severity: input.severity,
					status: 'open',
					dedupeKey: input.dedupeKey,
					payload: input.payload ?? null,
					firstTriggeredAt: now,
					lastTriggeredAt: now,
				})
				.returning()

			if (!created) {
				throw new Error('Failed to create alert')
			}
			row = created
		}

		const shouldDispatch =
			!existing || existing.status === 'resolved' || existing.discordDeliveryStatus !== 'sent'
		if (shouldDispatch) {
			row = await this.attemptDiscordDispatch(row)
		}

		void actorUserId
		return this.toAlert(row)
	}

	async listAlerts(filters: ListTaxAlertsFilters = {}): Promise<TaxAlert[]> {
		const conditions = []
		if (filters.corporationId) {
			conditions.push(eq(taxAlerts.corporationId, filters.corporationId))
		}
		if (filters.status) {
			conditions.push(eq(taxAlerts.status, filters.status))
		}
		if (filters.severity) {
			conditions.push(eq(taxAlerts.severity, filters.severity))
		}

		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const rows = await this.db.query.taxAlerts.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(taxAlerts.lastTriggeredAt)],
			limit,
			offset,
		})

		return rows.map((row) => this.toAlert(row))
	}

	async acknowledgeAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		const [updated] = await this.db
			.update(taxAlerts)
			.set({
				status: 'acknowledged',
				acknowledgedAt: new Date(),
				acknowledgedByUserId: actorUserId,
				updatedAt: new Date(),
			})
			.where(eq(taxAlerts.id, alertId))
			.returning()

		if (!updated) {
			throw new Error('Alert not found')
		}
		return this.toAlert(updated)
	}

	async resolveAlert(actorUserId: string, alertId: string): Promise<TaxAlert> {
		const [updated] = await this.db
			.update(taxAlerts)
			.set({
				status: 'resolved',
				resolvedAt: new Date(),
				resolvedByUserId: actorUserId,
				updatedAt: new Date(),
			})
			.where(eq(taxAlerts.id, alertId))
			.returning()

		if (!updated) {
			throw new Error('Alert not found')
		}
		return this.toAlert(updated)
	}

	async retryFailedAlertDeliveries(_actorUserId: string, limit = 20): Promise<number> {
		const now = new Date()
		const boundedLimit = Math.min(Math.max(limit, 1), 100)
		const rows = await this.db.query.taxAlerts.findMany({
			where: and(
				eq(taxAlerts.discordDeliveryStatus, 'failed'),
				lte(taxAlerts.discordAttemptCount, MAX_INTERNAL_RETRIES - 1),
				or(isNull(taxAlerts.nextRetryAt), lte(taxAlerts.nextRetryAt, now))
			),
			orderBy: [desc(taxAlerts.lastTriggeredAt)],
			limit: boundedLimit,
		})

		let attempted = 0
		for (const row of rows) {
			await this.attemptDiscordDispatch(row)
			attempted += 1
		}

		return attempted
	}

	async upsertNotificationDestination(
		actorUserId: string,
		input: UpsertTaxNotificationDestinationInput
	): Promise<TaxNotificationDestination> {
		const existing = await this.db.query.taxNotificationDestinations.findFirst({
			orderBy: [desc(taxNotificationDestinations.updatedAt)],
		})

		const now = new Date()
		if (existing) {
			const [updated] = await this.db
				.update(taxNotificationDestinations)
				.set({
					name: input.name,
					guildId: input.guildId,
					channelId: input.channelId,
					updatedByUserId: actorUserId,
					updatedAt: now,
				})
				.where(eq(taxNotificationDestinations.id, existing.id))
				.returning()

			if (!updated) {
				throw new Error('Failed to update notification destination')
			}

			return this.toDestination(updated)
		}

		const [created] = await this.db
			.insert(taxNotificationDestinations)
			.values({
				name: input.name,
				guildId: input.guildId,
				channelId: input.channelId,
				createdByUserId: actorUserId,
				updatedByUserId: actorUserId,
			})
			.returning()

		if (!created) {
			throw new Error('Failed to create notification destination')
		}

		return this.toDestination(created)
	}

	async listNotificationDestinations(
		filters: ListTaxNotificationDestinationsFilters = {}
	): Promise<TaxNotificationDestination[]> {
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const rows = await this.db.query.taxNotificationDestinations.findMany({
			orderBy: [desc(taxNotificationDestinations.updatedAt)],
			limit,
			offset,
		})

		return rows.map((row) => this.toDestination(row))
	}

	private async getDiscordDestination(): Promise<{
		guildId: string
		channelId: string
	} | null> {
		const global = await this.db.query.taxNotificationDestinations.findFirst({
			orderBy: [desc(taxNotificationDestinations.updatedAt)],
		})
		if (!global) {
			return null
		}
		return {
			guildId: global.guildId,
			channelId: global.channelId,
		}
	}

	private async attemptDiscordDispatch(alert: typeof taxAlerts.$inferSelect) {
		const destination = await this.getDiscordDestination()
		if (!destination) {
			const [updated] = await this.db
				.update(taxAlerts)
				.set({
					discordDeliveryStatus: 'skipped',
					discordLastError: 'No Discord destination configured',
					nextRetryAt: null,
					updatedAt: new Date(),
				})
				.where(eq(taxAlerts.id, alert.id))
				.returning()

			return updated ?? alert
		}

		const discord = getStub<Discord>(this.discordNamespace, 'default')
		const now = new Date()
		const nextAttemptCount = alert.discordAttemptCount + 1

		try {
			const result = await discord.sendMessage(destination.guildId, destination.channelId, {
				content: this.buildDiscordContent(alert),
				allowEveryone: false,
			})

			if (result.success) {
				const [updated] = await this.db
					.update(taxAlerts)
					.set({
						discordDeliveryStatus: 'sent',
						discordAttemptCount: nextAttemptCount,
						discordLastAttemptAt: now,
						discordLastError: null,
						nextRetryAt: null,
						updatedAt: now,
					})
					.where(eq(taxAlerts.id, alert.id))
					.returning()
				return updated ?? alert
			}

			const [updated] = await this.db
				.update(taxAlerts)
				.set({
					discordDeliveryStatus: 'failed',
					discordAttemptCount: nextAttemptCount,
					discordLastAttemptAt: now,
					discordLastError: result.error ?? 'Discord send failed',
					nextRetryAt: null,
					updatedAt: now,
				})
				.where(eq(taxAlerts.id, alert.id))
				.returning()
			return updated ?? alert
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const shouldRetry = nextAttemptCount < MAX_INTERNAL_RETRIES
			const [updated] = await this.db
				.update(taxAlerts)
				.set({
					discordDeliveryStatus: 'failed',
					discordAttemptCount: nextAttemptCount,
					discordLastAttemptAt: now,
					discordLastError: message,
					nextRetryAt: shouldRetry ? new Date(now.getTime() + DISCORD_RETRY_MS) : null,
					updatedAt: now,
				})
				.where(eq(taxAlerts.id, alert.id))
				.returning()
			return updated ?? alert
		}
	}

	private buildDiscordContent(alert: typeof taxAlerts.$inferSelect): string {
		const scope = alert.corporationId ? `Corporation ${alert.corporationId}` : 'Global'
		const details = this.buildDiscordAlertDetails(alert)
		return `[Tax Alert] ${scope} | ${alert.severity.toUpperCase()} | ${alert.alertType}${details}`
	}

	private buildDiscordAlertDetails(alert: typeof taxAlerts.$inferSelect): string {
		const payload = this.toPayloadObject(alert.payload)
		if (!payload) {
			return ''
		}

		if (alert.alertType === 'unexpected_income_ref_type_detected') {
			const refType =
				typeof payload.refType === 'string' && payload.refType.trim().length > 0
					? payload.refType.trim()
					: null
			const entryCountRaw = payload.entryCountInBatch
			const entryCount =
				typeof entryCountRaw === 'number'
					? entryCountRaw
					: typeof entryCountRaw === 'string'
						? Number(entryCountRaw)
						: null

			const refDetail = refType ? `refType=${refType}` : null
			const countDetail =
				entryCount !== null && Number.isFinite(entryCount)
					? `entryCount=${Math.trunc(entryCount)}`
					: null
			const detailText = [refDetail, countDetail].filter(Boolean).join(', ')

			return detailText.length > 0 ? ` | ${detailText}` : ''
		}

		return ''
	}

	private toPayloadObject(payload: unknown): Record<string, unknown> | null {
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			return null
		}
		return payload as Record<string, unknown>
	}

	private toAlert(row: typeof taxAlerts.$inferSelect): TaxAlert {
		return {
			id: row.id,
			corporationId: row.corporationId,
			alertType: row.alertType,
			severity: row.severity,
			status: row.status,
			dedupeKey: row.dedupeKey,
			payload: row.payload,
			firstTriggeredAt: row.firstTriggeredAt,
			lastTriggeredAt: row.lastTriggeredAt,
			acknowledgedAt: row.acknowledgedAt,
			acknowledgedByUserId: row.acknowledgedByUserId,
			resolvedAt: row.resolvedAt,
			resolvedByUserId: row.resolvedByUserId,
			discordDeliveryStatus: row.discordDeliveryStatus,
			discordAttemptCount: row.discordAttemptCount,
			discordLastAttemptAt: row.discordLastAttemptAt,
			discordLastError: row.discordLastError,
			nextRetryAt: row.nextRetryAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private toDestination(
		row: typeof taxNotificationDestinations.$inferSelect
	): TaxNotificationDestination {
		return {
			id: row.id,
			name: row.name,
			guildId: row.guildId,
			channelId: row.channelId,
			createdByUserId: row.createdByUserId,
			updatedByUserId: row.updatedByUserId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
