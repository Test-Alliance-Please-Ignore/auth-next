import type { z } from 'zod'

import { createDiscordClient, Routes } from '@repo/discord/src/client'

import { BaseNotificationTransport, type NotificationTransportResult } from '@repo/notification-transport-base'

import { DiscordChannelParams } from '../schemas/channel'

/** Discord channel transport - sends to a channel in a guild */
export class DiscordChannelTransport extends BaseNotificationTransport<typeof DiscordChannelParams> {
	readonly type = 'discord.channel'
	readonly paramsSchema = DiscordChannelParams

	constructor(private readonly botToken: string) {
		super()
	}

	async send(params: z.infer<typeof DiscordChannelParams>): Promise<NotificationTransportResult> {
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

