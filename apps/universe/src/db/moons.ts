import { index, integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Moons table
 * Stores EVE Online moon data
 *
 * All IDs stored as text to avoid BigInt serialization issues with Neon serverless
 */
export const moons = pgTable(
	'universe_moons',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		name: text('name').notNull().unique(),
		moonId: text('moon_id').notNull().unique(),
		planetId: text('planet_id').notNull(),
		solarSystemId: text('solar_system_id').notNull(),
		positionX: real('position_x'),
		positionY: real('position_y'),
		positionZ: real('position_z'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		moonIdIdx: index('universe_moons_moon_id_idx').on(table.moonId),
		locationIdx: index('universe_moons_location_idx').on(table.solarSystemId, table.planetId),
		nameIdx: index('universe_moons_name_idx').on(table.name),
	})
)

/**
 * Moon resources table
 * Stores resource composition data for each moon
 *
 * Quantity stored as text to preserve exact decimal precision
 * All IDs stored as text to avoid BigInt serialization issues
 */
export const moonResources = pgTable(
	'universe_moon_resources',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		moonId: integer('moon_id')
			.notNull()
			.references(() => moons.id, { onDelete: 'cascade' }),
		productName: text('product_name').notNull(),
		quantity: text('quantity').notNull(),
		oreTypeId: text('ore_type_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		moonIdIdx: index('universe_moon_resources_moon_id_idx').on(table.moonId),
		lookupIdx: index('universe_moon_resources_lookup_idx').on(table.productName, table.oreTypeId),
		coveringIdx: index('universe_moon_resources_covering_idx').on(
			table.moonId,
			table.productName,
			table.quantity
		),
	})
)
