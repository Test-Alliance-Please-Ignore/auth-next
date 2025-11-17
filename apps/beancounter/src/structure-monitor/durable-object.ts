import { DurableObject } from 'cloudflare:workers'

import { desc, eq } from '@repo/db-utils'
import type {
	StructureFuelSnapshotInput,
	StructureInventorySnapshotInput,
	StructureMonitor,
	StructureMonitorSchedulingOptions,
	StructureMonitorStatus,
} from '@repo/beancounter'

import type { Env } from '../context'
import {
	createStructureMonitorDb,
	runStructureMonitorMigrations,
	type StructureMonitorDb,
} from './database'
import { inventorySnapshots, structureSnapshots } from './schema'

const DEFAULT_POLL_DELAY_MS = 15 * 60 * 1000

export class StructureMonitorDO extends DurableObject<Env> implements StructureMonitor {
	private readonly db: StructureMonitorDb

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)

		this.db = createStructureMonitorDb(state.storage)

		state.blockConcurrencyWhile(async () => {
			await runStructureMonitorMigrations(this.db)
		})
	}

	async recordFuelSnapshot(structureId: string, snapshot: StructureFuelSnapshotInput): Promise<void> {
		const recordedAt = snapshot.recordedAt ? new Date(snapshot.recordedAt) : new Date()

		await this.db.insert(structureSnapshots).values({
			structureId,
			recordedAt,
			fuelExpiresAt: snapshot.fuelExpiresAt ? new Date(snapshot.fuelExpiresAt) : null,
			servicesJson: snapshot.services ?? null,
			metadataJson: snapshot.metadata ?? null,
		})
	}

	async recordInventorySnapshot(
		structureId: string,
		snapshot: StructureInventorySnapshotInput
	): Promise<void> {
		if (!snapshot.slots.length) {
			return
		}

		const recordedAt = snapshot.recordedAt ? new Date(snapshot.recordedAt) : new Date()

		await this.db.insert(inventorySnapshots).values(
			snapshot.slots.map((slot) => ({
				structureId,
				recordedAt,
				slotName: slot.slotName,
				typeId: slot.typeId,
				quantity: slot.quantity,
			}))
		)
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
			options?.runAt?.getTime() ??
			(Date.now() + (options?.delayMs ?? DEFAULT_POLL_DELAY_MS))

		await this.state.storage.setAlarm(targetTime)
	}

	async alarm(): Promise<void> {
		console.info('[StructureMonitorDO] alarm fired')
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
}
