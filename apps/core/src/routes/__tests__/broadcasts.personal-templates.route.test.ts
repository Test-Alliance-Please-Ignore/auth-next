import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ROLE_CORE_ALLIANCE_MEMBER } from '@repo/core'
import { getStub } from '@repo/do-utils'

import { getCachedUserPermissions } from '../../lib/groups-cache'
import { PersonalBroadcastTemplatesService } from '../../services/personal-broadcast-templates'
import broadcastsRoutes from '../broadcasts'

import type {
	BroadcastTarget,
	BroadcastTemplate,
	PersonalBroadcastTemplateInput,
} from '@repo/broadcasts'
import type { App, SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({ getStub: vi.fn() }))
vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedUserMemberships: vi.fn(),
}))
vi.mock('../../db', () => ({ createDb: vi.fn(), schema: {} }))
vi.mock('../../services/personal-broadcast-templates', () => ({
	PersonalBroadcastTemplatesService: vi.fn(),
}))

const service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
const stub = {
	getTarget: vi.fn(),
	getTemplate: vi.fn(),
	createTemplate: vi.fn(),
	updateTemplate: vi.fn(),
	createBroadcast: vi.fn(),
	sendBroadcast: vi.fn(),
}
const user: SessionUser = {
	id: 'user-1',
	mainCharacterId: '7001',
	sessionId: 'session-1',
	characters: [],
	is_admin: false,
	roles: [ROLE_CORE_ALLIANCE_MEMBER],
	discordUserId: null,
}
const target: BroadcastTarget = {
	id: 'target-1',
	name: 'Target',
	description: null,
	type: 'discord_channel',
	sendPermissionId: 'send-1',
	managePermissionId: 'manage-1',
	displayOrder: 0,
	config: {},
	createdBy: 'admin',
	createdAt: '',
	updatedAt: '',
}
const template: BroadcastTemplate = {
	id: 'template-1',
	name: 'Global template',
	description: null,
	targetType: target.type,
	targetIds: [target.id],
	displayOrder: 0,
	fieldSchema: [{ name: 'notes', label: 'Notes', type: 'text' }],
	messageTemplate: '{{notes}}',
	createdBy: 'admin',
	createdAt: '',
	updatedAt: '',
}
const input: PersonalBroadcastTemplateInput = {
	name: 'My template',
	targetId: target.id,
	templateId: template.id,
	content: { notes: 'My notes' },
}

function app(session: SessionUser | null = user) {
	const result = new Hono<App>()
	result.use('*', async (c, next) => {
		if (session) c.set('user', session)
		await next()
	})
	result.route('/api/broadcasts', broadcastsRoutes)
	return result
}
const env = { BROADCASTS: {}, GROUPS: {}, DATABASE_URL: 'test' } as unknown as App['Bindings']
function request(
	method = 'POST',
	data: unknown = input,
	id = '',
	session: SessionUser | null = user
) {
	return app(session).request(
		`/api/broadcasts/personal-templates${id ? `/${id}` : ''}`,
		{
			method,
			headers: { 'Content-Type': 'application/json' },
			...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(data) }),
		},
		env
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(PersonalBroadcastTemplatesService).mockImplementation(function () {
		return service as unknown as PersonalBroadcastTemplatesService
	})
	vi.mocked(getStub).mockReturnValue(stub as unknown as ReturnType<typeof getStub>)
	vi.mocked(getCachedUserPermissions).mockResolvedValue([
		{
			permissionId: 'send-1',
			urn: 'urn:broadcasts:alliance:test:send',
			name: 'Send',
			description: null,
			category: null,
			groupId: 'group-1',
			groupName: 'Group',
			targetType: 'all_members',
			source: 'global',
		},
	])
	stub.getTarget.mockResolvedValue(target)
	stub.getTemplate.mockResolvedValue(template)
	service.list.mockResolvedValue([{ ...input, id: 'personal-1' }])
	service.create.mockResolvedValue({ ...input, id: 'personal-1' })
	service.update.mockResolvedValue({ ...input, id: 'personal-1' })
	service.delete.mockResolvedValue(true)
})

describe('private broadcast templates', () => {
	it('allows send-only users to save presets, deriving ownership from the session', async () => {
		const response = await request('POST', {
			...input,
			userId: 'victim',
			id: 'forged',
			content: {
				notes: 'Keep',
				__srpToken: 'OLD',
				__baseMessage: 'INJECTED',
				__prefixText: 'Prefix',
				__fleetSessionId: 'OLD-SESSION',
				mentionLevel: 'none',
				unknownField: 'Ignore',
			},
		})
		expect(response.status).toBe(201)
		expect(service.create).toHaveBeenCalledWith(user.id, {
			...input,
			content: { notes: 'Keep', __prefixText: 'Prefix', mentionLevel: 'none' },
		})
		for (const fn of [
			stub.createTemplate,
			stub.updateTemplate,
			stub.createBroadcast,
			stub.sendBroadcast,
		])
			expect(fn).not.toHaveBeenCalled()
	})
	it('lists only the session owner and never accepts an owner supplied in the URL', async () => {
		await app().request('/api/broadcasts/personal-templates?userId=victim', {}, env)
		expect(service.list).toHaveBeenCalledExactlyOnceWith(user.id)
	})
	it.each(['PUT', 'DELETE'])(
		'scopes %s to the current user and returns 404 for another owner’s ID',
		async (method) => {
			service.update.mockResolvedValue(null)
			service.delete.mockResolvedValue(false)
			const response = await request(method, { ...input, userId: 'victim' }, 'victims-template')
			expect(response.status).toBe(404)
			if (method === 'PUT')
				expect(service.update).toHaveBeenCalledWith(user.id, 'victims-template', input)
			else expect(service.delete).toHaveBeenCalledWith(user.id, 'victims-template')
		}
	)
	it('returns a conflict when the atomic save reaches the six-template limit', async () => {
		service.create.mockResolvedValue(null)
		const response = await request()
		expect(response.status).toBe(409)
		expect(await response.json()).toMatchObject({ code: 'PERSONAL_TEMPLATE_LIMIT' })
	})
	it.each(['POST', 'PUT'])('requires current send permission for %s', async (method) => {
		vi.mocked(getCachedUserPermissions).mockResolvedValue([])
		expect((await request(method, input, method === 'PUT' ? 'personal-1' : '')).status).toBe(403)
		expect(service.create).not.toHaveBeenCalled()
		expect(service.update).not.toHaveBeenCalled()
	})
	it('allows owners to delete unavailable presets to free a slot', async () => {
		vi.mocked(getCachedUserPermissions).mockResolvedValue([])
		stub.getTarget.mockResolvedValue(null)
		expect((await request('DELETE', undefined, 'personal-1')).status).toBe(200)
		expect(service.delete).toHaveBeenCalledWith(user.id, 'personal-1')
	})
	it.each([
		null,
		{},
		{ ...input, name: '' },
		{ ...input, name: 'a'.repeat(81) },
		{ ...input, content: null },
		{ ...input, content: { notes: 123 } },
		{ ...input, content: { notes: 'a'.repeat(4001) } },
	])('rejects malformed or oversized input %j', async (data) => {
		expect((await request('POST', data)).status).toBe(400)
		expect(service.create).not.toHaveBeenCalled()
	})
	it.each([
		{ ...template, targetIds: ['other'] },
		{ ...template, targetType: 'other' },
	])('rejects incompatible global templates', async (value) => {
		stub.getTemplate.mockResolvedValue(value)
		expect((await request()).status).toBe(400)
		expect(service.create).not.toHaveBeenCalled()
	})
	it('rejects deleted targets and templates', async () => {
		stub.getTarget.mockResolvedValueOnce(null)
		expect((await request()).status).toBe(404)
		stub.getTemplate.mockResolvedValueOnce(null)
		expect((await request()).status).toBe(404)
		expect(service.create).not.toHaveBeenCalled()
	})
	it('supports custom-message presets', async () => {
		expect(
			(
				await request('POST', {
					...input,
					templateId: null,
					content: { message: 'Custom text', __srpToken: 'OLD' },
				})
			).status
		).toBe(201)
		expect(service.create).toHaveBeenCalledWith(user.id, {
			...input,
			templateId: null,
			content: { message: 'Custom text' },
		})
		expect(stub.getTemplate).not.toHaveBeenCalled()
	})
	it.each([null, { ...user, roles: [] }])(
		'requires authentication and broadcast-feature membership',
		async (session) => {
			const response = await request('POST', input, '', session)
			expect([401, 403]).toContain(response.status)
			expect(service.create).not.toHaveBeenCalled()
		}
	)
})
