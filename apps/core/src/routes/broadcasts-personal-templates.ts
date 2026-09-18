import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import {
	getPersonalBroadcastTemplateContent,
	isPersonalBroadcastTemplateInput,
} from '@repo/broadcasts'
import { getStub } from '@repo/do-utils'

import { createDb } from '../db'
import { getCachedUserPermissions } from '../lib/groups-cache'
import { PersonalBroadcastTemplatesService } from '../services/personal-broadcast-templates'
import {
	buildBroadcastPermissionContext,
	canAccessBroadcastTargetByAction,
} from './broadcasts-permissions'

import type { Context } from 'hono'
import type { Broadcasts, PersonalBroadcastTemplateInput } from '@repo/broadcasts'
import type { App } from '../context'

const routes = new Hono<App>()
routes.use('*', bodyLimit({ maxSize: 64_000 }))

routes.get('/', async (c) => {
	const service = new PersonalBroadcastTemplatesService(createDb(c.env.DATABASE_URL))
	return c.json(await service.list(c.get('user')!.id))
})

async function save(c: Context<App>, id?: string) {
	const user = c.get('user')!
	const data: unknown = await c.req.json().catch(() => null)
	if (!isPersonalBroadcastTemplateInput(data)) {
		return c.json({ error: 'Invalid personal template', code: 'INVALID_PERSONAL_TEMPLATE' }, 400)
	}
	const broadcasts = getStub<Broadcasts>(c.env.BROADCASTS, 'default')
	const target = await broadcasts.getTarget(data.targetId, user.id)
	if (!target) return c.json({ error: 'Target not found' }, 404)
	if (!user.is_admin) {
		const permissions = buildBroadcastPermissionContext(
			await getCachedUserPermissions(c.env, user.id)
		)
		if (!canAccessBroadcastTargetByAction(target, 'send', permissions)) {
			return c.json({ error: 'Permission denied' }, 403)
		}
	}
	const template = data.templateId ? await broadcasts.getTemplate(data.templateId, user.id) : null
	if (data.templateId && !template) return c.json({ error: 'Template not found' }, 404)
	if (
		template &&
		(template.targetType !== target.type || !template.targetIds.includes(target.id))
	) {
		return c.json({ error: 'Template is not attached to the selected target' }, 400)
	}
	const input: PersonalBroadcastTemplateInput = {
		name: data.name.trim(),
		targetId: target.id,
		templateId: template?.id ?? null,
		content: getPersonalBroadcastTemplateContent(
			data.content,
			template?.fieldSchema.map((field) => field.name) ?? ['message']
		),
	}
	const service = new PersonalBroadcastTemplatesService(createDb(c.env.DATABASE_URL))
	const saved = id ? await service.update(user.id, id, input) : await service.create(user.id, input)
	if (!saved) {
		return id
			? c.json({ error: 'Personal template not found' }, 404)
			: c.json({ error: 'Personal template limit reached', code: 'PERSONAL_TEMPLATE_LIMIT' }, 409)
	}
	return c.json(saved, id ? 200 : 201)
}

routes.post('/', (c) => save(c))
routes.put('/:id', (c) => save(c, c.req.param('id')))
routes.delete('/:id', async (c) => {
	const service = new PersonalBroadcastTemplatesService(createDb(c.env.DATABASE_URL))
	const deleted = await service.delete(c.get('user')!.id, c.req.param('id'))
	return deleted ? c.json({ success: true }) : c.json({ error: 'Personal template not found' }, 404)
})

export default routes
