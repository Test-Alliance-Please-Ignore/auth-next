import { z } from 'zod'

import { BaseTransportParams } from '@repo/notification-transport-base'

/** Discord webhook transport parameters */
export type DiscordWebhookParams = z.infer<typeof DiscordWebhookParams>
export const DiscordWebhookParams = BaseTransportParams.extend({
	webhookUrl: z.string().url(),
	message: z.string().optional(),
})

