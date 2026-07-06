import { Hono } from 'hono'
import { z } from 'zod'

import { asc, eq } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'
import {
	normalizeSidebarExternalLinkIconName,
	resolveSidebarExternalLinkIconName,
} from '@repo/admin'

import { createDb } from '../../db'
import { sidebarExternalLinks } from '../../db/schema'
import { requireAdmin, requireAuth } from '../../middleware/session'

import type { SidebarExternalLinkSummary } from '@repo/admin'
import type { App } from '../../context'

const app = new Hono<App>()

const iconNameSchema = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => normalizeSidebarExternalLinkIconName(value) !== null,
		{ message: 'unsupported icon name' }
	)
const urlSchema = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => {
			try {
				const parsed = new URL(value)
				return parsed.protocol === 'http:' || parsed.protocol === 'https:'
			} catch {
				return false
			}
		},
		{ message: 'url must be a valid http or https URL' }
	)

const createSchema = z.object({
	displayName: z.string().trim().min(1),
	url: urlSchema,
	iconName: iconNameSchema,
	sortOrder: z.coerce.number().int().optional(),
	isEnabled: z.boolean().optional(),
})

const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0, {
	message: 'At least one field is required',
})

function toSummary(
	row: typeof sidebarExternalLinks.$inferSelect
): SidebarExternalLinkSummary {
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

app.get('/external-links', requireAuth(), requireAdmin(), async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const rows = await db.query.sidebarExternalLinks.findMany({
		orderBy: [
			asc(sidebarExternalLinks.sortOrder),
			asc(sidebarExternalLinks.displayName),
			asc(sidebarExternalLinks.id),
		],
	})
	return c.json(rows.map(toSummary))
})

app.post('/external-links', requireAuth(), requireAdmin(), async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const parsed = createSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
	}

	try {
		const [created] = await db
			.insert(sidebarExternalLinks)
			.values({
				displayName: parsed.data.displayName,
				url: parsed.data.url,
				iconName: resolveSidebarExternalLinkIconName(parsed.data.iconName),
				sortOrder: parsed.data.sortOrder ?? 0,
				isEnabled: parsed.data.isEnabled ?? true,
			})
			.returning()
		if (!created) {
			return c.json({ error: 'Failed to create external link' }, 500)
		}
		return c.json(toSummary(created), 201)
	} catch (error) {
		logger.error('[AdminNavigationLinks.create] Failed', {
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to create external link' }, 500)
	}
})

app.patch('/external-links/:id', requireAuth(), requireAdmin(), async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const id = c.req.param('id')
	const parsed = updateSchema.safeParse(await c.req.json())
	if (!parsed.success) {
		return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
	}

	try {
		const [updated] = await db
			.update(sidebarExternalLinks)
			.set({
				...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
				...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
				...(parsed.data.iconName !== undefined
					? { iconName: resolveSidebarExternalLinkIconName(parsed.data.iconName) }
					: {}),
				...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
				...(parsed.data.isEnabled !== undefined ? { isEnabled: parsed.data.isEnabled } : {}),
				updatedAt: new Date(),
			})
			.where(eq(sidebarExternalLinks.id, id))
			.returning()
		if (!updated) {
			return c.json({ error: 'External link not found' }, 404)
		}
		return c.json(toSummary(updated))
	} catch (error) {
		logger.error('[AdminNavigationLinks.update] Failed', {
			id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to update external link' }, 500)
	}
})

app.delete('/external-links/:id', requireAuth(), requireAdmin(), async (c) => {
	const db = createDb(c.env.DATABASE_URL)
	const id = c.req.param('id')

	try {
		const deleted = await db
			.delete(sidebarExternalLinks)
			.where(eq(sidebarExternalLinks.id, id))
			.returning({ id: sidebarExternalLinks.id })
		if (deleted.length === 0) {
			return c.json({ error: 'External link not found' }, 404)
		}
		return c.json({ success: true })
	} catch (error) {
		logger.error('[AdminNavigationLinks.delete] Failed', {
			id,
			error: error instanceof Error ? error.message : String(error),
		})
		return c.json({ error: 'Failed to delete external link' }, 500)
	}
})

export default app
