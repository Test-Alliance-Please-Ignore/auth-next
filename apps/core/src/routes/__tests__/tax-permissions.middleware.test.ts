import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { getCachedCharacterPermissions, getCachedUserPermissions } from '../../lib/groups-cache'
import {
	canAuditTaxFeature,
	canManageTaxFeature,
	canReadTaxFeature,
	getTaxCharacterIds,
	hasCorporationSelfServiceAccess,
	hasTaxPermission,
	TAX_ADMIN_URN,
	TAX_AUDITOR_URN,
	TAX_VIEWER_URN,
} from '../../middleware/tax-permissions'

import type { SessionUser } from '../../context'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../lib/groups-cache', () => ({
	getCachedUserPermissions: vi.fn(),
	getCachedCharacterPermissions: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const getCachedUserPermissionsMock = vi.mocked(getCachedUserPermissions)
const getCachedCharacterPermissionsMock = vi.mocked(getCachedCharacterPermissions)

const env = {
	EVE_CORPORATION_DATA: { name: 'EVE_CORPORATION_DATA' },
	EVE_CHARACTER_DATA: { name: 'EVE_CHARACTER_DATA' },
	GROUPS: { name: 'GROUPS' },
} as any

function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
	return {
		id: 'user-1',
		mainCharacterId: '7001',
		sessionId: 'session-1',
		characters: [
			{
				id: 'link-1',
				characterOwnerHash: 'owner-1',
				characterId: '7001',
				characterName: 'Pilot One',
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

describe('tax permissions middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getCachedUserPermissionsMock.mockResolvedValue([])
		getCachedCharacterPermissionsMock.mockResolvedValue([])
		getStubMock.mockReset()
	})

	it('returns character IDs for tax permission checks', () => {
		const user = makeUser({
			characters: [
				{
					id: 'link-1',
					characterOwnerHash: 'owner-1',
					characterId: '7001',
					characterName: 'Pilot One',
					is_primary: true,
					hasValidToken: true,
				},
				{
					id: 'link-2',
					characterOwnerHash: 'owner-2',
					characterId: '8002',
					characterName: 'Pilot Two',
					is_primary: false,
					hasValidToken: true,
				},
			],
		})

		expect(getTaxCharacterIds(user)).toEqual(['7001', '8002'])
	})

	it('grants access for site admins without external permission checks', async () => {
		const allowed = await hasTaxPermission(
			env,
			makeUser({ is_admin: true }),
			[TAX_VIEWER_URN],
			'1001'
		)

		expect(allowed).toBe(true)
		expect(getCachedUserPermissionsMock).not.toHaveBeenCalled()
		expect(getCachedCharacterPermissionsMock).not.toHaveBeenCalled()
	})

	it('grants access when user has group URN permission', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: TAX_AUDITOR_URN }] as any)

		const allowed = await hasTaxPermission(env, makeUser(), [TAX_AUDITOR_URN], '1002')

		expect(allowed).toBe(true)
		expect(getCachedUserPermissionsMock).toHaveBeenCalledTimes(1)
		expect(getCachedCharacterPermissionsMock).not.toHaveBeenCalled()
	})

	it('grants access when character has URN permission', async () => {
		getCachedCharacterPermissionsMock.mockResolvedValue([{ urn: TAX_VIEWER_URN }] as any)

		const allowed = await hasTaxPermission(env, makeUser(), [TAX_VIEWER_URN], '1003')

		expect(allowed).toBe(true)
		expect(getCachedCharacterPermissionsMock).toHaveBeenCalledTimes(1)
	})

	it('denies access with no URNs and no corporation context', async () => {
		const allowed = await hasTaxPermission(env, makeUser(), [TAX_VIEWER_URN])

		expect(allowed).toBe(false)
	})

	it('grants corporation self-service access for CEO', async () => {
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '7001' }),
			getDirectors: vi.fn().mockResolvedValue([]),
		}
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '1200' }),
		}
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub
			if (binding === env.EVE_CHARACTER_DATA) return characterDataStub
			throw new Error('Unexpected binding')
		})

		const allowed = await hasCorporationSelfServiceAccess(
			env,
			makeUser({ id: 'self-service-ceo' }),
			'1200'
		)

		expect(allowed).toBe(true)
		expect(corporationDataStub.getCorporationInfo).toHaveBeenCalledWith('1200')
		expect(corporationDataStub.getDirectors).toHaveBeenCalledWith('1200')
		expect(characterDataStub.getCharacterInfo).toHaveBeenCalledWith('7001')
	})

	it('grants corporation self-service access for director', async () => {
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
			getDirectors: vi.fn().mockResolvedValue([{ characterId: '7001' }]),
		}
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '1300' }),
		}
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub
			if (binding === env.EVE_CHARACTER_DATA) return characterDataStub
			throw new Error('Unexpected binding')
		})

		const allowed = await hasCorporationSelfServiceAccess(
			env,
			makeUser({ id: 'self-service-director' }),
			'1300'
		)

		expect(allowed).toBe(true)
	})

	it('denies corporation self-service when character is not in corporation leadership', async () => {
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
			getDirectors: vi.fn().mockResolvedValue([{ characterId: '8888' }]),
		}
		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '1300' }),
		}
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub
			if (binding === env.EVE_CHARACTER_DATA) return characterDataStub
			throw new Error('Unexpected binding')
		})

		const allowed = await hasCorporationSelfServiceAccess(
			env,
			makeUser({ id: 'self-service-denied' }),
			'1300'
		)

		expect(allowed).toBe(false)
	})

	it('denies corporation self-service when corporation data lookup fails', async () => {
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockRejectedValue(new Error('ESI down')),
			getDirectors: vi.fn().mockResolvedValue([]),
		}
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub
			if (binding === env.EVE_CHARACTER_DATA) return { getCharacterInfo: vi.fn() }
			throw new Error('Unexpected binding')
		})

		const allowed = await hasCorporationSelfServiceAccess(
			env,
			makeUser({ id: 'self-service-error' }),
			'1400'
		)

		expect(allowed).toBe(false)
	})

	it('maps read/audit/manage helpers to correct URN scopes', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: TAX_AUDITOR_URN }] as any)
		const user = makeUser({ id: 'urn-scope-user' })

		const canRead = await canReadTaxFeature(env, user)
		const canAudit = await canAuditTaxFeature(env, user)
		const canManage = await canManageTaxFeature(env, user)

		expect(canRead).toBe(true)
		expect(canAudit).toBe(true)
		expect(canManage).toBe(false)

		getCachedUserPermissionsMock.mockResolvedValue([{ urn: TAX_ADMIN_URN }] as any)
		expect(await canManageTaxFeature(env, makeUser({ id: 'urn-admin-user' }))).toBe(true)
	})

	it('limits viewer URN reads to corporation-scoped membership access', async () => {
		getCachedUserPermissionsMock.mockResolvedValue([{ urn: TAX_VIEWER_URN }] as any)
		getStubMock.mockImplementation((binding: any) => {
			if (binding === env.EVE_CHARACTER_DATA) {
				return {
					getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '2200' }),
				}
			}
			if (binding === env.EVE_CORPORATION_DATA) {
				return {
					getCorporationInfo: vi.fn(),
					getDirectors: vi.fn(),
				}
			}
			throw new Error('Unexpected binding')
		})

		const user = makeUser({ id: 'viewer-user' })
		expect(await canReadTaxFeature(env, user)).toBe(false)
		expect(await canReadTaxFeature(env, user, '2200')).toBe(true)
		expect(await canAuditTaxFeature(env, user, '2200')).toBe(false)
		expect(await canManageTaxFeature(env, user, '2200')).toBe(false)
	})
})
