import { sql } from 'drizzle-orm'

import type { Column, GetColumnData, SQL } from 'drizzle-orm'

export { createDbClient, createDbClientRaw, createDbClientWs, createDbClientRawWs } from './client'
export { migrate, migrateWs } from './migrate'
export type { MigrationConfig } from './migrate'
export type { DbClient, DbClientWs, TimestampFields, NewEntity, UpdateEntity } from './types'

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
type AnySql = SQL | Column
// eslint-disable-next-line @typescript-eslint/array-type
type Coalesce<Array extends AnySql[]> = Array extends [...infer Optionals, infer Last]
	? Exclude<ExtractSqlType<Optionals[number]>, null | undefined> | ExtractSqlType<Last>
	: never
type ExtractSqlType<S> =
	S extends SQL<infer T> ? T : S extends Column ? GetColumnData<S, 'query'> : never

export function coalesce<Args extends [AnySql, AnySql, ...AnySql[]]>(...args: Args) {
	return sql<Coalesce<Args>>`coalesce(${sql.join(
		args.map((a) => sql`${a}`),
		sql.raw(',')
	)})`
}
