export { createDbClient, createDbClientRaw } from './client'
export { migrate } from './migrate'
export type { MigrationConfig } from './migrate'
export type { DbClient, TimestampFields, NewEntity, UpdateEntity } from './types'

// Re-export commonly used Drizzle functions and types
export {
	sql,
	eq,
	and,
	or,
	not,
	isNull,
	isNotNull,
	inArray,
	notInArray,
	between,
	like,
	ilike,
	gt,
	gte,
	lt,
	lte,
	ne,
} from 'drizzle-orm'
export { desc, asc } from 'drizzle-orm'
export type { InferSelectModel, InferInsertModel } from 'drizzle-orm'
export { TestBranchManager } from './test-client'
