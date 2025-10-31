import * as z from 'zod'

/**
 * Schema for ESI "Get fleet information" response.
 * Represents high-level configuration and status for a fleet.
 *
 * Fields:
 * - is_free_move: Whether free-move is enabled for members
 * - is_registered: Whether the fleet is registered in the fleet finder
 * - is_voice_enabled: Whether fleet voice is enabled
 * - motd: Optional message of the day for the fleet
 */

export const esiGetFleetInformationSchema = z.object({
	is_free_move: z.boolean(),
	is_registered: z.boolean(),
	is_voice_enabled: z.boolean(),
	motd: z.string().optional(),
})

/** Inferred TypeScript type for {@link esiGetFleetInformationSchema}. */
export type EsiGetFleetInformation = z.infer<typeof esiGetFleetInformationSchema>

/**
 * Schema for ESI "Get character fleet info" response.
 * Identifies a character's current fleet context and role.
 *
 * Fields:
 * - fleet_boss_id: Character ID of the fleet boss
 * - fleet_id: Fleet ID the character belongs to
 * - role: Role of the character within the fleet hierarchy
 * - squad_id: Squad ID the character is in
 * - wing_id: Wing ID the character is in
 */
export const esiGetCharacterFleetInformationSchema = z.object({
	fleet_boss_id: z.number(),
	fleet_id: z.number(),
	role: z.enum(['fleet_commander', 'squad_commander', 'squad_member', 'wing_commander']),
	squad_id: z.number(),
	wing_id: z.number(),
})

/** Inferred TypeScript type for {@link esiGetCharacterFleetInformationSchema}. */
export type EsiGetCharacterFleetInformation = z.infer<typeof esiGetCharacterFleetInformationSchema>

/**
 * Schema for an individual member object within the ESI "Get fleet members" response.
 * Describes a single fleet member's state and placement in the hierarchy.
 *
 * Fields:
 * - character_id: Character ID for the member
 * - join_time: ISO timestamp of when the member joined the fleet
 * - role: Member's role in the fleet hierarchy
 * - role_name: Human-readable role label
 * - ship_type_id: Type ID of the ship the member is flying
 * - solar_system_id: Current solar system ID for the member
 * - squad_id: Squad ID for the member
 * - station_id: Station ID if docked (may be 0 if not applicable)
 * - takes_fleet_warp: Whether the member accepts fleet warps
 * - wing_id: Wing ID for the member
 */
export const esiGetFleetMembersObjectSchema = z.object({
	character_id: z.number(),
	join_time: z.string(),
	role: z.enum(['fleet_commander', 'squad_commander', 'squad_member', 'wing_commander']),
	role_name: z.string(),
	ship_type_id: z.number(),
	solar_system_id: z.number(),
	squad_id: z.number(),
	station_id: z.number(),
	takes_fleet_warp: z.boolean(),
	wing_id: z.number(),
})

/** Inferred TypeScript type for {@link esiGetFleetMembersObjectSchema}. */
export type EsiGetFleetMembersObject = z.infer<typeof esiGetFleetMembersObjectSchema>

/** Schema for the ESI "Get fleet members" response: an array of member objects. */
export const esiGetFleetMembersSchema = z.array(esiGetFleetMembersObjectSchema)

/** Inferred TypeScript type for {@link esiGetFleetMembersSchema}. */
export type EsiGetFleetMembers = z.infer<typeof esiGetFleetMembersSchema>
