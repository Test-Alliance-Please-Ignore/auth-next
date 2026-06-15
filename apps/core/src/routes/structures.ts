import { Hono } from 'hono'
import { z } from 'zod'

import { parseFittingSlotFlag } from '@repo/eve-fitting/flags'
import { getInventoryBayLabel } from '@repo/inventory-display'
import { getStub } from '@repo/do-utils'
import { hasAllStructureManagerPermission } from '@repo/groups'

import type {
	StructureCitadelListQuery,
	StructureMiningListQuery,
	StructureNavigationListQuery,
	StructureOverviewMetrics,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
	UpdateStructureConfigInput,
	UpdateStructureModuleConfigInput,
} from '@repo/structures'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { TypeMetadata, Universe } from '@repo/universe'
import type { Context } from 'hono'
import type { App } from '../context'
import { getCachedUserPermissions } from '../lib/groups-cache'

const app = new Hono<App>()

const structureListSortFields = [
	'updatedAt',
	'nextStateAt',
	'fuel',
	'name',
	'corporation',
	'region',
	'system',
	'type',
	'state',
] as const

const structureListPagingSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
	sortBy: z.enum(structureListSortFields).default('updatedAt'),
	sortDirection: z.enum(['asc', 'desc']).default('desc'),
})

const citadelStructureListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	assignedGroupId: z.string().trim().min(1).optional(),
	lowPower: z.enum(['true', 'false']).optional(),
	lowPowerAllowed: z.enum(['true', 'false']).optional(),
	regionId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	state: z.string().trim().min(1).optional(),
	typeId: z.string().trim().min(1).optional(),
})

const navigationStructureListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	state: z.string().trim().min(1).optional(),
	typeId: z.string().trim().min(1).optional(),
})

const sovereigntyStructureListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	allianceId: z.string().trim().min(1).optional(),
})

const skyhookStructureListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	planetId: z.string().trim().min(1).optional(),
	state: z.string().trim().min(1).optional(),
	isRaidable: z.enum(['true', 'false']).optional(),
})

const miningStructureListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	planetId: z.string().trim().min(1).optional(),
	typeId: z.string().trim().min(1).optional(),
})

const updateStructureConfigSchema = z.object({
	hidden: z.boolean().optional(),
	lowPowerAllowed: z.boolean().optional(),
	assignedGroupId: z.string().min(1).nullable().optional(),
})

const structureModuleConfigSchema = z.object({
	lowFuelTimeThresholdHours: z.coerce.number().int().min(0).optional(),
	criticalFuelTimeThresholdHours: z.coerce.number().int().min(0).optional(),
	lowFuelAmountThreshold: z.coerce.number().int().min(0).optional(),
	criticalFuelAmountThreshold: z.coerce.number().int().min(0).optional(),
})

interface StructureInventoryItemView {
	typeId: string
	typeName: string | null
	quantity: number
	stackCount: number
}

interface StructureInventoryBayView {
	locationFlag: string
	label: string
	totalQuantity: number
	totalStacks: number
	items: StructureInventoryItemView[]
}

interface StructureFittingItemView {
	locationFlag: string
	slotIndex: number
	flagName: 'High Slot' | 'Mid Slot' | 'Low Slot' | 'Rig Slot' | 'Subsystem Slot'
	typeId: string
	typeName: string | null
	quantity: number
	isConsumable?: boolean
}

interface StructureDetailResponse {
	inventoryBays?: StructureInventoryBayView[]
	fittingItems?: StructureFittingItemView[]
	[key: string]: unknown
}

interface StructureAssetsDebugItemView {
	itemId: string
	typeId: string
	typeName: string | null
	quantity: number
	isSingleton: boolean
	locationId: string
	locationType: string
	locationFlag: string
	locationFlagLabel: string
	updatedAt: string
}

interface StructureAssetsDebugResponse {
	corporationId: string
	corporationName: string
	structureId: string
	structureName: string
	fetchedAt: string
	fetchedAssetCount: number
	itemCount: number
	items: StructureAssetsDebugItemView[]
}

async function getStructureActor(c: Context<App>) {
	const user = c.get('user')
	if (!user) {
		throw new Error('Unauthorized')
	}

	const permissions = await getCachedUserPermissions(c.env, user.id)

	return {
		id: user.id,
		is_admin: user.is_admin,
		roles: permissions.map((permission) => permission.urn),
	}
}

async function canManageStructures(c: Context<App>): Promise<boolean> {
	const user = c.get('user')
	if (!user) {
		return false
	}

	if (user.is_admin) {
		return true
	}

	const permissions = await getCachedUserPermissions(c.env, user.id)
	return hasAllStructureManagerPermission(permissions)
}

function getUniverseStub(env: App['Bindings']): Universe {
	return getStub<Universe>(env.UNIVERSE, 'default')
}

function getStructureAssetLocationLabel(locationFlag: string): string {
	const fittingSlot = parseFittingSlotFlag(locationFlag)
	if (fittingSlot) {
		return `${fittingSlot.flagName} ${fittingSlot.slotIndex}`
	}

	return getInventoryBayLabel(locationFlag)
}

async function enrichStructureDetailTypeNames(
	env: App['Bindings'],
	structure: StructureDetailResponse
): Promise<StructureDetailResponse> {
	if (
		(!structure.inventoryBays || structure.inventoryBays.length === 0) &&
		(!structure.fittingItems || structure.fittingItems.length === 0)
	) {
		return structure
	}

	const typeIds = Array.from(
		new Set([
			...(structure.inventoryBays?.flatMap((bay) => bay.items.map((item) => item.typeId)) ?? []),
			...(structure.fittingItems?.map((item) => item.typeId) ?? []),
		])
	)
	if (typeIds.length === 0) {
		return structure
	}

	const universe = getUniverseStub(env)
	const typeNameMap: Record<string, string> = {}
	const typeMetaMap: Record<string, TypeMetadata> = {}
	const batchSize = 1000

	for (let index = 0; index < typeIds.length; index += batchSize) {
		const batch = typeIds.slice(index, index + batchSize)
		const [resolvedNames, resolvedMeta] = await Promise.all([
			universe.resolveTypeNamesByIds(batch).catch(() => ({} as Record<string, null>)),
			universe.resolveTypeMetadataByIds(batch).catch(() => ({} as Record<string, TypeMetadata>)),
		])
		for (const [typeId, typeData] of Object.entries(resolvedNames)) {
			typeNameMap[typeId] = typeData?.typeName ?? typeId
		}
		for (const [typeId, typeMeta] of Object.entries(resolvedMeta)) {
			typeMetaMap[typeId] = typeMeta
		}
	}

	return {
		...structure,
		inventoryBays: structure.inventoryBays?.map((bay) => ({
			...bay,
			items: bay.items
				.map((item) => ({
					...item,
					typeName: typeNameMap[item.typeId] ?? item.typeId,
				}))
				.sort(
					(left, right) =>
						left.typeName.localeCompare(right.typeName) || left.typeId.localeCompare(right.typeId)
				),
		})),
		fittingItems: structure.fittingItems?.map((item) => ({
			...item,
			typeName: typeNameMap[item.typeId] ?? item.typeId,
			...(typeMetaMap[item.typeId]?.categoryName === 'Charge' ? { isConsumable: true } : {}),
		})),
	}
}

async function enrichStructureAssetsDebugTypeNames(
	env: App['Bindings'],
	items: StructureAssetsDebugItemView[]
): Promise<StructureAssetsDebugItemView[]> {
	if (items.length === 0) {
		return items
	}

	const typeIds = Array.from(new Set(items.map((item) => item.typeId)))
	if (typeIds.length === 0) {
		return items
	}

	const universe = getUniverseStub(env)
	const typeNameMap: Record<string, string> = {}
	const batchSize = 1000

	for (let index = 0; index < typeIds.length; index += batchSize) {
		const batch = typeIds.slice(index, index + batchSize)
		const resolved = await universe.resolveTypeNamesByIds(batch)
		for (const [typeId, typeData] of Object.entries(resolved)) {
			typeNameMap[typeId] = typeData?.typeName ?? typeId
		}
	}

	return items.map((item) => ({
		...item,
		typeName: typeNameMap[item.typeId] ?? item.typeId,
	}))
}

app.get('/', async (c) => {
	return handleCitadelStructuresRequest(c)
})

app.get('/citadels', async (c) => {
	return handleCitadelStructuresRequest(c)
})

app.get('/navigation', async (c) => {
	return handleNavigationStructuresRequest(c)
})

app.get('/sovereignty', async (c) => {
	return handleSovereigntyStructuresRequest(c)
})

app.get('/skyhooks', async (c) => {
	return handleSkyhookStructuresRequest(c)
})

app.get('/mining', async (c) => {
	return handleMiningStructuresRequest(c)
})

app.get('/overview', async (c) => {
	return handleStructureOverviewRequest(c)
})

app.post('/:structureId/assets-debug', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!user.is_admin) {
		return c.json({ error: 'Requires site administrator permission' }, 403)
	}

	const structureId = c.req.param('structureId')
	try {
		const actor = await getStructureActor(c)
		const structure = (await c.env.STRUCTURES.getVisibleStructureDetail(actor, structureId)) as
			| {
					corporationId: string
					corporationName: string | null
					structureId: string
					name: string | null
			  }
			| null
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}

		const corpData = getStub<EveCorporationData>(c.env.EVE_CORPORATION_DATA, structure.corporationId)
		const { assetsCount } = await corpData.fetchAssets(structure.corporationId, true)
		const rawItems = await corpData.searchAssets(structure.corporationId, {
			locationId: structure.structureId,
			locationType: 'item',
			limit: 10000,
		})

		const items = await enrichStructureAssetsDebugTypeNames(
			c.env,
			rawItems
				.map((item) => ({
					itemId: item.itemId,
					typeId: item.typeId,
					typeName: null,
					quantity: item.quantity,
					isSingleton: item.isSingleton,
					locationId: item.locationId,
					locationType: item.locationType,
					locationFlag: item.locationFlag,
					locationFlagLabel: getStructureAssetLocationLabel(item.locationFlag),
					updatedAt: item.updatedAt.toISOString(),
				}))
				.sort((left, right) =>
					left.locationFlagLabel.localeCompare(right.locationFlagLabel) ||
					left.typeId.localeCompare(right.typeId) ||
					left.itemId.localeCompare(right.itemId)
				)
		)

		const response: StructureAssetsDebugResponse = {
			corporationId: structure.corporationId,
			corporationName: structure.corporationName ?? structure.corporationId,
			structureId: structure.structureId,
			structureName: structure.name ?? structure.structureId,
			fetchedAt: new Date().toISOString(),
			fetchedAssetCount: assetsCount,
			itemCount: items.length,
			items,
		}

		return c.json(response)
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to fetch structure assets debug data',
			},
			500
		)
	}
})

async function handleCitadelStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = citadelStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
		}) satisfies StructureCitadelListQuery

		return c.json(await c.env.STRUCTURES.listCitadelStructures(await getStructureActor(c), query))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleNavigationStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = navigationStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
		}) satisfies StructureNavigationListQuery
		return c.json(await c.env.STRUCTURES.listNavigationStructures(await getStructureActor(c), query))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleSovereigntyStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = sovereigntyStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			allianceId: c.req.query('allianceId') || undefined,
		}) satisfies StructureSovereigntyListQuery
		return c.json(await c.env.STRUCTURES.listSovereigntyStructures(await getStructureActor(c), query))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleSkyhookStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = skyhookStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			planetId: c.req.query('planetId') || undefined,
			state: c.req.query('state') || undefined,
			isRaidable: c.req.query('isRaidable') || undefined,
		}) satisfies StructureSkyhookListQuery
		return c.json(await c.env.STRUCTURES.listSkyhookStructures(await getStructureActor(c), query))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleMiningStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = miningStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			planetId: c.req.query('planetId') || undefined,
			typeId: c.req.query('typeId') || undefined,
		}) satisfies StructureMiningListQuery
		return c.json(await c.env.STRUCTURES.listMiningStructures(await getStructureActor(c), query))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleStructureOverviewRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		return c.json(
			(await c.env.STRUCTURES.getStructureOverviewMetrics(await getStructureActor(c))) satisfies StructureOverviewMetrics
		)
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to load structure overview metrics',
			},
			500
		)
	}
}

app.get('/config', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	return c.json(await c.env.STRUCTURES.getStructureModuleConfig(await getStructureActor(c)))
})

app.patch('/config', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!(await canManageStructures(c))) {
		return c.json({ error: 'Requires structures manager permission' }, 403)
	}

	try {
		const body = structureModuleConfigSchema.parse(await c.req.json()) satisfies UpdateStructureModuleConfigInput
		return c.json(await c.env.STRUCTURES.updateStructureModuleConfig(await getStructureActor(c), body))
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid structure config payload', issues: error.issues }, 400)
		}
		return c.json({ error: 'Failed to update structure configuration' }, 500)
	}
})

app.get('/:structureId', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const structureId = c.req.param('structureId')
	try {
		const structure = await c.env.STRUCTURES.getVisibleStructureDetail(await getStructureActor(c), structureId)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(await enrichStructureDetailTypeNames(c.env, structure as StructureDetailResponse))
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to load structure detail',
			},
			500
		)
	}
})

app.patch('/:structureId/config', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	const structureId = c.req.param('structureId')

	try {
		const body = updateStructureConfigSchema.parse(await c.req.json()) satisfies UpdateStructureConfigInput
		const structure = await c.env.STRUCTURES.updateStructureConfig(await getStructureActor(c), structureId, body)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(await enrichStructureDetailTypeNames(c.env, structure as StructureDetailResponse))
	} catch (error) {
		if (error instanceof z.ZodError) {
			return c.json({ error: 'Invalid structure config payload', issues: error.issues }, 400)
		}
		if (error instanceof Error && error.message.startsWith('Structure group ')) {
			return c.json({ error: error.message }, 400)
		}
		return c.json({ error: 'Failed to update structure config' }, 500)
	}
})

export default app
