import type { z } from 'zod'

import { BaseNotificationTransport, type NotificationTransportResult } from '@repo/notification-transport-base'

import { DiscordWebhookParams } from '../schemas/webhook'

/** Discord webhook transport - sends via webhook URL */
export class DiscordWebhookTransport extends BaseNotificationTransport<typeof DiscordWebhookParams> {
	readonly type = 'discord.webhook'
	readonly paramsSchema = DiscordWebhookParams

	async send(params: z.infer<typeof DiscordWebhookParams>): Promise<NotificationTransportResult> {
		try {
			const content = params.message || JSON.stringify(params.notification.data || {})

			const response = await fetch(params.webhookUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					content,
				}),
			})

			if (!response.ok) {
				const errorText = await response.text()
				throw new Error(`Discord webhook failed: ${response.status} ${errorText}`)
			}

			return { success: true }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			}
		}
	}
}

