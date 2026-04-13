import { boolean, index, integer, pgTable, text } from 'drizzle-orm/pg-core'

export const universeRegions = pgTable(
	'universe_eve_regions',
	{
		regionId: text('region_id').primaryKey(),
		regionName: text('region_name').notNull(),
	},
	(table) => [
		index('universe_eve_regions_region_id_idx').on(table.regionId),
		index('universe_eve_regions_region_name_idx').on(table.regionName),
	]
)

export const universeSolarSystems = pgTable(
	'universe_eve_solar_systems',
	{
		solarSystemId: text('solar_system_id').primaryKey(),
		solarSystemName: text('solar_system_name').notNull(),
		regionId: text('region_id').notNull(),
		constellationId: text('constellation_id').notNull(),
		securityStatus: text('security_status'),
	},
	(table) => [
		index('universe_eve_solar_systems_solar_system_id_idx').on(table.solarSystemId),
		index('universe_eve_solar_systems_solar_system_name_idx').on(table.solarSystemName),
		index('universe_eve_solar_systems_region_id_idx').on(table.regionId),
		index('universe_eve_solar_systems_constellation_id_idx').on(table.constellationId),
	]
)

export const universePlanets = pgTable(
	'universe_eve_planets',
	{
		planetId: text('planet_id').primaryKey(),
		planetName: text('planet_name').notNull(),
		solarSystemId: text('solar_system_id').notNull(),
		celestialIndex: integer('celestial_index').notNull(),
		typeId: text('type_id'),
	},
	(table) => [
		index('universe_eve_planets_planet_id_idx').on(table.planetId),
		index('universe_eve_planets_planet_name_idx').on(table.planetName),
		index('universe_eve_planets_solar_system_id_idx').on(table.solarSystemId),
	]
)

export const universeStargates = pgTable(
	'universe_eve_stargates',
	{
		stargateId: text('stargate_id').primaryKey(),
		stargateName: text('stargate_name').notNull(),
		solarSystemId: text('solar_system_id').notNull(),
		destinationSolarSystemId: text('destination_solar_system_id'),
		destinationStargateId: text('destination_stargate_id'),
		typeId: text('type_id'),
	},
	(table) => [
		index('universe_eve_stargates_stargate_id_idx').on(table.stargateId),
		index('universe_eve_stargates_stargate_name_idx').on(table.stargateName),
		index('universe_eve_stargates_solar_system_id_idx').on(table.solarSystemId),
		index('universe_eve_stargates_destination_solar_system_id_idx').on(table.destinationSolarSystemId),
	]
)

export const universeNpcStations = pgTable(
	'universe_eve_npc_stations',
	{
		stationId: text('station_id').primaryKey(),
		stationName: text('station_name').notNull(),
		solarSystemId: text('solar_system_id').notNull(),
		orbitId: text('orbit_id'),
		ownerId: text('owner_id'),
		operationId: text('operation_id'),
		typeId: text('type_id'),
		useOperationName: boolean('use_operation_name').notNull().default(false),
	},
	(table) => [
		index('universe_eve_npc_stations_station_id_idx').on(table.stationId),
		index('universe_eve_npc_stations_station_name_idx').on(table.stationName),
		index('universe_eve_npc_stations_solar_system_id_idx').on(table.solarSystemId),
	]
)
