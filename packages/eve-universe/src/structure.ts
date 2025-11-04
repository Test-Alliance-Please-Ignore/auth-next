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

export interface EveStructure extends DurableObject {
	fetchStructureInfo: (
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	) => Promise<EsiGetStructureResponse | null>

	getInstance: (
		structureId: EveStructureId,
		authorizedCharacterId: EveCharacterId
	) => Promise<EveStructureInstance>
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
}
