import { z } from 'zod'

import { BaseTransportParams } from '@repo/notification-transport-base'

/** Discord channel transport parameters */
export type DiscordChannelParams = z.infer<typeof DiscordChannelParams>
export const DiscordChannelParams = BaseTransportParams.extend({
	guildId: z.string(),
	channelId: z.string(),
	message: z.string().optional(),
})

