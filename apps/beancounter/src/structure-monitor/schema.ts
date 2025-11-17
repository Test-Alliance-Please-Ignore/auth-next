import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const structureSnapshots = sqliteTable('structure_snapshots', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	structureId: text('structure_id').notNull(),
	recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
	fuelExpiresAt: integer('fuel_expires_at', { mode: 'timestamp' }),
	servicesJson: text('services_json', { mode: 'json' }).$type<
		Array<{ name: string; state: string }> | null
	>().default(null),
	metadataJson: text('metadata_json', { mode: 'json' }).$type<Record<string, unknown> | null>().default(
		null
	),
})

export const inventorySnapshots = sqliteTable('inventory_snapshots', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	structureId: text('structure_id').notNull(),
	recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
	slotName: text('slot_name').notNull(),
	typeId: text('type_id').notNull(),
	quantity: integer('quantity').notNull(),
})

export type StructureSnapshotRow = typeof structureSnapshots.$inferSelect
export type NewStructureSnapshotRow = typeof structureSnapshots.$inferInsert

export type InventorySnapshotRow = typeof inventorySnapshots.$inferSelect
export type NewInventorySnapshotRow = typeof inventorySnapshots.$inferInsert

