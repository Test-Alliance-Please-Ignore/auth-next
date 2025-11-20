/**
 * CCP maintains well-known ID ranges for most EVE entities.
 * Reference: https://developers.eveonline.com/docs/guides/id-ranges/
 *
 * This module provides helpers to classify IDs by range so downstream
 * workers can make decisions (e.g., whether an ID represents a structure).
 */

export const MIN_STRUCTURE_ID = 1_000_000_000_000
export const MAX_STRUCTURE_ID = 1_999_999_999_999

export type IdRangeType =
	| 'various'
	| 'faction'
	| 'npc_corporation'
	| 'npc_character'
	| 'universe'
	| 'region'
	| 'constellation'
	| 'solar_system'
	| 'celestial'
	| 'station'
	| 'stargate'
	| 'asteroid'
	| 'control_bunker'
	| 'promenade'
	| 'planetary_district'
	| 'character_2010_2016'
	| 'corporation_post_2010'
	| 'alliance_post_2010'
	| 'legacy_entity'
	| 'dust_character_post_2016'
	| 'character_post_2016'
	| 'structure'
	| 'unknown'
	| 'invalid'

export interface IdRangeDefinition {
	type: Exclude<IdRangeType, 'unknown' | 'invalid'>
	description: string
	from: number
	to?: number
}

const ID_RANGES: readonly IdRangeDefinition[] = [
	{ type: 'various', description: 'Various reusable IDs', from: 0, to: 499_999 },
	{ type: 'faction', description: 'Factions', from: 500_000, to: 599_999 },
	{
		type: 'npc_corporation',
		description: 'NPC corporations',
		from: 1_000_000,
		to: 1_999_999,
	},
	{
		type: 'npc_character',
		description: 'NPC characters (agents, CEOs)',
		from: 3_000_000,
		to: 3_999_999,
	},
	{ type: 'universe', description: 'Universes', from: 9_000_000, to: 9_999_999 },
	{ type: 'region', description: 'Regions', from: 10_000_000, to: 19_999_999 },
	{
		type: 'constellation',
		description: 'Constellations',
		from: 20_000_000,
		to: 29_999_999,
	},
	{
		type: 'solar_system',
		description: 'Solar systems',
		from: 30_000_000,
		to: 39_999_999,
	},
	{
		type: 'celestial',
		description: 'Celestials (suns, planets, moons, belts)',
		from: 40_000_000,
		to: 49_999_999,
	},
	{ type: 'stargate', description: 'Stargates', from: 50_000_000, to: 59_999_999 },
	{
		type: 'station',
		description: 'Stations (NPC, outposts, folders)',
		from: 60_000_000,
		to: 69_999_999,
	},
	{ type: 'asteroid', description: 'Asteroids', from: 70_000_000, to: 79_999_999 },
	{
		type: 'control_bunker',
		description: 'Factional warfare control bunkers',
		from: 80_000_000,
		to: 80_099_999,
	},
	{
		type: 'promenade',
		description: 'Walking in Stations promenades',
		from: 81_000_000,
		to: 81_999_999,
	},
	{
		type: 'planetary_district',
		description: 'Planetary districts',
		from: 82_000_000,
		to: 84_999_999,
	},
	{
		type: 'character_2010_2016',
		description: 'Characters created between 2010-11-03 and 2016-05-30',
		from: 90_000_000,
		to: 97_999_999,
	},
	{
		type: 'corporation_post_2010',
		description: 'Corporations created after 2010-11-03',
		from: 98_000_000,
		to: 98_999_999,
	},
	{
		type: 'alliance_post_2010',
		description: 'Alliances created after 2010-11-03',
		from: 99_000_000,
		to: 99_999_999,
	},
	{
		type: 'legacy_entity',
		description: 'Characters, corporations, alliances created before 2010-11-03',
		from: 100_000_000,
		to: 2_099_999_999,
	},
	{
		type: 'dust_character_post_2016',
		description: 'EVE / DUST characters created after 2016-05-30',
		from: 2_100_000_000,
		to: 2_111_999_999,
	},
	{
		type: 'character_post_2016',
		description: 'EVE characters created after 2016-05-30',
		from: 2_112_000_000,
		to: 2_129_999_999,
	},
	{
		type: 'structure',
		description: 'Structures / spawned items',
		from: MIN_STRUCTURE_ID,
		to: MAX_STRUCTURE_ID,
	},
]

export interface IdClassification {
	type: IdRangeType
	description: string
	range?: {
		from: number
		to?: number
	}
}

function normalizeId(value: number | string | bigint): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? Math.trunc(value) : null
	}

	if (typeof value === 'bigint') {
		return Number(value)
	}

	const trimmed = value.trim()
	if (trimmed.length === 0) {
		return null
	}

	const parsed = Number(trimmed)
	return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

export function getIdClassification(id: number | string | bigint): IdClassification {
	const numericId = normalizeId(id)
	if (numericId === null) {
		return {
			type: 'invalid',
			description: 'ID could not be parsed into a finite number',
		}
	}

	const range = ID_RANGES.find(
		(candidate) =>
			numericId >= candidate.from && (candidate.to === undefined || numericId <= candidate.to)
	)

	if (!range) {
		return {
			type: 'unknown',
			description: 'ID does not fall within a documented CCP range',
		}
	}

	return {
		type: range.type,
		description: range.description,
		range: { from: range.from, to: range.to },
	}
}

export function isStructureId(id: number | string | bigint): boolean {
	const numericId = normalizeId(id)
	return numericId !== null && numericId >= MIN_STRUCTURE_ID && numericId <= MAX_STRUCTURE_ID
}
