import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { buildMyBillListScope, getUserBillScope } from '../bills-user'

vi.mock('@repo/do-utils', () => ({
	getStub: vi.fn(),
}))

vi.mock('../../db', () => ({
	createDb: vi.fn(),
}))

const getStubMock = vi.mocked(getStub)
const createDbMock = vi.mocked(createDb)

describe('bills-user scope helpers', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('builds my-bills scope with user-only issuer IDs', () => {
		const scope = buildMyBillListScope('user-1', {
			characterIds: ['7001'],
			corporationIds: ['100'],
			groupIds: ['group-1'],
			partyEntities: [
				{ entityId: '7001', entityType: 'character' },
				{ entityId: '100', entityType: 'corporation' },
				{ entityId: 'group-1', entityType: 'group' },
			],
		})

		expect(scope.mode).toBe('my')
		expect(scope.issuerIds).toEqual(['user-1'])
		expect(scope.partyEntities).toEqual([
			{ entityId: '7001', entityType: 'character' },
			{ entityId: '100', entityType: 'corporation' },
			{ entityId: 'group-1', entityType: 'group' },
		])
	})

	it('includes linked characters, ceo/director corps, and owner/admin groups', async () => {
		createDbMock.mockReturnValue({
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{ characterId: '7001', characterName: 'Pilot One' },
						{ characterId: '8002', characterName: 'Pilot Two' },
						{ characterId: '9003', characterName: 'Pilot Three' },
					]),
				},
			},
		} as any)

		const characterDataStub = {
			getCharacterInfo: vi.fn(async (characterId: string) => {
				if (characterId === '7001') return { corporationId: '100' }
				if (characterId === '8002') return { corporationId: '200' }
				if (characterId === '9003') return { corporationId: '300' }
				return null
			}),
		}
		const corporationDataStub = {
			getCorporationInfo: vi.fn(async (corporationId: string) => {
				if (corporationId === '100') return { ceoId: '7001' }
				if (corporationId === '200') return { ceoId: '9999' }
				if (corporationId === '300') return { ceoId: '9999' }
				return { ceoId: '0' }
			}),
			getDirectors: vi.fn(async (corporationId: string) => {
				if (corporationId === '200') return [{ characterId: '8002' }]
				return []
			}),
		}
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([
				{ groupId: 'group-owner', isOwner: true, isAdmin: false },
				{ groupId: 'group-admin', isOwner: false, isAdmin: true },
				{ groupId: 'group-member-only', isOwner: false, isAdmin: false },
			]),
		}

		const env = {
			DATABASE_URL: 'postgres://example',
			EVE_CHARACTER_DATA: { binding: 'character' },
			EVE_CORPORATION_DATA: { binding: 'corporation' },
			GROUPS: { binding: 'groups' },
		} as any

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) {
				return characterDataStub as any
			}
			if (binding === env.EVE_CORPORATION_DATA) {
				return corporationDataStub as any
			}
			if (binding === env.GROUPS) {
				return groupsStub as any
			}
			throw new Error(`Unexpected binding: ${String(binding)}`)
		})

		const scope = await getUserBillScope(env, 'user-1')

		expect(new Set(scope.characterIds)).toEqual(new Set(['7001', '8002', '9003']))
		expect(new Set(scope.corporationIds)).toEqual(new Set(['100', '200']))
		expect(new Set(scope.groupIds)).toEqual(new Set(['group-owner', 'group-admin']))

		expect(scope.partyEntities).toEqual(
			expect.arrayContaining([
				{ entityId: '7001', entityType: 'character' },
				{ entityId: '8002', entityType: 'character' },
				{ entityId: '9003', entityType: 'character' },
				{ entityId: '100', entityType: 'corporation' },
				{ entityId: '200', entityType: 'corporation' },
				{ entityId: 'group-owner', entityType: 'group' },
				{ entityId: 'group-admin', entityType: 'group' },
			])
		)

		expect(scope.partyEntities).not.toEqual(
			expect.arrayContaining([{ entityId: '300', entityType: 'corporation' }])
		)
		expect(scope.partyEntities).not.toEqual(
			expect.arrayContaining([{ entityId: 'group-member-only', entityType: 'group' }])
		)
	})

	it('excludes corporations where user is only a regular member (not ceo/director)', async () => {
		createDbMock.mockReturnValue({
			query: {
				userCharacters: {
					findMany: vi
						.fn()
						.mockResolvedValue([{ characterId: '7001', characterName: 'Pilot One' }]),
				},
			},
		} as any)

		const characterDataStub = {
			getCharacterInfo: vi.fn().mockResolvedValue({ corporationId: '555' }),
		}
		const corporationDataStub = {
			getCorporationInfo: vi.fn().mockResolvedValue({ ceoId: '9999' }),
			getDirectors: vi.fn().mockResolvedValue([{ characterId: '8888' }]),
		}
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([]),
		}

		const env = {
			DATABASE_URL: 'postgres://example',
			EVE_CHARACTER_DATA: { binding: 'character' },
			EVE_CORPORATION_DATA: { binding: 'corporation' },
			GROUPS: { binding: 'groups' },
		} as any

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) return characterDataStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub as any
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error(`Unexpected binding: ${String(binding)}`)
		})

		const scope = await getUserBillScope(env, 'user-regular-member')

		expect(scope.characterIds).toEqual(['7001'])
		expect(scope.corporationIds).toEqual([])
		expect(scope.partyEntities).not.toEqual(
			expect.arrayContaining([{ entityId: '555', entityType: 'corporation' }])
		)
	})

	it('excludes member-only corporation affiliation from allowed party entities filter', async () => {
		createDbMock.mockReturnValue({
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{ characterId: '7001', characterName: 'Pilot One' },
						{ characterId: '8002', characterName: 'Pilot Two' },
					]),
				},
			},
		} as any)

		const characterDataStub = {
			getCharacterInfo: vi.fn(async (characterId: string) => {
				if (characterId === '7001') return { corporationId: '100' } // CEO corp
				if (characterId === '8002') return { corporationId: '200' } // member-only corp
				return null
			}),
		}
		const corporationDataStub = {
			getCorporationInfo: vi.fn(async (corporationId: string) => {
				if (corporationId === '100') return { ceoId: '7001' }
				if (corporationId === '200') return { ceoId: '9999' }
				return { ceoId: '0' }
			}),
			getDirectors: vi.fn(async (corporationId: string) => {
				if (corporationId === '200') return [{ characterId: '8888' }]
				return []
			}),
		}
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([]),
		}

		const env = {
			DATABASE_URL: 'postgres://example',
			EVE_CHARACTER_DATA: { binding: 'character' },
			EVE_CORPORATION_DATA: { binding: 'corporation' },
			GROUPS: { binding: 'groups' },
		} as any

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) return characterDataStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub as any
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error(`Unexpected binding: ${String(binding)}`)
		})

		const scope = await getUserBillScope(env, 'user-mixed-affiliations')
		const allowedPartyKeys = new Set(
			scope.partyEntities.map((party) => `${party.entityType}:${party.entityId}`)
		)

		expect(allowedPartyKeys.has('corporation:100')).toBe(true)
		expect(allowedPartyKeys.has('corporation:200')).toBe(false)
	})

	it('treats mixed payer/payee corporation pairs as visible when either side is ceo/director scoped', async () => {
		createDbMock.mockReturnValue({
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{ characterId: '7001', characterName: 'Pilot One' },
						{ characterId: '8002', characterName: 'Pilot Two' },
					]),
				},
			},
		} as any)

		const characterDataStub = {
			getCharacterInfo: vi.fn(async (characterId: string) => {
				if (characterId === '7001') return { corporationId: '100' } // scoped
				if (characterId === '8002') return { corporationId: '200' } // member-only
				return null
			}),
		}
		const corporationDataStub = {
			getCorporationInfo: vi.fn(async (corporationId: string) => {
				if (corporationId === '100') return { ceoId: '7001' }
				if (corporationId === '200') return { ceoId: '9999' }
				return { ceoId: '0' }
			}),
			getDirectors: vi.fn(async (corporationId: string) => {
				if (corporationId === '200') return [{ characterId: '8888' }]
				return []
			}),
		}
		const groupsStub = {
			getUserMemberships: vi.fn().mockResolvedValue([]),
		}

		const env = {
			DATABASE_URL: 'postgres://example',
			EVE_CHARACTER_DATA: { binding: 'character' },
			EVE_CORPORATION_DATA: { binding: 'corporation' },
			GROUPS: { binding: 'groups' },
		} as any

		getStubMock.mockImplementation((binding: unknown) => {
			if (binding === env.EVE_CHARACTER_DATA) return characterDataStub as any
			if (binding === env.EVE_CORPORATION_DATA) return corporationDataStub as any
			if (binding === env.GROUPS) return groupsStub as any
			throw new Error(`Unexpected binding: ${String(binding)}`)
		})

		const scope = await getUserBillScope(env, 'user-mixed-corp-bill')
		const allowedPartyKeys = new Set(
			scope.partyEntities.map((party) => `${party.entityType}:${party.entityId}`)
		)

		const isBillVisible = (payerCorpId: string, payeeCorpId: string): boolean => {
			const payerKey = `corporation:${payerCorpId}`
			const payeeKey = `corporation:${payeeCorpId}`
			return allowedPartyKeys.has(payerKey) || allowedPartyKeys.has(payeeKey)
		}

		// Payer scoped, payee not scoped -> visible
		expect(isBillVisible('100', '200')).toBe(true)
		// Payer not scoped, payee scoped -> visible
		expect(isBillVisible('200', '100')).toBe(true)
		// Neither side scoped -> not visible
		expect(isBillVisible('200', '300')).toBe(false)
	})
})
