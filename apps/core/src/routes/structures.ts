import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { hasAllStructureManagerPermission } from '@repo/groups'
import {
	STRUCTURE_COMMON_LIST_SORT_FIELDS,
	STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS,
	STRUCTURE_SKYHOOK_LIST_SORT_FIELDS,
	STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS,
} from '@repo/structures'
import { createWorkflow } from '@repo/workflow-utils'

import { getCachedUserPermissions } from '../lib/groups-cache'
import {
	buildStructureAssetsDebugExportKey,
	buildStructureAssetsDebugFileName,
	getStructureAssetsDebugBucket,
	readStructureAssetsDebugArtifact,
} from '../lib/structure-assets-debug'
import { normalizeWorkflowStatus } from '../lib/workflow-status'
import { EntityResolverService } from '../services/entity-resolver.service'

import type { Context } from 'hono'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type {
	StructureCommonListSortBy,
	StructureDetailResult,
	StructureFittingItem,
	StructureInventoryBay,
	StructureInventoryItem,
	StructureListQuery,
	StructureMiningCitadelListQuery,
	StructureMoonDrillListQuery,
	StructureMoonStructureListSortBy,
	StructureSkyhookListQuery,
	StructureSkyhookListSortBy,
	StructureSovereigntyListQuery,
	StructureSovereigntyListResponse,
	StructureSovereigntyListSortBy,
	UpdateStructureConfigInput,
	UpdateStructureModuleConfigInput,
} from '@repo/structures'
import type { TypeMetadata, Universe } from '@repo/universe'
import type { App } from '../context'

const app = new Hono<App>()

const structurePagingSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
	sortDirection: z.enum(['asc', 'desc']).default('asc'),
})

const structureCommonListQuerySchema = structurePagingSchema.extend({
	sortBy: z.enum(STRUCTURE_COMMON_LIST_SORT_FIELDS).default('fuel'),
	corporationId: z.string().trim().min(1).optional(),
	assignedGroupId: z.string().trim().min(1).optional(),
	lowPower: z.enum(['true', 'false']).optional(),
	lowPowerAllowed: z.enum(['true', 'false']).optional(),
	regionId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	state: z.string().trim().min(1).optional(),
	typeId: z.string().trim().min(1).optional(),
})

const structureListQuerySchema = structureCommonListQuerySchema

const sovereigntyStructureListQuerySchema = structurePagingSchema.extend({
	sortBy: z.enum(STRUCTURE_SOVEREIGNTY_LIST_SORT_FIELDS).default('fuel'),
	corporationId: z.string().trim().min(1).optional(),
	assignedGroupId: z.string().trim().min(1).optional(),
	regionId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	controllerAllianceId: z.string().trim().min(1).optional(),
	vulnerabilityState: z.enum(['vulnerable', 'invulnerable', 'reinforced']).optional(),
})

const skyhookStructureListQuerySchema = structureCommonListQuerySchema.extend({
	sortBy: z.enum(STRUCTURE_SKYHOOK_LIST_SORT_FIELDS).default('fuel'),
	planetId: z.string().trim().min(1).optional(),
	isRaidable: z.enum(['true', 'false']).optional(),
})

const moonDrillStructureListQuerySchema = structureCommonListQuerySchema.extend({
	sortBy: z.enum(STRUCTURE_MOON_STRUCTURE_LIST_SORT_FIELDS).default('fuel'),
	planetId: z.string().trim().min(1).optional(),
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

function getExecutionContextOrNull(c: {
	executionCtx?: Pick<ExecutionContext, 'waitUntil'>
}): Pick<ExecutionContext, 'waitUntil'> | null {
	try {
		return c.executionCtx ?? null
	} catch {
		return null
	}
}

async function enrichStructureDetailTypeNames(
	env: App['Bindings'],
	structure: StructureDetailResult
): Promise<StructureDetailResult> {
	const sovereignty = structure.sovereignty ?? null
	const sovereigntyHub = sovereignty?.hub ?? null
	const allianceIds = sovereignty?.allianceId ? [sovereignty.allianceId] : []
	const structureTypeIds = new Set<string>([
		...(structure.inventoryBays?.flatMap((bay: StructureInventoryBay) =>
			bay.items.map((item: StructureInventoryItem) => item.typeId)
		) ?? []),
		...(structure.fittingItems?.map((item) => item.typeId) ?? []),
		...(sovereigntyHub?.reagentBay?.reagents.map((reagent) => reagent.typeId) ?? []),
		...(sovereigntyHub?.upgrades?.map((upgrade) => upgrade.typeId) ?? []),
	])
	if (structureTypeIds.size === 0 && allianceIds.length === 0) {
		return structure
	}

	const typeIds = Array.from(structureTypeIds)
	if (typeIds.length === 0) {
		const allianceNameMap =
			allianceIds.length > 0
				? await new EntityResolverService(
						getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
					).resolveEntityNames(allianceIds)
				: new Map<string, string>()
		const nextSovereignty = sovereignty
			? {
					...sovereignty,
					allianceName: sovereignty.allianceId
						? (allianceNameMap.get(sovereignty.allianceId) ??
							sovereignty.allianceName ??
							sovereignty.allianceId)
						: null,
					hub: sovereigntyHub,
				}
			: sovereignty

		const nextStructure: StructureDetailResult = {
			...structure,
			sovereignty: nextSovereignty,
		}

		return nextStructure
	}

	const universe = getUniverseStub(env)
	const allianceResolver =
		allianceIds.length > 0
			? new EntityResolverService(getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default'))
			: null
	const typeNameMap: Record<string, string> = {}
	const typeMetaMap: Record<string, TypeMetadata> = {}
	const batchSize = 1000

	for (let index = 0; index < typeIds.length; index += batchSize) {
		const batch = typeIds.slice(index, index + batchSize)
		const [resolvedNames, resolvedMeta] = await Promise.all([
			universe.resolveTypeNamesByIds(batch).catch(() => ({}) as Record<string, null>),
			universe.resolveTypeMetadataByIds(batch).catch(() => ({}) as Record<string, TypeMetadata>),
		])
		for (const [typeId, typeData] of Object.entries(resolvedNames)) {
			typeNameMap[typeId] = typeData?.typeName ?? typeId
		}
		for (const [typeId, typeMeta] of Object.entries(resolvedMeta)) {
			typeMetaMap[typeId] = typeMeta
		}
	}

	const allianceNameMap =
		allianceResolver !== null
			? await allianceResolver.resolveEntityNames(allianceIds)
			: new Map<string, string>()

	return {
		...structure,
		inventoryBays: structure.inventoryBays?.map((bay: StructureInventoryBay) => ({
			...bay,
			items: bay.items
				.map((item: StructureInventoryItem) => ({
					...item,
					typeName: typeNameMap[item.typeId] ?? item.typeId,
				}))
				.sort(
					(left: StructureInventoryItem, right: StructureInventoryItem) =>
						(left.typeName ?? left.typeId).localeCompare(right.typeName ?? right.typeId) ||
						left.typeId.localeCompare(right.typeId)
				),
		})),
		fittingItems: structure.fittingItems?.map((item: StructureFittingItem) => ({
			...item,
			typeName: typeNameMap[item.typeId] ?? item.typeId,
			...(typeMetaMap[item.typeId]?.categoryName === 'Charge' ? { isConsumable: true } : {}),
		})),
		sovereignty: sovereignty
			? {
					...sovereignty,
					allianceName: sovereignty.allianceId
						? (allianceNameMap.get(sovereignty.allianceId) ??
							sovereignty.allianceName ??
							sovereignty.allianceId)
						: null,
					hub: sovereigntyHub
						? {
								...sovereigntyHub,
								reagentBay: sovereigntyHub.reagentBay
									? {
											...sovereigntyHub.reagentBay,
											reagents: sovereigntyHub.reagentBay.reagents.map((reagent) => ({
												...reagent,
												typeName: typeNameMap[reagent.typeId] ?? reagent.typeId,
											})),
										}
									: sovereigntyHub.reagentBay,
								upgrades: sovereigntyHub.upgrades?.map((upgrade) => ({
									...upgrade,
									typeName: typeNameMap[upgrade.typeId] ?? upgrade.typeId,
								})),
							}
						: sovereigntyHub,
				}
			: sovereignty,
	}
}

function stripUpdatedAtFromStructureItem(item: any): any {
	if (!item || typeof item !== 'object') {
		return item
	}

	const { updatedAt: _updatedAt, ...rest } = item as Record<string, unknown>
	return rest
}

function stripUpdatedAtFromStructureListResponse(response: any): any {
	return {
		...response,
		items: response.items.map((item: any) => stripUpdatedAtFromStructureItem(item)),
	}
}

async function enrichSovereigntyStructureListResponse(
	env: App['Bindings'],
	response: StructureSovereigntyListResponse
): Promise<StructureSovereigntyListResponse> {
	const allianceIds = [
		...new Set(
			[
				...response.items.map((item) => item.allianceId),
				...response.items.map((item) => item.controllerAllianceId),
				...response.filterOptions.controllerAlliances.map((option) => option.value),
			].filter((value): value is string => Boolean(value))
		),
	]

	if (allianceIds.length === 0) {
		return response
	}

	const allianceNameMap = await new EntityResolverService(
		getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
	).resolveEntityNames(allianceIds)

	return {
		...response,
		items: response.items.map((item) => ({
			...item,
			allianceName: item.allianceId
				? (allianceNameMap.get(item.allianceId) ?? item.allianceName ?? item.allianceId)
				: null,
			controllerAllianceName: item.controllerAllianceId
				? (allianceNameMap.get(item.controllerAllianceId) ??
					item.controllerAllianceName ??
					item.controllerAllianceId)
				: null,
		})),
		filterOptions: {
			...response.filterOptions,
			controllerAlliances: response.filterOptions.controllerAlliances.map((option) => ({
				...option,
				label: allianceNameMap.get(option.value) ?? option.label ?? option.value,
			})),
		},
	}
}

app.get('/', async (c) => {
	return handleStructuresRequest(c)
})

app.get('/sovereignty', async (c) => {
	return handleSovereigntyStructuresRequest(c)
})

app.get('/skyhooks', async (c) => {
	return handleSkyhookStructuresRequest(c)
})

app.get('/moon-drills', async (c) => {
	return handleMoonDrillStructuresRequest(c)
})

app.get('/mining-citadels', async (c) => {
	return handleMiningCitadelsStructuresRequest(c)
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
		const structure = (await c.env.STRUCTURES.getStructureDetail(actor, structureId)) as {
			corporationId: string
			corporationName: string | null
			structureId: string
			name: string | null
		} | null
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}

		const workflow = await createWorkflow(c.env.EXPORT_WORKFLOW, {
			params: {
				kind: 'structure-assets-debug',
				userId: user.id,
				corporationId: structure.corporationId,
				corporationName: structure.corporationName ?? structure.corporationId,
				structureId: structure.structureId,
				structureName: structure.name ?? structure.structureId,
			},
		})

		return c.json(
			{
				workflowInstanceId: workflow.id,
				exportId: workflow.id,
				fileName: buildStructureAssetsDebugFileName(workflow.id),
				status: 'queued',
			},
			202
		)
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to queue structure assets debug export',
			},
			500
		)
	}
})

app.post('/:structureId/inventory-rebuild', async (c) => {
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
		const structure = (await c.env.STRUCTURES.getStructureDetail(actor, structureId)) as {
			corporationId: string
			structureId: string
		} | null
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}

		const corpData = getStub<EveCorporationData>(
			c.env.EVE_CORPORATION_DATA,
			structure.corporationId
		)
		const result = await corpData.rebuildStructureInventorySnapshot(
			structure.corporationId,
			structure.structureId
		)

		return c.json({
			structureId: structure.structureId,
			corporationId: structure.corporationId,
			inventoryCount: result.inventoryCount,
		})
	} catch (error) {
		return c.json(
			{
				error:
					error instanceof Error ? error.message : 'Failed to rebuild structure inventory snapshot',
			},
			500
		)
	}
})

app.get('/:structureId/assets-debug/:workflowInstanceId', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!user.is_admin) {
		return c.json({ error: 'Requires site administrator permission' }, 403)
	}

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const workflow = await c.env.EXPORT_WORKFLOW.get(workflowInstanceId)
	const status = await workflow.status()
	const outputStatus =
		status.output && typeof status.output === 'object' && 'status' in status.output
			? String((status.output as { status?: string }).status ?? '')
			: undefined
	return c.json({
		workflowInstanceId,
		status: normalizeWorkflowStatus(status.status, outputStatus),
		rawStatus: status.status,
		output: status.output ?? null,
	})
})

app.get('/:structureId/assets-debug/:workflowInstanceId/download', async (c) => {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}
	if (!user.is_admin) {
		return c.json({ error: 'Requires site administrator permission' }, 403)
	}

	const workflowInstanceId = c.req.param('workflowInstanceId')
	if (!workflowInstanceId) {
		return c.json({ error: 'workflowInstanceId is required' }, 400)
	}

	const bucket = getStructureAssetsDebugBucket(c.env)
	const exportKey = buildStructureAssetsDebugExportKey(workflowInstanceId)
	const artifact = await readStructureAssetsDebugArtifact(bucket, exportKey)
	if (!artifact) {
		return c.json({ error: 'Export not found' }, 404)
	}

	const executionCtx = getExecutionContextOrNull(c)
	const cleanup = bucket.delete(exportKey).catch(() => {})
	if (executionCtx) {
		executionCtx.waitUntil(cleanup)
	} else {
		void cleanup
	}

	return c.json(artifact)
})

async function handleStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = structureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: (c.req.query('sortBy') || undefined) as StructureCommonListSortBy | undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
		}) as StructureListQuery

		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await c.env.STRUCTURES.listStructures(await getStructureActor(c), query)
			)
		)
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
			sortBy: (c.req.query('sortBy') || undefined) as StructureSovereigntyListSortBy | undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			controllerAllianceId: c.req.query('controllerAllianceId') || undefined,
			vulnerabilityState: c.req.query('vulnerabilityState') || undefined,
		}) as StructureSovereigntyListQuery
		const response = await c.env.STRUCTURES.listSovereigntyStructures(
			await getStructureActor(c),
			query
		)
		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await enrichSovereigntyStructureListResponse(c.env, response)
			)
		)
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
			sortBy: (c.req.query('sortBy') || undefined) as StructureSkyhookListSortBy | undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
			planetId: c.req.query('planetId') || undefined,
			isRaidable: c.req.query('isRaidable') || undefined,
		}) as StructureSkyhookListQuery
		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await c.env.STRUCTURES.listSkyhookStructures(await getStructureActor(c), query)
			)
		)
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleMoonDrillStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = moonDrillStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: (c.req.query('sortBy') || undefined) as StructureMoonStructureListSortBy | undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
			planetId: c.req.query('planetId') || undefined,
		}) as StructureMoonDrillListQuery
		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await c.env.STRUCTURES.listMoonDrillStructures(await getStructureActor(c), query)
			)
		)
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
		)
	}
}

async function handleMiningCitadelsStructuresRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		const query = moonDrillStructureListQuerySchema.parse({
			page: c.req.query('page'),
			pageSize: c.req.query('pageSize'),
			sortBy: (c.req.query('sortBy') || undefined) as StructureMoonStructureListSortBy | undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
			planetId: c.req.query('planetId') || undefined,
		}) as StructureMiningCitadelListQuery
		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await c.env.STRUCTURES.listMiningCitadelStructures(await getStructureActor(c), query)
			)
		)
	} catch (error) {
		return c.json(
			{
				error: error instanceof Error ? error.message : 'Failed to list structures',
			},
			error instanceof z.ZodError ? 400 : 500
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
		const body = structureModuleConfigSchema.parse(
			await c.req.json()
		) satisfies UpdateStructureModuleConfigInput
		return c.json(
			await c.env.STRUCTURES.updateStructureModuleConfig(await getStructureActor(c), body)
		)
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
		const structure = await c.env.STRUCTURES.getStructureDetail(
			await getStructureActor(c),
			structureId
		)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(
			stripUpdatedAtFromStructureItem(await enrichStructureDetailTypeNames(c.env, structure))
		)
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
		const body = updateStructureConfigSchema.parse(
			await c.req.json()
		) satisfies UpdateStructureConfigInput
		const structure = await c.env.STRUCTURES.updateStructureConfig(
			await getStructureActor(c),
			structureId,
			body
		)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(
			stripUpdatedAtFromStructureItem(await enrichStructureDetailTypeNames(c.env, structure))
		)
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
