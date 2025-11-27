import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Database schema for the mumble worker
 *
 * Add your table definitions here using Drizzle ORM.
 *
 * Example:
 * export const users = pgTable('users', {
 *   id: uuid('id').defaultRandom().primaryKey(),
 *   email: varchar('email', { length: 255 }).notNull().unique(),
 *   name: varchar('name', { length: 255 }).notNull(),
 *   createdAt: timestamp('created_at').defaultNow().notNull(),
 *   updatedAt: timestamp('updated_at').defaultNow().notNull(),
 * })
 */

export const users = pgTable(
	'minder_users',
	{
		id: uuid('id').defaultRandom().primaryKey(),
		userName: text('user_name').notNull(),
		coreUserId: text('core_user_id').notNull().unique(),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull(),
	},
	(table) => [index('minder_users_core_user_id_idx').on(table.coreUserId)]
)

// Export an empty object for now to avoid module errors
export const schema = {
	users,
}
