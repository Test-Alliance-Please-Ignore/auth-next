import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reconcileDirectorsFromCorporationRoles } from '../../../workflows/steps/directors'

const createTokenStoreMock = vi.fn()
const getCorporationDataStubMock = vi.fn()

vi.mock('../../../workflows/utils/services', () => ({
	createDirectorManager: vi.fn(),
	createTokenStore: (...args: unknown[]) => createTokenStoreMock(...args),
	getCorporationDataStub: (...args: unknown[]) => getCorporationDataStubMock(...args),
}))

describe('reconcileDirectorsFromCorporationRoles', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('adds promoted directors and removes demoted directors from configured set', async () => {
		createTokenStoreMock.mockReturnValue({
			fetchEsi: vi.fn().mockResolvedValue({
				data: [
					{ character_id: 1001, roles: ['Director'] },
					{ character_id: 1003, roles: ['CEO'] },
					{ character_id: 1004, roles: ['Trader'] },
				],
			}),
			fetchPublicEsi: vi
				.fn()
				.mockResolvedValueOnce({ data: { name: 'New Director A' } })
				.mockResolvedValueOnce({ data: { name: 'New Director B' } }),
		})

		const addDirector = vi.fn().mockResolvedValue(undefined)
		const removeDirector = vi.fn().mockResolvedValue(undefined)
		getCorporationDataStubMock.mockReturnValue({
			getDirectors: vi.fn().mockResolvedValue([
				{
					directorId: 'dir-1',
					characterId: '1002',
					characterName: 'Old Director',
				},
			]),
			addDirector,
			removeDirector,
		})

		const env = {
			CORE: {
				getCharacterOwner: vi
					.fn()
					.mockResolvedValueOnce({ userId: 'user-1001', isPrimary: false })
					.mockResolvedValueOnce({ userId: 'user-1003', isPrimary: true }),
			},
		} as any
		const result = await reconcileDirectorsFromCorporationRoles(env, '98000001', '90000001')

		expect(result).toEqual({ added: 2, removed: 1, discovered: 2, skippedUnlinked: 0 })
		expect(addDirector).toHaveBeenCalledWith('98000001', '1001', 'New Director A', 100)
		expect(addDirector).toHaveBeenCalledWith('98000001', '1003', 'New Director B', 100)
		expect(removeDirector).toHaveBeenCalledWith('98000001', '1002')
	})

	it('accepts hierarchy roles from positional arrays and leaves unchanged directors intact', async () => {
		createTokenStoreMock.mockReturnValue({
			fetchEsi: vi.fn().mockResolvedValue({
				data: [
					{ character_id: 2001, roles_at_hq: ['Director'] },
					{ character_id: 2002, roles_at_other: ['CEO'] },
				],
			}),
			fetchPublicEsi: vi.fn().mockResolvedValue({ data: { name: '2002' } }),
		})

		const addDirector = vi.fn().mockResolvedValue(undefined)
		const removeDirector = vi.fn().mockResolvedValue(undefined)
		getCorporationDataStubMock.mockReturnValue({
			getDirectors: vi.fn().mockResolvedValue([
				{
					directorId: 'dir-2001',
					characterId: '2001',
					characterName: 'Existing Director',
				},
			]),
			addDirector,
			removeDirector,
		})

		const env = {
			CORE: {
				getCharacterOwner: vi
					.fn()
					.mockResolvedValueOnce({ userId: 'user-2002', isPrimary: false }),
			},
		} as any
		const result = await reconcileDirectorsFromCorporationRoles(env, '98000001', '90000001')

		expect(result).toEqual({ added: 1, removed: 0, discovered: 2, skippedUnlinked: 0 })
		expect(addDirector).toHaveBeenCalledWith('98000001', '2002', '2002', 100)
		expect(removeDirector).not.toHaveBeenCalled()
	})

	it('skips auto-adding promoted directors that are not linked to any user', async () => {
		createTokenStoreMock.mockReturnValue({
			fetchEsi: vi.fn().mockResolvedValue({
				data: [{ character_id: 3001, roles: ['Director'] }],
			}),
			fetchPublicEsi: vi.fn(),
		})

		const addDirector = vi.fn().mockResolvedValue(undefined)
		const removeDirector = vi.fn().mockResolvedValue(undefined)
		getCorporationDataStubMock.mockReturnValue({
			getDirectors: vi.fn().mockResolvedValue([]),
			addDirector,
			removeDirector,
		})

		const env = {
			CORE: {
				getCharacterOwner: vi.fn().mockResolvedValue(null),
			},
		} as any

		const result = await reconcileDirectorsFromCorporationRoles(env, '98000001', '90000001')

		expect(result).toEqual({ added: 0, removed: 0, discovered: 1, skippedUnlinked: 1 })
		expect(addDirector).not.toHaveBeenCalled()
		expect(removeDirector).not.toHaveBeenCalled()
	})
})
