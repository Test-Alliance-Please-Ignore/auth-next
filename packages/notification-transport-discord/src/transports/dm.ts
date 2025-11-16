import type { z } from 'zod'

import { createDiscordClient, Routes } from '@repo/discord/src/client'

import { BaseNotificationTransport, type NotificationTransportResult } from '@repo/notification-transport-base'

import { DiscordDMParams } from '../schemas/dm'

/** Discord DM transport - sends a direct message to a user */
export class DiscordDMTransport extends BaseNotificationTransport<typeof DiscordDMParams> {
	readonly type = 'discord.dm'
	readonly paramsSchema = DiscordDMParams

	constructor(private readonly botToken: string) {
		super()
	}

	async send(params: z.infer<typeof DiscordDMParams>): Promise<NotificationTransportResult> {
		try {
			const rest = createDiscordClient(this.botToken)
			const content = params.message || JSON.stringify(params.notification.data || {})

			// Create or get DM channel with user
			const channel = (await rest.post(Routes.userChannels(), {
				body: {
					recipient_id: params.userId,
				},
			})) as { id: string }

			// Send message to DM channel
			await rest.post(Routes.channelMessages(channel.id), {
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

