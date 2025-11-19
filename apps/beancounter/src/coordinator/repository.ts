import { DbClient, desc, eq, inArray, sql } from '@repo/db-utils'

import {
	corporations,
	schema,
	structureMonitorInstances,
	structureMonitorRuns,
	structures,
	structureSnapshots,
} from '../common/db/schema'

import type { StructureRow } from '../common/db/schema'
import type { CorporationScanTarget } from '../types'

/**
 * Persistence layer for the structure coordinator.
 */
export class StructureMonitorRepository {
	constructor(private readonly db: DbClient<typeof schema>) {}

	/**
	 * Return all corporations that should be scanned for structures.
	 */
	async listTrackedCorporations(): Promise<CorporationScanTarget[]> {
		const result = await this.db
			.select()
			.from(corporations)
			.where(eq(corporations.trackingEnabled, true))

		return result
			.filter((corp) => corp && corp.corporationId) // Filter out any undefined/null corporations or corporationId
			.map((corp) => ({
				corporationId: corp.corporationId,
				structureTypeFilter: corp.structureTypeFilter ?? null,
				minimumFuelHours: corp.minimumFuelHours,
			}))
	}

	/**
	 * Upsert structures discovered for a corporation.
	 */
	async upsertStructuresForCorporation(
		corporationId: string,
		structureData: Array<{
			structureId: string
			typeId: string
			systemId: string
			profileId: string
			fuelExpires: Date | null
		}>
	): Promise<void> {
		if (!corporationId || structureData.length === 0) {
			return
		}

		const now = new Date()
		const values = structureData
			.filter((s) => s && s.structureId && s.typeId && s.systemId && s.profileId)
			.map((s) => ({
				corporationId,
				structureId: s.structureId,
				typeId: s.typeId,
				solarSystemId: s.systemId,
				profileId: s.profileId,
				fuelExpiresAt: s.fuelExpires ?? null,
				lastSeenAt: now,
				updatedAt: now,
			}))

		if (values.length === 0) {
			return
		}

		// Insert in batches
		const BATCH_SIZE = 10
		for (let i = 0; i < values.length; i += BATCH_SIZE) {
			const batch = values.slice(i, i + BATCH_SIZE)
			await this.db
				.insert(structures)
				.values(batch)
				.onConflictDoUpdate({
					target: structures.structureId,
					set: {
						typeId: sql`excluded.type_id`,
						solarSystemId: sql`excluded.solar_system_id`,
						profileId: sql`excluded.profile_id`,
						fuelExpiresAt: sql`excluded.fuel_expires_at`,
						lastSeenAt: sql`excluded.last_seen_at`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Record that a monitor Durable Object exists / was created for a structure.
	 */
	async ensureMonitorInstanceRecord(structureId: string, durableObjectName: string): Promise<void> {
		try {
			await this.db
				.insert(structureMonitorInstances)
				.values({
					structureId,
					durableObjectName,
					status: 'starting',
				})
				.onConflictDoUpdate({
					target: structureMonitorInstances.structureId,
					set: {
						durableObjectName: sql`excluded.durable_object_name`,
						// Preserve existing status on conflict - only set to 'starting' on new insert
						updatedAt: sql`excluded.updated_at`,
					},
				})
		} catch (error) {
			// Log error but don't throw - monitor creation should still proceed
			console.error('[Repository] Failed to record monitor instance', {
				structureId,
				durableObjectName,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Map string status to structureMonitorStatusEnum value.
	 */
	private mapStatusToEnum(
		status: string
	): 'idle' | 'starting' | 'active' | 'degraded' | 'unresponsive' | 'disabled' {
		const validStatuses = [
			'idle',
			'starting',
			'active',
			'degraded',
			'unresponsive',
			'disabled',
		] as const
		if (validStatuses.includes(status as (typeof validStatuses)[number])) {
			return status as (typeof validStatuses)[number]
		}
		// Default to 'active' for unknown statuses
		return 'active'
	}

	/**
	 * Mark a successful heartbeat from a structure monitor DO.
	 */
	async recordMonitorHeartbeat(structureId: string, status: string): Promise<void> {
		try {
			const statusEnum = this.mapStatusToEnum(status)
			const now = new Date()

			await this.db
				.update(structureMonitorInstances)
				.set({
					lastHeartbeatAt: now,
					lastHealthCheckAt: now,
					status: statusEnum,
					updatedAt: now,
				})
				.where(eq(structureMonitorInstances.structureId, structureId))
		} catch (error) {
			// Log error but don't throw - heartbeat recording failure shouldn't break monitoring
			console.error('[Repository] Failed to record monitor heartbeat', {
				structureId,
				status,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Store the outcome of a monitor polling run so the coordinator can aggregate health metrics.
	 */
	async recordMonitorRunResult(
		structureId: string,
		result: {
			runId?: string
			status: string
			fuelStatus?: Record<string, unknown>
			inventoryStatus?: Record<string, unknown>
			error?: string
		}
	): Promise<void> {
		try {
			// Optionally get monitorInstanceId if it exists
			const instance = await this.db.query.structureMonitorInstances.findFirst({
				where: eq(structureMonitorInstances.structureId, structureId),
			})

			const now = new Date()
			await this.db.insert(structureMonitorRuns).values({
				structureId,
				monitorInstanceId: instance?.id ?? null,
				startedAt: now, // Could be improved to track actual start time if available
				completedAt: now,
				status: result.status,
				resultSummary: result.error ? `Error: ${result.error}` : 'Completed',
				fuelStatus: result.fuelStatus ?? null,
				inventoryStatus: result.inventoryStatus ?? null,
				error: result.error ?? null,
			})
		} catch (error) {
			// Log error but don't throw - run result recording failure shouldn't break monitoring
			console.error('[Repository] Failed to record monitor run result', {
				structureId,
				status: result.status,
				error: error instanceof Error ? error.message : String(error),
			})
		}
	}

	/**
	 * Return all structures that are being monitored.
	 */
	async listMonitoredStructures(): Promise<StructureRow[]> {
		return await this.db.select().from(structures).where(eq(structures.monitoringEnabled, true))
	}

	/**
	 * Get the latest snapshot for each structure ID.
	 * Returns a map of structureId -> latest snapshot
	 */
	async getLatestSnapshotsForStructures(structureIds: string[]): Promise<
		Map<
			string,
			{
				lastSnapshotAt: string | null
				fuelExpiresAt: string | null
				services: Array<{ name: string; state: string }> | null
			}
		>
	> {
		if (structureIds.length === 0) {
			return new Map()
		}

		// Get the latest snapshot for each structure
		// Using a window function would be ideal, but Drizzle doesn't support it directly
		// So we'll get all snapshots for these structures and filter in memory
		const allSnapshots = await this.db
			.select()
			.from(structureSnapshots)
			.where(inArray(structureSnapshots.structureId, structureIds))
			.orderBy(desc(structureSnapshots.recordedAt))

		console.log('[Repository] Query results', {
			requestedIds: structureIds,
			requestedCount: structureIds.length,
			foundSnapshots: allSnapshots.length,
			snapshotStructureIds: allSnapshots.map((s) => s.structureId),
		})

		// Group by structureId and take the first (latest) for each
		const latestMap = new Map<
			string,
			{
				lastSnapshotAt: string | null
				fuelExpiresAt: string | null
				services: Array<{ name: string; state: string }> | null
			}
		>()

		for (const snapshot of allSnapshots) {
			if (!latestMap.has(snapshot.structureId)) {
				latestMap.set(snapshot.structureId, {
					lastSnapshotAt: snapshot.recordedAt?.toISOString() ?? null,
					fuelExpiresAt: snapshot.fuelExpiresAt?.toISOString() ?? null,
					services: snapshot.servicesJson ?? null,
				})
			}
		}

		console.log('[Repository] Latest map', {
			mapSize: latestMap.size,
			mapKeys: Array.from(latestMap.keys()),
		})

		return latestMap
	}
}
