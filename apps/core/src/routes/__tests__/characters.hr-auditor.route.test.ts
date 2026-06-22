import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import charactersRoutes from '../characters'

import type { SessionUser } from '../../context'

const hoisted = vi.hoisted(() => ({
	hrAccess: {
		resolveHrAccessState: vi.fn(),
	},
	hr: {
		checkPermission: vi.fn(),
		getUserHrCorporations: vi.fn(),
	},
	core: {
		queueImmunitasAccessAlert: vi.fn(),
	},
	resolver: {
		resolveEntityNames: vi.fn(),
	},
	characterData: {
		getInstance: vi.fn(),
	},
	characterInstance: {
		getCharacterInfo: vi.fn(),
		getCorporationHistory: vi.fn(),
		getSkills: vi.fn(),
		getAttributes: vi.fn(),
		getLastUpdated: vi.fn(),
		getSensitiveData: vi.fn(),
		refreshPublicCharacterData: vi.fn(),
	},
	skills: {
		getAllSkills: vi.fn(),
		getSkillsMetadata: vi.fn(),
	},
}))

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

const backgroundTasks: Promise<unknown>[] = []

vi.mock('../../lib/background-task', () => ({
	waitUntilWithTelemetry: (
		_executionCtx: unknown,
		_label: string,
		task: () => Promise<unknown>
	) => {
		backgroundTasks.push(task().catch(() => undefined))
	},
}))

vi.mock('../../lib/hr-access', () => ({
	resolveHrAccessState: hoisted.hrAccess.resolveHrAccessState,
}))

const getStubMock = vi.mocked(getStub)

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '9001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'uc-1',
				characterOwnerHash: 'owner-1',
				characterId: '9001',
				characterName: 'Auditor Pilot',
				is_primary: true,
				hasValidToken: true,
			},
		],
		is_admin: false,
		roles: [],
		discordUserId: null,
		...overrides,
	}
}

function createDb() {
	return {
		query: {
			userCharacters: {
				findFirst: vi.fn(),
			},
			users: {
				findFirst: vi.fn(),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue([{ hasValidToken: false }]),
				})),
			})),
		})),
	}
}

function createApp(user?: SessionUser, db?: ReturnType<typeof createDb>) {
	const app = new Hono<{
		Bindings: any
		Variables: {
			user?: SessionUser
			db?: ReturnType<typeof createDb>
			eveTokenStore?: {
				resolveIds: ReturnType<typeof vi.fn>
			}
		}
	}>()

	app.use('*', async (c, next) => {
		if (user) {
			c.set('user', user)
		}
		if (db) {
			c.set('db', db)
		}
		c.set('eveTokenStore', {
			resolveIds: vi.fn().mockResolvedValue({}),
		})
		await next()
	})

	return app.route('/api/characters', charactersRoutes)
}

describe('character detail access for HR page viewers', () => {
	const env = {
		CORE: { name: 'CORE' },
		HR: { name: 'HR' },
		EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
		SKILLS: { name: 'SKILLS' },
		ESI_TYPE_RESOLVER: { name: 'ESI_TYPE_RESOLVER' },
	} as any

	let db: ReturnType<typeof createDb>

	beforeEach(() => {
		vi.clearAllMocks()
		backgroundTasks.length = 0
		db = createDb()

		hoisted.hrAccess.resolveHrAccessState.mockResolvedValue({
			hasHrAccess: true,
			isHrAuditor: false,
			isSiteAdmin: false,
		})
		hoisted.hr.checkPermission.mockResolvedValue(false)
		hoisted.hr.getUserHrCorporations.mockResolvedValue([])
		hoisted.core.queueImmunitasAccessAlert.mockResolvedValue({
			added: 1,
			skipped: 0,
			pendingCount: 1,
		})
		hoisted.resolver.resolveEntityNames.mockResolvedValue(
			new Map([
				['2001', 'Target Corp'],
				['3001', 'Target Alliance'],
			])
		)
		hoisted.characterData.getInstance.mockResolvedValue(hoisted.characterInstance)
		hoisted.characterInstance.getCharacterInfo.mockResolvedValue({
			characterId: '2001',
			name: 'Target Pilot',
			corporationId: '2001',
			allianceId: '3001',
		})
		hoisted.characterInstance.getCorporationHistory.mockResolvedValue([])
		hoisted.characterInstance.getSkills.mockResolvedValue(null)
		hoisted.characterInstance.getAttributes.mockResolvedValue(null)
		hoisted.characterInstance.getLastUpdated.mockResolvedValue('2026-06-20T00:00:00.000Z')
		hoisted.characterInstance.getSensitiveData.mockResolvedValue({
			wallet: 123456789,
			assets: [],
			status: { state: 'active' },
			location: null,
			skillQueue: [],
		})
		hoisted.characterInstance.refreshPublicCharacterData.mockResolvedValue({})
		hoisted.skills.getAllSkills.mockResolvedValue([])
		hoisted.skills.getSkillsMetadata.mockResolvedValue([])

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.HR) {
				return hoisted.hr as any
			}
			if (binding === env.CORE) {
				return hoisted.core as any
			}
			if (binding === env.EVE_CHARACTER_DATA) {
				return hoisted.characterData as any
			}
			if (binding === env.SKILLS) {
				return hoisted.skills as any
			}
			if (binding === env.ESI_TYPE_RESOLVER) {
				return hoisted.resolver as any
			}
			throw new Error('Unexpected binding')
		})
	})

	it('returns public overview data without private fields', async () => {
		const app = createApp(makeUser(), db)
		const res = await app.request(
			'/api/characters/2001?corporationId=2001',
			{},
			env
		)

		await Promise.all(backgroundTasks.splice(0, backgroundTasks.length))

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.viewedAsHrViewer).toBe(true)
		expect(body.public.skills).toBeUndefined()
		expect(body.private).toBeUndefined()
	})

	it('returns private data for authorized HR users on the private route', async () => {
		hoisted.characterInstance.getSkills.mockResolvedValue({
			skills: [
				{
					active_skill_level: 5,
					skill_id: 123,
					skillpoints_in_skill: 256000,
					trained_skill_level: 5,
				},
			],
			total_sp: 123456,
		})

		vi.mocked(db.query.userCharacters.findFirst).mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)

		const app = createApp(makeUser(), db)
		const res = await app.request(
			'/api/characters/2001/private?corporationId=2001',
			{},
			env
		)

		await Promise.all(backgroundTasks.splice(0, backgroundTasks.length))

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.skills?.totalSp).toBe(123456)
		expect(body.private.wallet).toBe(123456789)
		expect(body.private.status).toEqual({ state: 'active' })
	})

	it('blocks private data on the private route and queues an alert for immunitas targets', async () => {
		hoisted.characterInstance.getSkills.mockResolvedValue({
			skills: [
				{
					active_skill_level: 5,
					skill_id: 123,
					skillpoints_in_skill: 256000,
					trained_skill_level: 5,
				},
			],
			total_sp: 123456,
		})
		vi.mocked(db.query.userCharacters.findFirst).mockResolvedValue({
			userId: 'target-user',
			characterName: 'Target Pilot',
		} as any)
		vi.mocked(db.query.users.findFirst).mockResolvedValue({ immunitas: true } as any)

		const app = createApp(makeUser({ is_admin: true }), db)
		const res = await app.request(
			'/api/characters/2001/private?corporationId=2001',
			{},
			env
		)

		await Promise.all(backgroundTasks.splice(0, backgroundTasks.length))

		expect(res.status).toBe(403)
		expect(hoisted.core.queueImmunitasAccessAlert).toHaveBeenCalledWith({
			targetUserId: 'target-user',
			targetCharacterLabel: 'Target Pilot',
			requestorUserId: 'user-1',
			requestorCharacterLabel: 'Auditor Pilot',
			accessType: 'profile-data',
			source: 'characters.private',
		})
	})

	it('returns skill levels from the dedicated skill route without alerting', async () => {
		hoisted.characterInstance.getSkills.mockResolvedValue({
			skills: [
				{
					active_skill_level: 5,
					skill_id: 123,
					skillpoints_in_skill: 256000,
					trained_skill_level: 5,
				},
			],
			total_sp: 123456,
		})

		const app = createApp(makeUser(), db)
		const res = await app.request('/api/characters/9001/skills', {}, env)

		await Promise.all(backgroundTasks.splice(0, backgroundTasks.length))

		expect(res.status).toBe(200)
		const body = (await res.json()) as any
		expect(body.characterName).toBe('Target Pilot')
		expect(body.totalSp).toBe(123456)
		expect(hoisted.core.queueImmunitasAccessAlert).not.toHaveBeenCalled()
	})

})
