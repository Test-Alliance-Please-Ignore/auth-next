import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const monitorConfig = sqliteTable('monitor_config', {
	corporationId: text('corporation_id').primaryKey().notNull(),
	structureId: text('structure_id').notNull(),
	structureName: text('structure_name'),
	structureTypeName: text('structure_type_name'),
	structureSolarSystemId: text('structure_solar_system_id'),
	structureSolarSystemName: text('structure_solar_system_name'),
	structureOwnerName: text('structure_owner_name'),
	initialized: integer('initialized').default(0).notNull(),

	lastInventoryRefreshAt: integer('last_inventory_refresh_at', { mode: 'timestamp' }),
})

export type MonitorConfigRow = typeof monitorConfig.$inferSelect
export type NewMonitorConfigRow = typeof monitorConfig.$inferInsert

export const structureSnapshots = sqliteTable('structure_snapshots', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	structureId: text('structure_id').notNull(),
	recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
	fuelExpiresAt: integer('fuel_expires_at', { mode: 'timestamp' }),
	servicesJson: text('services_json', { mode: 'json' })
		.$type<Array<{ name: string; state: string }> | null>()
		.default(null),
	metadataJson: text('metadata_json', { mode: 'json' })
		.$type<Record<string, unknown> | null>()
		.default(null),
})

export const inventorySnapshots = sqliteTable('inventory_snapshots', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	structureId: text('structure_id').notNull(),
	recordedAt: integer('recorded_at', { mode: 'timestamp' }).notNull(),
	slotName: text('slot_name').notNull(),
	typeId: text('type_id').notNull(),
	quantity: integer('quantity').notNull(),
})

export const corporationInventorySnapshots = sqliteTable('corporation_inventory_snapshots', {
	item_id: text('item_id').primaryKey().notNull(),
	corporation_id: text('corporation_id').notNull(),
	is_singleton: integer('is_singleton'),
	location_flag: text('location_flag').notNull(),
	location_id: text('location_id').notNull(),
	location_type: text('location_type').notNull(),
	quantity: integer('quantity').notNull(),
	type_id: text('type_id').notNull(),
	is_blueprint_copy: integer('is_blueprint_copy').default(0).notNull(),
})

export type StructureSnapshotRow = typeof structureSnapshots.$inferSelect
export type NewStructureSnapshotRow = typeof structureSnapshots.$inferInsert

export type InventorySnapshotRow = typeof inventorySnapshots.$inferSelect
export type NewInventorySnapshotRow = typeof inventorySnapshots.$inferInsert
