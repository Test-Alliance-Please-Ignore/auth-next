import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import type { EsiResponse } from '../lib/types'

export const esiCache = sqliteTable('esi_cache', {
	cacheKey: text('cache_key').primaryKey(),
	data: text('data', { mode: 'json' }).$type<unknown>(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }),
	etag: text('etag'),
	lastModified: integer('last_modified', { mode: 'timestamp' }),
	pages: integer('pages'),
	page: integer('page'),
})

export type EsiCacheRow = typeof esiCache.$inferSelect
export type NewEsiCacheRow = typeof esiCache.$inferInsert
