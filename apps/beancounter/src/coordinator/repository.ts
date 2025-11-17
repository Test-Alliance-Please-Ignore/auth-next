import { schema } from '../common/db/schema'

import type { DbClient } from '@repo/db-utils'
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
		return [] as CorporationScanTarget[]
	}

	/**
	 * Upsert structures discovered for a corporation.
	 */
	async upsertStructuresForCorporation(
		_corporationId: string,
		_structures: Array<Pick<StructureRow, 'structureId' | 'typeId' | 'solarSystemId'>>
	): Promise<void> {
		// TODO: Persist structure metadata in Neon.
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
}
