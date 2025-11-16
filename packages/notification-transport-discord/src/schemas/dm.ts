import { z } from 'zod'

import { BaseTransportParams } from '@repo/notification-transport-base'

/** Discord DM transport parameters */
export type DiscordDMParams = z.infer<typeof DiscordDMParams>
export const DiscordDMParams = BaseTransportParams.extend({
	userId: z.string(),
	message: z.string().optional(),
})

