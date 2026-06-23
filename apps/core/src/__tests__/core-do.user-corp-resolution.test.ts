import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getEsiInstance, getEsiInstanceForCorporation } from '@repo/esi'

import { CoreDO } from '../durable-object'

vi.mock('@repo/esi', () => ({
	getEsiInstance: vi.fn(),
	getEsiInstanceForCorporation: vi.fn(),
	getEsiInstanceForCharacter: vi.fn(),
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

describe('CoreDO user corporation and alliance resolution', () => {
	let core: CoreDO
	let dbMock: ReturnType<typeof createDbMock>

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
		;(core as any).getCharacterInfo = vi.fn()

		vi.mocked(getEsiInstanceForCorporation).mockReturnValue(corpStub as any)
		vi.mocked(getEsiInstance).mockReturnValue(allianceStub as any)
	})

	it('resolves corporation names from corporation data rather than character names', async () => {
		dbMock.query.users.findFirst.mockResolvedValue({ id: 'user-1' })
		dbMock.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: 'char-1' },
			{ characterId: 'char-2' },
			{ characterId: 'char-3' },
		])

		;(core as any).getCharacterInfo
			.mockResolvedValueOnce({
				corporation_id: '1001',
				alliance_id: '9001',
				name: 'Alt Alpha',
			})
			.mockResolvedValueOnce({
				corporation_id: '1001',
				alliance_id: '9001',
				name: 'Alt Beta',
			})
			.mockResolvedValueOnce({
				corporation_id: '2002',
				alliance_id: null,
				name: 'Alt Gamma',
			})

		corpStub.fetchCorporationPublicInfo.mockImplementation(async (corporationId: string) => {
			if (corporationId === '1001') {
				return { name: 'Alpha Corp' }
			}
			if (corporationId === '2002') {
				return { name: 'Beta Corp' }
			}
			return null
		})

		const result = await core.getUserCorporations('user-1')

		expect(result).toEqual([
			{ corporationId: '1001', corporationName: 'Alpha Corp' },
			{ corporationId: '2002', corporationName: 'Beta Corp' },
		])
		expect(result.some((corp) => corp.corporationName.startsWith('Alt'))).toBe(false)
	})

	it('resolves alliance names from alliance data rather than corporation names', async () => {
		dbMock.query.users.findFirst.mockResolvedValue({ id: 'user-1' })
		dbMock.query.userCharacters.findMany.mockResolvedValue([
			{ characterId: 'char-1' },
			{ characterId: 'char-2' },
		])

		;(core as any).getCharacterInfo
			.mockResolvedValueOnce({
				corporation_id: '1001',
				alliance_id: '9001',
				name: 'Alt Alpha',
			})
			.mockResolvedValueOnce({
				corporation_id: '2002',
				alliance_id: '9002',
				name: 'Alt Beta',
			})

		allianceStub.fetchAlliancePublicInfo.mockImplementation(async (allianceId: string) => {
			if (allianceId === '9001') {
				return { name: 'First Alliance' }
			}
			if (allianceId === '9002') {
				return { name: 'Second Alliance' }
			}
			return null
		})

		const result = await core.getUserAlliances('user-1')

		expect(result).toEqual([
			{ allianceId: '9001', allianceName: 'First Alliance' },
			{ allianceId: '9002', allianceName: 'Second Alliance' },
		])
		expect(result.some((alliance) => alliance.allianceName.startsWith('Alt'))).toBe(false)
	})

	it('resolves batch corporation names from corporation data for each user', async () => {
		dbMock.query.users.findFirst.mockResolvedValue({ id: 'user-1' })
		dbMock.query.userCharacters.findMany.mockResolvedValue([
			{ userId: 'user-1', characterId: 'char-1' },
			{ userId: 'user-1', characterId: 'char-2' },
			{ userId: 'user-2', characterId: 'char-3' },
		])

		;(core as any).getCharacterInfo
			.mockResolvedValueOnce({
				corporation_id: '1001',
				alliance_id: '9001',
				name: 'Alt Alpha',
			})
			.mockResolvedValueOnce({
				corporation_id: '2002',
				alliance_id: null,
				name: 'Alt Beta',
			})
			.mockResolvedValueOnce({
				corporation_id: '2002',
				alliance_id: null,
				name: 'Alt Gamma',
			})

		corpStub.fetchCorporationPublicInfo.mockImplementation(async (corporationId: string) => {
			if (corporationId === '1001') {
				return { name: 'Alpha Corp' }
			}
			if (corporationId === '2002') {
				return { name: 'Beta Corp' }
			}
			return null
		})

		const result = await core.getUserCorporationsBatch(['user-1', 'user-2'])

		expect(result.get('user-1')).toEqual([
			{ corporationId: '1001', corporationName: 'Alpha Corp' },
			{ corporationId: '2002', corporationName: 'Beta Corp' },
		])
		expect(result.get('user-2')).toEqual([{ corporationId: '2002', corporationName: 'Beta Corp' }])
	})
})
