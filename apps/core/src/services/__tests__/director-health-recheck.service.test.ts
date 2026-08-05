import { describe, expect, it, vi } from 'vitest'

import { recheckDirectorHealthAfterTokenReauth } from '../director-health-recheck.service'

import type { DirectorHealthRecheckStub } from '../director-health-recheck.service'

describe('director health reauth recheck', () => {
	it('re-verifies a matching director and updates managed corporation health', async () => {
		const getDirectors = vi
			.fn<DirectorHealthRecheckStub['getDirectors']>()
			.mockResolvedValueOnce([
				{
					directorId: 'dir-1',
					characterId: '111',
					characterName: 'Test Auth',
					isHealthy: false,
					lastHealthCheck: null,
					lastUsed: null,
					failureCount: 3,
					lastFailureReason:
						'Director token is missing required ESI scopes: esi-fleets.read_fleet.v1',
					priority: 100,
				},
				{
					directorId: 'dir-2',
					characterId: '222',
					characterName: 'Other Director',
					isHealthy: true,
					lastHealthCheck: new Date(),
					lastUsed: null,
					failureCount: 0,
					lastFailureReason: null,
					priority: 100,
				},
			])
			.mockResolvedValueOnce([
				{
					directorId: 'dir-1',
					characterId: '111',
					characterName: 'Test Auth',
					isHealthy: true,
					lastHealthCheck: new Date(),
					lastUsed: null,
					failureCount: 0,
					lastFailureReason: null,
					priority: 100,
				},
				{
					directorId: 'dir-2',
					characterId: '222',
					characterName: 'Other Director',
					isHealthy: true,
					lastHealthCheck: new Date(),
					lastUsed: null,
					failureCount: 0,
					lastFailureReason: null,
					priority: 100,
				},
			])

		const verifyDirectorHealth = vi
			.fn<DirectorHealthRecheckStub['verifyDirectorHealth']>()
			.mockResolvedValue(true)

		const updateManagedCorporationHealth = vi.fn().mockResolvedValue(undefined)

		const result = await recheckDirectorHealthAfterTokenReauth({
			characterId: '111',
			characterName: 'Test Auth',
			corporations: [{ corporationId: '1001', name: 'Corp One' }],
			getCorporationStub: (_corporationId) =>
				({
					getDirectors,
					verifyDirectorHealth,
				}) satisfies DirectorHealthRecheckStub,
			updateManagedCorporationHealth,
		})

		expect(verifyDirectorHealth).toHaveBeenCalledTimes(1)
		expect(verifyDirectorHealth).toHaveBeenCalledWith('1001', 'dir-1')
		expect(updateManagedCorporationHealth).toHaveBeenCalledTimes(1)
		expect(updateManagedCorporationHealth).toHaveBeenCalledWith({
			corporationId: '1001',
			healthyDirectorCount: 2,
		})
		expect(result).toEqual({
			matchedCorporations: ['1001'],
			verifiedCorporations: ['1001'],
		})
	})

	it('skips corporations that do not contain the reauthenticated director', async () => {
		const getDirectors = vi.fn().mockResolvedValue([
			{
				directorId: 'dir-9',
				characterId: '999',
				characterName: 'Unrelated Director',
				isHealthy: true,
				lastHealthCheck: new Date(),
				lastUsed: null,
				failureCount: 0,
				lastFailureReason: null,
				priority: 100,
				updatedAt: new Date(),
			},
		])
		const verifyDirectorHealth = vi.fn()
		const updateManagedCorporationHealth = vi.fn()

		const result = await recheckDirectorHealthAfterTokenReauth({
			characterId: '111',
			characterName: 'Test Auth',
			corporations: [{ corporationId: '1001', name: 'Corp One' }],
			getCorporationStub: () =>
				({
					getDirectors,
					verifyDirectorHealth,
				}) satisfies DirectorHealthRecheckStub,
			updateManagedCorporationHealth,
		})

		expect(verifyDirectorHealth).not.toHaveBeenCalled()
		expect(updateManagedCorporationHealth).not.toHaveBeenCalled()
		expect(result).toEqual({
			matchedCorporations: [],
			verifiedCorporations: [],
		})
	})
})
