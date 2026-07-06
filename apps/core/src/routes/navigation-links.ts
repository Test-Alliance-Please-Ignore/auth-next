import { Hono } from 'hono'

import { asc, eq } from '@repo/db-utils'
import { resolveSidebarExternalLinkIconName } from '@repo/admin'

import { createDb } from '../db'
import { sidebarExternalLinks } from '../db/schema'

import type { SidebarExternalLinkSummary } from '@repo/admin'
import type { App } from '../context'

const app = new Hono<App>()

function toSummary(row: typeof sidebarExternalLinks.$inferSelect): SidebarExternalLinkSummary {
	return {
		id: row.id,
		displayName: row.displayName,
		url: row.url,
		iconName: resolveSidebarExternalLinkIconName(row.iconName),
		sortOrder: row.sortOrder,
		isEnabled: row.isEnabled,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	}
}

app.get('/external-links', async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const links = await db.query.sidebarExternalLinks.findMany({
		where: eq(sidebarExternalLinks.isEnabled, true),
		orderBy: [
			asc(sidebarExternalLinks.sortOrder),
			asc(sidebarExternalLinks.displayName),
			asc(sidebarExternalLinks.id),
		],
	})
	return c.json(links.map(toSummary))
})

export default app
