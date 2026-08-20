/**
 * Structure and sovereignty ESI response types.
 *
 * These intentionally retain ESI's wire shape. The corporation domain owns
 * enrichment, prioritization, and persistence of these records.
 */

/** GET /sovereignty/systems */
export interface EsiSovereigntySystemsResponse {
	solar_systems: Array<
		| {
				solar_system_id: number
				claim: {
					alliance: {
						alliance_id: number
						corporation_id: number
						claimed_since: string
						is_capital_system: boolean
						sovereignty_hub: {
							id: number
							vulnerability_window?: { start: string; end: string }
						}
						development: {
							activity_defense_multiplier: number
							military_level: number
							industrial_level: number
							strategic_level: number
						}
					}
				}
		  }
		| { solar_system_id: number; claim: { faction: { faction_id: number } } }
		| { solar_system_id: number; claim: { unclaimed: boolean } }
	>
}

/** GET /corporations/{corporation_id}/structures/sovereignty-hubs */
export interface EsiSovereigntyHubListingResponse {
	sovereignty_hubs: Array<{ id: number; solar_system_id: number }>
}

/** GET /corporations/{corporation_id}/structures/sovereignty-hubs/{structure_id} */
export interface EsiSovereigntyHubDetail {
	id: number
	solar_system_id: number
	fuel_access_list_id?: number | null
	reagent_bay: {
		last_updated: string
		reagents: Array<{
			type_id: number
			amount: number
			burning_per_hour: number
			last_cycle: string
		}>
	}
	resources: {
		power: { allocated: number; available: number }
		workforce: { allocated: number; available: number }
	}
	upgrades: Array<{ type_id: number; power_state: string }>
	vulnerability_window?: { start: string; end: string } | null
	workforce_transport: {
		configuration:
			| { import: { sources: Array<{ solar_system_id: number }> } }
			| { export: { amount: number; solar_system_id?: number } }
			| { transit: boolean | null }
		state:
			| { import: { sources: Array<{ amount: number; solar_system_id: number }> } }
			| { export: { amount: number; solar_system_id?: number } }
			| { transit: boolean | null }
	}
}

/** GET /corporations/{corporation_id}/structures/skyhooks */
export interface EsiCorporationSkyhookListingResponse {
	skyhooks: Array<{ id: number; planet_id: number }>
}

/** GET /corporations/{corporation_id}/structures/skyhooks/{structure_id} */
export interface EsiCorporationSkyhookDetail {
	id: number
	planet_id: number
	state: string
	is_active: boolean
	effective_workforce?: number | null
	reagents?: Array<{
		type_id: number
		secured_stock: number
		unsecured_stock: number
		last_cycle: string
	}>
	reinforcement_timer?: { end: string } | null
	theft_vulnerability?: { start: string; end: string } | null
}

/** GET /corporation/{corporation_id}/mining/extractions */
export interface EsiCorporationMiningExtraction {
	structure_id: number
	moon_id: number
	extraction_start_time: string
	chunk_arrival_time: string
	natural_decay_time: string
}
