import { and, eq } from '@repo/db-utils'

import { userNotificationConfig } from '../db/schema'

import type { NotificationConfig, NotificationEventType } from '@repo/notifications'
import type { createDb } from '../db'

export class NotificationConfigService {
	constructor(private readonly db: ReturnType<typeof createDb>) {}

	async getNotificationConfig(
		userId: string
	): Promise<Omit<NotificationConfig, 'createdAt' | 'updatedAt'> | null> {
		const config = await this.db.query.userNotificationConfig.findFirst({
			where: eq(userNotificationConfig.coreUserId, userId),
		})

		if (!config) {
			return null
		}

		return {
			coreUserId: config?.coreUserId ?? '',
			notificationType: config?.notificationType ?? '',
			eventType: config?.eventType ?? '',
			enabled: config?.enabled ?? true,
			notifyCount: config?.notifyCount ?? 0,
			lastNotifiedAt: config?.lastNotifiedAt ?? null,
		}
	}

	/**
	 * Get all enabled transports for a destination and event type
	 */
	async getEnabledTransports(
		destinationId: string,
		eventType: NotificationEventType
	): Promise<Array<Omit<NotificationConfig, 'createdAt' | 'updatedAt'>>> {
		const configs = await this.db.query.userNotificationConfig.findMany({
			where: and(
				eq(userNotificationConfig.coreUserId, destinationId),
				eq(userNotificationConfig.enabled, true),
				eq(userNotificationConfig.eventType, eventType)
			),
		})

		return configs.map((config) => ({
			coreUserId: config.coreUserId,
			notificationType: config.notificationType,
			eventType: config.eventType ?? '',
			enabled: config.enabled,
			notifyCount: config.notifyCount,
			lastNotifiedAt: config.lastNotifiedAt,
		}))
	}

	/**
	 * Get config for a specific notification type
	 */
	async getNotificationConfigByType(
		destinationId: string,
		notificationType: string
	): Promise<Omit<NotificationConfig, 'createdAt' | 'updatedAt'> | null> {
		const config = await this.db.query.userNotificationConfig.findFirst({
			where: and(
				eq(userNotificationConfig.coreUserId, destinationId),
				eq(userNotificationConfig.notificationType, notificationType)
			),
		})

		if (!config) {
			return null
		}

		return {
			coreUserId: config.coreUserId,
			notificationType: config.notificationType,
			eventType: config.eventType ?? '',
			enabled: config.enabled,
			notifyCount: config.notifyCount,
			lastNotifiedAt: config.lastNotifiedAt,
		}
	}

	/**
	 * Check if a notification type is enabled for an event type
	 */
	async isTransportEnabled(
		destinationId: string,
		transportType: string,
		eventType?: NotificationEventType
	): Promise<boolean> {
		const whereConditions = [
			eq(userNotificationConfig.coreUserId, destinationId),
			eq(userNotificationConfig.notificationType, transportType),
			eq(userNotificationConfig.enabled, true),
		]

		if (eventType) {
			whereConditions.push(eq(userNotificationConfig.eventType, eventType))
		}

		const config = await this.db.query.userNotificationConfig.findFirst({
			where: and(...whereConditions),
		})

		return config?.enabled ?? false
	}
}
