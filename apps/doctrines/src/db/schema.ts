import { relations } from 'drizzle-orm'
import {
	boolean,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uuid,
} from 'drizzle-orm/pg-core'

export const doctrinesCategories = pgTable(
	'doctrines_categories',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		sortOrder: integer('sort_order').default(0).notNull(),
	}
)

export const doctrinesStagingSystems = pgTable(
	'doctrines_staging_systems',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		solarSystemId: text('solar_system_id').notNull(),
		solarSystemName: text('solar_system_name').notNull(),
		sortOrder: integer('sort_order').default(0).notNull(),
	}
)

export const doctrinesDoctrines = pgTable(
	'doctrines_doctrines',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		description: text('description'),
		shipTypeId: text('ship_type_id'),
		categoryId: uuid('category_id').references(() => doctrinesCategories.id, { onDelete: 'set null' }),
		sortOrder: integer('sort_order').default(0).notNull(),
		updatedBy: text('updated_by'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		nameIndex: index('doctrines_doctrines_name_idx').on(table.name),
		sortOrderIndex: index('doctrines_doctrines_sort_order_idx').on(table.sortOrder),
	})
)

export const doctrinesFittings = pgTable(
	'doctrines_fittings',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		description: text('description'),
		shipTypeId: text('ship_type_id').notNull(),
		shipName: text('ship_name').notNull(),
		fitting: text('fitting').notNull(),
		category: text('category').notNull(),
		srpEligible: boolean('srp_eligible').default(false).notNull(),
		srpValue: text('srp_value').default('0').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		shipTypeIdIndex: index('doctrines_fittings_ship_type_id_idx').on(table.shipTypeId),
		categoryIndex: index('doctrines_fittings_category_idx').on(table.category),
	})
)

export const doctrinesDoctrineFittings = pgTable(
	'doctrines_doctrine_fittings',
	{
		doctrineId: uuid('doctrine_id')
			.notNull()
			.references(() => doctrinesDoctrines.id, { onDelete: 'cascade' }),
		fittingId: uuid('fitting_id')
			.notNull()
			.references(() => doctrinesFittings.id, { onDelete: 'cascade' }),
		fittingCategory: text('fitting_category').default('Uncategorized').notNull(),
		sortOrder: integer('sort_order').default(0).notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.doctrineId, table.fittingId] }),
	})
)

export const doctrinesFittingItems = pgTable(
	'doctrines_fitting_items',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		fittingId: uuid('fitting_id')
			.notNull()
			.references(() => doctrinesFittings.id, { onDelete: 'cascade' }),
		typeId: text('type_id').notNull(),
		typeName: text('type_name').notNull(),
		quantity: text('quantity').notNull(),
		flagId: text('flag_id').notNull(),
		flagName: text('flag_name').notNull(),
		groupId: text('group_id').notNull(),
		groupName: text('group_name').notNull(),
		categoryId: text('category_id').notNull(),
	},
	(table) => ({
		fittingIdIndex: index('doctrines_fitting_items_fitting_id_idx').on(table.fittingId),
		typeIdIndex: index('doctrines_fitting_items_type_id_idx').on(table.typeId),
		groupIdIndex: index('doctrines_fitting_items_group_id_idx').on(table.groupId),
		categoryIdIndex: index('doctrines_fitting_items_category_id_idx').on(table.categoryId),
	})
)

export const doctrinesDoctrineStagingSystems = pgTable(
	'doctrines_doctrine_staging_systems',
	{
		doctrineId: uuid('doctrine_id')
			.notNull()
			.references(() => doctrinesDoctrines.id, { onDelete: 'cascade' }),
		stagingSystemId: uuid('staging_system_id')
			.notNull()
			.references(() => doctrinesStagingSystems.id, { onDelete: 'cascade' }),
		note: text('note').default('X').notNull(),
	},
	(table) => ({
		pk: primaryKey({ columns: [table.doctrineId, table.stagingSystemId] }),
	})
)

// Relations

export const categoriesRelations = relations(doctrinesCategories, ({ many }) => ({
	doctrines: many(doctrinesDoctrines),
}))

export const stagingSystemsRelations = relations(doctrinesStagingSystems, ({ many }) => ({
	doctrineStagingSystems: many(doctrinesDoctrineStagingSystems),
}))

export const doctrinesRelations = relations(doctrinesDoctrines, ({ one, many }) => ({
	category: one(doctrinesCategories, {
		fields: [doctrinesDoctrines.categoryId],
		references: [doctrinesCategories.id],
	}),
	doctrineFittings: many(doctrinesDoctrineFittings),
	doctrineStagingSystems: many(doctrinesDoctrineStagingSystems),
}))

export const fittingsRelations = relations(doctrinesFittings, ({ many }) => ({
	doctrineFittings: many(doctrinesDoctrineFittings),
	fittingItems: many(doctrinesFittingItems),
}))

export const doctrineFittingsRelations = relations(doctrinesDoctrineFittings, ({ one }) => ({
	doctrine: one(doctrinesDoctrines, {
		fields: [doctrinesDoctrineFittings.doctrineId],
		references: [doctrinesDoctrines.id],
	}),
	fitting: one(doctrinesFittings, {
		fields: [doctrinesDoctrineFittings.fittingId],
		references: [doctrinesFittings.id],
	}),
}))

export const doctrineStagingSystemsRelations = relations(doctrinesDoctrineStagingSystems, ({ one }) => ({
	doctrine: one(doctrinesDoctrines, {
		fields: [doctrinesDoctrineStagingSystems.doctrineId],
		references: [doctrinesDoctrines.id],
	}),
	stagingSystem: one(doctrinesStagingSystems, {
		fields: [doctrinesDoctrineStagingSystems.stagingSystemId],
		references: [doctrinesStagingSystems.id],
	}),
}))

export const fittingItemsRelations = relations(doctrinesFittingItems, ({ one }) => ({
	fitting: one(doctrinesFittings, {
		fields: [doctrinesFittingItems.fittingId],
		references: [doctrinesFittings.id],
	}),
}))
