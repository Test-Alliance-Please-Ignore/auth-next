import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { corporationStructures } from '@repo/eve-corporation-data-db-schema'

export * from '@repo/structures-db-schema'

export { corporationStructures }

/** Read-only mirror of the POS enrichment sidecar owned by eve-corporation-data. */
export const corporationStructurePosDetails = pgTable(
	'corporation_structure_pos_details',
	{
		structureId: text('structure_id')
			.primaryKey()
			.references(() => corporationStructures.structureId, { onDelete: 'cascade' }),
		corporationId: text('corporation_id').notNull(),
		lastAttemptedSyncAt: timestamp('last_attempted_sync_at', { withTimezone: true }),
		lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
		syncFailureReason: text('sync_failure_reason'),
	},
	(table) => [
		index('corp_pos_detail_sync_idx').on(
			table.corporationId,
			table.lastSyncedAt,
			table.lastAttemptedSyncAt
		),
	]
)
