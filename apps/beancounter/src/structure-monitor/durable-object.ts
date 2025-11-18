import { DurableObject, RpcTarget } from 'cloudflare:workers'

import { desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createStructureMonitorDb, runStructureMonitorMigrations } from './database'
import { inventorySnapshots, monitorConfig, structureSnapshots } from './schema'

import type {
	StructureCoordinator,
	StructureFuelSnapshotInput,
	StructureInventorySnapshotInput,
	StructureInventoryUpdate,
	StructureMonitor,
	StructureMonitorSchedulingOptions,
	StructureMonitorStatus,
	StructureStatusUpdate,
} from '@repo/beancounter'
import type {
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationStructure,
	EsiCorporationWalletTransaction,
	EveCorporationData,
} from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { InvName, Universe } from '@repo/universe'
import type { Env } from '../context'
import type { StructureMonitorDb } from './database'

const DEFAULT_POLL_DELAY_MS = 15 * 60 * 1000

export function transformAssets(assets: any[]): EsiCorporationAsset[] {
	return assets.map((asset) => ({
		item_id: String(asset.item_id),
		is_singleton: asset.is_singleton,
		location_flag: asset.location_flag,
		location_id: String(asset.location_id),
		location_type: asset.location_type,
		quantity: asset.quantity,
		type_id: String(asset.type_id),
		is_blueprint_copy: asset.is_blueprint_copy,
	}))
}
export class StructureMonitorDO extends DurableObject<Env> implements StructureMonitor {
	private db: StructureMonitorDb
	private logger: typeof logger

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		this.db = createStructureMonitorDb(state.storage)

		this.logger = logger
		state.blockConcurrencyWhile(async () => {
			await runStructureMonitorMigrations(this.db)
		})
	}

	async initialize(
		corporationId: string,
		structureId: string,
		force: boolean = false
	): Promise<boolean> {
		this.logger.setTags({
			corporationId,
			structureId,
			service: 'structure-monitor',
		})

		if (!force) {
			const existingConfig = await this.db.query.monitorConfig.findFirst({
				where: eq(monitorConfig.corporationId, corporationId),
			})

			if (existingConfig) {
				logger.info('[StructureMonitorDO] Already initialized, skipping re-initialization', {
					corporationId,
					structureId,
				})
				return true
			}
		}

		const corpData = await getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
		const structureDetails = await corpData.getStructureDetails(corporationId, structureId)

		await this.db.insert(monitorConfig).values({
			corporationId,
			structureId,
			initialized: 1,
			structureName: structureDetails?.name,
			structureTypeName: structureDetails?.typeName,
			structureSolarSystemId: structureDetails?.solar_system_id,
			structureSolarSystemName: structureDetails?.systemName,
			structureOwnerName: structureDetails?.ownerName,
		})

		return true
	}

	async destroy(): Promise<void> {
		this.logger.info('[StructureMonitorDO] Destroying structure monitor')
		await this.state.storage.deleteAll()
	}

	async getLatestStatus(structureId: string): Promise<StructureMonitorStatus | null> {
		const [latest] = await this.db
			.select()
			.from(structureSnapshots)
			.where(eq(structureSnapshots.structureId, structureId))
			.orderBy(desc(structureSnapshots.recordedAt))
			.limit(1)

		if (!latest) {
			return null
		}

		return {
			structureId,
			lastSnapshotAt: latest.recordedAt?.toISOString() ?? null,
			fuelExpiresAt: latest.fuelExpiresAt?.toISOString() ?? null,
			services: latest.servicesJson ?? null,
		}
	}

	async scheduleNextPoll(
		_structureId: string,
		options?: StructureMonitorSchedulingOptions
	): Promise<void> {
		const targetTime =
			options?.runAt?.getTime() ?? Date.now() + (options?.delayMs ?? DEFAULT_POLL_DELAY_MS)

		await this.state.storage.setAlarm(targetTime)
	}

	async alarm(): Promise<void> {
		console.info('[StructureMonitorDO] alarm fired')
		const config = await this.db.query.monitorConfig.findFirst()
		if (!config) {
			this.logger.error('[StructureMonitorDO] No config found')
			return
		}

		await this.refreshStructureInventory()
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		if (url.pathname === '/status') {
			const structureId = url.searchParams.get('structureId')

			if (!structureId) {
				return new Response('structureId is required', { status: 400 })
			}

			const status = await this.getLatestStatus(structureId)
			return Response.json(status ?? { structureId, status: 'unknown' })
		}

		return new Response('Structure Monitor Durable Object', { status: 200 })
	}

	async refreshStructureInventory(): Promise<void> {
		const config = await this.db.query.monitorConfig.findFirst()
		if (!config) {
			this.logger.error('[StructureMonitorDO] No config found')
			return
		}
		const corporationId = config.corporationId
		const structureId = config.structureId

		const corpData = await getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
		const assets = await corpData.searchAssets(corporationId, {
			locationId: structureId,
		})

		// TODO: Process assets and create inventory snapshots
		// For now, we'll send a placeholder update to demonstrate the flow
		// Once inventory processing is implemented, replace this with actual inventory data

		// Get structure status (fuel, services)
		const structures = await corpData.getStructures(corporationId)
		const structure = structures.find((s) => s.structureId === structureId)

		if (structure) {
			// Get structure name and location name
			// Structure name would need to come from database or Universe service
			// For now, we'll try to get it from Universe service
			let structureName: string | null = null
			let locationName: string | null = null

			try {
				const universe = await getStub<Universe>(this.env.UNIVERSE, 'default')

				// Try to resolve structure name and location name
				// Note: This requires a character ID with access - we might not have this here
				// For now, we'll leave these as null and they can be populated from the database
				// in the coordinator when sending updates
			} catch (error) {
				// Silently fail - we'll get names from database in coordinator
			}

			// Send status update if structure data is available
			const statusUpdate: StructureStatusUpdate = {
				lastSnapshotAt: new Date().toISOString(),
				fuelExpiresAt: structure.fuelExpires ? new Date(structure.fuelExpires).toISOString() : null,
				services: structure.services?.map((s) => ({ name: s.name, state: s.state })) ?? null,
				structureName,
				locationName,
			}

			// Notify coordinator of status update
			try {
				const coordinatorStub = getStub<StructureCoordinator>(
					this.env.STRUCTURE_COORDINATOR,
					'default'
				)
				await coordinatorStub.notifyStatusUpdate(structureId, statusUpdate)
			} catch (error) {
				this.logger.error('[StructureMonitorDO] Failed to notify coordinator of status update', {
					structureId,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		// TODO: Once inventory processing is complete, send inventory update:
		// const inventoryUpdate: StructureInventoryUpdate = {
		//   recordedAt: new Date().toISOString(),
		//   slots: processedSlots
		// }
		// const coordinatorStub = getStub<StructureCoordinator>(this.env.STRUCTURE_COORDINATOR, 'default')
		// await coordinatorStub.notifyInventoryUpdate(structureId, inventoryUpdate)
	}
}
