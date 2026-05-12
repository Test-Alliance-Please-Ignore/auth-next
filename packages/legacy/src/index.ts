/**
 * @repo/legacy
 *
 * Shared RPC interface for legacy migration/history worker.
 */

export type LegacyMigrationStatus = 'pending' | 'partially_applied' | 'applied' | 'dismissed' | 'error'
export type LegacyMigrationSeverity = 'none' | 'high' | 'critical'

export interface LegacyMigrationQueueItem {
	id: string
	modernUserId: string
	legacyAuthUserId: string
	status: LegacyMigrationStatus
	severity: LegacyMigrationSeverity
	candidateSnapshot: Record<string, unknown>
	conflicts: Record<string, unknown>
	lastError: string | null
	lastMatchedAt: Date
	lastReviewedAt: Date | null
	createdAt: Date
	updatedAt: Date
}

export interface LegacyMigrationAction {
	id: string
	queueId: string
	action: 'create' | 'update' | 'recheck' | 'apply' | 'dismiss'
	performedByUserId: string | null
	payload: Record<string, unknown>
	createdAt: Date
}

export interface LegacyHistoryApplication {
	id: string
	legacyApplicationId: string
	legacyAuthUserId: string | null
	characterId: string | null
	characterName: string | null
	corporationId: string | null
	corporationName: string | null
	status: string | null
	applicationDate: Date | null
	metadata: Record<string, unknown> | null
	createdAt: Date
	updatedAt: Date
}

export interface LegacyHistoryEvent {
	id: string
	legacyEventId: string
	legacyApplicationId: string
	legacyAuthUserId: string | null
	eventType: string
	eventCode: number | null
	message: string | null
	legacyActorUserId: string | null
	eventAt: Date | null
	metadata: Record<string, unknown> | null
	createdAt: Date
	updatedAt: Date
}

export interface Legacy extends DurableObject {
	listMigrations(filters: {
		page: number
		pageSize: number
		status?: LegacyMigrationStatus
		severity?: LegacyMigrationSeverity
		modernUserId?: string
		legacyAuthUserId?: string
	}): Promise<{
		items: LegacyMigrationQueueItem[]
		pagination: { page: number; pageSize: number; total: number; totalPages: number }
	}>
	getMigration(id: string): Promise<{ item: LegacyMigrationQueueItem; actions: LegacyMigrationAction[] } | null>
	applyMigration(id: string, payload?: Record<string, unknown>): Promise<{ item: LegacyMigrationQueueItem } | null>
	dismissMigration(id: string, payload?: Record<string, unknown>): Promise<{ item: LegacyMigrationQueueItem } | null>
	resolveMigration(
		id: string,
		payload: { decision: 'accept' | 'reject' | 'needs_review'; note?: string }
	): Promise<{ item: LegacyMigrationQueueItem } | null>
	recheckUser(modernUserId: string, actorUserId?: string): Promise<{
		ok: boolean
		modernUserId: string
		legacyAuthUserIds?: string[]
		created: number
		updated: number
		dismissed: number
		matches?: unknown[]
	}>
	listHistory(filters: {
		page: number
		pageSize: number
		corporationId?: string
		characterId?: string
		characterIds?: string
		characterName?: string
	}): Promise<{
		items: LegacyHistoryApplication[]
		pagination: { page: number; pageSize: number; total: number; totalPages: number }
	}>
	getHistoryApplication(legacyApplicationId: string): Promise<{
		application: LegacyHistoryApplication
		events: LegacyHistoryEvent[]
	} | null>
}

