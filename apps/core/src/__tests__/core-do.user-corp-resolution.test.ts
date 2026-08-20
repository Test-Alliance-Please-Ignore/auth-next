import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPublicEsiInstance } from '@repo/esi'

import { CoreDO } from '../durable-object'

vi.mock('@repo/esi', () => ({
	getPublicEsiInstance: vi.fn(),
}))

function createDbMock() {
	return {
		query: {
			users: {
				findFirst: vi.fn(),
			},
			userCharacters: {
				findMany: vi.fn(),
			},
		},
	}
}

function buildPublicInfo(overrides: Partial<Record<string, unknown>>) {
	return {
		birthday: '2025-05-28T14:55:26Z',
		bloodline_id: '7',
		corporation_id: '1001',
		description: null,
		faction_id: null,
		gender: 'male',
		name: 'Alt Alpha',
		race_id: '8',
		security_status: '1.1',
		title: null,
		...overrides,
	}
}

describe('CoreDO user corporation and alliance resolution', () => {
	let core: CoreDO
	let dbMock: ReturnType<typeof createDbMock>

	const characterStub = {
		fetchCharacterPublicInfo: vi.fn(),
		fetchCharacterAffiliation: vi.fn(),
	}
	const corpStub = {
		fetchCorporationPublicInfo: vi.fn(),
	}
	const allianceStub = {
		fetchAlliancePublicInfo: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()

		dbMock = createDbMock()
		core = Object.create(CoreDO.prototype) as CoreDO
		;(core as any).env = { ESI: {} }
		;(core as any).getDb = vi.fn().mockReturnValue(dbMock)

		vi.mocked(getPublicEsiInstance).mockReturnValue({
			...characterStub,
			...corpStub,
			...allianceStub,
		} as any)
	})

	it('merges affiliation ids over stale public character info', async () => {
		characterStub.fetchCharacterPublicInfo.mockResolvedValue(
			buildPublicInfo({
				corporation_id: '1001',
				alliance_id: '9001',
				name: 'Lorenzini',
			})
		)
		characterStub.fetchCharacterAffiliation.mockResolvedValue([
			{ character_id: 'char-1', corporation_id: '2002', alliance_id: '9002' },
		])

		const result = await (core as any).getCharacterInfo('char-1')

		expect(result).toMatchObject({
			corporation_id: '2002',
			alliance_id: '9002',
			name: 'Lorenzini',
		})
		expect(characterStub.fetchCharacterAffiliation).toHaveBeenCalledWith('char-1', ['char-1'])
	})

	it('resolves corporation names from merged character data rather than stale public info', async () => {
		dbMock.query.users.findFirst.mockResolvedValue({ id: 'user-1' })
		dbMock.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: 'char-1' },
			{ characterId: 'char-2' },
		])

		characterStub.fetchCharacterPublicInfo.mockImplementation(async (characterId: string) => {
			if (characterId === 'char-1') {
				return buildPublicInfo({ corporation_id: '1001', alliance_id: '9001', name: 'Alt Alpha' })
			}

			return buildPublicInfo({
				corporation_id: '1001',
				alliance_id: null,
				name: 'Alt Beta',
			})
		})
		characterStub.fetchCharacterAffiliation.mockImplementation(async (characterId: string) => {
			if (characterId === 'char-1') {
				return [{ character_id: 'char-1', corporation_id: '2002', alliance_id: '9002' }]
			}

			return [{ character_id: 'char-2', corporation_id: '3003' }]
		})

		corpStub.fetchCorporationPublicInfo.mockImplementation(async (corporationId: string) => {
			if (corporationId === '2002') {
				return { name: 'Beta Corp' }
			}
			if (corporationId === '3003') {
				return { name: 'Gamma Corp' }
			}
			return null
		})

		const result = await core.getUserCorporations('user-1')

		expect(result).toEqual([
			{ corporationId: '2002', corporationName: 'Beta Corp' },
			{ corporationId: '3003', corporationName: 'Gamma Corp' },
		])
		expect(characterStub.fetchCharacterAffiliation).toHaveBeenCalledTimes(2)
	})

	it('resolves alliance names from merged character data rather than stale public info', async () => {
		dbMock.query.users.findFirst.mockResolvedValue({ id: 'user-1' })
		dbMock.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: 'char-1' },
			{ characterId: 'char-2' },
		])

		characterStub.fetchCharacterPublicInfo.mockImplementation(async (characterId: string) => {
			if (characterId === 'char-1') {
				return buildPublicInfo({ corporation_id: '1001', alliance_id: '9001', name: 'Alt Alpha' })
			}

			return buildPublicInfo({
				corporation_id: '2002',
				alliance_id: null,
				name: 'Alt Beta',
			})
		})
		characterStub.fetchCharacterAffiliation.mockImplementation(async (characterId: string) => {
			if (characterId === 'char-1') {
				return [{ character_id: 'char-1', corporation_id: '2002', alliance_id: '9002' }]
			}

			return [{ character_id: 'char-2', corporation_id: '3003', alliance_id: '9003' }]
		})

		allianceStub.fetchAlliancePublicInfo.mockImplementation(async (allianceId: string) => {
			if (allianceId === '9002') {
				return { name: 'First Alliance' }
			}
			if (allianceId === '9003') {
				return { name: 'Second Alliance' }
			}
			return null
		})

		const result = await core.getUserAlliances('user-1')

		expect(result).toEqual([
			{ allianceId: '9002', allianceName: 'First Alliance' },
			{ allianceId: '9003', allianceName: 'Second Alliance' },
		])
		expect(characterStub.fetchCharacterAffiliation).toHaveBeenCalledTimes(2)
	})

	it('resolves batch corporation names from merged character data for each user', async () => {
		dbMock.query.users.findFirst.mockResolvedValue({ id: 'user-1' })
		dbMock.query.userCharacters.findMany.mockResolvedValue([
			{ userId: 'user-1', characterId: 'char-1' },
			{ userId: 'user-1', characterId: 'char-2' },
			{ userId: 'user-2', characterId: 'char-3' },
		])

		characterStub.fetchCharacterPublicInfo.mockImplementation(async (characterId: string) => {
			if (characterId === 'char-1') {
				return buildPublicInfo({ corporation_id: '1001', alliance_id: '9001', name: 'Alt Alpha' })
			}
			if (characterId === 'char-2') {
				return buildPublicInfo({
					corporation_id: '1001',
					alliance_id: null,
					name: 'Alt Beta',
				})
			}

			return buildPublicInfo({
				corporation_id: '2002',
				alliance_id: '9003',
				name: 'Alt Gamma',
			})
		})
		characterStub.fetchCharacterAffiliation.mockImplementation(async (characterId: string) => {
			if (characterId === 'char-1') {
				return [{ character_id: 'char-1', corporation_id: '2002', alliance_id: '9002' }]
			}
			if (characterId === 'char-2') {
				return [{ character_id: 'char-2', corporation_id: '2002' }]
			}
			return [{ character_id: 'char-3', corporation_id: '3003', alliance_id: '9003' }]
		})

		corpStub.fetchCorporationPublicInfo.mockImplementation(async (corporationId: string) => {
			if (corporationId === '2002') {
				return { name: 'Beta Corp' }
			}
			if (corporationId === '3003') {
				return { name: 'Gamma Corp' }
			}
			return null
		})

		const result = await core.getUserCorporationsBatch(['user-1', 'user-2'])

		expect(result.get('user-1')).toEqual([{ corporationId: '2002', corporationName: 'Beta Corp' }])
		expect(result.get('user-2')).toEqual([{ corporationId: '3003', corporationName: 'Gamma Corp' }])
		expect(characterStub.fetchCharacterAffiliation).toHaveBeenCalledTimes(3)
	})
})
