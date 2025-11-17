/**
 * @repo/beancounter
 *
 * Shared types and interfaces for the Structure Monitor Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

export interface StructureServiceState {
	name: string
	state: string
}

export interface StructureFuelSnapshotInput {
	fuelExpiresAt?: string | null
	services?: StructureServiceState[] | null
	metadata?: Record<string, unknown> | null
	recordedAt?: string | null
}

export interface StructureInventorySlotSnapshot {
	slotName: string
	typeId: string
	quantity: number
}

export interface StructureInventorySnapshotInput {
	recordedAt?: string | null
	slots: StructureInventorySlotSnapshot[]
}

export interface StructureMonitorStatus {
	structureId: string
	lastSnapshotAt: string | null
	fuelExpiresAt: string | null
	services?: StructureServiceState[] | null
}

export interface StructureMonitorSchedulingOptions {
	runAt?: Date
	delayMs?: number
}

/**
 * Public RPC interface for the Structure Monitor Durable Object.
 */
export interface StructureMonitor extends DurableObject {
	recordFuelSnapshot(structureId: string, snapshot: StructureFuelSnapshotInput): Promise<void>
	recordInventorySnapshot(
		structureId: string,
		snapshot: StructureInventorySnapshotInput
	): Promise<void>
	getLatestStatus(structureId: string): Promise<StructureMonitorStatus | null>
	scheduleNextPoll(
		structureId: string,
		options?: StructureMonitorSchedulingOptions
	): Promise<void>
}
