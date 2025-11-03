import * as z from 'zod'

import { EveRegionId, EveTypeId } from '@repo/eve-types'

export interface GetRegionMarketDataInput {
	regionId: EveRegionId
	typeId?: EveTypeId
	orderType?: 'buy' | 'sell' | 'all'
	useCachedData?: boolean
}

export const GetRegionMarketDataResponseObjectSchema = z.object({
	duration: z.coerce.string().transform((val) => parseInt(val)),
	is_buy_order: z.boolean(),
	issued: z.coerce.string().transform((val) => new Date(val)),
	location_id: z.coerce.string(),
	min_volume: z.coerce.string().transform((val) => parseInt(val)),
	order_id: z.coerce.string(),
	price: z.coerce.string().transform((val) => parseFloat(val)),
	range: z.enum([
		'station',
		' solarsystem',
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
	system_id: z.coerce.string(),
	type_id: z.coerce.string(),
	volume_remain: z.coerce.string().transform((val) => parseInt(val)),
	volume_total: z.coerce.string().transform((val) => parseInt(val)),
})

export type GetRegionMarketDataResponseObject = z.infer<
	typeof GetRegionMarketDataResponseObjectSchema
>

export const GetRegionMarketDataResponseSchema = z.array(GetRegionMarketDataResponseObjectSchema)
export type GetRegionMarketDataResponse = z.infer<typeof GetRegionMarketDataResponseSchema>
