import { z } from 'zod'

import { BaseTransportParams } from '@repo/notification-transport-base'

/** Discord message transport parameters */
export type DiscordMessageParams = z.infer<typeof DiscordMessageParams>
export const DiscordMessageParams = BaseTransportParams.extend({
	channelId: z.string(),
	message: z.string().optional(),
})

