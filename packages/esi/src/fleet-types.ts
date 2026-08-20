/** ESI GET /characters/{character_id}/fleet/ response. */
export type CharacterFleetInformation = {
	fleet_boss_id: number
	fleet_id: number
	role: 'fleet_commander' | 'squad_commander' | 'squad_member' | 'wing_commander'
	squad_id: number
	wing_id: number
}

/** ESI GET /fleets/{fleet_id}/ response. */
export type FleetInformation = {
	is_free_move: boolean
	is_registered: boolean
	is_voice_enabled: boolean
	motd?: string
}

/** One ESI GET /fleets/{fleet_id}/members/ row. */
export type FleetMember = {
	character_id: number
	join_time: string
	role: CharacterFleetInformation['role']
	role_name: string
	ship_type_id: number
	solar_system_id: number
	squad_id: number
	station_id: number | null
	takes_fleet_warp: boolean
	wing_id: number
}

export type FleetMembers = FleetMember[]

/** ESI POST /fleets/{fleet_id}/members/ request. */
export type FleetMemberInvitation = {
	character_id: number
	role: 'squad_member'
}
