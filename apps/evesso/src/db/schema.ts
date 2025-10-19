import { pgTable } from 'drizzle-orm/pg-core'

/**
 * Database schema for the evesso worker
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

// Export an empty object for now to avoid module errors
export const schema = {}
