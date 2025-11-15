import { z } from 'zod'

/**
 * Zod schemas for ESI Killmail endpoints
 * Based on: https://developers.eveonline.com/api-explorer#/operations/GetKillmailsKillmailIdKillmailHash
 */

/**
 * Position coordinates
 */
export const positionSchema = z.object({
	x: z.number(),
	y: z.number(),
	z: z.number(),
})

/**
 * Item dropped or destroyed in a killmail
 */
export const killmailItemSchema = z.object({
	flag: z.number(), // int32 - Item flag
	item_type_id: z.coerce.string(), // int64 -> string
	quantity_destroyed: z.number().optional(), // int64 but JavaScript safe range
	quantity_dropped: z.number().optional(), // int64 but JavaScript safe range
	singleton: z.number(), // int32 - 0 for stacks, 1 for fitted items, 2 for charges
})

// Recursive schema for items with nested items (containers)
export type KillmailItem = z.infer<typeof killmailItemSchema> & {
	items?: KillmailItem[]
}

export const killmailItemRecursiveSchema: z.ZodType<KillmailItem> = killmailItemSchema.extend({
	items: z.lazy(() => killmailItemRecursiveSchema.array()).optional(),
})

/**
 * Victim information
 */
export const killmailVictimSchema = z.object({
	alliance_id: z.coerce.string().optional(), // int64 -> string
	character_id: z.coerce.string().optional(), // int64 -> string
	corporation_id: z.coerce.string().optional(), // int64 -> string
	damage_taken: z.number(), // int32
	faction_id: z.coerce.string().optional(), // int64 -> string
	items: z.array(killmailItemRecursiveSchema).optional(),
	position: positionSchema.optional(),
	ship_type_id: z.coerce.string(), // int64 -> string
})

/**
 * Attacker information
 */
export const killmailAttackerSchema = z.object({
	alliance_id: z.coerce.string().optional(), // int64 -> string
	character_id: z.coerce.string().optional(), // int64 -> string
	corporation_id: z.coerce.string().optional(), // int64 -> string
	damage_done: z.number(), // int32
	faction_id: z.coerce.string().optional(), // int64 -> string
	final_blow: z.boolean(),
	security_status: z.number(), // float
	ship_type_id: z.coerce.string().optional(), // int64 -> string
	weapon_type_id: z.coerce.string().optional(), // int64 -> string
})

/**
 * Complete killmail detail response
 * GET /killmails/{killmail_id}/{killmail_hash}/
 */
export const killmailDetailSchema = z.object({
	attackers: z.array(killmailAttackerSchema),
	killmail_id: z.coerce.string(), // int64 -> string
	killmail_time: z.string(), // ISO 8601 datetime
	moon_id: z.coerce.string().optional(), // int64 -> string
	solar_system_id: z.coerce.string(), // int64 -> string
	victim: killmailVictimSchema,
	war_id: z.coerce.string().optional(), // int64 -> string
})

export type Position = z.infer<typeof positionSchema>
export type KillmailItemBase = z.infer<typeof killmailItemSchema>
export type KillmailVictim = z.infer<typeof killmailVictimSchema>
export type KillmailAttacker = z.infer<typeof killmailAttackerSchema>
export type KillmailDetail = z.infer<typeof killmailDetailSchema>

/**
 * Killmail database row type
 * This represents a killmail record stored in the database
 */
export type Killmail = {
	killmailId: string
	killmailHash: string
	killmailTime: Date
	solarSystemId: string
	solarSystemName: string | null
	moonId: string | null
	moonName: string | null
	warId: string | null
	warName: string | null
	victimCharacterId: string | null
	victimCharacterName: string | null
	victimCorporationId: string | null
	victimCorporationName: string | null
	victimAllianceId: string | null
	victimAllianceName: string | null
	victimShipTypeId: string
	victimShipTypeName: string | null
	victimDamageTaken: number
	attackerCharacterIds: string[] | null
	attackerCharacterNames: string[] | null
	attackerCorporationIds: string[] | null
	attackerCorporationNames: string[] | null
	killmailData: unknown
	createdAt: Date
	updatedAt: Date
}
