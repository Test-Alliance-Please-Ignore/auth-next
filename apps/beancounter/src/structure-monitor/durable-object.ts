import { DurableObject, RpcTarget } from 'cloudflare:workers'

import { desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../common/db'
import { structureSnapshots as pgStructureSnapshots } from '../common/db/schema'
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
import type { Esi } from '@repo/esi'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from '../context'
import type { StructureMonitorDb } from './database'

const DEFAULT_POLL_DELAY_MS = 75 * 60 * 1000 // 1 hour 15 minutes (assets cached for 1 hour)

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

	/**
	 * Sets up logger tags for structure monitoring operations
	 */
	private setLoggerTags(corporationId: string, structureId: string): void {
		this.logger.setTags({
			corporationId,
			structureId,
			service: 'structure-monitor',
		})
	}

	/**
	 * Checks if the monitor is already initialized for the given corporation
	 */
	private async isAlreadyInitialized(corporationId: string): Promise<boolean> {
		const existingConfig = await this.db.query.monitorConfig.findFirst({
			where: eq(monitorConfig.corporationId, corporationId),
		})
		return existingConfig !== null && existingConfig !== undefined
	}

	/**
	 * Deletes existing monitor configuration for the given corporation
	 */
	private async deleteExistingConfig(corporationId: string): Promise<void> {
		await this.db.delete(monitorConfig).where(eq(monitorConfig.corporationId, corporationId))
	}

	/**
	 * Fetches structure details from the corporation data service
	 */
	private async fetchStructureDetails(
		corporationId: string,
		structureId: string
	): Promise<Awaited<ReturnType<EveCorporationData['getStructureDetails']>>> {
		const corpData = getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId)
		return await corpData.getStructureDetails(corporationId, structureId)
	}

	/**
	 * Creates a monitor config object from structure details
	 */
	private createConfigFromStructureDetails(
		corporationId: string,
		structureId: string,
		structureDetails: Awaited<ReturnType<EveCorporationData['getStructureDetails']>>
	) {
		return {
			corporationId,
			structureId,
			initialized: 1,
			structureName: structureDetails?.name ?? null,
			structureTypeName: structureDetails?.typeName ?? null,
			structureSolarSystemId: structureDetails?.solar_system_id ?? null,
			structureSolarSystemName: structureDetails?.systemName ?? null,
			structureOwnerName: structureDetails?.ownerName ?? null,
		}
	}

	/**
	 * Saves monitor configuration to the database
	 */
	private async saveMonitorConfig(
		config: ReturnType<StructureMonitorDO['createConfigFromStructureDetails']>
	): Promise<void> {
		await this.db.insert(monitorConfig).values(config)
	}

	/**
	 * Gets the monitor configuration from the database
	 * Returns null if no config is found
	 */
	private async getMonitorConfig(): Promise<typeof monitorConfig.$inferSelect | null> {
		const config = await this.db.query.monitorConfig.findFirst()
		return config ?? null
	}

	async initialize(
		corporationId: string,
		structureId: string,
		force: boolean = false
	): Promise<boolean> {
		this.setLoggerTags(corporationId, structureId)

		if (!force && (await this.isAlreadyInitialized(corporationId))) {
			logger.info('[StructureMonitorDO] Already initialized, skipping re-initialization', {
				corporationId,
				structureId,
			})
			return true
		}

		// Clear existing config when forcing re-initialization
		if (force && (await this.isAlreadyInitialized(corporationId))) {
			await this.deleteExistingConfig(corporationId)
			logger.info('[StructureMonitorDO] Forced re-initialization: cleared existing config', {
				corporationId,
				structureId,
			})
		}

		const structureDetails = await this.fetchStructureDetails(corporationId, structureId)

		if (!structureDetails) {
			const errorMessage = `Failed to fetch structure details for corporation ${corporationId}, structure ${structureId}. Structure may not exist or no healthy directors available.`
			this.logger.error('[StructureMonitorDO] Cannot initialize without structure details', {
				corporationId,
				structureId,
			})
			throw new Error(errorMessage)
		}

		const config = this.createConfigFromStructureDetails(
			corporationId,
			structureId,
			structureDetails
		)
		await this.saveMonitorConfig(config)

		// Refresh the structure inventory
		await this.refreshStructureInventory()

		// Schedule the first poll after successful initialization
		await this.scheduleNextPoll(structureId)

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
		structureId: string,
		options?: StructureMonitorSchedulingOptions
	): Promise<void> {
		const targetTime =
			options?.runAt?.getTime() ?? Date.now() + (options?.delayMs ?? DEFAULT_POLL_DELAY_MS)

		await this.state.storage.setAlarm(targetTime)
	}

	async alarm(): Promise<void> {
		console.info('[StructureMonitorDO] alarm fired')
		const config = await this.getMonitorConfig()
		if (!config) {
			this.logger.error('[StructureMonitorDO] No config found')
			return
		}

		await this.refreshStructureInventory()

		// Schedule the next poll after refreshing
		await this.scheduleNextPoll(config.structureId)
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
		const config = await this.getMonitorConfig()
		if (!config) {
			this.logger.error('[StructureMonitorDO] No config found')
			return
		}
		const corporationId = config.corporationId
		const structureId = config.structureId

		const stub = getStub<Esi>(this.env.ESI, corporationId)
		const assets = await (stub as any).fetchAssets(corporationId)
		logger.info('[StructureMonitorDO] Fetched assets', {
			corporationId,
			structureId,
			assets,
		})

		const structureAssets = assets.filter((asset: any) => asset.location_id === structureId)
		logger.info('[StructureMonitorDO] Fetched structure assets', {
			corporationId,
			structureId,
			structureAssets,
		})
	}
}
