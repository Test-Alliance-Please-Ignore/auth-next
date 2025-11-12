import { relations } from 'drizzle-orm'
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const doctrinesDoctrines = pgTable(
	'doctrines_doctrines',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		name: text('name').notNull(),
		category: text('category').notNull(),
		maintainer: text('maintainer').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		nameIndex: index('doctrines_doctrines_name_idx').on(table.name),
		categoryIndex: index('doctrines_doctrines_category_idx').on(table.category),
	})
)

export const doctrinesFittings = pgTable(
	'doctrines_fittings',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		shipTypeId: text('ship_type_id').notNull(),
		shipName: text('ship_name').notNull(),
		fitting: text('fitting').notNull(),
		category: text('category').notNull(),
		maintainer: text('maintainer').notNull(),
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

// Relations

export const doctrinesRelations = relations(doctrinesDoctrines, ({ many }) => ({
	doctrineFittings: many(doctrinesDoctrineFittings),
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

export const fittingItemsRelations = relations(doctrinesFittingItems, ({ one }) => ({
	fitting: one(doctrinesFittings, {
		fields: [doctrinesFittingItems.fittingId],
		references: [doctrinesFittings.id],
	}),
}))
