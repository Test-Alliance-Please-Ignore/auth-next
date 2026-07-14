import { Hono } from 'hono'
import { z } from 'zod'

import { getStub } from '@repo/do-utils'
import { hasAllStructureManagerPermission } from '@repo/groups'

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
import type { EveTokenStore } from '@repo/eve-token-store'
import type {
	StructureCitadelListQuery,
	StructureMiningListQuery,
	StructureNavigationListQuery,
	StructureOverviewMetrics,
	StructureSkyhookListQuery,
	StructureSovereigntyListQuery,
	StructureSovereigntyListResponse,
	UpdateStructureConfigInput,
	UpdateStructureModuleConfigInput,
} from '@repo/structures'
import type { TypeMetadata, Universe } from '@repo/universe'
import type { App } from '../context'

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
	'magmaticGasEstimatedDepletionAt',
	'superionicIceEstimatedDepletionAt',
] as const

const structureListPagingSchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(25),
	sortBy: z.enum(structureListSortFields).default('fuel'),
	sortDirection: z.enum(['asc', 'desc']).default('asc'),
})

const structureCommonListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	assignedGroupId: z.string().trim().min(1).optional(),
	lowPower: z.enum(['true', 'false']).optional(),
	lowPowerAllowed: z.enum(['true', 'false']).optional(),
	regionId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	state: z.string().trim().min(1).optional(),
	typeId: z.string().trim().min(1).optional(),
})

const citadelStructureListQuerySchema = structureCommonListQuerySchema

const navigationStructureListQuerySchema = structureCommonListQuerySchema

const sovereigntyStructureListQuerySchema = structureListPagingSchema.extend({
	corporationId: z.string().trim().min(1).optional(),
	assignedGroupId: z.string().trim().min(1).optional(),
	regionId: z.string().trim().min(1).optional(),
	systemId: z.string().trim().min(1).optional(),
	controllerAllianceId: z.string().trim().min(1).optional(),
	vulnerabilityState: z.enum(['vulnerable', 'invulnerable', 'reinforced']).optional(),
})

const skyhookStructureListQuerySchema = structureCommonListQuerySchema.extend({
	planetId: z.string().trim().min(1).optional(),
	isRaidable: z.enum(['true', 'false']).optional(),
})

const miningStructureListQuerySchema = structureCommonListQuerySchema.extend({
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
	sovereignty?: {
			hub?: {
				controllerAllianceId?: string | null
				controllerAllianceName?: string | null
				reagentCount?: number
				magmaticGasQuantity?: number
				magmaticGasBurningPerHour?: number
				magmaticGasEstimatedDepletionAt?: string | null
				superionicIceQuantity?: number
				superionicIceBurningPerHour?: number
				superionicIceEstimatedDepletionAt?: string | null
				reagentBay?: {
					lastUpdated: string
					reagents: Array<{
						typeId: string
						typeName?: string | null
					amount: number
					burningPerHour: number
					lastCycle: string
				}>
			}
			upgrades?: Array<{
				typeId: string
				typeName?: string | null
				powerState: string
			}>
			workforceTransport?: {
				configuration: {
					mode: 'import' | 'export' | 'transit' | 'unknown'
					systems: Array<{
						solarSystemId: string
						amount: number | null
					}>
				}
				state: {
					mode: 'import' | 'export' | 'transit' | 'unknown'
					systems: Array<{
						solarSystemId: string
						amount: number | null
					}>
				}
			}
		} | null
	} | null
	includeInStructureAssetSync?: boolean
	[key: string]: unknown
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

function getExecutionContextOrNull(c: { executionCtx?: ExecutionContext }): ExecutionContext | null {
	try {
		return c.executionCtx ?? null
	} catch {
		return null
	}
}

async function enrichStructureDetailTypeNames(
	env: App['Bindings'],
	structure: StructureDetailResponse
): Promise<StructureDetailResponse> {
	const sovereigntyHub = structure.sovereignty?.hub ?? null
	const allianceIds = sovereigntyHub?.controllerAllianceId
		? [sovereigntyHub.controllerAllianceId]
		: []
	const structureTypeIds = new Set<string>([
		...(structure.inventoryBays?.flatMap((bay) => bay.items.map((item) => item.typeId)) ?? []),
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

		return {
			...structure,
			sovereignty: sovereigntyHub
				? {
						...structure.sovereignty,
						hub: {
							...sovereigntyHub,
							controllerAllianceName: sovereigntyHub.controllerAllianceId
								? (allianceNameMap.get(sovereigntyHub.controllerAllianceId) ?? null)
								: null,
						},
					}
				: structure.sovereignty,
		}
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
		sovereignty: sovereigntyHub
			? {
					...structure.sovereignty,
					hub: {
						...sovereigntyHub,
						controllerAllianceName: sovereigntyHub.controllerAllianceId
							? (allianceNameMap.get(sovereigntyHub.controllerAllianceId) ?? null)
							: null,
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
					},
				}
			: structure.sovereignty,
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

app.get('/moon-drills', async (c) => {
	return handleMiningStructuresRequest(c)
})

app.get('/mining-citadels', async (c) => {
	return handleMiningCitadelsStructuresRequest(c)
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
		const structure = (await c.env.STRUCTURES.getVisibleStructureDetail(actor, structureId)) as {
			corporationId: string
			corporationName: string | null
			structureId: string
			name: string | null
		} | null
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}

		const workflow = await c.env.EXPORT_WORKFLOW.create({
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

		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await c.env.STRUCTURES.listCitadelStructures(await getStructureActor(c), query)
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
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
		}) satisfies StructureNavigationListQuery
		return c.json(
			stripUpdatedAtFromStructureListResponse(
				await c.env.STRUCTURES.listNavigationStructures(await getStructureActor(c), query)
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
			sortBy: c.req.query('sortBy') || undefined,
			sortDirection: c.req.query('sortDirection') || undefined,
			corporationId: c.req.query('corporationId') || undefined,
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			controllerAllianceId: c.req.query('controllerAllianceId') || undefined,
			vulnerabilityState: c.req.query('vulnerabilityState') || undefined,
		}) satisfies StructureSovereigntyListQuery
		const response = await c.env.STRUCTURES.listSovereigntyStructures(await getStructureActor(c), query)
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
			planetId: c.req.query('planetId') || undefined,
			isRaidable: c.req.query('isRaidable') || undefined,
		}) satisfies StructureSkyhookListQuery
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
			assignedGroupId: c.req.query('assignedGroupId') || undefined,
			lowPower: c.req.query('lowPower') || undefined,
			lowPowerAllowed: c.req.query('lowPowerAllowed') || undefined,
			regionId: c.req.query('regionId') || undefined,
			systemId: c.req.query('systemId') || undefined,
			state: c.req.query('state') || undefined,
			typeId: c.req.query('typeId') || undefined,
			planetId: c.req.query('planetId') || undefined,
		}) satisfies StructureMiningListQuery
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
		const query = miningStructureListQuerySchema.parse({
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
			planetId: c.req.query('planetId') || undefined,
		}) satisfies StructureMiningListQuery
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

async function handleStructureOverviewRequest(c: Context<App>): Promise<Response> {
	const user = c.get('user')
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401)
	}

	try {
		return c.json(
			(await c.env.STRUCTURES.getStructureOverviewMetrics(
				await getStructureActor(c)
			)) satisfies StructureOverviewMetrics
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
		const structure = await c.env.STRUCTURES.getVisibleStructureDetail(
			await getStructureActor(c),
			structureId
		)
		if (!structure) {
			return c.json({ error: 'Structure not found' }, 404)
		}
		return c.json(
			stripUpdatedAtFromStructureItem(
				await enrichStructureDetailTypeNames(c.env, structure as StructureDetailResponse)
			)
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
			stripUpdatedAtFromStructureItem(
				await enrichStructureDetailTypeNames(c.env, structure as StructureDetailResponse)
			)
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
