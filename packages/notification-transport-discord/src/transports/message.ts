import type { z } from 'zod'

import { createDiscordClient, Routes } from '@repo/discord/src/client'

import { BaseNotificationTransport, type NotificationTransportResult } from '@repo/notification-transport-base'

import { DiscordMessageParams } from '../schemas/message'

/** Discord message transport - sends to a specific channel ID */
export class DiscordMessageTransport extends BaseNotificationTransport<typeof DiscordMessageParams> {
	readonly type = 'discord.message'
	readonly paramsSchema = DiscordMessageParams

	constructor(private readonly botToken: string) {
		super()
	}

	async send(params: z.infer<typeof DiscordMessageParams>): Promise<NotificationTransportResult> {
		try {
			const rest = createDiscordClient(this.botToken)
			const content = params.message || JSON.stringify(params.notification.data || {})

			await rest.post(Routes.channelMessages(params.channelId), {
				body: {
					content,
				},
			})

			return { success: true }
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			}
		}
	}
}

