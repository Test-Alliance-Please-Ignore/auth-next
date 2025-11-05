import { RpcTarget } from 'cloudflare:workers'
import { z } from 'zod'

import type { EveCharacterId, EveStructureId } from '@repo/eve-types'

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
export interface EveStructure extends DurableObject {
	fetchStructureInfo: (
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	) => Promise<EsiGetStructureResponse | null>

	getInstance: (
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	) => Promise<EveStructureInstance>

	fetchStructureMarketData: (
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	) => Promise<EsiGetStructureMarketDataResponse | null>
}

export class EveStructureInstance extends RpcTarget {
	constructor(
		private structureObject: EveStructure,
		private structureId: EveStructureId,
		private authorizedCharacterId: EveCharacterId
	) {
		super()
	}

	async getStructureInfo(): Promise<EsiGetStructureResponse | null> {
		return await this.structureObject.fetchStructureInfo(
			this.structureId,
			this.authorizedCharacterId
		)
	}

	async getStructureMarketData(): Promise<EsiGetStructureMarketDataResponse | null> {
		return await this.structureObject.fetchStructureMarketData(
			this.structureId,
			this.authorizedCharacterId
		)
	}
}
