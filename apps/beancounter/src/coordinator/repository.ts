import { DbClient, eq } from '@repo/db-utils'

import { corporations, schema, structures } from '../common/db/schema'

import type { StructureRow } from '../common/db/schema'
import type { CorporationScanTarget } from '../types'

/**
 * Persistence layer for the structure coordinator.
 *
 * Methods are intentionally stubbed for now; future plans will implement the real queries.
 */
export class StructureMonitorRepository {
	constructor(private readonly db: DbClient<typeof schema>) {}

	/**
	 * Return all corporations that should be scanned for structures.
	 */
	async listTrackedCorporations(): Promise<CorporationScanTarget[]> {
		// TODO: Implement real query using Drizzle once coordinator logic is ready.
		const result = await this.db
			.select()
			.from(corporations)
			.where(eq(corporations.trackingEnabled, true))

		return result.map((corp) => ({
			...corp,
		}))
	}

	/**
	 * Upsert structures discovered for a corporation.
	 */
	async upsertStructuresForCorporation(
		corporationId: string,
		structures: Array<Pick<StructureRow, 'structureId' | 'typeId' | 'solarSystemId'>>
	): Promise<void> {
		// TODO: Implement real query using Drizzle once coordinator logic is ready.
	}

	/**
	 * Record that a monitor Durable Object exists / was created for a structure.
	 */
	async ensureMonitorInstanceRecord(
		_structureId: string,
		_durableObjectName: string
	): Promise<void> {
		// TODO: Track monitor health + DO mapping.
	}

	/**
	 * Mark a successful heartbeat from a structure monitor DO.
	 */
	async recordMonitorHeartbeat(_structureId: string, _status: string): Promise<void> {
		// TODO: Update heartbeat + status columns.
	}

	/**
	 * Store the outcome of a monitor polling run so the coordinator can aggregate health metrics.
	 */
	async recordMonitorRunResult(
		_structureId: string,
		_result: {
			runId?: string
			status: string
			fuelStatus?: Record<string, unknown>
			inventoryStatus?: Record<string, unknown>
			error?: string
		}
	): Promise<void> {
		// TODO: Write to structure_monitor_runs table.
	}

	/**
	 * Return all structures that are being monitored.
	 */
	async listMonitoredStructures(): Promise<StructureRow[]> {
		return await this.db
			.select()
			.from(structures)
			.where(eq(structures.monitoringEnabled, true))
	}
}
