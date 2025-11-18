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
export interface StructureMonitor {
	/**
	 * Initialize the structure monitor for a specific corporation and structure.
	 * @param corporationId - The ID of the corporation to monitor.
	 * @param structureId - The ID of the structure to monitor.
	 * @param force - If true, force re-initialization even if already initialized.
	 */
	initialize(corporationId: string, structureId: string, force?: boolean): Promise<boolean>

	/**
	 * Destroy the structure monitor for a specific corporation and structure.
	 */
	destroy(): Promise<void>
	getLatestStatus(structureId: string): Promise<StructureMonitorStatus | null>
	scheduleNextPoll(structureId: string, options?: StructureMonitorSchedulingOptions): Promise<void>

	refreshStructureInventory(): Promise<void>
}

/**
 * Inventory update data sent from StructureMonitor to StructureCoordinator.
 */
export interface StructureInventoryUpdate {
	recordedAt: string
	slots: StructureInventorySlotSnapshot[]
}

/**
 * Status update data sent from StructureMonitor to StructureCoordinator.
 */
export interface StructureStatusUpdate {
	lastSnapshotAt: string | null
	fuelExpiresAt: string | null
	services?: StructureServiceState[] | null
	structureName?: string | null
	locationName?: string | null
}

/**
 * Public RPC interface for the Structure Coordinator Durable Object.
 */
export interface StructureCoordinator {
	/**
	 * Notify the coordinator of an inventory update for a structure.
	 * This will broadcast the update to all connected WebSocket clients.
	 */
	notifyInventoryUpdate(structureId: string, update: StructureInventoryUpdate): Promise<void>

	/**
	 * Notify the coordinator of a status update for a structure.
	 * This will broadcast the update to all connected WebSocket clients.
	 */
	notifyStatusUpdate(structureId: string, update: StructureStatusUpdate): Promise<void>

	/**
	 * Scan all tracked corporations for structures.
	 */
	scanCorporations(): Promise<void>

	/**
	 * Sync structures for a specific corporation.
	 */
	syncStructuresForCorp(corporationId: string): Promise<void>

	/**
	 * Ensure a monitor exists for a specific structure.
	 */
	ensureMonitor(corporationId: string, structureId: string): Promise<void>
}

/**
 * WebSocket message protocol types
 */

/**
 * Client → Server message types
 */
export type ClientWebSocketMessage = { type: 'ping' } | { type: 'subscribe' }

/**
 * Server → Client message types
 */
export type ServerWebSocketMessage =
	| {
			type: 'inventory_update'
			structureId: string
			data: StructureInventoryUpdate
			timestamp: string
	  }
	| { type: 'status_update'; structureId: string; data: StructureStatusUpdate; timestamp: string }
	| {
			type: 'initial_status'
			structures: Array<{ structureId: string; status: StructureStatusUpdate | null }>
			timestamp: string
	  }
	| { type: 'pong'; payload: number }
	| { type: 'subscribed' }
	| { type: 'error'; payload: string }
