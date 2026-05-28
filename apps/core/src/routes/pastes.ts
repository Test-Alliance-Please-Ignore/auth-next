import { Hono } from 'hono'
import { z } from 'zod'

import { requireAdmin, requireAllianceMember } from '../middleware/session'

import type { PasteWorker } from '@repo/paste'
import type { App } from '../context'

const app = new Hono<App>()

const createPasteSchema = z.object({
	name: z.string().min(1).max(120),
	content: z.string().min(1),
	visibility: z.enum(['alliance', 'public']),
	expiration: z.union([z.number().int().positive(), z.literal('indefinite')]),
	password: z.string().optional(),
})

const updatePasteSchema = z.object({
	name: z.string().min(1).max(120).optional(),
	content: z.string().min(1).optional(),
	visibility: z.enum(['alliance', 'public']).optional(),
	expiration: z.union([z.number().int().positive(), z.literal('indefinite')]).optional(),
	isPasswordProtected: z.boolean().optional(),
	password: z.string().optional(),
})

const decryptPasteSchema = z.object({
	password: z.string().min(1),
})

const rotatePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(1),
})

const updateSettingsSchema = z.object({
	createRateLimitCount: z.number().int().positive(),
	createRateLimitWindowMinutes: z.number().int().positive(),
	maxActivePastesPerUser: z.number().int().positive(),
})

const adminListQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0),
	visibility: z.enum(['alliance', 'public']).optional(),
	creatorUserId: z.string().min(1).optional(),
	createdFrom: z.string().datetime().optional(),
	createdTo: z.string().datetime().optional(),
	expiresFrom: z.string().datetime().optional(),
	expiresTo: z.string().datetime().optional(),
})

function getPasteStub(c: any): PasteWorker {
	return c.env.PASTE
}

function getClientIp(c: any): string {
	return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'
}

async function parseJsonBody(c: any): Promise<unknown> {
	try {
		return await c.req.json()
	} catch {
		throw new Error('Invalid request body')
	}
}

function isPasteValidationErrorMessage(message: string): boolean {
	return (
		message.includes('Password must be') ||
		message.includes('Paste name is required') ||
		message.includes('Paste exceeds 1 MiB size limit') ||
		message.includes('Paste content must be plain text only') ||
		message.includes('Public pastes require password protection') ||
		message.includes('Password is required') ||
		message.includes('Invalid expiration option') ||
		message.includes('Expiration is outside configured limits') ||
		message.includes('Rate limit exceeded for paste creation') ||
		message.includes('Maximum active pastes reached') ||
		message.includes('Paste is not password-protected') ||
		message.includes('Current password is invalid') ||
		message.includes('Content must be provided when updating a protected paste') ||
		message.includes('Rate limit settings must be positive') ||
		message.includes('maxActivePastesPerUser must be positive')
	)
}

function handlePasteRouteError(c: any, error: unknown, fallbackMessage: string = 'Paste operation failed') {
	if (error instanceof Error && isPasteValidationErrorMessage(error.message)) {
		return c.json({ error: error.message }, 400)
	}
	console.error('[Pastes] Unexpected route error', error)
	return c.json({ error: fallbackMessage }, 500)
}

function toPublicViewerResponse(
	payload: Awaited<ReturnType<PasteWorker['getPasteForPublicViewer']>>,
	options?: { includeName?: boolean }
) {
	if (!payload) return null
	return {
		paste: {
			id: payload.paste.id,
			name: options?.includeName ? payload.paste.name : undefined,
		},
		content: payload.content,
		requiresPassword: payload.requiresPassword,
	}
}

app.post('/', requireAllianceMember(), async (c) => {
	const user = c.get('user')!
	const body = await parseJsonBody(c).catch(() => null)
	if (!body) {
		return c.json({ error: 'Invalid request body' }, 400)
	}
	const parsed = createPasteSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
	}

	const primary = user.characters.find((ch) => ch.is_primary)
	try {
		const paste = await getPasteStub(c).createPaste({
			creatorUserId: user.id,
			creatorCharacterId: primary?.characterId ?? null,
			creatorCharacterName: primary?.characterName ?? null,
			name: parsed.data.name,
			content: parsed.data.content,
			visibility: parsed.data.visibility,
			expiration: parsed.data.expiration,
			password: parsed.data.password,
		})
		return c.json(paste, 201)
	} catch (error) {
		return handlePasteRouteError(c, error, 'Failed to create paste')
	}
})

app.get('/settings', requireAllianceMember(), async (c) => {
	return c.json(await getPasteStub(c).getPasteSettings())
})

app.get('/mine', requireAllianceMember(), async (c) => {
	const user = c.get('user')!
	const limit = Number(c.req.query('limit') ?? '50')
	const offset = Number(c.req.query('offset') ?? '0')
	return c.json(await getPasteStub(c).listCreatorPastes({ creatorUserId: user.id, limit, offset }))
})

app.get('/admin/list', requireAdmin(), async (c) => {
	const parsed = adminListQuerySchema.safeParse(c.req.query())
	if (!parsed.success) {
		return c.json({ error: 'Invalid query parameters', issues: parsed.error.issues }, 400)
	}
	const response = await getPasteStub(c).listAdminPastes({
		...parsed.data,
	})
	const adminUser = c.get('user')!
	const uniqueUserIds = [...new Set(response.items.map((item) => item.createdByUserId))]
	const displayNameByUserId = new Map<string, string | null>()
	const results = await Promise.allSettled(
		uniqueUserIds.map(async (userId) => {
			const details = await c.env.ADMIN.getUserDetails(userId, adminUser.id)
			const name = details?.characters.find((char) => char.is_primary)?.characterName ?? null
			return { userId, name }
		})
	)
	for (const result of results) {
		if (result.status === 'fulfilled') {
			displayNameByUserId.set(result.value.userId, result.value.name)
		}
	}
	return c.json({
		...response,
		items: response.items.map((item) => ({
			...item,
			creatorDisplayName: displayNameByUserId.get(item.createdByUserId) ?? null,
		})),
	})
})

app.put('/admin/settings', requireAdmin(), async (c) => {
	const user = c.get('user')!
	const body = await parseJsonBody(c).catch(() => null)
	if (!body) {
		return c.json({ error: 'Invalid request body' }, 400)
	}
	const parsed = updateSettingsSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
	}
	try {
		return c.json(
			await getPasteStub(c).updatePasteSettings({
				actorUserId: user.id,
				...parsed.data,
			})
		)
	} catch (error) {
		return handlePasteRouteError(c, error, 'Failed to update paste settings')
	}
})

app.delete('/admin/:id', requireAdmin(), async (c) => {
	const user = c.get('user')!
	const deleted = await getPasteStub(c).deletePaste({
		pasteId: c.req.param('id'),
		actorUserId: user.id,
		isAdmin: true,
	})
	if (!deleted) return c.json({ error: 'Paste not found' }, 404)
	return c.json({ success: true })
})

app.get('/:id', requireAllianceMember(), async (c) => {
	const paste = await getPasteStub(c).getPasteForAllianceViewer(c.req.param('id'))
	if (!paste) return c.json({ error: 'Paste unavailable' }, 404)
	return c.json(paste)
})

app.post('/:id/decrypt', requireAllianceMember(), async (c) => {
	const body = await parseJsonBody(c).catch(() => null)
	if (!body) return c.json({ error: 'Invalid request body' }, 400)
	const parsed = decryptPasteSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
	const paste = await getPasteStub(c).decryptPaste({
		pasteId: c.req.param('id'),
		password: parsed.data.password,
		requirePublic: false,
	})
	if (!paste) return c.json({ error: 'Invalid password or unavailable paste' }, 404)
	return c.json(paste)
})

app.post('/:id/rotate-password', requireAllianceMember(), async (c) => {
	const user = c.get('user')!
	const body = await parseJsonBody(c).catch(() => null)
	if (!body) return c.json({ error: 'Invalid request body' }, 400)
	const parsed = rotatePasswordSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
	try {
		const updated = await getPasteStub(c).rotatePastePassword({
			pasteId: c.req.param('id'),
			actorUserId: user.id,
			currentPassword: parsed.data.currentPassword,
			newPassword: parsed.data.newPassword,
		})
		if (!updated) return c.json({ error: 'Paste not found' }, 404)
		return c.json(updated)
	} catch (error) {
		return handlePasteRouteError(c, error, 'Failed to rotate paste password')
	}
})

app.patch('/:id', requireAllianceMember(), async (c) => {
	const user = c.get('user')!
	const body = await parseJsonBody(c).catch(() => null)
	if (!body) {
		return c.json({ error: 'Invalid request body' }, 400)
	}
	const parsed = updatePasteSchema.safeParse(body)
	if (!parsed.success) {
		return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400)
	}
	try {
		const updated = await getPasteStub(c).updatePaste({
			pasteId: c.req.param('id'),
			actorUserId: user.id,
			name: parsed.data.name,
			content: parsed.data.content,
			visibility: parsed.data.visibility,
			expiration: parsed.data.expiration,
			isPasswordProtected: parsed.data.isPasswordProtected,
			password: parsed.data.password,
		})
		if (!updated) return c.json({ error: 'Paste not found' }, 404)
		return c.json(updated)
	} catch (error) {
		return handlePasteRouteError(c, error, 'Failed to update paste')
	}
})

app.delete('/:id', requireAllianceMember(), async (c) => {
	const user = c.get('user')!
	const deleted = await getPasteStub(c).deletePaste({
		pasteId: c.req.param('id'),
		actorUserId: user.id,
	})
	if (!deleted) return c.json({ error: 'Paste not found' }, 404)
	return c.json({ success: true })
})

export const publicPasteRoutes = new Hono<App>()
publicPasteRoutes.get('/:id', async (c) => {
	const payload = await getPasteStub(c).getPasteForPublicViewer(c.req.param('id'))
	const paste = toPublicViewerResponse(payload)
	if (!paste) return c.json({ error: 'Invalid password or unavailable paste' }, 404)
	return c.json(paste)
})

publicPasteRoutes.post('/:id/decrypt', async (c) => {
	const ip = getClientIp(c)
	const key = `${ip}:${c.req.param('id')}`
	const canAttempt = await getPasteStub(c).canAttemptPublicDecrypt({ attemptKey: key })
	if (!canAttempt) {
		return c.json({ error: 'Too many attempts. Try again later.' }, 429)
	}
	const body = await parseJsonBody(c).catch(() => null)
	if (!body) return c.json({ error: 'Invalid request body' }, 400)
	const parsed = decryptPasteSchema.safeParse(body)
	if (!parsed.success) return c.json({ error: 'Invalid request body' }, 400)
	const payload = await getPasteStub(c).decryptPaste({
		pasteId: c.req.param('id'),
		password: parsed.data.password,
		requirePublic: true,
		publicAttemptKey: key,
	})
	const paste = toPublicViewerResponse(payload, { includeName: true })
	if (!paste) {
		return c.json({ error: 'Invalid password or unavailable paste' }, 404)
	}
	return c.json(paste)
})

export default app
