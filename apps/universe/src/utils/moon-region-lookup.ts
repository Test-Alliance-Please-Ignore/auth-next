import { eq, inArray } from '@repo/db-utils'

import type { DbClient } from '../db'
import type * as schema from '../db/schema'
import { moons, universeSolarSystems } from '../db/schema'

const MOON_REGION_LOOKUP_BATCH_SIZE = 500

function chunkArray<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size) as T[])
	}

	return chunks
}

export async function resolveMoonRegionIds(
	db: DbClient<typeof schema>,
	moonIds: string[]
): Promise<Record<string, string>> {
	if (moonIds.length === 0) return {}

	const result: Record<string, string> = {}
	const uniqueMoonIds = [...new Set(moonIds)]

	for (const moonIdChunk of chunkArray(uniqueMoonIds, MOON_REGION_LOOKUP_BATCH_SIZE)) {
		const rows = await db
			.select({
				moonId: moons.moonId,
				regionId: universeSolarSystems.regionId,
			})
			.from(moons)
			.innerJoin(universeSolarSystems, eq(moons.solarSystemId, universeSolarSystems.solarSystemId))
			.where(inArray(moons.moonId, moonIdChunk))

		for (const row of rows) {
			result[row.moonId] = row.regionId
		}
	}

	return result
}
