import { z } from 'zod'

export const killmailSchema = z.object({
	killmailId: z.coerce.string(),
	killmailHash: z.string(),
})

export type Killmail = z.infer<typeof killmailSchema>

export const killmailsSchema = z.array(killmailSchema)
export type Killmails = z.infer<typeof killmailsSchema>
