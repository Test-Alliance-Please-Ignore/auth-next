import { describe, expect, it, vi } from 'vitest'

import {
	getImplicitStructureAccessCorporationIds,
	invalidateImplicitStructureAccess,
} from '../structure-access'

const { getStubMock } = vi.hoisted(() => ({
	getStubMock: vi.fn(),
}))

vi.mock('@repo/do-utils', () => ({
	getStub: getStubMock,
}))

describe('implicit structure access', () => {
	it('resolves active managed CEO and director corporations for the user', async () => {
		const userId = 'user-structure-access'
		const db = {
			query: {
				userCharacters: {
					findMany: vi.fn().mockResolvedValue([
						{ characterId: 'ceo-character', corporationId: 'member-corp' },
						{ characterId: 'director-character', corporationId: 'special-corp' },
						{ characterId: 'unrelated-character', corporationId: 'other-corp' },
					]),
				},
				managedCorporations: {
					findMany: vi
						.fn()
						.mockResolvedValue([
							{ corporationId: 'member-corp' },
							{ corporationId: 'special-corp' },
						]),
				},
			},
		} as never

		getStubMock.mockImplementation((_binding: unknown, corporationId: string) => ({
			getCorporationInfo: vi
				.fn()
				.mockResolvedValue(
					corporationId === 'member-corp'
						? { ceoId: 'ceo-character' }
						: { ceoId: 'other-character' }
				),
			getDirectors: vi
				.fn()
				.mockResolvedValue(
					corporationId === 'special-corp'
						? [{ characterId: 'director-character', isHealthy: false }]
						: []
				),
		}))

		await expect(
			getImplicitStructureAccessCorporationIds({ EVE_CORPORATION_DATA: {} } as never, db, userId)
		).resolves.toEqual(['member-corp', 'special-corp'])

		expect(getStubMock).toHaveBeenCalledTimes(2)
		invalidateImplicitStructureAccess(userId)
	})

	it('does not resolve a corporation when the persisted roster lookup fails', async () => {
		const userId = 'user-structure-access-failure'
		const db = {
			query: {
				userCharacters: {
					findMany: vi
						.fn()
						.mockResolvedValue([
							{ characterId: 'director-character', corporationId: 'member-corp' },
						]),
				},
				managedCorporations: {
					findMany: vi.fn().mockResolvedValue([{ corporationId: 'member-corp' }]),
				},
			},
		} as never
		getStubMock.mockImplementation(() => {
			throw new Error('director dependency unavailable')
		})

		await expect(
			getImplicitStructureAccessCorporationIds({ EVE_CORPORATION_DATA: {} } as never, db, userId)
		).resolves.toEqual([])
		invalidateImplicitStructureAccess(userId)
	})
})
