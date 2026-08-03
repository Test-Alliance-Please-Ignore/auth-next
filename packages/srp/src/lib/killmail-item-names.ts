export interface KillmailItemNode {
	flag?: number
	item_type_id?: number | string
	type_id?: number | string
	typeId?: number | string
	items?: KillmailItemNode[]
}

export interface KillmailItemTypeMeta {
	typeName?: string | null
	groupId?: string | null
}

export function collectKillmailItemTypeIds(items: readonly KillmailItemNode[]): string[] {
	const typeIds = new Set<string>()

	const walk = (rows: readonly KillmailItemNode[]) => {
		for (const row of rows) {
			const rawTypeId = row.item_type_id ?? row.type_id ?? row.typeId
			if (rawTypeId != null) {
				const typeId = String(rawTypeId).trim()
				if (typeId.length > 0) typeIds.add(typeId)
			}
			if (row.items?.length) {
				walk(row.items)
			}
		}
	}

	walk(items)
	return [...typeIds]
}

/** ESI flag used for a ship stored in another ship's ship maintenance bay. */
export const SHIP_MAINTENANCE_BAY_FLAG = 90

export function buildKillmailItemMetadata(
	items: readonly KillmailItemNode[],
	typeMap: Record<string, KillmailItemTypeMeta | null | undefined>
): {
	killmailItemNames: Record<string, string>
	killmailItemGroupIds: Record<string, string>
} {
	const killmailItemNames: Record<string, string> = {}
	const killmailItemGroupIds: Record<string, string> = {}

	for (const typeId of collectKillmailItemTypeIds(items)) {
		const type = typeMap[typeId]
		const typeName = type?.typeName?.trim()
		if (typeName) killmailItemNames[typeId] = typeName
		if (type?.groupId) killmailItemGroupIds[typeId] = type.groupId
	}

	return {
		killmailItemNames,
		killmailItemGroupIds,
	}
}
