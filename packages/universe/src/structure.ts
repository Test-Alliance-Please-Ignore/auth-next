import { z } from 'zod'

import type { EveCharacterId, EveStructureId } from '@repo/eve-types'

/**
 * ESI Structure Response Schema
 * GET /universe/structures/{structure_id}/
 */
export const EsiGetStructureResponseSchema = z.object({
	name: z.string(),
	owner_id: z.coerce.string(),
	position: z.object({
		x: z.number(),
		y: z.number(),
		z: z.number(),
	}),
	solar_system_id: z.coerce.string(),
	type_id: z.coerce.string(),
})

export type EsiGetStructureResponse = z.infer<typeof EsiGetStructureResponseSchema>

/**
 * ESI Structure Market Order Schema
 * GET /markets/structures/{structure_id}/
 */
export const EsiGetStructureMarketDataResponseObjectSchema = z.object({
	duration: z.coerce.string().transform((val) => parseInt(val)),
	is_buy_order: z.boolean(),
	issued: z.coerce.string().transform((val) => new Date(val)),
	location_id: z.coerce.string(),
	min_volume: z.coerce.string(),
	order_id: z.coerce.string(),
	price: z.coerce.string().transform((val) => parseFloat(val)),
	range: z.enum([
		'station',
		'solarsystem',
		'region',
		'1',
		'2',
		'3',
		'4',
		'5',
		'10',
		'20',
		'30',
		'40',
	]),
	type_id: z.coerce.string(),
	volume_remain: z.coerce.string(),
	volume_total: z.coerce.string(),
})

export type EsiGetStructureMarketDataResponseObject = z.infer<
	typeof EsiGetStructureMarketDataResponseObjectSchema
>

export const EsiGetStructureMarketDataResponseSchema = z.array(
	EsiGetStructureMarketDataResponseObjectSchema
)

export type EsiGetStructureMarketDataResponse = z.infer<
	typeof EsiGetStructureMarketDataResponseSchema
>

// Re-export types for convenience
export type { EveCharacterId, EveStructureId }
