import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
	reconcileDirectorsFromCorporationRoles,
	selectDirector,
} from '../../../workflows/steps/directors'

const getCorporationDataStubMock = vi.fn()
const createDirectorManagerMock = vi.fn()
const getCorporationEsiMock = vi.fn()
const getPublicEsiMock = vi.fn()

vi.mock('../../../workflows/utils/services', () => ({
	createDirectorManager: (...args: unknown[]) => createDirectorManagerMock(...args),
	getCorporationDataStub: (...args: unknown[]) => getCorporationDataStubMock(...args),
	getCorporationEsi: (...args: unknown[]) => getCorporationEsiMock(...args),
	getPublicEsi: (...args: unknown[]) => getPublicEsiMock(...args),
}))

describe('selectDirector workflow step', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns null when no healthy director is available', async () => {
		createDirectorManagerMock.mockReturnValue({
			selectDirector: vi.fn().mockResolvedValue(null),
		})

		const selected = await selectDirector({} as any, '98000001')

		expect(selected).toBeNull()
	})

	it('returns null when director manager throws (short-circuit authenticated segment)', async () => {
		createDirectorManagerMock.mockReturnValue({
			selectDirector: vi.fn().mockRejectedValue(new Error('director manager unavailable')),
		})

		const selected = await selectDirector({} as any, '98000001')

		expect(selected).toBeNull()
	})
})

describe('reconcileDirectorsFromCorporationRoles', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('adds promoted directors and removes demoted directors from configured set', async () => {
		getCorporationEsiMock.mockReturnValue({
			fetchCorporationMemberRoles: vi.fn().mockResolvedValue([
				{ character_id: '1001', roles: ['Director'] },
				{ character_id: '1003', roles: ['CEO'] },
				{ character_id: '1004', roles: ['Trader'] },
			]),
		})
		getPublicEsiMock.mockReturnValue({
			fetchCharacterPublicInfo: vi
				.fn()
				.mockResolvedValueOnce({ name: 'New Director A' })
				.mockResolvedValueOnce({ name: 'New Director B' }),
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
		getCorporationEsiMock.mockReturnValue({
			fetchCorporationMemberRoles: vi.fn().mockResolvedValue([
				{ character_id: '2001', roles_at_hq: ['Director'] },
				{ character_id: '2002', roles_at_other: ['CEO'] },
			]),
		})
		getPublicEsiMock.mockReturnValue({
			fetchCharacterPublicInfo: vi.fn().mockResolvedValue({ name: '2002' }),
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
				getCharacterOwner: vi.fn().mockResolvedValueOnce({ userId: 'user-2002', isPrimary: false }),
			},
		} as any
		const result = await reconcileDirectorsFromCorporationRoles(env, '98000001', '90000001')

		expect(result).toEqual({ added: 1, removed: 0, discovered: 2, skippedUnlinked: 0 })
		expect(addDirector).toHaveBeenCalledWith('98000001', '2002', '2002', 100)
		expect(removeDirector).not.toHaveBeenCalled()
	})

	it('skips auto-adding promoted directors that are not linked to any user', async () => {
		getCorporationEsiMock.mockReturnValue({
			fetchCorporationMemberRoles: vi
				.fn()
				.mockResolvedValue([{ character_id: '3001', roles: ['Director'] }]),
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
